// scripts/auditar-duplicados.js (auditoría de solo lectura para la consola del navegador) con la misma regla que la alerta de captura.
//
// Corre el script TAL CUAL en un contexto con js/utils.js real y datos que reproducen los falsos positivos de la auditoría real:
//   - Pagos: tickets distintos con el mismo proveedor, material, kg y precio (JUANA, MIXTO, 770 kg, $7.80); un mismo ticket pagado en
//     dos partes (anticipo aplicado y liquidación: tickets 1380, 0864, 1370, 1204, 1175, 1297, 1066 y 1056), incluso con los mismos
//     kg y precio y con dos abonos IGUALES (500 + 500) mientras el ticket aún tenía saldo. Debe dar 0 pares en Pagos.
//   - Pagos: un doble clic de verdad (mismo ticket y mismo monto cuando el ticket ya estaba liquidado) sí aparece.
//   - Ventas: V-2026-043 y V-2026-048 (4 días de diferencia) y V-2026-034 / V-2026-035 (otra cantidad) no son pares; la copia exacta de
//     V-2026-034 sí. Gastos: una semana de diferencia no es par; el mismo día sí.
//   - No escribe nada, no cambia los datos y restituye la ventana de 30 días de la alerta.
//
// Uso: node scripts/verificar-auditoria-duplicados.js   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const igual = (a, b, m) => afirmar(JSON.stringify(a) === JSON.stringify(b), `${m}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);

