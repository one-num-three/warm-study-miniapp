/**
 * 权限边界、账号管控、审计留痕，以及到班 / 提醒 / 错题这几处的越权防线。
 * 这些是"谁能动什么"的底线，出问题就是事故，所以逐个用真实接口验。
 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
} from "@warm-study/shared";
import {
  call,
  failsWith,
  get,
  loginGuardian,
  loginOwner,
  loginStaff,
  ok,
  patch,
  post,
  reqId,
  startTestServer,
} from "./helpers.js";

let ctx;
let ownerToken;
let staffToken;

before(async () => {
  ctx = await startTestServer();
  ownerToken = await loginOwner(ctx.base);
  staffToken = await loginStaff(ctx.base);
});

after(async () => {
  await ctx.close();
});

/** 新建学生，返回 { student, bindingCodeDisplay } */
async function createStudent(name, grade = "三年级") {
  return ok(await post(ctx.base, "/students", { name, grade }, ownerToken), `新建学生 ${name}`);
}

/** 给一个学生绑一位家长，返回家长 token */
async function bindGuardian(created, deviceId, relation = "妈妈") {
  const token = await loginGuardian(ctx.base, deviceId, "测试家长");
  ok(
    await post(
      ctx.base,
      "/bindings/by-code",
      { bindingCode: created.bindingCodeDisplay, relation },
      token,
    ),
    "绑定孩子",
  );
  return token;
}

async function grantPoints(studentId, delta, token = staffToken) {
  return post(
    ctx.base,
    "/points/grant",
    { studentId, delta, type: "表现奖励", reason: "测试发分", requestId: reqId("perm") },
    token,
  );
}

async function findProduct(name) {
  const list = ok(await get(ctx.base, "/products", ownerToken), "查商品");
  const found = list.find((product) => product.name === name);
  assert.ok(found, `没有找到商品「${name}」`);
  return found;
}

/* ------------------------------- 权限矩阵 ------------------------------- */

test("老师的权限清单就是默认的那 7 项，负责人拥有全部", async () => {
  const staffProfile = ok(await get(ctx.base, "/auth/profile", staffToken), "老师档案");
  assert.deepEqual([...staffProfile.permissions].sort(), [...DEFAULT_STAFF_PERMISSIONS].sort());
  assert.deepEqual(staffProfile.roles, ["staff"]);
  for (const permission of OWNER_ONLY_PERMISSIONS) {
    assert.equal(
      staffProfile.permissions.includes(permission),
      false,
      `老师不该有 ${permission}`,
    );
  }

  const ownerProfile = ok(await get(ctx.base, "/auth/profile", ownerToken), "负责人档案");
  assert.deepEqual([...ownerProfile.permissions].sort(), [...ALL_PERMISSIONS].sort());

  // 家长没有任何管理端权限
  const parentToken = await loginGuardian(ctx.base, "device-perm-profile", "无权家长");
  const parentProfile = ok(await get(ctx.base, "/auth/profile", parentToken));
  assert.deepEqual(parentProfile.permissions, []);
});

