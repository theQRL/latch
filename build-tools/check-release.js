// Execute the built worker's install handler against its actual release files.
// This catches manifest additions by the bundler that unit fixtures cannot predict.
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { indexedDB } from "fake-indexeddb";
const root = new URL("../apps/pwa/dist/", import.meta.url);
const handlers = {},
  cache = new Map();
let count = 0;
const self = {
  location: { origin: "https://latch.example" },
  addEventListener(type, fn) {
    (handlers[type] ??= []).push(fn);
  },
};
vm.runInNewContext(await readFile(new URL("sw.js", root), "utf8"), {
  self,
  indexedDB,
  URL,
  Request,
  Response,
  AbortController,
  setTimeout,
  clearTimeout,
  caches: {
    keys: async () => [],
    open: async () => ({
      put: async (k, v) => cache.set(k, v),
      match: async (k) => cache.get(k),
    }),
    delete: async () => cache.clear(),
  },
  fetch: async (request) => {
    const path = new URL(request.url).pathname.slice(1);
    const bytes = await readFile(new URL(path, root));
    const digest =
      "sha256-" + createHash("sha256").update(bytes).digest("base64");
    if (request.integrity !== digest)
      throw Error(`Missing or incorrect integrity: ${path}`);
    count++;
    return new Response(bytes);
  },
});
const tasks = [];
for (const handler of handlers.install ?? [])
  handler({ waitUntil: (task) => tasks.push(task) });
await Promise.all(tasks);
if (!count || !cache.has("/__latch-installed__"))
  throw Error("Release did not install completely");
console.log(
  `Verified built service worker: ${count} assets with matching SHA-256 digests.`,
);
