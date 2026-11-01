// Verifica el sobrante de cobros como saldo a favor (js/cxc.js + js/saldos-cliente.js) y el bloqueo de reversión.
// Carga en un contexto vm los js/ reales con un Firestore simulado en memoria.
// Uso: node scripts/verificar-sobrante-cobro.js   (código de salida 1 si algún caso falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js', 'js/saldos-cliente.js', 'js/cxc.js'];
const MSG_BLOQUEO = 'Este saldo ya se aplicó a una venta; revierte primero esa aplicación.';

function crearContexto() {
  const colecciones = {};
  const col = (n) => (colecciones[n] = colecciones[n] || new Map());
  let secuencia = 0;
  const copia = (o) => JSON.parse(JSON.stringify(o));
  const fallos = { saldos_cliente: false };
  const db = {
    collection: (nombre) => ({
      doc: (id) => ({ col: nombre, id: id || `${nombre}_${++secuencia}` }),
      where: (campo, _op, valor) => ({
        get: async () => ({ docs: [...col(nombre).entries()].filter(([, d]) => d[campo] === valor).map(([id, d]) => ({ id, data: () => copia(d) })) })
      })
    }),
    runTransaction: async (fn) => {
      const escrituras = [];
      const tx = {
        get: async (r) => ({ exists: col(r.col).has(r.id), id: r.id, data: () => copia(col(r.col).get(r.id)) }),
        update: (r, c) => escrituras.push(() => col(r.col).set(r.id, { ...col(r.col).get(r.id), ...copia(c) })),
        set: (r, d) => escrituras.push(() => col(r.col).set(r.id, copia(d)))
      };
      const resultado = await fn(tx);
      escrituras.forEach((e) => e());
      return resultado;
    }
  };
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { getElementById: () => null },
    navigator: { onLine: true },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { cuentasPorCobrar: [], cobros: [], saldosCliente: [], currentUser: { username: 'tester' }, proveedores: [] };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  const w = sandbox.window;
  w.db = db;
  w.puedeEscribir = () => true;
  w.obtenerFechaMexico = () => '2026-11-01';
  w.EVE_HISTORIAL = { registrar: async () => {} };
  w.guardarDato = async (c, d) => {
    if (fallos[c]) throw new Error('Firestore no disponible');
    const id = `${c}_${++secuencia}`;
    col(c).set(id, copia(d));
    return id;
  };
  w.actualizarDato = async (c, id, cambios) => { col(c).set(id, { ...col(c).get(id), ...copia(cambios) }); };
  return { w, col, fallos };
}

function cuenta(id, ventaId, folio, cliente, total, extra) {
  return { id, ventaId, folio, cliente, material: 'PET', cantidad: 10, unidad: 'KG', total, pagado: 0, saldo: total, estado: 'pendiente', ivaTrasladado: 0, lineaIndex: 0, abonos: [], abonosRevertidos: [], fechaVenta: '2026-10-01', ...extra };
}

