/**
 * 安全回归：锁住一轮对抗性审查中发现并修掉的越权与滥用路径。
 * 每条用例上面写清当初的攻击手法。
 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { generateBindingCode } from "@warm-study/shared";
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

/** 建一个带指定权限的老师并登录，返回 { id, token } */
async function staffWith(permissions, label) {
  const username = `sec_${label}_${Math.random().toString(36).slice(2, 8)}`;
  ok(
    await post(
      ctx.base,
      "/staff",
      { username, password: "warm2026", displayName: `测试_${label}`, permissions },
      ownerToken,
    ),
  );
  const list = ok(await get(ctx.base, "/staff", ownerToken));
  const member = list.find((item) => item.username === username);
  const token = ok(
    await post(ctx.base, "/auth/staff-login", { username, password: "warm2026" }),
  ).token;
  return { id: member.id, token, username };
}

/* ---------------------------------------------------------------------------
 * 攻击 1：绑定码预览接口曾经是个无限次数的"码是否有效"预言机
 * 它只要 requireAuth，既不限流也不计入失败次数，
 * 攻击者根本不用碰 bindByCode 就能把码穷举出来。
 * ------------------------------------------------------------------------- */

test("预览接口与正式绑定共用限流额度，穷举会被拦下", async () => {
  const token = await loginGuardian(ctx.base, `device-preview-brute-${Date.now()}`);
  let limited = false;
  for (let i = 0; i < 40; i += 1) {
    const result = await get(ctx.base, `/bindings/preview?code=${generateBindingCode()}`, token);
    if (result.body.code === "TOO_MANY_ATTEMPTS") {
      limited = true;
      break;
    }
  }
  assert.ok(limited, "连续预览不存在的码应该触发限流");
});

test("格式非法的码不消耗限流额度（本地就该拦下，不该惩罚打字慢的家长）", async () => {
  const token = await loginGuardian(ctx.base, `device-preview-bad-${Date.now()}`);
  for (let i = 0; i < 30; i += 1) {
    const result = await get(ctx.base, "/bindings/preview?code=ABC", token);
    assert.equal(result.body.success, true, "格式错的码应该正常返回 valid:false");
    assert.equal(result.body.data.valid, false);
  }
});

/* ---------------------------------------------------------------------------
 * 攻击 2：拿到 staff.manage 的老师可以一步把自己写成负责人，
 * 再改掉负责人的密码接管整个系统。
 * ------------------------------------------------------------------------- */

test("有 staff.manage 的老师不能把自己或别人提成负责人", async () => {
  const attacker = await staffWith(["student.read_all", "staff.manage"], "escalate");

  failsWith(
    await patch(ctx.base, `/staff/${attacker.id}`, { roles: ["owner"] }, attacker.token),
    "FORBIDDEN",
    "把自己提成负责人",
  );

  const victim = await staffWith(["student.read_all"], "victim");
  failsWith(
    await patch(ctx.base, `/staff/${victim.id}`, { roles: ["owner"] }, attacker.token),
    "FORBIDDEN",
    "把同事提成负责人",
  );

  // 确认权限确实没涨
  const profile = ok(await get(ctx.base, "/auth/profile", attacker.token));
  assert.equal(profile.roles.includes("owner"), false);
  failsWith(await get(ctx.base, "/points/reconcile", attacker.token), "FORBIDDEN");
});

test("非负责人不能授予负责人专属权限", async () => {
  const attacker = await staffWith(["student.read_all", "staff.manage"], "grant");
  const victim = await staffWith(["student.read_all"], "grantee");

  ok(
    await patch(
      ctx.base,
      `/staff/${victim.id}`,
      { permissions: ["student.read_all", "points.adjust", "audit.read", "homework.manage"] },
      attacker.token,
    ),
  );

  const list = ok(await get(ctx.base, "/staff", ownerToken));
  const updated = list.find((item) => item.id === victim.id);
  assert.equal(updated.permissions.includes("points.adjust"), false, "负责人专属权限应被剔除");
  assert.equal(updated.permissions.includes("audit.read"), false);
  assert.equal(updated.permissions.includes("homework.manage"), true, "普通权限照常授予");
});

test("不能给自己增加权限", async () => {
  const attacker = await staffWith(["student.read_all", "staff.manage"], "self");
  failsWith(
    await patch(
      ctx.base,
      `/staff/${attacker.id}`,
      { permissions: ["student.read_all", "staff.manage", "homework.manage"] },
      attacker.token,
    ),
    "FORBIDDEN",
    "给自己加权限",
  );
});

