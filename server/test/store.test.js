/**
 * 商店域：现场兑换是全系统最需要事务保证的动作 ——
 * 扣积分、减库存、写兑换记录必须要么全成、要么全不成。
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

/** 新建学生，可选直接充一笔初始积分 */
async function createStudent(name, points = 0) {
  const created = ok(
    await post(ctx.base, "/students", { name, grade: "四年级" }, ownerToken),
    `新建学生 ${name}`,
  );
  if (points > 0) {
    ok(
      await post(
        ctx.base,
        "/points/grant",
        {
          studentId: created.student.id,
          delta: points,
          type: "表现奖励",
          reason: "测试初始积分",
          requestId: reqId("seed-points"),
        },
        staffToken,
      ),
      "发初始积分",
    );
  }
  return created;
}

async function findProduct(name) {
  const list = ok(await get(ctx.base, "/products", ownerToken), "查商品");
  const found = list.find((product) => product.name === name);
  assert.ok(found, `没有找到商品「${name}」`);
  return found;
}

async function balanceOf(studentId) {
  return ok(await get(ctx.base, `/points/ledger?studentId=${studentId}`, ownerToken)).balance;
}

async function ledgerOf(studentId) {
  return ok(await get(ctx.base, `/points/ledger?studentId=${studentId}`, ownerToken)).entries;
}

async function redemptionsOf(studentId, token = ownerToken) {
  return ok(await get(ctx.base, `/redemptions?studentId=${studentId}`, token), "查兑换记录");
}

async function redeem(studentId, productId, token = staffToken, requestId = reqId("rdm")) {
  return post(ctx.base, "/redemptions", { studentId, productId, requestId }, token);
}

test("老师现场兑换：扣分、减库存、生成兑换记录三件事都发生", async () => {
  const { student } = await createStudent("兑换顺利", 40);
  const product = await findProduct("贴纸大礼包"); // 15 分
  const stockBefore = product.stock;

  const result = ok(await redeem(student.id, product.id), "兑换");
  assert.equal(result.balanceAfter, 25);
  assert.equal(result.redemption.status, "已完成");
  assert.equal(result.redemption.pointsCost, 15);
  assert.equal(result.redemption.studentId, student.id);
  assert.equal(result.redemption.productSnapshot.name, "贴纸大礼包");

  // 1. 扣分
  assert.equal(await balanceOf(student.id), 25);
  const deductions = (await ledgerOf(student.id)).filter((entry) => entry.type === "兑换扣除");
  assert.equal(deductions.length, 1);
  assert.equal(deductions[0].delta, -15);
  assert.equal(deductions[0].id, result.redemption.ledgerId, "兑换记录要指回那条流水");
  assert.equal(deductions[0].sourceRef, `product:${product.id}`);

  // 2. 减库存
  assert.equal((await findProduct("贴纸大礼包")).stock, stockBefore - 1);

  // 3. 兑换记录
  const records = await redemptionsOf(student.id);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, result.redemption.id);
  assert.equal(records[0].studentName, "兑换顺利");
});

test("余额不足时整个事务回滚：库存不变、没有流水、没有兑换记录", async () => {
  const { student } = await createStudent("买不起"); // 0 分
  const product = await findProduct("橡皮擦套装"); // 20 分
  const stockBefore = product.stock;

  const failure = failsWith(await redeem(student.id, product.id), "INSUFFICIENT_POINTS", "余额不足");
  assert.equal(failure.details.balance, 0);
  assert.equal(failure.details.required, 20);

  assert.equal((await findProduct("橡皮擦套装")).stock, stockBefore, "库存不该变");
  assert.equal((await ledgerOf(student.id)).length, 0, "不该留下任何流水");
  assert.equal(await balanceOf(student.id), 0);
  assert.equal((await redemptionsOf(student.id)).length, 0, "不该留下兑换记录");
});

test("库存为 0 的商品不能兑换", async () => {
  const { student } = await createStudent("想要断货货", 50);
  const product = ok(
    await post(ctx.base, "/products", { name: "断货铅笔", pointsCost: 5, stock: 0 }, ownerToken),
    "上架一个零库存商品",
  );
  assert.equal(product.status, "上架");

  failsWith(await redeem(student.id, product.id), "OUT_OF_STOCK", "零库存兑换");
  assert.equal(await balanceOf(student.id), 50, "不该扣分");
  assert.equal((await redemptionsOf(student.id)).length, 0);
});

