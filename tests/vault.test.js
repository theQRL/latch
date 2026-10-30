import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { MLDSA87 } from "@theqrl/wallet.js";
import { TransactionFactory } from "@theqrl/web3-qrl-accounts";
import { verifySignedReply } from "../shared/src/lib/protocol.js";
async function client() {
  const w = new Worker(new URL("./worker-harness.js", import.meta.url));
  await new Promise((r, j) => {
    w.once("message", r);
    w.once("error", j);
  });
  let id = 0;
  return {
    stop: () => w.terminate(),
    call: (action, payload) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        const h = (data) => {
          if (data.id !== n) return;
          w.off("message", h);
          data.error ? reject(Error(data.error)) : resolve(data.result);
        };
        w.on("message", h);
        w.postMessage({ id: n, action, payload });
      }),
  };
}
test("persistent app vault, independent wallet lock, encrypted migration and real signed response verification", async () => {
  const c = await client();
  try {
    const password = "app test passphrase not for real funds",
      wp = "wallet test passphrase not for real funds",
      w = MLDSA87.newWallet(),
      secret = w.getHexExtendedSeed();
    let saved = await c.call("create", { password });
    assert.equal(saved.wallets.length, 0);
    saved = await c.call("add", {
      secret,
      password: wp,
      label: "Fixture",
      chainId: "0x7e7e",
      networkName: "Testnet",
    });
    assert.equal(saved.wallets.length, 1);
    assert.equal(JSON.stringify(saved.encrypted).includes(secret), false);
    const id = saved.wallets[0].id;
    await assert.rejects(
      c.call("unlock", { password: "wrong", encrypted: saved.encrypted }),
    );
    await c.call("unlock", { password, encrypted: saved.encrypted });
    const prf = crypto.getRandomValues(new Uint8Array(32));
    const wrapper = await c.call("enableDevice", { prf });
    const biometricClient = await client();
    try {
      await assert.rejects(
        biometricClient.call("unlockDevice", {
          prf: new Uint8Array(32),
          wrapper,
          encrypted: saved.encrypted,
        }),
      );
      const opened = await biometricClient.call("unlockDevice", {
        prf,
        wrapper,
        encrypted: saved.encrypted,
      });
      assert.equal(opened.wallets[0].id, id);
      await assert.rejects(biometricClient.call("export", { id: "missing" }));
    } finally {
      await biometricClient.stop();
      prf.fill(0);
    }
    // Passphrase recovery remains valid after biometric enrollment.
    await c.call("unlock", { password, encrypted: saved.encrypted });
    const exported = await c.call("export", { id });
    assert.equal(exported.type, "qrl-encrypted-wallet");
    assert.equal(JSON.stringify(exported).includes(secret), false);
    const request = {
      type: "qrl-unsigned-tx",
      version: 1,
      operation: "deploy",
      tx: {
        from: w.getAddressStr(),
        to: null,
        value: "0x0",
        gasLimit: "0x186a0",
        type: "0x2",
        chainId: "0x7e7e",
        nonce: "0x0",
        maxFeePerGas: "0x2",
        maxPriorityFeePerGas: "0x1",
        data: "0x60006000",
      },
    };
    await assert.rejects(c.call("sign", { id, password, message: request }));
    const signed = await c.call("sign", { id, password: wp, message: request });
    const decode = (raw) =>
      TransactionFactory.fromSerializedData(
        Uint8Array.from(raw.slice(2).match(/../g), (x) => parseInt(x, 16)),
      );
    assert.equal(
      verifySignedReply(signed, request, decode),
      signed.rawTransaction,
    );
    assert.throws(
      () =>
        verifySignedReply(
          signed,
          { ...request, tx: { ...request.tx, value: "0x1" } },
          decode,
        ),
      /value/,
    );
    assert.throws(() =>
      verifySignedReply({ ...signed, version: 2 }, request, decode),
    );
    const c2 = await client();
    try {
      await c2.call("create", { password });
      const imported = await c2.call("add", {
        file: exported.wallet,
        importPassword: wp,
        password: wp,
        label: "Migrated",
        chainId: "0x7e7e",
        networkName: "Testnet",
      });
      assert.equal(imported.wallets[0].address, w.getAddressStr());
    } finally {
      await c2.stop();
    }
  } finally {
    await c.stop();
  }
});

