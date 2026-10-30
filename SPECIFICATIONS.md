# QRL Latch wallet integration specification v1

**Status: unreleased draft.** This specification defines the protocol being implemented with Latch. It may change during development and review.

This document is for third-party QRL v2.0 wallet providers. The online wallet sends **unsigned transactions to Latch**, then receives **signed transactions from Latch**, verifies them against the retained request and broadcasts them. Latch keeps private keys offline and has no RPC or broadcast client.

Transfers, contract calls and contract deployment are all part of v1. There is one transaction message format, with explicit operation intent. QR frame `v: 2` and transaction message `version: 1` are separate fields defined below.

This file is the canonical repository specification. The [HackMD document](https://hackmd.io/mNMYWRjgTumJIB9MGb6S0w) mirrors it for review.

## 1. Purpose and scope

Some QRL users keep their private key on a device that never connects to a network: the **offline device**, usually an old phone running the signer as an installed web app with networking turned off. To spend funds they also need an **online device** that talks to a QRL node.

The transaction exchange uses QR codes: one device displays frames and the other scans them. Encrypted backups can also use files as described in section 16.

This document defines:

1. the messages that cross the gap (an unsigned transaction going in, a signed transaction coming out),
2. how a message is cut into QR codes and put back together,
3. what each device **must check** before it signs, displays or broadcasts anything.

Any QRL app that follows this document can build transactions for, and broadcast transactions from, any conforming signer.

Sections 5–15 define the transaction exchange. Sections 16–17 describe encrypted backup interoperability and Latch device behavior. Node consensus and arbitrary contract semantics are outside this specification.

### 1.1 Requirement words

- **MUST / MUST NOT**: required for conformance. Other implementations will reject your data, or you will accept data you should have rejected.
- **SHOULD / SHOULD NOT**: required unless you have a specific reason and understand what breaks.
- **MAY**: optional.

### 1.2 Terms

| Term | Meaning |
|---|---|
| Online device | The internet-facing app. Talks to a QRL node over JSON-RPC. Never sees the key. |
| Offline device / signer | The airgapped device. Holds the encrypted seed. Never talks to a network. |
| Message | One complete JSON object being transferred. |
| Frame | One QR code. A message is split across 1 to 256 frames. |
| Session | One message transfer. All frames of one message share a session ID. |
| ACK frame | Optional QR code shown by the receiver, listing the frames it already has. |
| Quantity | An unsigned integer written as `0x`-prefixed lowercase hex with no leading zeros (section 5.4). |
| Unit | The chain's smallest amount. 1 Quanta = 10¹⁸ units. |

---

## 2. Threat model

Read this section first. Every MUST in sections 10 and 11 follows from it.

| Assumption | Consequence |
|---|---|
| The **online device may be compromised**. Malware, a malicious website or a hostile RPC node can change anything it shows or sends. | The signer MUST NOT trust any field it is sent. It validates every field and **shows the user everything that will be signed** before asking for the password. |
| The **offline device is trusted** only while it stays offline and runs the code the user installed. | The signer MUST try to detect a network connection and refuse to unlock while one is present. Its code MUST NOT change silently. |
| The **user reads the signer's screen**. This is the only check that stops a compromised online device from redirecting funds. | The signer's display rules (section 11.4) are security requirements, not UI suggestions. |
| **Camera input is untrusted.** Any QR code in view, including one made by an attacker, can be scanned. | Receivers MUST strictly parse every frame, enforce size limits, and never mix frames from two sessions. |
| **Nothing secret crosses the gap.** Both transactions are public once broadcast. | Frames are not encrypted (`n: 1`). Confidentiality is not a goal; integrity and correct display are. |

What this protocol does **not** protect against: a user who approves a transaction without reading it, a signer whose code has already been replaced, or a stolen offline device with a weak password.

---

## 3. Flow

```
 ONLINE DEVICE                                            OFFLINE DEVICE

 1. Get nonce, chainId, base fee from the node
 2. Build qrl-unsigned-tx, KEEP A COPY
 3. Show it as frames            ────camera────▶  4. Receive frames, rebuild message
                                                  5. Validate every field (11.3)
                                                  6. Show everything that will be signed (11.4)
                                                  7. User approves + enters password
                                                  8. Sign only the validated fields
 10. Receive frames, rebuild msg  ◀───camera────  9. Show qrl-signed-tx as frames
     (optional: show ACK QR     ────camera────▶     hide frames already received)
 11. Decode the signed tx, compare with the copy from step 2,
     check the signature and sender (10.4)
 12. Broadcast
```

Both directions use the same frame format (section 6). Either direction MAY need several frames.

---

## 4. Layers

```
 Message object
   │ JSON.stringify  (no whitespace)
 JSON text
   │ UTF-8
 Bytes
   │ Base85 (6.1)
 One Base85 string
   │ cut into 593-character chunks (6.2)
 Chunks ─▶ one frame object per chunk (6.3) ─▶ JSON.stringify ─▶ one QR code each (7)
```

The Base85 string is cut at arbitrary positions. A single chunk is **not** valid Base85. Receivers MUST join all chunks, in page order, **before** decoding.

---

## 5. Messages

Every message is a JSON object with a `type` string and a `version` integer. A receiver MUST reject a message if:

- it is not a JSON object;
- `type` is not the one it expects at that point (the signer expects only `qrl-unsigned-tx`; the online device expects only `qrl-signed-tx`);
- `version` is not `1`;
- it contains any top-level key other than the ones listed for that type.

### 5.1 `qrl-unsigned-tx` (online → offline)

```json
{
  "type": "qrl-unsigned-tx",
  "version": 1,
  "operation": "transfer",
  "tx": {
    "from": "Qcf367022afc50b7306db67a658aaafc142f545c90000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    "to": "Q20202020202020202020202020202020202020200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    "value": "0xde0b6b3a7640000",
    "gasLimit": 21000,
    "type": "0x2",
    "chainId": "0x7e7e",
    "nonce": "0x0",
    "maxPriorityFeePerGas": "0x174876eabc",
    "maxFeePerGas": "0x174876eac2",
    "gas": "0x5208"
  }
}
```

The addresses and `chainId` above are example values only.

Top-level keys: exactly `type`, `version`, `operation`, `tx`.

`operation` MUST be `transfer`, `call` or `deploy`:

| Operation | `to` | `data` |
|---|---|---|
| `transfer` | Valid address | Absent or `"0x"` |
| `call` | Valid address | Nonempty lowercase hex bytes |
| `deploy` | Explicitly present and exactly `null` | Nonempty initialization bytecode |

Missing `to`, an empty string and `"0x"` MUST NOT imply deployment. Operation/data mismatches MUST be rejected. Transaction data is limited to 48,000 bytes. Senders MUST also reject a complete encoded message that exceeds 256 frames, including signed replies, which contain the signature and public key.

Allowed keys inside `tx`. **Any other key MUST cause the signer to reject the message.**

| Key | Format | Required | Rule |
|---|---|---|---|
| `from` | address (5.3) | MUST | MUST equal the signer's own wallet address (case-insensitive). Not signed. Used to catch "wrong wallet" mistakes. |
| `to` | address (5.3) or `null` | MUST | Recipient for transfer/call; exactly `null` for deployment. |
| `value` | quantity | MUST | Amount in units. ≤ 2²⁵⁶−1. `0x0` allowed. |
| `type` | string | MUST | Exactly `"0x2"`. |
| `chainId` | quantity | MUST | 1…2⁶⁴−1. MUST be in the signer's allowed set (11.2). |
| `nonce` | quantity | MUST | < 2⁶⁴−1. |
| `maxPriorityFeePerGas` | quantity | MUST | Tip per gas, in units. ≤ 2²⁵⁶−1. |
| `maxFeePerGas` | quantity | MUST | Maximum total fee per gas, in units. MUST be ≥ `maxPriorityFeePerGas`. |
| `gasLimit` | JSON integer or quantity | MUST | 21000 ≤ `gasLimit` ≤ 2⁶⁴−1. This is the value that is signed. |
| `gas` | quantity | MAY | Gas estimate from the node. Informational only, never signed. |
| `data` | data (5.4) | MAY | Call data or deployment bytecode. Missing means `"0x"` and is valid only for a transfer. |

`accessList` is **not** allowed. The signer always signs an empty access list.

The signer MUST build the object it signs from these validated fields only. It MUST NOT pass the received `tx` object to a signing library as-is (section 11.5).

### 5.2 `qrl-signed-tx` (offline → online)

```json
{
  "type": "qrl-signed-tx",
  "version": 1,
  "rawTransaction": "0x02f91c71827e7e8085174876eabc85174876eac2825208…"
}
```

Top-level keys: exactly `type`, `version`, `rawTransaction`.

| Key | Format | Rule |
|---|---|---|
| `rawTransaction` | data (5.4) | MUST start with `0x02`. It is `0x02` followed by the RLP encoding of `[chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data, accessList, descriptor, extraParams, signature, publicKey]`. |

Size: ML-DSA-87 signatures are 4,627 bytes and public keys 2,592 bytes, so a plain transfer is about 7.3 KB (≈14,600 hex characters, **31 frames**). A plain unsigned transfer with QRL v2.0 addresses is **2 frames**. Both sides MUST support multi-frame transfers in both directions.

### 5.3 Addresses

Every QRL v2.0 address is exactly **64 bytes**, represented on the wire as uppercase `Q` followed by **128 hexadecimal characters** (129 characters total). This is the deployed format, not a future upgrade. Other lengths MUST be rejected; implementations MUST NOT pad, shorten, migrate or compare only prefixes.

- The hex body may be entirely lowercase without a checksum. The mandatory `Q` prefix does not count as an uppercase checksum character.
- If **any** hex character is uppercase (`A`–`F`), the entire address MUST match QRL's canonical EIP-55-style checksum exactly. This includes all-uppercase bodies: they receive no case-uniform exemption. An invalid checksum MUST be rejected before any lowercasing or comparison.
- QRL's checksum uses **SHAKE-256**, not Ethereum's Keccak-256: hash the UTF-8 bytes of the 128-character lowercase hex body, without `Q`, producing 64 output bytes. Uppercase each letter whose corresponding hash nibble is at least 8; leave other letters lowercase. This matches `toChecksumAddress` / `isValidChecksumAddress` in `@theqrl/wallet.js` and `ToChecksumAddress` / `IsValidChecksumAddress` in `go-qrllib`.
- The libraries' permissive validators accept all-uppercase bodies without verification; implementations MUST use the strict checksum helper when uppercase hex is present.
- Messages MUST use uppercase `Q`; lowercase `q`, `0x` and missing prefixes MUST be rejected on the wire. Online input may normalize a prefix to `Q` before building a message, but MUST preserve hex case until checksum validation succeeds.
- Only after validation may complete addresses be compared case-insensitively. Check both sender and recipient, and the stored wallet address. For explicit contract deployment, `to: null` remains the sole recipient exception.

### 5.4 Value formats

| Name | Pattern | Examples | Notes |
|---|---|---|---|
| quantity | `^0x(0\|[1-9a-f][0-9a-f]*)$` | `0x0`, `0x5208`, `0xde0b6b3a7640000` | Lowercase hex, no leading zeros. Not a JSON number. This is what QRL JSON-RPC returns. |
| data | `^0x([0-9a-f]{2})*$` | `0x`, `0xa9059cbb` | Lowercase, even length. `0x` alone means empty. |
| integer | JSON integer | `21000` | Allowed only for `gasLimit`. MUST be a safe integer (≤ 2⁵³−1). |

Strict formats matter: a signing library that quietly accepts `"0x00de"` or `"de"` lets two different strings mean the same number, or turns an invalid string into zero. Rejecting non-canonical input means the signer and the online device always agree on what was signed.

---

## 6. Frame format

### 6.1 Base85

Base85 turns bytes into text using 85 printable characters (4 bytes → 5 characters). The alphabet is RFC 1924's. It contains no `"` or `\`, so the result needs no escaping inside a JSON string:

```
0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~
```

(Index 0 is `0`, index 84 is `~`.)

**Encode**

1. Take 4 bytes at a time as a big-endian unsigned 32-bit number `n`.
2. Write `n` as exactly 5 base-85 digits, most significant first, using the alphabet.
3. Last group with `k` bytes (1–3): pad with zero bytes to 4, encode, keep the first `k + 1` characters.
4. No short forms (no Ascii85 `z`), no line breaks, no delimiters.

**Decode**: receivers MUST reject the input if any of these happen:

- a character outside the alphabet;
- a final group of exactly 1 character (`length % 5 == 1`);
- a group whose value is more than 2³²−1 (e.g. `~~~~~`).

Otherwise: take 5 characters at a time, `n = n*85 + index`, output 4 big-endian bytes. A final group of `m` characters (2–4) is padded with `~` to 5, decoded, and keeps the first `m − 1` bytes.

The encoder and strict decoder are `base85Encode` and `base85Decode` in section 18.

Use plain arithmetic, not JavaScript bitwise operators. `n` reaches 2³²−1, and `|` and `>>` treat values as signed 32-bit.

| Input (UTF-8) | Base85 |
|---|---|
| (empty) | (empty) |
| `a` | `VE` |
| `ab` | `VPX` |
| `abc` | `VPaz` |
| `abcd` | `VPa!s` |
| `abcde` | `VPa!sWd` |
| `Hello` | `NM&qnZv` |
| decode `~~~~~` | **error** (overflow) |
| decode `VPa!sW` | **error** (dangling character) |

### 6.2 Chunking

Senders MUST cut the Base85 string into chunks of **593 characters**. The last chunk may be shorter. Number the chunks from 1.

Receivers MUST accept any chunk length from 1 to 1,024 characters, so a future sender can use smaller chunks for cheaper cameras.

### 6.3 Frame object

```json
{"v":2,"p":1,"t":31,"d":"dm?msaAhJoB6@FbWG!=PXKrO=Ep&JyEFyMga…","c":"0","s":"DD03412980374F82","e":"85","n":1}
```

| Key | Format | Sender | Receiver MUST reject the frame if… |
|---|---|---|---|
| `v` | integer | MUST be `2` | not `2` |
| `p` | integer | page number, 1…`t` | not an integer, or outside 1…`t` |
| `t` | integer | total frames, the same in every frame | not an integer, or outside 1…256 |
| `d` | string | this chunk | empty, longer than 1,024, or has a non-alphabet character |
| `c` | string | checksum of `d` (6.4) | not 1 digit or 8 hex digits, or does not match `d` |
| `s` | string | session ID, MUST be sent | present and not exactly 16 characters of `[0-9A-F]` |
| `e` | string | MUST be `"85"` | not exactly `"85"` |
| `n` | integer | MUST be `1` (not encrypted) | not exactly the number `1` |
| `a` | — | MUST NOT be present | present (that is an ACK frame, section 9) |

Receivers MUST ignore unknown keys in frames. That leaves room for additive changes later.

The whole frame text MUST NOT exceed 1,200 characters. Receivers MUST check this before parsing the JSON.

Session ID: 8 bytes from a cryptographically secure random source, written as 16 uppercase hex characters. Generate a new one for every message, including each new signed transaction.

See `newSessionId` in section 18.

### 6.4 Checksum

The checksum is computed over the UTF-8 bytes of `d`:

- `h = SHA-256(d)`
- **Compact** (senders SHOULD use it): add up all 32 bytes of `h`, take the sum modulo 10, and write the result as one digit.
- **Long** (receivers MUST also accept it): the first 4 bytes of `h` as 8 hex characters. Compare case-insensitively.

A receiver tells the forms apart by length: 1 character means compact, 8 means long.

See `checksum` in section 18.

| `d` | compact | long |
|---|---|---|
| `hello` | `5` | `2CF24DBA` |
| `12345` | `1` | `5994471A` |
| `abc` | `0` | `BA7816BF` |

The checksum is **not** a security control. Anyone can compute it. It catches misreads and mixed-up frames. Real integrity comes from three things: the strict parsing in section 8, the signer's display step, and the online device's check of the signed transaction (10.4).

### 6.5 Example: complete multi-frame message

Serialize the section 5.1 object with `JSON.stringify` in the displayed key order, encode its UTF-8 bytes with Base85, and split at 593 characters. The following deterministic construction produces the complete frames, including checksums, without a second hand-maintained copy of the payload:

```js
import { encodeMessage } from './shared/src/lib/airgap-v1.js'
const frames = await encodeMessage(unsignedMessage, 'CA36F456F5DFE2E2')
```

`unsignedMessage` is the object in section 5.1. The fixed session ID is for fixtures only; production senders MUST generate a fresh random session ID. Section 18 links the implementation and executable tests.

---

## 7. Showing and scanning QR codes

### 7.1 Rendering

| Setting | Value |
|---|---|
| Content | The frame JSON text, exactly |
| Error correction | `M` or higher |
| Quiet zone | ≥ 2 modules |
| Displayed size | ≥ 256 px square, on a white background |
| QR version | Chosen by the QR library. Don't force a version or byte mode. A full frame is about 670 characters; choose a size that remains readable by the receiving camera. |

### 7.2 Animation (when `t > 1`)

- Loop the frames continuously and provide slower/faster playback. Latch and the online wallet both use 550 ms per frame by default, with 900 ms (Slow) and 300 ms (Fast) alternatives.
- Provide pause, previous and next, and show "frame X of T".
- With a valid ACK (section 9), skip frames the receiver already has.

### 7.3 Scanning

- Use the rear camera at about 10 scans per second.
- Pass every decoded string to the receiver algorithm (section 8).
- Show which pages have arrived (e.g. numbered boxes) and `received / total`.
- Provide a "start over" control that clears all receiver state.

---

## 8. Receiver algorithm

```
state: total = null, session = null, pages = {}            (page → chunk)

for each scanned string:
  1. If it is longer than 1,200 characters → IGNORE.
  2. Parse as JSON. Not an object → IGNORE.
  3. Apply every rule in the 6.3 table, including the checksum. Any failure → IGNORE.
  4. If total is null: total = t, session = s.
  5. If t ≠ total or s ≠ session → CONFLICT.
  6. If pages already has p:
        same chunk → DUPLICATE (ignore)
        different chunk → CONFLICT
  7. pages[p] = d
  8. If pages has total entries → COMPLETE:
        text  = pages[1] + … + pages[total]
        bytes = strict Base85 decode (6.1)         error → FAIL
        json  = strict UTF-8 decode                invalid UTF-8 → FAIL
        msg   = JSON.parse(json)                   error or not an object → FAIL
        validate msg (section 5)                   any failure → FAIL
```

- **IGNORE**: drop the string silently and keep scanning. The camera will see a good copy soon.
- **CONFLICT**: a frame from a different transfer, or a page that changed. Keep the existing pages and tell the user "a QR code from a different transfer was scanned". Offer "start over". Don't switch sessions automatically.
- **FAIL**: tell the user the transfer was corrupt or invalid, with the reason, and clear all state.
- Frames can arrive in any order and any number of times.
- A receiver MUST NOT act on a partial message.

---

## 9. ACK frames (optional)

An ACK lets the receiver tell the sender which frames it already holds, so the sender shows only the missing ones. The receiver displays the ACK QR on its own screen. The sender's user scans it whenever they choose; the two devices don't need to face each other at the same time.

Support is optional on both sides. Without it, the sender just keeps looping all frames.

```json
{"v":2,"a":1,"t":31,"r":"17030000","s":"DD03412980374F82"}
```

| Key | Rule |
|---|---|
| `v` | `2` |
| `a` | `1` (marks an ACK) |
| `t` | total frames of the transfer being acknowledged |
| `r` | bitfield, exactly `2 × ceil(t / 8)` lowercase hex characters |
| `s` | the session ID of the transfer being acknowledged; MUST be present if the data frames had one |

**Bitfield:** page `p` is bit `(p − 1) & 7` (bit 0 = least significant) of byte `(p − 1) >> 3`. Bytes are written in order, two hex characters each. Bits for pages above `t` MUST be zero.

| `t` | Pages received | `r` |
|---|---|---|
| 10 | 1 | `0100` |
| 10 | 8 | `8000` |
| 10 | 9 | `0001` |
| 10 | 2, 3, 5, 9, 10 | `1603` |
| 10 | all | `ff03` |
| 31 | 1, 2, 3, 5, 9, 10 | `17030000` |
| 10 | — | `ff07` is **invalid** (bit for page 11 set) |

**Receiver showing the ACK:** regenerate it whenever a page arrives. After the last page, keep the complete ACK on screen for about 1.5 seconds.

**Sender reading the ACK:** reject an ACK if `t`, `s` or the length of `r` doesn't match, or if a bit is set beyond `t`. Replace the known-received set with the new one (don't merge). Skip received frames. When every page is received, stop and tell the user.

