/**
 * 家长端「成长」—— 积分余额 + 本周排行榜 + 最近变动，对应 h5 的 definePage("guardian.growth")。
 *
 * 排行榜按周结算，用的是"这一周挣了多少分"而不是余额，
 * 所以孩子去商城换东西不会掉名次 —— 这句话直接写在横幅上，
 * 否则每学期都会有家长来问"我家孩子分怎么变少了"。
 *
 * 排行榜接口不带 studentId（榜是全班的），是否高亮自己由服务端的 isSelf 决定。
 */

import { api, toastError } from "../../../utils/api";
import { compactStamp, decorateLedger } from "../../../utils/format";

Page({
  /** 首屏由 onLoad 负责，onShow 只在此之后才重新拉数据，避免刚进页面就发两遍请求 */
  booted: false,

  data: {
    loading: true,
    error: "",

    /** 一个孩子都没绑：整页换成绑定引导 */
    noStudent: false,
    /** 绑了多个孩子才显示切换条 */
    showPicker: false,
    pickerItems: [] as any[],
    /** 待审核的绑定申请 */
    pendings: [] as any[],

    /* -------- 顶部积分横幅 -------- */
    balance: 0,
    rankText: "",

    /* -------- 本周排行榜 -------- */
    /** 榜单周期，形如「2026-07-20 起」；接口没给区间时为空 */
    rangeText: "",
    rows: [] as any[],

    /** 最近 8 条积分流水 */
    entries: [] as any[],
  },

  async onLoad() {
    await getApp<any>().ready();
    this.booted = true;
    await this.load();
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ active: 2, role: "guardian" });
    }
    // 从商城 / 错题本返回时积分可能已经变了
    if (this.booted) void this.load();
  },

  async load() {
    const app = getApp<any>();
    const profile = app.globalData.profile;
    const students = (profile && profile.students) || [];

    if (students.length === 0) {
      this.setData({
        loading: false,
        error: "",
        noStudent: true,
        showPicker: false,
        pendings: buildPendings(profile),
      });
      return;
    }

    const student = app.activeStudent();
    this.setData({ loading: true, error: "", noStudent: false });
    try {
      const [board, ledger] = await Promise.all([
        api.get<any>("/leaderboard", { period: "week", limit: 10 }),
        api.get<any>("/points/ledger", { studentId: student.id, limit: 8 }),
      ]);

      const rows = (board && board.rows) || [];
      const self = rows.filter((row: any) => row.isSelf)[0];

      this.setData({
        loading: false,
        showPicker: students.length > 1,
        pickerItems: buildPicker(students, student.id),
        pendings: buildPendings(profile),

        balance: ledger.balance,
        rankText: `本周排名 ${self ? self.rank : "—"}`,

        rangeText: board && board.range ? `${board.range.start} 起` : "",
        rows: rows.map((row: any) => ({
          studentId: row.studentId,
          rank: row.rank,
          displayName: row.displayName,
          score: row.score,
          // 前三名换金 / 银配色，自己那行加浅绿底，两者可以叠加
          cls: `rank${row.rank <= 3 ? ` rank--top${row.rank}` : ""}${row.isSelf ? " is-self" : ""}`,
        })),

        entries: decorateLedger(ledger.entries || []).map(withLedgerSub),
      });
    } catch (error: any) {
      this.setData({
        loading: false,
        error: error && error.message ? error.message : "加载失败，请稍后重试",
      });
      toastError(error);
    }
  },

  /** 切孩子后整页重拉：流水按 studentId 查，榜单的 isSelf 也会跟着变 */
  onPickStudent(event: any) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    getApp<any>().selectStudent(id);
    void this.load();
  },

  goBind() {
    wx.navigateTo({ url: "/pages/guardian/bind/bind" });
  },

  goLedger() {
    wx.navigateTo({ url: "/pages/guardian/ledger/ledger" });
  },

  goStore() {
    wx.navigateTo({ url: "/pages/guardian/store/store" });
  },

  goMistakes() {
    wx.navigateTo({ url: "/pages/guardian/mistakes/mistakes" });
  },
});

/* --------------------------------- 数据加工 --------------------------------- */

/** 孩子切换条：选中项的高亮 class 在这里算好，WXML 只负责贴上去。 */
function buildPicker(students: any[], activeId: string): any[] {
  return students.map((student: any) => ({
    id: student.id,
    label: student.nickname || student.name,
    cls: student.id === activeId ? "picker__item is-active" : "picker__item",
  }));
}

/** 待审核的绑定申请。服务端没给 id，用姓名 + 提交时间拼一个稳定的列表 key。 */
function buildPendings(profile: any): any[] {
  return ((profile && profile.pendingBindings) || []).map((item: any) => ({
    key: `${item.studentName}-${item.createdAt}`,
    studentName: item.studentName,
    sub: `关系：${item.relation} · 提交于 ${compactStamp(item.createdAt)}`,
  }));
}

/** 流水副标题：类型 + 紧凑时间戳。 */
function withLedgerSub(entry: any): any {
  return { ...entry, sub: `${entry.type} · ${entry.stamp}` };
}
