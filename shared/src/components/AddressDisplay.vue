<script setup>
import { computed } from "vue";
const props = defineProps({ address: { type: String, required: true } });
const groups = computed(() => props.address.slice(1).match(/.{1,8}/g) || []);
</script>
<template>
  <div class="address-display" role="img" :aria-label="address">
    <span class="address-prefix" aria-hidden="true">{{
      address.slice(0, 1)
    }}</span>
    <span class="address-body" aria-hidden="true">
      <span v-for="(group, index) in groups" :key="index">{{ group }}</span>
    </span>
  </div>
</template>
