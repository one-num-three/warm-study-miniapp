/**
 * 接口客户端。所有网络请求走这里，统一处理 token、错误码和中文提示。
 * 小程序端 miniprogram/utils/api.ts 是这个文件的 wx.request 版本，出入参完全一致。
 */

import { API_PREFIX, messageForCode, newRequestId, type ApiResponse } from "@warm-study/shared";

const TOKEN_KEY = "warm-study.token";
const DEVICE_KEY = "warm-study.deviceId";

/** 业务错误：带稳定错误码，页面可以按码分支处理。 */
export class ApiError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number, details?: Record<string, unknown>) {
    super(message || messageForCode(code));
    this.name = "ApiError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 隐私模式下写不了就算了，本次会话仍可用 */
  }
}

let token: string | null = readStorage(TOKEN_KEY);

export function getToken(): string | null {
  return token;
}

export function setToken(next: string | null): void {
  token = next;
  writeStorage(TOKEN_KEY, next);
}

/**
 * 设备标识 —— H5 里扮演小程序 OPENID 的角色。
 * 第一次打开时随机生成并持久化，之后每次进来都是同一个身份，
 * 所以绑定过的孩子刷新页面还在。
 */
export function deviceId(): string {
  let id = readStorage(DEVICE_KEY);
  if (!id) {
    id = `h5-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    writeStorage(DEVICE_KEY, id);
  }
  return id;
}

/** 换一个设备身份 —— 演示"另一位家长"时很有用。 */
export function resetDeviceId(): string {
  writeStorage(DEVICE_KEY, null);
  setToken(null);
  return deviceId();
}

/** 接口基地址。开发时走 Vite 代理，打包后可用 VITE_API_BASE 指向真实域名。 */
const BASE = (import.meta.env?.VITE_API_BASE as string | undefined) ?? "";

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query } = options;
  const url = new URL(`${BASE}${API_PREFIX}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new ApiError("NETWORK", "网络连接失败，请检查后端服务是否已启动", 0, {
      cause: String(error),
    });
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError("INTERNAL", `服务返回了无法解析的内容（HTTP ${response.status}）`, response.status);
  }

  if (payload.success) return payload.data;

  // 登录态失效时主动清掉本地 token，避免一直拿着废票重试
  if (payload.code === "UNAUTHENTICATED") setToken(null);
  throw new ApiError(payload.code, payload.message, response.status, payload.details);
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"]) =>
    request<T>(path, { method: "GET", ...(query ? { query } : {}) }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
};

export { newRequestId };
