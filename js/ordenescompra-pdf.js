(function () {

// Orden de compra en PDF (A4 vertical) con jsPDF y autoTable, los mismos que usa la cotización. El emisor sale de
// EVE_COTIZACIONES.obtenerEmisor() (config/emisor; si no se puede leer, de la copia guardada en la orden); aquí no hay datos
// fijos. El total en letra y el aviso de datos faltantes del emisor se reutilizan de js/cotizaciones-pdf.js. Generar el PDF
// solo lee: no modifica la orden ni consume folio.

const MARGEN = 15;
const MARGEN_INFERIOR = 22;
const AZUL_MARINO = [0, 29, 61];
const ORO = [255, 195, 0]; // #FFC300
const GRIS_OSCURO = [102, 102, 102];
const ROJO_ERROR = [239, 71, 111];
const AZUL_CLARO = [0, 119, 182];
const VERDE = [46, 125, 50];
const ARCHIVO_LOGO = 'icons/icon-192.png';

// Marca de agua por estado: las tres llevan, para que el PDF diga en qué estado estaba la orden al descargarlo.
const MARCAS_DE_AGUA = {
  Emitida: { texto: 'EMITIDA', color: AZUL_CLARO },
  Recibida: { texto: 'RECIBIDA', color: VERDE },
  Cancelada: { texto: 'CANCELADA', color: ROJO_ERROR }
};

const texto = (valor) => (valor === undefined || valor === null ? '' : String(valor)).trim();
const cot = () => window.EVE_COTIZACIONES;
const cotPdf = () => window.EVE_COTIZACIONES_PDF;

// Nombre del archivo = folio completo y solo caracteres seguros: OC-2026-0001.pdf
function nombreArchivo(orden) {
  const folio = texto(orden && orden.folio).replace(/[^A-Za-z0-9._-]/g, '_');
  return `${folio || 'orden-compra'}.pdf`;
}

function marcaDeAgua(estado) {
  return MARCAS_DE_AGUA[estado] || null;
}

const formatearCantidad = (valor) => (Number(valor) || 0).toLocaleString('es-MX', { maximumFractionDigits: 4 });
const descripcionDe = (p) => [texto(p.producto), texto(p.descripcion)].filter(Boolean).join(' - ');

// Todo lo que se escribe en el PDF, ya formateado (fecha dd/mm/aaaa, montos en pesos). No depende de jsPDF.
function construirModelo(orden, emisor) {
  const o = orden || {};
  const e = emisor || {};
  const totales = o.totales || {};
  const partidas = Array.isArray(o.partidas) ? o.partidas : [];
  const redondear2 = cot().redondear2;
  const bruto = redondear2(partidas.reduce((suma, p) => suma + redondear2((Number(p.cantidad) || 0) * (Number(p.precioUnitario) || 0)), 0));
  const descuento = redondear2(partidas.reduce((suma, p) => suma + redondear2((Number(p.cantidad) || 0) * (Number(p.precioUnitario) || 0)) - (Number(p.importe) || 0), 0));
  const tasa = Math.round((Number(totales.ivaTasa) || cot().IVA_TASA) * 100);

  const filasTotales = [];
  if (descuento > 0) filasTotales.push(['Importe sin descuento', window.formatearMoneda(bruto)], ['Descuento', `- ${window.formatearMoneda(descuento)}`]);
  filasTotales.push(['Subtotal', window.formatearMoneda(totales.subtotal)]);
  if (totales.aplicaIva) filasTotales.push([`IVA ${tasa}%`, window.formatearMoneda(totales.iva)]);
  filasTotales.push(['TOTAL', window.formatearMoneda(totales.total)]);

  const proveedor = o.proveedor || {};
  return {
    folio: texto(o.folio),
    estado: texto(o.estado),
    nombreArchivo: nombreArchivo(o),
    marca: marcaDeAgua(o.estado),
    emisor: { razonSocial: texto(e.razonSocial), rfc: texto(e.rfc), domicilioFiscal: texto(e.domicilioFiscal), telefono: texto(e.telefono), correo: texto(e.correo) },
    fecha: o.fecha ? window.formatearFecha(o.fecha) : '',
    proveedor: { nombre: texto(proveedor.nombre), telefono: texto(proveedor.telefono), email: texto(proveedor.email), domicilio: texto(proveedor.domicilio) },
    partidas: partidas.map((p, i) => [
      String(i + 1), formatearCantidad(p.cantidad), texto(p.unidad), descripcionDe(p), window.formatearMoneda(p.precioUnitario),
      `${Number(p.descuentoPct) || 0}%`, window.formatearMoneda(p.importe !== undefined ? p.importe : cot().calcularImportePartida(p))
    ]),
    filasTotales,
    totalLetra: cotPdf().totalEnLetra(totales.total),
    condicionesPago: texto(o.condicionesPago),
    condicionesEntrega: texto(o.condicionesEntrega),
    notas: texto(o.notas)
  };
}

const aclarar = (color) => color.map((valor) => Math.round(255 - (255 - valor) * 0.15)); // 15% de intensidad sobre blanco

// Dibuja el modelo en un doc de jsPDF (A4 vertical). `logo`: data URL PNG o null.
function dibujar(doc, m, logo) {
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const derecha = ancho - MARGEN;
  const anchoUtil = ancho - 2 * MARGEN;
  const conMarca = new Set();
  let y = MARGEN;

  // La marca de agua se dibuja ANTES del contenido de cada página (diagonal, color claro) para no tapar el texto.
  function marcarPagina() {
    const pagina = doc.internal.getNumberOfPages();
    if (!m.marca || conMarca.has(pagina)) return;
    conMarca.add(pagina);
    const tamano = Math.min(90, Math.floor(760 / m.marca.texto.length));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(tamano);
    doc.setTextColor(...aclarar(m.marca.color));
    const mitad = doc.getTextWidth(m.marca.texto) / 2;
    const seno = Math.sin(Math.PI / 4);
    doc.text(m.marca.texto, ancho / 2 - mitad * seno, alto / 2 + mitad * seno, { angle: 45 });
  }
  function asegurarEspacio(altura) {
    if (y + altura <= alto - MARGEN_INFERIOR) return;
    doc.addPage();
    marcarPagina();
    y = MARGEN;
  }
  function seccion(titulo) {
    asegurarEspacio(14);
    doc.setFillColor(...ORO);
    doc.rect(MARGEN, y - 3.6, 1.6, 4.6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...AZUL_MARINO);
    doc.text(titulo, MARGEN + 4, y);
    y += 6;
  }
  function bloqueTexto(etiqueta, valor) {
    const lineas = doc.splitTextToSize(valor, anchoUtil);
    asegurarEspacio(8 + lineas.length * 4.4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...GRIS_OSCURO);
    doc.text(etiqueta, MARGEN, y);
    y += 4.6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...AZUL_MARINO);
    doc.text(lineas, MARGEN, y);
    y += lineas.length * 4.4 + 3;
  }

  marcarPagina();

  // (1) Encabezado: logo opcional y datos del emisor (quien compra).
  let xTexto = MARGEN;
  if (logo) {
    doc.addImage(logo, 'PNG', MARGEN, y, 20, 20);
    xTexto = MARGEN + 24;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...AZUL_MARINO);
  doc.text(m.emisor.razonSocial, xTexto, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS_OSCURO);
  const lineasEmisor = [];
  if (m.emisor.rfc) lineasEmisor.push(`RFC: ${m.emisor.rfc}`);
  if (m.emisor.domicilioFiscal) lineasEmisor.push(...doc.splitTextToSize(`Domicilio fiscal: ${m.emisor.domicilioFiscal}`, derecha - xTexto));
  const contacto = [m.emisor.telefono && `Tel. ${m.emisor.telefono}`, m.emisor.correo].filter(Boolean).join('   ');
  if (contacto) lineasEmisor.push(contacto);
  lineasEmisor.forEach((linea, i) => doc.text(linea, xTexto, y + 10 + i * 4));
  y += Math.max(22, 11 + lineasEmisor.length * 4);
  doc.setDrawColor(...ORO);
  doc.setLineWidth(0.8);
  doc.line(MARGEN, y, derecha, y);
  y += 10;

  // (2) Título, folio y fecha (una OC no lleva vigencia).
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...AZUL_MARINO);
  doc.text('ORDEN DE COMPRA', MARGEN, y);
  doc.setFontSize(14);
  doc.text(m.folio, derecha, y, { align: 'right' });
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...GRIS_OSCURO);
  doc.text(`Fecha: ${m.fecha}`, MARGEN, y);
  y += 10;

  // (3) Datos del proveedor.
  seccion('PROVEEDOR');
  [['Nombre', m.proveedor.nombre], ['Teléfono', m.proveedor.telefono], ['Correo', m.proveedor.email], ['Domicilio', m.proveedor.domicilio]].forEach(([etiqueta, valor]) => {
    const lineas = doc.splitTextToSize(valor || '-', anchoUtil - 30);
    asegurarEspacio(lineas.length * 4.4 + 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...GRIS_OSCURO);
    doc.text(`${etiqueta}:`, MARGEN, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...AZUL_MARINO);
    doc.text(lineas, MARGEN + 30, y);
    y += lineas.length * 4.4 + 1.6;
  });
  y += 4;

  // (4) Partidas: autoTable pagina sola y repite el encabezado; la marca de agua se pinta en cada página nueva.
  seccion('PARTIDAS');
  doc.autoTable({
    startY: y,
    margin: { left: MARGEN, right: MARGEN, bottom: MARGEN_INFERIOR },
    head: [['#', 'Cant.', 'Unidad', 'Descripción', 'Precio unit.', 'Desc. %', 'Importe']],
    body: m.partidas,
    theme: 'grid', // sin relleno en las filas: la marca de agua se ve a través de la tabla
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, textColor: AZUL_MARINO, lineColor: GRIS_OSCURO, lineWidth: 0.1 },
    headStyles: { fillColor: AZUL_MARINO, textColor: ORO, fontStyle: 'bold' },
    bodyStyles: { fillColor: false },
    columnStyles: { 0: { halign: 'right', cellWidth: 10 }, 1: { halign: 'right', cellWidth: 20 }, 2: { cellWidth: 18 }, 4: { halign: 'right', cellWidth: 28 }, 5: { halign: 'right', cellWidth: 16 }, 6: { halign: 'right', cellWidth: 30 } },
    willDrawPage: marcarPagina
  });
  y = doc.lastAutoTable.finalY + 8;

  // (5) Subtotal, descuento, IVA, total y total en letra (juntos en la misma página).
  const lineasLetra = doc.splitTextToSize(m.totalLetra, anchoUtil);
  asegurarEspacio(m.filasTotales.length * 6 + 12 + lineasLetra.length * 4.8);
  const xEtiqueta = derecha - 80;
  m.filasTotales.forEach(([etiqueta, valor], i) => {
    const esTotal = i === m.filasTotales.length - 1;
    if (esTotal) {
      doc.setDrawColor(...ORO);
      doc.setLineWidth(0.6);
      doc.line(xEtiqueta, y - 4, derecha, y - 4);
    }
    doc.setFont('helvetica', esTotal ? 'bold' : 'normal');
    doc.setFontSize(esTotal ? 12 : 10);
    doc.setTextColor(...(esTotal ? AZUL_MARINO : GRIS_OSCURO));
    doc.text(etiqueta, xEtiqueta, y);
    doc.text(valor, derecha, y, { align: 'right' });
    y += 6;
  });
  y += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...AZUL_MARINO);
  doc.text(lineasLetra, MARGEN, y);
  y += lineasLetra.length * 4.8 + 6;

  // (6) Condiciones de pago y de entrega, y notas (solo las que tengan texto).
  [['Condiciones de pago', m.condicionesPago], ['Condiciones de entrega', m.condicionesEntrega], ['Notas', m.notas]].forEach(([etiqueta, valor]) => {
    if (valor) bloqueTexto(etiqueta, valor);
  });

  // (7) Pie de cada página: emisor, folio y paginación.
  const paginas = doc.internal.getNumberOfPages();
  for (let pagina = 1; pagina <= paginas; pagina++) {
    doc.setPage(pagina);
    doc.setDrawColor(...ORO);
    doc.setLineWidth(0.4);
    doc.line(MARGEN, alto - MARGEN_INFERIOR + 8, derecha, alto - MARGEN_INFERIOR + 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRIS_OSCURO);
    doc.text(`${m.emisor.razonSocial} - ${m.folio}`, MARGEN, alto - MARGEN_INFERIOR + 13);
    doc.text(`Página ${pagina} de ${paginas}`, derecha, alto - MARGEN_INFERIOR + 13, { align: 'right' });
  }
  return doc;
}

