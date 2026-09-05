(function () {

let moduloActivo = 'general';
let tabActivaReportes = 'personalizado';
let tipoCxPActivo = 'estadoCuenta';
let tipoRendimientoActivo = 'porMaterial';

function valoresUnicos(valores) {
  const set = new Set();
  valores.forEach((v) => { if (v) set.add(v); });
  return Array.from(set).sort();
}

function obtenerProveedoresUnicos() {
  return valoresUnicos([
    ...window.EVE.registrosDestaraje.map((r) => r.proveedor),
    ...window.EVE.registrosPagos.map((r) => r.proveedor)
  ]);
}

function obtenerMaterialesUnicos() {
  const materialesVentas = [];
  (window.EVE.ventas || []).forEach((v) => {
    (v.lineas || []).forEach((l) => { if (l.material) materialesVentas.push(l.material); });
  });
  return valoresUnicos([
    ...window.EVE.registrosDestaraje.map((r) => r.material),
    ...window.EVE.registrosVentas.map((r) => r.material),
    ...materialesVentas,
    ...window.EVE.registrosPagos.map((r) => r.material)
  ]);
}

function obtenerClientesUnicos() {
  return valoresUnicos([
    ...window.EVE.registrosVentas.map((r) => r.proveedor),
    ...(window.EVE.ventas || []).map((v) => v.cliente)
  ]);
}

function obtenerOperadoresUnicos() {
  return valoresUnicos(window.EVE.registrosControlProduccion.map((r) => r.operador));
}

function obtenerMaterialesConComposicionUnicos() {
  return valoresUnicos(window.EVE_RENDIMIENTOS.materialesConComposicion(window.EVE.composiciones || []));
}

function obtenerProveedoresCxPUnicos() {
  return valoresUnicos((window.EVE.cuentasPorPagar || []).map((c) => c.proveedor));
}

function obtenerMaterialesCxPUnicos() {
  return valoresUnicos((window.EVE.cuentasPorPagar || []).map((c) => c.material));
}

function crearSelectConOpciones(id, opciones, etiquetaTodos) {
  const select = document.createElement('select');
  select.id = id;
  const opcionTodos = document.createElement('option');
  opcionTodos.value = '';
  opcionTodos.textContent = etiquetaTodos;
  select.appendChild(opcionTodos);
  opciones.forEach((valor) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    opcion.textContent = valor;
    select.appendChild(opcion);
  });
  return select;
}

function aplicarVisibilidadFechas() {
  const desdeInput = document.getElementById('ruf-desde');
  const hastaInput = document.getElementById('ruf-hasta');
  if (!desdeInput || !hastaInput) return;
  const mostrar = tabActivaReportes === 'personalizado';
  desdeInput.style.display = mostrar ? '' : 'none';
  hastaInput.style.display = mostrar ? '' : 'none';
}

function reconstruirCamposFiltro(contenedor) {
  contenedor.innerHTML = '';
  const ticketInput = document.createElement('input');
  ticketInput.type = 'text';
  ticketInput.id = 'ruf-ticket';
  ticketInput.placeholder = 'Ticket';
  const desdeInput = document.createElement('input');
  desdeInput.type = 'date';
  desdeInput.id = 'ruf-desde';
  const hastaInput = document.createElement('input');
  hastaInput.type = 'date';
  hastaInput.id = 'ruf-hasta';
  contenedor.appendChild(ticketInput);
  contenedor.appendChild(desdeInput);
  contenedor.appendChild(hastaInput);

  if (moduloActivo === 'general') {
    contenedor.appendChild(crearSelectConOpciones('ruf-proveedor', obtenerProveedoresUnicos(), 'Todos los proveedores'));
    contenedor.appendChild(crearSelectConOpciones('ruf-material', obtenerMaterialesUnicos(), 'Todos los materiales'));
    contenedor.appendChild(crearSelectConOpciones('ruf-cliente', obtenerClientesUnicos(), 'Todos los clientes'));
  } else if (moduloActivo === 'cxp') {
    const selectorTipo = document.createElement('select');
    selectorTipo.id = 'ruf-cxp-tipo';
    [['estadoCuenta', 'Estado de Cuenta'], ['consolidado', 'Consolidado'], ['historialPagos', 'Historial de Pagos']].forEach(([valor, texto]) => {
      const opcion = document.createElement('option');
      opcion.value = valor;
      opcion.textContent = texto;
      if (valor === tipoCxPActivo) opcion.selected = true;
      selectorTipo.appendChild(opcion);
    });
    selectorTipo.addEventListener('change', () => { tipoCxPActivo = selectorTipo.value; });
    contenedor.appendChild(selectorTipo);
    contenedor.appendChild(crearSelectConOpciones('ruf-cxp-proveedor', obtenerProveedoresCxPUnicos(), 'Todos los proveedores'));
    contenedor.appendChild(crearSelectConOpciones('ruf-cxp-material', obtenerMaterialesCxPUnicos(), 'Todos los materiales'));
    contenedor.appendChild(crearSelectConOpciones('ruf-cxp-estado', ['pendiente', 'parcial', 'liquidado'], 'Todos los estados'));
  } else if (moduloActivo === 'rendimientos') {
    const selectorTipo = document.createElement('select');
    selectorTipo.id = 'ruf-rendimientos-tipo';
    [['porMaterial', 'Por Material'], ['porOperador', 'Por Operador'], ['porProceso', 'Por Proceso'], ['porTicket', 'Por Ticket (Trazabilidad)']].forEach(([valor, texto]) => {
      const opcion = document.createElement('option');
      opcion.value = valor;
      opcion.textContent = texto;
      if (valor === tipoRendimientoActivo) opcion.selected = true;
      selectorTipo.appendChild(opcion);
    });
    selectorTipo.addEventListener('change', () => {
      tipoRendimientoActivo = selectorTipo.value;
      reconstruirCamposFiltro(contenedor);
    });
    contenedor.appendChild(selectorTipo);
    if (tipoRendimientoActivo === 'porTicket') {
      const aviso = document.createElement('div');
      aviso.className = 'chip chip-info';
      aviso.textContent = 'El reporte por ticket usa la vista de Trazabilidad.';
      contenedor.appendChild(aviso);
      const botonIr = document.createElement('button');
      botonIr.type = 'button';
      botonIr.className = 'btn-secondary';
      botonIr.textContent = 'Ir a Trazabilidad →';
      botonIr.addEventListener('click', () => {
        const tabControlProduccion = document.querySelector('#tabs-container .tab[data-modulo="controlProduccion"]');
        if (tabControlProduccion) tabControlProduccion.click();
      });
      contenedor.appendChild(botonIr);
    } else {
      if (tipoRendimientoActivo !== 'porProceso') {
        contenedor.appendChild(crearSelectConOpciones('ruf-rendimientos-material', obtenerMaterialesConComposicionUnicos(), 'Selecciona un material'));
      }
      contenedor.appendChild(crearSelectConOpciones('ruf-rendimientos-operador', obtenerOperadoresUnicos(), 'Todos los operadores'));
      const selectProceso = document.createElement('select');
      selectProceso.id = 'ruf-rendimientos-proceso';
      const opcionTodos = document.createElement('option');
      opcionTodos.value = '';
      opcionTodos.textContent = 'Todos los procesos';
      selectProceso.appendChild(opcionTodos);
      Object.keys(window.EVE_CONTROL_PRODUCCION.PROCESOS).forEach((clave) => {
        const opcion = document.createElement('option');
        opcion.value = clave;
        opcion.textContent = window.NOMBRE_PROCESO_UI[clave] || clave;
        selectProceso.appendChild(opcion);
      });
      contenedor.appendChild(selectProceso);
    }
  } else {
    contenedor.appendChild(crearSelectConOpciones('ruf-operador', obtenerOperadoresUnicos(), 'Todos los operadores'));
    contenedor.appendChild(crearSelectConOpciones('ruf-turno', ['Matutino', 'Vespertino', 'Nocturno'], 'Todos los turnos'));
    contenedor.appendChild(crearSelectConOpciones('ruf-tipoproceso', Object.keys(window.EVE_CONTROL_PRODUCCION.PROCESOS), 'Todos los procesos'));
  }
  aplicarVisibilidadFechas();
}

function crearTabsReportes() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
    { id: 'mes', nombre: 'Este Mes' },
    { id: 'personalizado', nombre: 'Personalizado' }
  ];
  definiciones.forEach((def) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (def.id === tabActivaReportes ? ' active' : '');
    boton.textContent = def.nombre;
    boton.dataset.tab = def.id;
    boton.addEventListener('click', () => {
      tabActivaReportes = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === boton));
      aplicarVisibilidadFechas();
    });
    nav.appendChild(boton);
  });
  return nav;
}

