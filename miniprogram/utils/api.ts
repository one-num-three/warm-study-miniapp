/**
 * 小程序接口客户端。和 H5 的 h5/src/api.ts 是同一套契约，只是把 fetch 换成 wx.request。
 *
 * 身份来源：wx.login 拿到的 code → 服务端换 OPENID → 落库只存哈希。
 * token 存在 storage 里，重新打开小程序会自动续上，绑定过的孩子还在。
 */

import { messageForCode } from "../shared/errors.js";

const TOKEN_KEY = "warm-study.token";

/** 后端地址。真机调试和上线时改成你自己的域名（并在小程序后台配置 request 合法域名）。 */
export const API_BASE = "http://localhost:8787/api";

export class ApiError extends Error {
  code: string;
  details?: Record<string, unknown>;
  httpStatus: number;

  constructor(code: string, message: string, httpStatus: number, details?: Record<string, unknown>) {
    super(message || messageForCode(code));
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function getToken(): string {
  return wx.getStorageSync(TOKEN_KEY) || "";
}

export function setToken(token: string | null): void {
  if (token) wx.setStorageSync(TOKEN_KEY, token);
  else wx.removeStorageSync(TOKEN_KEY);
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  data?: Record<string, unknown>;
}

function buildUrl(path: string, query?: Record<string, unknown>): string {
  if (!query) return API_BASE + path;
  const parts: string[] = [];
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `${API_BASE}${path}?${parts.join("&")}` : API_BASE + path;
}

export function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const header: Record<string, string> = { "content-type": "application/json" };
    const token = getToken();
    if (token) header.Authorization = `Bearer ${token}`;

    wx.request({
      url: API_BASE + path,
      method: options.method ?? "GET",
      data: options.data as WechatMiniprogram.IAnyObject,
      header,
      timeout: 15000,
      success(res) {
        const payload = res.data as
          | { success: true; data: T }
          | { success: false; code: string; message: string; details?: Record<string, unknown> };
        if (payload && (payload as { success: boolean }).success) {
          resolve((payload as { data: T }).data);
          return;
        }
        const failure = payload as { code: string; message: string; details?: Record<string, unknown> };
        if (failure?.code === "UNAUTHENTICATED") setToken(null);
        reject(new ApiError(failure?.code ?? "INTERNAL", failure?.message ?? "", res.statusCode, failure?.details));
      },
      fail(error) {
        reject(new ApiError("NETWORK", `网络请求失败：${error.errMsg ?? ""}`, 0));
      },
    });
  });
}

export const api = {
  get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const header: Record<string, string> = { "content-type": "application/json" };
      const token = getToken();
      if (token) header.Authorization = `Bearer ${token}`;
      wx.request({
        url: buildUrl(path, query),
        method: "GET",
        header,
        timeout: 15000,
        success(res) {
          const payload = res.data as { success: boolean; data?: T; code?: string; message?: string };
          if (payload?.success) resolve(payload.data as T);
          else {
            if (payload?.code === "UNAUTHENTICATED") setToken(null);
            reject(new ApiError(payload?.code ?? "INTERNAL", payload?.message ?? "", res.statusCode));
          }
        },
        fail(error) {
          reject(new ApiError("NETWORK", `网络请求失败：${error.errMsg ?? ""}`, 0));
        },
      });
    });
  },
  post<T>(path: string, data?: Record<string, unknown>): Promise<T> {
    return request<T>(path, { method: "POST", data: data ?? {} });
  },
  patch<T>(path: string, data?: Record<string, unknown>): Promise<T> {
    return request<T>(path, { method: "PATCH", data: data ?? {} });
  },
};

/** 统一的错误提示：把稳定错误码翻成中文弹出来。 */
export function toastError(error: unknown): void {
  const message = error instanceof ApiError ? error.message : "操作没有成功，请稍后重试";
  wx.showToast({ title: message, icon: "none", duration: 2600 });
}

export function toast(title: string, icon: "success" | "none" = "none"): void {
  wx.showToast({ title, icon, duration: 2000 });
}

/** wx.login 换 code，失败时抛出可读错误。 */
export function wxLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => (res.code ? resolve(res.code) : reject(new ApiError("INTERNAL", "微信登录失败", 0))),
      fail: () => reject(new ApiError("INTERNAL", "微信登录失败", 0)),
    });
  });
}
