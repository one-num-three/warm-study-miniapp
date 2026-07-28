/** 今日到班状态 + 接娃提醒。 */

import {
  AppError,
  ERROR_CODES,
  SESSION_TRANSITIONS,
  checkTransition,
  etaAfterMinutes,
  etaCrossesMidnight,
  isValidTimeLabel,
  newId,
  toDateKey,
  type SessionStatus,
} from "@warm-study/shared";
import { Db, isUniqueViolation, type Row } from "../db.js";
import { mapReminder, mapSession, mapSheet } from "../mappers.js";
import type { AuthInfo, RequestContext } from "../http.js";
import {
  assertCanAccessStudent,
  assertStudentActive,
  boundStudentIds,
  nowIso,
  writeAudit,
} from "../core.js";
import { actorOf } from "./identity.js";

/** 取当天的辅导记录，没有就现建一条「待到班」。每生每天唯一。 */
export function ensureSession(db: Db, studentId: string, dateKey: string) {
  const existing = db.get<Row>(
    "SELECT * FROM daily_sessions WHERE student_id = ? AND date_key = ?",
    studentId,
    dateKey,
  );
  if (existing) return mapSession(existing);

  const id = newId("ses");
  try {
    db.run(
      `INSERT INTO daily_sessions (id, student_id, date_key, status, updated_at)
       VALUES (?, ?, ?, '待到班', ?)`,
      id,
      studentId,
      dateKey,
      nowIso(),
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  return mapSession(
    db.get<Row>(
      "SELECT * FROM daily_sessions WHERE student_id = ? AND date_key = ?",
      studentId,
      dateKey,
    )!,
  );
}

/** 只读地取当天记录，没有就返回 undefined（不写库）。 */
function readSession(db: Db, studentId: string, dateKey: string) {
  const row = db.get<Row>(
    "SELECT * FROM daily_sessions WHERE student_id = ? AND date_key = ?",
    studentId,
    dateKey,
  );
  return row ? mapSession(row) : undefined;
}

/** 还没有记录时展示用的默认状态，不落库。 */
function defaultSession(studentId: string, dateKey: string) {
  return {
    id: `virtual:${studentId}:${dateKey}`,
    studentId,
    dateKey,
    status: "待到班" as SessionStatus,
    arrivalAt: null,
    tutoringAt: null,
    readyAt: null,
    pickupAt: null,
    updatedBy: null,
    updatedAt: dateKey,
  };
}

const STATUS_TIME_COLUMN: Partial<Record<SessionStatus, string>> = {
  已到班: "arrival_at",
  辅导中: "tutoring_at",
  待接: "ready_at",
  已接走: "pickup_at",
};

export function transitionSession(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  input: { studentId: string; to: SessionStatus; dateKey?: string; reason?: string },
) {
  assertStudentActive(db, input.studentId);
  const dateKey = input.dateKey ?? toDateKey();
  const session = ensureSession(db, input.studentId, dateKey);
  const check = checkTransition(SESSION_TRANSITIONS, session.status, input.to);
  if (!check.allowed) {
    throw new AppError(
      ERROR_CODES.INVALID_STATE,
      `不能从「${session.status}」直接变成「${input.to}」`,
    );
  }
  if (check.requiresCorrectionRight) {
    if (!auth.roles.includes("owner")) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "状态回退仅负责人可操作");
    }
    if (!input.reason) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "状态回退必须填写原因");
    }
  }

  return db.transaction(() => {
    const column = STATUS_TIME_COLUMN[input.to];
    const sets = ["status = ?", "updated_by = ?", "updated_at = ?"];
    const params: unknown[] = [input.to, auth.userId, nowIso()];
    if (column) {
      sets.push(`${column} = ?`);
      params.push(nowIso());
    }
    // 回退时清掉接走时间，避免留下矛盾数据
    if (input.to === "待接") {
      sets.push("pickup_at = NULL");
    }
    params.push(session.id);
    db.run(`UPDATE daily_sessions SET ${sets.join(", ")} WHERE id = ?`, ...params);

    if (check.requiresCorrectionRight) {
      writeAudit(db, ctx, actorOf(auth), {
        action: "session.correct",
        target: `session:${session.id}`,
        before: { status: session.status },
        after: { status: input.to },
        reason: input.reason ?? null,
      });
    }

    return mapSession(db.get<Row>("SELECT * FROM daily_sessions WHERE id = ?", session.id)!);
  });
}

/** 管理端今日学员列表：状态、作业、余额、最近提醒一次给全。 */
export function listTodayStudents(db: Db, dateKey = toDateKey()) {
  const students = db.all<Row>(
    "SELECT * FROM students WHERE status = 'active' ORDER BY grade ASC, name ASC",
  );
  return students.map((row) => {
    const studentId = row.id as string;
    // 读列表不建记录：以前这里调 ensureSession，导致每次 GET /dashboard
    // 都给所有学员批量插 daily_sessions 行，带个任意 dateKey 就能把表撑大。
    // 没有记录时派生一个「待到班」的默认值即可，真正的行在状态推进时才创建。
    const session = readSession(db, studentId, dateKey) ?? defaultSession(studentId, dateKey);
    const sheetRow = db.get<Row>(
      "SELECT * FROM homework_sheets WHERE student_id = ? AND date_key = ? AND status != '已撤回'",
      studentId,
      dateKey,
    );
    const reminderRow = db.get<Row>(
      "SELECT created_at FROM pickup_reminders WHERE student_id = ? ORDER BY created_at DESC LIMIT 1",
      studentId,
    );
    const sheet = sheetRow ? mapSheet(sheetRow) : null;
    return {
      studentId,
      name: row.name as string,
      nickname: row.nickname as string,
      grade: row.grade as string,
      session,
      sheet: sheet ? { id: sheet.id, status: sheet.status, rewarded: sheet.rewarded } : null,
      pointBalance: Number(row.point_balance ?? 0),
      lastReminderAt: (reminderRow?.created_at as string | undefined) ?? null,
    };
  });
}