function crearBarraFiltros() {
  const div = document.createElement('div');
  div.id = 'ru-filtros';
  div.className = 'card destaraje-filtros';
  reconstruirCamposFiltro(div);
  return div;
}

function crearSelectorModulo() {
  const select = document.createElement('select');
  select.id = 'ru-modulo';
  const opciones = [['general', 'Reporte General'], ['controlProduccion', 'Control de Producción'], ['rendimientos', '📊 Rendimientos']];
  const permissions = window.EVE.currentUser && window.EVE.currentUser.permissions;
  if (permissions && permissions.cxp_reportes) {
    opciones.push(['cxp', 'CxP']);
  }
  opciones.forEach(([valor, texto]) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    opcion.textContent = texto;
    select.appendChild(opcion);
  });
  select.addEventListener('change', () => {
    moduloActivo = select.value;
    reconstruirCamposFiltro(document.getElementById('ru-filtros'));
  });
  return select;
}

function leerFiltrosComunes() {
  return {
    ticket: document.getElementById('ruf-ticket').value,
    desde: document.getElementById('ruf-desde').value,
    hasta: document.getElementById('ruf-hasta').value
  };
}

function leerFiltrosGeneral() {
  const comunes = leerFiltrosComunes();
  return {
    ticket: comunes.ticket, desde: comunes.desde, hasta: comunes.hasta,
    proveedor: document.getElementById('ruf-proveedor').value,
    material: document.getElementById('ruf-material').value,
    cliente: document.getElementById('ruf-cliente').value
  };
}

