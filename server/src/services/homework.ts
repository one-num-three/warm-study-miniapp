/** 作业域：家长提交作业单，老师逐项推进、填反馈、结束当天并发积分。 */

import {
  AppError,
  ERROR_CODES,
  HOMEWORK_ITEM_TRANSITIONS,
  HOMEWORK_TRANSITIONS,
  SETTING_KEYS,
  allItemsSettled,
  checkTransition,
  homeworkRewardKey,
  newId,
  toDateKey,
  type HomeworkItemStatus,
  type HomeworkStatus,
} from "@warm-study/shared";
import { Db, isUniqueViolation, type Row } from "../db.js";
import { mapItem, mapSheet } from "../mappers.js";
import type { AuthInfo, RequestContext } from "../http.js";
import {
  applyLedger,
  assertCanAccessStudent,
  assertStudentActive,
  boundStudentIds,
  getSetting,
  nowIso,
  reverseLedgerEntry,
  writeAudit,
} from "../core.js";
import { actorOf } from "./identity.js";

export interface CreateSheetInput {
  studentId: string;
  dateKey?: string;
  items: Array<{ subject: string; content: string; image?: string }>;
}

export function createSheet(
  db: Db,
  _ctx: RequestContext,
  auth: AuthInfo,
  input: CreateSheetInput,
) {
  assertCanAccessStudent(db, auth, input.studentId);
  assertStudentActive(db, input.studentId);
  if (input.items.length === 0) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "至少填写一项作业");
  }
  const dateKey = input.dateKey ?? toDateKey();
  const now = nowIso();
  const sheetId = newId("hw");

  return db.transaction(() => {
    const existing = db.get<Row>(
      "SELECT * FROM homework_sheets WHERE student_id = ? AND date_key = ? AND status != '已撤回'",
      input.studentId,
      dateKey,
    );
    if (existing) {
      const sheet = mapSheet(existing);
      // 进入辅导后不允许覆盖，只能补充说明或让老师打回
      if (sheet.status !== "待确认" && sheet.status !== "需要补充") {
        throw new AppError(
          ERROR_CODES.INVALID_STATE,
          "今天的作业已经开始辅导了，不能重新提交；如需修改请联系老师",
        );
      }
      // 待确认/需要补充阶段允许追加条目
      for (const item of input.items) {
        db.run(
          `INSERT INTO homework_items (id, sheet_id, subject, content, status, image, updated_at)
           VALUES (?, ?, ?, ?, '待开始', ?, ?)`,
          newId("hwi"),
          sheet.id,
          item.subject.trim(),
          item.content.trim(),
          item.image ?? null,
          now,
        );
      }
      db.run(
        "UPDATE homework_sheets SET status = '待确认', updated_at = ? WHERE id = ?",
        now,
        sheet.id,
      );
      return getSheetDetail(db, sheet.id);
    }

    try {
      db.run(
        `INSERT INTO homework_sheets
          (id, student_id, date_key, status, rewarded, submitted_by, submitted_at, updated_at)
         VALUES (?, ?, ?, '待确认', 0, ?, ?, ?)`,
        sheetId,
        input.studentId,
        dateKey,
        auth.userId,
        now,
        now,
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(ERROR_CODES.DUPLICATE_REQUEST, "今天的作业单已经存在了");
      }
      throw error;
    }
    for (const item of input.items) {
      db.run(
        `INSERT INTO homework_items (id, sheet_id, subject, content, status, image, updated_at)
         VALUES (?, ?, ?, ?, '待开始', ?, ?)`,
        newId("hwi"),
        sheetId,
        item.subject.trim(),
        item.content.trim(),
        item.image ?? null,
        now,
      );
    }
    return getSheetDetail(db, sheetId);
  });
}

export function getSheetDetail(db: Db, sheetId: string) {
  const row = db.get<Row>(
    `SELECT h.*, s.name AS student_name, s.nickname AS student_nickname
     FROM homework_sheets h JOIN students s ON s.id = h.student_id WHERE h.id = ?`,
    sheetId,
  );
  if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, "作业单不存在");
  const items = db
    .all<Row>("SELECT * FROM homework_items WHERE sheet_id = ? ORDER BY rowid ASC", sheetId)
    .map(mapItem);
  return {
    ...mapSheet(row),
    studentName: row.student_name as string,
    studentNickname: row.student_nickname as string,
    items,
  };
}

