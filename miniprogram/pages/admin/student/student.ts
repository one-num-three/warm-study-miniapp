/**
 * 学员详情 —— 对应 h5/src/pages/admin.ts 的 definePage("admin.student")。
 *
 * 一屏之内回答老师最常问的四件事：
 *  1. 绑定码是多少、还能不能用；
 *  2. 谁绑了这个孩子；
 *  3. 积分对不对得上（缓存余额 vs 流水重算），怎么发、怎么冲正；
 *  4. 档案本身怎么改、怎么停用。
 *
 * 这是普通页面（不在 TabBar 上），所以不放 tab-bar 组件，用返回键回列表。
 */

import { api, ApiError, toast, toastError } from "../../../utils/api";
import { confirmDialog, copyText } from "../../../utils/ui";
import { bindingTone, compactStamp, decorateLedger } from "../../../utils/format";
import { newRequestId } from "../../../shared/id.js";
import { PERMISSIONS } from "../../../shared/permissions.js";

/** 发积分时可选的类型。负责人多一项「人工调整」—— 这就是权限边界在界面上的样子。 */
const OWNER_LEDGER_TYPES = ["表现奖励", "作业奖励", "错题订正", "人工调整"];
const STAFF_LEDGER_TYPES = ["表现奖励", "作业奖励", "错题订正"];

