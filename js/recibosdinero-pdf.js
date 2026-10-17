(function () {

// Recibo de dinero en PDF institucional (carta vertical, UNA sola hoja) con jsPDF y autoTable, los mismos que usan Cotizaciones y
// Órdenes de Compra, y con el mismo logo (window.LOGO_EMPRESA). Sigue el formato de docs/Recibo_Dinero_Anticipo_RIVALPLASTIC.xlsx.
// Los datos del emisor salen SIEMPRE de EVE_COTIZACIONES.obtenerEmisor() (config/emisor; si no se puede leer, de la copia guardada
// en el recibo); aquí no hay datos fijos del emisor. Generar el PDF solo lee: no modifica el recibo ni consume folio.
// Debe cargarse después de js/recibosdinero.js.

const cot = () => window.EVE_COTIZACIONES;
const cotPdf = () => window.EVE_COTIZACIONES_PDF;
const recibos = () => window.EVE_RECIBOS_DINERO;

const MARGEN = 15;
const MARGEN_INFERIOR = 22;
const AZUL_MARINO = [0, 29, 61];
const ORO = [255, 195, 0]; // #FFC300
const GRIS_OSCURO = [102, 102, 102];
const GRIS_CLARO = [245, 245, 245];
const ROJO_ERROR = [239, 71, 111];

const texto = (valor) => (valor === undefined || valor === null ? '' : String(valor)).trim();

const TITULO = 'RECIBO DE DINERO';
const LEYENDA = 'RECIBO DE CONTROL INTERNO. No sustituye al CFDI ni acredita por sí solo la liquidación total de la operación.';
const PIE = 'MATERIALES PLÁSTICOS  •  PRODUCTOS PLÁSTICOS  •  SOLUCIONES LOGÍSTICAS';
const RAZON_SOCIAL_RESPALDO = 'RIVAL PLASTIC, S.A.P.I. DE C.V.';

// Anticipo: texto del formato Excel. Pago de contado: equivalente, que indica que se recibe el pago TOTAL de la compra descrita.
const declaracionAnticipo = (razon) => `${razon} declara haber recibido del cliente identificado en este documento el importe señalado, en calidad de anticipo o pago a cuenta de la operación descrita. El importe se aplicará a dicha compra conforme a la cotización, pedido o condiciones comerciales acordadas. Este recibo acredita únicamente la recepción del dinero indicado; no representa por sí mismo la entrega de mercancía, la liquidación total de la operación ni sustituye el CFDI que corresponda.`;
const declaracionContado = (razon) => `${razon} declara haber recibido del cliente identificado en este documento el importe señalado, como pago total de contado de la compra descrita en el concepto. Este recibo acredita únicamente la recepción del dinero indicado; no representa por sí mismo la entrega de mercancía ni sustituye el CFDI que corresponda.`;

// Nombre del archivo = folio y solo caracteres seguros: RD-16102026-001.pdf
function nombreArchivo(recibo) {
  const folio = texto(recibo && recibo.folio).replace(/[^A-Za-z0-9._-]/g, '_');
  return `${folio || 'recibo-de-dinero'}.pdf`;
}

const formatearCantidad = (valor) => (Number(valor) || 0).toLocaleString('es-MX', { maximumFractionDigits: 4 });
const formatoImporte = (importe, moneda) => `${window.formatearMoneda(importe)} ${moneda || 'MXN'}`;

// Todo lo que se escribe en el PDF, ya formateado (fechas dd/mm/aaaa, montos con su moneda). No depende de jsPDF.
function construirModelo(recibo, emisor) {
  const r = recibo || {};
  const e = emisor || {};
  const cliente = r.cliente || {};
  const moneda = texto(r.moneda) || 'MXN';
  const razonSocial = texto(e.razonSocial) || RAZON_SOCIAL_RESPALDO;
  const esAnticipo = r.tipo === recibos().TIPO_ANTICIPO;
  const partidas = esAnticipo && r.resumen && Array.isArray(r.resumen.partidas) ? r.resumen.partidas : [];
  const cancelado = r.estado === recibos().ESTADO_CANCELADO;
  return {
    folio: texto(r.folio),
    estado: texto(r.estado),
    nombreArchivo: nombreArchivo(r),
    marca: cancelado ? { texto: 'CANCELADO', color: ROJO_ERROR } : null,
    titulo: TITULO,
    emisor: { razonSocial, domicilio: texto(e.domicilioFiscal), telefono: texto(e.telefono), correo: texto(e.correo) },
    leyenda: LEYENDA,
    cancelacion: cancelado
      ? `CANCELADO el ${window.formatearFecha(texto(r.canceladoEn).slice(0, 10))} por ${texto(r.canceladoPor)}. Motivo: ${texto(r.motivoCancelacion)}`
      : '',
    cliente: { nombre: texto(cliente.nombre), rfc: texto(cliente.rfc), domicilio: texto(cliente.domicilio) },
    fecha: r.fecha ? window.formatearFecha(r.fecha) : '',
    importe: formatoImporte(r.importe, moneda),
    moneda,
    importeLetra: texto(r.importeLetra) || recibos().importeConLetra(Number(r.importe) || 0, moneda),
    formaPago: texto(r.formaPago),
    referencia: texto(r.referencia),
    concepto: texto(r.concepto),
    pedidoReferencia: texto(r.pedidoReferencia),
    // Resumen de la operación: solo en Anticipo y solo si se capturó. Saldo pendiente = total de la operación − importe recibido.
    resumen: partidas.length === 0 ? null : {
      filas: partidas.map((p) => [texto(p.descripcion), formatearCantidad(p.cantidad), texto(p.unidad), window.formatearMoneda(p.precioUnitario), window.formatearMoneda(p.importe)]),
      totales: [
        ['Total de la operación', formatoImporte(r.resumen.totalOperacion, moneda)],
        ['Importe recibido', formatoImporte(r.resumen.importeRecibido, moneda)],
        ['Saldo pendiente', formatoImporte(r.resumen.saldoPendiente, moneda)]
      ]
    },
    tituloDeclaracion: 'DECLARACIÓN Y ALCANCE',
    declaracion: esAnticipo ? declaracionAnticipo(razonSocial) : declaracionContado(razonSocial),
    pie: PIE
  };
}

// ── Dibujo ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const aclarar = (color) => color.map((valor) => Math.round(255 - (255 - valor) * 0.15)); // 15% de intensidad sobre blanco

// Escalas con las que se intenta que todo quepa en UNA hoja: la primera que lo logra gana (1 = tamaños normales).
const ESCALAS = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58];

// Dibuja el modelo en un doc de jsPDF (carta vertical) a la `escala` indicada y devuelve { doc, paginas, cabe }: `cabe` es true si
// todo (incluidas las firmas) quedó dentro de la hoja, sobre el pie. `logo`: data URL PNG o null.
function dibujar(doc, m, logo, escala) {
  const k = escala || 1;
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const derecha = ancho - MARGEN;
  const anchoUtil = ancho - 2 * MARGEN;
  const limite = alto - MARGEN_INFERIOR;
  let y = MARGEN;

  const fuente = (estilo, tamano, color) => {
    doc.setFont('helvetica', estilo);
    doc.setFontSize(tamano * k);
    doc.setTextColor(...color);
  };
  // La marca de agua se dibuja ANTES del contenido (diagonal, color claro) para no tapar el texto.
  if (m.marca) {
    const tamano = Math.min(90, Math.floor(760 / m.marca.texto.length));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(tamano);
    doc.setTextColor(...aclarar(m.marca.color));
    const mitad = doc.getTextWidth(m.marca.texto) / 2;
    const seno = Math.sin(Math.PI / 4);
    doc.text(m.marca.texto, ancho / 2 - mitad * seno, alto / 2 + mitad * seno, { angle: 45 });
  }
  function seccion(titulo) {
    y += 2 * k;
    doc.setFillColor(...ORO);
    doc.rect(MARGEN, y - 3.4 * k, 1.6, 4.4 * k, 'F');
    fuente('bold', 10, AZUL_MARINO);
    doc.text(titulo, MARGEN + 4, y);
    y += 5.5 * k;
  }
  // Fila de campos con etiqueta y valor; un valor vacío deja una línea para llenarlo a mano. `columnas`: [[etiqueta, valor], ...]
  // (1 o 2); la segunda arranca al 56% del ancho. Avanza `y` lo que ocupe la columna más alta.
  function fila(columnas, anchoEtiquetas) {
    const inicios = [MARGEN, MARGEN + anchoUtil * 0.56];
    const anchos = [columnas.length === 1 ? anchoUtil : anchoUtil * 0.56 - 4, derecha - inicios[1]];
    let altura = 0;
    columnas.forEach(([etiqueta, valor], i) => {
      const xValor = inicios[i] + anchoEtiquetas[i];
      const anchoValor = anchos[i] - anchoEtiquetas[i];
      fuente('bold', 8.5, GRIS_OSCURO);
      doc.text(etiqueta, inicios[i], y);
      if (valor) {
        fuente('normal', 10, AZUL_MARINO);
        const lineas = doc.splitTextToSize(valor, anchoValor);
        doc.text(lineas, xValor, y);
        altura = Math.max(altura, (lineas.length - 1) * 4.4 * k);
      } else {
        doc.setDrawColor(...GRIS_OSCURO);
        doc.setLineWidth(0.2);
        doc.line(xValor, y + 0.8, inicios[i] + anchos[i], y + 0.8);
      }
    });
    y += altura + 6.2 * k;
  }

  // (1) Encabezado: logo a la izquierda; a la derecha título, folio y razón social del emisor.
  const alturaEncabezado = 24 * k;
  if (logo) {
    const medidas = window.medidasLogoEmpresa(46 * k, alturaEncabezado);
    doc.addImage(logo, 'PNG', MARGEN, y, medidas.ancho, medidas.alto);
  }
  fuente('bold', 19, AZUL_MARINO);
  doc.text(m.titulo, derecha, y + 7 * k, { align: 'right' });
  fuente('bold', 11, AZUL_MARINO);
  doc.text(`Folio: ${m.folio}`, derecha, y + 14 * k, { align: 'right' });
  fuente('bold', 10, GRIS_OSCURO);
  doc.text(m.emisor.razonSocial, derecha, y + 20.5 * k, { align: 'right' });
  y += alturaEncabezado + 3 * k;

  // (2) Domicilio, teléfono y correo del emisor (solo los que existan) y franja dorada.
  const contacto = [m.emisor.domicilio && `Domicilio: ${m.emisor.domicilio}`, m.emisor.telefono && `Tel.: ${m.emisor.telefono}`, m.emisor.correo && `Correo: ${m.emisor.correo}`].filter(Boolean).join('  |  ');
  if (contacto) {
    fuente('normal', 8.5, GRIS_OSCURO);
    const lineas = doc.splitTextToSize(contacto, anchoUtil);
    doc.text(lineas, MARGEN, y);
    y += lineas.length * 3.9 * k + 1;
  }
  doc.setDrawColor(...ORO);
  doc.setLineWidth(0.8);
  doc.line(MARGEN, y, derecha, y);
  y += 5 * k;

  // (3) Leyenda de control interno (y, si está cancelado, el aviso con su motivo).
  fuente('italic', 8.5, AZUL_MARINO);
  const lineasLeyenda = doc.splitTextToSize(m.leyenda, anchoUtil - 6);
  const altoLeyenda = lineasLeyenda.length * 3.9 * k + 4;
  doc.setFillColor(...GRIS_CLARO);
  doc.rect(MARGEN, y - 3.6 * k, anchoUtil, altoLeyenda, 'F');
  doc.text(lineasLeyenda, MARGEN + 3, y + 0.4 * k);
  y += altoLeyenda + 1.5 * k;
  if (m.cancelacion) {
    fuente('bold', 9, ROJO_ERROR);
    const lineasCancelacion = doc.splitTextToSize(m.cancelacion, anchoUtil);
    doc.text(lineasCancelacion, MARGEN, y + 1 * k);
    y += lineasCancelacion.length * 4.2 * k + 2 * k;
  }

  // (4) Datos del cliente y del pago.
  seccion('DATOS DEL CLIENTE Y DEL PAGO');
  fila([['Recibimos de:', m.cliente.nombre]], [30]);
  fila([['RFC (opcional):', m.cliente.rfc], ['Fecha:', m.fecha]], [30, 14]);
  fila([['Domicilio / Ciudad:', m.cliente.domicilio]], [30]);
  fila([['Importe recibido:', m.importe], ['Moneda:', m.moneda]], [30, 17]);
  fuente('bold', 8.5, GRIS_OSCURO);
  doc.text('Importe con letra:', MARGEN, y);
  fuente('bold', 10, AZUL_MARINO);
  const lineasLetra = doc.splitTextToSize(m.importeLetra, anchoUtil - 30);
  doc.text(lineasLetra, MARGEN + 30, y);
  y += (lineasLetra.length - 1) * 4.6 * k + 6.2 * k;
  fila([['Forma de pago:', m.formaPago], ['Referencia:', m.referencia]], [30, 22]);

  // (5) Concepto del pago y documento de la operación.
  seccion('CONCEPTO DEL PAGO');
  fuente('normal', 10, AZUL_MARINO);
  const lineasConcepto = doc.splitTextToSize(m.concepto, anchoUtil);
  doc.text(lineasConcepto, MARGEN, y);
  y += lineasConcepto.length * 4.5 * k + 3 * k;
  fila([['Pedido / cotización / OC No.:', m.pedidoReferencia]], [50]);

  // (6) Resumen de la operación con saldo pendiente: solo en Anticipo y solo si se capturó.
  if (m.resumen) {
    seccion('RESUMEN DE LA OPERACIÓN');
    doc.autoTable({
      startY: y - 1,
      margin: { left: MARGEN, right: MARGEN, bottom: MARGEN_INFERIOR },
      head: [['Descripción del producto', 'Cantidad', 'Unidad', 'Precio unitario', 'Importe']],
      body: m.resumen.filas,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8.5 * k, cellPadding: 1.4 * k, textColor: AZUL_MARINO, lineColor: [200, 200, 200], lineWidth: 0.2 },
      headStyles: { fillColor: AZUL_MARINO, textColor: ORO, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'right', cellWidth: 22 }, 2: { cellWidth: 20 }, 3: { halign: 'right', cellWidth: 30 }, 4: { halign: 'right', cellWidth: 30 } }
    });
    y = doc.lastAutoTable.finalY + 5 * k;
    const xEtiqueta = derecha - 86;
    m.resumen.totales.forEach(([etiqueta, valor], i) => {
      const esSaldo = i === m.resumen.totales.length - 1;
      if (esSaldo) {
        doc.setDrawColor(...ORO);
        doc.setLineWidth(0.6);
        doc.line(xEtiqueta, y - 4 * k, derecha, y - 4 * k);
      }
      fuente(esSaldo ? 'bold' : 'normal', esSaldo ? 11 : 9.5, esSaldo ? AZUL_MARINO : GRIS_OSCURO);
      doc.text(etiqueta, xEtiqueta, y);
      doc.text(valor, derecha, y, { align: 'right' });
      y += 5.4 * k;
    });
    y += 1 * k;
  }

  // (7) Declaración y alcance.
  seccion(m.tituloDeclaracion);
  fuente('normal', 9, AZUL_MARINO);
  const lineasDeclaracion = doc.splitTextToSize(m.declaracion, anchoUtil);
  doc.text(lineasDeclaracion, MARGEN, y);
  y += lineasDeclaracion.length * 4.1 * k + 6 * k;

  // (8) Dos bloques de firma: quien recibe por RIVALPLASTIC y quien entrega el dinero.
  const anchoBloque = (anchoUtil - 14) / 2;
  const bloques = [
    { x: MARGEN, titulo: 'RECIBIÓ POR RIVALPLASTIC', campos: ['Nombre:', 'Cargo:'] },
    { x: MARGEN + anchoBloque + 14, titulo: 'ENTREGÓ EL DINERO', campos: ['Nombre:', 'Identificación (opcional):'] }
  ];
  // Las firmas van ancladas al fondo de la hoja cuando sobra espacio; si el contenido no deja lugar, `cabe` queda en false.
  const altoFirmas = 9 * k + 2 * 9 * k + 17 * k;
  const cabe = y + altoFirmas <= limite + 0.5;
  const yFirmas = Math.max(y, limite - altoFirmas);
  bloques.forEach((bloque) => {
    let yb = yFirmas;
    fuente('bold', 9, AZUL_MARINO);
    doc.text(bloque.titulo, bloque.x, yb);
    doc.setFillColor(...ORO);
    doc.rect(bloque.x, yb + 1.6 * k, anchoBloque, 0.6, 'F');
    yb += 9 * k;
    bloque.campos.concat(['Firma:']).forEach((etiqueta) => {
      const esFirma = etiqueta === 'Firma:';
      if (esFirma) yb += 7 * k;
      fuente('bold', 8.5, GRIS_OSCURO);
      const anchoEtiqueta = doc.getTextWidth(etiqueta) + 2;
      doc.text(etiqueta, bloque.x, yb);
      doc.setDrawColor(...GRIS_OSCURO);
      doc.setLineWidth(0.25);
      doc.line(bloque.x + anchoEtiqueta, yb + 0.8, bloque.x + anchoBloque, yb + 0.8);
      yb += 9 * k;
    });
  });

  // (9) Pie: franja dorada y lema.
  doc.setDrawColor(...ORO);
  doc.setLineWidth(0.4);
  doc.line(MARGEN, alto - MARGEN_INFERIOR + 8, derecha, alto - MARGEN_INFERIOR + 8);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...GRIS_OSCURO);
  doc.text(m.pie, ancho / 2, alto - MARGEN_INFERIOR + 13, { align: 'center' });
  return { doc, paginas: doc.internal.getNumberOfPages(), cabe };
}

