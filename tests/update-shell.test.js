import test from "node:test";
import assert from "node:assert/strict";
import { reloadUpdatedShell } from "../shared/src/lib/update-shell.js";
test("reload waits for the new controller and permits only one attempt per build", async () => {
  const values = new Map();
  let reloads = 0;
  const options = {
    controller: {},
    storage: {
      getItem: (k) => values.get(k),
      setItem: (k, v) => values.set(k, v),
    },
    reload: () => reloads++,
    check: async () => {
      throw Error("old controller");
    },
  };
  await assert.rejects(reloadUpdatedShell("B", options), /old controller/);
  assert.equal(reloads, 0);
  assert.equal(values.size, 0);
  options.check = async () => {};
  await reloadUpdatedShell("B", options);
  assert.equal(reloads, 1);
  await assert.rejects(reloadUpdatedShell("B", options), /Close and reopen/);
  assert.equal(reloads, 1);
  await reloadUpdatedShell("C", options);
  assert.equal(reloads, 2);
});
