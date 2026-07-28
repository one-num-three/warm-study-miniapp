/**
 * 家长端「今日」—— 打开小程序第一眼看到的页面，对应 h5 的 definePage("guardian.today")。
 *
 * 这一页只回答三个问题：今天的作业交了没、几点能去接、积分涨了多少。
 * 三个接口并行拉，因为它们互不依赖，串行只会让家长多等两个来回。
 *
 * 页面里所有拼接文案和状态配色都在 load() 里算完再 setData ——
 * WXML 不能调用函数，把逻辑留在模板里迟早会变成没人敢改的表达式。
 */

import { api, toastError } from "../../../utils/api";
import { compactStamp, decorateLedger, sessionTone, todayKey } from "../../../utils/format";

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
    /** 待审核的绑定申请，绑定引导下面跟着显示 */
    pendings: [] as any[],

    /* -------- 顶部积分横幅 -------- */
    heroLabel: "",
    balance: 0,
    gradeText: "",
    relationText: "",

    /* -------- 今日作业 -------- */
    /** 为空表示今天还没交作业，右侧按钮从「查看」换成「去提交」 */
    todaySheetId: "",
    sheetTitle: "",
    sheetSub: "",

    /* -------- 接娃提醒 -------- */
    reminderTitle: "",
    reminderSub: "",
    /** 为空表示还没有提醒，右侧不出标签 */
    reminderStatus: "",
    reminderTone: "tag",

    /** 最近 5 条积分流水，已经过 decorateLedger 加工 */
    entries: [] as any[],
  },

  async onLoad() {
    await getApp<any>().ready();
    this.booted = true;
    await this.load();
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ active: 0, role: "guardian" });
    }
    // 从「提交作业」返回、或从别的 Tab 切回来时数据可能已经变了，重新拉一次
    if (this.booted) void this.load();
  },

  async load() {
    const app = getApp<any>();
    const profile = app.globalData.profile;
    const students = (profile && profile.students) || [];

    // 没绑孩子时三个接口都拿不到东西，直接画引导，不浪费请求
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
      const [sheets, reminders, ledger] = await Promise.all([
        api.get<any>("/homework/sheets", { studentId: student.id }),
        api.get<any>("/reminders", { studentId: student.id }),
        api.get<any>("/points/ledger", { studentId: student.id, limit: 5 }),
      ]);

      const today = todayKey();
      const todaySheet = (sheets || []).filter((sheet: any) => sheet.dateKey === today)[0];
      // /reminders 按创建时间倒序返回，第 0 条就是最新的那条
      const latest = (reminders || [])[0];

      this.setData({
        loading: false,
        showPicker: students.length > 1,
        pickerItems: buildPicker(students, student.id),
        pendings: buildPendings(profile),

        heroLabel: `${student.name}的积分余额`,
        balance: ledger.balance,
        gradeText: `年级 ${student.grade}`,
        relationText: `我是${student.relation}`,

        todaySheetId: todaySheet ? todaySheet.id : "",
        sheetTitle: todaySheet ? "今日作业" : "今天还没交作业",
        sheetSub: todaySheet
          ? `${(todaySheet.items || []).length} 项 · ${todaySheet.status}`
          : "把今天要写的作业拍照或打字告诉老师",

        reminderTitle: latest ? `预计 ${latest.etaAt} 可以接走` : "还没有接娃提醒",
        reminderSub: latest
          ? `老师发送于 ${compactStamp(latest.createdAt)}`
          : "老师安排好时间会主动通知你，不用反复问",
        reminderStatus: latest ? latest.status : "",
        reminderTone: latest ? sessionTone(latest.status) : "tag",

        entries: decorateLedger((ledger.entries || []).slice(0, 5)).map(withLedgerSub),
      });
    } catch (error: any) {
      this.setData({
        loading: false,
        error: error && error.message ? error.message : "加载失败，请稍后重试",
      });
      toastError(error);
    }
  },

  /** 切孩子。三个接口都带 studentId，所以换完必须整页重拉 */
  onPickStudent(event: any) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    getApp<any>().selectStudent(id);
    void this.load();
  },

  goBind() {
    wx.navigateTo({ url: "/pages/guardian/bind/bind" });
  },

  goSubmit() {
    wx.navigateTo({ url: "/pages/guardian/submit/submit" });
  },

  goLedger() {
    wx.navigateTo({ url: "/pages/guardian/ledger/ledger" });
  },

  openTodaySheet() {
    wx.navigateTo({ url: `/pages/guardian/sheet/sheet?id=${this.data.todaySheetId}` });
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
