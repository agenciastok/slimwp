const STORAGE_KEY = "slimflix-watch-progress";
const PLACEHOLDER_POSTER =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300"><rect fill="#141414" width="200" height="300"/><text x="100" y="155" text-anchor="middle" fill="#6b7280" font-family="sans-serif" font-size="14">Sem capa</text></svg>'
  );

const LIMITS = {
  TRENDING: 24,
  CONTINUE: 20,
  RECOMMENDED: 24,
  CATEGORY_ROWS: 30,
  CATEGORY_ITEMS: 24,
  BROWSE_GRID: 400,
  SEARCH_RESULTS: 500,
};

const TAB_LABELS = {
  home: { trending: "Em alta no Slimflix", continue: "Continuar assistindo", recommended: "Recomendado para você" },
  channels: { trending: "Canais em alta", continue: "Canais recentes", recommended: "Mais canais" },
  movies: { trending: "Filmes em alta", continue: "Continuar filmes", recommended: "Filmes para você" },
  series: { trending: "Séries em alta", continue: "Continuar séries", recommended: "Séries para você" },
};

const ABAS_COM_SIDEBAR = new Set(["movies", "series"]);

const navbar = document.getElementById("navbar");
const contentEl = document.getElementById("content");
const categoryRowsEl = document.getElementById("category-rows");
const carouselSectionsEl = document.getElementById("carousel-sections");
const browsePanel = document.getElementById("browse-panel");
const browseGrid = document.getElementById("browse-grid");
const browseTitle = document.getElementById("browse-title");
const browseMeta = document.getElementById("browse-meta");
const sidebar = document.getElementById("pastas-sidebar");
const sidebarNav = document.getElementById("sidebar-nav");
const loadStatus = document.getElementById("load-status");
const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const mainNav = document.getElementById("main-nav");
const playerModal = document.getElementById("player-modal");
const playerVideo = document.getElementById("player-video");
const playerTitle = document.getElementById("player-title");
const playerClose = document.getElementById("player-close");
const seriesModal = document.getElementById("series-modal");
const seriesClose = document.getElementById("series-close");
const seriesPoster = document.getElementById("series-poster");
const seriesNameEl = document.getElementById("series-name");
const seriesCategoryEl = document.getElementById("series-category");
const seriesEpCountEl = document.getElementById("series-ep-count");
const seasonTabsEl = document.getElementById("season-tabs");
const episodeGridEl = document.getElementById("episode-grid");
const channelsView = document.getElementById("channels-view");
const channelsFoldersEl = document.getElementById("channels-folders");
const channelsListEl = document.getElementById("channels-list");
const channelsListHeading = document.getElementById("channels-list-heading");
const channelsVideo = document.getElementById("channels-video");
const channelsNowTitle = document.getElementById("channels-now-title");
const channelsFullscreenBtn = document.getElementById("channels-fullscreen-btn");
const channelsPlayerScreen = document.getElementById("channels-player-screen");

let arrayCanais = [];
let arrayFilmes = [];
let arraySeries = [];
let categoriasPorAba = { channels: [], movies: [], series: [] };
let xtreamSeriesCategories = [];
let xtreamSeriesBrowseList = [];
let xtreamSeriesReady = false;
/** Última pasta de séries selecionada (restaura ao voltar na aba sem novo fetch). */
let ultimaPastaSeriesNome = null;
let abaAtiva = "home";
let pastaAtiva = null;
let pastaCanalAtiva = null;
let canalAtivo = null;
let termoBusca = "";
let searchDebounceTimer = null;
let featuredEntry = null;
let activeSeries = null;
let activeSeason = 1;
let savedScrollY = 0;
let renderGeneration = 0;
let activeHls = null;
let channelPlaybackToken = 0;
let canalReproduzindoUrl = null;
let channelStallWatchId = null;
let channelPlayDelayTimer = null;

/** Instância global do mpegts.js para canais ao vivo (.ts). */
window.mpegtsPlayer = window.mpegtsPlayer || null;

/** Margem de atraso permitida antes do watchdog corrigir (anti-travamento). */
const CHANNEL_STALL_MAX_LAG_SEC = 22;
const CHANNEL_LIVE_EDGE_OFFSET_SEC = 4.5;
const CHANNEL_INITIAL_PLAYBACK_OFFSET_SEC = 4.5;
const CHANNEL_STASH_PLAY_DELAY_MS = 3000;
const CHANNEL_MIN_BUFFER_BEFORE_PLAY_SEC = 4;

const MPEGTS_LIVE_OPTIONS = {
  enableWorker: true,
  enableStashBuffer: true,
  stashInitialSize: 1024 * 1024 * 3,
  liveBufferLatencyChasing: false,
  autoCleanupSourceBuffer: true,
  autoCleanupMaxBackwardDuration: 5,
  autoCleanupMinBackwardDuration: 2,
};

/* ─── Scroll navbar ─── */
window.addEventListener("scroll", () => {
  navbar?.classList.toggle("scrolled", window.scrollY > 50);
});

/* ─── Player (MP4 + HLS via hls.js) ─── */
function destroyHls() {
  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }
}

function destroyMpegts() {
  if (!window.mpegtsPlayer) return;
  const player = window.mpegtsPlayer;
  window.mpegtsPlayer = null;
  try {
    player.pause();
  } catch {
    /* ignore */
  }
  try {
    player.unload();
  } catch {
    /* ignore */
  }
  try {
    player.detachMediaElement();
  } catch {
    /* ignore */
  }
  try {
    player.destroy();
  } catch {
    /* ignore */
  }
}

/**
 * Garante <video id="channels-video"> no DOM (Video.js antigo podia trocar por um div).
 */
function ensureChannelsVideoElement() {
  const screen = document.getElementById("channels-player-screen");
  if (!screen) {
    console.error("[Slimflix] #channels-player-screen não encontrado");
    return null;
  }

  let video = document.getElementById("channels-video");

  if (video && video.tagName !== "VIDEO") {
    const inner = video.querySelector("video");
    if (inner) {
      video.removeAttribute("id");
      video = inner;
    } else {
      video.remove();
      video = null;
    }
  }

  if (!video) {
    video = screen.querySelector("video");
  }

  if (!video) {
    video = document.createElement("video");
    video.id = "channels-video";
    video.className = "channels-player__video";
    video.controls = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("crossorigin", "anonymous");
    video.preload = "auto";
    const fsBtn = document.getElementById("channels-fullscreen-btn");
    if (fsBtn) screen.insertBefore(video, fsBtn);
    else screen.appendChild(video);
    console.warn("[Slimflix] Tag <video id=\"channels-video\"> recriada no DOM");
  }

  video.id = "channels-video";
  video.classList.add("channels-player__video");
  video.setAttribute("crossorigin", "anonymous");
  video.crossOrigin = "anonymous";

  if (typeof video.play !== "function") {
    console.error("[Slimflix] #channels-video não é um HTMLVideoElement válido", video);
    return null;
  }

  return video;
}

function canUseMpegtsLive() {
  if (typeof mpegts === "undefined") return false;
  if (typeof mpegts.isSupported === "function" && mpegts.isSupported()) return true;
  return !!mpegts.getFeatureList?.().mseLivePlayback;
}

/**
 * URL canônica Xtream: http://dominio/live/usuario/senha/STREAM_ID.ts
 * Prioriza stream_id da API; não inventa .m3u8 a partir de rotas /auth/ etc.
 */
function buildXtreamLiveStreamUrl(entry, originalUrl) {
  const session = window.SlimFlixAuth?.getStoredSession?.();
  const streamId = entry?.xtreamStreamId ?? entry?.xtream_stream_id;
  if (session?.server && session?.username && session?.password && streamId != null && streamId !== "") {
    const base = session.server.replace(/\/+$/, "");
    const built = `${base}/live/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${streamId}.ts`;
    try {
      return new URL(built).href;
    } catch {
      return built;
    }
  }
  return enforceHttpStreamUrl(toAbsoluteLiveStreamUrl(originalUrl));
}

/** Ambiente VPS: streams sempre em HTTP (nunca forçar HTTPS). */
function enforceHttpStreamUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(String(url).trim());
    parsed.protocol = "http:";
    return parsed.href;
  } catch {
    return String(url).trim().replace(/^https:/i, "http:");
  }
}

function isLiveHlsUrl(streamUrl) {
  return (streamUrl || "").toLowerCase().includes(".m3u8");
}

function showLiveChannelUnavailable(titleEl, entry, extra = {}) {
  console.error("[Slimflix] Canal indisponível:", {
    canal: entry?.name,
    ...extra,
  });
  if (titleEl) titleEl.textContent = "Canal indisponível";
}

function clearChannelStallWatcher() {
  if (channelStallWatchId != null) {
    clearInterval(channelStallWatchId);
    channelStallWatchId = null;
  }
}

function clearChannelPlayDelay() {
  if (channelPlayDelayTimer != null) {
    clearTimeout(channelPlayDelayTimer);
    channelPlayDelayTimer = null;
  }
}

