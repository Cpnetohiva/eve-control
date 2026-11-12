// Dashboard Ejecutivo: los descuentos posteriores de venta (ventas.descuentos) restan de las ventas netas (por mes de la VENTA, por
// material y por cliente) y bajan el saldo de CxC al corte, sin tocar lo cobrado. Caso V-2026-045 (CHINOS QUERETARO, 21/10/2026):
// descuento de 4906 a PET VERDE → la partida queda en 60,598.00 en octubre y el saldo de CxC en 0.
// Sin navegador: se extraen por texto las funciones de dashboard-ejecutivo/index.html y se corren en vm (como verificar-dashboard-ejecutivo-materiales.js).
//
// Uso: node scripts/verificar-descuentos-dashboard.js [ruta/index.html]   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const HTML_RUTA = path.resolve(process.argv[2] || path.join(RAIZ, '..', 'dashboard-ejecutivo', 'index.html'));
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const cerca = (a, b, m) => afirmar(Math.abs(a - b) < 0.005, `${m}: esperado ${b}, obtenido ${a}`);
const html = fs.readFileSync(HTML_RUTA, 'utf8');

function extraerFuncion(nombre) {
  const ini = html.indexOf('function ' + nombre + '(');
  if (ini < 0) return '';
  let i = html.indexOf('{', ini), nivel = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') nivel++;
    else if (html[i] === '}' && --nivel === 0) return html.slice(ini, i + 1);
  }
  return '';
}
const extraerLinea = (nombre) => { const m = html.match(new RegExp('^(?:const|let) ' + nombre + '\\s*=.*$', 'm')); return m ? m[0] : ''; };

const LINEAS = ['num', 'fmt\\$', 'fmt\\$2', 'fmtN', 'fmtPct', 'esc', 'iso', 'fdate', 'norm', 'MATERIALES_ALIAS', 'normMat', 'PROVEEDORES_SOCIOS', 'limpiaSocio', 'sum', 'MESES', 'MESES_L', 'UNIDAD_PZ',
  'dayDiff', 'inP', 'tipoNormG', 'rmM', 'dia10', 'diaAnterior', 'verSocioG', 'esSaldoInicialCta', 'FLUJO_INICIO', 'subtotalCxc', 'baseCxc', 'INCLUIR_SOCIOS'];
const FUNCS = ['esProveedorSocio', 'incluirSocios', 'descuentoLineaVenta', 'subNetoLineaVenta', 'grp', 'aging', 'calc', 'abonosVigentesAl', 'cxpAlCorteDet', 'abonosCxcAl',
  'ventaDeCuentaCxc', 'descuentosCxcAl', 'descuentosCxcMonto', 'cxcAlCorteDet', 'puenteCxPMes', 'puenteCxCMes'];
