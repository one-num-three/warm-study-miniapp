/** 登录 + 绑定码绑定：这是用户最关心的核心流程，测得细一点。 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { formatBindingCode, normalizeBindingCode } from "@warm-study/shared";
import {
  failsWith,
  get,
  loginGuardian,
  loginOwner,
  loginStaff,
  ok,
  patch,
  post,
  startTestServer,
} from "./helpers.js";

let ctx;
let ownerToken;

before(async () => {
  ctx = await startTestServer();
  ownerToken = await loginOwner(ctx.base);
});

after(async () => {
  await ctx.close();
});

/** 管理员新建一个学生，返回它的绑定码 */
async function createStudent(name, grade = "三年级") {
  const data = ok(
    await post(ctx.base, "/students", { name, grade, nickname: name.slice(-1) }, ownerToken),
    "新建学生",
  );
  return data;
}

test("管理员新建学生时服务端生成绑定码，且格式规范", async () => {
  const { student, bindingCodeDisplay } = await createStudent("测试甲");
  assert.match(student.bindingCode, /^[0-9A-Z]{8}$/);
  assert.match(bindingCodeDisplay, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.equal(normalizeBindingCode(bindingCodeDisplay), student.bindingCode);
  assert.equal(student.bindingCodeEnabled, true);
  assert.equal(student.pointBalance, 0);
});

test("绑定码全局唯一：批量建 60 个学生无重复", async () => {
  const codes = new Set();
  for (let i = 0; i < 60; i += 1) {
    const { student } = await createStudent(`批量${i}`);
    assert.equal(codes.has(student.bindingCode), false, `第 ${i} 个码重复了`);
    codes.add(student.bindingCode);
  }
  assert.equal(codes.size, 60);
});

test("客户端指定的绑定码会被忽略，只认服务端生成的", async () => {
  const data = ok(
    await post(
      ctx.base,
      "/students",
      { name: "注入测试", grade: "一年级", bindingCode: "AAAAAAAA", id: "stu_hacked" },
      ownerToken,
    ),
    "带 bindingCode 建学生",
  );
  assert.notEqual(data.student.bindingCode, "AAAAAAAA");
  assert.notEqual(data.student.id, "stu_hacked");
});

test("家长输入绑定码即完成绑定（默认不需要审核）", async () => {
  const { student, bindingCodeDisplay } = await createStudent("小满测试");
  const guardianToken = await loginGuardian(ctx.base, "device-mom-1", "小满妈妈");

  const result = ok(
    await post(
      ctx.base,
      "/bindings/by-code",
      { bindingCode: bindingCodeDisplay, relation: "妈妈", guardianName: "小满妈妈" },
      guardianToken,
    ),
    "绑定",
  );

  assert.equal(result.status, "已通过");
  assert.equal(result.student.id, student.id);
  assert.equal(result.relation, "妈妈");
  assert.equal(result.profile.students.length, 1);
  assert.equal(result.profile.students[0].name, "小满测试");
  assert.equal(result.profile.displayName, "小满妈妈");
});

test("绑定码大小写、空格、短横都能容错", async () => {
  const { bindingCodeDisplay, student } = await createStudent("容错测试");
  const raw = normalizeBindingCode(bindingCodeDisplay);
  const variants = [
    raw,
    raw.toLowerCase(),
    bindingCodeDisplay,
    `  ${bindingCodeDisplay.toLowerCase()}  `,
    raw.split("").join(" "),
  ];
  for (const [index, variant] of variants.entries()) {
    const token = await loginGuardian(ctx.base, `device-tolerant-${index}`);
    const result = ok(
      await post(ctx.base, "/bindings/by-code", { bindingCode: variant, relation: "爸爸" }, token),
      `写法「${variant}」`,
    );
    assert.equal(result.student.id, student.id);
  }
});

test("一个孩子可以绑多个家长（爸爸妈妈都绑同一个码）", async () => {
  const { student, bindingCodeDisplay } = await createStudent("多家长测试");
  const momToken = await loginGuardian(ctx.base, "device-multi-mom");
  const dadToken = await loginGuardian(ctx.base, "device-multi-dad");

  ok(await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation: "妈妈" }, momToken));
  ok(await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation: "爸爸" }, dadToken));

  const detail = ok(await get(ctx.base, `/students/${student.id}`, ownerToken), "学生详情");
  const approved = detail.guardians.filter((g) => g.status === "已通过");
  assert.equal(approved.length, 2);
  assert.deepEqual(approved.map((g) => g.relation).sort(), ["妈妈", "爸爸"]);
});

