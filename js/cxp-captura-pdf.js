// ===== PDF de la Vista para captura de CxP =====
// Réplica de lo que se ve en pantalla, para uso interno: sin logo, sin encabezado nuevo y sin reconstruir las tablas. Se
// fotografía el DOM con html2canvas por bloques (el panel Resumen y cada proveedor visible) y se arma el PDF con jsPDF.
// El primer bloque es un encabezado de una línea con la fecha y hora de México del momento en que se pulsa el botón; existe solo
// durante la captura (elemento temporal fuera de pantalla que se elimina siempre). Los bloques se apilan en una sola página continua (ancho de la vista, altura sumada); si la altura supera el máximo se
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

  const ZONA_MEXICO = 'America/Mexico_City';

  function partesEnMexico(ahora, formato) {
    const partes = {};
    new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_MEXICO, ...formato }).formatToParts(ahora).forEach((p) => { partes[p.type] = p.value; });
    return partes;
  }

  // 'CxP al 20 de octubre de 2026, 3:30 p. m.' — hora de México aunque el dispositivo esté en otra zona.
  function textoEncabezadoPdf(ahora) {
    const p = partesEnMexico(ahora, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h12' });
    const periodo = /^a/i.test(p.dayPeriod) ? 'a. m.' : 'p. m.';
    return `CxP al ${p.day} de ${p.month} de ${p.year}, ${p.hour}:${p.minute} ${periodo}`;
  }

  // CxP_por_proveedor_AAAA-MM-DD_HHmm.pdf (hora de México, 24 h).
  function nombreArchivoPdf(ahora) {
    const p = partesEnMexico(ahora, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return `CxP_por_proveedor_${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}.pdf`;
  }

  // Encabezado de una línea con el estilo de los títulos de la vista (mismas clases: DM Sans, negrita, azul marino). Vive fuera de
  // pantalla y fuera del overlay (position: fixed no ocupa lugar), así que no altera el layout. Si no cabe en una línea al ancho
  // de la página, reduce el tamaño de la letra en vez de partirla en dos renglones. Devuelve { elemento, espacio, quitar }.
  function crearEncabezadoTemporal(texto, ancho) {
    const envoltorio = document.createElement('div');
    envoltorio.className = 'captura-contenido';
    envoltorio.setAttribute('aria-hidden', 'true');
    envoltorio.style.cssText = `position:fixed;left:-10000px;top:0;margin:0;max-width:none;width:${ancho}px;pointer-events:none`;
    const elemento = document.createElement('header');
    elemento.className = 'captura-header captura-pdf-encabezado';
    const titulo = document.createElement('h1');
    titulo.style.whiteSpace = 'nowrap';
    titulo.textContent = texto;
    elemento.appendChild(titulo);
    envoltorio.appendChild(elemento);
    document.body.appendChild(envoltorio);
    if (titulo.scrollWidth > ancho) {
      titulo.style.fontSize = `${Math.floor(parseFloat(window.getComputedStyle(titulo).fontSize) * ancho / titulo.scrollWidth)}px`;
    }
    return {
      elemento,
      espacio: parseFloat(window.getComputedStyle(elemento).marginBottom) || 0,
      quitar: () => envoltorio.remove()
    };
  }

  // Genera el PDF de la vista abierta. Devuelve { doc, nombre }. opciones.maxAlto sustituye el máximo de altura por página.
  async function generarPdfCaptura(overlay, opciones) {
    const ahora = (opciones && opciones.ahora) || new Date(); // el momento de pulsar el botón, antes de cualquier espera
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
    const anchoVista = Math.max(...[resumen].concat(proveedores).filter(Boolean).map((b) => b.getBoundingClientRect().width));
    let fotoEncabezado = null;
    let fotoResumen = null;
    let espacioEncabezado = 0;
    const fotosProveedores = [];
    const encabezado = crearEncabezadoTemporal(textoEncabezadoPdf(ahora), anchoVista);
    try {
      espacioEncabezado = encabezado.espacio;
      fotoEncabezado = await capturar(encabezado.elemento);
      fotoResumen = resumen ? await capturar(resumen) : null;
      for (const bloque of proveedores) fotosProveedores.push(await capturar(bloque));
    } finally {
      encabezado.quitar();
    }

    // El encabezado y el Resumen forman la cabecera de la primera página: el reparto en páginas no cambia.
    const espacioCabecera = fotoResumen ? espacioEncabezado : espacio;
    const altoCabecera = fotoEncabezado.alto + (fotoResumen ? espacioCabecera + fotoResumen.alto : 0);
    const paginas = repartirBloquesEnPaginas(altoCabecera, fotosProveedores.map((f) => f.alto), maxAlto, espacio);
    const ancho = Math.max(...[fotoEncabezado, fotoResumen].concat(fotosProveedores).filter(Boolean).map((f) => f.ancho));
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
      const cabecera = pagina.conResumen ? [{ foto: fotoEncabezado, hueco: espacioCabecera }].concat(fotoResumen ? [{ foto: fotoResumen, hueco: espacio }] : []) : [];
      const fotos = cabecera.concat(pagina.indices.map((i) => ({ foto: fotosProveedores[i], hueco: espacio })));
      fotos.forEach(({ foto, hueco }) => {
        doc.addImage(foto.imagen, 'PNG', 0, y, foto.ancho, foto.alto, undefined, 'FAST');
        y += foto.alto + hueco;
      });
    });
    return { doc, nombre: nombreArchivoPdf(ahora) };
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

  const AVISO_SIN_COMPARTIR = 'Tu dispositivo no permite compartir directo; adjunta el archivo descargado';

  // Mismo PDF que Descargar, entregado con el menú de compartir del dispositivo (WhatsApp u otra app de mensajería). Cancelar
  // el menú no es un error. Sin soporte para compartir archivos se descarga y se avisa.
  async function compartirPdf(overlay, opciones) {
    return window.protegerContraDobleRegistro(CLAVE_DOBLE_REGISTRO, async () => {
      try {
        const { doc, nombre } = await generarPdfCaptura(overlay, opciones);
        const archivo = new File([doc.output('blob')], nombre, { type: 'application/pdf' });
        const puedeCompartir = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [archivo] });
        if (!puedeCompartir) {
          doc.save(nombre);
          window.showSuccess(AVISO_SIN_COMPARTIR);
          return true;
        }
        await navigator.share({ files: [archivo], title: nombre });
        return true;
      } catch (error) {
        if (error && error.name === 'AbortError') return false;
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

    // La generación tarda (una foto por bloque): mientras corre se bloquean ambos botones y el pulsado muestra 'Generando…'.
    const acciones = [
      { etiqueta: 'Descargar PDF', ejecutar: descargarPdf },
      { etiqueta: 'Compartir', ejecutar: compartirPdf }
    ].map(({ etiqueta, ejecutar }) => {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'btn-secondary';
      boton.textContent = etiqueta;
      boton.addEventListener('click', async () => {
        acciones.forEach((accion) => { accion.boton.disabled = true; });
        boton.textContent = 'Generando…';
        try {
          await ejecutar(overlay);
        } finally {
          acciones.forEach((accion) => { accion.boton.disabled = false; });
          boton.textContent = etiqueta;
        }
      });
      barra.appendChild(boton);
      return { boton };
    });

    const encabezado = contenido.querySelector('.captura-header');
    contenido.insertBefore(barra, encabezado ? encabezado.nextSibling : contenido.firstChild);
  }

  window.EVE_CXP_CAPTURA_PDF = {
    ESCALA_CAPTURA,
    MAX_ALTO_PAGINA_PDF,
    repartirBloquesEnPaginas,
    textoEncabezadoPdf,
    nombreArchivoPdf,
    generarPdfCaptura,
    descargarPdf,
    compartirPdf,
    agregarBotones
  };
})();
