export function normalizeChainId(input) {
  if (typeof input !== "string")
    throw Error(
      "Enter a chain ID as decimal digits or 0x-prefixed hexadecimal.",
    );
  const text = input.trim();
  if (!/^(?:[1-9][0-9]{0,19}|0[xX][0-9a-fA-F]{1,16})$/.test(text))
    throw Error(
      "Enter a positive chain ID as decimal digits or 0x-prefixed hexadecimal (up to 64 bits).",
    );
  const value = BigInt(text);
  if (value < 1n || value > 0xffffffffffffffffn)
    throw Error("Chain ID must be between 1 and 18446744073709551615.");
  return "0x" + value.toString(16);
}
