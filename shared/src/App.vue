<script setup>
import { installedContext, canInitializeVault } from "./lib/install-context.js";
import { reloadUpdatedShell } from "./lib/update-shell.js";
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import {
  LockKeyhole,
  ArrowLeft,
  ArrowRight,
  ScanLine,
  Plus,
  ShieldCheck,
  ShieldAlert,
  Settings2,
  Lock,
  X,
  Radio,
  ChevronRight,
  KeyRound,
} from "lucide-vue-next";
import { validateBackup } from "./lib/vault-backup.js";
import { saveBackupFile, saveWalletFile } from "./lib/backup-file.js";
import VaultLatch from "./components/VaultLatch.vue";
import QrReader from "./components/QrReader.vue";
import QrTransferDetails from "./components/QrTransferDetails.vue";
import QrSender from "./components/QrSender.vue";
import AddressDisplay from "./components/AddressDisplay.vue";
import PublicAddress from "./components/PublicAddress.vue";
import NetworkOptions from "./components/NetworkOptions.vue";
import { normalizeChainId } from "./lib/network.js";
import {
  readLifecycle,
  beginWipe,
  readVault,
  writeVault,
  readSetting,
  writeSetting,
  removeSetting,
} from "./lib/storage.js";
import {
  cleanupWipe,
  checkRelease,
  installRelease,
  cancelRelease,
  sealInstallation,
  requireSingleWindow,
} from "./lib/maintenance.js";
import { vaultCall, stopVault } from "./lib/vault-client.js";
import { validateUnsignedTx, formatQuanta } from "./lib/protocol.js";
import { nativeBiometrics } from "./lib/native-biometrics.js";
import {
  enrollDevice,
  unlockDevice,
  isAppleMobileBrowser,
} from "./lib/device-unlock.js";
import InstallationStatus from "./components/InstallationStatus.vue";
import { nativeBuild, isNative, monitorNative } from "./lib/platform.js";
import {
  persistenceStatus,
  cacheStatus,
  preparePwa,
  withTimeout,
} from "./lib/installation.js";
const buildId = __BUILD_ID__;
const appleMobilePwa = !isNative && isAppleMobileBrowser(navigator);
const developmentBuild = __LATCH_DEV_BUILD__;
const bootedOffline = navigator.onLine === false;
const offlineLaunchVerified = ref(false);
const protectionBusy = ref(false),
  protectionFeedback = ref("");
const installAcknowledged = ref(false);
const biometrics = ref({
  available: false,
  label: "Biometric unlock",
  reason: "Checking biometric availability…",
});
const installation = ref({
  state: "checking",
  persistence: "checking",
  cached: 0,
  total: 0,
  error: "",
  native: isNative,
  phase:
    "Keep this empty installation online until it is opened from the Home Screen and its files are verified.",
});
let installationTask = null,
  removeNativeListeners = () => {},
  disposed = false,
  nativeHidden = false;
async function verifyInstallation(requestPersistence = false) {
  if (installationTask) return installationTask;
  installation.value.state = "checking";
  ready.value = false;
  installationTask = (async () => {
    try {
      if (developmentBuild)
        throw Error(
          "Development preview cannot be installed for offline use. Run npm run build:pwa, then npm run preview, and point the HTTPS tunnel at the preview server.",
        );
      if (nativeBuild && !isNative)
        throw Error(
          "This build must run inside the installed iOS or Android app.",
        );
      if (isNative) {
        installation.value = {
          state: "ready",
          persistence: "native",
          cached: 0,
          total: 0,
          error: "",
          native: true,
        };
      } else {
        const status = await cacheStatus(
          navigator.serviceWorker?.controller,
          buildId,
        );
        const persistence = await persistenceStatus(
          navigator.storage,
          requestPersistence,
        );
        installation.value = {
          ...status,
          state: "ready",
          persistence,
          error: "",
          native: false,
        };
      }
      if (!disposed) {
        ready.value = true;
        if (!isNative && bootedOffline && standalone.value && !online.value)
          offlineLaunchVerified.value = true;
      }
    } catch (error) {
      if (!disposed) lock();
      installation.value = {
        ...installation.value,
        state: "error",
        error: error.message,
      };
    }
    return ready.value;
  })().finally(() => {
    installationTask = null;
  });
  return installationTask;
}
async function retryInstallation() {
  installation.value = { ...installation.value, state: "checking", error: "" };
  try {
    if (developmentBuild)
      throw Error(
        "Use a production build served by npm run preview for offline installation.",
      );
    if (!isNative)
      await preparePwa(navigator.serviceWorker, {
        onProgress: (phase) => {
          installation.value.phase = phase;
        },
      });
    await verifyInstallation();
  } catch (error) {
    ready.value = false;
    installation.value = {
      ...installation.value,
      state: "error",
      error: error.message,
    };
  }
}
function controllerChanged() {
  lock();
  void verifyInstallation();
}

const online = ref(nativeBuild ? true : navigator.onLine),
  ready = ref(false),
  installPrompt = ref(null),
  stored = ref(null),
  wallets = ref([]),
  unlocked = ref(false),
  page = ref("home"),
  error = ref(""),
  notice = ref(""),
  busy = ref(false),
  pass = ref(""),
  repeat = ref(""),
  selected = ref(null),
  message = ref(null),
  review = ref(null),
  outgoing = ref(null),
  acknowledged = ref(false),
  deleteConfirm = ref(""),
  device = ref(null);
const walletMode = ref("create");
const customChainId = ref("");
const form = ref({
  label: "",
  secret: "",
  password: "",
  repeat: "",
  importPassword: "",
  chainId: "",
  file: null,
});
const offlineConfirmed = ref(false),
  storageBroken = ref(false);
let epoch = 0,
  idle,
  channel,
  systemPromptUntil = 0,
  hiddenTimer;
const setupComplete = computed(() =>
  canInitializeVault({
    native: isNative,
    standalone: standalone.value,
    offlineLaunchVerified: offlineLaunchVerified.value,
  }),
);
const canUse = computed(
  () => !online.value && ready.value && (!!stored.value || setupComplete.value),
);
const grouped = (a) => a?.match(/.{1,8}/g)?.join(" ") || "";
const heading = computed(
  () =>
    ({
      add:
        walletMode.value === "create" ? "Create a wallet" : "Import a wallet",
      address: "Public address",
      network: "Wallet network",
      receive: "Receive transaction",
      review: "Review transaction",
      signed: "Return signed transaction",
      export: "Back up wallet",
      importQr: "Receive encrypted wallet",
      settings: "Settings",
      backup: "Vault backup",
      wallet: "Wallet",
      remove: "Remove wallet",
    })[page.value] || "Your wallets",
);
const lifecycle = ref({ phase: "loading" }),
  maintenanceBusy = ref(false),
  maintenanceError = ref(""),
  availableRelease = ref(null);
const wipePassword = ref(""),
  wipeText = ref(""),
  backupTested = ref(false),
  exportedFilesHandled = ref(false);
