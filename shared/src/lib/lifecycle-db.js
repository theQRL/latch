// Shared by the page and service worker. All state and encrypted values commit together.
export const DATABASE = "qrl-latch-state-v2";
export function openDatabase(factory = indexedDB) {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(Error("Close other Latch windows and retry."));
    request.onsuccess = () => resolve(request.result);
  });
}
export async function transactRecord(change, factory) {
  const db = await openDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("state", change ? "readwrite" : "readonly", {
        durability: "strict",
      });
      const store = tx.objectStore("state");
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(failure || tx.error || Error("Storage transaction aborted"));
      tx.onerror = () => {};
      const request = store.get("record");
      request.onsuccess = () => {
        try {
          result = change
            ? change(request.result || null)
            : request.result || null;
          if (change) store.put(result, "record");
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  } finally {
    db.close();
  }
}
export function requireEmpty(record, phases) {
  if (
    !record ||
    !phases.includes(record.phase) ||
    Object.keys(record.values || {}).length
  )
    throw Error("Finish wiping Latch before updating.");
}
