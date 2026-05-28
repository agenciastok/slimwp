/*! SlimFlix BUILD: login-vps-8 — proxy Mixed Content (VPS/nginx path) */
(function () {
  if (window.__SlimFlixProxyInstalled) return;
  window.__SlimFlixProxyInstalled = true;
  const API = "/api";
  const PROXY_BUILD = "login-vps-8-proxy";

  function toProxyUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return raw;
    if (raw.startsWith(`${API}/`) && !raw.startsWith(`${API}/proxy`)) return raw;
    if (/^https?:\/\//i.test(raw)) {
      try {
        const p = new URL(raw);
        return `${API}/${p.host}${p.pathname}${p.search}${p.hash}`;
      } catch {
        return raw;
      }
    }
    return raw;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === "string") return nativeFetch(toProxyUrl(input), init);
    if (input instanceof Request) {
      const proxied = toProxyUrl(input.url);
      if (proxied !== input.url) return nativeFetch(new Request(proxied, input), init);
    }
    return nativeFetch(input, init);
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
    return xhrOpen.call(this, method, toProxyUrl(url), async, user, password);
  };

  try {
    const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
    if (srcDesc?.set) {
      Object.defineProperty(HTMLMediaElement.prototype, "src", {
        configurable: true,
        enumerable: srcDesc.enumerable,
        get: srcDesc.get,
        set(value) {
          srcDesc.set.call(this, toProxyUrl(value));
        },
      });
    }
  } catch {
    /* ignore */
  }

  window.SlimFlixApiProxyShim = {
    BUILD: PROXY_BUILD,
    toProxyUrl,
    proxyMode: () => "path",
  };
  console.info("[SlimFlix]", PROXY_BUILD, "ativo — http:// → /api/{host}/");
})();

/**
 * SlimFlix — autenticação Xtream Codes API e navegação SPA (login ↔ player)
 */