let lifecycleTimer;
let checkingUpdatedShell = false;
async function refreshLifecycle() {
  try {
    const state = await readLifecycle();
    lifecycle.value = state;
    if (state.phase !== "sealed" && unlocked.value) lock();
    if (
      state.phase === "maintenance" &&
      state.installedBuild &&
      state.installedBuild !== buildId &&
      !isNative
    ) {
      if (!checkingUpdatedShell) {
        checkingUpdatedShell = true;
        try {
          await reloadUpdatedShell(state.installedBuild);
        } catch (error) {
          maintenanceError.value = error.message;
        } finally {
          checkingUpdatedShell = false;
        }
      }
    }
  } catch (err) {
    lifecycle.value = { phase: "error" };
    maintenanceError.value = err.message;
    lock();
  }
}
async function maintenanceAction(fn) {
  if (maintenanceBusy.value) return;
  maintenanceBusy.value = true;
  maintenanceError.value = "";
  try {
    await fn();
  } catch (err) {
    maintenanceError.value =
      err.message ||
      "Could not complete this step. Your backup is still required.";
  } finally {
    maintenanceBusy.value = false;
    await refreshLifecycle();
  }
}
async function wipeForUpdate() {
  await run(async (e) => {
    assertOffline();
    if (
      !backupTested.value ||
      !exportedFilesHandled.value ||
      wipeText.value !== "WIPE THIS DEVICE"
    )
      throw Error("Complete the backup checks and type WIPE THIS DEVICE.");
    try {
      await vaultCall("verifyPassword", { password: wipePassword.value });
      if (e !== epoch) return;
      await requireSingleWindow();
      if (e !== epoch) return;
      lifecycle.value = await beginWipe();
      channel?.postMessage("maintenance");
      lock();
      await maintenanceAction(async () => {
        await cleanupWipe();
        location.reload();
      });
    } finally {
      wipePassword.value = "";
      wipeText.value = "";
    }
  });
}
async function resumeWipe() {
  await maintenanceAction(async () => {
    await cleanupWipe();
    location.reload();
  });
}
async function findUpdate() {
  await maintenanceAction(async () => {
    if (!online.value)
      throw Error("This instance is empty. Connect to check for updates.");
    availableRelease.value = await checkRelease();
  });
}
async function downloadUpdate() {
  await maintenanceAction(async () => {
    if (!online.value) throw Error("Connect to download the update.");
    await installRelease(
      availableRelease.value?.buildId || lifecycle.value.target,
    );
  });
}
async function returnOffline() {
  await maintenanceAction(async () => {
    if (online.value)
      throw Error(
        "Turn off Wi-Fi and other network connections before continuing.",
      );
    if (!(await verifyInstallation()))
      throw Error("Verify all offline files first.");
    if (online.value) throw Error("Disconnect before finishing offline setup.");
    if (
      !isNative &&
      lifecycle.value.installedBuild &&
      lifecycle.value.installedBuild !== buildId
    )
      throw Error("Close and reopen Latch to load the updated build first.");
    await sealInstallation();
    location.reload();
  });
}
const statusOpen = ref(false);
const security = ref({ current: "", next: "", repeat: "" });
const backupInput = ref(null),
  restorePassword = ref(""),
  restoreNext = ref(""),
  restoreRepeat = ref("");
const autoLockMs = ref(120000),
  deviceProgress = ref("");
