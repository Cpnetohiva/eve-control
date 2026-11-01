// Verifica el saldo a favor de clientes (js/saldo-clientes.js): documento `clientes` con saldoAFavor[], igual que proveedores en CxP.
// Carga en un contexto vm los js/ reales (config, utils, cxp, saldo-clientes) con un Firestore simulado en memoria.
// Uso: node scripts/verificar-saldo-clientes.js   (código de salida 1 si algún caso falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js', 'js/saldo-clientes.js'];
const MSG_CONSUMIDO = 'Este anticipo ya fue aplicado a otra cuenta. Revierte primero ese abono';

function crearContexto() {
  const colecciones = {};
  const col = (n) => (colecciones[n] = colecciones[n] || new Map());
  const copia = (o) => JSON.parse(JSON.stringify(o));
  const historial = [];
  const ref = (c, id) => ({ col: c, id });
  const snap = (r) => ({ exists: col(r.col).has(r.id), id: r.id, data: () => copia(col(r.col).get(r.id)) });
  const db = {
    collection: (c) => ({ doc: (id) => ({ ...ref(c, id), get: async () => snap(ref(c, id)) }) }),
    runTransaction: async (fn) => {
      const escrituras = [];
      const tx = {
        get: async (r) => snap(r),
        set: (r, d, op) => escrituras.push(() => col(r.col).set(r.id, op && op.merge ? { ...(col(r.col).get(r.id) || {}), ...copia(d) } : copia(d))),
        update: (r, d) => escrituras.push(() => col(r.col).set(r.id, { ...col(r.col).get(r.id), ...copia(d) }))
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
  sandbox.window.EVE = { clientes: [], cuentasPorCobrar: [], cobros: [], proveedores: [], currentUser: { username: 'tester' } };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) vm.runInContext(leer(archivo), sandbox, { filename: archivo });
  const w = sandbox.window;
  w.db = db;
  w.puedeEscribir = () => true;
  w.obtenerFechaMexico = () => '2026-11-02';
  w.EVE_HISTORIAL = { registrar: async (e) => { historial.push(e); } };
  return { w, S: w.EVE_SALDO_CLIENTES, col, historial };
}

function sembrarCuenta(ctx, id, cliente, folio, total) {
  const doc = { ventaId: 'v' + id, folio, cliente, material: 'PET', total, pagado: 0, saldo: total, estado: 'pendiente', abonos: [], abonosRevertidos: [] };
  ctx.col('cuentas_por_cobrar').set(id, JSON.parse(JSON.stringify(doc)));
  ctx.w.EVE.cuentasPorCobrar.push({ id, ...doc });
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(c, m) { if (!c) throw new Error(m); }
function igual(real, esperado, m) { afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`); }
async function falla(promesa, texto, m) {
  try { await promesa; } catch (e) { afirmar(e.message.includes(texto), `${m}: mensaje "${e.message}"`); return; }
  throw new Error(`${m}: no lanzó error`);
}

caso('Clave de cliente: recorta y pasa a mayúsculas, igual que Ventas', () => {
  const { w, S } = crearContexto();
  igual(w.normalizarCliente('  acme sa '), 'ACME SA', 'normalizarCliente');
  igual(S.claveCliente('  acme sa '), 'ACME SA', 'claveCliente');
  afirmar(leer('js/ventas.js').includes('cliente: datos.cliente.toString().trim().toUpperCase()'), 'ventas.js guarda el cliente con la misma regla');
});

caso('Alta: movimiento positivo en clientes/{CLIENTE}, memoria e historial', async () => {
  const { S, w, col, historial } = crearContexto();
  await S.guardarSaldoAFavorCliente('  acme ', { monto: 500, fecha: '2026-11-02', motivo: 'Sobrante de cobro folio V-1', grupoPagoId: 'g1' });
  const doc = col('clientes').get('ACME');
  igual([doc.nombre, doc.saldoAFavor.length, doc.saldoAFavor[0].monto, doc.saldoAFavor[0].revertido, doc.saldoAFavor[0].grupoPagoId], ['ACME', 1, 500, false, 'g1'], 'documento');
  igual(w.EVE.clientes.map((c) => [c.nombre, c.saldoAFavor.length]), [['ACME', 1]], 'memoria');
  igual(S.saldoAFavorDisponibleCliente('acme'), 500, 'disponible');
  await S.guardarSaldoAFavorCliente('ACME', { monto: 250.5, fecha: '2026-11-03', motivo: 'Otro', grupoPagoId: 'g2' });
  igual(col('clientes').get('ACME').saldoAFavor.length, 2, 'se agrega al arreglo, no lo reemplaza');
  igual(S.saldoAFavorDisponibleCliente('ACME'), 750.5, 'disponible tras segundo anticipo');
  igual(historial.filter((h) => h.accion === 'alta' && h.coleccion === 'clientes' && h.registroId === 'ACME').length, 2, 'altas en historial');
  await falla(S.guardarSaldoAFavorCliente('  ', { monto: 1, grupoPagoId: 'x' }), 'cliente', 'sin cliente');
});

caso('Escritura con lectura fresca: no pisa lo que otra sesión escribió y la memoria no decide', async () => {
  const { S, col } = crearContexto();
  await S.guardarSaldoAFavorCliente('ACME', { monto: 100, fecha: '2026-11-02', motivo: 'a', grupoPagoId: 'g1' });
  const doc = col('clientes').get('ACME');
  col('clientes').set('ACME', { ...doc, saldoAFavor: [...doc.saldoAFavor, { revertido: false, monto: 40, fecha: '2026-11-02', motivo: 'otra sesión', grupoPagoId: 'gX' }] });
  await S.guardarSaldoAFavorCliente('ACME', { monto: 10, fecha: '2026-11-02', motivo: 'b', grupoPagoId: 'g2' });
  igual(col('clientes').get('ACME').saldoAFavor.map((m) => m.grupoPagoId), ['g1', 'gX', 'g2'], 'conserva el movimiento de la otra sesión');
});

caso('Saldo con movimientos revertidos y aplicaciones negativas', async () => {
  const { S, w } = crearContexto();
  const movs = [
    { revertido: false, monto: 1000, grupoPagoId: 'a' },
    { revertido: true, monto: 500, grupoPagoId: 'b' },
    { revertido: false, monto: -300, grupoPagoId: 'c' }
  ];
  igual(S.totalSaldoAFavorCliente(movs), 700, 'ignora revertidos y resta aplicaciones');
  igual(S.totalSaldoAFavorCliente(undefined), 0, 'sin arreglo');
  igual(w.EVE_CXP.totalSaldoAFavor(movs), 700, 'reutiliza EVE_CXP.totalSaldoAFavor');
});

caso('Reversión: marca revertido (no borra), actualiza memoria e historial; sin movimiento vigente no hace nada', async () => {
  const { S, w, col, historial } = crearContexto();
  await S.guardarSaldoAFavorCliente('ACME', { monto: 300, fecha: '2026-11-02', motivo: 'm', grupoPagoId: 'g1' });
  const ok = await S.revertirMovimientoSaldoAFavorClienteSiExiste('acme', 'g1', 'cobro mal capturado', 'tester');
  igual(ok, true, 'devuelve true');
  const mov = col('clientes').get('ACME').saldoAFavor[0];
  igual([mov.revertido, mov.revertidoMotivo, mov.revertidoPor, !!mov.fechaReversion], [true, 'cobro mal capturado', 'tester', true], 'movimiento revertido');
  igual(w.EVE.clientes[0].saldoAFavor[0].revertido, true, 'memoria');
  igual(S.saldoAFavorDisponibleCliente('ACME'), 0, 'saldo 0 tras revertir');
  igual(historial.filter((h) => h.accion === 'reversion').length, 1, 'historial de reversión');
  igual(await S.revertirMovimientoSaldoAFavorClienteSiExiste('ACME', 'g1', 'otra vez', 'tester'), false, 'ya revertido');
  igual(await S.revertirMovimientoSaldoAFavorClienteSiExiste('ACME', 'no-existe', 'x', 'tester'), false, 'grupo inexistente');
  igual(await S.revertirMovimientoSaldoAFavorClienteSiExiste('NADIE', 'g1', 'x', 'tester'), false, 'cliente inexistente');
  igual(await S.revertirMovimientoSaldoAFavorClienteSiExiste('ACME', '', 'x', 'tester'), false, 'sin grupoPagoId');
});

caso('Anticipo consumido: bloquea con el mensaje de CxP; con saldo suficiente o sin movimiento no bloquea', async () => {
  const { S, col } = crearContexto();
  await S.guardarSaldoAFavorCliente('ACME', { monto: 300, fecha: '2026-11-02', motivo: 'ant', grupoPagoId: 'ant1' });
  await S.validarAnticipoClienteNoConsumido('ACME', 'ant1');
  await S.guardarSaldoAFavorCliente('ACME', { monto: -250, fecha: '2026-11-02', motivo: 'aplic', grupoPagoId: 'ap1' });
  await falla(S.validarAnticipoClienteNoConsumido('ACME', 'ant1'), MSG_CONSUMIDO, 'consumido');
  await S.validarAnticipoClienteNoConsumido('ACME', 'ap1');
  await S.validarAnticipoClienteNoConsumido('ACME', 'desconocido');
  await S.validarAnticipoClienteNoConsumido('NADIE', 'ant1');
  await S.validarAnticipoClienteNoConsumido('ACME', '');
  col('clientes').get('ACME').saldoAFavor[1].revertido = true;
  await S.validarAnticipoClienteNoConsumido('ACME', 'ant1');
});

caso('Aplicar a cuentas: abono + movimiento negativo con el mismo grupoPagoId, sin documento en cobros', async () => {
  const ctx = crearContexto();
  const { S, w, col, historial } = ctx;
  sembrarCuenta(ctx, 'c1', 'ACME', 'V-1', 400);
  sembrarCuenta(ctx, 'c2', 'ACME', 'V-2', 300);
  await S.guardarSaldoAFavorCliente('ACME', { monto: 500, fecha: '2026-11-02', motivo: 'ant', grupoPagoId: 'ant1' });
  const r = await S.aplicarSaldoAFavorACuentasCliente('acme', [{ id: 'c1', monto: 400 }, { id: 'c2', monto: 100 }]);
  igual(r.aplicado, 500, 'total aplicado');
  const c1 = col('cuentas_por_cobrar').get('c1');
  const c2 = col('cuentas_por_cobrar').get('c2');
  igual([c1.saldo, c1.estado, c1.abonos[0].referencia], [0, 'liquidado', 'Saldo a favor aplicado'], 'c1 liquidada');
  igual([c2.saldo, c2.pagado], [200, 100], 'c2 parcial');
  const movs = col('clientes').get('ACME').saldoAFavor;
  igual(movs.map((m) => m.monto), [500, -400, -100], 'movimientos negativos por cuenta');
  igual(movs[1].grupoPagoId, c1.abonos[0].grupoPagoId, 'mismo grupoPagoId abono-movimiento (c1)');
  igual(movs[2].grupoPagoId, c2.abonos[0].grupoPagoId, 'mismo grupoPagoId abono-movimiento (c2)');
  igual(col('cobros').size, 0, 'no crea cobros');
  igual(S.saldoAFavorDisponibleCliente('ACME'), 0, 'saldo agotado');
  igual(w.EVE.cuentasPorCobrar.find((c) => c.id === 'c2').saldo, 200, 'memoria de la cuenta actualizada');
  igual(historial.filter((h) => h.accion === 'aplicacion').length, 2, 'historial de aplicación');
});

caso('Aplicar a cuentas: rechaza exceso, cuenta de otro cliente, duplicados, montos inválidos y sin saldo; no escribe nada', async () => {
  const ctx = crearContexto();
  const { S, col } = ctx;
  sembrarCuenta(ctx, 'c1', 'ACME', 'V-1', 400);
  sembrarCuenta(ctx, 'c3', 'OTRO', 'V-3', 400);
  await S.guardarSaldoAFavorCliente('ACME', { monto: 100, fecha: '2026-11-02', motivo: 'ant', grupoPagoId: 'ant1' });
  await falla(S.aplicarSaldoAFavorACuentasCliente('ACME', [{ id: 'c1', monto: 150 }]), 'excede el saldo a favor', 'más que el saldo');
  await falla(S.aplicarSaldoAFavorACuentasCliente('ACME', [{ id: 'c3', monto: 50 }]), 'no es de ACME', 'otro cliente');
  await falla(S.aplicarSaldoAFavorACuentasCliente('ACME', [{ id: 'c1', monto: 10 }, { id: 'c1', monto: 10 }]), 'más de una vez', 'duplicada');
  await falla(S.aplicarSaldoAFavorACuentasCliente('ACME', [{ id: 'c1', monto: 0 }]), 'mayor a 0', 'monto 0');
  await falla(S.aplicarSaldoAFavorACuentasCliente('ACME', []), 'al menos una cuenta', 'sin cuentas');
  await falla(S.aplicarSaldoAFavorACuentasCliente('ACME', [{ id: 'no', monto: 10 }]), 'ya no existe', 'cuenta inexistente');
  await falla(S.aplicarSaldoAFavorACuentasCliente('SIN SALDO', [{ id: 'c1', monto: 10 }]), 'no tiene saldo a favor', 'cliente sin documento');
  igual(col('cuentas_por_cobrar').get('c1').abonos.length, 0, 'c1 intacta');
  igual(col('clientes').get('ACME').saldoAFavor.length, 1, 'clientes intacto');
});

caso('Aplicar a cuentas: lectura fresca (la memoria con saldo de más no decide) y permiso cxc', async () => {
  const ctx = crearContexto();
  const { S, w, col } = ctx;
  sembrarCuenta(ctx, 'c1', 'ACME', 'V-1', 400);
  await S.guardarSaldoAFavorCliente('ACME', { monto: 300, fecha: '2026-11-02', motivo: 'ant', grupoPagoId: 'ant1' });
  const doc = col('clientes').get('ACME');
  col('clientes').set('ACME', { ...doc, saldoAFavor: [...doc.saldoAFavor, { revertido: false, monto: -280, fecha: '2026-11-02', motivo: 'otra sesión', grupoPagoId: 'gX' }] });
  await falla(S.aplicarSaldoAFavorACuentasCliente('ACME', [{ id: 'c1', monto: 100 }]), 'excede el saldo a favor', 'lee Firestore, no memoria');
  w.puedeEscribir = () => false;
  await falla(S.aplicarSaldoAFavorACuentasCliente('ACME', [{ id: 'c1', monto: 10 }]), 'No tienes permiso', 'sin escritura en cxc');
});

caso('Fusión de duplicados: mismo cliente con distinta capitalización se une en memoria', () => {
  const { w } = crearContexto();
  const lista = w.fusionarClientesDuplicados([
    { id: 'ACME', nombre: 'ACME', saldoAFavor: [{ revertido: false, monto: 100, grupoPagoId: 'g1' }], ultimaActualizacion: '2026-11-01' },
    { id: 'acme', nombre: 'acme', saldoAFavor: [{ revertido: false, monto: 100, grupoPagoId: 'g1' }, { revertido: false, monto: 50, grupoPagoId: 'g2' }], ultimaActualizacion: '2026-11-02' },
    { id: 'BETA', nombre: 'BETA', saldoAFavor: [] }
  ]);
  igual(lista.map((c) => c.nombre).sort(), ['ACME', 'BETA'], 'dos clientes');
  igual(lista.find((c) => c.nombre === 'ACME').saldoAFavor.map((m) => m.grupoPagoId), ['g1', 'g2'], 'movimientos sin duplicar');
  igual(w.fusionarClientesDuplicados(undefined), [], 'sin datos');
});

caso('Integración: colección, carga con cxc, aviso de permiso una sola vez, limpieza, regla, matriz, index y APP_SHELL', () => {
  afirmar(/CLIENTES: 'clientes'/.test(leer('js/config.js')), 'COLECCIONES.CLIENTES');
  const auth = leer('js/auth.js');
  const linea = auth.split(/\r?\n/).find((l) => l.includes("campo: 'clientes'")) || '';
  afirmar(linea.includes("modulo: 'cxc'") && !linea.includes('tambienLeen'), 'CARGAS_MODULO solo con el módulo cxc');
  afirmar(auth.includes('window.EVE.clientes = datos.clientes;') && auth.includes('window.EVE.clientes = [];'), 'estado y limpieza al cerrar sesión');
  afirmar(auth.includes('datos.clientes = window.fusionarClientesDuplicados(datos.clientes);'), 'fusión de duplicados');
  afirmar(/carga\.campo === 'clientes' && !avisoClientesSinPermisoMostrado/.test(auth) && /avisoClientesSinPermisoMostrado = true;/.test(auth), 'aviso visible una sola vez');
  const reglas = leer('firestore.rules');
  const bloque = (reglas.match(/match \/clientes\/\{docId\} \{([^}]*)\}/) || [])[1] || '';
  afirmar(bloque.includes("allow read: if puedeLeer('cxc');") && bloque.includes("allow write: if puedeEscribir('cxc');"), 'bloque clientes');
  afirmar(reglas.indexOf('match /clientes/{docId}') > reglas.indexOf('match /cobros/{docId}') && reglas.indexOf('match /clientes/{docId}') < reglas.indexOf('match /flujo_movimientos'), 'después del bloque cobros');
  afirmar(!/match \/clientes\/\{docId\}/.test(leer('rules-test/firestore.rules')), 'rules-test/firestore.rules intacto');
  afirmar(leer('matriz-pruebas-firestore-rules.md').includes('bloque `clientes`'), 'matriz del Playground');
  afirmar(leer('index.html').includes('<script src="js/saldo-clientes.js"></script>'), 'index.html');
  afirmar(leer('service-worker.js').includes("'js/saldo-clientes.js'"), 'APP_SHELL');
});

(async () => {
  let fallidos = 0;
  for (const c of casos) {
    try { await c.fn(); console.log('ok   ' + c.nombre); } catch (e) { fallidos++; console.error('FALLA ' + c.nombre + ': ' + e.message); }
  }
  console.log(`\n${casos.length - fallidos}/${casos.length} casos correctos`);
  process.exit(fallidos ? 1 : 0);
})();
