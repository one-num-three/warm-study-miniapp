/**
 * 回归测试：锁住几个在联调中发现并修掉的真实缺陷，防止以后改回去。
 * 每条用例上面都写明了当初的错误行为。
 */

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

async function newStudent(name) {
  return ok(await post(ctx.base, "/students", { name, grade: "三年级" }, ownerToken));
}

async function bindGuardian(bindingCodeDisplay, deviceId, relation = "妈妈") {
  const token = await loginGuardian(ctx.base, deviceId);
  ok(await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation }, token));
  return token;
}

/* ---------------------------------------------------------------------------
 * 缺陷 1：停用学员后，积分/作业/到班/提醒仍然照常写入
 * 当初只有兑换和绑定检查了 status，其余入口全放行，
 * 结果停用学员的余额还在涨，而管理端列表默认又看不到这个学员。
 * ------------------------------------------------------------------------- */

test("停用学员后不能再发积分", async () => {
  const { student } = await newStudent("停用发分");
  ok(await patch(ctx.base, `/students/${student.id}`, { status: "disabled" }, ownerToken));
  failsWith(
    await post(
      ctx.base,
      "/points/grant",
      { studentId: student.id, delta: 10, type: "表现奖励", reason: "试试", requestId: reqId() },
      staffToken,
    ),
    "INVALID_STATE",
    "给停用学员发分",
  );
});

test("停用学员后家长不能再交作业", async () => {
  const { student, bindingCodeDisplay } = await newStudent("停用交作业");
  const guardian = await bindGuardian(bindingCodeDisplay, "device-reg-hw");
  ok(await patch(ctx.base, `/students/${student.id}`, { status: "disabled" }, ownerToken));
  failsWith(
    await post(
      ctx.base,
      "/homework/sheets",
      { studentId: student.id, items: [{ subject: "语文", content: "抄写" }] },
      guardian,
    ),
    "INVALID_STATE",
  );
});

test("停用学员后不能改到班状态、不能发接娃提醒", async () => {
  const { student } = await newStudent("停用到班");
  ok(await patch(ctx.base, `/students/${student.id}`, { status: "disabled" }, ownerToken));
  failsWith(
    await post(ctx.base, "/sessions/transition", { studentId: student.id, to: "已到班" }, staffToken),
    "INVALID_STATE",
  );
  failsWith(
    await post(ctx.base, "/reminders", { studentId: student.id, minutes: 30, requestId: reqId() }, staffToken),
    "INVALID_STATE",
  );
});

test("停用学员后家长不能再添错题", async () => {
  const { student, bindingCodeDisplay } = await newStudent("停用错题");
  const guardian = await bindGuardian(bindingCodeDisplay, "device-reg-wq");
  ok(await patch(ctx.base, `/students/${student.id}`, { status: "disabled" }, ownerToken));
  failsWith(
    await post(
      ctx.base,
      "/wrong-questions",
      { studentId: student.id, subject: "数学", knowledge: "进位加法" },
      guardian,
    ),
    "INVALID_STATE",
  );
});

test("学员停用后负责人仍然能冲正历史错账", async () => {
  const { student } = await newStudent("停用后纠错");
  const grant = ok(
    await post(
      ctx.base,
      "/points/grant",
      { studentId: student.id, delta: 20, type: "表现奖励", reason: "发错人了", requestId: reqId() },
      staffToken,
    ),
  );
  ok(await patch(ctx.base, `/students/${student.id}`, { status: "disabled" }, ownerToken));

  // 停用挡的是"新增业务"，不该挡住负责人修正历史
  const reversal = ok(
    await post(
      ctx.base,
      "/points/reverse",
      { ledgerId: grant.entryId, reason: "这 20 分本来是发给另一个孩子的" },
      ownerToken,
    ),
    "停用后冲正",
  );
  assert.equal(reversal.balanceAfter, 0);
});

test("停用学员的历史数据全部保留", async () => {
  const { student } = await newStudent("停用留档");
  ok(
    await post(
      ctx.base,
      "/points/grant",
      { studentId: student.id, delta: 15, type: "表现奖励", reason: "课堂表现", requestId: reqId() },
      staffToken,
    ),
  );
  ok(await patch(ctx.base, `/students/${student.id}`, { status: "disabled" }, ownerToken));

  const detail = ok(await get(ctx.base, `/students/${student.id}`, ownerToken));
  assert.equal(detail.status, "disabled");
  assert.equal(detail.pointBalance, 15, "余额留着");
  assert.equal(detail.computedBalance, 15);

  const ledger = ok(await get(ctx.base, `/points/ledger?studentId=${student.id}`, ownerToken));
  assert.equal(ledger.entries.length, 1, "流水留着");
});

/* ---------------------------------------------------------------------------
 * 缺陷 2：任一已绑家长都能撤回别人交的作业单
 * 代码注释写的是"只能撤回自己提交的"，实现却只检查了绑定关系。
 * ------------------------------------------------------------------------- */

