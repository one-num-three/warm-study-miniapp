/**
 * 兑换记录 —— 对应 h5/src/pages/admin.ts 的 definePage("admin.redemptions")。
 *
 * 撤销是这一页存在的理由：柜台前点错商品、孩子换完又反悔，都得有条退路。
 * 撤销不删记录，只把它划掉（is-reversed）并生成冲正流水 —— 账目必须留痕，
 * 家长回头查"我娃的分去哪了"时要能看到完整过程。
 */

import { api, toast, toastError } from "../../../utils/api";
import { compactStamp } from "../../../utils/format";
import { newRequestId } from "../../../shared/id.js";
import { PERMISSIONS } from "../../../shared/permissions.js";

Page({
  data: {
    loading: true,
    error: "",

    items: [] as any[],

    /** 没有 redemption.reverse 的人只能看，撤销按钮换成一枚「已完成」标签 */
    canReverse: false,

    /* -------------------------------- 表单弹层 -------------------------------- */
    formShow: false,
    formTitle: "",
    formHint: "",
    formFields: [] as any[],
    formSubmitText: "保存",
    formAction: "",
    /** 提交时才用得上的上下文：要撤销的是哪一笔兑换 */
    formPayload: null as any,
  },

  async onLoad() {
    const app = getApp<any>();
    await app.ready();
    this.setData({ canReverse: app.can(PERMISSIONS.REDEMPTION_REVERSE) });
    await this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    const app = getApp<any>();
    try {
      const list = await api.get<any[]>("/redemptions");
      // 权限直接问 app，不依赖 data 里那份副本什么时候写进去
      const canReverse = app.can(PERMISSIONS.REDEMPTION_REVERSE);
      this.setData({
        items: (list ?? []).map((item) => decorate(item, canReverse)),
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

  /* --------------------------------- 撤销动作 --------------------------------- */

  onReverse(event: any) {
    this.setData({
      formShow: true,
      formTitle: "撤销兑换",
      formHint: "积分和库存都会退回，并留下冲正流水。",
      formSubmitText: "确认撤销",
      formAction: "reverseRedemption",
      formPayload: { id: event.currentTarget.dataset.id },
      formFields: [{ name: "reason", label: "撤销原因", required: true, type: "textarea" }],
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
    if (action !== "reverseRedemption" || !payload) return;

    try {
      // requestId 是接口契约要求的幂等键：网络重试时不会退两次分
      await api.post(`/redemptions/${payload.id}/reverse`, {
        reason: values.reason,
        requestId: newRequestId(),
      });
      toast("已撤销", "success");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },
});

/**
 * 把兑换记录加工成 WXML 能直接渲染的形状。
 * 右侧到底显示"撤销按钮 / 已撤销 / 已完成"三选一，判断放在这里做完，
 * WXML 只按布尔值决定渲染哪一支。
 */
function decorate(item: any, canReverse: boolean): any {
  const reversed = item.status === "已撤销";
  return {
    ...item,
    // 已撤销的记录保留但划掉，绝不从列表里消失
    titleClass: reversed ? "row__title is-reversed" : "row__title",
    titleText: `${item.studentName} · ${item.productSnapshot.name}`,
    subText: `${item.pointsCost} 分 · ${compactStamp(item.createdAt)}`,
    reversed,
    showReverse: !reversed && canReverse,
    showDone: !reversed && !canReverse,
  };
}
