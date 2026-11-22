// Empacota o capturador MAIN sem depender de globais da página ou da ordem de injeção.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const directory = join(__dirname, '..');
const read = name => readFileSync(join(directory, name), 'utf8');

function privateModule(file, binding, value, globalName) {
  const source = read(file);
  const marker = `  if (typeof window === 'undefined' && typeof module === 'object' && module.exports) module.exports = ${value};
  else globalThis.${globalName} = ${value};`;
  const start = source.indexOf('(() => {');
  const end = source.lastIndexOf('})();');
  if (start < 0 || end < start || !source.includes(marker)) throw new Error('Formato inesperado em ' + file);
  const factory = source.slice(start, end + '})()'.length).replace(marker, '  return ' + value + ';');
  return 'const ' + binding + ' = ' + factory + ';';
}

function build() {
  const core = privateModule('market-core.js', 'mainMarketCore', 'core', 'PISMarketCore');
  const history = privateModule('coins-history.js', 'mainCoinsHistory', 'api', 'PISCoinsHistory');
  const diagnostic = privateModule('market-wire-diagnostic.js', 'mainMarketWireDiagnostic', 'api', 'PISMarketWireDiagnostic');
  const monitor = read('sniper.js').replaceAll('globalThis.PISMarketCore', 'mainMarketCore')
    .replaceAll('globalThis.PISCoinsHistory', 'mainCoinsHistory')
    .replaceAll('globalThis.PISMarketWireDiagnostic', 'mainMarketWireDiagnostic');
  return [
    '// Gerado por node scripts/build-market-main.cjs.',
    '(() => {',
    core,
    history,
    diagnostic,
    monitor.trimEnd(),
    '})();',
    '',
  ].join('\n');
}

if (require.main === module) {
  const path = join(directory, 'market-main.js');
  const code = build();
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== code) throw new Error('market-main.js desatualizado');
  } else writeFileSync(path, code);
}

module.exports = { build };
