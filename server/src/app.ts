/** 路由装配。所有接口在这里挂上去，权限在每个 handler 的第一行就校验。 */

import {
  ERROR_CODES,
  HOMEWORK_ITEM_STATUSES,
  HOMEWORK_STATUSES,
  LEDGER_TYPES,
  MISTAKE_STATUSES,
  PERMISSIONS,
  PRODUCT_STATUSES,
  SESSION_STATUSES,
  AppError,
  toDateKey,
  type HomeworkItemStatus,
  type HomeworkStatus,
  type LeaderboardPeriod,
  type LedgerType,
  type MistakeStatus,
  type ProductStatus,
  type SessionStatus,
} from "@warm-study/shared";
import { Db } from "./db.js";
import {
  Router,
  createRequestHandler,
  optionalBool,
  optionalDateKey,
  optionalInt,
  optionalString,
  pickEnum,
  requireInt,
  requireString,
  type RequestContext,
} from "./http.js";
import { requireAuth, requireOwner, requirePermission } from "./core.js";
import * as identity from "./services/identity.js";
import * as students from "./services/students.js";
import * as homework from "./services/homework.js";
import * as sessions from "./services/sessions.js";
import * as points from "./services/points.js";
import * as store from "./services/store.js";
import * as mistakes from "./services/mistakes.js";
import * as admin from "./services/admin.js";

/** 从 query 里取 dateKey，缺省用今天。非法日期直接拒掉，不让脏数据进业务层。 */
function queryDateKey(ctx: RequestContext): string {
  const raw = ctx.query.get("dateKey");
  if (!raw) return toDateKey();
  return optionalDateKey({ dateKey: raw }, "dateKey")!;
}

function bearer(ctx: RequestContext): string {
  const header = ctx.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function itemsOf(ctx: RequestContext): Array<{ subject: string; content: string; image?: string }> {
  const raw = ctx.body.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "至少填写一项作业");
  }
  return raw.map((entry, index) => {
    const item = entry as Record<string, unknown>;
    const subject = typeof item.subject === "string" ? item.subject.trim() : "";
    if (!subject) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `第 ${index + 1} 项缺少科目`);
    }
    return {
      subject,
      content: typeof item.content === "string" ? item.content.trim() : "",
      ...(typeof item.image === "string" && item.image ? { image: item.image } : {}),
    };
  });
}

