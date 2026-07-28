# 微信 OpenID 首次绑定与自动登录设计

## 目标

让家长首次使用小程序时用绑定码确认孩子身份；此后只要仍使用同一个微信，无论关闭小程序、令牌过期或更换手机，都能通过微信 OpenID 自动恢复已绑定孩子，不再重复输入绑定码。

## 现状与根因

小程序已经在启动时调用 `wx.login()`，并将 `code` 提交到 `POST /api/auth/login`。后端 `resolveWechatOpenId()` 在配置 `WARM_STUDY_WX_APPID` 与 `WARM_STUDY_WX_SECRET` 时会向微信 `jscode2session` 换取 OpenID。

当这两个环境变量缺失时，现有开发回退把临时 `code` 直接派生成 `devopenid:<code>`。微信 `code` 每次登录都会变化，因此每次都可能成为新的家长身份，无法稳定找回已有的孩子绑定。

## 用户流程

1. 小程序启动，先用本地会话令牌请求 `GET /api/auth/profile`。
2. 令牌有效时，直接恢复家长档案与孩子列表。
3. 令牌失效或首次启动时，小程序调用 `wx.login()`，提交 `loginType: "wechat"` 与临时 `code`。
4. 生产后端用对应 AppID 与 AppSecret 调微信 `jscode2session`，取得稳定 OpenID，只保存其带盐 SHA-256 哈希到 `users.identity_hash`。
5. 已存在该 OpenID 哈希时，服务端签发新会话并返回现有档案；小程序直接进入家长端。
6. 不存在该 OpenID 哈希时，服务端建立空的家长身份；小程序展示绑定码页面。绑定成功后，现有 `student_guardians` 记录把该身份与孩子关联。

同一个微信身份可绑定多个孩子；同一个孩子可由多个微信身份分别绑定。管理员现有的 `POST /api/bindings/:id/release` 会将关系改为“已解除”并写入审计记录；被解除的微信下次进入将不再看到该孩子。

## 生产配置

生产服务器必须设置以下环境变量：

```text
NODE_ENV=production
WARM_STUDY_WX_APPID=微信公众平台中的小程序 AppID
WARM_STUDY_WX_SECRET=微信公众平台中的小程序 AppSecret
WARM_STUDY_IDENTITY_SALT=随机生成并长期保存的高强度盐值
```

- 小程序 `project.config.json` 中的 AppID 必须与 `WARM_STUDY_WX_APPID` 相同。
- AppSecret 只保存在服务器的环境变量或部署平台密钥管理中；不写入小程序、Git 仓库、日志或接口响应。
- 部署到公网后，小程序后台要把 API 的 HTTPS 域名加入“request 合法域名”。真机不能访问 `localhost`。
- `WARM_STUDY_IDENTITY_SALT` 上线后不得随意更换，否则已有 OpenID 哈希将无法匹配到原账号。

## 开发环境行为

本地开发不具备真实 AppSecret 时，保留显式开发模式，但不再把临时 `wx.login` code 当身份。小程序生成并持久化一个仅用于开发的安装标识；后端仅在 `NODE_ENV !== "production"` 且未配置真实微信凭据时，使用该标识派生模拟身份。

生产环境缺失 AppID 或 AppSecret 时，后端必须拒绝微信登录并返回明确的配置错误，绝不能创建新家长账号或回退到临时 code 身份。

## 代码边界

- `server/src/auth.ts`：封装生产 OpenID 交换、显式开发身份回退，以及“生产环境配置缺失”的错误。
- `server/src/services/identity.ts`：扩展微信登录输入，仍只写入 `identity_hash`，复用现有用户查找、会话签发和档案构建流程。
- `server/src/app.ts` 与 `shared/src/api-contract.ts`：声明并校验可选的开发安装标识；生产环境忽略该字段。
- `miniprogram/utils/api.ts`：提供稳定的本地开发安装标识，不保存或暴露 AppSecret。
- `miniprogram/app.ts` 与 `miniprogram/pages/login/login.ts`：静默登录和首次绑定时传递该开发标识；已有 OpenID 档案仍优先直接进入家长端。
- `README.md` 与 `.env.example`：补充本地调试、生产环境变量和微信公众平台配置说明。

H5 继续使用既有浏览器设备身份，管理端账号密码登录不改变。数据库表结构无需迁移：`users.identity_hash` 与 `student_guardians` 已能表达所需关系。

## 安全与异常处理

- OpenID 原文不落库、不返回小程序；只保存带服务端盐值的哈希。
- 微信接口超时、AppSecret 失效、AppID 不匹配或微信返回错误时，登录页显示“微信登录暂不可用，请稍后重试”，不清除已有有效会话。
- 同一 OpenID 在多设备上登录会恢复同一个家长账号；不同 OpenID 必须仍受已有权限和数据隔离限制。
- 既有开发模式创建的临时身份无法安全映射到真实 OpenID。首次切换到真实微信登录时，该测试身份需要重新输入一次绑定码；之后即永久自动恢复。

## 验收与测试

1. 两个不同的临时 `code` 经同一真实 OpenID 解析后，返回同一个 `userId` 和同一组已绑定孩子。
2. 一个从未出现过的 OpenID 登录后没有孩子，首次绑定码成功后再次登录直接带回该孩子。
3. 两个不同 OpenID 不能互相读取对方孩子、作业、积分或错题数据。
4. 管理员解除绑定后，被解除的 OpenID 重新登录时不再获得该孩子。
5. `NODE_ENV=production` 且缺少微信凭据时，微信登录失败且数据库中不新增用户。
6. 开发模式的稳定安装标识在多次 `wx.login` code 变化后仍得到同一测试家长身份。
7. 现有共享逻辑、服务端集成测试、H5 构建和小程序静态检查全部保持通过。
