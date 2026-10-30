# Security policy and boundaries

Latch is a review-stage offline QRL v2.0 signer. It is not a certified hardware wallet, a formally verified implementation, or a guarantee against device compromise. This policy covers the shared app, cryptographic worker, PWA service worker and updater, native bridges, storage, build scripts, and their dependencies. It does not grant permission to suppress findings.

## What must be trusted

Trust the device hardware, OS, browser/WebView, installed browser extensions, build environment, dependencies, initial distribution, and native package signer. Trust the publisher and HTTPS origin again whenever an empty PWA installation reconnects for an update. A malicious replacement app can steal keys when they are restored later; wiping before updating does not authenticate replacement code.

QR messages, imported files, transaction fields, wallet labels, network metadata, and update responses are untrusted inputs. A QR checksum or receipt detects transfer problems; it does not establish sender identity, backup recoverability, or transaction intent. Test restored wallet access and verify addresses before wiping the source.

## Keys and encryption

The app vault and individual wallets have separate passphrases. New envelopes use AES-256-GCM with authenticated headers and bounded scrypt derivation. ML-DSA signing and AES-256 are not evidence that the entire system is post-quantum secure: passwords, OS credentials, distribution, TLS, dependencies and implementation correctness remain separate assumptions. No short standalone app PIN is supported. Legacy AES-128-CTR wallets are import-only.

New wallets use the wallet library’s Web Crypto random generator inside the worker. The application receives encrypted wallet data and public metadata, not the generated seed. Public addresses and QR codes are visible after app-vault unlock without a wallet passphrase; they are not shown while the app vault is locked. Address QR codes contain only the address, with no chain authentication or private material.

The worker retains the unlocked app key and decrypts wallet material only when needed. It is a process/lifecycle separation aid, not a security boundary against malicious same-origin application code. Termination and best-effort buffer clearing do not guarantee zeroization of JavaScript strings, garbage-collected memory, swap, crash dumps or forensic remnants.

PWA device unlock requires WebAuthn PRF and a user-verified, non-sync-eligible credential. New enrollment is disabled in the iOS/iPadOS PWA by product policy: PRF availability depends on the browser/device, and Apple’s usual platform passkeys are sync-eligible. Platform detection is a UI/product safeguard, not a cryptographic boundary; authenticator flags and PRF output are still checked. Previously configured credentials are not deleted and can still be tested, used or removed. Native iOS biometric unlock uses the separate Keychain implementation. The browser/OS chooses its local verification method, which may include a device PIN. Browser-created credentials rejected by Latch may remain in the OS. Removing the wrapper disables Latch access but cannot generally delete the OS credential.

Native biometric unlock protects a random wrapping secret using iOS Keychain with the current biometric set and device-only accessibility, or a hardware-backed Android Keystore key requiring strong biometrics for each use. Device-PIN fallback is excluded from the native biometric prompt. Vault-passphrase recovery and separate wallet passwords remain necessary.

## Offline boundary

No RPC client is included in the signer. Android's merged manifest removes Internet permission. Native app assets are packaged, with no remote live-update loader. iOS and browser builds do not have an OS-enforced network prohibition. Browser `navigator.onLine` and native connectivity callbacks cannot prove an air gap or stop every connection. Disable VPN reconnection, enable airplane mode, and turn off Wi-Fi and Bluetooth and keep key-bearing devices offline.

On iOS, an active VPN has been observed to keep the connection indicator online even in airplane mode with Wi-Fi and Bluetooth off. Disable the VPN and any automatic reconnection, then close and reopen Latch with the radios still off. The indicator is a platform connectivity report, not proof of Internet access or of an air gap. Latch continues to block unlocking while the platform reports a connection.

The PWA normally serves only its cached, same-origin GET resources. Browsers can fetch and evaluate candidate service workers on reconnection even without an app-initiated update check. Refusing installation in our worker is cooperative behavior of trusted code; it cannot constrain a hostile future worker delivered by a compromised origin. Staying offline is the protection for key-bearing installations.

## Storage and maintenance invariants

The PWA stores encrypted values and lifecycle metadata together in an IndexedDB record. Native apps use one Preferences record. Legacy records migrate before normal use and are removed after migration. This storage is not hardware-isolated vault storage. Quota failures, eviction, user deletion, uninstalling and OS behavior can destroy it. Persistence requests are best effort. A checklist tick for installed mode describes the current window, not device-wide installation discovery. A verified offline startup means this standalone document loaded with no connection reported and its cache was complete; it does not prove that every radio is off or that storage will last for years. New PWA vault creation and restore require that startup check; existing vaults remain recoverable from their original browser context. OS/device backups may preserve encrypted app data; Android backup exclusions do not prove forensic deletion.

