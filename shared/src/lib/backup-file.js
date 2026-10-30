import { isNative } from "./platform.js";
import { validateEnvelope } from "./encryption.js";
import { validateBackup } from "./vault-backup.js";
export async function saveBackupFile(backup) {
  validateBackup(backup);
  return saveEncryptedFile(JSON.stringify(backup), "vault");
}
export function serializeWalletBackup(backup) {
  if (backup?.type !== "qrl-encrypted-wallet" || backup.version !== 1)
    throw Error("Choose an individual encrypted wallet backup.");
  validateEnvelope(backup.wallet, "wallet");
  // Only this wallet's encrypted envelope belongs in an individual backup.
  return JSON.stringify({
    type: "qrl-encrypted-wallet",
    version: 1,
    wallet: backup.wallet,
  });
}
export async function saveWalletFile(backup) {
  return saveEncryptedFile(serializeWalletBackup(backup), "wallet");
}
async function saveEncryptedFile(data, kind) {
  const name = `qrl-latch-${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  if (isNative) {
    const { Filesystem, Directory, Encoding } = await import(
      "@capacitor/filesystem"
    );
    const { Share } = await import("@capacitor/share");
    const file = await Filesystem.writeFile({
      path: name,
      data,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    // Keep the encrypted cache copy alive while the receiving app reads it.
    // Android's chooser can resolve before that read has finished.
    await Share.share({
      title: `Save encrypted Latch ${kind} backup`,
      files: [file.uri],
      dialogTitle: `Save ${kind} backup`,
    });
  } else {
    const url = URL.createObjectURL(
      new Blob([data], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
