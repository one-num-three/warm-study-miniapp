/**
 * 服务层公共设施：权限校验、审计、设置、积分账本写入。
 *
 * 积分只能通过 applyLedger 变动 —— 这是"余额是流水汇总结果"这条铁律的落地方式：
 * 任何地方都不允许直接 UPDATE students.point_balance。
 */

import {
  AppError,
  DEFAULT_SETTINGS,
  ERROR_CODES,
  newId,
  type LedgerType,
  type Permission,
} from "@warm-study/shared";
import { Db, fromBool, isUniqueViolation, toJson, type Row } from "./db.js";
import { mapLedger, mapStudent } from "./mappers.js";
import type { AuthInfo, RequestContext } from "./http.js";

export interface Actor {
  userId: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 取出已登录用户，未登录直接抛 401。 */
export function requireAuth(ctx: RequestContext): AuthInfo {
  if (!ctx.auth) throw new AppError(ERROR_CODES.UNAUTHENTICATED);
  if (ctx.auth.status !== "active") {
    throw new AppError(ERROR_CODES.FORBIDDEN, "账号已被停用，请联系负责人");
  }
  return ctx.auth;
}

/** 校验权限，缺权限抛 403。老师被停用后立刻失去写能力就是靠这里。 */
export function requirePermission(ctx: RequestContext, permission: Permission): AuthInfo {
  const auth = requireAuth(ctx);
  if (!auth.permissions.includes(permission)) {
    throw new AppError(ERROR_CODES.FORBIDDEN);
  }
  return auth;
}

export function requireOwner(ctx: RequestContext): AuthInfo {
  const auth = requireAuth(ctx);
  if (!auth.roles.includes("owner")) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "该操作仅负责人可执行");
  }
  return auth;
}

/* -------------------------------- 系统设置 -------------------------------- */

export function getSetting<T>(db: Db, key: string): T {
  const row = db.get<Row>("SELECT value FROM system_settings WHERE key = ?", key);
  if (!row) return DEFAULT_SETTINGS[key] as T;
  try {
    return JSON.parse(row.value as string) as T;
  } catch {
    return DEFAULT_SETTINGS[key] as T;
  }
}

