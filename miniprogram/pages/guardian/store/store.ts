/**
 * 积分商城 —— 家长和孩子一起看「攒的分能换什么」。
 *
 * 这一页刻意只读：兑换必须到辅导班现场找老师办，家长端一个「立即兑换」按钮都不给。
 * 原因很实在 —— 自助扣分一旦误触就得走冲正流程，而孩子看着余额掉了是会当真哭的。
 */

import { api, toastError } from "../../../utils/api";
import { compactStamp } from "../../../utils/format";

Page({
  data: {
    loading: true,
    error: "",
    noStudent: false,
    /** 卡片标题：小满 现有 128 分 */
    headText: "",
    /** 商品：库存标签、单价文案、限购文案都在 load 里算好 */
    products: [] as any[],
    /** 兑换记录：已撤销的划掉但保留 */
    records: [] as any[],
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
      // 三个接口互不依赖，并行拉，别让家长等三次往返
      const [products, redemptions, ledger] = await Promise.all([
        api.get<any>("/products"),
        api.get<any>("/redemptions", { studentId: student.id }),
        api.get<any>("/points/ledger", { studentId: student.id, limit: 1 }),
      ]);

      this.setData({
        noStudent: false,
        headText: `${student.name} 现有 ${ledger.balance} 分`,
        products: (products || []).map((product: any) => ({
          ...product,
          description: product.description || "",
          stockClass: product.stock > 0 ? "tag" : "tag tag--muted",
          stockText: product.stock > 0 ? `库存 ${product.stock}` : "已兑完",
          costText: `${product.pointsCost} 分`,
          // 不限次的商品不显示限购标签，省得家长以为哪里有门槛
          limitText: product.perStudentLimit > 0 ? `每人限 ${product.perStudentLimit} 次` : "",
        })),
        records: (redemptions || []).map((item: any) => {
          const reversed = item.status === "已撤销";
          return {
            ...item,
            productName: item.productSnapshot ? item.productSnapshot.name : "",
            titleClass: reversed ? "row__title is-reversed" : "row__title",
            stamp: compactStamp(item.createdAt),
            tagClass: reversed ? "tag tag--muted" : "tag tag--accent",
            tagText: reversed ? "已撤销" : `-${item.pointsCost}`,
          };
        }),
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