/* ------------------------------ 接娃提醒 ------------------------------ */

export interface SendNoticeInput {
  studentId: string;
  minutes?: number;
  etaAt?: string;
  confirmDuplicate?: boolean;
  requestId: string;
}

/**
 * 发送接娃提醒。
 *
 * 时序按 design §9.4：先占幂等键写「待发送」记录，再调通知能力，最后回写结果。
 * V1 不做后台定时器，点一下就直接发"预计 XX:XX 可接"。
 * 微信订阅消息在小程序环境接入；这里没有配置时降级为站内提醒记录，
 * 并明确告诉管理端"请改用电话联系" —— 绝不把失败伪装成成功。
 */
export function sendPickupNotice(
  db: Db,
  _ctx: RequestContext,
  auth: AuthInfo,
  input: SendNoticeInput,
) {
  assertStudentActive(db, input.studentId);
  const dateKey = toDateKey();
  const session = ensureSession(db, input.studentId, dateKey);

  if (input.minutes !== undefined && etaCrossesMidnight(input.minutes)) {
    // 提醒只带 HH:mm 不带日期，跨天会让家长以为是今天上午
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "预计可接时间不能跨到第二天");
  }
  const etaAt = input.etaAt ?? (input.minutes !== undefined ? etaAfterMinutes(input.minutes) : undefined);
  if (!etaAt || !isValidTimeLabel(etaAt)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "预计可接时间格式应为 HH:mm");
  }

  // 幂等：同一个 requestId 重发（网络超时后老师又点了一次）只算一条。
  // 注意不能拿 ETA 当幂等键 —— ETA 是由当前时钟算出来的，
  // 跨一个分钟边界重试就变成不同的键，家长会收到两条时间不同的通知。
  const idempotencyKey = `PICKUP:${session.id}:${input.requestId}`;
  const sameRequest = db.get<Row>(
    "SELECT * FROM pickup_reminders WHERE idempotency_key = ?",
    idempotencyKey,
  );
  if (sameRequest) {
    const reminder = mapReminder(sameRequest);
    return { reminder, duplicate: true, delivered: reminder.status === "已发送" };
  }

  // 业务上的"重复提醒"是另一回事：同一个孩子同一个 ETA 已经发过了，
  // 需要老师显式确认再发一次（requirements R3）。
  const existing = db.get<Row>(
    "SELECT * FROM pickup_reminders WHERE session_id = ? AND eta_at = ?",
    session.id,
    etaAt,
  );
  if (existing && !input.confirmDuplicate) {
    throw new AppError(ERROR_CODES.DUPLICATE_REQUEST, `已经发过「${etaAt} 可接」的提醒了，确认要再发一次吗？`, {
      details: { etaAt, previousAt: existing.created_at },
    });
  }

  // 有已通过绑定的家长才可能收到通知
  const guardianCount = Number(
    db.get<Row>(
      "SELECT COUNT(*) AS total FROM student_guardians WHERE student_id = ? AND status = '已通过'",
      input.studentId,
    )?.total ?? 0,
  );

  const reminderId = newId("rem");
  const status = guardianCount > 0 ? "已发送" : "待授权";
  const failReason = guardianCount > 0 ? null : "该学员还没有家长完成绑定，请电话联系";

  db.transaction(() => {
    db.run(
      `INSERT INTO pickup_reminders
        (id, session_id, student_id, eta_at, status, sender_id, idempotency_key, fail_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reminderId,
      session.id,
      input.studentId,
      etaAt,
      status,
      auth.userId,
      idempotencyKey,
      failReason,
      nowIso(),
    );
    // 提醒发出后自动把状态推到「待接」（如果还没到）
    if (session.status === "已到班" || session.status === "辅导中") {
      db.run(
        "UPDATE daily_sessions SET status = '待接', ready_at = ?, updated_by = ?, updated_at = ? WHERE id = ?",
        nowIso(),
        auth.userId,
        nowIso(),
        session.id,
      );
    }
  });

  const reminder = mapReminder(
    db.get<Row>("SELECT * FROM pickup_reminders WHERE id = ?", reminderId)!,
  );
  if (status === "待授权") {
    // 记录留下了，但要让老师知道没真发出去
    return { reminder, duplicate: Boolean(existing), delivered: false };
  }
  return { reminder, duplicate: Boolean(existing), delivered: true };
}

export function listReminders(db: Db, auth: AuthInfo, studentId?: string) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (studentId) {
    assertCanAccessStudent(db, auth, studentId);
    clauses.push("r.student_id = ?");
    params.push(studentId);
  } else if (!auth.permissions.includes("student.read_all")) {
    const ids = boundStudentIds(db, auth.userId);
    if (ids.length === 0) return [];
    clauses.push(`r.student_id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .all<Row>(
      `SELECT r.*, s.name AS student_name, s.nickname AS student_nickname
       FROM pickup_reminders r JOIN students s ON s.id = r.student_id
       ${where} ORDER BY r.created_at DESC LIMIT 100`,
      ...params,
    )
    .map((row) => ({
      ...mapReminder(row),
      studentName: row.student_name as string,
      studentNickname: row.student_nickname as string,
    }));
}
