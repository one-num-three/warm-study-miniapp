/**
 * 登录页 —— 整个产品的入口，和 h5/src/pages/login.ts 一一对应。
 *
 * 家长：输入辅导班给的绑定码，输完即和孩子绑定，不注册、不填手机号、不设密码。
 * 管理端：老师 / 负责人用账号密码登录。
 *
 * 绑定码输入刻意做了三层体验，这是本页最值得花功夫的地方：
 *  1. 边输边归一化 —— 自动大写、第 5 位自动补短横、把手输最容易错的 O→0 / I、L→1 纠回来；
 *  2. 输满 8 位先在本地验校验位 —— 错了当场红框提示，不浪费一次网络往返，也不让服务端替用户挑错；
 *  3. 校验位过了才去服务端要一次"脱敏姓名预览" —— 让家长确认绑的是自家娃再提交，
 *     避免抄错一位把孩子绑到别人家去。
 */

import { normalizeBindingCode, validateBindingCode } from "../../shared/binding-code.js";
import { api, ApiError, setToken, toast, toastError, wechatLoginPayload } from "../../utils/api";

const RELATIONS = ["妈妈", "爸爸", "爷爷", "奶奶", "外公", "外婆", "其他家长"];

/** 预览请求的防抖计时器。放在模块级是因为它和页面数据无关，不需要进 setData。 */
let previewTimer = 0;

