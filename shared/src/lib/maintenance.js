import { withTimeout } from "./installation.js";
import { isNative } from "./platform.js";
import {
  readLifecycle,
  completeWipe,
  finishMaintenance,
  authorizeUpdate,
  cancelUpdateAuthorization,
} from "./storage.js";
import { requireEmpty } from "./lifecycle-db.js";
import { nativeBiometrics } from "./native-biometrics.js";
export function workerMessage(type, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const worker = navigator.serviceWorker?.controller;
    if (!worker) {
      reject(Error("Reopen the installed app first."));
      return;
    }
    const channel = new MessageChannel();
    const finish = (error, value) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(
      () =>
        finish(
          Error(
            "The app did not respond. Close other Latch windows and retry.",
          ),
        ),
      timeout,
    );
    channel.port1.onmessage = ({ data }) =>
      finish(data?.error ? Error(data.error) : null, data);
    try {
      worker.postMessage({ type }, [channel.port2]);
    } catch (error) {
      finish(error);
    }
  });
}
export async function requireSingleWindow() {
  if (!isNative && (await workerMessage("LATCH_CLIENT_COUNT")).count !== 1)
    throw Error("Close every other Latch tab or window before continuing.");
}
export async function cleanupWipe() {
  requireEmpty(await readLifecycle(), ["wiping"]);
  if (isNative) {
    await nativeBiometrics.cancel();
    await nativeBiometrics.wipe();
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { files } = await Filesystem.readdir({
      path: "",
      directory: Directory.Cache,
    });
    for (const file of files.filter((f) =>
      /^qrl-latch-(?:vault|wallet)-.*\.json$/.test(f.name),
    ))
      await Filesystem.deleteFile({
        path: file.name,
        directory: Directory.Cache,
      });
    const remaining = await Filesystem.readdir({
      path: "",
      directory: Directory.Cache,
    });
    if (
      remaining.files.some((f) =>
        /^qrl-latch-(?:vault|wallet)-.*\.json$/.test(f.name),
      )
    )
      throw Error("Temporary backup cleanup did not finish.");
  }
  await completeWipe();
}
export async function checkRelease() {
  requireEmpty(await readLifecycle(), ["maintenance"]);
  return (await workerMessage("LATCH_RELEASE_CHECK")).release;
}
export async function installRelease(buildId) {
  await requireSingleWindow();
  await authorizeUpdate(buildId);
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration)
    throw Error(
      "No installed service worker. Keep your backup and use a fresh installation.",
    );
  await withTimeout(
    registration.update(),
    30000,
    "The update is still pending or the network is unavailable. Retry after it fails, or wait for Latch to reopen.",
  );
  const worker = registration.installing || registration.waiting;
  if (!worker) {
    const state = await readLifecycle();
    if (state.phase === "maintenance" && state.installedBuild === buildId)
      return;
    throw Error(
      "No new release was installed. Cancel this attempt and check again.",
    );
  }
  await waitForActivation(worker);
}
export async function sealInstallation() {
  if (navigator.onLine && !isNative)
    throw Error("Disconnect before returning to offline mode.");
  await requireSingleWindow();
  if (!isNative) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration?.installing || registration?.waiting)
      throw Error(
        "An update is still pending. Finish it before restoring keys.",
      );
  }
  await finishMaintenance();
}

export async function cancelRelease() {
  const registration = await navigator.serviceWorker.getRegistration();
  if (registration?.installing || registration?.waiting)
    throw Error(
      "An update is still being installed. Wait for it to finish or fail before cancelling.",
    );
  await cancelUpdateAuthorization();
}

export function waitForActivation(worker, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", changed);
      error ? reject(error) : resolve();
    };
    const changed = () => {
      if (worker.state === "activated") finish();
      else if (worker.state === "redundant")
        finish(
          Error(
            "The update could not be verified or downloaded. Your existing offline files are intact. Retry the download.",
          ),
        );
    };
    const timer = setTimeout(
      () =>
        finish(
          Error(
            "The download is still pending. Keep this empty instance online, or retry after it fails.",
          ),
        ),
      timeout,
    );
    worker.addEventListener("statechange", changed);
    changed();
  });
}
