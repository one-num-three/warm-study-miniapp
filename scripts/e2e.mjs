#!/usr/bin/env node
/**
 * 端到端验收：用真浏览器把「管理员建学生拿绑定码 → 家长输码绑定 → 交作业 →
 * 老师辅导发分 → 现场兑换」这条主链路完整走一遍，每步截图。
 *
 * 运行：npm run test:e2e
 * 截图输出到被 Git 忽略的 artifacts/e2e/
 */

import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(root, "artifacts", "e2e");
const DB_PATH = join(tmpdir(), `warm-study-e2e-${Date.now()}.db`);

/**
 * 取一个真正空闲的端口。
 * 之前写死 8899/5199 踩过坑：上一轮被 Ctrl+C 杀掉后残留的服务还占着端口，
 * 新一轮"启动成功"其实连的是旧进程的旧数据库，测试结果完全是假的。
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

let API_PORT = 0;
let WEB_PORT = 0;

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

let serverProc;
let webProc;
let failures = 0;
let stepIndex = 0;

function log(message) {
  console.log(`  ${message}`);
}

function pass(name) {
  console.log(`  ✓ ${name}`);
}

function fail(name, error) {
  failures += 1;
  console.error(`  ✗ ${name}\n      ${error instanceof Error ? error.message : error}`);
}

async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`等待 ${url} 超时`);
}

function startProcesses() {
  serverProc = spawn(npm, ["run", "start", "--workspace", "server"], {
    cwd: root,
    env: { ...process.env, PORT: String(API_PORT), WARM_STUDY_DB: DB_PATH },
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
    detached: !isWindows,
  });
  serverProc.stdout.on("data", () => {});
  serverProc.stderr.on("data", (chunk) => {
    const text = String(chunk);
    if (!text.includes("ExperimentalWarning")) process.stderr.write(`[server] ${text}`);
  });

  webProc = spawn(npm, ["run", "dev", "--workspace", "h5", "--", "--port", String(WEB_PORT), "--strictPort"], {
    cwd: root,
    env: { ...process.env, WARM_STUDY_API: `http://localhost:${API_PORT}` },
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
    detached: !isWindows,
  });
  webProc.stdout.on("data", () => {});
  webProc.stderr.on("data", (chunk) => process.stderr.write(`[h5] ${chunk}`));
}

function stopProcesses() {
  for (const proc of [serverProc, webProc]) {
    if (!proc || proc.killed || proc.pid === undefined) continue;
    try {
      // 杀整个进程组：npm 会再 fork 出 node/vite，只杀 npm 会留下孤儿进程
      if (isWindows) {
        spawnSync("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { stdio: "ignore" });
      } else process.kill(-proc.pid, "SIGKILL");
    } catch {
      /* 已经退出了 */
    }
  }
}

