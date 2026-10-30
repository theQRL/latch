import test from "node:test";
import assert from "node:assert/strict";
import {
  preparePwa,
  persistenceStatus,
  cacheStatus,
} from "../shared/src/lib/installation.js";
test("persistence distinguishes granted, declined, unsupported and failed requests", async () => {
  assert.equal(await persistenceStatus(null, true), "unsupported");
  assert.equal(
    await persistenceStatus(
      {
        persisted: async () => true,
        persist: () => {
          throw Error("must not prompt");
        },
      },
      true,
    ),
    "granted",
  );
  assert.equal(
    await persistenceStatus(
      { persisted: async () => false, persist: async () => true },
      true,
    ),
    "granted",
  );
  assert.equal(
    await persistenceStatus(
      { persisted: async () => false, persist: async () => false },
      true,
    ),
    "not-granted",
  );
  assert.equal(
    await persistenceStatus(
      {
        persisted: async () => {
          throw Error("blocked");
        },
      },
      true,
    ),
    "unavailable",
  );
});
const controller = (response) => ({
  postMessage: (_message, ports) => ports[0].postMessage(response),
});
test("cache checks reject missing files, version skew, and timeouts", async () => {
  const good = {
    type: "LATCH_CACHE_STATUS",
    buildId: "a",
    total: 3,
    cached: 3,
    complete: true,
  };
  assert.equal((await cacheStatus(controller(good), "a")).cached, 3);
  await assert.rejects(
    cacheStatus(controller({ ...good, cached: 2, complete: false }), "a"),
    /missing/,
  );
  await assert.rejects(cacheStatus(controller(good), "b"), /different builds/);
  await assert.rejects(cacheStatus(null, "a"), /not controlling/);
  await assert.rejects(cacheStatus({ postMessage() {} }, "a", 20), /timed out/);
});

const never = () => new Promise(() => {});
test("offline preparation reports each phase and bounds every browser wait", async () => {
  for (const blocked of ['getRegistration','register','ready','controller']) {
    let removed=0;
    const sw={getRegistration:async()=>null,register:async()=>({}),ready:Promise.resolve(),controller:{},addEventListener(){},removeEventListener(){removed++;}};
    if(blocked==='ready') sw.ready=never();
    else if(blocked==='controller') sw.controller=null;
    else sw[blocked]=never;
    await assert.rejects(preparePwa(sw,{timeout:10}), /browser did not respond|download did not finish|timed out|reopen/);
    if(blocked==='controller') assert.equal(removed,1);
  }
  const phases=[];
  await preparePwa({getRegistration:async()=>({active:{}}),ready:Promise.resolve(),controller:{}},{onProgress:phase=>phases.push(phase)});
  assert.equal(phases.length,3);
  assert.match(phases.at(-1),/every required/);
});
test("a stalled storage API cannot leave installation preparation pending",async()=>{
  assert.equal(await persistenceStatus({persisted:never},true,10),'unavailable');
  assert.equal(await persistenceStatus({persisted:async()=>false,persist:never},true,10),'unavailable');
});
