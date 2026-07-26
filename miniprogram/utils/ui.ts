/**
 * 交互小工具。把小程序那几个回调式 API 包成 Promise，
 * 让页面里的业务流程能顺着读下来，而不是层层嵌套回调。
 *
 * 和 H5 的 h5/src/ui.ts 一一对应：confirmDialog / actionSheet / 复制 / 选图。
 */

import { toast } from "./api";

export interface ConfirmOptions {
  title: string;
  /** 正文，可以为空 */
  body?: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作用红色确认按钮，例如停用学员、解除绑定 */
  danger?: boolean;
}

/** 二次确认。返回 true 表示用户点了确认。 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: options.title,
      content: options.body ?? "",
      confirmText: options.confirmText ?? "确定",
      cancelText: options.cancelText ?? "取消",
      confirmColor: options.danger ? "#c0442f" : "#2f5b45",
      cancelColor: "#6b7a6f",
      success: (res: any) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
}

export interface ActionSheetAction {
  label: string;
  /** 回传值，页面据此分支 */
  value: string;
}

/** 底部动作菜单。用户取消返回 null。 */
export function actionSheet(options: {
  title?: string;
  actions: ActionSheetAction[];
}): Promise<string | null> {
  return new Promise((resolve) => {
    wx.showActionSheet({
      alertText: options.title,
      itemList: options.actions.map((item) => item.label),
      success: (res: any) => {
        const picked = options.actions[res.tapIndex];
        resolve(picked ? picked.value : null);
      },
      fail: () => resolve(null),
    });
  });
}

/** 复制到剪贴板。绑定码、学员姓名这类"要抄给别人"的内容都走这里。 */
export function copyText(text: string, tip?: string): void {
  wx.setClipboardData({
    data: text,
    success: () => toast(tip ?? `已复制 ${text}`, "success"),
    fail: () => toast(`复制失败，内容是：${text}`),
  });
}

/**
 * 选一张图并转成 data URI。
 *
 * 为什么转 base64 而不是传 fileId：后端是本项目自带的 Node 服务，
 * 没有接微信云存储，接口契约里 image 字段收的就是 dataURL（见 shared/src/types.ts）。
 * 压缩交给 sizeType: ["compressed"]，避免家长随手拍的 4MB 原图撑爆请求体。
 */
export function chooseImageDataUri(): Promise<string | null> {
  return new Promise((resolve) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (res: any) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) {
          resolve(null);
          return;
        }
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: "base64",
          success: (readRes: any) => {
            // 统一按 jpeg 声明：压缩后微信给的就是 jpg，个别 png 也能被浏览器/服务端正确解码
            resolve(`data:image/jpeg;base64,${readRes.data}`);
          },
          fail: () => {
            toast("读取图片失败，请换一张试试");
            resolve(null);
          },
        });
      },
      fail: () => resolve(null),
    });
  });
}

/** 页面级 loading 遮罩。用于提交类操作，避免用户连点两次。 */
export function showBusy(title = "处理中…"): void {
  wx.showLoading({ title, mask: true });
}

export function hideBusy(): void {
  wx.hideLoading();
}
