<script setup>
defineProps({ status: String });
defineEmits(["retry"]);
</script>
<template>
  <p v-if="status === 'active'" class="field-help" role="status">
    Keeping the screen awake during this QR transfer.
  </p>
  <div v-else-if="status === 'unavailable'" class="field-help" role="status">
    <p>
      This device could not keep the screen awake. You may need to tap the
      screen during the transfer.
    </p>
    <button type="button" class="btn btn-ghost btn-sm" @click="$emit('retry')">
      Keep screen awake
    </button>
  </div>
</template>
