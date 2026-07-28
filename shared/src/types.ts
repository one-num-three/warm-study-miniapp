/** 领域模型定义。服务端、H5、小程序三处共用同一套类型。 */

export type Role = "owner" | "staff" | "guardian";

export type AccountStatus = "active" | "disabled";

/** 每日辅导状态机（design.md §5） */
export type SessionStatus = "待到班" | "已到班" | "辅导中" | "待接" | "已接走";
export const SESSION_STATUSES: SessionStatus[] = [
  "待到班",
  "已到班",
  "辅导中",
  "待接",
  "已接走",
];

/** 作业单状态机 */
export type HomeworkStatus = "待确认" | "需要补充" | "辅导中" | "已完成" | "未完成" | "已撤回";
export const HOMEWORK_STATUSES: HomeworkStatus[] = [
  "待确认",
  "需要补充",
  "辅导中",
  "已完成",
  "未完成",
  "已撤回",
];

/** 作业单内单个科目项的状态 */
export type HomeworkItemStatus = "待开始" | "进行中" | "已完成" | "未完成";
export const HOMEWORK_ITEM_STATUSES: HomeworkItemStatus[] = [
  "待开始",
  "进行中",
  "已完成",
  "未完成",
];

/** 错题状态机 */
export type MistakeStatus = "待订正" | "已订正" | "已掌握";
export const MISTAKE_STATUSES: MistakeStatus[] = ["待订正", "已订正", "已掌握"];

/** 商品状态机 */
export type ProductStatus = "草稿" | "上架" | "下架";
export const PRODUCT_STATUSES: ProductStatus[] = ["草稿", "上架", "下架"];

/** 积分流水类型。兑换扣除为负，其余按业务定。 */
export type LedgerType =
  | "作业奖励"
  | "表现奖励"
  | "错题订正"
  | "兑换扣除"
  | "人工调整"
  | "撤销冲正";
export const LEDGER_TYPES: LedgerType[] = [
  "作业奖励",
  "表现奖励",
  "错题订正",
  "兑换扣除",
  "人工调整",
  "撤销冲正",
];

export type BindingStatus = "待审核" | "已通过" | "已拒绝" | "已解除";

export type RedemptionStatus = "已完成" | "已撤销";

export type NoticeStatus = "已发送" | "发送失败" | "结果未知" | "待授权";

