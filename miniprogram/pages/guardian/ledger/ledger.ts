/**
 * 积分流水 —— 孩子的每一分是怎么来的、怎么花的，一笔一笔摊开给家长看。
 *
 * 这一页的关键是「账目一致」那个标签：余额不是一个可以被谁改一改的数字，
 * 而是所有流水累加出来的。服务端顺手回了一个重算值，两者对不上就当场标红，
 * 家长不用懂原理，也能看出「这笔账有人动过手脚」。
 */

import { api, toastError } from "../../../utils/api";
import { decorateLedger } from "../../../utils/format";

Page({
  data: {
    loading: true,
    error: "",
    /** 一个孩子都没绑时不发请求，直接给空态 */
    noStudent: false,
    /** 卡片标题：小满 当前 128 分 */
    headText: "",
    /** 对账结果标签 */
    checkClass: "tag",
    checkText: "",
    /** decorateLedger 加工过的流水：deltaText / deltaClass / titleClass / stamp 都算好了 */
    entries: [] as any[],
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
      // 200 条足够覆盖一个学期，再多家长也不会往下翻
      const ledger = await api.get<any>("/points/ledger", { studentId: student.id, limit: 200 });
      const balanced = ledger.balance === ledger.computedBalance;
      this.setData({
        noStudent: false,
        headText: `${student.name} 当前 ${ledger.balance} 分`,
        checkClass: balanced ? "tag" : "tag tag--danger",
        checkText: balanced ? "账目一致" : "账目异常",
        entries: decorateLedger(ledger.entries),
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
