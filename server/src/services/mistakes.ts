/** 错题集。家长和老师都能维护，权限边界靠绑定关系和 mistake.manage_all 划分。 */

import {
  AppError,
  ERROR_CODES,
  MISTAKE_TRANSITIONS,
  checkTransition,
  newId,
  type MistakeStatus,
} from "@warm-study/shared";
import { Db, type Row } from "../db.js";
import { mapWrongQuestion } from "../mappers.js";
import type { AuthInfo } from "../http.js";
import {
  assertCanAccessStudent,
  assertStudentActive,
  boundStudentIds,
  nowIso,
} from "../core.js";

export interface UpsertWrongQuestionInput {
  studentId: string;
  subject: string;
  knowledge: string;
  reason?: string;
  answer?: string;
  note?: string;
  image?: string;
}

export function createWrongQuestion(
  db: Db,
  auth: AuthInfo,
  input: UpsertWrongQuestionInput,
) {
  assertCanAccessStudent(db, auth, input.studentId);
  assertStudentActive(db, input.studentId);
  const id = newId("wq");
  const now = nowIso();
  db.transaction(() => {
    db.run(
      `INSERT INTO wrong_questions
        (id, student_id, creator_id, subject, knowledge, reason, answer, note, image, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '待订正', ?, ?)`,
      id,
      input.studentId,
      auth.userId,
      input.subject.trim(),
      input.knowledge.trim(),
      input.reason ?? null,
      input.answer ?? null,
      input.note ?? null,
      input.image ?? null,
      now,
      now,
    );
    db.run(
      `INSERT INTO wrong_question_events (id, wrong_question_id, from_status, to_status, operator_id, created_at)
       VALUES (?, ?, NULL, '待订正', ?, ?)`,
      newId("wqe"),
      id,
      auth.userId,
      now,
    );
  });
  return mapWrongQuestion(db.get<Row>("SELECT * FROM wrong_questions WHERE id = ?", id)!);
}

function loadOrThrow(db: Db, id: string) {
  const row = db.get<Row>("SELECT * FROM wrong_questions WHERE id = ?", id);
  if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, "错题不存在");
  return mapWrongQuestion(row);
}

/** 能改这条错题吗：老师有 manage_all；家长只能改自己创建的，且孩子要已绑定。 */
function assertCanEdit(db: Db, auth: AuthInfo, question: ReturnType<typeof loadOrThrow>): void {
  if (auth.permissions.includes("mistake.manage_all")) return;
  assertCanAccessStudent(db, auth, question.studentId);
  if (question.creatorId !== auth.userId) {
    throw new AppError(ERROR_CODES.FORBIDDEN, "只能修改自己添加的错题");
  }
}

export function updateWrongQuestion(
  db: Db,
  auth: AuthInfo,
  id: string,
  input: Partial<UpsertWrongQuestionInput>,
) {
  const question = loadOrThrow(db, id);
  assertCanEdit(db, auth, question);

  const fields: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    params.push(value);
  };
  if (input.subject !== undefined) set("subject", input.subject.trim());
  if (input.knowledge !== undefined) set("knowledge", input.knowledge.trim());
  if (input.reason !== undefined) set("reason", input.reason);
  if (input.answer !== undefined) set("answer", input.answer);
  if (input.note !== undefined) set("note", input.note);
  if (input.image !== undefined) set("image", input.image);
  if (fields.length === 0) return question;

  set("updated_at", nowIso());
  params.push(id);
  db.run(`UPDATE wrong_questions SET ${fields.join(", ")} WHERE id = ?`, ...params);
  return loadOrThrow(db, id);
}

export function transitionWrongQuestion(
  db: Db,
  auth: AuthInfo,
  id: string,
  to: MistakeStatus,
) {
  const question = loadOrThrow(db, id);
  assertCanEdit(db, auth, question);
  const check = checkTransition(MISTAKE_TRANSITIONS, question.status, to);
  if (!check.allowed) {
    throw new AppError(ERROR_CODES.INVALID_STATE, `错题不能从「${question.status}」变成「${to}」`);
  }
  db.transaction(() => {
    db.run(
      "UPDATE wrong_questions SET status = ?, updated_at = ? WHERE id = ?",
      to,
      nowIso(),
      id,
    );
    // 状态历史全部保留，方便看孩子这道题反复错了几次
    db.run(
      `INSERT INTO wrong_question_events (id, wrong_question_id, from_status, to_status, operator_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      newId("wqe"),
      id,
      question.status,
      to,
      auth.userId,
      nowIso(),
    );
  });
  return loadOrThrow(db, id);
}

export function listWrongQuestions(
  db: Db,
  auth: AuthInfo,
  filter: { studentId?: string; subject?: string; status?: string } = {},
) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.studentId) {
    assertCanAccessStudent(db, auth, filter.studentId);
    clauses.push("w.student_id = ?");
    params.push(filter.studentId);
  } else if (
    // 两条分支要用同一个口径：能管全部错题、或者能看全部学员，才允许不带 studentId 查全量
    !auth.permissions.includes("mistake.manage_all") &&
    !auth.permissions.includes("student.read_all")
  ) {
    const ids = boundStudentIds(db, auth.userId);
    if (ids.length === 0) return [];
    clauses.push(`w.student_id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  if (filter.subject) {
    clauses.push("w.subject = ?");
    params.push(filter.subject);
  }
  if (filter.status) {
    clauses.push("w.status = ?");
    params.push(filter.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  return db
    .all<Row>(
      `SELECT w.*, s.name AS student_name, s.nickname AS student_nickname
       FROM wrong_questions w JOIN students s ON s.id = w.student_id
       ${where} ORDER BY w.updated_at DESC LIMIT 200`,
      ...params,
    )
    .map((row) => ({
      ...mapWrongQuestion(row),
      studentName: row.student_name as string,
      studentNickname: row.student_nickname as string,
    }));
}