Page({
  data: {
    loading: true,
    error: "",
    studentId: "",

    detail: null as any,
    guardians: [] as any[],
    entries: [] as any[],
    pointsTitle: "",
    balanceTagClass: "tag",
    balanceTagText: "",

    /* -------------------------------- 权限开关 -------------------------------- */
    canBindingCode: false,
    canGrant: false,
    canRedeem: false,
    canManage: false,
    isOwner: false,

    /* -------------------------------- 表单弹层 -------------------------------- */
    formShow: false,
    formTitle: "",
    formHint: "",
    formFields: [] as any[],
    formSubmitText: "保存",
    formAction: "",
    /** 弹层提交时才用得上的上下文，例如要冲正哪条流水 */
    formPayload: null as any,

    /* ------------------------------ 绑定码大字弹层 ------------------------------ */
    codeShow: false,
    codeTitle: "",
    codeValue: "",
    codeBody: "",
  },

  async onLoad(query: any) {
    const app = getApp<any>();
    await app.ready();
    this.setData({
      studentId: (query && query.id) || "",
      canBindingCode: app.can(PERMISSIONS.BINDING_CODE_MANAGE),
      canGrant: app.can(PERMISSIONS.POINTS_GRANT),
      canRedeem: app.can(PERMISSIONS.REDEMPTION_CREATE),
      canManage: app.can(PERMISSIONS.STUDENT_MANAGE),
      isOwner: app.isOwner(),
    });
    await this.load();
  },

  /** 从「现场兑换」返回时积分已经变了，回来必须重新拉一次 */
  onShow() {
    if (!this.data.loading) void this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    const app = getApp<any>();
    const id = this.data.studentId;
    try {
      const [detail, ledger] = await Promise.all([
        api.get<any>(`/students/${id}`),
        api.get<any>("/points/ledger", { studentId: id, limit: 30 }),
      ]);

      const active = detail.status === "active";
      const balanced = detail.pointBalance === detail.computedBalance;

      this.setData({
        detail: {
          ...detail,
          statusClass: active ? "tag" : "tag tag--muted",
          statusText: active ? "在读" : "已停用",
          subText: `${detail.grade} · 昵称 ${detail.nickname || "未设置"}`,
          plateClass: detail.bindingCodeEnabled ? "code-plate" : "code-plate is-disabled",
          plateLabel: detail.bindingCodeEnabled ? "绑定码（固定不变）" : "绑定码已停用",
          toggleCodeText: detail.bindingCodeEnabled ? "停用绑定码" : "启用绑定码",
          rankingText: detail.publicRanking ? "退出公开排行" : "加入公开排行",
          statusBtnText: active ? "停用学员" : "恢复在读",
          statusBtnClass: active ? "btn btn--sm btn--danger" : "btn btn--sm",
        },
        guardians: (detail.guardians ?? []).map((guardian: any) => ({
          ...guardian,
          titleText: `${guardian.displayName}（${guardian.relation}）`,
          stamp: compactStamp(guardian.createdAt),
          toneClass: bindingTone(guardian.status),
          // 只有已生效的绑定才谈得上"解除"，而且要有审核权限
          canRelease: guardian.status === "已通过" && app.can(PERMISSIONS.BINDING_REVIEW),
        })),
        entries: decorateLedger(ledger.entries ?? []).map((entry: any) => ({
          ...entry,
          subText: `${entry.type} · ${entry.stamp}`,
          // 冲正是负责人的纠错手段：已被冲正的、以及冲正流水本身都不能再冲
          canReverse: app.isOwner() && !entry.reversed && entry.type !== "撤销冲正",
        })),
        pointsTitle: `积分 ${detail.pointBalance}`,
        balanceTagClass: balanced ? "tag" : "tag tag--danger",
        balanceTagText: balanced ? "账目一致" : `与流水差 ${detail.pointBalance - detail.computedBalance}`,
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

  /* --------------------------------- 绑定码 --------------------------------- */

  onCopyCode(event: any) {
    const code = event.currentTarget.dataset.code;
    copyText(code, `已复制 ${code}`);
  },

  async onToggleCode() {
    const enabled = this.data.detail.bindingCodeEnabled;
    const yes = await confirmDialog({
      title: enabled ? "停用绑定码？" : "启用绑定码？",
      body: enabled
        ? "停用后新家长无法用这个码绑定，已绑定的家长不受影响。"
        : "启用后家长可以重新用这个码绑定。",
    });
    if (!yes) return;
    try {
      await api.post(`/students/${this.data.studentId}/binding-code/toggle`, { enabled: !enabled });
      toast("已更新");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  onResetCode() {
    this.setData({
      formShow: true,
      formTitle: "重置绑定码",
      formHint: "只有码外泄时才需要重置。重置后旧码立即失效，已绑定的家长不受影响。",
      formSubmitText: "确认重置",
      formAction: "resetCode",
      formPayload: null,
      formFields: [{ name: "reason", label: "重置原因", required: true, type: "textarea" }],
    });
  },

  /* --------------------------------- 家长绑定 --------------------------------- */

  async onReleaseGuardian(event: any) {
    const dataset = event.currentTarget.dataset;
    const yes = await confirmDialog({
      title: "解除绑定？",
      body: `${dataset.name} 将无法再看到 ${this.data.detail.name} 的数据。`,
      danger: true,
    });
    if (!yes) return;
    try {
      await api.post(`/bindings/${dataset.id}/release`, {});
      toast("已解除");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  /* ---------------------------------- 积分 ---------------------------------- */

  onGrantPoints() {
    this.setData({
      formShow: true,
      formTitle: `给 ${this.data.detail.name} 发积分`,
      formHint: "",
      formSubmitText: "发放",
      formAction: "grantPoints",
      formPayload: null,
      formFields: [
        { name: "delta", label: "分数", required: true, type: "number", value: "10" },
        {
          name: "type",
          label: "类型",
          type: "select",
          value: "表现奖励",
          options: this.data.isOwner ? OWNER_LEDGER_TYPES : STAFF_LEDGER_TYPES,
        },
        {
          name: "reason",
          label: "原因",
          required: true,
          placeholder: "写清楚，家长看得到",
          maxlength: 100,
        },
      ],
    });
  },

  onRedeem() {
    wx.navigateTo({ url: `/pages/admin/redeem/redeem?id=${this.data.studentId}` });
  },

  onReverseLedger(event: any) {
    this.setData({
      formShow: true,
      formTitle: "冲正这笔流水",
      formHint: "原流水永久保留，系统会另外生成一条反向流水。",
      formSubmitText: "确认冲正",
      formAction: "reverseLedger",
      formPayload: { ledgerId: event.currentTarget.dataset.id },
      formFields: [{ name: "reason", label: "冲正原因", required: true, type: "textarea" }],
    });
  },

  /* --------------------------------- 档案管理 --------------------------------- */

  onEditStudent() {
    const detail = this.data.detail;
    this.setData({
      formShow: true,
      formTitle: "编辑档案",
      formHint: "",
      formSubmitText: "保存",
      formAction: "editStudent",
      formPayload: null,
      formFields: [
        { name: "name", label: "姓名", required: true, value: detail.name },
        { name: "nickname", label: "昵称", value: detail.nickname || "" },
        { name: "grade", label: "年级", required: true, value: detail.grade },
        { name: "note", label: "备注", type: "textarea", value: detail.note || "" },
      ],
    });
  },

  async onToggleRanking() {
    const publicRanking = this.data.detail.publicRanking;
    try {
      await api.patch(`/students/${this.data.studentId}`, { publicRanking: !publicRanking });
      toast(publicRanking ? "已设为不公开参与排行" : "已加入公开排行");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  async onToggleStatus() {
    const active = this.data.detail.status === "active";
    const yes = await confirmDialog({
      title: active ? "停用这名学员？" : "恢复在读？",
      body: active
        ? "停用后不再产生新记录，历史数据全部保留。"
        : "恢复后可以继续记录作业和积分。",
      danger: active,
    });
    if (!yes) return;
    try {
      await api.patch(`/students/${this.data.studentId}`, {
        status: active ? "disabled" : "active",
      });
      toast("已更新");
      await this.load();
    } catch (error) {
      toastError(error);
    }
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

    if (action === "resetCode") await this.submitResetCode(values.reason);
    else if (action === "grantPoints") await this.submitGrant(values);
    else if (action === "reverseLedger") await this.submitReverse(payload.ledgerId, values.reason);
    else if (action === "editStudent") await this.submitEdit(values);
  },

  async submitResetCode(reason: string) {
    try {
      const result = await api.post<any>(`/students/${this.data.studentId}/binding-code/reset`, {
        reason,
      });
      // 新码同样要大字展示一次，否则老师没地方看到它
      this.setData({
        codeShow: true,
        codeTitle: "新的绑定码",
        codeValue: result.bindingCodeDisplay,
        codeBody: "旧码已立即失效，请把新码交给还没绑定的家长。",
      });
    } catch (error) {
      toastError(error);
    }
  },

  async submitGrant(values: any) {
    const payload: any = {
      studentId: this.data.studentId,
      delta: Number(values.delta),
      type: values.type,
      reason: values.reason,
      requestId: newRequestId(),
    };
    try {
      await api.post("/points/grant", payload);
      toast("已发放");
      await this.load();
    } catch (error) {
      // 大额调整服务端会要二次确认：把服务端的原话弹给用户，确认后带 confirmed 重发
      if (error instanceof ApiError && error.details && error.details.requiresConfirm) {
        const yes = await confirmDialog({ title: "大额调整确认", body: error.message });
        if (!yes) return;
        try {
          // requestId 必须换新的，否则会被幂等拦截当成重复请求
          await api.post("/points/grant", { ...payload, confirmed: true, requestId: newRequestId() });
          toast("已发放");
          await this.load();
        } catch (retryError) {
          toastError(retryError);
        }
        return;
      }
      toastError(error);
    }
  },

  async submitReverse(ledgerId: string, reason: string) {
    try {
      await api.post("/points/reverse", { ledgerId, reason });
      toast("已冲正");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  async submitEdit(values: any) {
    try {
      await api.patch(`/students/${this.data.studentId}`, values);
      toast("已保存");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  onCodeClose() {
    this.setData({ codeShow: false });
    void this.load();
  },
});
