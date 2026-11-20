// Converte fichas validadas e lê o CSV emitido pela aba Vendas confirmadas.
(() => {
  const FORMAT = 'pis_sales_backup_v1';
  const COLUMN = 'Dados da venda (JSON)';

  function normalize(rows, core) {
    const normalized = core.validate('sale', rows);
    if (normalized.length !== rows.length) throw new Error('Lote contém ficha de venda inválida');
    return normalized.map((row, index) => ({
      ...row, source: rows[index].source === 'smartmarket_backup' ? 'smartmarket_backup' : 'game',
    }));
  }

  function csvRows(contents) {
    const input = contents.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', quoted = false, closed = false;
    for (let i = 0; i <= input.length; i++) {
      const char = input[i];
      if (quoted) {
        if (char === '"') {
          if (input[i + 1] === '"') { field += '"'; i++; }
          else { quoted = false; closed = true; }
        } else if (char == null) throw new Error('Campo entre aspas incompleto no CSV');
        else field += char;
      } else if (char === ',' || char === '\r' || char === '\n' || char == null) {
        row.push(field);
        field = '';
        closed = false;
        if (char !== ',') {
          if (row.some(value => value !== '')) rows.push(row);
          row = [];
          if (char === '\r' && input[i + 1] === '\n') i++;
        }
      } else if (!field && !closed && char === '"') quoted = true;
      else if (closed || char === '"') throw new Error('Formato CSV inválido');
      else field += char;
    }
    return rows;
  }

  function restore(contents, core) {
    const [headers, ...data] = csvRows(contents);
    const column = headers?.indexOf(COLUMN) ?? -1;
    if (column < 0 || !data.length) throw new Error('Use o CSV da aba Vendas confirmadas');
    const rows = [];
    for (let i = 0; i < data.length; i += core.MAX_BATCH) {
      const batch = data.slice(i, i + core.MAX_BATCH).map((row, index) => {
        try {
          const saved = JSON.parse(row[column]);
          if (!saved || !['game', 'smartmarket_backup'].includes(saved.source)) throw new Error();
          return saved;
        } catch { throw new Error(`Dados da venda inválidos na linha ${i + index + 2}`); }
      });
      rows.push(...normalize(batch, core));
    }
    return rows;
  }

  const api = { FORMAT, COLUMN, normalize, restore };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.PISSalesBackup = api;
})();
