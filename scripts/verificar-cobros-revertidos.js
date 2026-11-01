// Verifica que los cobros revertidos no se listan en Cobros (tabla, conteo, filtros, CSV).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'cobros.js'), 'utf8');
let ok = 0, total = 0;
function afirmar(c, m) { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; }

// Se evalúa solo la lógica de datos del módulo (sin DOM) extrayendo funciones por nombre.
function extraer(nombre) {
  const i = src.indexOf('function ' + nombre + '(');
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j + 3);
}
const cod = ['calcularStats', 'filtrarPorHoy', 'filtrarPorSemana', 'filtrarPorMes', 'dentroDeRangoFecha', 'aplicarFiltrosTodos', 'obtenerRegistrosParaTab', 'construirFilasCSVCobros', 'construirFilaTabla'].map(extraer).join('\n');
const doc = { createElement: () => ({ appendChild() {}, addEventListener() {}, style: {}, set textContent(v) { this._t = v; } }) };
const ctx = {
  window: { EVE: { cobros: [
    { id: 'a', folio: 'V-1', cliente: 'X', material: 'M', cantidad: 1, pagado: 100, fecha: '2026-11-01' },
    { id: 'b', folio: 'V-2', cliente: 'X', material: 'M', cantidad: 1, pagado: 50, fecha: '2026-11-01', revertido: true }
  ], }, obtenerFechaMexico: () => '2026-11-01', obtenerInicioSemana: () => '2026-10-26', obtenerInicioMes: () => '2026-11-01',
    formatearKg: String, formatearMoneda: String, puedeEscribir: () => true },
  document: doc, tabActiva: 'hoy', filtros: { folio: '', desde: '', hasta: '', cliente: '', material: '' }
};
vm.createContext(ctx);
vm.runInContext(cod + '\nthis.f = { obtenerRegistrosParaTab, construirFilasCSVCobros, calcularStats };', ctx);
for (const tab of ['hoy', 'semana', 'mes', 'todos']) {
  ctx.tabActiva = tab;
  const r = ctx.f.obtenerRegistrosParaTab();
  afirmar(r.length === 1 && r[0].id === 'a', `tab ${tab}: solo el cobro vigente`);
  afirmar(ctx.f.calcularStats(r).totalRegistros === 1, `tab ${tab}: conteo sin revertidos`);
  afirmar(ctx.f.construirFilasCSVCobros(r).length === 1, `tab ${tab}: CSV sin revertidos`);
}
afirmar(!src.includes('↩️ Revertido') && !src.includes('line-through'), 'sin chip Revertido ni estilo tachado');
afirmar(ctx.window.EVE.cobros.length === 2, 'los revertidos siguen en memoria (no se borran)');
console.log(`${ok}/${total} verificaciones`);
