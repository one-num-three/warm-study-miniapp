#!/usr/bin/env node
/**
 * 把 shared 编译产物同步到 miniprogram/shared/。
 *
 * 微信小程序只能引用 miniprogramRoot 目录内的文件，没法像 H5 那样直接 import
 * 仓库里的 ../shared/src。所以这里把 shared/dist 的 .js 复制进去，
 * 两端跑的就是**同一套**绑定码校验、积分口径和状态机代码。
 *
 * 用法：npm run sync:shared（npm run build 之后自动需要执行一次）
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "shared", "dist");
const target = join(root, "miniprogram", "shared");

if (!existsSync(dist)) {
  console.error("找不到 shared/dist，请先运行 npm run build:shared");
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

let copied = 0;
for (const entry of readdirSync(dist)) {
  // 只要运行时代码，.d.ts 和 sourcemap 不进小程序包
  if (!entry.endsWith(".js")) continue;
  cpSync(join(dist, entry), join(target, entry));
  copied += 1;
}

writeFileSync(
  join(target, "README.md"),
  [
    "# 自动生成目录 —— 不要手改",
    "",
    "本目录由 `npm run sync:shared` 从 `shared/dist` 复制而来。",
    "要改这里的逻辑，请改 `shared/src`，然后重新执行：",
    "",
    "```bash",
    "npm run build:shared && npm run sync:shared",
    "```",
    "",
    "这样 H5 和小程序永远跑同一套绑定码、积分和状态机规则。",
    "",
  ].join("\n"),
);

console.log(`已同步 ${copied} 个文件到 miniprogram/shared/`);