export function listSheets(
  db: Db,
  auth: AuthInfo,
  filter: { dateKey?: string; studentId?: string; status?: string } = {},
) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!auth.permissions.includes("student.read_all")) {
    const ids = boundStudentIds(db, auth.userId);
    if (ids.length === 0) return [];
    clauses.push(`h.student_id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  if (filter.dateKey) {
    clauses.push("h.date_key = ?");
    params.push(filter.dateKey);
  }
  if (filter.studentId) {
    clauses.push("h.student_id = ?");
    params.push(filter.studentId);
  }
  if (filter.status) {
    clauses.push("h.status = ?");
    params.push(filter.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const sheets = db.all<Row>(
    `SELECT h.*, s.name AS student_name, s.nickname AS student_nickname
     FROM homework_sheets h JOIN students s ON s.id = h.student_id
     ${where} ORDER BY h.date_key DESC, h.updated_at DESC LIMIT 200`,
    ...params,
  );
  if (sheets.length === 0) return [];

  const ids = sheets.map((row) => row.id as string);
  const items = db.all<Row>(
    `SELECT * FROM homework_items WHERE sheet_id IN (${ids.map(() => "?").join(",")}) ORDER BY rowid ASC`,
    ...ids,
  );
  const grouped = new Map<string, ReturnType<typeof mapItem>[]>();
  for (const row of items) {
    const key = row.sheet_id as string;
    const list = grouped.get(key) ?? [];
    list.push(mapItem(row));
    grouped.set(key, list);
  }

  return sheets.map((row) => ({
    ...mapSheet(row),
    studentName: row.student_name as string,
    studentNickname: row.student_nickname as string,
    items: grouped.get(row.id as string) ?? [],
  }));
}

export function transitionSheet(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  sheetId: string,
  to: HomeworkStatus,
  reason?: string,
) {
  const detail = getSheetDetail(db, sheetId);
  const check = checkTransition(HOMEWORK_TRANSITIONS, detail.status, to);
  if (!check.allowed) {
    throw new AppError(
      ERROR_CODES.INVALID_STATE,
      `作业单不能从「${detail.status}」直接变成「${to}」`,
    );
  }
  if (check.requiresCorrectionRight) {
    if (!auth.roles.includes("owner")) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "退回已完成的作业单仅负责人可操作");
    }
    if (!reason) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "纠错操作必须填写原因");
    }
  }
  // 撤回只能由提交人本人做，负责人可以代为撤回（要填原因）。
  // 否则同一个孩子的另一位家长就能把别人交的作业记录抹掉。
  if (to === "已撤回") {
    assertCanAccessStudent(db, auth, detail.studentId);
    const isSubmitter = detail.submittedBy === auth.userId;
    const isOwner = auth.roles.includes("owner");
    if (!isSubmitter && !isOwner) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "只能撤回自己提交的作业单");
    }
    if (!isSubmitter && !reason) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "代他人撤回必须填写原因");
    }
  } else if (!auth.permissions.includes("homework.manage")) {
    throw new AppError(ERROR_CODES.FORBIDDEN);
  }

  const result = db.transaction(() => {
    db.run(
      "UPDATE homework_sheets SET status = ?, updated_at = ? WHERE id = ?",
      to,
      nowIso(),
      sheetId,
    );

    // 纠错退回「辅导中」时，如果之前已经因这张单发过积分，
    // 必须把分冲回去并释放幂等键 —— 否则改完再结一次，积分不会重发，
    // 老师却收到"成功"，孩子的分就凭空少了。
    let reversedReward: string | null = null;
    if (check.requiresCorrectionRight && to === "辅导中" && detail.rewarded) {
      const rewardRow = db.get<Row>(
        "SELECT * FROM point_ledger WHERE idempotency_key = ? AND reversed = 0",
        homeworkRewardKey(sheetId),
      );
      if (rewardRow) {
        const reversal = reverseLedgerEntry(db, {
          ledgerId: rewardRow.id as string,
          operatorId: auth.userId,
          reason: `退回作业单重新辅导：${reason ?? ""}`.trim(),
        });
        reversedReward = reversal.entryId;
        // 幂等键只是防重复的技术手段，不是业务数据；
        // 流水本身完整保留，只把键释放出来让重新结束时能再发一次。
        db.run("UPDATE point_ledger SET idempotency_key = NULL WHERE id = ?", rewardRow.id as string);
      }
      db.run("UPDATE homework_sheets SET rewarded = 0 WHERE id = ?", sheetId);
    }

    if (check.requiresCorrectionRight) {
      writeAudit(db, ctx, actorOf(auth), {
        action: "homework.correct",
        target: `sheet:${sheetId}`,
        before: { status: detail.status, rewarded: detail.rewarded },
        after: { status: to, rewarded: false, reversedRewardLedgerId: reversedReward },
        reason: reason ?? null,
      });
    } else if (to === "已撤回") {
      writeAudit(db, ctx, actorOf(auth), {
        action: "homework.withdraw",
        target: `sheet:${sheetId}`,
        before: { status: detail.status },
        after: { status: to },
        reason: reason ?? null,
      });
    }
    return getSheetDetail(db, sheetId);
  });
  return result;
}

export function updateItemStatus(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  itemId: string,
  to: HomeworkItemStatus,
  reason?: string,
) {
  const row = db.get<Row>("SELECT * FROM homework_items WHERE id = ?", itemId);
  if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, "作业项不存在");
  const item = mapItem(row);
  const check = checkTransition(HOMEWORK_ITEM_TRANSITIONS, item.status, to);
  if (!check.allowed) {
    throw new AppError(ERROR_CODES.INVALID_STATE, `作业项不能从「${item.status}」变成「${to}」`);
  }
  if (check.requiresCorrectionRight && !auth.roles.includes("owner")) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "退回已终结的作业项仅负责人可操作");
  }

  const sheet = getSheetDetail(db, item.sheetId);

  return db.transaction(() => {
    db.run(
      "UPDATE homework_items SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?",
      to,
      auth.userId,
      nowIso(),
      itemId,
    );
    // 第一项开始处理时，整张单自动进入「辅导中」
    if (sheet.status === "待确认" || sheet.status === "需要补充") {
      db.run(
        "UPDATE homework_sheets SET status = '辅导中', updated_at = ? WHERE id = ?",
        nowIso(),
        sheet.id,
      );
    }
    if (check.requiresCorrectionRight) {
      writeAudit(db, ctx, actorOf(auth), {
        action: "homework.item.correct",
        target: `item:${itemId}`,
        before: { status: item.status },
        after: { status: to },
        reason: reason ?? null,
      });
    }
    return getSheetDetail(db, item.sheetId);
  });
}

export interface FinishSheetInput {
  status: Extract<HomeworkStatus, "已完成" | "未完成">;
  feedback: string;
  unfinishedReason?: string;
  rewardPoints?: number;
  requestId: string;
}

/**
 * 结束当天作业：填反馈 → 落状态 → 发积分。
 * 发积分用「作业单 ID」做幂等键，重复点击不会重复发分。
 */
export function finishSheet(
  db: Db,
  _ctx: RequestContext,
  auth: AuthInfo,
  sheetId: string,
  input: FinishSheetInput,
) {
  const sheet = getSheetDetail(db, sheetId);
  if (sheet.status !== "辅导中") {
    throw new AppError(ERROR_CODES.INVALID_STATE, "只有辅导中的作业单可以结束");
  }
  if (!allItemsSettled(sheet.items.map((item) => item.status))) {
    throw new AppError(ERROR_CODES.INVALID_STATE, "还有作业项没有标记完成或未完成");
  }
  if (input.status === "未完成" && !input.unfinishedReason) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "标记未完成必须注明原因");
  }

  const defaultReward = getSetting<number>(db, SETTING_KEYS.HOMEWORK_DEFAULT_REWARD);
  const reward =
    input.rewardPoints !== undefined
      ? input.rewardPoints
      : input.status === "已完成"
        ? defaultReward
        : 0;

  return db.transaction(() => {
    db.run(
      `UPDATE homework_sheets
       SET status = ?, feedback = ?, unfinished_reason = ?, finished_by = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
      input.status,
      input.feedback,
      input.unfinishedReason ?? null,
      auth.userId,
      nowIso(),
      nowIso(),
      sheetId,
    );

    // 积分发放的结果如实回报给调用方，绝不"看起来成功但其实没发"
    const rewardOutcome: RewardOutcome = { requested: reward, applied: 0, skipped: null };

    if (reward > 0) {
      if (!auth.permissions.includes("points.grant")) {
        // 没有发分权限时不阻断结束作业 —— 单子照结，分挂起等负责人补发。
        // 看板上的「已完成未发分」指标就是给这种情况看的。
        rewardOutcome.skipped = "no_permission";
      } else {
        const result = applyLedger(db, {
          studentId: sheet.studentId,
          delta: reward,
          type: "作业奖励",
          reason: `${sheet.dateKey} 作业${input.status}`,
          operatorId: auth.userId,
          sourceRef: `sheet:${sheetId}`,
          idempotencyKey: homeworkRewardKey(sheetId),
        });
        if (result.deduplicated) {
          rewardOutcome.skipped = "already_rewarded";
        } else {
          rewardOutcome.applied = reward;
        }
        db.run("UPDATE homework_sheets SET rewarded = 1 WHERE id = ?", sheetId);
      }
    }

    return { ...getSheetDetail(db, sheetId), reward: rewardOutcome };
  });
}

export interface RewardOutcome {
  /** 本次希望发多少分 */
  requested: number;
  /** 实际发出去多少分 */
  applied: number;
  /**
   * 没发成的原因：
   * - no_permission：操作人没有发放积分权限，已挂起等负责人补发
   * - already_rewarded：这张单之前已经发过分了，没有重复发
   */
  skipped: "no_permission" | "already_rewarded" | null;
}

/** 把发放结果翻译成给老师看的一句话提示。 */
export function describeReward(outcome: RewardOutcome): string {
  if (outcome.applied > 0) return `已发放 ${outcome.applied} 分`;
  if (outcome.skipped === "no_permission") {
    return `本次未发放 ${outcome.requested} 分：你没有发放积分的权限，已记入看板待负责人补发`;
  }
  if (outcome.skipped === "already_rewarded") {
    return "这张作业单之前已经发过积分了，本次没有重复发放";
  }
  return "本次未发放积分";
}
