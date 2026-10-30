import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChainId } from "../shared/src/lib/network.js";
test("chain IDs normalize decimal and hexadecimal without numeric precision loss", () => {
  assert.equal(normalizeChainId(" 4242 "), "0x1092");
  assert.equal(normalizeChainId("0X00Ab"), "0xab");
  assert.equal(normalizeChainId("18446744073709551615"), "0xffffffffffffffff");
  assert.equal(normalizeChainId("9007199254740993"), "0x20000000000001");
});
test("chain IDs reject empty, zero, negative, malformed and oversized inputs", () => {
  for (const value of [
    "",
    " ",
    "0",
    "0x0",
    "-1",
    "+1",
    "01",
    "1.5",
    "1e3",
    "0x",
    "0xgg",
    "18446744073709551616",
    "0x10000000000000000",
    "9".repeat(1000),
    4242,
    null,
  ])
    assert.throws(() => normalizeChainId(value));
});
