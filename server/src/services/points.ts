/** 积分域：发放、人工调整、冲正、流水查询、排行榜、对账。 */

import {
  AppError,
  ERROR_CODES,
  LEDGER_TYPES,
  SETTING_KEYS,
  aggregatePeriodScores,
  buildLeaderboard,
  monthRange,
  publicDisplayName,
  weekRange,
  type LeaderboardPeriod,
  type LedgerType,
} from "@warm-study/shared";
import { Db, type Row } from "../db.js";
import { mapLedger, mapStudent } from "../mappers.js";
import type { AuthInfo, RequestContext } from "../http.js";
import {
  applyLedger,
  assertCanAccessStudent,
  boundStudentIds,
  getSetting,
  recomputeBalance,
  requireOwner,
  reverseLedgerEntry,
  writeAudit,
} from "../core.js";
import { actorOf } from "./identity.js";

export interface GrantInput {
  studentId: string;
  delta: number;
  type: LedgerType;
  reason: string;
  sourceRef?: string;
  requestId: string;
}

/**
 * 发放/调整积分。
 * - 老师只有 points.grant，只能发正分且类型受限；
 * - 负责人有 points.adjust，可以正负都调，超阈值要显式确认。
 */
export function grantPoints(db: Db, ctx: RequestContext, auth: AuthInfo, input: GrantInput) {
  if (!LEDGER_TYPES.includes(input.type)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "积分类型不合法");
  }
  if (input.type === "兑换扣除" || input.type === "撤销冲正") {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "这两种流水只能由兑换/冲正流程产生");
  }

  const isAdjust = input.type === "人工调整" || input.delta < 0;
  if (isAdjust) {
    if (!auth.permissions.includes("points.adjust")) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "人工调整积分仅负责人可操作");
    }
    const threshold = getSetting<number>(db, SETTING_KEYS.POINTS_ADJUST_THRESHOLD);
    if (Math.abs(input.delta) > threshold && ctx.body.confirmed !== true) {
      throw new AppError(
        ERROR_CODES.INVALID_STATE,
        `单次调整超过 ${threshold} 分，请二次确认`,
        { details: { threshold, requiresConfirm: true } },
      );
    }
  } else if (!auth.permissions.includes("points.grant")) {
    throw new AppError(ERROR_CODES.FORBIDDEN);
  }

  if (!input.reason.trim()) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "发放积分必须写明原因");
  }

  return db.transaction(() => {
    const result = applyLedger(db, {
      studentId: input.studentId,
      delta: input.delta,
      type: input.type,
      reason: input.reason.trim(),
      operatorId: auth.userId,
      sourceRef: input.sourceRef ?? null,
      // 幂等键必须带 studentId：只用 requestId 的话，
      // 同一个 requestId 发给不同孩子会命中前一条流水，
      // 接口返回"成功"和别人的余额，这个孩子实际一分没加。
      idempotencyKey: `GRANT:${input.studentId}:${input.requestId}`,
    });
    if (result.deduplicated) {
      // 如实告诉调用方这次没有产生新流水
      return { ...result, message: "该请求已经处理过了，没有重复发放" };
    }
    if (isAdjust) {
      writeAudit(db, ctx, actorOf(auth), {
        action: "points.adjust",
        target: `student:${input.studentId}`,
        after: { delta: input.delta, balanceAfter: result.balanceAfter },
        reason: input.reason,
      });
    }
    return result;
  });
}

export function reverseLedger(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  input: { ledgerId: string; reason: string },
) {
  requireOwner(ctx);
  if (!input.reason.trim()) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "冲正必须填写原因");
  }
  return db.transaction(() => {
    const before = db.get<Row>("SELECT * FROM point_ledger WHERE id = ?", input.ledgerId);
    // 兑换扣除必须走「撤销兑换」，那条路径会连库存和兑换记录一起回滚。
    // 直接冲正只退分不退货，之后这笔兑换永远撤不掉、库存永久少一件。
    if (before && (before.type as string) === "兑换扣除") {
      throw new AppError(
        ERROR_CODES.INVALID_STATE,
        "这是兑换产生的流水，请到「兑换记录」里撤销兑换，那样积分和库存会一起退回",
      );
    }
    const result = reverseLedgerEntry(db, {
      ledgerId: input.ledgerId,
      operatorId: auth.userId,
      reason: input.reason.trim(),
    });
    writeAudit(db, ctx, actorOf(auth), {
      action: "points.reverse",
      target: `ledger:${input.ledgerId}`,
      before: before ? mapLedger(before) : null,
      after: { reversalLedgerId: result.entryId, balanceAfter: result.balanceAfter },
      reason: input.reason,
    });
    return result;
  });
}

