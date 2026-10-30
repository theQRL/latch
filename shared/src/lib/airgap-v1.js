import { validateQrlAddress } from "./address.js";
// Reference implementation of "QRL Airgapped Transaction Signing over QR Codes" v1.0.
// Section numbers (§) refer to that specification. Uses Web Crypto and the QRL wallet checksum validator.

export const CHUNK = 593; // §6.2
const MAX_FRAMES = 256;
const MAX_CHUNK = 1024;
const MAX_FRAME_TEXT = 1200;

// ---------- Base85 (§6.1) ----------

const B85 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
const B85_INDEX = Object.fromEntries([...B85].map((ch, i) => [ch, i]));

export function base85Encode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 4) {
    const k = Math.min(4, bytes.length - i);
    let n = 0;
    for (let j = 0; j < 4; j++) n = n * 256 + (j < k ? bytes[i + j] : 0);
    let group = "";
    for (let j = 0; j < 5; j++) {
      group = B85[n % 85] + group;
      n = Math.floor(n / 85);
    }
    out += group.slice(0, k + 1);
  }
  return out;
}

export function base85Decode(text) {
  if (text.length % 5 === 1) throw new Error("base85: dangling character");
  const out = [];
  for (let i = 0; i < text.length; i += 5) {
    const m = Math.min(5, text.length - i);
    let n = 0;
    for (let j = 0; j < 5; j++) {
      const v = j < m ? B85_INDEX[text[i + j]] : 84;
      if (v === undefined) throw new Error("base85: invalid character");
      n = n * 85 + v;
    }
    if (n > 0xffffffff) throw new Error("base85: group overflow");
    for (let j = 0; j < m - 1; j++)
      out.push(Math.floor(n / 256 ** (3 - j)) % 256);
  }
  return new Uint8Array(out);
}

// ---------- Frames (§6.3, §6.4) ----------

export async function checksum(chunk, compact = true) {
  const h = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(chunk)),
  );
  if (compact) return String(h.reduce((sum, b) => sum + b, 0) % 10);
  return hex(h.slice(0, 4)).toUpperCase();
}

export function newSessionId() {
  return hex(crypto.getRandomValues(new Uint8Array(8))).toUpperCase();
}

// Message object -> array of QR code strings.
export async function encodeMessage(message, sessionId = newSessionId()) {
  const text = base85Encode(new TextEncoder().encode(JSON.stringify(message)));
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK)
    chunks.push(text.slice(i, i + CHUNK));
  return Promise.all(
    chunks.map(async (d, i) =>
      JSON.stringify({
        v: 2,
        p: i + 1,
        t: chunks.length,
        d,
        c: await checksum(d),
        s: sessionId,
        e: "85",
        n: 1,
      }),
    ),
  );
}

// QR string -> { p, t, d, s } or null (§6.3 receiver rules).
export async function parseFrame(text) {
  if (typeof text !== "string" || text.length > MAX_FRAME_TEXT) return null;
  let f;
  try {
    f = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(f) || f.v !== 2 || "a" in f || f.e !== "85" || f.n !== 1)
    return null;
  const { p, t, d, c, s } = f;
  if (!Number.isInteger(t) || t < 1 || t > MAX_FRAMES) return null;
  if (!Number.isInteger(p) || p < 1 || p > t) return null;
  if (
    typeof d !== "string" ||
    !d ||
    d.length > MAX_CHUNK ||
    [...d].some((ch) => !(ch in B85_INDEX))
  )
    return null;
  if (typeof c !== "string" || !/^([0-9]|[0-9A-Fa-f]{8})$/.test(c)) return null;
  if (s !== undefined && !(typeof s === "string" && /^[0-9A-F]{16}$/.test(s)))
    return null;
  if ((await checksum(d, c.length === 1)) !== c.toUpperCase()) return null;
  return { p, t, d, s: s ?? null };
}

// §8. offer() returns 'ignored' | 'duplicate' | 'conflict' | 'stored' | 'complete'.
export class Receiver {
  constructor() {
    this.reset();
  }

  reset() {
    this.generation = (this.generation || 0) + 1;
    this.total = null;
    this.session = null;
    this.pages = new Map();
  }

  async offer(text) {
    const generation = this.generation;
    const f = await parseFrame(text);
    if (generation !== this.generation) return "ignored";
    if (!f) return "ignored";
    if (this.total === null) {
      this.total = f.t;
      this.session = f.s;
    }
    if (f.t !== this.total || f.s !== this.session) return "conflict";
    if (this.pages.has(f.p))
      return this.pages.get(f.p) === f.d ? "duplicate" : "conflict";
    this.pages.set(f.p, f.d);
    return this.pages.size === this.total ? "complete" : "stored";
  }

  // Call only after offer() returned 'complete'. Throws on corrupt data.
  message() {
    let text = "";
    for (let p = 1; p <= this.total; p++) text += this.pages.get(p);
    const msg = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(base85Decode(text)),
    );
    if (!isObject(msg)) throw new Error("message is not an object");
    return msg;
  }
}

