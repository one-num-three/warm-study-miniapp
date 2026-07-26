/**
 * 现场兑换 —— 对应 h5/src/pages/admin.ts 的 definePage("admin.redeem")。
 *
 * 使用场景是柜台前的十秒钟：孩子指着货架说要哪个，老师点一下就得完事。
 * 所以这一页只回答两件事 —— 他还剩多少分、这件东西够不够换，
 * 其余判断（够不够分、有没有库存、能不能按）全部在 load 时算好写进 data，
 * 让 WXML 只负责照着渲染，避免柜台前还要等页面想事情。
 *
 * 这是普通页面（从学员详情跳进来），不带 tab-bar。
 */

import { api, toast, toastError } from "../../../utils/api";
import { confirmDialog } from "../../../utils/ui";
import { newRequestId } from "../../../shared/id.js";
import { PERMISSIONS } from "../../../shared/permissions.js";

Page({
  data: {
    loading: true,
    error: "",
    studentId: "",

    /** 学员抬头：姓名 + 当前余额，兑换前老师要拿它和孩子本人对一次 */
    studentName: "",
    balanceText: "",

    /** 只有上架商品会进这个列表，每项都带算好的按钮状态 */
    products: [] as any[],

    /** 没有 redemption.create 的人进来只能看，所有兑换按钮都不渲染 */
    canRedeem: false,
  },

  async onLoad(query: any) {
    const app = getApp<any>();
    await app.ready();
    this.setData({
      studentId: (query && query.id) || "",
      canRedeem: app.can(PERMISSIONS.REDEMPTION_CREATE),
    });
    await this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      // 余额和商品必须是同一时刻的快照，否则会出现"看着够分、点下去不够"
      const [detail, products] = await Promise.all([
        api.get<any>(`/students/${this.data.studentId}`),
        api.get<any[]>("/products"),
      ]);

      const balance = detail.pointBalance;
      const onSale = (products ?? [])
        .filter((product: any) => product.status === "上架")
        .map((product: any) => decorate(product, balance, detail.name));

      this.setData({
        studentName: detail.name,
        balanceText: `${balance} 分`,
        products: onSale,
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

  /* --------------------------------- 兑换动作 --------------------------------- */

  async onRedeem(event: any) {
    const productId = event.currentTarget.dataset.id;
    const product = this.data.products.filter((item: any) => item.id === productId)[0];
    // 兑不了的按钮是灰的但仍能点（view 没有 disabled），这里兜住
    if (!product || !product.affordable) return;

    const yes = await confirmDialog({ title: product.confirmTitle, body: product.confirmBody });
    if (!yes) return;

    try {
      const result = await api.post<any>("/redemptions", {
        studentId: this.data.studentId,
        productId,
        requestId: newRequestId(),
      });
      // 直接报出服务端算的余额：老师当场就能对着孩子说"你还剩多少"。
      // 不带 success 图标：带图标的 toast 标题只显示 7 个汉字，余额会被截掉
      toast(`兑换成功，余额 ${result.balanceAfter} 分`);
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },
});

/**
 * 把商品加工成 WXML 能直接渲染的形状。
 * 按钮的可用性、文案、配色都在这里定死 —— WXML 里不能调用函数，也不该做业务判断。
 */
function decorate(product: any, balance: number, studentName: string): any {
  const affordable = balance >= product.pointsCost && product.stock > 0;
  return {
    ...product,
    description: product.description || "",
    stockTagClass: product.stock > 0 ? "tag" : "tag tag--muted",
    stockText: `库存 ${product.stock}`,
    costText: `${product.pointsCost} 分`,
    affordable,
    // 不可兑时按钮压暗而不是隐藏：让老师看见"这件是因为分不够/兑完了"，而不是东西凭空消失
    btnClass: affordable ? "btn btn--sm btn--primary" : "btn btn--sm is-disabled",
    btnText: product.stock <= 0 ? "已兑完" : affordable ? "兑换" : "积分不够",
    confirmTitle: `兑换「${product.name}」？`,
    confirmBody: `将扣除 ${studentName} 的 ${product.pointsCost} 分。`,
  };
}
