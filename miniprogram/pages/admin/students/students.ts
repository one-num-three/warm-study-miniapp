/**
 * 学员列表（管理端第 3 个 Tab）—— 对应 h5/src/pages/admin.ts 的 definePage("admin.students")。
 *
 * 这一页的主角是绑定码：老师建完档案，唯一要做的事就是把码抄给家长。
 * 所以每张卡都把码做成深绿"牌子"并配一键复制；新增成功后再用大字弹层强推一次，
 * 免得老师回头满列表找码 —— 那说明这个页面没做好自己的本职工作。
 */

import { api, toastError } from "../../../utils/api";
import { copyText } from "../../../utils/ui";
import { formatBindingCode } from "../../../shared/binding-code.js";
import { PERMISSIONS } from "../../../shared/permissions.js";

/** 新增学员时可选的年级，和 H5 保持同一份清单 */
const GRADES = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"];

Page({
  data: {
    loading: true,
    error: "",
    /** 只有拿到 student.manage 的人才能建档，老师看不到「新增学员」 */
    canManage: false,
    students: [] as any[],

    /* -------------------------------- 表单弹层 -------------------------------- */
    formShow: false,
    formTitle: "",
    formHint: "",
    formFields: [] as any[],
    formSubmitText: "保存",
    formAction: "",

    /* ------------------------------ 绑定码大字弹层 ------------------------------ */
    codeShow: false,
    codeTitle: "",
    codeValue: "",
    codeBody: "",
  },

  async onLoad() {
    const app = getApp<any>();
    await app.ready();
    this.setData({ canManage: app.can(PERMISSIONS.STUDENT_MANAGE) });
    await this.load();
  },

  /** 从学员详情页返回时可能改过档案 / 重置过绑定码，回来要拿最新的 */
  onShow() {
    if (!this.data.loading) void this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      // includeDisabled：停用的学员也要列出来，否则老师会以为档案丢了
      const list = await api.get<any[]>("/students", { includeDisabled: "true" });
      this.setData({ students: (list ?? []).map(decorate), loading: false });
    } catch (error: any) {
      this.setData({
        loading: false,
        error: error && error.message ? error.message : "加载失败，请稍后重试",
      });
      toastError(error);
    }
  },

  /* --------------------------------- 列表交互 --------------------------------- */

  onCopyCode(event: any) {
    const code = event.currentTarget.dataset.code;
    copyText(code, `已复制 ${code}`);
  },

  onOpenDetail(event: any) {
    wx.navigateTo({ url: `/pages/admin/student/student?id=${event.currentTarget.dataset.id}` });
  },

  /* --------------------------------- 新增学员 --------------------------------- */

  onCreateStudent() {
    this.setData({
      formShow: true,
      formTitle: "新增学员",
      formHint: "保存后系统会生成一个唯一固定的绑定码，把它给家长即可完成绑定。",
      formSubmitText: "建立档案",
      formAction: "createStudent",
      formFields: [
        { name: "name", label: "姓名", required: true, maxlength: 20 },
        { name: "nickname", label: "昵称（排行榜上显示）", maxlength: 20 },
        { name: "grade", label: "年级", required: true, type: "select", options: GRADES, value: "一年级" },
        { name: "note", label: "备注", type: "textarea" },
      ],
    });
  },

  onFormCancel() {
    this.setData({ formShow: false });
  },

  async onFormSubmit(event: any) {
    const values = event.detail;
    const action = this.data.formAction;
    this.setData({ formShow: false });
    if (action !== "createStudent") return;

    try {
      const result = await api.post<any>("/students", values);
      // 生成的码在这里显眼地展示一次 —— 这就是老师抄给家长的那张纸条
      this.setData({
        codeShow: true,
        codeTitle: `${result.student.name} 的绑定码`,
        codeValue: result.bindingCodeDisplay,
        codeBody:
          "把这串码给家长，他们在小程序里输入即可绑定。这个码固定不变，爸爸妈妈可以用同一个码分别绑定。",
      });
    } catch (error) {
      toastError(error);
    }
  },

  /** 关掉码弹层再刷新列表：新学员这时才需要出现在列表里 */
  onCodeClose() {
    this.setData({ codeShow: false });
    void this.load();
  },
});

/**
 * 把服务端的学员对象加工成 WXML 能直接渲染的形状。
 * WXML 里不能调用函数，所以拼接文案、标签配色、绑定码展示形式都得在这里算完。
 */
function decorate(student: any): any {
  const active = student.status === "active";
  return {
    ...student,
    titleText: student.nickname ? `${student.name}（${student.nickname}）` : student.name,
    tagClass: active ? "tag" : "tag tag--muted",
    tagText: active ? student.grade : "已停用",
    codeDisplay: formatBindingCode(student.bindingCode),
    plateClass: student.bindingCodeEnabled ? "code-plate" : "code-plate is-disabled",
    balanceText: `${student.pointBalance} 分`,
  };
}
