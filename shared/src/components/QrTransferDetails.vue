<script setup>
import { ref } from "vue";
import QrSender from "./QrSender.vue";
defineProps({
  message: { type: Object, required: true },
  label: String,
  warning: String,
});
const emit = defineEmits(["prompt-start", "prompt-end"]);
const open = ref(false);
</script>
<template>
  <details class="collapse collapse-arrow" @toggle="open = $event.target.open">
    <summary class="collapse-title">{{ label }}</summary>
    <div class="collapse-content">
      <p v-if="warning" class="field-help">{{ warning }}</p>
      <QrSender
        v-if="open"
        :message="message"
        @prompt-start="emit('prompt-start')"
        @prompt-end="emit('prompt-end')"
      />
    </div>
  </details>
</template>
