// Persistência dos marcadores: { [chave do anúncio]: 'skull' | 'moon' | 'star' }.
// Leitura síncrona a partir de um Map em memória; gravação com debounce em chrome.storage.local.
(function (root) {
  const KEY = 'pimMarkers';
  const TYPES = ['skull', 'moon', 'star'];
  const KEY_PATTERN = /^(?:id|fp):[A-Za-z0-9_-]{1,64}$/;
  const MAX_ENTRIES = 5000;
  const WRITE_DELAY_MS = 150;

  function sanitize(raw) {
    const map = new Map();
    if (!raw || typeof raw !== 'object') return map;
    for (const [key, type] of Object.entries(raw)) {
      if (KEY_PATTERN.test(key) && TYPES.includes(type)) map.set(key, type);
    }
    while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value);
    return map;
  }

  const serialize = map => JSON.stringify(Object.fromEntries(map));

  // area: { get(key) -> Promise<{[key]: value}>, set(obj) -> Promise }
  // changes: { addListener(fn(changes, areaName)) } (opcional)
  function create(area, changes) {
    let map = new Map();
    let timer = null;
    const listeners = new Set();
    const notify = () => listeners.forEach(listener => { try { listener(); } catch { /* ignora */ } });

    async function flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      try { await area.set({ [KEY]: Object.fromEntries(map) }); } catch { /* tenta de novo na próxima gravação */ }
    }
    function scheduleWrite() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, WRITE_DELAY_MS);
    }

    changes?.addListener?.((delta, areaName) => {
      if (areaName !== 'local' || !delta[KEY]) return;
      const next = sanitize(delta[KEY].newValue);
      if (serialize(next) === serialize(map)) return;
      map = next;
      notify();
    });

    return {
      async load() {
        const data = await area.get(KEY).catch(() => ({}));
        map = sanitize(data?.[KEY]);
        notify();
      },
      get: key => map.get(key) ?? null,
      set(key, type) {
        if (!KEY_PATTERN.test(key) || !TYPES.includes(type)) return false;
        map.delete(key);
        map.set(key, type);
        while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value);
        scheduleWrite();
        notify();
        return true;
      },
      clear(key) {
        if (!map.delete(key)) return false;
        scheduleWrite();
        notify();
        return true;
      },
      onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      flush,
      size: () => map.size,
    };
  }

  const api = { KEY, TYPES, MAX_ENTRIES, sanitize, create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PIMStorage = api;
})(typeof self !== 'undefined' ? self : globalThis);
