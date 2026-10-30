import test from "node:test";
import assert from "node:assert/strict";
import { waitForActivation } from "../shared/src/lib/maintenance.js";
function worker(state) {
  const value = new EventTarget(); value.state = state;
  value.change = next => { value.state = next; value.dispatchEvent(new Event("statechange")); };
  return value;
}
test("update completion follows activation and reports failed or stalled installation", async () => {
  const pending = worker("installing");
  const activation = waitForActivation(pending, 100);
  pending.change("installed"); pending.change("activating"); pending.change("activated");
  await activation;
  const rejected = worker("installing"); const failure = waitForActivation(rejected, 100);
  rejected.change("redundant"); await assert.rejects(failure, /could not be verified/);
  await assert.rejects(waitForActivation(worker("installing"), 5), /still pending/);
  await waitForActivation(worker("activated"), 100);
});
