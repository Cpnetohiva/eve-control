// Aviso de repreciado al dar de alta un precio con fechaInicio <= hoy (js/precios.js manejarEnvioPrecio, js/admin-importar.js,
// js/cxp.js resumirAvisoRepreciado y avisoRepreciadoTrasAlta, js/admin-repreciar.js mostrarAvisoTrasAlta, js/admin.js abrirRepreciar).
// Regla: tras guardar el precio se cuentan las CxP del material que quedarían con otro precio; si hay alguna se muestra cantidad,
// diferencia en pesos y el botón «Revisar y repreciar». El aviso NUNCA escribe en cuentas_por_pagar: repreciar sigue pidiendo confirmación.
// Sin navegador: js/ reales en vm, un DOM mínimo y un Firestore en memoria.
//
// Uso: node scripts/verificar-aviso-repreciado.js   (código de salida 1 si algún caso falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['config.js', 'utils.js', 'rendimientos.js', 'precios.js', 'precios-sync.js', 'inventario.js', 'cxp.js', 'pagos.js', 'control-produccion.js', 'control-produccion-reglas.js', 'ventas.js', 'admin-importar.js', 'admin-repreciar.js'];
const HOY = '2026-11-13';
const clonar = (x) => JSON.parse(JSON.stringify(x));

// Elemento de DOM mínimo: recuerda hijos, texto, estilos y manejadores; cualquier método desconocido es un no-op.
function crearElemento(id) {
  const manejadores = {};
  const el = {
    id, value: '', textContent: '', className: '', style: {}, hijos: [], dataset: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(h) { el.hijos.push(h); return h; },
    addEventListener(tipo, fn) { (manejadores[tipo] = manejadores[tipo] || []).push(fn); },
    click() { (manejadores.click || []).forEach((fn) => fn()); },
    querySelector: () => crearElemento(), querySelectorAll: () => [],
    setAttribute() {}, removeAttribute() {}, focus() {}, reset() {}, remove() {},
    textoCompleto() { return [el.textContent, ...el.hijos.map((h) => h.textoCompleto())].join(' '); }
  };
  let html = '';
  Object.defineProperty(el, 'innerHTML', { get: () => html, set: (v) => { html = v; if (v === '') el.hijos = []; } });
  return el;
}

function crearDb(colecciones) {
  const almacen = clonar(colecciones);
  const lecturas = [];
  const cumple = (dato, f) => (f.op === '>=' ? dato[f.campo] >= f.valor : f.op === '<=' ? dato[f.campo] <= f.valor : dato[f.campo] === f.valor);
  const consulta = (coleccion, filtros) => ({
    where: (campo, op, valor) => consulta(coleccion, [...filtros, { campo, op, valor }]),
    get: async () => {
      lecturas.push(coleccion);
      return { docs: Object.keys(almacen[coleccion] || {}).filter((id) => filtros.every((f) => cumple(almacen[coleccion][id], f))).map((id) => ({ id, data: () => clonar(almacen[coleccion][id]) })) };
    }
  });
  return { almacen, lecturas, collection: (coleccion) => ({ where: (c, o, v) => consulta(coleccion, [{ campo: c, op: o, valor: v }]), get: () => consulta(coleccion, []).get(), doc: () => ({ id: 'x' }) }) };
}

const cxp = (extra) => ({
  ticket: '3001', proveedor: 'JOSE PEREZ', material: 'PET', kg: 1000, fechaTicket: '2026-11-10',
  precioAplicado: 9.5, precioBase: 9.5, ajusteProveedorAplicado: null, comisionPorKg: 0.5, precioEfectivo: 10, montoMaterial: 9500, montoComision: 500, total: 10000,
  pagado: 0, saldo: 10000, iva: 0, estado: 'pendiente', aprobacion: { tipo: 'manual' }, abonos: [], precioNegociado: null, creadoPor: 'capturista', ...extra
});

