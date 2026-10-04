(function () {

// Cotización en PDF institucional (carta vertical) con jsPDF y autoTable, los mismos que usan los reportes de los demás
// módulos. Los datos del emisor salen SIEMPRE de EVE_COTIZACIONES.obtenerEmisor() (config/emisor); aquí no hay datos fijos.
// Generar el PDF solo lee: no modifica la cotización ni consume folio.

const MARGEN = 15;
const MARGEN_INFERIOR = 22;
const AZUL_MARINO = [0, 29, 61];
const ORO = [255, 195, 0]; // #FFC300
const GRIS_OSCURO = [102, 102, 102];
const ROJO_ERROR = [239, 71, 111];
const AZUL_CLARO = [0, 119, 182];
const ARCHIVO_LOGO = 'icons/icon-192.png';

// Marca de agua por estado (null = sin marca). Enviada y Aceptada salen limpias.
const MARCAS_DE_AGUA = {
  Borrador: { texto: 'BORRADOR', color: GRIS_OSCURO },
  Cancelada: { texto: 'CANCELADA', color: ROJO_ERROR },
  Rechazada: { texto: 'RECHAZADA', color: ROJO_ERROR },
  Reemplazada: { texto: 'REEMPLAZADA', color: AZUL_CLARO }
};

const texto = (valor) => (valor === undefined || valor === null ? '' : String(valor)).trim();
const cotizaciones = () => window.EVE_COTIZACIONES;

// ── Total en letra (pesos mexicanos) ────────────────────────────────────────────────────────────────────────────────────
// 1234.56 → "UN MIL DOSCIENTOS TREINTA Y CUATRO PESOS 56/100 M.N.". Siempre "UN" (nunca "UNO") porque la cifra va delante
// de PESOS, MIL o MILLONES; los millones exactos llevan "DE PESOS".
const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO',
  'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
const LIMITE_LETRA = 1e12;

function menorDeMil(n) { // 1..999
  if (n === 100) return 'CIEN';
  const centenas = Math.floor(n / 100);
  const resto = n % 100;
  const partes = [];
  if (centenas) partes.push(CENTENAS[centenas]);
  if (resto) {
    if (resto < 30) {
      partes.push(UNIDADES[resto]);
    } else {
      const unidad = resto % 10;
      partes.push(unidad ? `${DECENAS[Math.floor(resto / 10)]} Y ${UNIDADES[unidad]}` : DECENAS[Math.floor(resto / 10)]);
    }
  }
  return partes.join(' ');
}

function enteroEnLetra(n) { // 0..999,999,999,999
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1e6);
  const resto = n % 1e6;
  const miles = Math.floor(resto / 1000);
  const unidades = resto % 1000;
  const partes = [];
  if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : `${enteroEnLetra(millones)} MILLONES`);
  if (miles) partes.push(`${menorDeMil(miles)} MIL`);
  if (unidades) partes.push(menorDeMil(unidades));
  return partes.join(' ');
}

function totalEnLetra(importe) {
  const numero = Number(importe);
  if (!Number.isFinite(numero) || numero < 0 || numero >= LIMITE_LETRA) throw new Error(`Importe no válido para escribir en letra: ${importe}`);
  const centavosTotales = Math.round(Number(`${Number(numero.toFixed(6))}e2`));
  const entero = Math.floor(centavosTotales / 100);
  const centavos = centavosTotales % 100;
  const moneda = entero === 1 ? 'PESO' : (entero >= 1e6 && entero % 1e6 === 0 ? 'DE PESOS' : 'PESOS');
  return `${enteroEnLetra(entero)} ${moneda} ${String(centavos).padStart(2, '0')}/100 M.N.`;
}

// ── Datos del documento ─────────────────────────────────────────────────────────────────────────────────────────────────
// Nombre del archivo = folio completo (con la revisión) y solo caracteres seguros: COT-2026-0001-R2.pdf
function nombreArchivo(cotizacion) {
  const folio = texto(cotizacion && cotizacion.folio).replace(/[^A-Za-z0-9._-]/g, '_');
  return `${folio || 'cotizacion'}.pdf`;
}

function marcaDeAgua(estado) {
  return MARCAS_DE_AGUA[estado] || null;
}

