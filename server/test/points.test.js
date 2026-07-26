/** 积分域：发放、人工调整、冲正、对账、排行榜口径。这里管的是"钱"，测得最细。 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
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

/** 新建一个学生，返回学生对象 */
async function createStudent(name, nickname) {
  const data = ok(
    await post(
      ctx.base,
      "/students",
      { name, grade: "三年级", ...(nickname ? { nickname } : {}) },
      ownerToken,
    ),
    `新建学生 ${name}`,
  );
  return data.student;
}

/** 发一笔积分，requestId 默认自动生成 */
async function grant(token, studentId, delta, type, reason, extra = {}) {
  return post(
    ctx.base,
    "/points/grant",
    { studentId, delta, type, reason, requestId: reqId("grant"), ...extra },
    token,
  );
}

async function ledgerOf(studentId) {
  return ok(await get(ctx.base, `/points/ledger?studentId=${studentId}`, ownerToken), "查流水");
}

async function board(token, period = "week") {
  return ok(await get(ctx.base, `/leaderboard?period=${period}`, token), "查排行榜");
}

function rowOf(leaderboard, studentId) {
  return leaderboard.rows.find((row) => row.studentId === studentId) ?? null;
}

async function findProduct(name) {
  const list = ok(await get(ctx.base, "/products", ownerToken), "查商品");
  const found = list.find((product) => product.name === name);
  assert.ok(found, `没有找到商品「${name}」`);
  return found;
}

/* --------------------------------- 发放 --------------------------------- */

test("老师能发正分，但不能人工调整、不能发负分", async () => {
  const student = await createStudent("发分对象");

  const granted = ok(
    await grant(staffToken, student.id, 12, "表现奖励", "主动擦黑板"),
    "老师发正分",
  );
  assert.equal(granted.balanceAfter, 12);
  assert.equal(granted.deduplicated, false);
  const firstEntry = (await ledgerOf(student.id)).entries[0];
  assert.equal(firstEntry.delta, 12);
  assert.equal(firstEntry.type, "表现奖励");
  assert.equal(firstEntry.reason, "主动擦黑板");

  // 负分属于人工调整，老师没有 points.adjust
  failsWith(
    await grant(staffToken, student.id, -5, "表现奖励", "扣掉一点"),
    "FORBIDDEN",
    "老师发负分",
  );
  // 类型写成人工调整也不行
  failsWith(
    await grant(staffToken, student.id, 5, "人工调整", "老师想手动调"),
    "FORBIDDEN",
    "老师人工调整",
  );
  // 兑换扣除 / 撤销冲正 只能由业务流程产生
  failsWith(
    await grant(ownerToken, student.id, -5, "兑换扣除", "手写一笔扣除"),
    "INVALID_ARGUMENT",
    "手写兑换扣除",
  );
  failsWith(
    await grant(ownerToken, student.id, 5, "撤销冲正", "手写一笔冲正"),
    "INVALID_ARGUMENT",
    "手写撤销冲正",
  );

  assert.equal((await ledgerOf(student.id)).balance, 12, "被拒的请求不应影响余额");
});

test("负责人可以人工调整积分，正负都行", async () => {
  const student = await createStudent("人工调整");

  const plus = ok(
    await grant(ownerToken, student.id, 30, "人工调整", "补录上周漏发的分"),
    "负责人加分",
  );
  assert.equal(plus.balanceAfter, 30);

  const minus = ok(
    await grant(ownerToken, student.id, -10, "人工调整", "上周多发了 10 分"),
    "负责人扣分",
  );
  assert.equal(minus.balanceAfter, 20);

  const ledger = await ledgerOf(student.id);
  assert.equal(ledger.balance, 20);
  assert.equal(ledger.computedBalance, 20);
  assert.deepEqual(
    ledger.entries.map((entry) => entry.delta).sort((a, b) => a - b),
    [-10, 30],
  );
});

