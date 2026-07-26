/**
 * 通用表单弹层 —— 对应 H5 的 h5/src/ui.ts 里的 formSheet。
 *
 * 管理端几乎每个写操作都要先填一张小表（结束作业要填反馈、发积分要填原因、
 * 重置绑定码要填理由……），如果每个页面各写一遍弹层，样式和校验很快就会飘。
 * 所以抽成一个组件，页面只需要声明「有哪些字段」。
 *
 * 用法：
 *   <form-modal show="{{formShow}}" title="发放积分" fields="{{formFields}}"
 *               bind:submit="onFormSubmit" bind:cancel="onFormCancel" />
 * submit 事件的 detail 就是 { 字段名: 字符串值 }。
 */

import { chooseImageDataUri } from "../../utils/ui";

/** 字段描述。页面按需拼装后通过 fields 传进来。 */
export interface FormField {
  name: string;
  label: string;
  /** 默认 text */
  type?: "text" | "textarea" | "number" | "password" | "select" | "image";
  value?: string;
  placeholder?: string;
  required?: boolean;
  /** 字段下方的灰色说明 */
  hint?: string;
  maxlength?: number;
  /** type 为 select 时的候选项 */
  options?: string[];
}

Component({
  options: { addGlobalClass: true },

  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: "" },
    /** 标题下方的整体说明，用来解释这个操作的后果 */
    hint: { type: String, value: "" },
    submitText: { type: String, value: "保存" },
    cancelText: { type: String, value: "取消" },
    fields: {
      type: Array,
      value: [],
      observer(this: any, value: FormField[]) {
        // 每次页面重新给字段（等于打开一张新表），就按 value 重置一遍输入内容
        this.setData({ rows: buildRows(value) });
      },
    },
  },

  data: {
    /** 字段 + 当前值 + 当前错误。WXML 里不能算表达式，所以这些都在 JS 里拼好 */
    rows: [] as any[],
    submitting: false,
  },

  methods: {
    onInput(this: any, event: any) {
      const index = Number(event.currentTarget.dataset.index);
      this.setData({
        [`rows[${index}].value`]: event.detail.value,
        [`rows[${index}].error`]: "",
      });
    },

    /** picker 回传的是选项下标，转回真正的文本值 */
    onPick(this: any, event: any) {
      const index = Number(event.currentTarget.dataset.index);
      const row = this.data.rows[index];
      const picked = (row.options || [])[Number(event.detail.value)];
      this.setData({ [`rows[${index}].value`]: picked ?? "", [`rows[${index}].error`]: "" });
    },

    async onChooseImage(this: any, event: any) {
      const index = Number(event.currentTarget.dataset.index);
      const dataUri = await chooseImageDataUri();
      if (dataUri) this.setData({ [`rows[${index}].value`]: dataUri });
    },

    onClearImage(this: any, event: any) {
      const index = Number(event.currentTarget.dataset.index);
      this.setData({ [`rows[${index}].value`]: "" });
    },

    onCancel(this: any) {
      this.triggerEvent("cancel");
    },

    /** 阻止点遮罩穿透到下层页面 */
    noop() {},

    onSubmit(this: any) {
      const rows = this.data.rows as any[];
      let firstError = -1;
      const patch: Record<string, string> = {};
      rows.forEach((row, index) => {
        const empty = !String(row.value ?? "").trim();
        if (row.required && empty) {
          patch[`rows[${index}].error`] = `请填写${row.label}`;
          if (firstError < 0) firstError = index;
        } else {
          patch[`rows[${index}].error`] = "";
        }
      });
      this.setData(patch);
      if (firstError >= 0) return;

      const values: Record<string, string> = {};
      rows.forEach((row) => {
        values[row.name] = String(row.value ?? "").trim();
      });
      this.triggerEvent("submit", values);
    },
  },
});

/** 把外部传进来的字段描述补全成 WXML 直接能用的形状。 */
function buildRows(fields: FormField[]): any[] {
  return (fields ?? []).map((field) => {
    const type = field.type ?? "text";
    return {
      name: field.name,
      label: field.label,
      type,
      value: field.value ?? "",
      placeholder: field.placeholder ?? "",
      required: Boolean(field.required),
      hint: field.hint ?? "",
      maxlength: field.maxlength ?? 200,
      options: field.options ?? [],
      // 小程序 input 的 type 与我们的语义不完全一致，这里做一次映射
      inputType: type === "number" ? "digit" : "text",
      password: type === "password",
      error: "",
    };
  });
}
