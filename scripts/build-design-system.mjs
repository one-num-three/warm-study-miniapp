#!/usr/bin/env node
/**
 * 从 h5/src/styles.css 生成一套可导入 Claude Design 的组件库。
 *
 * 关键设计：每个预览文件都**内联真实的 styles.css**，不另写一份「演示样式」。
 * 这样预览里看到的就是线上真正的样子，设计师改动能一对一映射回代码；
 * 一旦有人改了 styles.css 而忘了同步设计稿，重跑这个脚本立刻就能看出来。
 *
 * 用法：npm run build:design
 * 产物：design-system/（每个 .html 首行带 @dsCard 标记，Claude Design 据此建卡片）
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "design-system");
const APP_CSS = readFileSync(join(root, "h5", "src", "styles.css"), "utf8");

/* --------------------------- 从 CSS 里抽取设计令牌 --------------------------- */

/**
 * 直接解析 :root 块，而不是在这里另抄一份令牌表。
 * 抄一份的话两边一定会漂，而设计系统最怕的就是「文档写的和代码跑的不一样」。
 */
function extractTokens() {
  const rootBlock = APP_CSS.match(/:root\s*\{([\s\S]*?)\n\}/);
  if (!rootBlock) throw new Error("styles.css 里找不到 :root 块");
  const tokens = [];
  let currentGroup = "其它";
  for (const line of rootBlock[1].split("\n")) {
    const comment = line.match(/\/\*\s*(.+?)\s*\*\//);
    if (comment) {
      currentGroup = comment[1];
      continue;
    }
    const decl = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (decl) tokens.push({ name: decl[1], value: decl[2].trim(), group: currentGroup });
  }
  return tokens;
}

const TOKENS = extractTokens();
const colorTokens = TOKENS.filter((t) => /^#|rgb/.test(t.value));
const radiusTokens = TOKENS.filter((t) => t.name.startsWith("--r-"));

/** 每档圆角的用途说明，展示在色板旁边 */
const RADIUS_USAGE = {
  "--r-sm": "小元素",
  "--r-md": "按钮 / 输入框",
  "--r-lg": "卡片 / 弹层",
};

/* ------------------------------- 预览页模板 ------------------------------- */

/** 卡片外壳：内联真实样式 + 一点仅用于展示的排版样式。 */
function page({ group, name, subtitle, width = 390, height, body, bare = false }) {
  const marker = `<!-- @dsCard group="${group}" name="${name}"${
    subtitle ? ` subtitle="${subtitle}"` : ""
  } width="${width}"${height ? ` height="${height}"` : ""} -->`;

  // bare = true 时不加演示用的留白，用于整屏页面预览
  const demoCss = bare
    ? `body{margin:0;background:var(--c-bg);}`
    : `body{margin:0;padding:18px 14px 26px;background:var(--c-bg);}
       .ds-section{margin:0 0 22px;}
       .ds-section:last-child{margin-bottom:0;}
       .ds-label{margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--c-ink-3);}
       .ds-note{margin:6px 0 0;font-size:11px;line-height:1.7;color:var(--c-ink-2);}
       .ds-swatch{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--c-line);}
       .ds-swatch:last-child{border-bottom:0;}
       .ds-chip{width:38px;height:38px;flex:0 0 auto;border-radius:10px;border:1px solid rgba(0,0,0,.08);}
       .ds-swatch code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:var(--c-ink-2);}
       .ds-swatch b{display:block;font-size:13px;}
       .ds-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}`;

  return `${marker}
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>暖芽设计系统 · ${name}</title>
<style>
/* ↓↓↓ 以下是 h5/src/styles.css 的原文，由 scripts/build-design-system.mjs 内联 ↓↓↓ */
${APP_CSS}
/* ↑↑↑ 原文结束。下面是仅用于本预览页的排版样式 ↑↑↑ */
${demoCss}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function section(label, ...blocks) {
  return `<div class="ds-section"><p class="ds-label">${label}</p>${blocks.join("\n")}</div>`;
}

function note(text) {
  return `<p class="ds-note">${text}</p>`;
}

/* --------------------------------- 卡片定义 --------------------------------- */

const cards = [];
const add = (path, spec) => cards.push({ path, spec });

/* ---------- 基础：色彩 ---------- */
add("foundations/colors.html", {
  group: "Foundations",
  name: "色板",
  subtitle: "主色 / 强调 / 背景层次 / 文字 / 语义",
  height: 720,
  body: [
    section(
      "全部颜色令牌",
      `<div class="card">${colorTokens
        .map(
          (t) => `<div class="ds-swatch">
            <div class="ds-chip" style="background:${t.value}"></div>
            <div style="flex:1;min-width:0">
              <b>${t.name}</b>
              <code>${t.value}</code>
            </div>
            <span class="tag tag--muted">${t.group}</span>
          </div>`,
        )
        .join("")}</div>`,
      note(
        "深绿 <code>--c-primary</code> 是唯一主色，导航栏、主按钮、tab 选中态都用它。" +
          "陶土红 <code>--c-accent</code> 只用于「要花掉的东西」（扣分、待接、限时提醒），不要拿它当第二主色。",
      ),
    ),
    section(
      "背景的三层关系",
      `<div style="padding:14px;background:var(--c-bg);border-radius:var(--r-lg)">
        <p class="ds-note" style="margin:0 0 8px">--c-bg 页面底</p>
        <div class="card" style="margin-bottom:8px"><div class="card__title">--c-surface 卡片</div>
          <div class="card--flat" style="padding:10px;border-radius:var(--r-md)">--c-surface-2 卡内分区</div>
        </div>
      </div>`,
      note("三层都是暖米色系，靠明度拉开而不是靠边框。改配色时请保持这个明度顺序，否则卡片会「浮」不起来。"),
    ),
  ].join(""),
});

/* ---------- 基础：字号 ---------- */
add("foundations/typography.html", {
  group: "Foundations",
  name: "字号层级",
  subtitle: "从 32px 数字到 11px 标签，共 7 级",
  height: 620,
  body: [
    section(
      "层级",
      `<div class="card">
        <div style="font-size:32px;font-weight:700;line-height:1.1">32 / 700　积分数字</div>
        <div class="ds-note">.hero__value —— 每屏只出现一次</div>
        <div class="divider"></div>
        <div style="font-size:24px;font-weight:700;color:var(--c-primary)">24 / 700　看板指标</div>
        <div class="ds-note">.metric strong</div>
        <div class="divider"></div>
        <div style="font-size:17px;font-weight:700">17 / 700　弹层标题</div>
        <div class="ds-note">.sheet__title</div>
        <div class="divider"></div>
        <div style="font-size:16px;font-weight:600">16 / 600　导航栏标题</div>
        <div class="ds-note">.navbar__title</div>
        <div class="divider"></div>
        <div style="font-size:15px;font-weight:700">15 / 700　卡片标题</div>
        <div class="ds-note">.card__title</div>
        <div class="divider"></div>
        <div style="font-size:14px;font-weight:600">14 / 600　列表主行</div>
        <div class="ds-note">.row__title · 正文按钮也是 14</div>
        <div class="divider"></div>
        <div style="font-size:12px;color:var(--c-ink-2)">12 / 400　列表副行、说明文字</div>
        <div class="ds-note">.row__sub · .card__hint</div>
        <div class="divider"></div>
        <div style="font-size:11px;font-weight:600;color:var(--c-ink-3)">11 / 600　标签、指标名</div>
        <div class="ds-note">.tag · .metric span</div>
      </div>`,
    ),
    section(
      "字体栈",
      `<div class="card"><code style="font-size:11px;line-height:1.9;word-break:break-all">system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif</code></div>`,
      note(
        "<b>刻意不引任何 Web 字体</b>。小程序包体装不下中文字体子集，规格里也写明「包体不允许则降级为平台默认中文字体」。" +
          "所以设计时只能用系统字体已有的字重（常规 400 / 中黑 500-600 / 粗 700），不要指定 Light 或特殊字形。",
      ),
    ),
  ].join(""),
});

/* ---------- 基础：圆角与间距 ---------- */
add("foundations/spacing-radius.html", {
  group: "Foundations",
  name: "圆角与间距",
  subtitle: "3 档圆角 · 8px 栅格 · rpx 换算",
  height: 560,
  body: [
    section(
      "圆角",
      `<div class="card">${radiusTokens
        .map(
          (t) => `<div class="ds-swatch">
            <div class="ds-chip" style="background:var(--c-primary-soft);border-radius:${t.value}"></div>
            <div style="flex:1"><b>${t.name}</b><code>${t.value}</code></div>
            <span class="tag tag--muted">${
              RADIUS_USAGE[t.name] ?? ""
            }</span>
          </div>`,
        )
        .join("")}
        <div class="ds-swatch">
          <div class="ds-chip" style="background:var(--c-primary);border-radius:50% 50% 50% 10px"></div>
          <div style="flex:1"><b>头像</b><code>50% 50% 50% 10px</code></div>
          <span class="tag tag--muted">刻意不对称</span>
        </div>
      </div>`,
      note("头像左下角那个 10px 直角是品牌记号，登录页的「芽」字标同理（16px 圆角 + 5px 直角 + 旋转 -4°）。"),
    ),
    section(
      "间距",
      `<div class="card">
        <div class="ds-note" style="margin:0 0 8px">页面左右留白 14px，卡片内 14px，卡片之间 12px，列表行上下 11px。</div>
        <div style="display:flex;gap:8px;align-items:flex-end">
          ${[4, 8, 12, 14, 18, 22]
            .map(
              (n) =>
                `<div style="text-align:center"><div style="width:${n * 2}px;height:${n * 2}px;background:var(--c-primary-soft);border-radius:4px"></div><code style="font-size:10px">${n}</code></div>`,
            )
            .join("")}
        </div>
      </div>`,
      note(
        "<b>小程序换算：375px 设计稿上 1px = 2rpx。</b>标注请给 px，我落地时统一乘 2。" +
          "触控目标最小 40px（.btn 的 min-height），列表整行可点时最小 44px。",
      ),
    ),
  ].join(""),
});

/* ---------- 组件：按钮 ---------- */
add("components/buttons.html", {
  group: "Components",
  name: "按钮",
  subtitle: "5 种语义 × 2 尺寸 × 通栏/禁用",
  height: 560,
  body: [
    section(
      "语义",
      `<div class="card">
        <div class="ds-row">
          <button class="btn btn--primary">主操作</button>
          <button class="btn">次操作</button>
          <button class="btn btn--ghost">弱操作</button>
        </div>
        <div class="ds-row" style="margin-top:10px">
          <button class="btn btn--accent">现场兑换</button>
          <button class="btn btn--danger">停用学员</button>
          <button class="btn btn--primary" disabled>禁用态</button>
        </div>
      </div>`,
      note(
        "一屏最多一个 <code>btn--primary</code>。<code>btn--accent</code> 只给「要花掉积分」的动作，" +
          "<code>btn--danger</code> 只给不可逆或需要负责人权限的动作。",
      ),
    ),
    section(
      "小尺寸（列表行内）",
      `<div class="card">
        <div class="ds-row">
          <button class="btn btn--sm btn--primary">开始</button>
          <button class="btn btn--sm">完成</button>
          <button class="btn btn--sm btn--ghost">未完成</button>
          <button class="btn btn--sm btn--accent">发接娃提醒</button>
        </div>
      </div>`,
      note("小尺寸 min-height 30px，只在卡片内的操作行里用；单独成行的操作一律用大尺寸通栏按钮。"),
    ),
    section(
      "通栏",
      `<div class="card">
        <button class="btn btn--primary btn--block">新增学员（自动生成绑定码）</button>
        <button class="btn btn--block" style="margin-top:8px">添加一项</button>
        <button class="btn btn--ghost btn--block" style="margin-top:8px">退出登录</button>
      </div>`,
    ),
  ].join(""),
});

/* ---------- 组件：标签 ---------- */
add("components/tags.html", {
  group: "Components",
  name: "状态标签",
  subtitle: "5 种色调 · 对应业务状态机",
  height: 520,
  body: [
    section(
      "色调",
      `<div class="card"><div class="ds-row">
        <span class="tag">默认</span>
        <span class="tag tag--gold">进行中</span>
        <span class="tag tag--accent">需注意</span>
        <span class="tag tag--muted">已结束</span>
        <span class="tag tag--danger">异常</span>
      </div></div>`,
    ),
    section(
      "每日到班状态（正向推进）",
      `<div class="card"><div class="ds-row">
        <span class="tag tag--muted">待到班</span>
        <span style="color:var(--c-ink-3)">→</span>
        <span class="tag">已到班</span>
        <span style="color:var(--c-ink-3)">→</span>
        <span class="tag tag--gold">辅导中</span>
        <span style="color:var(--c-ink-3)">→</span>
        <span class="tag tag--accent">待接</span>
        <span style="color:var(--c-ink-3)">→</span>
        <span class="tag">已接走</span>
      </div></div>`,
      note("「待接」用陶土红是有意的 —— 这是唯一需要老师立刻行动的状态，看板上也用它做高亮指标。"),
    ),
    section(
      "作业单状态",
      `<div class="card"><div class="ds-row">
        <span class="tag">待确认</span>
        <span class="tag tag--accent">需要补充</span>
        <span class="tag tag--gold">辅导中</span>
        <span class="tag">已完成</span>
        <span class="tag tag--muted">未完成</span>
        <span class="tag tag--muted">已撤回</span>
      </div></div>`,
    ),
    section(
      "错题状态",
      `<div class="card"><div class="ds-row">
        <span class="tag tag--accent">待订正</span>
        <span class="tag tag--gold">已订正</span>
        <span class="tag">已掌握</span>
      </div></div>`,
    ),
  ].join(""),
});

/* ---------- 组件：卡片与列表 ---------- */
add("components/cards-rows.html", {
  group: "Components",
  name: "卡片与列表行",
  subtitle: "承载 90% 内容的两个容器",
  height: 700,
  body: [
    section(
      "标准卡片",
      `<div class="card">
        <div class="card__title"><div>今天在班里</div><span class="tag tag--gold">辅导中</span></div>
        <p class="card__hint">卡片标题右侧可以放一个状态标签或一个小按钮，两者不同时出现。</p>
      </div>`,
    ),
    section(
      "列表行（三种右侧形态）",
      `<div class="card">
        <div class="row">
          <div class="avatar">张</div>
          <div class="row__main">
            <div class="row__title">张小满（小满）</div>
            <div class="row__sub">三年级 · 我是妈妈</div>
          </div>
          <div class="row__value">40 分</div>
        </div>
        <div class="row">
          <div class="avatar avatar--accent">陈</div>
          <div class="row__main">
            <div class="row__title">陈知夏</div>
            <div class="row__sub">四年级 · 作业待确认</div>
          </div>
          <button class="btn btn--sm">查看</button>
        </div>
        <div class="row">
          <div class="row__main">
            <div class="row__title">林听白 → 小白妈妈</div>
            <div class="row__sub">关系：妈妈 · 07-26 15:04</div>
          </div>
          <span class="tag tag--gold">待审核</span>
        </div>
      </div>`,
      note(
        "右侧只能三选一：数值、单个按钮、单个标签。三者都想要时说明这行信息过载了，应该拆成卡片。" +
          "头像只在「人」的列表里出现（学员、家长），事务性列表不用。",
      ),
    ),
    section(
      "分区标题",
      `<div class="section-title"><div>今日学员 · 2026-07-26</div><span class="text-small text-muted">共 12 人</span></div>
       <div class="card"><p class="card__hint">分区标题在卡片外，用来切分同一页里的不同内容块。</p></div>`,
    ),
  ].join(""),
});

/* ---------- 组件：指标与 hero ---------- */
add("components/metrics-hero.html", {
  group: "Components",
  name: "数据展示",
  subtitle: "积分 hero · 看板指标格 · 排行榜 · 流水",
  height: 780,
  body: [
    section(
      "积分 hero（家长端首屏）",
      `<div class="hero">
        <p class="hero__label">张小满的积分余额</p>
        <strong class="hero__value">128</strong>
        <div class="hero__foot"><div>年级 三年级</div><div>我是妈妈</div></div>
      </div>`,
      note("每屏只出现一次，是家长打开小程序第一眼要看到的东西。渐变从 --c-primary 到 #3f7359。"),
    ),
    section(
      "看板指标格",
      `<div class="grid grid--3">
        <div class="metric"><strong>3</strong><span>待到班</span></div>
        <div class="metric"><strong>5</strong><span>已到班</span></div>
        <div class="metric"><strong>4</strong><span>辅导中</span></div>
        <div class="metric is-alert"><strong>2</strong><span>待接</span></div>
        <div class="metric"><strong>1</strong><span>已接走</span></div>
        <div class="metric"><strong>2</strong><span>今日未交作业</span></div>
      </div>`,
      note("<code>.is-alert</code> 把数字变成陶土红，只给「待接」用 —— 一屏里最多一个告警指标。"),
    ),
    section(
      "排行榜",
      `<div class="card">
        <div class="rank rank--top1"><div class="rank__no">1</div><div class="row__main"><div class="row__title">小满</div></div><div class="row__value">86</div></div>
        <div class="rank rank--top2"><div class="rank__no">2</div><div class="row__main"><div class="row__title">夏夏</div></div><div class="row__value">72</div></div>
        <div class="rank rank--top3"><div class="rank__no">3</div><div class="row__main"><div class="row__title">小白</div></div><div class="row__value">65</div></div>
        <div class="rank is-self"><div class="rank__no">4</div><div class="row__main"><div class="row__title">行行（我家）</div></div><div class="row__value">58</div></div>
      </div>`,
      note(
        "家长端只显示昵称或脱敏姓名（张*明），这是隐私要求不能改。" +
          "<code>.is-self</code> 给自家孩子加浅绿底，让家长一眼找到自己。",
      ),
    ),
    section(
      "积分流水",
      `<div class="card">
        <div class="row"><div class="row__main"><div class="row__title">上周作业全部按时完成</div><div class="row__sub">表现奖励 · 07-24 17:30</div></div><div class="ledger__delta is-plus">+30</div></div>
        <div class="row"><div class="row__main"><div class="row__title">兑换「自动铅笔」</div><div class="row__sub">兑换扣除 · 07-25 18:02</div></div><div class="ledger__delta is-minus">-35</div></div>
        <div class="row"><div class="row__main"><div class="row__title is-reversed">发错人了</div><div class="row__sub">表现奖励 · 07-26 09:12</div></div><div class="ledger__delta is-plus is-reversed">+20</div></div>
      </div>`,
      note("被冲正的流水加删除线但<b>永不隐藏</b> —— 账目要能倒查，这是产品的硬规则。"),
    ),
  ].join(""),
});

/* ---------- 组件：表单 ---------- */
add("components/forms.html", {
  group: "Components",
  name: "表单",
  subtitle: "输入 / 下拉 / 多行 / 开关 / 筛选条",
  height: 700,
  body: [
    section(
      "字段",
      `<div class="card">
        <div class="field">
          <label class="field__label">姓名 *</label>
          <input value="张小满">
        </div>
        <div class="field">
          <label class="field__label">年级</label>
          <select><option>三年级</option></select>
        </div>
        <div class="field">
          <label class="field__label">辅导反馈</label>
          <textarea>口算又快又准，生字写得工整</textarea>
          <p class="field__hint">反馈会直接展示给家长。</p>
        </div>
        <div class="field">
          <label class="field__label">冲正原因 *</label>
          <input value="" placeholder="必填，会记入审计日志">
          <p class="field__error">请填写「冲正原因」</p>
        </div>
      </div>`,
    ),
    section(
      "开关行",
      `<div class="card">
        <div class="row">
          <div class="row__main"><div class="row__title">绑定码需要人工审核</div><div class="row__sub">关闭时家长输码即绑定</div></div>
          <div class="switch is-on"></div>
        </div>
        <div class="row">
          <div class="row__main"><div class="row__title">家长端排行显示真实姓名</div><div class="row__sub">默认关闭，只显示昵称或脱敏姓名</div></div>
          <div class="switch"></div>
        </div>
      </div>`,
    ),
    section(
      "筛选条",
      `<div class="picker">
        <button class="is-active">本周</button>
        <button>本月</button>
        <button>累计</button>
      </div>
      <div class="picker">
        <button class="is-active">小满</button>
        <button>夏夏</button>
        <button>行行</button>
      </div>`,
      note("横向可滚动，不换行。绑了多个孩子的家长用它切换，超过 3 个时右侧要露出半个来暗示可滑。"),
    ),
  ].join(""),
});

/* ---------- 组件：导航 ---------- */
add("components/navigation.html", {
  group: "Components",
  name: "导航",
  subtitle: "导航栏 · 家长端/管理端两套 TabBar",
  height: 560,
  body: [
    section(
      "导航栏",
      `<div style="border-radius:var(--r-md);overflow:hidden">
        <div class="navbar" style="padding-top:12px"><div class="navbar__title">今日看板</div><div class="navbar__extra">王负责人</div></div>
      </div>
      <div style="border-radius:var(--r-md);overflow:hidden;margin-top:8px">
        <div class="navbar" style="padding-top:12px">
          <button class="navbar__back"><svg viewBox="0 0 24 24" class="tabbar__icon"><path d="M15 5l-7 7 7 7"/></svg></button>
          <div class="navbar__title">学员详情</div>
        </div>
      </div>`,
      note("Tab 页没有返回箭头，详情页有 —— 和微信小程序的规矩一致。右侧只放一行说明文字，不放操作。"),
    ),
    section(
      "TabBar · 家长端",
      tabbar([
        ["今日「, 」M3 9h18M7 3v3m10-3v3M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", true],
        ["作业「, 」M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 0v6h6M9 13h6M9 17h4", false],
        ["成长「, 」M4 19V9m5 10V5m5 14v-7m5 7V8", false],
        ["我的「, 」M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 8a8 8 0 0 1 16 0", false],
      ]),
    ),
    section(
      "TabBar · 管理端",
      tabbar([
        ["看板「, 」M4 4h7v7H4V4Zm9 0h7v4h-7V4ZM4 13h7v7H4v-7Zm9-3h7v10h-7V10Z", true],
        ["作业「, 」M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 0v6h6M9 13h6M9 17h4", false],
        ["学员「, 」M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-7 9a7 7 0 0 1 14 0M17 8a2.5 2.5 0 1 0 0-5M18 20a6 6 0 0 0-2-4.5", false],
        ["管理「, 」M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.13-1.45l2.06-1.6-2-3.46-2.43.98a8.4 8.4 0 0 0-2.5-1.45L15 2.4h-4l-.4 2.62a8.4 8.4 0 0 0-2.5 1.45l-2.43-.98-2 3.46 2.06 1.6a8.4 8.4 0 0 0 0 2.9l-2.06 1.6 2 3.46 2.43-.98a8.4 8.4 0 0 0 2.5 1.45L11 21.6h4l.4-2.62a8.4 8.4 0 0 0 2.5-1.45l2.43.98 2-3.46-2.06-1.6c.09-.47.13-.96.13-1.45Z", false],
      ]),
      note(
        "<b>图标必须是线性 SVG，禁止用 emoji</b>（规格 design.md §4.5 硬性要求）。" +
          "线宽统一 1.7，端点和拐角都是圆的。微信小程序原生 tabBar 最多 5 项，我们用 4 项，改版时别超。",
      ),
    ),
  ].join(""),
});

function tabbar(items) {
  return `<div style="position:relative;height:${56}px;border-radius:var(--r-md);overflow:hidden;border:1px solid var(--c-line)">
    <div class="tabbar" style="position:absolute;width:100%">
      ${items
        .map(
          ([label, d, active]) => `<div class="tabbar__item${active ? " is-active" : ""}">
            <svg viewBox="0 0 24 24" class="tabbar__icon"><path d="${d}"/></svg>
            <div>${label}</div>
          </div>`,
        )
        .join("")}
    </div>
  </div>`;
}

/* ---------- 组件：弹层 ---------- */
add("components/overlays.html", {
  group: "Components",
  name: "弹层与反馈",
  subtitle: "底部表单 / 确认框 / 轻提示 / 空态",
  height: 820,
  body: [
    section(
      "底部表单面板",
      `<div style="border-radius:var(--r-lg);overflow:hidden;background:rgba(30,38,32,.45);padding-top:20px">
        <div class="sheet" style="animation:none">
          <h3 class="sheet__title">结束今天的作业</h3>
          <p class="card__hint" style="margin-bottom:12px">反馈会直接展示给家长。</p>
          <div class="field"><label class="field__label">辅导反馈 *</label><textarea style="min-height:60px">口算又快又准</textarea></div>
          <div class="field"><label class="field__label">奖励积分</label><input value="10"></div>
          <div class="btn-row"><button class="btn btn--ghost" style="flex:1">取消</button><button class="btn btn--primary" style="flex:2">确认结束</button></div>
        </div>
      </div>`,
      note("取消:确认 = 1:2 的宽度比，主操作永远在右。"),
    ),
    section(
      "确认框",
      `<div style="border-radius:var(--r-lg);background:rgba(30,38,32,.45);padding:20px;display:flex;justify-content:center">
        <div class="dialog">
          <h3 class="dialog__title">停用这名学员？</h3>
          <p class="dialog__body">停用后不再产生新记录，历史数据全部保留。</p>
          <div class="btn-row"><button class="btn btn--ghost" style="flex:1">取消</button><button class="btn btn--danger" style="flex:1">确定</button></div>
        </div>
      </div>`,
    ),
    section(
      "轻提示",
      `<div style="border-radius:var(--r-lg);background:var(--c-surface-2);padding:20px;display:flex;flex-direction:column;gap:10px;align-items:center">
        <div class="toast" style="position:static;transform:none">已发放 30 分</div>
        <div class="toast toast--error" style="position:static;transform:none">家长还没绑定，提醒已记录但没发出去，请电话联系</div>
      </div>`,
      note("失败提示用深红底。<b>通知没发成功时绝不能用绿色成功态</b> —— 这是产品底线，不能为了好看改掉。"),
    ),
    section(
      "空态与加载",
      `<div class="card"><div class="empty">今天还没有家长提交作业</div></div>
       <div class="card"><div class="loading">加载中…</div></div>`,
    ),
  ].join(""),
});

/* ---------- 绑定码专区 ---------- */
add("binding-code/code-input.html", {
  group: "绑定码",
  name: "绑定码输入框",
  subtitle: "空 / 输入中 / 校验通过 / 校验失败",
  height: 700,
  body: [
    section(
      "四种状态",
      `<div class="card">
        <div class="field">
          <label class="field__label">空</label>
          <input class="code-input" placeholder="····-····" value="">
        </div>
        <div class="field">
          <label class="field__label">输入中</label>
          <input class="code-input" value="K3M9-Q">
          <p class="field__hint">还差 2 位</p>
        </div>
        <div class="field">
          <label class="field__label">校验通过</label>
          <input class="code-input is-valid" value="K3M9-QX2T">
          <div class="code-preview"><span class="tag">已找到</span><div>张** · 三年级</div></div>
        </div>
        <div class="field">
          <label class="field__label">校验失败</label>
          <input class="code-input is-invalid" value="AAAA-AAAA">
          <p class="field__error">绑定码不正确，请检查是否输错</p>
        </div>
      </div>`,
    ),
    note(
      "<b>这是整个产品最关键的一个输入框</b>，家长第一次打开小程序就面对它。已经做进去的体验，改版时请保留：" +
        "①边输边归一化：自动大写、第 5 位自动补短横、把误输的 O 纠正成 0、I/L 纠正成 1、全角转半角；" +
        "②满 8 位先在本地验校验位，错了当场变红，不发网络请求；" +
        "③校验位通过后才向服务端要一次脱敏姓名预览，让家长确认「绑的是自家娃」再提交。",
    ),
    section(
      "字符集说明",
      `<div class="card">
        <p class="card__hint" style="margin-bottom:8px">Crockford Base32，共 32 个字符：</p>
        <div class="mono" style="font-size:15px;line-height:1.9;word-break:break-all">0123456789ABCDEFGHJKMNPQRSTVWXYZ</div>
        <p class="card__hint" style="margin-top:8px"><b>不含 I、L、O、U</b> —— 家长照着纸条手输时不会把 0 认成 O、1 认成 I 或 l。占位符用 <code>····-····</code> 而不是 <code>XXXX-XXXX</code>，避免暗示「这里要填字母 X」。</p>
      </div>`,
    ),
  ].join(""),
});

add("binding-code/code-plate.html", {
  group: "绑定码",
  name: "绑定码牌子",
  subtitle: "管理端展示 · 启用/停用 · 弹窗大字版",
  height: 620,
  body: [
    section(
      "学员卡片上的牌子",
      `<div class="card">
        <div class="card__title"><div>张小满（小满）</div><span class="tag">三年级</span></div>
        <div class="code-plate">
          <div><div class="code-plate__label">绑定码</div><div class="code-plate__code">K3M9-QX2T</div></div>
          <button class="btn btn--sm">复制</button>
        </div>
        <div class="spread" style="margin-top:10px"><span class="text-small text-muted">128 分</span><button class="btn btn--sm">详情</button></div>
      </div>`,
    ),
    section(
      "停用态",
      `<div class="card">
        <div class="code-plate is-disabled">
          <div><div class="code-plate__label">绑定码已停用</div><div class="code-plate__code">K3M9-QX2T</div></div>
          <button class="btn btn--sm">复制</button>
        </div>
      </div>`,
      note("停用后底色变灰绿。码本身仍然显示 —— 负责人需要知道是哪个码被停了。"),
    ),
    section(
      "新建学员后的弹窗",
      `<div style="border-radius:var(--r-lg);background:rgba(30,38,32,.45);padding:20px;display:flex;justify-content:center">
        <div class="dialog">
          <h3 class="dialog__title">张小满 的绑定码</h3>
          <div class="code-plate" style="justify-content:center;margin:4px 0 12px"><div class="code-plate__code">K3M9-QX2T</div></div>
          <p class="dialog__body">把这串码给家长，他们在小程序里输入即可绑定。这个码固定不变，爸爸妈妈可以用同一个码分别绑定。</p>
          <div class="btn-row"><button class="btn btn--ghost" style="flex:1">复制</button><button class="btn btn--primary" style="flex:1">知道了</button></div>
        </div>
      </div>`,
      note(
        "老师建完学员就是照着这个弹窗把码抄到纸条上给家长的，所以码必须是全屏最大的元素。" +
          "等宽字体 + 0.14em 字距，短横分成 4-4 两组便于口述。",
      ),
    ),
  ].join(""),
});

/* ---------- 整屏 ---------- */
add("screens/login-guardian.html", {
  group: "Screens",
  name: "登录页 · 家长",
  subtitle: "产品入口，输码即绑定",
  height: 844,
  bare: true,
  body: `<div class="login" style="min-height:844px">
    <div class="login__brand">
      <div class="login__mark">芽</div>
      <h1>暖芽辅导班</h1>
      <p>输入辅导班给的绑定码，就能看到孩子的每一天</p>
    </div>
    <div class="login__card">
      <div class="field"><label class="field__label">孩子的绑定码</label><input class="code-input is-valid" value="K3M9-QX2T">
        <div class="code-preview"><span class="tag">已找到</span><div>张** · 三年级</div></div>
      </div>
      <div class="field"><label class="field__label">你和孩子的关系</label><select><option>妈妈</option></select></div>
      <div class="field"><label class="field__label">你的称呼（选填）</label><input placeholder="老师这样称呼你，例如「小满妈妈」"></div>
      <button class="btn btn--primary btn--block" style="margin-top:14px">绑定孩子</button>
    </div>
    <div class="login__switch"><button class="is-active">我是家长</button><button>老师 / 负责人</button></div>
    <p class="card__hint" style="margin-top:18px;text-align:center">绑定码由辅导班在建立学员档案时生成，一人一码、固定不变。</p>
  </div>`,
});

add("screens/guardian-today.html", {
  group: "Screens",
  name: "家长端 · 今日",
  subtitle: "家长打开小程序的第一屏",
  height: 844,
  bare: true,
  body: `<div class="shell shell--tabbed" style="height:844px;position:relative">
    <div class="navbar" style="padding-top:12px"><div class="navbar__title">今日</div></div>
    <div class="page">
      <div class="hero">
        <p class="hero__label">张小满的积分余额</p>
        <strong class="hero__value">128</strong>
        <div class="hero__foot"><div>年级 三年级</div><div>我是妈妈</div></div>
      </div>
      <div class="card">
        <div class="card__title"><div>今天在班里</div></div>
        <div class="row"><div class="row__main"><div class="row__title">今日作业</div><div class="row__sub">2 项 · 辅导中</div></div><button class="btn btn--sm">查看</button></div>
        <div class="row"><div class="row__main"><div class="row__title">预计 17:30 可以接走</div><div class="row__sub">老师发送于 07-26 17:00</div></div><span class="tag tag--accent">已发送</span></div>
      </div>
      <div class="card">
        <div class="card__title"><div>最近积分</div><button class="btn btn--sm">全部</button></div>
        <div class="row"><div class="row__main"><div class="row__title">上周作业全部按时完成</div><div class="row__sub">表现奖励 · 07-24 17:30</div></div><div class="ledger__delta is-plus">+30</div></div>
        <div class="row"><div class="row__main"><div class="row__title">兑换「自动铅笔」</div><div class="row__sub">兑换扣除 · 07-25 18:02</div></div><div class="ledger__delta is-minus">-35</div></div>
      </div>
    </div>
    ${tabbar([
      ["今日「, 」M3 9h18M7 3v3m10-3v3M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", true],
      ["作业「, 」M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 0v6h6M9 13h6M9 17h4", false],
      ["成长「, 」M4 19V9m5 10V5m5 14v-7m5 7V8", false],
      ["我的「, 」M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 8a8 8 0 0 1 16 0", false],
    ]).replace('style="position:relative;height:56px;border-radius:var(--r-md);overflow:hidden;border:1px solid var(--c-line)"', 'style="position:absolute;bottom:0;left:0;right:0;height:56px"')}
  </div>`,
});

add("screens/admin-board.html", {
  group: "Screens",
  name: "管理端 · 今日看板",
  subtitle: "老师每天盯的那一屏",
  height: 844,
  bare: true,
  body: `<div class="shell shell--tabbed" style="height:844px;position:relative">
    <div class="navbar" style="padding-top:12px"><div class="navbar__title">今日看板</div><div class="navbar__extra">王负责人</div></div>
    <div class="page">
      <div class="grid grid--3" style="margin-bottom:10px">
        <div class="metric"><strong>3</strong><span>待到班</span></div>
        <div class="metric"><strong>5</strong><span>已到班</span></div>
        <div class="metric"><strong>4</strong><span>辅导中</span></div>
        <div class="metric is-alert"><strong>2</strong><span>待接</span></div>
        <div class="metric"><strong>1</strong><span>已接走</span></div>
        <div class="metric"><strong>2</strong><span>今日未交作业</span></div>
      </div>
      <div class="card">
        <div class="card__title"><div>要处理的事</div></div>
        <div class="row"><div class="row__main"><div class="row__title">1 条家长绑定申请待审核</div></div><button class="btn btn--sm">去处理</button></div>
        <div class="row"><div class="row__main"><div class="row__title">2 份作业已完成但还没发积分</div></div><button class="btn btn--sm">去处理</button></div>
      </div>
      <div class="section-title"><div>今日学员 · 2026-07-26</div></div>
      <div class="card">
        <div class="card__title"><div>张小满（小满）</div><span class="tag tag--gold">辅导中</span></div>
        <div class="row__sub">三年级 · 128 分 · 作业辅导中</div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn--sm">可以接走</button>
          <button class="btn btn--sm btn--accent">发接娃提醒</button>
        </div>
      </div>
    </div>
    ${tabbar([
      ["看板「, 」M4 4h7v7H4V4Zm9 0h7v4h-7V4ZM4 13h7v7H4v-7Zm9-3h7v10h-7V10Z", true],
      ["作业「, 」M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 0v6h6M9 13h6M9 17h4", false],
      ["学员「, 」M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-7 9a7 7 0 0 1 14 0M17 8a2.5 2.5 0 1 0 0-5M18 20a6 6 0 0 0-2-4.5", false],
      ["管理「, 」M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.13-1.45l2.06-1.6-2-3.46-2.43.98a8.4 8.4 0 0 0-2.5-1.45L15 2.4h-4l-.4 2.62a8.4 8.4 0 0 0-2.5 1.45l-2.43-.98-2 3.46 2.06 1.6a8.4 8.4 0 0 0 0 2.9l-2.06 1.6 2 3.46 2.43-.98a8.4 8.4 0 0 0 2.5 1.45L11 21.6h4l.4-2.62a8.4 8.4 0 0 0 2.5-1.45l2.43.98 2-3.46-2.06-1.6c.09-.47.13-.96.13-1.45Z", false],
    ]).replace('style="position:relative;height:56px;border-radius:var(--r-md);overflow:hidden;border:1px solid var(--c-line)"', 'style="position:absolute;bottom:0;left:0;right:0;height:56px"')}
  </div>`,
});

add("screens/admin-students.html", {
  group: "Screens",
  name: "管理端 · 学员与绑定码",
  subtitle: "老师抄码给家长的那一屏",
  height: 844,
  bare: true,
  body: `<div class="shell shell--tabbed" style="height:844px;position:relative">
    <div class="navbar" style="padding-top:12px"><div class="navbar__title">学员</div></div>
    <div class="page">
      <button class="btn btn--primary btn--block" style="margin-bottom:12px">新增学员（自动生成绑定码）</button>
      ${[
        ["张小满", "小满", "三年级", "K3M9-QX2T", "128 分", false],
        ["陈知夏", "夏夏", "四年级", "7QPK-C8DC", "72 分", false],
        ["林听白", "小白", "二年级", "ZEDM-TZG5", "15 分", true],
      ]
        .map(
          ([name, nick, grade, code, points, disabled]) => `<div class="card">
        <div class="card__title"><div>${name}（${nick}）</div><span class="tag">${grade}</span></div>
        <div class="code-plate${disabled ? " is-disabled" : ""}" style="margin-top:10px">
          <div><div class="code-plate__label">${disabled ? "绑定码已停用" : "绑定码"}</div><div class="code-plate__code">${code}</div></div>
          <button class="btn btn--sm">复制</button>
        </div>
        <div class="spread" style="margin-top:10px"><span class="text-small text-muted">${points}</span><button class="btn btn--sm">详情</button></div>
      </div>`,
        )
        .join("")}
    </div>
    ${tabbar([
      ["看板「, 」M4 4h7v7H4V4Zm9 0h7v4h-7V4ZM4 13h7v7H4v-7Zm9-3h7v10h-7V10Z", false],
      ["作业「, 」M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 0v6h6M9 13h6M9 17h4", false],
      ["学员「, 」M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-7 9a7 7 0 0 1 14 0M17 8a2.5 2.5 0 1 0 0-5M18 20a6 6 0 0 0-2-4.5", true],
      ["管理「, 」M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.13-1.45l2.06-1.6-2-3.46-2.43.98a8.4 8.4 0 0 0-2.5-1.45L15 2.4h-4l-.4 2.62a8.4 8.4 0 0 0-2.5 1.45l-2.43-.98-2 3.46 2.06 1.6a8.4 8.4 0 0 0 0 2.9l-2.06 1.6 2 3.46 2.43-.98a8.4 8.4 0 0 0 2.5 1.45L11 21.6h4l.4-2.62a8.4 8.4 0 0 0 2.5-1.45l2.43.98 2-3.46-2.06-1.6c.09-.47.13-.96.13-1.45Z", false],
    ]).replace('style="position:relative;height:56px;border-radius:var(--r-md);overflow:hidden;border:1px solid var(--c-line)"', 'style="position:absolute;bottom:0;left:0;right:0;height:56px"')}
  </div>`,
});

/* ------------------------------ 单页总览（index） ------------------------------ */

/**
 * 把所有卡片拼成一个自包含的单页，方便设计师一次看完、也方便发给别人。
 * 样式只内联一次，所以体积远小于 16 个独立预览之和。
 */
function buildIndex() {
  const groups = new Map();
  for (const { path, spec } of cards) {
    if (!groups.has(spec.group)) groups.set(spec.group, []);
    groups.get(spec.group).push({ path, spec });
  }

  const nav = [...groups.keys()]
    .map((g) => `<a href="#g-${encodeURIComponent(g)}">${g}</a>`)
    .join("");

  const sections = [...groups.entries()]
    .map(
      ([group, items]) => `<section id="g-${encodeURIComponent(group)}" class="ds-group">
      <h2>${group}</h2>
      ${items
        .map(
          ({ path, spec }) => `<article class="ds-card">
        <header>
          <h3>${spec.name}</h3>
          ${spec.subtitle ? `<p>${spec.subtitle}</p>` : ""}
          <code>${path}</code>
        </header>
        <div class="ds-frame${spec.bare ? " ds-frame--screen" : ""}">${spec.body}</div>
      </article>`,
        )
        .join("")}
    </section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>暖芽辅导班 · 设计系统</title>
<style>
${APP_CSS}

/* ---- 总览页自身的排版，不属于产品样式 ---- */
body{margin:0;background:#e6e0d2;}
.ds-top{position:sticky;top:0;z-index:10;padding:14px 20px;background:var(--c-primary);color:#fdf8ec;}
.ds-top h1{margin:0;font-size:18px;letter-spacing:.06em;}
.ds-top p{margin:4px 0 10px;font-size:12px;opacity:.85;}
.ds-top nav{display:flex;flex-wrap:wrap;gap:6px;}
.ds-top nav a{padding:4px 10px;font-size:12px;color:#fdf8ec;text-decoration:none;background:rgba(255,255,255,.14);border-radius:999px;}
.ds-wrap{max-width:1240px;margin:0 auto;padding:22px 20px 60px;}
.ds-group{margin-bottom:36px;}
.ds-group h2{margin:0 0 14px;font-size:15px;letter-spacing:.1em;color:var(--c-ink-2);}
.ds-grid,.ds-group{display:block;}
.ds-group{display:grid;grid-template-columns:repeat(auto-fill,minmax(390px,1fr));gap:18px;align-items:start;}
.ds-group h2{grid-column:1/-1;}
.ds-card{background:#fff;border:1px solid #d9cfbb;border-radius:16px;overflow:hidden;}
.ds-card header{padding:12px 14px;border-bottom:1px solid #ece3d2;}
.ds-card h3{margin:0;font-size:14px;}
.ds-card header p{margin:3px 0 0;font-size:11px;color:var(--c-ink-2);}
.ds-card header code{display:block;margin-top:5px;font-size:10px;color:var(--c-ink-3);}
.ds-frame{padding:16px 14px;background:var(--c-bg);}
.ds-frame--screen{padding:0;}
.ds-section{margin:0 0 22px;}
.ds-section:last-child{margin-bottom:0;}
.ds-label{margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--c-ink-3);}
.ds-note{margin:6px 0 0;font-size:11px;line-height:1.7;color:var(--c-ink-2);}
.ds-swatch{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--c-line);}
.ds-swatch:last-child{border-bottom:0;}
.ds-chip{width:38px;height:38px;flex:0 0 auto;border-radius:10px;border:1px solid rgba(0,0,0,.08);}
.ds-swatch code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:var(--c-ink-2);}
.ds-swatch b{display:block;font-size:13px;}
.ds-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
.ds-frame .shell{box-shadow:none;width:100%;}
</style>
</head>
<body>
<div class="ds-top">
  <h1>暖芽辅导班 · 设计系统</h1>
  <p>样式取自 h5/src/styles.css 原文，看到什么就是线上什么。改动请对照类名标注。</p>
  <nav>${nav}</nav>
</div>
<div class="ds-wrap">${sections}</div>
</body>
</html>
`;
}

/* --------------------------------- 写出文件 --------------------------------- */

// README.md 是手写的交接文档，不能被生成流程删掉，先备份再重建目录
let keepReadme = null;
try {
  keepReadme = readFileSync(join(OUT, "README.md"), "utf8");
} catch {
  /* 首次生成时还没有 */
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
if (keepReadme) writeFileSync(join(OUT, "README.md"), keepReadme, "utf8");

for (const { path, spec } of cards) {
  const file = join(OUT, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, page(spec), "utf8");
}

// 把令牌也导出一份 JSON，方便设计工具直接吃
writeFileSync(
  join(OUT, "tokens.json"),
  JSON.stringify(
    {
      source: "h5/src/styles.css",
      note: "由 scripts/build-design-system.mjs 自动抽取，不要手改",
      tokens: TOKENS,
    },
    null,
    2,
  ),
  "utf8",
);

writeFileSync(join(OUT, "index.html"), buildIndex(), "utf8");

console.log(`已生成 ${cards.length} 个预览卡片 + index.html + tokens.json → design-system/`);
for (const { path, spec } of cards) console.log(`  [${spec.group}] ${path}`);