const escrituras = [];
const prohibido = (nombre) => () => { escrituras.push(nombre); throw new Error('ESCRITURA PROHIBIDA: ' + nombre); };
const salida = [];
const sandbox = {
  console: { log: (...a) => salida.push(['log', a.join(' ')]), error: (...a) => salida.push(['error', a.join(' ')]), group() {}, groupEnd() {}, table: (t) => salida.push(['table', t]), warn() {} },
  Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout, document: {}, navigator: { onLine: true }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(leer('js/utils.js'), sandbox, { filename: 'js/utils.js' });
sandbox.window.obtenerFechaMexico = () => '2026-11-04';
sandbox.window.guardarDato = prohibido('guardarDato');
sandbox.window.actualizarDato = prohibido('actualizarDato');
sandbox.window.eliminarDato = prohibido('eliminarDato');
sandbox.window.db = { collection: () => ({ add: prohibido('add'), doc: () => ({ set: prohibido('set'), update: prohibido('update'), delete: prohibido('delete') }), get: async () => { throw new Error('no debe leer Firestore'); } }) };

// ── Datos ──
const linea = (material, cantidad, unidad, precioUnitario) => ({ material, cantidad, unidad, precioUnitario, subtotal: cantidad * precioUnitario, totalLinea: cantidad * precioUnitario });
const venta = (id, folio, cliente, fecha, lineas) => ({ id, folio, cliente, fecha, lineas, totalVenta: lineas.reduce((s, l) => s + l.totalLinea, 0), registradoPor: 'Matilde', fechaRegistro: fecha + '12:00:00.000Z'.padStart(13, 'T') });
const ventas = [
  venta('v34', 'V-2026-034', 'ENVASES PLASTICOS', '2026-10-12', [linea('LECHERO MOLIDO', 4130, 'KG', 13.5)]),
  venta('v35', 'V-2026-035', 'ENVASES PLASTICOS', '2026-10-12', [linea('LECHERO MOLIDO', 3350, 'KG', 13.5)]), // otra cantidad
  venta('v43', 'V-2026-043', 'MANUEL SANTILLAN', '2026-10-19', [linea('CAJA CO30', 1000, 'PZ', 60)]),
  venta('v48', 'V-2026-048', 'MANUEL SANTILLAN', '2026-10-23', [linea('CAJA CO30', 1000, 'PZ', 60)]), // 4 días después
  venta('v34b', 'V-2026-099', 'ENVASES PLASTICOS', '2026-10-12', [linea('LECHERO MOLIDO', 4130, 'KG', 13.5)]) // copia exacta de V-2026-034
];
const TICKETS = ['1380', '0864', '1370', '1204', '1175', '1297', '1066', '1056'];
const pagos = [];
TICKETS.forEach((ticket, i) => {
  pagos.push({ id: 'ant' + ticket, ticket, proveedor: 'JUANA', material: 'MIXTO', kg: 770, precioPorKg: 7.8, total: 6006, pagado: 2000, fecha: '2026-10-2' + (i % 5), fechaRegistro: '2026-10-2' + (i % 5) + 'T10:00:00.000Z' });
  pagos.push({ id: 'liq' + ticket, ticket, proveedor: 'JUANA', material: 'MIXTO', kg: 770, precioPorKg: 7.8, total: 6006, pagado: 4006, fecha: '2026-11-02', fechaRegistro: '2026-11-02T10:00:00.000Z' });
});
// tickets distintos de JUANA, el mismo día, mismos kg, material y precio
['2001', '2002', '2003'].forEach((ticket, i) => pagos.push({ id: 'dj' + ticket, ticket, proveedor: 'JUANA', material: 'MIXTO', kg: 770, precioPorKg: 7.8, total: 6006, pagado: 6006, fecha: '2026-11-03', fechaRegistro: '2026-11-03T0' + i + ':00:00.000Z' }));
// dos abonos IGUALES (500 + 500) de un mismo ticket de 1,000 mientras tenía saldo
pagos.push({ id: 'ab1', ticket: '3001', proveedor: 'LUIS', material: 'PET', kg: 200, precioPorKg: 5, total: 1000, pagado: 500, fecha: '2026-10-28', fechaRegistro: '2026-10-28T09:00:00.000Z' });
pagos.push({ id: 'ab2', ticket: '3001', proveedor: 'LUIS', material: 'PET', kg: 200, precioPorKg: 5, total: 1000, pagado: 500, fecha: '2026-10-30', fechaRegistro: '2026-10-30T09:00:00.000Z' });
// anticipos (no son tickets)
pagos.push({ id: 'an1', ticket: '', proveedor: 'JUANA', material: '', kg: 0, precioPorKg: 0, total: 0, pagado: 800, fecha: '2026-11-03', origen: 'anticipo' });
pagos.push({ id: 'an2', ticket: '', proveedor: 'JUANA', material: '', kg: 0, precioPorKg: 0, total: 0, pagado: 800, fecha: '2026-11-03', origen: 'anticipo' });
// doble clic de verdad: ticket liquidado de un pago y vuelto a capturar con el mismo monto
pagos.push({ id: 'dc1', ticket: '4001', proveedor: 'PEDRO', material: 'HDPE', kg: 300, precioPorKg: 8, total: 2400, pagado: 2400, fecha: '2026-11-01', fechaRegistro: '2026-11-01T11:00:00.000Z' });
pagos.push({ id: 'dc2', ticket: '4001', proveedor: 'PEDRO', material: 'HDPE', kg: 300, precioPorKg: 8, total: 2400, pagado: 2400, fecha: '2026-11-01', fechaRegistro: '2026-11-01T11:00:05.000Z' });
const gastos = [
  { id: 'g1', fecha: '2026-10-20', beneficiario: 'GAS DEL NORTE', montoBase: 1200, concepto: 'Diésel', tipoGasto: 'operacion', creadoPor: 'A', fechaRegistro: '2026-10-20T10:00:00.000Z' },
  { id: 'g2', fecha: '2026-10-27', beneficiario: 'GAS DEL NORTE', montoBase: 1200, concepto: 'Diésel', tipoGasto: 'operacion', creadoPor: 'A', fechaRegistro: '2026-10-27T10:00:00.000Z' }, // una semana después
  { id: 'g3', fecha: '2026-11-02', beneficiario: 'LUZ', montoBase: 500, concepto: 'Recibo', tipoGasto: 'operacion', creadoPor: 'A', fechaRegistro: '2026-11-02T10:00:00.000Z' },
  { id: 'g4', fecha: '2026-11-02', beneficiario: 'LUZ', montoBase: 500, concepto: 'Recibo', tipoGasto: 'operacion', creadoPor: 'A', fechaRegistro: '2026-11-02T10:05:00.000Z' } // el mismo día
];
sandbox.window.EVE = { currentUser: { username: 'Admin' }, ventas, registrosPagos: pagos, cobros: [], gastos, recibosDinero: [], ordenesCompra: [], cuentasPorPagar: [] };
const antes = JSON.stringify(sandbox.window.EVE);
const ventanaOriginal = sandbox.window.obtenerInicioUltimos30Dias;

(async () => {
  await vm.runInContext(leer('scripts/auditar-duplicados.js'), sandbox, { filename: 'scripts/auditar-duplicados.js' });
  await new Promise((resolver) => setTimeout(resolver, 50));
  const r = sandbox.window.__auditoriaDuplicados;
  afirmar(!!r && !!r.colecciones, 'la auditoría terminó y dejó su resultado');
  const ids = (modulo) => (r.colecciones[modulo].pares || []).map((p) => `${p.idA}<->${p.idB}`).sort();

  // Pagos
  igual(r.colecciones.pagos.pares.filter((p) => !/dc1|dc2/.test(p.idA + p.idB)).length, 0, 'Pagos: 0 pares falsos (anticipo + liquidación, tickets distintos, abonos iguales con saldo, anticipos)');
  igual(ids('pagos'), ['dc1<->dc2'], 'Pagos: el único par es el doble clic de verdad (mismo ticket y mismo monto con el ticket liquidado)');
  afirmar(r.colecciones.pagos.pares[0].directa === true, 'Pagos: el par del doble clic es del tipo «mismo ticket, proveedor, material y monto pagado»');
  igual(r.colecciones.pagos.registrosRevisados, pagos.length - 2, 'Pagos: los 2 anticipos no se revisan');
  TICKETS.forEach((t) => afirmar(!ids('pagos').some((p) => p.includes('ant' + t) || p.includes('liq' + t)), `Pagos: ticket ${t} (anticipo y liquidación) no aparece`));
  afirmar(!ids('pagos').some((p) => p.includes('ab1') || p.includes('ab2')), 'Pagos: dos abonos de 500 del ticket 3001 con saldo pendiente no aparecen');
  afirmar(!ids('pagos').some((p) => /dj200/.test(p)), 'Pagos: tickets distintos de JUANA el mismo día no aparecen');

  // Ventas
  igual(ids('ventas'), ['v34<->v34b'], 'Ventas: solo la copia exacta de V-2026-034 (ni 034/035 ni 043/048)');
  // Gastos
  igual(ids('gastos'), ['g3<->g4'], 'Gastos: solo el mismo gasto del mismo día (la semana de diferencia no)');

  // Sin efectos
  igual(escrituras, [], 'no llamó a guardarDato, actualizarDato, eliminarDato ni escribió en Firestore');
  igual(JSON.stringify(sandbox.window.EVE), antes, 'los datos no se modificaron');
  afirmar(sandbox.window.obtenerInicioUltimos30Dias === ventanaOriginal, 'restituyó la ventana de 30 días');
  afirmar(salida.filter((s) => s[0] === 'error').length === 0, 'sin errores en la consola');
  afirmar(salida.some((s) => s[0] === 'log' && /Auditoría terminada: 3 par/.test(s[1])), 'imprime el total: 3 pares');

  // Estático
  const script = leer('scripts/auditar-duplicados.js');
  const codigo = script.replace(/\/\/.*$/gm, '');
  afirmar(!/guardarDato\(|actualizarDato\(|eliminarDato\(|db\.collection\([^)]*\)\s*\.(add|set|update|delete|doc)\(|\.doc\([^)]*\)\s*\.(set|update|delete)\(|\.batch\(|runTransaction/.test(codigo), 'el script no contiene ninguna llamada de escritura a Firestore (los Map.set locales no cuentan)');
  console.log(`${ok}/${total} verificaciones correctas`);
})().catch((e) => { console.error('FALLA: ' + (e.stack || e.message)); process.exitCode = 1; });
