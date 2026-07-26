/**
 * 页面栈。模仿小程序的 navigateTo / navigateBack / switchTab：
 * 切 Tab 会清空栈，进详情页是入栈，返回是出栈。
 */

export interface Route {
  name: string;
  params?: Record<string, string>;
  title?: string;
}

export interface PageDef {
  title: string | ((params: Record<string, string>) => string);
  /** 是否是 Tab 页（有 TabBar、没有返回箭头） */
  tab?: boolean;
  render: (container: HTMLElement, params: Record<string, string>) => void | Promise<void>;
  /** 右上角附加文案 */
  extra?: (params: Record<string, string>) => string | null;
}

const pages = new Map<string, PageDef>();
let stack: Route[] = [];
let onChange: () => void = () => {};

export function definePage(name: string, def: PageDef): void {
  pages.set(name, def);
}

export function getPage(name: string): PageDef | undefined {
  return pages.get(name);
}

export function setRouterListener(listener: () => void): void {
  onChange = listener;
}

export function current(): Route | undefined {
  return stack[stack.length - 1];
}

export function stackDepth(): number {
  return stack.length;
}

/** 切换 Tab：重置整个栈。 */
export function switchTab(name: string): void {
  stack = [{ name }];
  onChange();
}

/** 进入详情页。 */
export function navigateTo(name: string, params: Record<string, string> = {}): void {
  stack.push({ name, params });
  onChange();
}

/** 返回上一页；已经在栈底就什么都不做。 */
export function navigateBack(): void {
  if (stack.length <= 1) return;
  stack.pop();
  onChange();
}

/** 替换当前页，不增加栈深度。 */
export function redirectTo(name: string, params: Record<string, string> = {}): void {
  stack[stack.length - 1] = { name, params };
  onChange();
}

/** 重新渲染当前页（数据变了之后调用）。 */
export function reload(): void {
  onChange();
}

export function resetStack(): void {
  stack = [];
}