(function () {
  const SLIMFLIX_LOGIN_BUILD = "login-vps-8";
  console.info("[SlimFlix] login.js build:", SLIMFLIX_LOGIN_BUILD);

  /** Prefixo do proxy reverso local (evita Mixed Content). */
  const IPTV_API_BASE = "/api";

  /** Hosts dos painéis (failover). URLs de API/stream são sempre /api/{host}/… no navegador. */
  const IPTV_UPSTREAM_HOSTS = [
    "spacetg.shop",
    "premiumcp.online",
    "cdn.conectp.cloud",
  ];

  /** Compatibilidade — não usar em fetch; apenas referência legada. */
  const IPTV_UPSTREAM_SERVERS = IPTV_UPSTREAM_HOSTS.map((host) => `http://${host}`);

  const IPTV_SERVERS = IPTV_UPSTREAM_HOSTS;

  const STORAGE_SESSION = "slimflix_session";
  const STORAGE_ACTIVE_SERVER = "active_iptv_server";
  const STORAGE_USER = "slimflix_user";
  const STORAGE_AUTH = "slimflix_xtream_auth";
  const STORAGE_USER_LEGACY = "slimflix_xtream_username";
  const STORAGE_PASS = "slimflix_xtream_password";
  const STORAGE_USER_INFO = "slimflix_xtream_user_info";
  const STORAGE_SERVER_INFO = "slimflix_xtream_server_info";

  /** @returns {{ username: string, password: string, server?: string } | null} */
  function parseStoredSession() {
    try {
      const raw = localStorage.getItem(STORAGE_SESSION);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data?.username && data?.password) {
        return {
          username: String(data.username),
          password: String(data.password),
          server: data.server ? String(data.server) : undefined,
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /** Sessão válida: slimflix_session, slimflix_user + senha, ou chaves legadas Xtream. */
  function hasActiveSession() {
    const parsed = parseStoredSession();
    if (parsed?.username && parsed?.password) return true;

    const user =
      localStorage.getItem(STORAGE_USER) || localStorage.getItem(STORAGE_USER_LEGACY);
    const pass = localStorage.getItem(STORAGE_PASS);
    if (user && pass) return true;

    return (
      localStorage.getItem(STORAGE_AUTH) === "1" &&
      !!localStorage.getItem(STORAGE_USER_LEGACY) &&
      !!pass
    );
  }

  function enforceGuestOnlyUI() {
    document.documentElement.classList.add("slimflix-locked");
    document.body.classList.add("login-active");
    document.body.classList.remove("player-active", "loading-active");

    const login = document.getElementById("login-screen");
    const player = document.getElementById("player-screen");
    const loading = document.getElementById("loading-screen");

    player?.classList.add("hidden");
    player?.setAttribute("hidden", "");
    player?.setAttribute("aria-hidden", "true");

    loading?.classList.add("hidden");
    loading?.setAttribute("hidden", "");
    loading?.setAttribute("aria-hidden", "true");
    loading?.setAttribute("aria-busy", "false");

    login?.classList.remove("hidden");
    login?.removeAttribute("hidden");
    login?.setAttribute("aria-hidden", "false");
  }

  if (!hasActiveSession()) {
    enforceGuestOnlyUI();
  }

  const loginScreen = document.getElementById("login-screen");
  const loadingScreen = document.getElementById("loading-screen");
  const loadingScreenText = document.getElementById("loading-screen-text");
  const playerScreen = document.getElementById("player-screen");
  const loginForm = document.getElementById("login-form");
  const userInput = document.getElementById("xtream-user");
  const passInput = document.getElementById("xtream-password");
  const togglePasswordBtn = document.getElementById("toggle-password");
  const loginError = document.getElementById("login-error");
  const logoutBtn = document.getElementById("btn-logout");
  const playerApiAlert = document.getElementById("player-api-alert");
  const playerApiAlertText = document.getElementById("player-api-alert-text");
  const playerApiAlertClose = document.getElementById("player-api-alert-close");

  const MOCK_CATEGORIAS_CANAIS = [
    { category_id: "1", category_name: "Canais Abertos" },
    { category_id: "2", category_name: "Esportes" },
  ];

  const MOCK_CATEGORIAS_FILMES = [
    { category_id: "3", category_name: "Ação Premium" },
    { category_id: "4", category_name: "Ficção Científica" },
  ];

  let cachedCategoriasCanais = null;
  let cachedCategoriasFilmes = null;
  let cacheLiveStreams = null;
  let cacheVodStreams = null;
  let cacheSeriesCategoriesRaw = null;
  let cacheSeriesListRaw = null;

  function showLoginError(message) {
    if (!loginError) return;
    loginError.textContent = message;
    loginError.classList.remove("hidden");
  }

  function clearLoginError() {
    if (!loginError) return;
    loginError.textContent = "";
    loginError.classList.add("hidden");
  }

  function showPlayerApiAlert(message) {
    if (!playerApiAlert || !playerApiAlertText) return;
    playerApiAlertText.textContent = message;
    playerApiAlert.classList.remove("hidden");
  }

  function hidePlayerApiAlert() {
    playerApiAlert?.classList.add("hidden");
    if (playerApiAlertText) playerApiAlertText.textContent = "";
  }

  function formatFetchError(err) {
    if (err?.name === "TypeError" && /fetch|network|Failed/i.test(String(err.message))) {
      return "Erro de rede ao contatar o painel IPTV (servidor indisponível ou bloqueio CORS).";
    }
    return err?.message || "Erro desconhecido na API Xtream.";
  }

  let DEFAULT_ALLOWED_HOSTS = [];

  function getSessionServerHost() {
    try {
      const stored = localStorage.getItem(STORAGE_ACTIVE_SERVER);
      const fromStorage = stored ? normalizeServerUrl(stored) : "";
      const match = String(fromStorage).match(/^\/api\/([^/]+)/);
      if (match) return match[1].toLowerCase();
    } catch {
      /* ignore */
    }
    return window.location.hostname.toLowerCase();
  }

  function isAllowedUpstreamHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    const hosts = new Set([...DEFAULT_ALLOWED_HOSTS, getSessionServerHost()].filter(Boolean));
    for (const allowed of hosts) {
      if (host === allowed || host.endsWith(`.${allowed}`)) return true;
    }
    return false;
  }

  /** Desembrulha URLs antigas salvas com /api/proxy?url=... */
  function unwrapLegacyProxyUrl(targetUrl) {
    if (!targetUrl || typeof targetUrl !== "string") return targetUrl;
    const trimmed = targetUrl.trim();
    if (!trimmed.startsWith("/api/proxy")) return trimmed;
    try {
      const parsed = new URL(trimmed, window.location.origin);
      const upstream = parsed.searchParams.get("url");
      return upstream ? decodeURIComponent(upstream) : trimmed;
    } catch {
      return trimmed;
    }
  }

  function getProxyMode() {
    if (window.SlimFlixApiProxyShim?.proxyMode) return window.SlimFlixApiProxyShim.proxyMode();
    const meta = document.querySelector('meta[name="slimflix-proxy"]');
    return meta?.content?.trim() || "path";
  }

  /**
   * Vercel (query): http://host/… → /api/proxy?url=…
   * Docker (path):  http://host/… → /api/host/…
   */
  function httpUrlToApiProxy(targetUrl) {
    if (window.SlimFlixApiProxyShim?.toProxyUrl) {
      return window.SlimFlixApiProxyShim.toProxyUrl(targetUrl);
    }
    const trimmed = String(targetUrl || "").trim();
    if (!trimmed) return trimmed;
    if (trimmed.startsWith(`${IPTV_API_BASE}/proxy?url=`)) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) {
      if (getProxyMode() === "path") {
        try {
          const parsed = new URL(trimmed);
          return `${IPTV_API_BASE}/${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
        } catch {
          return trimmed;
        }
      }
      return `${IPTV_API_BASE}/proxy?url=${encodeURIComponent(trimmed)}`;
    }
    if (trimmed.startsWith(`${IPTV_API_BASE}/`) && getProxyMode() === "query") {
      const match = trimmed.match(/^\/api\/([^/]+)(\/[^?]*)?(\?.*)?$/);
      if (match) {
        const httpUrl = `http://${match[1]}${match[2] || "/"}${match[3] || ""}`;
        return `${IPTV_API_BASE}/proxy?url=${encodeURIComponent(httpUrl)}`;
      }
    }
    return trimmed;
  }

  /** /api/spacetg.shop a partir do hostname ou URL http legada. */
  function hostToApiBase(host) {
    const cleaned = String(host || "")
      .trim()
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .trim();
    return cleaned ? `${IPTV_API_BASE}/${cleaned}` : "";
  }

  /** Garante URL relativa /api/… antes de fetch ou <video src> (evita Mixed Content). */
  function ensureProxiedUrl(targetUrl) {
    let url = wrapUrlForProxy(targetUrl);
    if (/^https?:\/\//i.test(url)) {
      url = httpUrlToApiProxy(url);
    }
    if (/^https?:\/\//i.test(url) && window.location.protocol === "https:") {
      console.error("[SlimFlix] Bloqueio Mixed Content — URL ainda é HTTP absoluta:", url);
      throw new TypeError(
        "Mixed Content: requisição HTTP bloqueada em página HTTPS. Use o proxy /api/."
      );
    }
    return url;
  }

  /** Base do painel no proxy: http://host → /api/host */
  function normalizeServerUrl(raw) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        return `${IPTV_API_BASE}/${new URL(trimmed).host}`;
      } catch {
        return "";
      }
    }
    if (trimmed.startsWith(`${IPTV_API_BASE}/`)) {
      const match = trimmed.match(/^\/api\/([^/]+)/);
      return match ? `${IPTV_API_BASE}/${match[1]}` : "";
    }
    return trimmed;
  }

  /** Alias: reescreve qualquer URL Xtream HTTP para o proxy /api/{host}/… */
  function toApiPath(pathOrUrl) {
    return wrapUrlForProxy(pathOrUrl);
  }

  /**
   * Reescreve links externos para /api/{host}/path (mesma origem HTTPS → nginx → HTTP upstream).
   */
  function wrapUrlForProxy(targetUrl) {
    if (!targetUrl || typeof targetUrl !== "string") return targetUrl;
    let trimmed = targetUrl.trim();
    if (!trimmed) return trimmed;

    const legacy = unwrapLegacyProxyUrl(trimmed);
    if (legacy !== trimmed) return wrapUrlForProxy(legacy);

    if (/^https?:\/\//i.test(trimmed)) {
      return httpUrlToApiProxy(trimmed);
    }

    if (trimmed.startsWith(`${IPTV_API_BASE}/`)) {
      return trimmed;
    }

    const apiBase = getActiveIptvServer();
    if (apiBase && apiBase.startsWith(`${IPTV_API_BASE}/`)) {
      const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
      if (path.startsWith(`${IPTV_API_BASE}/`)) return path;
      return `${apiBase}${path}`;
    }

    return trimmed;
  }

  /** Compatibilidade: alias de ensureProxiedUrl. */
  function buildProxyUrl(targetUrl) {
    return ensureProxiedUrl(targetUrl);
  }

  function isXtreamLiveStreamUrl(targetUrl) {
    if (!targetUrl || typeof targetUrl !== "string") return false;
    try {
      const path = new URL(targetUrl.trim(), window.location.origin).pathname.toLowerCase();
      return /\/live\//.test(path);
    } catch {
      return /\/live\//i.test(targetUrl);
    }
  }

  /** GET via proxy /api/{host}/… — nunca fetch HTTP absoluto no navegador. */
  async function fetchXtreamUrl(targetUrl) {
    let url = ensureProxiedUrl(targetUrl);
    if (/^https?:\/\//i.test(url)) {
      url = httpUrlToApiProxy(url);
    }
    if (/^https?:\/\//i.test(url)) {
      console.error("[SlimFlix] fetch bloqueado (Mixed Content):", url, SLIMFLIX_LOGIN_BUILD);
      throw new TypeError("URL HTTP absoluta — deploy login.js + api-proxy-shim.js desatualizado.");
    }
    return fetch(url, { method: "GET" });
  }

  DEFAULT_ALLOWED_HOSTS = IPTV_UPSTREAM_HOSTS.map((host) => host.toLowerCase()).filter(Boolean);

  function getActiveIptvServer() {
    const stored = localStorage.getItem(STORAGE_ACTIVE_SERVER);
    if (stored) return normalizeServerUrl(stored);

    const parsed = parseStoredSession();
    if (parsed?.server) return normalizeServerUrl(parsed.server);

    return "";
  }

  function getLoginCredentials() {
    return {
      username: (userInput?.value || "").trim(),
      password: passInput?.value || "",
    };
  }

  function getStoredSession() {
    const activeServer = getActiveIptvServer();
    const parsed = parseStoredSession();
    if (parsed) {
      return {
        server: normalizeServerUrl(parsed.server || activeServer),
        username: parsed.username,
        password: parsed.password,
      };
    }
    return {
      server: activeServer,
      username:
        localStorage.getItem(STORAGE_USER) ||
        localStorage.getItem(STORAGE_USER_LEGACY) ||
        "",
      password: localStorage.getItem(STORAGE_PASS) || "",
    };
  }

  function isSessionStored() {
    return hasActiveSession();
  }

  function saveXtreamSession(username, password, apiPayload, serverUrl) {
    const userInfo = normalizeUserInfo(apiPayload);
    const server = normalizeServerUrl(serverUrl) || getActiveIptvServer();
    localStorage.setItem(STORAGE_USER, username);
    localStorage.setItem(STORAGE_PASS, password);
    localStorage.setItem(STORAGE_USER_LEGACY, username);
    localStorage.setItem(STORAGE_ACTIVE_SERVER, server);
    localStorage.setItem(
      STORAGE_SESSION,
      JSON.stringify({
        username,
        password,
        server,
        authenticatedAt: Date.now(),
      })
    );
    localStorage.setItem(STORAGE_AUTH, "1");
    if (userInfo) {
      localStorage.setItem(STORAGE_USER_INFO, JSON.stringify(userInfo));
    }
    if (apiPayload?.server_info) {
      localStorage.setItem(STORAGE_SERVER_INFO, JSON.stringify(apiPayload.server_info));
    }
  }

  function clearXtreamSession() {
    localStorage.removeItem(STORAGE_SESSION);
    localStorage.removeItem(STORAGE_ACTIVE_SERVER);
    localStorage.removeItem(STORAGE_USER);
    localStorage.removeItem(STORAGE_AUTH);
    localStorage.removeItem(STORAGE_USER_LEGACY);
    localStorage.removeItem(STORAGE_PASS);
    localStorage.removeItem(STORAGE_USER_INFO);
    localStorage.removeItem(STORAGE_SERVER_INFO);
  }

  function normalizeUserInfo(data) {
    let info = data?.user_info;
    if (Array.isArray(info)) info = info[0];
    return info || null;
  }

  function isUserActive(userInfo) {
    if (!userInfo) return false;
    const status = String(userInfo.status ?? userInfo.auth ?? "").trim().toLowerCase();
    return status === "active";
  }

  function isXtreamAuthValid(userInfo) {
    if (!userInfo) return false;
    const auth = userInfo.auth;
    return auth === 1 || auth === "1";
  }

  function resolveApiBase(serverBase) {
    if (!serverBase) return getActiveIptvServer();
    const raw = String(serverBase).trim();
    if (raw.startsWith(`${IPTV_API_BASE}/`)) return normalizeServerUrl(raw);
    if (/^https?:\/\//i.test(raw)) return normalizeServerUrl(raw);
    return hostToApiBase(raw);
  }

  function buildPlayerApiUrl(username, password, action, extraParams = {}, serverBase) {
    const base = resolveApiBase(serverBase);
    const host = base.replace(new RegExp(`^${IPTV_API_BASE}/`), "").replace(/^https?:\/\//i, "");
    if (!host) {
      throw new Error("Servidor IPTV inválido para proxy /api/.");
    }
    const params = new URLSearchParams({
      username,
      password,
    });
    if (action) params.set("action", action);
    Object.entries(extraParams).forEach(([key, value]) => {
      if (value != null && value !== "") params.set(key, String(value));
    });
    const httpUrl = `http://${host}/player_api.php?${params.toString()}`;
    return httpUrlToApiProxy(httpUrl);
  }

  /**
   * Requisição genérica à Xtream API (usa credenciais do localStorage).
   */
  async function xtreamFetch(action, extraParams = {}) {
    if (!hasActiveSession()) {
      throw new Error("Acesso negado. Faça login para continuar.");
    }
    const { username, password, server } = getStoredSession();
    if (!server || !username || !password) {
      throw new Error("Sessão Xtream não encontrada. Faça login novamente.");
    }
    const url = buildPlayerApiUrl(username, password, action, extraParams, server);
    const response = await fetchXtreamUrl(url);
    if (!response.ok) {
      throw new Error(`Servidor respondeu com erro HTTP ${response.status}.`);
    }
    return response.json();
  }

  /**
   * Autenticação Xtream Codes API — tenta cada servidor em IPTV_SERVERS até auth válido.
   */
  async function authenticateXtream(credentials) {
    const { username, password } = credentials;

    if (!username || !password) {
      return { ok: false, message: "Preencha usuário e senha." };
    }

    if (!IPTV_SERVERS.length) {
      return {
        ok: false,
        message: "Configure IPTV_SERVERS em login.js com as URLs dos painéis.",
      };
    }

    for (const host of IPTV_UPSTREAM_HOSTS) {
      const server = hostToApiBase(host);
      if (!server) continue;

      const url = buildPlayerApiUrl(username, password, undefined, {}, server);

      try {
        const response = await fetchXtreamUrl(url);
        if (!response.ok) continue;

        const data = await response.json();
        const userInfo = normalizeUserInfo(data);

        console.log("[SlimFlix Xtream] Tentativa de login:", {
          host,
          proxyUrl: url,
          username,
          user_info: userInfo,
          server_info: data?.server_info,
        });

        if (!isXtreamAuthValid(userInfo)) continue;

        saveXtreamSession(username, password, data, server);
        console.info("[SlimFlix Xtream] Login OK via proxy:", server);

        return { ok: true, userInfo, serverInfo: data?.server_info, server };
      } catch (err) {
        console.warn("[SlimFlix Xtream] Falha no login via proxy:", {
          build: SLIMFLIX_LOGIN_BUILD,
          proxyBase: server,
          requestUrl: url,
          err,
        });
      }
    }

    return { ok: false, message: "Login ou senha inválidos" };
  }

  function clearXtreamCatalogCache() {
    cachedCategoriasCanais = null;
    cachedCategoriasFilmes = null;
    cacheLiveStreams = null;
    cacheVodStreams = null;
    cacheSeriesCategoriesRaw = null;
    cacheSeriesListRaw = null;
    window.SlimFlixXtream?.clearSeriesCache?.();
  }

  async function buscarCategoriasFilmes() {
    if (cachedCategoriasFilmes) {
      return cachedCategoriasFilmes;
    }
    try {
      const categorias = await xtreamFetch("get_vod_categories");
      cachedCategoriasFilmes = categorias;
      console.log("[SlimFlix Xtream] Categorias de filmes (VOD):", categorias);
      return categorias;
    } catch (err) {
      console.error("[SlimFlix Xtream] Falha ao buscar categorias de filmes:", err);
      const msg = formatFetchError(err);
      showPlayerApiAlert(
        `${msg} Exibindo categorias de filmes fictícias para desenvolvimento.`
      );
      cachedCategoriasFilmes = [...MOCK_CATEGORIAS_FILMES];
      console.log("[SlimFlix Xtream] Fallback categorias filmes:", cachedCategoriasFilmes);
      return cachedCategoriasFilmes;
    }
  }

  async function buscarCategoriasCanais() {
    if (cachedCategoriasCanais) {
      return cachedCategoriasCanais;
    }
    try {
      const categorias = await xtreamFetch("get_live_categories");
      cachedCategoriasCanais = categorias;
      console.log("[SlimFlix Xtream] Categorias de canais (Live):", categorias);
      return categorias;
    } catch (err) {
      console.error("[SlimFlix Xtream] Falha ao buscar categorias de canais:", err);
      const msg = formatFetchError(err);
      showPlayerApiAlert(
        `${msg} Exibindo categorias de canais fictícias para desenvolvimento.`
      );
      cachedCategoriasCanais = [...MOCK_CATEGORIAS_CANAIS];
      console.log("[SlimFlix Xtream] Fallback categorias canais:", cachedCategoriasCanais);
      return cachedCategoriasCanais;
    }
  }

  async function buscarLiveStreams() {
    if (cacheLiveStreams) return cacheLiveStreams;
    cacheLiveStreams = await xtreamFetch("get_live_streams");
    return cacheLiveStreams;
  }

  async function buscarVodStreams() {
    if (cacheVodStreams) return cacheVodStreams;
    cacheVodStreams = await xtreamFetch("get_vod_streams");
    return cacheVodStreams;
  }

  async function buscarSeriesCategoriesRaw() {
    if (cacheSeriesCategoriesRaw) return cacheSeriesCategoriesRaw;
    try {
      cacheSeriesCategoriesRaw = await xtreamFetch("get_series_categories");
    } catch {
      cacheSeriesCategoriesRaw = [];
    }
    return cacheSeriesCategoriesRaw;
  }

  async function buscarSeriesListRaw() {
    if (cacheSeriesListRaw) return cacheSeriesListRaw;
    try {
      cacheSeriesListRaw = await xtreamFetch("get_series");
    } catch {
      cacheSeriesListRaw = [];
    }
    return cacheSeriesListRaw;
  }

  function logoutUser() {
    clearXtreamCatalogCache();
    window.SlimFlixSeriesUI?.resetXtreamSeriesState?.();
    localStorage.clear();
    sessionStorage.clear();
    console.info("[SlimFlix] Sessão encerrada — recarregando.");
    window.location.reload();
  }

  function hideLoadingScreen() {
    loadingScreen?.classList.add("hidden");
    loadingScreen?.setAttribute("hidden", "");
    loadingScreen?.setAttribute("aria-hidden", "true");
    loadingScreen?.setAttribute("aria-busy", "false");
    document.body.classList.remove("loading-active");
  }

  function showLoadingScreen(message = "Carregando seu catálogo premium...") {
    if (!hasActiveSession()) {
      enforceGuestOnlyUI();
      return;
    }
    loginScreen?.classList.add("hidden");
    loginScreen?.setAttribute("aria-hidden", "true");
    playerScreen?.classList.add("hidden");
    playerScreen?.setAttribute("hidden", "");
    playerScreen?.setAttribute("aria-hidden", "true");
    if (loadingScreenText) loadingScreenText.textContent = message;
    loadingScreen?.classList.remove("hidden");
    loadingScreen?.removeAttribute("hidden");
    loadingScreen?.setAttribute("aria-hidden", "false");
    loadingScreen?.setAttribute("aria-busy", "true");
    document.body.classList.remove("login-active", "player-active");
    document.body.classList.add("loading-active");
    window.scrollTo(0, 0);
  }

  function showPlayerScreen() {
    if (!hasActiveSession()) {
      enforceGuestOnlyUI();
      return;
    }
    document.documentElement.classList.remove("slimflix-locked");
    hideLoadingScreen();
    loginScreen?.classList.add("hidden");
    loginScreen?.setAttribute("aria-hidden", "true");
    playerScreen?.classList.remove("hidden");
    playerScreen?.removeAttribute("hidden");
    playerScreen?.setAttribute("aria-hidden", "false");
    document.body.classList.remove("login-active", "loading-active");
    document.body.classList.add("player-active");
    window.scrollTo(0, 0);
    window.dispatchEvent(new CustomEvent("slimflix:auth-ready"));
  }

  function showLoginScreen() {
    enforceGuestOnlyUI();
    hideLoadingScreen();
    clearLoginError();
  }

  async function preloadCacheSeries() {
    if (!window.SlimFlixXtream?.carregarDadosSeries) return;
    try {
      const { categorias } = await SlimFlixXtream.carregarDadosSeries();
      const first = categorias?.[0];
      if (first) {
        await SlimFlixXtream.carregarListaSeriesPorCategoria(first.categoryId, first.name);
      }
    } catch (e) {
      console.warn("[SlimFlix] Pré-cache de séries:", e);
    }
  }

  /**
   * Exibe o loader, baixa todo o catálogo para o cache e só então abre o player.
   */
  async function iniciarSessaoComPrecarga() {
    if (!hasActiveSession()) {
      enforceGuestOnlyUI();
      return;
    }
    document.documentElement.classList.remove("slimflix-locked");
    showLoadingScreen();
    try {
      await carregarCatalogoXtream();
    } catch (err) {
      console.error("[SlimFlix] Falha na precarga do catálogo:", err);
    } finally {
      showPlayerScreen();
    }
  }

  async function fetchXtreamStreamsAndAdapt(session) {
    const [liveCategories, vodCategories, seriesCategories] = await Promise.all([
      buscarCategoriasCanais(),
      buscarCategoriasFilmes(),
      buscarSeriesCategoriesRaw(),
    ]);

    const [liveStreams, vodStreams, seriesList] = await Promise.all([
      buscarLiveStreams(),
      buscarVodStreams(),
      buscarSeriesListRaw(),
    ]);

    return XtreamAdapter.adaptXtreamToM3UEntries({
      liveStreams,
      vodStreams,
      seriesList,
      liveCategories,
      vodCategories,
      seriesCategories,
      session,
    });
  }

  function waitForSlimFlixCatalog(maxAttempts = 40) {
    return new Promise((resolve) => {
      let attempts = 0;
      const tick = () => {
        const catalog = window.SlimFlixCatalog;
        if (catalog?.aplicarCatalogoFromEntries) {
          resolve(catalog);
          return;
        }
        attempts += 1;
        if (attempts >= maxAttempts) {
          resolve(null);
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  /**
   * Carrega catálogo Xtream, adapta para formato M3U e renderiza carrosséis.
   */
  async function carregarCatalogoXtream() {
    if (!hasActiveSession()) {
      console.warn("[SlimFlix] Precarga bloqueada — sem sessão ativa.");
      return;
    }

    const catalog = await waitForSlimFlixCatalog();
    if (!catalog) {
      console.error("[SlimFlix] SlimFlixCatalog não disponível — verifique ordem dos scripts.");
      return;
    }

    const session = getStoredSession();
    const isDev = sessionStorage.getItem("slimflix_dev_mode") === "1";
    let entries = [];
    let usedMock = false;

    try {
      if (isDev && !isSessionStored()) {
        throw new Error("Modo desenvolvedor sem sessão — usando catálogo de teste.");
      }
      if (!session.username || !session.password) {
        throw new Error("Credenciais Xtream ausentes.");
      }

      entries = await fetchXtreamStreamsAndAdapt(session);
      console.log("[SlimFlix Xtream] Entradas adaptadas para o player:", entries.length);
    } catch (err) {
      console.error("[SlimFlix Xtream] Falha ao montar catálogo:", err);
      usedMock = true;
      const msg = formatFetchError(err);
      showPlayerApiAlert(
        `${msg} Exibindo catálogo de demonstração nos carrosséis.`
      );
      entries = XtreamAdapter.getMockCatalogEntries(session);
      console.log("[SlimFlix Xtream] Catálogo mock aplicado:", entries.length, "itens");
    }

    if (!entries.length) {
      entries = XtreamAdapter.getMockCatalogEntries(session);
      usedMock = true;
    }

    catalog.aplicarCatalogoFromEntries(entries, {
      source: usedMock ? "xtream-mock" : "xtream-api",
    });

    await preloadCacheSeries();
  }

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearLoginError();

    const credentials = getLoginCredentials();
    if (!credentials.username || !credentials.password) {
      showLoginError("Preencha usuário e senha.");
      return;
    }

    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const submitLabel = submitBtn?.querySelector("span") || submitBtn;
    const originalText = submitLabel?.textContent;

    submitBtn?.setAttribute("disabled", "true");
    if (submitLabel) submitLabel.textContent = "Autenticando…";

    try {
      sessionStorage.removeItem("slimflix_dev_mode");

      const result = await authenticateXtream(credentials);
      if (result.ok) {
        await iniciarSessaoComPrecarga();
      } else {
        clearXtreamSession();
        showLoginError(result.message || "Não foi possível autenticar. Tente novamente.");
      }
    } finally {
      submitBtn?.removeAttribute("disabled");
      if (submitLabel && originalText) submitLabel.textContent = originalText;
    }
  });

  logoutBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    logoutUser();
  });

  playerApiAlertClose?.addEventListener("click", () => {
    hidePlayerApiAlert();
  });

  togglePasswordBtn?.addEventListener("click", () => {
    if (!passInput) return;
    const isPassword = passInput.type === "password";
    passInput.type = isPassword ? "text" : "password";
    togglePasswordBtn.setAttribute("aria-label", isPassword ? "Ocultar senha" : "Mostrar senha");
    togglePasswordBtn.setAttribute("aria-pressed", String(isPassword));
  });

  async function initAppScreen() {
    if (!hasActiveSession()) {
      enforceGuestOnlyUI();
      return;
    }
    await iniciarSessaoComPrecarga();
  }

  function onDocumentReady() {
    if (!hasActiveSession()) {
      enforceGuestOnlyUI();
      return;
    }
    void initAppScreen();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onDocumentReady);
  } else {
    onDocumentReady();
  }

  window.SlimFlixAuth = {
    SLIMFLIX_LOGIN_BUILD,
    IPTV_API_BASE,
    IPTV_UPSTREAM_HOSTS,
    IPTV_UPSTREAM_SERVERS,
    IPTV_SERVERS,
    STORAGE_ACTIVE_SERVER,
    hostToApiBase,
    ensureProxiedUrl,
    httpUrlToApiProxy,
    normalizeServerUrl,
    toApiPath,
    STORAGE_SESSION,
    STORAGE_USER,
    hasActiveSession,
    enforceGuestOnlyUI,
    parseStoredSession,
    getActiveIptvServer,
    buildProxyUrl,
    wrapUrlForProxy,
    getProxyMode,
    proxyPlaybackUrl: ensureProxiedUrl,
    isXtreamLiveStreamUrl,
    isAllowedUpstreamHost,
    fetchXtreamUrl,
    authenticateXtream,
    getLoginCredentials,
    getStoredSession,
    xtreamFetch,
    buscarCategoriasFilmes,
    buscarCategoriasCanais,
    getCachedCategoriasFilmes: () => cachedCategoriasFilmes,
    getCachedCategoriasCanais: () => cachedCategoriasCanais,
    clearXtreamCatalogCache,
    buscarLiveStreams,
    buscarVodStreams,
    showLoadingScreen,
    hideLoadingScreen,
    showPlayerScreen,
    showLoginScreen,
    iniciarSessaoComPrecarga,
    showPlayerApiAlert,
    hidePlayerApiAlert,
    logoutUser,
    clearXtreamSession,
    saveXtreamSession,
    isSessionStored,
    MOCK_CATEGORIAS_FILMES,
    MOCK_CATEGORIAS_CANAIS,
    carregarCatalogoXtream,
    fetchXtreamStreamsAndAdapt,
  };
})();
