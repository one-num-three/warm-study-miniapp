# 完整暖芽辅导班版本整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `warm-study_1.bundle` 中的完整 H5、微信小程序、Node 服务端和共享业务逻辑安全整合进当前 GitHub 项目。

**Architecture:** 以包内 `883ba42` 的完整双端架构为唯一运行时实现；它和当前演示版从同一初始提交分叉，但已重建目录、数据模型和页面，不将同名的简化页面逐行拼接。通过真实 Git 合并保留两侧提交历史，并以包内工作树解决冲突。

**Tech Stack:** Node.js 22.5+、TypeScript、Vite、原生微信小程序、Node `node:sqlite`、Git、GitHub。

## Global Constraints

- 只在 `codex/integrate-complete-warm-study` 隔离分支操作，绝不直接改动远端 `main`。
- 运行时代码以 `import/warm-study-1` 提交 `883ba42` 为准；现有简化版历史保留在合并祖先中。
- Node 版本必须为 22.5 或以上，服务端使用内置 `node:sqlite`。
- 小程序共享规则只能由 `shared/` 构建后通过 `npm run sync:shared` 写入 `miniprogram/shared/`。
- 不提交 `node_modules/`、`dist/` 或本地 `.worktrees/` 内容。

---

### Task 1: 导入并合并完整架构

**Files:**
- Create: `shared/`, `server/`, `h5/`, `design-system/`, `docs/`, `specs/`
- Replace: `miniprogram/`, `package.json`, `package-lock.json`, `README.md`
- Remove: `src/`, 根目录 `index.html`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `import/warm-study-1`（`883ba42`）与当前分支共同祖先 `e1dd4c6`。
- Produces: 一套以 `shared/` 为领域规则源、`server/` 提供 API、`h5/` 与 `miniprogram/` 为客户端的合并工作树。

- [ ] **Step 1: 记录分叉关系并检查工作树**

Run: `git merge-base HEAD import/warm-study-1 && git status -sb`

Expected: 共同祖先为 `e1dd4c6`，工作树干净。

- [ ] **Step 2: 创建保留双方父提交的合并状态**

Run: `git merge --no-commit --no-ff -X theirs import/warm-study-1`

Expected: Git 自动应用新增的 `shared/`、`server/`、`h5/`、设计系统和完整小程序文件；若简化版的 `src/` 或旧小程序文件发生冲突，保留包内版本。

- [ ] **Step 3: 以完整包的文件树解决同名实现冲突**

Keep these canonical paths from `MERGE_HEAD`: `README.md`, `package.json`, `package-lock.json`, `miniprogram/`, `h5/`, `shared/`, `server/`, `scripts/`, `design-system/`, `docs/`, `specs/`, `tsconfig.base.json`, `tsconfig.json`.

Retain `.gitignore` rule `.worktrees/` in addition to the package rules. Remove obsolete root `src/` and root `index.html`, because the full H5 client is located under `h5/`.

- [ ] **Step 4: Stage and create one merge commit**

Run: `git add -A && git commit -m "Integrate complete warm study application"`

Expected: the commit has both `a70a34e` and `883ba42` as parents and contains the full package tree.

### Task 2: 生成共享产物并验证完整应用

**Files:**
- Modify: `shared/dist/`（构建产物，不纳入版本控制）
- Modify: `miniprogram/shared/`（由同步脚本生成并校验）
- Test: `shared/test/*.test.js`, `server/test/*.test.js`, `scripts/check-miniprogram.mjs`

**Interfaces:**
- Consumes: `shared/src/index.ts` 和领域规则模块。
- Produces: 可供服务端、H5 和微信小程序一致使用的构建产物与静态检查结果。

- [ ] **Step 1: 安装完整项目依赖**

Run: `npm install`

Expected: 根工作区及 `shared`、`server`、`h5` 所需依赖可用。

- [ ] **Step 2: 检查 Node 版本**

Run: `node --version`

Expected: 版本为 `v22.5.0` 或更高；否则停止服务端测试并报告运行时限制。

- [ ] **Step 3: 构建共享领域逻辑并同步到小程序**

Run: `npm run build:shared && npm run sync:shared && npm run build:wxss`

Expected: `shared/dist/` 构建完成、`miniprogram/shared/` 同步完成、`miniprogram/styles/tokens.wxss` 与 H5 令牌一致。

- [ ] **Step 4: 运行完整验证**

Run: `npm run typecheck && npm test && npm run build && npm run check:mp`

Expected: 类型检查、共享单元测试、服务端集成测试、H5 构建和小程序静态检查全部通过。

### Task 3: 发布整合分支

**Files:**
- Modify: Git 分支 `codex/integrate-complete-warm-study`

**Interfaces:**
- Consumes: Task 1 的合并提交和 Task 2 的验证结果。
- Produces: 指向 `main` 的 GitHub 草稿合并请求，供确认后合入。

- [ ] **Step 1: 核对暂存区和提交图**

Run: `git status -sb && git log --oneline --decorate -5`

Expected: 工作树干净，完整包提交是合并提交的第二父提交。

- [ ] **Step 2: 推送整合分支**

Run: `git push -u full-origin codex/integrate-complete-warm-study`

Expected: 远端出现同名分支，不修改 `main`。

- [ ] **Step 3: 创建草稿合并请求**

Run: `gh pr create --repo one-num-three/warm-study-miniapp --base main --head codex/integrate-complete-warm-study --draft --title "Integrate complete warm study application" --body-file <prepared-markdown-file>`

Expected: 生成草稿 PR，说明完整双端架构、保留的历史和已运行的验证。
