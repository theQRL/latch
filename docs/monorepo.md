# PWA, iOS and Android

The three targets use one Vue application and one cryptographic implementation.

```
apps/pwa/           Service worker, PWA Vite entry, generated dist/
apps/ios/           Xcode project, Swift Package Manager dependencies
apps/android/       Android Studio / Gradle project
shared/src/         Vue UI, QR components, signing worker, storage adapters
shared/assets/      QRL logos, app icons and bundled fonts
shared/index.html   Shared HTML entry and startup recovery message
build-tools/        Shared and native Vite configurations
build/native/       Generated native web bundle; never deploy this as a PWA
tests/              Shared protocol, vault, lifecycle and installation tests
```

Run commands from the repository root with Node 22 or newer:

```
npm ci
npm test
npm run build:pwa
npm run preview
npm run ios:sync
npm run android:sync
npm run ios:open
npm run android:open
```

`npm run build` creates both web bundles. Native sync commands build and copy the shared code into the platform projects. Native source projects are maintained in Git; generated web copies, dependency caches, signing material and build products are ignored. No live-update plugin or remote `server.url` is configured. The app identifier is `org.theqrl.latch`; verify ownership before release. App Store / Play Store signing and distribution are not configured.

## PWA installation and storage

Follow the [README installation sequence](../README.md#install-before-entering-keys) and [deployment guide](deployment.md). Installation detection describes the current standalone window; there is no universal device-wide installed-app query. The app requests storage persistence and reports granted, refused or unsupported outcomes.

Cache checks verify unique manifest entries, successful nonempty responses, the completed-install marker and build ID. They do not rehash cached bytes or silently redownload files. Installation verifies downloaded digests. Missing files block normal use; an HTML startup fallback can help only if the document itself remains available. Loss of all origin storage cannot be repaired offline.

## Native installation

Capacitor 8 bundles all application assets in the installed package. Native builds do not register a service worker or depend on browser Cache Storage. Encrypted vault envelopes and lifecycle state are stored in one serialized Capacitor Preferences record, backed by iOS UserDefaults and Android SharedPreferences. PWA records use IndexedDB. Legacy records migrate on startup. The vault and wallet passwords remain separate. Never put plaintext seeds or passwords into Preferences.

Native network and app-lifecycle events control locking. Android's merged manifest removes INTERNET permission, allows camera access, and excludes app data from cloud backup and device-to-device transfer. Android also sets FLAG_SECURE to restrict screenshots and recordings. iOS covers the UI before app-switcher snapshots; this does not prevent a user taking a screenshot while the app is active. iOS has camera usage text and a privacy manifest for UserDefaults. iOS system/device backups may include the encrypted preferences; this is not a replacement for intentional encrypted wallet backups. Uninstalling, clearing app data, or losing the device can still destroy the vault.

Native apps optionally unlock with Face ID, Touch ID, or Android strong biometrics. iOS protects a random 32-byte wrapping secret in Keychain with `biometryCurrentSet` and `WhenPasscodeSetThisDeviceOnly`. Android encrypts that secret with an AES-256-GCM hardware-backed Keystore key requiring strong biometric authentication for every operation. Device PIN fallback is excluded. The secret wraps the app encryption key; vault passphrases and wallet passwords are never stored by the biometric plugin. Wallet passwords remain necessary to sign.

The vault passphrase remains the recovery method. Changed biometrics, removed device passcodes, restored backups or unavailable hardware can invalidate biometric access. Unlock with the vault passphrase, remove device unlock, then enroll again. Cancellation, background locking and stale authentication results must not reopen a locked vault. Physical-device acceptance must cover enrollment, cold-start unlock, cancellation, wrong fingerprints, changed enrollment, passcode removal, backgrounding, and passphrase recovery. Native compilation alone does not validate these hardware behaviors.

Capacitor's platform floors are iOS 15 and Android 7/API 24, but these are not a promise that every old phone can run the signing code. The bundled app requires a sufficiently current WebView with ES2022, module workers, Web Crypto, BigInt and crypto.randomUUID. Validate a specific phone before importing any keys. The PWA requires a maintained browser with service-worker support.

For iOS use Xcode 26+ and a selected signing team for a physical-device build. Free Apple provisioning is time-limited and is not suitable for a signer intended to remain usable for years; distribution and signing lifetime must be settled before deployment. A simulator build validates compilation only. For Android use JDK 21 and Android SDK 36; production APKs need a retained release-signing key.

## Recovery and release checklist

Keep an independent encrypted wallet backup and its password. Verify cold starts with VPN disabled, airplane mode enabled, and Wi-Fi/Bluetooth off, camera transfers, app/background locking, optional persistence, corrupted/missing PWA cache entries, OS storage pressure, native persistence across restart, and upgrade/backup behavior on real iOS and Android devices. Automated tests and successful compilation do not replace those acceptance checks.

If Xcode waits on Keychain lookup while resolving public packages, a command-line build can use `-packageAuthorizationProvider netrc`. No credentials are required for the pinned public Capacitor artifacts.