test("另一位家长不能撤回别人提交的作业单", async () => {
  const { student, bindingCodeDisplay } = await newStudent("撤回权限");
  const mom = await bindGuardian(bindingCodeDisplay, "device-reg-mom", "妈妈");
  const dad = await bindGuardian(bindingCodeDisplay, "device-reg-dad", "爸爸");

  const sheet = ok(
    await post(
      ctx.base,
      "/homework/sheets",
      { studentId: student.id, items: [{ subject: "语文", content: "妈妈交的" }] },
      mom,
    ),
  );

  failsWith(
    await post(ctx.base, `/homework/sheets/${sheet.id}/transition`, { to: "已撤回" }, dad),
    "FORBIDDEN",
    "爸爸撤回妈妈交的单",
  );

  // 提交人本人可以撤
  const withdrawn = ok(
    await post(ctx.base, `/homework/sheets/${sheet.id}/transition`, { to: "已撤回" }, mom),
  );
  assert.equal(withdrawn.status, "已撤回");
});

test("负责人可以代为撤回，但必须填原因并留审计", async () => {
  const { student, bindingCodeDisplay } = await newStudent("代撤回");
  const mom = await bindGuardian(bindingCodeDisplay, "device-reg-mom2", "妈妈");
  const sheet = ok(
    await post(
      ctx.base,
      "/homework/sheets",
      { studentId: student.id, items: [{ subject: "数学", content: "交错孩子了" }] },
      mom,
    ),
  );

  failsWith(
    await post(ctx.base, `/homework/sheets/${sheet.id}/transition`, { to: "已撤回" }, ownerToken),
    "INVALID_ARGUMENT",
    "负责人代撤没填原因",
  );

  ok(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/transition`,
      { to: "已撤回", reason: "家长交错孩子了，电话确认过" },
      ownerToken,
    ),
  );

  const audit = ok(await get(ctx.base, "/audit?action=homework.withdraw", ownerToken));
  assert.ok(audit.length >= 1, "代撤回要留审计");
  assert.match(audit[0].reason, /交错孩子/);
});

test("撤回后可以重新提交当天的作业单", async () => {
  const { student, bindingCodeDisplay } = await newStudent("撤回重交");
  const mom = await bindGuardian(bindingCodeDisplay, "device-reg-resubmit", "妈妈");
  const first = ok(
    await post(
      ctx.base,
      "/homework/sheets",
      { studentId: student.id, items: [{ subject: "语文", content: "第一版" }] },
      mom,
    ),
  );
  ok(await post(ctx.base, `/homework/sheets/${first.id}/transition`, { to: "已撤回" }, mom));

  const second = ok(
    await post(
      ctx.base,
      "/homework/sheets",
      { studentId: student.id, items: [{ subject: "语文", content: "第二版" }] },
      mom,
    ),
    "撤回后重交",
  );
  assert.notEqual(second.id, first.id);
  assert.equal(second.items[0].content, "第二版");
});

/* ---------------------------------------------------------------------------
 * 缺陷 3：结束作业时积分没发出去，接口却返回成功
 * 现在 finish 会带回 reward 字段，如实说明发了多少、为什么没发。
 * ------------------------------------------------------------------------- */

test("结束作业的响应里如实带出积分发放结果", async () => {
  const { student, bindingCodeDisplay } = await newStudent("发分回执");
  const mom = await bindGuardian(bindingCodeDisplay, "device-reg-reward", "妈妈");
  const sheet = ok(
    await post(
      ctx.base,
      "/homework/sheets",
      { studentId: student.id, items: [{ subject: "英语", content: "单词" }] },
      mom,
    ),
  );
  ok(await post(ctx.base, `/homework/items/${sheet.items[0].id}/status`, { status: "进行中" }, staffToken));
  ok(await post(ctx.base, `/homework/items/${sheet.items[0].id}/status`, { status: "已完成" }, staffToken));

  const finished = ok(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/finish`,
      { status: "已完成", feedback: "单词都记住了", rewardPoints: 25, requestId: reqId() },
      staffToken,
    ),
  );
  assert.equal(finished.reward.requested, 25);
  assert.equal(finished.reward.applied, 25);
  assert.equal(finished.reward.skipped, null);
  assert.equal(finished.rewarded, true);
});

test("未完成的作业默认不发分，且必须写明原因", async () => {
  const { student, bindingCodeDisplay } = await newStudent("未完成不发分");
  const mom = await bindGuardian(bindingCodeDisplay, "device-reg-unfinished", "妈妈");
  const sheet = ok(
    await post(
      ctx.base,
      "/homework/sheets",
      { studentId: student.id, items: [{ subject: "数学", content: "应用题" }] },
      mom,
    ),
  );
  ok(await post(ctx.base, `/homework/items/${sheet.items[0].id}/status`, { status: "进行中" }, staffToken));
  ok(await post(ctx.base, `/homework/items/${sheet.items[0].id}/status`, { status: "未完成" }, staffToken));

  failsWith(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/finish`,
      { status: "未完成", feedback: "今天状态不好", requestId: reqId() },
      staffToken,
    ),
    "INVALID_ARGUMENT",
    "未完成没填原因",
  );

  const finished = ok(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/finish`,
      {
        status: "未完成",
        feedback: "剩两道大题",
        unfinishedReason: "临时有事提前接走",
        requestId: reqId(),
      },
      staffToken,
    ),
  );
  assert.equal(finished.reward.requested, 0);
  assert.equal(finished.reward.applied, 0);
  const ledger = ok(await get(ctx.base, `/points/ledger?studentId=${student.id}`, ownerToken));
  assert.equal(ledger.balance, 0);
});
