import {
  transactRecord,
  requireEmpty,
} from "../../shared/src/lib/lifecycle-db.js";
// Replacement code is permitted only for an empty, explicitly approved maintenance update.
// Browser-managed update requests cannot be disabled by a PWA. Keep the device offline.
const manifest = self.__WB_MANIFEST;
const CACHE = "latch-shell-" + __BUILD_ID__;
async function approved() {
  const record = await transactRecord();
  requireEmpty(record, ["downloading"]);
  if (record.target !== __BUILD_ID__)
    throw Error("This release was not approved for installation");
  return record;
}
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const existing = [];
      for (const name of keys.filter(
        (k) => k.startsWith("latch-shell-") && k !== CACHE,
      )) {
        if (await (await caches.open(name)).match("/__latch-installed__"))
          existing.push(name);
      }
      const record = await transactRecord();
      const updating = existing.length > 0 || record?.phase === "downloading";
      if (updating) await approved();
      else if (
        record &&
        (record.phase !== "sealed" || Object.keys(record.values).length)
      )
        throw Error(
          "Existing vault data must be wiped before installing new code",
        );
      const cache = await caches.open(CACHE);
      try {
        for (const url of [...new Set(manifest.map((item) => item.url))]) {
          const integrity = self.__LATCH_DIGESTS__?.[url];
          if (!integrity) throw Error("Release integrity metadata is missing");
          const response = await fetch(
            new Request(new URL(url, self.location.origin), {
              cache: "reload",
              integrity,
            }),
          );
          if (
            !response.ok ||
            !(await response.clone().arrayBuffer()).byteLength
          )
            throw Error("Incomplete release download");
          await cache.put(url, response);
        }
        if (updating) await approved();
        await cache.put("/__latch-installed__", new Response("installed"));
        if (updating) await self.skipWaiting();
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      await transactRecord((record) => {
        if (record?.phase === "downloading") {
          requireEmpty(record, ["downloading"]);
          if (record.target !== __BUILD_ID__)
            throw Error("Release approval changed");
          return {
            ...record,
            phase: "maintenance",
            installedBuild: __BUILD_ID__,
            target: null,
          };
        }
        return record;
      });
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) =>
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const url = new URL(event.request.url);
      if (url.origin !== self.location.origin || event.request.method !== "GET")
        return Response.error();
      const response = await cache.match(
        event.request.mode === "navigate" ? "index.html" : event.request,
        { ignoreSearch: true, ignoreVary: true },
      );
      return (
        response ||
        new Response("Resource not included in this offline build", {
          status: 503,
        })
      );
    })(),
  ),
);

// Answer only from this installed worker's manifest and cache. Never repair by network.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "LATCH_CHECK_CACHE" || !event.ports?.[0]) return;
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        const urls = [...new Set(manifest.map((item) => item.url))];
        let cached = 0;
        for (const url of urls) {
          const response = await cache.match(url, {
            ignoreSearch: true,
            ignoreVary: true,
          });
          if (response?.ok && (await response.arrayBuffer()).byteLength > 0)
            cached++;
        }
        const marker = await cache.match("/__latch-installed__");
        event.ports[0].postMessage({
          type: "LATCH_CACHE_STATUS",
          buildId: __BUILD_ID__,
          total: urls.length,
          cached,
          complete: !!marker && cached === urls.length && urls.length > 0,
        });
      } catch {
        event.ports[0].postMessage({
          type: "LATCH_CACHE_STATUS",
          buildId: __BUILD_ID__,
          total: 0,
          cached: 0,
          complete: false,
        });
      }
    })(),
  );
});

// These network operations exist only in empty maintenance mode, on explicit messages.
self.addEventListener("message", (event) => {
  if (
    !["LATCH_CLIENT_COUNT", "LATCH_RELEASE_CHECK"].includes(event.data?.type) ||
    !event.ports?.[0]
  )
    return;
  event.waitUntil(
    (async () => {
      try {
        const client = await self.clients.get(event.source?.id);
        if (!client || new URL(client.url).origin !== self.location.origin)
          throw Error("Unknown app client");
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        if (event.data.type === "LATCH_CLIENT_COUNT") {
          event.ports[0].postMessage({ count: clients.length });
          return;
        }
        requireEmpty(await transactRecord(), ["maintenance"]);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(
            new URL("/release.json", self.location.origin),
            { cache: "no-store", signal: controller.signal, redirect: "error" },
          );
          if (!response.ok)
            throw Error("Release server did not respond successfully");
          const text = await response.text();
          if (text.length > 4096) throw Error("Invalid release response");
          const release = JSON.parse(text);
          if (!/^0\.1\.0\+[a-f0-9]{12}$/.test(release.buildId))
            throw Error("Invalid release identifier");
          event.ports[0].postMessage({ release });
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        event.ports[0].postMessage({
          error: error.message || "Update check failed",
        });
      }
    })(),
  );
});
