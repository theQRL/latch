<script setup>
import { useScreenAwake } from "../lib/use-screen-awake.js";
import ScreenAwakeStatus from "./ScreenAwakeStatus.vue";
import { ref, onMounted, onBeforeUnmount, computed } from "vue";
import QRCode from "qrcode";
import { Play, Pause, ScanLine } from "lucide-vue-next";
import { encodeMessage, parseAck } from "../lib/protocol.js";
import QrReader from "./QrReader.vue";
const emit = defineEmits(["prompt-start", "prompt-end"]);
const props = defineProps({ message: { type: Object, required: true } });
const frames = ref([]),
  images = ref([]),
  index = ref(0),
  playing = ref(true),
  speed = ref(550),
  error = ref(""),
  sync = ref(false),
  received = ref(new Set());
let timer,
  disposed = false;
const remaining = computed(() =>
  images.value.map((_, i) => i).filter((i) => !received.value.has(i + 1)),
);
const complete = computed(
  () => images.value.length > 0 && remaining.value.length === 0,
);
function advance() {
  const ids = remaining.value;
  if (!ids.length) return;
  index.value = ids[(ids.indexOf(index.value) + 1) % ids.length];
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (playing.value && !sync.value) advance();
    schedule();
  }, Number(speed.value));
}
function ack(text) {
  const f = JSON.parse(frames.value[0]);
  const got = parseAck(text, frames.value.length, f.s);
  if (got) {
    received.value = got;
    sync.value = false;
    if (got.has(index.value + 1)) advance();
  }
}
onMounted(async () => {
  try {
    frames.value = await encodeMessage(props.message);
    for (const text of frames.value) {
      const image = await QRCode.toDataURL(text, {
        width: 640,
        margin: 4,
        errorCorrectionLevel: "M",
      });
      if (disposed) return;
      images.value.push(image);
    }
    schedule();
  } catch (e) {
    error.value = e.message;
  }
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(timer);
});
const { screenAwake, retryScreenAwake } = useScreenAwake(
  () => images.value.length > 0 && !complete.value,
);
</script>
<template>
  <div class="stack">
    <ScreenAwakeStatus :status="screenAwake" @retry="retryScreenAwake" />
    <p v-if="error" class="notice danger" role="alert">{{ error }}</p>
    <p v-if="!images.length && !error" role="status">Preparing QR transfer…</p>
    <template v-if="images.length"
      ><div class="qr-stage">
        <img class="qr-image" :src="images[index]" alt="QR transfer frame" />
      </div>
      <p class="qr-count tabular-nums">
        Frame {{ index + 1 }} / {{ frames.length }}
        <span v-if="received.size">· {{ received.size }} received</span>
      </p>
      <p v-if="complete" class="notice success" role="status">
        All frames received. Check the receiving device before closing.
      </p>
      <div class="button-row">
        <button
          type="button"
          class="btn btn-outline"
          @click="playing = !playing"
        >
          <Pause v-if="playing" :size="16" aria-hidden="true" /><Play
            v-else
            :size="16"
            aria-hidden="true"
          />
          {{ playing ? "Pause" : "Play" }}</button
        ><button
          type="button"
          class="btn btn-outline"
          @click="
            playing = false;
            advance();
          "
        >
          Next frame
        </button>
      </div>
      <label class="field"
        >Playback speed<select name="speed" v-model="speed" class="select">
          <option :value="900">Slow · older cameras</option>
          <option :value="550">Normal</option>
          <option :value="300">Fast</option>
        </select></label
      >
      <p v-if="!complete" class="field-help">
        On the receiving device, show its Transfer progress QR. Scan it here to
        skip frames it already received.
      </p>
      <button
        v-if="!sync && !complete"
        type="button"
        class="btn btn-outline"
        @click="sync = true"
      >
        <ScanLine :size="16" aria-hidden="true" />Scan progress QR</button
      ><QrReader
        v-if="sync"
        ack-only
        @ack="ack"
        @prompt-start="emit('prompt-start')"
        @prompt-end="emit('prompt-end')"
      /><button
        v-if="sync"
        type="button"
        class="btn btn-ghost"
        @click="sync = false"
      >
        Back to codes
      </button></template
    >
  </div>
</template>
