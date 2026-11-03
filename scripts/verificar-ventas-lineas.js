// Verifica que la tabla de Ventas muestra una fila por línea de material (desglose de CxC), con subtotal por folio.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const leer = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const src = leer('js/ventas.js');
const srcCxc = leer('js/cxc.js');
const srcOrd = leer('js/ordenar-tabla.js');
let ok = 0, total = 0;
function afirmar(c, m) { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; }
function extraer(fuente, nombre) {
  const i = fuente.indexOf('function ' + nombre + '(');
  const j = fuente.indexOf('\n}\n', i);
  return fuente.slice(i, j + 3);
}

// DOM mínimo
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.className = ''; this._t = ''; this.listeners = {}; }
  set textContent(v) { this._t = String(v); }
  get textContent() { return this._t || this.children.map((c) => c.textContent).join(''); }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = v; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(ev, fn) { this.listeners[ev] = fn; }
  set innerHTML(v) { this.children = []; }
  set colSpan(v) { this.attrs.colspan = v; }
}
const tbody = new El('tbody');
const fmt = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ventas = [
  { id: 'v1', folio: 'V-1', cliente: 'ACME', fecha: '2026-11-01', totalVenta: 350, lineas: [
    { material: 'PET', cantidad: 1000, unidad: 'KG', precioUnitario: 0.2, subtotal: 200, totalLinea: 200 },
    { material: 'HDPE', cantidad: 500, unidad: 'KG', precioUnitario: 0.3, subtotal: 150, totalLinea: 150 }] },
  { id: 'v2', folio: 'V-2', cliente: 'BETA', fecha: '2026-11-02', totalVenta: 90, lineas: [
    { material: 'PP', cantidad: 300, unidad: 'KG', precioUnitario: 0.3, subtotal: 90, totalLinea: 90 }] }
];
const copia = JSON.stringify(ventas);
const cxcLimpio = extraer(srcCxc, 'construirDocsCxCDesdeVenta');
const ctx = {
  window: { puedeEscribir: () => true, formatearFecha: (f) => f, formatearMoneda: fmt, formatearKg: (c, m) => Number(c).toLocaleString('es-MX') + ' KG' },
  document: { createElement: (t) => new El(t), getElementById: () => tbody },
  abrirModalEdicion() {}, confirmarEliminar() {}
};
vm.createContext(ctx);
vm.runInContext(cxcLimpio + '\nthis.window.EVE_CXC = { construirDocsCxCDesdeVenta };', ctx);
vm.runInContext(['construirCeldasFila', 'construirCeldaAcciones', 'construirFilasTabla', 'llenarTabla'].map((n) => extraer(src, n)).join('\n') + '\nthis.f = { llenarTabla, construirFilasTabla };', ctx);
ctx.f.llenarTabla(ventas);

const filas = tbody.children;
afirmar(filas.length === 5, `5 filas (2 líneas + subtotal + 1 línea + subtotal), hay ${filas.length}`);
const txt = (f) => f.children.map((c) => c.textContent);
afirmar(txt(filas[0]).slice(0, 7).join('|') === ['V-1', 'ACME', '2026-11-01', 'PET', '1,000 KG', '$0.20', '$200.00'].join('|'), 'primera fila con folio, cliente, fecha y línea');
afirmar(txt(filas[1]).slice(0, 3).join('') === '' && txt(filas[1])[3] === 'HDPE' && txt(filas[1])[6] === '$150.00', 'segunda línea sin folio/cliente/fecha');
afirmar(txt(filas[2])[3] === 'Subtotal V-1' && txt(filas[2])[6] === '$350.00', 'subtotal del folio');
afirmar(txt(filas[3])[0] === 'V-2' && txt(filas[4])[6] === '$90.00', 'segundo folio');
// Editar/Eliminar una sola vez por folio
const botones = (f) => f.children[7].children.length;
afirmar(botones(filas[0]) === 2 && botones(filas[1]) === 0 && botones(filas[2]) === 0, 'botones solo en la primera fila');
// Filas ligadas para el ordenamiento
afirmar(!filas[0].hasAttribute('data-fila-ligada') && filas[1].hasAttribute('data-fila-ligada') && filas[2].hasAttribute('data-fila-ligada') && !filas[3].hasAttribute('data-fila-ligada'), 'filas 2..n y subtotal ligadas a la primera');
afirmar(!filas.some((f) => f.children.some((c) => c.hasAttribute('colspan'))), 'ninguna fila de datos usa colspan (no se ancla)');
// Suma de líneas = total que muestra Ventas
const sumaLineas = ventas.map((v) => v.lineas.reduce((s, l) => s + l.totalLinea, 0));
afirmar(sumaLineas[0] === ventas[0].totalVenta && sumaLineas[1] === ventas[1].totalVenta, 'suma de líneas = totalVenta');
afirmar(JSON.stringify(ventas) === copia, 'ventas sin modificar');
// El ordenamiento mueve las filas ligadas con su folio
afirmar(srcOrd.includes("hasAttribute('data-fila-ligada')"), 'ordenar-tabla soporta data-fila-ligada');
// Exportaciones sin cambios: siguen usando resumenMateriales y totalVenta
afirmar(/body: ventas\.map\(\(v\) => \[v\.folio, v\.cliente, window\.formatearFecha\(v\.fecha\), resumenMateriales\(v\), window\.formatearMoneda\(v\.totalVenta\)\]\)/.test(src), 'PDF sin cambios');
afirmar(src.includes('${resumenMateriales(v)}  ${window.formatearMoneda(v.totalVenta)}'), 'TXT sin cambios');
console.log(`${ok}/${total} verificaciones correctas`);
