import test from "node:test";
import assert from "node:assert/strict";
import { createScreenAwake } from "../shared/src/lib/screen-awake.js";
function environment(request) {
  const document = new EventTarget();
  document.visibilityState = "visible";
  let status;
  const manager = createScreenAwake({
    request,
    document,
    onStatus: (v) => (status = v),
  });
  return { manager, document, status: () => status };
}
function lock() {
  const sentinel = new EventTarget();
  sentinel.released = false;
  sentinel.release = async () => {
    sentinel.released = true;
    sentinel.dispatchEvent(new Event("release"));
  };
  return sentinel;
}
test("wake lock is shared and released only when the last transfer closes", async () => {
  let requests = 0;
  const sentinel = lock();
  const { manager, status } = environment(async () => {
    requests++;
    return sentinel;
  });
  const stopA = manager.acquire(),
    stopB = manager.acquire();
  await manager.settled();
  assert.equal(requests, 1);
  assert.equal(status(), "active");
  await stopA();
  assert.equal(sentinel.released, false);
  await stopB();
  assert.equal(sentinel.released, true);
  assert.equal(status(), "inactive");
});
test("closing a transfer during acquisition releases the late lock", async () => {
  let resolve;
  const sentinel = lock();
  const { manager, status } = environment(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const stop = manager.acquire();
  await Promise.resolve();
  const stopped = stop();
  resolve(sentinel);
  await stopped;
  assert.equal(sentinel.released, true);
  assert.equal(status(), "inactive");
});
test("hidden pages release the lock and visible transfers request a fresh lock", async () => {
  const locks = [];
  const { manager, document } = environment(async () => {
    const s = lock();
    locks.push(s);
    return s;
  });
  const stop = manager.acquire();
  await manager.settled();
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  await manager.settled();
  assert.equal(locks[0].released, true);
  document.visibilityState = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  await manager.settled();
  assert.equal(locks.length, 2);
  await stop();
  assert.equal(locks[1].released, true);
});
test("OS rejection or revocation exposes fallback without retry loops", async () => {
  let calls = 0;
  const sentinel = lock();
  const { manager, status } = environment(async () => {
    if (++calls === 1) throw Error("denied");
    return sentinel;
  });
  const stop = manager.acquire();
  await manager.settled();
  assert.equal(status(), "unavailable");
  await manager.retry();
  assert.equal(status(), "active");
  await sentinel.release();
  assert.equal(status(), "unavailable");
  assert.equal(calls, 2);
  await stop();
  assert.equal(status(), "inactive");
});
