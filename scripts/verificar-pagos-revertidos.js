// Verifica que los pagos revertidos no se listan en Compras > Pagos (todas las pestañas),
// que Registros y los totales no cambian y que los datos de exportación no los incluyen.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const leer = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8').replace(/\r\n/g, '\n');
const src = leer('pagos.js');
const srcRep = leer('reportes.js');
let ok = 0, total = 0;
function afirmar(c, m) { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; }

function extraer(fuente, nombre) {
  const i = fuente.indexOf('function ' + nombre + '(');
  const j = fuente.indexOf('\n}\n', i);
  return fuente.slice(i, j + 3);
}
const cod = ['calcularStats', 'filtrarPorHoy', 'filtrarPorSemana', 'filtrarPorMes', 'dentroDeRangoFecha', 'aplicarFiltrosTodos', 'obtenerRegistrosParaTab']
  .map((n) => extraer(src, n)).join('\n');
const codRep = ['deudaDePago', 'calcularResumenPagos'].map((n) => extraer(srcRep, n)).join('\n');

const HOY = '2026-11-03';
const pagos = [
  { id: 'a', ticket: '1', proveedor: 'P1', material: 'PET', kg: 100, total: 500, pagado: 300, fecha: HOY },
  { id: 'b', ticket: '2', proveedor: 'P1', material: 'PET', kg: 50, total: 250, pagado: 250, fecha: HOY, revertido: true },
  { id: 'c', ticket: '3', proveedor: 'P2', material: 'HDPE', kg: 20, total: 100, pagado: 100, fecha: '2026-10-20' },
  { id: 'd', ticket: '4', proveedor: 'P2', material: 'HDPE', kg: 30, total: 150, pagado: 0, fecha: '2026-10-20', revertido: true }
];
const copia = JSON.parse(JSON.stringify(pagos));
const ctx = {
  window: {
    EVE: { registrosPagos: pagos },
    normalizarProveedor: (v) => v || '',
    obtenerFechaMexico: () => HOY,
    obtenerInicioSemana: () => '2026-11-02',
    obtenerInicioMes: () => '2026-11-01',
    dentroDeUltimos30Dias: (f) => f >= '2026-10-04'
  },
  tabActiva: 'hoy',
  filtros: {}
};
vm.createContext(ctx);
vm.runInContext(cod + '\n' + codRep + '\nthis.f = { obtenerRegistrosParaTab, calcularStats, calcularResumenPagos };', ctx);

const esperados = { hoy: ['a'], semana: ['a'], mes: ['a'], ultimos30: ['a', 'c'], todos: ['a', 'c'] };
for (const [tab, ids] of Object.entries(esperados)) {
  ctx.tabActiva = tab;
  const r = ctx.f.obtenerRegistrosParaTab();
  afirmar(JSON.stringify(r.map((x) => x.id)) === JSON.stringify(ids), `pestaña ${tab}: lista ${JSON.stringify(r.map((x) => x.id))}, esperado ${JSON.stringify(ids)}`);
  afirmar(r.every((x) => !x.revertido), `pestaña ${tab}: hay revertidos en la lista`);
  afirmar(ctx.f.calcularStats(r).totalRegistros === ids.length, `pestaña ${tab}: contador Registros`);
}

// Totales iguales a los de antes (que ya excluían revertidos)
ctx.tabActiva = 'todos';
const lista = ctx.f.obtenerRegistrosParaTab();
const s = ctx.f.calcularStats(lista);
const res = ctx.f.calcularResumenPagos(lista);
afirmar(s.totalKg === 120, 'Total KG = 120');
afirmar(res.totalPagado === 400, 'Total Pagado = 400');
afirmar(res.totalDeuda === 200, 'Total Deuda = 200');

// No se modifican los datos en memoria/Firestore
afirmar(JSON.stringify(pagos) === JSON.stringify(copia), 'registrosPagos intacto');

// Exportaciones (TXT/PDF/CSV) arman sus datos con obtenerDatosPeriodo, que ya excluye revertidos
const bloque = extraer(srcRep, 'obtenerDatosPeriodo');
afirmar(/pagos:\s*window\.EVE\.registrosPagos\.filter\(\(r\) =>\s*!r\.revertido/.test(bloque), 'obtenerDatosPeriodo excluye revertidos');

console.log(`${ok}/${total} verificaciones correctas`);