function leerFiltrosControlProduccion() {
  const comunes = leerFiltrosComunes();
  return {
    ticket: comunes.ticket, desde: comunes.desde, hasta: comunes.hasta,
    operador: document.getElementById('ruf-operador').value,
    turno: document.getElementById('ruf-turno').value,
    tipoProceso: document.getElementById('ruf-tipoproceso').value
  };
}

function leerFiltrosRendimientos() {
  const comunes = leerFiltrosComunes();
  return {
    ticket: comunes.ticket, desde: comunes.desde, hasta: comunes.hasta,
    material: document.getElementById('ruf-rendimientos-material') ? document.getElementById('ruf-rendimientos-material').value : '',
    operador: document.getElementById('ruf-rendimientos-operador') ? document.getElementById('ruf-rendimientos-operador').value : '',
    tipoProceso: document.getElementById('ruf-rendimientos-proceso') ? document.getElementById('ruf-rendimientos-proceso').value : ''
  };
}

function obtenerResultadoRendimientoMaterialActivo(periodo) {
  const filtros = leerFiltrosRendimientos();
  if (!filtros.material) return null;
  return window.calcularRendimientoMaterial(filtros.material, periodo);
}

function obtenerResultadoRendimientoOperadorActivo(periodo) {
  const filtros = leerFiltrosRendimientos();
  const registros = window.obtenerRegistrosControlProduccionPorOperadorPeriodo(periodo, filtros);
  return window.calcularRendimientoOperador(registros, window.EVE.metaEficiencia || 90);
}

function obtenerResultadoRendimientoPorProcesoActivo(periodo) {
  const filtros = leerFiltrosRendimientos();
  return window.calcularRendimientoPorProceso(filtros.tipoProceso, periodo);
}

function obtenerPeriodoActivo() {
  return window.obtenerRangoYEtiqueta(tabActivaReportes, leerFiltrosComunes());
}

function obtenerDatosGeneralFiltrados(periodo) {
  const filtros = leerFiltrosGeneral();
  return window.obtenerDatosPeriodo(periodo.desde, periodo.hasta, {
    ticket: filtros.ticket,
    proveedor: filtros.proveedor,
    material: filtros.material,
    cliente: filtros.cliente
  });
}

function leerFiltrosCxP() {
  const comunes = leerFiltrosComunes();
  return {
    ticket: comunes.ticket, desde: comunes.desde, hasta: comunes.hasta,
    proveedor: document.getElementById('ruf-cxp-proveedor').value,
    material: document.getElementById('ruf-cxp-material').value,
    estado: document.getElementById('ruf-cxp-estado').value
  };
}