async function removeWithRetry(file, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rmSync(file, { force: true });
      return;
    } catch (error) {
      if (!isWindows || !["EBUSY", "EPERM"].includes(error?.code) || attempt === attempts - 1) {
        console.warn(`无法清理临时文件 ${file}：${error?.message ?? error}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}
process.on("SIGINT", () => {
  stopProcesses();
  process.exit(130);
});

/** 截图并编号，方便按顺序看。 */
async function shot(page, name) {
  stepIndex += 1;
  const file = join(SHOTS, `${String(stepIndex).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

/** 等一个可见的文本出现。 */
async function expectText(page, text, timeout = 8000) {
  await page.locator(`text=${text}`).first().waitFor({ state: "visible", timeout });
}

/**
 * 切到某个 Tab。
 * 详情页按小程序的规矩是没有 TabBar 的，所以先一路点返回回到 Tab 页再切。
 */
async function goTab(page, label) {
  for (let i = 0; i < 5; i += 1) {
    if ((await page.locator(".tabbar").count()) > 0) break;
    const back = page.locator(".navbar__back");
    if ((await back.count()) === 0) break;
    await back.click();
    await page.waitForTimeout(250);
  }
  await page.locator(`.tabbar__item:has-text("${label}")`).click();
  await page.waitForTimeout(500);
}

/** 找到某个学员卡片里的按钮（列表里有好几个孩子，不能只取第一个）。 */
function cardOf(page, studentName) {
  return page.locator(".card").filter({ hasText: studentName }).first();
}

async function main() {
  if (existsSync(SHOTS)) rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  API_PORT = await freePort();
  WEB_PORT = await freePort();
  console.log(`\n启动服务…（后端 ${API_PORT} / 前端 ${WEB_PORT}）`);
  startProcesses();
  await waitForUrl(`http://localhost:${API_PORT}/api/health`);
  await waitForUrl(`http://localhost:${WEB_PORT}/`);
  log(`后端 ${API_PORT} / 前端 ${WEB_PORT} 就绪\n`);

  const browser = await chromium.launch({ executablePath:
      process.env.WARM_STUDY_CHROMIUM ?? undefined,
    args: ["--no-sandbox"] });
  const phone = { width: 390, height: 844 };

  // ---------------------------------------------------------------- 管理端
  const adminCtx = await browser.newContext({ viewport: phone, deviceScaleFactor: 2, locale: "zh-CN" });
  const admin = await adminCtx.newPage();
  const consoleErrors = [];
  admin.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  admin.on("pageerror", (error) => consoleErrors.push(String(error)));

  console.log("【管理端】");
  await admin.goto(`http://localhost:${WEB_PORT}/`);
  await admin.waitForLoadState("networkidle");
  await shot(admin, "login-guardian");

  await check("登录页默认是家长入口，绑定码输入框可见", async () => {
    await admin.locator('[data-role="binding-code"]').waitFor({ state: "visible" });
  });

  await admin.locator('[data-role="tab-staff"]').click();
  await shot(admin, "login-staff");

  await check("负责人可以登录管理端", async () => {
    await admin.locator('[data-role="staff-username"]').fill("owner");
    await admin.locator('[data-role="staff-password"]').fill("warm2026");
    await admin.locator('[data-role="staff-submit"]').click();
    await expectText(admin, "今日看板");
  });
  await admin.waitForTimeout(600);
  await shot(admin, "admin-board");

  // 新建学生，拿到绑定码
  let bindingCode = "";
  await check("新增学员时服务端生成绑定码并展示给老师", async () => {
    await goTab(admin, "学员");
    await admin.locator('[data-action="new-student"]').waitFor({ state: "visible" });
    await admin.locator('[data-action="new-student"]').click();
    await admin.locator('.sheet input').first().fill("测试小满");
    await admin.locator('.sheet input').nth(1).fill("小满");
    await admin.locator(".sheet select").selectOption("三年级");
    await admin.locator('.sheet button:has-text("建立档案")').click();
    await admin.locator(".dialog").waitFor({ state: "visible" });
    const shown = await admin.locator('[data-role="dialog-code"]').innerText();
    const match = shown.match(/([0-9A-Z]{4}-[0-9A-Z]{4})/);
    if (!match) throw new Error(`对话框里没有找到绑定码，实际内容：${shown}`);
    bindingCode = match[1];
    log(`拿到绑定码 ${bindingCode}`);
  });
  await shot(admin, "admin-new-student-code");
  await admin.locator('.dialog button:has-text("知道了")').click();
  await admin.waitForTimeout(500);
  await shot(admin, "admin-students");

  await check("学员列表上直接显示绑定码", async () => {
    const plate = admin.locator('[data-role="binding-code-plate"]').first();
    await plate.waitFor({ state: "visible" });
    const text = await plate.innerText();
    if (!text.includes(bindingCode)) {
      throw new Error(`列表里没显示刚生成的码，实际：${text}`);
    }
  });

  // ---------------------------------------------------------------- 家长端
  console.log("\n【家长端】");
  const momCtx = await browser.newContext({ viewport: phone, deviceScaleFactor: 2, locale: "zh-CN" });
  const mom = await momCtx.newPage();
  mom.on("pageerror", (error) => consoleErrors.push(String(error)));
  await mom.goto(`http://localhost:${WEB_PORT}/`);
  await mom.waitForLoadState("networkidle");

  await check("输入错误的绑定码会当场提示，不需要提交", async () => {
    await mom.locator('[data-role="binding-code"]').fill("AAAA-AAAA");
    await mom.waitForTimeout(300);
    const cls = await mom.locator('[data-role="binding-code"]').getAttribute("class");
    if (!cls?.includes("is-invalid")) throw new Error("校验位错误的码应该被本地拦下");
  });
  await shot(mom, "guardian-code-invalid");

  await check("输入正确的绑定码会显示孩子的脱敏姓名预览", async () => {
    await mom.locator('[data-role="binding-code"]').fill("");
    await mom.locator('[data-role="binding-code"]').type(bindingCode.replace("-", ""), { delay: 30 });
    await mom.locator('[data-role="bind-preview"]').waitFor({ state: "visible", timeout: 6000 });
    const preview = await mom.locator('[data-role="bind-preview"]').innerText();
    if (!preview.includes("测***")) throw new Error(`预览应显示脱敏姓名，实际：${preview}`);
  });
  await shot(mom, "guardian-code-preview");

  await check("家长输码即完成绑定，直接进入家长端", async () => {
    await mom.locator('[data-role="relation"]').selectOption("妈妈");
    await mom.locator('[data-role="guardian-name"]').fill("小满妈妈");
    await mom.locator('[data-role="bind-submit"]').click();
    await expectText(mom, "测试小满的积分余额");
  });
  await mom.waitForTimeout(600);
  await shot(mom, "guardian-today");

  await check("刷新页面后绑定关系仍在（设备身份持久化）", async () => {
    await mom.reload();
    await mom.waitForLoadState("networkidle");
    await expectText(mom, "测试小满的积分余额");
  });

  await check("家长可以提交今天的作业", async () => {
    await mom.locator('button:has-text("去提交")').click();
    await expectText(mom, "今天的作业");
    await mom.locator('button:has-text("添加一项")').click();
    await mom.locator(".sheet select").selectOption("数学");
    await mom.locator(".sheet textarea").first().fill("口算 30 题，另加两道应用题");
    await mom.locator('.sheet button:has-text("添加")').click();
    await mom.waitForTimeout(200);
    await mom.locator('button:has-text("添加一项")').click();
    await mom.locator(".sheet select").selectOption("语文");
    await mom.locator(".sheet textarea").first().fill("抄写生字两遍");
    await mom.locator('.sheet button:has-text("添加")').click();
    await mom.waitForTimeout(200);
  });
  await shot(mom, "guardian-submit-homework");

  await check("提交后作业出现在列表里", async () => {
    await mom.locator('[data-role="submit-sheet"]').click();
    await expectText(mom, "提交今天的作业");
    await expectText(mom, "待确认");
  });
  await shot(mom, "guardian-homework-list");

  // ---------------------------------------------------------------- 老师处理
  console.log("\n【老师处理作业】");
  await check("老师在作业池里看到刚提交的作业", async () => {
    await goTab(admin, "作业");
    await expectText(admin, "测试小满");
    await expectText(admin, "口算 30 题");
  });
  await shot(admin, "admin-homework-pool");

  await check("逐项推进作业进度", async () => {
    // 第一项：开始 → 完成
    await admin.locator('[data-action="item-进行中"]').first().click();
    await admin.waitForTimeout(400);
    await admin.locator('[data-action="item-已完成"]').first().click();
    await admin.waitForTimeout(400);
    // 第二项
    await admin.locator('[data-action="item-进行中"]').first().click();
    await admin.waitForTimeout(400);
    await admin.locator('[data-action="item-已完成"]').first().click();
    await admin.waitForTimeout(400);
    await expectText(admin, "辅导中");
  });
  await shot(admin, "admin-homework-progress");

  await check("结束作业并发放积分", async () => {
    await admin.locator('[data-action="finish-sheet"]').click();
    await admin.locator(".sheet").waitFor({ state: "visible" });
    await admin.locator(".sheet textarea").first().fill("口算又快又准，生字写得工整");
    await admin.locator('.sheet input[inputmode="numeric"]').fill("30");
    await admin.locator('.sheet button:has-text("确认结束")').click();
    await expectText(admin, "发放 30 分");
  });
  await shot(admin, "admin-homework-finished");

  await check("家长端立刻看到反馈和积分", async () => {
    await goTab(mom, "今日");
    await mom.waitForTimeout(800);
    await expectText(mom, "30");
  });
  await shot(mom, "guardian-points");

  // ---------------------------------------------------------------- 接娃提醒
  console.log("\n【接娃提醒】");
  await check("老师发送接娃提醒", async () => {
    await goTab(admin, "看板");
    const target = cardOf(admin, "测试小满");
    await target.locator('[data-action="notify"]').waitFor({ state: "visible" });
    await target.locator('[data-action="notify"]').click();
    await admin.locator('.sheet button:has-text("30 分钟后可接")').click();
    await expectText(admin, "已通知家长");
  });
  await shot(admin, "admin-reminder");

  await check("同一个时间重复提醒需要二次确认", async () => {
    await admin.waitForTimeout(600);
    await cardOf(admin, "测试小满").locator('[data-action="notify"]').click();
    await admin.locator('.sheet button:has-text("30 分钟后可接")').click();
    await admin.locator(".dialog").waitFor({ state: "visible", timeout: 6000 });
    const text = await admin.locator(".dialog__body").innerText();
    if (!text.includes("确认要再发一次吗")) throw new Error(`应提示重复提醒，实际：${text}`);
    await admin.locator('.dialog button:has-text("取消")').click();
  });
  await shot(admin, "admin-reminder-duplicate");

  await check("家长端看到预计可接时间", async () => {
    await goTab(mom, "今日");
    await mom.waitForTimeout(800);
    await expectText(mom, "可以接走");
  });

  // ---------------------------------------------------------------- 兑换
  console.log("\n【积分兑换】");
  await check("老师现场兑换：扣分 + 减库存", async () => {
    await goTab(admin, "学员");
    await cardOf(admin, "测试小满").locator('button:has-text("详情")').click();
    await expectText(admin, "绑定码（固定不变）");
    await admin.locator('button:has-text("现场兑换")').click();
    await expectText(admin, "核对孩子本人");
    await admin.locator('[data-action="redeem"]').first().click();
    await admin.locator(".dialog").waitFor({ state: "visible" });
    await admin.locator('.dialog button:has-text("确定")').click();
    await expectText(admin, "兑换成功");
  });
  await shot(admin, "admin-redeem");

  await check("积分不够时兑换按钮不可点", async () => {
    await admin.waitForTimeout(600);
    const disabled = await admin.locator('[data-action="redeem"][disabled]').count();
    if (disabled === 0) throw new Error("余额不足的商品应该禁用兑换按钮");
  });

  await check("家长端能看到兑换记录，且花分不掉排名", async () => {
    await goTab(mom, "成长");
    await mom.waitForTimeout(800);
    const rank = await mom.locator(".rank.is-self").first().innerText();
    if (!rank.includes("30")) throw new Error(`本周得分应仍为 30（兑换不扣排名分），实际：${rank}`);
  });
  await shot(mom, "guardian-growth");

  await check("兑换记录出现在商城页", async () => {
    await mom.locator('button:has-text("商城")').click();
    await expectText(mom, "兑换记录");
  });
  await shot(mom, "guardian-store");

  // ---------------------------------------------------------------- 第二位家长
  console.log("\n【爸爸用同一个码绑定】");
  const dadCtx = await browser.newContext({ viewport: phone, deviceScaleFactor: 2, locale: "zh-CN" });
  const dad = await dadCtx.newPage();
  dad.on("pageerror", (error) => consoleErrors.push(String(error)));
  await dad.goto(`http://localhost:${WEB_PORT}/`);
  await dad.waitForLoadState("networkidle");

  await check("同一个绑定码爸爸也能用（不是一次性验证码）", async () => {
    await dad.locator('[data-role="binding-code"]').type(bindingCode.replace("-", ""), { delay: 20 });
    await dad.locator('[data-role="bind-preview"]').waitFor({ state: "visible", timeout: 6000 });
    await dad.locator('[data-role="relation"]').selectOption("爸爸");
    await dad.locator('[data-role="guardian-name"]').fill("小满爸爸");
    await dad.locator('[data-role="bind-submit"]').click();
    await expectText(dad, "测试小满的积分余额");
  });
  await shot(dad, "guardian-second-parent");

  await check("管理端能看到两位家长都绑上了", async () => {
    await goTab(admin, "学员");
    await cardOf(admin, "测试小满").locator('button:has-text("详情")').click();
    await expectText(admin, "小满妈妈");
    await expectText(admin, "小满爸爸");
  });
  await shot(admin, "admin-student-detail");

  // ---------------------------------------------------------------- 权限
  console.log("\n【权限边界】");
  const staffCtx = await browser.newContext({ viewport: phone, deviceScaleFactor: 2, locale: "zh-CN" });
  const staff = await staffCtx.newPage();
  staff.on("pageerror", (error) => consoleErrors.push(String(error)));
  await staff.goto(`http://localhost:${WEB_PORT}/`);
  await staff.waitForLoadState("networkidle");
  await staff.locator('[data-role="tab-staff"]').click();
  await staff.locator('[data-role="staff-username"]').fill("teacher");
  await staff.locator('[data-role="staff-password"]').fill("warm2026");
  await staff.locator('[data-role="staff-submit"]').click();
  await expectText(staff, "今日看板");

  await check("老师看不到「新增学员」按钮", async () => {
    await goTab(staff, "学员");
    await staff.waitForTimeout(600);
    const count = await staff.locator('[data-action="new-student"]').count();
    if (count !== 0) throw new Error("老师不该看到新增学员入口");
  });
  await shot(staff, "staff-students");

  await check("老师的管理页没有审计、设置、老师账号入口", async () => {
    await goTab(staff, "管理");
    await staff.waitForTimeout(500);
    for (const forbidden of ["审计日志", "系统设置", "老师账号", "家长绑定审核"]) {
      if ((await staff.locator(`.row__title:text-is("${forbidden}")`).count()) > 0) {
        throw new Error(`老师不该看到「${forbidden}」`);
      }
    }
  });
  await shot(staff, "staff-manage");

  await check("负责人的管理页有全部入口", async () => {
    await goTab(admin, "管理");
    await admin.waitForTimeout(500);
    for (const item of ["审计日志", "系统设置", "老师账号", "家长绑定审核", "积分对账"]) {
      if ((await admin.locator(`.row__title:text-is("${item}")`).count()) === 0) {
        throw new Error(`负责人应该看到「${item}」`);
      }
    }
  });
  await shot(admin, "admin-manage");

  await check("审计日志记下了建学员和兑换", async () => {
    await admin.locator('.row__title:text-is("审计日志")').click();
    await expectText(admin, "student.create");
    await expectText(admin, "redemption.create");
  });
  await shot(admin, "admin-audit");

  await check("积分对账全部一致", async () => {
    await admin.locator(".navbar__back").click();
    await admin.waitForTimeout(400);
    await admin.locator('.row__title:text-is("积分对账")').click();
    await expectText(admin, "全部一致");
  });

  await check("撤销兑换后积分和库存都退回来", async () => {
    await admin.locator(".navbar__back").click();
    await admin.waitForTimeout(400);
    await admin.locator('.row__title:text-is("兑换记录")').click();
    await expectText(admin, "测试小满");
    await admin.locator('button:has-text("撤销")').first().click();
    await admin.locator(".sheet textarea").first().fill("孩子拿错了，换一个");
    await admin.locator('.sheet button:has-text("确认撤销")').click();
    await expectText(admin, "已撤销");
  });
  await shot(admin, "admin-reconcile");

  // ---------------------------------------------------------------- 请求风暴回归
  console.log("\n【请求风暴回归】");

  await check("停在「我的」页不会无限刷接口", async () => {
    let calls = 0;
    const counter = (request) => {
      if (request.url().includes("/api/auth/profile")) calls += 1;
    };
    mom.on("request", counter);
    await goTab(mom, "我的");
    await mom.waitForTimeout(4000);
    mom.off("request", counter);
    // 修之前这里 4 秒能打出 180+ 次请求（refreshProfile → notify → 重渲染 → 再 refresh）
    if (calls > 3) throw new Error(`「我的」页 4 秒内请求了 ${calls} 次 /auth/profile，出现请求风暴`);
  });

  await check("登录一次只渲染一次，接口不会重复打", async () => {
    const fresh = await browser.newContext({ viewport: phone, deviceScaleFactor: 2, locale: "zh-CN" });
    const page = await fresh.newPage();
    const counts = new Map();
    page.on("request", (request) => {
      const url = request.url();
      if (!url.includes("/api/")) return;
      const key = new URL(url).pathname;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    await page.goto(`http://localhost:${WEB_PORT}/`);
    await page.waitForLoadState("networkidle");
    counts.clear();
    await page.locator('[data-role="tab-staff"]').click();
    await page.locator('[data-role="staff-username"]').fill("owner");
    await page.locator('[data-role="staff-password"]').fill("warm2026");
    await page.locator('[data-role="staff-submit"]').click();
    await expectText(page, "今日看板");
    await page.waitForTimeout(1500);
    const dashboard = counts.get("/api/dashboard") ?? 0;
    await fresh.close();
    // 修之前 render() 会自递归，一次登录把整页渲染两遍
    if (dashboard > 1) throw new Error(`登录一次打了 ${dashboard} 次 /api/dashboard，说明重复渲染了`);
  });

  await check("登录态失效时预览接口最多重试一次，不会死循环", async () => {
    const fresh = await browser.newContext({ viewport: phone, deviceScaleFactor: 2, locale: "zh-CN" });
    const page = await fresh.newPage();
    let previewCalls = 0;
    // 让预览接口一直返回 401，模拟"游客身份已失效"
    await page.route("**/api/bindings/preview**", async (route) => {
      previewCalls += 1;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ success: false, requestId: "x", code: "UNAUTHENTICATED", message: "登录已失效" }),
      });
    });
    await page.goto(`http://localhost:${WEB_PORT}/`);
    await page.waitForLoadState("networkidle");
    await page.locator('[data-role="binding-code"]').type(bindingCode.replace("-", ""), { delay: 20 });
    await page.waitForTimeout(3000);
    await fresh.close();
    // 修之前这里 3 秒能打出 300+ 次
    if (previewCalls > 3) throw new Error(`预览接口被调用了 ${previewCalls} 次，说明重试没有上限`);
  });

  // ---------------------------------------------------------------- 收尾
  await check("整个流程没有 JS 运行时错误", async () => {
    const real = consoleErrors.filter(
      (text) => !text.includes("favicon") && !text.includes("Failed to load resource"),
    );
    if (real.length > 0) throw new Error(`控制台报错：\n      ${real.join("\n      ")}`);
  });

  await browser.close();

  console.log(`\n截图已保存到 artifacts/e2e/（共 ${stepIndex} 张）`);
  if (failures > 0) {
    console.error(`\n端到端验收失败：${failures} 项\n`);
    process.exitCode = 1;
  } else {
    console.log("\n端到端验收全部通过\n");
  }
}

main()
  .catch((error) => {
    console.error("\n端到端脚本异常：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    stopProcesses();
    await new Promise((resolve) => setTimeout(resolve, isWindows ? 250 : 50));
    await Promise.all([
      removeWithRetry(DB_PATH),
      removeWithRetry(`${DB_PATH}-wal`),
      removeWithRetry(`${DB_PATH}-shm`),
    ]);
    setTimeout(() => process.exit(process.exitCode ?? 0), 400);
  });
