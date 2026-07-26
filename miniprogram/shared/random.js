/**
 * 与平台无关的安全随机。
 * Node（globalThis.crypto）、浏览器、微信小程序基础库都提供 crypto.getRandomValues，
 * 只有在都拿不到时才退化到 Math.random —— 这里不引入 DOM / Node 类型依赖。
 */
function cryptoObject() {
    return globalThis.crypto;
}
/** 返回 [0, 1) 的随机浮点数。 */
export function secureRandomFloat() {
    const api = cryptoObject();
    if (api?.getRandomValues) {
        const buffer = new Uint32Array(1);
        api.getRandomValues(buffer);
        return buffer[0] / 0x1_0000_0000;
    }
    return Math.random();
}
/** 返回 [0, max) 的随机整数。 */
export function secureRandomInt(max) {
    if (max <= 0)
        return 0;
    return Math.floor(secureRandomFloat() * max) % max;
}
//# sourceMappingURL=random.js.map