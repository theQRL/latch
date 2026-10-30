import "./buffer-shim.js";
import { normalizeChainId } from "./network.js";
import { MLDSA87, newWalletFromExtendedSeed } from "@theqrl/wallet.js";
import { signTransaction, TransactionFactory } from "@theqrl/web3-qrl-accounts";
import {
  newPasswordKey,
  passwordKey,
  encrypt,
  decrypt,
  seal,
  open,
  openLegacy,
  strongPassword,
} from "./encryption.js";
import { validateUnsignedTx } from "./protocol.js";
import { validateVault, validateBackup } from "./vault-backup.js";
import { wrapKey, unwrapKey } from "./device-unlock.js";
let appKey = null,
  kdf = null,
  vault = null;
function walletFromSecret(input) {
  const secret = input.trim();
  const seed = secret.replace(/^0x/i, "");
  if (/^[0-9a-f]{102}$/i.test(seed)) return newWalletFromExtendedSeed(seed);
  if (!/^[a-zA-Z\s]+$/.test(secret))
    throw Error("Enter a QRL mnemonic or 102-character hexseed");
  return MLDSA87.newWalletFromMnemonic(
    secret.toLowerCase().split(/\s+/).join(" "),
  );
}
function publicWallet(w) {
  return {
    id: w.id,
    label: w.label,
    address: w.address,
    chainIds: w.chainIds,
    names: w.names,
    addressHexLength: w.addressHexLength,
  };
}
async function save() {
  return {
    encrypted: await encrypt(vault, appKey, kdf, "vault"),
    wallets: vault.wallets.map(publicWallet),
  };
}
async function handle(action, p) {
  if (action === "create") {
    const keys = await newPasswordKey(p.password);
    appKey = keys.key;
    kdf = keys.kdf;
    vault = { wallets: [] };
    return save();
  }
  if (action === "unlock") {
    appKey?.fill(0);
    appKey = null;
    vault = null;
    kdf = null;
    const key = await passwordKey(p.password, p.encrypted.kdf);
    try {
      const data = await decrypt(p.encrypted, key, "vault");
      validateVault(data);
      appKey = key;
      kdf = p.encrypted.kdf;
      vault = data;
      return { wallets: vault.wallets.map(publicWallet) };
    } catch (e) {
      key.fill(0);
      throw e;
    }
  }
  if (action === "unlockDevice") {
    appKey?.fill(0);
    appKey = null;
    vault = null;
    kdf = null;
    const key = await unwrapKey(p.wrapper, p.prf);
    try {
      vault = validateVault(await decrypt(p.encrypted, key, "vault"));
      appKey = key;
      kdf = p.encrypted.kdf;
      return { wallets: vault.wallets.map(publicWallet) };
    } catch (e) {
      key.fill(0);
      throw e;
    } finally {
      p.prf.fill(0);
    }
  }
  if (action === "restore") {
    if (vault) throw Error("Restore into a fresh Latch installation.");
    const backup = validateBackup(p.backup);
    const restored = validateVault(
      await open(backup.encrypted, p.password, "vault"),
    );
    const keys = await newPasswordKey(p.newPassword);
    try {
      const encrypted = await encrypt(restored, keys.key, keys.kdf, "vault");
      appKey?.fill(0);
      appKey = keys.key;
      kdf = keys.kdf;
      vault = restored;
      return { encrypted, wallets: restored.wallets.map(publicWallet) };
    } catch (error) {
      keys.key.fill(0);
      throw error;
    }
  }
  if (!vault || !appKey) throw Error("Unlock Latch vault first");
  if (action === "testDevice") {
    let recovered;
    try {
      recovered = await unwrapKey(p.wrapper, p.prf);
      let diff = recovered.length ^ appKey.length;
      for (let i = 0; i < appKey.length; i++)
        diff |= (recovered[i] || 0) ^ appKey[i];
      if (diff)
        throw Error(
          "Device unlock does not match this vault. Set it up again.",
        );
      return { verified: true };
    } finally {
      recovered?.fill(0);
      p.prf.fill(0);
    }
  }
  if (action === "enableDevice") {
    try {
      return await wrapKey(appKey, p.prf);
    } finally {
      p.prf.fill(0);
    }
  }
  if (
    action === "backup" ||
    action === "changePassword" ||
    action === "verifyPassword"
  ) {
    // Verify recovery knowledge even when this session was opened with biometrics.
    const verifiedKey = await passwordKey(p.password, kdf);
    try {
      let diff = 0;
      for (let i = 0; i < appKey.length; i++)
        diff |= verifiedKey[i] ^ appKey[i];
      if (diff) throw Error("Incorrect current vault passphrase");
    } finally {
      verifiedKey.fill(0);
    }
    if (action === "verifyPassword") return { verified: true };
    if (action === "backup")
      return {
        type: "qrl-latch-vault-backup",
        version: 1,
        encrypted: await encrypt(vault, appKey, kdf, "vault"),
      };
    const keys = await newPasswordKey(p.newPassword);
    try {
      const encrypted = await encrypt(vault, keys.key, keys.kdf, "vault");
      appKey.fill(0);
      appKey = keys.key;
      kdf = keys.kdf;
      return { encrypted, wallets: vault.wallets.map(publicWallet) };
    } catch (error) {
      keys.key.fill(0);
      throw error;
    }
  }
  if (action === "add" || action === "generate") {
    if (vault.wallets.length >= 50)
      throw Error("This vault already contains 50 wallets");
    const chainId = normalizeChainId(p.chainId);
    strongPassword(p.password);
    let secret = p.secret;
    if (action === "add" && p.file) {
      secret =
        p.file.format === "qrl-latch-encrypted"
          ? (await open(p.file, p.importPassword, "wallet")).hexSeed
          : await openLegacy(p.file, p.importPassword);
    }
    let w;
    try {
      w =
        action === "generate" ? MLDSA87.newWallet() : walletFromSecret(secret);
      const address = w.getAddressStr();
      if (!/^Q[0-9a-fA-F]{128}$/.test(address))
        throw Error("This build requires QRL v2.0 64-byte addresses");
      if (
        vault.wallets.some(
          (v) => v.address.toLowerCase() === address.toLowerCase(),
        )
      )
        throw Error("This wallet is already in Latch");
      const encrypted = await seal(
        { hexSeed: w.getHexExtendedSeed(), address },
        p.password,
        "wallet",
      );
      vault.wallets.push({
        id: crypto.randomUUID(),
        label: p.label.trim().slice(0, 60) || "My wallet",
        address,
        addressHexLength: 128,
        chainIds: [chainId],
        names: {
          [chainId]:
            typeof p.networkName === "string"
              ? p.networkName.trim().slice(0, 60) || "Custom network"
              : "Custom network",
        },
        encrypted,
      });
      return save();
    } finally {
      secret = "";
      w = null;
    }
  }
  const w = vault.wallets.find((w) => w.id === p.id);
  if (!w) throw Error("Wallet not found");
  if (action === "setNetwork") {
    const chainId = normalizeChainId(p.chainId);
    w.chainIds = [chainId];
    w.names = { [chainId]: "Custom network" };
    return save();
  }
  if (action === "export")
    return {
      type: "qrl-encrypted-wallet",
      version: 1,
      wallet: w.encrypted,
      metadata: publicWallet(w),
    };
  if (action === "remove") {
    vault.wallets = vault.wallets.filter((x) => x.id !== p.id);
    return save();
  }
  if (action === "sign") {
    const checked = validateUnsignedTx(p.message, {
      ...w,
      chainIds: new Set(w.chainIds.map(BigInt)),
    });
    let secret;
    try {
      secret = await open(w.encrypted, p.password, "wallet");
      const actual = walletFromSecret(secret.hexSeed).getAddressStr();
      if (actual.toLowerCase() !== w.address.toLowerCase())
        throw Error("Wallet address does not match key");
      const result = await signTransaction(
        TransactionFactory.fromTxData(checked.toSign),
        secret.hexSeed,
      );
      return {
        type: "qrl-signed-tx",
        version: checked.version,
        rawTransaction: result.rawTransaction,
      };
    } finally {
      if (secret) secret.hexSeed = "";
      secret = null;
    }
  }
  throw Error("Unknown vault operation");
}
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      self.postMessage({
        id: data.id,
        result: await handle(data.action, data.payload),
      });
    } catch (e) {
      self.postMessage({ id: data.id, error: e.message || "Operation failed" });
    }
  });
};
