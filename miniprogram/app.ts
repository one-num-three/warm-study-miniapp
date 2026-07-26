/**
 * 小程序入口。
 *
 * 这里承担三件事：
 *  1. 启动时静默登录 —— 家长打开小程序不需要点任何"登录"按钮，
 *     wx.login 拿 code 换 token，之前绑过的孩子直接还在；
 *  2. 保存全局身份状态（profile / 当前外壳 / 当前查看的孩子），
 *     页面之间不重复拉档案；
 *  3. 提供权限判断和外壳切换，UI 层照着这些方法决定"这个按钮该不该出现"。
 *
 * 为什么用 globalData 而不是引一个状态库：小程序页面栈本身就是全局的，
 * 再套一层订阅机制只会增加心智负担；页面在 onShow 里读一次 globalData 就够了。
 */

import { api, setToken, wxLoginCode, ApiError } from "./utils/api";

/** 外壳：登录页 / 家长端 / 管理端。双身份用户显式切换，两边数据不混（design §1.1）。 */
export type Shell = "login" | "guardian" | "admin";

interface GlobalData {
  /** GET /auth/profile 的返回。结构见 shared/src/types.ts 的 Profile。 */
  profile: any | null;
  shell: Shell;
  /** 家长端当前查看的孩子 id；绑了多个孩子时用切换条改它 */
  activeStudentId: string | null;
  /** 启动流程是否已经跑完 */
  ready: boolean;
  /** 启动失败的原因（一般是后端没起或域名没配），登录页会提示 */
  bootError: string;
}

App({
  globalData: {
    profile: null,
    shell: "login",
    activeStudentId: null,
    ready: false,
    bootError: "",
  } as GlobalData,

  /** 启动流程的 Promise，页面 onLoad 里 await 它，避免比登录还早发请求 */
  readyPromise: null as Promise<void> | null,

  onLaunch() {
    this.readyPromise = this.bootstrap();
  },

  /** 页面统一用这个等启动完成。重复调用只会拿到同一个 Promise。 */
  ready(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.bootstrap();
    return this.readyPromise;
  },

  /**
   * 静默登录：
   *  - 本地已有 token → 直接拉档案（换手机 / 清缓存才会走下面）；
   *  - 没有 token → wx.login 换 code，POST /auth/login 建立微信身份。
   * 任何一步失败都不弹窗打断，把错误留给登录页展示，因为此时用户还什么都没做。
   */
  async bootstrap(): Promise<void> {
    const global = this.globalData as GlobalData;
    global.bootError = "";
    try {
      const profile = await api.get<any>("/auth/profile");
      this.applyProfile(profile);
    } catch (error) {
      // 没登录过或 token 失效，走微信静默登录
      if (error instanceof ApiError && error.code === "NETWORK") {
        global.bootError = error.message;
      }
      try {
        const code = await wxLoginCode();
        const result = await api.post<any>("/auth/login", { loginType: "wechat", code });
        setToken(result.token);
        this.applyProfile(result.profile);
        global.bootError = "";
      } catch (loginError) {
        setToken(null);
        global.profile = null;
        global.shell = "login";
        global.bootError =
          loginError instanceof ApiError ? loginError.message : "启动失败，请检查网络后重试";
      }
    }
    global.ready = true;
  },

  /** 写入档案并决定默认落在哪个外壳。管理端身份优先进工作台，家长可在「我的」里切回去。 */
  applyProfile(profile: any, shell?: Shell): void {
    const global = this.globalData as GlobalData;
    global.profile = profile;
    global.shell = shell ?? (this.isManagement(profile) ? "admin" : "guardian");
    const students = profile?.students ?? [];
    if (students.length > 0) {
      const stillBound = students.some((item: any) => item.id === global.activeStudentId);
      if (!global.activeStudentId || !stillBound) global.activeStudentId = students[0].id;
    } else {
      global.activeStudentId = null;
    }
  },

  /** 重新拉一次档案。绑定 / 解绑 / 发积分之后调用，保证「我的孩子」是最新的。 */
  async refreshProfile(): Promise<any> {
    const global = this.globalData as GlobalData;
    const profile = await api.get<any>("/auth/profile");
    // 只更新档案，不改当前外壳 —— 用户正在管理端时不该被弹回家长端
    this.applyProfile(profile, global.shell === "login" ? undefined : global.shell);
    return profile;
  },

  /* ------------------------------ 身份与权限 ------------------------------ */

  isManagement(profile?: any): boolean {
    const target = profile ?? (this.globalData as GlobalData).profile;
    const roles = target?.roles ?? [];
    return roles.indexOf("owner") >= 0 || roles.indexOf("staff") >= 0;
  },

  isOwner(profile?: any): boolean {
    const target = profile ?? (this.globalData as GlobalData).profile;
    return (target?.roles ?? []).indexOf("owner") >= 0;
  },

  /** 权限码见 shared/src/permissions.ts。界面上不该出现的入口直接不渲染，服务端再校验一次。 */
  can(permission: string): boolean {
    const profile = (this.globalData as GlobalData).profile;
    return Boolean(profile && (profile.permissions ?? []).indexOf(permission) >= 0);
  },

  /* ------------------------------ 家长端的孩子 ------------------------------ */

  /** 当前选中的孩子；没显式选过就用第一个。没绑孩子返回 null。 */
  activeStudent(): any | null {
    const global = this.globalData as GlobalData;
    const students = global.profile?.students ?? [];
    if (students.length === 0) return null;
    const found = students.filter((item: any) => item.id === global.activeStudentId)[0];
    return found ?? students[0];
  },

  selectStudent(studentId: string): void {
    (this.globalData as GlobalData).activeStudentId = studentId;
  },

  /* -------------------------------- 外壳切换 -------------------------------- */

  switchShell(shell: Shell): void {
    (this.globalData as GlobalData).shell = shell;
    this.enterShell();
  },

  /** 按当前外壳跳到对应首页。用 reLaunch 清栈，避免从管理端返回时串到家长页。 */
  enterShell(): void {
    const shell = (this.globalData as GlobalData).shell;
    if (shell === "admin") {
      wx.reLaunch({ url: "/pages/admin/board/board" });
    } else if (shell === "guardian") {
      wx.reLaunch({ url: "/pages/guardian/today/today" });
    } else {
      wx.reLaunch({ url: "/pages/login/login" });
    }
  },

  /**
   * 退出登录。服务端可能已经失效了，本地照样清干净再回登录页。
   * 注意：退出后下次启动仍会用同一个微信身份静默登录，
   * 但绑定关系在服务端，所以"退出"= 断开本机会话，不等于解绑。
   */
  async logout(): Promise<void> {
    try {
      await api.post("/auth/logout", {});
    } catch (error) {
      // 忽略：token 可能已经过期，本地清理才是关键
    }
    setToken(null);
    const global = this.globalData as GlobalData;
    global.profile = null;
    global.activeStudentId = null;
    global.shell = "login";
    global.ready = false;
    this.readyPromise = null;
    wx.reLaunch({ url: "/pages/login/login" });
  },
});