test("下架的商品不能兑换", async () => {
  const { student } = await createStudent("想要下架货", 50);
  const product = ok(
    await post(
      ctx.base,
      "/products",
      { name: "已下架橡皮", pointsCost: 5, stock: 9, status: "下架" },
      ownerToken,
    ),
    "上架后立刻下架",
  );

  const failure = failsWith(await redeem(student.id, product.id), "INVALID_STATE", "下架商品");
  assert.match(failure.message, /未上架/);
  assert.equal((await findProduct("已下架橡皮")).stock, 9, "库存不该动");
  assert.equal(await balanceOf(student.id), 50);

  // 家长端根本看不到下架商品
  const parentToken = await loginGuardian(ctx.base, "device-store-shelf", "看货家长");
  const parentList = ok(await get(ctx.base, "/products", parentToken));
  assert.equal(
    parentList.some((item) => item.name === "已下架橡皮"),
    false,
    "家长端只列上架商品",
  );

  // 重新上架后就能兑了
  ok(await patch(ctx.base, `/products/${product.id}`, { status: "上架" }, ownerToken));
  ok(await redeem(student.id, product.id), "重新上架后兑换");
});

test("限兑商品每人只能兑一次", async () => {
  const { student } = await createStudent("想多拿书", 200);
  const book = await findProduct("课外读物"); // 80 分，每人限 1 次
  assert.equal(book.perStudentLimit, 1);
  const stockBefore = book.stock;

  const first = ok(await redeem(student.id, book.id), "第一次兑换");
  assert.equal(first.balanceAfter, 120);

  const failure = failsWith(
    await redeem(student.id, book.id),
    "REDEEM_LIMIT_REACHED",
    "第二次兑换",
  );
  assert.equal(failure.details.limit, 1);
  assert.equal(failure.details.used, 1);

  assert.equal(await balanceOf(student.id), 120, "第二次不该扣分");
  assert.equal((await findProduct("课外读物")).stock, stockBefore - 1, "库存只该减一次");
  assert.equal((await redemptionsOf(student.id)).length, 1);

  // 换个孩子还能兑（限的是"每人"不是"总量"）
  const { student: other } = await createStudent("另一个娃", 100);
  ok(await redeem(other.id, book.id), "别的孩子兑换");
});

test("同一个 requestId 重复提交只兑换一次", async () => {
  const { student } = await createStudent("重复点两下", 100);
  const product = await findProduct("贴纸大礼包"); // 15 分
  const stockBefore = product.stock;
  const requestId = reqId("dup-redeem");

  const first = ok(await redeem(student.id, product.id, staffToken, requestId), "第一次提交");
  assert.equal(first.balanceAfter, 85);

  failsWith(
    await redeem(student.id, product.id, staffToken, requestId),
    "DUPLICATE_REQUEST",
    "重复提交",
  );

  assert.equal(await balanceOf(student.id), 85, "不该扣第二次分");
  assert.equal((await findProduct("贴纸大礼包")).stock, stockBefore - 1, "库存不该减第二次");
  assert.equal((await redemptionsOf(student.id)).length, 1, "只该有一条兑换记录");
  assert.equal(
    (await ledgerOf(student.id)).filter((entry) => entry.type === "兑换扣除").length,
    1,
  );
});

test("兑换后改商品价格，历史兑换记录里的价格快照不变", async () => {
  const { student } = await createStudent("快照娃", 100);
  const product = ok(
    await post(ctx.base, "/products", { name: "限时橡皮", pointsCost: 10, stock: 5 }, ownerToken),
  );

  const result = ok(await redeem(student.id, product.id), "按 10 分兑换");
  assert.equal(result.redemption.pointsCost, 10);
  assert.equal(await balanceOf(student.id), 90);

  // 涨价到 99 分
  const updated = ok(
    await patch(ctx.base, `/products/${product.id}`, { pointsCost: 99, name: "限时橡皮改名" }, ownerToken),
    "改价",
  );
  assert.equal(updated.pointsCost, 99);

  const records = await redemptionsOf(student.id);
  assert.equal(records.length, 1);
  assert.equal(records[0].pointsCost, 10, "历史扣分不该被改价影响");
  assert.equal(records[0].productSnapshot.pointsCost, 10, "快照里的价格也不变");
  assert.equal(records[0].productSnapshot.name, "限时橡皮", "快照留的是当时的商品名");
  assert.equal(await balanceOf(student.id), 90, "余额也不该被改价影响");
});