function obtenerCuentasCxPFiltradas(periodo) {
  const filtros = leerFiltrosCxP();
  return (window.EVE.cuentasPorPagar || []).filter((c) => {
    if (periodo.desde && c.fechaTicket < periodo.desde) return false;
    if (periodo.hasta && c.fechaTicket > periodo.hasta) return false;
    if (filtros.ticket && !String(c.ticket).toUpperCase().includes(filtros.ticket.toUpperCase())) return false;
    if (filtros.proveedor && c.proveedor !== filtros.proveedor) return false;
    if (filtros.material && c.material !== filtros.material) return false;
    if (filtros.estado && c.estado !== filtros.estado) return false;
    return true;
  });
}

function obtenerRegistrosControlProduccionFiltrados(periodo) {
  const filtros = leerFiltrosControlProduccion();
  return window.EVE.registrosControlProduccion.filter((r) => {
    const fechaFin = r.fechaFin.slice(0, 10);
    if (periodo.desde && fechaFin < periodo.desde) return false;
    if (periodo.hasta && fechaFin > periodo.hasta) return false;
    if (filtros.ticket && !String(r.ticket).toUpperCase().includes(filtros.ticket.toUpperCase())) return false;
    if (filtros.operador && r.operador !== filtros.operador) return false;
    if (filtros.turno && r.turno !== filtros.turno) return false;
    if (filtros.tipoProceso && r.tipoProceso !== filtros.tipoProceso) return false;
    return true;
  });
}

window.EVE_REPORTES_UI = {
  crearSelectorModulo,
  crearBarraFiltros,
  reconstruirCamposFiltro,
  leerFiltrosComunes,
  leerFiltrosGeneral,
  leerFiltrosControlProduccion,
  obtenerPeriodoActivo,
  obtenerDatosGeneralFiltrados,
  obtenerRegistrosControlProduccionFiltrados,
  leerFiltrosCxP,
  obtenerCuentasCxPFiltradas,
  leerFiltrosRendimientos,
  obtenerResultadoRendimientoMaterialActivo,
  obtenerResultadoRendimientoOperadorActivo,
  obtenerResultadoRendimientoPorProcesoActivo
};

function obtenerTextoYNombreCxP(periodo, extension) {
  const cuentas = obtenerCuentasCxPFiltradas(periodo);
  if (tipoCxPActivo === 'estadoCuenta') {
    const proveedor = leerFiltrosCxP().proveedor || 'TODOS';
    return {
      texto: window.generarTXTEstadoCuenta(proveedor, cuentas, periodo),
      nombre: `CxP_EstadoCuenta_${proveedor}_${window.obtenerFechaMexico()}.${extension}`
    };
  }
  if (tipoCxPActivo === 'consolidado') {
    return {
      texto: window.generarTXTConsolidadoCxP(cuentas, periodo),
      nombre: `CxP_Consolidado_${window.obtenerFechaMexico()}.${extension}`
    };
  }
  return {
    texto: window.generarTXTHistorialPagos(cuentas, periodo),
    nombre: `CxP_HistorialPagos_${window.obtenerFechaMexico()}.${extension}`
  };
}

function obtenerTextoYNombreRendimientos(periodo, extension) {
  if (tipoRendimientoActivo === 'porMaterial') {
    const resultado = obtenerResultadoRendimientoMaterialActivo(periodo);
    if (!resultado) {
      return { texto: 'Selecciona un material para generar el reporte.', nombre: `Rendimiento_Material_${window.obtenerFechaMexico()}.${extension}` };
    }
    return {
      texto: window.generarTXTRendimientoMaterial(resultado, periodo),
      nombre: `Rendimiento_${resultado.material}_${window.obtenerFechaMexico()}.${extension}`
    };
  }
  if (tipoRendimientoActivo === 'porOperador') {
    const resultados = obtenerResultadoRendimientoOperadorActivo(periodo);
    return {
      texto: window.generarTXTRendimientoOperador(resultados, periodo, window.EVE.metaEficiencia || 90),
      nombre: `Rendimiento_Operadores_${window.obtenerFechaMexico()}.${extension}`
    };
  }
  if (tipoRendimientoActivo === 'porProceso') {
    const resultado = obtenerResultadoRendimientoPorProcesoActivo(periodo);
    if (!resultado || resultado.secciones.length === 0) {
      return { texto: 'No hay procesos registrados en el período seleccionado.', nombre: `Rendimiento_Proceso_${window.obtenerFechaMexico()}.${extension}` };
    }
    const nombreProceso = resultado.secciones.length === 1 ? resultado.secciones[0].tipoProceso : 'TodosLosProcesos';
    return {
      texto: window.generarTXTRendimientoPorProceso(resultado, periodo),
      nombre: `Rendimiento_${nombreProceso}_${window.obtenerFechaMexico()}.${extension}`
    };
  }
  return {
    texto: 'El reporte por ticket se genera desde la vista de Trazabilidad (Control de Producción → Trazabilidad).',
    nombre: `Rendimiento_Ticket.${extension}`
  };
}

