# Latch settings and vault recovery

The shared Vue UI is used by the PWA, iOS and Android apps.

## Installation status

The header shield opens the installation/storage screen. Green means the installation is verified, storage protection is granted (or native app storage is used), and no network connection is detected. Red and a pulsing exclamation mark request attention. Checking uses amber. Reduced-motion preferences disable the pulse. The detailed cache counts, persistence controls and retry button are on this screen.

## Settings

- Device unlock: setup progress, Enabled/Not enabled status, a test action, and removal.
- Vault passphrase: verify the current vault passphrase and enter a new one twice. This rotates the app encryption key and invalidates device unlock. Wallet passwords are unchanged. Existing backups retain their original vault passphrase.
- Whole-vault backup: verify the vault passphrase before preparing an encrypted export. Save a JSON file, or transfer by animated QR. Native file export uses the system share sheet; keep the phone offline and save locally. Verify that the destination actually saved the file. Only encrypted data goes into temporary app cache; the OS may remove it later.
- Auto-lock: 30 seconds, 1 minute, 2 minutes (default), or 5 minutes. Background/reconnection locks still apply. The selection stays on this device.

## Restore

On a fresh, verified, offline installation, choose **Restore an existing vault** before creating a new vault. Select a backup file or scan its QR transfer, enter the backup's vault passphrase, then choose an vault passphrase for the new device. The encrypted wallet records and their labels/networks are preserved. Individual wallet passwords are still needed to sign. Device credentials are not transferred.

Restore does not merge into or replace an existing vault. Keep the old device and backup until every address has been checked on the new device.

The versioned backup envelope is `{type: "qrl-latch-vault-backup", version: 1, encrypted: <vault envelope>}`. It uses the existing authenticated AES-256-GCM vault format. The worker bounds the KDF and file size, authenticates decryption, validates wallet metadata and encrypted wallet envelopes, and encrypts the restored vault with a fresh salt/key. QR transfer retains the existing 256-frame limit; larger backups use files.

## PWA device unlock

A browser saving a passkey does not establish that it can release an encryption key. Latch requires PRF support, user verification, and a credential that is not eligible for syncing. Unsupported credentials are not enabled, and the reason is shown. Setup creates the credential and then tests a fresh authenticated key derivation before storing the encrypted wrapper. A browser-created credential may remain in the OS even when Latch rejects it; remove that unused credential in system settings if desired.

Prompts are bounded and aborted when Latch locks. Passkey tests use controlled browser mocks; actual authenticator behavior must still be checked on target devices. The native apps use their Keychain/Keystore biometric integration instead.

## Maintenance updates

Settings also includes confirmed offline wiping for an update. Follow [Updating Latch](updating.md); read the [security boundaries](../SECURITY.md) before reconnecting a device that previously held keys.

## Create wallets and share an address

Unlock the app vault while offline and choose **Create wallet**. Choose a name, verify the allowed chain ID, and set a separate wallet passphrase. Latch generates the key inside its crypto worker and encrypts it before storing it. Use **Back up this wallet** before receiving funds; test restoring that backup on another offline device. Individual wallet backups offer an encrypted file or QR without unlocking the wallet. Its wallet passphrase is needed when restoring or using it. Whole-vault backup remains in **Settings → Back up all wallets** and requires only the vault passphrase to create or restore the backup. Each wallet’s passphrase is needed later to use that restored wallet.

**Import wallet** retains mnemonic, hexseed, encrypted-file and QR import. To share an address, open a wallet and choose **Public address · text & QR**. The wallet remains locked. The text and static QR contain the same full address. The QR does not contain network metadata; verify the intended chain on the online device. Copy uses the device clipboard where available, with selectable text as a fallback. Locking the app vault hides the address along with the wallet list.

## iPhone and iPad PWA unlock

New passkey setup is hidden in the iOS/iPadOS PWA. This is Latch’s device-only credential policy, not a lack of Safari PRF support. Use the vault passphrase there, or the native app for Face ID/Touch ID. Existing configured credentials retain unlock, test and removal controls; removing one does not erase the vault.

## Custom networks during prerelease

Mainnet and Testnet presets are disabled. Open **Advanced** when creating or importing a wallet and enter your chain ID. Decimal digits and `0x`-prefixed hexadecimal are accepted; zero, negative values, malformed input and values beyond 64 bits are rejected. IDs are stored as canonical hexadecimal.

For an existing wallet, open **Network settings** to change its chain ID. This changes only that wallet’s signing allowlist and is stored inside the encrypted vault. Whole-vault backups preserve it. An individual wallet import requires independently choosing and verifying its network again. No RPC URL is requested, stored or contacted.

Changing the chain ID is discouraged and requires acknowledgment: it changes signing authorization without moving funds or changing keys. Networks that reuse a chain ID are not distinguished by that ID. Verify it independently.

QR playback starts at 550 ms per frame, with slower/faster settings and pause controls. During scanning or display, Latch requests that the screen stay awake; a fallback is shown if unavailable. The vault auto-lock timeout still applies.
