/**
 * 审计日志 —— 对应 h5/src/pages/admin.ts 的 definePage("admin.audit")。
 *
 * 整页只读，刻意不提供任何筛选、编辑、删除入口：
 * 日志能被谁改一次，它作为"追责依据"的价值就归零了。
 * 界面上没有删除按钮，服务端也没有对应接口，这是产品的硬约束而不是没来得及做。
 */

import { api, toastError } from "../../../utils/api";
import { compactStamp } from "../../../utils/format";

/** 一次拉 100 条。再往前翻的需求由后台导出承担，不在小程序里做分页。 */
const LIMIT = 100;

Page({
  data: {
    loading: true,
    error: "",
    logs: [] as any[],
  },

  async onLoad() {
    await getApp<any>().ready();
    await this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const list = await api.get<any[]>("/audit", { limit: LIMIT });
      this.setData({
        logs: (list ?? []).map((log: any) => ({
          ...log,
          titleText: `${log.actorName} · ${log.action}`,
          // 原因是可选的，有就跟在对象后面，别留一个孤零零的分隔符
          subText: log.reason ? `${log.target} · ${log.reason}` : log.target,
          stamp: compactStamp(log.createdAt),
        })),
        loading: false,
      });
    } catch (error: any) {
      // 没有 audit.read 的老师会拿到 FORBIDDEN，原话显示出来
      this.setData({
        loading: false,
        error: error && error.message ? error.message : "加载失败，请稍后重试",
      });
      toastError(error);
    }
  },
});
