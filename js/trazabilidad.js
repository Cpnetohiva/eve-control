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

})();
