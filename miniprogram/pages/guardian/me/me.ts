/**
 * 家长端「我的」—— 对应 h5 的 definePage("guardian.me")。
 *
 * 这一页每次显示都重新拉 /auth/profile：绑定审核通过、老师改了昵称、
 * 积分刚被发放，家长第一时间会来这里核对，用缓存里的旧档案会让人以为系统没反应。
 *
 * 双身份用户（既是家长又是老师）在这里显式切到管理工作台。
 * 不做自动切换 —— 两边数据不混在一起是产品的硬要求。
 */

import { toastError } from "../../../utils/api";
import { compactStamp, initial } from "../../../utils/format";
import { confirmDialog } from "../../../utils/ui";

Page({
  /** 首屏由 onLoad 负责，onShow 只在此之后才重新拉档案，避免刚进页面就请求两遍 */
  booted: false,

  data: {
    loading: true,
    error: "",

    displayName: "",
    /** 头像色块里的姓名首字 */
    avatarText: "",
    boundText: "",

    /** 已绑定的孩子，展示文案在 load 里拼好 */
    students: [] as any[],
    /** 待审核的绑定申请 */
    pendings: [] as any[],

    /** 有老师 / 负责人身份时才显示「切换到管理工作台」 */
    isManagement: false,
  },

  async onLoad() {
    await getApp<any>().ready();
    this.booted = true;
    await this.load();
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ active: 3, role: "guardian" });
    }
    if (this.booted) void this.load();
  },

  async load() {
    const app = getApp<any>();
    this.setData({ loading: true, error: "" });
    try {
      const profile = await app.refreshProfile();
      const students = (profile && profile.students) || [];
      this.setData({
        loading: false,
        displayName: profile.displayName,
        avatarText: initial(profile.displayName),
        boundText: `已绑定 ${students.length} 个孩子`,
        students: students.map((student: any) => ({
          id: student.id,
          avatarText: initial(student.name),
          title: `${student.name}（${student.nickname || "无昵称"}）`,
          sub: `${student.grade} · 我是${student.relation}`,
          value: `${student.pointBalance} 分`,
        })),
        pendings: buildPendings(profile),
        isManagement: app.isManagement(profile),
      });
    } catch (error: any) {
      this.setData({
        loading: false,
        error: error && error.message ? error.message : "加载失败，请稍后重试",
      });
      toastError(error);
    }
  },

  goBind() {
    wx.navigateTo({ url: "/pages/guardian/bind/bind" });
  },

  goAdmin() {
    getApp<any>().switchShell("admin");
  },

  async onLogout() {
    const yes = await confirmDialog({
      title: "退出登录？",
      body: "退出后需要重新输入绑定码。",
      danger: true,
    });
    if (!yes) return;
    await getApp<any>().logout();
  },
});

/* --------------------------------- 数据加工 --------------------------------- */

/** 待审核的绑定申请。服务端没给 id，用姓名 + 提交时间拼一个稳定的列表 key。 */
function buildPendings(profile: any): any[] {
  return ((profile && profile.pendingBindings) || []).map((item: any) => ({
    key: `${item.studentName}-${item.createdAt}`,
    studentName: item.studentName,
    sub: `关系：${item.relation} · 提交于 ${compactStamp(item.createdAt)}`,
  }));
}