test("老师有的 7 项权限，逐个用真实接口验证都调得通", async () => {
  const created = await createStudent("权限矩阵甲");
  const studentId = created.student.id;
  const guardianToken = await bindGuardian(created, "device-perm-matrix");

  // student.read_all
  const students = ok(await get(ctx.base, "/students", staffToken), "student.read_all");
  assert.ok(students.some((item) => item.id === studentId));

  // homework.manage
  const sheet = ok(
    await post(
      ctx.base,
      "/homework/sheets",
      { studentId, items: [{ subject: "语文", content: "读课文" }] },
      guardianToken,
    ),
  );
  const afterItem = ok(
    await post(
      ctx.base,
      `/homework/items/${sheet.items[0].id}/status`,
      { status: "进行中" },
      staffToken,
    ),
    "homework.manage",
  );
  assert.equal(afterItem.status, "辅导中");

  // session.manage
  const session = ok(
    await post(ctx.base, "/sessions/transition", { studentId, to: "已到班" }, staffToken),
    "session.manage",
  );
  assert.equal(session.status, "已到班");

  // notification.send
  const notice = ok(
    await post(
      ctx.base,
      "/reminders",
      { studentId, etaAt: "17:20", requestId: reqId("perm") },
      staffToken,
    ),
    "notification.send",
  );
  assert.equal(notice.delivered, true);

  // points.grant
  const granted = ok(await grantPoints(studentId, 60), "points.grant");
  assert.equal(granted.balanceAfter, 60);

  // redemption.create
  const product = await findProduct("贴纸大礼包");
  const redeemed = ok(
    await post(
      ctx.base,
      "/redemptions",
      { studentId, productId: product.id, requestId: reqId("perm") },
      staffToken,
    ),
    "redemption.create",
  );
  assert.equal(redeemed.redemption.status, "已完成");

  // mistake.manage_all：改的是家长创建的错题
  const mistake = ok(
    await post(
      ctx.base,
      "/wrong-questions",
      { studentId, subject: "数学", knowledge: "进位加法" },
      guardianToken,
    ),
  );
  const updated = ok(
    await patch(
      ctx.base,
      `/wrong-questions/${mistake.id}`,
      { note: "老师补充：再练十道" },
      staffToken,
    ),
    "mistake.manage_all",
  );
  assert.equal(updated.note, "老师补充：再练十道");
});

test("老师没有的 9 项权限，逐个用真实接口验证都被拒", async () => {
  const created = await createStudent("权限矩阵乙");
  const studentId = created.student.id;
  const granted = ok(await grantPoints(studentId, 40));
  const product = await findProduct("贴纸大礼包");
  const redeemed = ok(
    await post(
      ctx.base,
      "/redemptions",
      { studentId, productId: product.id, requestId: reqId("perm") },
      staffToken,
    ),
  );

  // student.manage
  failsWith(
    await post(ctx.base, "/students", { name: "老师建的", grade: "一年级" }, staffToken),
    "FORBIDDEN",
    "student.manage",
  );
  // binding.review
  failsWith(await get(ctx.base, "/bindings", staffToken), "FORBIDDEN", "binding.review");
  // binding_code.manage（顺带验一下，老师也碰不到绑定码）
  failsWith(
    await post(ctx.base, `/students/${studentId}/binding-code/reset`, { reason: "试试" }, staffToken),
    "FORBIDDEN",
    "binding_code.manage",
  );
  // points.adjust
  failsWith(
    await post(
      ctx.base,
      "/points/grant",
      {
        studentId,
        delta: 10,
        type: "人工调整",
        reason: "我想手动调",
        requestId: reqId("perm"),
      },
      staffToken,
    ),
    "FORBIDDEN",
    "points.adjust",
  );
  // points.reverse
  failsWith(
    await post(
      ctx.base,
      "/points/reverse",
      { ledgerId: granted.entryId, reason: "我想撤回" },
      staffToken,
    ),
    "FORBIDDEN",
    "points.reverse",
  );
  // product.manage
  failsWith(
    await post(ctx.base, "/products", { name: "老师上架的", pointsCost: 5, stock: 1 }, staffToken),
    "FORBIDDEN",
    "product.manage",
  );
  // redemption.reverse
  failsWith(
    await post(
      ctx.base,
      `/redemptions/${redeemed.redemption.id}/reverse`,
      { reason: "我想撤销" },
      staffToken,
    ),
    "FORBIDDEN",
    "redemption.reverse",
  );
  // staff.manage
  failsWith(await get(ctx.base, "/staff", staffToken), "FORBIDDEN", "staff.manage");
  failsWith(
    await post(
      ctx.base,
      "/staff",
      { username: "hacker", password: "warm2026", displayName: "自己加的" },
      staffToken,
    ),
    "FORBIDDEN",
    "staff.manage 建号",
  );
  // audit.read
  failsWith(await get(ctx.base, "/audit", staffToken), "FORBIDDEN", "audit.read");
  // settings.manage
  failsWith(
    await patch(ctx.base, "/settings", { "points.adjustThreshold": 9999 }, staffToken),
    "FORBIDDEN",
    "settings.manage",
  );
  // 仅负责人的对账接口
  failsWith(await get(ctx.base, "/points/reconcile", staffToken), "FORBIDDEN", "对账");

  // 一通试探之后，数据一点没变
  const settings = ok(await get(ctx.base, "/settings", ownerToken));
  assert.equal(settings["points.adjustThreshold"], 50);
  assert.equal(
    ok(await get(ctx.base, `/points/ledger?studentId=${studentId}`, ownerToken)).balance,
    25,
  );
});