export function setSetting(db: Db, key: string, value: unknown, updatedBy: string): void {
  db.run(
    `INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    key,
    toJson(value),
    updatedBy,
    nowIso(),
  );
}

export function allSettings(db: Db): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of db.all<Row>("SELECT key, value FROM system_settings")) {
    try {
      merged[row.key as string] = JSON.parse(row.value as string);
    } catch {
      /* 坏值忽略，用默认值 */
    }
  }
  return merged;
}

/* --------------------------------- 审计 --------------------------------- */

export interface AuditInput {
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** 敏感操作写审计。审计只增不删，任何角色都没有删除入口。 */
export function writeAudit(db: Db, ctx: RequestContext, actor: Actor, input: AuditInput): void {
  db.run(
    `INSERT INTO audit_logs (id, actor_id, actor_name, action, target, before, after, reason, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId("aud"),
    actor.userId,
    actor.displayName,
    input.action,
    input.target,
    input.before === undefined ? null : toJson(input.before),
    input.after === undefined ? null : toJson(input.after),
    input.reason ?? null,
    ctx.requestId,
    nowIso(),
  );
}

/* ------------------------------- 积分账本 ------------------------------- */

export interface LedgerInput {
  studentId: string;
  delta: number;
  type: LedgerType;
  reason: string;
  operatorId: string;
  sourceRef?: string | null;
  reversalOf?: string | null;
  idempotencyKey?: string | null;
  /** 允许余额为负？永远为 false，留参数只是让意图显式 */
  allowNegative?: boolean;
  /**
   * 允许对已停用的学员写流水。
   * 只有冲正/纠错路径该传 true —— 负责人要能修正历史，
   * 但正常的发分、兑换、作业奖励都必须对停用学员关门。
   */
  allowInactiveStudent?: boolean;
}

export interface LedgerResult {
  entryId: string;
  balanceAfter: number;
  /** 命中幂等键，说明这次是重复请求，没有产生新流水 */
  deduplicated: boolean;
}

/**
 * 写一条积分流水并同步余额缓存。**必须在事务里调用。**
 *
 * - 余额从 students.point_balance 读，但真值以流水为准，写入时把新余额快照进流水；
 * - 扣分后余额为负直接拒绝；
 * - 带幂等键时重复调用只返回首次结果，不会重复扣加。
 */
export function applyLedger(db: Db, input: LedgerInput): LedgerResult {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "积分变动必须是非零整数");
  }

  if (input.idempotencyKey) {
    const existing = db.get<Row>(
      "SELECT * FROM point_ledger WHERE idempotency_key = ?",
      input.idempotencyKey,
    );
    if (existing) {
      const entry = mapLedger(existing);
      return { entryId: entry.id, balanceAfter: entry.balanceAfter, deduplicated: true };
    }
  }

  const studentRow = db.get<Row>("SELECT * FROM students WHERE id = ?", input.studentId);
  if (!studentRow) throw new AppError(ERROR_CODES.NOT_FOUND, "学生不存在");
  const student = mapStudent(studentRow);

  // 停用的学员不该再有新的积分变动。这道关卡放在账本入口，
  // 发分、作业奖励、兑换扣分全都会经过这里，不用每个调用点各写一遍。
  if (student.status !== "active" && !input.allowInactiveStudent) {
    throw new AppError(ERROR_CODES.INVALID_STATE, "该学员已停用，不能再变动积分");
  }

  const balanceAfter = student.pointBalance + input.delta;
  if (balanceAfter < 0 && !input.allowNegative) {
    throw new AppError(ERROR_CODES.INSUFFICIENT_POINTS, undefined, {
      details: { balance: student.pointBalance, required: Math.abs(input.delta) },
    });
  }

  const entryId = newId("led");
  try {
    db.run(
      `INSERT INTO point_ledger
        (id, student_id, delta, type, reason, source_ref, balance_after, operator_id, reversed, reversal_of, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      entryId,
      input.studentId,
      input.delta,
      input.type,
      input.reason,
      input.sourceRef ?? null,
      balanceAfter,
      input.operatorId,
      input.reversalOf ?? null,
      input.idempotencyKey ?? null,
      nowIso(),
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      // 并发下另一个请求先写成功了：按幂等处理，不重复扣加
      if (input.idempotencyKey) {
        const existing = db.get<Row>(
          "SELECT * FROM point_ledger WHERE idempotency_key = ?",
          input.idempotencyKey,
        );
        if (existing) {
          const entry = mapLedger(existing);
          return { entryId: entry.id, balanceAfter: entry.balanceAfter, deduplicated: true };
        }
      }
      if (input.reversalOf) {
        throw new AppError(ERROR_CODES.DUPLICATE_REQUEST, "这条流水已经被冲正过了");
      }
    }
    throw error;
  }

  db.run(
    "UPDATE students SET point_balance = ?, updated_at = ? WHERE id = ?",
    balanceAfter,
    nowIso(),
    input.studentId,
  );

  return { entryId, balanceAfter, deduplicated: false };
}

/** 冲正一条流水：原流水标记 reversed，同时写一条反向流水。 */
export function reverseLedgerEntry(
  db: Db,
  options: { ledgerId: string; operatorId: string; reason: string; type?: LedgerType },
): LedgerResult {
  const row = db.get<Row>("SELECT * FROM point_ledger WHERE id = ?", options.ledgerId);
  if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, "流水不存在");
  const entry = mapLedger(row);
  if (entry.reversed) {
    throw new AppError(ERROR_CODES.DUPLICATE_REQUEST, "这条流水已经被冲正过了");
  }
  if (entry.type === "撤销冲正") {
    throw new AppError(ERROR_CODES.INVALID_STATE, "冲正流水本身不能再被冲正");
  }

  const result = applyLedger(db, {
    studentId: entry.studentId,
    delta: -entry.delta,
    type: options.type ?? "撤销冲正",
    reason: options.reason,
    operatorId: options.operatorId,
    sourceRef: entry.sourceRef ?? null,
    reversalOf: entry.id,
    // 冲正一笔"发出去的分"时，孩子可能已经把分花掉了，
    // 硬扣会让余额为负 —— 这里仍然拒绝，让负责人先补分或改用人工调整。
    allowNegative: false,
    // 学员停用后，负责人仍然要能纠正历史上的错账
    allowInactiveStudent: true,
  });

  db.run("UPDATE point_ledger SET reversed = 1 WHERE id = ?", entry.id);
  return result;
}

/** 从流水重算余额，用于只读对账（绝不自动覆盖缓存值）。 */
export function recomputeBalance(db: Db, studentId: string): number {
  const row = db.get<Row>(
    "SELECT COALESCE(SUM(delta), 0) AS total FROM point_ledger WHERE student_id = ?",
    studentId,
  );
  return Number(row?.total ?? 0);
}

/* ------------------------------- 通用查询 ------------------------------- */

export function findStudentOrThrow(db: Db, studentId: string) {
  const row = db.get<Row>("SELECT * FROM students WHERE id = ?", studentId);
  if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, "学生不存在");
  return mapStudent(row);
}

/**
 * 停用的学员不接受任何新的业务写入 —— 交作业、改到班状态、发提醒都拦掉。
 * 历史数据全部保留，只是不再产生新记录。
 */
export function assertStudentActive(db: Db, studentId: string) {
  const student = findStudentOrThrow(db, studentId);
  if (student.status !== "active") {
    throw new AppError(ERROR_CODES.INVALID_STATE, "该学员已停用，请联系负责人");
  }
  return student;
}

/** 家长只能看自己已绑定的孩子；管理端有 student.read_all 就能看全部。 */
export function assertCanAccessStudent(db: Db, auth: AuthInfo, studentId: string): void {
  if (auth.permissions.includes("student.read_all")) return;
  const row = db.get<Row>(
    `SELECT id FROM student_guardians
     WHERE student_id = ? AND guardian_user_id = ? AND status = '已通过'`,
    studentId,
    auth.userId,
  );
  if (!row) throw new AppError(ERROR_CODES.FORBIDDEN, "你还没有绑定这个孩子");
}

/** 当前家长已通过审核的孩子 ID 列表。 */
export function boundStudentIds(db: Db, userId: string): string[] {
  return db
    .all<Row>(
      `SELECT student_id FROM student_guardians
       WHERE guardian_user_id = ? AND status = '已通过'`,
      userId,
    )
    .map((row) => row.student_id as string);
}

export function boolToDb(value: boolean | undefined, fallback: boolean): number {
  return fromBool(value === undefined ? fallback : value);
}
