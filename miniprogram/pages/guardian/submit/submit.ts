/**
 * 家长端「提交作业」—— 对应 h5 的 definePage("guardian.submit")。
 *
 * 设计上刻意做成"先在本地攒一份清单，最后一次性提交"：
 * 家长通常是抄着孩子的记事本一科一科敲，中途还要拍照，
 * 每加一项就发一次请求既慢又容易只提交半份；
 * 而且服务端一天只允许一张作业单，多次提交会撞唯一约束。
 *
 * 提交成功后作业进入「待确认」，老师开始辅导就锁死不能再改 —— 这一点写在页面顶部的说明里。
 */

import { api, toast, toastError } from "../../../utils/api";
import { compactStamp, todayKey } from "../../../utils/format";

/** 科目候选。和 h5 的 formSheet 选项保持一致，别让两端出现不同的科目名。 */
const SUBJECTS = ["语文", "数学", "英语", "科学", "其他"];

Page({
  /** 本地清单的行号，只用来当列表 key —— 删掉中间一项后剩下的行不能被复用错 */
  seq: 0,
  /** 当前孩子 id，提交时用；不进 data 是因为模板不需要它 */
  studentId: "",

  data: {
    loading: true,
    error: "",

    /** 一个孩子都没绑：整页换成绑定引导 */
    noStudent: false,
    pendings: [] as any[],

    /** 顶部标题：孩子姓名 · 今天的日期 */
    headTitle: "",
    /** 本地攒的作业清单，提交前不落服务端 */
    items: [] as any[],
    submitting: false,

    /* -------- 通用表单弹层 -------- */
    formShow: false,
    formTitle: "",
    formHint: "",
    formFields: [] as any[],
    formSubmitText: "保存",
    formAction: "",
  },

  async onLoad() {
    await getApp<any>().ready();
    await this.load();
  },

  /** 这一页没有列表接口，load 只负责取当前孩子；写成可重试的形式和其它页面保持一致 */
  async load() {
    const app = getApp<any>();
    this.setData({ loading: true, error: "" });
    try {
      const student = app.activeStudent();
      if (!student) {
        this.setData({
          loading: false,
          noStudent: true,
          pendings: buildPendings(app.globalData.profile),
        });
        return;
      }
      this.studentId = student.id;
      this.setData({
        loading: false,
        noStudent: false,
        headTitle: `${student.name} · ${todayKey()}`,
      });
    } catch (error: any) {
      this.setData({
        loading: false,
        error: error && error.message ? error.message : "加载失败，请稍后重试",
      });
      toastError(error);
    }
  },

  goBind() {
    wx.navigateTo({ url: "/pages/guardian/bind/bind" });
  },

  /* ------------------------------- 本地作业清单 ------------------------------- */

  onAddItem() {
    this.setData({
      formShow: true,
      formAction: "addItem",
      formTitle: "添加一项作业",
      formHint: "",
      formSubmitText: "添加",
      formFields: [
        {
          name: "subject",
          label: "科目",
          type: "select",
          required: true,
          options: SUBJECTS,
          value: SUBJECTS[0],
        },
        {
          name: "content",
          label: "作业内容",
          type: "textarea",
          placeholder: "例如：抄写生字两遍、口算 30 题",
        },
        {
          name: "image",
          label: "作业照片（选填）",
          type: "image",
          hint: "拍一张作业本，老师看得更清楚",
        },
      ],
    });
  },

  onFormCancel() {
    this.setData({ formShow: false });
  },

  onFormSubmit(event: any) {
    const values = event.detail;
    this.setData({ formShow: false });
    if (this.data.formAction !== "addItem") return;

    this.seq += 1;
    const content = values.content || "";
    this.setData({
      items: this.data.items.concat([
        {
          key: `item-${this.seq}`,
          subject: values.subject,
          content,
          // 没写说明也要占住副标题的位置，否则那一行看起来像坏了
          contentText: content || "（没有补充说明）",
          image: values.image || "",
        },
      ]),
    });
  },

  onRemoveItem(event: any) {
    const index = Number(event.currentTarget.dataset.index);
    const items = this.data.items.slice();
    items.splice(index, 1);
    this.setData({ items });
  },

  /* --------------------------------- 提交 --------------------------------- */

  async onSubmit() {
    if (this.data.submitting) return;
    if (this.data.items.length === 0) {
      toast("至少添加一项作业");
      return;
    }

    // 只把服务端认识的字段发过去，key / contentText 是纯展示用的
    const items = this.data.items.map((item: any) => {
      const payload: any = { subject: item.subject, content: item.content };
      if (item.image) payload.image = item.image;
      return payload;
    });

    this.setData({ submitting: true });
    try {
      await api.post("/homework/sheets", { studentId: this.studentId, items });
      toast("已提交，老师会在班上处理");
      // 从作业列表或今日页进来的直接退回去；被分享链接直接打开时没有上一页，切回作业 Tab
      const pages = getCurrentPages();
      if (pages.length > 1) wx.navigateBack({});
      else wx.switchTab({ url: "/pages/guardian/homework/homework" });
    } catch (error) {
      this.setData({ submitting: false });
      toastError(error);
    }
  },
});

/* --------------------------------- 数据加工 --------------------------------- */

/** 待审核的绑定申请。服务端没给 id，用姓名 + 提交时间拼一个稳定的列表 key。 */
function buildPendings(profile: any): any[] {
  return ((profile && profile.pendingBindings) || []).map((item: any) => ({
    key: `${item.studentName}-${item.createdAt}`,
    studentName: item.studentName,
    sub: `关系：${item.relation} · 提交于 ${compactStamp(item.createdAt)}`,
  }));
}
