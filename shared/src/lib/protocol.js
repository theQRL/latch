import {
  validateTransactionFields,
  encodeMessage as encodeV1,
  Receiver as ReceiverV1,
  base85Encode,
} from "./airgap-v1.js";
export {
  formatQuanta,
  parseAck,
  encodeAck,
  newSessionId,
} from "./airgap-v1.js";
export class Receiver extends ReceiverV1 {
  message() {
    if (this.total === null || this.pages.size !== this.total)
      throw Error("Transfer is incomplete");
    return super.message();
  }
}
export async function encodeMessage(msg) {
  if (
    base85Encode(new TextEncoder().encode(JSON.stringify(msg))).length >
    593 * 256
  )
    throw Error(
      "Transfer exceeds 256 QR frames. Use an encrypted backup file for a large vault, or reduce transaction data.",
    );
  return encodeV1(msg);
}
export function validateUnsignedTx(msg, wallet) {
  if (!msg || msg.type !== "qrl-unsigned-tx")
    throw Error("Not an unsigned transaction");
  if (msg.version !== 1) throw Error("Unsupported message version");
  if (
    Object.keys(msg).some(
      (k) => !["type", "version", "operation", "tx"].includes(k),
    )
  )
    throw Error("Unknown message field");
  if (!["transfer", "call", "deploy"].includes(msg.operation))
    throw Error("An explicit transaction operation is required");
  const deploying = msg.operation === "deploy";
  const tx = msg.tx;
  if (deploying && (!tx || !Object.hasOwn(tx, "to") || tx.to !== null))
    throw Error("Deployment requires explicit to: null");
  if (deploying && (!tx.data || tx.data === "0x"))
    throw Error("Deployment requires initialization bytecode");
  const base = validateTransactionFields(
    deploying ? { ...tx, to: wallet.address } : tx,
    wallet,
  );
  const data = base.toSign.data;
  const operation = deploying ? "deploy" : data === "0x" ? "transfer" : "call";
  if (msg.operation !== operation)
    throw Error("Operation does not match transaction data");
  if (data.length > 2 + 48000 * 2)
    throw Error("Transaction data exceeds 48,000 bytes");
  if (deploying) {
    delete base.toSign.to;
    base.display.to = null;
  }
  return {
    ...base,
    version: msg.version,
    operation,
    display: {
      ...base.display,
      operation,
      dataBytes: (data.length - 2) / 2,
      selector:
        operation === "call" && data.length >= 10 ? data.slice(0, 10) : null,
      gasLimit: BigInt(base.toSign.gasLimit),
      maxFeePerGas: BigInt(base.toSign.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(base.toSign.maxPriorityFeePerGas),
    },
  };
}
// Expected is the complete validated request, retained before displaying its QR.
export function verifySignedReply(msg, expected, decode) {
  if (
    !msg ||
    msg.type !== "qrl-signed-tx" ||
    msg.version !== expected.version ||
    Object.keys(msg).some(
      (k) => !["type", "version", "rawTransaction"].includes(k),
    )
  )
    throw Error("Not a matching signed transaction message");
  const raw = msg.rawTransaction;
  if (
    typeof raw !== "string" ||
    raw.length > 240000 ||
    !/^0x02([0-9a-f]{2})+$/.test(raw)
  )
    throw Error("Invalid signed transaction bytes");
  const from = expected.tx.from;
  const { toSign } = validateUnsignedTx(expected, {
    address: from,
    addressHexLength: 128,
    chainIds: new Set([BigInt(expected.tx.chainId)]),
  });
  const tx = decode(raw);
  const fail = [];
  for (const k of [
    "chainId",
    "nonce",
    "value",
    "gasLimit",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
  ])
    if (BigInt(tx[k]) !== BigInt(toSign[k])) fail.push(k);
  const actualTo = tx.to == null ? null : String(tx.to).toLowerCase();
  if (actualTo !== (toSign.to?.toLowerCase() ?? null)) fail.push("to");
  if (
    "0x" +
      Array.from(tx.data, (b) => b.toString(16).padStart(2, "0")).join("") !==
    toSign.data
  )
    fail.push("data");
  if (tx.accessList.length !== 0) fail.push("accessList");
  if (!tx.verifySignature()) fail.push("signature");
  if (String(tx.getSenderAddress()).toLowerCase() !== from.toLowerCase())
    fail.push("sender");
  if (fail.length)
    throw Error("Signed transaction does not match: " + fail.join(", "));
  return raw;
}