test("一个家长可以绑多个孩子", async () => {
  const a = await createStudent("兄弟甲");
  const b = await createStudent("兄弟乙");
  const token = await loginGuardian(ctx.base, "device-two-kids");

  ok(await post(ctx.base, "/bindings/by-code", { bindingCode: a.bindingCodeDisplay, relation: "妈妈" }, token));
  const result = ok(
    await post(ctx.base, "/bindings/by-code", { bindingCode: b.bindingCodeDisplay, relation: "妈妈" }, token),
  );
  assert.equal(result.profile.students.length, 2);
  assert.deepEqual(result.profile.students.map((s) => s.name).sort(), ["兄弟乙", "兄弟甲"]);
});

test("重复绑定同一个孩子被拒绝", async () => {
  const { bindingCodeDisplay } = await createStudent("重复绑定测试");
  const token = await loginGuardian(ctx.base, "device-dup");
  ok(await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation: "妈妈" }, token));
  failsWith(
    await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation: "妈妈" }, token),
    "BINDING_ALREADY_EXISTS",
  );
});

test("格式非法的绑定码被拦下，且给出针对性提示", async () => {
  const token = await loginGuardian(ctx.base, "device-bad-format");
  // 太短
  const short = failsWith(
    await post(ctx.base, "/bindings/by-code", { bindingCode: "ABC", relation: "妈妈" }, token),
    "BINDING_CODE_INVALID",
  );
  assert.match(short.message, /8 位/);
  // 含字符集外的字母
  const charset = failsWith(
    await post(ctx.base, "/bindings/by-code", { bindingCode: "UUUUUUUU", relation: "妈妈" }, token),
    "BINDING_CODE_INVALID",
  );
  assert.match(charset.message, /I、L、O、U/);
});

test("校验位错误的码不会去查库，直接报格式错", async () => {
  const { bindingCodeDisplay } = await createStudent("校验位测试");
  const raw = normalizeBindingCode(bindingCodeDisplay);
  // 改掉最后一位校验位
  const broken = raw.slice(0, 7) + (raw[7] === "2" ? "3" : "2");
  const token = await loginGuardian(ctx.base, "device-bad-checksum");
  failsWith(
    await post(ctx.base, "/bindings/by-code", { bindingCode: broken, relation: "妈妈" }, token),
    "BINDING_CODE_INVALID",
  );
});

test("格式合法但不存在的码报「不存在」而不是「格式错」", async () => {
  const token = await loginGuardian(ctx.base, "device-not-found");
  // 构造一个校验位正确但库里没有的码
  let candidate = null;
  for (let i = 0; i < 200 && !candidate; i += 1) {
    const { generateBindingCode } = await import("@warm-study/shared");
    const code = generateBindingCode();
    const preview = ok(await get(ctx.base, `/bindings/preview?code=${code}`, token));
    if (!preview.valid) candidate = code;
  }
  assert.ok(candidate, "应该能找到一个未使用的合法码");
  failsWith(
    await post(ctx.base, "/bindings/by-code", { bindingCode: candidate, relation: "妈妈" }, token),
    "BINDING_CODE_NOT_FOUND",
  );
});

test("绑定前可以预览孩子的脱敏姓名，确认绑的是自家娃", async () => {
  const { bindingCodeDisplay } = await createStudent("预览测试", "六年级");
  const token = await loginGuardian(ctx.base, "device-preview");
  const preview = ok(await get(ctx.base, `/bindings/preview?code=${bindingCodeDisplay}`, token));
  assert.equal(preview.valid, true);
  assert.equal(preview.studentHint, "预***");
  assert.equal(preview.grade, "六年级");
  // 预览不会建立任何关系
  const profile = ok(await get(ctx.base, "/auth/profile", token));
  assert.equal(profile.students.length, 0);
});

test("负责人可以停用绑定码，停用后无法再绑", async () => {
  const { student, bindingCodeDisplay } = await createStudent("停用测试");
  ok(
    await post(
      ctx.base,
      `/students/${student.id}/binding-code/toggle`,
      { enabled: false, reason: "码贴到家长群里了" },
      ownerToken,
    ),
  );
  const token = await loginGuardian(ctx.base, "device-disabled-code");
  failsWith(
    await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation: "妈妈" }, token),
    "BINDING_CODE_DISABLED",
  );
});

test("重置绑定码后旧码失效、新码可用，已绑家长不受影响", async () => {
  const { student, bindingCodeDisplay: oldCode } = await createStudent("重置测试");
  const momToken = await loginGuardian(ctx.base, "device-reset-mom");
  ok(await post(ctx.base, "/bindings/by-code", { bindingCode: oldCode, relation: "妈妈" }, momToken));

  const reset = ok(
    await post(
      ctx.base,
      `/students/${student.id}/binding-code/reset`,
      { reason: "旧码外泄" },
      ownerToken,
    ),
  );
  assert.notEqual(reset.bindingCode, normalizeBindingCode(oldCode));

  // 妈妈的绑定关系还在
  const momProfile = ok(await get(ctx.base, "/auth/profile", momToken));
  assert.equal(momProfile.students.length, 1);

  // 旧码不能用了
  const dadToken = await loginGuardian(ctx.base, "device-reset-dad");
  failsWith(
    await post(ctx.base, "/bindings/by-code", { bindingCode: oldCode, relation: "爸爸" }, dadToken),
    "BINDING_CODE_NOT_FOUND",
  );
  // 新码可以用
  ok(
    await post(
      ctx.base,
      "/bindings/by-code",
      { bindingCode: reset.bindingCodeDisplay, relation: "爸爸" },
      dadToken,
    ),
  );
});

