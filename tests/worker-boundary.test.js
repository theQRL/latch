import test from "node:test";
import assert from "node:assert/strict";
import { ref, reactive } from "vue";
import {
  workerPayload,
  vaultCall,
  stopVault,
} from "../shared/src/lib/vault-client.js";
import { Receiver, encodeMessage } from "../shared/src/lib/protocol.js";

test("worker boundary snapshots nested Vue proxies and preserves PRF bytes", () => {
  const stored = ref({ header: { version: 1 } });
  const form = reactive({ file: reactive({ ciphertext: "encrypted" }) });
  const prf = new Uint8Array([1, 2, 3]);
  const payload = workerPayload({ encrypted: stored.value, ...form, prf });
  const copy = structuredClone(payload);
  assert.deepEqual(copy, {
    encrypted: { header: { version: 1 } },
    file: { ciphertext: "encrypted" },
    prf,
  });
});

test("worker calls accept reactive payloads and recover from a synchronous clone failure", async () => {
  globalThis.Worker = class {
    postMessage(message) {
      const copy = structuredClone(message);
      queueMicrotask(() =>
        this.onmessage({ data: { id: copy.id, result: copy.payload } }),
      );
    }
    terminate() {}
  };
  try {
    await assert.rejects(vaultCall("invalid", { callback() {} }), {
      name: "DataCloneError",
    });
    assert.deepEqual(
      await vaultCall("unlock", {
        encrypted: ref({ data: "ciphertext" }).value,
      }),
      { encrypted: { data: "ciphertext" } },
    );
  } finally {
    stopVault();
    delete globalThis.Worker;
  }
});

test("reset discards a frame still awaiting digest verification", async () => {
  const encoded = await encodeMessage({ type: "test", version: 1 });
  const rx = new Receiver();
  const pending = rx.offer(encoded[0]);
  rx.reset();
  assert.equal(await pending, "ignored");
  assert.equal(rx.pages.size, 0);
  assert.equal(rx.session, null);
});
