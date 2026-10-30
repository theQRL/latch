import { toRaw } from "vue";

// Snapshot nested reactive records before the structured-clone worker boundary.
export function workerPayload(value) {
  const raw = toRaw(value);
  if (Array.isArray(raw)) return raw.map(workerPayload);
  if (raw && Object.getPrototypeOf(raw) === Object.prototype)
    return Object.fromEntries(
      Object.entries(raw).map(([key, item]) => [key, workerPayload(item)]),
    );
  return raw;
}

let worker = null,
  id = 0;
const pending = new Map();
export function stopVault() {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(Error("Vault locked"));
  pending.clear();
}
export function vaultCall(action, payload) {
  if (!worker) {
    worker = new Worker(new URL("./crypto-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      pending.delete(data.id);
      if (p) data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
    };
    worker.onerror = () => stopVault();
  }
  return new Promise((resolve, reject) => {
    const request = ++id;
    pending.set(request, { resolve, reject });
    try {
      worker.postMessage({
        id: request,
        action,
        payload: workerPayload(payload),
      });
    } catch (error) {
      pending.delete(request);
      reject(error);
    }
  });
}
