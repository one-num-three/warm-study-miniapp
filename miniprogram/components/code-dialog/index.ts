/**
 * 绑定码大字弹层。
 *
 * 新增学员、重置绑定码之后，这串码是老师要抄给家长的唯一凭证 ——
 * 必须一次性、显眼地展示，并且能一键复制，
 * 否则老师就会去数据库或列表里找，那是产品设计的失败。
 */

import { copyText } from "../../utils/ui";

Component({
  options: { addGlobalClass: true },

  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: "绑定码" },
    /** 展示形式，例如 K3M9-QX2T */
    code: { type: String, value: "" },
    body: { type: String, value: "" },
  },

  methods: {
    onCopy(this: any) {
      copyText(this.data.code, `已复制绑定码 ${this.data.code}`);
    },
    onClose(this: any) {
      this.triggerEvent("close");
    },
    noop() {},
  },
});