An ACK only changes **which frames are shown**. It MUST NOT trigger signing, broadcasting, or deleting anything.

---

## 10. Online device requirements

### 10.1 Inputs

- Validate `from` and transfer/call `to` under section 5.3 before case normalization. For deployment, require `to: null`.
- Parse the amount with decimal-string or BigInt arithmetic, never floating point. Reject negative amounts and amounts with more than 18 decimal places of Quanta. Zero native value is valid, including contract calls and deployment.

### 10.2 Build

| Field | Source |
|---|---|
| `nonce` | `qrl_getTransactionCount(from, "pending")` |
| `chainId` | `qrl_chainId` |
| base fee | `baseFeePerGas` of `qrl_getBlockByNumber("pending", true)` |
| `maxPriorityFeePerGas` | The online wallet's fee policy; display it for review. |
| `maxFeePerGas` | MUST be ≥ base fee + tip. SHOULD be `2 × base fee + tip`, so the transaction still gets included if the base fee rises. |
| `gasLimit` | Use `qrl_estimateGas` for calls and deployment, omitting `to` from the RPC request only for deployment. Round up a 20% margin. A simple transfer may use `21000`. |
| `gas` | MAY include the `qrl_estimateGas` result. |

All quantities MUST be canonical (5.4). The RPC already returns canonical hex; for values you compute, use `'0x' + bigint.toString(16)`.

