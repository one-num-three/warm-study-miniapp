/**
 * 微信小程序 API 的兜底类型声明。
 *
 * 为什么要手写这个文件：官方类型包 miniprogram-api-typings 需要联网安装，
 * 本仓库在离线环境里构建，装不上就会让整个工程编译不过。
 * 与其被类型问题卡住，不如给出一份"能过编译、不误导人"的最小声明 ——
 * 全部标成 any，保证 IDE 不报错，同时不假装提供并不存在的类型安全。
 *
 * 联网后想要真正的类型提示：
 *   npm i -D miniprogram-api-typings
 * 然后删掉本文件，并把 tsconfig.json 的 "types" 改成 ["miniprogram-api-typings"]。
 */

/** 全局 wx 命名空间。真实签名以官方文档为准。 */
declare const wx: any;

/** 小程序全局注册函数。 */
declare function App<T = any>(options: T & Record<string, any>): void;
declare function Page<T = any>(options: T & Record<string, any>): void;
declare function Component<T = any>(options: T & Record<string, any>): void;
declare function Behavior<T = any>(options: T & Record<string, any>): any;

/** 取到 App 实例。业务里统一写成 getApp<IAppInstance>()。 */
declare function getApp<T = any>(opts?: { allowDefault?: boolean }): T;

/** 当前页面栈，退栈刷新时会用到。 */
declare function getCurrentPages(): any[];

/** 定时器（小程序里是全局函数，不在 window 上）。 */
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearTimeout(handle?: number): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): number;
declare function clearInterval(handle?: number): void;

/** utils/api.ts 里引用了这个命名空间，这里给出最小声明。 */
declare namespace WechatMiniprogram {
  type IAnyObject = Record<string, any>;
  type Page = any;
  type Component = any;
}

/** 允许 import 一个没有类型声明的 .js 共享模块（miniprogram/shared 是自动生成的纯 JS）。 */
declare module "*.js";
