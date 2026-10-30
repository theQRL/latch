import { isNative } from "./platform.js";
import { transactRecord, requireEmpty } from "./lifecycle-db.js";
const KEY = "qrl-latch-vault-v1",
  RECORD = "latch-state-v2";
const LEGACY = [KEY, "latch-device-unlock", "latch-auto-lock"];
let initial,
  generation,
  serial = Promise.resolve();
async function preferences() {
  return (await import("@capacitor/preferences")).Preferences;
}
async function transaction(change) {
  if (!isNative) return transactRecord(change);
  const operation = serial.then(async () => {
    const prefs = await preferences();
    const value = (await prefs.get({ key: RECORD })).value;
    const current = value ? JSON.parse(value) : null;
    if (!change) return current;
    const result = change(current);
    await prefs.set({ key: RECORD, value: JSON.stringify(result) });
    return result;
  });
  serial = operation.catch(() => {});
  return operation;
}
export async function clearLegacyStorage() {
  for (const key of LEGACY) {
    if (isNative) await (await preferences()).remove({ key });
    else localStorage.removeItem(key);
  }
  for (const key of LEGACY) {
    const value = isNative
      ? (await (await preferences()).get({ key })).value
      : localStorage.getItem(key);
    if (value !== null) throw Error("Old vault storage could not be removed.");
  }
}
export function initializeStorage() {
  if (!initial)
    initial = (async () => {
      const values = {};
      for (const key of LEGACY) {
        const value = isNative
          ? (await (await preferences()).get({ key })).value
          : localStorage.getItem(key);
        if (value !== null) values[key] = value;
      }
      const result = await transaction(
        (record) =>
          record || { phase: "sealed", epoch: crypto.randomUUID(), values },
      );
      generation = result.epoch;
      await clearLegacyStorage();
      return result;
    })().catch((error) => {
      initial = undefined;
      throw error;
    });
  return initial;
}
export async function readLifecycle() {
  await initializeStorage();
  return transaction();
}
export async function readSetting(key) {
  return (await readLifecycle()).values[key] ?? null;
}
function writable(record) {
  if (!record || record.phase !== "sealed" || record.epoch !== generation)
    throw Error(
      "This Latch session is no longer writable. Close and reopen it.",
    );
}
export async function writeSetting(key, value) {
  await initializeStorage();
  await transaction((record) => {
    writable(record);
    record.values[key] = value;
    return record;
  });
}
export async function removeSetting(key) {
  await initializeStorage();
  await transaction((record) => {
    writable(record);
    delete record.values[key];
    return record;
  });
}
export async function readVault() {
  const text = await readSetting(KEY);
  if (!text) return null;
  if (text.length > 1600000) throw Error("Stored vault exceeds size limit");
  return JSON.parse(text);
}
export async function writeVault(vault) {
  const text = JSON.stringify(vault);
  if (text.length > 1600000) throw Error("Stored vault exceeds size limit");
  await writeSetting(KEY, text);
}
export async function beginWipe() {
  await initializeStorage();
  return transaction((record) => {
    writable(record);
    return { phase: "wiping", epoch: crypto.randomUUID(), values: {} };
  });
}
export async function completeWipe() {
  await clearLegacyStorage();
  return transaction((record) => {
    requireEmpty(record, ["wiping", "maintenance"]);
    return { ...record, phase: "maintenance" };
  });
}
export async function authorizeUpdate(buildId) {
  if (!/^0\.1\.0\+[a-f0-9]{12}$/.test(buildId))
    throw Error("Invalid release identifier");
  return transaction((record) => {
    requireEmpty(record, ["maintenance", "downloading"]);
    return { ...record, phase: "downloading", target: buildId };
  });
}
export async function finishMaintenance() {
  const result = await transaction((record) => {
    requireEmpty(record, ["maintenance"]);
    return { phase: "sealed", epoch: crypto.randomUUID(), values: {} };
  });
  generation = result.epoch;
  return result;
}

export async function cancelUpdateAuthorization() {
  return transaction((record) => {
    requireEmpty(record, ["downloading"]);
    return { ...record, phase: "maintenance", target: null };
  });
}