function obtenerTextoYNombre(periodo, extension) {
  if (moduloActivo === 'general') {
    return {
      texto: window.generarTXT(obtenerDatosGeneralFiltrados(periodo), periodo),
      nombre: `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.${extension}`
    };
  }
  if (moduloActivo === 'cxp') {
    return obtenerTextoYNombreCxP(periodo, extension);
  }
  if (moduloActivo === 'rendimientos') {
    return obtenerTextoYNombreRendimientos(periodo, extension);
  }
  return {
    texto: window.generarTXTControlProduccion(obtenerRegistrosControlProduccionFiltrados(periodo), periodo),
    nombre: `Reporte_ControlProduccion_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.${extension}`
  };
}

function mostrarVistaPrevia() {
  const periodo = obtenerPeriodoActivo();
  const { texto } = obtenerTextoYNombre(periodo, 'txt');
  document.getElementById('ru-preview-texto').textContent = texto;
  document.getElementById('ru-preview-card').style.display = '';
}

function ocultarVistaPrevia() {
  document.getElementById('ru-preview-card').style.display = 'none';
}

function manejarExportarTXT() {
  const periodo = obtenerPeriodoActivo();
  const { texto, nombre } = obtenerTextoYNombre(periodo, 'txt');
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8;' });
  window.descargarArchivo(blob, nombre);
}

function manejarExportarPDF() {
  const periodo = obtenerPeriodoActivo();
  let doc, nombre;
  if (moduloActivo === 'general') {
    doc = window.generarPDF(obtenerDatosGeneralFiltrados(periodo), periodo);
    nombre = `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`;
  } else if (moduloActivo === 'cxp') {
    const cuentas = obtenerCuentasCxPFiltradas(periodo);
    if (tipoCxPActivo === 'estadoCuenta') {
      const proveedor = leerFiltrosCxP().proveedor || 'TODOS';
      doc = window.generarPDFEstadoCuenta(proveedor, cuentas, periodo);
      nombre = `CxP_EstadoCuenta_${proveedor}_${window.obtenerFechaMexico()}.pdf`;
    } else if (tipoCxPActivo === 'consolidado') {
      doc = window.generarPDFConsolidadoCxP(cuentas, periodo);
      nombre = `CxP_Consolidado_${window.obtenerFechaMexico()}.pdf`;
    } else {
      doc = window.generarPDFHistorialPagos(cuentas, periodo);
      nombre = `CxP_HistorialPagos_${window.obtenerFechaMexico()}.pdf`;
    }
  } else if (moduloActivo === 'rendimientos') {
    if (tipoRendimientoActivo === 'porMaterial') {
      const resultado = obtenerResultadoRendimientoMaterialActivo(periodo);
      if (!resultado) {
        window.showError('Selecciona un material');
        return;
      }
      doc = window.generarPDFRendimientoMaterial(resultado, periodo);
      nombre = `Rendimiento_${resultado.material}_${window.obtenerFechaMexico()}.pdf`;
    } else if (tipoRendimientoActivo === 'porOperador') {
      const resultados = obtenerResultadoRendimientoOperadorActivo(periodo);
      doc = window.generarPDFRendimientoOperador(resultados, periodo, window.EVE.metaEficiencia || 90);
      nombre = `Rendimiento_Operadores_${window.obtenerFechaMexico()}.pdf`;
    } else if (tipoRendimientoActivo === 'porProceso') {
      const resultado = obtenerResultadoRendimientoPorProcesoActivo(periodo);
      if (!resultado || resultado.secciones.length === 0) {
        window.showError('No hay procesos registrados en el período');
        return;
      }
      doc = window.generarPDFRendimientoPorProceso(resultado, periodo);
      const nombreProceso = resultado.secciones.length === 1 ? resultado.secciones[0].tipoProceso : 'TodosLosProcesos';
      nombre = `Rendimiento_${nombreProceso}_${window.obtenerFechaMexico()}.pdf`;
    } else {
      window.showError('El reporte por ticket se exporta desde Trazabilidad');
      return;
    }
  } else {
    doc = window.generarPDFControlProduccion(obtenerRegistrosControlProduccionFiltrados(periodo), periodo);
    nombre = `Reporte_ControlProduccion_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`;
  }
  doc.save(nombre);
}

