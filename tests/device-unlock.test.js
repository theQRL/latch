import test from "node:test";
import assert from "node:assert/strict";
import {
  enrollDevice,
  unlockDevice,
  isAppleMobileBrowser,
} from "../shared/src/lib/device-unlock.js";
function credential(
  flags = 5,
  enabled = true,
  key = new Uint8Array(32).fill(7),
) {
  const data = new Uint8Array(37);
  data[32] = flags;
  return {
    rawId: new Uint8Array([1, 2, 3]).buffer,
    response: {
      getAuthenticatorData: () => data.buffer,
      authenticatorData: data.buffer,
    },
    getClientExtensionResults: () => ({
      prf: { enabled, results: { first: key.buffer } },
    }),
  };
}
test("PWA device unlock tests fresh encryption access and exposes both setup stages", async () => {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    oldCredential = globalThis.PublicKeyCredential;
  const phases = [],
    calls = [];
  try {
    globalThis.PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        credentials: {
          create: async (o) => {
            calls.push(o);
            return credential();
          },
          get: async (o) => {
            calls.push(o);
            return credential();
          },
        },
      },
    });
    const signal = new AbortController().signal;
    const settings = await enrollDevice({
      signal,
      onPhase: (p) => phases.push(p),
    });
    assert.equal(phases.length, 2);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal, signal);
    assert.equal(calls[1].signal, signal);
    assert.equal(settings.prf.length, 32);
    assert.equal(settings.credential, "AQID");
    navigator.credentials.create = async () => credential(13);
    await assert.rejects(enrollDevice(), /can sync/);
    navigator.credentials.create = async () => credential(5, false);
    await assert.rejects(enrollDevice(), /without encryption support/);
    navigator.credentials.get = async () =>
      credential(5, true, new Uint8Array(1));
    await assert.rejects(unlockDevice(settings), /unavailable/);
    navigator.credentials.get = async () => {
      throw new DOMException("Cancelled", "NotAllowedError");
    };
    await assert.rejects(unlockDevice(settings), /Cancelled/);
  } finally {
    if (oldNavigator)
      Object.defineProperty(globalThis, "navigator", oldNavigator);
    else delete globalThis.navigator;
    if (oldCredential) globalThis.PublicKeyCredential = oldCredential;
    else delete globalThis.PublicKeyCredential;
  }
});

test("iOS/iPadOS detection includes desktop-mode iPad without hiding desktop or Android setup", () => {
  assert.equal(
    isAppleMobileBrowser({ userAgent: "Mozilla iPhone OS 27" }),
    true,
  );
  assert.equal(isAppleMobileBrowser({ userAgent: "Mozilla iPad" }), true);
  assert.equal(
    isAppleMobileBrowser({
      userAgent: "Mozilla Macintosh",
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
    true,
  );
  assert.equal(
    isAppleMobileBrowser({
      userAgent: "Mozilla Macintosh",
      platform: "MacIntel",
      maxTouchPoints: 0,
    }),
    false,
  );
  assert.equal(
    isAppleMobileBrowser({ userAgent: "Mozilla Android", maxTouchPoints: 5 }),
    false,
  );
});
test("Apple mobile PWA enrollment fails before creating any credential", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let prompted = false;
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent: "iPhone",
        credentials: {
          create: async () => {
            prompted = true;
          },
        },
      },
    });
    await assert.rejects(enrollDevice(), /disabled in the iOS/);
    assert.equal(prompted, false);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  }
});
