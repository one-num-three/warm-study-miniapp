/** 学员档案。新增学员时**同时**生成那个唯一固定的绑定码。 */

import {
  AppError,
  ERROR_CODES,
  formatBindingCode,
  newId,
  type Student,
} from "@warm-study/shared";
import { Db, fromBool, isUniqueViolation, type Row } from "../db.js";
import { mapStudent } from "../mappers.js";
import type { AuthInfo, RequestContext } from "../http.js";
import { findStudentOrThrow, nowIso, recomputeBalance, writeAudit } from "../core.js";
import { actorOf, allocateBindingCode } from "./identity.js";

export interface CreateStudentInput {
  name: string;
  nickname?: string;
  grade: string;
  note?: string;
  publicRanking?: boolean;
}

/**
 * 新增学员。绑定码在这里第一次也是唯一一次被生成：
 * 客户端无权指定，生成后写入带唯一索引的列，撞了就换一个再试。
 */
export function createStudent(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  input: CreateStudentInput,
): { student: Student; bindingCodeDisplay: string } {
  const now = nowIso();
  const id = newId("stu");

  const student = db.transaction(() => {
    let lastError: unknown;
    // 唯一索引兜底：万一并发下两个请求抽到同一个码，这里最多重试 5 轮
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = allocateBindingCode(db);
      try {
        db.run(
          `INSERT INTO students
            (id, name, nickname, grade, status, binding_code, binding_code_enabled,
             binding_code_issued_at, point_balance, public_ranking, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, 1, ?, 0, ?, ?, ?, ?)`,
          id,
          input.name.trim(),
          (input.nickname ?? "").trim(),
          input.grade.trim(),
          code,
          now,
          fromBool(input.publicRanking ?? true),
          input.note ?? null,
          now,
          now,
        );
        return mapStudent(db.get<Row>("SELECT * FROM students WHERE id = ?", id)!);
      } catch (error) {
        lastError = error;
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new AppError(ERROR_CODES.INTERNAL, "绑定码生成失败，请重试", { cause: lastError });
  });

  writeAudit(db, ctx, actorOf(auth), {
    action: "student.create",
    target: `student:${student.id}`,
    after: { name: student.name, grade: student.grade, bindingCode: student.bindingCode },
  });

  return { student, bindingCodeDisplay: formatBindingCode(student.bindingCode) };
}

export function listStudents(
  db: Db,
  options: { includeDisabled?: boolean; keyword?: string } = {},
): Student[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!options.includeDisabled) clauses.push("status = 'active'");
  if (options.keyword) {
    // 转义 LIKE 的通配符，否则搜 "%" 会匹配全部、搜 "_" 会匹配任意单字符
    const escaped = options.keyword.trim().replace(/[\\%_]/g, (char) => `\\${char}`);
    clauses.push(
      "(name LIKE ? ESCAPE '\\' OR nickname LIKE ? ESCAPE '\\' OR binding_code LIKE ? ESCAPE '\\')",
    );
    const like = `%${escaped}%`;
    params.push(like, like, like.toUpperCase());
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .all<Row>(`SELECT * FROM students ${where} ORDER BY created_at DESC`, ...params)
    .map(mapStudent);
}

export function getStudentDetail(db: Db, studentId: string) {
  const student = findStudentOrThrow(db, studentId);
  const guardians = db
    .all<Row>(
      `SELECT g.id, g.guardian_user_id, g.relation, g.status, g.created_at, u.display_name
       FROM student_guardians g JOIN users u ON u.id = g.guardian_user_id
       WHERE g.student_id = ? ORDER BY g.created_at ASC`,
      studentId,
    )
    .map((row) => ({
      bindingId: row.id as string,
      userId: row.guardian_user_id as string,
      displayName: row.display_name as string,
      relation: row.relation as string,
      status: row.status as "待审核" | "已通过" | "已拒绝" | "已解除",
      createdAt: row.created_at as string,
    }));

  return {
    ...student,
    bindingCodeDisplay: formatBindingCode(student.bindingCode),
    computedBalance: recomputeBalance(db, studentId),
    guardians,
  };
}

export interface UpdateStudentInput {
  name?: string;
  nickname?: string;
  grade?: string;
  note?: string;
  publicRanking?: boolean;
  status?: "active" | "disabled";
}

export function updateStudent(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  studentId: string,
  input: UpdateStudentInput,
): Student {
  const before = findStudentOrThrow(db, studentId);
  const fields: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    fields.push("name = ?");
    params.push(input.name.trim());
  }
  if (input.nickname !== undefined) {
    fields.push("nickname = ?");
    params.push(input.nickname.trim());
  }
  if (input.grade !== undefined) {
    fields.push("grade = ?");
    params.push(input.grade.trim());
  }
  if (input.note !== undefined) {
    fields.push("note = ?");
    params.push(input.note);
  }
  if (input.publicRanking !== undefined) {
    fields.push("public_ranking = ?");
    params.push(fromBool(input.publicRanking));
  }
  if (input.status !== undefined) {
    fields.push("status = ?");
    params.push(input.status);
  }
  if (fields.length === 0) return before;

  fields.push("updated_at = ?");
  params.push(nowIso(), studentId);
  db.run(`UPDATE students SET ${fields.join(", ")} WHERE id = ?`, ...params);

  const after = findStudentOrThrow(db, studentId);
  // 停用学员是敏感操作，历史数据全部保留，只改状态
  writeAudit(db, ctx, actorOf(auth), {
    action: input.status && input.status !== before.status ? "student.status" : "student.update",
    target: `student:${studentId}`,
    before: { name: before.name, grade: before.grade, status: before.status },
    after: { name: after.name, grade: after.grade, status: after.status },
  });
  return after;
}

/**
 * 重置绑定码。默认不该用 —— 只有码被贴到家长群、外泄了才重置。
 * 重置后旧码立刻失效，已经绑上的家长不受影响。
 */
export function resetBindingCode(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  studentId: string,
  reason: string,
): { bindingCode: string; bindingCodeDisplay: string } {
  const before = findStudentOrThrow(db, studentId);
  const code = db.transaction(() => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = allocateBindingCode(db);
      try {
        db.run(
          "UPDATE students SET binding_code = ?, binding_code_issued_at = ?, updated_at = ? WHERE id = ?",
          candidate,
          nowIso(),
          nowIso(),
          studentId,
        );
        return candidate;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new AppError(ERROR_CODES.INTERNAL, "绑定码生成失败，请重试");
  });

  writeAudit(db, ctx, actorOf(auth), {
    action: "binding_code.reset",
    target: `student:${studentId}`,
    before: { bindingCode: before.bindingCode },
    after: { bindingCode: code },
    reason,
  });
  return { bindingCode: code, bindingCodeDisplay: formatBindingCode(code) };
}

/** 临时停用/启用绑定码，不改码本身。 */
export function toggleBindingCode(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  studentId: string,
  enabled: boolean,
  reason?: string,
): { enabled: boolean } {
  const before = findStudentOrThrow(db, studentId);
  db.run(
    "UPDATE students SET binding_code_enabled = ?, updated_at = ? WHERE id = ?",
    fromBool(enabled),
    nowIso(),
    studentId,
  );
  writeAudit(db, ctx, actorOf(auth), {
    action: "binding_code.toggle",
    target: `student:${studentId}`,
    before: { enabled: before.bindingCodeEnabled },
    after: { enabled },
    reason: reason ?? null,
  });
  return { enabled };
}
