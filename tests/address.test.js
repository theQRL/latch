import test from "node:test";
import assert from "node:assert/strict";
import { toChecksumAddress } from "@theqrl/wallet.js";
import { validateQrlAddress } from "../shared/src/lib/address.js";
import { validateUnsignedTx } from "../shared/src/lib/protocol.js";
// Shared wallet.js / go-qrllib parity vector, not a user wallet.
const lower =
  "Qd5812f6cf4a0f645aa620cd57319a0ed649dd8f5519a9dde7770ae5b0e49e547985f35eb972a2a07041561aa39c65a3991478f9b1e6749e05277dcf58a9a8b72";
const checked =
  "Qd5812F6Cf4a0f645aa620cd57319a0Ed649dd8f5519A9dde7770ae5b0E49e547985f35eB972A2a07041561aa39c65A3991478f9B1e6749e05277dcf58A9A8B72";
const bad = checked.slice(0, 1) + "D" + checked.slice(2);
test("QRL checksum agrees with the cross-library SHAKE-256 vector", () => {
  assert.equal(toChecksumAddress(lower), checked);
  assert.equal(validateQrlAddress(lower), lower);
  assert.equal(validateQrlAddress(checked), checked);
  assert.equal(validateQrlAddress("Q" + "0".repeat(128)).length, 129);
  for (const value of [
    bad,
    lower.toUpperCase(),
    "q" + lower.slice(1),
    "0x" + lower.slice(1),
    lower.slice(1),
    "Q" + "ab".repeat(20),
    "Q" + "ab".repeat(65),
  ])
    assert.throws(() => validateQrlAddress(value));
});
test("sender, recipient and wallet checksum are checked before comparison or signing", () => {
  const wallet = {
    address: lower,
    addressHexLength: 128,
    chainIds: new Set([1n]),
  };
  const msg = {
    type: "qrl-unsigned-tx",
    version: 1,
    operation: "transfer",
    tx: {
      from: checked,
      to: checked,
      value: "0x0",
      gasLimit: "0x5208",
      type: "0x2",
      chainId: "0x1",
      nonce: "0x0",
      maxFeePerGas: "0x2",
      maxPriorityFeePerGas: "0x1",
      data: "0x",
    },
  };
  assert.equal(validateUnsignedTx(msg, wallet).display.from, checked);
  for (const key of ["from", "to"])
    for (const value of [bad, lower.toUpperCase(), "Q" + "ab".repeat(20)])
      assert.throws(() =>
        validateUnsignedTx({ ...msg, tx: { ...msg.tx, [key]: value } }, wallet),
      );
  assert.throws(() => validateUnsignedTx(msg, { ...wallet, address: bad }));
  assert.throws(() =>
    validateUnsignedTx(msg, { ...wallet, addressHexLength: 40 }),
  );
  const deploy = {
    ...msg,
    operation: "deploy",
    tx: { ...msg.tx, to: null, data: "0x6000" },
  };
  assert.equal(validateUnsignedTx(deploy, wallet).display.to, null);
});
