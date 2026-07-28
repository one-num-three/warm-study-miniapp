/**
 * 管理端「今日作业池」—— 对应 h5/src/pages/admin.ts 的 admin.homework。
 *
 * 一张作业单从家长提交（待确认）走到结束（已完成 / 未完成），中间靠逐项推进：
 * 任意一项标成「开始」，整张单会被服务端自动带进辅导中，所有项都终结后才允许结束。
 *
 * 这页最要紧的一条：结束作业时的积分发放结果必须如实转述。
 * 老师没有发分权限时，单子照结但分是挂起的 —— 界面上绝不能说成"已发放"。
 */

import { api, toast, toastError } from "../../../utils/api";
import { todayKey, decorateSheet } from "../../../utils/format";
import { newRequestId } from "../../../shared/id.js";
import { PERMISSIONS } from "../../../shared/permissions.js";

/** 作业项当前状态 → 界面上该给哪几个推进按钮。终结状态没有按钮，改成只读标签。 */
const ITEM_ACTIONS: Record<string, Array<{ to: string; label: string }>> = {
  待开始: [
    { to: "进行中", label: "开始" },
    { to: "未完成", label: "未完成" },
  ],
  进行中: [
    { to: "已完成", label: "完成" },
    { to: "未完成", label: "未完成" },
  ],
  已完成: [],
  未完成: [],
};

Page({
  data: {
    loading: true,
    error: "",

    /** 今天的全部作业单，配色 / 按钮 / 能不能结束都已经算好 */
    sheets: [] as any[],

    /* -------- 通用表单弹层：结束作业的反馈与奖励 -------- */
    formShow: false,
    formTitle: "",
    formHint: "",
    formFields: [] as any[],
    formSubmitText: "保存",
    formAction: "",
    formPayload: null as any,
  },

  async onLoad() {
    await getApp<any>().ready();
    await this.load();
  },

  /** 从看板或其他页跳回来时重新拉，避免看到已经处理过的旧状态 */
  onShow() {
    if (!this.data.loading) void this.load();
  },

  async load() {
    const app = getApp<any>();
    this.setData({ loading: true, error: "" });
    try {
      const list = await api.get<any[]>("/homework/sheets", { dateKey: todayKey() });

      // 没有处理作业的权限时，界面退化成只读：状态看得到，但一个按钮都不给
      const canManage = app.can(PERMISSIONS.HOMEWORK_MANAGE);

      const sheets = (list ?? []).map((raw: any) => {
        const sheet = decorateSheet(raw);
        const items = sheet.items.map((item: any) => {
          const actions = ITEM_ACTIONS[item.status] ?? [];
          return {
            ...item,
            actions: canManage ? actions : [],
            // 已完成用主色，未完成用灰色 —— 未完成不是错误，只是"今天没做完"
            tagClass: item.status === "已完成" ? "tag" : "tag tag--muted",
          };
        });
        return {
          ...sheet,
          items,
          canFinish: canManage && sheet.status === "辅导中",
          // 所有项都终结了才用主色按钮，否则只是一个普通按钮，点了会被拦下来
          finishClass: sheet.settled ? "btn btn--sm btn--primary" : "btn btn--sm",
          canAskMore: canManage && (sheet.status === "待确认" || sheet.status === "需要补充"),
        };
      });

      this.setData({ sheets, loading: false });
    } catch (error: any) {
      this.setData({
        loading: false,
        error: error && error.message ? error.message : "加载失败，请稍后重试",
      });
      toastError(error);
    }
  },

  /* ------------------------------ 逐项推进 ------------------------------ */

  /** 不弹提示：列表刷新后状态标签自己会变，这就是最直接的反馈 */
  async onItemStatus(event: any) {
    const itemId = event.currentTarget.dataset.item;
    const to = event.currentTarget.dataset.to;
    try {
      await api.post(`/homework/items/${itemId}/status`, { status: to });
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  /* ------------------------------ 要求补充 ------------------------------ */

  async onAskMore(event: any) {
    const sheetId = event.currentTarget.dataset.sheet;
    try {
      await api.post(`/homework/sheets/${sheetId}/transition`, { to: "需要补充" });
      toast("已要求家长补充");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  /* ------------------------------ 结束作业 ------------------------------ */

  onFinish(event: any) {
    const sheet = this.data.sheets[Number(event.currentTarget.dataset.index)];
    if (!sheet) return;
    if (!sheet.settled) {
      // 还有项悬着就结束，反馈和奖励会落在一张没算完的单上，家长看到的结论也不对
      toast("还有作业项没有标记完成或未完成");
      return;
    }

    this.setData({
      formShow: true,
      formTitle: "结束今天的作业",
      formHint: "反馈会直接展示给家长。",
      formFields: [
        { name: "status", label: "结果", type: "select", value: "已完成", options: ["已完成", "未完成"] },
        { name: "feedback", label: "辅导反馈", required: true, type: "textarea", maxlength: 300 },
        { name: "unfinishedReason", label: "未完成原因（选未完成时必填）", type: "textarea" },
        { name: "rewardPoints", label: "奖励积分", type: "number", value: "10" },
      ],
      formSubmitText: "确认结束",
      formAction: "finishSheet",
      formPayload: { sheetId: sheet.id },
    });
  },

  /* ------------------------------ 表单弹层 ------------------------------ */

  onFormCancel() {
    this.setData({ formShow: false });
  },

  async onFormSubmit(event: any) {
    const values = event.detail || {};
    const action = this.data.formAction;
    const payload = this.data.formPayload || {};
    this.setData({ formShow: false });

    if (action !== "finishSheet") return;

    try {
      const result = await api.post<any>(`/homework/sheets/${payload.sheetId}/finish`, {
        status: values.status,
        feedback: values.feedback,
        unfinishedReason: values.unfinishedReason || undefined,
        rewardPoints: values.rewardPoints ? Number(values.rewardPoints) : undefined,
        requestId: newRequestId(),
      });

      // 如实转述服务端的发放结果，绝不把"没发成"说成"成功"
      const reward = result.reward || {};
      if (reward.applied > 0) {
        toast(`已结束，发放 ${reward.applied} 分`);
      } else if (reward.skipped === "no_permission") {
        toast("作业已结束，但你没有发放积分的权限，分已挂起等负责人补发");
      } else if (reward.skipped === "already_rewarded") {
        toast("作业已结束。这张单之前发过分了，没有重复发放");
      } else {
        toast("作业已结束");
      }
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },
});
