// Dashboard Ejecutivo: (1) el interruptor "Incluir material de socios" arranca SIEMPRE excluido y no recuerda sesiones anteriores;
// (2) antes de imprimir cada gráfica se sustituye por una imagen de su canvas y después se restaura.
// Sin navegador ni Playwright: se extraen por texto las funciones de dashboard-ejecutivo/index.html y se corren en vm con dobles
// (mismo método que scripts/verificar-dashboard-ejecutivo-materiales.js). El renderizado real de Chart.js, la vista previa de
// impresión y el PDF NO se prueban aquí (ver checklist manual en chat/paso2_A8_socios_impresion.md).
//
// Uso: node scripts/verificar-dashboard-socios-impresion.js [ruta/index.html]   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const HTML_RUTA = path.resolve(process.argv[2] || path.join(RAIZ, '..', 'dashboard-ejecutivo', 'index.html'));
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const cerca = (a, b, m) => afirmar(Math.abs(a - b) < 0.005, `${m}: esperado ${b}, obtenido ${a}`);
if (!fs.existsSync(HTML_RUTA)) { console.error('No existe ' + HTML_RUTA); process.exit(1); }
const html = fs.readFileSync(HTML_RUTA, 'utf8');

function extraerFuncion(nombre) {
  const ini = html.indexOf('function ' + nombre + '(');
  if (ini < 0) return '';
  let i = html.indexOf('{', ini), nivel = 0;
  for (; i < html.length; i++) { if (html[i] === '{') nivel++; if (html[i] === '}' && --nivel === 0) return html.slice(ini, i + 1); }
  return '';
}
function extraerLinea(nombre) { const m = html.match(new RegExp('^(?:const|let) ' + nombre + '\\s*=.*$', 'm')); return m ? m[0] : ''; }

// ── Extracción de lo de socios (misma lista que verificar-dashboard-ejecutivo-materiales.js) ──
const LINEAS = ['num', 'fmt\\$', 'fmt\\$2', 'fmtN', 'fmtPct', 'esc', 'iso', 'fdate', 'norm', 'MATERIALES_ALIAS', 'normMat', 'PROVEEDORES_SOCIOS', 'limpiaSocio', 'sum', 'MESES', 'MESES_L', 'UNIDAD_PZ',
  'dayDiff', 'inP', 'tipoNormG', 'rmM', 'dia10', 'diaAnterior', 'verSocioG', 'esSaldoInicialCta', 'FLUJO_INICIO', 'subtotalCxc', 'baseCxc', 'INCLUIR_SOCIOS'];
const FUNCS = ['esProveedorSocio', 'incluirSocios', 'grp', 'aging', 'calc', 'abonosVigentesAl', 'cxpAlCorteDet', 'abonosCxcAl', 'cxcAlCorteDet', 'puenteCxPMes', 'puenteCxCMes',
  'autopruebaCxP', 'autopruebaCxC', 'rmFilasRubro', 'rmTablaRubro', 'rmBloqueCxP', 'rmBloqueCxC', 'rReporteMensual', 'rMateriales'];
