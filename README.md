# QRL | Latch

Offline QRL v2.0 signing for a dedicated phone. The PWA, iOS and Android apps share a Vue/daisyUI interface and cryptographic worker. This is a prerelease for review; successful builds are not a security certification.

## What it does

- Creates wallets offline and imports mnemonics, hex seeds or encrypted wallet files.
- Signs transfers, contract calls and deployments after explicit transaction review.
- Exchanges transactions and encrypted backups through QR codes or files.
- Encrypts the vault and each wallet separately; supports vault-passphrase recovery and optional device unlock.
- Shares public addresses without unlocking individual wallets.
- Checks offline installation and storage status, locks on backgrounding/reconnection, and supports controlled updates only after confirmed wiping.

Latch has no RPC endpoint or broadcast client. Mainnet/Testnet presets are disabled during prerelease. Each wallet needs an independently verified custom chain ID. All addresses are 64 bytes, displayed as `Q` plus 128 hexadecimal characters; uppercase hex requires the QRL case checksum.

## Build and deploy

Use Node 22 and run from the repository root:

```sh
npm ci
npm test
npm run build
npm run preview
```

`npm run dev` is online-only. For phone installation tests, serve the production PWA build over HTTPS. A tunnel to the development server is not an offline installation test.

The root `netlify.toml` installs dependencies, runs tests, builds and validates the PWA, then publishes `apps/pwa/dist`. Link the repository in Netlify and configure **latch.theqrl.org** as its custom domain. Read [deployment and verification](docs/deployment.md) for DNS/TLS, header checks and hosting restrictions. Never deploy `build/native` as the PWA.

## Install before entering keys

1. Open the HTTPS site while online and add **QRL Latch** to the Home Screen. Keep “Open as Web App” enabled where offered.
2. Launch the new Home Screen icon while still online. Open the header shield and wait for the installed-app and offline-files checks to pass. A Safari-tab check does not verify the Home Screen storage context.
3. Request **Protect offline storage**. The result is shown; browsers may refuse or not support persistence. It does not replace a backup.
4. Disable the VPN and automatic VPN reconnection, enable airplane mode, and explicitly turn off Wi-Fi and Bluetooth. Close and reopen the Home Screen app offline before creating or restoring a vault.

Do not go offline before installation and the first Home Screen launch finish. A generic icon or Safari launch error can indicate an incomplete installation. Do not delete or reconnect an instance holding keys to troubleshoot it.

On iOS an active VPN has been observed to leave the platform reporting “Online” even with airplane mode enabled and Wi-Fi/Bluetooth off. The indicator is a precaution, not proof of Internet access or an air gap. Latch blocks unlocking while a connection is reported.

## Recovery and security

The vault passphrase unlocks the collection. Each wallet retains its separate password. Back up and test recovery before receiving funds. Keep the device offline while it holds keys. Browser storage can be evicted; neither cache verification nor a persistence grant guarantees years of retention.

New encrypted backups use AES-256-GCM and bounded scrypt. Legacy AES-128-CTR files are import-only. Contract review shows raw data; Latch cannot verify arbitrary contract semantics, balances or current chain state offline. Read [SECURITY.md](SECURITY.md) before using it.

A fresh device with offline migration is the stronger update model. Same-device maintenance requires a tested backup, confirmed logical wipe, explicit update, offline verification and restore. Logical wipe is not forensic erasure.

## Documentation

- [Settings, wallet backups and recovery](docs/settings-and-recovery.md)
- [Updating Latch](docs/updating.md)
- [Monorepo and native build setup](docs/monorepo.md)
- [Third-party wallet integration specification](SPECIFICATIONS.md), including the base protocol and Latch extension
- [Auditor handoff and release gates](docs/audit-handoff.md)

Physical-device acceptance, independent security review, production native signing, and a private vulnerability-reporting channel remain release requirements. Use disposable keys for testing.
