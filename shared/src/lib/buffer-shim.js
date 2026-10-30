import { Buffer } from "buffer";
// Evaluate before dependencies that expect the browser Buffer polyfill.
globalThis.Buffer = Buffer;
