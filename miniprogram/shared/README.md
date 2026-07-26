# 自动生成目录 —— 不要手改

本目录由 `npm run sync:shared` 从 `shared/dist` 复制而来。
要改这里的逻辑，请改 `shared/src`，然后重新执行：

```bash
npm run build:shared && npm run sync:shared
```

这样 H5 和小程序永远跑同一套绑定码、积分和状态机规则。