test("超过阈值（默认 50 分）的人工调整必须二次确认", async () => {
  const student = await createStudent("大额调整");

  const blocked = failsWith(
    await grant(ownerToken, student.id, 60, "人工调整", "一次性补发学期奖励"),
    "INVALID_STATE",
    "大额加分没确认",
  );
  assert.equal(blocked.details.threshold, 50);
  assert.equal(blocked.details.requiresConfirm, true);
  assert.equal((await ledgerOf(student.id)).balance, 0, "没确认前不该落库");

  const confirmed = ok(
    await grant(ownerToken, student.id, 60, "人工调整", "一次性补发学期奖励", {
      confirmed: true,
    }),
    "确认后加分",
  );
  assert.equal(confirmed.balanceAfter, 60);

  // 大额扣分同样要确认
  failsWith(
    await grant(ownerToken, student.id, -55, "人工调整", "一次性扣回"),
    "INVALID_STATE",
    "大额扣分没确认",
  );
  const back = ok(
    await grant(ownerToken, student.id, -55, "人工调整", "一次性扣回", { confirmed: true }),
    "确认后扣分",
  );
  assert.equal(back.balanceAfter, 5);

  // 阈值以内不需要确认
  const small = ok(await grant(ownerToken, student.id, 50, "人工调整", "刚好卡在阈值上"));
  assert.equal(small.balanceAfter, 55);
});

test("余额不能被扣成负数", async () => {
  const student = await createStudent("余额不足");
  const failure = failsWith(
    await grant(ownerToken, student.id, -10, "人工调整", "凭空扣分"),
    "INSUFFICIENT_POINTS",
    "余额 0 时扣分",
  );
  assert.equal(failure.details.balance, 0);
  assert.equal(failure.details.required, 10);

  ok(await grant(staffToken, student.id, 20, "表现奖励", "先发 20 分"));
  failsWith(
    await grant(ownerToken, student.id, -21, "人工调整", "扣超一分也不行"),
    "INSUFFICIENT_POINTS",
    "扣超余额",
  );
  const exact = ok(await grant(ownerToken, student.id, -20, "人工调整", "刚好扣光"));
  assert.equal(exact.balanceAfter, 0, "扣到 0 是允许的");

  const ledger = await ledgerOf(student.id);
  assert.equal(ledger.entries.length, 2, "被拒的扣分不留流水");
});

test("同一个 requestId 重复发分只记一笔", async () => {
  const student = await createStudent("幂等发分");
  const requestId = reqId("idem-grant");

  const first = ok(
    await grant(staffToken, student.id, 15, "表现奖励", "课堂表现好", { requestId }),
    "第一次发分",
  );
  assert.equal(first.deduplicated, false);
  assert.equal(first.balanceAfter, 15);

  const second = ok(
    await grant(staffToken, student.id, 15, "表现奖励", "课堂表现好", { requestId }),
    "重复提交",
  );
  assert.equal(second.deduplicated, true, "应命中幂等键");
  assert.equal(second.entryId, first.entryId, "返回的还是第一次那条流水");
  assert.equal(second.balanceAfter, 15);

  const ledger = await ledgerOf(student.id);
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.balance, 15);
  assert.equal(ledger.computedBalance, 15);
});

/* --------------------------------- 冲正 --------------------------------- */

test("负责人冲正一条流水：原流水标记已冲正、新增反向流水、余额回退", async () => {
  const student = await createStudent("冲正对象");
  const granted = ok(
    await grant(staffToken, student.id, 45, "表现奖励", "帮老师搬书"),
    "先发一笔",
  );
  assert.equal(granted.balanceAfter, 45);

  const reversed = ok(
    await post(
      ctx.base,
      "/points/reverse",
      { ledgerId: granted.entryId, reason: "记错学生了" },
      ownerToken,
    ),
    "冲正",
  );
  assert.equal(reversed.balanceAfter, 0);

  const ledger = await ledgerOf(student.id);
  assert.equal(ledger.balance, 0);
  assert.equal(ledger.computedBalance, 0);
  assert.equal(ledger.entries.length, 2, "流水永不删除，冲正是写一条反向流水");

  const original = ledger.entries.find((entry) => entry.id === granted.entryId);
  assert.equal(original.reversed, true, "原流水应被标记为已冲正");
  assert.equal(original.delta, 45, "原流水金额不会被改写");

  const reversal = ledger.entries.find((entry) => entry.reversalOf === granted.entryId);
  assert.ok(reversal, "应有一条指回原流水的反向流水");
  assert.equal(reversal.delta, -45);
  assert.equal(reversal.type, "撤销冲正");
  assert.equal(reversal.id, reversed.entryId);
});

