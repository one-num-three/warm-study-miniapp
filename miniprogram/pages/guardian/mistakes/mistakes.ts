/**
 * 错题本 —— 家长把孩子做错的题记下来，标记订正进度。
 *
 * 状态只有三档（待订正 / 已订正 / 已掌握），而且允许往回退：
 * 「复测又错了」是真实发生的事，如果只能单向前进，家长就会为了让记录好看而不敢点回去，
 * 错题本也就失去了意义。所以下一步能点哪几个按钮由当前状态决定，在 .ts 里算好。
 */

import { api, toast, toastError } from "../../../utils/api";
import { mistakeTone } from "../../../utils/format";

/** 状态流转表。和 h5/src/pages/guardian.ts 的 nextMistakeActions 保持一致。 */
const TRANSITIONS: Record<string, Array<{ to: string; label: string }>> = {
  待订正: [{ to: "已订正", label: "标记已订正" }],
  已订正: [
    { to: "已掌握", label: "已经掌握了" },
    { to: "待订正", label: "订正得不对" },
  ],
  已掌握: [{ to: "待订正", label: "复测又错了" }],
};

Page({
  data: {
    loading: true,
    error: "",
    noStudent: false,
    /** 每道错题都带好了 tone / 标题 / 错因文案 / 可点的按钮 */
    questions: [] as any[],

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

  async load() {
    const app = getApp<any>();
    this.setData({ loading: true, error: "" });

    const student = app.activeStudent();
    if (!student) {
      this.setData({ loading: false, noStudent: true });
      return;
    }

    try {
      const questions = await api.get<any>("/wrong-questions", { studentId: student.id });
      this.setData({
        noStudent: false,
        questions: (questions || []).map((question: any) => ({
          ...question,
          tone: mistakeTone(question.status),
          titleText: `${question.subject} · ${question.knowledge}`,
          reasonText: question.reason ? `错因：${question.reason}` : "",
          answerText: question.answer ? `正确答案：${question.answer}` : "",
          actions: TRANSITIONS[question.status] || [],
        })),
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

  /* --------------------------------- 记错题 --------------------------------- */

  onAdd() {
    this.setData({
      formShow: true,
      formAction: "addQuestion",
      formTitle: "记一道错题",
      formSubmitText: "保存",
      formFields: [
        {
          name: "subject",
          label: "科目",
          type: "select",
          required: true,
          options: ["语文", "数学", "英语", "科学", "其他"],
          value: "语文",
        },
        { name: "knowledge", label: "知识点", required: true, placeholder: "例如：两位数进位加法" },
        { name: "reason", label: "错因", type: "textarea", placeholder: "为什么错了" },
        { name: "answer", label: "正确答案", type: "textarea" },
        { name: "image", label: "题目照片", type: "image" },
      ],
    });
  },

  onFormCancel() {
    this.setData({ formShow: false });
  },

  async onFormSubmit(event: any) {
    const values = event.detail || {};
    this.setData({ formShow: false });
    if (this.data.formAction !== "addQuestion") return;

    const student = getApp<any>().activeStudent();
    if (!student) return;

    const payload: any = {
      studentId: student.id,
      subject: values.subject,
      knowledge: values.knowledge,
    };
    // 选填字段留空就别往上传：服务端对空串也会走一遍长度校验，传了反而多一层出错的可能
    ["reason", "answer", "image"].forEach((key) => {
      if (values[key]) payload[key] = values[key];
    });

    try {
      await api.post("/wrong-questions", payload);
      toast("已记录");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  /* -------------------------------- 状态流转 -------------------------------- */

  async onTransition(event: any) {
    const dataset = event.currentTarget.dataset;
    const id = dataset.id;
    const to = dataset.to;
    if (!id || !to) return;

    try {
      await api.post(`/wrong-questions/${id}/transition`, { to });
      toast("已更新");
      // 状态变了下一步能点的按钮也跟着变，整页重拉最省心
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },
});
