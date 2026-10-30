import test from "node:test";
import assert from "node:assert/strict";
import { seal, open, passwordKey } from "../shared/src/lib/encryption.js";
const password = "test-only random words for encryption";
test("authenticated encryption roundtrip, wrong password, tamper and purpose binding", async () => {
  const f = await seal({ hexSeed: "fixture" }, password, "wallet");
  assert.deepEqual(await open(f, password, "wallet"), { hexSeed: "fixture" });
  await assert.rejects(open(f, "incorrect password", "wallet"));
  await assert.rejects(
    open(
      {
        ...f,
        ciphertext:
          (f.ciphertext[0] === "0" ? "1" : "0") + f.ciphertext.slice(1),
      },
      password,
      "wallet",
    ),
  );
  await assert.rejects(open(f, password, "vault"));
  const g = await seal({ hexSeed: "fixture" }, password, "wallet");
  assert.notEqual(f.iv, g.iv);
  assert.notEqual(f.kdf.salt, g.kdf.salt);
});
test("reject hostile KDF before expensive allocation", async () => {
  await assert.rejects(
    passwordKey(password, {
      name: "scrypt",
      n: 2 ** 30,
      r: 8,
      p: 1,
      salt: "00".repeat(32),
    }),
  );
  await assert.rejects(
    passwordKey(password, {
      name: "scrypt",
      n: 65536,
      r: 8,
      p: 100000,
      salt: "00".repeat(32),
    }),
  );
});
