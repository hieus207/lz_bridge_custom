// test_oklink.mjs — Node.js port of test.py
// Run: node test_oklink.mjs

import crypto from "crypto";
import https  from "https";
import fs     from "fs";

// ── X-Apikey generator ────────────────────────────────────────────────────
const _RAW_KEY = "a2c903cc-b31e-4547-9299-b6d07b7631ab";
const _SALT    = 1111111111111n; // BigInt to avoid float precision loss

function encryptApiKey() {
  const chars = _RAW_KEY.split("");
  return [...chars.slice(8), ...chars.slice(0, 8)].join("");
}

function encryptTime(tsMs) {
  const digits = (BigInt(tsMs) + _SALT).toString().split("");
  const noise  = Array.from({ length: 3 }, () => String(Math.floor(Math.random() * 10)));
  return [...digits, ...noise].join("");
}

function getXApiKey(tsMs) {
  return Buffer.from(`${encryptApiKey()}|${encryptTime(tsMs)}`).toString("base64");
}

// ── Ok-Verify-Sign signer ─────────────────────────────────────────────────
function sha256Bytes(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest();
}

function shuffleHash(hashBuf, timestampSec) {
  const f = Math.floor(timestampSec / 600)  % 32;
  const p = Math.floor(timestampSec / 3600) % 32;
  return Array.from({ length: 32 }, (_, d) => {
    const idx = (f + (p + d) * d) % 32;
    return hashBuf[idx].toString(16).padStart(2, "0");
  }).join("");
}

function hmacSha256B64(keyHex, message) {
  const keyBuf = Buffer.from(keyHex, "hex");
  return crypto.createHmac("sha256", keyBuf).update(message, "utf8").digest("base64");
}

function buildHeaders(url) {
  const token        = crypto.randomUUID();
  const timestamp    = Date.now();
  const timestampSec = Math.floor(timestamp / 1000);

  const tokenHash = sha256Bytes(token);
  const keyHex    = shuffleHash(tokenHash, timestampSec);

  const parsed  = new URL(url);
  const path    = parsed.pathname;
  const query   = parsed.search.slice(1);
  const content = query ? `${path}?${query}` : path;

  const signature = hmacSha256B64(keyHex, content);
  const xApiKey   = getXApiKey(timestamp);

  return {
    "Ok-Verify-Token":     token,
    "Ok-Timestamp":        String(timestamp),
    "Ok-Verify-Sign":      signature,
    "X-Apikey":            xApiKey,
    "X-Cdn":               "https://static.oklink.com",
    "X-Locale":            "en_US",
    "X-Utc":               "7",
    "X-Site-Info":         "9FjOikHdpRnblJCLiskTJx0SPJiOiUGZvNmIsIiTWJiOi42bpdWZyJye",
    "X-Zkdex-Env":         "0",
    "X-Simulated-Trading": "0",
    "Devid":               "3f2b8770-4353-4d81-8e8a-9130734cfc1a",
    "Accept":              "application/json",
    "Accept-Language":     "en-US,en;q=0.9",
    "App-Type":            "web",
    "Cache-Control":       "no-cache",
    "Pragma":              "no-cache",
    "Origin":              "https://www.oklink.com",
    "Referer":             "https://www.oklink.com",
    "User-Agent":          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0",
    "Sec-Ch-Ua":           '"Chromium";v="146", "Not-A.Brand";v="24", "Microsoft Edge";v="146"',
    "Sec-Ch-Ua-Mobile":    "?0",
    "Sec-Ch-Ua-Platform":  '"Windows"',
    "Sec-Fetch-Dest":      "empty",
    "Sec-Fetch-Mode":      "cors",
    "Sec-Fetch-Site":      "same-origin",
  };
}

// ── Simple HTTPS GET ──────────────────────────────────────────────────────
function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", chunk => body += chunk);
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

// ── JSON-RPC helpers for OFT detection ────────────────────────────────────
const ETH_RPC = "https://eth.llamarpc.com";

