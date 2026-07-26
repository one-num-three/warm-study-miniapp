/** 服务入口。默认监听 8787，数据库落在 server/data/warm-study.db。 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Db } from "./db.js";
import { createApp } from "./app.js";
import { ensureSeed } from "./seed.js";

const here = dirname(fileURLToPath(import.meta.url));

export function defaultDbPath(): string {
  return process.env.WARM_STUDY_DB ?? resolve(here, "..", "data", "warm-study.db");
}

export function startServer(options: { port?: number; dbPath?: string } = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const dbPath = options.dbPath ?? defaultDbPath();
  const db = new Db(dbPath);

  // 首次启动自动灌入演示数据（含一个负责人账号和几个带绑定码的学生）
  const seeded = ensureSeed(db);

  const server = createServer(createApp(db));
  server.listen(port, () => {
    console.log(`\n  暖芽后端已启动`);
    console.log(`  接口地址  http://localhost:${port}/api`);
    console.log(`  数据文件  ${dbPath}`);
    if (seeded.created) {
      console.log(`\n  已生成演示数据：`);
      console.log(`  负责人账号  ${seeded.ownerUsername} / ${seeded.ownerPassword}`);
      console.log(`  老师账号    ${seeded.staffUsername} / ${seeded.staffPassword}`);
      console.log(`  学生绑定码：`);
      for (const item of seeded.students) {
        console.log(`    ${item.name.padEnd(6, "　")} ${item.code}`);
      }
    }
    console.log("");
  });

  return { server, db, port, dbPath };
}

// 直接执行本文件时启动服务（被 import 时不启动，方便测试复用）
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(here, "index.js");
if (invokedDirectly || process.env.WARM_STUDY_FORCE_START === "1") {
  startServer();
}

export { createApp, Db, join };
