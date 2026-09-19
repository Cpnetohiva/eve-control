(function () {

  // Estado de orden por tabla: id de la tabla -> { columna, tipo, direccion }
  const ESTADOS = new Map();
  // Bandera por tabla para ignorar la mutación que provocamos nosotros mismos al reordenar
  const IGNORAR_MUTACION = new WeakMap();
  let contadorId = 0;

  function identificadorTabla(tabla) {
    // Preferimos el id del tbody: es el que los módulos fijan como cadena fija
    // (ej. 'destaraje-tabla-destaraje') y por eso se mantiene estable aunque la
    // tabla se recree por completo en un re-render del módulo.
    const tbody = tabla.tBodies[0];
    if (tbody && tbody.id) return tbody.id;
    if (tabla.id) return tabla.id;
    tabla.id = `tabla-ordenable-${++contadorId}`;
    return tabla.id;
  }

  function extraerTexto(celda) {
    return celda ? (celda.textContent || '').trim() : '';
  }

  function extraerNumero(texto) {
    const limpio = String(texto)
      .replace(/kg/gi, '')
      .replace(/\$/g, '')
      .replace(/,/g, '')
      .trim();
    const numero = parseFloat(limpio);
    return Number.isFinite(numero) ? numero : -Infinity;
  }

  function extraerFecha(texto) {
    const valor = String(texto).trim();
    let m = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    m = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
    const fallback = Date.parse(valor);
    return Number.isFinite(fallback) ? fallback : -Infinity;
  }

  function valorFila(fila, columna, tipo) {
    const celda = fila.children[columna];
    const texto = extraerTexto(celda);
    if (tipo === 'numero' || tipo === 'moneda') return extraerNumero(texto);
    if (tipo === 'fecha') return extraerFecha(texto);
    return texto;
  }

  function compararFilas(filaA, filaB, columna, tipo, direccion) {
    const signo = direccion === 'desc' ? -1 : 1;
    if (tipo === 'numero' || tipo === 'moneda' || tipo === 'fecha') {
      const a = valorFila(filaA, columna, tipo);
      const b = valorFila(filaB, columna, tipo);
      return signo * (a - b);
    }
    // texto y ticket usan localeCompare con numeric:true (conserva ceros a la izquierda en el texto mostrado)
    const a = valorFila(filaA, columna, 'texto');
    const b = valorFila(filaB, columna, 'texto');
    return signo * a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  function esFilaAncla(fila) {
    // Filas de resumen/alternar (ej. "Ver liquidados", detalle de abonos expandido,
    // "Sin registros") usan una sola celda con colspan: no son datos ordenables y
    // se dejan ancladas al final, en su orden relativo original.
    return Array.from(fila.children).some((celda) => celda.hasAttribute('colspan'));
  }

  function ordenarFilasEnDOM(tabla, columna, tipo, direccion) {
    const tbody = tabla.tBodies[0];
    if (!tbody) return;
    const filas = Array.from(tbody.rows);
    if (filas.length <= 1) return;
    const filasAncla = filas.filter(esFilaAncla);
    const filasDatos = filas.filter((fila) => !esFilaAncla(fila));
    if (filasDatos.length <= 1) return;
    const ordenadas = filasDatos.slice().sort((a, b) => compararFilas(a, b, columna, tipo, direccion));
    const nuevoOrden = ordenadas.concat(filasAncla);
    const sinCambios = nuevoOrden.every((fila, i) => fila === filas[i]);
    if (sinCambios) return;
    IGNORAR_MUTACION.set(tabla, true);
    const fragmento = document.createDocumentFragment();
    nuevoOrden.forEach((fila) => fragmento.appendChild(fila)); // mueve los nodos existentes, no los recrea
    tbody.appendChild(fragmento);
  }

  function actualizarIndicadores(tabla, thActivo, direccion) {
    tabla.querySelectorAll('thead th[data-tipo]').forEach((th) => {
      th.classList.remove('th-ordenable-asc', 'th-ordenable-desc');
      th.removeAttribute('aria-sort');
    });
    thActivo.classList.add(direccion === 'desc' ? 'th-ordenable-desc' : 'th-ordenable-asc');
    thActivo.setAttribute('aria-sort', direccion === 'desc' ? 'descending' : 'ascending');
  }

  function aplicarEstadoGuardado(tabla) {
    const estado = ESTADOS.get(identificadorTabla(tabla));
    if (!estado) return;
    const th = tabla.querySelectorAll('thead th[data-tipo]')[estado.indice];
    if (!th) return;
    ordenarFilasEnDOM(tabla, estado.columna, estado.tipo, estado.direccion);
    actualizarIndicadores(tabla, th, estado.direccion);
  }

  function manejarActivacion(tabla, th, indice) {
    const columna = th.cellIndex;
    const tipo = th.dataset.tipo;
    const id = identificadorTabla(tabla);
    const anterior = ESTADOS.get(id);
    const direccion = (anterior && anterior.columna === columna && anterior.direccion === 'asc') ? 'desc' : 'asc';
    ESTADOS.set(id, { columna, tipo, direccion, indice });
    ordenarFilasEnDOM(tabla, columna, tipo, direccion);
    actualizarIndicadores(tabla, th, direccion);
  }

  function activarOrdenamiento(tabla) {
    if (!tabla || tabla.dataset.ordenamientoActivo === '1') return;
    tabla.dataset.ordenamientoActivo = '1';

    const encabezados = Array.from(tabla.querySelectorAll('thead th[data-tipo]'));
    encabezados.forEach((th, indice) => {
      th.classList.add('th-ordenable');
      th.setAttribute('role', 'button');
      th.setAttribute('tabindex', '0');
      th.addEventListener('click', () => manejarActivacion(tabla, th, indice));
      th.addEventListener('keydown', (evento) => {
        if (evento.key === 'Enter' || evento.key === ' ') {
          evento.preventDefault();
          manejarActivacion(tabla, th, indice);
        }
      });
    });

    const tbody = tabla.tBodies[0];
    if (tbody) {
      const observador = new MutationObserver(() => {
        if (IGNORAR_MUTACION.get(tabla)) {
          IGNORAR_MUTACION.set(tabla, false);
          return;
        }
        aplicarEstadoGuardado(tabla);
      });
      observador.observe(tbody, { childList: true });
    }

    aplicarEstadoGuardado(tabla);
  }

  window.activarOrdenamiento = activarOrdenamiento;

})();
