// Sobrante de cobros como anticipo de cliente (js/cxc.js + js/saldo-clientes.js + js/cobros.js + js/flujo.js).
// Carga en un contexto vm los js/ reales con un Firestore simulado en memoria y comprueba:
//  - cobro por folio y cobro general con sobrante (documento anticipo en cobros + movimiento positivo en clientes, mismo grupoPagoId),
//    cliente sin deuda, fallos parciales y atomicidad del cobro por folio;
//  - la confirmación del sobrante;
//  - reverso conjunto, bloqueo cuando el anticipo ya se aplicó y reversión del anticipo desde Cobros;
//  - Flujo de efectivo y Posición de IVA del Dashboard con y sin anticipos (sin NaN, cifras previas intactas).
// Uso: node scripts/verificar-sobrante-anticipo-cliente.js   (código de salida 1 si algún caso falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
const ARCHIVOS = ['config.js', 'utils.js', 'permisos.js', 'cxp.js', 'saldo-clientes.js', 'cxc.js', 'cobros.js', 'flujo.js', 'rendimientos.js', 'dashboard.js'];
const MSG_CONSUMIDO = 'Este anticipo ya fue aplicado a otra cuenta. Revierte primero ese abono';

function crearContexto() {
  const colecciones = {};
  const col = (n) => (colecciones[n] = colecciones[n] || new Map());
  let secuencia = 0;
  const copia = (o) => JSON.parse(JSON.stringify(o));
  const fallos = { clientes: false, anticipoCobro: false };
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
      const escrituras = [];
      const tx = {
        get: async (r) => snap(r),
        set: (r, d, op) => {
          if (r.col === 'clientes' && fallos.clientes) throw new Error('Firestore no disponible');
          escrituras.push(() => col(r.col).set(r.id, op && op.merge ? { ...(col(r.col).get(r.id) || {}), ...copia(d) } : copia(d)));
        },
        update: (r, d) => escrituras.push(() => col(r.col).set(r.id, { ...col(r.col).get(r.id), ...copia(d) }))
      };
      const resultado = await fn(tx);
      escrituras.forEach((e) => e());
      return resultado;
    }
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { getElementById: () => null, createElement: () => ({}) },
    navigator: { onLine: true },
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
  w.guardarDato = async (c, d) => {
    if (c === 'cobros' && d.origen === 'anticipo' && fallos.anticipoCobro) throw new Error('sin red');
    const id = `${c}_${++secuencia}`;
    col(c).set(id, copia(d));
    return id;
  };
  w.actualizarDato = async (c, id, cambios) => { col(c).set(id, { ...col(c).get(id), ...copia(cambios) }); };
  return { w, col, fallos, errores, historial, C: w.EVE_CXC, S: w.EVE_SALDO_CLIENTES };
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
const FECHA = '2026-11-02';
const cobrar = (ctx, cliente, ventaId, monto) => ctx.C.registrarCobroFactura(cliente, ventaId, { monto, fecha: FECHA, referencia: 'Transferencia' });

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(c, m) { if (!c) throw new Error(m); }
function igual(real, esperado, m) { afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`); }
async function falla(promesa, texto, m) {
  try { await promesa; } catch (e) { afirmar(e.message.includes(texto), `${m}: mensaje "${e.message}"`); return; }
  throw new Error(`${m}: no lanzó error`);
}
function extraerFuncion(fuente, nombre) {
  const texto = fuente.replace(/\r\n/g, '\n');
  const i = texto.indexOf(`function ${nombre}(`);
  afirmar(i >= 0, `no se encontró ${nombre}`);
  return texto.slice(i, texto.indexOf('\n}\n', i) + 3);
}

// ── Cobro por folio ──────────────────────────────────────────────────────────────────────────────────────────────────

caso('Folio V-2026-053: debe 38,304 y paga 40,000 → cobro 38,304 + anticipo 1,696 (documento en cobros y movimiento en clientes)', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v53', 'V-2026-053', 'ACME', 38304)]);
  const r = await cobrar(ctx, 'ACME', 'v53', 40000);
  igual([r.total, r.sobrante, r.partidas], [38304, 1696, 1], 'resultado');
  const cobros = [...ctx.col('cobros').values()];
  igual(cobros.length, 2, 'dos documentos en cobros');
  const normal = cobros.find((c) => c.origen === 'cxc_cobro_factura');
  const anticipo = cobros.find((c) => c.origen === 'anticipo');
  igual(normal.pagado, 38304, 'cobro topado al saldo');
  igual([anticipo.cxcId, anticipo.cliente, anticipo.folio, anticipo.fecha, anticipo.pagado, anticipo.iva, anticipo.revertido], ['', 'ACME', 'V-2026-053', FECHA, 1696, 0, false], 'documento anticipo');
  const mov = ctx.col('clientes').get('ACME').saldoAFavor;
  igual(mov.length, 1, 'un movimiento');
  igual([mov[0].monto, mov[0].motivo, mov[0].revertido], [1696, 'Sobrante de cobro folio V-2026-053', false], 'movimiento positivo');
  igual([normal.grupoPagoId === anticipo.grupoPagoId, anticipo.grupoPagoId === mov[0].grupoPagoId, !!mov[0].grupoPagoId], [true, true, true], 'mismo grupoPagoId');
  igual(ctx.col('cuentas_por_cobrar').get('c1').saldo, 0, 'CxC liquidada');
  igual(ctx.w.EVE.cobros.length, 2, 'memoria de cobros');
  igual(ctx.S.saldoAFavorDisponibleCliente('ACME'), 1696, 'saldo en memoria');
  afirmar(ctx.historial.some((h) => h.coleccion === 'clientes' && h.accion === 'alta'), 'alta en historial');
});

caso('Folio exacto: sin anticipo ni documento en clientes; varias partidas con sobrante respetan el tope de cada una', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 500)]);
  const r = await cobrar(ctx, 'ACME', 'v1', 500);
  igual(r.sobrante, 0, 'sin sobrante');
  igual([ctx.col('cobros').size, ctx.col('clientes').size], [1, 0], 'sin anticipo');
  const ctx2 = crearContexto();
  sembrar(ctx2, [cuenta('a', 'v2', 'V-2', 'ACME', 300, { lineaIndex: 0 }), cuenta('b', 'v2', 'V-2', 'ACME', 200, { lineaIndex: 1 })]);
  const r2 = await cobrar(ctx2, 'ACME', 'v2', 650);
  igual([r2.total, r2.sobrante, r2.partidas], [500, 150, 2], 'dos partidas topadas');
  igual([ctx2.col('cuentas_por_cobrar').get('a').saldo, ctx2.col('cuentas_por_cobrar').get('b').saldo], [0, 0], 'ambas liquidadas');
});

caso('Folio: todo ocurre en una transacción; si falla el movimiento de clientes no se escribe nada', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600)]);
  ctx.fallos.clientes = true;
  await falla(cobrar(ctx, 'ACME', 'v1', 700), 'Firestore no disponible', 'falla la transacción');
  igual(ctx.col('cobros').size, 0, 'sin cobros');
  igual(ctx.col('cuentas_por_cobrar').get('c1').saldo, 600, 'CxC intacta');
  igual(ctx.w.EVE.cobros.length, 0, 'memoria intacta');
});

// ── Cobro general ────────────────────────────────────────────────────────────────────────────────────────────────────

caso('General con sobrante: reparte lo adeudado y registra el anticipo con el mismo grupoPagoId', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600), cuenta('c2', 'v2', 'V-2', 'ACME', 400, { fechaVenta: '2026-10-02' })]);
  const r = await ctx.C.registrarCobroGeneral('ACME', 1200, FECHA, 'Efectivo', 'tester', '');
  igual([r.sobrante, r.sobranteRegistrado], [200, 200], 'resultado');
  const cobros = [...ctx.col('cobros').values()];
  igual(cobros.filter((c) => c.origen === 'cxc_cobro_general').reduce((s, c) => s + c.pagado, 0), 1000, 'cobros = lo adeudado');
  const anticipo = cobros.find((c) => c.origen === 'anticipo');
  const mov = ctx.col('clientes').get('ACME').saldoAFavor[0];
  igual([anticipo.pagado, anticipo.cxcId, mov.monto, mov.motivo], [200, '', 200, 'Sobrante de cobro'], 'anticipo y movimiento');
  afirmar(cobros.every((c) => c.grupoPagoId === mov.grupoPagoId), 'mismo grupoPagoId en todo');
});

caso('General sin sobrante: no crea anticipo; cliente sin deuda: todo el monto va a saldo a favor', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600)]);
  const r = await ctx.C.registrarCobroGeneral('ACME', 600, FECHA, 'Efectivo', 'tester', '');
  igual([r.sobrante, r.sobranteRegistrado, ctx.col('clientes').size], [0, 0, 0], 'sin anticipo');
  const ctx2 = crearContexto();
  const r2 = await ctx2.C.registrarCobroGeneral('BETA', 500, FECHA, 'Efectivo', 'tester', '');
  igual([r2.actualizaciones.length, r2.sobranteRegistrado], [0, 500], 'cliente sin cuentas');
  const anticipo = [...ctx2.col('cobros').values()][0];
  igual([anticipo.origen, anticipo.pagado, anticipo.cliente], ['anticipo', 500, 'BETA'], 'anticipo íntegro');
  igual(ctx2.S.saldoAFavorDisponibleCliente('BETA'), 500, 'saldo a favor');
});

caso('General: si falla guardar el saldo después de abonar, no se revierte nada y se avisa para registrarlo a mano', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600)]);
  ctx.fallos.clientes = true;
  const r = await ctx.C.registrarCobroGeneral('ACME', 700, FECHA, 'Efectivo', 'tester', '');
  igual(r.sobranteRegistrado, 0, 'no se registró el sobrante');
  igual(ctx.col('cuentas_por_cobrar').get('c1').saldo, 0, 'el abono se conserva');
  igual([...ctx.col('cobros').values()].map((c) => c.origen), ['cxc_cobro_general'], 'sin documento anticipo');
  afirmar(ctx.errores.some((e) => e.includes('Regístralo manualmente')), 'aviso visible: ' + ctx.errores.join('|'));
});

caso('General: si falla el documento en cobros, el saldo a favor queda y se avisa', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600)]);
  ctx.fallos.anticipoCobro = true;
  const r = await ctx.C.registrarCobroGeneral('ACME', 700, FECHA, 'Efectivo', 'tester', '');
  igual([r.sobranteRegistrado, ctx.S.saldoAFavorDisponibleCliente('ACME')], [100, 100], 'saldo guardado');
  afirmar(ctx.errores.some((e) => e.includes('no se pudo registrar en Cobros')), 'aviso visible');
});

// ── Confirmación ─────────────────────────────────────────────────────────────────────────────────────────────────────

caso('Confirmación del sobrante: pide confirmar con cliente y monto; sin confirmar no continúa; sin sobrante no pregunta', () => {
  const fuente = leer('js/cxc.js');
  const llamadas = [];
  const w = { confirm: (t) => { llamadas.push(t); return w.respuesta; }, respuesta: true, formatearMoneda: (v) => `$${v}` };
  const ctx = vm.createContext({ window: w, Math });
  vm.runInContext(extraerFuncion(fuente, 'confirmarSobranteCobro') + '\nthis.f = confirmarSobranteCobro;', ctx);
  igual(ctx.f('ACME', 500, 500), true, 'exacto');
  igual(ctx.f('ACME', 500.005, 500), true, 'tolerancia de centavos');
  igual(llamadas.length, 0, 'sin sobrante no pregunta');
  igual(ctx.f('ACME', 1200, 1000), true, 'con sobrante y confirmado');
  afirmar(llamadas[0].includes('ACME') && llamadas[0].includes('$200') && llamadas[0].includes('saldo a favor'), 'texto con cliente y monto: ' + llamadas[0]);
  w.respuesta = false;
  igual(ctx.f('ACME', 1200, 1000), false, 'sin confirmar no continúa');
  ctx.f('BETA', 500, 0);
  afirmar(llamadas[2].includes('BETA no tiene cuentas pendientes') && llamadas[2].includes('$500'), 'cliente sin deuda: ' + llamadas[2]);
});

caso('manejarEnvioPago confirma antes de escribir, ya no rechaza clientes sin deuda y usa el aviso nuevo', () => {
  const f = leer('js/cxc.js').replace(/\r\n/g, '\n');
  const cuerpo = f.slice(f.indexOf('async function manejarEnvioPago'));
  afirmar(cuerpo.indexOf('confirmarSobranteCobro(') < cuerpo.indexOf('await registrarCobroFactura('), 'confirma antes del cobro por folio');
  const iGeneral = cuerpo.indexOf('await registrarCobroGeneral(');
  afirmar(cuerpo.lastIndexOf('confirmarSobranteCobro(', iGeneral) > 0 && cuerpo.lastIndexOf('confirmarSobranteCobro(', iGeneral) < iGeneral, 'confirma antes del cobro general');
  afirmar(!cuerpo.includes('no tiene cuentas pendientes`)'), 'ya no rechaza al cliente sin cuentas pendientes');
  afirmar(!f.includes('Sobrante sin aplicar') && f.includes('quedó registrado como saldo a favor de'), 'aviso final nuevo');
  afirmar(!f.includes('excede el saldo de la factura (') && !f.includes("if (excede) resumen.style.color = '#c0392b'"), 'sin rechazo por exceso ni aviso rojo');
  afirmar(!/botonGuardar\.disabled = excede/.test(f), 'Guardar queda habilitado con sobrante');
});

