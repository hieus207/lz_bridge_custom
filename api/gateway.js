// Relay for Circle Gateway (https://gateway-api.circle.com/v1). The API allows CORS, so the page
// talks to it directly; this relay is the fallback when a browser/extension blocks the call.
//   /api/gateway?path=/info            GET
//   /api/gateway?path=/estimate&enableForwarder=true   POST (JSON body passed through)
const https = require("https");

const API_HOST = "gateway-api.circle.com";
const ALLOWED = /^\/(info|balances|estimate|transfer(\/[A-Za-z0-9-]+)?)$/;

function relay(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: API_HOST, path: "/v1" + path, method, headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 hltbridge/1.0", Accept: "application/json" } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  const { path, ...rest } = req.query || {};
  if (!path || !ALLOWED.test(path)) { res.status(400).json({ error: "path not allowed" }); return; }
  const qs = new URLSearchParams(rest).toString();
  const body = req.method === "POST" ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {})) : null;
  try {
    const r = await relay(req.method === "POST" ? "POST" : "GET", path + (qs ? `?${qs}` : ""), body);
    res.status(r.status).setHeader("Content-Type", "application/json").send(r.body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
