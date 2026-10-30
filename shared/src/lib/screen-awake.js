// Serialise acquisition/release so navigation during an OS prompt cannot leak a lock.
export function createScreenAwake({ request, document, onStatus = () => {} }) {
  const owners = new Set();
  let sentinel = null,
    queue = Promise.resolve();
  const wanted = () =>
    owners.size > 0 && document.visibilityState === "visible";
  function reconcile() {
    queue = queue.then(async () => {
      if (!wanted()) {
        const previous = sentinel;
        sentinel = null;
        if (previous) await previous.release().catch(() => {});
        onStatus("inactive");
        return;
      }
      if (sentinel) return;
      onStatus("requesting");
      try {
        const acquired = await request();
        if (!wanted()) {
          await acquired.release();
          onStatus("inactive");
          return;
        }
        sentinel = acquired;
        acquired.addEventListener?.(
          "release",
          () => {
            if (sentinel !== acquired) return;
            sentinel = null;
            onStatus(wanted() ? "unavailable" : "inactive");
          },
          { once: true },
        );
        if (acquired.released) {
          sentinel = null;
          onStatus("unavailable");
        } else onStatus("active");
      } catch {
        onStatus(wanted() ? "unavailable" : "inactive");
      }
    });
    return queue;
  }
  document.addEventListener("visibilitychange", reconcile);
  return {
    acquire() {
      const owner = {};
      owners.add(owner);
      reconcile();
      return () => {
        owners.delete(owner);
        return reconcile();
      };
    },
    retry: reconcile,
    settled: () => queue,
  };
}
