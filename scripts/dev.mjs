#!/usr/bin/env node
/**
 * 一条命令把后端和 H5 一起跑起来：`npm run dev`
 * 后端 http://localhost:8787，前端 http://localhost:5173（已配好 /api 代理）。
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

const children = [];

function run(label, args, options = {}) {
  const child = spawn(npm, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
    ...options,
  });
  const prefix = `[${label}] `;
  const pipe = (stream, target) => {
    stream.setEncoding("utf8");
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) target.write(prefix + line + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      process.stdout.write(`${prefix}退出，代码 ${code}\n`);
    }
  });
  children.push(child);
  return child;
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("正在构建 shared 与 server…");
const build = spawn(npm, ["run", "build:shared"], { cwd: root, stdio: "inherit", shell: isWindows });
build.on("exit", (code) => {
  if (code !== 0) {
    console.error("shared 构建失败");
    process.exit(code ?? 1);
  }
  run("server", ["run", "dev", "--workspace", "server"]);
  setTimeout(() => run("h5", ["run", "dev", "--workspace", "h5"]), 1500);
  setTimeout(() => {
    console.log("\n  前端 http://localhost:5173");
    console.log("  后端 http://localhost:8787/api");
    console.log("  Ctrl+C 结束\n");
  }, 3000);
});