const lineas = LINEAS.map((n) => extraerLinea(n));
const funcs = FUNCS.map(extraerFuncion);
afirmar(lineas.every(Boolean), 'se encontraron todas las constantes: ' + LINEAS.filter((n, i) => !lineas[i]).join(', '));
afirmar(funcs.every(Boolean), 'se encontraron todas las funciones: ' + FUNCS.filter((n, i) => !funcs[i]).join(', '));
const kpiLinea = (html.match(/^function kpi\(.*$/m) || [''])[0];

// localStorage con una elección guardada de una sesión anterior (marcada como incluida): NO debe leerse al abrir.
const almacen = { dash_incluir_socios: '1' };
const lecturas = [];
const elementos = {};
const ctx = {
  console: { warn() {}, info() {}, error: console.error, log() {} },
  localStorage: {
    getItem: (k) => { lecturas.push(k); return k in almacen ? almacen[k] : null; },
    setItem: (k, v) => { almacen[k] = String(v); }, removeItem: (k) => { delete almacen[k]; }
  },
  $: (id) => elementos[id] || (elementos[id] = { value: '', innerHTML: '', style: {}, checked: false }),
  barRow: () => '', chart: () => {}, C_NAVY: '#000', COL_FALLAS: []
};
vm.createContext(ctx);
const HOY_FIJO = '2026-11-09';
// La línea "let INCLUIR_SOCIOS=false;" va seguida (en el HTML real) del removeItem; lo reproducimos tal cual desde el texto.
const bloqueSocios = (html.match(/let INCLUIR_SOCIOS=false;\r?\ntry\{[^\n]*\}catch\(e\)\{\}/) || [''])[0];
afirmar(!!bloqueSocios, 'se encontró el bloque de arranque del interruptor (variable + borrado de la clave vieja)');
vm.runInContext(`
  const HOY = '${HOY_FIJO}'; let DB = null, PER = {desde:'',hasta:'',label:''}, R = null;
  ${lineas.filter((l) => !/^let (COL_FALLAS|INCLUIR_SOCIOS)/.test(l)).join('\n')}
  let COL_FALLAS = [];
  ${bloqueSocios}
  ${kpiLinea}
  ${funcs.join('\n')}
  globalThis.api = {
    set(db, per) { DB = db; PER = per; }, calc: () => (R = calc()), rMateriales, rReporteMensual, incluirSocios,
    setIncluir: (v) => { INCLUIR_SOCIOS = v; }
  };
`, ctx);
const api = ctx.api;

// a) Estado inicial: excluido en la variable (incluirSocios()) y checkbox desmarcado en el HTML y tras renderAll.
afirmar(api.incluirSocios() === false, 'a) el estado inicial de la variable es excluido (aunque localStorage guardara "1")');
afirmar(/<input type="checkbox" id="chkSocios">/.test(html) && !/id="chkSocios"[^>]*checked/.test(html), 'a) el checkbox arranca desmarcado en el HTML');
{
  const renderAllTxt = extraerFuncion('renderAll');
  afirmar(!!renderAllTxt, 'a) se encontró renderAll');
  const el = { chkSocios: { checked: true }, tagSocios: { style: { display: 'none' } } };
  const llamadas = [];
  const c2 = { $: (id) => el[id], incluirSocios: () => api.incluirSocios(), calcPeriodo() {}, calc: () => ({}), esc: String, R: null,
    rMateriales() {}, rVentas() {}, rInventario() {}, rCxP() {}, rCxC() {}, rPE() {}, rReporteMensual() { llamadas.push('mensual'); },
    MOSTRAR_INVENTARIO: false, MOSTRAR_PUNTO_EQUILIBRIO: false };
  vm.createContext(c2);
  vm.runInContext('let R=null;' + renderAllTxt + ';globalThis.renderAll=renderAll;', c2);
  c2.renderAll();
  afirmar(el.chkSocios.checked === false, 'a) al abrir (renderAll) el checkbox queda desmarcado');
  afirmar(el.tagSocios.style.display === '', 'a) al abrir el chip superior "importes sin material de socios" está visible');
  afirmar(llamadas.length === 1, 'a) renderAll arma el reporte mensual');
  api.setIncluir(true); c2.renderAll();
  afirmar(el.chkSocios.checked === true && el.tagSocios.style.display === 'none', 'd) al marcar el interruptor el checkbox y el chip se actualizan');
  api.setIncluir(false);
}

// b) No se lee un valor guardado de sesiones anteriores.
afirmar(!lecturas.includes('dash_incluir_socios'), 'b) al abrir no se leyó la clave dash_incluir_socios de localStorage');
afirmar(!('dash_incluir_socios' in almacen), 'b) la clave vieja se borra al abrir (no queda rastro)');
afirmar(!/localStorage\.getItem\('dash_incluir_socios'\)/.test(html), 'b) index.html ya no lee dash_incluir_socios');
afirmar(!/localStorage\.setItem\('dash_incluir_socios'/.test(html), 'b) index.html ya no guarda dash_incluir_socios (solo cambia en memoria)');
afirmar(/\$\('chkSocios'\)\.onchange=\(\)=>\{ INCLUIR_SOCIOS=\$\('chkSocios'\)\.checked; renderAll\(\); \};/.test(html), 'b) el checkbox cambia la variable en memoria y recalcula');
afirmar(!/URLSearchParams|location\.(search|hash)[^;]*socios/i.test(html), 'b) el estado tampoco viene de la URL');

// c) Con excluido: importe de materiales y CxP sin GERMAN ni MARIO M; kg con ellos.
const vacio = () => ({ cxp: [], cxc: [], ventas: [], destaraje: [], cobros: [], pagos: [], gastos: [], flujo: [], precios: [], invIni: [], inv: [], prod: [], proveedores: [], clientes: [] });
const PER_OCT = { desde: '2026-10-01', hasta: '2026-10-31', label: 'Octubre 2026' };
const db = vacio();
db.destaraje = [
  { ticket: '1001', proveedor: 'PROV A', material: 'PET', kg: 1000, fechaSalida: '2026-10-05' },
  { ticket: '1002', proveedor: 'GERMAN', material: 'PET', kg: 500, fechaSalida: '2026-10-06' },
  { ticket: '1003', proveedor: 'MARIO M', material: 'HDPE', kg: 300, fechaSalida: '2026-10-07' }
];
db.cxp = [
  { id: 'c1', ticket: '1001', proveedor: 'PROV A', material: 'PET', kg: 1000, total: 5000, saldo: 5000, fechaTicket: '2026-10-05' },
  { id: 'c2', ticket: '1002', proveedor: 'GERMAN', material: 'PET', kg: 500, total: 2500, saldo: 2500, fechaTicket: '2026-10-06' },
  { id: 'c3', ticket: '1003', proveedor: 'MARIO M', material: 'HDPE', kg: 300, total: 1200, saldo: 1200, fechaTicket: '2026-10-07' }
];
db.cxc = [{ id: 'x1', cliente: 'CLI', total: 4000, saldo: 4000, fecha: '2026-10-10', fechaVenta: '2026-10-10' }];
api.set(db, PER_OCT);
const Rini = api.calc();   // sin tocar el interruptor: estado inicial
cerca(Rini.comprasMonto, 5000, 'c) con el estado inicial (excluido) el importe de compras no incluye a GERMAN ni a MARIO M');
afirmar(!Rini.compras.HDPE, 'c) MARIO M no aparece en el importe de materiales (HDPE)');
cerca(Rini.compras.PET.monto, 5000, 'c) PET sin GERMAN');
cerca(Rini.cxpTotal, 5000, 'c) la CxP total excluye a los socios');
cerca(Rini.kgBascula, 1800, 'c) los kg de báscula SÍ incluyen a GERMAN y MARIO M');
cerca(Rini.kgBasculaMat.PET.kg, 1500, 'c) kg de PET con GERMAN');
cerca(Rini.kgBasculaMat.HDPE.kg, 300, 'c) kg de HDPE de MARIO M');

// d) Al marcar el interruptor todo se recalcula.
api.setIncluir(true);
const Rinc = api.calc();
cerca(Rinc.comprasMonto, 8700, 'd) al marcar, el importe de compras incluye a los socios');
cerca(Rinc.cxpTotal, 8700, 'd) al marcar, la CxP total incluye a los socios');
cerca(Rinc.kgBascula, 1800, 'd) los kg no cambian al marcar');
api.setIncluir(false);
const Rdes = api.calc();
cerca(Rdes.comprasMonto, 5000, 'd) al desmarcar vuelve a excluir');

// e) El reporte mensual abre con los chips de importes sin material de socios.
{
  api.setIncluir(false);
  ctx.$('rmMes').value = '2026-10'; api.set(db, { desde: '', hasta: '', label: '' }); api.rReporteMensual();
  const ini = ctx.$('rmCuerpo').innerHTML;
  const chips = ini.match(/Importes: material de socios <b>?\w*|Importes: material de socios [a-zé]+/g) || [];
  afirmar(/Importes: material de socios excluido/.test(ini), 'e) el reporte mensual abre con "Importes: material de socios excluido"');
  afirmar(!/Importes: material de socios incluido/.test(ini), 'e) el reporte mensual no dice "incluido" en el estado inicial');
  api.setIncluir(true); api.rReporteMensual();
  afirmar(/Importes: material de socios incluido/.test(ctx.$('rmCuerpo').innerHTML), 'e) al marcar el interruptor el reporte mensual dice "incluido"');
  api.setIncluir(false);
}

// f) Preparar y restaurar la impresión (doble de Chart que registra las llamadas).
const ini = html.indexOf('const IMP_ANCHO'), fin = html.indexOf("window.addEventListener('afterprint',restaurarGraficasDespuesDeImprimir);");
afirmar(ini > 0 && fin > ini, 'f) se encontró el bloque de impresión de gráficas');
const bloqueImp = html.slice(ini, fin + "window.addEventListener('afterprint',restaurarGraficasDespuesDeImprimir);".length);
const registro = [];
function crearDom() {
  const mkPadre = (n) => ({ id: n, hijos: [], appendChild(h) { this.hijos.push(h); h.parentNode = this; }, removeChild(h) { this.hijos = this.hijos.filter((x) => x !== h); h.parentNode = null; } });
  return { mkPadre };
}
const { mkPadre } = crearDom();
function crearGrafica(id, opciones = {}) {
  const padre = mkPadre('box-' + id), canvas = { id, style: { display: 'block' }, parentNode: null };
  padre.appendChild(canvas);
  const ch = {
    id, canvas, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 1000 } },
    resize(w, h) { registro.push([id, 'resize', w, h]); },
    update(modo) { registro.push([id, 'update', modo, this.options.animation, this.options.responsive]); },
    toBase64Image() { registro.push([id, 'imagen']); if (opciones.falla) throw new Error('canvas vacío'); return 'data:image/png;base64,' + id; }
  };
  return { ch, canvas, padre };
}
const g = {
  materiales: crearGrafica('chMat'),                // Materiales
  ventas: crearGrafica('chVen'),                    // Ventas
  cxpProv: crearGrafica('chCxp'), cxpAg: crearGrafica('chCxpAg'),   // Por pagar: saldo por proveedor y antigüedad
  cxcAg: crearGrafica('chCxcAg'),                   // Por cobrar: antigüedad (pestaña que nunca se abrió)
  vacia: crearGrafica('chPe', { falla: true })      // sin datos: el canvas no se puede exportar
};
const chartsDoble = {};
Object.values(g).forEach((x) => { chartsDoble[x.ch.id] = x.ch; });
const escuchas = {};
const imagenes = [];
let renders = 0;
const ctxImp = {
  charts: chartsDoble, renderAll: () => { renders++; },
  document: { createElement: (t) => { const e = { tag: t, style: {}, className: '' }; imagenes.push(e); return e; } },
  window: { addEventListener: (ev, fn) => { (escuchas[ev] = escuchas[ev] || []).push(fn); }, print: () => { registro.push(['window', 'print']); } },
  Promise
};
vm.createContext(ctxImp);
vm.runInContext(bloqueImp + ';globalThis.imp={preparar:prepararGraficasParaImprimir,restaurar:restaurarGraficasDespuesDeImprimir,imprimir:imprimirConGraficas};', ctxImp);

