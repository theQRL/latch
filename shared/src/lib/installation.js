export function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(message)), ms);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
// Persistence is separate from cache availability. Neither is a backup.
export async function persistenceStatus(storage, request = false, timeout = 5000) {
  if (!storage?.persisted) return "unsupported";
  try {
    if (await withTimeout(storage.persisted(),timeout,"Storage check timed out")) return "granted";
    if (!request) return "not-granted";
    if (!storage.persist) return "unsupported";
    return (await withTimeout(storage.persist(),timeout,"Storage request timed out")) ? "granted" : "not-granted";
  } catch {
    return "unavailable";
  }
}
export function cacheStatus(controller, buildId, timeout = 10000) {
  if (!controller)
    return Promise.reject(
      Error(
        "Offline worker is not controlling this page yet. Reopen Latch after installation.",
      ),
    );
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const close = () => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
    };
    const timer = setTimeout(() => {
      close();
      reject(Error("Offline verification timed out. Close and reopen Latch."));
    }, timeout);
    channel.port1.onmessage = ({ data }) => {
      close();
      if (data?.type !== "LATCH_CACHE_STATUS" || data.buildId !== buildId) {
        reject(
          Error(
            "App and offline files belong to different builds. Close and reopen Latch.",
          ),
        );
        return;
      }
      if (
        !data.complete ||
        !Number.isInteger(data.total) ||
        data.total < 1 ||
        data.cached !== data.total
      ) {
        reject(
          Error(
            "Offline files are missing. Do not import keys. Recover existing wallets from your encrypted backup on a fresh installation.",
          ),
        );
        return;
      }
      resolve(data);
    };
    try {
      controller.postMessage({ type: "LATCH_CHECK_CACHE" }, [channel.port2]);
    } catch (error) {
      close();
      reject(error);
    }
  });
}
export async function preparePwa(serviceWorker, {timeout = 25000, onProgress = () => {}} = {}) {
  if (!serviceWorker) throw Error("Offline installation needs HTTPS and a supported browser. Add to Home Screen from Safari on iPhone, or Chrome on Android.");
  const deadline = Date.now() + timeout;
  const step = (promise, message) => withTimeout(promise, Math.max(1,deadline-Date.now()), message);
  onProgress("Checking the offline installation…");
  const registration = await step(serviceWorker.getRegistration(), "The browser did not respond. Close and reopen the Home Screen app, then retry.");
  if (!registration?.active) {
    onProgress("Downloading offline app files. Keep this new installation online…");
    await step(serviceWorker.register("/sw.js", {updateViaCache:"none"}), "The offline download did not finish. For a new installation, check the connection and retry. Keep devices with existing keys offline.");
  }
  onProgress("Waiting for the offline version to activate…");
  await step(serviceWorker.ready, "Offline preparation timed out. Keep this new installation online. Add to Home Screen, open the new icon while still online, then retry.");
  if (!serviceWorker.controller) {
    let done;
    const controlled = new Promise(resolve => {
      done=() => {if(serviceWorker.controller) resolve();};
      serviceWorker.addEventListener("controllerchange",done);done();
    });
    try { await step(controlled,"Close and reopen the Home Screen app to finish offline preparation."); }
    finally { serviceWorker.removeEventListener("controllerchange",done); }
  }
  onProgress("Checking every required offline file…");
}
