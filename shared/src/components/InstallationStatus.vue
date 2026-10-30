<script setup>
import { computed } from "vue";
const props = defineProps({
  status: Object,
  standalone: Boolean,
  online: Boolean,
  offlineLaunchVerified: Boolean,
  protectionBusy: Boolean,
  protectionFeedback: String,
  installAcknowledged: Boolean,
});
defineEmits(["check", "protect", "retry", "reopen"]);
const protectedStorage = computed(
  () => props.status.native || props.status.persistence === "granted",
);
const protection = computed(
  () =>
    ({
      granted: "Protection granted. Nothing to click.",
      "not-granted": "Not protected yet. Request protection below.",
      unsupported: "This browser does not support storage protection requests.",
      unavailable: "Could not check protection. Try requesting it again.",
      native:
        "The native app uses app-owned storage. No browser permission is needed.",
      checking: "Checking storage protection…",
    })[props.status.persistence],
);
</script>
<template>
  <section
    class="installation-panel stack"
    aria-labelledby="installation-heading"
  >
    <h2 id="installation-heading">Offline setup checklist</h2>
    <p v-if="!status.native">
      Ticks reflect checks performed by Latch. Keep a new, empty installation
      online through the first two steps.
    </p>
    <ol class="install-checklist">
      <li class="install-step">
        <input
          type="checkbox"
          class="checkbox checkbox-success"
          :checked="standalone || status.native"
          disabled
          aria-label="Opened as an installed app"
        />
        <div>
          <h3>
            {{
              status.native
                ? "Native app installed"
                : "Open from the Home Screen"
            }}
          </h3>
          <p v-if="status.native">You are running the installed native app.</p>
          <p v-else-if="standalone">Opened as an installed app.</p>
          <template v-else>
            <p v-if="installAcknowledged">
              Installation was reported by the browser. Open the new icon to
              verify the installed app.
            </p>
            <p v-else>
              Still in a browser tab. Latch cannot tell whether an icon already
              exists elsewhere on this device.
            </p>
            <p>
              While online, use Safari’s Share → Add to Home Screen, or your
              browser’s Install menu. Keep “Open as Web App” enabled if offered.
              Then open the QRL Latch icon while still online.
            </p>
            <p v-if="!online" class="text-warning">
              Do not add a new Home Screen icon while offline. Reconnect only if
              this instance has never held keys or has completed the maintenance
              wipe.
            </p>
          </template>
        </div>
      </li>
      <li class="install-step">
        <input
          type="checkbox"
          class="checkbox checkbox-success"
          :checked="status.state === 'ready' && (standalone || status.native)"
          disabled
          aria-label="Offline files verified in installed app"
        />
        <div>
          <h3>
            {{
              status.native
                ? "App files bundled"
                : "Verify files in the installed app"
            }}
          </h3>
          <p v-if="status.state === 'checking'" role="status">
            {{ status.phase || "Checking required files…" }}
          </p>
          <p
            v-else-if="status.state === 'error'"
            role="alert"
            class="text-error"
          >
            {{ status.error }}
          </p>
          <p v-else-if="status.native">
            Files are packaged with the app. No browser cache is used.
          </p>
          <p v-else>
            {{ status.cached }} of {{ status.total }} required files verified{{
              standalone
                ? "."
                : " in this browser tab. Repeat this check after opening the Home Screen icon."
            }}
          </p>
          <button
            class="btn btn-outline"
            type="button"
            :disabled="status.state === 'checking'"
            @click="$emit(status.state === 'error' ? 'retry' : 'check')"
          >
            {{
              status.state === "checking"
                ? "Checking offline files…"
                : "Check offline files"
            }}
          </button>
        </div>
      </li>
      <li class="install-step">
        <input
          type="checkbox"
          class="checkbox checkbox-success"
          :checked="protectedStorage"
          disabled
          aria-label="Storage protected"
        />
        <div>
          <h3>
            Protect offline storage
            <span v-if="!status.native" class="badge badge-outline"
              >Recommended</span
            >
          </h3>
          <p>{{ protection }}</p>
          <p v-if="!status.native && !protectedStorage">
            The browser decides whether to grant this request, sometimes without
            a prompt. A refusal does not block setup, but the vault remains at
            risk of eviction.
          </p>
          <button
            v-if="!protectedStorage && status.persistence !== 'unsupported'"
            type="button"
            class="btn btn-primary"
            :disabled="protectionBusy || status.persistence === 'checking'"
            @click="$emit('protect')"
          >
            <span
              v-if="protectionBusy"
              class="loading loading-spinner loading-sm"
              aria-hidden="true"
            ></span>
            {{
              protectionBusy
                ? "Requesting protection…"
                : "Protect offline storage"
            }}
          </button>
          <p v-if="protectionFeedback" role="status" aria-live="polite">
            {{ protectionFeedback }}
          </p>
        </div>
      </li>
      <li class="install-step">
        <input
          type="checkbox"
          class="checkbox checkbox-success"
          :checked="!online && (status.native || offlineLaunchVerified)"
          disabled
          aria-label="Offline launch verified"
        />
        <div>
          <h3>
            {{
              status.native
                ? "Disconnect this device"
                : "Reopen from the Home Screen offline"
            }}
          </h3>
          <p v-if="online">
            Network detected. Finish installation while this instance is empty,
            then disable any VPN, enable airplane mode, and turn off Wi-Fi and
            Bluetooth.
          </p>
          <p v-else-if="status.native">
            No network connection reported. Keep airplane mode on and Wi-Fi and
            Bluetooth off.
          </p>
          <p v-else-if="offlineLaunchVerified">
            This installed app opened offline and its required files were
            verified.
          </p>
          <p v-else>
            After the first two steps are complete, disable any VPN, enable
            airplane mode, and turn off Wi-Fi and Bluetooth. Close Latch and
            reopen its Home Screen icon. Latch
            checks the files again before you can create or restore a vault.
          </p>
          <p class="field-help">
            On iOS, an active VPN has been observed to keep the connection
            indicator online even in airplane mode with Wi-Fi and Bluetooth off.
            Disable the VPN, including automatic reconnection, then reopen Latch
            with airplane mode on and Wi-Fi and Bluetooth off. The indicator cannot prove an
            air gap; unlocking stays blocked while a connection is reported.
          </p>
          <button
            v-if="
              !status.native &&
              standalone &&
              !online &&
              !offlineLaunchVerified &&
              status.state === 'ready'
            "
            type="button"
            class="btn btn-primary"
            @click="$emit('reopen')"
          >
            Reopen offline and verify
          </button>
          <p class="field-help">
            Connection detection cannot prove this device is offline. Check that
            airplane mode is on and Wi-Fi and Bluetooth are off.
          </p>
        </div>
      </li>
    </ol>
    <p class="field-help">
      Storage protection is not a backup. Clearing app data, uninstalling or
      losing the device can still remove your vault.
    </p>
  </section>
</template>
