// Policy gate, not a claim that Safari lacks WebAuthn PRF. Apple's usual
// platform passkeys are sync-eligible; Latch requires device-only credentials.
export function isAppleMobileBrowser(nav = globalThis.navigator) {
  return (
    /iPad|iPhone|iPod/i.test(nav?.userAgent || "") ||
    (nav?.platform === "MacIntel" && nav?.maxTouchPoints > 1)
  );
}
const enc = new TextEncoder();
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const un64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function checkLocal(authData) {
  if (!authData || authData.byteLength < 37)
    throw Error("This authenticator cannot prove device-bound storage");
  const flags = new Uint8Array(authData)[32];
  if (!(flags & 4) || flags & 8)
    throw Error(
      "This credential can sync to other devices. It was not enabled in Latch. Use a device-only credential or the native app.",
    );
}
export async function enrollDevice({ signal, onPhase = () => {} } = {}) {
  if (isAppleMobileBrowser())
    throw Error(
      "Passkey setup is disabled in the iOS/iPadOS PWA because Latch requires device-only credentials. Use your vault passphrase or the native app for Face ID or Touch ID.",
    );
  if (
    !globalThis.PublicKeyCredential ||
    !(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
  )
    throw Error(
      "Device unlock is not supported on this phone. Use your vault passphrase.",
    );
  const salt = crypto.getRandomValues(new Uint8Array(32));
  onPhase("Create a device-only credential (step 1 of 2)");
  const credential = await navigator.credentials.create({
    signal,
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "QRL Latch" },
      user: {
        id: crypto.getRandomValues(new Uint8Array(32)),
        name: "latch-vault",
        displayName: "Latch offline vault",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
      attestation: "none",
      timeout: 25000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  checkLocal(credential.response.getAuthenticatorData?.());
  if (!credential.getClientExtensionResults().prf?.enabled)
    throw Error(
      "The browser created a credential without encryption support. It was not enabled in Latch. Use your vault passphrase or the native app.",
    );
  const settings = { credential: b64(credential.rawId), salt: b64(salt) };
  // Registration is insufficient: test a fresh unlock before storing any wrapper.
  onPhase("Verify encryption access (step 2 of 2)");
  return { ...settings, prf: await unlockDevice(settings, { signal }) };
}
export async function unlockDevice(settings, { signal } = {}) {
  const credential = await navigator.credentials.get({
    signal,
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [
        {
          type: "public-key",
          id: un64(settings.credential),
          transports: ["internal"],
        },
      ],
      userVerification: "required",
      timeout: 25000,
      extensions: { prf: { eval: { first: un64(settings.salt) } } },
    },
  });
  checkLocal(credential.response.authenticatorData);
  const result = credential.getClientExtensionResults().prf?.results?.first;
  if (!result || result.byteLength !== 32)
    throw Error("Device encryption is unavailable. Use your vault passphrase.");
  return new Uint8Array(result);
}
export async function wrapKey(key, prf) {
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    k = await crypto.subtle.importKey("raw", prf, "AES-GCM", false, [
      "encrypt",
    ]);
  return {
    iv: b64(iv),
    ciphertext: b64(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: enc.encode("qrl-latch-device-unlock-v1"),
        },
        k,
        key,
      ),
    ),
  };
}
export async function unwrapKey(wrapper, prf) {
  const k = await crypto.subtle.importKey("raw", prf, "AES-GCM", false, [
    "decrypt",
  ]);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: un64(wrapper.iv),
        additionalData: enc.encode("qrl-latch-device-unlock-v1"),
      },
      k,
      un64(wrapper.ciphertext),
    ),
  );
}
