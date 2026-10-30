import test from "node:test";
import assert from "node:assert/strict";
import {
  base85Encode,
  base85Decode,
  checksum,
  parseFrame,
  encodeAck,
  parseAck,
  formatQuanta,
} from "../shared/src/lib/airgap-v1.js";
import {
  Receiver,
  encodeMessage,
  validateUnsignedTx,
} from "../shared/src/lib/protocol.js";
import { MLDSA87 } from "@theqrl/wallet.js";
import { signTransaction, TransactionFactory } from "@theqrl/web3-qrl-accounts";
const a = "Q" + "11".repeat(64),
  b = "Q" + "22".repeat(64),
  wallet = {
    address: a,
    addressHexLength: 128,
    chainIds: new Set([0x7e7en]),
  };
const tx = () => ({
  from: a,
  to: b,
  value: "0x1",
  type: "0x2",
  chainId: "0x7e7e",
  nonce: "0x0",
  gasLimit: "0x5208",
  maxFeePerGas: "0x2",
  maxPriorityFeePerGas: "0x1",
});
const msg = () => ({
  type: "qrl-unsigned-tx",
  version: 1,
  operation: "transfer",
  tx: tx(),
});
test("Base85 published fixtures and rejection", () => {
  for (const [s, e] of [
    ["", ""],
    ["a", "VE"],
    ["ab", "VPX"],
    ["abc", "VPaz"],
    ["abcd", "VPa!s"],
    ["Hello", "NM&qnZv"],
  ]) {
    assert.equal(base85Encode(new TextEncoder().encode(s)), e);
    assert.equal(new TextDecoder().decode(base85Decode(e)), s);
  }
  for (const bad of ["~~~~~", "VPa!sW", '"'])
    assert.throws(() => base85Decode(bad));
});
test("checksum fixtures", async () => {
  assert.equal(await checksum("hello"), "5");
  assert.equal(await checksum("hello", false), "2CF24DBA");
  assert.equal(await checksum("12345"), "1");
  assert.equal(await checksum("abc"), "0");
});
test("receiver ordering, duplicates, session conflict, bounds and completeness", async () => {
  const frames = await encodeMessage({ ...msg(), padding: "x".repeat(2000) });
  const r = new Receiver();
  assert.throws(() => r.message());
  assert.equal(await r.offer(frames[0]), "stored");
  assert.equal(await r.offer(frames[0]), "duplicate");
  const other = JSON.parse(frames[0]);
  other.s = "AAAAAAAAAAAAAAAA";
  assert.equal(await r.offer(JSON.stringify(other)), "conflict");
  for (const f of frames.slice(1).reverse()) await r.offer(f);
  assert.equal(r.message().padding.length, 2000);
  for (const mutate of [
    { t: 1000 },
    { p: 0 },
    { e: "64" },
    { n: 0 },
    { c: "X" },
    { s: "abc" },
    { a: 1 },
    { v: 1 },
  ])
    assert.equal(
      await parseFrame(JSON.stringify({ ...JSON.parse(frames[0]), ...mutate })),
      null,
    );
});
test("signer rejects unsupported or malformed intent", () => {
  for (const change of [
    (t) => delete t.to,
    (t) => (t.accessList = []),
    (t) => (t.from = b),
    (t) => (t.chainId = "0x1"),
    (t) => (t.value = "0x00de"),
    (t) => (t.value = 12),
    (t) => (t.maxFeePerGas = "0x0"),
    (t) => (t.to = "q" + b.slice(1)),
    (t) => (t.gasLimit = 100),
  ]) {
    const m = msg();
    change(m.tx);
    assert.throws(() => validateUnsignedTx(m, wallet));
  }
  assert.throws(() => validateUnsignedTx({ ...msg(), extra: 1 }, wallet));
  assert.throws(() =>
    validateUnsignedTx({ ...msg(), type: "zond-unsigned-tx" }, wallet),
  );
  assert.throws(() => validateUnsignedTx({ ...msg(), version: 2 }, wallet));
  assert.throws(() =>
    validateUnsignedTx(msg(), { ...wallet, addressHexLength: 40 }),
  );
});
test("unsigned requests require explicit intent and reject other versions", () => {
  const { operation, ...withoutOperation } = msg();
  assert.throws(() => validateUnsignedTx(withoutOperation, wallet));
  for (const version of [0, 2, 3, "1", null])
    assert.throws(() => validateUnsignedTx({ ...msg(), version }, wallet));
  assert.throws(() =>
    validateUnsignedTx({ ...msg(), operation: "call" }, wallet),
  );
});
test("deployment explicitness and operation consistency", () => {
  const m = {
    ...msg(),
    version: 1,
    operation: "deploy",
    tx: { ...tx(), to: null, data: "0x60006000", gasLimit: "0x186a0" },
  };
  const v = validateUnsignedTx(m, wallet);
  assert.equal(v.operation, "deploy");
  assert.equal(v.toSign.to, undefined);
  assert.equal(v.display.to, null);
  assert.throws(() =>
    validateUnsignedTx({ ...m, tx: { ...m.tx, to: undefined } }, wallet),
  );
  assert.throws(() =>
    validateUnsignedTx({ ...m, operation: "transfer" }, wallet),
  );
  assert.throws(() =>
    validateUnsignedTx({ ...m, tx: { ...m.tx, data: "0x" } }, wallet),
  );
});
test("ACK strict session and high bits", () => {
  const text = encodeAck([1, 3], 3, "AAAAAAAAAAAAAAAA");
  assert.deepEqual([...parseAck(text, 3, "AAAAAAAAAAAAAAAA")], [1, 3]);
  assert.equal(parseAck(text, 3, "BBBBBBBBBBBBBBBB"), null);
  assert.equal(parseAck(text.replace("05", "85"), 3, "AAAAAAAAAAAAAAAA"), null);
});
test("exact amounts above Number precision", () =>
  assert.equal(formatQuanta(9007199254740993n), "0.009007199254740993 Quanta"));
test("real ML-DSA signature through QR for transfer, call and deploy", async () => {
  const w = MLDSA87.newWallet();
  const address = w.getAddressStr();
  for (const operation of ["transfer", "call", "deploy"]) {
    const input = {
      type: "qrl-unsigned-tx",
      version: 1,
      operation,
      tx: {
        ...tx(),
        from: address,
        to: operation === "deploy" ? null : b,
        data: operation === "transfer" ? "0x" : "0x60006000",
        gasLimit: "0x186a0",
      },
    };
    const r = new Receiver();
    for (const f of await encodeMessage(input)) await r.offer(f);
    const v = validateUnsignedTx(r.message(), { ...wallet, address });
    const signed = await signTransaction(
      TransactionFactory.fromTxData(v.toSign),
      w.getHexExtendedSeed(),
    );
    const rx = new Receiver();
    for (const f of (
      await encodeMessage({
        type: "qrl-signed-tx",
        version: 1,
        rawTransaction: signed.rawTransaction,
      })
    ).reverse())
      await rx.offer(f);
    const raw = Uint8Array.from(
      rx.message().rawTransaction.slice(2).match(/../g),
      (x) => parseInt(x, 16),
    );
    const parsed = TransactionFactory.fromSerializedData(raw);
    assert.equal(parsed.verifySignature(), true);
    assert.equal(
      String(parsed.getSenderAddress()).toLowerCase(),
      address.toLowerCase(),
    );
    assert.equal(parsed.value, 1n);
    if (operation === "deploy") assert.equal(parsed.to, undefined);
  }
});
