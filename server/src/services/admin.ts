/** 管理域：今日看板、老师账号、审计日志、系统设置。 */

import {
  AppError,
  ALL_PERMISSIONS,
  ERROR_CODES,
  OWNER_ONLY_PERMISSIONS,
  SESSION_STATUSES,
  SETTING_KEYS,
  toDateKey,
  type DashboardSummary,
  type Permission,
  type Role,
  type SessionStatus,
} from "@warm-study/shared";
import { Db, fromJson, toJson, type Row } from "../db.js";
import { mapAudit, mapUser } from "../mappers.js";
import type { AuthInfo, RequestContext } from "../http.js";
import { allSettings, getSetting, nowIso, setSetting, writeAudit } from "../core.js";
import {
  actorOf,
  assertNotLastOwner,
  createStaffUser,
  effectivePermissions,
} from "./identity.js";
import { hashPassword } from "../auth.js";
import { listTodayStudents } from "./sessions.js";

/** 今日看板：requirements §5 要求的全部指标一次算齐。 */
export function dashboard(db: Db, dateKey = toDateKey()): DashboardSummary {
  const rows = listTodayStudents(db, dateKey);

  const sessionCounts = Object.fromEntries(
    SESSION_STATUSES.map((status) => [status, 0]),
  ) as Record<SessionStatus, number>;
  for (const row of rows) sessionCounts[row.session.status] += 1;

  let notSubmitted = 0;
  let pending = 0;
  let inProgress = 0;
  let finished = 0;
  let finishedButUnrewarded = 0;
  for (const row of rows) {
    if (!row.sheet) {
      notSubmitted += 1;
      continue;
    }
    if (row.sheet.status === "待确认" || row.sheet.status === "需要补充") pending += 1;
    else if (row.sheet.status === "辅导中") inProgress += 1;
    else if (row.sheet.status === "已完成" || row.sheet.status === "未完成") {
      finished += 1;
      // 只有「已完成」才可能欠着积分；「未完成」本来就不发分，
      // 把它算进来会让告警数字永远降不下去，变成纯噪声
      if (row.sheet.status === "已完成" && !row.sheet.rewarded) finishedButUnrewarded += 1;
    }
  }

  const remindedNotPickedUp = Number(
    db.get<Row>(
      `SELECT COUNT(DISTINCT r.student_id) AS total
       FROM pickup_reminders r
       JOIN daily_sessions s ON s.id = r.session_id
       WHERE s.date_key = ? AND s.status != '已接走'`,
      dateKey,
    )?.total ?? 0,
  );

  const pendingBindings = Number(
    db.get<Row>("SELECT COUNT(*) AS total FROM student_guardians WHERE status = '待审核'")
      ?.total ?? 0,
  );

  const lowStockThreshold = getSetting<number>(db, SETTING_KEYS.LOW_STOCK_THRESHOLD);
  const lowStockProducts = Number(
    db.get<Row>(
      "SELECT COUNT(*) AS total FROM products WHERE status = '上架' AND stock <= ?",
      lowStockThreshold,
    )?.total ?? 0,
  );

  return {
    dateKey,
    sessionCounts,
    homework: { notSubmitted, pending, inProgress, finished, finishedButUnrewarded },
    remindedNotPickedUp,
    pendingBindings,
    lowStockProducts,
  };
}

/* ------------------------------ 老师账号 ------------------------------ */

export function listStaff(db: Db) {
  return db
    .all<Row>(
      "SELECT * FROM users WHERE roles LIKE '%owner%' OR roles LIKE '%staff%' ORDER BY created_at ASC",
    )
    .map((row) => ({
      ...mapUser(row),
      username: (row.username as string | null) ?? null,
      permissions: effectivePermissions(row),
    }));
}

export function createStaff(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  input: {
    username: string;
    password: string;
    displayName: string;
    permissions?: string[];
    grantedByOwner?: boolean;
  },
) {
  const permissions = normalizePermissions(input.permissions, input.grantedByOwner ?? false);
  const id = createStaffUser(db, {
    username: input.username,
    password: input.password,
    displayName: input.displayName,
    roles: ["staff"],
    permissions,
  });
  writeAudit(db, ctx, actorOf(auth), {
    action: "staff.create",
    target: `user:${id}`,
    after: { username: input.username, displayName: input.displayName, permissions },
  });
  return { id };
}

