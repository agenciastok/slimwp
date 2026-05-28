/**
 * SlimFlix — shim global (carregar ANTES de login.js).
 * Reescreve fetch/XHR de http://painel/… para /api/painel/… e evita Mixed Content em HTTPS.
 */
(function () {
  const BUILD = "api-proxy-shim-5";
  const API = "/api";

  function toProxyUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return raw;
    if (raw.startsWith(`${API}/`) || raw === API) return raw;
    if (!/^https?:\/\//i.test(raw)) return raw;
    try {
      const parsed = new URL(raw);
      return `${API}/${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return raw;
    }
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === "string") {
      return nativeFetch(toProxyUrl(input), init);
    }
    if (input instanceof Request) {
      const proxied = toProxyUrl(input.url);
      if (proxied !== input.url) {
        return nativeFetch(new Request(proxied, input), init);
      }
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

  window.SlimFlixApiProxyShim = { BUILD, toProxyUrl };

  console.info(`[SlimFlix] ${BUILD} ativo — HTTP externo → ${API}/{host}/…`);
})();
