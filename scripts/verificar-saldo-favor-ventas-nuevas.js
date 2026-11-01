// Aplicación automática del saldo a favor del cliente al generar las CxC de una venta nueva (js/cxc.js: generarCxCDesdeVenta),
// como generarYGuardarCxP en CxP. Carga en un contexto vm los js/ reales con un Firestore simulado en memoria y comprueba:
//  - saldo mayor, igual y menor al total de la venta, con varias líneas (un movimiento negativo por línea con el grupoPagoId de su abono);
//  - sin saldo / saldo ya consumido desde otra sesión / sin conexión: las CxC se crean normales;
//  - falla de la aplicación: la venta y sus CxC se crean sin aplicar y se avisa (nunca a medias);
//  - editar o eliminar una venta con saldo a favor aplicado se bloquea (y se valida antes de tocar la venta); al revertir el abono el saldo vuelve;
//  - cuadratura cobros + saldo CxC = ventas + saldo a favor pendiente; Flujo no cuenta la aplicación como entrada.
// Uso: node scripts/verificar-saldo-favor-ventas-nuevas.js   (código de salida 1 si algún caso falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
const ARCHIVOS = ['config.js', 'utils.js', 'permisos.js', 'cxp.js', 'saldo-clientes.js', 'cxc.js', 'cobros.js', 'flujo.js'];

function crearContexto() {
  const colecciones = {};
  const col = (n) => (colecciones[n] = colecciones[n] || new Map());
  let secuencia = 0;
  const copia = (o) => JSON.parse(JSON.stringify(o));
  const estado = { fallaClientes: false, transacciones: 0, enLinea: true };
  const errores = [];
  const historial = [];
  const snap = (r) => ({ exists: col(r.col).has(r.id), id: r.id, data: () => copia(col(r.col).get(r.id)) });
  const crearRef = (c, id) => ({ col: c, id: id || `${c}_${++secuencia}`, get: async function () { return snap(this); } });
  const db = {
    collection: (c) => ({
      doc: (id) => crearRef(c, id),
      where: (campo, _op, valor) => ({
        get: async () => ({ docs: [...col(c).entries()].filter(([, d]) => d[campo] === valor).map(([id, d]) => ({ id, data: () => copia(d) })) })
      })
    }),
    runTransaction: async (fn) => {
      estado.transacciones++;
      const escrituras = [];
      const tx = {
        get: async (r) => snap(r),
        set: (r, d, op) => {
          if (r.col === 'clientes' && estado.fallaClientes) throw new Error('Firestore no disponible');
          escrituras.push(() => col(r.col).set(r.id, op && op.merge ? { ...(col(r.col).get(r.id) || {}), ...copia(d) } : copia(d)));
        },
        update: (r, d) => escrituras.push(() => col(r.col).set(r.id, { ...col(r.col).get(r.id), ...copia(d) }))
      };
      const resultado = await fn(tx);
      escrituras.forEach((e) => e());
      return resultado;
    }
  };
  const navigator = { get onLine() { return estado.enLinea; } };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { getElementById: () => null, createElement: () => ({}) }, navigator,
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { cuentasPorCobrar: [], cobros: [], clientes: [], proveedores: [], registrosPagos: [], gastos: [], flujoMovimientos: [], currentUser: { username: 'tester' } };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const f of ARCHIVOS) vm.runInContext(leer(`js/${f}`), sandbox, { filename: f });
  const w = sandbox.window;
  w.db = db;
  w.puedeEscribir = () => true;
  w.obtenerFechaMexico = () => '2026-11-02';
  w.EVE_HISTORIAL = { registrar: async (e) => { historial.push(e); } };
  w.showError = (m) => errores.push(m);
  w.guardarDato = async (c, d) => { const id = `${c}_${++secuencia}`; col(c).set(id, copia(d)); return id; };
  w.actualizarDato = async (c, id, cambios) => { col(c).set(id, { ...col(c).get(id), ...copia(cambios) }); };
  w.eliminarDato = async (c, id) => { col(c).delete(id); };
  return { w, col, estado, errores, historial, C: w.EVE_CXC, S: w.EVE_SALDO_CLIENTES };
}