test("非负责人不能改负责人账号（包括改密码接管）", async () => {
  const attacker = await staffWith(["student.read_all", "staff.manage"], "takeover");
  const list = ok(await get(ctx.base, "/staff", ownerToken));
  const owner = list.find((item) => item.roles.includes("owner"));

  failsWith(
    await patch(ctx.base, `/staff/${owner.id}`, { password: "hacked123" }, attacker.token),
    "FORBIDDEN",
    "改负责人密码",
  );
  // 负责人原密码仍然可用
  ok(await post(ctx.base, "/auth/staff-login", { username: "owner", password: "warm2026" }));
});

test("角色只能是白名单里的三种", async () => {
  const member = await staffWith(["student.read_all"], "roles");
  failsWith(
    await patch(ctx.base, `/staff/${member.id}`, { roles: ["superadmin"] }, ownerToken),
    "INVALID_ARGUMENT",
  );
  failsWith(
    await patch(ctx.base, `/staff/${member.id}`, { roles: ["<script>"] }, ownerToken),
    "INVALID_ARGUMENT",
  );
});

test("「最后一名负责人」的判断不能被 co-owner 这种字符串骗过", async () => {
  // 旧实现用 roles LIKE '%owner%' 子串匹配，
  // 写一个 ["co-owner"] 就能骗过保护、把唯一的真负责人停掉
  const member = await staffWith(["student.read_all"], "coowner");
  failsWith(
    await patch(ctx.base, `/staff/${member.id}`, { roles: ["co-owner"] }, ownerToken),
    "INVALID_ARGUMENT",
    "co-owner 不是合法角色",
  );

  const list = ok(await get(ctx.base, "/staff", ownerToken));
  const owner = list.find((item) => item.roles.includes("owner"));
  failsWith(
    await patch(ctx.base, `/staff/${owner.id}`, { status: "disabled" }, ownerToken),
    "LAST_OWNER_PROTECTED",
    "停用最后一名负责人",
  );
});

/* ---------------------------------------------------------------------------
 * 攻击 3：PATCH 是校验的后门 —— POST 卡住的超长内容改一次就进去了
 * ------------------------------------------------------------------------- */

test("PATCH 和 POST 用同一套长度约束", async () => {
  const { student } = await newStudent("长度校验");
  const huge = "长".repeat(5000);

  failsWith(
    await patch(ctx.base, `/students/${student.id}`, { nickname: huge }, ownerToken),
    "INVALID_ARGUMENT",
    "超长昵称",
  );
  failsWith(
    await patch(ctx.base, `/students/${student.id}`, { note: huge }, ownerToken),
    "INVALID_ARGUMENT",
    "超长备注",
  );

  const products = ok(await get(ctx.base, "/products", ownerToken));
  failsWith(
    await patch(ctx.base, `/products/${products[0].id}`, { description: huge }, ownerToken),
    "INVALID_ARGUMENT",
    "超长商品说明",
  );
});

test("错题 PATCH 也受长度限制", async () => {
  const { student, bindingCodeDisplay } = await newStudent("错题长度");
  const guardian = await loginGuardian(ctx.base, `device-wq-len-${Date.now()}`);
  ok(await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation: "妈妈" }, guardian));
  const question = ok(
    await post(
      ctx.base,
      "/wrong-questions",
      { studentId: student.id, subject: "数学", knowledge: "进位加法" },
      guardian,
    ),
  );
  failsWith(
    await patch(ctx.base, `/wrong-questions/${question.id}`, { subject: "科".repeat(500) }, guardian),
    "INVALID_ARGUMENT",
  );
});

/* ---------------------------------------------------------------------------
 * 攻击 4：任意 dateKey 既能污染数据，又能让只读接口批量写库
 * ------------------------------------------------------------------------- */

test("非法日期被拒绝，不会产生永远查不到的作业单", async () => {
  const { student, bindingCodeDisplay } = await newStudent("日期校验");
  const guardian = await loginGuardian(ctx.base, `device-date-${Date.now()}`);
  ok(await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation: "妈妈" }, guardian));

  for (const bad of ["not-a-date", "9999-99-99", "2026-02-30", "26-1-1"]) {
    failsWith(
      await post(
        ctx.base,
        "/homework/sheets",
        { studentId: student.id, dateKey: bad, items: [{ subject: "语文", content: "x" }] },
        guardian,
      ),
      "INVALID_ARGUMENT",
      `非法日期 ${bad}`,
    );
  }
  // 合法日期照常通过
  ok(
    await post(
      ctx.base,
      "/homework/sheets",
      { studentId: student.id, dateKey: "2026-02-28", items: [{ subject: "语文", content: "x" }] },
      guardian,
    ),
  );
});

