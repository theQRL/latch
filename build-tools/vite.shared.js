import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const repo = fileURLToPath(new URL("../", import.meta.url));
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) =>
      e.isDirectory() ? sources(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
    );
}
const hash = createHash("sha256");
for (const p of [
  ...sources(resolve(repo, "shared/src")),
  ...sources(resolve(repo, "shared/assets")),
  ...[
    "shared/index.html",
    "build-tools/vite.shared.js",
    "apps/pwa/sw.js",
    "build-tools/finalize-release.js",
    "build-tools/check-hosting.js",
    "netlify.toml",
    "package.json",
    "package-lock.json",
  ].map((p) => resolve(repo, p)),
])
  hash.update(p.replace(repo, "")).update(readFileSync(p));
const buildId = `0.1.0+${hash.digest("hex").slice(0, 12)}`;
export function config(native = false) {
  return defineConfig(({ command }) => ({
    root: resolve(repo, "shared"),
    publicDir: resolve(repo, "shared/assets"),
    resolve: { alias: { events: require.resolve("events/") } },
    plugins: [
      vue(),
      ...(!native
        ? [
            {
              name: "latch-release",
              generateBundle() {
                this.emitFile({
                  type: "asset",
                  fileName: "release.json",
                  source: JSON.stringify({ buildId, version: "0.1.0" }),
                });
              },
            },
          ]
        : []),
      ...(!native
        ? [
            VitePWA({
              strategies: "injectManifest",
              srcDir: resolve(repo, "apps/pwa"),
              filename: "sw.js",
              injectRegister: false,
              registerType: "prompt",
              manifest: {
                name: "QRL Latch",
                short_name: "QRL Latch",
                description: "Offline QRL signing vault",
                id: "/",
                scope: "/",
                start_url: "/",
                display: "standalone",
                background_color: "#0a1720",
                theme_color: "#0a1720",
                icons: [
                  { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
                  { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
                ],
              },
              injectManifest: {
                globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
                maximumFileSizeToCacheInBytes: 15000000,
              },
            }),
          ]
        : []),
    ],
    define: {
      __BUILD_ID__: JSON.stringify(buildId),
      __LATCH_DEV_BUILD__: command === "serve",
      __LATCH_NATIVE_BUILD__: native,
      "process.env": {},
    },
    worker: { format: "es" },
    build: {
      target: "es2022",
      sourcemap: false,
      outDir: resolve(repo, native ? "build/native" : "apps/pwa/dist"),
      emptyOutDir: true,
    },
  }));
}