test("家长完全拿不到管理端接口，未登录一律 UNAUTHENTICATED", async () => {
  const created = await createStudent("家长越权");
  const parentToken = await bindGuardian(created, "device-perm-parent");

  for (const path of [
    "/students",
    "/dashboard",
    "/sessions/today",
    "/staff",
    "/audit",
    "/bindings",
    "/points/reconcile",
  ]) {
    failsWith(await get(ctx.base, path, parentToken), "FORBIDDEN", `家长 GET ${path}`);
  }
  failsWith(
    await post(
      ctx.base,
      "/sessions/transition",
      { studentId: created.student.id, to: "已到班" },
      parentToken,
    ),
    "FORBIDDEN",
    "家长改到班状态",
  );
  failsWith(
    await post(
      ctx.base,
      "/reminders",
      { studentId: created.student.id, etaAt: "17:00", requestId: reqId("perm") },
      parentToken,
    ),
    "FORBIDDEN",
    "家长发接娃提醒",
  );
  failsWith(
    await post(ctx.base, "/products", { name: "家长上架", pointsCost: 1, stock: 1 }, parentToken),
    "FORBIDDEN",
    "家长上架商品",
  );
  failsWith(
    await patch(ctx.base, "/settings", { "points.adjustThreshold": 1 }, parentToken),
    "FORBIDDEN",
    "家长改设置",
  );
  // 连自家孩子也不能自己发分
  failsWith(
    await grantPoints(created.student.id, 100, parentToken),
    "FORBIDDEN",
    "家长给自家娃发分",
  );

  // 完全没登录
  for (const path of ["/students", "/audit", "/staff", "/homework/sheets", "/leaderboard"]) {
    failsWith(await get(ctx.base, path), "UNAUTHENTICATED", `未登录 GET ${path}`);
  }
});

/* ------------------------------- 账号管控 ------------------------------- */

test("负责人停用老师账号后，该老师的 token 立刻失效", async () => {
  const staff = ok(
    await post(
      ctx.base,
      "/staff",
      { username: "temp-teacher", password: "warm2026", displayName: "临时老师" },
      ownerToken,
    ),
    "新建老师账号",
  );
  const tempToken = ok(
    await post(ctx.base, "/auth/staff-login", { username: "temp-teacher", password: "warm2026" }),
    "临时老师登录",
  ).token;
  ok(await get(ctx.base, "/students", tempToken), "停用前应能访问");

  ok(await patch(ctx.base, `/staff/${staff.id}`, { status: "disabled" }, ownerToken), "停用账号");

  failsWith(await get(ctx.base, "/students", tempToken), "UNAUTHENTICATED", "停用后旧 token");
  failsWith(await get(ctx.base, "/auth/profile", tempToken), "UNAUTHENTICATED", "停用后查档案");
  failsWith(
    await post(ctx.base, "/auth/staff-login", { username: "temp-teacher", password: "warm2026" }),
    "FORBIDDEN",
    "停用后重新登录",
  );

  // 老账号不受影响
  ok(await get(ctx.base, "/students", staffToken), "别的老师照常工作");
});

test("最后一名负责人既不能被停用也不能被降权", async () => {
  const staffList = ok(await get(ctx.base, "/staff", ownerToken), "老师列表");
  const owner = staffList.find((item) => item.username === "owner");
  assert.ok(owner, "应该有 owner 账号");
  assert.ok(owner.roles.includes("owner"));

  failsWith(
    await patch(ctx.base, `/staff/${owner.id}`, { status: "disabled" }, ownerToken),
    "LAST_OWNER_PROTECTED",
    "停用最后一名负责人",
  );
  failsWith(
    await patch(ctx.base, `/staff/${owner.id}`, { roles: ["staff"] }, ownerToken),
    "LAST_OWNER_PROTECTED",
    "把最后一名负责人降成老师",
  );

  // 负责人还活着，接口照常
  ok(await get(ctx.base, "/audit", ownerToken), "负责人仍可读审计");
  const stillOwner = ok(await get(ctx.base, "/staff", ownerToken)).find(
    (item) => item.username === "owner",
  );
  assert.equal(stillOwner.status, "active");
  assert.ok(stillOwner.roles.includes("owner"));
});

