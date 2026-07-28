#!/usr/bin/env node
/**
 * 小程序静态校验。
 *
 * 背景：这个仓库跑在云端沙箱里，**装不了微信开发者工具**，
 * 所以小程序端没法像 H5 那样用真浏览器点一遍。
 * 与其嘴上说"应该没问题"，不如把开发者工具会报的那类错误
 * 尽量在这里提前抓出来。抓不到的部分在 docs/h5-to-miniprogram.md 里如实列了。
 *
 * 覆盖的检查：
 *   1. app.json 的 pages 与磁盘上的四件套是否一一对应
 *   2. usingComponents 引用的组件路径能否解析
 *   3. WXML 里 {{}} 引用的顶层字段，是否在页面的 data 或 setData 里出现过
 *   4. wx:for 是否漏了 wx:key（列表复用错乱的头号原因）
 *   5. bindtap 绑的方法是否真的存在
 *   6. WXSS 是否用了小程序不支持的选择器（*、标签选择器、属性选择器等）
 *   7. 两端设计令牌是否漂移（tokens.wxss 必须由 H5 的 styles.css 生成）
 *   8. shared/ 里是否用了小程序基础库可能没有的 JS API
 *   9. 接口路径是否都能在 shared 的 ENDPOINTS 契约里找到
 *
 * 用法：npm run check:mp
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MP = join(root, "miniprogram");

const problems = [];
const warnings = [];
const fail = (file, message) => problems.push({ file, message });
const warn = (file, message) => warnings.push({ file, message });

function read(path) {
  return readFileSync(path, "utf8");
}

/** tsconfig / jsconfig 允许注释（JSONC），解析前先剥掉 */
function stripJsonComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1");
}

function readJson(path, label) {
  try {
    return JSON.parse(stripJsonComments(read(path)));
  } catch (error) {
    fail(relative(root, path), `${label} 不是合法 JSON：${error.message}`);
    return null;
  }
}

function walk(dir, filter, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

/* ------------------------ 1. app.json 与页面四件套 ------------------------ */

const appJson = readJson(join(MP, "app.json"), "app.json");
if (!appJson) {
  report();
  process.exit(1);
}

const pages = appJson.pages ?? [];
if (pages.length === 0) fail("app.json", "pages 为空");

for (const page of pages) {
  for (const ext of ["wxml", "json", "ts"]) {
    const file = join(MP, `${page}.${ext}`);
    // .ts 允许退化成 .js
    if (ext === "ts" && !existsSync(file) && existsSync(join(MP, `${page}.js`))) continue;
    if (!existsSync(file)) fail("app.json", `pages 里的 ${page} 缺少 .${ext} 文件`);
  }
}

// tabBar 里列的页面必须也在 pages 里
for (const item of appJson.tabBar?.list ?? []) {
  if (!pages.includes(item.pagePath)) {
    fail("app.json", `tabBar 里的 ${item.pagePath} 不在 pages 中`);
  }
}
if (appJson.tabBar && (appJson.tabBar.list ?? []).length > 5) {
  fail("app.json", "微信小程序原生 tabBar 最多 5 项");
}
if (appJson.tabBar?.custom && !existsSync(join(MP, "custom-tab-bar", "index.wxml"))) {
  fail("app.json", "声明了 custom tabBar，但缺少 custom-tab-bar/index.wxml");
}
if (appJson.sitemapLocation && !existsSync(join(MP, appJson.sitemapLocation))) {
  fail("app.json", `sitemapLocation 指向的 ${appJson.sitemapLocation} 不存在`);
}

/* ------------------------ 2. usingComponents 路径 ------------------------ */

const jsonFiles = walk(
  MP,
  (f) => f.endsWith(".json") && !f.includes("/shared/") && !/(ts|js)config\.json$/.test(f),
);
for (const file of jsonFiles) {
  const config = readJson(file, relative(root, file));
  if (!config) continue;
  for (const [name, path] of Object.entries(config.usingComponents ?? {})) {
    // 绝对路径以 / 开头，相对路径基于当前文件所在目录
    const base = path.startsWith("/") ? join(MP, path.slice(1)) : resolve(dirname(file), path);
    if (!existsSync(`${base}.wxml`)) {
      fail(relative(root, file), `usingComponents 的 "${name}" 指向 ${path}，找不到对应的 .wxml`);
    }
  }
}

/* ---------------- 3~5. WXML 绑定、wx:for、事件处理函数 ---------------- */

/** 从 WXML 里抽出所有 {{ }} 表达式引用的顶层标识符 */
function referencedIdentifiers(wxml) {
  const ids = new Set();
  const keywords = new Set([
    "true", "false", "null", "undefined", "index", "item", "true", "length",
  ]);
  for (const match of wxml.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const expr = match[1];
    // 去掉字符串字面量，避免把中文文案当成标识符
    const stripped = expr.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    for (const id of stripped.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)) {
      const name = id[2];
      if (!keywords.has(name)) ids.add(name);
    }
  }
  return ids;
}

