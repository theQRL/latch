// A browser tab cannot reliably discover an installation elsewhere on the device.
export function installedContext(nav, media) {
  return (
    nav.standalone === true ||
    media("(display-mode: standalone)").matches ||
    media("(display-mode: window-controls-overlay)").matches
  );
}
export function canInitializeVault({
  native,
  standalone,
  offlineLaunchVerified,
}) {
  return native || (standalone && offlineLaunchVerified);
}