/* -------------------------------- 审计日志 -------------------------------- */

test("敏感操作全部写审计，只有负责人能读，且没有任何删除入口", async () => {
  const created = await createStudent("留痕同学", "二年级");
  const studentId = created.student.id;

  // 重置绑定码
  ok(
    await post(
      ctx.base,
      `/students/${studentId}/binding-code/reset`,
      { reason: "码被贴到家长群了" },
      ownerToken,
    ),
  );
  // 人工调整积分
  ok(
    await post(
      ctx.base,
      "/points/grant",
      {
        studentId,
        delta: 20,
        type: "人工调整",
        reason: "期末补发",
        requestId: reqId("audit"),
      },
      ownerToken,
    ),
  );
  // 撤销兑换
  const product = await findProduct("贴纸大礼包");
  const redeemed = ok(
    await post(
      ctx.base,
      "/redemptions",
      { studentId, productId: product.id, requestId: reqId("audit") },
      staffToken,
    ),
  );
  ok(
    await post(
      ctx.base,
      `/redemptions/${redeemed.redemption.id}/reverse`,
      { reason: "孩子拿错了" },
      ownerToken,
    ),
  );
  // 停用学员
  ok(await patch(ctx.base, `/students/${studentId}`, { status: "disabled" }, ownerToken));

  const logs = ok(await get(ctx.base, "/audit?limit=500", ownerToken), "读审计");
  const onStudent = logs
    .filter((log) => log.target === `student:${studentId}`)
    .map((log) => log.action);
  assert.ok(onStudent.includes("student.create"), "建学员要留痕");
  assert.ok(onStudent.includes("binding_code.reset"), "重置绑定码要留痕");
  assert.ok(onStudent.includes("points.adjust"), "人工调整积分要留痕");
  assert.ok(onStudent.includes("student.status"), "停用学员要留痕");
  assert.ok(
    logs.some((log) => log.target === `redemption:${redeemed.redemption.id}` && log.action === "redemption.reverse"),
    "撤销兑换要留痕",
  );

  // 审计内容要有实际信息，不是空壳
  const resetLog = logs.find(
    (log) => log.target === `student:${studentId}` && log.action === "binding_code.reset",
  );
  assert.equal(resetLog.reason, "码被贴到家长群了");
  assert.equal(resetLog.actorName, "王负责人");
  assert.ok(resetLog.before.bindingCode && resetLog.after.bindingCode);
  assert.notEqual(resetLog.before.bindingCode, resetLog.after.bindingCode);
  assert.ok(resetLog.requestId, "审计要能追回请求");

  // 老师和家长都读不到
  failsWith(await get(ctx.base, "/audit", staffToken), "FORBIDDEN", "老师读审计");
  const parentToken = await loginGuardian(ctx.base, "device-perm-audit", "好奇家长");
  failsWith(await get(ctx.base, "/audit", parentToken), "FORBIDDEN", "家长读审计");

  // 审计只增不删：路由表里根本不存在删除入口
  const deleteAll = await call(ctx.base, "DELETE", "/audit", { token: ownerToken });
  assert.equal(deleteAll.body.success, false);
  assert.equal(deleteAll.body.code, "NOT_FOUND");
  const deleteOne = await call(ctx.base, "DELETE", `/audit/${logs[0].id}`, { token: ownerToken });
  assert.equal(deleteOne.body.code, "NOT_FOUND");
  // PATCH 改审计同样没有入口
  assert.equal(
    (await patch(ctx.base, `/audit/${logs[0].id}`, { action: "改掉" }, ownerToken)).body.code,
    "NOT_FOUND",
  );

  // 条数只会变多，不会变少
  const later = ok(await get(ctx.base, "/audit?limit=500", ownerToken));
  assert.ok(later.length >= logs.length);
});

/* ------------------------------ 今日到班状态机 ------------------------------ */