// ── Reverso conjunto ─────────────────────────────────────────────────────────────────────────────────────────────────

caso('Revertir el abono revierte el cobro, el anticipo (sin cxcId) y el movimiento de clientes', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600)]);
  await cobrar(ctx, 'ACME', 'v1', 700);
  const abono = ctx.w.EVE.cuentasPorCobrar[0].abonos[0];
  await ctx.C.revertirAbonoCxC('c1', abono.abonoId, 'error de captura', 'tester');
  const cobros = [...ctx.col('cobros').values()];
  igual(cobros.map((c) => c.revertido), [true, true], 'cobro y anticipo revertidos');
  igual(ctx.col('clientes').get('ACME').saldoAFavor[0].revertido, true, 'movimiento revertido');
  igual(ctx.col('cuentas_por_cobrar').get('c1').saldo, 600, 'CxC con su saldo');
  igual(ctx.S.saldoAFavorDisponibleCliente('ACME'), 0, 'sin saldo a favor');
  igual(ctx.col('cobros').size, 2, 'no se borra nada');
});

caso('Si el anticipo ya se aplicó, revertir el cobro se bloquea con el mensaje de CxP y no modifica nada', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600), cuenta('c2', 'v2', 'V-2', 'ACME', 500)]);
  await cobrar(ctx, 'ACME', 'v1', 700);
  await ctx.S.aplicarSaldoAFavorACuentasCliente('ACME', [{ id: 'c2', monto: 100 }]);
  const abono = ctx.w.EVE.cuentasPorCobrar.find((c) => c.id === 'c1').abonos[0];
  await falla(ctx.C.revertirAbonoCxC('c1', abono.abonoId, 'x', 'tester'), MSG_CONSUMIDO, 'bloqueo');
  igual(ctx.col('cuentas_por_cobrar').get('c1').abonos.length, 1, 'abono vigente');
  igual([...ctx.col('cobros').values()].map((c) => !!c.revertido), [false, false], 'cobros sin revertir');
  igual(ctx.col('clientes').get('ACME').saldoAFavor.map((m) => !!m.revertido), [false, false], 'movimientos sin revertir');
  // Al revertir primero la aplicación, el saldo vuelve solo y ya se puede revertir el cobro.
  const aplicado = ctx.col('cuentas_por_cobrar').get('c2').abonos[0];
  await ctx.C.revertirAbonoCxC('c2', aplicado.abonoId, 'corregir', 'tester');
  igual(ctx.S.saldoAFavorDisponibleCliente('ACME'), 100, 'el saldo vuelve');
  await ctx.C.revertirAbonoCxC('c1', abono.abonoId, 'ahora sí', 'tester');
  igual([...ctx.col('cobros').values()].every((c) => c.revertido === true), true, 'cobro y anticipo revertidos');
});

