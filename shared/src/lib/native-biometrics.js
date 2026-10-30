import { registerPlugin } from "@capacitor/core";
export const NATIVE_BIOMETRIC_KIND = "native-biometric-v1";
const validId = (id) => typeof id === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
export function createNativeBiometrics(bridge) {
  function decode(result) {
    if (!validId(result?.credential) || typeof result.secret !== "string" || result.secret.length > 64)
      throw Error("Invalid biometric key. Use your vault passphrase.");
    const key = Uint8Array.from(atob(result.secret), (c) => c.charCodeAt(0));
    if (key.length !== 32) { key.fill(0); throw Error("Invalid biometric key. Use your vault passphrase."); }
    return key;
  }
  return {
    availability: () => bridge.availability(),
    async enroll() {
      const result = await bridge.enroll();
      try { return { kind: NATIVE_BIOMETRIC_KIND, credential: result.credential, prf: decode(result) }; }
      catch (error) { if (validId(result?.credential)) await bridge.remove({ credential: result.credential }); throw error; }
    },
    async unlock(settings) {
      if (settings?.kind !== NATIVE_BIOMETRIC_KIND || !validId(settings.credential)) throw Error("Set up biometric unlock again using your vault passphrase.");
      const result = await bridge.unlock({ credential: settings.credential });
      if (result?.credential !== settings.credential) throw Error("Biometric credential mismatch");
      return decode(result);
    },
    remove: (settings) => bridge.remove({ credential: settings.credential }),
    cancel: () => bridge.cancel(),
    wipe: () => bridge.wipe(),
  };
}
export const nativeBiometrics = createNativeBiometrics(registerPlugin("LatchBiometrics"));
