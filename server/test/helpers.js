import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Db } from "../dist/db.js";
import { createApp } from "../dist/app.js";
import { ensureSeed } from "../dist/seed.js";

/** 起一个跑在随机端口上的临时服务，每个测试文件独立数据库。 */
export async function startTestServer(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "warm-study-test-"));
  const dbPath = join(dir, "test.db");
  const db = new Db(dbPath);
  const seed = ensureSeed(db);
  const server = createServer(createApp(db, options));
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api`;

  return {
    base,
    db,
    seed,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 带 token 的 fetch 封装，返回 { status, body }。 */
export async function call(base, method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

export const get = (base, path, token) => call(base, "GET", path, { token });
export const post = (base, path, body, token) => call(base, "POST", path, { body, token });
export const patch = (base, path, body, token) => call(base, "PATCH", path, { body, token });

/** 断言接口成功并返回 data，失败时把错误码打出来方便定位。 */
export function ok(result, hint = "") {
  if (!result.body?.success) {
    throw new Error(
      `${hint} 期望成功但失败了: ${result.status} ${result.body?.code} ${result.body?.message}`,
    );
  }
  return result.body.data;
}

/** 断言接口失败并命中指定错误码。 */
export function failsWith(result, code, hint = "") {
  if (result.body?.success) {
    throw new Error(`${hint} 期望失败(${code})但成功了: ${JSON.stringify(result.body.data)}`);
  }
  if (result.body?.code !== code) {
    throw new Error(
      `${hint} 期望错误码 ${code}，实际 ${result.body?.code}（${result.body?.message}）`,
    );
  }
  return result.body;
}

let counter = 0;
export function reqId(prefix = "test") {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 用负责人账号登录 */
export async function loginOwner(base) {
  const data = ok(
    await post(base, "/auth/staff-login", { username: "owner", password: "warm2026" }),
    "负责人登录",
  );
  return data.token;
}

/** 用老师账号登录 */
export async function loginStaff(base) {
  const data = ok(
    await post(base, "/auth/staff-login", { username: "teacher", password: "warm2026" }),
    "老师登录",
  );
  return data.token;
}

/** 模拟一个家长（H5 设备身份），返回 token */
export async function loginGuardian(base, deviceId, displayName) {
  // 不传称呼时不覆盖已有的 displayName —— 模拟"重新打开小程序"的静默登录
  const data = ok(
    await post(base, "/auth/login", {
      loginType: "device",
      code: deviceId,
      ...(displayName ? { displayName } : {}),
    }),
    "家长登录",
  );
  return data.token;
}
