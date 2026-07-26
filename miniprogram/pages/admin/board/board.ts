/**
 * 管理端「今日看板」—— 老师上班后第一眼看的页面，对应 h5/src/pages/admin.ts 的 admin.board。
 *
 * 这页只回答三个问题：班上现在什么情况（六个指标）、有什么事等着我处理（告警卡）、
 * 每个孩子该推到下一步了吗（学员卡上的流转按钮）。
 *
 * WXML 里不能调函数，所以状态配色、副标题拼接、当前可用的流转按钮，
 * 全部在 load() 里算好再 setData —— 页面模板只负责摆位置。
 */

import { api, toast, toastError, ApiError } from "../../../utils/api";
import { confirmDialog, actionSheet } from "../../../utils/ui";
import { compactStamp, sessionTone } from "../../../utils/format";
import { newRequestId } from "../../../shared/id.js";
import { PERMISSIONS } from "../../../shared/permissions.js";
import { SESSION_TRANSITIONS, nextTransitions } from "../../../shared/state-machines.js";
import { SESSION_STATUSES } from "../../../shared/types.js";

Page({
  data: {
    loading: true,
    error: "",

    /** 服务端算好的今天，展示在「今日学员」小标题上 */
    dateKey: "",
    /** 六个指标：五个到班状态 + 今日未交作业 */
    metrics: [] as any[],
    /** 要处理的事；为空时整张卡不渲染，看板保持干净 */
    alerts: [] as any[],
    /** 今日学员，每行都预先算好了配色、副标题和按钮 */
    rows: [] as any[],

    /** 权限边界：没有发提醒权限的老师根本看不到那个按钮（服务端还会再校验一次） */
    canNotify: false,

    /* -------- 通用表单弹层：撤回接走的原因、自定义可接时间都走它 -------- */
    formShow: false,
    formTitle: "",
    formHint: "",
    formFields: [] as any[],
    formSubmitText: "保存",
    /** 弹层是事件回调式的，用它在 onFormSubmit 里分辨这次填的是哪张表 */
    formAction: "",
    /** 这张表关联的上下文（学员 id 等），弹层本身不认识业务 */
    formPayload: null as any,
  },

  async onLoad() {
    await getApp<any>().ready();
    await this.load();
  },

  /** 从绑定审核、商品这些子页返回时重新拉一次，否则告警数字会停在旧值 */
  onShow() {
    if (!this.data.loading) void this.load();
  },

  async load() {
    const app = getApp<any>();
    this.setData({ loading: true, error: "" });
    try {
      const [summary, list] = await Promise.all([
        api.get<any>("/dashboard"),
        api.get<any[]>("/sessions/today"),
      ]);

      const metrics = (SESSION_STATUSES as string[]).map((status) => ({
        label: status,
        value: summary.sessionCounts[status] ?? 0,
        // 「待接」是唯一"孩子已经在等家长"的状态，用强调色从一排数字里挑出来
        cls: status === "待接" ? "metric is-alert" : "metric",
      }));
      metrics.push({
        label: "今日未交作业",
        value: summary.homework.notSubmitted,
        cls: "metric",
      });

      const alerts: any[] = [];
      if (summary.pendingBindings > 0 && app.can(PERMISSIONS.BINDING_REVIEW)) {
        alerts.push({
          text: `${summary.pendingBindings} 条家长绑定申请待审核`,
          url: "/pages/admin/bindings/bindings",
          replace: false,
        });
      }
      if (summary.homework.finishedButUnrewarded > 0) {
        // 作业池是管理端 TabBar 的同级页，用 redirectTo 平移过去，页面栈不越点越深
        alerts.push({
          text: `${summary.homework.finishedButUnrewarded} 份作业已完成但还没发积分`,
          url: "/pages/admin/homework/homework",
          replace: true,
        });
      }
      if (summary.lowStockProducts > 0 && app.can(PERMISSIONS.PRODUCT_MANAGE)) {
        alerts.push({
          text: `${summary.lowStockProducts} 个商品库存不足`,
          url: "/pages/admin/products/products",
          replace: false,
        });
      }
      if (summary.remindedNotPickedUp > 0) {
        // 提醒已经发出去了，接下来只能等家长来，所以这条没有"去处理"的落点
        alerts.push({ text: `${summary.remindedNotPickedUp} 个孩子已提醒但还没接走`, url: "" });
      }

      const canSession = app.can(PERMISSIONS.SESSION_MANAGE);
      const owner = app.isOwner();
      const rows = (list ?? []).map((row: any) => ({
        ...row,
        title: `${row.name}（${row.nickname || row.grade}）`,
        tone: sessionTone(row.session.status),
        subText:
          `${row.grade} · ${row.pointBalance} 分 · 作业${row.sheet ? row.sheet.status : "未提交"}` +
          (row.lastReminderAt ? ` · 已提醒 ${compactStamp(row.lastReminderAt)}` : ""),
        // nextTransitions 默认滤掉纠错流转，所以「已接走 → 待接」不会混进正常按钮里，
        // 它单独做成下面那个仅负责人可见的「撤回接走」
        transitions: canSession ? nextTransitions(SESSION_TRANSITIONS, row.session.status) : [],
        canRevert: owner && row.session.status === "已接走",
      }));

      this.setData({
        dateKey: summary.dateKey,
        metrics,
        alerts,
        rows,
        canNotify: app.can(PERMISSIONS.NOTIFICATION_SEND),
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

  /* -------------------------------- 要处理的事 -------------------------------- */

  onAlertTap(event: any) {
    const alert = this.data.alerts[Number(event.currentTarget.dataset.index)];
    if (!alert || !alert.url) return;
    if (alert.replace) wx.redirectTo({ url: alert.url });
    else wx.navigateTo({ url: alert.url });
  },

  /* -------------------------------- 到班状态流转 -------------------------------- */

  async onTransition(event: any) {
    const studentId = event.currentTarget.dataset.student;
    const to = event.currentTarget.dataset.to;
    try {
      await api.post("/sessions/transition", { studentId, to });
      toast(`已标记「${to}」`);
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  /** 撤回「已接走」：只有负责人能做，且必须写原因，因为它会进审计日志 */
  onRevert(event: any) {
    const row = this.data.rows[Number(event.currentTarget.dataset.index)];
    if (!row) return;
    this.setData({
      formShow: true,
      formTitle: "撤回「已接走」",
      formHint: "状态回退属于纠错操作，会记入审计日志。",
      formFields: [{ name: "reason", label: "原因", required: true, type: "textarea" }],
      formSubmitText: "确认回退",
      formAction: "revertPickup",
      formPayload: { studentId: row.studentId },
    });
  },

  /* -------------------------------- 接娃提醒 -------------------------------- */

  onNotify(event: any) {
    const row = this.data.rows[Number(event.currentTarget.dataset.index)];
    if (row) void this.sendReminder(row);
  },

  /**
   * 先用动作菜单选一个常用时长，选「自定义」才展开表单。
   * 表单是事件回调式的，所以这里把学员 id 寄存进 formPayload，
   * 剩下的一半流程在 onFormSubmit 里接着走。
   */
  async sendReminder(row: any) {
    const choice = await actionSheet({
      title: `提醒 ${row.name} 的家长`,
      actions: [
        { label: "15 分钟后可接", value: "15" },
        { label: "30 分钟后可接", value: "30" },
        { label: "60 分钟后可接", value: "60" },
        { label: "自定义时间…", value: "custom" },
      ],
    });
    if (!choice) return;

    if (choice === "custom") {
      this.setData({
        formShow: true,
        formTitle: "自定义可接时间",
        formHint: "",
        formFields: [
          { name: "etaAt", label: "预计可接时刻", required: true, placeholder: "18:30", maxlength: 5 },
        ],
        formSubmitText: "发送提醒",
        formAction: "reminderEta",
        formPayload: { studentId: row.studentId },
      });
      return;
    }

    await this.postReminder({
      studentId: row.studentId,
      requestId: newRequestId(),
      minutes: Number(choice),
    });
  },

  /**
   * 真正发提醒。两件事必须如实说给老师听：
   *  - 家长还没绑定时提醒发不出去，这时候只能打电话，不能让老师以为已经通知到了；
   *  - 短时间内重复提醒会被服务端拦成 DUPLICATE_REQUEST，确认后才带 confirmDuplicate 重发。
   */
  async postReminder(body: Record<string, unknown>) {
    try {
      const result = await api.post<any>("/reminders", body);
      toast(
        result.delivered
          ? `已通知家长：预计 ${result.reminder.etaAt} 可接`
          : "家长还没绑定，提醒已记录但没发出去，请电话联系",
      );
      await this.load();
    } catch (error) {
      if (error instanceof ApiError && error.code === "DUPLICATE_REQUEST") {
        const again = await confirmDialog({
          title: "重复提醒",
          body: error.message,
          confirmText: "再发一次",
        });
        if (!again) return;
        try {
          // 换一个 requestId，否则会再次撞上幂等键
          await api.post("/reminders", { ...body, confirmDuplicate: true, requestId: newRequestId() });
          toast("已再次发送");
          await this.load();
        } catch (retryError) {
          toastError(retryError);
        }
        return;
      }
      toastError(error);
    }
  },

  /* -------------------------------- 表单弹层 -------------------------------- */

  onFormCancel() {
    this.setData({ formShow: false });
  },

  async onFormSubmit(event: any) {
    const values = event.detail || {};
    const action = this.data.formAction;
    const payload = this.data.formPayload || {};
    this.setData({ formShow: false });

    if (action === "reminderEta") {
      await this.postReminder({
        studentId: payload.studentId,
        requestId: newRequestId(),
        etaAt: values.etaAt,
      });
      return;
    }

    if (action === "revertPickup") {
      try {
        await api.post("/sessions/transition", {
          studentId: payload.studentId,
          to: "待接",
          reason: values.reason,
        });
        toast("已回退");
        await this.load();
      } catch (error) {
        toastError(error);
      }
    }
  },
});