test("负责人撤销兑换：积分回来、库存回来、记录变已撤销并写冲正流水", async () => {
  const { student } = await createStudent("拿错东西", 60);
  const product = await findProduct("橡皮擦套装"); // 20 分
  const stockBefore = product.stock;

  const result = ok(await redeem(student.id, product.id), "先兑换");
  assert.equal(result.balanceAfter, 40);
  assert.equal((await findProduct("橡皮擦套装")).stock, stockBefore - 1);

  const reversed = ok(
    await post(
      ctx.base,
      `/redemptions/${result.redemption.id}/reverse`,
      { reason: "孩子拿错了，换成贴纸" },
      ownerToken,
    ),
    "撤销兑换",
  );
  assert.equal(reversed.balanceAfter, 60, "积分要回来");
  assert.equal(reversed.redemption.status, "已撤销");
  assert.ok(reversed.redemption.reversedAt);
  assert.ok(reversed.redemption.reversalLedgerId);

  assert.equal(await balanceOf(student.id), 60);
  assert.equal((await findProduct("橡皮擦套装")).stock, stockBefore, "库存要回来");

  const entries = await ledgerOf(student.id);
  const original = entries.find((entry) => entry.id === result.redemption.ledgerId);
  assert.equal(original.reversed, true, "原扣分流水标记为已冲正");
  const reversal = entries.find((entry) => entry.id === reversed.redemption.reversalLedgerId);
  assert.equal(reversal.delta, 20);
  assert.equal(reversal.type, "撤销冲正");
  assert.equal(reversal.reversalOf, result.redemption.ledgerId);
  assert.match(reversal.reason, /撤销兑换/);
});

test("老师无权撤销兑换", async () => {
  const { student } = await createStudent("老师想撤销", 60);
  const product = await findProduct("橡皮擦套装");
  const result = ok(await redeem(student.id, product.id));

  failsWith(
    await post(
      ctx.base,
      `/redemptions/${result.redemption.id}/reverse`,
      { reason: "我来撤一下" },
      staffToken,
    ),
    "FORBIDDEN",
    "老师撤销",
  );
  assert.equal(await balanceOf(student.id), 40, "余额不该变");
  assert.equal((await redemptionsOf(student.id))[0].status, "已完成");
});

test("同一笔兑换不能撤销两次", async () => {
  const { student } = await createStudent("撤两次", 60);
  const product = await findProduct("橡皮擦套装");
  const result = ok(await redeem(student.id, product.id));
  const stockAfterRedeem = (await findProduct("橡皮擦套装")).stock;

  ok(
    await post(
      ctx.base,
      `/redemptions/${result.redemption.id}/reverse`,
      { reason: "第一次撤销" },
      ownerToken,
    ),
  );
  failsWith(
    await post(
      ctx.base,
      `/redemptions/${result.redemption.id}/reverse`,
      { reason: "再撤一次" },
      ownerToken,
    ),
    "DUPLICATE_REQUEST",
    "第二次撤销",
  );

  assert.equal(await balanceOf(student.id), 60, "不该退两次分");
  assert.equal((await findProduct("橡皮擦套装")).stock, stockAfterRedeem + 1, "库存只该退一次");
  assert.equal((await ledgerOf(student.id)).length, 3, "发分 + 扣分 + 一条冲正");

  // 撤销原因是必填的
  const another = ok(await redeem(student.id, product.id));
  failsWith(
    await post(ctx.base, `/redemptions/${another.redemption.id}/reverse`, {}, ownerToken),
    "INVALID_ARGUMENT",
    "撤销不填原因",
  );
});

test("家长只能看到自己孩子的兑换记录", async () => {
  const mine = await createStudent("我家娃", 50);
  const other = await createStudent("别家娃", 50);
  const product = await findProduct("贴纸大礼包");

  const parentToken = await loginGuardian(ctx.base, "device-store-parent", "我家家长");
  ok(
    await post(
      ctx.base,
      "/bindings/by-code",
      { bindingCode: mine.bindingCodeDisplay, relation: "妈妈" },
      parentToken,
    ),
    "绑定我家娃",
  );

  ok(await redeem(mine.student.id, product.id), "给我家娃兑换");
  ok(await redeem(other.student.id, product.id), "给别家娃兑换");

  const list = ok(await get(ctx.base, "/redemptions", parentToken), "家长看兑换记录");
  assert.equal(list.length, 1);
  assert.equal(list[0].studentId, mine.student.id);

  failsWith(
    await get(ctx.base, `/redemptions?studentId=${other.student.id}`, parentToken),
    "FORBIDDEN",
    "偷看别家兑换记录",
  );

  // 家长自己也不能发起兑换（没有 redemption.create）
  failsWith(
    await redeem(mine.student.id, product.id, parentToken),
    "FORBIDDEN",
    "家长自助兑换",
  );

  // 管理端两条都能看到
  const adminList = ok(await get(ctx.base, "/redemptions", ownerToken));
  const studentIds = adminList.map((item) => item.studentId);
  assert.ok(studentIds.includes(mine.student.id) && studentIds.includes(other.student.id));
});

test("兑换过程结束后账目仍然对得上", async () => {
  const report = ok(await get(ctx.base, "/points/reconcile", ownerToken), "对账");
  assert.deepEqual(report.mismatches, [], "兑换和撤销之后余额不该和流水对不上");
});
