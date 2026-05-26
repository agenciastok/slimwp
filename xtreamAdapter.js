/**
 * SlimFlix — adaptador Xtream Codes API (JSON) → formato M3U interno
 */
(function (global) {
  function asArray(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === "object") return Object.values(data);
    return [];
  }

  function buildCategoryMap(categories) {
    const map = new Map();
    for (const cat of asArray(categories)) {
      if (cat?.category_id != null) {
        map.set(String(cat.category_id), cat.category_name || "Sem categoria");
      }
    }
    return map;
  }

  function resolveCategoryName(categoryId, categoryMap, fallbackPrefix) {
    if (categoryId == null || categoryId === "") return fallbackPrefix || "Sem categoria";
    return categoryMap.get(String(categoryId)) || fallbackPrefix || "Sem categoria";
  }

  function buildLiveStreamUrl(server, username, password, streamId) {
    return `${server}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.ts`;
  }

  function buildVodStreamUrl(server, username, password, streamId, extension) {
    const ext = (extension || "mp4").replace(/^\./, "");
    return `${server}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`;
  }

  function mapLiveStream(stream, categoryMap, session) {
    const category = resolveCategoryName(stream.category_id, categoryMap, "Canais");
    return {
      name: stream.name || "Canal",
      logo: stream.stream_icon || "",
      category,
      type: "channel",
      url: buildLiveStreamUrl(session.server, session.username, session.password, stream.stream_id),
      duration: "",
      xtreamStreamId: stream.stream_id,
      xtreamType: "live",
    };
  }

  function mapVodStream(stream, categoryMap, session) {
    const category = resolveCategoryName(stream.category_id, categoryMap, "Filmes");
    return {
      name: stream.name || "Filme",
      logo: stream.stream_icon || "",
      category,
      type: "movie",
      url: buildVodStreamUrl(
        session.server,
        session.username,
        session.password,
        stream.stream_id,
        stream.container_extension
      ),
      duration: stream.duration || "",
      xtreamStreamId: stream.stream_id,
      xtreamType: "vod",
    };
  }

  /** Série como card agrupado (episódios podem ser carregados depois via series_id). */
  function mapSeriesShow(series, categoryMap) {
    const category = resolveCategoryName(series.category_id, categoryMap, "Séries");
    const logo = series.cover || series.stream_icon || "";
    return {
      type: "series",
      isSeriesGroup: true,
      name: series.name || "Série",
      logo,
      category,
      seasons: {},
      seasonList: [],
      episodeCount: Number(series.episode_run_time) > 0 ? series.episode_run_time : 0,
      xtreamSeriesId: series.series_id,
    };
  }

  /**
   * Converte respostas JSON da Xtream em entradas compatíveis com M3UParser.splitCatalog.
   */
  function adaptXtreamToM3UEntries({
    liveStreams = [],
    vodStreams = [],
    seriesList = [],
    liveCategories = [],
    vodCategories = [],
    seriesCategories = [],
    session,
  }) {
    const liveMap = buildCategoryMap(liveCategories);
    const vodMap = buildCategoryMap(vodCategories);
    const seriesMap = buildCategoryMap(seriesCategories);

    const entries = [];

    for (const stream of asArray(liveStreams)) {
      if (stream?.stream_id == null) continue;
      entries.push(mapLiveStream(stream, liveMap, session));
    }

    for (const stream of asArray(vodStreams)) {
      if (stream?.stream_id == null) continue;
      entries.push(mapVodStream(stream, vodMap, session));
    }

    for (const show of asArray(seriesList)) {
      if (!show?.series_id) continue;
      const group = mapSeriesShow(show, seriesMap);
      if (group.episodeCount > 0 || group.logo) entries.push(group);
    }

    return entries;
  }

  /** Catálogo fictício para desenvolvimento quando a API falha. */
  function getMockCatalogEntries(session) {
    const server = session?.server || "http://demo.local:8080";
    const user = session?.username || "demo";
    const pass = session?.password || "demo";

    const liveCategories = [
      { category_id: "1", category_name: "Canais Abertos" },
      { category_id: "2", category_name: "Esportes" },
    ];
    const vodCategories = [
      { category_id: "3", category_name: "Ação Premium" },
      { category_id: "4", category_name: "Ficção Científica" },
    ];

    const liveStreams = [
      { stream_id: 1001, name: "TV Globo FHD", category_id: "1", stream_icon: "" },
      { stream_id: 1002, name: "SporTV 1 HD", category_id: "2", stream_icon: "" },
      { stream_id: 1003, name: "Band News HD", category_id: "1", stream_icon: "" },
    ];
    const vodStreams = [
      {
        stream_id: 2001,
        name: "Filme Demo — Ação Total",
        category_id: "3",
        stream_icon: "",
        container_extension: "mp4",
      },
      {
        stream_id: 2002,
        name: "Filme Demo — Espaço Profundo",
        category_id: "4",
        stream_icon: "",
        container_extension: "mp4",
      },
      {
        stream_id: 2003,
        name: "Filme Demo — Comédia Mix",
        category_id: "3",
        stream_icon: "",
        container_extension: "mp4",
      },
    ];

    const seriesList = [
      {
        series_id: 3001,
        name: "Série Demo — Linha do Tempo",
        category_id: "4",
        cover: "",
        episode_run_time: 8,
      },
    ];

    return adaptXtreamToM3UEntries({
      liveStreams,
      vodStreams,
      seriesList,
      liveCategories,
      vodCategories,
      seriesCategories: [],
      session: { server, username: user, password: pass },
    });
  }

  global.XtreamAdapter = {
    asArray,
    buildCategoryMap,
    adaptXtreamToM3UEntries,
    getMockCatalogEntries,
    mapLiveStream,
    mapVodStream,
  };
})(typeof window !== "undefined" ? window : globalThis);