// Arma el documento probando escalas hasta que todo quepa en una sola hoja carta. Devuelve { doc, escala, paginas, cabe }; `cabe`
// solo es false si ni a la escala más chica entra (el módulo limita las partidas para que eso no ocurra con recibos válidos).
function construirDocumento(recibo, emisor, logo) {
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDF) throw new Error('No se cargó la librería de PDF (revisa tu conexión a internet)');
  const modelo = construirModelo(recibo, emisor);
  let resultado = null;
  let escalaUsada = ESCALAS[0];
  for (const escala of ESCALAS) {
    escalaUsada = escala;
    resultado = dibujar(new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' }), modelo, logo || null, escala);
    if (resultado.paginas === 1 && resultado.cabe) break;
  }
  return { ...resultado, escala: escalaUsada, cabe: resultado.paginas === 1 && resultado.cabe };
}

function crearDocumento(recibo, emisor, logo) {
  return construirDocumento(recibo, emisor, logo).doc;
}

// Genera y descarga el PDF de un recibo (cualquier estado, cualquier permiso de lectura). Relee el recibo del servidor para que
// estado y datos sean los reales; si no se puede leer (sin red ni caché) usa `copia` (la que está en pantalla). Si al emisor le
// falta el RFC o el domicilio fiscal avisa y pide confirmación. Devuelve el nombre del archivo, o null si el usuario canceló.
async function generarPdfReciboDinero(id, copia) {
  let recibo = copia || null;
  try {
    const fresco = await recibos().obtenerRecibo(id);
    if (fresco) recibo = fresco;
    else if (!copia) throw new Error('El recibo ya no existe');
  } catch (errorLectura) {
    if (!recibo) throw errorLectura;
  }
  if (!recibo) throw new Error('Falta el recibo');
  let emisor;
  try {
    emisor = await cot().obtenerEmisor();
  } catch (errorEmisor) {
    emisor = cot().normalizarEmisor(recibo.emisor);
  }
  const faltan = cotPdf().faltantesEmisor(emisor);
  if (faltan.length && !window.confirm(`Faltan datos del emisor en Admin → Configuración: ${faltan.join(' y ')}.\n\nEl recibo saldrá sin esos datos. ¿Generar el PDF de todos modos?`)) return null;
  const doc = crearDocumento(recibo, emisor, await window.cargarLogoEmpresa());
  const nombre = nombreArchivo(recibo);
  doc.save(nombre);
  return nombre;
}

window.EVE_RECIBOS_DINERO_PDF = {
  declaracionAnticipo,
  declaracionContado,
  nombreArchivo,
  construirModelo,
  construirDocumento,
  crearDocumento,
  generarPdfReciboDinero
};

})();
