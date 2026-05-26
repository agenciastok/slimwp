/**
 * SlimFlix — autenticação Xtream Codes API e navegação SPA (login ↔ player)
 */
(function () {
  /** Altere para a URL do seu painel Xtream (sem barra no final). */
  const IPTV_SERVER = "http://spacetg.shop";

  const STORAGE_SESSION = "slimflix_session";
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
  const devBypassBtn = document.getElementById("dev-bypass-btn");
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
      return "Erro de rede ao contatar o painel IPTV (proxy ou servidor indisponível).";
    }
    return err?.message || "Erro desconhecido na API Xtream.";
  }

  const DEFAULT_ALLOWED_HOSTS = ["spacetg.shop"];

  function getSessionServerHost() {
    try {
      const server = normalizeServerUrl(getStoredSession().server || IPTV_SERVER);
      return new URL(server).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  function isAllowedUpstreamHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    const hosts = new Set([...DEFAULT_ALLOWED_HOSTS, getSessionServerHost()].filter(Boolean));
    for (const allowed of hosts) {
      if (host === allowed || host.endsWith(`.${allowed}`)) return true;
    }
    return false;
  }

  /** Rota Vercel serverless — evita CORS no browser. */
  function buildProxyUrl(targetUrl) {
    return `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
  }

  function isXtreamLiveStreamUrl(targetUrl) {
    if (!targetUrl || typeof targetUrl !== "string") return false;
    try {
      const path = new URL(targetUrl.trim()).pathname.toLowerCase();
      return /\/live\//.test(path);
    } catch {
      return /\/live\//i.test(targetUrl);
    }
  }

  /**
   * Encapsula qualquer URL do painel (API, /live/, /movie/, /series/) no proxy Vercel.
   */
  function wrapUrlForProxy(targetUrl) {
    if (!targetUrl || typeof targetUrl !== "string") return targetUrl;
    const trimmed = targetUrl.trim();
    if (trimmed.startsWith("/api/proxy")) return trimmed;
    try {
      const parsed = new URL(trimmed, window.location.origin);
      if (!["http:", "https:"].includes(parsed.protocol)) return targetUrl;
      if (!isAllowedUpstreamHost(parsed.hostname)) return targetUrl;
      return buildProxyUrl(parsed.href);
    } catch {
      return targetUrl;
    }
  }

  /**
   * GET na Xtream API via proxy (/api/proxy). Em localhost sem Vercel, tenta fetch direto.
   */
  async function fetchXtreamUrl(targetUrl) {
    const proxyUrl = buildProxyUrl(targetUrl);
    let response;

    try {
      response = await fetch(proxyUrl, { method: "GET", credentials: "same-origin" });
    } catch (proxyErr) {
      console.warn("[SlimFlix Xtream] Proxy indisponível, tentando origem direta:", proxyErr);
      response = await fetch(targetUrl, { method: "GET" });
    }

    if (!response.ok && response.status === 404 && /localhost|127\.0\.0\.1/.test(window.location.hostname)) {
      response = await fetch(targetUrl, { method: "GET" });
    }

    return response;
  }

  function normalizeServerUrl(raw) {
    let url = (raw || "").trim();
    if (!url) return "";
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    return url.replace(/\/+$/, "");
  }

  function getLoginCredentials() {
    return {
      server: normalizeServerUrl(IPTV_SERVER),
      username: (userInput?.value || "").trim(),
      password: passInput?.value || "",
    };
  }

  function getStoredSession() {
    const parsed = parseStoredSession();
    if (parsed) {
      return {
        server: normalizeServerUrl(parsed.server || IPTV_SERVER),
        username: parsed.username,
        password: parsed.password,
      };
    }
    return {
      server: normalizeServerUrl(IPTV_SERVER),
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

  function saveXtreamSession(username, password, apiPayload) {
    const userInfo = normalizeUserInfo(apiPayload);
    const server = normalizeServerUrl(IPTV_SERVER);
    localStorage.setItem(STORAGE_USER, username);
    localStorage.setItem(STORAGE_PASS, password);
    localStorage.setItem(STORAGE_USER_LEGACY, username);
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

  function buildPlayerApiUrl(username, password, action, extraParams = {}, serverBase) {
    const base = normalizeServerUrl(serverBase || IPTV_SERVER);
    const params = new URLSearchParams({
      username,
      password,
    });
    if (action) params.set("action", action);
    Object.entries(extraParams).forEach(([key, value]) => {
      if (value != null && value !== "") params.set(key, String(value));
    });
    return `${base}/player_api.php?${params.toString()}`;
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
   * Autenticação Xtream Codes API via player_api.php
   */
  async function authenticateXtream(credentials) {
    const { server, username, password } = credentials;

    if (!server || server.includes("seu-painel-iptv")) {
      return {
        ok: false,
        message: "Configure IPTV_SERVER em login.js com a URL do seu painel.",
      };
    }

    const url = buildPlayerApiUrl(username, password, undefined, {}, server);

    let data;
    try {
      const response = await fetchXtreamUrl(url);
      if (!response.ok) {
        return {
          ok: false,
          message: `Não foi possível conectar ao servidor (${response.status}).`,
        };
      }
      data = await response.json();
    } catch (err) {
      console.error("[SlimFlix Xtream] Erro de rede:", err);
      return {
        ok: false,
        message:
          "Falha na conexão com o servidor. Verifique IPTV_SERVER ou se o proxy /api/proxy está ativo na Vercel.",
      };
    }

    const userInfo = normalizeUserInfo(data);

    console.log("[SlimFlix Xtream] Resposta de autenticação:", {
      username,
      user_info: userInfo,
      server_info: data?.server_info,
    });

    if (!isUserActive(userInfo)) {
      return {
        ok: false,
        message: "Usuário ou senha inválidos, ou conta inativa no servidor.",
      };
    }

    saveXtreamSession(username, password, data);

    return { ok: true, userInfo, serverInfo: data?.server_info };
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

  async function enterDeveloperMode() {
    clearLoginError();
    console.info("[SlimFlix] Modo desenvolvedor — sessão local de teste.");
    sessionStorage.setItem("slimflix_dev_mode", "1");
    saveXtreamSession("dev", "dev", null);
    await iniciarSessaoComPrecarga();
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

  devBypassBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    void enterDeveloperMode();
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
    IPTV_SERVER,
    STORAGE_SESSION,
    STORAGE_USER,
    hasActiveSession,
    enforceGuestOnlyUI,
    parseStoredSession,
    buildProxyUrl,
    wrapUrlForProxy,
    proxyPlaybackUrl: wrapUrlForProxy,
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
    enterDeveloperMode,
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
