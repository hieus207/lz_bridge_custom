const crypto = require("crypto");
const https = require("https");

// ── OKLink auth helpers ───────────────────────────────────────────────────
const _RAW_KEY = "a2c903cc-b31e-4547-9299-b6d07b7631ab";
const _SALT = 1111111111111n;

function encryptApiKey() {
  const c = _RAW_KEY.split("");
  return [...c.slice(8), ...c.slice(0, 8)].join("");
}
function encryptTime(tsMs) {
  const digits = (BigInt(tsMs) + _SALT).toString().split("");
  const noise = Array.from({ length: 3 }, () => String(Math.floor(Math.random() * 10)));
  return [...digits, ...noise].join("");
}
function getXApiKey(tsMs) {
  return Buffer.from(`${encryptApiKey()}|${encryptTime(tsMs)}`).toString("base64");
}
function sha256Bytes(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest();
}
function shuffleHash(hashBuf, tsSec) {
  const f = Math.floor(tsSec / 600) % 32;
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
  const token = crypto.randomUUID();
  const timestamp = Date.now();
  const tsSec = Math.floor(timestamp / 1000);
  const keyHex = shuffleHash(sha256Bytes(token), tsSec);
  const parsed = new URL(url);
  const content = parsed.search
    ? `${parsed.pathname}?${parsed.search.slice(1)}`
    : parsed.pathname;
  const signature = hmacSha256B64(keyHex, content);

  return {
    "Ok-Verify-Token": token,
    "Ok-Timestamp": String(timestamp),
    "Ok-Verify-Sign": signature,
    "X-Apikey": getXApiKey(timestamp),
    "X-Cdn": "https://static.oklink.com",
    "X-Locale": "en_US",
    "X-Utc": "7",
    "X-Site-Info": "9FjOikHdpRnblJCLiskTJx0SPJiOiUGZvNmIsIiTWJiOi42bpdWZyJye",
    "X-Zkdex-Env": "0",
    "X-Simulated-Trading": "0",
    Devid: "3f2b8770-4353-4d81-8e8a-9130734cfc1a",
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "App-Type": "web",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Origin: "https://www.oklink.com",
    Referer: "https://www.oklink.com",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0",
    "Sec-Ch-Ua": '"Chromium";v="146", "Not-A.Brand";v="24", "Microsoft Edge";v="146"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
}

function fetchOklink(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers = buildOklinkHeaders(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const { chain, address } = req.query;
  const offset = req.query.offset || "0";
  const limit = req.query.limit || "50";
  const sort = req.query.sort || "value,desc";
  const ts = Date.now();

  const oklinkUrl = `https://www.oklink.com/api/explorer/v2/${chain}/tokens/holders/${address}?offset=${offset}&limit=${limit}&sort=${encodeURIComponent(sort)}&t=${ts}`;

  try {
    const { status, body } = await fetchOklink(oklinkUrl);
    res.status(status).setHeader("Content-Type", "application/json").send(body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
