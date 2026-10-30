<script setup>
import { useScreenAwake } from "../lib/use-screen-awake.js";
import ScreenAwakeStatus from "./ScreenAwakeStatus.vue";
import { ref, onBeforeUnmount } from "vue";
import { Html5Qrcode } from "html5-qrcode";
import { Receiver, encodeAck } from "../lib/protocol.js";
import QRCode from "qrcode";
const emit = defineEmits(["message", "ack", "prompt-start", "prompt-end"]);
const props = defineProps({ ackOnly: Boolean });
const rx = new Receiver(),
  active = ref(false),
  error = ref(""),
  received = ref(0),
  total = ref(0),
  ackImage = ref("");
const elementId = "reader-" + crypto.randomUUID();
let scanner = null,
  starting = null,
  generation = 0,
  busy = false,
  disposed = false;
async function stop() {
  generation++;
  const instance = scanner;
  const pendingStart = starting;
  scanner = null;
  active.value = false;
  if (instance) {
    try {
      await pendingStart;
    } catch {}
    try {
      if (instance.isScanning) await instance.stop();
      instance.clear();
    } catch {}
  }
}
async function accept(text) {
  if (busy || disposed) return;
  busy = true;
  const current = generation;
  try {
    if (props.ackOnly) {
      emit("ack", text);
      return;
    }
    const result = await rx.offer(text);
    if (disposed || current !== generation) return;
    if (result === "conflict") {
      error.value =
        "A different transfer is in view. Return to the original codes, or start over.";
      return;
    }
    if (result === "ignored") return;
    error.value = "";
    received.value = rx.pages.size;
    total.value = rx.total;
    if (result === "complete") {
      const msg = rx.message();
      await stop();
      reset();
      if (!disposed) emit("message", msg);
    } else if (rx.session) {
      const image = await QRCode.toDataURL(
        encodeAck(rx.pages.keys(), rx.total, rx.session),
        { width: 240, margin: 4 },
      );
      if (!disposed && current === generation) ackImage.value = image;
    }
  } catch (e) {
    error.value = e.message;
    reset();
  } finally {
    busy = false;
  }
}
async function start() {
  if (active.value || starting || disposed) return;
  error.value = "";
  active.value = true;
  try {
    scanner = new Html5Qrcode(elementId, { verbose: false });
    emit("prompt-start");
    starting = scanner.start(
      { facingMode: "environment" },
      { fps: 8, qrbox: { width: 250, height: 250 } },
      accept,
      () => {},
    );
    await starting;
  } catch {
    error.value =
      "Camera unavailable. Allow camera access in your browser settings, then try again.";
    await stop();
  } finally {
    starting = null;
    emit("prompt-end");
  }
}
function reset() {
  generation++;
  rx.reset();
  received.value = 0;
  total.value = 0;
  ackImage.value = "";
}
onBeforeUnmount(() => {
  disposed = true;
  stop();
});
const { screenAwake, retryScreenAwake } = useScreenAwake(() => active.value);
</script>
<template>
  <div class="stack">
    <ScreenAwakeStatus :status="screenAwake" @retry="retryScreenAwake" />
    <div :id="elementId" class="camera-view"></div>
    <p v-if="error" class="notice danger" role="alert">{{ error }}</p>
    <p v-if="total" role="status" class="tabular-nums">
      Received {{ received }} of {{ total }} frames
    </p>
    <progress
      v-if="total"
      class="progress progress-primary"
      :value="received"
      :max="total"
    ></progress
    ><button
      v-if="!active"
      type="button"
      class="btn btn-primary"
      @click="start"
    >
      Start camera</button
    ><button v-else type="button" class="btn btn-outline" @click="stop">
      Stop camera</button
    ><button v-if="received" type="button" class="btn btn-ghost" @click="reset">
      Start transfer over
    </button>
    <details v-if="ackImage">
      <summary>Show transfer progress QR</summary>
      <p class="field-help">
        On the sending device, choose Scan progress QR to skip frames already
        received.
      </p>
      <img
        :src="ackImage"
        alt="Transfer progress QR showing received frames"
        class="qr-image"
      />
    </details>
  </div>
</template>
