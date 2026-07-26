/** 应用外壳：导航栏 + 页面容器 + 自定义 TabBar。 */

import { button, div, icon, mount } from "./dom.js";
import { ICONS, type IconName } from "./icons.js";
import {
  current,
  getPage,
  navigateBack,
  setRouterListener,
  stackDepth,
  switchTab,
} from "./router.js";
import { state, subscribe } from "./state.js";
import { renderLogin } from "./pages/login.js";
import { loading } from "./ui.js";

interface TabDef {
  name: string;
  label: string;
  icon: IconName;
  badge?: () => number;
}

const GUARDIAN_TABS: TabDef[] = [
  { name: "guardian.today", label: "今日", icon: "today" },
  { name: "guardian.homework", label: "作业", icon: "homework" },
  { name: "guardian.growth", label: "成长", icon: "growth" },
  { name: "guardian.me", label: "我的", icon: "me" },
];

const ADMIN_TABS: TabDef[] = [
  { name: "admin.board", label: "看板", icon: "board" },
  { name: "admin.homework", label: "作业", icon: "homework" },
  { name: "admin.students", label: "学员", icon: "students" },
  { name: "admin.manage", label: "管理", icon: "manage" },
];

function tabsForShell(): TabDef[] {
  return state.shell === "admin" ? ADMIN_TABS : GUARDIAN_TABS;
}

let root: HTMLElement;
let renderToken = 0;

export function bootApp(container: HTMLElement): void {
  root = container;
  setRouterListener(render);
  subscribe(render);
  render();
}

/** 当前 shell 的默认首页 */
function defaultTab(): string {
  return tabsForShell()[0]!.name;
}

export function render(): void {
  if (!state.ready) {
    mount(root, div({ class: "shell" }, div({ class: "loading" }, "正在打开暖芽…")));
    return;
  }

  if (state.shell === "login" || !state.profile) {
    mount(root, renderLogin());
    return;
  }

  let route = current();
  const tabs = tabsForShell();
  // 切换身份后栈里可能还留着另一端的页面，重置到本端首页。
  // switchTab 会同步回调 render()，所以这里必须直接 return —— 让那次回调
  // 去完成渲染。否则一次登录会把整页渲染两遍、所有接口打两次
  // （其中 /dashboard 内部还有写操作，写放大也翻倍）。
  if (!route || !getPage(route.name) || !belongsToShell(route.name)) {
    switchTab(defaultTab());
    return;
  }

  const page = getPage(route.name);
  if (!page) {
    switchTab(defaultTab());
    return;
  }

  const params = route.params ?? {};
  const title = typeof page.title === "function" ? page.title(params) : page.title;
  const isTab = Boolean(page.tab);

  const body = div({ class: "page" });
  const shell = div(
    { class: isTab ? "shell shell--tabbed" : "shell", style: "position:relative" },
    div(
      { class: "navbar" },
      !isTab && stackDepth() > 1
        ? button({ class: "navbar__back", onClick: () => navigateBack() }, icon(ICONS.back, "tabbar__icon"))
        : null,
      div({ class: "navbar__title" }, title),
      page.extra ? div({ class: "navbar__extra" }, page.extra(params) ?? "") : null,
    ),
    body,
    isTab ? renderTabBar(tabs, route.name) : null,
  );

  mount(root, shell);

  const token = ++renderToken;
  loading(body);
  void Promise.resolve(page.render(body, params)).catch((error: unknown) => {
    if (token !== renderToken) return;
    console.error(error);
    mount(
      body,
      div(
        { class: "card" },
        div({ class: "card__title" }, "页面加载失败"),
        div({ class: "card__hint" }, error instanceof Error ? error.message : String(error)),
        button({ class: "btn btn--primary btn--block", style: "margin-top:12px", onClick: render }, "重试"),
      ),
    );
  });
}

function belongsToShell(name: string): boolean {
  if (state.shell === "admin") return name.startsWith("admin.") || name.startsWith("common.");
  return name.startsWith("guardian.") || name.startsWith("common.");
}

function renderTabBar(tabs: TabDef[], activeName: string): HTMLElement {
  return div(
    { class: "tabbar" },
    ...tabs.map((tab) => {
      const count = tab.badge?.() ?? 0;
      return button(
        {
          class: tab.name === activeName ? "tabbar__item is-active" : "tabbar__item",
          dataset: { tab: tab.name },
          onClick: () => switchTab(tab.name),
        },
        icon(ICONS[tab.icon]),
        div({}, tab.label),
        count > 0 ? div({ class: "tabbar__badge" }, String(count)) : null,
      );
    }),
  );
}
