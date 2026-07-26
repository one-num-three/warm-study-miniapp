/**
 * 接口契约。H5 和小程序照着这里的路径与出入参调用，服务端照着实现，
 * 改动这里会同时让三边编译报错 —— 这就是把契约放在 shared 里的目的。
 */

import type {
  DailySession,
  HomeworkItem,
  HomeworkItemStatus,
  HomeworkSheet,
  HomeworkStatus,
  LeaderboardRow,
  LedgerType,
  MistakeStatus,
  PickupReminder,
  PointLedgerEntry,
  Product,
  ProductStatus,
  Profile,
  Role,
  SessionStatus,
  Student,
  StudentGuardian,
  User,
} from "./types.js";

export const API_PREFIX = "/api";

/* ------------------------------- 身份与登录 ------------------------------- */

export interface LoginRequest {
  /** wechat：小程序 wx.login 拿到的 code；device：H5 浏览器持久化的设备标识 */
  loginType: "wechat" | "device";
  code: string;
  /** 首次进入时的称呼，可选 */
  displayName?: string;
}

export interface LoginResponse {
  token: string;
  profile: Profile;
}

export interface StaffLoginRequest {
  username: string;
  password: string;
}

/** 家长用绑定码绑定孩子 —— 本项目的核心流程 */
export interface BindByCodeRequest {
  bindingCode: string;
  /** 与孩子的关系：妈妈 / 爸爸 / 爷爷 …… */
  relation: string;
  /** 家长自己的称呼，首次绑定时顺便补上 */
  guardianName?: string;
}

export interface BindByCodeResponse {
  status: "已通过" | "待审核";
  student: { id: string; name: string; nickname: string; grade: string };
  relation: string;
  profile: Profile;
}

/* --------------------------------- 学生 --------------------------------- */

export interface CreateStudentRequest {
  name: string;
  nickname?: string;
  grade: string;
  note?: string;
  publicRanking?: boolean;
}

/** 新增学生的返回：绑定码在这里第一次、也是唯一一次被"生成" */
export interface CreateStudentResponse {
  student: Student;
  /** 展示用的带短横形式，例如 K3M9-QX2T */
  bindingCodeDisplay: string;
}

export interface UpdateStudentRequest {
  name?: string;
  nickname?: string;
  grade?: string;
  note?: string;
  publicRanking?: boolean;
  status?: "active" | "disabled";
}

export interface StudentDetail extends Student {
  guardians: Array<{
    bindingId: string;
    userId: string;
    displayName: string;
    relation: string;
    status: StudentGuardian["status"];
    createdAt: string;
  }>;
}

/* --------------------------------- 作业 --------------------------------- */

export interface CreateSheetRequest {
  studentId: string;
  dateKey?: string;
  items: Array<{ subject: string; content: string; image?: string }>;
}

export interface SheetDetail extends HomeworkSheet {
  items: HomeworkItem[];
  studentName: string;
  studentNickname: string;
}

export interface UpdateItemStatusRequest {
  status: HomeworkItemStatus;
  reason?: string;
}

export interface FinishSheetRequest {
  status: Extract<HomeworkStatus, "已完成" | "未完成">;
  feedback: string;
  unfinishedReason?: string;
  /** 结束作业时顺手发的积分，0 表示不发 */
  rewardPoints?: number;
  requestId: string;
}

/* ------------------------------ 今日到班状态 ------------------------------ */

export interface TransitionSessionRequest {
  studentId: string;
  to: SessionStatus;
  reason?: string;
  dateKey?: string;
}

export interface TodayStudentRow {
  studentId: string;
  name: string;
  nickname: string;
  grade: string;
  session: DailySession;
  sheet?: Pick<HomeworkSheet, "id" | "status" | "rewarded"> | null;
  pointBalance: number;
  lastReminderAt?: string | null;
}

/* -------------------------------- 接娃提醒 -------------------------------- */

export interface SendPickupNoticeRequest {
  studentId: string;
  /** 15 / 30 / 60，或直接给 HH:mm */
  minutes?: number;
  etaAt?: string;
  /** 同一 ETA 重复发送时必须显式确认 */
  confirmDuplicate?: boolean;
  requestId: string;
}

export interface SendPickupNoticeResponse {
  reminder: PickupReminder;
  duplicate: boolean;
}

/* --------------------------------- 积分 --------------------------------- */

export interface GrantPointsRequest {
  studentId: string;
  delta: number;
  type: LedgerType;
  reason: string;
  sourceRef?: string;
  requestId: string;
}

export interface ReverseLedgerRequest {
  ledgerId: string;
  reason: string;
  requestId: string;
}

export interface LedgerPage {
  entries: PointLedgerEntry[];
  balance: number;
  /** 流水重算出的余额，与 balance 不一致说明有问题 */
  computedBalance: number;
}

/* -------------------------------- 排行榜 -------------------------------- */

export type LeaderboardPeriod = "week" | "month" | "lifetime";

export interface LeaderboardResponse {
  period: LeaderboardPeriod;
  range: { start: string; end: string } | null;
  rows: LeaderboardRow[];
}

/* --------------------------------- 商店 --------------------------------- */

export interface UpsertProductRequest {
  name: string;
  description?: string;
  pointsCost: number;
  stock: number;
  perStudentLimit?: number;
  tone?: Product["tone"];
  status?: ProductStatus;
  image?: string;
}

export interface RedeemRequest {
  studentId: string;
  productId: string;
  requestId: string;
}

export interface ReverseRedemptionRequest {
  reason: string;
  /**
   * 可选。撤销的幂等性由兑换记录自身的状态保证：
   * 已经是「已撤销」的记录再撤会直接返回 DUPLICATE_REQUEST，
   * 所以这里不强制客户端生成请求 ID。
   */
  requestId?: string;
}