export interface User {
  id: string;
  /** 微信 OPENID 的哈希（或 H5 端的设备身份哈希）。原值永不返回客户端。 */
  identityHash: string;
  displayName: string;
  roles: Role[];
  status: AccountStatus;
  /** 管理端登录名，仅 owner/staff 有 */
  username?: string | null;
  avatarText?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Student {
  id: string;
  name: string;
  nickname: string;
  grade: string;
  status: AccountStatus;
  /** 服务端生成的唯一固定绑定码，规范形式（无短横） */
  bindingCode: string;
  /** 绑定码是否可用；负责人可停用 */
  bindingCodeEnabled: boolean;
  bindingCodeIssuedAt: string;
  /** 积分余额缓存值，真值永远是 point_ledger 的汇总 */
  pointBalance: number;
  /** 是否参与公开排行榜 */
  publicRanking: boolean;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentGuardian {
  id: string;
  studentId: string;
  guardianUserId: string;
  relation: string;
  status: BindingStatus;
  /** 通过绑定码直接绑定，还是走了人工审核 */
  source: "binding_code" | "manual";
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  createdAt: string;
}

export interface DailySession {
  id: string;
  studentId: string;
  /** yyyy-MM-dd（辅导班本地时区） */
  dateKey: string;
  status: SessionStatus;
  arrivalAt?: string | null;
  tutoringAt?: string | null;
  readyAt?: string | null;
  pickupAt?: string | null;
  updatedBy?: string | null;
  updatedAt: string;
}

export interface HomeworkSheet {
  id: string;
  studentId: string;
  dateKey: string;
  status: HomeworkStatus;
  feedback?: string | null;
  /** 是否已经因这张作业单发过积分，防重复发放 */
  rewarded: boolean;
  submittedBy: string;
  submittedAt: string;
  finishedBy?: string | null;
  finishedAt?: string | null;
  unfinishedReason?: string | null;
  updatedAt: string;
}

export interface HomeworkItem {
  id: string;
  sheetId: string;
  subject: string;
  content: string;
  status: HomeworkItemStatus;
  /** dataURL 或云存储 fileId */
  image?: string | null;
  updatedBy?: string | null;
  updatedAt: string;
}

export interface PickupReminder {
  id: string;
  sessionId: string;
  studentId: string;
  /** HH:mm，预计可接时间 */
  etaAt: string;
  status: NoticeStatus;
  senderId: string;
  idempotencyKey: string;
  failReason?: string | null;
  createdAt: string;
}

export interface PointLedgerEntry {
  id: string;
  studentId: string;
  delta: number;
  type: LedgerType;
  reason: string;
  /** 关联业务对象，例如 sheet:xxx / redemption:xxx */
  sourceRef?: string | null;
  /** 写入时的余额快照，用于对账 */
  balanceAfter: number;
  operatorId: string;
  /** 被冲正后置为 true，原流水永久保留 */
  reversed: boolean;
  /** 本条是哪条流水的冲正 */
  reversalOf?: string | null;
  idempotencyKey?: string | null;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  image?: string | null;
  pointsCost: number;
  stock: number;
  status: ProductStatus;
  /** 每个学生的限兑次数，0 表示不限 */
  perStudentLimit: number;
  tone: "sun" | "leaf" | "clay";
  createdAt: string;
  updatedAt: string;
}

/** 兑换时对商品的快照，商品后续改价不影响历史记录 */
export interface ProductSnapshot {
  id: string;
  name: string;
  pointsCost: number;
  image?: string | null;
}

export interface Redemption {
  id: string;
  studentId: string;
  productSnapshot: ProductSnapshot;
  pointsCost: number;
  status: RedemptionStatus;
  operatorId: string;
  requestId: string;
  ledgerId: string;
  reversedAt?: string | null;
  reversedBy?: string | null;
  reversalLedgerId?: string | null;
  createdAt: string;
}

export interface WrongQuestion {
  id: string;
  studentId: string;
  creatorId: string;
  subject: string;
  knowledge: string;
  reason?: string | null;
  answer?: string | null;
  note?: string | null;
  image?: string | null;
  status: MistakeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WrongQuestionEvent {
  id: string;
  wrongQuestionId: string;
  fromStatus: MistakeStatus | null;
  toStatus: MistakeStatus;
  operatorId: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestId: string;
  createdAt: string;
}

export interface SystemSetting {
  key: string;
  value: unknown;
  updatedBy?: string | null;
  updatedAt: string;
}

/** 排行榜一行 */
export interface LeaderboardRow {
  rank: number;
  studentId: string;
  /** 家长端只看得到昵称或脱敏姓名 */
  displayName: string;
  score: number;
  isSelf?: boolean;
}

/** 登录后返回的完整身份档案 */
export interface Profile {
  userId: string;
  displayName: string;
  roles: Role[];
  status: AccountStatus;
  permissions: string[];
  /** 家长身份下已通过审核的孩子 */
  students: Array<Pick<Student, "id" | "name" | "nickname" | "grade" | "pointBalance"> & {
    relation: string;
  }>;
  /** 待审核的绑定申请 */
  pendingBindings: Array<{ studentName: string; relation: string; createdAt: string }>;
}

/** 统一响应包 */
export interface ApiSuccess<T> {
  success: true;
  requestId: string;
  data: T;
}

export interface ApiFailure {
  success: false;
  requestId: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** 管理端今日看板指标（requirements §5） */
export interface DashboardSummary {
  dateKey: string;
  sessionCounts: Record<SessionStatus, number>;
  homework: {
    notSubmitted: number;
    pending: number;
    inProgress: number;
    finished: number;
    finishedButUnrewarded: number;
  };
  remindedNotPickedUp: number;
  pendingBindings: number;
  lowStockProducts: number;
}
