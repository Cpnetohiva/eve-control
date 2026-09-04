(function () {

// ── Funciones puras ─────────────────────────────────────────────────────

const ETAPAS_INVENTARIO = [
  'RECEPCIÓN', 'SELECCIÓN', 'EMPACADO', 'MOLIENDA', 'LAVADO', 'MEZCLADO',
  'PELETIZADO', 'INYECCIÓN', 'SOPLADO', 'PRODUCTO TERMINADO', 'VENDIDO'
];

const ETAPA_POR_PROCESO = {
  SELECCION: 'SELECCIÓN',
  EMPACADO: 'EMPACADO',
  MOLIENDA: 'MOLIENDA',
  LAVADO: 'LAVADO',
  PELETIZADO: 'PELETIZADO',
  PRODUCCION_CAJAS: 'INYECCIÓN',
  PRODUCCION_TAMBOS: 'SOPLADO'
};

const ETAPAS_FINALES = ['EMPACADO', 'PELETIZADO', 'INYECCIÓN', 'SOPLADO', 'PRODUCTO TERMINADO'];
const ETAPAS_EN_PROCESO = ['SELECCIÓN', 'MOLIENDA', 'LAVADO', 'MEZCLADO'];

// Orden de búsqueda al consumir un material: se toma de la etapa más avanzada
// donde exista saldo; si no hay saldo en ninguna, se descuenta de RECEPCIÓN
// (queda en negativo, marcado en rojo como error de captura a corregir).
const ORDEN_CONSUMO = [
  'PRODUCTO TERMINADO', 'SOPLADO', 'INYECCIÓN', 'PELETIZADO', 'EMPACADO',
  'MEZCLADO', 'LAVADO', 'MOLIENDA', 'SELECCIÓN', 'RECEPCIÓN'
];

function obtenerCelda(ledger, material, etapa) {
  if (!ledger[material]) ledger[material] = {};
  if (ledger[material][etapa] === undefined) ledger[material][etapa] = 0;
  return ledger[material][etapa];
}

function sumarCelda(ledger, material, etapa, delta) {
  obtenerCelda(ledger, material, etapa);
  ledger[material][etapa] += delta;
}

function encontrarEtapaConSaldo(ledger, material) {
  const balances = ledger[material] || {};
  const encontrada = ORDEN_CONSUMO.find((etapa) => (balances[etapa] || 0) > 1e-6);
  return encontrada || 'RECEPCIÓN';
}

function construirEventos(datos) {
  const eventos = [];
  (datos.registrosDestaraje || []).forEach((r) => {
    eventos.push({ tipo: 'recepcion', fecha: r.fechaSalida || '', material: (r.material || '').toString().trim().toUpperCase(), kg: Number(r.kg) || 0 });
  });
  (datos.registrosControlProduccion || []).forEach((r) => {
    const etapaDestino = ETAPA_POR_PROCESO[r.tipoProceso] || null;
    eventos.push({
      tipo: 'proceso',
      fecha: r.fechaFin || '',
      inputs: (r.inputs || []).map((i) => ({ material: (i.material || '').toString().trim().toUpperCase(), kg: Number(i.kg) || 0 })),
      outputs: (r.outputs || [])
        .filter((o) => !o.esMerma)
        .map((o) => ({ material: (o.material || '').toString().trim().toUpperCase(), kg: Number(o.kg) || 0, etapaDestino }))
    });
  });
  (datos.ventas || []).forEach((v) => {
    (v.lineas || []).forEach((l) => {
      eventos.push({ tipo: 'venta', fecha: v.fecha || '', material: (l.material || '').toString().trim().toUpperCase(), kg: Number(l.cantidad) || 0 });
    });
  });
  return eventos.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
}

function procesarEventos(eventos) {
  const ledger = {};
  eventos.forEach((evento) => {
    if (evento.tipo === 'recepcion') {
      sumarCelda(ledger, evento.material, 'RECEPCIÓN', evento.kg);
    } else if (evento.tipo === 'proceso') {
      evento.inputs.forEach((input) => {
        const etapaOrigen = encontrarEtapaConSaldo(ledger, input.material);
        sumarCelda(ledger, input.material, etapaOrigen, -input.kg);
      });
      (evento.outputs || []).forEach((output) => {
        if (output.etapaDestino && output.material) {
          sumarCelda(ledger, output.material, output.etapaDestino, output.kg);
        }
      });
    } else if (evento.tipo === 'venta') {
      const etapaOrigen = encontrarEtapaConSaldo(ledger, evento.material);
      sumarCelda(ledger, evento.material, etapaOrigen, -evento.kg);
      sumarCelda(ledger, evento.material, 'VENDIDO', evento.kg);
    }
  });
  return ledger;
}

function calcularInventarioCalculado(datos) {
  const ledger = procesarEventos(construirEventos(datos));
  const filas = [];
  Object.keys(ledger).sort().forEach((material) => {
    ETAPAS_INVENTARIO.forEach((etapa) => {
      const cantidad = ledger[material][etapa];
      if (cantidad !== undefined && Math.round(cantidad * 100) / 100 !== 0) {
        filas.push({ material, etapa, cantidadCalculada: Math.round(cantidad * 100) / 100 });
      }
    });
  });
  return filas;
}

function buscarDocInventario(registrosInventario, material, etapa) {
  return (registrosInventario || []).find((r) => r.material === material && r.etapa === etapa) || null;
}

function combinarConAjustes(filasCalculadas, registrosInventario) {
  return filasCalculadas.map((fila) => {
    const doc = buscarDocInventario(registrosInventario, fila.material, fila.etapa);
    const ajusteNeto = doc ? Number(doc.ajusteNeto) || 0 : 0;
    return {
      ...fila,
      cantidadReal: Math.round((fila.cantidadCalculada + ajusteNeto) * 100) / 100,
      docId: doc ? doc.id : null,
      ajusteNeto,
      ajustes: doc ? (doc.ajustes || []) : []
    };
  });
}

function estadoInventario(fila) {
  if (fila.cantidadReal < 0) return { color: 'rojo', etiqueta: '⚠️ Error de captura' };
  if (fila.etapa === 'VENDIDO') return { color: 'gris', etiqueta: 'Vendido' };
  if (ETAPAS_FINALES.includes(fila.etapa)) return { color: 'verde', etiqueta: 'Listo venta' };
  if (fila.etapa === 'RECEPCIÓN') return { color: 'amarillo', etiqueta: 'Pendiente proc.' };
  return { color: 'azul', etiqueta: 'En proceso' };
}

function construirMatrizInventario(filas) {
  const materiales = Array.from(new Set(filas.map((f) => f.material))).sort();
  return materiales.map((material) => {
    const celdas = {};
    let totalPlanta = 0;
    ETAPAS_INVENTARIO.forEach((etapa) => {
      const fila = filas.find((f) => f.material === material && f.etapa === etapa);
      celdas[etapa] = fila || null;
      if (fila && etapa !== 'VENDIDO') totalPlanta += fila.cantidadReal;
    });
    return { material, celdas, totalPlanta: Math.round(totalPlanta * 100) / 100 };
  });
}

function calcularMermaAcumulada(registrosControlProduccion) {
  const registros = registrosControlProduccion || [];
  const totalProcesado = registros.reduce((suma, r) =>
    suma + (r.inputs || []).reduce((s, i) => s + (Number(i.kg) || 0), 0), 0);
  const mermaPorMaterial = new Map();
  registros.forEach((r) => {
    (r.outputs || []).filter((o) => o.esMerma).forEach((o) => {
      const material = (o.material || '').toString().trim().toUpperCase();
      if (!material) return;
      mermaPorMaterial.set(material, (mermaPorMaterial.get(material) || 0) + (Number(o.kg) || 0));
    });
  });
  return Array.from(mermaPorMaterial.entries())
    .map(([material, kgMerma]) => ({
      material,
      kgMerma: Math.round(kgMerma * 100) / 100,
      porcentaje: totalProcesado > 0 ? Math.round((kgMerma / totalProcesado) * 10000) / 100 : 0
    }))
    .sort((a, b) => b.kgMerma - a.kgMerma);
}

function resumenInventario(filas) {
  let totalPlanta = 0;
  let listoVenta = 0;
  let enProceso = 0;
  let pendienteProcesar = 0;
  filas.forEach((f) => {
    if (f.etapa === 'VENDIDO') return;
    totalPlanta += f.cantidadReal;
    if (ETAPAS_FINALES.includes(f.etapa)) listoVenta += f.cantidadReal;
    else if (ETAPAS_EN_PROCESO.includes(f.etapa)) enProceso += f.cantidadReal;
    else if (f.etapa === 'RECEPCIÓN') pendienteProcesar += f.cantidadReal;
  });
  const r2 = (n) => Math.round(n * 100) / 100;
  return { totalPlanta: r2(totalPlanta), listoVenta: r2(listoVenta), enProceso: r2(enProceso), pendienteProcesar: r2(pendienteProcesar) };
}

function construirAjuste(datos, cantidadRealActual) {
  const material = (datos.material || '').toString().trim().toUpperCase();
  if (!material) throw new Error('Selecciona un material');
  const etapa = (datos.etapa || '').toString().trim();
  if (!ETAPAS_INVENTARIO.includes(etapa)) throw new Error('Selecciona una etapa válida');
  const cantidadDeseada = Number(datos.cantidadReal);
  if (!Number.isFinite(cantidadDeseada)) throw new Error('La cantidad real debe ser un número');
  const motivo = (datos.motivo || '').toString().trim();
  if (!motivo) throw new Error('El motivo del ajuste es obligatorio');
  const diferencia = Math.round((cantidadDeseada - cantidadRealActual) * 100) / 100;
  return {
    material,
    etapa,
    diferencia,
    registro: {
      fecha: datos.fecha,
      cantidadAntes: cantidadRealActual,
      cantidadDespues: cantidadDeseada,
      diferencia,
      motivo,
      ajustadoPor: datos.ajustadoPor
    }
  };
}

window.EVE_INVENTARIO = {
  ETAPAS_INVENTARIO,
  ETAPA_POR_PROCESO,
  ETAPAS_FINALES,
  ETAPAS_EN_PROCESO,
  construirEventos,
  procesarEventos,
  calcularInventarioCalculado,
  buscarDocInventario,
  combinarConAjustes,
  construirMatrizInventario,
  calcularMermaAcumulada,
  estadoInventario,
  resumenInventario,
  construirAjuste
};

// ── Estado del módulo ────────────────────────────────────────────────────

let vistaActiva = 'tabla';
let materialAjusteSeleccionado = '';
let etapaAjusteSeleccionada = '';
let filasActuales = [];

function puedeAjustarInventario() {
  const permisos = window.EVE.currentUser && window.EVE.currentUser.permissions;
  return !!(permisos && permisos.inventario_ajuste);
}

function obtenerFilasCombinadas() {
  const calculado = calcularInventarioCalculado({
    registrosDestaraje: window.EVE.registrosDestaraje,
    registrosControlProduccion: window.EVE.registrosControlProduccion,
    ventas: window.EVE.ventas
  });
  return combinarConAjustes(calculado, window.EVE.inventario);
}

// ── Modal de ajuste manual ────────────────────────────────────────────────

function llenarSelectoresAjuste() {
  const selectMaterial = document.getElementById('ia-material');
  const materiales = Array.from(new Set(filasActuales.map((f) => f.material))).sort();
  selectMaterial.innerHTML = '<option value="">Selecciona un material…</option>';
  materiales.forEach((m) => {
    const opcion = document.createElement('option');
    opcion.value = m;
    opcion.textContent = m;
    selectMaterial.appendChild(opcion);
  });

  const selectEtapa = document.getElementById('ia-etapa');
  selectEtapa.innerHTML = '<option value="">Selecciona una etapa…</option>';
  ETAPAS_INVENTARIO.forEach((e) => {
    const opcion = document.createElement('option');
    opcion.value = e;
    opcion.textContent = e;
    selectEtapa.appendChild(opcion);
  });
}

function actualizarVistaPreviaAjuste() {
  const material = document.getElementById('ia-material').value;
  const etapa = document.getElementById('ia-etapa').value;
  const fila = filasActuales.find((f) => f.material === material && f.etapa === etapa);
  const cantidadActual = fila ? fila.cantidadReal : 0;
  document.getElementById('ia-cantidad-calculada').textContent = fila ? `${fila.cantidadCalculada} Kg` : '0 Kg';
  document.getElementById('ia-cantidad-actual').textContent = `${cantidadActual} Kg`;
  document.getElementById('ia-cantidad-real').value = cantidadActual;
}

async function manejarEnvioAjuste(evento) {
  evento.preventDefault();
  const material = document.getElementById('ia-material').value;
  const etapa = document.getElementById('ia-etapa').value;
  const fila = filasActuales.find((f) => f.material === material && f.etapa === etapa);
  const cantidadRealActual = fila ? fila.cantidadReal : 0;
  const usuario = (window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
  const datos = {
    material,
    etapa,
    cantidadReal: document.getElementById('ia-cantidad-real').value,
    motivo: document.getElementById('ia-motivo').value,
    fecha: window.obtenerFechaMexico(),
    ajustadoPor: usuario
  };
  try {
    const { diferencia, registro } = construirAjuste(datos, cantidadRealActual);
    const docExistente = buscarDocInventario(window.EVE.inventario, material, etapa);
    if (docExistente) {
      const ajustesActualizados = [...(docExistente.ajustes || []), registro];
      const ajusteNetoActualizado = Math.round(((Number(docExistente.ajusteNeto) || 0) + diferencia) * 100) / 100;
      await window.actualizarDato('inventario', docExistente.id, {
        ajusteNeto: ajusteNetoActualizado,
        ajustes: ajustesActualizados,
        ultimaActualizacion: new Date().toISOString()
      });
      docExistente.ajusteNeto = ajusteNetoActualizado;
      docExistente.ajustes = ajustesActualizados;
    } else {
      const nuevoDoc = {
        material,
        etapa,
        unidad: 'KG',
        ajusteNeto: diferencia,
        ajustes: [registro],
        ultimaActualizacion: new Date().toISOString()
      };
      const id = await window.guardarDato('inventario', nuevoDoc);
      window.EVE.inventario.push({ id, ...nuevoDoc });
    }
    window.EVE_HISTORIAL.registrar({
      coleccion: 'inventario',
      registroId: `${material}__${etapa}`,
      accion: 'ajuste',
      valorAnterior: { cantidadReal: registro.cantidadAntes },
      valorNuevo: { cantidadReal: registro.cantidadDespues },
      motivo: registro.motivo
    });
    cerrarModalAjuste();
    renderizarVistaActiva();
    window.showSuccess('Ajuste aplicado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearModalAjuste() {
  const overlay = document.createElement('div');
  overlay.id = 'inventario-ajuste-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>⚙️ Ajuste Manual de Inventario</h3>
      <form id="inventario-ajuste-form">
        <label class="admin-config-campo">Material <select id="ia-material" required></select></label>
        <label class="admin-config-campo">Etapa <select id="ia-etapa" required></select></label>
        <p>Cantidad actual (calculada): <span id="ia-cantidad-calculada">0 Kg</span></p>
        <p>Cantidad real actual: <span id="ia-cantidad-actual">0 Kg</span></p>
        <label class="admin-config-campo">Cantidad real (física) <input type="number" id="ia-cantidad-real" step="0.01" required></label>
        <textarea id="ia-motivo" placeholder="Motivo del ajuste (obligatorio)" rows="2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical" required></textarea>
        <p class="chip chip-warn">⚠️ Este ajuste queda registrado con tu usuario y fecha. No se puede deshacer.</p>
        <button type="submit" class="btn-primary">Aplicar Ajuste</button>
        <button type="button" id="ia-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#ia-material').addEventListener('change', actualizarVistaPreviaAjuste);
  overlay.querySelector('#ia-etapa').addEventListener('change', actualizarVistaPreviaAjuste);
  overlay.querySelector('#inventario-ajuste-form').addEventListener('submit', manejarEnvioAjuste);
  overlay.querySelector('#ia-cancelar').addEventListener('click', () => cerrarModalAjuste());
  return overlay;
}

function abrirModalAjuste(materialPrefill, etapaPrefill) {
  document.getElementById('inventario-ajuste-form').reset();
  llenarSelectoresAjuste();
  if (materialPrefill) document.getElementById('ia-material').value = materialPrefill;
  if (etapaPrefill) document.getElementById('ia-etapa').value = etapaPrefill;
  actualizarVistaPreviaAjuste();
  document.getElementById('inventario-ajuste-overlay').classList.add('open');
}

function cerrarModalAjuste() {
  document.getElementById('inventario-ajuste-overlay').classList.remove('open');
}

// ── Vista: tabla principal ────────────────────────────────────────────────

function crearBarraAcciones() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const btnActualizar = document.createElement('button');
  btnActualizar.textContent = '🔄 Actualizar';
  btnActualizar.className = 'btn-secondary';
  btnActualizar.addEventListener('click', () => renderizarVistaActiva());
  div.appendChild(btnActualizar);
  if (puedeAjustarInventario()) {
    const btnAjustar = document.createElement('button');
    btnAjustar.textContent = '⚙️ Ajustar';
    btnAjustar.className = 'btn-primary';
    btnAjustar.addEventListener('click', () => abrirModalAjuste());
    div.appendChild(btnAjustar);
  }
  return div;
}

function crearVistaTabla() {
  const wrapper = document.createElement('div');
  wrapper.id = 'inventario-tabla-wrapper';

  const cabecera = document.createElement('p');
  cabecera.id = 'inventario-ultima-actualizacion';
  wrapper.appendChild(cabecera);

  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'card destaraje-tabla-wrapper';
  tablaWrapper.innerHTML = `
    <table class="tabla-destaraje">
      <thead><tr><th>Material</th>${ETAPAS_INVENTARIO.map((etapa) => `<th>${etapa}</th>`).join('')}<th>Total planta</th></tr></thead>
      <tbody id="inventario-tabla-body"></tbody>
    </table>
  `;
  wrapper.appendChild(tablaWrapper);

  const resumen = document.createElement('div');
  resumen.id = 'inventario-resumen';
  resumen.className = 'card';
  wrapper.appendChild(resumen);

  const merma = document.createElement('div');
  merma.id = 'inventario-merma';
  merma.className = 'card';
  wrapper.appendChild(merma);

  return wrapper;
}

function llenarVistaTabla() {
  const cabecera = document.getElementById('inventario-ultima-actualizacion');
  const ahora = new Date();
  cabecera.textContent = `Última actualización: ${window.formatearFecha(window.obtenerFechaMexico())} ${ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;

  filasActuales = obtenerFilasCombinadas();
  const tbody = document.getElementById('inventario-tabla-body');
  tbody.innerHTML = '';
  const totalColumnas = ETAPAS_INVENTARIO.length + 2;
  if (filasActuales.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = totalColumnas;
    celda.textContent = 'Sin movimientos de inventario registrados';
    fila.appendChild(celda);
    tbody.appendChild(fila);
  } else {
    const puedeAjustar = puedeAjustarInventario();
    construirMatrizInventario(filasActuales).forEach((filaMaterial) => {
      const fila = document.createElement('tr');
      const celdaMaterial = document.createElement('td');
      celdaMaterial.textContent = filaMaterial.material;
      fila.appendChild(celdaMaterial);

      ETAPAS_INVENTARIO.forEach((etapa) => {
        const datoCelda = filaMaterial.celdas[etapa];
        const celda = document.createElement('td');
        if (!datoCelda) {
          celda.textContent = '—';
        } else {
          const estado = estadoInventario(datoCelda);
          celda.textContent = `${datoCelda.cantidadReal.toLocaleString('es-MX')} Kg`;
          celda.title = estado.etiqueta;
          celda.classList.add(`inv-estado-${estado.color}`);
          if (etapa === 'VENDIDO') celda.classList.add('inv-celda-vendido');
          if (puedeAjustar) {
            celda.classList.add('inv-celda-clic');
            celda.addEventListener('click', () => abrirModalAjuste(datoCelda.material, datoCelda.etapa));
          }
        }
        fila.appendChild(celda);
      });

      const celdaTotal = document.createElement('td');
      celdaTotal.textContent = `${filaMaterial.totalPlanta.toLocaleString('es-MX')} Kg`;
      celdaTotal.style.fontWeight = '600';
      fila.appendChild(celdaTotal);

      tbody.appendChild(fila);
    });
  }

  const resumen = resumenInventario(filasActuales);
  const contenedorResumen = document.getElementById('inventario-resumen');
  contenedorResumen.innerHTML = '<h4>RESUMEN</h4>';
  [
    `Total en planta: ${resumen.totalPlanta.toLocaleString('es-MX')} Kg`,
    `Listo para venta: ${resumen.listoVenta.toLocaleString('es-MX')} Kg`,
    `En proceso: ${resumen.enProceso.toLocaleString('es-MX')} Kg`,
    `Pendiente procesar: ${resumen.pendienteProcesar.toLocaleString('es-MX')} Kg`
  ].forEach((texto) => {
    const p = document.createElement('p');
    p.textContent = texto;
    contenedorResumen.appendChild(p);
  });

  const contenedorMerma = document.getElementById('inventario-merma');
  contenedorMerma.innerHTML = '<h4>♻️ Merma Acumulada (histórico)</h4><p class="chip chip-warn">Solo lectura — no es inventario físico disponible</p>';
  const filasMerma = calcularMermaAcumulada(window.EVE.registrosControlProduccion);
  if (filasMerma.length === 0) {
    const vacio = document.createElement('p');
    vacio.textContent = 'Sin merma registrada';
    contenedorMerma.appendChild(vacio);
  } else {
    const tablaWrapper = document.createElement('div');
    tablaWrapper.className = 'destaraje-tabla-wrapper';
    tablaWrapper.style.marginTop = '0.5rem';
    tablaWrapper.innerHTML = `
      <table class="tabla-destaraje">
        <thead><tr><th>Material</th><th>Kg Merma</th><th>% del total procesado</th></tr></thead>
        <tbody></tbody>
      </table>
    `;
    const tbodyMerma = tablaWrapper.querySelector('tbody');
    filasMerma.forEach((f) => {
      const fila = document.createElement('tr');
      [f.material, `${f.kgMerma.toLocaleString('es-MX')} Kg`, `${f.porcentaje.toLocaleString('es-MX')}%`].forEach((valor) => {
        const celda = document.createElement('td');
        celda.textContent = valor;
        fila.appendChild(celda);
      });
      tbodyMerma.appendChild(fila);
    });
    contenedorMerma.appendChild(tablaWrapper);
  }
}

// ── Vista: historial de ajustes ───────────────────────────────────────────

function crearVistaAjustes() {
  const wrapper = document.createElement('div');
  wrapper.id = 'inventario-ajustes-wrapper';
  wrapper.style.display = 'none';

  const selectorCard = document.createElement('div');
  selectorCard.className = 'card';
  selectorCard.innerHTML = `
    <div class="form-grid">
      <label class="admin-config-campo">Material <select id="iah-material"></select></label>
      <label class="admin-config-campo">Etapa <select id="iah-etapa"></select></label>
    </div>
  `;
  wrapper.appendChild(selectorCard);

  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'card destaraje-tabla-wrapper';
  tablaWrapper.id = 'inventario-ajustes-tabla-wrapper';
  wrapper.appendChild(tablaWrapper);

  selectorCard.querySelector('#iah-material').addEventListener('change', () => {
    materialAjusteSeleccionado = document.getElementById('iah-material').value;
    etapaAjusteSeleccionada = '';
    llenarSelectoresHistorialAjustes();
    llenarVistaAjustes();
  });
  selectorCard.querySelector('#iah-etapa').addEventListener('change', () => {
    etapaAjusteSeleccionada = document.getElementById('iah-etapa').value;
    llenarVistaAjustes();
  });

  return wrapper;
}

function llenarSelectoresHistorialAjustes() {
  const filas = obtenerFilasCombinadas().filter((f) => f.ajustes && f.ajustes.length > 0);
  const materiales = Array.from(new Set(filas.map((f) => f.material))).sort();
  const selectMaterial = document.getElementById('iah-material');
  selectMaterial.innerHTML = '<option value="">Selecciona un material…</option>';
  materiales.forEach((m) => {
    const opcion = document.createElement('option');
    opcion.value = m;
    opcion.textContent = m;
    selectMaterial.appendChild(opcion);
  });
  if (materiales.includes(materialAjusteSeleccionado)) selectMaterial.value = materialAjusteSeleccionado;

  const etapas = Array.from(new Set(filas.filter((f) => f.material === selectMaterial.value).map((f) => f.etapa)));
  const selectEtapa = document.getElementById('iah-etapa');
  selectEtapa.innerHTML = '<option value="">Selecciona una etapa…</option>';
  etapas.forEach((e) => {
    const opcion = document.createElement('option');
    opcion.value = e;
    opcion.textContent = e;
    selectEtapa.appendChild(opcion);
  });
  if (etapas.includes(etapaAjusteSeleccionada)) selectEtapa.value = etapaAjusteSeleccionada;
}

function llenarVistaAjustes() {
  const wrapper = document.getElementById('inventario-ajustes-tabla-wrapper');
  wrapper.innerHTML = '';
  if (!materialAjusteSeleccionado || !etapaAjusteSeleccionada) {
    const mensaje = document.createElement('p');
    mensaje.textContent = 'Selecciona un material y una etapa para ver su historial de ajustes';
    wrapper.appendChild(mensaje);
    return;
  }
  const fila = obtenerFilasCombinadas().find((f) => f.material === materialAjusteSeleccionado && f.etapa === etapaAjusteSeleccionada);
  const ajustes = (fila ? fila.ajustes : []).slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  if (ajustes.length === 0) {
    const mensaje = document.createElement('p');
    mensaje.textContent = 'Sin ajustes registrados para esta combinación';
    wrapper.appendChild(mensaje);
    return;
  }
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead><tr><th>Fecha</th><th>Antes</th><th>Después</th><th>Diferencia</th><th>Motivo</th><th>Usuario</th></tr></thead>
    <tbody></tbody>
  `;
  const tbody = tabla.querySelector('tbody');
  ajustes.forEach((a) => {
    const filaTr = document.createElement('tr');
    const valores = [
      window.formatearFecha(a.fecha),
      `${a.cantidadAntes} Kg`,
      `${a.cantidadDespues} Kg`,
      `${a.diferencia > 0 ? '+' : ''}${a.diferencia} Kg`,
      a.motivo,
      a.ajustadoPor
    ];
    valores.forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      filaTr.appendChild(celda);
    });
    tbody.appendChild(filaTr);
  });
  wrapper.appendChild(tabla);
}

// ── Orquestación de vistas ────────────────────────────────────────────────

function crearSubtabs() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  nav.id = 'inventario-subtabs';
  const definiciones = [
    { id: 'tabla', nombre: 'Inventario' },
    { id: 'ajustes', nombre: 'Historial de Ajustes' }
  ];
  definiciones.forEach((def) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (def.id === vistaActiva ? ' active' : '');
    boton.textContent = def.nombre;
    boton.dataset.tab = def.id;
    boton.addEventListener('click', () => {
      vistaActiva = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === vistaActiva));
      renderizarVistaActiva();
    });
    nav.appendChild(boton);
  });
  return nav;
}

function renderizarVistaActiva() {
  document.getElementById('inventario-tabla-wrapper').style.display = vistaActiva === 'tabla' ? '' : 'none';
  document.getElementById('inventario-ajustes-wrapper').style.display = vistaActiva === 'ajustes' ? '' : 'none';
  if (vistaActiva === 'tabla') {
    llenarVistaTabla();
  } else {
    llenarSelectoresHistorialAjustes();
    llenarVistaAjustes();
  }
}

function renderInventario(container) {
  vistaActiva = 'tabla';
  materialAjusteSeleccionado = '';
  etapaAjusteSeleccionada = '';
  filasActuales = [];

  container.appendChild(crearBarraAcciones());
  container.appendChild(crearSubtabs());
  container.appendChild(crearVistaTabla());
  container.appendChild(crearVistaAjustes());
  if (puedeAjustarInventario()) {
    container.appendChild(crearModalAjuste());
  }

  renderizarVistaActiva();
}

window.EVE_MODULES.inventario = { render: renderInventario };

})();