test("同一条流水不能被冲正两次", async () => {
  const student = await createStudent("重复冲正");
  const granted = ok(await grant(staffToken, student.id, 20, "表现奖励", "背诵过关"));
  ok(
    await post(
      ctx.base,
      "/points/reverse",
      { ledgerId: granted.entryId, reason: "发错了" },
      ownerToken,
    ),
  );
  failsWith(
    await post(
      ctx.base,
      "/points/reverse",
      { ledgerId: granted.entryId, reason: "再冲一次" },
      ownerToken,
    ),
    "DUPLICATE_REQUEST",
    "第二次冲正",
  );
  assert.equal((await ledgerOf(student.id)).entries.length, 2, "不该多出流水");
});

test("老师无权冲正流水", async () => {
  const student = await createStudent("老师冲正");
  const granted = ok(await grant(staffToken, student.id, 10, "表现奖励", "回答问题积极"));
  failsWith(
    await post(
      ctx.base,
      "/points/reverse",
      { ledgerId: granted.entryId, reason: "我想撤回" },
      staffToken,
    ),
    "FORBIDDEN",
    "老师冲正",
  );
  const ledger = await ledgerOf(student.id);
  assert.equal(ledger.balance, 10, "余额不受影响");
  assert.equal(ledger.entries[0].reversed, false);
});

/* -------------------------------- 排行榜 -------------------------------- */

