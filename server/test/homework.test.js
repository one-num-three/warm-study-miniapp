/** 作业域：家长提交作业单 → 老师逐项推进 → 结束当天并发积分。 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import {
  failsWith,
  get,
  loginGuardian,
  loginOwner,
  loginStaff,
  ok,
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

/** 新建一个学生并让一位家长绑定，返回 { student, guardianToken } */
async function studentWithGuardian(name, deviceId) {
  const created = ok(
    await post(ctx.base, "/students", { name, grade: "三年级" }, ownerToken),
    "新建学生",
  );
  const guardianToken = await loginGuardian(ctx.base, deviceId, `${name}妈妈`);
  ok(
    await post(
      ctx.base,
      "/bindings/by-code",
      { bindingCode: created.bindingCodeDisplay, relation: "妈妈" },
      guardianToken,
    ),
    "绑定孩子",
  );
  return { student: created.student, guardianToken };
}

/** 家长提交一张作业单 */
async function submitSheet(guardianToken, studentId, items, dateKey) {
  return post(
    ctx.base,
    "/homework/sheets",
    { studentId, items, ...(dateKey ? { dateKey } : {}) },
    guardianToken,
  );
}

/** 老师把某个作业项推到指定状态 */
async function setItem(itemId, status, token = staffToken, reason) {
  return post(
    ctx.base,
    `/homework/items/${itemId}/status`,
    { status, ...(reason ? { reason } : {}) },
    token,
  );
}

/** 管理端视角看一个孩子的积分流水 */
async function ledgerOf(studentId) {
  return ok(await get(ctx.base, `/points/ledger?studentId=${studentId}`, ownerToken), "查流水");
}

test("家长提交多科作业 → 老师逐项推进 → 结束当天并发积分，全流程走通", async () => {
  const { student, guardianToken } = await studentWithGuardian("作业全流程", "device-hw-full");

  const sheet = ok(
    await submitSheet(guardianToken, student.id, [
      { subject: "语文", content: "抄写生字两遍" },
      { subject: "数学", content: "口算题卡 P12" },
    ]),
    "提交作业单",
  );
  assert.equal(sheet.status, "待确认");
  assert.equal(sheet.rewarded, false);
  assert.equal(sheet.items.length, 2);
  assert.deepEqual(
    sheet.items.map((item) => item.subject),
    ["语文", "数学"],
  );
  assert.deepEqual(
    sheet.items.map((item) => item.status),
    ["待开始", "待开始"],
  );

  // 老师动第一项，整张单自动进入「辅导中」
  const started = ok(await setItem(sheet.items[0].id, "进行中"), "开始第一项");
  assert.equal(started.status, "辅导中");

  ok(await setItem(sheet.items[0].id, "已完成"), "完成第一项");
  ok(await setItem(sheet.items[1].id, "进行中"), "开始第二项");
  const settled = ok(await setItem(sheet.items[1].id, "已完成"), "完成第二项");
  assert.deepEqual(
    settled.items.map((item) => item.status),
    ["已完成", "已完成"],
  );
  assert.equal(settled.status, "辅导中", "所有项终结后单子仍是辅导中，等老师填反馈");

  const finished = ok(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/finish`,
      { status: "已完成", feedback: "两科都完成得很认真", requestId: reqId("finish") },
      staffToken,
    ),
    "结束当天作业",
  );
  assert.equal(finished.status, "已完成");
  assert.equal(finished.rewarded, true);
  assert.equal(finished.feedback, "两科都完成得很认真");
  assert.ok(finished.finishedAt, "应记录结束时间");

  // 默认奖励 10 分，且只记一笔作业奖励流水
  const ledger = await ledgerOf(student.id);
  assert.equal(ledger.balance, 10);
  assert.equal(ledger.computedBalance, 10, "缓存余额和流水汇总要一致");
  const rewards = ledger.entries.filter((entry) => entry.type === "作业奖励");
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0].delta, 10);
  assert.equal(rewards[0].sourceRef, `sheet:${sheet.id}`);
});

test("作业单进入「辅导中」后家长不能重新提交", async () => {
  const { student, guardianToken } = await studentWithGuardian("重复提交", "device-hw-resubmit");
  const sheet = ok(
    await submitSheet(guardianToken, student.id, [{ subject: "语文", content: "背古诗" }]),
  );
  ok(await setItem(sheet.items[0].id, "进行中"), "老师开始辅导");

  const failure = failsWith(
    await submitSheet(guardianToken, student.id, [{ subject: "数学", content: "补一项" }]),
    "INVALID_STATE",
    "辅导中重新提交",
  );
  assert.match(failure.message, /已经开始辅导/);

  // 原来的条目没有被覆盖
  const detail = ok(await get(ctx.base, `/homework/sheets/${sheet.id}`, guardianToken));
  assert.equal(detail.items.length, 1);
});

test("待确认阶段家长可以追加条目", async () => {
  const { student, guardianToken } = await studentWithGuardian("追加条目", "device-hw-append");
  const first = ok(
    await submitSheet(guardianToken, student.id, [{ subject: "语文", content: "抄写生字" }]),
  );
  assert.equal(first.items.length, 1);

  const second = ok(
    await submitSheet(guardianToken, student.id, [
      { subject: "数学", content: "应用题 3 道" },
      { subject: "英语", content: "听读 15 分钟" },
    ]),
    "追加两项",
  );
  assert.equal(second.id, first.id, "还是同一张单");
  assert.equal(second.status, "待确认");
  assert.equal(second.items.length, 3);
  assert.deepEqual(
    second.items.map((item) => item.subject),
    ["语文", "数学", "英语"],
  );
});

test("还有作业项没终结时不能结束当天作业", async () => {
  const { student, guardianToken } = await studentWithGuardian("未终结", "device-hw-unsettled");
  const sheet = ok(
    await submitSheet(guardianToken, student.id, [
      { subject: "语文", content: "抄写生字" },
      { subject: "数学", content: "口算题卡" },
    ]),
  );
  ok(await setItem(sheet.items[0].id, "进行中"));
  ok(await setItem(sheet.items[0].id, "已完成"));
  // 第二项还停在「待开始」

  const failure = failsWith(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/finish`,
      { status: "已完成", feedback: "先结了吧", requestId: reqId("finish") },
      staffToken,
    ),
    "INVALID_STATE",
    "还有项没终结",
  );
  assert.match(failure.message, /还有作业项/);

  // 没有产生任何积分
  assert.equal((await ledgerOf(student.id)).balance, 0);
});