test("今日到班状态机：老师可以一路正向推进，非法跳跃被拒", async () => {
  const created = await createStudent("到班推进");
  const studentId = created.student.id;

  for (const to of ["已到班", "辅导中", "待接", "已接走"]) {
    const session = ok(
      await post(ctx.base, "/sessions/transition", { studentId, to }, staffToken),
      `推进到${to}`,
    );
    assert.equal(session.status, to);
  }
  const today = ok(await get(ctx.base, "/sessions/today", staffToken)).find(
    (item) => item.studentId === studentId,
  );
  assert.equal(today.session.status, "已接走");
  assert.ok(today.session.arrivalAt && today.session.pickupAt);

  // 「待到班」不能一步跳到「已接走」
  const jumper = await createStudent("到班跳跃");
  failsWith(
    await post(
      ctx.base,
      "/sessions/transition",
      { studentId: jumper.student.id, to: "已接走" },
      staffToken,
    ),
    "INVALID_STATE",
    "待到班→已接走",
  );
});

test("「已接走 → 待接」的回退老师做不了，负责人可以但必须填原因", async () => {
  const created = await createStudent("接走纠错");
  const studentId = created.student.id;
  for (const to of ["已到班", "辅导中", "待接", "已接走"]) {
    ok(await post(ctx.base, "/sessions/transition", { studentId, to }, staffToken));
  }

  failsWith(
    await post(
      ctx.base,
      "/sessions/transition",
      { studentId, to: "待接", reason: "标错了" },
      staffToken,
    ),
    "FORBIDDEN",
    "老师回退已接走",
  );
  failsWith(
    await post(ctx.base, "/sessions/transition", { studentId, to: "待接" }, ownerToken),
    "INVALID_ARGUMENT",
    "负责人回退但没填原因",
  );

  const fixed = ok(
    await post(
      ctx.base,
      "/sessions/transition",
      { studentId, to: "待接", reason: "家长还没到，接走标早了" },
      ownerToken,
    ),
    "负责人带原因回退",
  );
  assert.equal(fixed.status, "待接");
  assert.equal(fixed.pickupAt, null, "回退时要清掉接走时间，别留矛盾数据");

  // 纠错要留审计
  const logs = ok(await get(ctx.base, "/audit?action=session.correct&limit=500", ownerToken));
  const record = logs.find((log) => log.target === `session:${fixed.id}`);
  assert.ok(record, "回退应写审计");
  assert.equal(record.reason, "家长还没到，接走标早了");
  assert.equal(record.before.status, "已接走");
  assert.equal(record.after.status, "待接");
});

/* -------------------------------- 接娃提醒 -------------------------------- */

test("同一学生同一时间重复发接娃提醒要二次确认", async () => {
  const created = await createStudent("提醒重复");
  const studentId = created.student.id;
  await bindGuardian(created, "device-perm-remind");

  const first = ok(
    await post(
      ctx.base,
      "/reminders",
      { studentId, etaAt: "17:40", requestId: reqId("rem") },
      staffToken,
    ),
    "第一次提醒",
  );
  assert.equal(first.delivered, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.reminder.etaAt, "17:40");
  assert.equal(first.reminder.status, "已发送");

  const blocked = failsWith(
    await post(
      ctx.base,
      "/reminders",
      { studentId, etaAt: "17:40", requestId: reqId("rem") },
      staffToken,
    ),
    "DUPLICATE_REQUEST",
    "重复同一个 ETA",
  );
  assert.equal(blocked.details.etaAt, "17:40");

  const confirmed = ok(
    await post(
      ctx.base,
      "/reminders",
      { studentId, etaAt: "17:40", requestId: reqId("rem"), confirmDuplicate: true },
      staffToken,
    ),
    "二次确认后再发",
  );
  assert.equal(confirmed.duplicate, true);
  assert.equal(confirmed.delivered, true);

  // 换个时间就不算重复
  const other = ok(
    await post(
      ctx.base,
      "/reminders",
      { studentId, etaAt: "18:10", requestId: reqId("rem") },
      staffToken,
    ),
    "换个 ETA",
  );
  assert.equal(other.duplicate, false);

  const list = ok(await get(ctx.base, `/reminders?studentId=${studentId}`, staffToken));
  assert.equal(list.length, 3, "三次成功的提醒都应留下记录");
});

