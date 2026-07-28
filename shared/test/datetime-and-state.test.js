import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STAFF_PERMISSIONS,
  HOMEWORK_TRANSITIONS,
  MISTAKE_TRANSITIONS,
  PERMISSIONS,
  SESSION_TRANSITIONS,
  allItemsSettled,
  checkTransition,
  compactStamp,
  dateKeyOfIso,
  etaAfterMinutes,
  isDateKeyInRange,
  isRedeemable,
  isValidTimeLabel,
  monthRange,
  nextTransitions,
  permissionsForRoles,
  toDateKey,
  toTimeLabel,
  weekRange,
} from "../dist/index.js";

/* ------------------------------- 时间 ------------------------------- */

test("dateKey 按 UTC+8 划分，跨零点边界正确", () => {
  // UTC 07-25 16:00 = 北京时间 07-26 00:00
  assert.equal(toDateKey(new Date("2026-07-25T16:00:00.000Z")), "2026-07-26");
  // UTC 07-25 15:59 = 北京时间 07-25 23:59
  assert.equal(toDateKey(new Date("2026-07-25T15:59:00.000Z")), "2026-07-25");
});

test("时刻标签按 UTC+8", () => {
  assert.equal(toTimeLabel(new Date("2026-07-26T09:05:00.000Z")), "17:05");
  assert.equal(toTimeLabel(new Date("2026-07-26T16:00:00.000Z")), "00:00");
});

test("ETA 计算", () => {
  const base = new Date("2026-07-26T09:00:00.000Z"); // 北京 17:00
  assert.equal(etaAfterMinutes(15, base), "17:15");
  assert.equal(etaAfterMinutes(30, base), "17:30");
  assert.equal(etaAfterMinutes(60, base), "18:00");
  // 跨零点
  assert.equal(etaAfterMinutes(60 * 8, base), "01:00");
});

test("HH:mm 校验", () => {
  assert.equal(isValidTimeLabel("00:00"), true);
  assert.equal(isValidTimeLabel("23:59"), true);
  assert.equal(isValidTimeLabel("24:00"), false);
  assert.equal(isValidTimeLabel("9:00"), false);
  assert.equal(isValidTimeLabel("18:60"), false);
});

test("周范围以周一为开始", () => {
  // 2026-07-26 是周日
  const range = weekRange(new Date("2026-07-26T02:00:00.000Z"));
  assert.deepEqual(range, { start: "2026-07-20", end: "2026-07-26" });
  // 2026-07-20 是周一
  assert.deepEqual(weekRange(new Date("2026-07-20T02:00:00.000Z")), {
    start: "2026-07-20",
    end: "2026-07-26",
  });
});

test("月范围覆盖整月", () => {
  assert.deepEqual(monthRange(new Date("2026-07-15T02:00:00.000Z")), {
    start: "2026-07-01",
    end: "2026-07-31",
  });
  // 2 月（2026 非闰年）
  assert.deepEqual(monthRange(new Date("2026-02-10T02:00:00.000Z")), {
    start: "2026-02-01",
    end: "2026-02-28",
  });
});

test("闭区间判断", () => {
  assert.equal(isDateKeyInRange("2026-07-20", "2026-07-20", "2026-07-26"), true);
  assert.equal(isDateKeyInRange("2026-07-26", "2026-07-20", "2026-07-26"), true);
  assert.equal(isDateKeyInRange("2026-07-27", "2026-07-20", "2026-07-26"), false);
});

test("紧凑时间戳与 ISO → dateKey", () => {
  assert.equal(compactStamp("2026-07-26T09:05:00.000Z"), "07-26 17:05");
  assert.equal(dateKeyOfIso("2026-07-25T16:00:00.000Z"), "2026-07-26");
});

/* ------------------------------ 状态机 ------------------------------ */

test("辅导状态正向流转合法", () => {
  assert.equal(checkTransition(SESSION_TRANSITIONS, "待到班", "已到班").allowed, true);
  assert.equal(checkTransition(SESSION_TRANSITIONS, "已到班", "辅导中").allowed, true);
  assert.equal(checkTransition(SESSION_TRANSITIONS, "辅导中", "待接").allowed, true);
  assert.equal(checkTransition(SESSION_TRANSITIONS, "待接", "已接走").allowed, true);
});