caso('Aplicar el saldo a una cuenta no crea cobro: Flujo no cuenta la aplicación como entrada', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600), cuenta('c2', 'v2', 'V-2', 'ACME', 500)]);
  await cobrar(ctx, 'ACME', 'v1', 700);
  const antes = ctx.col('cobros').size;
  await ctx.S.aplicarSaldoAFavorACuentasCliente('ACME', [{ id: 'c2', monto: 100 }]);
  igual(ctx.col('cobros').size, antes, 'sin cobros nuevos');
});

caso('Anticipo desde la lista de Cobros: se revierte; bloqueado si ya se aplicó; solo aplica a anticipos', async () => {
  const ctx = crearContexto();
  sembrar(ctx, [cuenta('c1', 'v1', 'V-1', 'ACME', 600), cuenta('c2', 'v2', 'V-2', 'ACME', 500)]);
  await cobrar(ctx, 'ACME', 'v1', 700);
  const anticipo = ctx.w.EVE.cobros.find((c) => c.origen === 'anticipo');
  const normal = ctx.w.EVE.cobros.find((c) => c.origen === 'cxc_cobro_factura');
  await falla(ctx.C.revertirAnticipoCobro(normal.id, 'x', 'tester'), 'no es un anticipo', 'cobro normal');
  await ctx.S.aplicarSaldoAFavorACuentasCliente('ACME', [{ id: 'c2', monto: 50 }]);
  await falla(ctx.C.revertirAnticipoCobro(anticipo.id, 'x', 'tester'), MSG_CONSUMIDO, 'anticipo consumido');
  const ctx2 = crearContexto();
  sembrar(ctx2, [cuenta('c1', 'v1', 'V-1', 'ACME', 600)]);
  await cobrar(ctx2, 'ACME', 'v1', 700);
  const a2 = ctx2.w.EVE.cobros.find((c) => c.origen === 'anticipo');
  await ctx2.C.revertirAnticipoCobro(a2.id, 'mal capturado', 'tester');
  igual([ctx2.col('cobros').get(a2.id).revertido, ctx2.col('clientes').get('ACME').saldoAFavor[0].revertido, ctx2.S.saldoAFavorDisponibleCliente('ACME')], [true, true, 0], 'anticipo revertido');
  igual(ctx2.col('cuentas_por_cobrar').get('c1').saldo, 0, 'el cobro de la factura sigue vigente');
});

