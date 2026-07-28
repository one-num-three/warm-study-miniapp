/**
 * 自定义 TabBar 的挂载点。
 *
 * 小程序规定：app.json 里 tabBar.custom 为 true 时，
 * 框架会自动把 /custom-tab-bar/index 这个组件渲染到 tabBar 页面底部。
 * 这里只做转发，真正的实现在 /components/tab-bar，
 * 这样管理端那四个"普通页面"也能用同一个组件，两端外观完全一致。
 *
 * 页面里这样同步高亮：
 *   if (typeof this.getTabBar === "function" && this.getTabBar()) {
 *     this.getTabBar().setData({ active: 0, role: "guardian" });
 *   }
 */

Component({
  data: {
    active: 0,
    role: "guardian",
  },
});
