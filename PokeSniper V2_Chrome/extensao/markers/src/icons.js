// Ícones vetoriais dos três marcadores (caveira, lua e estrela).
// Cada SVG é autocontido; os ids de gradiente ficam isolados no Shadow DOM de cada marcador.
(function (root) {
  const TYPES = ['skull', 'moon', 'star'];

  const SVG = {
    skull:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="#f4f1ea" stroke="#8d897f" stroke-width="1" stroke-linejoin="round" ' +
      'd="M12 2.4c-4.7 0-8.1 3.1-8.1 7.5 0 2.6 1.2 4.4 3.1 5.5v3.2c0 .9.7 1.6 1.5 1.6h1.2v1.2c0 .4.3.7.7.7h3.2c.4 0 .7-.3.7-.7v-1.2h1.2c.8 0 1.5-.7 1.5-1.6v-3.2c1.9-1.1 3.1-2.9 3.1-5.5 0-4.4-3.4-7.5-8.1-7.5z"/>' +
      '<ellipse cx="8.5" cy="11" rx="2.2" ry="2.6" fill="#1b1b24"/>' +
      '<ellipse cx="15.5" cy="11" rx="2.2" ry="2.6" fill="#1b1b24"/>' +
      '<path fill="#1b1b24" d="M12 13.4l1.3 2.3h-2.6z"/>' +
      '<path stroke="#1b1b24" stroke-width="1" stroke-linecap="round" d="M10.1 18.1v2.3M12 18.1v2.3M13.9 18.1v2.3"/>' +
      '</svg>',
    moon:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
      '<defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#f1f6ff"/><stop offset="1" stop-color="#8fb0e3"/></linearGradient></defs>' +
      '<path fill="url(#m)" stroke="#5a7bb3" stroke-width="1" stroke-linejoin="round" ' +
      'd="M20.6 13.6A8.8 8.8 0 1 1 10.4 3.4a7 7 0 0 0 10.2 10.2z"/>' +
      '</svg>',
    star:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
      '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#fff0a6"/><stop offset="1" stop-color="#f0b400"/></linearGradient></defs>' +
      '<path fill="url(#s)" stroke="#b9860f" stroke-width="1" stroke-linejoin="round" ' +
      'd="M12 1.8c.8 4.8 2.8 7.8 8.2 10.2-5.4 2.4-7.4 5.4-8.2 10.2-.8-4.8-2.8-7.8-8.2-10.2C9.2 9.6 11.2 6.6 12 1.8z"/>' +
      '</svg>',
  };

  const LABELS = { skull: 'Caveira', moon: 'Lua', star: 'Estrela' };

  const api = { TYPES, SVG, LABELS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PIMIcons = api;
})(typeof self !== 'undefined' ? self : globalThis);
