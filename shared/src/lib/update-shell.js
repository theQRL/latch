import { cacheStatus } from "./installation.js";
// Wait for clients.claim() before reloading, and never loop on a stale shell.
export async function reloadUpdatedShell(
  target,
  {
    controller = navigator.serviceWorker?.controller,
    storage = sessionStorage,
    reload = () => location.reload(),
    check = cacheStatus,
  } = {},
) {
  await check(controller, target, 5000);
  const key = "latch-reload-target";
  if (storage.getItem(key) === target)
    throw Error("The updated build did not load. Close and reopen Latch.");
  storage.setItem(key, target);
  reload();
}
