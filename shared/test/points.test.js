import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregatePeriodScores,
  buildLeaderboard,
  checkSufficient,
  computeBalance,
  countsTowardPeriodScore,
  maskName,
  publicDisplayName,
  verifyBalance,
} from "../dist/index.js";

let seq = 0;
function entry(overrides = {}) {
  seq += 1;
  return {
    id: `led_${seq}`,
    studentId: "stu_1",
    delta: 10,
    type: "作业奖励",
    reason: "完成作业",
    balanceAfter: 0,
    operatorId: "usr_staff",
    reversed: false,
    createdAt: "2026-07-20T02:00:00.000Z",
    ...overrides,
  };
}

test("余额是流水汇总的结果", () => {
  const entries = [entry({ delta: 10 }), entry({ delta: 5 }), entry({ delta: -8, type: "兑换扣除" })];
  assert.equal(computeBalance(entries), 7);
  assert.equal(computeBalance([]), 0);
});

test("对账能发现缓存余额与流水不一致", () => {
  const entries = [entry({ delta: 10 }), entry({ delta: -3, type: "兑换扣除" })];
  assert.deepEqual(verifyBalance(7, entries), { ok: true, expected: 7, cached: 7, diff: 0 });
  const bad = verifyBalance(9, entries);
  assert.equal(bad.ok, false);
  assert.equal(bad.diff, 2);
});

test("余额不足检查", () => {
  assert.equal(checkSufficient(10, 10), null);
  assert.equal(checkSufficient(10, 11), "INSUFFICIENT_POINTS");
  assert.equal(checkSufficient(0, 0), null);
});

test("排行只计正向、未被冲正、非兑换相关的流水", () => {
  assert.equal(countsTowardPeriodScore(entry({ delta: 10 })), true);
  assert.equal(countsTowardPeriodScore(entry({ delta: -10, type: "兑换扣除" })), false);
  assert.equal(countsTowardPeriodScore(entry({ delta: 10, reversed: true })), false);
  // 撤销兑换返还的分不能让排名上涨
  assert.equal(countsTowardPeriodScore(entry({ delta: 10, type: "撤销冲正" })), false);
  assert.equal(countsTowardPeriodScore(entry({ delta: 0 })), false);
});

test("花积分兑换不降低当期排名", () => {
  const entries = [
    entry({ studentId: "a", delta: 30, createdAt: "2026-07-20T01:00:00.000Z" }),
    entry({ studentId: "a", delta: -25, type: "兑换扣除", createdAt: "2026-07-21T01:00:00.000Z" }),
    entry({ studentId: "b", delta: 20, createdAt: "2026-07-20T01:00:00.000Z" }),
  ];
  const scores = aggregatePeriodScores(entries);
  const a = scores.find((s) => s.studentId === "a");
  const b = scores.find((s) => s.studentId === "b");
  assert.equal(a.score, 30, "兑换扣除不应减少周期得分");
  assert.equal(b.score, 20);
  const rows = buildLeaderboard(scores, { displayNameOf: (id) => id });
  assert.equal(rows[0].studentId, "a");
});

test("周期过滤按 dateKey 闭区间", () => {
  const entries = [
    entry({ studentId: "a", delta: 5, createdAt: "2026-07-19T16:30:00.000Z" }), // UTC+8 → 07-20
    entry({ studentId: "a", delta: 7, createdAt: "2026-07-26T15:00:00.000Z" }), // UTC+8 → 07-26
    entry({ studentId: "a", delta: 100, createdAt: "2026-07-26T16:30:00.000Z" }), // UTC+8 → 07-27，超出
  ];
  const scores = aggregatePeriodScores(entries, { start: "2026-07-20", end: "2026-07-26" });
  assert.equal(scores.length, 1);
  assert.equal(scores[0].score, 12);
});

test("排行同分时先达到者靠前", () => {
  const scores = [
    { studentId: "late", score: 20, reachedAt: "2026-07-22T10:00:00.000Z" },
    { studentId: "early", score: 20, reachedAt: "2026-07-21T10:00:00.000Z" },
  ];
  const rows = buildLeaderboard(scores, { displayNameOf: (id) => id });
  assert.equal(rows[0].studentId, "early");
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].rank, 2);
});

test("分数与达成时间都相同则并列，名次跳号", () => {
  const at = "2026-07-21T10:00:00.000Z";
  const scores = [
    { studentId: "a", score: 20, reachedAt: at },
    { studentId: "b", score: 20, reachedAt: at },
    { studentId: "c", score: 10, reachedAt: at },
  ];
  const rows = buildLeaderboard(scores, { displayNameOf: (id) => id });
  assert.deepEqual(
    rows.map((r) => r.rank),
    [1, 1, 3],
  );
});

test("不公开参与排行的学生被剔除", () => {
  const scores = [
    { studentId: "a", score: 30, reachedAt: "2026-07-21T10:00:00.000Z" },
    { studentId: "secret", score: 99, reachedAt: "2026-07-21T10:00:00.000Z" },
  ];
  const rows = buildLeaderboard(scores, {
    displayNameOf: (id) => id,
    isPublic: (id) => id !== "secret",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].studentId, "a");
});

test("零分和负分不上榜", () => {
  const rows = buildLeaderboard(
    [{ studentId: "a", score: 0, reachedAt: "2026-07-21T10:00:00.000Z" }],
    { displayNameOf: (id) => id },
  );
  assert.equal(rows.length, 0);
});

test("姓名脱敏", () => {
  assert.equal(maskName("张小明"), "张*明");
  assert.equal(maskName("欧阳小小明"), "欧***明");
  assert.equal(maskName("张三"), "张*");
  assert.equal(maskName("张"), "张");
});

test("家长端展示名优先用昵称", () => {
  assert.equal(publicDisplayName("小明", "张小明"), "小明");
  assert.equal(publicDisplayName("  ", "张小明"), "张*明");
  assert.equal(publicDisplayName(null, "张小明"), "张*明");
});

test("标记自己家孩子", () => {
  const rows = buildLeaderboard(
    [
      { studentId: "a", score: 30, reachedAt: "2026-07-21T10:00:00.000Z" },
      { studentId: "mine", score: 10, reachedAt: "2026-07-21T10:00:00.000Z" },
    ],
    { displayNameOf: (id) => id, selfStudentIds: ["mine"] },
  );
  assert.equal(rows.find((r) => r.studentId === "mine").isSelf, true);
  assert.equal(rows.find((r) => r.studentId === "a").isSelf, false);
});