// cuentas: { id: CxP } (servidor y memoria iguales). permisos: { cxp: bool }.
function crearContexto({ cuentas, precios, puedeLeerCxp, enLinea }) {
  const elementos = {};
  const documento = { getElementById: (id) => elementos[id] || (elementos[id] = crearElemento(id)), createElement: () => crearElemento(), addEventListener() {}, body: crearElemento('body') };
  const window = { EVE_MODULES: {} };
  window.window = window;
  window.EVE = {
    registrosDestaraje: [], registrosVentas: [], registrosControlProduccion: [], registrosPagos: [], proveedores: [], ajustesPrecioProveedor: [], comisiones: [],
    auditorias: [], composiciones: [], ventas: [], inventarioInicial: [], inventario: [], fechaCorteAuditoria: '2026-07-01',
    precios: precios || [], cuentasPorPagar: Object.keys(cuentas || {}).map((id) => ({ id, ...clonar(cuentas[id]) })),
    currentUser: { username: 'neto', permisosResueltos: { admin: 'escritura' } }
  };
  const firebase = { initializeApp() {}, firestore: () => ({ enablePersistence: () => ({ catch() {} }) }) };
  const navegador = { onLine: enLinea !== false };
  const ctx = vm.createContext({ window, firebase, console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout, XLSX: {}, document: documento, navigator: navegador });
  for (const f of ARCHIVOS) vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js', f), 'utf8'), ctx, { filename: f });
  window.db = crearDb({ cuentas_por_pagar: cuentas || {} });
  window.elementos = elementos;
  window.obtenerFechaMexico = () => HOY;
  window.puedeLeer = (m) => (m === 'cxp' ? puedeLeerCxp !== false : true);
  window.puedeEscribir = () => true;
  window.activarOrdenamiento = () => {};
  window.errores = [];
  window.showError = (m) => window.errores.push(m);
  window.showSuccess = () => {};
  window.escrituras = [];
  window.guardarDato = async (coleccion, datos) => { window.escrituras.push({ tipo: 'set', coleccion, datos }); return 'nuevoPrecio'; };
  window.actualizarDato = async (coleccion, id, cambios) => { window.escrituras.push({ tipo: 'update', coleccion, id, cambios }); };
  window.EVE_OFFLINE = { contarPendientes: async () => 0, guardarCacheDatos: async () => {} };
  window.abiertos = [];
  window.EVE_ADMIN = { subpestanasVisibles: () => [{ id: 'repreciar' }], abrirRepreciar: (datos) => window.abiertos.push(datos) };
  return window;
}

const PRECIOS_BASE = () => [{ id: 'A', material: 'PET', precio: 9.5, fechaInicio: '2026-01-01', fechaFin: null, fechaRegistro: '2026-01-01T10:00:00.000Z' }];
const esperar = () => new Promise((r) => setTimeout(r, 30));