test("辅导状态非法跳跃被拒", () => {
  assert.equal(checkTransition(SESSION_TRANSITIONS, "待到班", "已接走").allowed, false);
  assert.equal(checkTransition(SESSION_TRANSITIONS, "待到班", "待到班").allowed, false);
  assert.equal(checkTransition(SESSION_TRANSITIONS, "已接走", "待到班").allowed, false);
});

test("已接走 → 待接 属于纠错，需要负责人权限", () => {
  const check = checkTransition(SESSION_TRANSITIONS, "已接走", "待接");
  assert.equal(check.allowed, true);
  assert.equal(check.requiresCorrectionRight, true);
});

test("界面按钮默认不含纠错项", () => {
  const normal = nextTransitions(SESSION_TRANSITIONS, "已接走");
  assert.equal(normal.length, 0);
  const withCorrections = nextTransitions(SESSION_TRANSITIONS, "已接走", {
    includeCorrections: true,
  });
  assert.equal(withCorrections.length, 1);
});

test("作业单：待确认 ⇄ 需要补充", () => {
  assert.equal(checkTransition(HOMEWORK_TRANSITIONS, "待确认", "需要补充").allowed, true);
  assert.equal(checkTransition(HOMEWORK_TRANSITIONS, "需要补充", "待确认").allowed, true);
  // 辅导中之后不能再撤回
  assert.equal(checkTransition(HOMEWORK_TRANSITIONS, "辅导中", "已撤回").allowed, false);
});

test("错题：已掌握可以打回待订正", () => {
  assert.equal(checkTransition(MISTAKE_TRANSITIONS, "已掌握", "待订正").allowed, true);
  assert.equal(checkTransition(MISTAKE_TRANSITIONS, "待订正", "已掌握").allowed, false);
});

test("作业项全部终结才能结束当天作业", () => {
  assert.equal(allItemsSettled(["已完成", "已完成"]), true);
  assert.equal(allItemsSettled(["已完成", "未完成"]), true);
  assert.equal(allItemsSettled(["已完成", "进行中"]), false);
  assert.equal(allItemsSettled([]), false);
});

test("库存为 0 时派生为不可兑换", () => {
  assert.equal(isRedeemable("上架", 3), true);
  assert.equal(isRedeemable("上架", 0), false);
  assert.equal(isRedeemable("下架", 5), false);
});

/* ------------------------------ 权限 ------------------------------ */

test("负责人拥有全部权限", () => {
  const owner = permissionsForRoles(["owner"]);
  assert.ok(owner.includes(PERMISSIONS.AUDIT_READ));
  assert.ok(owner.includes(PERMISSIONS.REDEMPTION_REVERSE));
  assert.ok(owner.includes(PERMISSIONS.POINTS_ADJUST));
});

test("老师默认拿不到钱和审计相关权限", () => {
  const staff = permissionsForRoles(["staff"]);
  assert.ok(staff.includes(PERMISSIONS.POINTS_GRANT), "老师应能发积分");
  assert.ok(staff.includes(PERMISSIONS.REDEMPTION_CREATE), "老师应能现场兑换");
  assert.equal(staff.includes(PERMISSIONS.POINTS_ADJUST), false);
  assert.equal(staff.includes(PERMISSIONS.POINTS_REVERSE), false);
  assert.equal(staff.includes(PERMISSIONS.REDEMPTION_REVERSE), false);
  assert.equal(staff.includes(PERMISSIONS.AUDIT_READ), false);
  assert.equal(staff.includes(PERMISSIONS.STAFF_MANAGE), false);
  assert.equal(staff.includes(PERMISSIONS.BINDING_REVIEW), false);
});

test("家长没有管理端权限", () => {
  assert.deepEqual(permissionsForRoles(["guardian"]), []);
});

test("可以给老师单独授予额外权限", () => {
  const granted = permissionsForRoles(["staff"], [...DEFAULT_STAFF_PERMISSIONS, PERMISSIONS.PRODUCT_MANAGE]);
  assert.ok(granted.includes(PERMISSIONS.PRODUCT_MANAGE));
});