test("标记「未完成」必须填写原因，且不发奖励分", async () => {
  const { student, guardianToken } = await studentWithGuardian("未完成", "device-hw-unfinished");
  const sheet = ok(
    await submitSheet(guardianToken, student.id, [{ subject: "数学", content: "口算题卡" }]),
  );
  ok(await setItem(sheet.items[0].id, "进行中"));
  ok(await setItem(sheet.items[0].id, "未完成"));

  failsWith(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/finish`,
      { status: "未完成", feedback: "今天没写完", requestId: reqId("finish") },
      staffToken,
    ),
    "INVALID_ARGUMENT",
    "未完成不填原因",
  );

  const finished = ok(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/finish`,
      {
        status: "未完成",
        feedback: "今天没写完",
        unfinishedReason: "孩子发烧提前回家了",
        requestId: reqId("finish"),
      },
      staffToken,
    ),
    "补上原因后结束",
  );
  assert.equal(finished.status, "未完成");
  assert.equal(finished.unfinishedReason, "孩子发烧提前回家了");
  assert.equal(finished.rewarded, false);
  assert.equal((await ledgerOf(student.id)).balance, 0, "未完成不发奖励分");
});

test("结束作业发积分是幂等的：同一张单不会被重复加分", async () => {
  const { student, guardianToken } = await studentWithGuardian("幂等发分", "device-hw-idem");
  const sheet = ok(
    await submitSheet(guardianToken, student.id, [{ subject: "语文", content: "背课文" }]),
  );
  ok(await setItem(sheet.items[0].id, "进行中"));
  ok(await setItem(sheet.items[0].id, "已完成"));

  ok(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/finish`,
      { status: "已完成", feedback: "背得很流利", requestId: reqId("finish") },
      staffToken,
    ),
    "第一次结束",
  );
  const afterFirst = await ledgerOf(student.id);
  assert.equal(afterFirst.balance, 10);
  assert.equal(afterFirst.entries.length, 1);

  // 直接再点一次：状态已经不是「辅导中」，被状态机挡住
  failsWith(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/finish`,
      { status: "已完成", feedback: "再点一次", requestId: reqId("finish") },
      staffToken,
    ),
    "INVALID_STATE",
    "重复结束",
  );

  // 负责人纠错退回「辅导中」：之前发出去的分要冲回来，
  // 否则重新结束时因为幂等键还占着，分不会重发，孩子就白白少了 10 分
  const rolledBack = ok(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/transition`,
      { to: "辅导中", reason: "反馈写错了要重填" },
      ownerToken,
    ),
    "负责人退回辅导中",
  );
  assert.equal(rolledBack.status, "辅导中");
  assert.equal(rolledBack.rewarded, false, "退回后应重置发分标记");

  const afterRollback = await ledgerOf(student.id);
  assert.equal(afterRollback.balance, 0, "退回后积分应被冲正回去");
  assert.equal(afterRollback.entries.length, 2, "原流水 + 冲正流水，历史全保留");
  assert.equal(afterRollback.entries.some((e) => e.type === "撤销冲正"), true);
  assert.equal(
    afterRollback.entries.find((e) => e.type === "作业奖励").reversed,
    true,
    "原流水应被标记为已冲正",
  );

  const second = ok(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/finish`,
      { status: "已完成", feedback: "重新填一遍反馈", requestId: reqId("finish") },
      staffToken,
    ),
    "第二次结束",
  );
  assert.equal(second.reward.applied, 10, "重新结束时应真的把分补回去");
  assert.equal(second.reward.skipped, null);

  const afterSecond = await ledgerOf(student.id);
  assert.equal(afterSecond.balance, 10, "最终余额应回到 10，不多不少");
  assert.equal(afterSecond.entries.length, 3, "发分 → 冲正 → 重新发分，三条流水");
  assert.equal(afterSecond.computedBalance, 10, "缓存余额与流水汇总一致");
});

