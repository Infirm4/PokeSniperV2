// Ponto de entrada do content script (mundo ISOLATED, só no pokeidle.io).
(async () => {
  if (window.__pimMarkers) return;
  window.__pimMarkers = true;
  const store = PIMStorage.create(chrome.storage.local, chrome.storage.onChanged);
  await store.load();
  PIMUI.createUI({ document, store }).start(window);
  window.addEventListener('pagehide', () => { void store.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) void store.flush(); });
})();