The online wallet MUST check that the RPC chain ID matches the user's selected chain before constructing the request and again before broadcasting. It MUST retain the complete unsigned message, including `operation` and `version`. A network label or public-address QR does not authenticate a chain.

Build exactly `{type:"qrl-unsigned-tx", version:1, operation, tx}` using section 5.1. Deployment uses `to: null` in the QR message even though the RPC estimation and signing-library objects omit `to`. Never infer deployment from a missing recipient.

### 10.3 Show

Encode the message with `encodeMessage` (section 18) and show each returned string as one QR code.

The online device MUST keep the complete unsigned request it built until the signed transaction comes back or the user cancels. It MUST accept a signed transaction only while it is waiting for one.

### 10.4 Verify before broadcast

After receiving a `qrl-signed-tx`, the online device MUST decode `rawTransaction` and check **all** of these before broadcasting:

- the reply type is `qrl-signed-tx`, its version is `1`, and its fields match section 5.2;
- `chainId`, `nonce`, `to`, `value`, `gasLimit`, `maxFeePerGas`, `maxPriorityFeePerGas` and `data` equal the copy it kept; deployment MUST have no signed recipient;
- `accessList` is empty;
- the signature verifies;
- the sender derived from the signature's public key equals `from`.

If any check fails, the online device MUST NOT broadcast. It MUST show which fields differ. `verifySignedReply` in section 18 checks the signed fields and signature. The online app separately checks the active RPC/network before broadcasting. A bare raw transaction is not a protocol reply.

