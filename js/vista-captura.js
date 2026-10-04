// ===== Vista para captura: componente compartido =====
// Overlay de pantalla completa pensado para tomar un screenshot legible desde
// cualquier módulo: título + periodo, bloque de resumen (kpis + detalle
// opcional) arriba, tabla compacta (con o sin agrupación) y pie con sello de
// fecha/hora. Cada módulo solo arma los datos y llama a
// window.VistaCaptura.abrir(config); el diseño (overlay, columnas, paleta,
// responsive) vive únicamente aquí para no duplicarlo por módulo.
//
// config = {
//   titulo,               // texto del <h1>, ej. 'Báscula'
//   periodo,               // texto bajo el título, ej. 'Hoy · 28/09/2026'
//   kpis,                  // opcional: [{ label, valor }] — franja compacta arriba
//   resumenTitulo,          // opcional: encabezado sobre resumenFilas (ej. 'Kg por material')
//   resumenFilas,           // opcional: [{ label, valor }] — tabla de 2 columnas en el bloque resumen
//   resumenEtiquetaLabel,   // opcional: encabezado de la 1a columna de resumenFilas (default 'Concepto')
//   resumenEtiquetaValor,   // opcional: encabezado de la 2a columna de resumenFilas (default 'Valor')
//   resumenSecciones,       // opcional, alternativa a resumenTitulo/resumenFilas cuando se
//                           // necesita más de una tabla label/valor en el bloque resumen:
//                           // [{ titulo, filas: [{label, valor}], etiquetaLabel, etiquetaValor }]
//   columnas,               // [{ clave, etiqueta, alineacion, ancho, truncar, mono, formato(valor, fila) }]
//   filas,                  // [{...}] — filas de la tabla principal, sin agrupar
//   grupos,                 // alternativa a `filas`: [{ encabezado, subtotal, filas, columnas? }]
//                           // (grupo.columnas, si viene, reemplaza a `columnas` solo en ese bloque)
//   sinTabla,               // opcional: si es true, no arma la tabla y en su lugar muestra `notaSinTabla`
//   notaSinTabla,           // opcional: texto mostrado cuando sinTabla es true
//   vacioMensaje,           // opcional: texto cuando no hay contenido en absoluto
//   tablasExtra             // opcional: [{ titulo, columnas, filas, vacioMensaje }] — tablas
//                           // adicionales de ancho completo debajo de la tabla principal, para
//                           // módulos que necesitan más de una tabla de datos (no label/valor)
//                           // en la misma vista, ej. precios vigentes + ajustes por proveedor.
// }
(function () {
  function generarSelloCaptura() {
    const partes = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const obtener = (tipo) => partes.find((p) => p.type === tipo).value;
    return `${obtener('day')}/${obtener('month')}/${obtener('year')} ${obtener('hour')}:${obtener('minute')}`;
  }

  function aplicarEstiloColumna(celda, columna) {
    celda.style.textAlign = columna.alineacion || 'left';
    celda.classList.add(columna.truncar === false ? 'captura-col-normal' : 'captura-col-truncar');
    if (columna.mono) celda.classList.add('mono');
  }

  function construirTabla(columnas, filas) {
    const tabla = document.createElement('table');
    tabla.className = 'captura-tabla';

    if (columnas.some((columna) => columna.ancho)) {
      const colgroup = document.createElement('colgroup');
      columnas.forEach((columna) => {
        const col = document.createElement('col');
        if (columna.ancho) col.style.width = columna.ancho;
        colgroup.appendChild(col);
      });
      tabla.appendChild(colgroup);
    }

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    columnas.forEach((columna) => {
      const th = document.createElement('th');
      th.textContent = columna.etiqueta;
      th.style.textAlign = columna.alineacion || 'left';
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    tabla.appendChild(thead);

    const tbody = document.createElement('tbody');
    filas.forEach((fila) => {
      const tr = document.createElement('tr');
      columnas.forEach((columna) => {
        const td = document.createElement('td');
        const crudo = fila[columna.clave];
        const valor = columna.formato ? columna.formato(crudo, fila) : crudo;
        td.textContent = valor == null ? '' : valor;
        aplicarEstiloColumna(td, columna);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tabla.appendChild(tbody);
    return tabla;
  }

  function construirCuerpo(config) {
    const cuerpo = document.createElement('div');
    cuerpo.className = 'captura-cuerpo';

    if (config.sinTabla) {
      const nota = document.createElement('p');
      nota.className = 'captura-vacio';
      nota.textContent = config.notaSinTabla || 'Lista completa disponible en pantalla';
      cuerpo.appendChild(nota);
      return cuerpo;
    }

    const hayGrupos = config.grupos && config.grupos.length > 0;
    const hayFilas = config.filas && config.filas.length > 0;
    if (!hayGrupos && !hayFilas) {
      const vacio = document.createElement('p');
      vacio.className = 'captura-vacio';
      vacio.textContent = config.vacioMensaje || 'Sin registros en este periodo';
      cuerpo.appendChild(vacio);
      return cuerpo;
    }

    if (hayGrupos) {
      config.grupos.forEach((grupo) => {
        const seccion = document.createElement('div');
        seccion.className = 'captura-dia';
        const titulo = document.createElement('h3');
        titulo.className = 'captura-dia-titulo';
        titulo.textContent = grupo.subtotal ? `${grupo.encabezado} · ${grupo.subtotal}` : grupo.encabezado;
        seccion.appendChild(titulo);
        seccion.appendChild(construirTabla(grupo.columnas || config.columnas, grupo.filas));
        cuerpo.appendChild(seccion);
      });
    } else {
      cuerpo.appendChild(construirTabla(config.columnas, config.filas));
    }
    return cuerpo;
  }

  function construirResumen(config) {
    // resumenSecciones permite varias tablas label/valor tituladas dentro del
    // mismo bloque (ej. total por proveedor + desglose por forma de pago). Si
    // el módulo solo necesita una, resumenTitulo/resumenFilas siguen
    // funcionando igual (se traducen a una sección única) sin romper a nadie
    // que ya use esa forma corta (ej. Báscula).
    const secciones = config.resumenSecciones && config.resumenSecciones.length > 0
      ? config.resumenSecciones
      : (config.resumenFilas && config.resumenFilas.length > 0
        ? [{
          titulo: config.resumenTitulo,
          filas: config.resumenFilas,
          etiquetaLabel: config.resumenEtiquetaLabel,
          etiquetaValor: config.resumenEtiquetaValor
        }]
        : []);
    const hayKpis = config.kpis && config.kpis.length > 0;
    const haySecciones = secciones.some((seccion) => seccion.filas && seccion.filas.length > 0);
    if (!hayKpis && !haySecciones) return null;

    const contenedor = document.createElement('div');
    contenedor.className = 'captura-resumen';
    const titulo = document.createElement('h2');
    titulo.textContent = 'Resumen';
    contenedor.appendChild(titulo);

    if (hayKpis) {
      const statsDiv = document.createElement('div');
      statsDiv.className = 'captura-resumen-stats';
      config.kpis.forEach((kpi) => {
        const bloque = document.createElement('div');
        bloque.className = 'captura-resumen-stat';
        const valor = document.createElement('span');
        valor.className = 'captura-resumen-stat-valor mono';
        valor.textContent = kpi.valor;
        const etiqueta = document.createElement('span');
        etiqueta.className = 'captura-resumen-stat-etiqueta';
        etiqueta.textContent = kpi.label;
        bloque.appendChild(valor);
        bloque.appendChild(etiqueta);
        statsDiv.appendChild(bloque);
      });
      contenedor.appendChild(statsDiv);
    }

    secciones.forEach((seccion) => {
      if (!seccion.filas || seccion.filas.length === 0) return;
      if (seccion.titulo) {
        const subtitulo = document.createElement('h3');
        subtitulo.className = 'captura-resumen-subtitulo';
        subtitulo.textContent = seccion.titulo;
        contenedor.appendChild(subtitulo);
      }

      const tabla = document.createElement('table');
      tabla.className = 'captura-tabla captura-tabla-resumen';
      const colgroup = document.createElement('colgroup');
      const colLabel = document.createElement('col');
      colLabel.style.width = '60%';
      const colValor = document.createElement('col');
      colValor.style.width = '40%';
      colgroup.appendChild(colLabel);
      colgroup.appendChild(colValor);
      tabla.appendChild(colgroup);
      const etiquetaLabel = seccion.etiquetaLabel || 'Concepto';
      const etiquetaValor = seccion.etiquetaValor || 'Valor';
      tabla.innerHTML += `<thead><tr><th>${etiquetaLabel}</th><th style="text-align:right">${etiquetaValor}</th></tr></thead><tbody></tbody>`;
      const tbody = tabla.querySelector('tbody');
      seccion.filas.forEach((item) => {
        const fila = document.createElement('tr');
        const celdaLabel = document.createElement('td');
        celdaLabel.className = 'captura-col-normal';
        celdaLabel.textContent = item.label;
        const celdaValor = document.createElement('td');
        celdaValor.className = 'mono';
        celdaValor.style.textAlign = 'right';
        celdaValor.textContent = item.valor;
        fila.appendChild(celdaLabel);
        fila.appendChild(celdaValor);
        tbody.appendChild(fila);
      });
      contenedor.appendChild(tabla);
    });

    return contenedor;
  }

  let handlerEscapeCaptura = null;

  function cerrar() {
    const overlay = document.getElementById('vista-captura-overlay');
    if (overlay) overlay.remove();
    if (handlerEscapeCaptura) {
      document.removeEventListener('keydown', handlerEscapeCaptura);
      handlerEscapeCaptura = null;
    }
  }

  function abrir(config) {
    cerrar();

    const overlay = document.createElement('div');
    overlay.id = 'vista-captura-overlay';
    overlay.className = 'captura-overlay';

    const botonCerrar = document.createElement('button');
    botonCerrar.type = 'button';
    botonCerrar.className = 'captura-cerrar';
    botonCerrar.setAttribute('aria-label', 'Cerrar');
    botonCerrar.textContent = '✕';
    botonCerrar.addEventListener('click', cerrar);
    overlay.appendChild(botonCerrar);

    const contenido = document.createElement('div');
    contenido.className = 'captura-contenido';

    const header = document.createElement('header');
    header.className = 'captura-header';
    const titulo = document.createElement('h1');
    titulo.textContent = config.titulo || '';
    header.appendChild(titulo);
    if (config.periodo) {
      const periodo = document.createElement('p');
      periodo.className = 'captura-periodo';
      periodo.textContent = config.periodo;
      header.appendChild(periodo);
    }
    contenido.appendChild(header);

    const hayContenido = config.sinTabla
      || (config.filas && config.filas.length > 0)
      || (config.grupos && config.grupos.length > 0)
      || (config.kpis && config.kpis.length > 0)
      || (config.resumenFilas && config.resumenFilas.length > 0)
      || (config.resumenSecciones && config.resumenSecciones.some((s) => s.filas && s.filas.length > 0));

    if (!hayContenido) {
      contenido.appendChild(construirCuerpo(config));
    } else {
      const resumen = construirResumen(config);
      if (resumen) {
        const layout = document.createElement('div');
        layout.className = 'captura-layout';
        const colResumen = document.createElement('div');
        colResumen.className = 'captura-col-resumen';
        colResumen.appendChild(resumen);
        const colTabla = document.createElement('div');
        colTabla.className = 'captura-col-tickets';
        colTabla.appendChild(construirCuerpo(config));
        layout.appendChild(colResumen);
        layout.appendChild(colTabla);
        contenido.appendChild(layout);
      } else {
        contenido.appendChild(construirCuerpo(config));
      }
    }

    if (config.tablasExtra && config.tablasExtra.length > 0) {
      config.tablasExtra.forEach((seccion) => {
        const bloque = document.createElement('div');
        bloque.className = 'captura-seccion-extra';
        const titulo = document.createElement('h2');
        titulo.textContent = seccion.titulo || '';
        bloque.appendChild(titulo);
        if (seccion.filas && seccion.filas.length > 0) {
          bloque.appendChild(construirTabla(seccion.columnas, seccion.filas));
        } else {
          const vacio = document.createElement('p');
          vacio.className = 'captura-vacio';
          vacio.textContent = seccion.vacioMensaje || 'Sin datos';
          bloque.appendChild(vacio);
        }
        contenido.appendChild(bloque);
      });
    }

    const footer = document.createElement('footer');
    footer.className = 'captura-footer';
    footer.textContent = `Generado el ${generarSelloCaptura()}`;
    contenido.appendChild(footer);

    overlay.appendChild(contenido);
    document.body.appendChild(overlay);

    handlerEscapeCaptura = (evento) => {
      if (evento.key === 'Escape') cerrar();
    };
    document.addEventListener('keydown', handlerEscapeCaptura);
  }

  window.VistaCaptura = { abrir, cerrar };
})();
