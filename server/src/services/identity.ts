/**
 * 身份域：登录、档案、绑定码绑定、绑定审核。
 * 这里是整个项目的入口流程，家长第一次打开小程序走的就是这条路。
 */

import {
  AppError,
  DEFAULT_STAFF_PERMISSIONS,
  ERROR_CODES,
  PERMISSIONS,
  SETTING_KEYS,
  formatBindingCode,
  generateBindingCodeCandidates,
  newId,
  permissionsForRoles,
  validateBindingCode,
  type Permission,
  type Profile,
  type Role,
} from "@warm-study/shared";
import { Db, fromJson, isUniqueViolation, toJson, type Row } from "../db.js";
import { mapBinding, mapStudent, mapUser } from "../mappers.js";
import {
  hashIdentity,
  hashPassword,
  hashToken,
  newSessionToken,
  resolveWechatOpenId,
  sessionExpiry,
  verifyPassword,
  type WechatIdentityResolver,
} from "../auth.js";
import type { AuthInfo, RequestContext } from "../http.js";
import { getSetting, nowIso, writeAudit, type Actor } from "../core.js";

/* ------------------------------ 权限计算 ------------------------------ */

export function effectivePermissions(row: Row): Permission[] {
  const roles = fromJson<Role[]>(row.roles, ["guardian"]);
  const explicit = fromJson<Permission[] | null>(row.permissions, null);
  if (roles.includes("owner")) return permissionsForRoles(["owner"]);
  if (roles.includes("staff")) {
    return permissionsForRoles(["staff"], explicit ?? DEFAULT_STAFF_PERMISSIONS);
  }
  return [];
}

/* ------------------------------ 会话管理 ------------------------------ */

export function issueToken(db: Db, userId: string): string {
  const { token, tokenHash } = newSessionToken();
  const now = nowIso();
  db.run(
    `INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
    tokenHash,
    userId,
    now,
    sessionExpiry(),
    now,
  );
  return token;
}

export function revokeToken(db: Db, token: string): void {
  db.run("DELETE FROM auth_sessions WHERE token_hash = ?", hashToken(token));
}

/** 由 Authorization: Bearer <token> 解析出登录态。 */
export function authenticateRequest(db: Db, ctx: RequestContext): void {
  const header = ctx.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return;
  const token = header.slice(7).trim();
  if (!token) return;

  const session = db.get<Row>(
    "SELECT * FROM auth_sessions WHERE token_hash = ?",
    hashToken(token),
  );
  if (!session) return;
  if ((session.expires_at as string) < nowIso()) {
    db.run("DELETE FROM auth_sessions WHERE token_hash = ?", session.token_hash as string);
    return;
  }

  const userRow = db.get<Row>("SELECT * FROM users WHERE id = ?", session.user_id as string);
  if (!userRow) return;

  db.run(
    "UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?",
    nowIso(),
    session.token_hash as string,
  );

  const user = mapUser(userRow);
  const auth: AuthInfo = {
    userId: user.id,
    displayName: user.displayName,
    roles: user.roles,
    permissions: effectivePermissions(userRow),
    status: user.status,
  };
  ctx.auth = auth;
}

export function actorOf(auth: AuthInfo): Actor {
  return {
    userId: auth.userId,
    displayName: auth.displayName,
    roles: auth.roles,
    permissions: auth.permissions,
  };
}

/* -------------------------------- 档案 -------------------------------- */

export function buildProfile(db: Db, userId: string): Profile {
  const userRow = db.get<Row>("SELECT * FROM users WHERE id = ?", userId);
  if (!userRow) throw new AppError(ERROR_CODES.NOT_FOUND, "用户不存在");
  const user = mapUser(userRow);

  const students = db
    .all<Row>(
      `SELECT s.*, g.relation FROM student_guardians g
       JOIN students s ON s.id = g.student_id
       WHERE g.guardian_user_id = ? AND g.status = '已通过'
       ORDER BY g.created_at ASC`,
      userId,
    )
    .map((row) => {
      const student = mapStudent(row);
      return {
        id: student.id,
        name: student.name,
        nickname: student.nickname,
        grade: student.grade,
        pointBalance: student.pointBalance,
        relation: row.relation as string,
      };
    });

  const pendingBindings = db
    .all<Row>(
      `SELECT g.relation, g.created_at, s.name AS student_name FROM student_guardians g
       JOIN students s ON s.id = g.student_id
       WHERE g.guardian_user_id = ? AND g.status = '待审核'
       ORDER BY g.created_at DESC`,
      userId,
    )
    .map((row) => ({
      studentName: row.student_name as string,
      relation: row.relation as string,
      createdAt: row.created_at as string,
    }));

  return {
    userId: user.id,
    displayName: user.displayName,
    roles: user.roles,
    status: user.status,
    permissions: effectivePermissions(userRow),
    students,
    pendingBindings,
  };
}

/* -------------------------------- 登录 -------------------------------- */

export interface LoginResult {
  token: string;
  profile: Profile;
}

/**
 * 家长登录。小程序传 wx.login 的 code，H5 传浏览器里持久化的设备标识，
 * 服务端统一换成身份哈希 —— 原始 OPENID 不入库。
 */
export async function login(
  db: Db,
  input: { loginType: "wechat" | "device"; code: string; developmentIdentity?: string; displayName?: string },
  resolveWechatIdentity: WechatIdentityResolver = resolveWechatOpenId,
): Promise<LoginResult> {
  const rawIdentity =
    input.loginType === "wechat"
      ? await resolveWechatIdentity({ code: input.code, developmentIdentity: input.developmentIdentity })
      : `device:${input.code}`;
  const identityHash = hashIdentity(rawIdentity);

  let userRow = db.get<Row>("SELECT * FROM users WHERE identity_hash = ?", identityHash);
  if (!userRow) {
    const id = newId("usr");
    const now = nowIso();
    const displayName = (input.displayName ?? "").trim() || "家长";
    db.run(
      `INSERT INTO users (id, identity_hash, display_name, roles, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      id,
      identityHash,
      displayName,
      toJson(["guardian"]),
      now,
      now,
    );
    userRow = db.get<Row>("SELECT * FROM users WHERE id = ?", id)!;
  } else if (input.displayName && (input.displayName ?? "").trim().length > 0) {
    db.run(
      "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
      input.displayName.trim(),
      nowIso(),
      userRow.id as string,
    );
    userRow = db.get<Row>("SELECT * FROM users WHERE id = ?", userRow.id as string)!;
  }

  const user = mapUser(userRow);
  if (user.status !== "active") {
    throw new AppError(ERROR_CODES.FORBIDDEN, "账号已被停用，请联系负责人");
  }

  return { token: issueToken(db, user.id), profile: buildProfile(db, user.id) };
}