### 10.5 Broadcast

Send `rawTransaction` unchanged with `qrl_sendRawTransaction`. Show the returned hash, or the node's error message in full if it fails.

---

## 11. Offline device (signer) requirements

### 11.1 Environment

- The signer MUST run offline. It SHOULD check `navigator.onLine` (or the platform equivalent) before decrypting the seed. If it finds a network connection, it MUST NOT decrypt; it MUST tell the user to turn networking off. The platform connectivity signal cannot prove Internet access or an air gap. On iOS, an active VPN has been observed to keep the connection indicator online even in airplane mode with Wi-Fi and Bluetooth off. Disable the VPN and any automatic reconnection, then close and reopen Latch with Wi-Fi and Bluetooth still off. The indicator is a platform connectivity report, not proof of Internet access or of an air gap. Latch continues to block unlocking while the platform reports a connection.
- Latch serves its installed cache without network fallback and refuses replacement builds while sealed. Updates require completed logical wiping and explicit empty-device maintenance authorization; see section 17.
- The signer MUST be separate from the online wallet. Latch uses a dedicated PWA origin or a native package. This separation does not protect against a compromised browser, OS or publisher.

### 11.2 Wallet storage and network

- The seed MUST be stored only in encrypted form (e.g. a scrypt + AES keystore). For signing, decrypt only after approval and wallet-password verification; discard plaintext references afterwards. Wallet import and recovery may also require decryption. JavaScript cannot guarantee forensic zeroization.
- The signer MUST record, at wallet setup, which allowed chain ID for each wallet, using the fixed 64-byte address format (5.3). It MUST reject any message whose `chainId` isn't in that set.
- Removing the stored wallet MUST require an explicit confirmation that warns the user to have a backup.

