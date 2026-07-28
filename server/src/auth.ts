/**
 * 身份与会话。
 *
 * 家长身份的来源：
 *  - 小程序：wx.login 拿到 code → 服务端换 OPENID（配了 AppID/Secret 就走真微信接口，
 *    没配就用开发模式派生一个稳定假 OPENID，方便本地和 H5 联调）；
 *  - H5：浏览器里持久化的设备标识，走同一条路径。
 * 无论哪条路径，落库的都只是**哈希值**，原始 OPENID 不入库、不返回客户端（design §7）。
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** 服务端盐值：生产环境务必通过环境变量覆盖。 */
const IDENTITY_SALT = process.env.WARM_STUDY_IDENTITY_SALT ?? "warm-study-dev-salt";

export function hashIdentity(rawIdentity: string): string {
  return createHash("sha256").update(`${IDENTITY_SALT}:${rawIdentity}`).digest("hex");
}

/** 密码哈希：scrypt + 每账号独立随机盐。存储格式 `scrypt$<salt>$<hash>`。 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expected] = parts as [string, string, string];
  const derived = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  if (expectedBuffer.length !== derived.length) return false;
  return timingSafeEqual(derived, expectedBuffer);
}

/** 生成不可预测的会话令牌；库里只存它的哈希，泄库也拿不到可用令牌。 */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * 把小程序 code 换成 OPENID。
 * 配置了 WARM_STUDY_WX_APPID / WARM_STUDY_WX_SECRET 就调微信接口，
 * 否则走开发模式：把 code 当成稳定身份，本地开发和 H5 都靠这条路。
 */
export async function resolveWechatOpenId(code: string): Promise<string> {
  const appId = process.env.WARM_STUDY_WX_APPID;
  const secret = process.env.WARM_STUDY_WX_SECRET;
  if (!appId || !secret) {
    return `devopenid:${code}`;
  }
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", secret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const payload = (await response.json()) as { openid?: string; errmsg?: string; errcode?: number };
  if (!payload.openid) {
    throw new Error(`微信登录失败: ${payload.errcode ?? "?"} ${payload.errmsg ?? ""}`);
  }
  return payload.openid;
}

export const SESSION_TTL_DAYS = 30;

export function sessionExpiry(from = new Date()): string {
  return new Date(from.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString();
}
