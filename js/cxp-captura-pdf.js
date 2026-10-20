// ===== PDF de la Vista para captura de CxP =====
// Réplica de lo que se ve en pantalla, para uso interno: sin logo, sin encabezado nuevo y sin reconstruir las tablas. Se
// fotografía el DOM con html2canvas por bloques (el panel Resumen y cada proveedor visible) y se arma el PDF con jsPDF.
// Los bloques se apilan en una sola página continua (ancho de la vista, altura sumada); si la altura supera el máximo se
// parte en varias páginas solo entre proveedores, nunca dentro de uno. No toca la selección: el estado de los checkboxes y de
// 'Mostrar solo seleccionados' se captura tal como está.
(function () {
  const ESCALA_CAPTURA = 2;
  // jsPDF/PDF aceptan páginas de hasta 14400 pt; con px_scaling 1 px = 0.75 pt, así que 14400 px (10800 pt) queda dentro con holgura.
  const MAX_ALTO_PAGINA_PDF = 14400;
  const CLAVE_DOBLE_REGISTRO = 'cxp-captura-pdf';

  // Reparte los bloques en páginas sin partir ninguno: el Resumen va en la primera página junto con al menos el primer
  // proveedor, y se abre una página nueva solo antes de un proveedor que ya no cabe. Un proveedor más alto que el máximo
  // va completo en su propia página. Devuelve [{ conResumen, indices, alto }].
  function repartirBloquesEnPaginas(altoResumen, altosProveedores, maxAlto, espacio) {
    const hueco = espacio || 0;
    const paginas = [];
    let actual = { conResumen: altoResumen > 0, indices: [], alto: altoResumen > 0 ? altoResumen : 0 };
    altosProveedores.forEach((alto, indice) => {
      const hayPrevio = actual.alto > 0;
      const agregado = alto + (hayPrevio ? hueco : 0);
      if (actual.indices.length > 0 && actual.alto + agregado > maxAlto) {
        paginas.push(actual);
        actual = { conResumen: false, indices: [indice], alto };
      } else {
        actual.indices.push(indice);
        actual.alto += agregado;
      }
    });
    if (actual.conResumen || actual.indices.length > 0) paginas.push(actual);
    return paginas;
  }

  const esVisible = (elemento) => elemento.getClientRects().length > 0;

  // Panel Resumen y bloques de proveedor que se ven ahora (respeta 'Mostrar solo seleccionados').
  function obtenerBloquesVisibles(overlay) {
    const resumen = overlay.querySelector('.captura-resumen');
    return {
      resumen: resumen && esVisible(resumen) ? resumen : null,
      proveedores: Array.from(overlay.querySelectorAll('.captura-dia')).filter(esVisible)
    };
  }

  function colorRgb(texto) {
    const partes = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(texto || '');
    return partes ? [Number(partes[1]), Number(partes[2]), Number(partes[3])] : [255, 255, 255];
  }

  function nombreArchivoPdf() {
    return `CxP_por_proveedor_${window.obtenerFechaMexico()}.pdf`;
  }

  // Genera el PDF de la vista abierta. Devuelve { doc, nombre }. opciones.maxAlto sustituye el máximo de altura por página.
  async function generarPdfCaptura(overlay, opciones) {
    const jsPDF = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDF || !window.html2canvas) {
      throw new Error('No se cargó la librería de PDF o de captura (revisa tu conexión a internet)');
    }
    const { resumen, proveedores } = obtenerBloquesVisibles(overlay);
    if (!resumen && proveedores.length === 0) throw new Error('No hay contenido para exportar a PDF');

    // Con las fuentes sin cargar la foto saldría con la tipografía de respaldo.
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    const estilo = window.getComputedStyle(overlay);
    const fondo = estilo.backgroundColor;
    const maxAlto = (opciones && opciones.maxAlto) || MAX_ALTO_PAGINA_PDF;
    const espacio = proveedores.length > 0 ? parseFloat(window.getComputedStyle(proveedores[0]).marginBottom) || 0 : 0;

    const capturar = async (elemento) => {
      const canvas = await window.html2canvas(elemento, { scale: ESCALA_CAPTURA, backgroundColor: fondo, useCORS: true, logging: false });
      return { imagen: canvas.toDataURL('image/png'), ancho: canvas.width / ESCALA_CAPTURA, alto: canvas.height / ESCALA_CAPTURA };
    };
    const fotoResumen = resumen ? await capturar(resumen) : null;
    const fotosProveedores = [];
    for (const bloque of proveedores) fotosProveedores.push(await capturar(bloque));

    const paginas = repartirBloquesEnPaginas(fotoResumen ? fotoResumen.alto : 0, fotosProveedores.map((f) => f.alto), maxAlto, espacio);
    const ancho = Math.max(...[fotoResumen].concat(fotosProveedores).filter(Boolean).map((f) => f.ancho));
    const orientacion = (alto) => (ancho > alto ? 'l' : 'p');
    const [r, g, b] = colorRgb(fondo);

    let doc = null;
    paginas.forEach((pagina, numero) => {
      const formato = [ancho, pagina.alto];
      if (!doc) {
        doc = new jsPDF({ unit: 'px', format: formato, orientation: orientacion(pagina.alto), hotfixes: ['px_scaling'], compress: true });
      } else {
        doc.addPage(formato, orientacion(pagina.alto));
      }
      doc.setFillColor(r, g, b);
      doc.rect(0, 0, ancho, pagina.alto, 'F');
      let y = 0;
      const fotos = (pagina.conResumen ? [fotoResumen] : []).concat(pagina.indices.map((i) => fotosProveedores[i]));
      fotos.forEach((foto) => {
        doc.addImage(foto.imagen, 'PNG', 0, y, foto.ancho, foto.alto, undefined, 'FAST');
        y += foto.alto + espacio;
      });
    });
    return { doc, nombre: nombreArchivoPdf() };
  }

  async function descargarPdf(overlay, opciones) {
    return window.protegerContraDobleRegistro(CLAVE_DOBLE_REGISTRO, async () => {
      try {
        const { doc, nombre } = await generarPdfCaptura(overlay, opciones);
        doc.save(nombre);
        return true;
      } catch (error) {
        window.showError(error.message);
        return false;
      }
    });
  }

  // Barra de acciones de la vista. data-html2canvas-ignore la deja fuera de cualquier captura; captura-no-imprimir, fuera de la impresión.
  function agregarBotones(overlay) {
    const contenido = overlay && overlay.querySelector('.captura-contenido');
    if (!contenido || !overlay.querySelector('.captura-resumen, .captura-dia')) return;
    const barra = document.createElement('div');
    barra.className = 'captura-acciones captura-no-imprimir';
    barra.setAttribute('data-html2canvas-ignore', 'true');

    const btnDescargar = document.createElement('button');
    btnDescargar.type = 'button';
    btnDescargar.className = 'btn-secondary';
    btnDescargar.textContent = 'Descargar PDF';
    btnDescargar.addEventListener('click', async () => {
      btnDescargar.disabled = true;
      btnDescargar.textContent = 'Generando…';
      try {
        await descargarPdf(overlay);
      } finally {
        btnDescargar.disabled = false;
        btnDescargar.textContent = 'Descargar PDF';
      }
    });
    barra.appendChild(btnDescargar);

    const encabezado = contenido.querySelector('.captura-header');
    contenido.insertBefore(barra, encabezado ? encabezado.nextSibling : contenido.firstChild);
  }

  window.EVE_CXP_CAPTURA_PDF = {
    ESCALA_CAPTURA,
    MAX_ALTO_PAGINA_PDF,
    repartirBloquesEnPaginas,
    nombreArchivoPdf,
    generarPdfCaptura,
    descargarPdf,
    agregarBotones
  };
})();