### 11.3 Validation

Before showing anything, the signer MUST apply every rule in sections 5.1, 5.3 and 5.4. At minimum it MUST reject:

- unknown top-level or `tx` keys, including `accessList`;
- a missing `to`, a null recipient outside deployment, or an operation/data mismatch;
- `from` that is not the stored wallet's address;
- `type` other than `"0x2"`;
- a `chainId` that isn't allowed;
- non-canonical quantities, quantities out of range, or JSON numbers anywhere other than `gasLimit`;
- `maxFeePerGas < maxPriorityFeePerGas`, or `gasLimit < 21000`;
- malformed `data`.

### 11.4 Display

The signer displays operation, network name and chain ID, full sender and destination addresses, exact native value, maximum network fee, maximum native cost, nonce, gas limit, both fee-per-gas fields, transaction type and the empty access list.

For call data, it shows byte length, the selector when at least four bytes are present, and the complete raw bytes in an expandable inspection view. For deployment it shows initialization bytecode, its length, and an explicit deployment warning. The user must acknowledge review before providing the wallet passphrase.

An offline signer cannot verify arbitrary contract behavior from a selector or an ABI supplied by the online device. It MUST NOT imply that the displayed native QRL value bounds token transfers or approvals. ABI decoding and offline simulation are future extensions; this version supports explicit raw-data signing with a warning, not semantic verification of arbitrary contracts.