/** wx:for 会引入局部变量，这些不算未定义 */
function localScopeNames(wxml) {
  const names = new Set(["item", "index"]);
  for (const m of wxml.matchAll(/wx:for-item\s*=\s*"([^"]+)"/g)) names.add(m[1]);
  for (const m of wxml.matchAll(/wx:for-index\s*=\s*"([^"]+)"/g)) names.add(m[1]);
  return names;
}

const wxmlFiles = walk(MP, (f) => f.endsWith(".wxml") && !f.includes("/shared/"));

for (const wxmlPath of wxmlFiles) {
  const wxml = read(wxmlPath);
  const rel = relative(root, wxmlPath);
  const logicPath = ["ts", "js"]
    .map((ext) => wxmlPath.replace(/\.wxml$/, `.${ext}`))
    .find((p) => existsSync(p));

  // wx:for 必须带 wx:key —— 少了它，列表更新时组件复用会串数据
  for (const tag of wxml.matchAll(/<[^>]*\bwx:for\s*=[^>]*>/g)) {
    if (!/\bwx:key\s*=/.test(tag[0])) {
      const preview = tag[0].replace(/\s+/g, " ").slice(0, 80);
      fail(rel, `wx:for 缺少 wx:key：${preview}…`);
    }
  }

  // 不该出现的标签：小程序没有这些
  for (const badTag of ["div", "span", "p", "ul", "li", "a", "strong", "img", "select"]) {
    const re = new RegExp(`<${badTag}[\\s/>]`, "g");
    if (re.test(wxml)) fail(rel, `用了 HTML 标签 <${badTag}>，小程序里不存在`);
  }

  // 功能图标不能用 emoji（design.md §4.5）
  const emoji = wxml.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  if (emoji) fail(rel, `出现 emoji「${emoji[0]}」，功能图标必须用线性 SVG`);

  if (!logicPath) continue;
  const logic = read(logicPath);
  const locals = localScopeNames(wxml);

  // 绑定引用的字段是否在逻辑文件里出现过（data 初值或 setData）
  for (const id of referencedIdentifiers(wxml)) {
    if (locals.has(id)) continue;
    // WXS 模块和过滤器函数也会出现在表达式里
    if (new RegExp(`<wxs[^>]*module\\s*=\\s*"${id}"`).test(wxml)) continue;
    if (!new RegExp(`\\b${id}\\b`).test(logic)) {
      fail(rel, `模板引用了 {{${id}}}，但 ${relative(root, logicPath)} 里没有这个字段`);
    }
  }

  // bindtap / catchtap 绑定的方法必须存在
  for (const m of wxml.matchAll(/\b(?:bind|catch)(?::)?(?:tap|change|input|confirm|blur|focus|longpress|submit)\s*=\s*"([^"{}]+)"/g)) {
    const handler = m[1].trim();
    if (!handler) continue;
    if (!new RegExp(`\\b${handler}\\s*[(:]`).test(logic)) {
      fail(rel, `绑定了事件处理函数 ${handler}，但 ${relative(root, logicPath)} 里没有定义`);
    }
  }
}

