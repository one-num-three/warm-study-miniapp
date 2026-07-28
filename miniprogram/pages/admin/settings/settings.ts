/**
 * 系统设置 —— 对应 h5/src/pages/admin.ts 的 definePage("admin.settings")。
 *
 * 这几个开关直接改变别的页面的行为（绑定要不要审核、发多少分、库存什么时候告警），
 * 所以每一项都必须带一句"改了会怎样"的说明 —— 负责人不该靠猜来决定要不要动它。
 *
 * 权限上这一页有点特别：GET /settings 只要登录就能读，PATCH 才要 settings.manage。
 * 所以老师能进来看当前配置，但一个可点的控件都不该出现，否则就是在骗他点。
 */

import { api, toast, toastError } from "../../../utils/api";
import { SETTING_KEYS } from "../../../shared/api-contract.js";
import { PERMISSIONS } from "../../../shared/permissions.js";

/**
 * 设置项清单：分组、控件类型、文案，和 H5 一字对齐。
 * 放在模块级而不是 data 里，因为它是静态的，没必要每次 setData 都搬一遍。
 */
const SETTING_SPEC = [
  {
    group: "绑定",
    key: SETTING_KEYS.BINDING_REQUIRES_REVIEW,
    kind: "toggle",
    label: "绑定码需要人工审核",
    hint: "关闭时家长输码即绑定；开启后要负责人在「绑定审核」里通过",
  },
  {
    group: "积分",
    key: SETTING_KEYS.HOMEWORK_DEFAULT_REWARD,
    kind: "number",
    label: "作业完成默认奖励",
    hint: "结束作业时的默认发放分数",
  },
  {
    group: "积分",
    key: SETTING_KEYS.POINTS_ADJUST_THRESHOLD,
    kind: "number",
    label: "大额调整阈值",
    hint: "超过这个分数的人工调整需要二次确认",
  },
  {
    group: "商店与排行",
    key: SETTING_KEYS.LOW_STOCK_THRESHOLD,
    kind: "number",
    label: "库存告警线",
    hint: "库存低于这个数会在看板提示",
  },
  {
    group: "商店与排行",
    key: SETTING_KEYS.LEADERBOARD_SHOW_REAL_NAME,
    kind: "toggle",
    label: "家长端排行显示真实姓名",
    hint: "默认关闭，家长端只看到昵称或脱敏姓名",
  },
];

/** 卡片顺序。和 SETTING_SPEC 里的 group 一一对应。 */
const GROUP_TITLES = ["绑定", "积分", "商店与排行"];

Page({
  data: {
    loading: true,
    error: "",
    /** 没有 settings.manage 就只能看，所有开关和改值按钮都不给点 */
    canManage: false,
    /** 服务端返回的原始配置。只在 .ts 里读，WXML 用下面加工好的 groups */
    settings: {} as any,
    /** [{ title, rows: [{ key, label, hint, kind, on, value, switchClass }] }] */
    groups: [] as any[],

    /* -------------------------------- 表单弹层 -------------------------------- */
    formShow: false,
    formTitle: "",
    formHint: "",
    formFields: [] as any[],
    formSubmitText: "保存",
    formAction: "",
    formPayload: null as any,
  },

  async onLoad() {
    const app = getApp<any>();
    await app.ready();
    this.setData({ canManage: app.can(PERMISSIONS.SETTINGS_MANAGE) });
    await this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const settings = (await api.get<any>("/settings")) ?? {};
      this.setData({
        settings,
        groups: GROUP_TITLES.map((title) => ({ title, rows: buildRows(title, settings) })),
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

  /* ---------------------------------- 开关 ---------------------------------- */

  async onToggle(event: any) {
    const key = event.currentTarget.dataset.key;
    const on = Boolean(this.data.settings[key]);
    try {
      await api.patch("/settings", { [key]: !on });
      toast("已保存");
      // 重新拉一次而不是本地取反：服务端可能会归一化或拒改某一项，以它的结果为准
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  /* --------------------------------- 数值项 --------------------------------- */

  onEditNumber(event: any) {
    const key = event.currentTarget.dataset.key;
    const spec = SETTING_SPEC.filter((item) => item.key === key)[0];
    if (!spec) return;
    this.setData({
      formShow: true,
      formTitle: spec.label,
      formHint: spec.hint,
      formSubmitText: "保存",
      formAction: "updateNumber",
      formPayload: { key },
      formFields: [
        {
          name: "value",
          label: spec.label,
          type: "number",
          required: true,
          value: String(this.data.settings[key] ?? 0),
        },
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
    if (action !== "updateNumber") return;

    try {
      await api.patch("/settings", { [payload.key]: Number(values.value) });
      toast("已保存");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },
});

/**
 * 把某一组的设置项加工成 WXML 能直接渲染的行。
 * WXML 里不能调用函数，开关的 class 和按钮上的当前值都得在这里算好。
 */
function buildRows(group: string, settings: any): any[] {
  return SETTING_SPEC.filter((item) => item.group === group).map((item) => {
    const raw = settings[item.key];
    const on = Boolean(raw);
    return {
      key: item.key,
      label: item.label,
      hint: item.hint,
      kind: item.kind,
      on,
      // 服务端没返回这一项时显示短横而不是 "undefined"，让缺配置一眼可见
      value: raw === undefined || raw === null ? "-" : String(raw),
      switchClass: on ? "switch is-on" : "switch",
    };
  });
}