The approve control MUST be separate from scanning. A scan cannot trigger signing on its own.

### 11.5 Signing

- Sign an object built only from the validated fields: `type`, `chainId`, `nonce`, `to`, `value`, `gasLimit`, `maxPriorityFeePerGas`, `maxFeePerGas`, `data`, and `accessList: []`. With `@theqrl/web3-qrl-accounts`, that is `signTransaction(TransactionFactory.fromTxData(toSign), hexSeed)`.
- For deployment only, omit `to` from the fresh signing-library object. Show "Contract deployment" and "New contract" in review.
- `from` and `gas` MUST NOT be passed to the signing library.
- Clear the password field and drop the seed whether signing succeeds or fails.

### 11.6 Reply

Encode `{ "type": "qrl-signed-tx", "version": 1, "rawTransaction": … }` as frames with a **new** session ID. The signer MAY read ACK frames (section 9).

---

## 12. Security considerations

- **Redirected payments.** A compromised online device can build a transaction to its own address. Only the signer's display (11.4) and the user reading it stop this. Every field that gets signed is shown, which is why unknown fields are rejected rather than ignored.
- **Hidden contract calls.** Without the `data` rule, an attacker could send a token-transfer call disguised as a 0-Quanta payment. Signers show and flag any `data`.
- **Fee drain.** Signers show the maximum fee, so an inflated `gasLimit` or `maxFeePerGas` is visible.
- **Cross-network replay.** `chainId` is signed and must be in the signer's allowed set. It cannot distinguish networks that reuse the same chain ID.
- **Wrong wallet.** The `from` check stops a signer from signing for a different account than the one the online device expects. The signature would still be valid, but the transaction would come from the wrong account.
- **Compromised signer.** The online device's verification (10.4) catches a signer that signed different values from the ones it was sent.
- **Malicious QR codes.** Size limits (`t` ≤ 256, frame ≤ 1,200 characters, chunk ≤ 1,024) stop a crafted code from exhausting memory. Strict Base85 and UTF-8 decoding stop malformed input from being "repaired" into something unexpected.
- **Session IDs and checksums** prevent mistakes, not attacks. Never rely on them for security.
- **Code integrity.** A web signer that silently updates whenever the phone sees a network can be replaced by whoever controls the server. Empty-device maintenance makes updates explicit, but does not independently authenticate publisher code. Keep key-bearing devices offline.

---

## 13. Version fields

This is the unreleased v1 specification. Transaction messages use `version: 1`, with explicit `operation` required for unsigned requests. Other transaction message versions MUST be rejected. There is no alternate compatibility format.

QR frames and ACK frames use the separate transport marker `v: 2`. This marker does not imply a second transaction specification. Future incompatible changes must define their own version and validation rules before release.

---

## 14. Conformance checklist

**Online device**
- [ ] Validates and normalises addresses as exactly 64 bytes with strict checksum validation.
- [ ] Parses amounts without floating point.
- [ ] Gets `nonce`, `chainId` and base fee from the node; `maxFeePerGas ≥ baseFee + tip` (preferably `2 × baseFee + tip`).
- [ ] Emits explicit transfer/call/deploy intent, canonical quantities and only allowed fields.
- [ ] Frames: 593-char chunks, `v:2`, `s` fresh per message, `e:"85"`, `n:1`, compact checksum.
- [ ] Keeps the built tx; accepts a signed tx only while waiting for one.
- [ ] Receives with the strict algorithm (section 8) and limits.
- [ ] Verifies the signed tx against the kept copy, plus signature and sender (10.4), before broadcasting.
- [ ] Shows node errors in full.

**Signer**
- [ ] Refuses to decrypt while a network connection is detected.
- [ ] Code updates require completed wipe and explicit empty maintenance authorization.
- [ ] Stores the allowed chain ID inside the encrypted vault for each wallet.
- [ ] Receives with the strict algorithm (section 8) and limits.
- [ ] Rejects unknown keys and versions; enforces every rule in 11.3.
- [ ] Shows network, to, exact amount, max fee, nonce, data warning, from (11.4).
- [ ] Signs only the validated fields, with an empty access list.
- [ ] Replies with a new session ID.
- [ ] Confirms before removing the stored wallet.

---

## 15. Test fixtures