test("看板等只读接口不再往库里写记录", async () => {
  const before = ctx.db.get("SELECT COUNT(*) AS total FROM daily_sessions").total;
  for (let i = 0; i < 15; i += 1) {
    ok(await get(ctx.base, `/dashboard?dateKey=2026-03-${String(i + 1).padStart(2, "0")}`, ownerToken));
  }
  const after = ctx.db.get("SELECT COUNT(*) AS total FROM daily_sessions").total;
  assert.equal(after, before, "只读接口不该产生任何 daily_sessions 行");
});

test("非法 dateKey 在查询参数上也被拒", async () => {
  failsWith(await get(ctx.base, "/dashboard?dateKey=junk", ownerToken), "INVALID_ARGUMENT");
  failsWith(await get(ctx.base, "/sessions/today?dateKey=2026-13-01", ownerToken), "INVALID_ARGUMENT");
});

/* ---------------------------------------------------------------------------
 * 攻击 5：绕过「撤销兑换」直接冲正兑换流水，制造分退了货没退的死局
 * ------------------------------------------------------------------------- */

test("兑换产生的流水不能直接冲正，必须走撤销兑换", async () => {
  const { student } = await newStudent("兑换冲正");
  ok(
    await post(
      ctx.base,
      "/points/grant",
      { studentId: student.id, delta: 100, type: "表现奖励", reason: "攒分", requestId: reqId() },
      staffToken,
    ),
  );
  const products = ok(await get(ctx.base, "/products", ownerToken));
  const product = products.find((item) => item.status === "上架" && item.perStudentLimit === 0);
  const stockBefore = product.stock;

  const redemption = ok(
    await post(
      ctx.base,
      "/redemptions",
      { studentId: student.id, productId: product.id, requestId: reqId() },
      staffToken,
    ),
  );

  const ledger = ok(await get(ctx.base, `/points/ledger?studentId=${student.id}`, ownerToken));
  const deduction = ledger.entries.find((entry) => entry.type === "兑换扣除");
  failsWith(
    await post(ctx.base, "/points/reverse", { ledgerId: deduction.id, reason: "试图绕过" }, ownerToken),
    "INVALID_STATE",
    "直接冲正兑换流水",
  );

  // 正确路径仍然可用，且库存真的退回来了
  ok(
    await post(
      ctx.base,
      `/redemptions/${redemption.redemption.id}/reverse`,
      { reason: "孩子拿错了" },
      ownerToken,
    ),
  );
  const productsAfter = ok(await get(ctx.base, "/products", ownerToken));
  assert.equal(productsAfter.find((item) => item.id === product.id).stock, stockBefore, "库存应完全退回");
});

/* ---------------------------------------------------------------------------
 * 攻击 6：同一个 requestId 发给不同孩子，接口返回成功却一分没加
 * ------------------------------------------------------------------------- */

test("发积分的幂等键区分学员，不会张冠李戴", async () => {
  const a = await newStudent("幂等甲");
  const b = await newStudent("幂等乙");
  const shared = reqId("shared");

  const first = ok(
    await post(
      ctx.base,
      "/points/grant",
      { studentId: a.student.id, delta: 20, type: "表现奖励", reason: "甲", requestId: shared },
      staffToken,
    ),
  );
  const second = ok(
    await post(
      ctx.base,
      "/points/grant",
      { studentId: b.student.id, delta: 20, type: "表现奖励", reason: "乙", requestId: shared },
      staffToken,
    ),
  );

  assert.notEqual(first.entryId, second.entryId, "两个孩子应各自产生流水");
  const ledgerB = ok(await get(ctx.base, `/points/ledger?studentId=${b.student.id}`, ownerToken));
  assert.equal(ledgerB.balance, 20, "乙的分必须真的加上");
  assert.equal(ledgerB.entries.length, 1);
});

test("同一学员同一 requestId 仍然只算一次", async () => {
  const { student } = await newStudent("同人幂等");
  const same = reqId("same");
  const payload = {
    studentId: student.id,
    delta: 15,
    type: "表现奖励",
    reason: "重复提交",
    requestId: same,
  };
  ok(await post(ctx.base, "/points/grant", payload, staffToken));
  ok(await post(ctx.base, "/points/grant", payload, staffToken));
  const ledger = ok(await get(ctx.base, `/points/ledger?studentId=${student.id}`, ownerToken));
  assert.equal(ledger.balance, 15);
  assert.equal(ledger.entries.length, 1);
});

/* ---------------------------------------------------------------------------
 * 攻击 7：接娃提醒的 requestId 曾是死参数，真实重试会发出两条通知
 * ------------------------------------------------------------------------- */

