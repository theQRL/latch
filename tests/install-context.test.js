import test from "node:test";
import assert from "node:assert/strict";
import {
  installedContext,
  canInitializeVault,
} from "../shared/src/lib/install-context.js";
test("installation detection identifies this app window without claiming a browser tab is installed", () => {
  const media = (mode) => (query) => ({
    matches: query === `(display-mode: ${mode})`,
  });
  assert.equal(installedContext({ standalone: true }, media("browser")), true);
  assert.equal(installedContext({}, media("standalone")), true);
  assert.equal(installedContext({}, media("window-controls-overlay")), true);
  assert.equal(
    installedContext({ standalone: false }, media("browser")),
    false,
  );
  assert.equal(installedContext({}, media("fullscreen")), false);
});
test("new PWA vaults require verified offline startup in an installed window", () => {
  for (const standalone of [false, true])
    for (const offlineLaunchVerified of [false, true])
      assert.equal(
        canInitializeVault({
          native: false,
          standalone,
          offlineLaunchVerified,
        }),
        standalone && offlineLaunchVerified,
      );
  assert.equal(
    canInitializeVault({
      native: true,
      standalone: false,
      offlineLaunchVerified: false,
    }),
    true,
  );
});
