# 微信 OpenID 自动绑定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 家长首次用绑定码确认孩子后，后续小程序登录按稳定微信 OpenID 自动恢复同一账号与孩子列表，不再重复输入绑定码。

**Architecture:** 保留 `users.identity_hash` 与 `student_guardians` 两张现有关系表；后端把微信临时 code 换成真实 OpenID 后只保存其加盐哈希。开发环境不再用临时 code 作为身份，改由小程序持久化的开发安装标识派生模拟 OpenID；生产环境缺少微信凭据则明确拒绝登录。

**Tech Stack:** Node.js 22.5+、TypeScript、Node `node:test`、原生微信小程序 TypeScript、微信 `jscode2session`、Node `--env-file-if-exists`。

## Global Constraints

- 所有改动仅在 `codex/integrate-complete-warm-study` 隔离分支完成；不提交 `miniprogram/project.config.json` 或 `miniprogram/project.private.config.json` 的开发者工具本地改动。
- 生产环境必须使用 `WARM_STUDY_WX_APPID`、`WARM_STUDY_WX_SECRET` 与稳定不变的 `WARM_STUDY_IDENTITY_SALT`；AppSecret 不得出现在小程序、Git、日志或接口响应中。
- 生产环境不允许把临时 `wx.login` code 或客户端开发安装标识当成身份。
- H5 的 `loginType: "device"` 和管理员账号密码登录不得改变。
- OpenID 原文不得写入数据库；唯一可持久化标识仍为 `hashIdentity(openid)`。
- 每个生产行为改动先写一个会失败的 Node 测试，再写最小实现使其通过。

---

### Task 1: 以失败测试定义稳定微信身份

**Files:**
- Create: `server/test/wechat-login.test.js`
- Modify: `server/test/helpers.js`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: `createApp(db)`、`POST /api/auth/login`、`POST /api/bindings/by-code`。
- Produces: `createApp(db, { resolveWechatIdentity })` 的可选测试依赖注入接口，其中 `resolveWechatIdentity({ code, developmentIdentity })` 返回稳定 OpenID 字符串。

- [ ] **Step 1: 扩展测试服务器创建器，不改变现有调用**

In `server/test/helpers.js`, change exactly these two existing lines:

```js
export async function startTestServer(options = {}) {
  const server = createServer(createApp(db, options));
}
```

Run: `npm run build:server`

Expected: PASS before behavior tests are added; all existing callers still use `startTestServer()` with no argument.

- [ ] **Step 2: Write failing integration tests for OpenID account recovery and production failure**

Create `server/test/wechat-login.test.js` with this shared login helper and three tests:

```js
async function loginWechat(base, code, developmentIdentity) {
  return ok(await post(base, "/auth/login", {
    loginType: "wechat",
    code,
    ...(developmentIdentity ? { developmentIdentity } : {}),
  }));
}

test("同一 OpenID 的不同临时 code 恢复同一已绑定孩子", async () => {
  const ctx = await startTestServer({
    resolveWechatIdentity: async () => "openid-mom-1",
  });
  const ownerToken = await loginOwner(ctx.base);
  const created = ok(await post(ctx.base, "/students", { name: "小满", grade: "三年级" }, ownerToken));
  const first = await loginWechat(ctx.base, "code-first");
  ok(await post(ctx.base, "/bindings/by-code", {
    bindingCode: created.bindingCodeDisplay,
    relation: "妈妈",
  }, first.token));
  const second = await loginWechat(ctx.base, "code-second");
  assert.equal(second.profile.userId, first.profile.userId);
  assert.deepEqual(second.profile.students.map((student) => student.id), [created.student.id]);
  await ctx.close();
});
```

Add tests asserting that two different resolver OpenIDs receive different `userId` values. Import `createWechatIdentityResolver` from `../dist/auth.js`, create it with `{ environment: "production" }`, pass it as `resolveWechatIdentity`, and assert that a login rejects with `WECHAT_LOGIN_UNAVAILABLE` without adding a `users` row.

Use these exact assertions for the remaining two tests:

```js
test("不同 OpenID 不能合并为同一个家长", async () => {
  const resolver = async ({ code }) => (code === "code-a" ? "openid-a" : "openid-b");
  const ctx = await startTestServer({ resolveWechatIdentity: resolver });
  const a = await loginWechat(ctx.base, "code-a", "install-a");
  const b = await loginWechat(ctx.base, "code-b", "install-b");
  assert.notEqual(a.profile.userId, b.profile.userId);
  await ctx.close();
});

test("生产环境缺少微信凭据不会创建家长", async () => {
  const resolver = createWechatIdentityResolver({ environment: "production" });
  const ctx = await startTestServer({ resolveWechatIdentity: resolver });
  const before = ctx.db.get("SELECT COUNT(*) AS count FROM users").count;
  failsWith(await post(ctx.base, "/auth/login", {
    loginType: "wechat", code: "code-without-secret", developmentIdentity: "install-prod",
  }), "WECHAT_LOGIN_UNAVAILABLE");
  const after = ctx.db.get("SELECT COUNT(*) AS count FROM users").count;
  assert.equal(after, before);
  await ctx.close();
});
```

Run: `npm run build:server && node --test server/test/wechat-login.test.js`

Expected: FAIL because `createApp` has no resolver option, `developmentIdentity` is not parsed, and `WECHAT_LOGIN_UNAVAILABLE` does not exist.

- [ ] **Step 3: Define the API contract and router input needed by the failing tests**

In `shared/src/api-contract.ts`, add the exact request shape:

```ts
export interface WechatLoginRequest {
  loginType: "wechat";
  code: string;
  developmentIdentity?: string;
  displayName?: string;
}
```

In `server/src/app.ts`, parse `developmentIdentity` with:

```ts
const developmentIdentity = optionalString(ctx.body, "developmentIdentity", {
  max: 128,
  label: "开发安装标识",
});
```

Pass it only with `loginType: "wechat"`. Extend `createApp` with:

```ts
export interface AppOptions {
  resolveWechatIdentity?: WechatIdentityResolver;
}
export function createApp(db: Db, options: AppOptions = {})
```

Run: `npm run typecheck`

Expected: still FAIL for the new tests because identity resolution is not implemented yet, while TypeScript compiles.

### Task 2: 实现生产 OpenID 解析与安全开发模式

**Files:**
- Modify: `shared/src/errors.ts`
- Modify: `server/src/auth.ts`
- Modify: `server/src/services/identity.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/wechat-login.test.js`

**Interfaces:**
- Consumes: `WechatLoginRequest` and optional `AppOptions.resolveWechatIdentity` from Task 1.
- Produces: `createWechatIdentityResolver(options)` and `resolveWechatOpenId({ code, developmentIdentity })`, returning a stable raw OpenID only to `identity.login`; callers receive a session token and `Profile` only.

- [ ] **Step 1: Add a stable public error for unavailable WeChat login**

In `shared/src/errors.ts`, add one error code in all three maps:

```ts
WECHAT_LOGIN_UNAVAILABLE: "WECHAT_LOGIN_UNAVAILABLE"
// message: "微信登录暂不可用，请稍后重试"
// HTTP status: 503
```

Run: `npm run build:shared`

Expected: PASS; the new code is available to both server and mini-program shared output after `npm run sync:shared`.

- [ ] **Step 2: Replace temporary-code fallback with an explicit resolver**

In `server/src/auth.ts`, define these exact public types and factory, then export `resolveWechatOpenId` as the production-environment factory result:

```ts
export interface WechatIdentityInput {
  code: string;
  developmentIdentity?: string;
}

export type WechatIdentityResolver = (input: WechatIdentityInput) => Promise<string>;

export function createWechatIdentityResolver(options: {
  environment?: string;
  appId?: string;
  secret?: string;
  exchangeCode?: (code: string, appId: string, secret: string) => Promise<string>;
} = {}): WechatIdentityResolver {
  const environment = options.environment ?? process.env.NODE_ENV ?? "development";
  const appId = options.appId ?? process.env.WARM_STUDY_WX_APPID;
  const secret = options.secret ?? process.env.WARM_STUDY_WX_SECRET;
  const exchangeCode = options.exchangeCode ?? exchangeWechatCode;
  return async (input) => {
  if (appId && secret) {
    return exchangeCode(input.code, appId, secret);
  }
  if (environment === "production") {
    throw new AppError(ERROR_CODES.WECHAT_LOGIN_UNAVAILABLE);
  }
  const developmentIdentity = input.developmentIdentity?.trim();
  if (!developmentIdentity) {
    throw new AppError(ERROR_CODES.WECHAT_LOGIN_UNAVAILABLE, "开发环境缺少稳定安装标识");
  }
  return `devopenid:${developmentIdentity}`;
  };
}

export const resolveWechatOpenId = createWechatIdentityResolver();
```

