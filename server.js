const express = require("express");
const cors = require("cors");
const path = require("path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const ALLOWED_HOSTS = (process.env.ALLOWED_IPTV_HOSTS || "spacetg.shop,premiumcp.online,cdn.conectp.cloud")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function normalizePanelBase(serverUrl) {
  let base = String(serverUrl || "").trim();
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return base.replace(/\/+$/, "");
}

function isHostAllowed(hostname) {
  const host = String(hostname || "").toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function buildPlayerApiUrl(serverUrl, username, password, action, extraParams = {}) {
  const base = normalizePanelBase(serverUrl);
  if (!base) throw new Error("serverUrl inválida");

  const parsed = new URL(base);
  if (!isHostAllowed(parsed.hostname)) {
    throw new Error("Host do painel não permitido");
  }

  const params = new URLSearchParams({ username, password });
  if (action) params.set("action", action);
  Object.entries(extraParams).forEach(([key, value]) => {
    if (value != null && value !== "") params.set(key, String(value));
  });

  return `${base}/player_api.php?${params.toString()}`;
}

async function fetchPanelJson(url) {
  const response = await fetch(url, { method: "GET" });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const err = new Error("Resposta inválida do painel IPTV");
    err.status = 502;
    throw err;
  }
  return { response, data };
}

function normalizeUserInfo(data) {
  let info = data?.user_info;
  if (Array.isArray(info)) info = info[0];
  return info || null;
}

function isXtreamAuthValid(userInfo) {
  if (!userInfo) return false;
  const auth = userInfo.auth;
  return auth === 1 || auth === "1";
}

/** Login Xtream — o Node faz o HTTP inseguro; o browser só fala com HTTPS local. */
app.post("/api/login", async (req, res) => {
  const { username, password, serverUrl } = req.body || {};

  if (!username || !password || !serverUrl) {
    return res.status(400).json({
      ok: false,
      message: "Informe username, password e serverUrl.",
    });
  }

  try {
    const base = normalizePanelBase(serverUrl);
    const url = buildPlayerApiUrl(base, username, password);
    const { response, data } = await fetchPanelJson(url);
    const userInfo = normalizeUserInfo(data);
    const ok = isXtreamAuthValid(userInfo);

    return res.status(response.ok ? 200 : response.status).json({
      ok,
      message: ok ? undefined : "Login ou senha inválidos",
      data,
      userInfo,
      serverInfo: data?.server_info,
      serverUrl: base,
    });
  } catch (err) {
    console.error("[SlimFlix /api/login]", err);
    return res.status(err.status || 502).json({
      ok: false,
      message: err.message || "Falha ao contactar o painel IPTV",
    });
  }
});

/** Listas e catálogo Xtream (mesmo proxy server-side). */
app.post("/api/xtream", async (req, res) => {
  const { serverUrl, username, password, action, extraParams = {} } = req.body || {};

  if (!username || !password || !serverUrl) {
    return res.status(400).json({ error: "serverUrl, username e password são obrigatórios" });
  }

  try {
    const url = buildPlayerApiUrl(serverUrl, username, password, action, extraParams);
    const { response, data } = await fetchPanelJson(url);
    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) {
    console.error("[SlimFlix /api/xtream]", err);
    return res.status(err.status || 502).json({
      error: err.message || "Falha ao contactar o painel IPTV",
    });
  }
});

/** Streams (.ts / .m3u8) — repassa binário do painel HTTP. */
app.get("/api/stream", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || typeof targetUrl !== "string") {
    return res.status(400).json({ error: "Missing url query parameter" });
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: "Invalid url" });
  }

  if (!["http:", "https:"].includes(parsed.protocol) || !isHostAllowed(parsed.hostname)) {
    return res.status(403).json({ error: "Host not allowed" });
  }

  try {
    const upstream = await fetch(targetUrl, { method: "GET" });
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    const ar = upstream.headers.get("accept-ranges");
    if (ar) res.setHeader("Accept-Ranges", ar);
    const cr = upstream.headers.get("content-range");
    if (cr) res.setHeader("Content-Range", cr);
    const cl = upstream.headers.get("content-length");
    if (cl) res.setHeader("Content-Length", cl);

    if (!upstream.body) {
      res.end();
      return;
    }

    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    console.error("[SlimFlix /api/stream]", err);
    if (!res.headersSent) {
      res.status(502).json({ error: "Upstream stream failed" });
    }
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`SlimFlix rodando em http://localhost:${PORT}`);
});