const devueltas = ctxImp.imp.preparar();
const imgDe = (x) => x.padre.hijos.find((h) => h.tag === 'img');
['materiales', 'ventas', 'cxpProv', 'cxpAg', 'cxcAg'].forEach((k) => {
  const x = g[k];
  const img = imgDe(x);
  afirmar(!!img && img.src === 'data:image/png;base64,' + x.ch.id, `f) ${x.ch.id}: se agregó una imagen generada de su propio canvas`);
  afirmar(x.canvas.style.display === 'none', `f) ${x.ch.id}: el canvas interactivo queda oculto mientras se imprime`);
  afirmar(x.ch.options.animation === false && x.ch.options.responsive === false, `f) ${x.ch.id}: se redibuja sin animación y sin responsive`);
  afirmar(registro.some((r) => r[0] === x.ch.id && r[1] === 'resize' && r[2] > 0 && r[3] > 0), `f) ${x.ch.id}: se fija un tamaño válido distinto de cero`);
  afirmar(registro.some((r) => r[0] === x.ch.id && r[1] === 'update' && r[2] === 'none'), `f) ${x.ch.id}: se actualiza sin animación`);
});
afirmar(devueltas.length === 5, 'f) devuelve las 5 imágenes generadas (la gráfica sin datos no genera imagen ni error)');
afirmar(!imgDe(g.vacia) && g.vacia.padre.hijos.includes(g.vacia.canvas), 'f) la gráfica sin datos conserva su contenedor y su canvas, sin error');
afirmar(g.vacia.canvas.style.display === 'block', 'f) la gráfica sin datos no se oculta');
// Idempotente: botón + beforeprint no duplican imágenes.
const antes = imagenes.length;
ctxImp.imp.preparar();
afirmar(imagenes.length === antes, 'f) preparar dos veces (botón y beforeprint) no duplica imágenes');

