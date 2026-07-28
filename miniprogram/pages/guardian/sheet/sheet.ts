/**
 * 作业详情 —— 家长点开某一天的作业单，看老师逐项标了什么，必要时撤回重交。
 *
 * 「撤回」只在作业还没进入辅导流程时给：老师已经开始批改再撤，
 * 班上的进度和积分就对不上了，所以能不能撤由状态说了算，而不是由按钮说了算。
 */

import { api, toast, toastError } from "../../../utils/api";
import { confirmDialog } from "../../../utils/ui";
import { decorateSheet } from "../../../utils/format";

Page({
  data: {
    loading: true,
    error: "",
    /** 从上一页带过来的作业单 id */
    sheetId: "",
    /** decorateSheet 加工过的作业单：items 补了「（没有补充说明）」，tone 是状态配色 */
    sheet: null as any,
    /** 卡片标题：日期 · 孩子姓名 */
    titleText: "",
    canWithdraw: false,
    withdrawing: false,
    withdrawText: "撤回作业",
  },

  async onLoad(query: any) {
    await getApp<any>().ready();
    this.setData({ sheetId: (query && query.id) || "" });
    await this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    if (!this.data.sheetId) {
      this.setData({ loading: false, error: "没有找到这份作业，请从作业列表重新进入" });
      return;
    }
    try {
      const sheet = decorateSheet(await api.get<any>(`/homework/sheets/${this.data.sheetId}`));
      this.setData({
        sheet,
        titleText: `${sheet.dateKey} · ${sheet.studentName}`,
        // 只有还没开始辅导的作业能撤：已完成 / 辅导中撤回会把老师的进度打乱
        canWithdraw: sheet.status === "待确认" || sheet.status === "需要补充",
        loading: false,
      });
    } catch (error: any) {
      this.setData({
        loading: false,
        error: error && error.message ? error.message : "加载失败，请稍后重试",
      });
      toastError(error);
    }
  },

  async onWithdraw() {
    if (this.data.withdrawing) return;
    const yes = await confirmDialog({
      title: "撤回这份作业？",
      body: "撤回后可以重新提交今天的作业。",
    });
    if (!yes) return;

    this.setData({ withdrawing: true, withdrawText: "撤回中…" });
    try {
      await api.post(`/homework/sheets/${this.data.sheetId}/transition`, { to: "已撤回" });
      toast("已撤回");
      // 等 toast 露个脸再退回作业列表，列表页会自己重新拉一次
      setTimeout(() => {
        if (getCurrentPages().length > 1) wx.navigateBack();
        else getApp<any>().enterShell();
      }, 700);
    } catch (error) {
      this.setData({ withdrawing: false, withdrawText: "撤回作业" });
      toastError(error);
    }
  },
});
