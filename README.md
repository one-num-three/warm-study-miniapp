# 暖芽辅导班 H5

面向小型课后辅导班的 H5 体验版，用于先验证家长与管理端的完整日常流程，再迁移到微信小程序。

## 已实现功能

- 家长、老师、负责人三种角色工作台。
- 作业提交、辅导反馈、今日到班与接娃提醒。
- 积分流水、冲正、周排行榜。
- 商品上架、库存管理、现场兑换与撤销兑换。
- 错题集、浏览器本地图片上传、家长绑定审核与操作审计。

> 当前数据保存于浏览器本地存储，便于演示与流程确认；微信订阅消息、云端图片存储和多人实时协作将在小程序/云端阶段接入。

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## 规格文档

- `specs/tutoring-miniapp-v1/requirements.md`
- `specs/tutoring-miniapp-v1/design.md`
- `specs/tutoring-miniapp-v1/tasks.md`
