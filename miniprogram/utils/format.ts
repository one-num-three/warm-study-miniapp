/**
 * 展示层加工函数。
 *
 * WXML 里不能调用任意函数（只能用有限的 WXS），所以所有"由数据算出来的样式类和文案"
 * 都必须在 setData 之前算好。这个文件就是干这个的，
 * 顺便保证同一种状态在管理端和家长端显示成同一个颜色。
 */

import { compactStamp, toDateKey } from "../shared/datetime.js";

/** 今日的 dateKey（按辅导班时区 UTC+8，服务端也用同一套换算）。 */
export function todayKey(): string {
  return toDateKey();
}

export { compactStamp };

/** 到班状态 → 标签配色。和 h5/src/pages/guardian.ts 的 SESSION_TONE 保持一致。 */
const SESSION_TONE: Record<string, string> = {
  待到班: "tag tag--muted",
  已到班: "tag",
  辅导中: "tag tag--gold",
  待接: "tag tag--accent",
  已接走: "tag",
};

export function sessionTone(status: string): string {
  return SESSION_TONE[status] ?? "tag";
}

/** 作业单状态 → 标签配色。 */
const HOMEWORK_TONE: Record<string, string> = {
  待确认: "tag tag--gold",
  需要补充: "tag tag--accent",
  辅导中: "tag tag--gold",
  已完成: "tag",
  未完成: "tag tag--danger",
  已撤回: "tag tag--muted",
};

export function homeworkTone(status: string): string {
  return HOMEWORK_TONE[status] ?? "tag";
}

/** 错题状态 → 标签配色。 */
const MISTAKE_TONE: Record<string, string> = {
  待订正: "tag tag--accent",
  已订正: "tag tag--gold",
  已掌握: "tag",
};

export function mistakeTone(status: string): string {
  return MISTAKE_TONE[status] ?? "tag";
}

/** 绑定关系状态 → 标签配色。 */
const BINDING_TONE: Record<string, string> = {
  待审核: "tag tag--gold",
  已通过: "tag",
  已拒绝: "tag tag--muted",
  已解除: "tag tag--muted",
};

export function bindingTone(status: string): string {
  return BINDING_TONE[status] ?? "tag";
}

/**
 * 积分流水行加工：算出 +/- 文案、涨跌配色和紧凑时间戳。
 * 被冲正的流水不删除，只加删除线（is-reversed），这是产品的硬要求。
 */
export function decorateLedger(entries: any[]): any[] {
  return (entries ?? []).map((entry) => ({
    ...entry,
    deltaText: `${entry.delta > 0 ? "+" : ""}${entry.delta}`,
    deltaClass: `ledger__delta ${entry.delta > 0 ? "is-plus" : "is-minus"}${
      entry.reversed ? " is-reversed" : ""
    }`,
    titleClass: entry.reversed ? "row__title is-reversed" : "row__title",
    stamp: compactStamp(entry.createdAt),
  }));
}

/** 作业单加工：状态配色 + 科目摘要 + 各项是否都已终结（决定能不能结束作业）。 */
export function decorateSheet(sheet: any): any {
  const items = (sheet.items ?? []).map((item: any) => ({
    ...item,
    content: item.content || "（没有补充说明）",
  }));
  return {
    ...sheet,
    items,
    tone: homeworkTone(sheet.status),
    summary: items.map((item: any) => `${item.subject}（${item.status}）`).join("，"),
    settled:
      items.length > 0 &&
      items.every((item: any) => item.status === "已完成" || item.status === "未完成"),
  };
}

/** 姓名首字，用于头像色块。 */
export function initial(name: string): string {
  return (name || "?").slice(0, 1);
}
