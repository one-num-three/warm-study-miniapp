import test from "node:test";
import assert from "node:assert/strict";
import { failsWith, loginOwner, ok, post, startTestServer } from "./helpers.js";

async function loginWechat(base, code, developmentIdentity) {
  return ok(
    await post(base, "/auth/login", {
      loginType: "wechat",
      code,
      ...(developmentIdentity ? { developmentIdentity } : {}),
    }),
    "微信家长登录",
  );
}

test("同一 OpenID 的不同临时 code 恢复同一已绑定孩子", async (t) => {
  const ctx = await startTestServer({
    resolveWechatIdentity: async () => "openid-mom-1",
  });
  t.after(() => ctx.close());

  const ownerToken = await loginOwner(ctx.base);
  const created = ok(
    await post(ctx.base, "/students", { name: "小满", grade: "三年级" }, ownerToken),
    "创建学生",
  );
  const first = await loginWechat(ctx.base, "code-first", "install-mom-1");
  ok(
    await post(
      ctx.base,
      "/bindings/by-code",
      { bindingCode: created.bindingCodeDisplay, relation: "妈妈" },
      first.token,
    ),
    "首次绑定",
  );

  const second = await loginWechat(ctx.base, "code-second", "install-mom-1");

  assert.equal(second.profile.userId, first.profile.userId);
  assert.deepEqual(second.profile.students.map((student) => student.id), [created.student.id]);
});

test("开发环境用稳定安装标识而不是临时 code 恢复同一账号", async (t) => {
  const original = {
    nodeEnv: process.env.NODE_ENV,
    appId: process.env.WARM_STUDY_WX_APPID,
    secret: process.env.WARM_STUDY_WX_SECRET,
  };
  t.after(() => {
    for (const [key, value] of Object.entries({
      NODE_ENV: original.nodeEnv,
      WARM_STUDY_WX_APPID: original.appId,
      WARM_STUDY_WX_SECRET: original.secret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.NODE_ENV = "development";
  delete process.env.WARM_STUDY_WX_APPID;
  delete process.env.WARM_STUDY_WX_SECRET;

  const ctx = await startTestServer();
  t.after(() => ctx.close());
  const first = await loginWechat(ctx.base, "code-development-first", "install-stable-1");
  const second = await loginWechat(ctx.base, "code-development-second", "install-stable-1");

  assert.equal(second.profile.userId, first.profile.userId);
});

test("不同 OpenID 不会合并为同一个家长", async (t) => {
  const ctx = await startTestServer({
    resolveWechatIdentity: async ({ code }) => (code === "code-a" ? "openid-mom-a" : "openid-mom-b"),
  });
  t.after(() => ctx.close());

  const first = await loginWechat(ctx.base, "code-a", "install-a");
  const second = await loginWechat(ctx.base, "code-b", "install-b");

  assert.notEqual(first.profile.userId, second.profile.userId);
});

test("生产环境缺少微信凭据不会创建家长", async (t) => {
  const original = {
    nodeEnv: process.env.NODE_ENV,
    appId: process.env.WARM_STUDY_WX_APPID,
    secret: process.env.WARM_STUDY_WX_SECRET,
  };
  t.after(() => {
    for (const [key, value] of Object.entries({
      NODE_ENV: original.nodeEnv,
      WARM_STUDY_WX_APPID: original.appId,
      WARM_STUDY_WX_SECRET: original.secret,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.NODE_ENV = "production";
  delete process.env.WARM_STUDY_WX_APPID;
  delete process.env.WARM_STUDY_WX_SECRET;

  const ctx = await startTestServer();
  t.after(() => ctx.close());
  const before = ctx.db.get("SELECT COUNT(*) AS count FROM users").count;
  const response = await post(ctx.base, "/auth/login", {
    loginType: "wechat",
    code: "code-without-secret",
    developmentIdentity: "install-production-1",
  });
  failsWith(response, "WECHAT_LOGIN_UNAVAILABLE");
  const after = ctx.db.get("SELECT COUNT(*) AS count FROM users").count;

  assert.equal(after, before);
});