test("接娃提醒按 requestId 幂等，网络重试不会发两条", async () => {
  const { student, bindingCodeDisplay } = await newStudent("提醒幂等");
  const guardian = await loginGuardian(ctx.base, `device-notice-${Date.now()}`);
  ok(await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation: "妈妈" }, guardian));

  const requestId = reqId("notice");
  const first = ok(
    await post(ctx.base, "/reminders", { studentId: student.id, etaAt: "17:40", requestId }, staffToken),
  );
  const retry = ok(
    await post(ctx.base, "/reminders", { studentId: student.id, etaAt: "17:40", requestId }, staffToken),
  );
  assert.equal(retry.reminder.id, first.reminder.id, "重试应返回同一条提醒");
  assert.equal(retry.duplicate, true);

  const list = ok(await get(ctx.base, `/reminders?studentId=${student.id}`, staffToken));
  assert.equal(list.length, 1, "只该有一条提醒记录");
});

test("跨天的接娃时间被拒绝（HH:mm 表达不了明天）", async () => {
  const { student } = await newStudent("跨天提醒");
  failsWith(
    await post(
      ctx.base,
      "/reminders",
      // 固定加 24 小时，避免测试依赖执行时刻（例如凌晨执行时 600 分钟仍在当天）。
      { studentId: student.id, minutes: 24 * 60, requestId: reqId() },
      staffToken,
    ),
    "INVALID_ARGUMENT",
  );
});

/* ---------------------------------------------------------------------------
 * 攻击 8：系统设置零校验，填个小数就让全班作业都结不了
 * ------------------------------------------------------------------------- */

test("系统设置有类型和范围校验", async () => {
  failsWith(
    await patch(ctx.base, "/settings", { "points.homeworkDefaultReward": 1.5 }, ownerToken),
    "INVALID_ARGUMENT",
    "小数奖励",
  );
  failsWith(
    await patch(ctx.base, "/settings", { "points.homeworkDefaultReward": "abc" }, ownerToken),
    "INVALID_ARGUMENT",
  );
  failsWith(
    await patch(ctx.base, "/settings", { "binding.requiresReview": "yes" }, ownerToken),
    "INVALID_ARGUMENT",
    "开关必须是布尔",
  );
  failsWith(
    await patch(ctx.base, "/settings", { "points.adjustThreshold": -5 }, ownerToken),
    "INVALID_ARGUMENT",
    "阈值不能为负",
  );
  // 合法值照常保存
  const result = ok(await patch(ctx.base, "/settings", { "points.homeworkDefaultReward": 12 }, ownerToken));
  assert.equal(result["points.homeworkDefaultReward"], 12);
  ok(await patch(ctx.base, "/settings", { "points.homeworkDefaultReward": 10 }, ownerToken));
});

/* ---------------------------------------------------------------------------
 * 其它收口
 * ------------------------------------------------------------------------- */

test("家长读不到系统设置", async () => {
  const guardian = await loginGuardian(ctx.base, `device-settings-${Date.now()}`);
  failsWith(await get(ctx.base, "/settings", guardian), "FORBIDDEN");
  ok(await get(ctx.base, "/settings", staffToken), "老师可以读");
});

test("排行榜 limit=0 返回空而不是全表", async () => {
  const result = ok(await get(ctx.base, "/leaderboard?period=lifetime&limit=0", ownerToken));
  assert.equal(result.rows.length, 0);
});

test("学员搜索里的 LIKE 通配符被转义", async () => {
  await newStudent("通配符测试");
  const all = ok(await get(ctx.base, "/students", ownerToken));
  const wildcard = ok(await get(ctx.base, "/students?keyword=%25", ownerToken));
  assert.ok(wildcard.length < all.length, "搜 % 不应该匹配到全部学员");
});

test("看板的「已完成未发分」不把未完成的作业算进去", async () => {
  const { student, bindingCodeDisplay } = await newStudent("看板指标");
  const guardian = await loginGuardian(ctx.base, `device-board-${Date.now()}`);
  ok(await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation: "妈妈" }, guardian));
  const sheet = ok(
    await post(
      ctx.base,
      "/homework/sheets",
      { studentId: student.id, items: [{ subject: "语文", content: "抄写" }] },
      guardian,
    ),
  );
  const before = ok(await get(ctx.base, "/dashboard", ownerToken)).homework.finishedButUnrewarded;

  ok(await post(ctx.base, `/homework/items/${sheet.items[0].id}/status`, { status: "进行中" }, staffToken));
  ok(await post(ctx.base, `/homework/items/${sheet.items[0].id}/status`, { status: "未完成" }, staffToken));
  ok(
    await post(
      ctx.base,
      `/homework/sheets/${sheet.id}/finish`,
      {
        status: "未完成",
        feedback: "今天状态不好",
        unfinishedReason: "提前接走",
        requestId: reqId(),
      },
      staffToken,
    ),
  );

  const after = ok(await get(ctx.base, "/dashboard", ownerToken)).homework.finishedButUnrewarded;
  assert.equal(after, before, "未完成的作业本来就不发分，不该计入待补发告警");
});