Add this non-exported exchange function above the factory:

```ts
async function exchangeWechatCode(code: string, appId: string, secret: string): Promise<string> {
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", secret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const payload = (await response.json()) as { openid?: string };
  if (!payload.openid) throw new AppError(ERROR_CODES.WECHAT_LOGIN_UNAVAILABLE);
  return payload.openid;
}
```

Preserve the existing eight-second timeout and reject a non-OpenID WeChat response as `WECHAT_LOGIN_UNAVAILABLE`; do not include AppSecret or raw response text in the error.

- [ ] **Step 3: Thread the resolver through identity login without changing stored data**

Change `identity.login` to receive an optional resolver argument:

```ts
export async function login(
  db: Db,
  input: { loginType: "wechat" | "device"; code: string; developmentIdentity?: string; displayName?: string },
  resolveWechatIdentity = resolveWechatOpenId,
): Promise<LoginResult> {
  const rawIdentity = input.loginType === "wechat"
    ? await resolveWechatIdentity({ code: input.code, developmentIdentity: input.developmentIdentity })
    : `device:${input.code}`;
  const identityHash = hashIdentity(rawIdentity);
}
```

In `createApp`, call `identity.login(db, input, options.resolveWechatIdentity)` for wechat requests and `identity.login(db, input)` for device requests. After `identityHash` is calculated, retain the existing `users` lookup/insert, active-status check, `issueToken`, and `buildProfile` statements exactly as they are.

- [ ] **Step 4: Run the red/green test cycle**

Run: `npm run build:shared && npm run build:server && node --test server/test/wechat-login.test.js`

Expected: PASS. Confirm all three assertions: repeat OpenID restores the bound child, distinct OpenIDs produce distinct users, and production without credentials returns `WECHAT_LOGIN_UNAVAILABLE` without a new database row.

- [ ] **Step 5: Run focused regression tests and commit**

Run: `npm run test --workspace server`

Expected: PASS; binding code, review, release, permissions, points, homework, store, and security tests remain green.

Commit:

```bash
git add shared/src/errors.ts shared/src/api-contract.ts server/src/auth.ts server/src/app.ts server/src/services/identity.ts server/test/helpers.js server/test/wechat-login.test.js
git commit -m "Add stable WeChat OpenID login"
```

### Task 3: 让小程序开发身份稳定并复用现有自动跳转

**Files:**
- Modify: `miniprogram/utils/api.ts`
- Modify: `miniprogram/app.ts`
- Modify: `miniprogram/pages/login/login.ts`
- Test: `scripts/check-miniprogram.mjs`

**Interfaces:**
- Consumes: `developmentIdentity?: string` from Task 1 and the existing `wx.login` API.
- Produces: each wechat login payload contains a persistent development installation ID; a real-credential production server ignores it and derives identity from OpenID.

- [ ] **Step 1: Write the failing static assertion**

In `scripts/check-miniprogram.mjs`, add a check that `miniprogram/app.ts` and `miniprogram/pages/login/login.ts` use the shared `wechatLoginPayload()` helper rather than manually posting only `{ loginType: "wechat", code }`.

Implement the check with this helper after the script's existing source-reading helpers, and call it once for each of the two files:

```js
function assertWechatLoginPayload(relativePath) {
  const source = read(join(root, relativePath));
  if (!source.includes("wechatLoginPayload()") || source.includes('wxLoginCode')) {
    fail(relativePath, "微信登录必须通过 wechatLoginPayload 发送稳定开发安装标识");
  }
}

assertWechatLoginPayload("miniprogram/app.ts");
assertWechatLoginPayload("miniprogram/pages/login/login.ts");
```

The check must fail with:

```text
微信登录必须通过 wechatLoginPayload 发送稳定开发安装标识
```

Run: `npm run check:mp`

Expected: FAIL because the two call sites currently construct the old payload themselves.

- [ ] **Step 2: Add the minimal shared login payload helper**

In `miniprogram/utils/api.ts`, add:

```ts
const DEV_IDENTITY_KEY = "warm-study.dev-installation-id";

export function developmentIdentity(): string {
  let value = wx.getStorageSync(DEV_IDENTITY_KEY);
  if (typeof value !== "string" || value.length < 16) {
    value = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    wx.setStorageSync(DEV_IDENTITY_KEY, value);
  }
  return value;
}

export async function wechatLoginPayload(): Promise<{
  loginType: "wechat";
  code: string;
  developmentIdentity: string;
}> {
  return { loginType: "wechat", code: await wxLoginCode(), developmentIdentity: developmentIdentity() };
}
```

Replace both app bootstrap and login-page `ensureIdentity()` calls with:

```ts
const result = await api.post<any>("/auth/login", await wechatLoginPayload());
```

Remove now-unused `wxLoginCode` imports. No UI copy needs changing: existing `applyProfile` and login-page redirect already skip the binding page when `profile.students.length > 0`.

- [ ] **Step 3: Verify the mini-program checks**

Run: `npm run build:shared && npm run sync:shared && npm run check:mp`

Expected: PASS with no new static problems. Manually inspect that the two login call sites share one helper and no AppSecret is present anywhere in `miniprogram/`.

- [ ] **Step 4: Commit the mini-program behavior**

```bash
git add miniprogram/utils/api.ts miniprogram/app.ts miniprogram/pages/login/login.ts scripts/check-miniprogram.mjs miniprogram/shared
git commit -m "Persist development WeChat identity"
```

### Task 4: 配置文件、文档与全量验证

**Files:**
- Create: `.env.example`
- Modify: `server/package.json`
- Modify: `README.md`
- Test: `server/test/wechat-login.test.js`, all existing test commands

**Interfaces:**
- Consumes: environment variables defined in the approved design.
- Produces: local server commands can optionally read ignored root `.env`; deployment guidance specifies real OpenID configuration without publishing secrets.

- [ ] **Step 1: Add a secret-free environment template**

Create `.env.example` with commented explanations and blank assignments only:

```dotenv
# 生产环境必须填写；不要提交真实 AppSecret。
WARM_STUDY_WX_APPID=
WARM_STUDY_WX_SECRET=
# 上线后保持不变的随机盐值。
WARM_STUDY_IDENTITY_SALT=
# 本地调试用 development；部署平台设置为 production。
NODE_ENV=development
```

- [ ] **Step 2: Make local server startup read an ignored root `.env` when present**

In `server/package.json`, update both server launch commands to use Node 22's optional env-file flag from the server workspace:

```json
"start": "node --env-file-if-exists=../.env dist/index.js",
"dev": "npm run build && node --env-file-if-exists=../.env dist/index.js"
```

Do not add a dotenv dependency. `.env` is already ignored and `.env.example` is explicitly allowed by `.gitignore`.

- [ ] **Step 3: Document the exact operator steps**

In `README.md`, add an “微信登录上线配置” section that instructs the operator to copy `.env.example` to `.env` for local testing, configure the three secret values in the deployment platform for production, use the same AppID in the mini-program project, and configure the API HTTPS domain as a WeChat request domain. State that first binding is required once and existing temporary development accounts cannot be migrated to real OpenID automatically.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm install
npm run typecheck
npm test
npm run build
npm run check:mp
git diff --check
```

Expected: all commands exit 0. `npm test` includes the new OpenID integration test, the 44 shared tests, and all server integration tests.

- [ ] **Step 5: Stage only feature files and commit**

Before staging, confirm `git status --short` still lists the developer-tool-owned `miniprogram/project.config.json` and `miniprogram/project.private.config.json` separately. Do not stage either file.

```bash
git add .env.example server/package.json README.md
git commit -m "Document WeChat login deployment"
```

### Task 5: Publish and verify the existing PR

**Files:**
- Modify: Git branch `codex/integrate-complete-warm-study`

**Interfaces:**
- Consumes: the commits from Tasks 2–4 and a clean feature-only index.
- Produces: GitHub PR #1 updated with the OpenID feature while leaving `main` unchanged.

- [ ] **Step 1: Push the existing feature branch**

Run: `git push full-origin codex/integrate-complete-warm-study`

Expected: GitHub receives the three feature commits and PR #1 updates automatically.

- [ ] **Step 2: Verify PR state and branch diff**

Run:

```bash
gh pr view 1 --repo one-num-three/warm-study-miniapp --json url,state,isDraft,baseRefName,headRefName
git status -sb
```

Expected: PR #1 remains a draft from `codex/integrate-complete-warm-study` to `main`; the only remaining local changes are the user-owned developer-tool project settings.