1. Base85 table (6.1), checksum table (6.4), ACK table (9).
2. The generated frames in 6.5 decode to the object in 5.1.
3. Round trip: encode any message (10.3), shuffle the frames, add duplicates, and feed them to your receiver; you must get identical JSON back.
4. Each of the following, sent to a signer whose wallet is `Qcf367022afc50b7306db67a658aaafc142f545c90000000000000000000000000000000000000000000000000000000000000000000000000000000000000000` with allowed chain ID `0x7e7e`, MUST be rejected. Start from the 5.1 message and change one thing:

| Change | Reason |
|---|---|
| remove `to` | explicit recipient or deployment null required |
| remove `operation` | explicit intent required |
| `operation` = `"deploy"` with an address recipient | deployment requires null |
| add `"accessList": []` | unknown key |
| `from` = `Q1111…11` | not this wallet |
| `chainId` = `"0x1"` | not allowed |
| `value` = `"0x00de"` | leading zero |
| `value` = `12` (number) | not a quantity |
| `maxFeePerGas` = `"0x1"` | below tip |
| `to` = `q2020…20` | lowercase prefix |
| `gasLimit` = `100` | below 21000 |
| `version` = `2` | unknown version |
| add top-level `"extra": 1` | unknown key |

5. Frames that MUST be ignored (start from any valid frame and change one key): `t: 1000`, `p: 0`, `e: "64"`, `n: 0`, `n` missing, `c: "X"`, wrong checksum digit, `d` containing `"`, `s: "abc"`, `a: 1`, `v: 1`.
6. A signed tx whose `value` differs from the kept copy MUST fail 10.4 verification.

Also test all three operations through real signing and reply verification, explicit-null versus missing recipients, operation/data mismatches, modified signed fields, wrong reply versions and large bytecode. See the executable tests in section 18.

---


## 16. Optional encrypted backup interoperability

Transaction signing does not require wallet import or backup support. Implementations offering these features MUST keep their message types separate from transactions and public-address QR codes.

### 16.1 Authenticated encryption

New Latch-compatible encrypted wallet files use AES-256-GCM with a 256-bit key, a fresh random 96-bit IV per encryption, and a 128-bit authentication tag. Password keys use scrypt with a fresh random 32-byte salt, `N=65536`, `r=8`, `p=1`, `dkLen=32`. New passphrases require at least 16 characters; this length rule is not an entropy guarantee. Recommend randomly chosen words. AES-256 provides a conservative symmetric-key choice for quantum resistance; password entropy and device security still limit protection.

The JSON envelope fields, in canonical authenticated-header order, are:

```
format: "qrl-latch-encrypted"
version: 1
purpose: "wallet" or "vault"
cipher: "AES-256-GCM"
kdf: {name:"scrypt", n:65536, r:8, p:1, salt:<lowercase hex>}
iv: <12 bytes, lowercase hex>
ciphertext: <encrypted JSON plus GCM tag, lowercase hex>
```

GCM additional authenticated data is UTF-8 of `JSON.stringify({format,version,purpose,cipher,kdf,iv})` in that order. Wallet plaintext contains `hexSeed`, and may include a derived `address`. Vault plaintext contains the wallet collection, with each seed still independently encrypted by its wallet passphrase. A wallet envelope MUST NOT be accepted as a vault or vice versa.

Readers cap file sizes and validate KDF parameters before deriving any key. This profile accepts scrypt powers of two from 16384 through 262144, only `r=8`, `p=1`, and a 32-byte derived key. Legacy AES-128-CTR/v3 keystores are import-only, with MAC validation and bounded KDF parameters. They are re-encrypted on import. Wallet implementations must support this authenticated format to read new files; support for legacy keystores alone is insufficient.

### 16.2 Individual wallets and whole vaults

Migration has its own explicit import screen and message type:

`{type:"qrl-encrypted-wallet",version:1,wallet:<authenticated wallet envelope>,metadata:<public label/address/network hints>}`.

The message uses the same strict framing limits. `n:1` means the transport layer does not encrypt the message; the `wallet` payload is already encrypted. Seeds, mnemonic words, vault passphrases, wallet passwords, device wrappers and decrypted vaults MUST NOT be exported in these codes.

The destination decrypts with the existing wallet password, derives the address independently, asks the user to select/verify the network, and re-encrypts with a new wallet passphrase inside its own vault. Public metadata is never authoritative. Both devices remain offline. The user verifies the new wallet and backup before explicitly confirming removal of the old copy. Recording the QR stream permits offline password guessing, so strong wallet passphrases matter.

Whole-vault backups use `{type:"qrl-latch-vault-backup",version:1,encrypted:<authenticated vault envelope>}`. Restore is permitted only into a fresh, verified offline vault and does not merge existing collections. It preserves encrypted wallet records and validated metadata, then encrypts the collection under a new vault passphrase. Device credentials are excluded. QR transfers retain the 256-frame limit; larger backups require files. Users must verify restored addresses and individual wallet access before wiping the source. Rotating a vault passphrase does not change old backups or individual wallet passwords.

## 17. Latch device behavior

### 17.1 Installation, locking and updates

Latch is installed as a PWA on its own HTTPS origin before any secrets are entered. All application code, fonts, cryptography and QR decoding are cached locally. The application has no RPC endpoint or transaction broadcast code.