const lineas = LINEAS.map(extraerLinea);
const funcs = FUNCS.map(extraerFuncion);
afirmar(lineas.every(Boolean), 'se encontraron las constantes: ' + LINEAS.filter((n, i) => !lineas[i]).join(', '));
afirmar(funcs.every(Boolean), 'se encontraron las funciones: ' + FUNCS.filter((n, i) => !funcs[i]).join(', '));
const kpiLinea = (html.match(/^function kpi\(.*$/m) || [''])[0];

const ctx = {
  console: { warn() {}, info() {}, error: console.error, log: console.log },
  localStorage: { getItem: () => null },
  $: () => ({ value: '', innerHTML: '' }),
  barRow: () => '', chart: () => {}, C_NAVY: '#000', COL_FALLAS: []
};
vm.createContext(ctx);
vm.runInContext(`
  const HOY = '2026-11-12'; let DB = null, PER = {desde:'',hasta:'',label:''}, R = null;
  ${lineas.filter((l) => !/^let COL_FALLAS/.test(l)).join('\n')}
  let COL_FALLAS = [];
  ${kpiLinea}
  ${funcs.join('\n')}
  globalThis.api = { set(db, per) { DB = db; PER = per; }, calc: () => (R = calc()), cxcAlCorteDet, puenteCxCMes };
`, ctx);
const api = ctx.api;

const vacio = () => ({ cxp: [], cxc: [], ventas: [], destaraje: [], cobros: [], pagos: [], gastos: [], flujo: [], precios: [], invIni: [], inv: [], prod: [], proveedores: [], clientes: [] });
const PER_OCT = { desde: '2026-10-01', hasta: '2026-10-31', label: 'Octubre 2026' };
const PER_NOV = { desde: '2026-11-01', hasta: '2026-11-30', label: 'Noviembre 2026' };

function datos(conDescuento) {
  const db = vacio();
  db.ventas = [
    { id: 'v45', folio: 'V-2026-045', cliente: 'CHINOS QUERETARO', fecha: '2026-10-21', totalVenta: 65504,
      lineas: [{ material: 'PET VERDE', cantidad: 8000, unidad: 'KG', precioUnitario: 8.188, subtotal: 65504, ivaTrasladado: 0, ivaRetenido: 0, totalLinea: 65504 }],
      descuentos: conDescuento ? [{ id: 'd1', fecha: '2026-11-12', monto: 4906, material: 'PET VERDE', lineaIndex: 0, motivo: 'Merma', usuario: 'Neto', revertido: false, aplicaciones: [{ cxcId: 'c45', monto: 4906 }] }] : [] },
    { id: 'v50', folio: 'V-2026-050', cliente: 'OTRO', fecha: '2026-10-22', totalVenta: 1000,
      lineas: [{ material: 'PET VERDE', cantidad: 100, unidad: 'KG', precioUnitario: 10, subtotal: 1000, ivaTrasladado: 0, ivaRetenido: 0, totalLinea: 1000 }] }
  ];
  db.cxc = [{
    id: 'c45', ventaId: 'v45', cliente: 'CHINOS QUERETARO', folio: 'V-2026-045', material: 'PET VERDE', subtotal: 65504, total: 65504, ivaTrasladado: 0, ivaRetenido: 0,
    fecha: '2026-10-21', fechaVenta: '2026-10-21', pagado: 60598, saldo: conDescuento ? 0 : 4906, descuentoAplicado: conDescuento ? 4906 : 0,
    abonos: [{ monto: 60598, fecha: '2026-10-25', referencia: 'Transferencia', abonoId: 'a1' }]
  }];
  db.cobros = [{ id: 'k1', cxcId: 'c45', ventaId: 'v45', cliente: 'CHINOS QUERETARO', pagado: 60598, total: 65504, fecha: '2026-10-25', revertido: false }];
  return db;
}
const correr = (db, per) => { api.set(db, per); return api.calc(); };
const porCliente = (R) => {
  const m = {};
  R.ventasLin.forEach((l) => { m[l.cliente] = (m[l.cliente] || 0) + (l.subtotal != null ? l.subtotal : l.cantidad * l.precioUnitario); });
  return m;
};

const sin = correr(datos(false), PER_OCT);
const con = correr(datos(true), PER_OCT);
cerca(sin.ventas['PET VERDE'].monto, 66504, 'sin descuento: PET VERDE de octubre (65,504 + 1,000)');
cerca(con.ventas['PET VERDE'].monto, 61598, 'con descuento: PET VERDE de octubre baja 4,906 (60,598 + 1,000)');
cerca(con.ventasMonto, 61598, 'ventas netas de octubre');
cerca(porCliente(con)['CHINOS QUERETARO'], 60598, 'por cliente: la partida de V-2026-045 queda en 60,598.00');
cerca(porCliente(con)['OTRO'], 1000, 'por cliente: otro cliente intacto');

// El descuento (fechado en noviembre) NO mueve ventas de noviembre: se atribuye al mes de la venta.
cerca(correr(datos(true), PER_NOV).ventasMonto, 0, 'noviembre no recibe el descuento ni la venta');

// Lo cobrado no cambia con el descuento (el descuento no es un cobro).
cerca(con.cobrado || 0, sin.cobrado || 0, 'lo cobrado no cambia');

// Saldo de CxC al corte: 0 con el descuento vigente; 4,906 antes de aplicarlo (31/10) y con el descuento revertido.
api.set(datos(true), PER_OCT);
cerca(api.cxcAlCorteDet('2026-11-12').todo, 0, 'saldo CxC al 12/11 con el descuento');
cerca(api.cxcAlCorteDet('2026-10-31').todo, 4906, 'saldo CxC al 31/10 (el descuento es del 12/11)');
const revertida = datos(true);
revertida.ventas[0].descuentos[0].revertido = true;
api.set(revertida, PER_OCT);
cerca(api.cxcAlCorteDet('2026-11-12').todo, 4906, 'saldo CxC con el descuento revertido');

// El puente de CxC del mes cuadra con el descuento: saldo inicial + generado − cobros − descuentos = saldo final.
api.set(datos(true), PER_NOV);
const puente = api.puenteCxCMes('2026-11-01', '2026-11-12');
cerca(puente.calculado, puente.final, 'puente CxC de noviembre cuadra con el descuento');
cerca(puente.final, 0, 'saldo final de noviembre');

console.log(`${ok}/${total} comprobaciones correctas`);
