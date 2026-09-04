# 从 H5 迁移到微信小程序

这份文档说明 H5 与原生微信小程序的边界，以及哪些项目必须靠微信开发者工具和真机验收。完整的上线优先级、排期和放行门槛统一见 [上线执行计划](上线执行计划.md)。

---

## 一、迁移策略：为什么不用跨端框架

常见做法是上 Taro / uni-app，一套代码编译两端。这个项目没有那么做，理由有三条：

1. **两端的交互规矩本来就不同。** 小程序有原生导航栏和页面栈、`wx.showToast`、`wx.chooseMedia`、订阅消息授权；H5 这些都得自己实现。跨端框架会把这些差异抹平成"最小公约数"，结果是两边都不像原生。
2. **规格要求的是原生小程序。** [冻结需求](../specs/tutoring-miniapp-v1/requirements.md) 明确写了「前端：原生微信小程序，建议 TypeScript」。用编译框架会让审核材料、性能分析、真机调试都多一层。
3. **真正值得共享的不是 UI，是规则。** 绑定码怎么算校验位、积分排行怎么排、状态机能不能从 A 跳到 B —— 这些逻辑两端必须一模一样，一旦漂移就是线上事故。而按钮长什么样、弹层怎么弹，两端各自适配反而更好。

所以采用的是**共享领域逻辑 + 各自的平台壳**：

```
        ┌──────────────── shared/ ────────────────┐
        │  绑定码校验 · 积分口径 · 状态机 · 权限矩阵  │
        │  接口契约 · 错误码与中文提示                │
        └───────┬─────────────────────┬────────────┘
                │                     │
      ┌─────────▼────────┐   ┌────────▼──────────┐
      │  h5/  (Vite+TS)  │   │ miniprogram/ (原生) │
      │  DOM · fetch     │   │ WXML · wx.request  │
      │  localStorage    │   │ wx.setStorageSync  │
      └──────────────────┘   └───────────────────┘
```

---

## 二、能力对照表

迁移时逐项替换的东西：

| 能力 | H5 | 小程序 | 状态 |
| --- | --- | --- | --- |
| 身份来源 | `localStorage` 里的设备 ID | `wx.login` 拿 code，服务端换 OPENID | 已做，服务端 `/auth/login` 同一个接口按 `loginType` 分支 |
| 网络请求 | `fetch` | `wx.request` | 已做，`miniprogram/utils/api.ts` 与 `h5/src/api.ts` 出入参一致 |
| 本地存储 | `localStorage` | `wx.setStorageSync` | 已做 |
| 页面栈 | 自己写的 `router.ts` | 原生 `navigateTo` / `switchTab` / `navigateBack` | 已做 |
| 导航栏 | 自绘 `.navbar` | 原生 `navigationBarTitleText` | 已做，所以 `app.wxss` 里没有 `.navbar` |
| TabBar | 自绘 `.tabbar` | `"tabBar": { "custom": true }` + `custom-tab-bar/` | 已做，见下方"两套机制"说明 |
| 轻提示 | 自绘 `.toast` | `wx.showToast` | 已做 |
| 确认框 / 表单弹层 | 自绘 `.dialog` / `.sheet` | 自定义组件 `components/form-modal`、`code-dialog` | 已做（`wx.showModal` 不支持多字段表单） |
| 选图 | `<input type=file>` + `FileReader` | `wx.chooseMedia` + `wx.getFileSystemManager().readFile({encoding:'base64'})` | 已做 |
| 样式单位 | px | rpx（375 稿 1px = 2rpx） | 已做，令牌由脚本换算 |
| 接娃通知 | 无 | 微信订阅消息 | **未做**，需要真实 AppID 和模板 ID |
| 安全区 | `env(safe-area-inset-bottom)` | 同名，但要配合 `page` 而不是 `:root` | 已做 |

### 两套 TabBar 机制

小程序原生 `tabBar.list` 最多 5 项，而这个产品有 8 个导航目标（家长端 4 个 + 管理端 4 个）。做法是：

- **家长端四页**注册成真 tabBar 页，用 `wx.switchTab` 切换；
- **管理端四页**是普通页面，在各自 WXML 里手动放 `<tab-bar role="admin">`，用 `wx.redirectTo` 切换；
- 两者共用 `components/tab-bar` 同一个组件，保证外观一致。

---

## 三、分层：什么共享、什么不共享

### 共享（`shared/` → `miniprogram/shared/`）

绑定码生成与校验、积分账本口径、排行榜排序规则、四个状态机的转移表、权限码与角色默认权限、接口契约、稳定错误码与中文提示。

同步方式：`npm run sync:shared` 把 `shared/dist` 的 `.js` 复制进 `miniprogram/shared/`。**小程序只能引用 `miniprogramRoot` 内的文件**，所以必须复制，不能软链或相对引用出去。那个目录是自动生成的，不要手改。

`shared/` 里刻意不碰任何平台 API。唯一擦边的是随机数：`random.ts` 会先试 `crypto.getRandomValues`，小程序基础库多半没有，自动退回 `Math.random()`。绑定码的唯一性本来就靠数据库唯一索引兜底，不靠随机源质量，所以这个退化是安全的。

### 不共享（有意的）

页面视图层、导航方式、弹层实现、样式的组件层。理由见第一节。

### 半共享：设计令牌

颜色、圆角、投影这些一旦两边各写一套，改个主色就要改两处，迟早漂。所以：

```bash
npm run build:wxss   # 从 h5/src/styles.css 的 :root 生成 miniprogram/styles/tokens.wxss
```

`app.wxss` 第一行 `@import "./styles/tokens.wxss"`，组件层全部用 `var(--x)`。要改配色，改 H5 那一处，重新生成即可两端生效。`npm run check:mp` 会校验两端令牌是否一致，漂了就报错。