After installation, the user disables networking and reopens the installed app offline before creating the vault. App and wallet decryption are refused while `navigator.onLine` reports a connection. This signal is a precaution, not proof of an air gap. Airplane mode does not necessarily disable Wi-Fi or Bluetooth; the setup instructions must address these explicitly.

On iOS, an active VPN has been observed to keep the connection indicator online even in airplane mode with Wi-Fi and Bluetooth off. Disable the VPN and any automatic reconnection, then close and reopen Latch with Wi-Fi and Bluetooth still off. The indicator is a platform connectivity report, not proof of Internet access or of an air gap. Latch continues to block unlocking while the platform reports a connection.

The shipped service worker serves the pinned cache without a network fallback. A sealed installation refuses replacement builds. The stronger upgrade model is a new device with offline encrypted migration. An optional same-device workflow requires an unlocked vault, the current vault passphrase, tested-backup and external-file acknowledgments, and explicit destructive confirmation before logical wiping. Cleanup must finish before the persistent empty maintenance state permits a user-initiated update check. Only the approved build may install; asset integrity and completeness are checked before activation. Pending updates block offline resealing and restore. Native updates use externally installed signed packages, not downloaded executable code.

Logical deletion does not prove forensic erasure or remove external backups. A PWA cannot prevent browser-managed service-worker update requests or defend against a compromised origin after reconnection. Key-bearing installations must remain offline. See the repository's update workflow and security policy for these boundaries.

The app locks on detected reconnection, hiding/backgrounding, or the configured inactivity timeout (30 seconds, one minute, two minutes by default, or five minutes). An explicitly opened native file picker or device-authentication prompt may defer background locking for at most 30 seconds; explicit locking, detected reconnection, and inactivity locking still apply. Late asynchronous results must not reopen a locked vault. Locking terminates the crypto worker and drops password and seed references. JavaScript does not promise forensic memory erasure. Browser storage eviction, clearing site data, or uninstalling can destroy the only stored copy; separate backups remain necessary.

### 17.2 Device unlock

The vault passphrase is the recovery unlock method. Where available, a platform WebAuthn authenticator with PRF can wrap the app vault key after user verification. Enrollment requires a successful subsequent PRF assertion before storing the wrapper. The credential must report user verification and must not be backup-eligible. Synced passkeys are not accepted by this profile.

Device verification may use biometrics or the OS device PIN. The app does not promise a particular biometric mechanism, and does not offer a standalone short app PIN. Unsupported browsers/authenticators retain passphrase-only unlock. Wallet signing still requires the independent wallet passphrase.

New PWA enrollment is hidden on iOS/iPadOS under Latch's non-sync-eligible credential policy. Previously configured credentials can still be used, tested or removed. Native iOS uses a device-only Keychain secret protected by the current biometric set; Android uses a hardware-backed Keystore key requiring strong biometrics for each operation. Native device-PIN fallback is excluded. The vault passphrase remains the recovery method on every platform.

Device wrappers are local and never included in wallet or whole-vault migration. Real-device offline PRF tests are required before advertising support for any particular phone/browser combination.

### 17.3 Networks and QR usability

Changing an existing wallet's network is discouraged and requires an explicit warning and acknowledgment. It replaces that wallet's allowed chain ID, not its keys or address, and does not move funds. Chain ID binding prevents replay between different chain IDs; it does not authenticate a network or prevent replay on networks that reuse the same chain ID. The signer cannot check network identity offline. Users must verify the intended chain ID independently and review it for each transaction.

Latch and the online wallet use the same default of 550 ms per frame, with 900 ms (Slow) and 300 ms (Fast) alternatives. During QR display or camera scanning, Latch requests a foreground screen wake lock. Native iOS and Android use their platform screen-on controls; the PWA uses the browser Screen Wake Lock API where available. Locks are released when the transfer view closes or the app goes into the background. If the platform denies or revokes the request, the app shows a manual-interaction fallback. Screen wake locks do not extend the vault's configured inactivity timeout or bypass background/reconnection locking.

The public-address QR contains only the plain `Q`-prefixed 128-character hex body. Online wallets may scan it to add an address-only wallet, subject to the address length and checksum validation in section 5.3. They must show the address for confirmation and must not treat a seed, wallet backup or transaction QR as a public address.

## 18. Implementation and acceptance evidence

The repository contains the implementation used by this build. Read it alongside this specification at the same revision; there is no duplicated source listing in this document.

- [QR transport, Base85, checksums and ACKs](shared/src/lib/airgap-v1.js)
- [Transaction validation and signed-reply verification](shared/src/lib/protocol.js)
- [Address validation](shared/src/lib/address.js)
- [Authenticated encryption](shared/src/lib/encryption.js)
- [Protocol and real-signature tests](tests/protocol.test.js)
- [Vault and signed-reply tamper tests](tests/vault.test.js)
- [Security boundaries](SECURITY.md) and [auditor handoff](docs/audit-handoff.md)

Before release, complete physical iOS/Android offline cold starts, long camera transfers, large-bytecode transactions, background/reconnection locking, storage recovery, device-unlock checks and accessibility acceptance. Automated tests do not substitute for these checks.
