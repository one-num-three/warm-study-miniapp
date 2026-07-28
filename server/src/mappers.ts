/** 数据库行 → 领域对象。列名用下划线，领域对象用小驼峰，转换集中在这里。 */

import type {
  AuditLog,
  DailySession,
  HomeworkItem,
  HomeworkSheet,
  PickupReminder,
  PointLedgerEntry,
  Product,
  Redemption,
  Student,
  StudentGuardian,
  User,
  WrongQuestion,
} from "@warm-study/shared";
import { fromJson, toBool, type Row } from "./db.js";

export function mapUser(row: Row): User {
  return {
    id: row.id as string,
    identityHash: row.identity_hash as string,
    displayName: row.display_name as string,
    roles: fromJson<User["roles"]>(row.roles, ["guardian"]),
    status: row.status as User["status"],
    username: (row.username as string | null) ?? null,
    avatarText: (row.avatar_text as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapStudent(row: Row): Student {
  return {
    id: row.id as string,
    name: row.name as string,
    nickname: row.nickname as string,
    grade: row.grade as string,
    status: row.status as Student["status"],
    bindingCode: row.binding_code as string,
    bindingCodeEnabled: toBool(row.binding_code_enabled),
    bindingCodeIssuedAt: row.binding_code_issued_at as string,
    pointBalance: Number(row.point_balance ?? 0),
    publicRanking: toBool(row.public_ranking),
    note: (row.note as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapBinding(row: Row): StudentGuardian {
  return {
    id: row.id as string,
    studentId: row.student_id as string,
    guardianUserId: row.guardian_user_id as string,
    relation: row.relation as string,
    status: row.status as StudentGuardian["status"],
    source: row.source as StudentGuardian["source"],
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    reviewNote: (row.review_note as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function mapSession(row: Row): DailySession {
  return {
    id: row.id as string,
    studentId: row.student_id as string,
    dateKey: row.date_key as string,
    status: row.status as DailySession["status"],
    arrivalAt: (row.arrival_at as string | null) ?? null,
    tutoringAt: (row.tutoring_at as string | null) ?? null,
    readyAt: (row.ready_at as string | null) ?? null,
    pickupAt: (row.pickup_at as string | null) ?? null,
    updatedBy: (row.updated_by as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}

export function mapSheet(row: Row): HomeworkSheet {
  return {
    id: row.id as string,
    studentId: row.student_id as string,
    dateKey: row.date_key as string,
    status: row.status as HomeworkSheet["status"],
    feedback: (row.feedback as string | null) ?? null,
    rewarded: toBool(row.rewarded),
    submittedBy: row.submitted_by as string,
    submittedAt: row.submitted_at as string,
    finishedBy: (row.finished_by as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    unfinishedReason: (row.unfinished_reason as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}

export function mapItem(row: Row): HomeworkItem {
  return {
    id: row.id as string,
    sheetId: row.sheet_id as string,
    subject: row.subject as string,
    content: row.content as string,
    status: row.status as HomeworkItem["status"],
    image: (row.image as string | null) ?? null,
    updatedBy: (row.updated_by as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}

export function mapReminder(row: Row): PickupReminder {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    studentId: row.student_id as string,
    etaAt: row.eta_at as string,
    status: row.status as PickupReminder["status"],
    senderId: row.sender_id as string,
    idempotencyKey: row.idempotency_key as string,
    failReason: (row.fail_reason as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function mapLedger(row: Row): PointLedgerEntry {
  return {
    id: row.id as string,
    studentId: row.student_id as string,
    delta: Number(row.delta),
    type: row.type as PointLedgerEntry["type"],
    reason: row.reason as string,
    sourceRef: (row.source_ref as string | null) ?? null,
    balanceAfter: Number(row.balance_after),
    operatorId: row.operator_id as string,
    reversed: toBool(row.reversed),
    reversalOf: (row.reversal_of as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function mapProduct(row: Row): Product {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    image: (row.image as string | null) ?? null,
    pointsCost: Number(row.points_cost),
    stock: Number(row.stock),
    status: row.status as Product["status"],
    perStudentLimit: Number(row.per_student_limit ?? 0),
    tone: row.tone as Product["tone"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapRedemption(row: Row): Redemption {
  return {
    id: row.id as string,
    studentId: row.student_id as string,
    productSnapshot: fromJson<Redemption["productSnapshot"]>(row.product_snapshot, {
      id: "",
      name: "",
      pointsCost: 0,
    }),
    pointsCost: Number(row.points_cost),
    status: row.status as Redemption["status"],
    operatorId: row.operator_id as string,
    requestId: row.request_id as string,
    ledgerId: row.ledger_id as string,
    reversedAt: (row.reversed_at as string | null) ?? null,
    reversedBy: (row.reversed_by as string | null) ?? null,
    reversalLedgerId: (row.reversal_ledger_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function mapWrongQuestion(row: Row): WrongQuestion {
  return {
    id: row.id as string,
    studentId: row.student_id as string,
    creatorId: row.creator_id as string,
    subject: row.subject as string,
    knowledge: row.knowledge as string,
    reason: (row.reason as string | null) ?? null,
    answer: (row.answer as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    image: (row.image as string | null) ?? null,
    status: row.status as WrongQuestion["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapAudit(row: Row): AuditLog {
  return {
    id: row.id as string,
    actorId: row.actor_id as string,
    actorName: row.actor_name as string,
    action: row.action as string,
    target: row.target as string,
    before: fromJson<unknown>(row.before, null),
    after: fromJson<unknown>(row.after, null),
    reason: (row.reason as string | null) ?? null,
    requestId: row.request_id as string,
    createdAt: row.created_at as string,
  };
}