test("whole-vault backup, fresh-device restore, password rotation and device-key invalidation", async () => {
  const c = await client(),
    restored = await client(),
    probe = await client();
  const password = "original app passphrase for tests",
    next = "replacement app passphrase for tests",
    wp = "independent wallet password for tests";
  try {
    await c.call("create", { password });
    const w = MLDSA87.newWallet();
    const saved = await c.call("add", {
      secret: w.getHexExtendedSeed(),
      password: wp,
      label: "Backup fixture",
      chainId: "0x7e7e",
      networkName: "Testnet",
    });
    const id = saved.wallets[0].id;
    const walletBefore = await c.call("export", { id });
    const prf = crypto.getRandomValues(new Uint8Array(32));
    const wrapper = await c.call("enableDevice", { prf });
    assert.deepEqual(await c.call("testDevice", { prf, wrapper }), {
      verified: true,
    });
    await assert.rejects(
      c.call("backup", { password: "incorrect" }),
      /Incorrect/,
    );
    await assert.rejects(
      c.call("changePassword", { password: "incorrect", newPassword: next }),
      /Incorrect/,
    );
    const backup = await c.call("backup", { password });
    assert.equal(
      JSON.stringify(backup).includes(w.getHexExtendedSeed()),
      false,
    );
    await assert.rejects(
      restored.call("restore", {
        backup,
        password: "wrong",
        newPassword: next,
      }),
    );
    const damaged = structuredClone(backup);
    damaged.encrypted.ciphertext =
      (parseInt(damaged.encrypted.ciphertext.slice(0, 2), 16) ^ 255)
        .toString(16)
        .padStart(2, "0") + damaged.encrypted.ciphertext.slice(2);
    await assert.rejects(
      restored.call("restore", {
        backup: damaged,
        password,
        newPassword: next,
      }),
    );
    const migrated = await restored.call("restore", {
      backup,
      password,
      newPassword: next,
    });
    assert.deepEqual(migrated.wallets, saved.wallets);
    assert.deepEqual(await restored.call("export", { id }), walletBefore);
    await assert.rejects(
      restored.call("restore", { backup, password, newPassword: next }),
      /fresh/,
    );
    const rotated = await c.call("changePassword", {
      password,
      newPassword: next,
    });
    await assert.rejects(c.call("testDevice", { prf, wrapper }), /match/);
    await assert.rejects(
      probe.call("unlockDevice", {
        prf,
        wrapper,
        encrypted: rotated.encrypted,
      }),
    );
    await assert.rejects(
      probe.call("unlock", { password, encrypted: rotated.encrypted }),
    );
    await probe.call("unlock", {
      password: next,
      encrypted: rotated.encrypted,
    });
    assert.deepEqual(await probe.call("export", { id }), walletBefore);
    await probe.call("unlock", { password, encrypted: backup.encrypted });
    assert.equal(
      (await probe.call("export", { id })).metadata.address,
      w.getAddressStr(),
    );
    prf.fill(0);
  } finally {
    await Promise.all([c.stop(), restored.stop(), probe.stop()]);
  }
});

test("generated wallets are independent, encrypted, recoverable and expose only public metadata", async () => {
  const c = await client();
  const password = "app fixture passphrase for generation";
  const walletPassword = "separate wallet fixture passphrase";
  try {
    await assert.rejects(c.call("generate", { password: walletPassword }));
    await c.call("create", { password });
    const input = {
      password: walletPassword,
      label: "Generated",
      chainId: "0x7e7e",
      networkName: "Testnet",
    };
    let saved = await c.call("generate", input);
    const first = saved.wallets[0];
    assert.match(first.address, /^Q[0-9a-fA-F]{128}$/);
    assert.deepEqual(
      Object.keys(first).sort(),
      [
        "address",
        "addressHexLength",
        "chainIds",
        "id",
        "label",
        "names",
      ].sort(),
    );
    saved = await c.call("generate", input);
    assert.notEqual(first.address, saved.wallets[1].address);
    await c.call("unlock", { password, encrypted: saved.encrypted });
    const exported = await c.call("export", { id: first.id });
    const { open } = await import("../shared/src/lib/encryption.js");
    await assert.rejects(open(exported.wallet, password, "wallet"));
    const { serializeWalletBackup } = await import(
      "../shared/src/lib/backup-file.js"
    );
    const file = JSON.parse(serializeWalletBackup(exported));
    assert.deepEqual(Object.keys(file).sort(), ["type", "version", "wallet"]);
    assert.equal(file.type, "qrl-encrypted-wallet");
    assert.deepEqual(file.wallet, exported.wallet);
    assert.throws(() =>
      serializeWalletBackup({
        type: "qrl-latch-vault-backup",
        version: 1,
        encrypted: saved.encrypted,
      }),
    );
    const recovered = await open(file.wallet, walletPassword, "wallet");
    const { newWalletFromExtendedSeed } = await import("@theqrl/wallet.js");
    assert.equal(
      newWalletFromExtendedSeed(recovered.hexSeed).getAddressStr(),
      first.address,
    );
    assert.equal(JSON.stringify(saved).includes(recovered.hexSeed), false);
    await assert.rejects(c.call("generate", { ...input, password: "short" }));
    const second = saved.wallets[1];
    const updated = await c.call("setNetwork", {
      id: first.id,
      chainId: "4242",
    });
    assert.deepEqual(updated.wallets.find((w) => w.id === first.id).chainIds, [
      "0x1092",
    ]);
    assert.deepEqual(
      updated.wallets.find((w) => w.id === second.id).chainIds,
      second.chainIds,
    );
    await assert.rejects(
      c.call("setNetwork", { id: first.id, chainId: "0x0" }),
    );
    const reopened = await c.call("unlock", {
      password,
      encrypted: updated.encrypted,
    });
    assert.deepEqual(reopened.wallets.find((w) => w.id === first.id).chainIds, [
      "0x1092",
    ]);
    const wrongChain = {
      type: "qrl-unsigned-tx",
      version: 1,
      operation: "deploy",
      tx: {
        from: first.address,
        to: null,
        value: "0x0",
        gasLimit: "0x186a0",
        type: "0x2",
        chainId: input.chainId,
        nonce: "0x0",
        maxFeePerGas: "0x2",
        maxPriorityFeePerGas: "0x1",
        data: "0x60006000",
      },
    };
    await assert.rejects(
      c.call("sign", {
        id: first.id,
        password: walletPassword,
        message: wrongChain,
      }),
      /chain/i,
    );
  } finally {
    await c.stop();
  }
});