export function updateStaff(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  userId: string,
  input: {
    displayName?: string;
    permissions?: string[];
    status?: "active" | "disabled";
    roles?: Role[];
    password?: string;
    grantedByOwner?: boolean;
  },
) {
  const row = db.get<Row>("SELECT * FROM users WHERE id = ?", userId);
  if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, "账号不存在");
  const before = mapUser(row);

  // 系统硬约束：最后一名有效负责人不能被停用或降权
  const losingOwner =
    (input.status === "disabled" && before.roles.includes("owner")) ||
    (input.roles !== undefined && before.roles.includes("owner") && !input.roles.includes("owner"));
  if (losingOwner) assertNotLastOwner(db, userId);

  const fields: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    params.push(value);
  };
  if (input.displayName !== undefined) set("display_name", input.displayName.trim());
  if (input.permissions !== undefined)
    set("permissions", toJson(normalizePermissions(input.permissions, input.grantedByOwner ?? false)));
  if (input.status !== undefined) set("status", input.status);
  if (input.roles !== undefined) set("roles", toJson(input.roles));
  if (input.password) set("password_hash", hashPassword(input.password));
  if (fields.length === 0) return { id: userId };

  set("updated_at", nowIso());
  params.push(userId);
  db.run(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, ...params);

  // 账号被停用 → 立刻踢掉所有在线会话，写能力当场消失
  if (input.status === "disabled") {
    db.run("DELETE FROM auth_sessions WHERE user_id = ?", userId);
  }

  const after = mapUser(db.get<Row>("SELECT * FROM users WHERE id = ?", userId)!);
  writeAudit(db, ctx, actorOf(auth), {
    action: "staff.update",
    target: `user:${userId}`,
    before: { roles: before.roles, status: before.status },
    after: { roles: after.roles, status: after.status },
  });
  return { id: userId };
}

/**
 * 过滤要授予的权限。
 *
 * 只按 ALL_PERMISSIONS 过滤是不够的：一个拿到 staff.manage 的老师
 * 能把 staff.manage / points.adjust / audit.read 这些负责人专属权限
 * 授给别人（或自己），一步完成提权。所以非负责人调用时把这些剔掉。
 */
function normalizePermissions(input?: string[], grantedByOwner = true): Permission[] | null {
  if (!input) return null;
  const allowed = new Set<string>(ALL_PERMISSIONS);
  const ownerOnly = new Set<string>(OWNER_ONLY_PERMISSIONS);
  return input.filter(
    (permission) => allowed.has(permission) && (grantedByOwner || !ownerOnly.has(permission)),
  ) as Permission[];
}

/** 目标账号是不是负责人。用于"只有负责人能改负责人账号"的判断。 */
export function isOwnerAccount(db: Db, userId: string): boolean {
  const row = db.get<Row>("SELECT roles FROM users WHERE id = ?", userId);
  if (!row) return false;
  return fromJson<Role[]>(row.roles, []).includes("owner");
}

/* ------------------------------ 审计 & 设置 ------------------------------ */

export function listAudit(db: Db, filter: { action?: string; limit?: number } = {}) {
  const limit = Math.min(filter.limit ?? 100, 500);
  if (filter.action) {
    return db
      .all<Row>(
        "SELECT * FROM audit_logs WHERE action = ? ORDER BY created_at DESC LIMIT ?",
        filter.action,
        limit,
      )
      .map(mapAudit);
  }
  return db
    .all<Row>("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?", limit)
    .map(mapAudit);
}

export function getSettings(db: Db) {
  return allSettings(db);
}

/**
 * 每个设置项的校验规则。
 *
 * 少了这层校验会出人命：把「作业完成默认奖励」填成 1.5，
 * applyLedger 会抛"积分变动必须是非零整数"→ 整个 finishSheet 事务回滚 →
 * 全班的作业单都结不掉，而老师看到的错误提示和设置毫无关系。
 */
const SETTING_RULES: Record<string, (value: unknown) => unknown> = {
  [SETTING_KEYS.BINDING_REQUIRES_REVIEW]: (value) => {
    if (typeof value !== "boolean") {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "「绑定码需要人工审核」只能是开或关");
    }
    return value;
  },
  [SETTING_KEYS.LEADERBOARD_SHOW_REAL_NAME]: (value) => {
    if (typeof value !== "boolean") {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "「排行显示真实姓名」只能是开或关");
    }
    return value;
  },
  [SETTING_KEYS.HOMEWORK_DEFAULT_REWARD]: (value) => requireSettingInt(value, "作业完成默认奖励", 0, 500),
  [SETTING_KEYS.POINTS_ADJUST_THRESHOLD]: (value) => requireSettingInt(value, "大额调整阈值", 1, 10_000),
  [SETTING_KEYS.LOW_STOCK_THRESHOLD]: (value) => requireSettingInt(value, "库存告警线", 0, 1_000),
};

function requireSettingInt(value: unknown, label: string, min: number, max: number): number {
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num) || !Number.isInteger(num)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `「${label}」必须是整数`);
  }
  if (num < min || num > max) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `「${label}」应在 ${min} 到 ${max} 之间`);
  }
  return num;
}

export function updateSettings(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  patch: Record<string, unknown>,
) {
  const known = new Set<string>(Object.values(SETTING_KEYS));
  const before = allSettings(db);
  const applied: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!known.has(key)) continue;
    const rule = SETTING_RULES[key];
    const normalized = rule ? rule(value) : value;
    setSetting(db, key, normalized, auth.userId);
    applied[key] = normalized;
  }
  if (Object.keys(applied).length > 0) {
    writeAudit(db, ctx, actorOf(auth), {
      action: "settings.update",
      target: "system",
      before,
      after: applied,
    });
  }
  return allSettings(db);
}

/** 兼容旧数据：把 users.roles 里可能出现的字符串解析回数组。 */
export function rolesOf(row: Row): Role[] {
  return fromJson<Role[]>(row.roles, ["guardian"]);
}