const linea = (material, total) => ({ material, cantidad: 10, unidad: 'KG', precioUnitario: total / 10, subtotal: total, ivaTrasladado: 0, ivaRetenido: 0, totalLinea: total });
const venta = (folio, cliente, totales) => ({ folio, cliente, fecha: '2026-11-02', fechaEsperadaCobro: '2026-11-02', lineas: totales.map((t, i) => linea('PET' + i, t)) });
function sembrarSaldo(ctx, cliente, montos) {
  const saldoAFavor = montos.map((monto, i) => ({ revertido: false, monto, fecha: `2026-10-0${i + 1}`, motivo: 'Sobrante de cobro', grupoPagoId: 'gs' + i }));
  ctx.col('clientes').set(cliente, { nombre: cliente, saldoAFavor: JSON.parse(JSON.stringify(saldoAFavor)) });
  ctx.w.EVE.clientes.push({ id: cliente, nombre: cliente, saldoAFavor });
}
const cuentasDe = (ctx, ventaId) => [...ctx.col('cuentas_por_cobrar').entries()].filter(([, d]) => d.ventaId === ventaId).map(([id, d]) => ({ id, ...d })).sort((a, b) => a.lineaIndex - b.lineaIndex);
const suma = (xs, f) => Math.round(xs.reduce((s, x) => s + f(x), 0) * 100) / 100;
function cuadra(ctx) {
  const cobrado = suma(ctx.w.EVE.cobros.filter((c) => !c.revertido), (c) => c.pagado);
  const saldoCxC = suma(ctx.w.EVE.cuentasPorCobrar, (c) => c.saldo);
  const ventas = suma(ctx.w.EVE.cuentasPorCobrar, (c) => c.total);
  const favor = suma(ctx.w.EVE.clientes, (c) => ctx.S.saldoAFavorDisponibleCliente(c.nombre));
  return { izquierda: Math.round((cobrado + saldoCxC) * 100) / 100, derecha: Math.round((ventas + favor) * 100) / 100 };
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(c, m) { if (!c) throw new Error(m); }
function igual(real, esperado, m) { afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`); }
async function falla(promesa, texto, m) {
  try { await promesa; } catch (e) { afirmar(e.message.includes(texto), `${m}: mensaje "${e.message}"`); return e; }
  throw new Error(`${m}: no lanzó error`);
}

caso('Saldo mayor que la venta (2 líneas 300 + 200, saldo 1,000): ambas liquidadas, un movimiento negativo por línea y sobran 500', async () => {
  const ctx = crearContexto();
  sembrarSaldo(ctx, 'ACME', [1000]);
  await ctx.C.generarCxCDesdeVenta('v1', venta('V-1', 'ACME', [300, 200]));
  const [a, b] = cuentasDe(ctx, 'v1');
  igual([a.saldo, a.pagado, a.estado, b.saldo, b.estado], [0, 300, 'liquidado', 0, 'liquidado'], 'cuentas liquidadas');
  igual(a.abonos[0].referencia, 'Saldo a favor aplicado automáticamente', 'referencia del abono');
  igual([a.abonos[0].monto, b.abonos[0].monto, a.abonos[0].registradoPor], [300, 200, 'Sistema'], 'montos');
  const movs = ctx.col('clientes').get('ACME').saldoAFavor;
  igual(movs.slice(1).map((m) => m.monto), [-300, -200], 'un movimiento negativo por línea');
  igual([movs[1].grupoPagoId === a.abonos[0].grupoPagoId, movs[2].grupoPagoId === b.abonos[0].grupoPagoId, movs[1].grupoPagoId !== movs[2].grupoPagoId], [true, true, true], 'grupoPagoId por línea');
  igual(ctx.S.saldoAFavorDisponibleCliente('ACME'), 500, 'sobran 500');
  igual(ctx.col('cobros').size, 0, 'no crea cobros');
  igual(ctx.estado.transacciones, 1, 'una sola transacción por venta');
  igual(ctx.w.EVE.cuentasPorCobrar.length, 2, 'memoria con las dos CxC');
  igual(ctx.historial.filter((h) => h.coleccion === 'clientes' && h.accion === 'aplicacion').length, 2, 'historial de aplicaciones');
  igual(ctx.errores.length, 0, 'sin avisos');
});

caso('Saldo igual al total (500 vs 300 + 200): todo liquidado y el saldo queda en 0', async () => {
  const ctx = crearContexto();
  sembrarSaldo(ctx, 'ACME', [500]);
  await ctx.C.generarCxCDesdeVenta('v1', venta('V-1', 'ACME', [300, 200]));
  igual(cuentasDe(ctx, 'v1').map((c) => [c.saldo, c.estado]), [[0, 'liquidado'], [0, 'liquidado']], 'liquidadas');
  igual(ctx.S.saldoAFavorDisponibleCliente('ACME'), 0, 'saldo 0');
});

caso('Saldo menor al total (350 vs 300 + 200): la primera línea se liquida, la segunda queda parcial y el saldo en 0', async () => {
  const ctx = crearContexto();
  sembrarSaldo(ctx, 'ACME', [200, 150]);
  await ctx.C.generarCxCDesdeVenta('v1', venta('V-1', 'ACME', [300, 200]));
  const [a, b] = cuentasDe(ctx, 'v1');
  igual([a.saldo, a.estado, b.pagado, b.saldo, b.estado], [0, 'liquidado', 50, 150, 'parcial'], 'reparto línea por línea en orden');
  igual(ctx.S.saldoAFavorDisponibleCliente('ACME'), 0, 'saldo agotado');
  igual(ctx.col('clientes').get('ACME').saldoAFavor.slice(2).map((m) => m.monto), [-300, -50], 'movimientos negativos');
});

caso('Cliente sin saldo, o saldo ya consumido desde otra sesión, o sin conexión: las CxC se crean normales', async () => {
  const ctx = crearContexto();
  await ctx.C.generarCxCDesdeVenta('v1', venta('V-1', 'ACME', [300]));
  igual([ctx.estado.transacciones, cuentasDe(ctx, 'v1')[0].abonos.length, cuentasDe(ctx, 'v1')[0].estado], [0, 0, 'pendiente'], 'sin saldo: ni siquiera abre transacción');
  const ctx2 = crearContexto();
  sembrarSaldo(ctx2, 'ACME', [400]);
  ctx2.col('clientes').get('ACME').saldoAFavor.push({ revertido: false, monto: -400, fecha: '2026-11-01', motivo: 'otra sesión', grupoPagoId: 'gX' });
  await ctx2.C.generarCxCDesdeVenta('v2', venta('V-2', 'ACME', [300]));
  igual([cuentasDe(ctx2, 'v2').length, cuentasDe(ctx2, 'v2')[0].abonos.length, ctx2.col('clientes').get('ACME').saldoAFavor.length], [1, 0, 2], 'lectura fresca: no aplica lo que ya no existe');
  const ctx3 = crearContexto();
  sembrarSaldo(ctx3, 'ACME', [400]);
  ctx3.estado.enLinea = false;
  await ctx3.C.generarCxCDesdeVenta('v3', venta('V-3', 'ACME', [300]));
  igual([ctx3.estado.transacciones, cuentasDe(ctx3, 'v3')[0].abonos.length, ctx3.S.saldoAFavorDisponibleCliente('ACME')], [0, 0, 400], 'sin conexión: crea sin aplicar');
});

caso('Si la aplicación falla se crean las CxC sin aplicar, se avisa y el saldo queda intacto (nunca a medias)', async () => {
  const ctx = crearContexto();
  sembrarSaldo(ctx, 'ACME', [1000]);
  ctx.estado.fallaClientes = true;
  await ctx.C.generarCxCDesdeVenta('v1', venta('V-1', 'ACME', [300, 200]));
  const cuentas = cuentasDe(ctx, 'v1');
  igual([cuentas.length, cuentas.every((c) => c.abonos.length === 0 && c.saldo === c.total)], [2, true], 'CxC completas y sin aplicar');
  igual(ctx.col('clientes').get('ACME').saldoAFavor.length, 1, 'saldo sin movimientos nuevos');
  igual(ctx.w.EVE.cuentasPorCobrar.length, 2, 'memoria con las dos CxC');
  afirmar(ctx.errores.length === 1 && ctx.errores[0].includes('no se pudo aplicar el saldo a favor') && ctx.errores[0].includes('Aplicar saldo a favor'), 'aviso visible: ' + ctx.errores.join('|'));
});

caso('Editar o eliminar una venta con saldo a favor aplicado se bloquea con el mensaje de revertir ese abono; el bloqueo de editar va antes de tocar la venta', async () => {
  const ctx = crearContexto();
  sembrarSaldo(ctx, 'ACME', [1000]);
  await ctx.C.generarCxCDesdeVenta('v1', venta('V-1', 'ACME', [300, 200]));
  const e1 = await falla(ctx.C.regenerarCxCDesdeVenta('v1', venta('V-1', 'ACME', [100])), 'revierte primero ese abono', 'regenerar');
  afirmar(e1.message.includes('saldo a favor aplicado'), 'menciona el saldo a favor');
  let error;
  try { ctx.C.validarVentaEditable('v1'); } catch (e) { error = e; }
  afirmar(error && error.message.includes('saldo a favor aplicado'), 'validarVentaEditable bloquea');
  const e2 = await falla(ctx.C.eliminarVentaConCxC({ id: 'v1', folio: 'V-1', cliente: 'ACME' }, 'prueba'), 'saldo a favor aplicado', 'eliminar');
  igual(e2.code, 'cxc-con-cobros', 'mismo código de error de siempre');
  igual(cuentasDe(ctx, 'v1').length, 2, 'las CxC no se tocaron');
  const f = leer('js/ventas.js').replace(/\r\n/g, '\n');
  const i = f.indexOf("EVE_CXC.validarVentaEditable(editandoId)");
  afirmar(i > 0 && i < f.indexOf("actualizarDato('ventas', editandoId, ventaConstruida)"), 'ventas.js valida ANTES de actualizar la venta');
  // Una venta sin abonos sí se puede editar.
  const ctx2 = crearContexto();
  await ctx2.C.generarCxCDesdeVenta('v2', venta('V-2', 'ACME', [300]));
  ctx2.C.validarVentaEditable('v2');
  await ctx2.C.regenerarCxCDesdeVenta('v2', venta('V-2', 'ACME', [100]));
  igual(cuentasDe(ctx2, 'v2').map((c) => c.total), [100], 'se regeneró');
});

caso('Revertir el abono automático devuelve el saldo solo y desbloquea la edición', async () => {
  const ctx = crearContexto();
  sembrarSaldo(ctx, 'ACME', [1000]);
  await ctx.C.generarCxCDesdeVenta('v1', venta('V-1', 'ACME', [300, 200]));
  igual(ctx.S.saldoAFavorDisponibleCliente('ACME'), 500, 'antes de revertir');
  for (const c of cuentasDe(ctx, 'v1')) await ctx.C.revertirAbonoCxC(c.id, c.abonos[0].abonoId, 'venta mal capturada', 'tester');
  igual(ctx.S.saldoAFavorDisponibleCliente('ACME'), 1000, 'el saldo vuelve solo');
  igual(cuentasDe(ctx, 'v1').map((c) => [c.saldo, c.abonos.length, c.abonosRevertidos.length]), [[300, 0, 1], [200, 0, 1]], 'CxC con su saldo y abonos en revertidos');
  ctx.C.validarVentaEditable('v1');
  await ctx.C.regenerarCxCDesdeVenta('v1', venta('V-1', 'ACME', [250]));
  igual(cuentasDe(ctx, 'v1').map((c) => [c.total, c.saldo]), [[250, 0]], 'al regenerar se vuelve a aplicar el saldo');
});

caso('Cuadratura: cobros + saldo CxC = ventas + saldo a favor pendiente, y vuelve a cuadrar al aplicarse', async () => {
  const ctx = crearContexto();
  const c1 = { id: 'c1', ventaId: 'v0', folio: 'V-0', cliente: 'ACME', material: 'PET', cantidad: 10, unidad: 'KG', total: 1000, pagado: 0, saldo: 1000, estado: 'pendiente', ivaTrasladado: 0, lineaIndex: 0, abonos: [], abonosRevertidos: [], fechaVenta: '2026-10-01' };
  ctx.col('cuentas_por_cobrar').set('c1', JSON.parse(JSON.stringify({ ...c1, id: undefined })));
  ctx.w.EVE.cuentasPorCobrar.push(c1);
  let c = cuadra(ctx);
  igual(c.izquierda, c.derecha, 'inicial');
  await ctx.C.registrarCobroFactura('ACME', 'v0', { monto: 1500, fecha: '2026-11-02', referencia: 'Transferencia' });
  c = cuadra(ctx);
  igual([c.izquierda, c.derecha, ctx.S.saldoAFavorDisponibleCliente('ACME')], [1500, 1500, 500], 'con anticipo pendiente: 1,500 = 1,000 + 500');
  await ctx.C.generarCxCDesdeVenta('v1', venta('V-1', 'ACME', [500]));
  c = cuadra(ctx);
  igual([c.izquierda, c.derecha, ctx.S.saldoAFavorDisponibleCliente('ACME')], [1500, 1500, 0], 'al aplicarse el anticipo: 1,500 = 1,500 + 0');
  const cuenta = cuentasDe(ctx, 'v1')[0];
  await ctx.C.revertirAbonoCxC(cuenta.id, cuenta.abonos[0].abonoId, 'x', 'tester');
  c = cuadra(ctx);
  igual([c.izquierda, c.derecha], [2000, 2000], 'al revertir la aplicación vuelve a cuadrar (1,500 + 500 = 1,500 + 500)');
  afirmar(!/cuadratura/i.test(leer('js/dashboard.js')), 'el Dashboard no muestra cuadratura: no hay línea que agregar');
});

caso('Flujo no cuenta la aplicación automática como entrada de efectivo', async () => {
  const ctx = crearContexto();
  const c1 = { id: 'c1', ventaId: 'v0', folio: 'V-0', cliente: 'ACME', material: 'PET', cantidad: 10, unidad: 'KG', total: 600, pagado: 0, saldo: 600, estado: 'pendiente', ivaTrasladado: 0, lineaIndex: 0, abonos: [], abonosRevertidos: [], fechaVenta: '2026-10-01' };
  ctx.col('cuentas_por_cobrar').set('c1', JSON.parse(JSON.stringify({ ...c1, id: undefined })));
  ctx.w.EVE.cuentasPorCobrar.push(c1);
  await ctx.C.registrarCobroFactura('ACME', 'v0', { monto: 1000, fecha: '2026-11-02', referencia: 'Transferencia' });
  const antes = ctx.w.EVE_FLUJO.construirMovimientosFlujo({ cobros: ctx.w.EVE.cobros });
  await ctx.C.generarCxCDesdeVenta('v1', venta('V-1', 'ACME', [400]));
  const despues = ctx.w.EVE_FLUJO.construirMovimientosFlujo({ cobros: ctx.w.EVE.cobros });
  igual(despues.map((m) => [m.concepto, m.entrada]), antes.map((m) => [m.concepto, m.entrada]), 'mismos movimientos antes y después de aplicar');
  igual(despues.reduce((s, m) => s + m.entrada, 0), 1000, 'el efectivo entró completo una sola vez (cobro 600 + anticipo 400)');
});

(async () => {
  let fallidos = 0;
  for (const c of casos) {
    try { await c.fn(); console.log('ok   ' + c.nombre); } catch (e) { fallidos++; console.error('FALLA ' + c.nombre + ': ' + e.message); }
  }
  console.log(`\n${casos.length - fallidos}/${casos.length} casos correctos`);
  process.exit(fallidos ? 1 : 0);
})();