/** Inicia ~4–5s atrás da borda do buffer para margem de segurança ao vivo. */
function applyChannelSafePlaybackOffset(videoEl) {
  if (!videoEl?.buffered || videoEl.buffered.length === 0) return false;

  const bufferedEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
  const bufferedStart = videoEl.buffered.start(0);
  const target = Math.max(
    bufferedStart,
    bufferedEnd - CHANNEL_INITIAL_PLAYBACK_OFFSET_SEC
  );

  try {
    videoEl.currentTime = target;
    return true;
  } catch {
    return false;
  }
}

/**
 * Aguarda stash/buffer inicial antes do play (evita travamento ao trocar de canal).
 */
function scheduleMpegtsDelayedPlay(playbackToken, videoElement, entry, titleEl) {
  clearChannelPlayDelay();

  if (!window.mpegtsPlayer || !videoElement) return;

  if (titleEl) {
    titleEl.textContent = "Preparando buffer…";
  }

  try {
    window.mpegtsPlayer.pause();
  } catch {
    /* ignore */
  }
  try {
    videoElement.pause();
  } catch {
    /* ignore */
  }

  const startedAt = Date.now();

  const beginPlayback = () => {
    if (playbackToken != null && playbackToken !== channelPlaybackToken) return;
    if (!window.mpegtsPlayer) return;

    applyChannelSafePlaybackOffset(videoElement);

    try {
      window.mpegtsPlayer.play();
    } catch (err) {
      console.warn("[Slimflix] mpegts.play após buffer:", err);
    }

    try {
      const playPromise = videoElement.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    } catch (err) {
      console.warn("[Slimflix] video.play após buffer:", err);
    }

    if (titleEl && entry) {
      titleEl.textContent = entry.name || entry.label || "Canal";
    }

    startChannelStallWatcher(videoElement, playbackToken);
  };

  const waitForBuffer = () => {
    if (playbackToken != null && playbackToken !== channelPlaybackToken) return;

    let bufferedAhead = 0;
    if (videoElement.buffered && videoElement.buffered.length > 0) {
      const end = videoElement.buffered.end(videoElement.buffered.length - 1);
      const start = videoElement.buffered.start(0);
      bufferedAhead = end - Math.max(videoElement.currentTime, start);
    }

    const elapsed = Date.now() - startedAt;
    const bufferReady = bufferedAhead >= CHANNEL_MIN_BUFFER_BEFORE_PLAY_SEC;
    const delayElapsed = elapsed >= CHANNEL_STASH_PLAY_DELAY_MS;

    if (bufferReady || delayElapsed) {
      clearChannelPlayDelay();
      beginPlayback();
      return;
    }

    channelPlayDelayTimer = setTimeout(waitForBuffer, 250);
  };

  channelPlayDelayTimer = setTimeout(waitForBuffer, 500);
}

/** Salta para a borda ao vivo se o buffer acumular atraso excessivo. */
function startChannelStallWatcher(videoEl, playbackToken) {
  clearChannelStallWatcher();
  if (!videoEl) return;

  channelStallWatchId = setInterval(() => {
    if (playbackToken != null && playbackToken !== channelPlaybackToken) {
      clearChannelStallWatcher();
      return;
    }
    if (videoEl.paused || videoEl.readyState < 2) return;
    if (!videoEl.buffered || videoEl.buffered.length === 0) return;

    const bufferedEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
    const lag = bufferedEnd - videoEl.currentTime;

    if (lag > CHANNEL_STALL_MAX_LAG_SEC) {
      const target = Math.max(0, bufferedEnd - CHANNEL_LIVE_EDGE_OFFSET_SEC);
      try {
        videoEl.currentTime = target;
      } catch {
        /* seek na borda ao vivo pode falhar em alguns browsers */
      }
    }
  }, 400);
}

function teardownChannelPlayer() {
  clearChannelPlayDelay();
  clearChannelStallWatcher();
  destroyHls();
  destroyMpegts();
  canalReproduzindoUrl = null;

  const videoElement = ensureChannelsVideoElement();
  if (!videoElement) return;
  try {
    videoElement.pause();
  } catch {
    /* ignore */
  }
  try {
    videoElement.removeAttribute("src");
    videoElement.removeAttribute("srcObject");
  } catch {
    /* ignore */
  }
}

function playLiveChannelHls(videoElement, streamUrl, entry, playbackToken) {
  if (playbackToken != null && playbackToken !== channelPlaybackToken) return;

  destroyMpegts();
  activeHls = new Hls(createHlsConfig());
  activeHls.loadSource(streamUrl);
  activeHls.attachMedia(videoElement);

  activeHls.on(Hls.Events.MANIFEST_PARSED, () => {
    if (playbackToken != null && playbackToken !== channelPlaybackToken) return;
    videoElement.play().catch(() => {});
    if (channelsNowTitle && entry?.name) {
      channelsNowTitle.textContent = entry.name;
    }
  });

  activeHls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data?.fatal) return;
    if (playbackToken != null && playbackToken !== channelPlaybackToken) return;
    try {
      videoElement.pause();
    } catch {
      /* ignore */
    }
    destroyHls();
    showLiveChannelUnavailable(channelsNowTitle, entry, { url: streamUrl });
  });
}

/**
 * Canal ao vivo: <video id="channels-video"> + mpegts.js (HTTP puro, sem Video.js).
 */
function playLiveChannel(entry, playbackToken) {
  if (!entry?.url) return;
  if (playbackToken != null && playbackToken !== channelPlaybackToken) return;

  const urlDoCanal = enforceHttpStreamUrl(buildXtreamLiveStreamUrl(entry, entry.url));

  destroyHls();
  destroyMpegts();

  const videoElement = ensureChannelsVideoElement();
  if (!videoElement) {
    showLiveChannelUnavailable(channelsNowTitle, entry, { url: urlDoCanal });
    return;
  }

  if (channelsNowTitle) {
    channelsNowTitle.textContent = entry.name || entry.label || "Canal";
  }

  console.info("[Slimflix] Canal:", {
    nome: entry.name,
    url: urlDoCanal,
    streamId: entry.xtreamStreamId,
    videoTag: videoElement.tagName,
  });

  if (isLiveHlsUrl(urlDoCanal)) {
    playLiveChannelHls(videoElement, urlDoCanal, entry, playbackToken);
    return;
  }

  if (!canUseMpegtsLive()) {
    showLiveChannelUnavailable(channelsNowTitle, entry, {
      url: urlDoCanal,
      reason: "mpegts.js indisponível neste navegador",
    });
    return;
  }

  try {
    window.mpegtsPlayer = mpegts.createPlayer(
      {
        type: "mse",
        isLive: true,
        url: urlDoCanal,
      },
      MPEGTS_LIVE_OPTIONS
    );

    window.mpegtsPlayer.attachMediaElement(videoElement);
    window.mpegtsPlayer.load();

    window.mpegtsPlayer.on(mpegts.Events.ERROR, () => {
      if (playbackToken != null && playbackToken !== channelPlaybackToken) return;
      clearChannelPlayDelay();
      try {
        videoElement.pause();
      } catch {
        /* ignore */
      }
      destroyMpegts();
      showLiveChannelUnavailable(channelsNowTitle, entry, { url: urlDoCanal });
    });

    scheduleMpegtsDelayedPlay(playbackToken, videoElement, entry, channelsNowTitle);
  } catch (err) {
    console.error("[Slimflix] Falha ao iniciar mpegts:", err);
    destroyMpegts();
    showLiveChannelUnavailable(channelsNowTitle, entry, { url: urlDoCanal, err: String(err) });
  }
}