caso('cobroTieneVinculoActivo considera el saldo a favor de clientes; la lista de Cobros ofrece Revertir en anticipos', () => {
  const ctx = crearContexto();
  const f = ctx.w.EVE_COBROS.cobroTieneVinculoActivo;
  ctx.w.EVE.clientes = [{ nombre: 'ACME', saldoAFavor: [{ grupoPagoId: 'g1', monto: 10, revertido: false }, { grupoPagoId: 'g2', monto: 10, revertido: true }] }];
  igual([f('g1'), f('g2'), f('g3'), f('')], [true, false, false, false], 'vínculo con clientes[].saldoAFavor');
  ctx.w.EVE.clientes = undefined;
  igual(f('g1'), false, 'sin clientes cargados no falla');
  const c = leer('js/cobros.js');
  afirmar(c.includes("registro.origen === 'anticipo'") && c.includes('revertirAnticipoCobro'), 'botón Revertir para anticipos');
});

// ── Flujo y Dashboard con y sin anticipos ───────────────────────────────────────────────────────────────────────────

caso('Flujo: el anticipo es entrada de efectivo "Anticipo cliente"; revertido no cuenta; sin anticipos nada cambia', () => {
  const { w } = crearContexto();
  const normal = { id: 'n', cliente: 'ACME', folio: 'V-1', pagado: 1000, iva: 0, fecha: '2026-11-01', origen: 'cxc_cobro_factura', cxcId: 'c1' };
  const anticipo = { id: 'a', cliente: 'ACME', folio: 'V-1', pagado: 200, iva: 0, fecha: '2026-11-01', origen: 'anticipo', cxcId: '' };
  const revertido = { ...anticipo, id: 'r', pagado: 999, revertido: true };
  const sin = w.EVE_FLUJO.construirMovimientosFlujo({ cobros: [normal] });
  igual(sin.map((m) => [m.concepto, m.entrada, m.salida, m.saldo]), [['Cobro', 1000, 0, 1000]], 'sin anticipos: igual que hoy');
  const con = w.EVE_FLUJO.construirMovimientosFlujo({ cobros: [normal, anticipo, revertido] });
  igual(con.map((m) => [m.concepto, m.entrada]), [['Cobro', 1000], ['Anticipo cliente', 200]], 'con anticipo (el revertido no entra)');
  afirmar(con.every((m) => Number.isFinite(m.entrada) && Number.isFinite(m.saldo)), 'sin NaN');
  igual(con[con.length - 1].saldo, 1200, 'saldo acumulado');
});

