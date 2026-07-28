#!/usr/bin/env node
/**
 * 从 h5/src/styles.css 的 :root 块生成 miniprogram/styles/tokens.wxss。
 *
 * 为什么只生成令牌、不整体生成样式表：
 * 两端的**标记结构本来就不一样**，而且是有意的 —— 小程序没有 <strong>/<span>，
 * 导航栏走原生 navigationBar，轻提示走 wx.showToast。硬把 H5 的选择器搬过去
 * 只会得到一堆匹配不上的规则。
 *
 * 但**令牌**必须只有一份。颜色、圆角、投影这些一旦两边各写一套，
 * 改个主色就要改两处，迟早漂。所以令牌自动生成，组件层各自适配 var(--x)。
 *
 * px → rpx 按 375 设计稿换算（1px = 2rpx）。
 *
 * 用法：npm run build:wxss
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "h5", "src", "styles.css");
const OUT_DIR = join(root, "miniprogram", "styles");
const OUT = join(OUT_DIR, "tokens.wxss");

const css = readFileSync(SRC, "utf8");
const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/);
if (!rootBlock) {
  console.error("在 h5/src/styles.css 里找不到 :root 块");
  process.exit(1);
}

/** 这些令牌不是给小程序用的，或者需要平台特有的写法 */
const SKIP = new Set([
  "--safe-b", // 小程序用 env() 时写法不同，在 app.wxss 里单独处理
]);

/**
 * px → rpx。只转真正的长度值，不碰颜色里的数字。
 * 注意 0 不加单位，小数按 375 稿换算后取一位。
 */
function pxToRpx(value) {
  return value.replace(/(-?\d*\.?\d+)px/g, (_m, num) => {
    const rpx = Number(num) * 2;
    if (rpx === 0) return "0";
    return `${Number.isInteger(rpx) ? rpx : rpx.toFixed(1)}rpx`;
  });
}

const lines = [];
let pending = [];
for (const raw of rootBlock[1].split("\n")) {
  const comment = raw.match(/^\s*\/\*\s*(.+?)\s*\*\/\s*$/);
  if (comment) {
    pending.push(`  /* ${comment[1]} */`);
    continue;
  }
  const decl = raw.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
  if (!decl) continue;
  const [, name, value] = decl;
  if (SKIP.has(name)) {
    pending = [];
    continue;
  }
  lines.push(...pending);
  pending = [];
  lines.push(`  ${name}: ${pxToRpx(value.trim())};`);
}

const banner = `/**
 * 设计令牌 —— 自动生成，请勿手改。
 *
 * 来源：h5/src/styles.css 的 :root 块
 * 生成：npm run build:wxss（脚本 scripts/build-miniprogram-wxss.mjs）
 *
 * 长度已按 375 设计稿从 px 换算成 rpx（1px = 2rpx）。
 * 要改配色或圆角，请改 h5/src/styles.css，然后重新生成 —— 两端同时生效。
 */

page {
${lines.join("\n")}
}
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, banner, "utf8");
console.log(`已生成 ${lines.filter((l) => l.includes("--")).length} 个令牌 → miniprogram/styles/tokens.wxss`);
