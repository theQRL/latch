# Auditor handoff and release gates

Status: prerelease implementation awaiting independent review and physical-device acceptance. This document is a review map, not an audit result. The root [security policy](../SECURITY.md) defines boundaries without excluding known limitations from review.

## Review map

| Area | Implementation | Existing automated evidence |
| --- | --- | --- |
| Framing, bounds, transaction intent and address checks | `shared/src/lib/{airgap-v1,protocol,address,network}.js` | protocol, address, network tests |
| Encryption, KDF limits, wallet generation and signing | `shared/src/lib/{encryption,crypto-worker,vault-client}.js` | encryption, vault, worker-boundary tests |
| Encrypted backup/restore and password rotation | crypto worker, `vault-backup.js`, `backup-file.js` | vault tests |
| Lifecycle generation, wipe and stale writers | `lifecycle-db.js`, `storage.js`, `maintenance.js` | lifecycle, lifecycle-storage tests |
| PWA install, cache and explicit updates | `apps/pwa/sw.js`, `installation.js`, `install-context.js`, `update-shell.js` | service-worker, installation, install-context, update-shell, update-activation tests |
| Device unlock and native bridges | `device-unlock.js`, `native-biometrics.js`, Swift/Java sources in native projects | device-unlock, native-biometrics tests; hardware acceptance still required |
| Screen wake and auto-lock interaction | `screen-awake.js`, `use-screen-awake.js`, `App.vue` | screen-awake tests; UI/device checks required |
| Distribution and asset integrity | `netlify.toml`, `shared/assets/_headers`, `build-tools/` | build install simulation, hosting checks, post-deploy check |

Tests and mocks are supporting evidence, not proof of the listed invariants. Review native implementations and dependency behavior directly, including platform error and cancellation paths.

## Reproduce and preserve evidence

From a clean checkout with Node 22:

```sh
npm ci
npm test
npm run build
npm run check:deployment -- https://latch.theqrl.org
```

The last command requires a deployment of the same build and is a separate hosting acceptance step. Native compilation requires the platform toolchains in [monorepo setup](monorepo.md). Run native sync before building packages.

Record the full source revision (or a source archive and SHA-256 if reviewing an uncommitted snapshot), lockfile hash, Node/npm and native toolchain versions, commands and logs, artifact hashes, displayed build ID and deployment identifier. The displayed build ID is not a full repository revision. Preserve dependency inventory and scan results with dates; review transitive advisories and licenses rather than treating a clean top-level list as sufficient.

Use disposable generated keys and synthetic chain IDs. Never include real keys, private endpoints, passwords or user backups in review bundles or logs. Any online-wallet counterpart must be versioned alongside interoperability evidence.

## Required before production release

- Independent security review, triage, remediation and retesting of findings across worker, parser, lifecycle, native bridges and distribution.
- Publish a verified private vulnerability-reporting channel, support policy and supported-device/browser matrix. These are not configured yet.
- Establish production native signing, distribution, signing-key custody and long-term offline launch/upgrade behavior. Debug APKs and unsigned iOS builds are not production releases.
- Verify Netlify DNS/TLS, actual response headers, unchanged asset bytes and missing-file responses. Keep content injection disabled and protect publishing access.
- On physical iOS and Android devices, test installation and cold launch offline, VPN behavior, camera/long QR transfers, screen wake, low-memory/storage pressure and recovery from missing cache data.
- Test device unlock offline, rejection/cancellation, biometric enrollment changes, passcode removal, background/reconnection locking and passphrase recovery. Browser mocks cannot validate secure hardware.
- Test transfer/call/deployment request and signed-reply verification with the online implementation; check wrong chain IDs, changed fields, large bytecode, checksummed addresses and exact amounts/fees.
- Test individual and whole-vault backup restoration, wrong passwords, damaged files, vault rotation, interrupted wipes/updates, concurrent windows, stale sessions and retained external backups.
- Complete accessibility and usability acceptance on supported devices, including transaction review, destructive confirmations and installation failure guidance.

Do not advertise guaranteed multi-year cache retention, secure forensic erasure, arbitrary contract verification, independently authenticated PWA updates, or protection from a compromised OS/origin. The implemented controls and their limits are described in SECURITY.md.
