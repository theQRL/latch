import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { ref, computed } from "vue";
import { isAppleMobileBrowser } from "../shared/src/lib/device-unlock.js";
import {
  installedContext,
  canInitializeVault,
} from "../shared/src/lib/install-context.js";
import {
  Receiver,
  encodeAck,
  encodeMessage,
} from "../shared/src/lib/protocol.js";

// Execute the component's setup with browser boundaries controlled by the test.
async function setup(file, bindings, exports) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const script = source
    .split("<script setup>")[1]
    .split("</script>")[0]
    .replace(/^import[\s\S]*?;\n/gm, "");
  return vm.runInNewContext(`${script}\n;({${exports}})`, {
    ref,
    computed,
    useScreenAwake: () => ({
      screenAwake: ref("inactive"),
      retryScreenAwake: () => {},
    }),
    isAppleMobileBrowser,
    installedContext,
    canInitializeVault,
    crypto,
    AbortController,
    ...bindings,
  });
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test("camera acquired after unmount is stopped on its original instance", async () => {
  const permission = deferred();
  const prompts = [];
  let unmount, instance;
  class Camera {
    constructor() {
      instance = this;
      this.isScanning = false;
    }
    async start() {
      assert.deepEqual(prompts, ["prompt-start"]);
      await permission.promise;
      this.isScanning = true;
    }
    async stop() {
      this.isScanning = false;
      this.stopped = true;
    }
    clear() {
      this.cleared = true;
    }
  }
  const component = await setup(
    "../shared/src/components/QrReader.vue",
    {
      Html5Qrcode: Camera,
      Receiver,
      encodeAck,
      QRCode: {},
      defineEmits: () => (event) => prompts.push(event),
      defineProps: () => ({}),
      onBeforeUnmount: (callback) => {
        unmount = callback;
      },
    },
    "start, stop",
  );
  const pending = component.start();
  unmount();
  permission.resolve();
  await pending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(instance.stopped, true);
  assert.equal(instance.cleared, true);
  assert.equal(instance.isScanning, false);
  assert.deepEqual(prompts, ["prompt-start", "prompt-end"]);
});

for (const native of [false, true])
  test(`a late ${native ? "native biometric" : "browser device"} result cannot recreate the worker after locking`, async () => {
    const authentication = deferred();
    const calls = [];
    const timers = new Map();
    let timer = 0;
    const document = { hidden: false };
    const component = await setup(
      "../shared/src/App.vue",
      {
        __BUILD_ID__: "test",
        __LATCH_DEV_BUILD__: false,
        readLifecycle: async () => ({
          phase: "sealed",
          epoch: "test",
          values: {},
        }),
        isNative: native,
        nativeBiometrics: {
          unlock: () => authentication.promise,
          cancel: async () => {},
        },
        nativeBuild: false,
        cacheStatus: async () => ({ complete: true, total: 1, cached: 1 }),
        persistenceStatus: async () => "granted",
        navigator: { onLine: false },
        document,
        matchMedia: () => ({ matches: false }),
        onMounted() {},
        onBeforeUnmount() {},
        setTimeout(fn) {
          timers.set(++timer, fn);
          return timer;
        },
        clearTimeout(id) {
          timers.delete(id);
        },
        unlockDevice: () => authentication.promise,
        stopVault() {},
        vaultCall: (...args) => {
          calls.push(args);
        },
      },
      "deviceOpen, lock, ready, beginSystemPrompt, endSystemPrompt, visibility, unlocked, stored",
    );
    component.stored.value = { fixture: "encrypted existing vault" };
    component.ready.value = true;
    const pending = component.deviceOpen();
    await new Promise((resolve) => setImmediate(resolve));
    component.lock();
    const prf = new Uint8Array([3, 4, 5]);
    authentication.resolve(prf);
    await pending;
    assert.equal(calls.length, 0);
    assert.deepEqual(prf, new Uint8Array(3));
    component.unlocked.value = true;
    component.beginSystemPrompt();
    document.hidden = true;
    component.visibility();
    assert.equal(component.unlocked.value, true);
    assert.equal(timers.size, 1);
    component.endSystemPrompt();
    assert.equal(component.unlocked.value, true);
    assert.equal(timers.size, 1);
    [...timers.values()][0]();
    assert.equal(component.unlocked.value, false);
  });

// A rejected payload leaves the reader mounted; restarting must accept a new session.
test("completed camera transfer resets before a retry", async () => {
  const received = [];
  const component = await setup(
    "../shared/src/components/QrReader.vue",
    {
      Html5Qrcode: class {},
      Receiver,
      encodeAck,
      QRCode: {},
      defineEmits: () => (event, payload) => received.push(payload),
      defineProps: () => ({}),
      onBeforeUnmount() {},
    },
    "accept",
  );
  for (const value of ["rejected", "corrected"]) {
    const frames = await encodeMessage({ type: value });
    for (const frame of frames) await component.accept(frame);
  }
  assert.deepEqual(received, [{ type: "rejected" }, { type: "corrected" }]);
});
