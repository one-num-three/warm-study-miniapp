/**
 * 家长端「作业」—— 按天倒序列出这个孩子的所有作业单，对应 h5 的 definePage("guardian.homework")。
 *
 * 这里只做"看"：每张单子给一句各科摘要 + 一个状态标签，
 * 真正的逐项进度在详情页。列表页塞满细节只会让家长找不到今天那一张。
 */

import { api, toastError } from "../../../utils/api";
import { compactStamp, decorateSheet } from "../../../utils/format";

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

    /** 作业单列表，已经过 decorateSheet 加工（tone / summary） */
    sheets: [] as any[],
  },

  async onLoad() {
    await getApp<any>().ready();
    this.booted = true;
    await this.load();
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ active: 1, role: "guardian" });
    }
    // 刚提交完作业返回这一页时，列表必须已经带上新的那一张
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
      const sheets = await api.get<any>("/homework/sheets", { studentId: student.id });
      this.setData({
        loading: false,
        showPicker: students.length > 1,
        pickerItems: buildPicker(students, student.id),
        pendings: buildPendings(profile),
        sheets: (sheets || []).map((sheet: any) => {
          const decorated = decorateSheet(sheet);
          return {
            id: decorated.id,
            dateKey: decorated.dateKey,
            status: decorated.status,
            tone: decorated.tone,
            summary: decorated.summary,
            feedback: decorated.feedback || "",
            feedbackText: decorated.feedback ? `老师反馈：${decorated.feedback}` : "",
          };
        }),
      });
    } catch (error: any) {
      this.setData({
        loading: false,
        error: error && error.message ? error.message : "加载失败，请稍后重试",
      });
      toastError(error);
    }
  },

  /** 切孩子后整页重拉：作业单是按 studentId 查的 */
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

  openSheet(event: any) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/guardian/sheet/sheet?id=${id}` });
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