function crearDocumento(orden, emisor, logo) {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) throw new Error('No se cargó la librería de PDF (revisa tu conexión a internet)');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  return dibujar(doc, construirModelo(orden, emisor), logo || null);
}

// El logo es el icono institucional del repo (icons/icon-192.png, precacheado por el service worker). Sin red o si no se
// puede leer, el encabezado sale solo con texto.
let logoEnCache = null;
async function cargarLogo() {
  if (logoEnCache) return logoEnCache;
  try {
    if (typeof fetch !== 'function' || typeof FileReader === 'undefined') return null;
    const respuesta = await fetch(ARCHIVO_LOGO);
    if (!respuesta.ok) return null;
    const blob = await respuesta.blob();
    logoEnCache = await new Promise((resolver, rechazar) => {
      const lector = new FileReader();
      lector.onload = () => resolver(lector.result);
      lector.onerror = () => rechazar(lector.error);
      lector.readAsDataURL(blob);
    });
  } catch (error) {
    return null;
  }
  return logoEnCache;
}

// Genera y descarga el PDF de una orden de compra (cualquier estado, cualquier permiso de lectura). Relee la orden del servidor
// para que estado y datos sean los reales; si no se puede leer (sin red ni caché) usa `copia` (la que está en pantalla). Si al
// emisor le falta el RFC o el domicilio fiscal avisa y pide confirmación. Devuelve el nombre del archivo, o null si el usuario
// canceló.
async function generarPdfOrdenCompra(id, copia) {
  let orden = copia || null;
  try {
    const fresca = await window.EVE_ORDENES_COMPRA.obtenerOC(id);
    if (fresca) orden = fresca;
    else if (!copia) throw new Error('La orden de compra ya no existe');
  } catch (errorLectura) {
    if (!orden) throw errorLectura;
  }
  if (!orden) throw new Error('Falta la orden de compra');
  let emisor;
  try {
    emisor = await cot().obtenerEmisor();
  } catch (errorEmisor) {
    emisor = cot().normalizarEmisor(orden.emisor);
  }
  const faltan = cotPdf().faltantesEmisor(emisor);
  if (faltan.length && !window.confirm(`Faltan datos del emisor en Admin → Configuración: ${faltan.join(' y ')}.\n\nLa orden saldrá sin esos datos. ¿Generar el PDF de todos modos?`)) return null;
  const doc = crearDocumento(orden, emisor, await cargarLogo());
  const nombre = nombreArchivo(orden);
  doc.save(nombre);
  return nombre;
}

window.EVE_ORDENES_COMPRA_PDF = {
  nombreArchivo,
  marcaDeAgua,
  construirModelo,
  crearDocumento,
  generarPdfOrdenCompra
};

})();
