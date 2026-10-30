import { validateQrlAddress } from "./address.js";
import { validateEnvelope } from "./encryption.js";
export function validateBackup(value) {
  if (
    !value ||
    value.type !== "qrl-latch-vault-backup" ||
    value.version !== 1 ||
    JSON.stringify(value).length > 1600000
  )
    throw Error(
      "Choose a Latch whole-vault backup, not an individual wallet file.",
    );
  validateEnvelope(value.encrypted, "vault");
  return value;
}
export function validateVault(value) {
  if (!value || !Array.isArray(value.wallets) || value.wallets.length > 50)
    throw Error("Invalid vault backup");
  const ids = new Set(),
    addresses = new Set();
  for (const w of value.wallets) {
    if (
      !w ||
      typeof w.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(w.id) ||
      ids.has(w.id) ||
      typeof w.label !== "string" ||
      w.label.length > 60 ||
      !/^Q[0-9a-f]{128}$/i.test(w.address) ||
      addresses.has(w.address.toLowerCase()) ||
      w.addressHexLength !== 128 ||
      !Array.isArray(w.chainIds) ||
      !w.chainIds.length ||
      w.chainIds.length > 32 ||
      !w.names ||
      typeof w.names !== "object"
    )
      throw Error("Invalid wallet in vault backup");
    for (const id of w.chainIds) {
      if (
        typeof id !== "string" ||
        !/^0x[1-9a-f][0-9a-f]{0,15}$/.test(id) ||
        typeof w.names[id] !== "string" ||
        w.names[id].length > 60
      )
        throw Error("Invalid wallet network in backup");
    }
    validateQrlAddress(w.address, "wallet address");
    validateEnvelope(w.encrypted, "wallet");
    ids.add(w.id);
    addresses.add(w.address.toLowerCase());
  }
  return value;
}
