/**
 * SlimFlix — proxy path /api/{host}/{path} (Vercel rewrite).
 * Ex.: /api/spacetg.shop/player_api.php?username=… → http://spacetg.shop/player_api.php?…
 */

const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { Agent, fetch: undiciFetch } = require("undici");

const ALLOWED_HOSTS = (
  process.env.ALLOWED_IPTV_HOSTS || "spacetg.shop,premiumcp.online,cdn.conectp.cloud"
)
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
  bodyTimeout: 0,
  headersTimeout: 120_000,
});

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Range, Content-Type, Accept, If-Range, If-Modified-Since"
  );
}

function isHostAllowed(hostname) {
  const host = String(hostname || "").toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function buildTargetUrl(req) {
  const host = String(req.query?.host || "").trim();
  if (!host || !isHostAllowed(host)) return null;

  let path = req.query?.path ?? "";
  if (Array.isArray(path)) path = `/${path.join("/")}`;
  else if (path && !String(path).startsWith("/")) path = `/${path}`;
  else if (!path) path = "/";

  const target = new URL(`http://${host}${path}`);
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === "host" || key === "path") continue;
    if (value == null) continue;
    if (Array.isArray(value)) value.forEach((v) => target.searchParams.append(key, v));
    else target.searchParams.set(key, value);
  }
  return target.href;
}

async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const targetUrl = buildTargetUrl(req);
  if (!targetUrl) {
    res.status(403).json({ error: "Host not allowed or missing path" });
    return;
  }

  try {
    const upstream = await undiciFetch(targetUrl, {
      method: req.method,
      dispatcher: insecureDispatcher,
      redirect: "follow",
      headers: {
        "User-Agent": "SlimFlix-Vercel-Proxy/1.0",
        Accept: req.headers.accept || "*/*",
      },
    });

    res.status(upstream.status);
    res.setHeader("Cache-Control", "no-store");
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    if (upstream.body) {
      await pipeline(Readable.fromWeb(upstream.body), res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error("[SlimFlix xtream-proxy]", err);
    if (!res.headersSent) {
      res.status(502).json({ error: "Upstream fetch failed", message: err?.message });
    }
  }
}

handler.config = { maxDuration: 60 };

module.exports = handler;