let browserAuth = null;
const shieldState = computed(() =>
  installation.value.state === "checking"
    ? "checking"
    : ready.value &&
        !online.value &&
        (isNative || (standalone.value && offlineLaunchVerified.value)) &&
        (isNative || installation.value.persistence === "granted")
      ? "verified"
      : "attention",
);
function showStatus() {
  statusOpen.value = true;
  activity();
}
function reopenOffline() {
  if (online.value || !standalone.value || !ready.value || busy.value) return;
  lock();
  location.reload();
}
function closeStatus() {
  statusOpen.value = false;
  activity();
}
function startRestore() {
  if (stored.value) return;
  go("restore");
}
async function setAutoLock(event) {
  const value = Number(event.target.value);
  if (![30000, 60000, 120000, 300000].includes(value)) return;
  await run(async () => {
    await writeSetting("latch-auto-lock", String(value));
    autoLockMs.value = value;
    activity();
    notice.value = "Auto-lock updated.";
  });
}
async function changeVaultPassword() {
  await run(async (e) => {
    assertOffline();
    if (security.value.next !== security.value.repeat)
      throw Error("New passphrases do not match.");
    try {
      const result = await vaultCall("changePassword", {
        password: security.value.current,
        newPassword: security.value.next,
      });
      if (e !== epoch) return;
      // The new app key invalidates all old device wrappers, even if cleanup fails.
      const oldDevice = device.value;
      if (await apply(result, e)) {
        device.value = null;
        await removeSetting("latch-device-unlock").catch(() => {});
        if (isNative && oldDevice)
          await nativeBiometrics.remove(oldDevice).catch(() => {});
        if (e === epoch)
          notice.value =
            "Vault passphrase changed. Set up device unlock again and make a new backup. Older backups still use the old passphrase.";
      }
    } finally {
      security.value = { current: "", next: "", repeat: "" };
    }
  });
}
async function prepareBackup() {
  await run(async (e) => {
    assertOffline();
    try {
      const backup = await vaultCall("backup", {
        password: security.value.current,
      });
      if (e !== epoch) return;
      outgoing.value = backup;
      go("backup");
    } finally {
      security.value.current = "";
    }
  });
}
async function saveWholeBackup() {
  await run(async (e) => {
    assertOffline();
    const backup = outgoing.value;
    beginSystemPrompt();
    try {
      await saveBackupFile(backup);
      if (e === epoch)
        notice.value =
          "Backup file handed to your device. Check the saved copy before relying on it.";
    } finally {
      endSystemPrompt();
    }
  });
}
function receiveBackup(value) {
  try {
    assertOffline();
    if (stored.value) throw Error("Restore needs a fresh installation.");
    backupInput.value = validateBackup(value);
    error.value = "";
  } catch (err) {
    error.value = err.message;
  }
}
async function pickBackup(event) {
  endSystemPrompt();
  await run(async (e) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 1600000) throw Error("Backup file is too large.");
      const value = JSON.parse(await file.text());
      if (e === epoch) receiveBackup(value);
    } finally {
      event.target.value = "";
    }
  });
}
async function restoreWholeVault() {
  await run(async (e) => {
    if (!(await verifyInstallation()) || e !== epoch) return;
    assertOffline();
    const existing = await readVault();
    if (e !== epoch) return;
    if (stored.value || existing)
      throw Error(
        "Restore needs a fresh installation. Existing wallets were not changed.",
      );
    if (restoreNext.value !== restoreRepeat.value)
      throw Error("New passphrases do not match.");
    try {
      const result = await vaultCall("restore", {
        backup: backupInput.value,
        password: restorePassword.value,
        newPassword: restoreNext.value,
      });
      if (await apply(result, e)) {
        unlocked.value = true;
        device.value = null;
        await removeSetting("latch-device-unlock").catch(() => {});
        if (e !== epoch) return;
        backupInput.value = null;
        go("home");
        notice.value =
          "Vault restored. Wallet passwords are unchanged. Set up device unlock on this device if wanted.";
      }
    } finally {
      restorePassword.value = "";
      restoreNext.value = "";
      restoreRepeat.value = "";
    }
  });
}
async function testDeviceUnlock() {
  await run(async (e) => {
    assertOffline();
    beginSystemPrompt();
    browserAuth = new AbortController();
    let prf;
    try {
      prf = await (isNative
        ? nativeBiometrics.unlock(device.value)
        : unlockDevice(device.value, { signal: browserAuth.signal }));
      if (e !== epoch) return;
      await vaultCall("testDevice", { prf, wrapper: device.value.wrapper });
      if (e === epoch)
        notice.value =
          "Device unlock verified. It is ready on the lock screen.";
    } finally {
      prf?.fill(0);
      if (e === epoch) {
        browserAuth = null;
        endSystemPrompt();
      }
    }
  });
}
function assertOffline() {
  if (lifecycle.value.phase !== "sealed")
    throw Error("Finish maintenance before using the vault.");
  if (storageBroken.value)
    throw Error(
      "Stored vault could not be read. Recover from a backup on a fresh installation.",
    );
  if (online.value)
    throw Error(
      "Disable any VPN, turn on airplane mode, and turn off Wi-Fi and Bluetooth before unlocking Latch.",
    );
  if (!ready.value) throw Error("Finish installing the offline app first.");
  if (!stored.value && !setupComplete.value)
    throw Error(
      "Open Latch from the Home Screen while online, verify its files, then disconnect and close and reopen it before creating or restoring a vault.",
    );
}
function lock() {
  wipePassword.value = "";
  wipeText.value = "";
  backupTested.value = false;
  exportedFilesHandled.value = false;
  browserAuth?.abort();
  browserAuth = null;
  deviceProgress.value = "";
  security.value = { current: "", next: "", repeat: "" };
  restorePassword.value = "";
  restoreNext.value = "";
  restoreRepeat.value = "";
  backupInput.value = null;
  if (isNative) void nativeBiometrics.cancel().catch(() => {});
  epoch++;
  systemPromptUntil = 0;
  clearTimeout(hiddenTimer);
  stopVault();
  unlocked.value = false;
  wallets.value = [];
  selected.value = null;
  message.value = null;
  review.value = null;
  outgoing.value = null;
  pass.value = "";
  repeat.value = "";
  form.value = {
    label: "",
    secret: "",
    password: "",
    repeat: "",
    importPassword: "",
    chainId: "",
    file: null,
  };
  page.value = "home";
  busy.value = false;
  clearTimeout(idle);
}
function activity() {
  clearTimeout(idle);
  if (unlocked.value) idle = setTimeout(lock, autoLockMs.value);
}
function connection(connected) {
  if (isNative && typeof connected !== "boolean") return;
  online.value = typeof connected === "boolean" ? connected : navigator.onLine;
  if (online.value) {
    lock();
    notice.value = "Latch locked because a network connection was detected.";
  }
}
// Native pickers can hide the page. Permit a bounded interval only for those
// explicit prompts; reconnect, inactivity, and explicit lock still lock immediately.
function beginSystemPrompt() {
  systemPromptUntil = Date.now() + 30000;
}
function endSystemPrompt() {
  // Native completion may precede visibilitychange. Never extend the original
  // deadline or restore grace after an explicit/reconnection/inactivity lock.
  systemPromptUntil =
    document.hidden || nativeHidden
      ? Math.min(systemPromptUntil, Date.now() + 1500)
      : 0;
  visibility();
}
function visibility() {
  clearTimeout(hiddenTimer);
  if (!document.hidden && !nativeHidden) return;
  const remaining = systemPromptUntil - Date.now();
  if (remaining > 0) hiddenTimer = setTimeout(lock, remaining);
  else lock();
}
function go(target) {
  security.value = { current: "", next: "", repeat: "" };
  restorePassword.value = "";
  restoreNext.value = "";
  restoreRepeat.value = "";
  if (target !== "restore") backupInput.value = null;
  page.value = target;
  error.value = "";
  notice.value = "";
  pass.value = "";
  acknowledged.value = false;
  deleteConfirm.value = "";
  activity();
}
async function run(fn) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  const e = epoch;
  try {
    await refreshLifecycle();
    if (e !== epoch || lifecycle.value.phase !== "sealed") return;
    await fn(e);
  } catch (err) {
    if (epoch === e)
      error.value = err.message || "Could not complete this action";
  } finally {
    if (epoch === e) busy.value = false;
  }
}
async function apply(result, e) {
  if (epoch !== e || online.value) return false;
  if (result.encrypted) {
    try {
      if (JSON.stringify(await readVault()) !== JSON.stringify(stored.value))
        throw Error("Vault changed in another window. Reopen Latch.");
      if (epoch !== e || online.value) return false;
      await writeVault(result.encrypted);
      stored.value = result.encrypted;
    } catch (e) {
      lock();
      error.value = e.message;
      return false;
    }
  }
  if (epoch !== e || online.value) return false;
  if (result.wallets) wallets.value = result.wallets;
  return true;
}
async function openApp() {
  await run(async (e) => {
    if (!(await verifyInstallation()) || e !== epoch) return;
    stored.value = await readVault();
    if (e !== epoch) return;
    assertOffline();
    if (
      !stored.value &&
      (!offlineConfirmed.value || pass.value !== repeat.value)
    )
      throw Error("Confirm your offline setup and enter matching passphrases.");
    try {
      const r = await vaultCall(stored.value ? "unlock" : "create", {
        password: pass.value,
        encrypted: stored.value,
      });
      if (await apply(r, e)) {
        unlocked.value = true;
        activity();
      }
    } finally {
      pass.value = "";
      repeat.value = "";
    }
  });
}
async function deviceOpen() {
  await run(async (e) => {
    if (!(await verifyInstallation()) || e !== epoch) return;
    assertOffline();
    beginSystemPrompt();
    let prf;
    browserAuth = new AbortController();
    try {
      prf = await (isNative
        ? nativeBiometrics.unlock(device.value)
        : unlockDevice(device.value, { signal: browserAuth.signal }));
    } finally {
      if (e === epoch) {
        browserAuth = null;
        deviceProgress.value = "";
        endSystemPrompt();
      }
    }
    try {
      if (e !== epoch) return;
      assertOffline();
      const r = await vaultCall("unlockDevice", {
        prf,
        wrapper: device.value.wrapper,
        encrypted: stored.value,
      });
      if (await apply(r, e)) {
        unlocked.value = true;
        activity();
      }
    } finally {
      prf.fill(0);
    }
  });
}
async function enableDevice() {
  await run(async (e) => {
    assertOffline();
    beginSystemPrompt();
    let settings,
      committed = false;
    browserAuth = new AbortController();
    deviceProgress.value = "Waiting for device authentication…";
    try {
      settings = await (isNative
        ? nativeBiometrics.enroll()
        : enrollDevice({
            signal: browserAuth.signal,
            onPhase: (phase) => {
              if (e !== epoch)
                throw Error(
                  "Setup cancelled. Unlock Latch vault to try again.",
                );
              deviceProgress.value = phase;
              beginSystemPrompt();
              activity();
            },
          }));
    } finally {
      if (e === epoch) {
        browserAuth = null;
        deviceProgress.value = "";
        endSystemPrompt();
      }
    }
    try {
      if (e !== epoch) return;
      assertOffline();
      const wrapper = await vaultCall("enableDevice", { prf: settings.prf });
      if (e !== epoch) return;
      const next = {
        kind: settings.kind,
        credential: settings.credential,
        salt: settings.salt,
        wrapper,
      };
      await writeSetting("latch-device-unlock", JSON.stringify(next));
      committed = true;
      device.value = next;
      if (e !== epoch) return;
      notice.value =
        "Device unlock enabled. Keep your vault passphrase as your recovery method.";
    } finally {
      settings.prf.fill(0);
      if (isNative && !committed) await nativeBiometrics.remove(settings);
    }
  });
}
async function disableDevice() {
  await run(async () => {
    if (isNative && device.value) await nativeBiometrics.remove(device.value);
    await removeSetting("latch-device-unlock");
    device.value = null;
    notice.value = "Device unlock removed.";
  });
}
function addWalletScreen(mode) {
  walletMode.value = mode;
  form.value.secret = "";
  form.value.file = null;
  form.value.importPassword = "";
  form.value.password = "";
  form.value.repeat = "";
  go("add");
}
async function addWallet() {
  await run(async (e) => {
    assertOffline();
    if (form.value.password !== form.value.repeat)
      throw Error("Wallet passphrases do not match");
    try {
      const r = await vaultCall(
        walletMode.value === "create" ? "generate" : "add",
        { ...form.value, chainId: normalizeChainId(form.value.chainId) },
      );
      if (await apply(r, e)) {
        selected.value = r.wallets[r.wallets.length - 1];
        go("wallet");
        notice.value =
          walletMode.value === "create"
            ? "Wallet created and encrypted. Back up this wallet before receiving funds."
            : "Wallet imported and encrypted. Back up this wallet before using it.";
        form.value = {
          label: "",
          secret: "",
          password: "",
          repeat: "",
          importPassword: "",
          chainId: "",
          file: null,
        };
      }
    } finally {
      form.value.secret = "";
      form.value.password = "";
      form.value.repeat = "";
      form.value.importPassword = "";
    }
  });
}
async function pickFile(event) {
  endSystemPrompt();
  if (!unlocked.value) {
    event.target.value = "";
    return;
  }
  await run(async (e) => {
    const f = event.target.files?.[0];
    if (!f) return;
    if (f.size > 100000) throw Error("Wallet file is too large");
    const parsed = JSON.parse(await f.text());
    if (e !== epoch) return;
    assertOffline();
    form.value.file =
      parsed.type === "qrl-encrypted-wallet" ? parsed.wallet : parsed;
    notice.value = "Encrypted wallet loaded. Enter its password below.";
    event.target.value = "";
  });
}
function receiveWallet(msg) {
  if (
    msg?.type !== "qrl-encrypted-wallet" ||
    msg.version !== 1 ||
    msg.wallet?.purpose !== "wallet"
  ) {
    error.value = "This QR transfer is not an encrypted Latch wallet";
    return;
  }
  walletMode.value = "import";
  form.value.file = msg.wallet;
  go("add");
  notice.value =
    "Encrypted wallet received. Choose and verify the network on this device.";
}
function receiveTx(msg) {
  try {
    assertOffline();
    const w = selected.value;
    const checked = validateUnsignedTx(msg, {
      ...w,
      chainIds: new Set(w.chainIds.map(BigInt)),
    });
    message.value = structuredClone(msg);
    review.value = checked;
    go("review");
  } catch (e) {
    error.value = e.message;
  }
}
async function sign() {
  await run(async (e) => {
    assertOffline();
    if (!acknowledged.value)
      throw Error("Confirm that you checked all transaction details");
    try {
      const signed = await vaultCall("sign", {
        id: selected.value.id,
        message: message.value,
        password: pass.value,
      });
      assertOffline();
      if (e !== epoch) return;
      outgoing.value = signed;
      go("signed");
    } finally {
      pass.value = "";
    }
  });
}
const networkChangeConfirmed = ref(false);
async function saveNetwork() {
  await run(async (e) => {
    assertOffline();
    if (!networkChangeConfirmed.value)
      throw Error("Confirm the network change before saving.");
    const id = selected.value.id;
    const result = await vaultCall("setNetwork", {
      id,
      chainId: normalizeChainId(customChainId.value),
    });
    if (await apply(result, e)) {
      selected.value = result.wallets.find((w) => w.id === id);
      message.value = null;
      review.value = null;
      outgoing.value = null;
      go("wallet");
      notice.value = "Network settings saved for this wallet.";
    }
  });
}
async function exportWallet() {
  await run(async (e) => {
    assertOffline();
    const payload = await vaultCall("export", { id: selected.value.id });
    if (e !== epoch) return;
    outgoing.value = payload;
    go("export");
  });
}
async function saveIndividualBackup() {
  await run(async (e) => {
    assertOffline();
    beginSystemPrompt();
    try {
      await saveWalletFile(outgoing.value);
      if (e === epoch)
        notice.value =
          "Wallet backup handed to your device. Check the saved copy before relying on it.";
    } finally {
      endSystemPrompt();
    }
  });
}
async function removeWallet() {
  await run(async (e) => {
    assertOffline();
    if (deleteConfirm.value !== selected.value.label)
      throw Error("Enter the wallet name to confirm");
    const result = await vaultCall("remove", { id: selected.value.id });
    if (await apply(result, e)) {
      selected.value = null;
      go("home");
      notice.value = "Wallet removed from this installation.";
    }
  });
}
async function protectStorage() {
  if (protectionBusy.value || isNative) return;
  protectionBusy.value = true;
  protectionFeedback.value = "Requesting storage protection…";
  try {
    const result = await persistenceStatus(navigator.storage, true);
    if (disposed) return;
    installation.value.persistence = result;
    protectionFeedback.value = {
      granted: "Protection granted. No further action is needed here.",
      "not-granted":
        "The browser did not grant protection. Reopen from the Home Screen and try again. Keep a separate backup either way.",
      unsupported:
        "This browser cannot request persistent storage. Keep a separate backup; this step cannot be completed here.",
      unavailable: "The browser could not check protection. Try again.",
    }[result];
  } finally {
    protectionBusy.value = false;
  }
}
async function install() {
  if (developmentBuild || !online.value || installation.value.state !== "ready")
    return;
  if (installPrompt.value) {
    try {
      await installPrompt.value.prompt();
    } finally {
      installPrompt.value = null;
    }
  }
}
const standalone = ref(installedContext(navigator, matchMedia));
const displayMode = matchMedia(
  "(display-mode: standalone), (display-mode: window-controls-overlay)",
);
function refreshDisplayMode() {
  standalone.value = installedContext(navigator, matchMedia);
}
function installed() {
  installAcknowledged.value = true;
  installPrompt.value = null;
  refreshDisplayMode();
}
function beforeInstall(e) {
  e.preventDefault();
  installPrompt.value = e;
}
function refreshBiometrics() {
  void withTimeout(
    nativeBiometrics.availability(),
    5000,
    "Biometric availability timed out",
  )
    .then((value) => {
      if (!disposed) biometrics.value = value;
    })
    .catch(() => {
      if (!disposed)
        biometrics.value = {
          available: false,
          label: "Biometric unlock",
          reason: "Biometrics unavailable. Use your vault passphrase.",
        };
    });
}
onMounted(async () => {
  await refreshLifecycle();
  lifecycleTimer = setInterval(refreshLifecycle, 1500);
  if (isNative) refreshBiometrics();
  try {
    const savedDelay = Number(await readSetting("latch-auto-lock"));
    if ([30000, 60000, 120000, 300000].includes(savedDelay))
      autoLockMs.value = savedDelay;
  } catch {}
  try {
    stored.value = await readVault();
  } catch {
    storageBroken.value = true;
    error.value =
      "Stored vault could not be read. Do not clear app data unless you have a backup.";
  }
  try {
    device.value = JSON.parse(
      (await readSetting("latch-device-unlock")) || "null",
    );
  } catch {
    device.value = null;
    notice.value =
      "Device unlock settings could not be read. Use your vault passphrase.";
  }
  addEventListener("online", connection);
  addEventListener("offline", connection);
  document.addEventListener("visibilitychange", visibility);
  addEventListener("pointerdown", activity);
  addEventListener("keydown", activity);
  addEventListener("beforeinstallprompt", beforeInstall);
  addEventListener("appinstalled", installed);
  addEventListener("pageshow", refreshDisplayMode);
  displayMode.addEventListener?.("change", refreshDisplayMode);
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("latch-exclusive");
    channel.onmessage = () => {
      lock();
      notice.value =
        "Latch was opened in another window. Use one window at a time.";
    };
    channel.postMessage("opened");
  }
  try {
    if (developmentBuild)
      throw Error(
        "Development preview is online-only. Build the PWA and serve its production preview before adding it to the Home Screen.",
      );
    if (isNative) {
      removeNativeListeners = await monitorNative(
        connection,
        () => {
          nativeHidden = true;
          visibility();
        },
        () => {
          nativeHidden = false;
          refreshBiometrics();
          visibility();
          void verifyInstallation();
        },
      );
      if (disposed) {
        removeNativeListeners();
        return;
      }
    } else {
      await preparePwa(navigator.serviceWorker, {
        onProgress: (phase) => {
          installation.value.phase = phase;
        },
      });
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        controllerChanged,
      );
    }
    if (!disposed) await verifyInstallation();
  } catch (error) {
    installation.value = {
      ...installation.value,
      state: "error",
      error: error.message,
    };
  }
});
onBeforeUnmount(() => {
  removeEventListener("beforeinstallprompt", beforeInstall);
  removeEventListener("appinstalled", installed);
  removeEventListener("pageshow", refreshDisplayMode);
  displayMode.removeEventListener?.("change", refreshDisplayMode);
  clearInterval(lifecycleTimer);
  disposed = true;
  lock();
  removeNativeListeners();
  navigator.serviceWorker?.removeEventListener(
    "controllerchange",
    controllerChanged,
  );
  channel?.close();
  removeEventListener("online", connection);
  removeEventListener("offline", connection);
  document.removeEventListener("visibilitychange", visibility);
  removeEventListener("pointerdown", activity);
  removeEventListener("keydown", activity);
});
</script>

