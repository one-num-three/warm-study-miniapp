# 暖芽辅导班 · 微信小程序端

家长用绑定码看孩子在辅导班的一天，老师和负责人在同一个小程序里跑完当天的班务。
本目录是**原生小程序**（不是 Taro / uni-app），和 `h5/` 是同一套接口契约、同一套设计令牌、同一套核心领域逻辑。

---

## 一、用微信开发者工具打开

1. 下载并安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（稳定版即可）。
2. 打开工具 → 「导入项目」。
3. **目录**选到本目录 `miniprogram/`（**不是**仓库根目录 —— 根目录下还有 `server/`、`h5/`，选错了会把它们一起打进包里）。
4. **AppID** 填你自己的小程序 AppID；只是本地看看效果的话选「测试号」或直接用工具里的「不使用 AppID / 游客模式」。
   `project.config.json` 里预置的是 `touristappid`，这只是占位，不能上线。
5. 语言选 TypeScript —— `project.config.json` 已经开好 `useCompilerPlugins: ["typescript"]`，工具会自动把 `.ts` 编译成 `.js`，你不用手动跑 tsc。

导入后直接点「编译」，模拟器里会先落在登录页。

---

## 二、改后端地址（API_BASE）

后端地址写在 **`utils/api.ts` 第 13 行**：

```ts
export const API_BASE = "http://localhost:8787/api";
```

- **本地联调**：先在仓库根目录跑 `npm run dev`（会同时起后端和 H5），后端默认监听 `8787`。
  然后在开发者工具里勾上 **「详情 → 本地设置 → 不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**，
  否则 `http://localhost` 的请求会被工具拦掉。
- **真机调试 / 上线**：把它改成你自己的 HTTPS 域名，例如 `https://api.example.com/api`。

首次进入需要后端有数据，可以在仓库根目录执行：

```bash
npm run seed          # 灌演示数据（含演示账号）
```

演示账号：负责人 `owner / warm2026`，老师 `teacher / warm2026`。
登录页「老师 / 负责人」这一栏里有「用负责人账号快速登录」按钮。

---

## 三、真机调试要配的合法域名

小程序在**真机**上只允许请求已备案且在后台登记过的 HTTPS 域名，`localhost` 和 IP 一律不行。

