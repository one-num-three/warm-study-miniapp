/** 轻提示、确认框、底部动作面板。对应小程序的 wx.showToast / showModal / 自定义弹层。 */

import { ApiError } from "./api.js";
import { button, div, el, mount, p } from "./dom.js";

let toastTimer: number | undefined;

export function toast(message: string, variant: "info" | "error" = "info", ms = 2000): void {
  document.querySelectorAll(".toast").forEach((node) => node.remove());
  const node = div({ class: variant === "error" ? "toast toast--error" : "toast" }, message);
  document.body.appendChild(node);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.remove(), ms);
}

/** 把接口异常翻译成一句人话弹出来。 */
export function toastError(error: unknown): void {
  if (error instanceof ApiError) {
    toast(error.message, "error", 2600);
    return;
  }
  console.error(error);
  toast("操作没有成功，请稍后重试", "error");
}

function overlay(className: string, content: HTMLElement, onClose?: () => void): () => void {
  const mask = div({ class: className });
  mask.appendChild(content);
  mask.addEventListener("click", (event) => {
    if (event.target === mask) {
      mask.remove();
      onClose?.();
    }
  });
  document.body.appendChild(mask);
  return () => mask.remove();
}

export function confirmDialog(options: {
  title: string;
  body?: string;
  /** 需要显眼展示的一串码（绑定码），会用等宽大字单独排一行 */
  code?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let close = () => {};
    const dialog = div(
      { class: "dialog" },
      el("h3", { class: "dialog__title" }, options.title),
      options.code
        ? div(
            { class: "code-plate", style: "justify-content:center;margin:4px 0 12px" },
            div({ class: "code-plate__code", dataset: { role: "dialog-code" } }, options.code),
          )
        : null,
      options.body ? p({ class: "dialog__body" }, options.body) : null,
      div(
        { class: "btn-row" },
        button(
          {
            class: "btn btn--ghost",
            style: "flex:1",
            onClick: () => {
              close();
              resolve(false);
            },
          },
          options.cancelText ?? "取消",
        ),
        button(
          {
            class: options.danger ? "btn btn--danger" : "btn btn--primary",
            style: "flex:1",
            onClick: () => {
              close();
              resolve(true);
            },
          },
          options.confirmText ?? "确定",
        ),
      ),
    );
    close = overlay("mask mask--center", dialog, () => resolve(false));
  });
}

export interface SheetField {
  name: string;
  label: string;
  type?: "text" | "number" | "textarea" | "select" | "password" | "image";
  placeholder?: string;
  value?: string;
  hint?: string;
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
  maxlength?: number;
}

/**
 * 底部弹出的表单面板。返回 null 表示用户取消。
 * 图片类型走浏览器本地读取转 dataURL —— 和小程序的 wx.chooseMedia 对应。
 */
export function formSheet(options: {
  title: string;
  fields: SheetField[];
  submitText?: string;
  hint?: string;
}): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    let close = () => {};
    const values: Record<string, string> = {};
    const errorNode = p({ class: "field__error", style: "display:none" });

    const controls = options.fields.map((field) => {
      values[field.name] = field.value ?? "";
      let control: HTMLElement;

      if (field.type === "textarea") {
        control = el("textarea", {
          placeholder: field.placeholder ?? "",
          value: field.value ?? "",
          maxlength: field.maxlength ?? 300,
          onInput: (event) => {
            values[field.name] = (event.target as HTMLTextAreaElement).value;
          },
        });
      } else if (field.type === "select") {
        const select = el("select", {
          onChange: (event) => {
            values[field.name] = (event.target as HTMLSelectElement).value;
          },
        });
        for (const option of field.options ?? []) {
          const node = el("option", { value: option.value }, option.label);
          if (option.value === field.value) node.selected = true;
          select.appendChild(node);
        }
        values[field.name] = field.value ?? field.options?.[0]?.value ?? "";
        control = select;
      } else if (field.type === "image") {
        const preview = el("img", { class: "thumb", style: "display:none" });
        const input = el("input", { type: "file", accept: "image/*" });
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = String(reader.result);
            values[field.name] = dataUrl;
            preview.src = dataUrl;
            preview.style.display = "block";
          };
          reader.readAsDataURL(file);
        });
        control = div({}, input, preview);
      } else {
        control = el("input", {
          type: field.type ?? "text",
          placeholder: field.placeholder ?? "",
          value: field.value ?? "",
          maxlength: field.maxlength ?? 60,
          ...(field.type === "number" ? { inputmode: "numeric" } : {}),
          onInput: (event) => {
            values[field.name] = (event.target as HTMLInputElement).value;
          },
        });
      }

      return div(
        { class: "field" },
        el("label", { class: "field__label" }, field.label, field.required ? " *" : ""),
        control,
        field.hint ? p({ class: "field__hint" }, field.hint) : null,
      );
    });

    const sheet = div(
      { class: "sheet" },
      el("h3", { class: "sheet__title" }, options.title),
      options.hint ? p({ class: "card__hint", style: "margin-bottom:12px" }, options.hint) : null,
      ...controls,
      errorNode,
      div(
        { class: "btn-row", style: "margin-top:6px" },
        button(
          {
            class: "btn btn--ghost",
            style: "flex:1",
            onClick: () => {
              close();
              resolve(null);
            },
          },
          "取消",
        ),
        button(
          {
            class: "btn btn--primary",
            style: "flex:2",
            onClick: () => {
              const missing = options.fields.find(
                (field) => field.required && !String(values[field.name] ?? "").trim(),
              );
              if (missing) {
                errorNode.textContent = `请填写「${missing.label}」`;
                errorNode.style.display = "block";
                return;
              }
              close();
              resolve(values);
            },
          },
          options.submitText ?? "提交",
        ),
      ),
    );

    close = overlay("mask", sheet, () => resolve(null));
  });
}

/** 一组按钮的底部选择面板。 */
export function actionSheet(options: {
  title: string;
  actions: Array<{ label: string; value: string; danger?: boolean; hint?: string }>;
}): Promise<string | null> {
  return new Promise((resolve) => {
    let close = () => {};
    const sheet = div(
      { class: "sheet" },
      el("h3", { class: "sheet__title" }, options.title),
      div(
        { class: "stack" },
        ...options.actions.map((action) =>
          button(
            {
              class: action.danger ? "btn btn--danger btn--block" : "btn btn--block",
              onClick: () => {
                close();
                resolve(action.value);
              },
            },
            action.label,
          ),
        ),
        button(
          {
            class: "btn btn--ghost btn--block",
            onClick: () => {
              close();
              resolve(null);
            },
          },
          "取消",
        ),
      ),
    );
    close = overlay("mask", sheet, () => resolve(null));
  });
}

/** 页面级 loading 占位。 */
export function loading(container: HTMLElement, text = "加载中…"): void {
  mount(container, div({ class: "loading" }, text));
}

export function emptyState(text: string): HTMLElement {
  return div({ class: "empty" }, text);
}
