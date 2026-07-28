/**
 * 稳定错误码 —— 前端按码显示中文提示，永远不向用户暴露内部异常栈。
 * 对应 specs/tutoring-miniapp-v1/design.md §13.1，并按绑定码流程做了扩充。
 */
export const ERROR_CODES = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  INVALID_STATE: "INVALID_STATE",
  DUPLICATE_REQUEST: "DUPLICATE_REQUEST",
  CONFLICT: "CONFLICT",
  INSUFFICIENT_POINTS: "INSUFFICIENT_POINTS",
  OUT_OF_STOCK: "OUT_OF_STOCK",
  REDEEM_LIMIT_REACHED: "REDEEM_LIMIT_REACHED",
  NOTICE_PERMISSION_REQUIRED: "NOTICE_PERMISSION_REQUIRED",
  /** 绑定码格式不合法（长度、字符集或校验位不通过） */
  BINDING_CODE_INVALID: "BINDING_CODE_INVALID",
  /** 绑定码格式合法但系统里没有对应学生 */
  BINDING_CODE_NOT_FOUND: "BINDING_CODE_NOT_FOUND",
  /** 绑定码被负责人停用 */
  BINDING_CODE_DISABLED: "BINDING_CODE_DISABLED",
  /** 该家长已经绑定过这个孩子 */
  BINDING_ALREADY_EXISTS: "BINDING_ALREADY_EXISTS",
  /** 绑定申请已提交，等待负责人审核 */
  BINDING_PENDING_REVIEW: "BINDING_PENDING_REVIEW",
  /** 尝试次数过多，暂时锁定 */
  TOO_MANY_ATTEMPTS: "TOO_MANY_ATTEMPTS",
  /** 系统硬约束：最后一名有效负责人不可停用或降权 */
  LAST_OWNER_PROTECTED: "LAST_OWNER_PROTECTED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** 错误码 → 面向用户的中文提示。两端共用，保证同一个码在小程序和 H5 上说法一致。 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "登录状态已失效，请重新登录",
  FORBIDDEN: "你没有执行该操作的权限",
  NOT_FOUND: "没有找到对应的数据",
  INVALID_ARGUMENT: "提交的内容不完整或格式不正确",
  INVALID_STATE: "当前状态下不能执行该操作",
  DUPLICATE_REQUEST: "该操作已经处理过了，请勿重复提交",
  CONFLICT: "数据刚刚被其他人改动，请刷新后重试",
  INSUFFICIENT_POINTS: "孩子的积分余额不足",
  OUT_OF_STOCK: "该商品库存不足",
  REDEEM_LIMIT_REACHED: "已达到该商品的限兑次数",
  NOTICE_PERMISSION_REQUIRED: "家长尚未授权接收通知，请改用电话或微信联系",
  BINDING_CODE_INVALID: "绑定码格式不正确，请检查是否输错",
  BINDING_CODE_NOT_FOUND: "绑定码不存在，请向辅导班老师确认",
  BINDING_CODE_DISABLED: "该绑定码已被停用，请联系负责人",
  BINDING_ALREADY_EXISTS: "你已经绑定过这个孩子了",
  BINDING_PENDING_REVIEW: "绑定申请已提交，请等待负责人审核",
  TOO_MANY_ATTEMPTS: "尝试次数过多，请稍后再试",
  LAST_OWNER_PROTECTED: "系统必须保留至少一名负责人，不能停用最后一名负责人",
  INTERNAL: "服务开小差了，请稍后重试",
};

export interface AppErrorOptions {
  /** 附加的结构化信息，例如 { retryAfterSeconds: 60 } */
  details?: Record<string, unknown>;
  /** HTTP 状态码，缺省按错误码推断 */
  httpStatus?: number;
  cause?: unknown;
}

const DEFAULT_HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_ARGUMENT: 400,
  INVALID_STATE: 409,
  DUPLICATE_REQUEST: 409,
  CONFLICT: 409,
  INSUFFICIENT_POINTS: 409,
  OUT_OF_STOCK: 409,
  REDEEM_LIMIT_REACHED: 409,
  NOTICE_PERMISSION_REQUIRED: 403,
  BINDING_CODE_INVALID: 400,
  BINDING_CODE_NOT_FOUND: 404,
  BINDING_CODE_DISABLED: 403,
  BINDING_ALREADY_EXISTS: 409,
  BINDING_PENDING_REVIEW: 202,
  TOO_MANY_ATTEMPTS: 429,
  LAST_OWNER_PROTECTED: 409,
  INTERNAL: 500,
};

/** 业务异常。服务端捕获后统一转成 { success:false, code, message, requestId }。 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message?: string, options: AppErrorOptions = {}) {
    super(message ?? ERROR_MESSAGES[code] ?? code, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? DEFAULT_HTTP_STATUS[code] ?? 400;
    this.details = options.details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** 把任意错误码翻译成中文提示，未知码回落到通用文案。 */
export function messageForCode(code: string): string {
  return (ERROR_MESSAGES as Record<string, string>)[code] ?? ERROR_MESSAGES.INTERNAL;
}