<template>
  <div class="app-shell isolate antialiased">
    <header class="topbar">
      <a href="/" aria-label="Latch home" class="wordmark"
        ><img src="/qrl-logo.svg" alt="QRL" width="76" height="27" /><i></i
        ><span>Latch</span></a
      >
      <div class="header-actions">
        <button
          type="button"
          class="btn btn-ghost btn-square installation-shield"
          :class="`shield-${shieldState}`"
          :aria-label="
            shieldState === 'verified'
              ? 'Installation verified. View status'
              : shieldState === 'checking'
                ? 'Checking installation. View status'
                : 'Installation or connection needs attention. View status'
          "
          :aria-expanded="statusOpen"
          @click="statusOpen ? closeStatus() : showStatus()"
        >
          <ShieldCheck
            v-if="shieldState === 'verified'"
            :size="24"
          /><ShieldAlert v-else :size="24" />
          <span
            v-if="shieldState === 'attention'"
            class="shield-exclamation"
            aria-hidden="true"
            >!</span
          >
        </button>
        <span class="connection" :class="online ? 'is-online' : 'is-offline'"
          ><span class="status-dot"></span
          >{{ online ? "Network detected" : "Offline" }}</span
        ><button
          v-if="unlocked"
          type="button"
          class="icon-button"
          aria-label="Lock Latch"
          @click="lock"
        >
          <Lock :size="16" />
        </button>
      </div>
    </header>
    <main id="main" class="main-content" @pointerdown="activity">
      <div v-if="developmentBuild" class="alert alert-warning" role="alert">
        Development preview · online only. Do not install this version or import
        keys. Use a production build for offline testing.
      </div>
      <div v-if="notice" class="notice" role="status">{{ notice }}</div>
      <div v-if="error" class="notice danger" role="alert">{{ error }}</div>
      <section
        v-if="lifecycle.phase !== 'sealed'"
        class="stack maintenance-screen"
      >
        <p class="eyebrow">Maintenance</p>
        <h1>
          {{
            lifecycle.phase === "loading"
              ? "Checking device state…"
              : lifecycle.phase === "wiping"
                ? "Finish clearing this device"
                : lifecycle.phase === "downloading"
                  ? "Installing your update"
                  : lifecycle.phase === "error"
                    ? "Storage needs attention"
                    : "No vault stored"
          }}
        </h1>
        <p v-if="maintenanceError" class="notice danger" role="alert">
          {{ maintenanceError }}
        </p>
        <template v-if="lifecycle.phase === 'wiping'">
          <p>
            Keep this device offline. Cleanup must finish before it can be
            updated. Your other device is now your recovery copy.
          </p>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="maintenanceBusy || online"
            @click="resumeWipe"
          >
            {{ maintenanceBusy ? "Clearing app data…" : "Finish cleanup" }}
          </button>
        </template>
        <template
          v-else-if="
            lifecycle.phase === 'maintenance' ||
            lifecycle.phase === 'downloading'
          "
        >
          <p>
            Wallet creation and signing are disabled. Keep your verified backup
            on the other offline device.
          </p>
          <p class="mono">Installed build {{ buildId }}</p>
          <template v-if="!isNative">
            <button
              v-if="lifecycle.phase === 'maintenance'"
              type="button"
              class="btn btn-primary"
              :disabled="maintenanceBusy"
              @click="findUpdate"
            >
              {{ maintenanceBusy ? "Checking…" : "Check for updates" }}
            </button>
            <p v-if="availableRelease" role="status">
              {{
                availableRelease.buildId === buildId
                  ? "You have the current release."
                  : `Available: ${availableRelease.buildId}`
              }}
            </p>
            <button
              v-if="
                availableRelease &&
                availableRelease.buildId !== buildId &&
                lifecycle.phase === 'maintenance'
              "
              type="button"
              class="btn btn-primary"
              :disabled="maintenanceBusy"
              @click="downloadUpdate"
            >
              Download and install
            </button>
            <template v-if="lifecycle.phase === 'downloading'">
              <p role="status">
                Downloading and verifying offline files. Latch will reopen when
                the complete release is ready. If the download fails, reconnect
                and retry.
              </p>
              <button
                type="button"
                class="btn btn-outline"
                :disabled="maintenanceBusy"
                @click="downloadUpdate"
              >
                Retry download
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                :disabled="maintenanceBusy"
                @click="maintenanceAction(cancelRelease)"
              >
                Cancel failed download
              </button>
            </template>
          </template>
          <template v-else>
            <h2>Install a signed app update</h2>
            <p>
              You can now reconnect this empty device. Close Latch and update it
              through your trusted distribution channel. Android requires a
              release signed by the same publisher; iOS uses its signed
              distribution channel.
            </p>
            <p>
              Reopen Latch after installation. This maintenance state will
              remain until you choose to return offline.
            </p>
          </template>
          <button
            v-if="lifecycle.phase === 'maintenance'"
            type="button"
            class="btn btn-outline"
            :disabled="maintenanceBusy || online"
            @click="returnOffline"
          >
            Finish offline setup
          </button>
          <p class="field-help">
            After updating, disconnect and finish offline setup before restoring
            by QR. Keep the backup device intact until the restored wallets have
            been tested.
          </p>
        </template>
        <p v-else-if="lifecycle.phase === 'error'">
          Do not clear app data. Close and reopen Latch; use your verified
          backup on another device if storage remains unavailable.
        </p>
      </section>
      <section v-else-if="statusOpen" class="stack status-screen">
        <div class="page-heading">
          <button
            type="button"
            class="btn btn-ghost btn-square status-back"
            aria-label="Back to vault"
            @click="closeStatus"
          >
            <ArrowLeft :size="24" />
          </button>
          <h1>Installation & storage</h1>
        </div>
        <p v-if="online" class="notice danger">
          Network detected. Disconnect before unlocking or importing keys.
        </p>
        <InstallationStatus
          :status="installation"
          :standalone="isNative || standalone"
          :online="online"
          :offline-launch-verified="offlineLaunchVerified"
          :protection-busy="protectionBusy"
          :protection-feedback="protectionFeedback"
          :install-acknowledged="installAcknowledged"
          @check="verifyInstallation()"
          @protect="protectStorage"
          @retry="retryInstallation"
          @reopen="reopenOffline"
        />
        <button
          v-if="installPrompt && !standalone"
          type="button"
          class="btn btn-primary"
          :disabled="!online || installation.state !== 'ready'"
          @click="install"
        >
          Add to Home Screen
        </button>
      </section>
      <section v-else-if="page === 'restore' && !stored" class="stack">
        <div class="page-heading">
          <button
            type="button"
            class="btn btn-ghost btn-square"
            aria-label="Back to vault"
            @click="go('home')"
          >
            <ArrowLeft :size="20" />
          </button>
          <h1>Restore vault</h1>
        </div>
        <p>
          Import a whole-vault backup from your old Latch. Your wallet passwords
          will stay the same.
        </p>
        <p v-if="!canUse" class="notice">
          Verify installation and disconnect before restoring.
        </p>
        <template v-else>
          <label class="field"
            >Encrypted backup file<input
              name="vault-backup"
              type="file"
              accept=".json,application/json"
              class="file-input"
              @click="beginSystemPrompt"
              @cancel="endSystemPrompt"
              @change="pickBackup"
              :disabled="busy"
          /></label>
          <details v-if="!backupInput" class="collapse collapse-arrow">
            <summary class="collapse-title">Scan backup QR codes</summary>
            <div class="collapse-content">
              <QrReader
                @message="receiveBackup"
                @prompt-start="beginSystemPrompt"
                @prompt-end="endSystemPrompt"
              />
            </div>
          </details>
          <form
            v-if="backupInput"
            class="stack"
            @submit.prevent="restoreWholeVault"
          >
            <p class="notice success">Encrypted backup loaded.</p>
            <label class="field"
              >Backup's vault passphrase<input
                name="restore-password"
                type="password"
                class="input"
                v-model="restorePassword"
                maxlength="1024"
                required
                autocomplete="current-password"
            /></label>
            <label class="field"
              >Vault passphrase for this device<input
                name="restore-new-password"
                type="password"
                class="input"
                v-model="restoreNext"
                minlength="16"
                maxlength="1024"
                required
                autocomplete="new-password"
            /></label>
            <label class="field"
              >Repeat new passphrase<input
                name="restore-repeat-password"
                type="password"
                class="input"
                v-model="restoreRepeat"
                minlength="16"
                maxlength="1024"
                required
                autocomplete="new-password"
            /></label>
            <button type="submit" class="btn btn-primary" :disabled="busy">
              {{ busy ? "Verifying backup…" : "Restore all wallets" }}
            </button>
          </form>
        </template>
      </section>
      <template v-else-if="!unlocked">
        <section class="welcome">
          <VaultLatch />
          <p class="eyebrow">Offline signing vault</p>
          <h1>
            {{
              stored
                ? "Post-quantum, airgapped transactions"
                : "Secure here.\nSign anywhere."
            }}
          </h1>
          <p class="intro">
            {{
              stored
                ? "Unlock your vault to review and sign. Your keys stay on this device."
                : "A dedicated home for your QRL keys. Review every transaction. Release only the signature."
            }}
          </p>
        </section>
        <section v-if="!canUse" class="stack centered">
          <button type="button" class="btn btn-outline" @click="showStatus">
            {{ ready ? "View offline setup" : "Finish installation"
            }}<ChevronRight :size="16" />
          </button>
        </section>
        <form v-else class="unlock-form stack" @submit.prevent="openApp">
          <label class="field"
            >{{ stored ? "Vault passphrase" : "Create a vault passphrase"
            }}<input
              name="app-passphrase"
              class="input"
              type="password"
              v-model="pass"
              :autocomplete="stored ? 'current-password' : 'new-password'"
              :minlength="stored ? 1 : 16"
              maxlength="1024"
              required
              placeholder="Your vault passphrase" /></label
          ><template v-if="!stored"
            ><p class="field-help">
              Use at least 16 characters. Several random words are easier to
              remember. Each wallet will have its own passphrase too.
            </p>
            <label class="field"
              >Repeat vault passphrase<input
                name="repeat-app-passphrase"
                class="input"
                type="password"
                v-model="repeat"
                autocomplete="new-password"
                required /></label
            ><label class="check-row"
              ><input
                name="offline-confirmation"
                type="checkbox"
                class="checkbox"
                v-model="offlineConfirmed"
                required
              /><span
                >I have turned off Wi-Fi and Bluetooth and will keep this device
                offline.</span
              ></label
            ></template
          ><button type="submit" class="btn btn-primary" :disabled="busy">
            {{
              busy
                ? "Opening vault…"
                : stored
                  ? "Unlock Latch vault"
                  : "Create offline vault"
            }}<ArrowRight :size="16" /></button
          ><button
            v-if="stored && device"
            type="button"
            class="btn btn-outline"
            :disabled="busy"
            @click="deviceOpen"
          >
            {{
              isNative
                ? `Unlock with ${biometrics.label}`
                : "Unlock with this device"
            }}
          </button>
          <p class="field-help centered">
            {{
              stored
                ? "Your wallet passphrases are still required to sign."
                : "Check that airplane mode is on and Wi-Fi and Bluetooth are off."
            }}
          </p>
        </form>
        <button
          v-if="!stored && canUse"
          type="button"
          class="btn btn-ghost restore-entry"
          @click="startRestore"
        >
          Restore an existing vault
        </button>
      </template>
      <template v-else>
        <div class="page-heading">
          <button
            v-if="page !== 'home'"
            type="button"
            class="icon-button"
            aria-label="Back to wallets"
            @click="
              go('home');
              outgoing = null;
              message = null;
              review = null;
            "
          >
            <ArrowLeft :size="16" />
          </button>
          <div>
            <p class="eyebrow">
              {{ page === "home" ? "Vault unlocked" : "QRL | Latch" }}
            </p>
            <h1>{{ heading }}</h1>
          </div>
          <button
            v-if="page === 'home'"
            type="button"
            class="icon-button"
            aria-label="Device and security settings"
            @click="go('settings')"
          >
            <Settings2 :size="16" />
          </button>
        </div>
        <template v-if="page === 'home'"
          ><div v-if="!wallets.length" class="empty-state">
            <VaultLatch open />
            <h2>Airgapped QRL v2.0 Signer</h2>
            <p>
              Create a QRL v2.0 wallet or import one you already own. Latch
              stores each wallet encrypted, inside your encrypted app vault.
            </p>
          </div>
          <div v-else class="wallet-list">
            <button
              v-for="w in wallets"
              :key="w.id"
              type="button"
              class="wallet-card"
              @click="
                selected = w;
                go('wallet');
              "
            >
              <div class="wallet-card-title">
                <LockKeyhole :size="16" /><strong>{{ w.label }}</strong
                ><ChevronRight :size="16" />
              </div>
              <p class="network-label">{{ w.chainIds[0] }}</p>
              <p class="address-preview">
                {{ w.address.slice(0, 17) }}…{{ w.address.slice(-12) }}
              </p>
              <div class="wallet-card-footer">
                Wallet locked <span>ML-DSA-87</span>
              </div>
            </button>
          </div>
          <div class="button-row">
            <button
              type="button"
              class="btn btn-primary"
              @click="addWalletScreen('create')"
            >
              <Plus :size="16" />Create wallet
            </button>
            <button
              type="button"
              class="btn btn-outline"
              @click="addWalletScreen('import')"
            >
              Import wallet
            </button>
          </div>
        </template>
        <form v-if="page === 'add'" class="stack" @submit.prevent="addWallet">
          <p class="intro">
            {{
              walletMode === "create"
                ? "Generate a new QRL v2.0 wallet on this offline device."
                : "Import a QRL v2.0 wallet."
            }}
            Give it its own passphrase, separate from your vault passphrase.
          </p>
          <div v-if="walletMode === 'import'" class="button-row">
            <label class="btn btn-outline file-button"
              >Open encrypted file<input
                name="wallet-file"
                type="file"
                accept=".json,application/json"
                @click="beginSystemPrompt"
                @cancel="endSystemPrompt"
                @change="pickFile" /></label
            ><button
              type="button"
              class="btn btn-outline"
              @click="go('importQr')"
            >
              Scan wallet QR
            </button>
          </div>
          <label class="field"
            >Wallet name<input
              name="wallet-name"
              class="input"
              v-model="form.label"
              maxlength="60"
              placeholder="Long-term savings"
              required /></label
          ><label v-if="walletMode === 'import' && !form.file" class="field"
            >Mnemonic or hexseed<textarea
              name="wallet-secret"
              class="textarea secret"
              v-model="form.secret"
              autocomplete="off"
              autocapitalize="off"
              :spellcheck="false"
              rows="4"
              required
              placeholder="Enter your existing QRL mnemonic"
            ></textarea></label
          ><template v-else-if="walletMode === 'import' && form.file"
            ><div class="notice">
              Encrypted file selected.
              <button
                type="button"
                class="text-button"
                @click="form.file = null"
              >
                Use a mnemonic instead
              </button>
            </div>
            <label class="field"
              >Existing wallet password<input
                name="import-password"
                class="input"
                type="password"
                v-model="form.importPassword"
                autocomplete="off"
                required /></label
          ></template>
          <NetworkOptions v-model="form.chainId" />
          <label class="field"
            >New wallet passphrase<input
              name="wallet-password"
              class="input"
              type="password"
              v-model="form.password"
              minlength="16"
              maxlength="1024"
              autocomplete="new-password"
              required /></label
          ><label class="field"
            >Repeat wallet passphrase<input
              name="wallet-repeat"
              class="input"
              type="password"
              v-model="form.repeat"
              minlength="16"
              autocomplete="new-password"
              required /></label
          ><button type="submit" class="btn btn-primary" :disabled="busy">
            {{
              busy
                ? "Encrypting wallet…"
                : walletMode === "create"
                  ? "Create encrypted wallet"
                  : "Import encrypted wallet"
            }}
          </button>
        </form>
        <template v-if="page === 'wallet' && selected"
          ><section class="wallet-detail stack">
            <p class="eyebrow">{{ selected.names[selected.chainIds[0]] }}</p>
            <h2>{{ selected.label }}</h2>
            <AddressDisplay :address="selected.address" />
            <p class="field-help">Chain ID {{ selected.chainIds[0] }}</p>
            <button
              type="button"
              class="btn btn-primary"
              @click="go('receive')"
            >
              <ScanLine :size="16" />Sign a transaction
            </button>
            <button
              type="button"
              class="btn btn-outline"
              @click="
                customChainId = selected.chainIds[0];
                networkChangeConfirmed = false;
                go('network');
              "
            >
              Network settings
            </button>
            <button
              type="button"
              class="btn btn-outline"
              @click="go('address')"
            >
              Public address · text &amp; QR
            </button>
            <button
              type="button"
              class="btn btn-outline"
              :disabled="busy"
              @click="exportWallet"
            >
              Back up this wallet</button
            ><button
              type="button"
              class="btn btn-outline btn-error"
              @click="go('remove')"
            >
              Remove wallet
            </button>
          </section></template
        >
        <form
          v-if="page === 'network' && selected"
          class="stack"
          @submit.prevent="saveNetwork"
        >
          <h2>{{ selected.label }}</h2>
          <NetworkOptions
            v-model="customChainId"
            @update:model-value="networkChangeConfirmed = false"
          />
          <div class="alert alert-warning" role="note">
            Changing networks for an existing wallet is discouraged. The same
            keys and address can control funds on multiple networks. Changing
            this chain ID changes which transactions Latch allows you to sign;
            it does not move funds or prove which network the online wallet
            uses. Verify the chain ID independently and review it before
            signing.
          </div>
          <label class="check-row">
            <input
              type="checkbox"
              class="checkbox"
              v-model="networkChangeConfirmed"
              required
            />
            <span
              >I understand this replaces the wallet’s allowed chain ID.</span
            >
          </label>
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="busy || !networkChangeConfirmed"
          >
            Save network settings
          </button>
          <button type="button" class="btn btn-ghost" @click="go('wallet')">
            Cancel
          </button>
        </form>
        <section v-if="page === 'address' && selected" class="stack">
          <h2>{{ selected.label }}</h2>
          <p class="eyebrow">
            {{ selected.names[selected.chainIds[0]] }} ·
            {{ selected.chainIds[0] }}
          </p>
          <PublicAddress :key="selected.id" :address="selected.address" />
        </section>
        <template v-if="page === 'receive'"
          ><p class="intro">
            Scan the request displayed by a Latch-compatible wallet. You will
            review every signed field before unlocking the wallet.
          </p>
          <QrReader
            @prompt-start="beginSystemPrompt"
            @prompt-end="endSystemPrompt"
            @message="receiveTx"
        /></template>
        <template v-if="page === 'importQr'"
          ><p class="intro">
            Scan encrypted wallet codes from another Latch device. Keep both
            devices offline.
          </p>
          <QrReader
            @prompt-start="beginSystemPrompt"
            @prompt-end="endSystemPrompt"
            @message="receiveWallet"
        /></template>
        <template v-if="page === 'review' && review"
          ><div
            class="transaction-type"
            :class="review.operation !== 'transfer' ? 'contract' : ''"
          >
            <p class="eyebrow">
              {{
                review.operation === "deploy"
                  ? "Contract deployment"
                  : review.operation === "call"
                    ? "Contract call"
                    : "QRL transfer"
              }}
            </p>
            <h2 class="amount">{{ formatQuanta(review.display.value) }}</h2>
            <p>
              {{ selected.names[message.tx.chainId] }} · Chain
              {{ message.tx.chainId }}
            </p>
          </div>
          <div v-if="review.operation !== 'transfer'" class="notice warning">
            <strong>{{
              review.operation === "deploy"
                ? "You are deploying a new contract."
                : "You are calling a contract."
            }}</strong>
            <p>
              Latch cannot verify what this code does offline. The value shown
              is only the native QRL amount. Contract actions may move other
              assets or grant permissions.
            </p>
          </div>
          <dl class="review-list">
            <div>
              <dt>From</dt>
              <dd class="address-full">{{ grouped(review.display.from) }}</dd>
            </div>
            <div>
              <dt>
                {{ review.operation === "deploy" ? "Destination" : "To" }}
              </dt>
              <dd class="address-full">
                {{
                  review.display.to
                    ? grouped(review.display.to)
                    : "New contract · no recipient address"
                }}
              </dd>
            </div>
            <div>
              <dt>Maximum network fee</dt>
              <dd>{{ formatQuanta(review.display.maxTotalFee) }}</dd>
            </div>
            <div>
              <dt>Maximum native QRL cost</dt>
              <dd>
                {{
                  formatQuanta(
                    review.display.maxTotalFee + review.display.value,
                  )
                }}
              </dd>
            </div>
            <div>
              <dt>Nonce</dt>
              <dd>{{ review.display.nonce.toString() }}</dd>
            </div>
            <div>
              <dt>Gas limit</dt>
              <dd>{{ review.display.gasLimit.toString() }}</dd>
            </div>
            <div>
              <dt>Maximum fee per gas</dt>
              <dd>{{ review.display.maxFeePerGas.toString() }} units</dd>
            </div>
            <div>
              <dt>Priority fee per gas</dt>
              <dd>
                {{ review.display.maxPriorityFeePerGas.toString() }} units
              </dd>
            </div>
            <div>
              <dt>Transaction type / access list</dt>
              <dd>0x2 / empty</dd>
            </div>
            <div>
              <dt>Data</dt>
              <dd>
                {{ review.display.dataBytes }} bytes<span
                  v-if="review.display.selector"
                >
                  · Selector {{ review.display.selector }}</span
                >
              </dd>
            </div>
          </dl>
          <details v-if="review.display.dataBytes" class="data-details">
            <summary>
              Inspect full
              {{
                review.operation === "deploy"
                  ? "deployment bytecode"
                  : "call data"
              }}
            </summary>
            <pre>{{ review.display.data }}</pre>
          </details>
          <form class="stack" @submit.prevent="sign">
            <label class="check-row"
              ><input
                type="checkbox"
                name="review-confirm"
                class="checkbox"
                v-model="acknowledged"
                required
              /><span
                >I have checked the network, destination, amount, fees{{
                  review.operation !== "transfer" ? ", and contract data" : ""
                }}.</span
              ></label
            ><label class="field"
              >Unlock {{ selected.label
              }}<input
                name="sign-password"
                class="input"
                type="password"
                v-model="pass"
                autocomplete="off"
                required
                placeholder="Wallet passphrase" /></label
            ><button
              type="submit"
              class="btn btn-primary"
              :disabled="busy || !acknowledged"
            >
              {{ busy ? "Signing offline…" : "Approve & sign"
              }}<KeyRound :size="16" /></button
            ><button
              type="button"
              class="btn btn-ghost"
              @click="
                message = null;
                review = null;
                go('wallet');
              "
            >
              Reject transaction
            </button>
          </form></template
        >
        <template v-if="page === 'signed' && outgoing"
          ><p class="intro">
            Scan these codes with a Latch-compatible wallet. It must verify the
            signature and compare the transaction before broadcasting.
          </p>
          <QrSender
            @prompt-start="beginSystemPrompt"
            @prompt-end="endSystemPrompt"
            :message="outgoing"
          /><button
            type="button"
            class="btn btn-outline full"
            @click="
              outgoing = null;
              message = null;
              review = null;
              go('home');
            "
          >
            Done
          </button></template
        >
        <section v-if="page === 'export' && outgoing" class="stack">
          <h2>{{ selected.label }}</h2>
          <p>
            This backup contains only this wallet. Restore it with its wallet
            passphrase; the vault passphrase is not needed.
          </p>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="busy"
            @click="saveIndividualBackup"
          >
            Save encrypted wallet file
          </button>
          <QrTransferDetails
            label="Back up this wallet by QR"
            warning="Anyone recording these codes can attempt to guess the wallet passphrase."
            :message="outgoing"
            @prompt-start="beginSystemPrompt"
            @prompt-end="endSystemPrompt"
          />
          <p class="field-help">
            On the receiving offline device, choose Import wallet, then Open
            encrypted file or Scan wallet QR. Verify its address and test the
            wallet passphrase before relying on this backup.
          </p>
          <button
            type="button"
            class="btn btn-outline"
            @click="
              outgoing = null;
              go('wallet');
            "
          >
            Back to wallet
          </button>
        </section>
        <form
          v-if="page === 'remove'"
          class="stack"
          @submit.prevent="removeWallet"
        >
          <div class="notice warning">
            This removes {{ selected.label }} from this device. Confirm that you
            have a working backup first. Browser storage cannot guarantee
            forensic erasure.
          </div>
          <AddressDisplay :address="selected.address" />
          <label class="field"
            >Type “{{ selected.label }}” to confirm<input
              name="remove-confirm"
              class="input"
              v-model="deleteConfirm"
              autocomplete="off"
              required /></label
          ><button
            type="submit"
            class="btn btn-error"
            :disabled="busy || deleteConfirm !== selected.label"
          >
            Remove wallet</button
          ><button type="button" class="btn btn-ghost" @click="go('wallet')">
            Keep wallet
          </button>
        </form>
        <section v-if="page === 'settings'" class="settings-list">
          <section v-if="appleMobilePwa" class="setting-section stack">
            <h2>App unlock</h2>
            <p>
              Use your vault passphrase in the iPhone or iPad PWA. New passkey
              setup is hidden because Latch requires device-only credentials.
              For Face ID or Touch ID, use the native app.
            </p>
          </section>
          <section
            v-if="!appleMobilePwa || device"
            class="setting-section stack"
          >
            <div class="setting-title">
              <h2>{{ isNative ? "Biometric unlock" : "Device unlock" }}</h2>
              <span
                class="badge"
                :class="device ? 'badge-success' : 'badge-neutral'"
                >{{ device ? "Enabled" : "Not enabled" }}</span
              >
            </div>
            <p>
              {{
                isNative
                  ? "Unlock Latch vault with Face ID, Touch ID or a strong Android biometric."
                  : "Requires a device-only credential with encryption support. Synced passkeys are not accepted."
              }}
            </p>
            <p class="field-help">
              Your vault passphrase is the fallback. Wallet passwords still
              protect signing.
            </p>
            <p v-if="deviceProgress" role="status">{{ deviceProgress }}</p>
            <div class="button-row">
              <button
                v-if="!device && !appleMobilePwa"
                type="button"
                class="btn btn-outline"
                :disabled="busy || (isNative && !biometrics.available)"
                @click="enableDevice"
              >
                {{ busy ? "Checking device…" : "Set up device unlock" }}
              </button>
              <template v-else-if="device"
                ><button
                  type="button"
                  class="btn btn-outline"
                  :disabled="busy"
                  @click="testDeviceUnlock"
                >
                  Test unlock</button
                ><button
                  type="button"
                  class="btn btn-ghost"
                  :disabled="busy"
                  @click="disableDevice"
                >
                  Remove
                </button></template
              >
            </div>
            <p v-if="isNative && !biometrics.available" class="field-help">
              {{ biometrics.reason }}
            </p>
          </section>
          <details class="collapse collapse-arrow setting-section">
            <summary class="collapse-title">Change vault passphrase</summary>
            <form
              class="collapse-content stack"
              @submit.prevent="changeVaultPassword"
            >
              <p>
                Wallet passwords stay the same. Device unlock will need to be
                set up again.
              </p>
              <label class="field"
                >Current vault passphrase<input
                  name="current-vault-passphrase"
                  type="password"
                  class="input"
                  autocomplete="current-password"
                  v-model="security.current"
                  required
                  maxlength="1024"
              /></label>
              <label class="field"
                >New vault passphrase<input
                  name="new-vault-passphrase"
                  type="password"
                  class="input"
                  autocomplete="new-password"
                  v-model="security.next"
                  minlength="16"
                  maxlength="1024"
                  required
              /></label>
              <label class="field"
                >Repeat new passphrase<input
                  name="confirm-vault-passphrase"
                  type="password"
                  class="input"
                  autocomplete="new-password"
                  v-model="security.repeat"
                  minlength="16"
                  maxlength="1024"
                  required
              /></label>
              <button type="submit" class="btn btn-primary" :disabled="busy">
                Change passphrase
              </button>
            </form>
          </details>
          <details class="collapse collapse-arrow setting-section">
            <summary class="collapse-title">
              Back up all wallets
              <span class="badge badge-neutral">{{ wallets.length }}</span>
            </summary>
            <form
              class="collapse-content stack"
              @submit.prevent="prepareBackup"
            >
              <p>
                One encrypted backup includes every wallet and its network
                labels. Restore it into a fresh Latch installation.
              </p>
              <label class="field"
                >Vault passphrase<input
                  name="backup-passphrase"
                  type="password"
                  class="input"
                  autocomplete="current-password"
                  v-model="security.current"
                  maxlength="1024"
                  required
              /></label>
              <button type="submit" class="btn btn-primary" :disabled="busy">
                Prepare encrypted backup
              </button>
            </form>
          </details>
          <section class="setting-section stack">
            <label class="field"
              >Auto-lock after inactivity<select
                name="auto-lock"
                class="select"
                :value="autoLockMs"
                :disabled="busy"
                @change="setAutoLock"
              >
                <option :value="30000">30 seconds</option>
                <option :value="60000">1 minute</option>
                <option :value="120000">2 minutes</option>
                <option :value="300000">5 minutes</option>
              </select></label
            >
            <p class="field-help">
              Leaving the app or reconnecting still locks it immediately, except
              during a brief system prompt.
            </p>
          </section>
          <details class="collapse collapse-arrow setting-section">
            <summary class="collapse-title">
              Prepare this device for an update
            </summary>
            <form
              class="collapse-content stack"
              @submit.prevent="wipeForUpdate"
            >
              <p>
                First restore a whole-vault backup on another offline device.
                Check every address and test the wallet passwords there.
              </p>
              <label class="check-row"
                ><input
                  name="tested-backup"
                  type="checkbox"
                  class="checkbox"
                  v-model="backupTested"
                  required
                /><span
                  >I restored and tested my backup on another offline
                  device.</span
                ></label
              >
              <label class="check-row"
                ><input
                  name="external-backups"
                  type="checkbox"
                  class="checkbox"
                  v-model="exportedFilesHandled"
                  required
                /><span
                  >I handled exported files outside Latch. App cleanup cannot
                  remove downloads or OS backups.</span
                ></label
              >
              <p class="notice danger">
                This removes all wallets and device unlock from this instance.
                Deletion is not guaranteed forensic erasure. Keeping a signer
                permanently offline remains the stronger option.
              </p>
              <label class="field"
                >Current vault passphrase<input
                  name="wipe-passphrase"
                  type="password"
                  class="input"
                  autocomplete="current-password"
                  v-model="wipePassword"
                  maxlength="1024"
                  required
              /></label>
              <label class="field"
                >Type WIPE THIS DEVICE<input
                  name="wipe-confirmation"
                  class="input"
                  v-model="wipeText"
                  autocomplete="off"
                  spellcheck="false"
                  required
              /></label>
              <button
                type="submit"
                class="btn btn-error"
                :disabled="
                  busy ||
                  !backupTested ||
                  !exportedFilesHandled ||
                  wipeText !== 'WIPE THIS DEVICE'
                "
              >
                Wipe this instance
              </button>
            </form>
          </details>
          <button type="button" class="btn btn-outline" @click="showStatus">
            <ShieldCheck :size="18" />Installation & storage<ChevronRight
              :size="16"
            />
          </button>
        </section>
        <section v-if="page === 'backup' && outgoing" class="stack">
          <p>
            Keep this backup and the vault passphrase separately. Each wallet
            still needs its own password.
          </p>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="busy"
            @click="saveWholeBackup"
          >
            Save encrypted backup file
          </button>
          <QrTransferDetails
            label="Transfer to another offline device by QR"
            :message="outgoing"
            @prompt-start="beginSystemPrompt"
            @prompt-end="endSystemPrompt"
          />
          <p class="field-help">
            On a fresh device, choose Restore vault. Verify all wallet addresses
            before retiring this device.
          </p>
        </section>
      </template>
    </main>
    <footer class="footer">
      <div><LockKeyhole :size="14" /><span>QRL est. 2016</span></div>
      <span class="mono">{{ buildId }}</span>
    </footer>
  </div>
</template>
