(function () {

function construirNodoProceso(registro) {
  return {
    tipo: 'proceso',
    ticket: registro.ticket,
    tipoProceso: registro.tipoProceso,
    kg: Number(registro.outputs.principal.kg) || 0,
    merma: Number(registro.outputs.merma.kg) || 0,
    eficiencia: Number(registro.eficiencia) || 0
  };
}

function construirNodoEntrada(ticket, registrosDestaraje) {
  const entrada = registrosDestaraje.find((r) => String(r.ticket) === String(ticket));
  if (entrada) {
    return { tipo: 'entrada', ticket, material: entrada.material, kg: Number(entrada.kg) || 0, identificada: true };
  }
  return { tipo: 'entrada', ticket, material: null, kg: 0, identificada: false };
}

function buscarProcesoPorTicket(ticket, registrosControlProduccion) {
  return registrosControlProduccion.find((r) => r.ticket === ticket) || null;
}

function recolectarAlcanzables(ticketInicial, datos) {
  const entradas = new Map();
  const procesos = new Map();
  const terminales = new Map();

  function explorarAtras(ticket, visitados) {
    if (visitados.has(ticket)) return;
    visitados.add(ticket);
    const proceso = buscarProcesoPorTicket(ticket, datos.registrosControlProduccion);
    if (!proceso) {
      if (!entradas.has(ticket)) {
        entradas.set(ticket, construirNodoEntrada(ticket, datos.registrosDestaraje));
      }
      return;
    }
    if (!procesos.has(ticket)) {
      procesos.set(ticket, construirNodoProceso(proceso));
    }
    proceso.inputs.forEach((input) => explorarAtras(input.ticketOrigen, visitados));
  }

  function explorarAdelante(ticket, visitados) {
    if (visitados.has(ticket)) return;
    visitados.add(ticket);
    const ventas = datos.registrosVentas.filter((r) => r.ticketOrigen === ticket);
    const siguientes = datos.registrosControlProduccion.filter((r) =>
      r.inputs.some((input) => input.ticketOrigen === ticket)
    );
    ventas.forEach((v) => {
      terminales.set(`venta:${v.id}`, { tipo: 'venta', id: v.id, ticket: v.ticket, proveedor: v.proveedor, material: v.material, kg: Number(v.kg) || 0 });
    });
    if (ventas.length === 0 && siguientes.length === 0) {
      const nodo = procesos.get(ticket);
      if (nodo) terminales.set(`proceso-final:${ticket}`, nodo);
    }
    siguientes.forEach((p) => {
      if (!procesos.has(p.ticket)) {
        procesos.set(p.ticket, construirNodoProceso(p));
      }
      explorarAdelante(p.ticket, visitados);
    });
  }

  const procesoInicial = buscarProcesoPorTicket(ticketInicial, datos.registrosControlProduccion);
  if (procesoInicial && !procesos.has(ticketInicial)) {
    procesos.set(ticketInicial, construirNodoProceso(procesoInicial));
  }
  explorarAtras(ticketInicial, new Set());
  explorarAdelante(ticketInicial, new Set());

  return { entradas, procesos, terminales };
}

function calcularResumenGlobal(alcanzables) {
  let kgEntrada = 0;
  alcanzables.entradas.forEach((nodo) => { kgEntrada += nodo.kg; });
  let kgSalida = 0;
  alcanzables.terminales.forEach((nodo) => { kgSalida += nodo.kg; });
  let mermaTotal = 0;
  alcanzables.procesos.forEach((nodo) => { mermaTotal += nodo.merma; });
  const eficienciaGlobal = kgEntrada > 0 ? (kgSalida / kgEntrada) * 100 : 0;
  return { kgEntrada, kgSalida, mermaTotal, eficienciaGlobal };
}

function construirArbolHaciaAtras(ticket, datos, visitados) {
  if (visitados.has(ticket)) return null;
  const proceso = buscarProcesoPorTicket(ticket, datos.registrosControlProduccion);
  if (!proceso) {
    return { nodo: construirNodoEntrada(ticket, datos.registrosDestaraje), origenes: [], destinos: [] };
  }
  const nuevosVisitados = new Set(visitados);
  nuevosVisitados.add(ticket);
  const origenes = proceso.inputs
    .map((input) => construirArbolHaciaAtras(input.ticketOrigen, datos, nuevosVisitados))
    .filter(Boolean);
  return { nodo: construirNodoProceso(proceso), origenes, destinos: [] };
}

function construirArbolHaciaAdelante(ticket, datos, visitados) {
  if (visitados.has(ticket)) return [];
  const nuevosVisitados = new Set(visitados);
  nuevosVisitados.add(ticket);
  const ventas = datos.registrosVentas.filter((r) => r.ticketOrigen === ticket);
  const siguientes = datos.registrosControlProduccion.filter((r) =>
    r.inputs.some((input) => input.ticketOrigen === ticket)
  );
  const nodosVenta = ventas.map((v) => ({
    nodo: { tipo: 'venta', id: v.id, ticket: v.ticket, proveedor: v.proveedor, material: v.material, kg: Number(v.kg) || 0 },
    origenes: [],
    destinos: []
  }));
  const nodosProceso = siguientes.map((p) => ({
    nodo: construirNodoProceso(p),
    origenes: [],
    destinos: construirArbolHaciaAdelante(p.ticket, datos, nuevosVisitados)
  }));
  return [...nodosVenta, ...nodosProceso];
}

function construirCadena(ticketBuscado, datos) {
  const proceso = buscarProcesoPorTicket(ticketBuscado, datos.registrosControlProduccion);
  const entrada = datos.registrosDestaraje.find((r) => String(r.ticket) === String(ticketBuscado));
  if (!proceso && !entrada) {
    return { encontrado: false, arbol: null, resumen: null };
  }
  let arbol;
  if (proceso) {
    const origenes = proceso.inputs
      .map((input) => construirArbolHaciaAtras(input.ticketOrigen, datos, new Set([ticketBuscado])))
      .filter(Boolean);
    const destinos = construirArbolHaciaAdelante(ticketBuscado, datos, new Set());
    arbol = { nodo: construirNodoProceso(proceso), origenes, destinos };
  } else {
    const destinos = construirArbolHaciaAdelante(ticketBuscado, datos, new Set());
    arbol = { nodo: construirNodoEntrada(ticketBuscado, datos.registrosDestaraje), origenes: [], destinos };
  }
  const alcanzables = recolectarAlcanzables(ticketBuscado, datos);
  const resumen = calcularResumenGlobal(alcanzables);
  return { encontrado: true, arbol, resumen };
}

window.EVE_TRAZABILIDAD = {
  construirNodoProceso,
  construirNodoEntrada,
  buscarProcesoPorTicket,
  recolectarAlcanzables,
  calcularResumenGlobal,
  construirArbolHaciaAtras,
  construirArbolHaciaAdelante,
  construirCadena
};

function colorEficienciaLocal(eficiencia) {
  if (eficiencia >= 90) return 'verde';
  if (eficiencia >= 80) return 'naranja';
  return 'rojo';
}

function crearNodoArbolDOM(nodoArbol, esRaiz) {
  const contenedor = document.createElement('div');
  contenedor.className = 'cp-trz-nodo' + (esRaiz ? ' cp-trz-raiz' : '');
  const etiqueta = document.createElement('div');
  etiqueta.className = 'cp-trz-etiqueta';
  const nodo = nodoArbol.nodo;
  if (nodo.tipo === 'entrada') {
    etiqueta.textContent = nodo.identificada
      ? `ENTRADA ${nodo.ticket} — ${nodo.material} — ${window.formatearKg(nodo.kg, nodo.material)}`
      : `ENTRADA ${nodo.ticket} (no identificada)`;
  } else if (nodo.tipo === 'proceso') {
    etiqueta.textContent = `${nodo.tipoProceso} ${nodo.ticket} — Eficiencia ${nodo.eficiencia.toFixed(2)}% — ${window.formatearKg(nodo.kg, '')}`;
    etiqueta.classList.add(`cp-eficiencia-${colorEficienciaLocal(nodo.eficiencia)}`);
  } else {
    etiqueta.textContent = `VENTA ${nodo.proveedor} — ${nodo.material} — ${window.formatearKg(nodo.kg, nodo.material)}`;
  }
  contenedor.appendChild(etiqueta);

  if (nodoArbol.origenes && nodoArbol.origenes.length > 0) {
    const grupoOrigenes = document.createElement('div');
    grupoOrigenes.className = 'cp-trz-rama cp-trz-origenes';
    const tituloOrigenes = document.createElement('span');
    tituloOrigenes.className = 'cp-trz-titulo-rama';
    tituloOrigenes.textContent = 'Viene de:';
    grupoOrigenes.appendChild(tituloOrigenes);
    nodoArbol.origenes.forEach((hijo) => grupoOrigenes.appendChild(crearNodoArbolDOM(hijo, false)));
    contenedor.appendChild(grupoOrigenes);
  }
  if (nodoArbol.destinos && nodoArbol.destinos.length > 0) {
    const grupoDestinos = document.createElement('div');
    grupoDestinos.className = 'cp-trz-rama cp-trz-destinos';
    const tituloDestinos = document.createElement('span');
    tituloDestinos.className = 'cp-trz-titulo-rama';
    tituloDestinos.textContent = 'Va hacia:';
    grupoDestinos.appendChild(tituloDestinos);
    nodoArbol.destinos.forEach((hijo) => grupoDestinos.appendChild(crearNodoArbolDOM(hijo, false)));
    contenedor.appendChild(grupoDestinos);
  }
  return contenedor;
}

function renderizarResumenGlobal(resumen) {
  const contenedor = document.getElementById('cp-trz-resumen');
  contenedor.innerHTML = '';
  const partes = [
    `Kg Entrada: ${resumen.kgEntrada.toLocaleString('es-MX')}`,
    `Kg Salida: ${resumen.kgSalida.toLocaleString('es-MX')}`,
    `Merma Total: ${resumen.mermaTotal.toLocaleString('es-MX')}`,
    `Eficiencia Global: ${resumen.eficienciaGlobal.toFixed(2)}%`
  ];
  partes.forEach((texto) => {
    const span = document.createElement('span');
    span.textContent = texto;
    contenedor.appendChild(span);
  });
}

function buscarTrazabilidad(ticket) {
  const datos = {
    registrosControlProduccion: window.EVE.registrosControlProduccion,
    registrosDestaraje: window.EVE.registrosDestaraje,
    registrosVentas: window.EVE.registrosVentas
  };
  const cadena = construirCadena(ticket.trim(), datos);
  const arbolContenedor = document.getElementById('cp-trz-arbol');
  arbolContenedor.innerHTML = '';
  const resumenContenedor = document.getElementById('cp-trz-resumen');
  resumenContenedor.innerHTML = '';
  if (!cadena.encontrado) {
    const mensaje = document.createElement('p');
    mensaje.textContent = `No se encontró ningún registro con el ticket "${ticket}"`;
    arbolContenedor.appendChild(mensaje);
    return;
  }
  arbolContenedor.appendChild(crearNodoArbolDOM(cadena.arbol, true));
  renderizarResumenGlobal(cadena.resumen);
}

function crearVistaTrazabilidad() {
  const contenedor = document.createElement('div');
  contenedor.className = 'card cp-trazabilidad';
  contenedor.innerHTML = `
    <div class="cp-trz-buscador">
      <input type="text" id="cp-trz-ticket" placeholder="Buscar por ticket">
      <button type="button" id="cp-trz-buscar" class="btn-primary">Buscar</button>
    </div>
    <div id="cp-trz-resumen" class="cp-trz-resumen-global"></div>
    <div id="cp-trz-arbol" class="cp-trz-arbol"></div>
  `;
  contenedor.querySelector('#cp-trz-buscar').addEventListener('click', () => {
    const ticket = document.getElementById('cp-trz-ticket').value;
    if (ticket.trim()) buscarTrazabilidad(ticket);
  });
  return contenedor;
}

Object.assign(window.EVE_TRAZABILIDAD, {
  crearVistaTrazabilidad,
  buscarTrazabilidad
});

})();