function manejarExportarCSV() {
  const periodo = obtenerPeriodoActivo();
  let filas, nombre;
  if (moduloActivo === 'general') {
    filas = window.construirFilasCSV(obtenerDatosGeneralFiltrados(periodo));
    nombre = `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.csv`;
  } else if (moduloActivo === 'cxp') {
    const cuentas = obtenerCuentasCxPFiltradas(periodo);
    if (tipoCxPActivo === 'estadoCuenta') {
      const proveedor = leerFiltrosCxP().proveedor || 'TODOS';
      filas = window.construirFilasCSVEstadoCuenta(cuentas);
      nombre = `CxP_EstadoCuenta_${proveedor}_${window.obtenerFechaMexico()}.csv`;
    } else if (tipoCxPActivo === 'consolidado') {
      filas = window.construirFilasCSVConsolidadoCxP(cuentas);
      nombre = `CxP_Consolidado_${window.obtenerFechaMexico()}.csv`;
    } else {
      filas = window.construirFilasCSVHistorialPagos(cuentas);
      nombre = `CxP_HistorialPagos_${window.obtenerFechaMexico()}.csv`;
    }
  } else if (moduloActivo === 'rendimientos') {
    if (tipoRendimientoActivo === 'porMaterial') {
      const resultado = obtenerResultadoRendimientoMaterialActivo(periodo);
      if (!resultado) {
        window.showError('Selecciona un material');
        return;
      }
      filas = window.construirFilasCSVRendimientoMaterial(resultado);
      nombre = `Rendimiento_${resultado.material}_${window.obtenerFechaMexico()}.csv`;
    } else if (tipoRendimientoActivo === 'porOperador') {
      const resultados = obtenerResultadoRendimientoOperadorActivo(periodo);
      filas = window.construirFilasCSVRendimientoOperador(resultados);
      nombre = `Rendimiento_Operadores_${window.obtenerFechaMexico()}.csv`;
    } else if (tipoRendimientoActivo === 'porProceso') {
      const resultado = obtenerResultadoRendimientoPorProcesoActivo(periodo);
      if (!resultado || resultado.secciones.length === 0) {
        window.showError('No hay procesos registrados en el período');
        return;
      }
      filas = window.construirFilasCSVRendimientoPorProceso(resultado);
      const nombreProceso = resultado.secciones.length === 1 ? resultado.secciones[0].tipoProceso : 'TodosLosProcesos';
      nombre = `Rendimiento_${nombreProceso}_${window.obtenerFechaMexico()}.csv`;
    } else {
      window.showError('El reporte por ticket se exporta desde Trazabilidad');
      return;
    }
  } else {
    filas = window.construirFilasCSVControlProduccion(obtenerRegistrosControlProduccionFiltrados(periodo));
    nombre = `Reporte_ControlProduccion_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.csv`;
  }
  window.exportarCSV(filas, nombre);
}

function crearTarjetaVistaPrevia() {
  const tarjeta = document.createElement('div');
  tarjeta.id = 'ru-preview-card';
  tarjeta.className = 'card';
  tarjeta.style.display = 'none';
  tarjeta.innerHTML = `
    <pre id="ru-preview-texto"></pre>
    <button type="button" id="ru-cerrar-preview" class="btn-secondary">✕ Cerrar Vista Previa</button>
  `;
  tarjeta.querySelector('#ru-cerrar-preview').addEventListener('click', ocultarVistaPrevia);
  return tarjeta;
}

