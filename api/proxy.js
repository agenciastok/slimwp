/**
 * SlimFlix — proxy universal (Vercel) para API Xtream e streams (/live, /movie, /series).
 * GET /api/proxy?url=<URL completa codificada>
 */

const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const ALLOWED_HOSTS = (process.env.ALLOWED_IPTV_HOSTS || "spacetg.shop")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const FORWARD_REQUEST_HEADERS = [
  "range",
  "if-range",
  "if-modified-since",
  "accept",
  "accept-language",
];

const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "cache-control",
  "etag",
  "last-modified",
  "content-disposition",
];

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Accept, If-Range, If-Modified-Since");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type");
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
  return ["http:", "https:"].includes(parsed.protocol) && isHostAllowed(parsed.hostname);
}

function buildUpstreamHeaders(req) {
  const headers = {
    "User-Agent": "SlimFlix-Vercel-Proxy/1.0",
    Accept: req.headers.accept || "*/*",
  };
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (value) headers[name] = value;
  }
  return headers;
}

function forwardResponseHeaders(upstream, res) {
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const targetUrl = req.query?.url;
  if (!targetUrl || typeof targetUrl !== "string") {
    res.status(400).json({ error: "Missing url query parameter" });
    return;
  }

  if (!isAllowedTargetUrl(targetUrl)) {
    res.status(403).json({ error: "Host not allowed by proxy policy" });
    return;
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: buildUpstreamHeaders(req),
      redirect: "follow",
    });

    res.status(upstream.status);
    forwardResponseHeaders(upstream, res);

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(upstream.body);
    await pipeline(nodeStream, res);
  } catch (err) {
    console.error("[SlimFlix proxy]", err);
    if (!res.headersSent) {
      res.status(502).json({
        error: "Upstream fetch failed",
        message: err?.message || "Unknown error",
      });
    } else {
      res.end();
    }
  }
};
