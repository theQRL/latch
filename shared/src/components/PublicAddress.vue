<script setup>
import { useScreenAwake } from "../lib/use-screen-awake.js";
import ScreenAwakeStatus from "./ScreenAwakeStatus.vue";
import { ref, onMounted, onBeforeUnmount } from "vue";
import QRCode from "qrcode";
const props = defineProps({ address: { type: String, required: true } });
const image = ref(""),
  status = ref(""),
  error = ref(""),
  text = ref(null);
let disposed = false;
onBeforeUnmount(() => {
  disposed = true;
});
onMounted(async () => {
  try {
    const result = await QRCode.toDataURL(props.address, {
      errorCorrectionLevel: "M",
      margin: 4,
      width: 360,
      color: { dark: "#000000", light: "#ffffff" },
    });
    if (!disposed) image.value = result;
  } catch {
    if (!disposed)
      error.value = "Could not draw the QR. Copy the address below instead.";
  }
});
async function copy() {
  try {
    await navigator.clipboard.writeText(props.address);
    if (!disposed) status.value = "Public address copied.";
  } catch {
    if (disposed) return;
    text.value?.focus();
    text.value?.select();
    status.value =
      "Address selected. Use your device’s Copy action, or scan the QR.";
  }
}
const { screenAwake, retryScreenAwake } = useScreenAwake(() => !!image.value);
</script>
<template>
  <div class="stack">
    <ScreenAwakeStatus :status="screenAwake" @retry="retryScreenAwake" />
    <p class="intro">
      Scan with your online wallet to use this public address. This wallet stays
      locked.
    </p>
    <div v-if="image" class="qr-stage">
      <img
        :src="image"
        class="qr-image"
        width="360"
        height="360"
        alt="Wallet public address QR code"
      />
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <label class="field"
      >Public address
      <textarea
        ref="text"
        class="textarea mono"
        style="overflow-wrap: anywhere; word-break: break-all; min-height: 8rem"
        :value="address"
        readonly
        rows="4"
        spellcheck="false"
        @click="$event.target.select()"
      />
    </label>
    <button type="button" class="btn btn-primary" @click="copy">
      Copy public address
    </button>
    <p role="status" aria-live="polite" class="field-help">
      {{
        status ||
        "The QR contains only the address, with no private keys or wallet data."
      }}
    </p>
  </div>
</template>
