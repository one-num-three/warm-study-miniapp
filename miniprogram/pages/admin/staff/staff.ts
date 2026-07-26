/**
 * 老师账号 —— 对应 h5/src/pages/admin.ts 的 definePage("admin.staff")。
 *
 * 这一页只有负责人进得来（manage 页已按 staff.manage 显隐，服务端再挡一次）。
 * 除了照搬 H5 的新增 / 停用 / 重设密码，这里额外把每个人的权限翻成中文平铺出来：
 * 「3 项权限」这种数字对负责人毫无意义，他真正要判断的是"这个老师能不能碰钱"。
 */

import { api, toast, toastError } from "../../../utils/api";
import { confirmDialog } from "../../../utils/ui";
import { PERMISSIONS, PERMISSION_LABELS } from "../../../shared/permissions.js";

/**
 * 权限标签最多平铺几个。
 * 负责人手里是全量 17 项，全铺开会把卡片本身淹掉，超出部分折成「等 N 项」。
 */
const MAX_PERMISSION_TAGS = 8;

Page({
  data: {
    loading: true,
    error: "",
    /** 没有 staff.manage 就只剩查看，所有写操作入口都不渲染 */
    canManage: false,
    staff: [] as any[],

    /* -------------------------------- 表单弹层 -------------------------------- */
    formShow: false,
    formTitle: "",
    formHint: "",
    formFields: [] as any[],
    formSubmitText: "保存",
    formAction: "",
    /** 提交时才用得上的上下文，例如要给谁重设密码 */
    formPayload: null as any,
  },

  async onLoad() {
    const app = getApp<any>();
    await app.ready();
    this.setData({ canManage: app.can(PERMISSIONS.STAFF_MANAGE) });
    await this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const list = await api.get<any[]>("/staff");
      this.setData({ staff: (list ?? []).map(decorate), loading: false });
    } catch (error: any) {
      // 老师直接打开这一页时服务端返回 FORBIDDEN，这里要把"你没有执行该操作的权限"显示出来，不能白屏
      this.setData({
        loading: false,
        error: error && error.message ? error.message : "加载失败，请稍后重试",
      });
      toastError(error);
    }
  },

  /* --------------------------------- 新增老师 --------------------------------- */

  onCreateStaff() {
    this.setData({
      formShow: true,
      formTitle: "新增老师",
      formHint: "",
      formSubmitText: "保存",
      formAction: "createStaff",
      formPayload: null,
      formFields: [
        { name: "displayName", label: "姓名", required: true },
        { name: "username", label: "登录名", required: true, hint: "至少 3 个字符" },
        { name: "password", label: "初始密码", required: true, type: "password", hint: "至少 6 位" },
      ],
    });
  },

  /* --------------------------------- 账号操作 --------------------------------- */

  async onToggleStatus(event: any) {
    const member = this.data.staff[Number(event.currentTarget.dataset.index)];
    if (!member) return;
    const active = member.status === "active";

    const yes = await confirmDialog({
      title: active ? "停用这个账号？" : "恢复这个账号？",
      body: active
        ? "停用后该老师立刻失去所有管理权限，历史操作记录保留。"
        : "恢复后可以重新登录。",
      danger: active,
    });
    if (!yes) return;

    try {
      await api.patch(`/staff/${member.id}`, { status: active ? "disabled" : "active" });
      toast("已更新");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  onResetPassword(event: any) {
    const member = this.data.staff[Number(event.currentTarget.dataset.index)];
    if (!member) return;
    this.setData({
      formShow: true,
      formTitle: `重设 ${member.displayName} 的密码`,
      formHint: "",
      formSubmitText: "保存",
      formAction: "resetPassword",
      formPayload: { id: member.id },
      formFields: [{ name: "password", label: "新密码", required: true, type: "password" }],
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

    if (action === "createStaff") {
      try {
        await api.post("/staff", values);
        toast("已创建");
        await this.load();
      } catch (error) {
        toastError(error);
      }
      return;
    }

    if (action === "resetPassword") {
      try {
        await api.patch(`/staff/${payload.id}`, { password: values.password });
        // 密码不在列表上展示，改完没有任何东西会变，不必重新拉一次
        toast("已重设");
      } catch (error) {
        toastError(error);
      }
    }
  },
});

/**
 * 把服务端的账号对象加工成 WXML 能直接渲染的形状。
 * WXML 里不能调用函数，标签配色、拼接文案、权限中文名都得在这里算完。
 */
function decorate(member: any): any {
  const active = member.status === "active";
  const owner = (member.roles ?? []).indexOf("owner") >= 0;
  const permissions = member.permissions ?? [];

  // 权限码对负责人没有意义，翻成中文；没收录的码（新加的）原样显示，好过显示 undefined
  const labels = permissions.map((code: string) => (PERMISSION_LABELS as any)[code] || code);
  const rest = labels.length - MAX_PERMISSION_TAGS;

  return {
    ...member,
    titleText: member.username ? `${member.displayName}（${member.username}）` : member.displayName,
    // 照搬 H5 这个略绕的组合：配色看账号是否停用，文案看角色
    tagClass: active ? "tag" : "tag tag--muted",
    tagText: owner ? "负责人" : "老师",
    subText: `${permissions.length} 项权限 · ${active ? "正常" : "已停用"}`,
    isOwner: owner,
    statusBtnText: active ? "停用" : "恢复",
    statusBtnClass: active ? "btn btn--sm btn--danger" : "btn btn--sm",
    permissionLabels: labels.slice(0, MAX_PERMISSION_TAGS),
    permissionRestText: rest > 0 ? `等 ${rest} 项` : "",
  };
}