function crearBotonesAccion() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const botonVistaPrevia = document.createElement('button');
  botonVistaPrevia.type = 'button';
  botonVistaPrevia.textContent = '🔍 Vista Previa';
  botonVistaPrevia.className = 'btn-primary';
  botonVistaPrevia.addEventListener('click', mostrarVistaPrevia);
  const botonLimpiar = document.createElement('button');
  botonLimpiar.type = 'button';
  botonLimpiar.textContent = '🔄 Limpiar';
  botonLimpiar.className = 'btn-secondary';
  botonLimpiar.addEventListener('click', () => {
    reconstruirCamposFiltro(document.getElementById('ru-filtros'));
    ocultarVistaPrevia();
  });
  div.appendChild(botonVistaPrevia);
  div.appendChild(botonLimpiar);
  return div;
}

async function manejarEnviarTelegram() {
  const periodo = obtenerPeriodoActivo();
  try {
    if (moduloActivo === 'cxp') {
      const cuentas = obtenerCuentasCxPFiltradas(periodo);
      const proveedor = leerFiltrosCxP().proveedor || 'TODOS';
      await window.enviarReporteCxPTelegram(tipoCxPActivo, proveedor, cuentas, periodo);
    } else if (moduloActivo === 'rendimientos') {
      if (tipoRendimientoActivo === 'porTicket') {
        window.showError('El reporte por ticket se envía desde Trazabilidad');
        return;
      }
      const metaEficiencia = window.EVE.metaEficiencia || 90;
      const materialResultado = tipoRendimientoActivo === 'porMaterial' ? obtenerResultadoRendimientoMaterialActivo(periodo) : null;
      if (tipoRendimientoActivo === 'porMaterial' && !materialResultado) {
        window.showError('Selecciona un material');
        return;
      }
      const procesoResultado = tipoRendimientoActivo === 'porProceso' ? obtenerResultadoRendimientoPorProcesoActivo(periodo) : null;
      if (tipoRendimientoActivo === 'porProceso' && (!procesoResultado || procesoResultado.secciones.length === 0)) {
        window.showError('No hay procesos registrados en el período');
        return;
      }
      const operadorResultados = tipoRendimientoActivo === 'porOperador' ? obtenerResultadoRendimientoOperadorActivo(periodo) : null;
      await window.enviarReporteRendimientoTelegram(tipoRendimientoActivo, periodo, materialResultado, operadorResultados, metaEficiencia, procesoResultado);
    } else {
      await window.enviarReporteTelegram(periodo);
    }
    window.showSuccess('Reporte enviado a Telegram');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearBotonesExportar() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const botonTXT = document.createElement('button');
  botonTXT.textContent = 'TXT';
  botonTXT.className = 'btn-secondary';
  botonTXT.addEventListener('click', manejarExportarTXT);
  const botonPDF = document.createElement('button');
  botonPDF.textContent = 'PDF';
  botonPDF.className = 'btn-secondary';
  botonPDF.addEventListener('click', manejarExportarPDF);
  const botonCSV = document.createElement('button');
  botonCSV.textContent = 'CSV';
  botonCSV.className = 'btn-secondary';
  botonCSV.addEventListener('click', manejarExportarCSV);
  const botonTelegram = document.createElement('button');
  botonTelegram.textContent = '📤 Telegram';
  botonTelegram.className = 'btn-secondary';
  botonTelegram.addEventListener('click', manejarEnviarTelegram);
  div.appendChild(botonTXT);
  div.appendChild(botonPDF);
  div.appendChild(botonCSV);
  div.appendChild(botonTelegram);
  return div;
}

function renderReportesUI(container) {
  moduloActivo = 'general';
  tabActivaReportes = 'personalizado';
  tipoRendimientoActivo = 'porMaterial';
  container.appendChild(crearSelectorModulo());
  container.appendChild(crearTabsReportes());
  container.appendChild(crearBarraFiltros());
  container.appendChild(crearBotonesAccion());
  container.appendChild(crearTarjetaVistaPrevia());
  container.appendChild(crearBotonesExportar());
}

window.EVE_MODULES.reportes = { render: renderReportesUI };

Object.assign(window.EVE_REPORTES_UI, {
  mostrarVistaPrevia,
  ocultarVistaPrevia,
  manejarEnviarTelegram
});

})();