export function listLedger(
  db: Db,
  auth: AuthInfo,
  filter: { studentId?: string; limit?: number } = {},
) {
  const limit = Math.min(filter.limit ?? 100, 500);
  if (filter.studentId) {
    assertCanAccessStudent(db, auth, filter.studentId);
    const entries = db
      .all<Row>(
        "SELECT * FROM point_ledger WHERE student_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
        filter.studentId,
        limit,
      )
      .map(mapLedger);
    const studentRow = db.get<Row>("SELECT * FROM students WHERE id = ?", filter.studentId);
    const balance = studentRow ? mapStudent(studentRow).pointBalance : 0;
    return { entries, balance, computedBalance: recomputeBalance(db, filter.studentId) };
  }

  if (!auth.permissions.includes("student.read_all")) {
    const ids = boundStudentIds(db, auth.userId);
    if (ids.length === 0) return { entries: [], balance: 0, computedBalance: 0 };
    const entries = db
      .all<Row>(
        `SELECT * FROM point_ledger WHERE student_id IN (${ids.map(() => "?").join(",")})
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        ...ids,
        limit,
      )
      .map(mapLedger);
    return { entries, balance: 0, computedBalance: 0 };
  }

  const entries = db
    .all<Row>(
      "SELECT * FROM point_ledger ORDER BY created_at DESC, rowid DESC LIMIT ?",
      limit,
    )
    .map(mapLedger);
  return { entries, balance: 0, computedBalance: 0 };
}

/** 只读对账：把缓存余额和流水汇总逐个比对，有差异只告警不覆盖。 */
export function reconcile(db: Db) {
  const rows = db.all<Row>("SELECT * FROM students");
  const items = rows.map((row) => {
    const student = mapStudent(row);
    const computed = recomputeBalance(db, student.id);
    return {
      studentId: student.id,
      name: student.name,
      cached: student.pointBalance,
      computed,
      diff: student.pointBalance - computed,
    };
  });
  return { checked: items.length, mismatches: items.filter((item) => item.diff !== 0), items };
}

/* ------------------------------- 排行榜 ------------------------------- */

export function leaderboard(
  db: Db,
  auth: AuthInfo,
  period: LeaderboardPeriod,
  limit = 20,
) {
  const range =
    period === "week" ? weekRange() : period === "month" ? monthRange() : null;

  const entries = db.all<Row>("SELECT * FROM point_ledger").map(mapLedger);
  const scores = aggregatePeriodScores(entries, range ?? undefined);

  const students = new Map(
    db.all<Row>("SELECT * FROM students").map((row) => {
      const student = mapStudent(row);
      return [student.id, student] as const;
    }),
  );

  const isManagement = auth.permissions.includes("student.read_all");
  const showRealName =
    isManagement || getSetting<boolean>(db, SETTING_KEYS.LEADERBOARD_SHOW_REAL_NAME);
  const selfIds = isManagement ? [] : boundStudentIds(db, auth.userId);

  const rows = buildLeaderboard(scores, {
    displayNameOf: (studentId) => {
      const student = students.get(studentId);
      if (!student) return "未知学员";
      return showRealName ? student.name : publicDisplayName(student.nickname, student.name);
    },
    isPublic: (studentId) => {
      const student = students.get(studentId);
      if (!student || student.status !== "active") return false;
      // 管理端要看到全部，家长端只看愿意公开的
      return isManagement ? true : student.publicRanking;
    },
    selfStudentIds: selfIds,
    limit,
  });

  return { period, range, rows };
}