// Fecha límite = fecha + vigencia en días (YYYY-MM-DD → YYYY-MM-DD); '' si la fecha no es válida.
function fechaLimite(fecha, vigenciaDias) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto(fecha));
  if (!partes) return '';
  const [, anio, mes, dia] = partes.map(Number);
  const inicio = new Date(Date.UTC(anio, mes - 1, dia));
  if (inicio.getUTCFullYear() !== anio || inicio.getUTCMonth() !== mes - 1 || inicio.getUTCDate() !== dia) return '';
  return new Date(Date.UTC(anio, mes - 1, dia + (Number(vigenciaDias) || 0))).toISOString().slice(0, 10);
}

// R2 o mayor sustituye a la revisión anterior: R2 → el folio base (R1); R3 → ...-R2.
function folioQueSustituye(cotizacion) {
  const revision = cotizaciones().revisionDe(cotizacion);
  if (revision < 2) return '';
  const base = cotizaciones().folioBaseDe(cotizacion);
  return revision - 1 === 1 ? base : `${base}-R${revision - 1}`;
}

// Datos del emisor que el PDF institucional debería llevar y que faltan en config/emisor.
function faltantesEmisor(emisor) {
  const e = emisor || {};
  const faltan = [];
  if (!texto(e.rfc)) faltan.push('RFC');
  if (!texto(e.domicilioFiscal)) faltan.push('domicilio fiscal');
  return faltan;
}

const formatearCantidad = (valor) => (Number(valor) || 0).toLocaleString('es-MX', { maximumFractionDigits: 4 });
const descripcionDe = (p) => [texto(p.producto), texto(p.descripcion)].filter(Boolean).join(' - ');

// Todo lo que se escribe en el PDF, ya formateado (fechas dd/mm/aaaa, montos en pesos). No depende de jsPDF.
function construirModelo(cotizacion, emisor) {
  const c = cotizacion || {};
  const e = emisor || {};
  const totales = c.totales || {};
  const partidas = Array.isArray(c.partidas) ? c.partidas : [];
  const redondear2 = cotizaciones().redondear2;
  const bruto = redondear2(partidas.reduce((suma, p) => suma + redondear2((Number(p.cantidad) || 0) * (Number(p.precioUnitario) || 0)), 0));
  const descuento = redondear2(partidas.reduce((suma, p) => suma + redondear2((Number(p.cantidad) || 0) * (Number(p.precioUnitario) || 0)) - (Number(p.importe) || 0), 0));
  const tasa = Math.round((Number(totales.ivaTasa) || cotizaciones().IVA_TASA) * 100);

  const filasTotales = [];
  if (descuento > 0) {
    filasTotales.push(['Importe sin descuento', window.formatearMoneda(bruto)], ['Descuento', `- ${window.formatearMoneda(descuento)}`]);
  }
  filasTotales.push(['Subtotal', window.formatearMoneda(totales.subtotal)]);
  if (totales.aplicaIva) filasTotales.push([`IVA ${tasa}%`, window.formatearMoneda(totales.iva)]);
  filasTotales.push(['TOTAL', window.formatearMoneda(totales.total)]);

  const limite = fechaLimite(c.fecha, c.vigenciaDias);
  const dias = Number(c.vigenciaDias) || 0;
  const cliente = c.cliente || {};
  const marca = marcaDeAgua(c.estado);
  return {
    folio: texto(c.folio),
    estado: texto(c.estado),
    nombreArchivo: nombreArchivo(c),
    marca,
    emisor: { razonSocial: texto(e.razonSocial), rfc: texto(e.rfc), domicilioFiscal: texto(e.domicilioFiscal), telefono: texto(e.telefono), correo: texto(e.correo) },
    fecha: c.fecha ? window.formatearFecha(c.fecha) : '',
    vigencia: `${dias} ${dias === 1 ? 'día' : 'días'}${limite ? ` - válida hasta el ${window.formatearFecha(limite)}` : ''}`,
    sustituye: folioQueSustituye(c),
    cliente: { razonSocial: texto(cliente.razonSocial), contacto: texto(cliente.contacto), telefono: texto(cliente.telefono), direccion: texto(cliente.direccion) },
    partidas: partidas.map((p) => [
      formatearCantidad(p.cantidad), texto(p.unidad), descripcionDe(p), window.formatearMoneda(p.precioUnitario),
      `${Number(p.descuentoPct) || 0}%`, window.formatearMoneda(p.importe !== undefined ? p.importe : cotizaciones().calcularImportePartida(p))
    ]),
    filasTotales,
    totalLetra: totalEnLetra(totales.total),
    condicionesPago: texto(c.condicionesPago),
    condicionesEntrega: texto(c.condicionesEntrega),
    notas: texto(c.notas)
  };
}