/* --------------------------------- 错题 --------------------------------- */

export interface UpsertWrongQuestionRequest {
  studentId: string;
  subject: string;
  knowledge: string;
  reason?: string;
  answer?: string;
  note?: string;
  image?: string;
}

export interface TransitionWrongQuestionRequest {
  to: MistakeStatus;
}

/* --------------------------------- 管理 --------------------------------- */

export interface CreateStaffRequest {
  username: string;
  password: string;
  displayName: string;
  permissions?: string[];
}

export interface UpdateStaffRequest {
  displayName?: string;
  permissions?: string[];
  status?: "active" | "disabled";
  roles?: Role[];
  password?: string;
}

export interface ReviewBindingRequest {
  decision: "approve" | "reject";
  reason?: string;
}

export interface StaffRow extends Pick<User, "id" | "displayName" | "roles" | "status"> {
  username: string | null;
  permissions: string[];
}

/* --------------------------- 各接口的路径与方法 --------------------------- */

export const ENDPOINTS = {
  health: { method: "GET", path: "/health" },

  login: { method: "POST", path: "/auth/login" },
  staffLogin: { method: "POST", path: "/auth/staff-login" },
  logout: { method: "POST", path: "/auth/logout" },
  profile: { method: "GET", path: "/auth/profile" },

  bindByCode: { method: "POST", path: "/bindings/by-code" },
  previewBindingCode: { method: "GET", path: "/bindings/preview" },
  listBindings: { method: "GET", path: "/bindings" },
  reviewBinding: { method: "POST", path: "/bindings/:id/review" },
  releaseBinding: { method: "POST", path: "/bindings/:id/release" },

  listStudents: { method: "GET", path: "/students" },
  createStudent: { method: "POST", path: "/students" },
  getStudent: { method: "GET", path: "/students/:id" },
  updateStudent: { method: "PATCH", path: "/students/:id" },
  resetBindingCode: { method: "POST", path: "/students/:id/binding-code/reset" },
  toggleBindingCode: { method: "POST", path: "/students/:id/binding-code/toggle" },

  dashboard: { method: "GET", path: "/dashboard" },
  todayStudents: { method: "GET", path: "/sessions/today" },
  transitionSession: { method: "POST", path: "/sessions/transition" },

  listSheets: { method: "GET", path: "/homework/sheets" },
  createSheet: { method: "POST", path: "/homework/sheets" },
  getSheet: { method: "GET", path: "/homework/sheets/:id" },
  transitionSheet: { method: "POST", path: "/homework/sheets/:id/transition" },
  updateItemStatus: { method: "POST", path: "/homework/items/:id/status" },
  finishSheet: { method: "POST", path: "/homework/sheets/:id/finish" },

  sendPickupNotice: { method: "POST", path: "/reminders" },
  listReminders: { method: "GET", path: "/reminders" },

  listLedger: { method: "GET", path: "/points/ledger" },
  grantPoints: { method: "POST", path: "/points/grant" },
  reverseLedger: { method: "POST", path: "/points/reverse" },
  reconcile: { method: "GET", path: "/points/reconcile" },

  leaderboard: { method: "GET", path: "/leaderboard" },

  listProducts: { method: "GET", path: "/products" },
  createProduct: { method: "POST", path: "/products" },
  updateProduct: { method: "PATCH", path: "/products/:id" },
  redeem: { method: "POST", path: "/redemptions" },
  listRedemptions: { method: "GET", path: "/redemptions" },
  reverseRedemption: { method: "POST", path: "/redemptions/:id/reverse" },

  listWrongQuestions: { method: "GET", path: "/wrong-questions" },
  createWrongQuestion: { method: "POST", path: "/wrong-questions" },
  updateWrongQuestion: { method: "PATCH", path: "/wrong-questions/:id" },
  transitionWrongQuestion: { method: "POST", path: "/wrong-questions/:id/transition" },

  listStaff: { method: "GET", path: "/staff" },
  createStaff: { method: "POST", path: "/staff" },
  updateStaff: { method: "PATCH", path: "/staff/:id" },

  listAudit: { method: "GET", path: "/audit" },
  getSettings: { method: "GET", path: "/settings" },
  updateSettings: { method: "PATCH", path: "/settings" },
} as const;

/** 前端调用时用它把 :id 填进路径。 */
export function buildPath(
  template: string,
  params: Record<string, string | number> = {},
): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`路径参数缺失: ${key}`);
    return encodeURIComponent(String(value));
  });
}

/** 系统设置项的键名与默认值。 */
export const SETTING_KEYS = {
  /** 用绑定码绑定后是否还要负责人审核。默认 false —— 输码即绑定。 */
  BINDING_REQUIRES_REVIEW: "binding.requiresReview",
  /** 人工调整积分的大额阈值，超过要二次确认 */
  POINTS_ADJUST_THRESHOLD: "points.adjustThreshold",
  /** 作业完成默认奖励分 */
  HOMEWORK_DEFAULT_REWARD: "points.homeworkDefaultReward",
  /** 商品库存低于此值在看板告警 */
  LOW_STOCK_THRESHOLD: "store.lowStockThreshold",
  /** 家长端排行榜是否显示真实姓名（默认脱敏） */
  LEADERBOARD_SHOW_REAL_NAME: "leaderboard.showRealName",
} as const;

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  [SETTING_KEYS.BINDING_REQUIRES_REVIEW]: false,
  [SETTING_KEYS.POINTS_ADJUST_THRESHOLD]: 50,
  [SETTING_KEYS.HOMEWORK_DEFAULT_REWARD]: 10,
  [SETTING_KEYS.LOW_STOCK_THRESHOLD]: 3,
  [SETTING_KEYS.LEADERBOARD_SHOW_REAL_NAME]: false,
};