/** 管理端登录：账号 + 密码。 */
export function staffLogin(db: Db, username: string, password: string): LoginResult {
  const row = db.get<Row>("SELECT * FROM users WHERE username = ?", username.trim());
  // 用户名不存在时也走一次密码校验，避免通过响应时间探测账号是否存在
  const ok = verifyPassword(password, (row?.password_hash as string | null) ?? null);
  if (!row || !ok) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, "账号或密码不正确");
  }
  const user = mapUser(row);
  if (user.status !== "active") {
    throw new AppError(ERROR_CODES.FORBIDDEN, "账号已被停用，请联系负责人");
  }
  return { token: issueToken(db, user.id), profile: buildProfile(db, user.id) };
}

/* ------------------------------ 绑定码绑定 ------------------------------ */

/** 生成一个库里没有的绑定码。冲突就换一个，全部用完才报错。 */
export function allocateBindingCode(db: Db): string {
  const candidates = generateBindingCodeCandidates(12);
  for (const code of candidates) {
    const clash = db.get<Row>("SELECT id FROM students WHERE binding_code = ?", code);
    if (!clash) return code;
  }
  throw new AppError(ERROR_CODES.INTERNAL, "绑定码生成失败，请重试");
}

const ATTEMPT_WINDOW_MS = 10 * 60_000;

/**
 * 限流的两个计数桶，阈值刻意不同。
 *
 * 只按用户身份计数挡不住攻击：`POST /auth/login` 用任意 device code 就能换一个
 * 全新身份、全新的桶，轮换十几个 deviceId 就能不受限地猜码。所以要按来源 IP 再兜一层。
 *
 * 但 IP 桶不能和身份桶一样严 —— 一个辅导班的家长很可能都连同一个 WiFi、
 * 或在同一个运营商 NAT 后面，几位家长各输错两次就会把整栋楼锁死。
 * 所以：单个身份 10 次失败即锁（正常人不会输错这么多次），
 * 单个 IP 放宽到 60 次（够几十位家长各错几次，但挡得住穷举）。
 */