ctxImp.imp.restaurar();
['materiales', 'ventas', 'cxpProv', 'cxpAg', 'cxcAg', 'vacia'].forEach((k) => {
  const x = g[k];
  afirmar(!imgDe(x), `f) ${x.ch.id}: tras restaurar ya no hay imagen`);
  afirmar(x.canvas.style.display === 'block', `f) ${x.ch.id}: tras restaurar el canvas interactivo vuelve a verse`);
  afirmar(x.ch.options.responsive === true && x.ch.options.animation && x.ch.options.animation.duration === 1000, `f) ${x.ch.id}: tras restaurar vuelve responsive y su animación`);
  afirmar(registro.some((r) => r[0] === x.ch.id && r[1] === 'resize' && r[2] === undefined), `f) ${x.ch.id}: se vuelve a medir con su tamaño responsivo`);
});
afirmar(renders === 0, 'f) una restauración sin fallas no vuelve a pintar todo el dashboard');
ctxImp.imp.restaurar();   // segunda restauración: no hace nada ni falla
afirmar(true, 'f) restaurar sin haber preparado no falla');

// f2) Las gráficas de pestañas que nunca se abrieron existen: renderAll las crea todas con chart('id', ...)
const canvases = [...html.matchAll(/<canvas id="(\w+)"/g)].map((m) => m[1]);
afirmar(canvases.length >= 6 && !canvases.includes('chTend'), 'f) el dashboard tiene gráficas en Materiales, Ventas, Por pagar, Por cobrar (y punto de equilibrio/inventario), ninguna de tendencia: ' + canvases.join(','));
afirmar(canvases.every((id) => new RegExp("chart\\('" + id + "'").test(html)), 'f) cada canvas se crea con chart(id, ...) desde renderAll, aunque su pestaña nunca se haya abierto');
afirmar(/rMateriales\(\); rVentas\(\);[^\n]*rCxP\(\); rCxC\(\);/.test(html) && !/rResumen/.test(html), 'f) renderAll arma todas las pestañas (no solo la visible) y ya no llama a rResumen');
// f3) Si al restaurar una gráfica falla, se repinta todo el dashboard como último recurso.
{
  const x = crearGrafica('chFalla');
  Object.keys(chartsDoble).forEach((k) => delete chartsDoble[k]);
  chartsDoble.chFalla = x.ch;
  ctxImp.imp.preparar();
  x.ch.update = () => { throw new Error('boom'); };
  ctxImp.imp.restaurar();
  afirmar(renders === 1, 'f) si una gráfica no se puede restaurar se vuelve a pintar el dashboard (renderAll)');
  afirmar(!imgDe(x), 'f) aun con falla la imagen de impresión se retira');
}

