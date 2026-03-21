/**
 * oklink-proxy.mjs — Local proxy server for OKLink API
 * Run alongside the React dev server:
 *   node oklink-proxy.mjs
 *
 * Listens on http://localhost:3001
 * Endpoints:
 *   GET /api/holders/:chain/:address?offset=&limit=&sort=
 */

import crypto from "crypto";
import http   from "http";
import https  from "https";

const PORT = 3001;
const ALLOWED_ORIGIN = "*"; // allow localhost:3000 (dev) — restrict in prod

// ── OKLink auth helpers ───────────────────────────────────────────────────
const _RAW_KEY = "a2c903cc-b31e-4547-9299-b6d07b7631ab";
const _SALT    = 1111111111111n;

function encryptApiKey() {
  const c = _RAW_KEY.split("");
  return [...c.slice(8), ...c.slice(0, 8)].join("");
}
function encryptTime(tsMs) {
  const digits = (BigInt(tsMs) + _SALT).toString().split("");
  const noise  = Array.from({ length: 3 }, () => String(Math.floor(Math.random() * 10)));
  return [...digits, ...noise].join("");
}
function getXApiKey(tsMs) {
  return Buffer.from(`${encryptApiKey()}|${encryptTime(tsMs)}`).toString("base64");
}

function sha256Bytes(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest();
}
function shuffleHash(hashBuf, tsSec) {
  const f = Math.floor(tsSec / 600)  % 32;
  const p = Math.floor(tsSec / 3600) % 32;
  return Array.from({ length: 32 }, (_, d) => {
    const idx = (f + (p + d) * d) % 32;
    return hashBuf[idx].toString(16).padStart(2, "0");
  }).join("");
}
function hmacSha256B64(keyHex, message) {
  return crypto.createHmac("sha256", Buffer.from(keyHex, "hex")).update(message, "utf8").digest("base64");
}

function buildOklinkHeaders(url) {
  const token     = crypto.randomUUID();
  const timestamp = Date.now();
  const tsSec     = Math.floor(timestamp / 1000);

  const keyHex    = shuffleHash(sha256Bytes(token), tsSec);
  const parsed    = new URL(url);
  const content   = parsed.search ? `${parsed.pathname}?${parsed.search.slice(1)}` : parsed.pathname;
  const signature = hmacSha256B64(keyHex, content);

  return {
    "Ok-Verify-Token":     token,
    "Ok-Timestamp":        String(timestamp),
    "Ok-Verify-Sign":      signature,
    "X-Apikey":            getXApiKey(timestamp),
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

// ── HTTPS request helper ──────────────────────────────────────────────────
function fetchOklink(url) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const headers = buildOklinkHeaders(url);
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", c => body += c);
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────
// Route: GET /api/holders/:chain/:address
// Route: GET /api/fetch-proxy?url=...
const HOLDER_RE    = /^\/api\/holders\/([^/]+)\/([^/?]+)/;
const FP_PATH      = "/api/fetch-proxy";

const FETCH_PROXY_ALLOWED = [
  "portalbridge.com",
  "api.wormholescan.io",
];

function simpleFetch(urlStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === "https:" ? https : http;
    const req2 = lib.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: "GET",
        headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" } },
      (res2) => {
        if ((res2.statusCode === 301 || res2.statusCode === 302) && res2.headers.location) {
          return simpleFetch(res2.headers.location).then(resolve).catch(reject);
        }
        const chunks = [];
        res2.on("data", c => chunks.push(c));
        res2.on("end", () => resolve({ status: res2.statusCode, body: Buffer.concat(chunks), contentType: res2.headers["content-type"] || "text/plain" }));
      }
    );
    req2.on("error", reject);
    req2.end();
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  res.setHeader("Access-Control-Allow-Origin",  ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  // ── /api/fetch-proxy?url=... ─────────────────────────────────────────
  if (reqUrl.pathname === FP_PATH) {
    const targetUrl = reqUrl.searchParams.get("url");
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing ?url= parameter" }));
      return;
    }
    let parsed2;
    try { parsed2 = new URL(targetUrl); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid URL" }));
      return;
    }
    const allowed = FETCH_PROXY_ALLOWED.some(h => parsed2.hostname === h || parsed2.hostname.endsWith("." + h));
    if (!allowed) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Domain not allowed: " + parsed2.hostname }));
      return;
    }
    try {
      const { status, body, contentType } = await simpleFetch(targetUrl);
      res.writeHead(status, { "Content-Type": contentType });
      res.end(body);
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const match  = HOLDER_RE.exec(reqUrl.pathname);

  if (!match) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Use /api/holders/:chain/:address or /api/fetch-proxy?url=..." }));
    return;
  }

  const chain   = match[1];
  const address = match[2];
  const offset  = reqUrl.searchParams.get("offset") || "0";
  const limit   = reqUrl.searchParams.get("limit")  || "50";
  const sort    = reqUrl.searchParams.get("sort")   || "value,desc";
  const ts      = Date.now();

  const oklinkUrl = `https://www.oklink.com/api/explorer/v2/${chain}/tokens/holders/${address}?offset=${offset}&limit=${limit}&sort=${encodeURIComponent(sort)}&t=${ts}`;

  console.log(`[${new Date().toISOString()}] GET ${chain}/${address}`);

  try {
    const { status, body } = await fetchOklink(oklinkUrl);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`OKLink proxy running at http://localhost:${PORT}`);
  console.log(`Supported chains: eth | bsc | polygon | avax-c | arbitrum-one | optimism | base`);
  console.log(`Example: http://localhost:${PORT}/api/holders/eth/0xdac17f958d2ee523a2206206994597c13d831ec7`);
});