// ---------- ACK frames (§9) ----------

export function encodeAck(receivedPages, total, sessionId) {
  const bytes = new Uint8Array(Math.ceil(total / 8));
  for (const p of receivedPages) bytes[(p - 1) >> 3] |= 1 << ((p - 1) & 7);
  return JSON.stringify({ v: 2, a: 1, t: total, r: hex(bytes), s: sessionId });
}

// QR string -> Set of received pages, or null if it is not a valid ACK for this transfer.
export function parseAck(text, total, sessionId) {
  let f;
  try {
    f = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isObject(f) ||
    f.v !== 2 ||
    f.a !== 1 ||
    f.t !== total ||
    f.s !== sessionId
  )
    return null;
  if (
    typeof f.r !== "string" ||
    !new RegExp(`^[0-9a-f]{${2 * Math.ceil(total / 8)}}$`).test(f.r)
  )
    return null;
  const received = new Set();
  for (let i = 0; i < f.r.length * 4; i++) {
    if (
      !(
        (parseInt(f.r.slice((i >> 3) * 2, (i >> 3) * 2 + 2), 16) >> (i & 7)) &
        1
      )
    )
      continue;
    if (i >= total) return null;
    received.add(i + 1);
  }
  return received;
}

// ---------- Unsigned transaction, signer side (§5, §11.3) ----------

const U64 = 2n ** 64n - 1n;
const U256 = 2n ** 256n - 1n;
const TX_KEYS = [
  "from",
  "to",
  "value",
  "gasLimit",
  "type",
  "chainId",
  "nonce",
  "maxPriorityFeePerGas",
  "maxFeePerGas",
  "gas",
  "data",
];

function quantity(name, v, max) {
  if (typeof v !== "string" || !/^0x(0|[1-9a-f][0-9a-f]*)$/.test(v))
    throw new Error(`${name}: not a canonical quantity`);
  if (BigInt(v) > max) throw new Error(`${name}: too large`);
  return BigInt(v);
}

function onlyKeys(obj, allowed, where) {
  for (const k of Object.keys(obj))
    if (!allowed.includes(k)) throw new Error(`unknown ${where} field: ${k}`);
}

// wallet: { address, addressHexLength (128 only), chainIds: Set<bigint> }
// Returns { toSign, display }. Pass only toSign to the signing library.
export function validateTransactionFields(tx, wallet) {
  if (!isObject(tx)) throw new Error("tx missing");
  onlyKeys(tx, TX_KEYS, "tx");

  if (wallet.addressHexLength !== undefined && wallet.addressHexLength !== 128)
    throw Error("QRL v2.0 addresses are always 64 bytes");
  validateQrlAddress(wallet.address, "wallet address");
  const from = validateQrlAddress(tx.from, "from");
  if (from.toLowerCase() !== wallet.address.toLowerCase())
    throw new Error("from is not this wallet");
  const to = validateQrlAddress(tx.to, "to");
  if (tx.type !== "0x2") throw new Error("type must be 0x2");
  const chainId = quantity("chainId", tx.chainId, U64);
  if (!wallet.chainIds.has(chainId))
    throw new Error(`chainId ${tx.chainId} is not allowed for this wallet`);
  const nonce = quantity("nonce", tx.nonce, U64 - 1n);
  const value = quantity("value", tx.value, U256);
  const tip = quantity("maxPriorityFeePerGas", tx.maxPriorityFeePerGas, U256);
  const maxFee = quantity("maxFeePerGas", tx.maxFeePerGas, U256);
  if (maxFee < tip)
    throw new Error("maxFeePerGas is below maxPriorityFeePerGas");
  const gasLimit = Number.isSafeInteger(tx.gasLimit)
    ? BigInt(tx.gasLimit)
    : quantity("gasLimit", tx.gasLimit, U64);
  if (gasLimit < 21000n || gasLimit > U64)
    throw new Error("gasLimit out of range");
  if (tx.gas !== undefined) quantity("gas", tx.gas, U64);
  const data = tx.data ?? "0x";
  if (typeof data !== "string" || !/^0x([0-9a-f]{2})*$/.test(data))
    throw new Error("data: not lowercase hex bytes");

  return {
    toSign: {
      type: "0x2",
      chainId: tx.chainId,
      nonce: tx.nonce,
      to,
      value: tx.value,
      gasLimit: "0x" + gasLimit.toString(16),
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      maxFeePerGas: tx.maxFeePerGas,
      data,
      accessList: [],
    },
    display: {
      from,
      to,
      chainId,
      nonce,
      value,
      maxTotalFee: gasLimit * maxFee,
      data,
    },
  };
}

// Units -> exact Quanta string (1 Quanta = 10^18 units).
export function formatQuanta(units) {
  const s = units.toString().padStart(19, "0");
  const frac = s.slice(-18).replace(/0+$/, "");
  return s.slice(0, -18) + (frac ? "." + frac : "") + " Quanta";
}

// ---------- helpers ----------

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
