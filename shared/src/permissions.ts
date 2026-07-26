/** 权限代码表（design.md §7.1）。Owner 拥有全部权限，Staff 默认拥有一个子集。 */

import type { Role } from "./types.js";

export const PERMISSIONS = {
  STUDENT_READ_ALL: "student.read_all",
  STUDENT_MANAGE: "student.manage",
  BINDING_REVIEW: "binding.review",
  BINDING_CODE_MANAGE: "binding_code.manage",
  HOMEWORK_MANAGE: "homework.manage",
  SESSION_MANAGE: "session.manage",
  NOTIFICATION_SEND: "notification.send",
  POINTS_GRANT: "points.grant",
  POINTS_ADJUST: "points.adjust",
  POINTS_REVERSE: "points.reverse",
  PRODUCT_MANAGE: "product.manage",
  REDEMPTION_CREATE: "redemption.create",
  REDEMPTION_REVERSE: "redemption.reverse",
  MISTAKE_MANAGE_ALL: "mistake.manage_all",
  STAFF_MANAGE: "staff.manage",
  AUDIT_READ: "audit.read",
  SETTINGS_MANAGE: "settings.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** 老师默认权限：能跑完日常流程，但碰不到钱、权限和审计。 */
export const DEFAULT_STAFF_PERMISSIONS: Permission[] = [
  PERMISSIONS.STUDENT_READ_ALL,
  PERMISSIONS.HOMEWORK_MANAGE,
  PERMISSIONS.SESSION_MANAGE,
  PERMISSIONS.NOTIFICATION_SEND,
  PERMISSIONS.POINTS_GRANT,
  PERMISSIONS.REDEMPTION_CREATE,
  PERMISSIONS.MISTAKE_MANAGE_ALL,
];

/** 只有负责人能拿到的权限，界面上对老师直接隐藏。 */
export const OWNER_ONLY_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter(
  (permission) => !DEFAULT_STAFF_PERMISSIONS.includes(permission),
);

/** 权限的中文名，用于管理端权限勾选界面。 */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "student.read_all": "查看全部学员",
  "student.manage": "维护学员档案",
  "binding.review": "审核家长绑定",
  "binding_code.manage": "管理绑定码",
  "homework.manage": "处理作业",
  "session.manage": "管理今日到班状态",
  "notification.send": "发送接娃提醒",
  "points.grant": "发放积分",
  "points.adjust": "人工调整积分",
  "points.reverse": "冲正积分流水",
  "product.manage": "管理商品与库存",
  "redemption.create": "现场兑换",
  "redemption.reverse": "撤销兑换",
  "mistake.manage_all": "管理全部错题",
  "staff.manage": "管理老师账号",
  "audit.read": "查看审计日志",
  "settings.manage": "系统设置",
};

export function permissionsForRoles(roles: Role[], grantedToStaff?: Permission[]): Permission[] {
  if (roles.includes("owner")) return [...ALL_PERMISSIONS];
  if (roles.includes("staff")) return [...(grantedToStaff ?? DEFAULT_STAFF_PERMISSIONS)];
  return [];
}

export function hasPermission(permissions: readonly string[], required: Permission): boolean {
  return permissions.includes(required);
}

export function hasAnyPermission(
  permissions: readonly string[],
  required: readonly Permission[],
): boolean {
  return required.some((permission) => permissions.includes(permission));
}

/** 是否是管理端身份（老师或负责人） */
export function isManagementRole(roles: readonly Role[]): boolean {
  return roles.includes("owner") || roles.includes("staff");
}
