/**
 * 时间工具。辅导班按本地时区（默认 Asia/Shanghai，UTC+8）划分"今天"，
 * 服务器可能跑在 UTC 上，所以所有 dateKey 都要显式按偏移量算，不能直接用本地时间。
 */

/** 辅导班时区相对 UTC 的偏移分钟数，默认 +8 小时。 */
export const DEFAULT_TZ_OFFSET_MINUTES = 8 * 60;

function shift(date: Date, offsetMinutes: number): Date {
  return new Date(date.getTime() + offsetMinutes * 60_000);
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/** yyyy-MM-dd，按辅导班时区。 */
export function toDateKey(
  date: Date = new Date(),
  offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES,
): string {
  const local = shift(date, offsetMinutes);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/** HH:mm，按辅导班时区。 */
export function toTimeLabel(
  date: Date = new Date(),
  offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES,
): string {
  const local = shift(date, offsetMinutes);
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/**
 * 在当前时刻上加若干分钟，返回 HH:mm，用于「15/30/60 分钟后可接」。
 * 只返回时刻不带日期，所以调用方要保证 minutes 不会跨到第二天 ——
 * 否则家长看到「预计 09:50 可接」会以为是今天上午。
 */
export function etaAfterMinutes(
  minutes: number,
  from: Date = new Date(),
  offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES,
): string {
  return toTimeLabel(new Date(from.getTime() + minutes * 60_000), offsetMinutes);
}

/** 加上这些分钟后会不会跨到第二天。跨天的 ETA 用 HH:mm 表达会产生歧义。 */
export function etaCrossesMidnight(
  minutes: number,
  from: Date = new Date(),
  offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES,
): boolean {
  return toDateKey(from, offsetMinutes) !== toDateKey(new Date(from.getTime() + minutes * 60_000), offsetMinutes);
}

/** 校验 HH:mm 形式的时刻字符串。 */
export function isValidTimeLabel(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** 本周（周一为一周开始）的 [起, 止] dateKey，闭区间。 */
export function weekRange(
  date: Date = new Date(),
  offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES,
): { start: string; end: string } {
  const local = shift(date, offsetMinutes);
  // getUTCDay: 0=周日
  const weekday = (local.getUTCDay() + 6) % 7; // 0=周一
  const monday = new Date(local.getTime() - weekday * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { start: dateKeyFromUtcParts(monday), end: dateKeyFromUtcParts(sunday) };
}

/** 本月的 [起, 止] dateKey，闭区间。 */
export function monthRange(
  date: Date = new Date(),
  offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES,
): { start: string; end: string } {
  const local = shift(date, offsetMinutes);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  return { start: dateKeyFromUtcParts(first), end: dateKeyFromUtcParts(last) };
}

function dateKeyFromUtcParts(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** ISO 时间戳 → 辅导班时区的 dateKey。 */
export function dateKeyOfIso(iso: string, offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES): string {
  return toDateKey(new Date(iso), offsetMinutes);
}

/** "07-26 15:04" 这样的紧凑展示，用于流水和审计列表。 */
export function compactStamp(iso: string, offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES): string {
  const local = shift(new Date(iso), offsetMinutes);
  return `${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(
    local.getUTCHours(),
  )}:${pad(local.getUTCMinutes())}`;
}

/**
 * 校验 dateKey 是不是真实存在的一天。
 * 光用正则不够：`2026-02-30` 和 `9999-99-99` 都能通过正则，
 * 落库之后这条记录就永远不会出现在任何按日期查询的界面里。
 */
export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** 判断 dateKey 是否落在闭区间内（字符串比较即可，因为格式定长）。 */
export function isDateKeyInRange(dateKey: string, start: string, end: string): boolean {
  return dateKey >= start && dateKey <= end;
}