function sembrar(ctx, cuentas) {
  cuentas.forEach((c) => {
    const { id, ...datos } = c;
    ctx.col('cuentas_por_cobrar').set(id, JSON.parse(JSON.stringify(datos)));
    ctx.w.EVE.cuentasPorCobrar.push(JSON.parse(JSON.stringify(c)));
  });
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(c, m) { if (!c) throw new Error(m); }
function igual(real, esperado, m) { afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`); }
async function falla(promesa, texto, m) {
  try { await promesa; } catch (e) { afirmar(e.message.includes(texto), `${m}: mensaje "${e.message}"`); return; }
  throw new Error(`${m}: no lanzó error`);
}

caso('V-2026-053: debe 38,304, paga 40,000 → cobro 38,304 y saldo a favor 1,696', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v53', 'V-2026-053', 'ACME', 38304)]);
  const r = await ctx.w.EVE_CXC.registrarCobroFactura('ACME', 'v53', { monto: 40000, fecha: '2026-11-01', referencia: 'Transferencia' });
  igual(r.total, 38304, 'aplicado');
  igual(r.sobrante, 1696, 'sobrante devuelto');
  const cobros = [...ctx.col('cobros').values()];
  igual(cobros.map((c) => c.pagado), [38304], 'cobro tope al saldo');
  const saldos = [...ctx.col('saldos_cliente').values()];
  afirmar(saldos.length === 1, 'un saldo a favor');
  igual([saldos[0].monto, saldos[0].origen, saldos[0].cliente, saldos[0].fecha, saldos[0].folio], [1696, 'cobro_sobrante', 'ACME', '2026-11-01', 'V-2026-053'], 'datos del saldo');
  afirmar(saldos[0].grupoPagoId && saldos[0].grupoPagoId === cobros[0].grupoPagoId, 'mismo grupoPagoId que el cobro');
  igual(ctx.col('cuentas_por_cobrar').get('c1').saldo, 0, 'CxC liquidada');
});

caso('Cobro por folio exacto: sin saldo a favor', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 500)]);
  const r = await ctx.w.EVE_CXC.registrarCobroFactura('ACME', 'v1', { monto: 500, fecha: '2026-11-01', referencia: 'Efectivo' });
  igual(r.sobrante, 0, 'sin sobrante');
  igual(ctx.col('saldos_cliente').size, 0, 'no se crea saldo');
});

caso('Cobro general con sobrante: reparte lo adeudado y guarda el resto con el grupoPagoId del cobro', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600), cuenta('c2', 'v2', 'V-2', 'ACME', 400, { fechaVenta: '2026-10-02' })]);
  const r = await ctx.w.EVE_CXC.registrarCobroGeneral('ACME', 1200, '2026-11-01', 'Efectivo', 'tester', '');
  igual(r.sobrante, 200, 'sobrante');
  const cobros = [...ctx.col('cobros').values()];
  igual(cobros.reduce((s, c) => s + c.pagado, 0), 1000, 'cobros suman lo adeudado');
  const saldos = [...ctx.col('saldos_cliente').values()];
  igual([saldos.length, saldos[0].monto, saldos[0].origen, saldos[0].cliente, saldos[0].fecha], [1, 200, 'cobro_sobrante', 'ACME', '2026-11-01'], 'saldo');
  afirmar(cobros.every((c) => c.grupoPagoId === saldos[0].grupoPagoId), 'mismo grupoPagoId');
  const exacto = await ctx.w.EVE_CXC.registrarCobroGeneral('ACME', 0.01, '2026-11-01', 'Efectivo', 'tester', '').catch(() => null);
  afirmar(exacto === null || ctx.col('saldos_cliente').size === 1, 'sin pendiente no agrega saldo');
});

caso('Cobro general sin sobrante: no crea saldo', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600)]);
  const r = await ctx.w.EVE_CXC.registrarCobroGeneral('ACME', 600, '2026-11-01', 'Efectivo', 'tester', '');
  igual(r.sobrante, 0, 'sobrante 0');
  igual(ctx.col('saldos_cliente').size, 0, 'sin saldo');
});

caso('Falla al crear el saldo (general): no se registra ningún cobro', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600)]);
  ctx.fallos.saldos_cliente = true;
  await falla(ctx.w.EVE_CXC.registrarCobroGeneral('ACME', 700, '2026-11-01', 'Efectivo', 'tester', ''), 'No se pudo guardar el sobrante', 'aviso');
  igual(ctx.col('cobros').size, 0, 'sin cobros');
  igual(ctx.w.EVE.cuentasPorCobrar[0].saldo, 600, 'CxC intacta en memoria');
  igual(ctx.col('cuentas_por_cobrar').get('c1').saldo, 600, 'CxC intacta en Firestore');
});

caso('Falla al crear el saldo (por folio): el cobro se deshace, no queda a medias', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600)]);
  ctx.fallos.saldos_cliente = true;
  await falla(ctx.w.EVE_CXC.registrarCobroFactura('ACME', 'v1', { monto: 700, fecha: '2026-11-01', referencia: 'Efectivo' }), 'El cobro se canceló', 'aviso');
  const doc = ctx.col('cuentas_por_cobrar').get('c1');
  igual([doc.saldo, doc.abonos.length], [600, 0], 'CxC restaurada');
  igual([...ctx.col('cobros').values()].every((c) => c.revertido === true), true, 'cobro marcado revertido');
});

caso('Reverso bloqueado si el saldo del cobro ya se aplicó; el cobro no se modifica', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600)]);
  await ctx.w.EVE_CXC.registrarCobroFactura('ACME', 'v1', { monto: 700, fecha: '2026-11-01', referencia: 'Efectivo' });
  const [saldoId] = [...ctx.col('saldos_cliente').keys()];
  await ctx.w.EVE_SALDOS_CLIENTE.aplicarSaldoCliente(saldoId, 50, 'cobroX', 'V-9');
  const abono = ctx.w.EVE.cuentasPorCobrar[0].abonos[0];
  await falla(ctx.w.EVE_CXC.revertirAbonoCxC('c1', abono.abonoId, 'error de captura', 'tester'), MSG_BLOQUEO, 'bloqueo con mensaje tal cual');
  const doc = ctx.col('cuentas_por_cobrar').get('c1');
  igual([doc.saldo, doc.abonos.length, (doc.abonosRevertidos || []).length], [0, 1, 0], 'CxC sin cambios');
  igual([...ctx.col('cobros').values()].map((c) => !!c.revertido), [false], 'cobro sin revertir');
  igual(ctx.col('saldos_cliente').get(saldoId).revertido, false, 'saldo sin revertir');
});

caso('Reverso permitido sin aplicaciones: revierte abono, cobro y saldo (no borra)', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600)]);
  await ctx.w.EVE_CXC.registrarCobroFactura('ACME', 'v1', { monto: 700, fecha: '2026-11-01', referencia: 'Efectivo' });
  const abono = ctx.w.EVE.cuentasPorCobrar[0].abonos[0];
  await ctx.w.EVE_CXC.revertirAbonoCxC('c1', abono.abonoId, 'error de captura', 'tester');
  igual([...ctx.col('saldos_cliente').values()].map((s) => s.revertido), [true], 'saldo revertido, sigue existiendo');
  igual([...ctx.col('cobros').values()].map((c) => c.revertido), [true], 'cobro revertido');
  igual(ctx.col('cuentas_por_cobrar').get('c1').saldo, 600, 'CxC con su saldo');
});

caso('Cobros: eliminar un cobro con grupoPagoId revisa el saldo antes de eliminarDato', () => {
  const f = fs.readFileSync(path.join(RAIZ, 'js/cobros.js'), 'utf8');
  const i = f.indexOf('revertirSaldoPorGrupo');
  afirmar(i > 0 && i < f.indexOf("eliminarDato('cobros', id)"), 'revertirSaldoPorGrupo antes de eliminarDato');
  afirmar(/if \(!saldo\.ok\) \{\s*window\.showError\(saldo\.error\);\s*return;/.test(f), 'si ok es false muestra el error y sale');
});

caso('Tarjeta de saldos: solo con saldos, botones solo con escritura en cxc, avisos con el texto pedido', () => {
  const f = fs.readFileSync(path.join(RAIZ, 'js/cxc.js'), 'utf8');
  afirmar(f.includes('quedó registrado como saldo a favor del cliente'), 'aviso del sobrante');
  afirmar(!f.includes('Sobrante sin aplicar'), 'sin el aviso viejo');
  afirmar(/if \(filas\.length === 0\) \{\s*if \(puedeEscribir\) contenedor\.appendChild\(boton\);\s*return;/.test(f), 'sin saldos no hay tarjeta');
  afirmar(f.includes("if (puedeEscribir) encabezado.appendChild(boton);"), 'botón Registrar con permiso');
  afirmar(f.includes("doc.origen === 'manual' && (doc.aplicaciones || []).length === 0 && window.puedeEscribir('cxc')"), 'eliminar solo manual, sin aplicaciones y con permiso');
  afirmar(f.includes("protegerContraDobleRegistro('cxc-saldo-manual'"), 'protección de doble registro');
  afirmar(f.includes('id="cxc-saldo-nota" placeholder="Nota (obligatoria)" required'), 'nota obligatoria');
});

(async () => {
  let fallidos = 0;
  for (const c of casos) {
    try { await c.fn(); console.log('ok   ' + c.nombre); } catch (e) { fallidos++; console.error('FALLA ' + c.nombre + ': ' + e.message); }
  }
  console.log(`\n${casos.length - fallidos}/${casos.length} casos correctos`);
  process.exit(fallidos ? 1 : 0);
})();