test("没有已绑定家长的学生发提醒时明确返回 delivered:false，不伪装成成功", async () => {
  const created = await createStudent("没人绑");
  const result = ok(
    await post(
      ctx.base,
      "/reminders",
      { studentId: created.student.id, etaAt: "17:40", requestId: reqId("rem") },
      staffToken,
    ),
    "给没绑家长的孩子发提醒",
  );
  assert.equal(result.delivered, false, "没有家长能收到就不能报成功");
  assert.equal(result.reminder.status, "待授权");
  assert.match(result.reminder.failReason, /还没有家长完成绑定/);
  assert.match(result.reminder.etaAt, /^([01]\d|2[0-3]):[0-5]\d$/);

  // ETA 格式不对直接拒
  failsWith(
    await post(
      ctx.base,
      "/reminders",
      { studentId: created.student.id, etaAt: "25:99", requestId: reqId("rem") },
      staffToken,
    ),
    "INVALID_ARGUMENT",
    "非法 ETA",
  );
});

/* --------------------------------- 错题 --------------------------------- */

test("错题：家长只能改自己创建的，老师有 mistake.manage_all 能改全部", async () => {
  const created = await createStudent("错题娃");
  const studentId = created.student.id;
  const momToken = await bindGuardian(created, "device-perm-wq-mom", "妈妈");
  const dadToken = await bindGuardian(created, "device-perm-wq-dad", "爸爸");

  const byMom = ok(
    await post(
      ctx.base,
      "/wrong-questions",
      { studentId, subject: "数学", knowledge: "退位减法", reason: "借位忘了" },
      momToken,
    ),
    "妈妈记一道错题",
  );
  assert.equal(byMom.status, "待订正");

  // 妈妈改自己记的 —— 可以
  const mine = ok(
    await patch(ctx.base, `/wrong-questions/${byMom.id}`, { note: "再练五道" }, momToken),
    "妈妈改自己的",
  );
  assert.equal(mine.note, "再练五道");

  // 爸爸虽然也绑了同一个孩子，但改不了妈妈记的
  failsWith(
    await patch(ctx.base, `/wrong-questions/${byMom.id}`, { note: "我来改" }, dadToken),
    "FORBIDDEN",
    "爸爸改妈妈记的错题",
  );
  failsWith(
    await post(ctx.base, `/wrong-questions/${byMom.id}/transition`, { to: "已订正" }, dadToken),
    "FORBIDDEN",
    "爸爸推进妈妈记的错题",
  );

  // 老师有 mistake.manage_all，谁记的都能改
  const byStaff = ok(
    await patch(
      ctx.base,
      `/wrong-questions/${byMom.id}`,
      { answer: "标准答案见课本 P30" },
      staffToken,
    ),
    "老师改家长记的错题",
  );
  assert.equal(byStaff.answer, "标准答案见课本 P30");
  const settled = ok(
    await post(ctx.base, `/wrong-questions/${byMom.id}/transition`, { to: "已订正" }, staffToken),
    "老师推进状态",
  );
  assert.equal(settled.status, "已订正");

  // 老师记的错题，家长同样改不了
  const byTeacher = ok(
    await post(
      ctx.base,
      "/wrong-questions",
      { studentId, subject: "语文", knowledge: "多音字" },
      staffToken,
    ),
  );
  failsWith(
    await patch(ctx.base, `/wrong-questions/${byTeacher.id}`, { note: "家长改" }, momToken),
    "FORBIDDEN",
    "家长改老师记的错题",
  );

  // 没绑这个孩子的家长连碰都碰不到
  const strangerToken = await loginGuardian(ctx.base, "device-perm-wq-stranger", "路人家长");
  failsWith(
    await patch(ctx.base, `/wrong-questions/${byMom.id}`, { note: "路人来改" }, strangerToken),
    "FORBIDDEN",
    "陌生家长改错题",
  );
  failsWith(
    await get(ctx.base, `/wrong-questions?studentId=${studentId}`, strangerToken),
    "FORBIDDEN",
    "陌生家长查错题",
  );
  assert.equal(
    ok(await get(ctx.base, "/wrong-questions", strangerToken)).length,
    0,
    "不带过滤时也只能看到自己孩子的（这里是空）",
  );
});
