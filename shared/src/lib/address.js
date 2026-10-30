import { isValidChecksumAddress } from "@theqrl/wallet.js";
// QRL v2.0 uses 64 bytes. The Q prefix is not part of the case checksum.
export function validateQrlAddress(value, name = "address") {
  if (typeof value !== "string" || !/^Q[0-9a-fA-F]{128}$/.test(value))
    throw Error(
      `${name}: must be Q followed by exactly 128 hex characters (64 bytes)`,
    );
  if (/[A-F]/.test(value.slice(1)) && !isValidChecksumAddress(value))
    throw Error(`${name}: invalid QRL address checksum`);
  return value;
}