Page({
  data: {
    /** 启动流程还没跑完时先显示占位，避免表单闪一下又跳走 */
    booting: true,
    /** guardian：家长绑定码；staff：管理端账密 */
    mode: "guardian",

    /* -------- 家长绑定码 -------- */
    codeDisplay: "",
    /** 归一化后的 8 位规范码，提交时用它 */
    codeNormalized: "",
    codeClass: "code-input",
    /** 灰色提示（还差几位 / 正在核对） */
    codeHint: "",
    /** 红色错误 */
    codeError: "",
    /** 服务端返回的脱敏预览："小*  ·  三年级" */
    preview: null as { studentHint: string; grade: string } | null,
    relations: RELATIONS,
    relation: RELATIONS[0],
    guardianName: "",
    canBind: false,
    binding: false,

    /* -------- 管理端账密 -------- */
    username: "",
    password: "",
    staffLogging: false,

    /** 已经绑过孩子却又回到登录页时，给一个直接进入的入口 */
    boundNames: "",
    /** 启动失败（后端没起 / 合法域名没配）时的提示 */
    bootError: "",
  },

  async onLoad() {
    const app = getApp<any>();
    await app.ready();
    const profile = app.globalData.profile;

    // 已经是管理端身份或已经绑过孩子，就不该再看到登录页
    if (profile && app.isManagement(profile)) {
      app.switchShell("admin");
      return;
    }
    if (profile && (profile.students ?? []).length > 0) {
      app.switchShell("guardian");
      return;
    }

    this.setData({
      booting: false,
      bootError: app.globalData.bootError || "",
      boundNames: "",
    });
  },

  /** 从家长端「退出登录」回来时会走 onShow，这里刷新一下"已绑定"提示 */
  onShow() {
    const app = getApp<any>();
    const students = app.globalData.profile?.students ?? [];
    this.setData({ boundNames: students.map((item: any) => item.name).join("、") });
  },

  /* ------------------------------- 顶部两个 Tab ------------------------------- */

  switchMode(event: any) {
    this.setData({ mode: event.currentTarget.dataset.mode });
  },

  /* -------------------------------- 绑定码输入 -------------------------------- */

  onCodeInput(event: any) {
    const raw = normalizeBindingCode(event.detail.value).slice(0, 8);
    // 第 5 位开始补短横，视觉上分成两组，和纸条上的印刷形式一致
    const display = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;

    this.setData({
      codeDisplay: display,
      codeNormalized: raw,
      preview: null,
      canBind: false,
      codeError: "",
    });
    if (previewTimer) clearTimeout(previewTimer);

    if (raw.length === 0) {
      this.setData({ codeClass: "code-input", codeHint: "" });
      return;
    }
    if (raw.length < 8) {
      this.setData({ codeClass: "code-input", codeHint: `还差 ${8 - raw.length} 位` });
      return;
    }

    // 第二层：本地校验位。错了当场说，不发请求
    const check = validateBindingCode(raw);
    if (!check.ok) {
      this.setData({
        codeClass: "code-input is-invalid",
        codeHint: "",
        codeError:
          check.reason === "charset"
            ? "绑定码里不会出现 I、L、O、U，请再核对一下"
            : "绑定码不正确，请检查是否输错",
      });
      return;
    }

    // 第三层：格式对了，去服务端要一次脱敏预览
    this.setData({ codeClass: "code-input is-valid", codeHint: "格式正确，正在核对…" });
    previewTimer = setTimeout(() => {
      void this.loadPreview(raw);
    }, 180);
  },

  async loadPreview(code: string) {
    try {
      const preview = await api.get<any>("/bindings/preview", { code });
      // 用户可能已经改了输入，过期的响应直接丢掉
      if (this.data.codeNormalized !== code) return;

      if (!preview.valid) {
        this.setData({
          codeClass: "code-input is-invalid",
          codeHint: "",
          codeError: "这个绑定码不存在，请向辅导班老师确认",
          canBind: false,
        });
        return;
      }
      this.setData({
        codeHint: "",
        codeError: "",
        preview: { studentHint: preview.studentHint ?? "", grade: preview.grade ?? "" },
        canBind: true,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
        // 微信身份还没建好，建完再试一次
        const ok = await this.ensureIdentity();
        if (ok) void this.loadPreview(code);
        return;
      }
      // 预览失败不阻断绑定：让用户直接提交，由服务端给准确结论
      this.setData({ codeHint: "", codeError: "", canBind: true });
    }
  },

  onRelationChange(event: any) {
    this.setData({ relation: RELATIONS[Number(event.detail.value)] });
  },

  onGuardianNameInput(event: any) {
    this.setData({ guardianName: event.detail.value });
  },

  /**
   * 保证当前有一个可用的微信身份 —— /bindings/preview 和 /bindings/by-code 都要登录态。
   * 返回 false 表示连身份都建不起来（一般是后端没起或没配合法域名）。
   */
  async ensureIdentity(): Promise<boolean> {
    const app = getApp<any>();
    if (app.globalData.profile) return true;
    try {
      const result = await api.post<any>("/auth/login", await wechatLoginPayload());
      setToken(result.token);
      // 显式停在登录页：此时用户还没绑孩子，不该被弹进家长端
      app.applyProfile(result.profile, "login");
      return true;
    } catch (error) {
      toastError(error);
      return false;
    }
  },

  async onBind() {
    if (!this.data.canBind || this.data.binding) return;
    const app = getApp<any>();
    this.setData({ binding: true });
    try {
      if (!(await this.ensureIdentity())) {
        this.setData({ binding: false });
        return;
      }
      const result = await api.post<any>("/bindings/by-code", {
        bindingCode: this.data.codeNormalized,
        relation: this.data.relation,
        guardianName: this.data.guardianName.trim() || undefined,
      });
      app.applyProfile(result.profile, "guardian");
      if (result.status === "待审核") {
        toast("绑定申请已提交，等负责人通过后就能看到孩子的数据");
      } else {
        toast(`已绑定 ${result.student.name}`, "success");
      }
      // 等 toast 露个脸再跳，否则用户看不到反馈
      setTimeout(() => app.enterShell(), 900);
    } catch (error) {
      this.setData({ binding: false });
      if (error instanceof ApiError && error.code === "BINDING_ALREADY_EXISTS") {
        // 已经绑过了，直接进去就好，不必让用户再想办法
        try {
          const profile = await api.get<any>("/auth/profile");
          app.applyProfile(profile, "guardian");
          toast("你已经绑定过这个孩子了");
          setTimeout(() => app.enterShell(), 700);
          return;
        } catch (retryError) {
          /* 落到下面的统一提示 */
        }
      }
      toastError(error);
    }
  },

  /** 已绑定过的用户回到登录页时的快捷入口 */
  enterGuardian() {
    const app = getApp<any>();
    app.switchShell("guardian");
  },

  /* -------------------------------- 管理端账密 -------------------------------- */

  onUsernameInput(event: any) {
    this.setData({ username: event.detail.value });
  },

  onPasswordInput(event: any) {
    this.setData({ password: event.detail.value });
  },

  async onStaffLogin() {
    if (this.data.staffLogging) return;
    const username = this.data.username.trim();
    const password = this.data.password;
    if (!username || !password) {
      toast("请填写登录名和密码");
      return;
    }
    const app = getApp<any>();
    this.setData({ staffLogging: true });
    try {
      const result = await api.post<any>("/auth/staff-login", { username, password });
      setToken(result.token);
      app.applyProfile(result.profile, "admin");
      toast(`欢迎回来，${result.profile.displayName}`, "success");
      setTimeout(() => app.enterShell(), 700);
    } catch (error) {
      this.setData({ staffLogging: false });
      toastError(error);
    }
  },

  /** 演示环境的快捷登录，方便验收时不用手输 */
  quickOwnerLogin() {
    this.setData({ username: "owner", password: "warm2026" }, () => {
      void this.onStaffLogin();
    });
  },

  /** 启动失败后的重试 */
  async retryBoot() {
    const app = getApp<any>();
    this.setData({ booting: true });
    app.readyPromise = null;
    await app.ready();
    this.setData({ booting: false, bootError: app.globalData.bootError || "" });
  },
});
