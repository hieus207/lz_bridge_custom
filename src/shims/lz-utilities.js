// Browser stand-in for @layerzerolabs/lz-utilities. The real package bundles key tooling
// for Sui/Aptos/TON/Initia/IOTA plus Node-only logging; the Solana OFT SDK only needs the
// byte helpers below (copied verbatim from lz-utilities 3.0.x). Wired in craco.config.js.
import { Buffer } from "buffer";

class SizeExceedsPaddingSizeError extends Error {
  constructor({ size, targetSize, type }) {
    super(`${type.charAt(0).toUpperCase()}${type.slice(1).toLowerCase()} size (${size}) exceeds padding size (${targetSize})`);
    this.name = "SizeExceedsPaddingSizeError";
  }
}

function padHex(hex, { dir, size = 32 } = {}) {
  if (size === null) return hex;
  const value = hex.replace("0x", "");
  if (value.length > size * 2) throw new SizeExceedsPaddingSizeError({ size: Math.ceil(value.length / 2), targetSize: size, type: "hex" });
  return `0x${value[dir === "right" ? "padEnd" : "padStart"](size * 2, "0")}`;
}

function padBytes(bytes, { dir, size = 32 } = {}) {
  if (size === null) return bytes;
  if (bytes.length > size) throw new SizeExceedsPaddingSizeError({ size: bytes.length, targetSize: size, type: "bytes" });
  const padded = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const padEnd = dir === "right";
    padded[padEnd ? i : size - i - 1] = bytes[padEnd ? i : bytes.length - i - 1];
  }
  return padded;
}

export function padify(hexOrBytes, { dir, size = 32 } = {}) {
  return typeof hexOrBytes === "string" ? padHex(hexOrBytes, { dir, size }) : padBytes(hexOrBytes, { dir, size });
}

export const isHex = (value) => /^(0x)?[0-9A-F]+$/i.test(value);
export const trim0x = (hex) => hex.replace(/^0x/i, "");

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") {
    if (/^(0x)?[0-9A-F]*$/i.test(value)) {
      const hex = value.replace(/^0x/i, "");
      const len = hex.length + 1 - ((hex.length + 1) % 2);
      return Uint8Array.from(Buffer.from(hex.padStart(len, "0"), "hex"));
    }
    throw new Error("Invalid hex string");
  }
  if (typeof value === "number") {
    if (value < 0) throw new Error("Number must be non-negative");
    const out = [];
    while (value > 0) { out.push(value & 255); value >>= 8; }
    return new Uint8Array(out.reverse());
  }
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (typeof value === "bigint") return toBytes(value.toString(16));
  throw new Error("unsupported type");
}

export function arrayify(value, size) {
  const bytes = toBytes(value);
  return size === undefined ? bytes : padify(bytes, { size });
}

export function hexlify(value) {
  if (typeof value === "string" && /^(0x)?[0-9A-F]*$/i.test(value)) return "0x" + trim0x(value);
  return "0x" + Buffer.from(arrayify(value)).toString("hex");
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const getLogger = () => console;
