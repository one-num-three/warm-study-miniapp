#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generated = [
  "dist",
  "h5/dist",
  "server/dist",
  "shared/dist",
  "tsconfig.tsbuildinfo",
  "h5/tsconfig.tsbuildinfo",
  "server/tsconfig.tsbuildinfo",
  "shared/tsconfig.tsbuildinfo",
  "artifacts",
];

for (const relative of generated) {
  const target = resolve(root, relative);
  if (!target.startsWith(`${root}/`) && !target.startsWith(`${root}\\`)) {
    throw new Error(`拒绝删除工作区外路径: ${target}`);
  }
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}

console.log("已清理构建产物和 E2E 产物；未触碰源码、文档、测试、server/data 与微信本地配置。");