const ATTEMPT_LIMITS: { identity: number; ip: number } = {
  identity: 10,
  ip: 60,
};

function attemptBuckets(
  identityHash: string,
  clientIp: string | undefined,
): Array<{ key: string; limit: number }> {
  const buckets = [{ key: `id:${identityHash}`, limit: ATTEMPT_LIMITS.identity }];
  if (clientIp) buckets.push({ key: `ip:${clientIp}`, limit: ATTEMPT_LIMITS.ip });
  return buckets;
}

function assertNotRateLimited(db: Db, identityHash: string, clientIp?: string): void {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
  for (const bucket of attemptBuckets(identityHash, clientIp)) {
    const row = db.get<Row>(
      `SELECT COUNT(*) AS failures FROM binding_attempts
       WHERE identity_hash = ? AND ok = 0 AND created_at > ?`,
      bucket.key,
      since,
    );
    if (Number(row?.failures ?? 0) >= bucket.limit) {
      throw new AppError(ERROR_CODES.TOO_MANY_ATTEMPTS, undefined, {
        details: { retryAfterMinutes: 10 },
      });
    }
  }
}

function recordAttempt(db: Db, identityHash: string, ok: boolean, clientIp?: string): void {
  for (const { key } of attemptBuckets(identityHash, clientIp)) {
    db.run(
      "INSERT INTO binding_attempts (id, identity_hash, ok, created_at) VALUES (?, ?, ?, ?)",
      newId("att"),
      key,
      ok ? 1 : 0,
      nowIso(),
    );
  }
}

export interface BindResult {
  status: "已通过" | "待审核";
  student: { id: string; name: string; nickname: string; grade: string };
  relation: string;
  profile: Profile;
}

/**
 * 用绑定码把家长和孩子关联起来 —— 本项目的核心流程。
 *
 * 1. 先做格式与校验位检查，格式错的码根本不查库（也就不消耗限流额度之外的资源）；
 * 2. 限流：同一身份 10 分钟内最多 10 次失败，防穷举；
 * 3. 命中学生后检查码是否被停用、学生是否在读；
 * 4. 按系统设置决定「输码即绑定」还是「提交申请等审核」，默认前者；
 * 5. 全程写审计。
 */