test("开启审核开关后，输码变成提交申请，审核通过前看不到孩子数据", async () => {
  const settings = ok(
    await patch(ctx.base, "/settings", { "binding.requiresReview": true }, ownerToken),
    "开启审核开关",
  );
  assert.equal(settings["binding.requiresReview"], true);

  const { student, bindingCodeDisplay } = await createStudent("审核测试");
  const token = await loginGuardian(ctx.base, "device-review");
  const result = ok(
    await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation: "奶奶" }, token),
  );
  assert.equal(result.status, "待审核");
  assert.equal(result.profile.students.length, 0, "审核通过前不应出现在已绑列表");
  assert.equal(result.profile.pendingBindings.length, 1);

  // 待审核状态下访问孩子数据被拒
  failsWith(
    await get(ctx.base, `/points/ledger?studentId=${student.id}`, token),
    "FORBIDDEN",
    "待审核期间",
  );

  // 再输一次码，提示等待审核
  failsWith(
    await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation: "奶奶" }, token),
    "BINDING_PENDING_REVIEW",
  );

  // 负责人审核通过
  const pending = ok(await get(ctx.base, "/bindings?status=待审核", ownerToken));
  const target = pending.find((item) => item.studentId === student.id);
  assert.ok(target, "应有待审核申请");
  ok(await post(ctx.base, `/bindings/${target.id}/review`, { decision: "approve" }, ownerToken));

  const after = ok(await get(ctx.base, "/auth/profile", token));
  assert.equal(after.students.length, 1);
  ok(await get(ctx.base, `/points/ledger?studentId=${student.id}`, token), "审核后应可访问");

  // 恢复默认设置，不影响其它用例
  ok(await patch(ctx.base, "/settings", { "binding.requiresReview": false }, ownerToken));
});

test("穷举绑定码会被限流拦下", async () => {
  const token = await loginGuardian(ctx.base, "device-brute-force");
  const { generateBindingCode } = await import("@warm-study/shared");
  let limited = false;
  for (let i = 0; i < 15; i += 1) {
    const result = await post(
      ctx.base,
      "/bindings/by-code",
      { bindingCode: generateBindingCode(), relation: "妈妈" },
      token,
    );
    if (result.body.code === "TOO_MANY_ATTEMPTS") {
      limited = true;
      break;
    }
  }
  assert.ok(limited, "连续失败后应触发限流");
});

test("未登录不能绑定", async () => {
  const { bindingCodeDisplay } = await createStudent("未登录测试");
  failsWith(
    await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation: "妈妈" }),
    "UNAUTHENTICATED",
  );
});

test("同一设备再次登录拿到同一个身份，绑定关系还在", async () => {
  const { bindingCodeDisplay } = await createStudent("持久身份测试");
  const first = await loginGuardian(ctx.base, "device-persist", "持久家长");
  ok(await post(ctx.base, "/bindings/by-code", { bindingCode: bindingCodeDisplay, relation: "妈妈" }, first));

  // 模拟重新打开小程序
  const second = await loginGuardian(ctx.base, "device-persist");
  const profile = ok(await get(ctx.base, "/auth/profile", second));
  assert.equal(profile.students.length, 1);
  assert.equal(profile.displayName, "持久家长");
});

test("退出登录后 token 立即失效", async () => {
  const token = await loginGuardian(ctx.base, "device-logout");
  ok(await get(ctx.base, "/auth/profile", token));
  ok(await post(ctx.base, "/auth/logout", {}, token));
  failsWith(await get(ctx.base, "/auth/profile", token), "UNAUTHENTICATED");
});

test("老师没有建学员和管绑定码的权限", async () => {
  const staffToken = await loginStaff(ctx.base);
  failsWith(
    await post(ctx.base, "/students", { name: "老师建的", grade: "一年级" }, staffToken),
    "FORBIDDEN",
  );
  const { student } = await createStudent("权限测试");
  failsWith(
    await post(ctx.base, `/students/${student.id}/binding-code/reset`, { reason: "试试" }, staffToken),
    "FORBIDDEN",
  );
  failsWith(await get(ctx.base, "/bindings", staffToken), "FORBIDDEN");
});

test("绑定码展示格式与库内规范形式互相一致", async () => {
  const { student, bindingCodeDisplay } = await createStudent("格式一致性");
  assert.equal(formatBindingCode(student.bindingCode), bindingCodeDisplay);
});