Every app write must observe a sealed lifecycle and the session's generation. Wiping atomically removes values and changes the generation, blocking stale cooperating writers. The UI requires an unlocked session, current vault passphrase, tested-backup acknowledgment, acknowledgment about external files, the exact destructive confirmation, and a single PWA window. It terminates the worker and remains in `wiping` until legacy storage, native biometric records and app-owned temporary encrypted backups are removed. A restart must not turn an incomplete wipe into permission to update.

After cleanup, maintenance persists across restart and native package replacement. Creating, importing and signing are disabled. An explicit release check may use the network only in empty maintenance mode; a candidate release may download only when that exact build is authorized. Old app caches remain until replacement files are complete. Explicit offline resealing is required before restoring keys, and pending updates must block resealing. Native updates are signed package installations outside Latch; the app does not fetch executable code or enable Android Internet permission.

The updater uses same-origin HTTPS and SHA-256 subresource integrity to reject incomplete, corrupted or mixed release files. Digests are distributed with the worker and are not independent publisher signatures. Release metadata is not signed, release IDs are content identifiers rather than monotonic security versions, and no cryptographic downgrade prevention is claimed. Retained old caches consume storage; the app fails rather than erasing its fallback to make room for an update.

Maintenance changes the original permanently-offline device model. Logical deletion cannot establish that secrets or encrypted copies are absent from flash remnants, system snapshots, exported files, clipboard history or other apps. A permanently offline signer with migration to a different device is the stronger operating model. External downloads and OS backups need separate user handling. Do not describe the maintenance screen as proof of secure physical erasure.

## Transaction review

Offline signing cannot discover the latest nonce, balances, contract state, malicious contract semantics or arbitrary ABI meaning. Displayed network labels are not chain authentication. Review raw data, recipient, value, chain ID and fees independently. All addresses must be 64 bytes; shorter forms and prefix-only matching are rejected. Any uppercase hex body requires the strict QRL case checksum, including all-uppercase input. Validate before lowercasing or comparison. Parser bounds, operation consistency, signing the exact reviewed transaction, wallet-address binding, and independent wallet-password checks are security requirements.

Changing a wallet's allowed chain ID does not rotate its keys or move funds. This action is discouraged and requires acknowledgment. A signed chain ID separates transactions for distinct chain IDs, but cannot distinguish networks that reuse the same ID. Verify the chain ID independently; an offline signer cannot authenticate a network.

QR views request screen wake locks only while displaying or scanning codes. These prevent automatic dimming where the platform permits it; they do not change the vault inactivity timeout, background lock or reconnection lock. Denial and revocation are normal platform outcomes, not proof that the device is insecure.

## Reporting and release status

Report bypasses of the above controls, unintended key/plaintext exposure, stale-session writes, restore corruption, unauthorized update paths, parser/KDF resource exhaustion, mismatched transaction signing, and ineffective native key protection. Describe realistic prerequisites and impact. Known limitations are context, not blanket exclusions; a claimed mitigation that fails remains reportable. No severity suppression or broad finding exclusions are authorized by this document.

No dedicated private reporting address, response SLA, supported-release matrix, or production signing/distribution process has been established for this review build. Before public distribution, the owner must publish a verified private reporting channel and support policy. Do not publish real mnemonics, private keys, passphrases or user backups in issues.

Automated tests, successful builds and CodeRabbit reviews are not a security audit. Physical-device testing of updates, interrupted wipes, biometrics, WebAuthn, storage pressure, backgrounding and backup recovery is still required. Android debug APKs and unsigned iOS build products are testing artifacts, not authenticated production releases.



## Hosting and release evidence

The dedicated HTTPS origin and Netlify deployment account are part of the trusted distribution boundary. CSP restricts resource loading but permits same-origin scripts and inline styles required by the UI; it cannot make malicious same-origin code safe. Security headers and disabled content injection must be checked on the deployed responses. See [deployment](docs/deployment.md).

Install/update checks verify downloaded asset digests. Subsequent cache-completeness checks verify entries, successful nonempty responses and the installation marker; they do not rehash every cached byte. Neither check proves publisher identity or device integrity. The displayed build identifier covers selected build inputs, not the entire repository history. Record the source revision and artifact hashes separately for review.

[Auditor handoff](docs/audit-handoff.md) lists evidence and outstanding release gates. These are validation requirements, not accepted vulnerabilities or findings exclusions.
