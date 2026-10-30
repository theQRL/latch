import { scryptAsync } from "@noble/hashes/scrypt.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import aesjs from "aes-js";
export const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export function bytes(s, length) {
  if (
    typeof s !== "string" ||
    !/^([0-9a-f]{2})+$/i.test(s) ||
    (length && s.length !== length * 2)
  )
    throw Error("Invalid encoded bytes");
  return Uint8Array.from(s.match(/../g), (v) => parseInt(v, 16));
}
const random = (n) => crypto.getRandomValues(new Uint8Array(n));
const encoder = new TextEncoder();
export function strongPassword(p) {
  if (typeof p !== "string" || p.length < 16 || p.length > 1024)
    throw Error(
      "Use a passphrase of at least 16 characters, preferably several random words.",
    );
}
function params(k) {
  if (
    !k ||
    k.name !== "scrypt" ||
    !Number.isInteger(k.n) ||
    k.n < 16384 ||
    k.n > 262144 ||
    k.n & (k.n - 1) ||
    k.r !== 8 ||
    k.p !== 1
  )
    throw Error("Unsupported or excessive wallet KDF settings");
  bytes(k.salt, 32);
  return {
    N: k.n,
    r: k.r,
    p: k.p,
    dkLen: 32,
    maxmem: 300 * 1024 * 1024,
    asyncTick: 10,
  };
}
export async function passwordKey(password, kdf) {
  if (typeof password !== "string" || password.length > 1024)
    throw Error("Invalid password");
  return scryptAsync(
    encoder.encode(password),
    bytes(kdf.salt, 32),
    params(kdf),
  );
}
export async function newPasswordKey(password) {
  strongPassword(password);
  const kdf = { name: "scrypt", n: 65536, r: 8, p: 1, salt: hex(random(32)) };
  return { key: await passwordKey(password, kdf), kdf };
}
function header(e) {
  return {
    format: e.format,
    version: e.version,
    purpose: e.purpose,
    cipher: e.cipher,
    kdf: e.kdf,
    iv: e.iv,
  };
}
export async function encrypt(value, key, kdf, purpose) {
  const h = {
    format: "qrl-latch-encrypted",
    version: 1,
    purpose,
    cipher: "AES-256-GCM",
    kdf,
    iv: hex(random(12)),
  };
  const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
    "encrypt",
  ]);
  const plain = encoder.encode(JSON.stringify(value));
  try {
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: bytes(h.iv),
        additionalData: encoder.encode(JSON.stringify(h)),
        tagLength: 128,
      },
      k,
      plain,
    );
    return { ...h, ciphertext: hex(new Uint8Array(encrypted)) };
  } finally {
    plain.fill(0);
  }
}
export function validateEnvelope(e, purpose) {
  if (
    !e ||
    e.format !== "qrl-latch-encrypted" ||
    e.version !== 1 ||
    e.purpose !== purpose ||
    e.cipher !== "AES-256-GCM" ||
    Object.keys(e).some(
      (k) =>
        ![
          "format",
          "version",
          "purpose",
          "cipher",
          "kdf",
          "iv",
          "ciphertext",
        ].includes(k),
    )
  )
    throw Error("Unsupported encrypted file");
  params(e.kdf);
  bytes(e.iv, 12);
  if (typeof e.ciphertext !== "string" || e.ciphertext.length > 1500000)
    throw Error("Encrypted file is too large");
  bytes(e.ciphertext);
  return e;
}
export async function decrypt(e, key, purpose) {
  validateEnvelope(e, purpose);
  const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
    "decrypt",
  ]);
  let plain;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: bytes(e.iv),
          additionalData: encoder.encode(JSON.stringify(header(e))),
          tagLength: 128,
        },
        k,
        bytes(e.ciphertext),
      ),
    );
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
  } catch {
    throw Error("Incorrect passphrase or damaged encrypted file");
  } finally {
    plain?.fill(0);
  }
}
export async function seal(value, password, purpose) {
  const { key, kdf } = await newPasswordKey(password);
  try {
    return await encrypt(value, key, kdf, purpose);
  } finally {
    key.fill(0);
  }
}
export async function open(e, password, purpose) {
  const key = await passwordKey(password, e?.kdf);
  try {
    return await decrypt(e, key, purpose);
  } finally {
    key.fill(0);
  }
}
export async function openLegacy(file, password) {
  const c = file?.Crypto;
  if (
    file?.version !== 3 ||
    c?.cipher !== "aes-128-ctr" ||
    c.kdf !== "scrypt" ||
    c.kdfparams?.dklen !== 32
  )
    throw Error("Unsupported legacy wallet file");
  const p = c.kdfparams,
    kdf = { name: "scrypt", n: p.n, r: p.r, p: p.p, salt: p.salt };
  bytes(c.cipherparams?.iv, 16);
  bytes(c.ciphertext, 51);
  bytes(c.mac, 32);
  const key = await passwordKey(password, kdf);
  try {
    const ciphertext = bytes(c.ciphertext),
      input = new Uint8Array(16 + ciphertext.length);
    input.set(key.subarray(16));
    input.set(ciphertext, 16);
    const mac = keccak_256(input),
      expected = bytes(c.mac);
    let diff = 0;
    for (let i = 0; i < 32; i++) diff |= mac[i] ^ expected[i];
    if (diff) throw Error("Incorrect wallet password");
    const plain = new aesjs.ModeOfOperation.ctr(
      key.subarray(0, 16),
      new aesjs.Counter(bytes(c.cipherparams.iv)),
    ).decrypt(ciphertext);
    try {
      return hex(plain);
    } finally {
      plain.fill(0);
    }
  } finally {
    key.fill(0);
  }
}
