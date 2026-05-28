/**

 * SlimFlix — séries via Xtream API (categorias, lista, episódios)

 * Cache guarda apenas JSON bruto da API; o DOM é montado em script.js.

 */

(function (global) {

  /** JSON bruto da API — não usar como estado de UI. */

  let cacheCategoriasSeriesRaw = null;

  let cacheSeriesListFullRaw = null;

  const cacheSeriesListaRawPorCategoria = {};

  const cacheSeriesInfoRaw = {};



  const MOCK_SERIES_CATEGORIES = [

    { category_id: "10", category_name: "Drama Premium" },

    { category_id: "11", category_name: "Documentários" },

  ];



  const MOCK_SERIES_LIST = [

    {

      series_id: 501,

      name: "Gangland Undercover",

      category_id: "10",

      cover: "",

      plot: "Série de teste para validar temporadas e episódios.",

    },

    {

      series_id: 502,

      name: "Linha do Tempo — Demo",

      category_id: "11",

      cover: "",

    },

  ];



  function asArray(data) {

    if (!data) return [];

    if (Array.isArray(data)) return data;

    if (typeof data === "object") return Object.values(data);

    return [];

  }



  function getSession() {

    return global.SlimFlixAuth?.getStoredSession?.() || {

      server: "",

      username: "",

      password: "",

    };

  }



  function assertAuthenticated() {

    if (!global.SlimFlixAuth?.hasActiveSession?.()) {

      throw new Error("Acesso negado. Faça login para continuar.");

    }

  }



  function buildSeriesEpisodeUrl(session, episodeId, extension) {

    const ext = (extension || "mp4").replace(/^\./, "");

    const base = (global.SlimFlixAuth?.normalizeServerUrl?.(session.server) || "/api")
      .replace(/^\/api\//, "");

    const httpUrl = `http://${base}/series/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${episodeId}.${ext}`;

    const rewrite = global.SlimFlixApiProxyShim?.toProxyUrl || global.SlimFlixAuth?.httpUrlToApiProxy;

    return rewrite ? rewrite(httpUrl) : httpUrl;

  }



  function mapSeriesStub(series, categoryName) {

    return {

      type: "series",

      isSeriesGroup: false,

      isXtreamSeriesStub: true,

      xtreamSeriesId: String(series.series_id),

      name: series.name || "Série",

      logo: series.cover || series.stream_icon || "",

      category: categoryName || "Séries",

      episodeCount: 0,

      plot: series.plot || "",

    };

  }



  function adaptSeriesInfoToShow(data, session, fallbackMeta = {}) {

    const info = data?.info && typeof data.info === "object" ? data.info : data;

    const episodes = data?.episodes && typeof data.episodes === "object" ? data.episodes : {};



    let seasonNums = asArray(data?.seasons).map((n) => Number(n)).filter((n) => !Number.isNaN(n));

    if (!seasonNums.length) {

      seasonNums = Object.keys(episodes)

        .map((k) => Number(k))

        .filter((n) => !Number.isNaN(n));

    }

    seasonNums.sort((a, b) => a - b);



    const show = {

      type: "series",

      isSeriesGroup: true,

      isXtreamSeriesStub: false,

      xtreamSeriesId: String(fallbackMeta.xtreamSeriesId || info?.series_id || ""),

      name: info?.name || fallbackMeta.name || "Série",

      logo: info?.cover || info?.stream_icon || fallbackMeta.logo || "",

      category: fallbackMeta.category || "Séries",

      seasons: {},

      seasonList: [],

      episodeCount: 0,

    };



    for (const seasonNum of seasonNums) {

      const rawEps = episodes[seasonNum] ?? episodes[String(seasonNum)];

      const eps = asArray(rawEps);

      if (!eps.length) continue;



      show.seasons[seasonNum] = [];

      eps.forEach((ep, idx) => {

        const episodeId = ep.id ?? ep.stream_id ?? ep.episode_id;

        if (episodeId == null) return;



        const episodeNum = Number(ep.episode_num) || idx + 1;

        const title = ep.title || ep.name || `Episódio ${episodeNum}`;



        show.seasons[seasonNum].push({

          season: seasonNum,

          episode: episodeNum,

          name: title,

          label: title,

          logo: show.logo,

          url: buildSeriesEpisodeUrl(session, episodeId, ep.container_extension),

          xtreamEpisodeId: String(episodeId),

        });

        show.episodeCount += 1;

      });



      show.seasons[seasonNum].sort((a, b) => a.episode - b.episode);

    }



    show.seasonList = Object.keys(show.seasons)

      .map(Number)

      .sort((a, b) => a - b);



    return show;

  }



  function getMockSeriesInfo(stub) {

    const session = getSession();

    return adaptSeriesInfoToShow(

      {

        info: {

          name: stub?.name || "Gangland Undercover",

          cover: stub?.logo || "",

          series_id: stub?.xtreamSeriesId || "501",

        },

        seasons: [1],

        episodes: {

          1: [

            {

              id: 9001,

              episode_num: 1,

              title: "Episódio 1 — Entrada",

              container_extension: "mp4",

            },

            {

              id: 9002,

              episode_num: 2,

              title: "Episódio 2 — Tensão",

              container_extension: "mp4",

            },

            {

              id: 9003,

              episode_num: 3,

              title: "Episódio 3 — Confronto",

              container_extension: "mp4",

            },

          ],

        },

      },

      session,

      stub

    );

  }



  function buildCategoryIndex(categories, allSeries) {

    const countMap = new Map();

    for (const s of asArray(allSeries)) {

      const id = String(s.category_id ?? "");

      countMap.set(id, (countMap.get(id) || 0) + 1);

    }



    return asArray(categories).map((cat) => ({

      name: cat.category_name || "Sem categoria",

      categoryId: String(cat.category_id),

      count: countMap.get(String(cat.category_id)) || 0,

    }));

  }



  function montarListaSeriesStub(rawList, categoryName, categoryId) {

    return asArray(rawList).map((s) =>

      mapSeriesStub(

        s,

        categoryName ||

          MOCK_SERIES_CATEGORIES.find((c) => String(c.category_id) === String(s.category_id))

            ?.category_name ||

          "Séries"

      )

    );

  }



  function getCategoriasFallback() {

    return buildCategoryIndex(MOCK_SERIES_CATEGORIES, MOCK_SERIES_LIST);

  }



  function getListaFallback(categoryId, categoryName) {

    const filtered = MOCK_SERIES_LIST.filter(

      (s) => !categoryId || String(s.category_id) === String(categoryId)

    );

    const raw = filtered.length ? filtered : MOCK_SERIES_LIST;

    return montarListaSeriesStub(raw, categoryName || "Drama Premium", categoryId);

  }



  function clearSeriesCache() {

    cacheCategoriasSeriesRaw = null;

    cacheSeriesListFullRaw = null;

    Object.keys(cacheSeriesListaRawPorCategoria).forEach((k) => {

      delete cacheSeriesListaRawPorCategoria[k];

    });

    Object.keys(cacheSeriesInfoRaw).forEach((k) => {

      delete cacheSeriesInfoRaw[k];

    });

  }



  function cacheKeyCategoria(categoryId) {

    return categoryId != null && categoryId !== "" ? String(categoryId) : "__all__";

  }



  function temCacheCategoriasSeries() {

    return cacheCategoriasSeriesRaw != null;

  }



  function temCacheListaCategoria(categoryId) {

    return cacheSeriesListaRawPorCategoria[cacheKeyCategoria(categoryId)] != null;

  }



  async function fetchCategoriasSeriesRaw() {

    if (cacheCategoriasSeriesRaw != null) {

      return cacheCategoriasSeriesRaw;

    }

    try {

      cacheCategoriasSeriesRaw = await global.SlimFlixAuth.xtreamFetch("get_series_categories");

      return cacheCategoriasSeriesRaw;

    } catch (err) {

      console.error("[SlimFlix Séries] Falha categorias:", err);

      global.SlimFlixAuth?.showPlayerApiAlert?.(

        `${global.SlimFlixAuth.formatFetchError?.(err) || err.message} Usando categorias de séries de teste.`

      );

      cacheCategoriasSeriesRaw = [...MOCK_SERIES_CATEGORIES];

      return cacheCategoriasSeriesRaw;

    }

  }



  async function fetchSeriesListFullRaw() {

    if (cacheSeriesListFullRaw != null) {

      return cacheSeriesListFullRaw;

    }

    try {

      cacheSeriesListFullRaw = await global.SlimFlixAuth.xtreamFetch("get_series");

    } catch (e) {

      console.warn("[SlimFlix Séries] get_series para contagem:", e);

      cacheSeriesListFullRaw = [...MOCK_SERIES_LIST];

    }

    return cacheSeriesListFullRaw;

  }



  async function fetchSeriesListByCategoryRaw(categoryId) {

    const key = cacheKeyCategoria(categoryId);

    if (cacheSeriesListaRawPorCategoria[key] != null) {

      return cacheSeriesListaRawPorCategoria[key];

    }

    try {

      let raw;

      if (categoryId != null && categoryId !== "") {

        raw = await global.SlimFlixAuth.xtreamFetch("get_series", {

          category_id: String(categoryId),

        });

      } else {

        raw = await fetchSeriesListFullRaw();

      }

      cacheSeriesListaRawPorCategoria[key] = raw;

      return raw;

    } catch (err) {

      console.error("[SlimFlix Séries] Falha lista:", err);

      const filtered = MOCK_SERIES_LIST.filter(

        (s) => !categoryId || String(s.category_id) === String(categoryId)

      );

      const fallbackRaw = filtered.length ? filtered : MOCK_SERIES_LIST;

      cacheSeriesListaRawPorCategoria[key] = fallbackRaw;

      return fallbackRaw;

    }

  }



  /**

   * Obtém categorias (cache ou API) e devolve índice pronto para a UI.

   * Não altera o DOM — script.js chama renderizarPastasSeries depois.

   */

  async function carregarDadosSeries() {

    assertAuthenticated();

    const categoriesRaw = await fetchCategoriasSeriesRaw();

    const allSeriesRaw = await fetchSeriesListFullRaw();

    let categorias = buildCategoryIndex(categoriesRaw, allSeriesRaw);

    if (!categorias.length) {

      categorias = getCategoriasFallback();

    }

    console.log("[SlimFlix Séries] Categorias para UI:", categorias.length);

    return { categorias, categoriesRaw, allSeriesRaw };

  }



  /**

   * Obtém lista de uma pasta (cache ou API) e devolve stubs para cards.

   */

  async function carregarListaSeriesPorCategoria(categoryId, categoryName) {

    assertAuthenticated();

    const raw = await fetchSeriesListByCategoryRaw(categoryId);

    let lista = montarListaSeriesStub(raw, categoryName, categoryId);

    if (!lista.length) {

      lista = getListaFallback(categoryId, categoryName);

    }

    console.log("[SlimFlix Séries] Lista UI categoria", categoryId, lista.length);

    return { lista, raw };

  }



  async function carregarSeriesInfo(stub) {

    const infoKey = String(stub?.xtreamSeriesId || "");

    const session = getSession();



    try {

      if (!infoKey) throw new Error("ID da série ausente.");



      let raw = cacheSeriesInfoRaw[infoKey];

      if (!raw) {

        raw = await global.SlimFlixAuth.xtreamFetch("get_series_info", {

          series_id: infoKey,

        });

        cacheSeriesInfoRaw[infoKey] = raw;

      }



      const show = adaptSeriesInfoToShow(raw, session, stub);

      if (!show.seasonList.length) {

        throw new Error("Nenhuma temporada/episódio na resposta.");

      }

      console.log("[SlimFlix Séries] Detalhes:", show.name, show.episodeCount, "eps");

      return show;

    } catch (err) {

      console.error("[SlimFlix Séries] Falha get_series_info:", err);

      global.SlimFlixAuth?.showPlayerApiAlert?.(

        `Detalhes da série indisponíveis (${err.message}). Exibindo episódios de demonstração.`

      );

      return getMockSeriesInfo(stub);

    }

  }



  /** Compatibilidade com chamadas antigas. */

  async function buscarCategoriasSeries() {

    const { categorias } = await carregarDadosSeries();

    return categorias;

  }



  async function buscarSeriesPorCategoria(categoryId, categoryName) {

    const { lista } = await carregarListaSeriesPorCategoria(categoryId, categoryName);

    return lista;

  }



  function categoryNameForSeriesRaw(item) {

    return (

      MOCK_SERIES_CATEGORIES.find((c) => String(c.category_id) === String(item.category_id))

        ?.category_name || "Séries"

    );

  }



  /**

   * Catálogo completo de séries a partir do cache bruto (para busca global).

   */

  function obterCatalogoSeriesParaBusca() {

    const seen = new Set();

    const out = [];



    const pushRaw = (raw) => {

      for (const item of asArray(raw)) {

        const id = String(item.series_id ?? item.id ?? "");

        if (!id || seen.has(id)) continue;

        seen.add(id);

        out.push(mapSeriesStub(item, categoryNameForSeriesRaw(item)));

      }

    };



    if (cacheSeriesListFullRaw != null) {

      pushRaw(cacheSeriesListFullRaw);

      if (out.length) return out;

    }



    for (const raw of Object.values(cacheSeriesListaRawPorCategoria)) {

      pushRaw(raw);

    }



    if (!out.length) {

      return montarListaSeriesStub(MOCK_SERIES_LIST, "Séries");

    }



    return out;

  }



  global.SlimFlixXtream = {

    carregarDadosSeries,

    carregarListaSeriesPorCategoria,

    carregarSeriesInfo,

    buscarCategoriasSeries,

    buscarSeriesPorCategoria,

    clearSeriesCache,

    temCacheCategoriasSeries,

    temCacheListaCategoria,

    getCategoriasFallback,

    getListaFallback,

    obterCatalogoSeriesParaBusca,

    adaptSeriesInfoToShow,

    mapSeriesStub,

    getMockSeriesInfo,

    MOCK_SERIES_CATEGORIES,

    MOCK_SERIES_LIST,

  };

})(typeof window !== "undefined" ? window : globalThis);