export function createApp(db: Db) {
  const router = new Router();

  /* --------------------------------- 健康检查 --------------------------------- */
  router.get("/api/health", () => ({
    ok: true,
    time: new Date().toISOString(),
    dateKey: toDateKey(),
  }));

  /* ---------------------------------- 登录 ---------------------------------- */
  router.post("/api/auth/login", async (ctx) => {
    const loginType = pickEnum(ctx.body, "loginType", ["wechat", "device"] as const, {
      label: "登录方式",
    })!;
    const code = requireString(ctx.body, "code", { label: "登录凭证", max: 256 });
    const displayName = optionalString(ctx.body, "displayName", { max: 20, label: "称呼" });
    return identity.login(db, { loginType, code, ...(displayName ? { displayName } : {}) });
  });

  router.post("/api/auth/staff-login", (ctx) => {
    const username = requireString(ctx.body, "username", { label: "登录名", max: 40 });
    const password = requireString(ctx.body, "password", { label: "密码", max: 128 });
    return identity.staffLogin(db, username, password);
  });

  router.post("/api/auth/logout", (ctx) => {
    const token = bearer(ctx);
    if (token) identity.revokeToken(db, token);
    return { ok: true };
  });

  router.get("/api/auth/profile", (ctx) => {
    const auth = requireAuth(ctx);
    return identity.buildProfile(db, auth.userId);
  });

  /* --------------------------------- 绑定码 --------------------------------- */
  router.post("/api/bindings/by-code", (ctx) => {
    const auth = requireAuth(ctx);
    const bindingCode = requireString(ctx.body, "bindingCode", { label: "绑定码", max: 32 });
    const relation = optionalString(ctx.body, "relation", { max: 10, label: "关系" }) ?? "家长";
    const guardianName = optionalString(ctx.body, "guardianName", { max: 20, label: "称呼" });
    return identity.bindByCode(db, ctx, auth, {
      bindingCode,
      relation,
      ...(guardianName ? { guardianName } : {}),
    });
  });

  router.get("/api/bindings/preview", (ctx) => {
    const auth = requireAuth(ctx);
    // 走和正式绑定同一个限流桶，否则这个接口就是个无限次数的绑定码预言机
    return identity.previewBindingCode(db, ctx, auth, ctx.query.get("code") ?? "");
  });

  router.get("/api/bindings", (ctx) => {
    requirePermission(ctx, PERMISSIONS.BINDING_REVIEW);
    return identity.listBindings(db, {
      ...(ctx.query.get("status") ? { status: ctx.query.get("status")! } : {}),
      ...(ctx.query.get("studentId") ? { studentId: ctx.query.get("studentId")! } : {}),
    });
  });

  router.post("/api/bindings/:id/review", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.BINDING_REVIEW);
    const decision = pickEnum(ctx.body, "decision", ["approve", "reject"] as const, {
      label: "审核结果",
    })!;
    const reason = optionalString(ctx.body, "reason", { max: 100, label: "原因" });
    return identity.reviewBinding(db, ctx, auth, ctx.params.id!, decision, reason);
  });

  router.post("/api/bindings/:id/release", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.BINDING_REVIEW);
    const reason = optionalString(ctx.body, "reason", { max: 100, label: "原因" });
    return identity.releaseBinding(db, ctx, auth, ctx.params.id!, reason);
  });

  /* ---------------------------------- 学员 ---------------------------------- */
  router.get("/api/students", (ctx) => {
    requirePermission(ctx, PERMISSIONS.STUDENT_READ_ALL);
    return students.listStudents(db, {
      includeDisabled: optionalBool(
        Object.fromEntries(ctx.query.entries()),
        "includeDisabled",
      ) ?? false,
      ...(ctx.query.get("keyword") ? { keyword: ctx.query.get("keyword")! } : {}),
    });
  });

  router.post("/api/students", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.STUDENT_MANAGE);
    const name = requireString(ctx.body, "name", { label: "姓名", max: 20 });
    const grade = requireString(ctx.body, "grade", { label: "年级", max: 20 });
    const nickname = optionalString(ctx.body, "nickname", { max: 20, label: "昵称" });
    const note = optionalString(ctx.body, "note", { max: 200, label: "备注" });
    const publicRanking = optionalBool(ctx.body, "publicRanking");
    return students.createStudent(db, ctx, auth, {
      name,
      grade,
      ...(nickname ? { nickname } : {}),
      ...(note ? { note } : {}),
      ...(publicRanking === undefined ? {} : { publicRanking }),
    });
  });

  router.get("/api/students/:id", (ctx) => {
    requirePermission(ctx, PERMISSIONS.STUDENT_READ_ALL);
    return students.getStudentDetail(db, ctx.params.id!);
  });

  router.patch("/api/students/:id", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.STUDENT_MANAGE);
    const status = pickEnum(ctx.body, "status", ["active", "disabled"] as const, {
      optional: true,
      label: "状态",
    });
    const publicRanking = optionalBool(ctx.body, "publicRanking");
    return students.updateStudent(db, ctx, auth, ctx.params.id!, {
      ...(ctx.body.name !== undefined
        ? { name: requireString(ctx.body, "name", { label: "姓名", max: 20 }) }
        : {}),
      // PATCH 必须和 POST 用同一套长度约束，否则改一次就能塞进 10 万字符的昵称，
      // 而昵称会随排行榜发给每一个家长
      ...(ctx.body.nickname !== undefined
        ? { nickname: optionalString(ctx.body, "nickname", { max: 20, label: "昵称" }) ?? "" }
        : {}),
      ...(ctx.body.grade !== undefined
        ? { grade: requireString(ctx.body, "grade", { label: "年级", max: 20 }) }
        : {}),
      ...(ctx.body.note !== undefined
        ? { note: optionalString(ctx.body, "note", { max: 200, label: "备注" }) ?? "" }
        : {}),
      ...(publicRanking === undefined ? {} : { publicRanking }),
      ...(status ? { status } : {}),
    });
  });

  router.post("/api/students/:id/binding-code/reset", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.BINDING_CODE_MANAGE);
    const reason = requireString(ctx.body, "reason", { label: "重置原因", max: 100 });
    return students.resetBindingCode(db, ctx, auth, ctx.params.id!, reason);
  });

  router.post("/api/students/:id/binding-code/toggle", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.BINDING_CODE_MANAGE);
    const enabled = optionalBool(ctx.body, "enabled");
    if (enabled === undefined) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "缺少 enabled 参数");
    }
    const reason = optionalString(ctx.body, "reason", { max: 100, label: "原因" });
    return students.toggleBindingCode(db, ctx, auth, ctx.params.id!, enabled, reason);
  });

  /* -------------------------------- 今日看板 -------------------------------- */
  router.get("/api/dashboard", (ctx) => {
    requirePermission(ctx, PERMISSIONS.STUDENT_READ_ALL);
    return admin.dashboard(db, queryDateKey(ctx));
  });

  router.get("/api/sessions/today", (ctx) => {
    requirePermission(ctx, PERMISSIONS.STUDENT_READ_ALL);
    return sessions.listTodayStudents(db, queryDateKey(ctx));
  });

  router.post("/api/sessions/transition", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.SESSION_MANAGE);
    const studentId = requireString(ctx.body, "studentId", { label: "学员" });
    const to = pickEnum<SessionStatus>(ctx.body, "to", SESSION_STATUSES, { label: "目标状态" })!;
    const reason = optionalString(ctx.body, "reason", { max: 100, label: "原因" });
    const dateKey = optionalDateKey(ctx.body, "dateKey");
    return sessions.transitionSession(db, ctx, auth, {
      studentId,
      to,
      ...(reason ? { reason } : {}),
      ...(dateKey ? { dateKey } : {}),
    });
  });

  /* ---------------------------------- 作业 ---------------------------------- */
  router.get("/api/homework/sheets", (ctx) => {
    const auth = requireAuth(ctx);
    return homework.listSheets(db, auth, {
      ...(ctx.query.get("dateKey") ? { dateKey: queryDateKey(ctx) } : {}),
      ...(ctx.query.get("studentId") ? { studentId: ctx.query.get("studentId")! } : {}),
      ...(ctx.query.get("status") ? { status: ctx.query.get("status")! } : {}),
    });
  });

  router.post("/api/homework/sheets", (ctx) => {
    const auth = requireAuth(ctx);
    const studentId = requireString(ctx.body, "studentId", { label: "学员" });
    const dateKey = optionalDateKey(ctx.body, "dateKey");
    return homework.createSheet(db, ctx, auth, {
      studentId,
      items: itemsOf(ctx),
      ...(dateKey ? { dateKey } : {}),
    });
  });

  router.get("/api/homework/sheets/:id", (ctx) => {
    const auth = requireAuth(ctx);
    const detail = homework.getSheetDetail(db, ctx.params.id!);
    if (!auth.permissions.includes(PERMISSIONS.STUDENT_READ_ALL)) {
      // 家长只能看自己孩子的作业单
      const ok = homework
        .listSheets(db, auth, { studentId: detail.studentId })
        .some((sheet) => sheet.id === detail.id);
      if (!ok) throw new AppError(ERROR_CODES.FORBIDDEN);
    }
    return detail;
  });

  router.post("/api/homework/sheets/:id/transition", (ctx) => {
    const auth = requireAuth(ctx);
    const to = pickEnum<HomeworkStatus>(ctx.body, "to", HOMEWORK_STATUSES, {
      label: "目标状态",
    })!;
    const reason = optionalString(ctx.body, "reason", { max: 100, label: "原因" });
    return homework.transitionSheet(db, ctx, auth, ctx.params.id!, to, reason);
  });

  router.post("/api/homework/items/:id/status", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.HOMEWORK_MANAGE);
    const status = pickEnum<HomeworkItemStatus>(ctx.body, "status", HOMEWORK_ITEM_STATUSES, {
      label: "作业项状态",
    })!;
    const reason = optionalString(ctx.body, "reason", { max: 100, label: "原因" });
    return homework.updateItemStatus(db, ctx, auth, ctx.params.id!, status, reason);
  });

  router.post("/api/homework/sheets/:id/finish", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.HOMEWORK_MANAGE);
    const status = pickEnum(ctx.body, "status", ["已完成", "未完成"] as const, {
      label: "结束状态",
    })!;
    const feedback = requireString(ctx.body, "feedback", { label: "辅导反馈", max: 300 });
    const unfinishedReason = optionalString(ctx.body, "unfinishedReason", {
      max: 200,
      label: "未完成原因",
    });
    const rewardPoints = optionalInt(ctx.body, "rewardPoints", {
      min: 0,
      max: 500,
      label: "奖励积分",
    });
    const requestId = requireString(ctx.body, "requestId", { label: "请求 ID", max: 64 });
    return homework.finishSheet(db, ctx, auth, ctx.params.id!, {
      status,
      feedback,
      requestId,
      ...(unfinishedReason ? { unfinishedReason } : {}),
      ...(rewardPoints === undefined ? {} : { rewardPoints }),
    });
  });

  /* -------------------------------- 接娃提醒 -------------------------------- */
  router.post("/api/reminders", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.NOTIFICATION_SEND);
    const studentId = requireString(ctx.body, "studentId", { label: "学员" });
    const requestId = requireString(ctx.body, "requestId", { label: "请求 ID", max: 64 });
    const minutes = optionalInt(ctx.body, "minutes", { min: 1, max: 600, label: "分钟数" });
    const etaAt = optionalString(ctx.body, "etaAt", { max: 5, label: "预计时间" });
    const confirmDuplicate = optionalBool(ctx.body, "confirmDuplicate") ?? false;
    return sessions.sendPickupNotice(db, ctx, auth, {
      studentId,
      requestId,
      confirmDuplicate,
      ...(minutes === undefined ? {} : { minutes }),
      ...(etaAt ? { etaAt } : {}),
    });
  });

  router.get("/api/reminders", (ctx) => {
    const auth = requireAuth(ctx);
    return sessions.listReminders(db, auth, ctx.query.get("studentId") ?? undefined);
  });

  /* ---------------------------------- 积分 ---------------------------------- */
  router.get("/api/points/ledger", (ctx) => {
    const auth = requireAuth(ctx);
    return points.listLedger(db, auth, {
      ...(ctx.query.get("studentId") ? { studentId: ctx.query.get("studentId")! } : {}),
      ...(ctx.query.get("limit") ? { limit: Number(ctx.query.get("limit")) } : {}),
    });
  });

  router.post("/api/points/grant", (ctx) => {
    const auth = requireAuth(ctx);
    const studentId = requireString(ctx.body, "studentId", { label: "学员" });
    const delta = requireInt(ctx.body, "delta", { min: -1000, max: 1000, label: "积分" });
    const type = pickEnum<LedgerType>(ctx.body, "type", LEDGER_TYPES, { label: "类型" })!;
    const reason = requireString(ctx.body, "reason", { label: "原因", max: 100 });
    const requestId = requireString(ctx.body, "requestId", { label: "请求 ID", max: 64 });
    const sourceRef = optionalString(ctx.body, "sourceRef", { max: 64 });
    return points.grantPoints(db, ctx, auth, {
      studentId,
      delta,
      type,
      reason,
      requestId,
      ...(sourceRef ? { sourceRef } : {}),
    });
  });

  router.post("/api/points/reverse", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.POINTS_REVERSE);
    const ledgerId = requireString(ctx.body, "ledgerId", { label: "流水" });
    const reason = requireString(ctx.body, "reason", { label: "冲正原因", max: 100 });
    return points.reverseLedger(db, ctx, auth, { ledgerId, reason });
  });

  router.get("/api/points/reconcile", (ctx) => {
    requireOwner(ctx);
    return points.reconcile(db);
  });

  router.get("/api/leaderboard", (ctx) => {
    const auth = requireAuth(ctx);
    const period = (ctx.query.get("period") ?? "week") as LeaderboardPeriod;
    if (!["week", "month", "lifetime"].includes(period)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "排行周期只能是 week / month / lifetime");
    }
    const limit = Number(ctx.query.get("limit") ?? 20);
    return points.leaderboard(db, auth, period, Number.isFinite(limit) ? limit : 20);
  });

  /* ---------------------------------- 商店 ---------------------------------- */
  router.get("/api/products", (ctx) => {
    const auth = requireAuth(ctx);
    return store.listProducts(db, auth);
  });

  router.post("/api/products", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.PRODUCT_MANAGE);
    return store.createProduct(db, ctx, auth, {
      name: requireString(ctx.body, "name", { label: "商品名", max: 30 }),
      pointsCost: requireInt(ctx.body, "pointsCost", { min: 1, max: 10_000, label: "积分价格" }),
      stock: requireInt(ctx.body, "stock", { min: 0, max: 10_000, label: "库存" }),
      ...(optionalString(ctx.body, "description", { max: 100 })
        ? { description: optionalString(ctx.body, "description", { max: 100 })! }
        : {}),
      ...(optionalInt(ctx.body, "perStudentLimit", { min: 0, max: 100 }) === undefined
        ? {}
        : { perStudentLimit: optionalInt(ctx.body, "perStudentLimit", { min: 0, max: 100 })! }),
      ...(pickEnum(ctx.body, "tone", ["sun", "leaf", "clay"] as const, { optional: true })
        ? { tone: pickEnum(ctx.body, "tone", ["sun", "leaf", "clay"] as const, { optional: true })! }
        : {}),
      ...(pickEnum<ProductStatus>(ctx.body, "status", PRODUCT_STATUSES, { optional: true })
        ? { status: pickEnum<ProductStatus>(ctx.body, "status", PRODUCT_STATUSES, { optional: true })! }
        : {}),
      ...(typeof ctx.body.image === "string" && ctx.body.image ? { image: ctx.body.image } : {}),
    });
  });

  router.patch("/api/products/:id", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.PRODUCT_MANAGE);
    const patch: Parameters<typeof store.updateProduct>[4] = {};
    if (ctx.body.name !== undefined) patch.name = requireString(ctx.body, "name", { max: 30 });
    if (ctx.body.description !== undefined)
      patch.description = optionalString(ctx.body, "description", { max: 100, label: "说明" }) ?? "";
    if (ctx.body.image !== undefined) patch.image = String(ctx.body.image ?? "");
    if (ctx.body.pointsCost !== undefined)
      patch.pointsCost = requireInt(ctx.body, "pointsCost", { min: 1, max: 10_000 });
    if (ctx.body.stock !== undefined)
      patch.stock = requireInt(ctx.body, "stock", { min: 0, max: 10_000 });
    if (ctx.body.perStudentLimit !== undefined)
      patch.perStudentLimit = requireInt(ctx.body, "perStudentLimit", { min: 0, max: 100 });
    const status = pickEnum<ProductStatus>(ctx.body, "status", PRODUCT_STATUSES, {
      optional: true,
    });
    if (status) patch.status = status;
    const tone = pickEnum(ctx.body, "tone", ["sun", "leaf", "clay"] as const, { optional: true });
    if (tone) patch.tone = tone;
    return store.updateProduct(db, ctx, auth, ctx.params.id!, patch);
  });

  router.post("/api/redemptions", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.REDEMPTION_CREATE);
    return store.redeem(db, ctx, auth, {
      studentId: requireString(ctx.body, "studentId", { label: "学员" }),
      productId: requireString(ctx.body, "productId", { label: "商品" }),
      requestId: requireString(ctx.body, "requestId", { label: "请求 ID", max: 64 }),
    });
  });

  router.get("/api/redemptions", (ctx) => {
    const auth = requireAuth(ctx);
    return store.listRedemptions(db, auth, ctx.query.get("studentId") ?? undefined);
  });

  router.post("/api/redemptions/:id/reverse", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.REDEMPTION_REVERSE);
    const reason = requireString(ctx.body, "reason", { label: "撤销原因", max: 100 });
    return store.reverseRedemption(db, ctx, auth, ctx.params.id!, reason);
  });

  /* ---------------------------------- 错题 ---------------------------------- */
  router.get("/api/wrong-questions", (ctx) => {
    const auth = requireAuth(ctx);
    return mistakes.listWrongQuestions(db, auth, {
      ...(ctx.query.get("studentId") ? { studentId: ctx.query.get("studentId")! } : {}),
      ...(ctx.query.get("subject") ? { subject: ctx.query.get("subject")! } : {}),
      ...(ctx.query.get("status") ? { status: ctx.query.get("status")! } : {}),
    });
  });

  router.post("/api/wrong-questions", (ctx) => {
    const auth = requireAuth(ctx);
    return mistakes.createWrongQuestion(db, auth, {
      studentId: requireString(ctx.body, "studentId", { label: "学员" }),
      subject: requireString(ctx.body, "subject", { label: "科目", max: 20 }),
      knowledge: requireString(ctx.body, "knowledge", { label: "知识点", max: 50 }),
      ...(optionalString(ctx.body, "reason", { max: 200 })
        ? { reason: optionalString(ctx.body, "reason", { max: 200 })! }
        : {}),
      ...(optionalString(ctx.body, "answer", { max: 200 })
        ? { answer: optionalString(ctx.body, "answer", { max: 200 })! }
        : {}),
      ...(optionalString(ctx.body, "note", { max: 200 })
        ? { note: optionalString(ctx.body, "note", { max: 200 })! }
        : {}),
      ...(typeof ctx.body.image === "string" && ctx.body.image ? { image: ctx.body.image } : {}),
    });
  });

  router.patch("/api/wrong-questions/:id", (ctx) => {
    const auth = requireAuth(ctx);
    const patch: Record<string, unknown> = {};
    // 每个字段沿用创建时的长度上限，PATCH 不能是校验的后门
    const limits: Record<string, { max: number; label: string }> = {
      subject: { max: 20, label: "科目" },
      knowledge: { max: 50, label: "知识点" },
      reason: { max: 200, label: "错因" },
      answer: { max: 200, label: "正确答案" },
      note: { max: 200, label: "备注" },
    };
    for (const [key, rule] of Object.entries(limits)) {
      if (ctx.body[key] !== undefined) {
        patch[key] = optionalString(ctx.body, key, rule) ?? "";
      }
    }
    if (ctx.body.image !== undefined) patch.image = String(ctx.body.image ?? "");
    return mistakes.updateWrongQuestion(db, auth, ctx.params.id!, patch);
  });

  router.post("/api/wrong-questions/:id/transition", (ctx) => {
    const auth = requireAuth(ctx);
    const to = pickEnum<MistakeStatus>(ctx.body, "to", MISTAKE_STATUSES, { label: "目标状态" })!;
    return mistakes.transitionWrongQuestion(db, auth, ctx.params.id!, to);
  });

  /* ---------------------------------- 管理 ---------------------------------- */
  router.get("/api/staff", (ctx) => {
    requirePermission(ctx, PERMISSIONS.STAFF_MANAGE);
    return admin.listStaff(db);
  });

  router.post("/api/staff", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.STAFF_MANAGE);
    return admin.createStaff(db, ctx, auth, {
      username: requireString(ctx.body, "username", { label: "登录名", min: 3, max: 20 }),
      password: requireString(ctx.body, "password", { label: "密码", min: 6, max: 64 }),
      displayName: requireString(ctx.body, "displayName", { label: "姓名", max: 20 }),
      ...(Array.isArray(ctx.body.permissions)
        ? { permissions: (ctx.body.permissions as unknown[]).map(String) }
        : {}),
      grantedByOwner: auth.roles.includes("owner"),
    });
  });

  router.patch("/api/staff/:id", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.STAFF_MANAGE);
    const status = pickEnum(ctx.body, "status", ["active", "disabled"] as const, {
      optional: true,
    });
    const targetId = ctx.params.id!;

    // 不能给自己加权限。角色方面唯一的提权途径是 owner，
    // 已经由下面那条"只有负责人才能授予负责人角色"的规则覆盖；
    // 给自己降级（负责人退位成老师）是合法诉求，放行后由
    // "最后一名负责人不可降权"的硬约束兜住。
    if (targetId === auth.userId && Array.isArray(ctx.body.permissions)) {
      const added = (ctx.body.permissions as unknown[])
        .map(String)
        .filter((permission) => !auth.permissions.includes(permission));
      if (added.length > 0) {
        throw new AppError(ERROR_CODES.FORBIDDEN, "不能给自己增加权限，请让另一位负责人操作");
      }
    }
    // 授予 owner 角色、以及改动 owner 账号（含改密码），只有 owner 本人能做
    if (Array.isArray(ctx.body.roles)) {
      const roles = (ctx.body.roles as unknown[]).map(String);
      const allowed = ["owner", "staff", "guardian"];
      const illegal = roles.filter((role) => !allowed.includes(role));
      if (illegal.length > 0) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `角色只能是：${allowed.join(" / ")}`);
      }
      if (roles.includes("owner") && !auth.roles.includes("owner")) {
        throw new AppError(ERROR_CODES.FORBIDDEN, "只有负责人才能授予负责人角色");
      }
    }
    if (!auth.roles.includes("owner") && admin.isOwnerAccount(db, targetId)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "只有负责人才能修改负责人账号");
    }

    return admin.updateStaff(db, ctx, auth, targetId, {
      ...(ctx.body.displayName !== undefined
        ? { displayName: requireString(ctx.body, "displayName", { max: 20 }) }
        : {}),
      ...(Array.isArray(ctx.body.permissions)
        ? { permissions: (ctx.body.permissions as unknown[]).map(String) }
        : {}),
      ...(status ? { status } : {}),
      ...(Array.isArray(ctx.body.roles)
        ? { roles: (ctx.body.roles as unknown[]).map(String) as ("owner" | "staff" | "guardian")[] }
        : {}),
      // 非负责人授予权限时会在服务层被剔除掉负责人专属权限
      grantedByOwner: auth.roles.includes("owner"),
      ...(ctx.body.password !== undefined
        ? { password: requireString(ctx.body, "password", { min: 6, max: 64, label: "密码" }) }
        : {}),
    });
  });

  router.get("/api/audit", (ctx) => {
    requirePermission(ctx, PERMISSIONS.AUDIT_READ);
    return admin.listAudit(db, {
      ...(ctx.query.get("action") ? { action: ctx.query.get("action")! } : {}),
      ...(ctx.query.get("limit") ? { limit: Number(ctx.query.get("limit")) } : {}),
    });
  });

  router.get("/api/settings", (ctx) => {
    // 家长不需要知道积分阈值、库存告警线这些运营参数
    requirePermission(ctx, PERMISSIONS.STUDENT_READ_ALL);
    return admin.getSettings(db);
  });

  router.patch("/api/settings", (ctx) => {
    const auth = requirePermission(ctx, PERMISSIONS.SETTINGS_MANAGE);
    return admin.updateSettings(db, ctx, auth, ctx.body);
  });

  return createRequestHandler({
    router,
    authenticate: (ctx) => identity.authenticateRequest(db, ctx),
  });
}
