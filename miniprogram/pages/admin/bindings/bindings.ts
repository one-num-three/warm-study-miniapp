/**
 * 家长绑定审核 —— 对应 h5/src/pages/admin.ts 的 definePage("admin.bindings")。
 *
 * 这一页把"待办"和"档案"分成两张卡，是刻意的：
 * 负责人打开它通常只为清掉待审核那几条，全部绑定关系只是事后翻查用的底账，
 * 混在一起会让待办被历史记录淹没。
 *
 * 拒绝必须填原因并记进审计日志 —— 家长事后来问"为什么没通过"时，得有人答得上来。
 */

import { api, toast, toastError } from "../../../utils/api";
import { bindingTone, compactStamp } from "../../../utils/format";
import { PERMISSIONS } from "../../../shared/permissions.js";

Page({
  data: {
    loading: true,
    error: "",

    /** 待审核的申请，页面的主角 */
    pending: [] as any[],
    /** 其余（已通过 / 已拒绝 / 已解除）的底账 */
    others: [] as any[],

    /** 没有 binding.review 的人只能看，通过 / 拒绝按钮不渲染 */
    canReview: false,

    /* -------------------------------- 表单弹层 -------------------------------- */
    formShow: false,
    formTitle: "",
    formHint: "",
    formFields: [] as any[],
    formSubmitText: "保存",
    formAction: "",
    /** 提交时才用得上的上下文：要拒绝的是哪一条申请 */
    formPayload: null as any,
  },

  async onLoad() {
    const app = getApp<any>();
    await app.ready();
    this.setData({ canReview: app.can(PERMISSIONS.BINDING_REVIEW) });
    await this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const list = await api.get<any[]>("/bindings");
      const all = list ?? [];
      this.setData({
        pending: all.filter((item) => item.status === "待审核").map(decoratePending),
        others: all.filter((item) => item.status !== "待审核").map(decorateOther),
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

  /* --------------------------------- 审核动作 --------------------------------- */

  async onApprove(event: any) {
    try {
      await api.post(`/bindings/${event.currentTarget.dataset.id}/review`, { decision: "approve" });
      toast("已通过", "success");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  /** 拒绝要先问原因，所以走弹层而不是直接发请求 */
  onReject(event: any) {
    this.setData({
      formShow: true,
      formTitle: "拒绝绑定申请",
      formHint: "",
      formSubmitText: "确认拒绝",
      formAction: "rejectBinding",
      formPayload: { id: event.currentTarget.dataset.id },
      formFields: [
        { name: "reason", label: "拒绝原因", type: "textarea", placeholder: "会记入审计日志" },
      ],
    });
  },

  /* --------------------------------- 弹层回调 --------------------------------- */

  onFormCancel() {
    this.setData({ formShow: false });
  },

  async onFormSubmit(event: any) {
    const values = event.detail;
    const action = this.data.formAction;
    const payload = this.data.formPayload;
    this.setData({ formShow: false });
    if (action !== "rejectBinding" || !payload) return;

    try {
      await api.post(`/bindings/${payload.id}/review`, {
        decision: "reject",
        reason: values.reason,
      });
      toast("已拒绝");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },
});

/** 待审核行：关系写全（"关系：妈妈"），因为这正是负责人要核对的那一项。 */
function decoratePending(item: any): any {
  return {
    ...item,
    titleText: `${item.guardianName} → ${item.studentName}`,
    subText: `关系：${item.relation} · ${compactStamp(item.createdAt)}`,
  };
}

/** 底账行：只需要关系和时间，状态用统一的配色标签，和家长端保持同一种颜色语言。 */
function decorateOther(item: any): any {
  return {
    ...item,
    titleText: `${item.guardianName} → ${item.studentName}`,
    subText: `${item.relation} · ${compactStamp(item.createdAt)}`,
    toneClass: bindingTone(item.status),
  };
}
