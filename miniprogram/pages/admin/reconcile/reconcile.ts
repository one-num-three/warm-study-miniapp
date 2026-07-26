/**
 * 积分对账 —— 对应 h5/src/pages/admin.ts 的 definePage("admin.reconcile")。
 *
 * 整页只读，而且刻意不提供"一键修正"：
 * 缓存余额和流水重算结果对不上，说明某个地方的写入逻辑有问题，
 * 这时候把缓存悄悄改成流水值只会掩盖 bug，还会让审计链断掉。
 * 所以这里只负责把差异摆出来，怎么处理由人来决定。
 *
 * 服务端要求 owner 才能读，老师进来会拿到 FORBIDDEN，由 error-box 如实显示。
 */

import { api, toastError } from "../../../utils/api";

Page({
  data: {
    loading: true,
    error: "",

    checkedText: "",
    summaryTagClass: "tag",
    summaryTagText: "",
    mismatches: [] as any[],
    items: [] as any[],
  },

  async onLoad() {
    await getApp<any>().ready();
    await this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await api.get<any>("/points/reconcile");
      const mismatches = result.mismatches ?? [];
      const items = result.items ?? [];
      const balanced = mismatches.length === 0;

      this.setData({
        checkedText: `已核对 ${result.checked} 名学员`,
        summaryTagClass: balanced ? "tag" : "tag tag--danger",
        summaryTagText: balanced ? "全部一致" : `${mismatches.length} 处不一致`,
        mismatches: mismatches.map((item: any) => ({
          ...item,
          subText: `缓存 ${item.cached} · 流水 ${item.computed}`,
          // 差值要带符号：+ 表示缓存比流水多发了，- 表示少发了，方向决定怎么查
          diffText: `${item.diff > 0 ? "+" : ""}${item.diff}`,
        })),
        items: items.map((item: any) => ({ ...item, computedText: String(item.computed) })),
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
});
