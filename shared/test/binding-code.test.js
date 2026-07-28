import test from "node:test";
import assert from "node:assert/strict";
import {
  BINDING_CODE_ALPHABET,
  BINDING_CODE_LENGTH,
  formatBindingCode,
  generateBindingCode,
  generateBindingCodeCandidates,
  isValidBindingCode,
  normalizeBindingCode,
  validateBindingCode,
} from "../dist/index.js";

/** 确定性随机源，让测试可复现 */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test("字符集不含易混字符 I / L / O / U", () => {
  for (const char of "ILOU") {
    assert.equal(BINDING_CODE_ALPHABET.includes(char), false, `不应包含 ${char}`);
  }
  assert.equal(BINDING_CODE_ALPHABET.length, 32);
  // 字符集内无重复
  assert.equal(new Set(BINDING_CODE_ALPHABET).size, 32);
});

test("生成的绑定码长度正确且自校验通过", () => {
  const random = seededRandom(20260726);
  for (let i = 0; i < 500; i += 1) {
    const code = generateBindingCode(random);
    assert.equal(code.length, BINDING_CODE_LENGTH);
    assert.ok(isValidBindingCode(code), `${code} 应该通过校验`);
    for (const char of code) {
      assert.ok(BINDING_CODE_ALPHABET.includes(char), `${code} 含非法字符 ${char}`);
    }
  }
});

test("归一化：大小写、空格、短横、全角都能还原", () => {
  const code = generateBindingCode(seededRandom(7));
  const display = formatBindingCode(code);
  assert.equal(normalizeBindingCode(display), code);
  assert.equal(normalizeBindingCode(display.toLowerCase()), code);
  assert.equal(normalizeBindingCode(`  ${display}  `), code);
  assert.equal(normalizeBindingCode(display.split("").join(" ")), code);
  // 全角输入（中文输入法下很常见）
  const fullWidth = display
    .split("")
    .map((c) => (/[0-9A-Z]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c))
    .join("");
  assert.equal(normalizeBindingCode(fullWidth), code);
});

test("归一化：O→0、I→1、L→1 的手输纠错", () => {
  assert.equal(normalizeBindingCode("O"), "0");
  assert.equal(normalizeBindingCode("I"), "1");
  assert.equal(normalizeBindingCode("l"), "1");
  assert.equal(normalizeBindingCode("oil"), "011");
});

test("展示形式是 4-4 分组", () => {
  const code = generateBindingCode(seededRandom(99));
  const display = formatBindingCode(code);
  assert.match(display, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.equal(display.replace("-", ""), code);
});

test("校验位能抓住单字符错输", () => {
  const random = seededRandom(1234);
  let caught = 0;
  let total = 0;
  for (let i = 0; i < 200; i += 1) {
    const code = generateBindingCode(random);
    for (let pos = 0; pos < code.length; pos += 1) {
      for (const replacement of BINDING_CODE_ALPHABET) {
        if (replacement === code[pos]) continue;
        const broken = code.slice(0, pos) + replacement + code.slice(pos + 1);
        total += 1;
        if (!isValidBindingCode(broken)) caught += 1;
      }
    }
  }
  // 加权模 32 校验位对单字符错输应当 100% 拦截
  assert.equal(caught, total, `单字符错输拦截率应为 100%，实际 ${caught}/${total}`);
});

test("校验位能抓住绝大多数相邻换位", () => {
  const random = seededRandom(555);
  let caught = 0;
  let total = 0;
  for (let i = 0; i < 400; i += 1) {
    const code = generateBindingCode(random);
    for (let pos = 0; pos < code.length - 1; pos += 1) {
      if (code[pos] === code[pos + 1]) continue;
      const swapped =
        code.slice(0, pos) + code[pos + 1] + code[pos] + code.slice(pos + 2);
      total += 1;
      if (!isValidBindingCode(swapped)) caught += 1;
    }
  }
  const rate = caught / total;
  assert.ok(rate > 0.9, `相邻换位拦截率应高于 90%，实际 ${(rate * 100).toFixed(1)}%`);
});

test("非法输入给出具体原因", () => {
  assert.equal(validateBindingCode("").reason, "empty");
  assert.equal(validateBindingCode("ABC").reason, "length");
  // U 不在字符集内，长度对但字符非法
  assert.equal(validateBindingCode("UUUUUUUU").reason, "charset");
  const code = generateBindingCode(seededRandom(3));
  const wrongChecksum =
    code.slice(0, 7) + (code[7] === "0" ? "1" : "0");
  assert.equal(validateBindingCode(wrongChecksum).reason, "checksum");
});

test("批量生成的候选码互不相同", () => {
  const candidates = generateBindingCodeCandidates(50, seededRandom(2026));
  assert.equal(candidates.length, 50);
  assert.equal(new Set(candidates).size, 50);
  for (const code of candidates) {
    assert.ok(isValidBindingCode(code));
  }
});

test("1 万个真随机码的碰撞率可忽略", () => {
  const codes = new Set();
  for (let i = 0; i < 10_000; i += 1) {
    codes.add(generateBindingCode());
  }
  // 32^7 ≈ 3.4e10 的空间里取 1 万个，期望碰撞 < 0.002 个
  assert.ok(codes.size >= 9_999, `碰撞过多，仅剩 ${codes.size} 个不同码`);
});

test("formatBindingCode 对非法值原样返回，不抛错", () => {
  assert.equal(formatBindingCode("ABC"), "ABC");
  assert.equal(formatBindingCode(""), "");
});