function rpcPost(method, params) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const parsed = new URL(ETH_RPC);
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => { let b = ""; res.on("data", c => b += c); res.on("end", () => resolve(JSON.parse(b))); }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Pre-computed 4-byte selectors (keccak256 of signature)
const SELECTORS = {
  "token()":       "0xfc0c546a",
  "endpoint()":    "0x5e280f11",
  "oftVersion()":  "0xe6d7c5b5",
};

async function ethCall(to, sig) {
  try {
    const r = await rpcPost("eth_call", [{ to, data: SELECTORS[sig] }, "latest"]);
    if (r.error) return null;
    return r.result === "0x" ? null : r.result;
  } catch { return null; }
}

async function getCode(addr) {
  try {
    const r = await rpcPost("eth_getCode", [addr, "latest"]);
    return r.result || "0x";
  } catch { return "0x"; }
}

// ── Test ──────────────────────────────────────────────────────────────────
const TOKEN_ADDR = "0x32b4d049fe4c888d2b92eecaf729b2e28da4c514";
const CHAIN      = "eth";
const ts  = Date.now();
const url = `https://www.oklink.com/api/explorer/v2/${CHAIN}/tokens/holders/${TOKEN_ADDR}?offset=0&limit=50&sort=value%2Cdesc&t=${ts}`;

console.log("Token:", TOKEN_ADDR);
console.log("RPC:  ", ETH_RPC);
console.log();

console.log("=".repeat(60));
console.log("Step 1: Fetch holders from OKLink");
console.log("=".repeat(60));
const headers = buildHeaders(url);
const res = await httpsGet(url, headers);
console.log("HTTP Status:", res.status);

const data = JSON.parse(res.body);
if (data.code !== 0 && data.code !== "0") {
  console.log("OKLink failed:", data);
  process.exit(1);
}

const rawList = data.data?.hits || data.data?.holderList || [];
console.log(`Total holders on-chain: ${data.data?.total}, fetched: ${rawList.length}`);
console.log();

// Filter 0.2%-15%
const inRange = rawList.filter(h => {
  const pct = parseFloat(h.rate ?? 0) * 100;
  return pct >= 0.2 && pct <= 15;
});
console.log(`Holders in 0.2%–15% range: ${inRange.length}`);
inRange.forEach(h => console.log(`  ${h.holderAddress}  ${(parseFloat(h.rate)*100).toFixed(2)}%`));
console.log();

console.log("=".repeat(60));
console.log("Step 2: getCode + OFT ABI calls on each");
console.log("=".repeat(60));

for (const h of inRange) {
  const addr = h.holderAddress;
  const pct  = (parseFloat(h.rate) * 100).toFixed(2);
  const code = await getCode(addr);
  const isContract = code !== "0x";

  if (!isContract) {
    console.log(`[EOA    ] ${addr}  (${pct}%)`);
    continue;
  }

  const [tokenRes, endpointRes, versionRes] = await Promise.all([
    ethCall(addr, "token()"),
    ethCall(addr, "endpoint()"),
    ethCall(addr, "oftVersion()"),
  ]);

  const hasEndpoint = !!endpointRes;
  const hasVersion  = !!versionRes;
  const hasToken    = !!tokenRes;
  const isOFT = hasEndpoint || hasVersion;

  console.log(`[${isOFT ? "✓ OFT  " : "CONTRACT"}] ${addr}  (${pct}%)`);
  if (hasToken)    console.log(`   token()      → 0x${tokenRes.slice(-40)}`);
  if (hasEndpoint) console.log(`   endpoint()   → 0x${endpointRes.slice(-40)}`);
  if (hasVersion)  console.log(`   oftVersion() → ${versionRes}`);
  if (isContract && !hasToken && !hasEndpoint && !hasVersion)
    console.log(`   (no OFT methods — not OFT)`);
  console.log();
}
