import { Capacitor } from "@capacitor/core";
export const nativeBuild =
  typeof __LATCH_NATIVE_BUILD__ !== "undefined" && __LATCH_NATIVE_BUILD__;
export const isNative = nativeBuild && Capacitor.isNativePlatform();
export async function monitorNative(connection, background, foreground) {
  if (!isNative) return () => {};
  const { Network } = await import("@capacitor/network");
  const { App } = await import("@capacitor/app");
  const network = await Network.addListener("networkStatusChange", (s) =>
    connection(s.connected),
  );
  const state = await App.addListener("appStateChange", (s) =>
    s.isActive ? foreground() : background(),
  );
  connection((await Network.getStatus()).connected);
  return () => {
    network.remove();
    state.remove();
  };
}