test("没有发分权限的老师也能结束作业，分挂起等负责人补发", async () => {
  // 建一个只有作业权限、没有 points.grant 的老师
  ok(
    await post(
      ctx.base,
      "/staff",
      {
        username: `hw_only_${Date.now().toString(36)}`,
        password: "warm2026",
        displayName: "只管作业的老师",
        permissions: ["student.read_all", "homework.manage"],
      },
      ownerToken,
    ),
    "建受限老师",
  );
  const staffList = ok(await get(ctx.base, "/staff", ownerToken));
  const limited = staffList.find((s) => s.displayName === "只管作业的老师");
  const limitedToken = ok(
    await post(ctx.base, "/auth/staff-login", {
      username: limited.username,
      password: "warm2026",
    }),
  ).token;

  const { student, guardianToken } = await studentWithGuardian("挂起发分", "device-hw-noperm");
  const sheet = ok(
    await submitSheet(guardianToken, student.id, [{ subject: "数学", content: "口算" }]),
  );
  ok(
    await post(ctx.base, `/homework/items/${sheet.items[0].id}/status`, { status: "进行中" }, limitedToken),
  );
  ok(
    await post(ctx.base, `/homework/items/${sheet.items[0].id}/status`, { status: "已完成" }, limitedToken),
  );

  const finished = ok(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/finish`,
      { status: "已完成", feedback: "口算又快又准", requestId: reqId("finish") },
      limitedToken,
    ),
    "受限老师结束作业",
  );

  assert.equal(finished.status, "已完成", "单子必须能结掉，不能卡在辅导中");
  assert.equal(finished.rewarded, false);
  assert.equal(finished.reward.applied, 0);
  assert.equal(finished.reward.skipped, "no_permission", "要如实告知没发成，不能假装成功");

  const ledger = await ledgerOf(student.id);
  assert.equal(ledger.balance, 0);

  // 看板上应该能看到「已完成但未发分」
  const board = ok(await get(ctx.base, "/dashboard", ownerToken));
  assert.ok(board.homework.finishedButUnrewarded >= 1);
});

test("家长只能看到自己家孩子的作业单", async () => {
  const mine = await studentWithGuardian("我家娃", "device-hw-mine");
  const other = await studentWithGuardian("别家娃", "device-hw-other");

  const mySheet = ok(
    await submitSheet(mine.guardianToken, mine.student.id, [
      { subject: "语文", content: "我家的作业" },
    ]),
  );
  const otherSheet = ok(
    await submitSheet(other.guardianToken, other.student.id, [
      { subject: "数学", content: "别家的作业" },
    ]),
  );

  const list = ok(await get(ctx.base, "/homework/sheets", mine.guardianToken), "家长看作业列表");
  assert.equal(list.length, 1);
  assert.equal(list[0].id, mySheet.id);
  assert.equal(list[0].studentId, mine.student.id);

  // 显式按别人家孩子过滤也拿不到
  const filtered = ok(
    await get(ctx.base, `/homework/sheets?studentId=${other.student.id}`, mine.guardianToken),
  );
  assert.equal(filtered.length, 0);

  // 直接按 ID 取详情被拒
  failsWith(
    await get(ctx.base, `/homework/sheets/${otherSheet.id}`, mine.guardianToken),
    "FORBIDDEN",
    "偷看别家作业单",
  );

  // 老师有 student.read_all，两张都能看到
  const staffList = ok(await get(ctx.base, "/homework/sheets", staffToken));
  const ids = staffList.map((sheet) => sheet.id);
  assert.ok(ids.includes(mySheet.id) && ids.includes(otherSheet.id));
});

test("老师没有 student.manage，但有 homework.manage 能改作业项状态", async () => {
  const { student, guardianToken } = await studentWithGuardian("老师权限", "device-hw-perm");
  const sheet = ok(
    await submitSheet(guardianToken, student.id, [{ subject: "语文", content: "读课文" }]),
  );

  // 没有 student.manage
  failsWith(
    await post(ctx.base, "/students", { name: "老师建的", grade: "一年级" }, staffToken),
    "FORBIDDEN",
    "老师建学员",
  );

  // 有 homework.manage
  const updated = ok(await setItem(sheet.items[0].id, "进行中"), "老师改作业项");
  assert.equal(updated.items[0].status, "进行中");

  // 家长没有 homework.manage，改不了作业项
  failsWith(
    await setItem(sheet.items[0].id, "已完成", guardianToken),
    "FORBIDDEN",
    "家长改作业项",
  );
});

test("非法的状态跳跃一律被拒绝", async () => {
  const { student, guardianToken } = await studentWithGuardian("状态跳跃", "device-hw-jump");
  const sheet = ok(
    await submitSheet(guardianToken, student.id, [{ subject: "语文", content: "抄写" }]),
  );

  // 作业项：待开始不能直接跳到已完成
  failsWith(await setItem(sheet.items[0].id, "已完成"), "INVALID_STATE", "待开始→已完成");
  // 作业单：待确认不能直接跳到已完成
  failsWith(
    await post(ctx.base, `/homework/sheets/${sheet.id}/transition`, { to: "已完成" }, staffToken),
    "INVALID_STATE",
    "待确认→已完成",
  );

  ok(await setItem(sheet.items[0].id, "进行中"));
  ok(await setItem(sheet.items[0].id, "已完成"));
  // 作业项：已完成不能回到待开始
  failsWith(await setItem(sheet.items[0].id, "待开始"), "INVALID_STATE", "已完成→待开始");
  // 已完成退回进行中属于纠错，老师做不了
  failsWith(
    await setItem(sheet.items[0].id, "进行中", staffToken, "点错了"),
    "FORBIDDEN",
    "老师退回已终结的作业项",
  );
  // 负责人可以
  const fixed = ok(
    await setItem(sheet.items[0].id, "进行中", ownerToken, "老师点错了"),
    "负责人退回作业项",
  );
  assert.equal(fixed.items[0].status, "进行中");
});