caso('Dashboard: Posición de IVA con un cobro anticipo (sin cxcId) no produce NaN y deja las cifras iguales', () => {
  const { w } = crearContexto();
  const iva = { fecha: '2026-10-15', cxcId: 'c1', iva: 160, pagado: 1160 };
  w.EVE.cobros = [iva];
  const sin = JSON.stringify(w.EVE_DASHBOARD.calcularVistaPosicionIva());
  w.EVE.cobros = [iva, { fecha: '2026-10-15', cxcId: '', origen: 'anticipo', pagado: 200, iva: 0 }, { fecha: '2026-10-16', origen: 'anticipo', pagado: 50 }];
  const con = JSON.stringify(w.EVE_DASHBOARD.calcularVistaPosicionIva());
  igual(con, sin, 'cifras idénticas con anticipos');
  afirmar(!con.includes('null') && !/NaN/.test(con), 'sin NaN');
  const d = leer('js/dashboard.js');
  afirmar(!/cuadratura/i.test(d) && !/Cobrado/.test(d), 'el Dashboard no tiene KPI Cobrado ni cuadratura que ajustar');
});

(async () => {
  let fallidos = 0;
  for (const c of casos) {
    try { await c.fn(); console.log('ok   ' + c.nombre); } catch (e) { fallidos++; console.error('FALLA ' + c.nombre + ': ' + e.message); }
  }
  console.log(`\n${casos.length - fallidos}/${casos.length} casos correctos`);
  process.exit(fallidos ? 1 : 0);
})();