test("周榜按周期内的正向积分排名，零分学生不上榜", async () => {
  const first = await createStudent("周榜甲");
  const second = await createStudent("周榜乙");
  const third = await createStudent("周榜丙");
  const zero = await createStudent("周榜零分");

  ok(await grant(ownerToken, first.id, 300, "表现奖励", "本周之星"));
  ok(await grant(ownerToken, second.id, 200, "表现奖励", "进步很大"));
  ok(await grant(ownerToken, third.id, 100, "表现奖励", "按时完成"));

  const week = await board(ownerToken, "week");
  assert.equal(week.period, "week");
  assert.match(week.range.start, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(week.range.end, /^\d{4}-\d{2}-\d{2}$/);

  assert.equal(rowOf(week, first.id).score, 300);
  assert.equal(rowOf(week, second.id).score, 200);
  assert.equal(rowOf(week, third.id).score, 100);
  assert.ok(
    rowOf(week, first.id).rank < rowOf(week, second.id).rank,
    "300 分应排在 200 分前面",
  );
  assert.ok(rowOf(week, second.id).rank < rowOf(week, third.id).rank);
  assert.equal(rowOf(week, zero.id), null, "没有得分的学生不该出现在榜上");

  // 总榜同样能查
  const lifetime = await board(ownerToken, "lifetime");
  assert.equal(lifetime.period, "lifetime");
  assert.equal(lifetime.range, null);
  assert.equal(rowOf(lifetime, first.id).score, 300);

  // 周期参数非法直接拒绝
  failsWith(await get(ctx.base, "/leaderboard?period=year", ownerToken), "INVALID_ARGUMENT");
});

test("兑换扣分不降低当期排名（花积分不掉排名）", async () => {
  const spender = await createStudent("爱花分的娃");
  const saver = await createStudent("攒着不花的娃");

  ok(await grant(staffToken, spender.id, 100, "表现奖励", "本周全勤"));
  ok(await grant(staffToken, saver.id, 90, "表现奖励", "本周表现好"));

  const before = await board(ownerToken, "week");
  assert.equal(rowOf(before, spender.id).score, 100);
  assert.ok(rowOf(before, spender.id).rank < rowOf(before, saver.id).rank);

  // 花掉 70 分，余额只剩 30，比对手的 90 还少
  const pencil = await findProduct("自动铅笔"); // 35 分
  ok(
    await post(
      ctx.base,
      "/redemptions",
      { studentId: spender.id, productId: pencil.id, requestId: reqId("rank-rdm") },
      staffToken,
    ),
    "第一次兑换",
  );
  ok(
    await post(
      ctx.base,
      "/redemptions",
      { studentId: spender.id, productId: pencil.id, requestId: reqId("rank-rdm") },
      staffToken,
    ),
    "第二次兑换",
  );
  assert.equal((await ledgerOf(spender.id)).balance, 30, "余额确实被扣了");

  const after = await board(ownerToken, "week");
  assert.equal(rowOf(after, spender.id).score, 100, "兑换扣除不计入当期积分");
  assert.ok(
    rowOf(after, spender.id).rank < rowOf(after, saver.id).rank,
    "花掉积分不应该掉名次",
  );
});

test("被冲正的原始流水不计入排名", async () => {
  const student = await createStudent("冲正掉榜");
  const granted = ok(await grant(ownerToken, student.id, 60, "表现奖励", "误发给了这个孩子"));
  assert.equal(rowOf(await board(ownerToken, "week"), student.id).score, 60);

  ok(
    await post(
      ctx.base,
      "/points/reverse",
      { ledgerId: granted.entryId, reason: "发错人了" },
      ownerToken,
    ),
  );

  assert.equal(
    rowOf(await board(ownerToken, "week"), student.id),
    null,
    "原流水被冲正、反向流水也不计分，孩子应从榜上消失",
  );
});

test("排行榜在家长端脱敏，在管理端显示真实姓名", async () => {
  const withNickname = await createStudent("有昵称的娃", "小昵");
  const withoutNickname = await createStudent("无昵称娃");

  ok(await grant(ownerToken, withNickname.id, 120, "表现奖励", "作业全对"));
  ok(await grant(ownerToken, withoutNickname.id, 110, "表现奖励", "作业全对"));

  const parentToken = await loginGuardian(ctx.base, "device-board-parent", "围观家长");
  const parentBoard = await board(parentToken, "week");
  assert.equal(rowOf(parentBoard, withNickname.id).displayName, "小昵", "有昵称就用昵称");
  assert.equal(
    rowOf(parentBoard, withoutNickname.id).displayName,
    "无**娃",
    "没昵称就用脱敏姓名",
  );

  const adminBoard = await board(ownerToken, "week");
  assert.equal(rowOf(adminBoard, withNickname.id).displayName, "有昵称的娃");
  assert.equal(rowOf(adminBoard, withoutNickname.id).displayName, "无昵称娃");
});

test("家长端能认出「我家孩子」，管理端不标记", async () => {
  const created = ok(
    await post(ctx.base, "/students", { name: "自家娃", grade: "二年级" }, ownerToken),
  );
  ok(await grant(ownerToken, created.student.id, 140, "表现奖励", "本周表现优异"));

  const parentToken = await loginGuardian(ctx.base, "device-board-self", "自家家长");
  ok(
    await post(
      ctx.base,
      "/bindings/by-code",
      { bindingCode: created.bindingCodeDisplay, relation: "妈妈" },
      parentToken,
    ),
  );

  const parentBoard = await board(parentToken, "week");
  assert.equal(rowOf(parentBoard, created.student.id).isSelf, true);
  const adminBoard = await board(ownerToken, "week");
  assert.equal(rowOf(adminBoard, created.student.id).isSelf, false);
});

test("设为不公开排行的学生在家长端消失，管理端仍然可见", async () => {
  const student = await createStudent("低调同学");
  ok(await grant(ownerToken, student.id, 130, "表现奖励", "默默努力"));

  const parentToken = await loginGuardian(ctx.base, "device-board-private", "路人家长");
  assert.ok(rowOf(await board(parentToken, "week"), student.id), "默认是公开的");

  ok(
    await patch(ctx.base, `/students/${student.id}`, { publicRanking: false }, ownerToken),
    "设为不公开",
  );

  assert.equal(
    rowOf(await board(parentToken, "week"), student.id),
    null,
    "家长端榜上应看不到",
  );
  const adminRow = rowOf(await board(ownerToken, "week"), student.id);
  assert.ok(adminRow, "管理端仍然要能看到");
  assert.equal(adminRow.score, 130);
});

/* --------------------------------- 对账 --------------------------------- */

test("对账接口在跑完这一堆操作后没有任何差异", async () => {
  const report = ok(await get(ctx.base, "/points/reconcile", ownerToken), "对账");
  assert.ok(report.checked > 0, "应该检查到学生");
  assert.deepEqual(report.mismatches, [], "缓存余额和流水汇总不该有差异");
  for (const item of report.items) {
    assert.equal(item.cached, item.computed, `${item.name} 的余额对不上`);
    assert.ok(item.cached >= 0, `${item.name} 的余额不该为负`);
  }
});
