/**
 * SlimFlix — proxy serverless (Vercel) para contornar CORS na Xtream API.
 * Uso: GET /api/proxy?url=<URL codificada do player_api.php>
 */

const ALLOWED_HOSTS = (process.env.ALLOWED_IPTV_HOSTS || "spacetg.shop")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function isHostAllowed(hostname) {
  const host = String(hostname || "").toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function isAllowedTargetUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  if (!isHostAllowed(parsed.hostname)) return false;
  const path = parsed.pathname.toLowerCase();
  return path.endsWith("/player_api.php");
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const targetUrl = req.query?.url;
  if (!targetUrl || typeof targetUrl !== "string") {
    res.status(400).json({ error: "Missing url query parameter" });
    return;
  }

  if (!isAllowedTargetUrl(targetUrl)) {
    res.status(403).json({ error: "URL not allowed by proxy policy" });
    return;
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "SlimFlix-Vercel-Proxy/1.0",
      },
    });

    const contentType = upstream.headers.get("content-type") || "application/json";
    const body = Buffer.from(await upstream.arrayBuffer());

    res.status(upstream.status);
    res.setHeader("Content-Type", contentType);
    res.end(body);
  } catch (err) {
    console.error("[SlimFlix proxy]", err);
    res.status(502).json({
      error: "Upstream fetch failed",
      message: err?.message || "Unknown error",
    });
  }
};
