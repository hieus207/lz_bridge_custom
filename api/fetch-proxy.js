const https = require("https");
const http = require("http");

// Whitelist of allowed domains to proxy
const ALLOWED_HOSTS = [
  "portalbridge.com",
  "api.wormholescan.io",
];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "*/*",
        },
      },
      (res) => {
        // Follow redirects
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          return fetchUrl(res.headers.location).then(resolve).catch(reject);
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks), contentType: res.headers["content-type"] || "text/plain" })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const targetUrl = req.query.url;
  if (!targetUrl) {
    res.status(400).json({ error: "Missing ?url= parameter" });
    return;
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  const allowed = ALLOWED_HOSTS.some(
    (h) => parsed.hostname === h || parsed.hostname.endsWith("." + h)
  );
  if (!allowed) {
    res.status(403).json({ error: "Domain not allowed: " + parsed.hostname });
    return;
  }

  try {
    const { status, body, contentType } = await fetchUrl(targetUrl);
    res.status(status).setHeader("Content-Type", contentType).send(body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
