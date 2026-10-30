import { parentPort } from "node:worker_threads";
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
await import("../shared/src/lib/crypto-worker.js");
parentPort.on("message", (data) => self.onmessage({ data }));
parentPort.postMessage({ ready: true });
