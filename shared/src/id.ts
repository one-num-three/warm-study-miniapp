/** 与平台无关的 ID 生成。服务端、H5、小程序都能用。 */

import { secureRandomInt } from "./random.js";

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * 形如 `stu_lz4k9x2m7q` 的可读 ID：前缀标明类型，
 * 时间戳部分保证大致有序（利于按主键排序和排查问题）。
 */
export function newId(prefix: string): string {
  const stamp = Date.now().toString(36);
  let random = "";
  for (let i = 0; i < 6; i += 1) {
    random += ID_ALPHABET[secureRandomInt(ID_ALPHABET.length)];
  }
  return `${prefix}_${stamp}${random}`;
}

/** 客户端生成的请求 ID，服务端据此做幂等拦截。 */
export function newRequestId(): string {
  return newId("req");
}
