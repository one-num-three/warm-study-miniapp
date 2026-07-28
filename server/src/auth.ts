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
import { AppError, ERROR_CODES } from "@warm-study/shared";

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
 * 微信登录身份解析的入参。code 是一次性临时凭证，不能作为稳定身份保存；
 * developmentIdentity 只用于没有接入真实微信配置的本地开发。
 */
export interface WechatIdentityInput {
  code: string;
  developmentIdentity?: string;
}

export type WechatIdentityResolver = (input: WechatIdentityInput) => Promise<string>;

export interface WechatIdentityResolverOptions {
  environment?: string;
  appId?: string;
  secret?: string;
  /** 注入点仅供测试使用，避免测试向微信发真实请求。 */
  exchangeCode?: (input: { appId: string; secret: string; code: string }) => Promise<string>;
}

async function exchangeWechatCode(input: {
  appId: string;
  secret: string;
  code: string;
}): Promise<string> {
  const { appId, secret, code } = input;
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", secret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const payload = (await response.json()) as { openid?: unknown };
    if (typeof payload.openid === "string" && payload.openid) return payload.openid;
  } catch {
    // 对外只暴露稳定错误码，不能把 AppSecret、微信响应或网络细节返回给客户端。
  }
  throw new AppError(ERROR_CODES.WECHAT_LOGIN_UNAVAILABLE);
}

/**
 * 生成微信身份解析器：配置完整时调用微信 jscode2session；本地开发没有配置时，
 * 用小程序本地持久化的安装标识模拟稳定 OPENID。生产环境绝不允许该回退。
 */
export function createWechatIdentityResolver(
  options: WechatIdentityResolverOptions = {},
): WechatIdentityResolver {
  const environment = options.environment ?? process.env.NODE_ENV ?? "development";
  const appId = options.appId ?? process.env.WARM_STUDY_WX_APPID;
  const secret = options.secret ?? process.env.WARM_STUDY_WX_SECRET;
  const exchangeCode = options.exchangeCode ?? exchangeWechatCode;

  return async ({ code, developmentIdentity }) => {
    if (appId && secret) return exchangeCode({ appId, secret, code });
    if (environment === "production") {
      throw new AppError(ERROR_CODES.WECHAT_LOGIN_UNAVAILABLE);
    }
    const stableInstallId = developmentIdentity?.trim();
    if (!stableInstallId) {
      throw new AppError(ERROR_CODES.WECHAT_LOGIN_UNAVAILABLE);
    }
    return `devopenid:${stableInstallId}`;
  };
}

/**
 * 默认解析器在每次登录时读取环境变量，便于本地测试切换环境；正式服务的环境变量
 * 在进程启动时固定不变。业务层只接触这个接口，不接触 OPENID 原文。
 */
export async function resolveWechatOpenId(input: WechatIdentityInput): Promise<string> {
  return createWechatIdentityResolver()(input);
}

export const SESSION_TTL_DAYS = 30;

export function sessionExpiry(from = new Date()): string {
  return new Date(from.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString();
}