export function bindByCode(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  input: { bindingCode: string; relation: string; guardianName?: string },
): BindResult {
  const userRow = db.get<Row>("SELECT * FROM users WHERE id = ?", auth.userId);
  if (!userRow) throw new AppError(ERROR_CODES.UNAUTHENTICATED);
  const identityHash = userRow.identity_hash as string;

  assertNotRateLimited(db, identityHash, ctx.clientIp);

  const validation = validateBindingCode(input.bindingCode);
  if (!validation.ok) {
    recordAttempt(db, identityHash, false, ctx.clientIp);
    const hint =
      validation.reason === "length"
        ? "绑定码是 8 位，请检查是否输漏或多输"
        : validation.reason === "charset"
          ? "绑定码里不含 I、L、O、U 这几个字母，请再核对一下"
          : undefined;
    throw new AppError(ERROR_CODES.BINDING_CODE_INVALID, hint);
  }

  const studentRow = db.get<Row>(
    "SELECT * FROM students WHERE binding_code = ?",
    validation.normalized,
  );
  if (!studentRow) {
    recordAttempt(db, identityHash, false, ctx.clientIp);
    throw new AppError(ERROR_CODES.BINDING_CODE_NOT_FOUND);
  }
  const student = mapStudent(studentRow);

  if (!student.bindingCodeEnabled) {
    recordAttempt(db, identityHash, false, ctx.clientIp);
    throw new AppError(ERROR_CODES.BINDING_CODE_DISABLED);
  }
  if (student.status !== "active") {
    recordAttempt(db, identityHash, false, ctx.clientIp);
    throw new AppError(ERROR_CODES.INVALID_STATE, "该学员已停用，请联系负责人");
  }

  const existing = db.get<Row>(
    `SELECT * FROM student_guardians
     WHERE student_id = ? AND guardian_user_id = ? AND status IN ('待审核', '已通过')`,
    student.id,
    auth.userId,
  );
  if (existing) {
    recordAttempt(db, identityHash, true, ctx.clientIp);
    const binding = mapBinding(existing);
    if (binding.status === "待审核") {
      throw new AppError(ERROR_CODES.BINDING_PENDING_REVIEW);
    }
    throw new AppError(ERROR_CODES.BINDING_ALREADY_EXISTS);
  }

  const requiresReview = getSetting<boolean>(db, SETTING_KEYS.BINDING_REQUIRES_REVIEW);
  const status: "已通过" | "待审核" = requiresReview ? "待审核" : "已通过";
  const relation = input.relation.trim() || "家长";

  db.transaction(() => {
    const bindingId = newId("bnd");
    try {
      db.run(
        `INSERT INTO student_guardians
          (id, student_id, guardian_user_id, relation, status, source, reviewed_by, reviewed_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'binding_code', ?, ?, ?)`,
        bindingId,
        student.id,
        auth.userId,
        relation,
        status,
        status === "已通过" ? "system" : null,
        status === "已通过" ? nowIso() : null,
        nowIso(),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(ERROR_CODES.BINDING_ALREADY_EXISTS);
      }
      throw error;
    }

    // 家长首次绑定：补上称呼，并确保带上 guardian 角色
    const roles = fromJson<Role[]>(userRow.roles, ["guardian"]);
    const nextRoles = roles.includes("guardian") ? roles : [...roles, "guardian"];
    const name = (input.guardianName ?? "").trim();
    db.run(
      "UPDATE users SET roles = ?, display_name = ?, updated_at = ? WHERE id = ?",
      toJson(nextRoles),
      name.length > 0 ? name : (userRow.display_name as string),
      nowIso(),
      auth.userId,
    );

    writeAudit(db, ctx, actorOf(auth), {
      action: status === "已通过" ? "binding.create" : "binding.request",
      target: `student:${student.id}`,
      after: { relation, status, source: "binding_code" },
    });
  });

  recordAttempt(db, identityHash, true, ctx.clientIp);

  return {
    status,
    student: {
      id: student.id,
      name: student.name,
      nickname: student.nickname,
      grade: student.grade,
    },
    relation,
    profile: buildProfile(db, auth.userId),
  };
}

/**
 * 输码前的预览：只回孩子的脱敏姓名，让家长确认"绑的是不是自家娃"。
 * 不建立任何关系，也不返回其它信息。
 *
 * 这个接口必须和正式绑定**共用同一个限流桶** —— 否则它就成了一个
 * 无限次数的"这个码存不存在、是谁家孩子"预言机，攻击者根本不需要碰
 * bindByCode 就能把码穷举出来。
 */
export function previewBindingCode(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  code: string,
): { valid: boolean; studentHint?: string; grade?: string } {
  const userRow = db.get<Row>("SELECT identity_hash FROM users WHERE id = ?", auth.userId);
  if (!userRow) throw new AppError(ERROR_CODES.UNAUTHENTICATED);
  const identityHash = userRow.identity_hash as string;

  assertNotRateLimited(db, identityHash, ctx.clientIp);

  const validation = validateBindingCode(code);
  if (!validation.ok) {
    // 格式错的码不查库，也不消耗额度（本地就该拦下）
    return { valid: false };
  }
  const row = db.get<Row>(
    "SELECT name, grade, status, binding_code_enabled FROM students WHERE binding_code = ?",
    validation.normalized,
  );
  const found = Boolean(row && row.status === "active" && row.binding_code_enabled);
  recordAttempt(db, identityHash, found, ctx.clientIp);
  if (!row || !found) return { valid: false };

  const name = row.name as string;
  const chars = [...name];
  const hint = chars.length <= 1 ? name : `${chars[0]}${"*".repeat(chars.length - 1)}`;
  return { valid: true, studentHint: hint, grade: row.grade as string };
}

/* ------------------------------ 绑定审核 ------------------------------ */

