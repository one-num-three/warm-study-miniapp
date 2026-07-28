/**
 * 商品与库存 —— 对应 h5/src/pages/admin.ts 的 definePage("admin.products")。
 *
 * 老师在这一页真正会做的动作只有三个：补库存、临时下架、改价。
 * 所以"改库存"单独拎出来做成一个只有一格的表单 —— 补货时不该被迫再确认一遍商品名和价格，
 * 那既慢又容易手滑改坏别的字段。完整编辑另走一张表。
 */

import { api, toast, toastError } from "../../../utils/api";
import { PERMISSIONS } from "../../../shared/permissions.js";

/** 商品状态清单，和 H5 保持同一份 */
const STATUSES = ["上架", "下架", "草稿"];

Page({
  data: {
    loading: true,
    error: "",

    products: [] as any[],

    /** 没有 product.manage 的人进来只能看货架，所有写操作入口都不渲染 */
    canManage: false,

    /* -------------------------------- 表单弹层 -------------------------------- */
    formShow: false,
    formTitle: "",
    formHint: "",
    formFields: [] as any[],
    formSubmitText: "保存",
    formAction: "",
    /** 提交时才用得上的上下文：改的是哪个商品（新增时为 null） */
    formPayload: null as any,
  },

  async onLoad() {
    const app = getApp<any>();
    await app.ready();
    this.setData({ canManage: app.can(PERMISSIONS.PRODUCT_MANAGE) });
    await this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const list = await api.get<any[]>("/products");
      this.setData({ products: (list ?? []).map(decorate), loading: false });
    } catch (error: any) {
      this.setData({
        loading: false,
        error: error && error.message ? error.message : "加载失败，请稍后重试",
      });
      toastError(error);
    }
  },

  /* --------------------------------- 新增 / 编辑 --------------------------------- */

  onCreate() {
    this.openUpsertForm(null);
  },

  onEdit(event: any) {
    const product = this.find(event.currentTarget.dataset.id);
    if (product) this.openUpsertForm(product);
  },

  /** 新增和编辑共用一张表：字段完全一样，只有标题和默认值不同 */
  openUpsertForm(product: any) {
    this.setData({
      formShow: true,
      formTitle: product ? `编辑「${product.name}」` : "新增商品",
      formHint: "",
      formSubmitText: "保存",
      formAction: "upsertProduct",
      formPayload: product ? { id: product.id } : null,
      formFields: [
        { name: "name", label: "商品名", required: true, value: product ? product.name : "" },
        {
          name: "description",
          label: "说明",
          value: product ? product.description || "" : "",
        },
        {
          name: "pointsCost",
          label: "积分价格",
          required: true,
          type: "number",
          value: product ? String(product.pointsCost) : "20",
        },
        {
          name: "stock",
          label: "库存",
          required: true,
          type: "number",
          value: product ? String(product.stock) : "10",
        },
        {
          name: "perStudentLimit",
          label: "每人限兑次数（0 = 不限）",
          type: "number",
          value: product ? String(product.perStudentLimit || 0) : "0",
        },
        {
          name: "status",
          label: "状态",
          type: "select",
          value: product ? product.status : "上架",
          options: STATUSES,
        },
      ],
    });
  },

  /* ---------------------------------- 改库存 ---------------------------------- */

  onEditStock(event: any) {
    const product = this.find(event.currentTarget.dataset.id);
    if (!product) return;
    this.setData({
      formShow: true,
      formTitle: `补库存 · ${product.name}`,
      formHint: "",
      formSubmitText: "保存",
      formAction: "updateStock",
      formPayload: { id: product.id },
      formFields: [
        { name: "stock", label: "调整为", type: "number", required: true, value: String(product.stock) },
      ],
    });
  },

  /* --------------------------------- 上架 / 下架 --------------------------------- */

  async onToggleStatus(event: any) {
    const product = this.find(event.currentTarget.dataset.id);
    if (!product) return;
    try {
      // 下架不删数据，只改状态：已经兑出去的记录还要能查到这件商品
      await api.patch(`/products/${product.id}`, {
        status: product.status === "上架" ? "下架" : "上架",
      });
      await this.load();
    } catch (error) {
      toastError(error);
    }
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

    if (action === "upsertProduct") await this.submitUpsert(values, payload);
    else if (action === "updateStock") await this.submitStock(payload, values.stock);
  },

  async submitUpsert(values: any, payload: any) {
    // 表单回传的一律是字符串，价格 / 库存 / 限次都要转回数字再发
    const body = {
      name: values.name,
      description: values.description,
      pointsCost: Number(values.pointsCost),
      stock: Number(values.stock),
      perStudentLimit: Number(values.perStudentLimit || 0),
      status: values.status,
    };
    try {
      if (payload && payload.id) await api.patch(`/products/${payload.id}`, body);
      else await api.post("/products", body);
      toast("已保存", "success");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  async submitStock(payload: any, stock: string) {
    if (!payload) return;
    try {
      await api.patch(`/products/${payload.id}`, { stock: Number(stock) });
      toast("已更新库存", "success");
      await this.load();
    } catch (error) {
      toastError(error);
    }
  },

  /** 列表项已经加工过，按 id 取回原始字段比在 WXML 里传一堆 data- 干净 */
  find(id: string): any {
    return this.data.products.filter((item: any) => item.id === id)[0];
  },
});

/** 把商品加工成 WXML 能直接渲染的形状：配色、摘要文案、按钮文字都在这里定死。 */
function decorate(product: any): any {
  const limitText = product.perStudentLimit > 0 ? ` · 限 ${product.perStudentLimit} 次` : "";
  return {
    ...product,
    tagClass: product.status === "上架" ? "tag" : "tag tag--muted",
    subText: `${product.pointsCost} 分 · 库存 ${product.stock}${limitText}`,
    toggleText: product.status === "上架" ? "下架" : "上架",
  };
}
