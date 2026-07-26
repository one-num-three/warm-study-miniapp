/** 极简 DOM 构建工具。不引框架，保持和小程序端一样的"手写视图"心智。 */

type Child = Node | string | number | null | undefined | false | Child[];

export interface Attrs {
  class?: string;
  id?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  maxlength?: number;
  src?: string;
  alt?: string;
  href?: string;
  rows?: number;
  inputmode?: string;
  autocomplete?: string;
  style?: string;
  dataset?: Record<string, string>;
  onClick?: (event: MouseEvent) => void;
  onInput?: (event: Event) => void;
  onChange?: (event: Event) => void;
  onKeydown?: (event: KeyboardEvent) => void;
  [key: string]: unknown;
}

function append(parent: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const item of child) append(parent, item);
    return;
  }
  if (child instanceof Node) {
    parent.appendChild(child);
    return;
  }
  parent.appendChild(document.createTextNode(String(child)));
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "dataset") {
      Object.assign(node.dataset, value as Record<string, string>);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(
        key.slice(2).toLowerCase(),
        value as EventListenerOrEventListenerObject,
      );
    } else if (key === "class") {
      node.className = String(value);
    } else if (key === "value" && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
      node.value = String(value);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
  append(node, children);
  return node;
}

export const div = (attrs: Attrs = {}, ...children: Child[]) => el("div", attrs, ...children);
export const span = (attrs: Attrs = {}, ...children: Child[]) => el("span", attrs, ...children);
export const p = (attrs: Attrs = {}, ...children: Child[]) => el("p", attrs, ...children);
export const strong = (attrs: Attrs = {}, ...children: Child[]) => el("strong", attrs, ...children);
export const button = (attrs: Attrs = {}, ...children: Child[]) => el("button", attrs, ...children);

/** 快捷卡片 */
export function card(title: Child, ...children: Child[]): HTMLElement {
  return div(
    { class: "card" },
    title ? div({ class: "card__title" }, title) : null,
    ...children,
  );
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(node: HTMLElement, ...children: Child[]): void {
  clear(node);
  append(node, children);
}

/** 内联 SVG 图标。design.md §4.5 明确禁止用 emoji 当功能图标。 */
export function icon(path: string, className = "tabbar__icon"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", className);
  const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
  node.setAttribute("d", path);
  svg.appendChild(node);
  return svg;
}