---

## 四、自动化保障

三个脚本各守一段，合起来接住了大部分"编译期能发现的问题"：

| 命令 | 守住什么 |
| --- | --- |
| `npm run sync:shared` | 领域逻辑两端同源 |
| `npm run build:wxss` | 设计令牌两端同源 |
| `npm run check:mp` | 见下 |

`npm run check:mp` 的九项检查：

1. `app.json` 的 pages 与磁盘上的 `.wxml/.json/.ts` 四件套一一对应
2. `usingComponents` 引用的组件路径能否解析
3. WXML 里 `{{}}` 引用的字段，在页面逻辑文件里是否存在
4. `wx:for` 是否漏了 `wx:key`（列表复用串数据的头号原因）
5. `bindtap` 绑的方法是否真的定义了
6. WXSS 是否用了小程序不支持的选择器（`*`、属性选择器、`:focus-visible`、`::placeholder` 等）
7. 两端设计令牌是否漂移
8. `shared/` 里是否用了小程序基础库可能没有的 JS API
9. 接口路径是否都能在 `shared` 的 `ENDPOINTS` 契约里找到

这个校验器本身是**用故意注入的故障验证过的** —— 去掉一个 `wx:key`、绑一个不存在的方法、引用一个不存在的字段、指向一个不存在的组件、写一个属性选择器、改一个令牌值，六项全部被抓到。不是摆设。

它也进了 `npm test`，所以改坏了会在测试里挂掉。

---

## 五、静态检查抓不到的：必须人工验

这是本次迁移最诚实的一段。云端沙箱**装不了微信开发者工具**，下面这些只做到"代码逻辑正确、静态检查通过"，**没有一次真实渲染或真实点击**：

1. **所有页面的实际渲染效果。** 布局是按 1px=2rpx 换算的，但 rpx 折算后的观感、`grid` 在小程序 WebView 里的表现、长文本截断，都可能要微调。
2. **自定义 TabBar 的挂载。** `custom-tab-bar/index` 被框架自动注入、`this.getTabBar().setData()` 能否联动、管理端手动放的 `<tab-bar>` 与 `position: fixed` 会不会和框架容器打架 —— 这是最可能需要现场调整的一处。
3. **WXSS 里内联 SVG data URI 图标能否渲染。** 理论上走 `background-image` 最稳，但没在模拟器/真机上看过。若不显示，退路是换成 PNG 本地资源。
4. **`wx.chooseMedia` → base64 的图片链路。** 编码格式、压缩后体积会不会撑爆请求体，都没实测。
5. **绑定码输入框的受控回写。** 每次 `bindinput` 都 setData 回写带短横的值，真机输入法下可能出现光标跳动。这是小程序受控输入的经典坑，只能真机验。
6. **`wx.login` 全链路。** 需要真实 AppID + 后端用 code 换 OPENID。游客模式下 `wx.login` 返回的 code 换不到有效身份，所以启动流程一次都没跑通过。
7. **接口联调。** 后端没在小程序环境下被真实调用过，响应结构是照契约和服务端源码交叉核对的。

H5 端的主流程可以在真浏览器中回归；每次 E2E 运行产生的截图写入被 Git 忽略的 `artifacts/e2e/`。**小程序端复用的是同一套领域逻辑**，但真实渲染、微信登录、图片和通知仍必须在开发者工具和真机中验收。

---

## 六、上线前 checklist

**必做**

- [ ] `miniprogram/utils/api.ts` 的 `API_BASE` 改成你的后端域名（HTTPS）
- [ ] `project.config.json` 的 `appid` 换成自己的
- [ ] 小程序后台配置 request 合法域名
- [ ] 服务端配置 `WARM_STUDY_WX_APPID` / `WARM_STUDY_WX_SECRET`；生产缺少凭据时必须启动失败
- [ ] 服务端配置 `WARM_STUDY_IDENTITY_SALT`（默认值只适合本地）
- [ ] 在微信开发者工具里逐页点一遍，重点是第五节那七项
- [ ] 至少一台 iOS + 一台 Android 真机验收（规格 requirements §6 要求）

**接订阅消息时**

- [ ] 申请模板，字段只放：孩子昵称、预计可接时间、辅导班提示语
- [ ] 家长端在「通知设置」或关键流程里申请订阅授权
- [ ] 服务端 `sendPickupNotice` 里接上真实发送；**只有微信接口确认成功时才允许返回 `delivered: true`**

**审核材料**

- [ ] 隐私政策、用户协议
- [ ] 隐私接口说明（用到了 `wx.login`、`wx.chooseMedia`）
- [ ] 类目材料（教育 / 培训类目通常需要资质）

---

## 七、如果以后想变

**只留小程序、不要 H5 了**：删掉 `h5/` 之前，先把 `scripts/build-miniprogram-wxss.mjs` 和 `scripts/build-design-system.mjs` 的输入源从 `h5/src/styles.css` 换成一个独立的 `shared/tokens.css`。这两个脚本现在拿 H5 当样式的单一来源，H5 没了它们就断了。端到端测试也会一起失去 —— 那是目前唯一能真跑业务流程的验证手段，建议保留 H5 作为"业务逻辑的活体测试床"，哪怕不对外。

**要上 Taro / uni-app**：`shared/` 可以原样带走，那部分本来就与平台无关。要重写的是两个壳。不过在换之前值得先想清楚第一节那三条理由是否已经不成立。

**要加管理后台（Web）**：后端接口是完整的 REST，`shared/src/api-contract.ts` 就是现成的契约，直接起一个新前端接上即可，不需要动服务端。
