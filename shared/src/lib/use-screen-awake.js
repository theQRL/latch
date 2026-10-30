import { ref, watch, onBeforeUnmount } from "vue";
import { registerPlugin } from "@capacitor/core";
import { isNative } from "./platform.js";
import { createScreenAwake } from "./screen-awake.js";
const native = registerPlugin("LatchScreenAwake");
const status = ref("inactive");
const manager = createScreenAwake({
  document,
  onStatus: (value) => {
    status.value = value;
  },
  async request() {
    if (isNative) {
      await native.setEnabled({ enabled: true });
      return { release: () => native.setEnabled({ enabled: false }) };
    }
    if (!navigator.wakeLock) throw Error("Screen wake lock unavailable");
    return navigator.wakeLock.request("screen");
  },
});
export function useScreenAwake(active) {
  let release;
  watch(
    active,
    (enabled) => {
      if (enabled && !release) release = manager.acquire();
      if (!enabled && release) {
        release();
        release = null;
      }
    },
    { immediate: true, flush: "sync" },
  );
  onBeforeUnmount(() => {
    release?.();
    release = null;
  });
  return { screenAwake: status, retryScreenAwake: manager.retry };
}
