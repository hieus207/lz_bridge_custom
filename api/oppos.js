// Relay for the dexcheck bot's OPPOS feed. The page is served over https and the bot's feed is
// plain http on the VPS, so the browser can't call it directly. The viewer's key comes with each
// request (header) and is checked by the bot; nothing is stored here.
// OPPOS_FEED_URL (Vercel env) = http://<vps>:8787/oppos
module.exports = async (req, res) => {
  const feed = process.env.OPPOS_FEED_URL;
  if (!feed) return res.status(503).json({ error: "OPPOS_FEED_URL is not set on Vercel" });
  const key = req.headers["x-feed-token"];
  if (!key) return res.status(401).json({ error: "missing key" });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(feed, { headers: { "X-Feed-Token": key }, signal: ctrl.signal });
    const body = await r.text();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    return res.status(r.status).send(body);
  } catch (err) {
    return res.status(502).json({ error: err.name === "AbortError" ? "bot feed timeout" : "bot feed unreachable" });
  } finally {
    clearTimeout(timer);
  }
};
