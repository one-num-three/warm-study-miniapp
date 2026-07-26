/**
 * SQLite 访问层。用 Node 内置的 node:sqlite，不需要任何原生依赖，
 * `npm install` 之后开箱即用（要求 Node >= 22.5）。
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Row = Record<string, unknown>;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  identity_hash  TEXT NOT NULL UNIQUE,
  username       TEXT UNIQUE,
  password_hash  TEXT,
  display_name   TEXT NOT NULL,
  roles          TEXT NOT NULL DEFAULT '["guardian"]',
  permissions    TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  avatar_text    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  nickname                TEXT NOT NULL DEFAULT '',
  grade                   TEXT NOT NULL DEFAULT '',
  status                  TEXT NOT NULL DEFAULT 'active',
  binding_code            TEXT NOT NULL,
  binding_code_enabled    INTEGER NOT NULL DEFAULT 1,
  binding_code_issued_at  TEXT NOT NULL,
  point_balance           INTEGER NOT NULL DEFAULT 0,
  public_ranking          INTEGER NOT NULL DEFAULT 1,
  note                    TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);
-- 绑定码全局唯一：这是"唯一固定"承诺的技术兜底
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_binding_code ON students(binding_code);

CREATE TABLE IF NOT EXISTS student_guardians (
  id                TEXT PRIMARY KEY,
  student_id        TEXT NOT NULL REFERENCES students(id),
  guardian_user_id  TEXT NOT NULL REFERENCES users(id),
  relation          TEXT NOT NULL DEFAULT '家长',
  status            TEXT NOT NULL DEFAULT '已通过',
  source            TEXT NOT NULL DEFAULT 'binding_code',
  reviewed_by       TEXT,
  reviewed_at       TEXT,
  review_note       TEXT,
  created_at        TEXT NOT NULL
);
-- 同一家长对同一孩子只保留一条有效关系（已解除/已拒绝的不占位）
CREATE UNIQUE INDEX IF NOT EXISTS idx_binding_unique_active
  ON student_guardians(student_id, guardian_user_id)
  WHERE status IN ('待审核', '已通过');
CREATE INDEX IF NOT EXISTS idx_binding_guardian ON student_guardians(guardian_user_id, status);
CREATE INDEX IF NOT EXISTS idx_binding_status ON student_guardians(status, created_at DESC);

CREATE TABLE IF NOT EXISTS daily_sessions (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students(id),
  date_key    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT '待到班',
  arrival_at  TEXT,
  tutoring_at TEXT,
  ready_at    TEXT,
  pickup_at   TEXT,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_unique ON daily_sessions(student_id, date_key);
CREATE INDEX IF NOT EXISTS idx_session_date ON daily_sessions(date_key, status);

CREATE TABLE IF NOT EXISTS homework_sheets (
  id                TEXT PRIMARY KEY,
  student_id        TEXT NOT NULL REFERENCES students(id),
  date_key          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT '待确认',
  feedback          TEXT,
  rewarded          INTEGER NOT NULL DEFAULT 0,
  submitted_by      TEXT NOT NULL,
  submitted_at      TEXT NOT NULL,
  finished_by       TEXT,
  finished_at       TEXT,
  unfinished_reason TEXT,
  updated_at        TEXT NOT NULL
);
-- 每个孩子每天只有一张有效作业单，撤回后可以重开
CREATE UNIQUE INDEX IF NOT EXISTS idx_sheet_active
  ON homework_sheets(student_id, date_key) WHERE status != '已撤回';
CREATE INDEX IF NOT EXISTS idx_sheet_date ON homework_sheets(date_key, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sheet_student ON homework_sheets(student_id, date_key DESC);

CREATE TABLE IF NOT EXISTS homework_items (
  id         TEXT PRIMARY KEY,
  sheet_id   TEXT NOT NULL REFERENCES homework_sheets(id),
  subject    TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT '待开始',
  image      TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_item_sheet ON homework_items(sheet_id);

CREATE TABLE IF NOT EXISTS pickup_reminders (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  student_id      TEXT NOT NULL REFERENCES students(id),
  eta_at          TEXT NOT NULL,
  status          TEXT NOT NULL,
  sender_id       TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  fail_reason     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminder_student ON pickup_reminders(student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS point_ledger (
  id              TEXT PRIMARY KEY,
  student_id      TEXT NOT NULL REFERENCES students(id),
  delta           INTEGER NOT NULL,
  type            TEXT NOT NULL,
  reason          TEXT NOT NULL DEFAULT '',
  source_ref      TEXT,
  balance_after   INTEGER NOT NULL,
  operator_id     TEXT NOT NULL,
  reversed        INTEGER NOT NULL DEFAULT 0,
  reversal_of     TEXT,
  idempotency_key TEXT UNIQUE,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_student ON point_ledger(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_period ON point_ledger(created_at, delta, student_id);
-- 一条流水最多被冲正一次
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_reversal_once
  ON point_ledger(reversal_of) WHERE reversal_of IS NOT NULL;

CREATE TABLE IF NOT EXISTS products (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  image             TEXT,
  points_cost       INTEGER NOT NULL,
  stock             INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT '草稿',
  per_student_limit INTEGER NOT NULL DEFAULT 0,
  tone              TEXT NOT NULL DEFAULT 'leaf',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redemptions (
  id                  TEXT PRIMARY KEY,
  student_id          TEXT NOT NULL REFERENCES students(id),
  product_id          TEXT NOT NULL,
  product_snapshot    TEXT NOT NULL,
  points_cost         INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT '已完成',
  operator_id         TEXT NOT NULL,
  request_id          TEXT NOT NULL UNIQUE,
  ledger_id           TEXT NOT NULL,
  reversed_at         TEXT,
  reversed_by         TEXT,
  reversal_ledger_id  TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redemption_student ON redemptions(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_redemption_status ON redemptions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS wrong_questions (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  creator_id TEXT NOT NULL,
  subject    TEXT NOT NULL,
  knowledge  TEXT NOT NULL DEFAULT '',
  reason     TEXT,
  answer     TEXT,
  note       TEXT,
  image      TEXT,
  status     TEXT NOT NULL DEFAULT '待订正',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wq_student ON wrong_questions(student_id, subject, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS wrong_question_events (
  id                TEXT PRIMARY KEY,
  wrong_question_id TEXT NOT NULL REFERENCES wrong_questions(id),
  from_status       TEXT,
  to_status         TEXT NOT NULL,
  operator_id       TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  before     TEXT,
  after      TEXT,
  reason     TEXT,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_user ON auth_sessions(user_id);

-- 绑定码尝试记录，用于限流，防止有人穷举别人家孩子的码
CREATE TABLE IF NOT EXISTS binding_attempts (
  id            TEXT PRIMARY KEY,
  identity_hash TEXT NOT NULL,
  ok            INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts ON binding_attempts(identity_hash, created_at DESC);
`;

export class Db {
  readonly raw: DatabaseSync;
  private txDepth = 0;

  constructor(filename: string) {
    if (filename !== ":memory:") {
      mkdirSync(dirname(filename), { recursive: true });
    }
    this.raw = new DatabaseSync(filename);
    this.raw.exec(SCHEMA);
  }

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.raw.prepare(sql).all(...(params as never[])) as T[];
  }

  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return this.raw.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  run(sql: string, ...params: unknown[]): { changes: number } {
    const result = this.raw.prepare(sql).run(...(params as never[]));
    return { changes: Number(result.changes) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /**
   * 事务包装。支持嵌套（内层用 SAVEPOINT），
   * 抛异常时整段回滚 —— 扣积分/减库存/写记录要么全成要么全不成。
   */
  transaction<T>(fn: () => T): T {
    const isOuter = this.txDepth === 0;
    const savepoint = `sp_${this.txDepth}`;
    this.raw.exec(isOuter ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    this.txDepth += 1;
    try {
      const result = fn();
      this.txDepth -= 1;
      this.raw.exec(isOuter ? "COMMIT" : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.txDepth -= 1;
      try {
        this.raw.exec(isOuter ? "ROLLBACK" : `ROLLBACK TO ${savepoint}`);
        if (!isOuter) this.raw.exec(`RELEASE ${savepoint}`);
      } catch {
        // 回滚本身失败时不要盖掉原始异常
      }
      throw error;
    }
  }

  close(): void {
    this.raw.close();
  }
}

/** SQLite 唯一索引冲突的识别（用于绑定码重试、幂等拦截）。 */
export function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message);
}

/* -------------------------- JSON 列的读写辅助 -------------------------- */

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function fromJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

export function fromBool(value: boolean): number {
  return value ? 1 : 0;
}