// g) Conexión de beforeprint, afterprint y botones.
afirmar((escuchas.beforeprint || []).length === 1 && escuchas.beforeprint[0] === ctxImp.imp.preparar, 'g) beforeprint está conectado a preparar');
afirmar((escuchas.afterprint || []).length === 1 && escuchas.afterprint[0] === ctxImp.imp.restaurar, 'g) afterprint está conectado a restaurar');
afirmar(/<button class="btn ghost" onclick="imprimirConGraficas\(\)">/.test(html) && !/onclick="window\.print\(\)"/.test(html), 'g) el botón Imprimir llama a imprimirConGraficas');
afirmar(/^\$\('rmImprimir'\)\.onclick=.*imprimirConGraficas\(\);/m.test(html) && !/^\$\('rmImprimir'\)\.onclick=.*window\.print\(\)/m.test(html), 'g) el botón del reporte mensual también prepara las gráficas');
{
  // El botón prepara y luego imprime
  const g2 = crearGrafica('chBoton');
  Object.keys(chartsDoble).forEach((k) => delete chartsDoble[k]);
  chartsDoble.chBoton = g2.ch;
  registro.length = 0;
  ctxImp.imp.imprimir();
  afirmar(registro.some((r) => r[0] === 'chBoton' && r[1] === 'imagen'), 'g) el botón genera la imagen antes de imprimir');
  Promise.resolve().then(() => Promise.resolve()).then(() => {
    const ordenImg = registro.findIndex((r) => r[1] === 'imagen'), ordenPrint = registro.findIndex((r) => r[1] === 'print');
    afirmar(ordenImg >= 0 && ordenPrint > ordenImg, 'g) window.print se llama después de generar las imágenes');
    ctxImp.imp.restaurar();
    cerrar();
  });
}

function cerrar() {
  // h) No quedan referencias que dependan del estado inicial incluido.
  afirmar(!/!==\s*'0'/.test(html.slice(html.indexOf('function incluirSocios'), html.indexOf('function incluirSocios') + 200)), 'h) incluirSocios ya no compara contra "0" (default incluido)');
  afirmar(/^let INCLUIR_SOCIOS=false;/m.test(html), 'h) la variable de estado arranca en false');
  afirmar(!/catch\(e\)\{ return true; \}/.test(html.slice(html.indexOf('function incluirSocios'), html.indexOf('function incluirSocios') + 200)), 'h) incluirSocios ya no devuelve true por defecto');
  const usos = [...html.matchAll(/incluirSocios\(\)/g)].length;
  afirmar(usos >= 3, 'h) las vistas leen el estado solo con incluirSocios(): ' + usos + ' usos');
  console.log(`${ok}/${total} comprobaciones correctas`);
  if (ok !== total) process.exitCode = 1;
}
