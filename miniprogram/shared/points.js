/**
 * 积分账务与排行榜口径。
 *
 * 铁律（requirements R4）：
 *  - 余额是流水汇总的结果，任何地方都不能直接改余额；
 *  - 余额不允许为负；
 *  - 流水永不删除，撤销靠写一条反向流水实现。
 */
import { isDateKeyInRange, dateKeyOfIso } from "./datetime.js";
/** 流水汇总出真实余额。这是余额的唯一真值来源。 */
export function computeBalance(entries) {
    return entries.reduce((sum, entry) => sum + entry.delta, 0);
}
/** 缓存余额与流水汇总是否一致，用于每周只读对账。 */
export function verifyBalance(cachedBalance, entries) {
    const expected = computeBalance(entries);
    return {
        ok: expected === cachedBalance,
        expected,
        cached: cachedBalance,
        diff: cachedBalance - expected,
    };
}
/** 扣分前的余额检查。返回 null 表示可以扣。 */
export function checkSufficient(balance, cost) {
    if (cost <= 0)
        return null;
    return balance >= cost ? null : "INSUFFICIENT_POINTS";
}
/**
 * 一条流水是否计入"周期内积分排名"。
 *
 * 只统计周期内**正向且有效**的获得：
 *  - delta 必须 > 0；
 *  - 被冲正的原始流水不算（reversed = true）；
 *  - 兑换扣除本身是负数，天然不算 —— 保证「花积分不掉排名」；
 *  - 撤销兑换产生的返还（撤销冲正）也不算，否则退货反而涨分。
 */
export function countsTowardPeriodScore(entry) {
    if (entry.delta <= 0)
        return false;
    if (entry.reversed)
        return false;
    const excludedTypes = ["兑换扣除", "撤销冲正"];
    return !excludedTypes.includes(entry.type);
}
/** 按学生汇总周期内得分。start/end 为闭区间 dateKey，省略则统计全部。 */
export function aggregatePeriodScores(entries, range, tzOffsetMinutes) {
    const buckets = new Map();
    for (const entry of entries) {
        if (!countsTowardPeriodScore(entry))
            continue;
        if (range) {
            const key = dateKeyOfIso(entry.createdAt, tzOffsetMinutes);
            if (!isDateKeyInRange(key, range.start, range.end))
                continue;
        }
        const current = buckets.get(entry.studentId);
        if (current) {
            current.score += entry.delta;
            if (entry.createdAt > current.reachedAt)
                current.reachedAt = entry.createdAt;
        }
        else {
            buckets.set(entry.studentId, {
                studentId: entry.studentId,
                score: entry.delta,
                reachedAt: entry.createdAt,
            });
        }
    }
    return [...buckets.values()];
}
/**
 * 生成排行榜。
 * 排序：分数高的在前；同分则先达到该分数的在前；分数与达成时间都相同则并列同名次。
 * 名次采用竞技排名（1,2,2,4）。
 */
export function buildLeaderboard(scores, options) {
    const selfIds = new Set(options.selfStudentIds ?? []);
    const visible = scores.filter((item) => (options.isPublic ? options.isPublic(item.studentId) : true) && item.score > 0);
    const sorted = [...visible].sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        if (a.reachedAt !== b.reachedAt)
            return a.reachedAt < b.reachedAt ? -1 : 1;
        return a.studentId < b.studentId ? -1 : 1;
    });
    const rows = [];
    let lastScore = null;
    let lastReachedAt = null;
    let lastRank = 0;
    sorted.forEach((item, index) => {
        const tied = item.score === lastScore && item.reachedAt === lastReachedAt;
        const rank = tied ? lastRank : index + 1;
        lastScore = item.score;
        lastReachedAt = item.reachedAt;
        lastRank = rank;
        rows.push({
            rank,
            studentId: item.studentId,
            displayName: options.displayNameOf(item.studentId),
            score: item.score,
            isSelf: selfIds.has(item.studentId),
        });
    });
    // limit 为 0 / 负数时应该返回空，不能因为 falsy 就当成"不限制"整表返回
    if (options.limit === undefined || options.limit === null)
        return rows;
    return rows.slice(0, Math.max(0, options.limit));
}
/** 家长端姓名脱敏：张小明 → 张*明，两字姓名 → 张*。 */
export function maskName(name) {
    const chars = [...name];
    if (chars.length <= 1)
        return name;
    if (chars.length === 2)
        return `${chars[0]}*`;
    return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}
/** 家长端展示名：优先昵称，没有昵称就用脱敏姓名。 */
export function publicDisplayName(nickname, name) {
    const trimmed = (nickname ?? "").trim();
    return trimmed.length > 0 ? trimmed : maskName(name);
}
/** 幂等键：同一张作业单同一条规则只发一次积分。 */
export function homeworkRewardKey(sheetId, ruleId = "default") {
    return `HOMEWORK_REWARD:${sheetId}:${ruleId}`;
}
/** 幂等键：同一次辅导同一个 ETA 只发一条提醒。 */
export function pickupNoticeKey(sessionId, etaAt) {
    return `PICKUP_NOTICE:${sessionId}:${etaAt}`;
}
/** 冲正幂等键：一条流水最多被冲正一次。 */
export function reversalKey(ledgerId) {
    return `REVERSAL:${ledgerId}`;
}
//# sourceMappingURL=points.js.map