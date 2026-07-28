/**
 * 管理入口（管理端第 4 个 Tab）—— 对应 h5/src/pages/admin.ts 的 definePage("admin.manage")。
 *
 * 这一页本身没有业务数据，它的全部价值在于"谁能看到哪几个入口"：
 * 老师登进来只应看到「商品与库存」之外的极少数条目，
 * 审计日志、系统设置、老师账号、绑定审核、积分对账这些一律不渲染 —— 不是禁用，是不存在。
 * 服务端当然还会再校验一次，但界面上先不给念想，能省掉大量"为什么点了没反应"的追问。
 */

import { confirmDialog } from "../../../utils/ui";
import { initial } from "../../../utils/format";
import { PERMISSIONS } from "../../../shared/permissions.js";

Page({
  data: {
    loading: true,
    error: "",
    displayName: "",
    avatarText: "",
    roleText: "",
    /** 已按权限过滤好的入口，WXML 只负责渲染 */
    entries: [] as any[],
    /** 双身份用户（自己也是家长）才显示切换入口 */
    showSwitch: false,
  },

  async onLoad() {
    await getApp<any>().ready();
    this.build();
  },

  /** 从子页面返回时档案可能变了（比如刚给自己绑了孩子），重建一次入口列表 */
  onShow() {
    if (!this.data.loading) this.build();
  },

  build() {
    const app = getApp<any>();
    const profile = app.globalData.profile;
    if (!profile) {
      this.setData({ loading: false, error: "登录状态已失效，请重新登录" });
      return;
    }

    const owner = app.isOwner();
    const all = [
      {
        label: "家长绑定审核",
        hint: "审核、解除家长与孩子的绑定关系",
        page: "/pages/admin/bindings/bindings",
        show: app.can(PERMISSIONS.BINDING_REVIEW),
      },
      {
        label: "商品与库存",
        hint: "上下架、改价、补库存",
        page: "/pages/admin/products/products",
        show: app.can(PERMISSIONS.PRODUCT_MANAGE),
      },
      { label: "兑换记录", hint: "查看与撤销兑换", page: "/pages/admin/redemptions/redemptions", show: true },
      {
        label: "老师账号",
        hint: "新增老师、分配权限、停用账号",
        page: "/pages/admin/staff/staff",
        show: app.can(PERMISSIONS.STAFF_MANAGE),
      },
      {
        label: "审计日志",
        hint: "敏感操作全记录，只增不删",
        page: "/pages/admin/audit/audit",
        show: app.can(PERMISSIONS.AUDIT_READ),
      },
      {
        label: "系统设置",
        hint: "绑定审核开关、积分规则、排行隐私",
        page: "/pages/admin/settings/settings",
        show: app.can(PERMISSIONS.SETTINGS_MANAGE),
      },
      { label: "积分对账", hint: "流水重算余额，只读核对", page: "/pages/admin/reconcile/reconcile", show: owner },
    ];

    this.setData({
      loading: false,
      error: "",
      displayName: profile.displayName || "",
      avatarText: initial(profile.displayName),
      roleText: owner ? "负责人" : "老师",
      entries: all.filter((entry) => entry.show),
      showSwitch: (profile.students || []).length > 0,
    });
  },

  onOpenEntry(event: any) {
    wx.navigateTo({ url: event.currentTarget.dataset.page });
  },

  onSwitchGuardian() {
    getApp<any>().switchShell("guardian");
  },

  async onLogout() {
    const yes = await confirmDialog({ title: "退出登录？", danger: true });
    if (yes) await getApp<any>().logout();
  },

  /** 档案没了只能重新登录，reLaunch 清掉管理端的页面栈 */
  goLogin() {
    wx.reLaunch({ url: "/pages/login/login" });
  },
});
