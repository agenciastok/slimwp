/**
 * Parser M3U — classificação rigorosa em Canais | Filmes | Séries
 */
(function (global) {
  const ATTR_RE = /([a-zA-Z0-9-]+)="([^"]*)"/g;

  function normalizeText(value) {
    return (value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
  }

  /** Prioridade: group-title de canais ao vivo */
  function isChannelByGroup(category) {
    const g = normalizeText(category);
    if (!g) return false;
    return (
      /(?:^|[\s♠■●★◆▪])CANAIS?\b/.test(g) ||
      /\bCANAIS?\s*(?:⚽|📺|HD|4K|FHD|UHD)?\b/.test(g) ||
      /(?:^|[\s♠■●★◆▪])ESPORTES?\b/.test(g) ||
      /\bSPORTS?\b/.test(g) ||
      /\bTV\s*AO\s*VIVO\b/.test(g) ||
      /\bAO\s*VIVO\b/.test(g) ||
      /\bLIVE\s*TV\b/.test(g) ||
      /\bCHANNELS?\b/.test(g) ||
      /\bTV\s*ABERTA\b/.test(g) ||
      /\bPPV\b/.test(g) ||
      /\b24\s*HORAS\b/.test(g) ||
      /\/CANAIS\//.test(g)
    );
  }

  function isChannelByUrl(url) {
    const lower = (url || "").toLowerCase().trim();
    if (!lower) return false;
    if (/\.ts(?:\?|$)/i.test(lower)) return true;
    if (/\/live\//.test(lower) || /\/live\./.test(lower)) return true;
    if (/\/canais\//.test(lower)) return true;
    if (/get\.php\?/.test(lower) && /output=ts/i.test(lower)) return true;
    if (/[?&]output=ts(?:&|$)/i.test(lower)) return true;
    return false;
  }

  function isSeriesByGroup(category) {
    const g = normalizeText(category);
    if (!g) return false;
    if (isChannelByGroup(category)) return false;
    return (
      /\bSERIES?\b/.test(g) ||
      /\bSERIE\b/.test(g) ||
      /(?:^|[\s♠■●★◆▪])SERIES?\b/.test(g)
    );
  }

  function isSeriesByUrl(url) {
    return (url || "").toLowerCase().includes("/series/");
  }

  function isMovieByGroup(category) {
    const g = normalizeText(category);
    if (!g) return false;
    if (isChannelByGroup(category) || isSeriesByGroup(category)) return false;
    return (
      /\bFILMES?\b/.test(g) ||
      /\bVOD\b/.test(g) ||
      /\bMOVIES?\b/.test(g) ||
      /\bCINEMA\b/.test(g)
    );
  }

  function isMovieByUrl(url) {
    const lower = (url || "").toLowerCase();
    return lower.includes("/movie/") || lower.includes("/vod/");
  }

  /**
   * Classificação rigorosa (ordem de prioridade):
   * 1. Canal — group-title OU URL de ao vivo
   * 2. Série — group-title OU /series/
   * 3. Filme — não é canal/série E (group-title OU /movie/|/vod/)
   */
  function classifyEntry(url, category) {
    if (isChannelByGroup(category) || isChannelByUrl(url)) {
      return "channel";
    }
    if (isSeriesByGroup(category) || isSeriesByUrl(url)) {
      return "series";
    }
    if (isMovieByGroup(category) || isMovieByUrl(url)) {
      return "movie";
    }
    return "unknown";
  }

  function parseExtinf(line) {
    const attrs = {};
    let match;
    while ((match = ATTR_RE.exec(line)) !== null) {
      attrs[match[1]] = match[2];
    }

    const commaIdx = line.lastIndexOf(",");
    const afterComma =
      commaIdx !== -1 ? line.slice(commaIdx + 1).trim() : "";

    return {
      name: attrs["tvg-name"] || afterComma || "Sem título",
      logo: attrs["tvg-logo"] || "",
      category: attrs["group-title"] || "Sem categoria",
      duration: attrs["duration"] || attrs["tvg-duration"] || "",
    };
  }

  function parseM3U(rawText) {
    if (!rawText || typeof rawText !== "string") return [];

    const lines = rawText.split(/\r?\n/);
    const entries = [];
    let pending = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith("#EXTINF")) {
        pending = parseExtinf(line);
        continue;
      }

      if (line.startsWith("#")) continue;

      if (pending) {
        const type = classifyEntry(line, pending.category);
        entries.push({
          ...pending,
          url: line,
          type,
        });
        pending = null;
      }
    }

    return entries;
  }

  /** Extrai temporada e episódio do título (S01E01, 1x01, etc.). */
  function parseSeasonEpisode(title) {
    const t = (title || "").trim();
    let m = t.match(/[Ss](\d{1,3})[.\s:_-]*[Ee](\d{1,4})/);
    if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };

    m = t.match(/(\d{1,3})[xX](\d{1,4})/);
    if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };

    m = t.match(/[Tt]emporada\s*(\d{1,3})[.\s:_-]*[Ee]pis[oó]dio\s*(\d{1,4})/i);
    if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };

    m = t.match(/[Tt](\d{1,3})[.\s:_-]*[Ee](\d{1,4})/);
    if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };

    m = t.match(/[Ee]pis[oó]dio\s*(\d{1,4})/i);
    if (m) {
      const sm = t.match(/[Ss](\d{1,3})/i) || t.match(/[Tt]emporada\s*(\d{1,3})/i);
      return {
        season: sm ? parseInt(sm[1], 10) : 1,
        episode: parseInt(m[1], 10),
      };
    }

    m = t.match(/[Ss](\d{1,3})(?![Ee\d])/i);
    if (m) return { season: parseInt(m[1], 10), episode: 1 };

    return null;
  }

  /** Nome base da série (texto antes de S01, 1x01, etc.). */
  function extractSeriesBaseName(title) {
    let base = (title || "").trim();
    const cuts = [
      /\s*[-–—:|]\s*[Ss]\d{1,3}[.\s:_-]*[Ee]\d{1,4}.*$/i,
      /\s*[-–—:|]\s*\d{1,3}[xX]\d{1,4}.*$/i,
      /\s*[Ss]\d{1,3}[.\s:_-]*[Ee]\d{1,4}.*$/i,
      /\s*\d{1,3}[xX]\d{1,4}.*$/i,
      /\s*[-–—:|]\s*[Tt]emporada\s*\d+.*$/i,
      /\s*[Tt]\d{1,3}[.\s:_-]*[Ee]\d{1,4}.*$/i,
      /\s*[-–—:|]\s*[Ee]pis[oó]dio\s*\d+.*$/i,
    ];
    for (const re of cuts) base = base.replace(re, "");
    return base.replace(/\s{2,}/g, " ").trim() || title;
  }

  function seriesGroupKey(baseName, category) {
    return `${baseName}::${category || ""}`;
  }

  /**
   * Agrupa episódios em um objeto por série (um card por show).
   */
  function groupSeriesEpisodes(rawEpisodes) {
    const map = new Map();

    for (const ep of rawEpisodes) {
      const baseName = extractSeriesBaseName(ep.name);
      const key = seriesGroupKey(baseName, ep.category);
      const parsed = parseSeasonEpisode(ep.name);

      if (!map.has(key)) {
        map.set(key, {
          type: "series",
          isSeriesGroup: true,
          name: baseName,
          logo: ep.logo || "",
          category: ep.category || "Sem categoria",
          seasons: {},
          seasonList: [],
          episodeCount: 0,
        });
      }

      const show = map.get(key);
      if (ep.logo && !show.logo) show.logo = ep.logo;

      const season = parsed?.season ?? 1;
      let episodeNum = parsed?.episode;
      if (!episodeNum) {
        episodeNum = (show.seasons[season]?.length || 0) + 1;
      }

      if (!show.seasons[season]) show.seasons[season] = [];

      show.seasons[season].push({
        season,
        episode: episodeNum,
        name: ep.name,
        url: ep.url,
        logo: ep.logo || show.logo,
      });
      show.episodeCount++;
    }

    const result = [];
    for (const show of map.values()) {
      show.seasonList = Object.keys(show.seasons)
        .map(Number)
        .sort((a, b) => a - b);

      for (const s of show.seasonList) {
        const seen = new Set();
        show.seasons[s].sort((a, b) => a.episode - b.episode);
        show.seasons[s] = show.seasons[s].filter((ep) => {
          const id = `${s}-${ep.episode}`;
          if (seen.has(id)) return false;
          seen.add(id);
          ep.label = `Episódio ${ep.episode}`;
          return true;
        });
      }
      result.push(show);
    }

    return result;
  }

  function compareAlphabetic(a, b) {
    return String(a || "").localeCompare(String(b || ""), "pt-BR", { sensitivity: "base" });
  }

  /** Índice de categorias (group-title) com contagem. */
  function buildCategoryIndex(items, sortMode = "count") {
    const counts = new Map();
    for (const item of items) {
      const key = item.category || "Sem categoria";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const entries = [...counts.entries()];
    if (sortMode === "alpha") {
      entries.sort((a, b) => compareAlphabetic(a[0], b[0]));
    } else {
      entries.sort((a, b) => b[1] - a[1]);
    }
    return entries.map(([name, count]) => ({ name, count }));
  }

  /** Ordena canais por nome (A–Z) dentro de cada pasta. */
  function sortChannelsByName(channels) {
    return [...channels].sort((a, b) =>
      compareAlphabetic(a.name || a.label, b.name || b.label)
    );
  }

  /** Separa em 3 arrays distintos; séries agrupadas por nome base. */
  function splitCatalog(entries) {
    const arrayCanais = [];
    const arrayFilmes = [];
    const rawSeries = [];

    for (const entry of entries) {
      const type = entry.type || classifyEntry(entry.url, entry.category);
      const item = { ...entry, type };

      if (type === "channel") arrayCanais.push(item);
      else if (type === "series") rawSeries.push(item);
      else if (type === "movie") arrayFilmes.push(item);
    }

    const arraySeries = groupSeriesEpisodes(rawSeries);

    return {
      channels: arrayCanais,
      movies: arrayFilmes,
      series: arraySeries,
      seriesRawCount: rawSeries.length,
      all: [...arrayCanais, ...arrayFilmes, ...arraySeries],
      categories: {
        channels: buildCategoryIndex(arrayCanais, "alpha"),
        movies: buildCategoryIndex(arrayFilmes),
        series: buildCategoryIndex(arraySeries),
      },
    };
  }

  function groupByCategory(entries) {
    const map = new Map();
    for (const entry of entries) {
      const key = entry.category || "Sem categoria";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    }
    return map;
  }

  function groupByType(entries) {
    const split = splitCatalog(entries);
    return {
      series: split.series,
      movie: split.movies,
      channel: split.channels,
    };
  }

  function getTopCategories(entries, maxRows = 35, maxItems = 24, minItems = 2) {
    const counts = new Map();
    for (const entry of entries) {
      const key = entry.category || "Sem categoria";
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const topNames = [...counts.entries()]
      .filter(([, count]) => count >= minItems)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxRows)
      .map(([name]) => name);

    if (!topNames.length) return [];

    const allowed = new Set(topNames);
    const buckets = new Map(topNames.map((name) => [name, []]));

    for (const entry of entries) {
      const key = entry.category || "Sem categoria";
      if (!allowed.has(key)) continue;
      const list = buckets.get(key);
      if (list.length < maxItems) list.push(entry);
    }

    return topNames.map((name) => [name, buckets.get(name)]);
  }

  global.M3UParser = {
    parseM3U,
    splitCatalog,
    classifyEntry,
    groupByCategory,
    groupByType,
    getTopCategories,
    groupSeriesEpisodes,
    parseSeasonEpisode,
    extractSeriesBaseName,
    buildCategoryIndex,
    sortChannelsByName,
    isChannelByGroup,
    isChannelByUrl,
    isSeriesByGroup,
    isSeriesByUrl,
    isMovieByGroup,
    isMovieByUrl,
  };
})(typeof window !== "undefined" ? window : globalThis);