export function listBindings(db: Db, filter: { status?: string; studentId?: string } = {}) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    clauses.push("g.status = ?");
    params.push(filter.status);
  }
  if (filter.studentId) {
    clauses.push("g.student_id = ?");
    params.push(filter.studentId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .all<Row>(
      `SELECT g.*, s.name AS student_name, s.nickname AS student_nickname, u.display_name AS guardian_name
       FROM student_guardians g
       JOIN students s ON s.id = g.student_id
       JOIN users u ON u.id = g.guardian_user_id
       ${where}
       ORDER BY g.created_at DESC`,
      ...params,
    )
    .map((row) => ({
      ...mapBinding(row),
      studentName: row.student_name as string,
      studentNickname: row.student_nickname as string,
      guardianName: row.guardian_name as string,
    }));
}

export function reviewBinding(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  bindingId: string,
  decision: "approve" | "reject",
  reason?: string,
) {
  const row = db.get<Row>("SELECT * FROM student_guardians WHERE id = ?", bindingId);
  if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, "绑定申请不存在");
  const binding = mapBinding(row);
  if (binding.status !== "待审核") {
    throw new AppError(ERROR_CODES.INVALID_STATE, "该申请已经处理过了");
  }
  const next = decision === "approve" ? "已通过" : "已拒绝";
  db.transaction(() => {
    db.run(
      `UPDATE student_guardians SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?
       WHERE id = ?`,
      next,
      auth.userId,
      nowIso(),
      reason ?? null,
      bindingId,
    );
    writeAudit(db, ctx, actorOf(auth), {
      action: "binding.review",
      target: `binding:${bindingId}`,
      before: { status: binding.status },
      after: { status: next },
      reason: reason ?? null,
    });
  });
  return { id: bindingId, status: next };
}

export function releaseBinding(
  db: Db,
  ctx: RequestContext,
  auth: AuthInfo,
  bindingId: string,
  reason?: string,
) {
  const row = db.get<Row>("SELECT * FROM student_guardians WHERE id = ?", bindingId);
  if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, "绑定关系不存在");
  const binding = mapBinding(row);
  if (binding.status !== "已通过") {
    throw new AppError(ERROR_CODES.INVALID_STATE, "只有已通过的绑定才能解除");
  }
  db.transaction(() => {
    db.run(
      "UPDATE student_guardians SET status = '已解除', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?",
      auth.userId,
      nowIso(),
      reason ?? null,
      bindingId,
    );
    writeAudit(db, ctx, actorOf(auth), {
      action: "binding.release",
      target: `binding:${bindingId}`,
      before: { status: "已通过" },
      after: { status: "已解除" },
      reason: reason ?? null,
    });
  });
  return { id: bindingId, status: "已解除" };
}

/* ------------------------------ 老师账号 ------------------------------ */

export function createStaffUser(
  db: Db,
  input: {
    username: string;
    password: string;
    displayName: string;
    roles?: Role[];
    permissions?: Permission[] | null;
  },
): string {
  const id = newId("usr");
  const now = nowIso();
  const roles = input.roles ?? ["staff"];
  try {
    db.run(
      `INSERT INTO users (id, identity_hash, username, password_hash, display_name, roles, permissions, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      id,
      hashIdentity(`staff:${input.username}`),
      input.username.trim(),
      hashPassword(input.password),
      input.displayName.trim(),
      toJson(roles),
      input.permissions ? toJson(input.permissions) : null,
      now,
      now,
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(ERROR_CODES.CONFLICT, "该登录名已被占用");
    }
    throw error;
  }
  return id;
}

/** 系统必须始终保留至少一名有效负责人。 */
export function assertNotLastOwner(db: Db, userId: string): void {
  const target = db.get<Row>("SELECT roles, status FROM users WHERE id = ?", userId);
  if (!target) return;
  const roles = fromJson<Role[]>(target.roles, []);
  if (!roles.includes("owner") || target.status !== "active") return;
  // 不能用 roles LIKE '%owner%'：roles 是 JSON 文本，
  // ["co-owner"] 这种值会被子串匹配误判成负责人，
  // 于是"最后一名负责人"的保护就被绕过，系统会落到 0 个负责人。
  const candidates = db.all<Row>(
    "SELECT id, roles FROM users WHERE status = 'active' AND id != ?",
    userId,
  );
  const otherOwners = candidates.filter((candidate) =>
    fromJson<Role[]>(candidate.roles, []).includes("owner"),
  );
  if (otherOwners.length === 0) {
    throw new AppError(ERROR_CODES.LAST_OWNER_PROTECTED);
  }
}

export const BINDING_CODE_DISPLAY = formatBindingCode;
export const OWNER_PERMISSION = PERMISSIONS.STAFF_MANAGE;