// ── Dibujo ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const aclarar = (color) => color.map((valor) => Math.round(255 - (255 - valor) * 0.15)); // 15% de intensidad sobre blanco

// Dibuja el modelo en un doc de jsPDF (carta vertical). `logo`: data URL PNG o null.
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

  // (1) Encabezado: logo opcional y datos del emisor.
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

  // (2) Título, folio completo, fecha y vigencia con su fecha límite.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...AZUL_MARINO);
  doc.text('COTIZACIÓN', MARGEN, y);
  doc.setFontSize(14);
  doc.text(m.folio, derecha, y, { align: 'right' });
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...GRIS_OSCURO);
  doc.text(`Fecha: ${m.fecha}`, MARGEN, y);
  y += 5;
  doc.text(`Vigencia: ${m.vigencia}`, MARGEN, y);
  y += 5;
  if (m.sustituye) {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...AZUL_MARINO);
    doc.text(`Sustituye a ${m.sustituye}`, MARGEN, y);
    y += 5;
  }
  y += 5;

  // (3) Datos del cliente.
  seccion('DATOS DEL CLIENTE');
  [['Razón Social', m.cliente.razonSocial], ['Contacto', m.cliente.contacto], ['Teléfono', m.cliente.telefono], ['Dirección', m.cliente.direccion]].forEach(([etiqueta, valor]) => {
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
    head: [['Cant.', 'Unidad', 'Descripción', 'Precio unit.', 'Desc. %', 'Importe']],
    body: m.partidas,
    theme: 'grid', // sin relleno en las filas: la marca de agua se ve a través de la tabla
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, textColor: AZUL_MARINO, lineColor: GRIS_OSCURO, lineWidth: 0.1 },
    headStyles: { fillColor: AZUL_MARINO, textColor: ORO, fontStyle: 'bold' },
    bodyStyles: { fillColor: false },
    columnStyles: { 0: { halign: 'right', cellWidth: 20 }, 1: { cellWidth: 20 }, 3: { halign: 'right', cellWidth: 30 }, 4: { halign: 'right', cellWidth: 18 }, 5: { halign: 'right', cellWidth: 32 } },
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

function crearDocumento(cotizacion, emisor, logo) {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) throw new Error('No se cargó la librería de PDF (revisa tu conexión a internet)');
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  return dibujar(doc, construirModelo(cotizacion, emisor), logo || null);
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

// Genera y descarga el PDF de una cotización (cualquier estado, cualquier permiso). Si al emisor le falta el RFC o el
// domicilio fiscal avisa y pide confirmación; si el usuario acepta, genera igual. Devuelve el nombre del archivo, o null si
// el usuario canceló.
async function generarPDF(cotizacion) {
  if (!cotizacion) throw new Error('Falta la cotización');
  const emisor = await cotizaciones().obtenerEmisor();
  const faltan = faltantesEmisor(emisor);
  if (faltan.length && !window.confirm(`Faltan datos del emisor en Admin → Configuración: ${faltan.join(' y ')}.\n\nLa cotización saldrá sin esos datos. ¿Generar el PDF de todos modos?`)) return null;
  const doc = crearDocumento(cotizacion, emisor, await cargarLogo());
  const nombre = nombreArchivo(cotizacion);
  doc.save(nombre);
  return nombre;
}

window.EVE_COTIZACIONES_PDF = {
  totalEnLetra,
  nombreArchivo,
  marcaDeAgua,
  fechaLimite,
  folioQueSustituye,
  faltantesEmisor,
  construirModelo,
  crearDocumento,
  generarPDF
};

})();
