/** 极简路由 + JSON 处理，直接跑在 node:http 上，不引第三方框架。 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { AppError, ERROR_CODES, isValidDateKey, newRequestId } from "@warm-study/shared";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RequestContext {
  method: HttpMethod;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  headers: IncomingMessage["headers"];
  requestId: string;
  /** 客户端 IP，限流用。反代后面读 x-forwarded-for 的第一段。 */
  clientIp: string | undefined;
  /** 由鉴权中间件填充 */
  auth?: AuthInfo;
}

export interface AuthInfo {
  userId: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  status: string;
}

export type Handler = (ctx: RequestContext) => unknown | Promise<unknown>;

interface Route {
  method: HttpMethod;
  segments: string[];
  handler: Handler;
}

/** 请求体上限，作业图片用 dataURL 传，留足空间 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export class Router {
  private routes: Route[] = [];

  add(method: HttpMethod, path: string, handler: Handler): this {
    this.routes.push({ method, segments: path.split("/").filter(Boolean), handler });
    return this;
  }

  get(path: string, handler: Handler) {
    return this.add("GET", path, handler);
  }
  post(path: string, handler: Handler) {
    return this.add("POST", path, handler);
  }
  patch(path: string, handler: Handler) {
    return this.add("PATCH", path, handler);
  }
  del(path: string, handler: Handler) {
    return this.add("DELETE", path, handler);
  }

  match(
    method: string,
    path: string,
  ): { handler: Handler; params: Record<string, string> } | undefined {
    const parts = path.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i]!;
        const value = parts[i]!;
        if (segment.startsWith(":")) {
          params[segment.slice(1)] = decodeURIComponent(value);
        } else if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return undefined;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new AppError(ERROR_CODES.INVALID_ARGUMENT, "上传内容过大，请压缩图片后重试"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export interface CreateHandlerOptions {
  router: Router;
  /** 每个请求在进入业务前执行，用于解析登录态 */
  authenticate?: (ctx: RequestContext) => void | Promise<void>;
  /** 允许的跨域来源，'*' 表示全放开（开发环境） */
  corsOrigin?: string;
  onError?: (error: unknown, ctx: RequestContext) => void;
}

export function createRequestHandler(options: CreateHandlerOptions) {
  const { router, authenticate, corsOrigin = "*" } = options;

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = newRequestId();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const ctx: RequestContext = {
      method: (req.method ?? "GET") as HttpMethod,
      path: url.pathname,
      params: {},
      query: url.searchParams,
      body: {},
      headers: req.headers,
      requestId,
      clientIp: clientIpOf(req),
    };

    try {
      const matched = router.match(ctx.method, ctx.path);
      if (!matched) {
        throw new AppError(ERROR_CODES.NOT_FOUND, `接口不存在: ${ctx.method} ${ctx.path}`);
      }
      ctx.params = matched.params;

      if (ctx.method !== "GET") {
        const raw = await readBody(req);
        if (raw.trim().length > 0) {
          try {
            const parsed: unknown = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              ctx.body = parsed as Record<string, unknown>;
            }
          } catch {
            throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "请求体不是合法的 JSON");
          }
        }
      }

      if (authenticate) await authenticate(ctx);

      const data = await matched.handler(ctx);
      sendJson(res, 200, { success: true, requestId, data: data ?? null });
    } catch (error) {
      options.onError?.(error, ctx);
      if (error instanceof AppError) {
        sendJson(res, error.httpStatus, {
          success: false,
          requestId,
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        });
        return;
      }
      // 未预期异常：只在服务端日志里留栈，不给客户端
      console.error(`[${requestId}] ${ctx.method} ${ctx.path} 未处理异常:`, error);
      sendJson(res, 500, {
        success: false,
        requestId,
        code: ERROR_CODES.INTERNAL,
        message: "服务开小差了，请稍后重试",
      });
    }
  };
}

/** 取客户端 IP。部署在反代后面时用 x-forwarded-for 的第一段。 */
function clientIpOf(req: IncomingMessage): string | undefined {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? undefined;
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/* ------------------------------ 入参取值辅助 ------------------------------ */

export function requireString(
  source: Record<string, unknown>,
  key: string,
  options: { max?: number; min?: number; label?: string } = {},
): string {
  const label = options.label ?? key;
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `${label}不能为空`);
  }
  const trimmed = value.trim();
  if (options.min && trimmed.length < options.min) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `${label}至少 ${options.min} 个字符`);
  }
  if (options.max && trimmed.length > options.max) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `${label}不能超过 ${options.max} 个字符`);
  }
  return trimmed;
}

export function optionalString(
  source: Record<string, unknown>,
  key: string,
  options: { max?: number; label?: string } = {},
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(source, key, options);
}

export function requireInt(
  source: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; label?: string } = {},
): number {
  const label = options.label ?? key;
  const raw = source[key];
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `${label}必须是整数`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `${label}不能小于 ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `${label}不能大于 ${options.max}`);
  }
  return value;
}

export function optionalInt(
  source: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; label?: string } = {},
): number | undefined {
  if (source[key] === undefined || source[key] === null || source[key] === "") return undefined;
  return requireInt(source, key, options);
}

export function optionalBool(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * 校验 yyyy-MM-dd 形式的日期，并且必须是真实存在的一天。
 * 只用长度或正则挡不住 `9999-99-99` —— 这种值落库后，
 * 那条记录再也不会出现在任何按日期查询的界面里。
 */
export function optionalDateKey(
  source: Record<string, unknown>,
  key: string,
  label = "日期",
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (!isValidDateKey(value)) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `${label}格式应为 yyyy-MM-dd 且必须是真实日期`);
  }
  return value;
}

export function pickEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  options: { label?: string; optional?: boolean } = {},
): T | undefined {
  const label = options.label ?? key;
  const value = source[key];
  if (value === undefined || value === null || value === "") {
    if (options.optional) return undefined;
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `${label}不能为空`);
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new AppError(
      ERROR_CODES.INVALID_ARGUMENT,
      `${label}只能是：${allowed.join(" / ")}`,
    );
  }
  return value as T;
}