// Da de alta un precio por el formulario real de Precios (js/precios.js manejarEnvioPrecio).
async function altaPorFormulario(w, { material, precio, fecha }) {
  w.document_ = null;
  w.elementos['pr-material'] = Object.assign(crearElemento('pr-material'), { value: material });
  w.elementos['pr-precio'] = Object.assign(crearElemento('pr-precio'), { value: String(precio) });
  w.elementos['pr-fecha'] = Object.assign(crearElemento('pr-fecha'), { value: fecha });
  w.elementos['pr-notas'] = Object.assign(crearElemento('pr-notas'), { value: '' });
  await w.EVE_PRECIOS.manejarEnvioPrecio({ preventDefault() {} });
  await esperar();
  afirmar(w.errores.length === 0, `el alta falló: ${w.errores.join(' | ')}`);
  return w.elementos['precios-aviso-repreciar'] || crearElemento('precios-aviso-repreciar');
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const sinEscrituraEnCxP = (w, mensaje) => igual(w.escrituras.filter((e) => e.coleccion === 'cuentas_por_pagar').length, 0, `${mensaje}: el aviso no escribe en cuentas_por_pagar`);

// ── Alta manual (formulario de Precios) ──
caso('alta retroactiva con CxP afectadas: aparece el aviso con cantidad, diferencia en pesos y el botón; el botón abre Repreciar con material y rango', async () => {
  const w = crearContexto({
    precios: PRECIOS_BASE(),
    cuentas: { c1: cxp({ ticket: '3001' }), c2: cxp({ ticket: '3002', pagado: 2000, saldo: 8000, estado: 'parcial', abonos: [{ monto: 2000 }] }) }
  });
  const aviso = await altaPorFormulario(w, { material: 'PET', precio: 9.7, fecha: '2026-11-09' });
  afirmar(aviso && aviso.hijos.length === 1, 'debe haber un aviso');
  const texto = aviso.textoCompleto();
  afirmar(/2 CxP de PET/.test(texto), `cantidad en el aviso: ${texto}`);
  afirmar(/\$400\.00/.test(texto), `diferencia total $400.00 en el aviso: ${texto}`);
  afirmar(/1 repreciables, 1 no se tocan/.test(texto), `desglose: ${texto}`);
  const boton = aviso.hijos[0].hijos.find((h) => h.textContent === 'Revisar y repreciar');
  afirmar(boton, 'botón «Revisar y repreciar»');
  boton.click();
  igual(w.abiertos, [{ material: 'PET', desde: '2026-11-09', hasta: HOY }], 'abre Repreciar con material y rango');
  igual(w.escrituras.map((e) => `${e.tipo}:${e.coleccion}`), ['update:precios', 'set:precios'], 'solo se escribió el alta del precio y el cierre del anterior');
  sinEscrituraEnCxP(w, 'alta retroactiva');
});

caso('alta con fecha futura: no aparece el aviso y ni siquiera se leen las CxP', async () => {
  const w = crearContexto({ precios: PRECIOS_BASE(), cuentas: { c1: cxp() } });
  const aviso = await altaPorFormulario(w, { material: 'PET', precio: 9.7, fecha: '2026-12-01' });
  igual(aviso.hijos.length, 0, 'sin aviso');
  igual(w.db.lecturas.length, 0, 'sin lecturas de CxP');
  igual(w.escrituras.map((e) => e.coleccion), ['precios', 'precios'], 'el alta sí se guardó');
});

caso('alta retroactiva sin CxP afectadas (ya tienen el precio nuevo, otro material o fuera del rango): no aparece', async () => {
  const w = crearContexto({
    precios: PRECIOS_BASE(),
    cuentas: {
      c1: cxp({ ticket: '3001', precioAplicado: 9.7, precioBase: 9.7, montoMaterial: 9700, total: 10200, saldo: 10200, precioEfectivo: 10.2 }),
      c2: cxp({ ticket: '3002', material: 'CARTON' }),
      c3: cxp({ ticket: '3003', fechaTicket: '2026-11-05' })
    }
  });
  const aviso = await altaPorFormulario(w, { material: 'PET', precio: 9.7, fecha: '2026-11-09' });
  igual(aviso.hijos.length, 0, 'sin aviso');
  igual(w.escrituras.map((e) => e.coleccion), ['precios', 'precios'], 'el alta se guardó');
});

caso('alta de HOY con CxP de hoy en el catálogo viejo: sí avisa (fechaInicio igual a hoy cuenta como retroactiva)', async () => {
  const w = crearContexto({ precios: PRECIOS_BASE(), cuentas: { c1: cxp({ fechaTicket: HOY }) } });
  const aviso = await altaPorFormulario(w, { material: 'PET', precio: 9.7, fecha: HOY });
  afirmar(/1 CxP de PET/.test(aviso.textoCompleto()), 'avisa con fechaInicio = hoy');
});

caso('si el aviso falla (lectura del servidor caída) el alta ya guardada no se afecta y se usa la memoria', async () => {
  const w = crearContexto({ precios: PRECIOS_BASE(), cuentas: { c1: cxp() } });
  w.db.collection = () => ({ where() { throw new Error('boom'); } });
  const aviso = await altaPorFormulario(w, { material: 'PET', precio: 9.7, fecha: '2026-11-09' });
  afirmar(/1 CxP de PET/.test(aviso.textoCompleto()), 'cae a la memoria y avisa');
  igual(w.escrituras.map((e) => e.coleccion), ['precios', 'precios'], 'alta guardada');
});

caso('sin permiso de lectura de CxP no calcula ni lee nada', async () => {
  const w = crearContexto({ precios: PRECIOS_BASE(), cuentas: { c1: cxp() }, puedeLeerCxp: false });
  const aviso = await altaPorFormulario(w, { material: 'PET', precio: 9.7, fecha: '2026-11-09' });
  igual(aviso.hijos.length, 0, 'sin aviso');
  igual(w.db.lecturas.length, 0, 'sin lecturas');
});

caso('sin permiso para abrir Repreciar el aviso aparece pero sin botón', () => {
  const w = crearContexto({ precios: [], cuentas: {} });
  w.EVE_ADMIN.subpestanasVisibles = () => [];
  const caja = crearElemento('x');
  w.EVE_ADMIN_REPRECIAR.mostrarAvisoTrasAlta(caja, [{ material: 'PET', desde: '2026-11-09', hasta: HOY, cantidad: 1, repreciables: 1, noRepreciables: 0, diferenciaPesos: 200 }]);
  afirmar(/1 CxP de PET/.test(caja.textoCompleto()), 'hay aviso');
  afirmar(!caja.hijos[0].hijos.some((h) => h.textContent === 'Revisar y repreciar'), 'sin botón');
});

// ── Importación ──
const fila = (material, precio, fecha) => ({ Material: material, Precio: precio, 'Fecha Vigencia': fecha, Notas: '' });
const altasDeHoja = (hoja) => hoja.filter((f) => f.valido).map((f) => ({ material: f.registro.nuevo.material, fechaInicio: f.registro.nuevo.fechaInicio }));

caso('importación retroactiva con CxP afectadas: el aviso se calcula con las altas importadas; con varias filas del mismo material toma la fecha más antigua', async () => {
  const w = crearContexto({ precios: PRECIOS_BASE(), cuentas: { c1: cxp({ ticket: '3001', fechaTicket: '2026-11-10' }), c2: cxp({ ticket: '3002', fechaTicket: '2026-11-12' }) } });
  const hoja = w.EVE_ADMIN_IMPORTAR.procesarHojaPreciosGenerales([fila('PET', 9.7, '09-11-2026')]);
  igual(hoja[0].valido, true, 'fila válida');
  await w.EVE_ADMIN_IMPORTAR.procesarConfirmacionPreciosGenerales(hoja).catch(() => {}); // sin batch real: solo importa dejar el catálogo local actualizado
  w.EVE.precios = [{ ...PRECIOS_BASE()[0], fechaFin: '2026-11-08' }, { id: 'N', material: 'PET', precio: 9.7, fechaInicio: '2026-11-09', fechaFin: null }];
  const avisos = await w.EVE_CXP.avisoRepreciadoTrasAlta(altasDeHoja(hoja));
  igual(avisos.map((a) => [a.material, a.desde, a.cantidad, a.diferenciaPesos]), [['PET', '2026-11-09', 2, 400]], 'un aviso con 2 CxP y $400');
});

caso('importación con fecha futura o sin CxP afectadas: no hay aviso', async () => {
  const w = crearContexto({ precios: PRECIOS_BASE(), cuentas: { c1: cxp() } });
  igual(await w.EVE_CXP.avisoRepreciadoTrasAlta([{ material: 'PET', fechaInicio: '2026-12-01' }]), [], 'fecha futura');
  w.EVE.precios = [{ id: 'N', material: 'PET', precio: 9.5, fechaInicio: '2026-11-09', fechaFin: null }];
  igual(await w.EVE_CXP.avisoRepreciadoTrasAlta([{ material: 'PET', fechaInicio: '2026-11-09' }]), [], 'las CxP ya coinciden con el catálogo');
});

caso('la importación y el alta manual llaman al aviso después de guardar (revisión por texto)', () => {
  const imp = fs.readFileSync(path.join(RAIZ, 'js/admin-importar.js'), 'utf8');
  const pre = fs.readFileSync(path.join(RAIZ, 'js/precios.js'), 'utf8');
  afirmar(/avisarTrasAlta\(avisoRepreciar, altasPrecios\)/.test(imp), 'admin-importar.js debe llamar a avisarTrasAlta');
  afirmar(imp.indexOf('altasPrecios') < imp.indexOf('ejecutarImportacion(resultadoParseo, modoActual)'), 'las altas se toman ANTES de que limpiarArchivoAnalizado borre el análisis');
  afirmar(/avisarTrasAlta\(document\.getElementById\('precios-aviso-repreciar'\)/.test(pre), 'precios.js debe llamar a avisarTrasAlta');
  afirmar(pre.indexOf("window.showSuccess('Precio guardado')") < pre.indexOf('avisarTrasAlta'), 'el aviso va después de guardar');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try {
      await fn();
      console.log(`OK   ${nombre}`);
    } catch (error) {
      fallos++;
      console.log(`FALLA ${nombre}\n     ${error.message}`);
    }
  }
  console.log(`\n${casos.length - fallos} de ${casos.length} casos pasan.`);
  process.exit(fallos ? 1 : 0);
})();