到 [微信公众平台](https://mp.weixin.qq.com) → 「开发 → 开发管理 → 开发设置 → 服务器域名」里配置：

| 类别 | 需要填什么 | 本项目用途 |
| --- | --- | --- |
| `request` 合法域名 | 你的 API 域名，如 `https://api.example.com` | **必填**，所有接口都走 `wx.request` |
| `uploadFile` 合法域名 | 暂不需要 | 作业照片是转成 base64 dataURL 走 `request` 提交的，没有单独的上传接口 |
| `downloadFile` 合法域名 | 暂不需要 | 图片同样是 dataURL，不从外部域名拉 |

补充约束：

- 域名必须是 **HTTPS**，且证书要被信任（自签证书真机上会失败）。
- 域名要**已完成 ICP 备案**。
- 一个月只能修改 5 次，改完要**重新编译**小程序才生效。
- 不能带端口（默认 443）也不能用 IP。

开发阶段绕过办法：开发者工具里勾「不校验合法域名…」；真机预览时打开手机上的**调试模式**（预览二维码旁边选「真机调试」）也可以临时放宽，但**体验版和正式版不行**，必须老老实实配域名。

---

## 四、订阅消息模板要自己申请

「接娃提醒」在产品上是要推给家长微信的。**本仓库没有内置任何模板 ID，也没有调用 `wx.requestSubscribeMessage`** ——
因为订阅消息模板必须绑定到你自己的小程序主体，别人的模板 ID 用不了。

要真正把提醒推到家长微信上，你需要自己做这几步：

1. 公众平台 → 「功能 → 订阅消息」→ 从模板库选一个「服务进度通知 / 预约提醒」类模板，或申请自定义模板，拿到 **模板 ID**。
2. 在家长端合适的时机（例如「今日」页首次进入、或点「开启接娃提醒」时）调 `wx.requestSubscribeMessage({ tmplIds: [模板ID] })` 向用户要授权。
   一次授权只能发一条，长期订阅需要单独申请权限。
3. 服务端在发提醒时调用微信的 `subscribeMessage.send` 接口，用家长的 OPENID + 模板 ID 推送。

**当前实现的诚实说明**：`POST /reminders` 现在只把提醒**记进数据库**，返回值里的 `delivered` 表示"有没有已绑定的家长可通知"。
管理端看板在 `delivered === false` 时会明确提示「家长还没绑定，提醒已记录但没发出去，请电话联系」，
不会把没发出去的提醒说成"已通知"。家长端是在「今日」页里主动拉取最新提醒来展示的。

---

## 五、`npm run sync:shared` 是干什么的

小程序只能引用 `miniprogramRoot` 目录内的文件，没法像 H5 那样直接 `import` 仓库里的 `../shared/src`。
所以有这个脚本（在**仓库根目录**执行）：

```bash
npm run build:shared && npm run sync:shared
```

它把 `shared/dist/*.js` 复制到本目录的 `shared/` 下。这样绑定码校验位算法、积分口径、状态机转移表
在**服务端 / H5 / 小程序三边跑的是同一份代码**，不会出现"H5 说这个码有效、小程序说无效"这种事。

- `miniprogram/shared/` 是**自动生成目录，不要手改** —— 下次同步会被整个删掉重建。
- 要改共享逻辑，改 `shared/src/`，然后重新执行上面那条命令。
- 页面里引用共享模块必须**带 `.js` 后缀**（因为它们是编译产物）：

  ```ts
  import { normalizeBindingCode } from "../../../shared/binding-code.js";
  ```

  引用本目录内自己写的 TS（`utils/`、`components/`）则**不带后缀**。

---

## 六、目录结构

```
miniprogram/
├── app.json            页面路由表、window 配置、自定义 TabBar 声明
├── app.ts              启动静默登录（wx.login → /auth/login）、全局身份状态、权限判断、外壳切换
├── app.wxss            全局样式，从 h5/src/styles.css 移植（px → rpx，1px = 2rpx）
├── sitemap.json        全部不收录（页面都要登录后按身份看，索引没意义）
├── tsconfig.json       TS 配置
├── typings/index.d.ts  wx / App / Page / Component 的兜底类型声明（见下「类型策略」）
├── project.config.json 开发者工具配置
├── custom-tab-bar/     自定义 TabBar 挂载点（框架约定路径）
├── components/
│   ├── tab-bar/        底部导航的实际实现，两套四项 + 线性 SVG 图标
│   ├── form-modal/     通用表单弹层（对应 H5 的 formSheet）
│   └── code-dialog/    绑定码大字弹层
├── utils/
│   ├── api.ts          接口客户端（api.get/post/patch、toast、toastError、wxLoginCode）
│   ├── ui.ts           confirmDialog / actionSheet / 复制 / 选图转 base64
│   └── format.ts       展示层加工（状态配色、时间戳、流水加工）
├── shared/             ← 自动生成，不要改
└── pages/
    ├── login/          绑定码入口 + 管理端账密
    ├── guardian/       today homework submit growth me bind sheet ledger store mistakes
    └── admin/          board homework students student manage redeem bindings products
                        redemptions staff audit settings reconcile
```

---

## 七、两个实现上的选择（免得后人踩坑）

### 1. 为什么管理端四页不是 tabBar 页

小程序的 `tabBar.list` 最多只能放 5 项，而我们有 8 个导航目标（家长四项 + 管理端四项）。
所以：

- **家长端**「今日/作业/成长/我的」注册成真正的 tabBar 页，切换走 `wx.switchTab`；
- **管理端**「看板/作业/学员/管理」是普通页面，各自在 WXML 里手动放 `<tab-bar role="admin">` 组件，切换走 `wx.redirectTo`（平移替换，页面栈不会越点越深）。

两者用的是同一个 `components/tab-bar` 组件，所以外观完全一致。

### 2. 图标为什么是 WXSS 里的一串 data URI

`design.md §4.5` 明确要求「图标统一使用同一套专业线性图标的本地资源，不使用 emoji 作为功能图标」。
`components/tab-bar/index.wxss` 里的图标是内联的线性 SVG（`background-image: url("data:image/svg+xml,...")`），
路径与 `h5/src/icons.ts` 完全相同，未选中 `#9aa79d`、选中 `#2f5b45` 各一份。
没用 `<image src="data:image/svg+xml;base64,...">`，是因为 `<image>` 组件对 SVG 的支持在不同基础库版本上有差异，
而 WXSS 的 `background-image` 走的是 WebView 的 CSS 引擎，表现稳定。改图标请两端一起改。

### 3. 类型策略

`typings/index.d.ts` 里把 `wx` 等全局对象声明成了 `any`。
官方类型包 `miniprogram-api-typings` 需要联网安装，本仓库在离线环境构建，装不上就会让整个工程编译不过 ——
与其被类型问题卡住，不如给一份"能过编译、不误导人"的最小声明。

联网后想要真正的类型提示：

```bash
npm i -D miniprogram-api-typings
```

然后删掉 `typings/index.d.ts`，把 `tsconfig.json` 的 `"types": []` 改成 `["miniprogram-api-typings"]`。

接口返回值统一用 `any` 承接，字段含义写在调用处的注释里。这是刻意的取舍：契约的真值在
`shared/src/api-contract.ts` 和 `shared/src/types.ts`，在小程序端再抄一份类型只会多一处要同步的地方。

---

## 八、权限边界

管理端界面按 `profile.permissions` 显隐，权限码定义在 `shared/src/permissions.ts`。
老师（`DEFAULT_STAFF_PERMISSIONS`）**看不到**这些入口：

- 学员页的「新增学员」（需要 `student.manage`）
- 管理页的「家长绑定审核」（`binding.review`）、「老师账号」（`staff.manage`）、
  「审计日志」（`audit.read`）、「系统设置」（`settings.manage`）、「商品与库存」（`product.manage`）、
  「积分对账」（仅负责人）
- 学员详情页的绑定码停用/重置（`binding_code.manage`）、流水冲正（仅负责人）、档案管理（`student.manage`）
- 发放积分时的「人工调整」类型（仅负责人）

界面不渲染只是第一道；**服务端每个接口都会再校验一次**，前端隐藏不构成安全边界。