/* ------------------------- 6. WXSS 不支持的写法 ------------------------- */

const wxssFiles = walk(MP, (f) => f.endsWith(".wxss"));
/** WXSS 不支持这些选择器（微信官方文档明确列出） */
const UNSUPPORTED_SELECTORS = [
  { re: /^\s*\*\s*[,{]/m, label: "通配选择器 *" },
  { re: /\[[\w-]+[~^$*|]?=?[^\]]*\]\s*\{/m, label: "属性选择器" },
  { re: /:focus-visible/, label: ":focus-visible" },
  { re: /::placeholder/, label: "::placeholder（小程序用 placeholder-class）" },
  { re: /::-webkit-scrollbar/, label: "::-webkit-scrollbar" },
  { re: /:has\(/, label: ":has()" },
  { re: /@media\s*\(prefers-reduced-motion/, label: "prefers-reduced-motion 媒体查询" },
];

for (const file of wxssFiles) {
  const css = read(file);
  const rel = relative(root, file);
  for (const rule of UNSUPPORTED_SELECTORS) {
    if (rule.re.test(css)) fail(rel, `用了 WXSS 不支持的 ${rule.label}`);
  }
  // px 在小程序里不会随屏幕缩放，除非是刻意为之的发丝线
  for (const m of css.matchAll(/:\s*[^;]*?(\d+)px/g)) {
    if (Number(m[1]) > 1) {
      warn(rel, `出现 ${m[1]}px —— 小程序里应该用 rpx，否则不同屏幕尺寸不缩放`);
      break;
    }
  }
}

/* -------------------------- 7. 设计令牌是否漂移 -------------------------- */

const stylesCss = read(join(root, "h5", "src", "styles.css"));
const tokensWxssPath = join(MP, "styles", "tokens.wxss");
if (!existsSync(tokensWxssPath)) {
  fail("miniprogram/styles/tokens.wxss", "缺失，请运行 npm run build:wxss");
} else {
  const tokensWxss = read(tokensWxssPath);
  const h5Root = stylesCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const h5Tokens = new Map();
  for (const m of h5Root.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    h5Tokens.set(m[1], m[2].trim());
  }
  const mpTokens = new Map();
  for (const m of tokensWxss.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    mpTokens.set(m[1], m[2].trim());
  }
  for (const [name, value] of h5Tokens) {
    if (name === "--safe-b") continue; // 平台写法不同，脚本里已跳过
    if (!mpTokens.has(name)) {
      fail("miniprogram/styles/tokens.wxss", `缺少令牌 ${name}，请重新运行 npm run build:wxss`);
      continue;
    }
    // 颜色类令牌两端必须字面一致；长度类经过 px→rpx 换算，只比较数值关系
    if (/^#|^rgba?\(/.test(value) && mpTokens.get(name) !== value) {
      fail(
        "miniprogram/styles/tokens.wxss",
        `${name} 与 H5 不一致（H5 ${value} / 小程序 ${mpTokens.get(name)}），请重新运行 npm run build:wxss`,
      );
    }
  }
}

/* --------------------- 8. shared 里可能不兼容的 JS API --------------------- */

/**
 * 小程序基础库不是完整浏览器环境。这几个是实际踩过或高风险的：
 * crypto 在多数基础库里不存在（shared 已做 Math.random 兜底，这里只提示）；
 * 其余几个在低版本基础库上没有。
 */
const RISKY_APIS = [
  { re: /\bglobalThis\.crypto\b|\bcrypto\.getRandomValues\b/, label: "crypto.getRandomValues", note: "shared 已有 Math.random 兜底，仅提示" },
  { re: /\bstructuredClone\(/, label: "structuredClone", note: "小程序不支持" },
  { re: /\bObject\.hasOwn\(/, label: "Object.hasOwn", note: "需较新基础库" },
  { re: /\.replaceAll\(/, label: "String.replaceAll", note: "需较新基础库" },
  { re: /\bArray\.prototype\.at\b|\.at\(-/, label: "Array.at", note: "需较新基础库" },
  { re: /\bIntl\./, label: "Intl", note: "小程序支持不完整" },
  { re: /\bnew URL\(/, label: "URL 构造器", note: "小程序没有，需手拼查询串" },
  { re: /\bfetch\(/, label: "fetch", note: "小程序要用 wx.request" },
  { re: /\blocalStorage\b/, label: "localStorage", note: "小程序要用 wx.setStorageSync" },
  { re: /\bdocument\.|window\./, label: "DOM / window", note: "小程序没有 DOM" },
];

const sharedFiles = existsSync(join(MP, "shared"))
  ? walk(join(MP, "shared"), (f) => f.endsWith(".js"))
  : [];
for (const file of sharedFiles) {
  const code = read(file);
  const rel = relative(root, file);
  for (const api of RISKY_APIS) {
    if (!api.re.test(code)) continue;
    if (api.label === "crypto.getRandomValues") warn(rel, `${api.label} —— ${api.note}`);
    else fail(rel, `用了 ${api.label}：${api.note}`);
  }
}

/* ----------------------- 9. 接口路径是否符合契约 ----------------------- */

const contract = read(join(root, "shared", "src", "api-contract.ts"));
const contractPaths = new Set();
for (const m of contract.matchAll(/path:\s*"([^"]+)"/g)) contractPaths.add(m[1]);

/** 把调用里的具体 id 还原成契约里的 :id 形式 */
function toTemplate(path) {
  return path
    .replace(/\$\{[^}]+\}/g, ":id")
    .replace(/\/[a-z]+_[a-z0-9]+/gi, "/:id");
}

const logicFiles = walk(
  MP,
  (f) => (f.endsWith(".ts") || f.endsWith(".js")) && !f.includes("/shared/") && !f.endsWith(".d.ts"),
);
for (const file of logicFiles) {
  const code = read(file);
  const rel = relative(root, file);
  for (const m of code.matchAll(/api\.(?:get|post|patch)<[^>]*>\(\s*[`"']([^`"']+)/g)) {
    const called = toTemplate(m[1].split("?")[0]);
    const known = [...contractPaths].some((p) => p === called || toTemplate(p) === called);
    if (!known) {
      fail(rel, `调用了契约里没有的接口路径 ${m[1]}`);
    }
  }
}

/* --------------------------------- 汇报 --------------------------------- */

function report() {
  const byFile = new Map();
  for (const item of problems) {
    if (!byFile.has(item.file)) byFile.set(item.file, []);
    byFile.get(item.file).push(item.message);
  }

  console.log(`\n小程序静态校验：${wxmlFiles.length} 个 WXML，${pages.length} 个页面\n`);

  if (problems.length === 0) {
    console.log("  ✓ 没有发现问题");
  } else {
    for (const [file, messages] of byFile) {
      console.log(`  ✗ ${file}`);
      for (const message of messages) console.log(`      ${message}`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n提示（不阻断）：`);
    const seen = new Set();
    for (const item of warnings) {
      const key = `${item.file}|${item.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  · ${item.file}：${item.message}`);
    }
  }

  console.log(
    `\n结论：${problems.length} 个问题，${warnings.length} 条提示\n` +
      `注意：静态检查抓不到渲染效果、TabBar 挂载、真机交互 —— 那些必须在微信开发者工具里验。\n`,
  );
}

report();
process.exit(problems.length > 0 ? 1 : 0);