function isRawTsStreamUrl(url) {
  const lower = (url || "").toLowerCase();
  if (/\.m3u8(?:\?|$)/i.test(lower)) return false;
  return (
    /\.ts(?:\?|$)/i.test(lower) ||
    /output=ts/i.test(lower) ||
    /\/ts(?=[?#]|$)/i.test(lower)
  );
}

function isCanal(entry) {
  return entry?.type === "channel" || abaAtiva === "channels";
}

/**
 * Converte URLs de canais MPEG-TS para HLS (.m3u8).
 * Padrão IPTV: .../play/TOKEN/ts → .../play/TOKEN/m3u8
 */
function normalizeChannelStreamUrl(url, entry) {
  if (!url || !isCanal(entry)) return url;

  let normalized = url.trim();

  normalized = normalized.replace(/output=(?:ts|mpegts)(?=&|$)/gi, "output=m3u8");
  normalized = normalized.replace(/([&?])output=(?:ts|mpegts)\b/gi, "$1output=m3u8");

  if (/\/ts(?=[?#]|$)/i.test(normalized)) {
    normalized = normalized.replace(/\/ts(?=[?#]|$)/i, "/m3u8");
  } else if (/\.ts(?=[?#]|$)/i.test(normalized)) {
    normalized = normalized.replace(/\.ts(?=[?#]|$)/i, ".m3u8");
  }

  if (normalized !== url) {
    console.info("[Slimflix] URL do canal convertida para HLS:", {
      original: url,
      normalized,
    });
  }

  return normalized;
}

/** Fallback se /m3u8 falhar: mantém /ts e acrescenta .m3u8 */
function getChannelStreamFallbackUrl(url) {
  if (!url || !/\/ts(?=[?#]|$)/i.test(url)) return null;
  return url.replace(/\/ts(?=[?#]|$)/i, "/ts.m3u8");
}

function needsHlsPlayback(url, entry) {
  const lower = (url || "").toLowerCase();
  if (isCanal(entry) && entry?.type === "channel" && abaAtiva === "channels") return false;
  if (/\.m3u8(?:\?|$)/i.test(lower)) return true;
  if (/\.ts(?:\?|$)/i.test(lower)) return true;
  if (/output=(?:ts|mpegts|m3u8)/i.test(lower)) return true;
  if (/\/live\//.test(lower) || /\/canais\//.test(lower)) return true;
  return false;
}

function isXtreamLiveStreamUrl(url) {
  if (window.SlimFlixAuth?.isXtreamLiveStreamUrl) {
    return window.SlimFlixAuth.isXtreamLiveStreamUrl(url);
  }
  return /\/live\//i.test(url || "");
}

/** Reprodução direta no painel (sem /api/proxy). */
function proxyPlaybackUrl(url) {
  const trimmed = (url || "").trim();
  if (!trimmed) return trimmed;
  return window.SlimFlixAuth?.wrapUrlForProxy?.(trimmed) || trimmed;
}

/**
 * Garante extensão .ts em URLs Xtream /live/.../STREAM_ID quando ausente.
 */
function ensureLiveTsUrl(url) {
  if (!url) return url;
  const trimmed = url.trim();
  if (!isXtreamLiveStreamUrl(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (/\.(ts|m3u8|mp4|mkv|avi)(\?|#|$)/i.test(parsed.pathname)) {
      return parsed.href;
    }
    if (/\/live\/[^/]+\/[^/]+\/[^/]+$/i.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname}.ts`;
      return parsed.href;
    }
    return parsed.href;
  } catch {
    if (/\.(ts|m3u8)(\?|#|$)/i.test(trimmed)) return trimmed;
    return trimmed;
  }
}

/** URL absoluta do canal (.ts), sem passar pelo domínio da Vercel. */
function toAbsoluteLiveStreamUrl(originalUrl) {
  const withTs = ensureLiveTsUrl(originalUrl);
  try {
    return new URL(withTs).href;
  } catch {
    const server = window.SlimFlixAuth?.getStoredSession?.()?.server;
    if (server) return new URL(withTs, server.replace(/\/+$/, "/")).href;
    return withTs;
  }
}

function liveStreamUrlWithProtocol(absoluteUrl, protocol) {
  const parsed = new URL(absoluteUrl);
  parsed.protocol = protocol === "https" ? "https:" : "http:";
  return parsed.href;
}

function createHlsConfig() {
  const config = {
    enableWorker: true,
    lowLatencyMode: true,
  };
  config.xhrSetup = (xhr, requestUrl) => {
    xhr.open("GET", proxyPlaybackUrl(requestUrl), true);
  };
  return config;
}

function resetVideoElement(videoEl) {
  if (!videoEl) return;
  if (videoEl === channelsVideo || videoEl?.id === "channels-video") {
    teardownChannelPlayer();
    return;
  }
  destroyHls();
  try {
    videoEl.pause();
    videoEl.removeAttribute("src");
    videoEl.removeAttribute("srcObject");
    videoEl.load();
  } catch {
    /* ignore */
  }
}

function resetPlayerElement() {
  resetVideoElement(playerVideo);
}

function logHlsError(url, entry, data) {
  console.log("Erro de Stream:", data);
  console.error("[Slimflix HLS] Erro no stream:", {
    canal: entry?.name,
    urlOriginal: entry?.url,
    urlReproduzindo: url,
    type: data?.type,
    details: data?.details,
    fatal: data?.fatal,
    reason: data?.reason,
    error: data?.error,
    response: data?.response,
    networkDetails: data?.networkDetails,
    context: data?.context,
    data,
  });
}

function startHlsPlayback(streamUrl, entry, originalUrl, videoEl, titleEl, playbackToken) {
  if (!videoEl) return;
  if (playbackToken != null && playbackToken !== channelPlaybackToken) return;

  activeHls = new Hls(createHlsConfig());

  const tryLoad = (urlToLoad) => {
    activeHls.loadSource(urlToLoad);
    activeHls.attachMedia(videoEl);
  };

  activeHls.on(Hls.Events.MANIFEST_PARSED, () => {
    videoEl.play().catch(() => {});
  });

  activeHls.on(Hls.Events.ERROR, (_event, data) => {
    logHlsError(streamUrl, entry, data);
    if (data.fatal && titleEl) {
      titleEl.textContent = `Erro ao carregar: ${entry?.name || "Filme"}`;
    }
  });

  tryLoad(streamUrl);
}

function attachStreamToVideo(videoEl, titleEl, url, entry, options = {}) {
  if (!videoEl || !url) return;

  const { playbackToken = null } = options;
  const trimmed = url.trim();
  const live = isCanal(entry) || isXtreamLiveStreamUrl(trimmed);

  if (playbackToken != null && playbackToken !== channelPlaybackToken) return;

  if (live && (videoEl?.id === "channels-video" || videoEl === document.getElementById("channels-video"))) {
    playLiveChannel(entry, playbackToken);
    return;
  }

  const streamUrl = proxyPlaybackUrl(trimmed);
  const useHls = needsHlsPlayback(trimmed, entry);

  if (useHls && typeof Hls !== "undefined" && Hls.isSupported()) {
    startHlsPlayback(streamUrl, entry, trimmed, videoEl, titleEl, playbackToken);
    return;
  }

  if (useHls && videoEl.canPlayType("application/vnd.apple.mpegurl")) {
    videoEl.src = streamUrl;
    videoEl.addEventListener(
      "loadedmetadata",
      () => {
        videoEl.play().catch(() => {});
      },
      { once: true }
    );
    return;
  }

  videoEl.src = streamUrl;
  videoEl.load();
  videoEl.play().catch(() => {});
}

function attachStreamToPlayer(url, entry) {
  attachStreamToVideo(playerVideo, playerTitle, url, entry);
}

function attachStreamToChannelsPlayer(url, entry, playbackToken) {
  playLiveChannel(entry, playbackToken);
}

function openPlayer(entry) {
  if (!entry?.url || !playerModal || !playerVideo) return;

  savedScrollY = window.scrollY;
  document.body.classList.add("modal-open");

  if (playerTitle) {
    playerTitle.textContent = entry.name || entry.label || "Reproduzindo";
  }

  resetPlayerElement();
  attachStreamToPlayer(entry.url, entry);
  if (isCanal(entry)) {
    const abs = buildXtreamLiveStreamUrl(entry, entry.url);
    console.info("[Slimflix] Reproduzindo canal (direto, sem proxy):", {
      nome: entry.name,
      urlOriginal: entry.url,
      urlHttp: enforceHttpStreamUrl(abs),
      streamId: entry.xtreamStreamId,
    });
  }

  playerModal.hidden = false;
  playerModal.setAttribute("aria-hidden", "false");
}

function closePlayer() {
  if (!playerModal || !playerVideo) return;

  resetPlayerElement();

  playerModal.hidden = true;
  playerModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");

  window.scrollTo({
    top: savedScrollY,
    behavior: "instant" in window ? "instant" : "auto",
  });
}

function playEntry(entry) {
  if (!entry?.url) return;
  const current = getWatchProgress()[entry.url] || 0;
  saveWatchProgress(entry.url, current > 0 && current < 95 ? current + 12 : 28);
  if (entry.type === "channel" && abaAtiva === "channels") {
    playChannelInline(entry);
    return;
  }
  openPlayer(entry);
}

function updateChannelsListActiveState() {
  if (!channelsListEl || !canalAtivo?.url) return;
  channelsListEl.querySelectorAll(".channels-channel").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.url === canalAtivo.url);
  });
}

function playChannelInline(entry) {
  if (!entry?.url) return;
  if (!ensureChannelsVideoElement()) {
    showLiveChannelUnavailable(channelsNowTitle, entry);
    return;
  }
  if (canalReproduzindoUrl === entry.url && (window.mpegtsPlayer || activeHls)) return;

  canalAtivo = entry;
  updateChannelsListActiveState();

  channelPlaybackToken += 1;
  const playbackToken = channelPlaybackToken;

  teardownChannelPlayer();
  canalReproduzindoUrl = entry.url;
  playLiveChannel(entry, playbackToken);
}

playerClose?.addEventListener("click", closePlayer);
playerModal?.addEventListener("click", (e) => {
  if (e.target === playerModal) closePlayer();
});

/* ─── Modal série ─── */
function openSeriesDetail(show) {
  if (!show?.isSeriesGroup || !seriesModal) return;
  activeSeries = show;
  activeSeason = show.seasonList[0] ?? 1;
  savedScrollY = window.scrollY;

  if (seriesPoster) {
    seriesPoster.src = show.logo || PLACEHOLDER_POSTER;
    seriesPoster.alt = show.name;
    seriesPoster.onerror = () => {
      seriesPoster.src = PLACEHOLDER_POSTER;
    };
  }
  if (seriesNameEl) seriesNameEl.textContent = show.name;
  if (seriesCategoryEl) seriesCategoryEl.textContent = show.category;
  if (seriesEpCountEl) {
    const n = show.seasonList.length;
    seriesEpCountEl.textContent = `${show.episodeCount} episódios · ${n} temporada${n !== 1 ? "s" : ""}`;
  }

  renderSeasonTabs(show);
  renderEpisodeGrid(show, activeSeason);

  seriesModal.hidden = false;
  seriesModal.removeAttribute("hidden");
  seriesModal.setAttribute("aria-hidden", "false");
  seriesModal.setAttribute("aria-busy", "false");
  document.body.classList.add("modal-open");
}

function closeSeriesDetail() {
  if (!seriesModal) return;
  seriesModal.hidden = true;
  seriesModal.setAttribute("aria-hidden", "true");
  activeSeries = null;
  if (playerModal?.hidden) {
    document.body.classList.remove("modal-open");
    window.scrollTo({ top: savedScrollY, behavior: "instant" in window ? "instant" : "auto" });
  }
}

function renderSeasonTabs(show) {
  if (!seasonTabsEl) return;
  seasonTabsEl.innerHTML = "";
  show.seasonList.forEach((num) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `season-tab${num === activeSeason ? " active" : ""}`;
    btn.textContent = `Temporada ${num}`;
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", () => {
      activeSeason = num;
      renderSeasonTabs(show);
      renderEpisodeGrid(show, num);
    });
    seasonTabsEl.appendChild(btn);
  });
}

function renderEpisodeGrid(show, seasonNum) {
  if (!episodeGridEl) return;
  episodeGridEl.innerHTML = "";
  const episodes = show.seasons[seasonNum] || [];
  if (!episodes.length) {
    episodeGridEl.innerHTML = '<p class="row__empty">Nenhum episódio nesta temporada.</p>';
    return;
  }
  const frag = document.createDocumentFragment();
  episodes.forEach((ep) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "episode-card";
    btn.innerHTML = `
      <span class="episode-card__num">T${ep.season} · E${String(ep.episode).padStart(2, "0")}</span>
      <span class="episode-card__label">${escapeHtml(ep.label)}</span>
      <span class="episode-card__play">▶ Assistir</span>`;
    btn.addEventListener("click", () => playEntry(ep));
    frag.appendChild(btn);
  });
  episodeGridEl.appendChild(frag);
}

seriesClose?.addEventListener("click", closeSeriesDetail);
seriesModal?.addEventListener("click", (e) => {
  if (e.target === seriesModal) closeSeriesDetail();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (playerModal && !playerModal.hidden) closePlayer();
  else if (seriesModal && !seriesModal.hidden) closeSeriesDetail();
});

/* ─── Abas e listas ─── */
function tipoDaAba(tab) {
  if (tab === "channels") return "channel";
  if (tab === "movies") return "movie";
  if (tab === "series") return "series";
  return null;
}

function getListaBase(tab) {
  if (tab === "channels") return arrayCanais;
  if (tab === "movies") return arrayFilmes;
  if (tab === "series") return arraySeries;
  return misturarInicio(arrayCanais, arrayFilmes, arraySeries);
}

function getListaFiltrada(tab, pasta) {
  const base = getListaBase(tab);
  if (!pasta) return base;
  return base.filter((item) => (item.category || "Sem categoria") === pasta);
}

/** Pool de busca conforme a aba ativa */
function getListaParaBusca(tab) {
  switch (tab) {
    case "channels":
      return arrayCanais;
    case "movies":
      return arrayFilmes;
    case "series":
      return arraySeries;
    case "home":
    default:
      return [...arrayCanais, ...arrayFilmes, ...arraySeries];
  }
}

function filtrarPorBusca(lista, termo) {
  const q = termo.trim().toLowerCase();
  if (!q) return lista;
  const resultados = [];
  for (const item of lista) {
    const nome = (item.name || "").toLowerCase();
    if (nome.includes(q)) resultados.push(item);
    if (resultados.length >= LIMITS.SEARCH_RESULTS * 2) break;
  }
  return resultados;
}

function labelContextoBusca(tab) {
  const map = {
    home: "todo o catálogo",
    movies: "Filmes",
    series: "Séries",
    channels: "Canais",
  };
  return map[tab] || "catálogo";
}

function limparBusca() {
  termoBusca = "";
  if (searchInput) searchInput.value = "";
}

function executarBusca() {
  termoBusca = (searchInput?.value || "").trim();
  if (abaAtiva === "series" && isXtreamCatalogActive()) {
    void aplicarBuscaSeriesXtream();
    return;
  }
  renderizarPagina(abaAtiva);
}

/** Busca case-insensitive em name, title e plot das séries. */
function filtrarSeriesPorTermo(lista, termo) {
  const q = (termo || "").trim().toLowerCase();
  if (!q) return Array.isArray(lista) ? [...lista] : [];

  const resultados = [];
  for (const item of lista) {
    const nome = (item.name || item.title || "").toLowerCase();
    const plot = (item.plot || "").toLowerCase();
    const categoria = (item.category || "").toLowerCase();
    if (nome.includes(q) || plot.includes(q) || categoria.includes(q)) {
      resultados.push(item);
      if (resultados.length >= LIMITS.SEARCH_RESULTS) break;
    }
  }
  return resultados;
}

/**
 * Busca de séries Xtream no cache global — renderiza grade filtrada ou restaura a pasta.
 */
async function aplicarBuscaSeriesXtream() {
  hideChannelsView();
  toggleBrowseMode(true);

  if (xtreamSeriesCategories.length) {
    renderizarPastasSeries(xtreamSeriesCategories);
  }

  if (!termoBusca) {
    document.body.classList.remove("search-mode");
    const pasta = pastaAtiva || ultimaPastaSeriesNome;
    if (pasta) {
      await carregarGridSeriesPasta(pasta);
    } else if (xtreamSeriesBrowseList.length) {
      renderizarGridSeries(xtreamSeriesBrowseList, {
        titulo: "Séries",
        allowFallback: false,
      });
    } else {
      await carregarSeries();
    }
    return;
  }

  document.body.classList.add("search-mode");

  const pool = window.SlimFlixXtream?.obterCatalogoSeriesParaBusca?.() || xtreamSeriesBrowseList;
  const resultados = filtrarSeriesPorTermo(pool, termoBusca);

  renderizarGridSeries(resultados, {
    titulo: `Busca em Séries`,
    searchTerm: termoBusca,
    allowFallback: false,
    limite: LIMITS.SEARCH_RESULTS,
  });
}

function initSearch() {
  searchBtn?.addEventListener("click", () => {
    clearTimeout(searchDebounceTimer);
    executarBusca();
  });

  searchInput?.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(executarBusca, 280);
  });

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(searchDebounceTimer);
      executarBusca();
    }
    if (e.key === "Escape") {
      limparBusca();
      if (abaAtiva === "series" && isXtreamCatalogActive()) {
        void aplicarBuscaSeriesXtream();
      } else {
        renderizarPagina(abaAtiva);
      }
      searchInput?.blur();
    }
  });

  searchInput?.addEventListener("search", () => {
    if (!searchInput.value) {
      limparBusca();
      if (abaAtiva === "series" && isXtreamCatalogActive()) {
        void aplicarBuscaSeriesXtream();
      } else {
        renderizarPagina(abaAtiva);
      }
    }
  });
}

function misturarInicio(canais, filmes, series) {
  const out = [];
  const max = LIMITS.TRENDING * 4;
  let ci = 0, fi = 0, si = 0;
  while (out.length < max && (ci < canais.length || fi < filmes.length || si < series.length)) {
    if (ci < canais.length) out.push(canais[ci++]);
    if (fi < filmes.length && out.length < max) out.push(filmes[fi++]);
    if (si < series.length && out.length < max) out.push(series[si++]);
  }
  return out;
}

function pertenceAba(entry, tab) {
  const tipo = tipoDaAba(tab);
  if (!tipo) return true;
  return entry.type === tipo;
}

function setAbaAtiva(tab) {
  abaAtiva = tab;
  mainNav?.querySelectorAll(".nav-tab").forEach((link) => {
    link.classList.toggle("active", link.dataset.tab === tab);
  });
}

function isXtreamCatalogActive() {
  return (
    localStorage.getItem("slimflix_xtream_auth") === "1" ||
    sessionStorage.getItem("slimflix_dev_mode") === "1"
  );
}

function usesXtreamSeriesFlow() {
  return isXtreamCatalogActive() && abaAtiva === "series";
}

function setSidebarLoading(message = "Carregando pastas…") {
  if (!sidebarNav) return;
  sidebarNav.innerHTML = `<p class="sidebar__loading catalog-loading catalog-loading--inline"><span class="catalog-loading__spinner" aria-hidden="true"></span>${escapeHtml(message)}</p>`;
}

function setBrowseLoading(message = "Carregando…") {
  if (!browseGrid) return;
  browseGrid.innerHTML = `<div class="catalog-loading"><span class="catalog-loading__spinner" aria-hidden="true"></span><p>${escapeHtml(message)}</p></div>`;
}

/** Limpa carrosséis / modo canais antes de desenhar a aba Séries. */
function limparLayoutSeries() {
  hideChannelsView();
  limparCarrosseis();
  if (categoryRowsEl) categoryRowsEl.innerHTML = "";
  document.body.classList.remove("search-mode");
  document.body.classList.remove("channels-mode");
  toggleBrowseMode(true);
}

function getCategoriasSeriesFallback() {
  return (
    window.SlimFlixXtream?.getCategoriasFallback?.() || [
      { name: "Drama Premium", count: 1, categoryId: "10" },
      { name: "Documentários", count: 1, categoryId: "11" },
    ]
  );
}

/** Sempre desenha a barra lateral de pastas (mesmo com fallback). */
function renderizarPastasSeries(categorias) {
  const list =
    Array.isArray(categorias) && categorias.length ? categorias : getCategoriasSeriesFallback();

  xtreamSeriesCategories = list;
  categoriasPorAba.series = list.map(({ name, count, categoryId }) => ({
    name,
    count,
    categoryId,
  }));
  xtreamSeriesReady = true;

  if (sidebar) sidebar.hidden = false;
  document.body.classList.add("has-sidebar");
  renderSidebar("series");
}

/** Sempre desenha o grid de cards. */
function renderizarGridSeries(lista, options = {}) {
  const { allowFallback = true, searchTerm = "" } = options;
  const raw = Array.isArray(lista) ? lista : [];
  const list =
    raw.length > 0
      ? raw
      : searchTerm
        ? []
        : allowFallback
          ? window.SlimFlixXtream?.getListaFallback?.() || []
          : [];

  xtreamSeriesBrowseList = list;
  renderBrowseGrid(list, options);

  if (list[0]) {
    featuredEntry = null;
    updateHero(list[0], "series");
  } else if (searchTerm) {
    featuredEntry = null;
  }
}

/* ─── Sidebar pastas ─── */
function renderSidebar(tab) {
  if (!sidebar || !sidebarNav) return;

  const show = ABAS_COM_SIDEBAR.has(tab);
  sidebar.hidden = !show;
  document.body.classList.toggle("has-sidebar", show);

  if (!show) return;

  const cats = tab === "series" && isXtreamCatalogActive() ? xtreamSeriesCategories : categoriasPorAba[tab] || [];
  sidebarNav.innerHTML = "";

  const totalCount =
    tab === "series" && isXtreamCatalogActive()
      ? cats.reduce((sum, c) => sum + (c.count || 0), 0)
      : getListaBase(tab).length;

  const btnAll = document.createElement("button");
  btnAll.type = "button";
  btnAll.className = `sidebar__item${pastaAtiva === null ? " active" : ""}`;
  btnAll.dataset.category = "";
  btnAll.innerHTML = `<span class="folder-item__main"><span class="folder-item__icon folder-item__icon--folder">${PASTA_ICON_SVG.folder}</span><span class="folder-item__text">${tab === "series" ? "Todas as séries" : "Todas as pastas"}</span></span><span class="sidebar__count">${totalCount.toLocaleString("pt-BR")}</span>`;
  btnAll.addEventListener("click", () => selecionarPasta(null));
  sidebarNav.appendChild(btnAll);

  cats.forEach(({ name, count, categoryId }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `sidebar__item${pastaAtiva === name ? " active" : ""}`;
    btn.dataset.category = name;
    if (categoryId != null) btn.dataset.categoryId = categoryId;
    btn.innerHTML = `${buildPastaLabelHtml(name)}<span class="sidebar__count">${count.toLocaleString("pt-BR")}</span>`;
    btn.addEventListener("click", () => selecionarPasta(name));
    sidebarNav.appendChild(btn);
  });
}

async function carregarGridSeriesPasta(nome) {
  pastaAtiva = nome || null;
  ultimaPastaSeriesNome = pastaAtiva;

  renderizarPastasSeries(xtreamSeriesCategories);

  let categoryId = null;
  let categoryName = nome || "Todas as séries";

  if (nome) {
    const cat = xtreamSeriesCategories.find((c) => c.name === nome);
    categoryId = cat?.categoryId ?? null;
    categoryName = cat?.name || nome;
  }

  let lista = [];
  try {
    if (!window.SlimFlixXtream) {
      throw new Error("Módulo de séries indisponível.");
    }
    const precisaFetch = !SlimFlixXtream.temCacheListaCategoria?.(categoryId);
    if (precisaFetch) {
      setBrowseLoading("Carregando séries…");
    }
    const dados = await SlimFlixXtream.carregarListaSeriesPorCategoria(categoryId, categoryName);
    lista = dados.lista || [];
  } catch (err) {
    console.error("[SlimFlix] carregarGridSeriesPasta:", err);
    lista = SlimFlixXtream?.getListaFallback?.(categoryId, categoryName) || [];
  }

  renderizarGridSeries(lista, { titulo: categoryName, pasta: categoryName });
}

/**
 * Fluxo principal da aba Séries: busca dados (cache ou API) e renderiza UI em seguida.
 */
async function carregarSeries() {
  abaAtiva = "series";
  setAbaAtiva("series");
  limparLayoutSeries();

  let categorias = [];

  try {
    if (!window.SlimFlixXtream) {
      throw new Error("Módulo de séries indisponível.");
    }

    const precisaFetch = !SlimFlixXtream.temCacheCategoriasSeries?.();
    if (precisaFetch) {
      setSidebarLoading();
      setBrowseLoading("Carregando séries…");
    }

    const dados = await SlimFlixXtream.carregarDadosSeries();
    categorias = dados.categorias || [];
  } catch (err) {
    console.error("[SlimFlix] carregarSeries:", err);
    categorias = getCategoriasSeriesFallback();
  }

  renderizarPastasSeries(categorias);

  if (!pastaAtiva) {
    pastaAtiva = ultimaPastaSeriesNome || categorias[0]?.name || null;
  }

  if (pastaAtiva) {
    await carregarGridSeriesPasta(pastaAtiva);
  } else {
    renderizarGridSeries([], { titulo: "Séries", pasta: null });
  }
}

async function selecionarPastaSeriesXtream(nome) {
  if (termoBusca) {
    limparBusca();
    document.body.classList.remove("search-mode");
  }
  await carregarGridSeriesPasta(nome);
}

function selecionarPasta(nome) {
  pastaAtiva = nome || null;
  if (usesXtreamSeriesFlow()) {
    void selecionarPastaSeriesXtream(nome);
    return;
  }
  renderSidebar(abaAtiva);
  if (termoBusca) executarBusca();
  else renderizarPagina(abaAtiva);
}

async function initXtreamSeriesTab() {
  await carregarSeries();
}

function toggleBrowseMode(on) {
  document.body.classList.toggle("browse-mode", on);
  if (browsePanel) browsePanel.hidden = !on;
  if (!on) document.body.classList.remove("search-mode");
}

/* ─── Grade principal filtrada ─── */
function renderBrowseGrid(lista, options = {}) {
  if (!browseGrid || !browsePanel) return;

  const {
    pasta = null,
    searchTerm = "",
    titulo = null,
    limite = LIMITS.BROWSE_GRID,
  } = options;

  const total = lista.length;
  const slice = lista.slice(0, limite);

  if (browseTitle) {
    browseTitle.textContent =
      titulo || (searchTerm ? `Resultados da busca` : pasta || "Todas as pastas");
  }

  if (browseMeta) {
    if (searchTerm) {
      const ctx = labelContextoBusca(abaAtiva);
      browseMeta.textContent =
        total === 0
          ? `Buscando em ${ctx}`
          : total > limite
            ? `${total.toLocaleString("pt-BR")} resultados em ${ctx} · exibindo ${slice.length.toLocaleString("pt-BR")}`
            : `${total.toLocaleString("pt-BR")} resultado${total !== 1 ? "s" : ""} em ${ctx}`;
    } else {
      browseMeta.textContent =
        total > limite
          ? `Exibindo ${slice.length.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} títulos`
          : `${total.toLocaleString("pt-BR")} títulos nesta pasta`;
    }
  }

  browseGrid.innerHTML = "";

  if (!slice.length) {
    if (searchTerm) {
      browseGrid.innerHTML = `<p class="search-empty">Nenhum conteúdo encontrado para "<strong>${escapeHtml(searchTerm)}</strong>"</p>`;
    } else {
      browseGrid.innerHTML = '<p class="row__empty">Nenhum item nesta pasta.</p>';
    }
    return;
  }

  const frag = document.createDocumentFragment();
  slice.forEach((entry) => frag.appendChild(createCard(entry)));
  browseGrid.appendChild(frag);
}

function renderResultadosBusca(tab, termo) {
  let base = getListaParaBusca(tab);
  if (pastaAtiva) {
    base = base.filter((item) => (item.category || "Sem categoria") === pastaAtiva);
  }
  const resultados = filtrarPorBusca(base, termo);

  document.body.classList.add("search-mode");
  toggleBrowseMode(true);

  renderBrowseGrid(resultados, {
    searchTerm: termo,
    titulo: `Busca: "${termo}"`,
    limite: LIMITS.SEARCH_RESULTS,
  });

  updateHero(pickFeatured(resultados, tab) || pickFeatured(base, tab), tab);
}

/* ─── Carrosséis ─── */
function initCarousels(root = document) {
  root.querySelectorAll("[data-row]").forEach((row) => {
    const track = row.querySelector(".row__track");
    const leftBtn = row.querySelector(".row__arrow--left");
    const rightBtn = row.querySelector(".row__arrow--right");
    if (!track) return;
    const scrollAmount = () => track.clientWidth * 0.75;
    leftBtn?.replaceWith(leftBtn.cloneNode(true));
    rightBtn?.replaceWith(rightBtn.cloneNode(true));
    row.querySelector(".row__arrow--left")?.addEventListener("click", () => {
      track.scrollBy({ left: -scrollAmount(), behavior: "smooth" });
    });
    row.querySelector(".row__arrow--right")?.addEventListener("click", () => {
      track.scrollBy({ left: scrollAmount(), behavior: "smooth" });
    });
  });
}

function getWatchProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveWatchProgress(url, percent) {
  const data = getWatchProgress();
  data[url] = Math.min(100, Math.max(0, percent));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function typeLabel(entry) {
  if (entry.isSeriesGroup) return "Série";
  if (entry.type === "series") return "Série";
  if (entry.type === "movie") return "Filme";
  return "Canal";
}

function resolveSeriesStub(seriesId, entryMeta = null) {
  if (entryMeta?.xtreamSeriesId || entryMeta?.isXtreamSeriesStub) {
    return entryMeta;
  }
  const found = xtreamSeriesBrowseList.find(
    (e) => String(e.xtreamSeriesId) === String(seriesId)
  );
  if (found) return found;
  return {
    type: "series",
    isXtreamSeriesStub: true,
    isSeriesGroup: false,
    xtreamSeriesId: String(seriesId),
    name: "Série",
    logo: "",
    category: "Séries",
    episodeCount: 0,
  };
}

function showSeriesModalLoading(stub) {
  if (!seriesModal) return;
  activeSeries = null;
  if (seriesPoster) {
    seriesPoster.src = stub?.logo || PLACEHOLDER_POSTER;
    seriesPoster.alt = stub?.name || "Série";
  }
  if (seriesNameEl) seriesNameEl.textContent = stub?.name || "Carregando série…";
  if (seriesCategoryEl) seriesCategoryEl.textContent = stub?.category || "Séries";
  if (seriesEpCountEl) seriesEpCountEl.textContent = "Buscando temporadas e episódios…";
  if (seasonTabsEl) seasonTabsEl.innerHTML = "";
  if (episodeGridEl) {
    episodeGridEl.innerHTML =
      '<div class="catalog-loading catalog-loading--inline"><span class="catalog-loading__spinner" aria-hidden="true"></span><p>Carregando episódios…</p></div>';
  }
  seriesModal.hidden = false;
  seriesModal.setAttribute("aria-hidden", "false");
  seriesModal.setAttribute("aria-busy", "true");
  document.body.classList.add("modal-open");
}

/**
 * Abre o modal de temporadas/episódios (get_series_info via cache ou API).
 */
async function abrirModalSerie(seriesId, entryMeta = null) {
  const id = seriesId != null ? String(seriesId) : "";
  if (!id) return;

  if (!window.SlimFlixXtream?.carregarSeriesInfo) {
    console.error("[SlimFlix] SlimFlixXtream.carregarSeriesInfo indisponível.");
    return;
  }

  const stub = resolveSeriesStub(id, entryMeta);
  showSeriesModalLoading(stub);

  try {
    const show = await SlimFlixXtream.carregarSeriesInfo(stub);
    if (!show?.seasonList?.length) {
      if (episodeGridEl) {
        episodeGridEl.innerHTML =
          '<p class="row__empty">Nenhum episódio encontrado para esta série.</p>';
      }
      return;
    }
    featuredEntry = show;
    updateHero(show, "series");
    openSeriesDetail(show);
  } catch (err) {
    console.error("[SlimFlix] abrirModalSerie:", err);
    if (episodeGridEl) {
      episodeGridEl.innerHTML =
        '<p class="row__empty">Não foi possível carregar os episódios. Tente novamente.</p>';
    }
  } finally {
    seriesModal?.removeAttribute("aria-busy");
  }
}

async function openXtreamSeriesFromStub(entry, openModal = true) {
  if (!entry?.isXtreamSeriesStub && !entry?.xtreamSeriesId) return;
  const id = entry.xtreamSeriesId || entry.series_id;
  if (openModal) {
    await abrirModalSerie(id, entry);
    return;
  }

  if (!window.SlimFlixXtream) return;
  const show = await SlimFlixXtream.carregarSeriesInfo(entry);
  if (!show?.seasonList?.length) return;
  featuredEntry = show;
  updateHero(show, "series");
}

function handleCardClick(entry) {
  if (entry?.isXtreamSeriesStub || (entry?.type === "series" && entry?.xtreamSeriesId)) {
    void abrirModalSerie(entry.xtreamSeriesId, entry);
    return;
  }
  if (entry?.isSeriesGroup) {
    openSeriesDetail(entry);
    return;
  }
  playEntry(entry);
}

function createCard(entry, options = {}) {
  const { showProgress = false, progress = 0, badge } = options;
  const card = document.createElement("article");
  card.className = "card";
  if (entry.isSeriesGroup || entry.isXtreamSeriesStub) card.classList.add("card--series");
  if (showProgress) card.classList.add("card--progress");
  if (entry.url) card.dataset.url = entry.url;
  card.dataset.type = entry.type;
  if (entry.xtreamSeriesId) {
    card.dataset.seriesId = String(entry.xtreamSeriesId);
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `Abrir episódios: ${entry.name || "Série"}`);
  }

  const poster = document.createElement("div");
  poster.className = "card__poster";

  const img = document.createElement("img");
  img.src = entry.logo || PLACEHOLDER_POSTER;
  img.alt = entry.name;
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.onerror = () => {
    if (img.src !== PLACEHOLDER_POSTER) img.src = PLACEHOLDER_POSTER;
  };
  poster.appendChild(img);

  if (entry.isSeriesGroup && entry.episodeCount > 0) {
    const ep = document.createElement("span");
    ep.className = "card__episodes";
    ep.textContent = `${entry.episodeCount} eps`;
    poster.appendChild(ep);
  } else if (entry.isXtreamSeriesStub) {
    const ep = document.createElement("span");
    ep.className = "card__episodes";
    ep.textContent = "Série";
    poster.appendChild(ep);
  }

  if (badge) {
    const span = document.createElement("span");
    span.className = `card__badge${badge === "hot" ? " card__badge--hot" : ""}`;
    span.textContent = badge === "hot" ? "Popular" : badge;
    poster.appendChild(span);
  } else {
    const span = document.createElement("span");
    span.className = "card__badge";
    span.textContent = typeLabel(entry);
    poster.appendChild(span);
  }

  if (showProgress) {
    card.style.setProperty("--progress", `${progress}%`);
    const bar = document.createElement("div");
    bar.className = "card__bar";
    poster.appendChild(bar);
  }

  const title = document.createElement("h3");
  title.className = "card__title";
  title.textContent = entry.name;
  title.title = entry.name;

  card.appendChild(poster);
  card.appendChild(title);

  const onActivate = () => handleCardClick(entry);
  card.addEventListener("click", onActivate);
  if (entry.xtreamSeriesId || entry.isSeriesGroup) {
    card.style.cursor = "pointer";
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    });
  }

  return card;
}

function hashProgress(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h + url.charCodeAt(i) * (i + 1)) % 100;
  return 8 + (h % 40);
}

function findSeriesContinue(progress) {
  const out = [];
  for (const show of arraySeries) {
    let best = null;
    let bestP = 0;
    for (const s of show.seasonList) {
      for (const ep of show.seasons[s] || []) {
        const p = progress[ep.url] || 0;
        if (p > bestP) {
          bestP = p;
          best = { show, ep, progress: p };
        }
      }
    }
    if (best) out.push(best);
    if (out.length >= LIMITS.CONTINUE * 2) break;
  }
  out.sort((a, b) => b.progress - a.progress);
  return out.slice(0, LIMITS.CONTINUE);
}

/** Mantém destaque selecionado (banner hero removido — interação via cards). */
function updateHero(entry) {
  featuredEntry = entry || null;
}

function pickFeatured(lista, tab) {
  const tipo = tipoDaAba(tab);
  for (const e of lista) {
    if (tipo && e.type !== tipo) continue;
    if (e.logo) return e;
  }
  for (const e of lista) {
    if (tipo && e.type !== tipo) continue;
    return e;
  }
  return lista[0];
}

function buildFixedRows(lista, tab) {
  const progress = getWatchProgress();
  const trending = [];
  const recommended = [];

  for (const e of lista) {
    if (!pertenceAba(e, tab)) continue;
    if (trending.length < LIMITS.TRENDING) trending.push(e);
    if (recommended.length < LIMITS.RECOMMENDED * 2 && e.logo) recommended.push(e);
    if (trending.length >= LIMITS.TRENDING && recommended.length >= LIMITS.RECOMMENDED * 2) break;
  }

  let continueMapped = [];

  if (tab === "series") {
    const seriesCont = findSeriesContinue(progress);
    continueMapped = seriesCont.map(({ show, ep, progress: p }) => ({
      entry: show,
      progress: p,
      lastEp: ep,
    }));
  } else {
    const continueItems = [];
    if (Object.keys(progress).length > 0) {
      for (const e of lista) {
        if (!pertenceAba(e, tab)) continue;
        if (e.url && progress[e.url] > 0) continueItems.push(e);
        if (continueItems.length >= LIMITS.CONTINUE * 2) break;
      }
      continueItems.sort((a, b) => (progress[b.url] || 0) - (progress[a.url] || 0));
    }
    const fallback = [];
    if (continueItems.length < LIMITS.CONTINUE) {
      for (const e of lista) {
        if (!pertenceAba(e, tab) || e.isSeriesGroup) continue;
        if (tab === "home" && e.type === "channel") continue;
        fallback.push(e);
        if (fallback.length >= LIMITS.CONTINUE) break;
      }
    }
    const src = continueItems.length ? continueItems : fallback;
    continueMapped = src.slice(0, LIMITS.CONTINUE).map((e) => ({
      entry: e,
      progress: progress[e.url] || hashProgress(e.url || e.name),
    }));
  }

  return {
    trending,
    continue: continueMapped,
    recommended: recommended.slice(0, LIMITS.RECOMMENDED),
  };
}

function updateRowTitles(tab) {
  const labels = TAB_LABELS[tab] || TAB_LABELS.home;
  const setTitle = (sel, text) => {
    const el = document.querySelector(sel);
    if (el) el.innerHTML = `<span class="row__accent"></span>${escapeHtml(text)}`;
  };
  setTitle('[data-row-id="trending"] .row__title', labels.trending);
  setTitle('[data-row-id="continue"] .row__title', labels.continue);
  setTitle('[data-row-id="recommended"] .row__title', labels.recommended);
}

function limparCarrosseis() {
  document.querySelectorAll("[data-row-id] .row__track").forEach((t) => (t.innerHTML = ""));
  if (categoryRowsEl) categoryRowsEl.innerHTML = "";
}

function renderFixedRows(lista, tab) {
  const fixed = buildFixedRows(lista, tab);
  const trendingTrack = document.querySelector('[data-row-id="trending"] .row__track');
  const continueTrack = document.querySelector('[data-row-id="continue"] .row__track');
  const recommendedTrack = document.querySelector('[data-row-id="recommended"] .row__track');

  if (trendingTrack) {
    trendingTrack.innerHTML = "";
    if (!fixed.trending.length) {
      trendingTrack.innerHTML = `<p class="row__empty">Nenhum título nesta aba.</p>`;
    } else {
      fixed.trending.forEach((entry, i) => {
        const opts = {};
        if (i === 0) opts.badge = "hot";
        else if (i === 1) opts.badge = "Novo";
        trendingTrack.appendChild(createCard(entry, opts));
      });
    }
  }

  if (continueTrack) {
    continueTrack.innerHTML = "";
    if (!fixed.continue.length) {
      continueTrack.innerHTML = `<p class="row__empty">Nenhum progresso nesta aba.</p>`;
    } else {
      fixed.continue.forEach(({ entry, progress }) => {
        continueTrack.appendChild(createCard(entry, { showProgress: true, progress }));
      });
    }
  }

  if (recommendedTrack) {
    recommendedTrack.innerHTML = "";
    if (!fixed.recommended.length) {
      recommendedTrack.innerHTML = `<p class="row__empty">Nenhuma recomendação.</p>`;
    } else {
      fixed.recommended.forEach((entry) => {
        recommendedTrack.appendChild(createCard(entry));
      });
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** Remove emojis/símbolos coloridos do início dos nomes de pasta (ex.: ▶️, ⚽). */
function sanitizePastaName(rawName) {
  const name = String(rawName || "");
  const cleaned = name
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[▶️▶►⏵⚽🏈📺🎬⭐🔴🟢🔵]/g, "")
    .replace(/^[\s|\-_:·.]+/, "")
    .trim();
  return cleaned || name.trim();
}

function inferPastaIconType(rawName, cleanedName) {
  const blob = `${rawName} ${cleanedName}`.toLowerCase();
  if (/futebol|futbol|soccer|esporte|sport|⚽|🏈/.test(blob)) return "sport";
  if (/filme|movie|vod|cine|série|serie|play|▶|►/.test(blob)) return "play";
  if (/live|ao vivo|canal|tv|abertos|news|notíc/.test(blob)) return "live";
  return "folder";
}

const PASTA_ICON_SVG = {
  folder:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
  play:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  sport:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="10" opacity="0.35"/><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 2v7l5 3-1.5 2.6L9 13V4z"/></svg>',
  live:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2H8v2h8v-2h-2v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>',
};

function buildPastaLabelHtml(rawName) {
  const cleaned = sanitizePastaName(rawName);
  const iconType = inferPastaIconType(rawName, cleaned);
  const icon = PASTA_ICON_SVG[iconType] || PASTA_ICON_SVG.folder;
  return `<span class="folder-item__main"><span class="folder-item__icon folder-item__icon--${iconType}">${icon}</span><span class="folder-item__text">${escapeHtml(cleaned)}</span></span>`;
}

function createCategoryRow(categoryName, items) {
  if (!items.length) return null;
  const section = document.createElement("section");
  section.className = "row";
  section.dataset.row = "";
  section.innerHTML = `
    <h2 class="row__title"><span class="row__accent"></span>${escapeHtml(categoryName)}</h2>
    <div class="row__slider">
      <button class="row__arrow row__arrow--left" aria-label="Rolar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>
      <div class="row__track"></div>
      <button class="row__arrow row__arrow--right" aria-label="Rolar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></button>
    </div>`;
  const track = section.querySelector(".row__track");
  const frag = document.createDocumentFragment();
  items.forEach((e) => frag.appendChild(createCard(e)));
  track.appendChild(frag);
  return section;
}

function renderCategoryRows(lista, generation) {
  if (!categoryRowsEl) return;
  categoryRowsEl.innerHTML = "";
  const categories = M3UParser.getTopCategories(lista, LIMITS.CATEGORY_ROWS, LIMITS.CATEGORY_ITEMS);
  if (generation !== renderGeneration) return;
  const frag = document.createDocumentFragment();
  let n = 0;
  for (const [name, items] of categories) {
    const row = createCategoryRow(name, items);
    if (row) {
      frag.appendChild(row);
      n++;
    }
  }
  if (generation !== renderGeneration) return;
  if (!n) {
    categoryRowsEl.innerHTML = '<p class="row__empty row__empty--wide">Nenhuma categoria extra.</p>';
  } else {
    categoryRowsEl.appendChild(frag);
  }
}

/* ─── Aba Canais (layout 3 colunas) ─── */
function getPastasCanais() {
  return categoriasPorAba.channels || [];
}

function getCanaisMapaPorPasta() {
  const map = new Map();
  for (const canal of arrayCanais) {
    const key = canal.category || "Sem categoria";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(canal);
  }
  for (const list of map.values()) {
    M3UParser.sortChannelsByName(list);
  }
  return map;
}

function toggleChannelsMode(on) {
  document.body.classList.toggle("channels-mode", on);
  if (channelsView) channelsView.hidden = !on;
}

function hideChannelsView() {
  toggleChannelsMode(false);
  teardownChannelPlayer();
  canalAtivo = null;
}

function selecionarPastaCanal(nome) {
  pastaCanalAtiva = nome;
  if (!termoBusca) canalAtivo = null;
  renderChannelsFolders();
  renderChannelsList();
}

function renderChannelsFolders() {
  if (!channelsFoldersEl) return;

  const pastas = getPastasCanais();
  channelsFoldersEl.innerHTML = "";

  if (!arrayCanais.length) {
    channelsFoldersEl.innerHTML =
      '<p class="channels-col__empty">Importe um arquivo M3U para ver as pastas de canais.</p>';
    pastaCanalAtiva = null;
    return;
  }

  if (!termoBusca && pastaCanalAtiva === null && pastas.length) {
    pastaCanalAtiva = pastas[0].name;
  }

  if (!termoBusca && pastaCanalAtiva && !pastas.some((p) => p.name === pastaCanalAtiva)) {
    pastaCanalAtiva = pastas[0]?.name ?? null;
  }

  const frag = document.createDocumentFragment();
  pastas.forEach(({ name, count }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `channels-folder${pastaCanalAtiva === name ? " active" : ""}`;
    btn.innerHTML = `
      ${buildPastaLabelHtml(name)}
      <span class="channels-folder__count">${count.toLocaleString("pt-BR")}</span>`;
    btn.addEventListener("click", () => {
      if (termoBusca) limparBusca();
      selecionarPastaCanal(name);
    });
    frag.appendChild(btn);
  });
  channelsFoldersEl.appendChild(frag);
}

function renderChannelsList() {
  if (!channelsListEl) return;

  channelsListEl.innerHTML = "";

  if (!arrayCanais.length) {
    channelsListEl.innerHTML = '<p class="channels-col__empty">Nenhum canal disponível.</p>';
    if (channelsListHeading) channelsListHeading.textContent = "Canais";
    return;
  }

  let lista = [];
  if (termoBusca) {
    lista = M3UParser.sortChannelsByName(filtrarPorBusca(arrayCanais, termoBusca));
    if (channelsListHeading) {
      channelsListHeading.textContent = `Busca: "${termoBusca}"`;
    }
  } else {
    if (!pastaCanalAtiva) {
      channelsListEl.innerHTML =
        '<p class="channels-col__empty">Selecione uma pasta à esquerda.</p>';
      if (channelsListHeading) channelsListHeading.textContent = "Canais";
      return;
    }
    lista = getCanaisMapaPorPasta().get(pastaCanalAtiva) || [];
    if (channelsListHeading) channelsListHeading.textContent = sanitizePastaName(pastaCanalAtiva);
  }

  if (!lista.length) {
    channelsListEl.innerHTML = '<p class="channels-col__empty">Nenhum canal encontrado.</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  lista.forEach((canal, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `channels-channel${canalAtivo?.url === canal.url ? " active" : ""}`;
    btn.dataset.url = canal.url || "";
    const logoPart = canal.logo
      ? `<img class="channels-channel__logo" src="${escapeHtml(canal.logo)}" alt="" loading="lazy" />`
      : `<span class="channels-channel__logo channels-channel__logo--empty" aria-hidden="true">TV</span>`;
    btn.innerHTML = `
      <span class="channels-channel__num">${index + 1}</span>
      ${logoPart}
      <span class="channels-channel__name">${escapeHtml(canal.name || canal.label || "Canal")}</span>`;
    const img = btn.querySelector("img");
    if (img) {
      img.onerror = () => {
        img.outerHTML =
          '<span class="channels-channel__logo channels-channel__logo--empty" aria-hidden="true">TV</span>';
      };
    }
    btn.addEventListener("click", () => playChannelInline(canal));
    frag.appendChild(btn);
  });
  channelsListEl.appendChild(frag);
}

function renderChannelsView() {
  toggleChannelsMode(true);
  toggleBrowseMode(false);
  document.body.classList.remove("search-mode");
  renderChannelsFolders();
  renderChannelsList();
  if (!canalAtivo && channelsNowTitle) {
    channelsNowTitle.textContent = "Selecione um canal";
  }
}

/**
 * Renderiza a página da aba ativa — sidebar, grade ou carrosséis.
 */
function renderizarPagina(tab) {
  abaAtiva = tab;
  setAbaAtiva(tab);

  if (tab === "series" && isXtreamCatalogActive()) {
    if (termoBusca) {
      void aplicarBuscaSeriesXtream();
    } else {
      void carregarSeries();
    }
    return;
  }

  renderSidebar(tab);

  if (tab === "channels") {
    if (termoBusca) {
      renderChannelsView();
      return;
    }
    renderChannelsView();
    return;
  }

  hideChannelsView();

  const lista = getListaFiltrada(tab, pastaAtiva);
  const generation = ++renderGeneration;
  const usaSidebar = ABAS_COM_SIDEBAR.has(tab);

  if (termoBusca) {
    renderResultadosBusca(tab, termoBusca);
    return;
  }

  document.body.classList.remove("search-mode");
  const modoGrade = usaSidebar && pastaAtiva !== null;

  toggleBrowseMode(modoGrade);

  if (modoGrade) {
    renderBrowseGrid(lista, { pasta: pastaAtiva });
    updateHero(pickFeatured(lista, tab), tab);
    return;
  }

  limparCarrosseis();
  updateRowTitles(tab);
  renderFixedRows(lista, tab);
  updateHero(pickFeatured(lista, tab), tab);

  if (categoryRowsEl && !pastaAtiva) {
    categoryRowsEl.innerHTML = '<p class="row__empty row__empty--wide">Montando categorias…</p>';
    requestAnimationFrame(() => {
      renderCategoryRows(lista, generation);
      initCarousels(contentEl);
    });
  } else {
    initCarousels(contentEl);
  }
}

function initTabs() {
  mainNav?.querySelectorAll(".nav-tab").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const tab = link.dataset.tab;
      if (!tab || tab === abaAtiva) return;
      pastaAtiva = null;
      limparBusca();
      if (tab === "channels") {
        const pastas = getPastasCanais();
        pastaCanalAtiva = pastas[0]?.name ?? null;
        canalAtivo = null;
      } else {
        pastaCanalAtiva = null;
        canalAtivo = null;
      }
      setAbaAtiva(tab);
      renderizarPagina(tab);
    });
  });

  document.querySelector(".logo")?.addEventListener("click", (e) => {
    e.preventDefault();
    pastaAtiva = null;
    pastaCanalAtiva = null;
    canalAtivo = null;
    limparBusca();
    setAbaAtiva("home");
    renderizarPagina("home");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function setLoadStatus(message, type = "") {
  if (!loadStatus) return;
  loadStatus.textContent = message;
  loadStatus.className = `load-status${type ? ` load-status--${type}` : ""}`;
}

/**
 * Motor único de catálogo — usado por M3U local e Xtream API.
 * Preenche arrays globais e chama renderizarPagina (carrosséis + hero).
 */
function resetXtreamSeriesState() {
  xtreamSeriesReady = false;
  xtreamSeriesCategories = [];
  xtreamSeriesBrowseList = [];
  ultimaPastaSeriesNome = null;
  SlimFlixXtream?.clearSeriesCache?.();
}

function aplicarCatalogoSplit(split, options = {}) {
  const { source = "catalog" } = options;

  arrayCanais = split.channels;
  arrayFilmes = split.movies;
  arraySeries = split.series;
  categoriasPorAba = split.categories;
  pastaAtiva = null;
  pastaCanalAtiva = null;
  canalAtivo = null;
  limparBusca();
  abaAtiva = "home";
  setAbaAtiva("home");
  renderizarPagina("home");

  console.info(`[SlimFlix] Catálogo aplicado (${source}):`, {
    canais: arrayCanais.length,
    filmes: arrayFilmes.length,
    series: arraySeries.length,
    epsBrutos: split.seriesRawCount,
  });
}

function aplicarCatalogoFromEntries(entries, options = {}) {
  if (!window.SlimFlixAuth?.hasActiveSession?.()) {
    console.warn("[SlimFlix] Catálogo bloqueado — usuário não autenticado.");
    return false;
  }
  if (!entries?.length) {
    console.warn("[SlimFlix] Nenhuma entrada para aplicar ao catálogo.");
    return false;
  }

  const seriesGroups = entries.filter((e) => e.isSeriesGroup);
  const flatEntries = entries.filter((e) => !e.isSeriesGroup);
  const split = M3UParser.splitCatalog(flatEntries);

  if (seriesGroups.length) {
    split.series = [...split.series, ...seriesGroups];
  }

  aplicarCatalogoSplit(split, options);
  return true;
}

async function handleM3UFile(file) {
  if (!window.SlimFlixAuth?.hasActiveSession?.()) {
    setLoadStatus("Faça login para importar playlists.", "error");
    return;
  }
  if (!file) return;
  setLoadStatus("Lendo playlist…", "loading");
  try {
    const text = await file.text();
    setLoadStatus("Classificando e agrupando séries…", "loading");
    await new Promise((r) => setTimeout(r, 0));
    const entries = M3UParser.parseM3U(text);
    if (!entries.length) {
      setLoadStatus("Arquivo vazio ou inválido.", "error");
      return;
    }
    aplicarCatalogoFromEntries(entries, { source: "m3u" });

    setLoadStatus(
      `${entries.length.toLocaleString("pt-BR")} linhas importadas`,
      "success"
    );
  } catch (err) {
    console.error(err);
    setLoadStatus("Erro ao processar o M3U.", "error");
  }
}

const SlimFlixCatalogExport = {
  aplicarCatalogoFromEntries,
  aplicarCatalogoSplit,
  handleM3UFile,
};

if (typeof window !== "undefined") {
  window.SlimFlixCatalog = SlimFlixCatalogExport;
  window.SlimFlixSeriesUI = {
    resetXtreamSeriesState,
    carregarSeries,
    renderizarPastasSeries,
    renderizarGridSeries,
    abrirModalSerie,
    aplicarBuscaSeriesXtream,
    initXtreamSeriesTab,
  };
}

channelsFullscreenBtn?.addEventListener("click", async () => {
  const target = channelsPlayerScreen || document.getElementById("channels-video");
  if (!target) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await target.requestFullscreen();
  } catch (err) {
    console.warn("[Slimflix] Tela cheia indisponível:", err);
  }
});

function bootPlayerUi() {
  initTabs();
  initSearch();
  initCarousels();
}

window.SlimFlixBootPlayerUi = bootPlayerUi;
window.addEventListener("slimflix:auth-ready", () => bootPlayerUi(), { once: true });
