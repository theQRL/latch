<script setup>
import { computed } from "vue";
import { normalizeChainId } from "../lib/network.js";
const props = defineProps({ modelValue: { type: String, default: "" } });
const emit = defineEmits(["update:modelValue"]);
const validation = computed(() => {
  if (!props.modelValue.trim()) return { error: "", canonical: "" };
  try {
    return { canonical: normalizeChainId(props.modelValue), error: "" };
  } catch (error) {
    return { canonical: "", error: error.message };
  }
});
</script>
<template>
  <fieldset class="stack">
    <legend>Network</legend>
    <div
      class="join"
      aria-label="Network presets unavailable during prerelease"
    >
      <button type="button" class="btn join-item" disabled>Mainnet</button>
      <button type="button" class="btn join-item" disabled>Testnet</button>
    </div>
    <p class="field-help">
      Network presets are unavailable in this prerelease. Configure your chain
      ID below.
    </p>
    <details class="collapse collapse-arrow" open>
      <summary class="collapse-title">Advanced</summary>
      <div class="collapse-content stack">
        <label class="field"
          >Custom chain ID
          <input
            class="input mono"
            name="chain-id"
            :value="modelValue"
            @input="emit('update:modelValue', $event.target.value)"
            @invalid="$event.target.closest('details').open = true"
            :aria-invalid="!!validation.error"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            maxlength="22"
            placeholder="Decimal or 0x-prefixed hexadecimal"
            required
          />
        </label>
        <p v-if="validation.error" class="text-error" role="status">
          {{ validation.error }}
        </p>
        <p v-else-if="validation.canonical" class="field-help mono">
          Stored as {{ validation.canonical }}
        </p>
        <p class="field-help">
          Verify this ID independently. It controls which chain this wallet may
          sign for. Latch does not connect to a node.
        </p>
      </div>
    </details>
  </fieldset>
</template>
