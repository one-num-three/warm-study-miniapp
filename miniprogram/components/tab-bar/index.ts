/**
 * 底部导航条的实际实现。
 *
 * 两套四项：家长端「今日/作业/成长/我的」，管理端「看板/作业/学员/管理」。
 * 之所以做成普通组件而不是直接写在 custom-tab-bar 里：
 * 小程序的 tabBar.list 最多只能声明 5 个页面，我们有 8 个导航目标，
 * 所以家长端四页注册成真正的 tabBar 页（走 switchTab），
 * 管理端四页是普通页面、在各自 WXML 里手动放这个组件（走 redirectTo）。
 *
 * 图标一律用线性 SVG（见 index.wxss 里的 data URI），不使用 emoji —— design.md §4.5 的硬要求。
 */

interface TabItem {
  text: string;
  /** 对应 index.wxss 里的 .ico-xxx 类名 */
  icon: string;
  path: string;
  /** 是否是注册在 app.json tabBar.list 里的页面，决定用 switchTab 还是 redirectTo */
  tab: boolean;
}

const GUARDIAN_TABS: TabItem[] = [
  { text: "今日", icon: "today", path: "/pages/guardian/today/today", tab: true },
  { text: "作业", icon: "homework", path: "/pages/guardian/homework/homework", tab: true },
  { text: "成长", icon: "growth", path: "/pages/guardian/growth/growth", tab: true },
  { text: "我的", icon: "me", path: "/pages/guardian/me/me", tab: true },
];

const ADMIN_TABS: TabItem[] = [
  { text: "看板", icon: "board", path: "/pages/admin/board/board", tab: false },
  { text: "作业", icon: "homework", path: "/pages/admin/homework/homework", tab: false },
  { text: "学员", icon: "students", path: "/pages/admin/students/students", tab: false },
  { text: "管理", icon: "manage", path: "/pages/admin/manage/manage", tab: false },
];

Component({
  options: {
    // 让外部页面能通过 class 微调（目前没用到，但组件被复用时省得改样式表）
    addGlobalClass: true,
  },

  properties: {
    /** 当前高亮第几项 */
    active: { type: Number, value: 0 },
    /** guardian | admin */
    role: {
      type: String,
      value: "guardian",
      observer(this: any, value: string) {
        this.setData({ items: value === "admin" ? ADMIN_TABS : GUARDIAN_TABS });
      },
    },
  },

  data: {
    items: GUARDIAN_TABS,
  },

  methods: {
    onTap(this: any, event: any) {
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.items[index];
      if (!item || index === this.data.active) return;
      if (item.tab) wx.switchTab({ url: item.path });
      // 管理端四页是普通页面，用 redirectTo 替换当前页，页面栈不会越点越深
      else wx.redirectTo({ url: item.path });
    },
  },
});
