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
  PRODUCCION_TAMBOS: 'SOPLADO',
  PRODUCCION_TAPONES: 'INYECCIÓN'
};

// La etapa es un dato informativo (dónde está el material): el saldo disponible de un material es la suma de
// todas sus etapas menos VENDIDO. No se distingue "listo para venta" de "en proceso".

// Unidad real del material: las piezas (PZ) nunca se suman con los kg.
function esMaterialPiezas(material) {
  return window.materialesPZ().includes(window.normalizarMaterial(material));
}

// Orden de búsqueda al consumir un material: se toma de la etapa más avanzada
// donde exista saldo; si no hay saldo en ninguna, se descuenta de RECEPCIÓN
// (queda en negativo, marcado en rojo como error de captura a corregir).
const ORDEN_CONSUMO = [
  'PRODUCTO TERMINADO', 'SOPLADO', 'INYECCIÓN', 'PELETIZADO', 'EMPACADO',
  'MEZCLADO', 'LAVADO', 'MOLIENDA', 'SELECCIÓN', 'RECEPCIÓN'
];

// Etapas de las que un proceso toma sus inputs, en este orden (el consumo se reparte entre ellas). NO se
// cae a ORDEN_CONSUMO ni a otras etapas: lo que no alcance es un faltante (aviso + saldo negativo).
// INYECCIÓN y SOPLADO en MOLIENDA guardan los materiales de rechazo (RECHAZO CAJAS P.E./P.P. en INYECCIÓN,
// RECHAZO TAMBOS en SOPLADO), que salen de PRODUCCION_CAJAS/TAMBOS como outputs que no son merma.
const ORIGEN_POR_PROCESO = {
  SELECCION: ['RECEPCIÓN'],
  EMPACADO: ['SELECCIÓN'],
  MOLIENDA: ['SELECCIÓN', 'INYECCIÓN', 'SOPLADO'],
  LAVADO: ['MOLIENDA'],
  PELETIZADO: ['LAVADO', 'MOLIENDA'],
  PRODUCCION_CAJAS: ['PELETIZADO'],
  PRODUCCION_TAMBOS: ['PELETIZADO'],
  PRODUCCION_TAPONES: ['PELETIZADO']
};

// Procesos que, además de su lista base, pueden tomar de RECEPCIÓN un material que no requiere selección
// (molido comprado, MATERIAL VIRGEN): se compra ya listo y no pasa por Selección.
const PROCESOS_CON_ORIGEN_RECEPCION = ['LAVADO', 'PELETIZADO', 'PRODUCCION_CAJAS', 'PRODUCCION_TAMBOS', 'PRODUCCION_TAPONES'];

// Bandera requiereSeleccion del catálogo (true por omisión; un material fuera del catálogo se trata como crudo).
function materialRequiereSeleccion(material) {
  const entrada = (window.CATALOGO_MATERIALES || []).find((m) => m.nombre === window.normalizarMaterial(material));
  return entrada ? entrada.requiereSeleccion !== false : true;
}

// Etapas de origen de un input de un proceso. En SELECCION un material que no requiere selección no tiene
// origen válido (lista vacía: se avisa que no se selecciona).
function etapasOrigen(tipoProceso, material) {
  const base = ORIGEN_POR_PROCESO[tipoProceso] || [];
  const requiere = materialRequiereSeleccion(material);
  if (tipoProceso === 'SELECCION') return requiere ? base.slice() : [];
  if (!requiere && PROCESOS_CON_ORIGEN_RECEPCION.includes(tipoProceso)) return [...base, 'RECEPCIÓN'];
  return base.slice();
}

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

// Orden de los eventos dentro de un mismo día: inventario inicial, recepción (Báscula), proceso
// (Control Producción) y venta. Así producir y vender el mismo día no deja saldo negativo.
const RANGO_EVENTO = { inicial: 0, recepcion: 1, proceso: 2, venta: 3 };

// Los eventos se ordenan y se cortan por DÍA: se usan solo los primeros 10 caracteres (YYYY-MM-DD),
// de modo que un registro con hora ('2026-09-14T10:00') cae en el mismo día que uno sin hora.
function fechaDia(fecha) {
  return String(fecha || '').slice(0, 10);
}

function compararNatural(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'es', { numeric: true });
}

// Número de un ticket de proceso 'P-001' → 1; cualquier otro valor va después.
function numeroTicketProceso(ticket) {
  const m = String(ticket || '').match(/^P-(\d+)$/);
  return m ? Number(m[1]) : Infinity;
}

function compararTicketsProceso(a, b) {
  const diferencia = numeroTicketProceso(a.ticket) - numeroTicketProceso(b.ticket);
  if (diferencia !== 0 && !Number.isNaN(diferencia)) return diferencia < 0 ? -1 : 1;
  return compararNatural(a.ticket, b.ticket);
}

// Ticket de Báscula: numérico ascendente; si no es numérico, comparación natural.
function compararTicketsRecepcion(a, b) {
  const na = Number(a.ticket);
  const nb = Number(b.ticket);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na < nb ? -1 : 1;
  return compararNatural(a.ticket, b.ticket);
}

// Procesos de un mismo día: el que es `ticketOrigen` de otro proceso del mismo día va primero; entre
// los independientes, número de ticket P-### ascendente. (Orden topológico, tomando siempre el de
// menor número entre los disponibles; si hubiera un ciclo, se toma el de menor número restante.)
function ordenarProcesosDelMismoDia(procesos) {
  if (procesos.length < 2) return procesos;
  const porNumero = procesos.slice().sort(compararTicketsProceso);
  const tickets = new Set(porNumero.map((p) => String(p.ticket)));
  const predecesores = new Map(porNumero.map((p) => {
    const origenes = new Set();
    (p.inputs || []).forEach((i) => {
      const origen = String(i.ticketOrigen || '');
      if (origen && origen !== String(p.ticket) && tickets.has(origen)) origenes.add(origen);
    });
    return [p, origenes];
  }));
  const colocados = new Set();
  const resultado = [];
  const pendientes = porNumero.slice();
  while (pendientes.length > 0) {
    let indice = pendientes.findIndex((p) => Array.from(predecesores.get(p)).every((t) => colocados.has(t)));
    if (indice === -1) indice = 0;
    const [elegido] = pendientes.splice(indice, 1);
    colocados.add(String(elegido.ticket));
    resultado.push(elegido);
  }
  return resultado;
}

function ordenarEventos(eventos) {
  // Primero por (fecha, rango) y desempate propio de cada tipo; el sort es estable, así que los
  // eventos que empatan en todo conservan el orden en que se construyeron.
  const ordenados = eventos.slice().sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
    if (a.rango !== b.rango) return a.rango - b.rango;
    if (a.tipo === 'recepcion') return compararTicketsRecepcion(a, b);
    if (a.tipo === 'venta') return compararNatural(a.folio, b.folio);
    return 0;
  });
  // Los procesos de un mismo día se reordenan por dependencia (ticketOrigen) y número de ticket.
  const resultado = [];
  let i = 0;
  while (i < ordenados.length) {
    if (ordenados[i].tipo !== 'proceso') {
      resultado.push(ordenados[i]);
      i += 1;
      continue;
    }
    let j = i;
    while (j < ordenados.length && ordenados[j].tipo === 'proceso' && ordenados[j].fecha === ordenados[i].fecha) j += 1;
    resultado.push(...ordenarProcesosDelMismoDia(ordenados.slice(i, j)));
    i = j;
  }
  return resultado;
}

function construirEventos(datos) {
  const eventos = [];
  (datos.inventarioInicial || []).forEach((r) => {
    eventos.push({
      tipo: 'inicial',
      rango: RANGO_EVENTO.inicial,
      fecha: fechaDia(r.fecha),
      material: window.normalizarMaterial(r.material),
      etapa: r.etapa,
      kg: Number(r.kg) || 0
    });
  });
  (datos.registrosDestaraje || []).forEach((r) => {
    eventos.push({ tipo: 'recepcion', rango: RANGO_EVENTO.recepcion, fecha: fechaDia(r.fechaSalida), material: window.normalizarMaterial(r.material), kg: Number(r.kg) || 0, ticket: r.ticket });
  });
  (datos.registrosControlProduccion || []).forEach((r) => {
    const etapaDestino = ETAPA_POR_PROCESO[r.tipoProceso] || null;
    eventos.push({
      tipo: 'proceso',
      rango: RANGO_EVENTO.proceso,
      fecha: fechaDia(window.fechaProceso(r)),
      ticket: r.ticket,
      tipoProceso: r.tipoProceso,
      inputs: (r.inputs || []).map((i) => {
        const material = window.normalizarMaterial(i.material);
        return {
          material,
          kg: Number(i.kg) || 0,
          ticketOrigen: i.ticketOrigen || '',
          tipoProceso: r.tipoProceso,
          requiereSeleccion: materialRequiereSeleccion(material)
        };
      }),
      outputs: (r.outputs || [])
        .filter((o) => !o.esMerma)
        .map((o) => ({ material: window.normalizarMaterial(o.material), kg: Number(o.kg) || 0, etapaDestino }))
    });
  });
  (datos.ventas || []).forEach((v) => {
    (v.lineas || []).forEach((l) => {
      eventos.push({
        tipo: 'venta',
        rango: RANGO_EVENTO.venta,
        fecha: fechaDia(v.fecha),
        material: window.normalizarMaterial(l.material),
        kg: Number(l.cantidad) || 0,
        folio: v.folio,
        ventaId: v.id,
        ticketsOrigen: v.ticketsOrigen
      });
    });
  });
  return ordenarEventos(eventos);
}

// onMovimiento es opcional: si se pasa, se invoca justo después de cada sumarCelda con el
// saldo de esa etapa ya actualizado, para reportar histórico de movimientos sin duplicar
// la lógica de cálculo. Los 2 call sites existentes no pasan segundo argumento.
//
// Consumo de un input de proceso: se REPARTE entre las etapas de etapasOrigen(tipoProceso, material), en
// ese orden. Lo que no alcance (faltanteOrigen) se descuenta de la primera etapa de la lista donde el material
// haya tenido saldo alguna vez (si nunca tuvo, de la primera) y deja esa celda negativa: error de captura.
// Las ventas toman de la etapa más avanzada con saldo (ORDEN_CONSUMO) y reparten si esa no alcanza.
// Devuelve { ledger, faltanteOrigen }; el ledger solo es lo que devuelve procesarEventos.
function procesarEventosConDetalle(eventos, onMovimiento) {
  const ledger = {};
  const faltanteOrigen = [];
  const tuvoSaldo = new Set();
  const emitir = (material, etapa, kg, evento, extra) => {
    if (onMovimiento) onMovimiento({ material, etapa, kg, saldoDespues: ledger[material][etapa], evento, ...extra });
  };
  const sumar = (material, etapa, kg, evento, extra) => {
    sumarCelda(ledger, material, etapa, kg);
    if (kg > 0) tuvoSaldo.add(`${material}|${etapa}`);
    emitir(material, etapa, kg, evento, extra);
  };
  // Descuenta `kg` de las etapas dadas en orden, solo de las que tienen saldo; devuelve lo que no alcanzó.
  const repartir = (material, etapas, kg, evento) => {
    let restante = kg;
    for (const etapa of etapas) {
      if (restante <= 1e-6) break;
      const saldo = (ledger[material] && ledger[material][etapa]) || 0;
      if (saldo <= 1e-6) continue;
      const toma = Math.min(saldo, restante);
      sumar(material, etapa, -toma, evento);
      restante -= toma;
    }
    return restante > 1e-6 ? restante : 0;
  };
  eventos.forEach((evento) => {
    if (evento.tipo === 'inicial') {
      sumar(evento.material, evento.etapa, evento.kg, evento);
    } else if (evento.tipo === 'recepcion') {
      sumar(evento.material, 'RECEPCIÓN', evento.kg, evento);
    } else if (evento.tipo === 'proceso') {
      evento.inputs.forEach((input) => {
        const origen = etapasOrigen(evento.tipoProceso, input.material);
        // Sin etapas de origen (Selección de un material que no se selecciona) el consumo sale de RECEPCIÓN y
        // solo se avisa que no requiere selección; con etapas, lo que falte se reporta como faltanteOrigen.
        const etapas = origen.length > 0 ? origen : ['RECEPCIÓN'];
        const falta = repartir(input.material, etapas, input.kg, evento);
        if (falta > 0) {
          const etapaFalta = etapas.find((etapa) => tuvoSaldo.has(`${input.material}|${etapa}`)) || etapas[0];
          sumar(input.material, etapaFalta, -falta, evento, { faltanteOrigen: falta });
          if (origen.length > 0) {
            faltanteOrigen.push({ ticket: evento.ticket, tipoProceso: evento.tipoProceso, material: input.material, kg: falta, etapa: etapaFalta, etapasOrigen: origen, evento });
          }
        }
      });
      (evento.outputs || []).forEach((output) => {
        if (output.etapaDestino && output.material) {
          sumar(output.material, output.etapaDestino, output.kg, evento);
        }
      });
    } else if (evento.tipo === 'venta') {
      const falta = repartir(evento.material, ORDEN_CONSUMO, evento.kg, evento);
      if (falta > 0) sumar(evento.material, 'RECEPCIÓN', -falta, evento);
      sumar(evento.material, 'VENDIDO', evento.kg, evento);
    }
  });
  return { ledger, faltanteOrigen };
}

function procesarEventos(eventos, onMovimiento) {
  return procesarEventosConDetalle(eventos, onMovimiento).ledger;
}

// Saldo disponible de un material considerando solo eventos con fecha <= al corte dado.
// Permite excluir el registro que se está creando/editando (ya que aún vive en window.EVE
// y contaría su propio consumo dos veces al recalcular).
function calcularSaldoDisponibleEnFecha(datos, material, fecha, exclusiones) {
  const materialNorm = window.normalizarMaterial(material);
  exclusiones = exclusiones || {};
  const datosFiltrados = {
    inventarioInicial: datos.inventarioInicial,
    registrosDestaraje: datos.registrosDestaraje,
    registrosControlProduccion: exclusiones.controlProduccionId
      ? (datos.registrosControlProduccion || []).filter((r) => r.id !== exclusiones.controlProduccionId)
      : datos.registrosControlProduccion,
    ventas: exclusiones.ventaId
      ? (datos.ventas || []).filter((v) => v.id !== exclusiones.ventaId)
      : datos.ventas
  };
  // El corte es por DÍA: se comparan solo los primeros 10 caracteres de la fecha de corte y de cada
  // evento, así un proceso con hora ('2026-09-14T10:00') entra en el corte del '2026-09-14'.
  const corte = fechaDia(fecha);
  const eventos = construirEventos(datosFiltrados).filter((e) => fechaDia(e.fecha) <= corte);
  const ledger = procesarEventos(eventos);
  const balances = ledger[materialNorm] || {};
  const saldo = ETAPAS_INVENTARIO
    .filter((etapa) => etapa !== 'VENDIDO')
    .reduce((suma, etapa) => suma + (balances[etapa] || 0), 0);
  return Math.round(saldo * 100) / 100;
}

// Saldo de cada material en cada etapa a una fecha de corte: { [material]: { [etapa]: saldo } } (K21b). Usa el mismo
// ledger que calcularSaldoDisponibleEnFecha (orden de K2, reparto por etapa de K18), el mismo corte por día y las
// mismas exclusiones (controlProduccionId: el registro que se edita; ventaId), así que la suma de las etapas de un
// material es SIEMPRE su saldo disponible. Por eso VENDIDO (acumulado de lo vendido, no existencia) no aparece.
// Redondea a 2 decimales y omite las celdas en cero; un saldo negativo (error de captura) se conserva.
function calcularSaldosPorEtapaEnFecha(datos, fecha, exclusiones) {
  exclusiones = exclusiones || {};
  const datosFiltrados = {
    inventarioInicial: datos.inventarioInicial,
    registrosDestaraje: datos.registrosDestaraje,
    registrosControlProduccion: exclusiones.controlProduccionId
      ? (datos.registrosControlProduccion || []).filter((r) => r.id !== exclusiones.controlProduccionId)
      : datos.registrosControlProduccion,
    ventas: exclusiones.ventaId
      ? (datos.ventas || []).filter((v) => v.id !== exclusiones.ventaId)
      : datos.ventas
  };
  const corte = fechaDia(fecha);
  const ledger = procesarEventos(construirEventos(datosFiltrados).filter((e) => fechaDia(e.fecha) <= corte));
  const saldos = {};
  Object.keys(ledger).forEach((material) => {
    ETAPAS_INVENTARIO.filter((etapa) => etapa !== 'VENDIDO').forEach((etapa) => {
      const cantidad = Math.round((ledger[material][etapa] || 0) * 100) / 100;
      if (cantidad === 0) return;
      if (!saldos[material]) saldos[material] = {};
      saldos[material][etapa] = cantidad;
    });
  });
  return saldos;
}

// Versión no bloqueante de la verificación de stock, pensada para importaciones
// masivas (donde no se puede usar window.confirm por fila). Usa el mismo criterio
// de fecha de corte que calcularSaldoDisponibleEnFecha (eventos con fecha <= fecha)
// y el mismo patrón de saldo restante por material que verificarStockSuficienteVenta/
// verificarStockSuficienteProceso, pero devuelve advertencias en vez de preguntar.
// lineas: [{ material, kg }]. No modifica datos ni bloquea nada.
function calcularAdvertenciasStock(datos, lineas, fecha, exclusiones) {
  const saldosRestantes = new Map();
  const advertencias = [];
  (lineas || []).forEach(({ material, kg }) => {
    if (!saldosRestantes.has(material)) {
      saldosRestantes.set(material, calcularSaldoDisponibleEnFecha(datos, material, fecha, exclusiones));
    }
    const saldoDisponible = saldosRestantes.get(material);
    if (saldoDisponible + 1e-6 < kg) {
      advertencias.push(`"${material}": stock insuficiente a la fecha (disponible ${saldoDisponible} kg, solicitado ${kg} kg)`);
    }
    saldosRestantes.set(material, saldoDisponible - kg);
  });
  return advertencias;
}

// Avisos (no bloquean) de la etapa de origen de un proceso que se va a guardar (registro: { tipoProceso,
// inputs, fecha, ticket? }). Dos tipos: 'este material no requiere selección' (input de SELECCION con
// requiereSeleccion=false) y 'sin saldo en las etapas de origen' (el consumo no alcanza entre las etapas de
// ORIGEN_POR_PROCESO a la fecha del proceso). exclusiones.controlProduccionId: el registro que se edita.
function calcularAvisosOrigen(datos, registro, exclusiones) {
  exclusiones = exclusiones || {};
  const avisos = [];
  const inputs = (registro.inputs || []).map((i) => ({ material: window.normalizarMaterial(i.material), kg: Number(i.kg) || 0 }));
  if (registro.tipoProceso === 'SELECCION') {
    inputs.filter((i) => i.material && !materialRequiereSeleccion(i.material)).forEach((i) => {
      avisos.push(`"${i.material}": este material no requiere selección`);
    });
  }
  const eventoObjetivo = construirEventos({ registrosControlProduccion: [registro] })[0];
  eventoObjetivo.objetivo = true;
  const otros = exclusiones.controlProduccionId
    ? (datos.registrosControlProduccion || []).filter((r) => r.id !== exclusiones.controlProduccionId)
    : datos.registrosControlProduccion;
  const corte = fechaDia(eventoObjetivo.fecha);
  const eventos = ordenarEventos([
    ...construirEventos({ ...datos, registrosControlProduccion: otros }),
    eventoObjetivo
  ]).filter((e) => fechaDia(e.fecha) <= corte);
  procesarEventosConDetalle(eventos).faltanteOrigen
    .filter((f) => f.evento.objetivo)
    .forEach((f) => {
      avisos.push(`"${f.material}": sin saldo en las etapas de origen de ${registro.tipoProceso} (${f.etapasOrigen.join(', ')}): faltan ${Math.round(f.kg * 100) / 100} kg`);
    });
  return avisos;
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

// Los documentos de ajuste pueden estar guardados con un nombre anterior a un alias ('P.P MOLIDO'): se compara el
// nombre normalizado en ambos lados.
function buscarDocInventario(registrosInventario, material, etapa) {
  const clave = window.normalizarMaterial(material);
  return (registrosInventario || []).find((r) => window.normalizarMaterial(r.material) === clave && r.etapa === etapa) || null;
}

function combinarConAjustes(filasCalculadas, registrosInventario) {
  const combinadas = filasCalculadas.map((fila) => {
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
  const cubiertas = new Set(combinadas.map((f) => `${f.material}||${f.etapa}`));
  const soloAjuste = (registrosInventario || [])
    .filter((doc) => !cubiertas.has(`${window.normalizarMaterial(doc.material)}||${doc.etapa}`) && (Number(doc.ajusteNeto) || 0) !== 0)
    .map((doc) => {
      const ajusteNeto = Number(doc.ajusteNeto) || 0;
      return {
        material: window.normalizarMaterial(doc.material),
        etapa: doc.etapa,
        cantidadCalculada: 0,
        cantidadReal: Math.round(ajusteNeto * 100) / 100,
        docId: doc.id,
        ajusteNeto,
        ajustes: doc.ajustes || []
      };
    });
  return combinadas.concat(soloAjuste);
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
    return { material, unidad: esMaterialPiezas(material) ? 'PZ' : 'KG', celdas, totalPlanta: Math.round(totalPlanta * 100) / 100 };
  });
}

function calcularMermaAcumulada(registrosControlProduccion) {
  const registros = registrosControlProduccion || [];
  const totalProcesado = registros.reduce((suma, r) =>
    suma + (r.inputs || []).reduce((s, i) => s + (Number(i.kg) || 0), 0), 0);
  const mermaPorMaterial = new Map();
  registros.forEach((r) => {
    (r.outputs || []).filter((o) => o.esMerma).forEach((o) => {
      const material = window.normalizarMaterial(o.material);
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
  let totalKg = 0;
  let totalPiezas = 0;
  filas.forEach((f) => {
    if (f.etapa === 'VENDIDO') return;
    if (esMaterialPiezas(f.material)) totalPiezas += f.cantidadReal;
    else totalKg += f.cantidadReal;
  });
  const r2 = (n) => Math.round(n * 100) / 100;
  return { totalKg: r2(totalKg), totalPiezas: r2(totalPiezas) };
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

// Materiales que se ofrecen en el ajuste manual: los activos más los ARCHIVADOS que todavía tienen saldo distinto de 0
// (para poder corregirlos). filas = filas combinadas del inventario ({ material, cantidadReal }).
function materialesParaAjuste(filas) {
  const conSaldo = new Set((filas || []).filter((f) => Math.abs(Number(f.cantidadReal) || 0) > 1e-9).map((f) => f.material));
  const archivadosConSaldo = Array.from(conSaldo).filter((m) => window.EVE_CATALOGO.estadoDe(m) === 'archivado');
  return Array.from(new Set([...window.materialesConStock(), ...archivadosConSaldo])).sort();
}

function construirRegistroInventarioInicial(datos, existentes) {
  const material = window.normalizarMaterial(datos.material);
  if (!material) throw new Error('Selecciona un material');
  if (!window.materialesConStockHistoricos().includes(material)) throw new Error(`Material '${material}' no está en el catálogo`);
  const etapa = (datos.etapa || '').toString().trim();
  if (!ETAPAS_INVENTARIO.includes(etapa) || etapa === 'VENDIDO') throw new Error('Selecciona una etapa válida');
  const kg = Number(datos.kg);
  if (!(kg > 0)) throw new Error('Kg debe ser mayor a 0');
  if (!datos.fecha) throw new Error('La fecha es obligatoria');
  const yaExiste = (existentes || []).some((r) => window.normalizarMaterial(r.material) === material && r.etapa === etapa);
  if (yaExiste) throw new Error('Ya existe un Inventario Inicial para este Material + Etapa');
  return {
    material,
    etapa,
    kg,
    fecha: datos.fecha,
    nota: (datos.nota || '').toString().trim(),
    creadoPor: datos.creadoPor
  };
}

// Recorre los mismos eventos ya calculados por construirEventos/procesarEventos (no
// duplica la lógica de sumarCelda) y devuelve solo los movimientos del material pedido,
// con el saldo de etapa resultante de cada uno, para la vista de Historial por Material.
function construirMovimientosPorMaterial(datos, material) {
  material = window.normalizarMaterial(material);
  const movimientos = [];
  const eventos = construirEventos(datos);
  procesarEventos(eventos, (mov) => {
    if (mov.material !== material) return;
    movimientos.push(mov);
  });
  return movimientos;
}

// ── Inventario por rango Desde/Hasta ──────────────────────────────────────

const TOLERANCIA_CUADRE_RANGO = 0.05;

function redondear2(valor) {
  return Math.round(valor * 100) / 100;
}

function diaAnteriorISO(fechaISO) {
  const [anio, mes, dia] = fechaDia(fechaISO).split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia - 1)).toISOString().slice(0, 10);
}

// Saldo inicial / entradas / salidas / ajustes / saldo final por material y etapa entre dos fechas (ambas inclusive).
// - Saldo inicial = saldo al cierre del día anterior a `desde`; saldo final = saldo al cierre de `hasta`. Los dos salen
//   de la misma línea de tiempo (construirEventos + ledger) cortada a cada fecha, vía calcularSaldosPorEtapaEnFecha,
//   cuya suma por material es calcularSaldoDisponibleEnFecha. Un inventario inicial anterior a `desde` queda en el saldo
//   inicial; uno dentro del rango cuenta como entrada.
// - Entradas por etapa = movimientos positivos del ledger dentro del rango; salidas = movimientos negativos (VENDIDO no
//   es existencia y se omite, igual que en el saldo disponible).
// - Entradas/salidas por material se suman directo de los eventos (recepciones, inventario inicial y outputs no merma
//   de procesos; inputs de procesos y ventas), sin pasar por el ledger: así la identidad
//   saldo inicial + entradas − salidas + ajustes = saldo final es una verificación real y no una tautología, y un
//   renglón que no cuadre (p. ej. un output sin etapa destino que no llegó al ledger) se marca con cuadra = false.
// - Ajustes: las líneas de registrosInventario[].ajustes por su propia fecha (antes de `desde` ya están en el saldo
//   inicial; dentro del rango se muestran en Ajustes; todos están en el saldo final).
function calcularInventarioPorRango(datos, registrosInventario, desde, hasta) {
  const desdeDia = fechaDia(desde);
  const hastaDia = fechaDia(hasta);
  const previo = diaAnteriorISO(desdeDia);
  const etapasExistencia = ETAPAS_INVENTARIO.filter((etapa) => etapa !== 'VENDIDO');

  const materiales = new Map();
  const obtenerMaterial = (material) => {
    if (!materiales.has(material)) materiales.set(material, { etapas: {}, entradas: 0, salidas: 0 });
    return materiales.get(material);
  };
  const obtenerEtapa = (material, etapa) => {
    const registro = obtenerMaterial(material);
    if (!registro.etapas[etapa]) registro.etapas[etapa] = { saldoInicial: 0, entradas: 0, salidas: 0, ajustes: 0, saldoFinal: 0 };
    return registro.etapas[etapa];
  };

  const saldosIniciales = calcularSaldosPorEtapaEnFecha(datos, previo);
  const saldosFinales = calcularSaldosPorEtapaEnFecha(datos, hastaDia);
  Object.keys(saldosIniciales).forEach((material) => {
    Object.keys(saldosIniciales[material]).forEach((etapa) => { obtenerEtapa(material, etapa).saldoInicial = saldosIniciales[material][etapa]; });
  });
  Object.keys(saldosFinales).forEach((material) => {
    Object.keys(saldosFinales[material]).forEach((etapa) => { obtenerEtapa(material, etapa).saldoFinal = saldosFinales[material][etapa]; });
  });

  const eventos = construirEventos(datos).filter((e) => fechaDia(e.fecha) <= hastaDia);
  procesarEventos(eventos, (mov) => {
    const dia = fechaDia(mov.evento.fecha);
    if (dia < desdeDia || mov.etapa === 'VENDIDO') return;
    const celda = obtenerEtapa(mov.material, mov.etapa);
    if (mov.kg > 0) celda.entradas += mov.kg;
    else celda.salidas -= mov.kg;
  });

  eventos.filter((e) => fechaDia(e.fecha) >= desdeDia).forEach((e) => {
    if (e.tipo === 'inicial' || e.tipo === 'recepcion') {
      obtenerMaterial(e.material).entradas += e.kg;
    } else if (e.tipo === 'venta') {
      obtenerMaterial(e.material).salidas += e.kg;
    } else if (e.tipo === 'proceso') {
      e.inputs.forEach((i) => { obtenerMaterial(i.material).salidas += i.kg; });
      e.outputs.forEach((o) => { if (o.material) obtenerMaterial(o.material).entradas += o.kg; });
    }
  });

  (registrosInventario || []).forEach((doc) => {
    if (doc.etapa === 'VENDIDO') return;
    const material = window.normalizarMaterial(doc.material);
    (doc.ajustes || []).forEach((ajuste) => {
      const dia = fechaDia(ajuste.fecha);
      if (dia > hastaDia) return;
      const diferencia = Number(ajuste.diferencia) || 0;
      const celda = obtenerEtapa(material, doc.etapa);
      celda.saldoFinal += diferencia;
      if (dia <= previo) celda.saldoInicial += diferencia;
      else celda.ajustes += diferencia;
    });
  });

  const filas = [];
  Array.from(materiales.keys()).sort().forEach((material) => {
    const registro = materiales.get(material);
    const etapas = etapasExistencia
      .filter((etapa) => registro.etapas[etapa])
      .map((etapa) => {
        const c = registro.etapas[etapa];
        return {
          etapa,
          saldoInicial: redondear2(c.saldoInicial),
          entradas: redondear2(c.entradas),
          salidas: redondear2(c.salidas),
          ajustes: redondear2(c.ajustes),
          saldoFinal: redondear2(c.saldoFinal)
        };
      })
      .filter((e) => [e.saldoInicial, e.entradas, e.salidas, e.ajustes, e.saldoFinal].some((v) => v !== 0));
    const suma = (campo) => redondear2(etapas.reduce((total, e) => total + e[campo], 0));
    const fila = {
      material,
      unidad: esMaterialPiezas(material) ? 'PZ' : 'KG',
      saldoInicial: suma('saldoInicial'),
      entradas: redondear2(registro.entradas),
      salidas: redondear2(registro.salidas),
      ajustes: suma('ajustes'),
      saldoFinal: suma('saldoFinal'),
      etapas
    };
    if (etapas.length === 0 && fila.entradas === 0 && fila.salidas === 0) return;
    fila.diferencia = redondear2(fila.saldoInicial + fila.entradas - fila.salidas + fila.ajustes - fila.saldoFinal);
    fila.cuadra = Math.abs(fila.diferencia) <= TOLERANCIA_CUADRE_RANGO;
    filas.push(fila);
  });

  return { desde: desdeDia, hasta: hastaDia, filas, descuadres: filas.filter((f) => !f.cuadra) };
}

// Valida el rango de la vista: devuelve { activo, error }. Solo está activo con las dos fechas válidas y Desde <= Hasta.
function validarRangoInventario(desde, hasta) {
  if (!desde && !hasta) return { activo: false, error: '' };
  if (!desde || !hasta) return { activo: false, error: 'Completa Desde y Hasta para ver el inventario por rango.' };
  if (desde > hasta) return { activo: false, error: 'Desde no puede ser posterior a Hasta.' };
  return { activo: true, error: '' };
}

function construirFilasCSVInventarioRango(resultado) {
  const filas = [];
  resultado.filas.forEach((f) => {
    filas.push({
      'Material': f.material, 'Etapa': 'TOTAL', 'Unidad': f.unidad,
      'Saldo Inicial': f.saldoInicial, 'Entradas': f.entradas, 'Salidas': f.salidas, 'Ajustes': f.ajustes, 'Saldo Final': f.saldoFinal,
      'Cuadra': f.cuadra ? 'SI' : `NO (dif ${f.diferencia})`
    });
    f.etapas.forEach((e) => {
      filas.push({
        'Material': f.material, 'Etapa': e.etapa, 'Unidad': f.unidad,
        'Saldo Inicial': e.saldoInicial, 'Entradas': e.entradas, 'Salidas': e.salidas, 'Ajustes': e.ajustes, 'Saldo Final': e.saldoFinal,
        'Cuadra': ''
      });
    });
  });
  return filas;
}

window.EVE_INVENTARIO = {
  ETAPAS_INVENTARIO,
  calcularInventarioPorRango,
  validarRangoInventario,
  construirFilasCSVInventarioRango,
  ETAPA_POR_PROCESO,
  ORIGEN_POR_PROCESO,
  etapasOrigen,
  construirEventos,
  procesarEventos,
  construirMovimientosPorMaterial,
  calcularSaldoDisponibleEnFecha,
  calcularSaldosPorEtapaEnFecha,
  fechaDia,
  compararTicketsProceso,
  compararTicketsRecepcion,
  calcularAdvertenciasStock,
  calcularAvisosOrigen,
  calcularInventarioCalculado,
  buscarDocInventario,
  combinarConAjustes,
  construirMatrizInventario,
  calcularMermaAcumulada,
  esMaterialPiezas,
  resumenInventario,
  construirAjuste,
  construirRegistroInventarioInicial,
  materialesParaAjuste,
  abrirHistorialMaterial,
  construirFilasMovimientosHistorial
};

// ── Estado del módulo ────────────────────────────────────────────────────

let vistaActiva = 'tabla';
let materialAjusteSeleccionado = '';
let etapaAjusteSeleccionada = '';
let materialHistorialSeleccionado = '';
let filasActuales = [];
let rangoInventario = { desde: '', hasta: '' };
let materialesRangoExpandidos = new Set();

function puedeAjustarInventario() {
  return window.puedeEscribir('inventario');
}

function obtenerDatosInventario() {
  return {
    inventarioInicial: window.EVE.inventarioInicial,
    registrosDestaraje: window.EVE.registrosDestaraje,
    registrosControlProduccion: window.EVE.registrosControlProduccion,
    ventas: window.EVE.ventas
  };
}

function obtenerFilasCombinadas() {
  const calculado = calcularInventarioCalculado(obtenerDatosInventario());
  return combinarConAjustes(calculado, window.EVE.inventario);
}

function entradasInventarioInicial(material, etapa) {
  const clave = window.normalizarMaterial(material);
  return (window.EVE.inventarioInicial || [])
    .filter((r) => window.normalizarMaterial(r.material) === clave && r.etapa === etapa)
    .map((r) => ({
      fecha: r.fecha,
      cantidadAntes: 0,
      cantidadDespues: r.kg,
      diferencia: r.kg,
      motivo: `Inventario Inicial${r.nota ? ` — ${r.nota}` : ''}`,
      ajustadoPor: r.creadoPor
    }));
}

// ── Modal de ajuste manual ────────────────────────────────────────────────

function llenarSelectoresAjuste() {
  const selectMaterial = document.getElementById('ia-material');
  const materiales = materialesParaAjuste(obtenerFilasCombinadas());
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

// ── Modal de inventario inicial ────────────────────────────────────────────

async function manejarEnvioInventarioInicial(evento) {
  evento.preventDefault();
  const usuario = (window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
  const datos = {
    material: document.getElementById('ii-material').value,
    etapa: document.getElementById('ii-etapa').value,
    kg: document.getElementById('ii-kg').value,
    fecha: document.getElementById('ii-fecha').value,
    nota: document.getElementById('ii-nota').value,
    creadoPor: usuario
  };
  try {
    const registro = construirRegistroInventarioInicial(datos, window.EVE.inventarioInicial);
    const registroCompleto = { ...registro, fechaRegistro: new Date().toISOString() };
    const id = await window.guardarDato('inventario_inicial', registroCompleto);
    window.EVE.inventarioInicial.push({ id, ...registroCompleto });
    cerrarModalInventarioInicial();
    renderizarVistaActiva();
    window.showSuccess('Inventario inicial registrado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearModalInventarioInicial() {
  const overlay = document.createElement('div');
  overlay.id = 'inventario-inicial-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>📦 Agregar Inventario Inicial</h3>
      <form id="inventario-inicial-form">
        <label class="admin-config-campo">Material <input type="text" id="ii-material" list="ii-materiales-datalist" style="text-transform:uppercase" required></label>
        <datalist id="ii-materiales-datalist"></datalist>
        <label class="admin-config-campo">Etapa <select id="ii-etapa" required></select></label>
        <label class="admin-config-campo">Kg <input type="number" id="ii-kg" step="0.01" required></label>
        <label class="admin-config-campo">Fecha <input type="date" id="ii-fecha" required></label>
        <textarea id="ii-nota" placeholder="Nota (opcional)" rows="2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
        <p class="chip chip-warn">⚠️ Usa esto solo para cargar el stock físico existente al momento del corte inicial. Para corregir inventario ya en operación, usa "Ajustar".</p>
        <button type="submit" class="btn-primary">Agregar</button>
        <button type="button" id="ii-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#inventario-inicial-form').addEventListener('submit', manejarEnvioInventarioInicial);
  overlay.querySelector('#ii-cancelar').addEventListener('click', () => cerrarModalInventarioInicial());
  return overlay;
}

function abrirModalInventarioInicial() {
  document.getElementById('inventario-inicial-form').reset();
  const selectEtapa = document.getElementById('ii-etapa');
  selectEtapa.innerHTML = '<option value="">Selecciona una etapa…</option>';
  ETAPAS_INVENTARIO.filter((e) => e !== 'VENDIDO').forEach((e) => {
    const opcion = document.createElement('option');
    opcion.value = e;
    opcion.textContent = e;
    selectEtapa.appendChild(opcion);
  });
  const datalist = document.getElementById('ii-materiales-datalist');
  datalist.innerHTML = '';
  window.materialesConStock().slice().sort().forEach((m) => {
    const opcion = document.createElement('option');
    opcion.value = m;
    datalist.appendChild(opcion);
  });
  document.getElementById('ii-fecha').value = window.EVE_CXP.fechaCorteVigente();
  document.getElementById('inventario-inicial-overlay').classList.add('open');
}

function cerrarModalInventarioInicial() {
  document.getElementById('inventario-inicial-overlay').classList.remove('open');
}

// ── Vista: tabla principal ────────────────────────────────────────────────

function construirFilasCSVInventario(filas) {
  return filas.map((f) => ({
    'Material': f.material,
    'Etapa': f.etapa,
    'Unidad': esMaterialPiezas(f.material) ? 'PZ' : 'KG',
    'Cantidad Calculada': f.cantidadCalculada,
    'Ajuste Neto': f.ajusteNeto,
    'Cantidad Real': f.cantidadReal
  }));
}

function calcularInventarioRangoActual() {
  return calcularInventarioPorRango(obtenerDatosInventario(), window.EVE.inventario, rangoInventario.desde, rangoInventario.hasta);
}

function exportarInventarioCSV() {
  const rango = validarRangoInventario(rangoInventario.desde, rangoInventario.hasta);
  if (rango.error) {
    window.showError(rango.error);
    return;
  }
  if (rango.activo) {
    const filas = construirFilasCSVInventarioRango(calcularInventarioRangoActual());
    window.exportarCSV(filas, `inventario_${rangoInventario.desde}_a_${rangoInventario.hasta}.csv`);
    return;
  }
  const filas = construirFilasCSVInventario(filasActuales);
  window.exportarCSV(filas, `inventario_snapshot_${window.obtenerFechaMexico()}.csv`);
}

function crearBarraAcciones() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const btnActualizar = document.createElement('button');
  btnActualizar.textContent = '🔄 Actualizar';
  btnActualizar.className = 'btn-secondary';
  btnActualizar.addEventListener('click', () => renderizarVistaActiva());
  div.appendChild(btnActualizar);
  const btnExportarCSV = document.createElement('button');
  btnExportarCSV.textContent = 'Exportar CSV';
  btnExportarCSV.className = 'btn-secondary';
  btnExportarCSV.addEventListener('click', () => exportarInventarioCSV());
  div.appendChild(btnExportarCSV);
  if (puedeAjustarInventario()) {
    const btnAjustar = document.createElement('button');
    btnAjustar.textContent = '⚙️ Ajustar';
    btnAjustar.className = 'btn-primary';
    btnAjustar.addEventListener('click', () => abrirModalAjuste());
    div.appendChild(btnAjustar);

    const btnInicial = document.createElement('button');
    btnInicial.textContent = '📦 Agregar Inventario Inicial';
    btnInicial.className = 'btn-secondary';
    btnInicial.addEventListener('click', () => abrirModalInventarioInicial());
    div.appendChild(btnInicial);
  }
  return div;
}

function aplicarRangoInventario() {
  const desde = document.getElementById('inv-rango-desde').value;
  const hasta = document.getElementById('inv-rango-hasta').value;
  rangoInventario = { desde, hasta };
  materialesRangoExpandidos = new Set();
  llenarVistaTabla();
}

function limpiarRangoInventario() {
  document.getElementById('inv-rango-desde').value = '';
  document.getElementById('inv-rango-hasta').value = '';
  aplicarRangoInventario();
}

// Fechas con <input type="date">: se ven dd/mm/aaaa (es-MX) y su value es YYYY-MM-DD, igual que en los demás filtros.
function crearBarraRangoInventario() {
  const card = document.createElement('div');
  card.className = 'card destaraje-filtros';

  [['Desde', 'inv-rango-desde', rangoInventario.desde], ['Hasta', 'inv-rango-hasta', rangoInventario.hasta]].forEach(([texto, id, valor]) => {
    const campo = document.createElement('label');
    campo.className = 'filtro-campo';
    campo.innerHTML = `<span>${texto}</span>`;
    const input = document.createElement('input');
    input.type = 'date';
    input.id = id;
    input.value = valor;
    input.addEventListener('change', aplicarRangoInventario);
    campo.appendChild(input);
    card.appendChild(campo);
  });

  const btnLimpiar = document.createElement('button');
  btnLimpiar.type = 'button';
  btnLimpiar.className = 'btn-secondary';
  btnLimpiar.textContent = 'Limpiar';
  btnLimpiar.addEventListener('click', limpiarRangoInventario);
  card.appendChild(btnLimpiar);

  const mensaje = document.createElement('span');
  mensaje.id = 'inv-rango-mensaje';
  mensaje.style.alignSelf = 'center';
  card.appendChild(mensaje);
  return card;
}

function crearVistaTabla() {
  const wrapper = document.createElement('div');
  wrapper.id = 'inventario-tabla-wrapper';

  wrapper.appendChild(crearBarraRangoInventario());

  const cabecera = document.createElement('p');
  cabecera.id = 'inventario-ultima-actualizacion';
  wrapper.appendChild(cabecera);

  const rangoContenedor = document.createElement('div');
  rangoContenedor.id = 'inventario-rango-contenedor';
  rangoContenedor.style.display = 'none';
  wrapper.appendChild(rangoContenedor);

  const tablaWrapper = document.createElement('div');
  tablaWrapper.id = 'inventario-tabla-card';
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

function llenarVistaRango(contenedor) {
  contenedor.innerHTML = '';
  const resultado = calcularInventarioRangoActual();

  const titulo = document.createElement('h4');
  titulo.textContent = `Del ${window.formatearFecha(resultado.desde)} al ${window.formatearFecha(resultado.hasta)}`;
  contenedor.appendChild(titulo);

  if (resultado.descuadres.length > 0) {
    const aviso = document.createElement('p');
    aviso.className = 'chip chip-error';
    aviso.textContent = `⚠️ No cuadra (saldo inicial + entradas − salidas + ajustes ≠ saldo final): ${resultado.descuadres
      .map((f) => `${f.material} (dif ${f.diferencia.toLocaleString('es-MX')})`).join(', ')}`;
    contenedor.appendChild(aviso);
    console.warn('Inventario por rango: renglones que no cuadran', resultado.descuadres);
  }

  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'card destaraje-tabla-wrapper';
  tablaWrapper.innerHTML = `
    <table class="tabla-destaraje">
      <thead><tr><th>Material</th><th>Saldo inicial</th><th>Entradas</th><th>Salidas</th><th>Ajustes</th><th>Saldo final</th><th>Cuadra</th></tr></thead>
      <tbody></tbody>
    </table>
  `;
  const tbody = tablaWrapper.querySelector('tbody');

  const agregarFila = (etiqueta, valores, material, opciones) => {
    const fila = document.createElement('tr');
    const celdaEtiqueta = document.createElement('td');
    celdaEtiqueta.textContent = etiqueta;
    if (opciones.sangria) celdaEtiqueta.style.paddingLeft = '2rem';
    fila.appendChild(celdaEtiqueta);
    valores.forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = window.formatearKg(valor, material);
      if (opciones.negrita) celda.style.fontWeight = '600';
      fila.appendChild(celda);
    });
    const celdaCuadra = document.createElement('td');
    celdaCuadra.textContent = opciones.cuadra;
    if (opciones.descuadre) celdaCuadra.classList.add('inv-estado-rojo');
    fila.appendChild(celdaCuadra);
    if (opciones.descuadre) fila.classList.add('inv-estado-rojo');
    tbody.appendChild(fila);
    return fila;
  };

  if (resultado.filas.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = 7;
    celda.textContent = 'Sin movimientos ni saldos en este rango';
    fila.appendChild(celda);
    tbody.appendChild(fila);
  }

  resultado.filas.forEach((f) => {
    const expandido = materialesRangoExpandidos.has(f.material);
    const fila = agregarFila(
      `${f.etapas.length > 0 ? (expandido ? '▾ ' : '▸ ') : ''}${f.material}`,
      [f.saldoInicial, f.entradas, f.salidas, f.ajustes, f.saldoFinal],
      f.material,
      { negrita: true, cuadra: f.cuadra ? '✓' : `✗ dif ${f.diferencia.toLocaleString('es-MX')}`, descuadre: !f.cuadra }
    );
    if (f.etapas.length === 0) return;
    fila.classList.add('inv-celda-clic');
    fila.addEventListener('click', () => {
      if (materialesRangoExpandidos.has(f.material)) materialesRangoExpandidos.delete(f.material);
      else materialesRangoExpandidos.add(f.material);
      llenarVistaRango(contenedor);
    });
    if (!expandido) return;
    f.etapas.forEach((e) => {
      agregarFila(e.etapa, [e.saldoInicial, e.entradas, e.salidas, e.ajustes, e.saldoFinal], f.material, { sangria: true, cuadra: '' });
    });
  });
  contenedor.appendChild(tablaWrapper);

  const nota = document.createElement('p');
  nota.textContent = 'Entradas: recepciones, producción (sin merma) e inventario inicial dentro del rango. Salidas: consumos de producción y ventas. '
    + 'El detalle por etapa también incluye los traspasos entre etapas.';
  contenedor.appendChild(nota);
}

function llenarVistaTabla() {
  const cabecera = document.getElementById('inventario-ultima-actualizacion');
  const ahora = new Date();
  cabecera.textContent = `Última actualización: ${window.formatearFecha(window.obtenerFechaMexico())} ${ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;

  filasActuales = obtenerFilasCombinadas();

  // Con rango válido se reemplaza la matriz por el cuadro Saldo inicial/Entradas/Salidas/Ajustes/Saldo final; sin rango
  // (o con rango incompleto/inválido) la vista de siempre queda intacta.
  const rango = validarRangoInventario(rangoInventario.desde, rangoInventario.hasta);
  const mensajeRango = document.getElementById('inv-rango-mensaje');
  mensajeRango.textContent = rango.error;
  mensajeRango.className = rango.error ? 'chip chip-warn' : '';
  ['inventario-tabla-card', 'inventario-resumen', 'inventario-merma'].forEach((id) => {
    document.getElementById(id).style.display = rango.activo ? 'none' : '';
  });
  const contenedorRango = document.getElementById('inventario-rango-contenedor');
  contenedorRango.style.display = rango.activo ? '' : 'none';
  if (rango.activo) {
    llenarVistaRango(contenedorRango);
    return;
  }

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
          celda.textContent = window.formatearKg(datoCelda.cantidadReal, datoCelda.material);
          if (datoCelda.cantidadReal < 0) {
            celda.title = '⚠️ Error de captura';
            celda.classList.add('inv-estado-rojo');
          }
          if (etapa === 'VENDIDO') celda.classList.add('inv-celda-vendido');
          if (puedeAjustar) {
            celda.classList.add('inv-celda-clic');
            celda.addEventListener('click', () => abrirModalAjuste(datoCelda.material, datoCelda.etapa));
          }
        }
        fila.appendChild(celda);
      });

      const celdaTotal = document.createElement('td');
      celdaTotal.textContent = window.formatearKg(filaMaterial.totalPlanta, filaMaterial.material);
      celdaTotal.style.fontWeight = '600';
      fila.appendChild(celdaTotal);

      tbody.appendChild(fila);
    });
  }

  const resumen = resumenInventario(filasActuales);
  const contenedorResumen = document.getElementById('inventario-resumen');
  contenedorResumen.innerHTML = '<h4>RESUMEN</h4>';
  [
    `Total en planta: ${resumen.totalKg.toLocaleString('es-MX')} KG · ${resumen.totalPiezas.toLocaleString('es-MX')} PZ`
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
        <thead><tr><th data-tipo="texto">Material</th><th data-tipo="numero">Kg Merma</th><th data-tipo="numero">% del total procesado</th></tr></thead>
        <tbody id="inv-merma-tabla"></tbody>
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
    window.activarOrdenamiento(tablaWrapper.querySelector('table'));
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
  const filas = obtenerFilasCombinadas();
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

  const selectEtapa = document.getElementById('iah-etapa');
  selectEtapa.innerHTML = '<option value="">Selecciona una etapa…</option>';
  ETAPAS_INVENTARIO.forEach((e) => {
    const opcion = document.createElement('option');
    opcion.value = e;
    opcion.textContent = e;
    selectEtapa.appendChild(opcion);
  });
  if (ETAPAS_INVENTARIO.includes(etapaAjusteSeleccionada)) selectEtapa.value = etapaAjusteSeleccionada;
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
  const ajustes = (fila ? fila.ajustes : [])
    .concat(entradasInventarioInicial(materialAjusteSeleccionado, etapaAjusteSeleccionada))
    .slice()
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  if (ajustes.length === 0) {
    const mensaje = document.createElement('p');
    mensaje.textContent = 'Sin ajustes registrados para esta combinación';
    wrapper.appendChild(mensaje);
    return;
  }
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead><tr><th data-tipo="fecha">Fecha</th><th data-tipo="numero">Antes</th><th data-tipo="numero">Después</th><th data-tipo="numero">Diferencia</th><th>Motivo</th><th data-tipo="texto">Usuario</th></tr></thead>
    <tbody id="inv-ajustes-tabla"></tbody>
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
  window.activarOrdenamiento(tabla);
  wrapper.appendChild(tabla);
}

// ── Historial de Movimientos por Material (vista de solo lectura) ──────────

function ajustesPorMaterial(registrosInventario, material) {
  const resultado = [];
  const clave = window.normalizarMaterial(material);
  (registrosInventario || []).filter((r) => window.normalizarMaterial(r.material) === clave).forEach((r) => {
    (r.ajustes || []).forEach((a) => {
      resultado.push(Object.assign({ etapa: r.etapa }, a));
    });
  });
  return resultado;
}

function etiquetaTipoMovimiento(evento) {
  if (evento.tipo === 'recepcion') return 'Recepción';
  if (evento.tipo === 'proceso') return `Proceso: ${(window.NOMBRE_PROCESO_UI && window.NOMBRE_PROCESO_UI[evento.tipoProceso]) || evento.tipoProceso}`;
  if (evento.tipo === 'venta') return 'Venta';
  if (evento.tipo === 'inicial') return 'Inventario Inicial';
  return evento.tipo;
}

function referenciaMovimiento(evento) {
  if (evento.tipo === 'recepcion' || evento.tipo === 'proceso') return evento.ticket;
  if (evento.tipo === 'venta') return evento.folio || (evento.ticketsOrigen || []).join(', ');
  return '—';
}

// Reabre el mismo árbol de Trazabilidad ya usado por Control Producción/Destaraje;
// no se reimplementa ninguna lógica de reconstrucción de cadena.
function abrirDetalleMovimiento(evento) {
  const origen = { material: materialHistorialSeleccionado };
  window.activarTab('controlProduccion');
  if (evento.tipo === 'venta') {
    window.EVE_CONTROL_PRODUCCION.abrirTrazabilidad('folio', evento.folio, origen);
  } else {
    window.EVE_CONTROL_PRODUCCION.abrirTrazabilidad('ticket', evento.ticket, origen);
  }
}

// Punto de regreso desde el botón "← Regresar" de Trazabilidad (ver
// regresarAHistorialMaterial en trazabilidad.js). Reconstruye la vista con el
// mismo material que estaba seleccionado antes de salir, sin que el usuario
// tenga que volver a elegirlo.
function abrirHistorialMaterial(material) {
  window.activarTab('inventario');
  vistaActiva = 'historialMaterial';
  document.querySelectorAll('#inventario-subtabs .tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === 'historialMaterial');
  });
  materialHistorialSeleccionado = material || '';
  renderizarVistaActiva();
}

function abrirDetalleAjuste(ajuste) {
  document.getElementById('ida-fecha').textContent = window.formatearFecha(ajuste.fecha);
  document.getElementById('ida-etapa').textContent = ajuste.etapa;
  document.getElementById('ida-antes').textContent = `${ajuste.cantidadAntes} Kg`;
  document.getElementById('ida-despues').textContent = `${ajuste.cantidadDespues} Kg`;
  document.getElementById('ida-motivo').textContent = ajuste.motivo;
  document.getElementById('ida-usuario').textContent = ajuste.ajustadoPor;
  document.getElementById('inventario-detalle-ajuste-overlay').classList.add('open');
}

function crearModalDetalleAjusteHistorial() {
  const overlay = document.createElement('div');
  overlay.id = 'inventario-detalle-ajuste-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>📋 Detalle de Ajuste Manual</h3>
      <p><strong>Fecha:</strong> <span id="ida-fecha"></span></p>
      <p><strong>Etapa:</strong> <span id="ida-etapa"></span></p>
      <p><strong>Cantidad antes:</strong> <span id="ida-antes"></span></p>
      <p><strong>Cantidad después:</strong> <span id="ida-despues"></span></p>
      <p><strong>Motivo:</strong> <span id="ida-motivo"></span></p>
      <p><strong>Usuario:</strong> <span id="ida-usuario"></span></p>
      <button type="button" id="ida-cerrar" class="btn-secondary">Cerrar</button>
    </div>
  `;
  overlay.querySelector('#ida-cerrar').addEventListener('click', () => {
    overlay.classList.remove('open');
  });
  return overlay;
}

function crearVistaHistorialMaterial() {
  const wrapper = document.createElement('div');
  wrapper.id = 'inventario-historial-material-wrapper';
  wrapper.style.display = 'none';

  const selectorCard = document.createElement('div');
  selectorCard.className = 'card';
  selectorCard.innerHTML = `
    <div class="form-grid">
      <label class="admin-config-campo">Material <select id="ihm-material"></select></label>
    </div>
  `;
  wrapper.appendChild(selectorCard);

  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'card destaraje-tabla-wrapper';
  tablaWrapper.id = 'inventario-historial-material-tabla-wrapper';
  wrapper.appendChild(tablaWrapper);

  selectorCard.querySelector('#ihm-material').addEventListener('change', () => {
    materialHistorialSeleccionado = document.getElementById('ihm-material').value;
    llenarVistaHistorialMaterial();
  });

  return wrapper;
}

function llenarSelectorHistorialMaterial() {
  const selectMaterial = document.getElementById('ihm-material');
  selectMaterial.innerHTML = '<option value="">Selecciona un material…</option>';
  window.materialesConStockHistoricos().slice().sort().forEach((m) => {
    const opcion = document.createElement('option');
    opcion.value = m;
    opcion.textContent = m;
    selectMaterial.appendChild(opcion);
  });
  if (materialHistorialSeleccionado) selectMaterial.value = materialHistorialSeleccionado;
}

// Filas de movimientos del historial por material. Cruzando por ticket el consumo de cada molido en PELETIZADO se
// reconstruye la mezcla de cada lote (secreto industrial), así que sin window.puedeVerFormulasPeletizado() (K24b) las
// salidas de un material por PELETIZADO se muestran AGREGADAS POR DÍA (y etapa, porque el saldo es por etapa): un renglón
// con el total de kg y el saldo al cierre del día, sin ticket ni enlace. Solo cambia la vista: saldos y ledger son los mismos.
function construirFilasMovimientosHistorial(datos, material) {
  const verFormulas = typeof window.puedeVerFormulasPeletizado === 'function' && window.puedeVerFormulasPeletizado();
  const esConsumoPeletizado = (mov) => mov.evento.tipo === 'proceso' && mov.evento.tipoProceso === 'PELETIZADO' && mov.kg < 0;
  const filas = [];
  const agregados = new Map();
  construirMovimientosPorMaterial(datos, material).forEach((mov) => {
    if (!verFormulas && esConsumoPeletizado(mov)) {
      const clave = `${fechaDia(mov.evento.fecha)}|${mov.etapa}`;
      const fila = agregados.get(clave);
      if (fila) {
        fila.kg += mov.kg;
        fila.saldoDespues = mov.saldoDespues;
      } else {
        const nueva = {
          fecha: mov.evento.fecha,
          tipo: etiquetaTipoMovimiento(mov.evento),
          etapa: mov.etapa,
          kg: mov.kg,
          saldoDespues: mov.saldoDespues,
          referencia: '—',
          clic: null
        };
        agregados.set(clave, nueva);
        filas.push(nueva);
      }
      return;
    }
    filas.push({
      fecha: mov.evento.fecha,
      tipo: etiquetaTipoMovimiento(mov.evento),
      etapa: mov.etapa,
      kg: mov.kg,
      saldoDespues: mov.saldoDespues,
      referencia: referenciaMovimiento(mov.evento),
      clic: mov.evento.tipo !== 'inicial' ? () => abrirDetalleMovimiento(mov.evento) : null
    });
  });
  return filas;
}

function llenarVistaHistorialMaterial() {
  const wrapper = document.getElementById('inventario-historial-material-tabla-wrapper');
  wrapper.innerHTML = '';
  if (!materialHistorialSeleccionado) {
    const mensaje = document.createElement('p');
    mensaje.textContent = 'Selecciona un material para ver su historial de movimientos';
    wrapper.appendChild(mensaje);
    return;
  }
  const datos = {
    inventarioInicial: window.EVE.inventarioInicial,
    registrosDestaraje: window.EVE.registrosDestaraje,
    registrosControlProduccion: window.EVE.registrosControlProduccion,
    ventas: window.EVE.ventas
  };
  const movimientos = construirFilasMovimientosHistorial(datos, materialHistorialSeleccionado);
  const ajustes = ajustesPorMaterial(window.EVE.inventario, materialHistorialSeleccionado).map((a) => ({
    fecha: a.fecha,
    tipo: 'Ajuste Manual',
    etapa: a.etapa,
    kg: a.diferencia,
    saldoDespues: a.cantidadDespues,
    referencia: a.ajustadoPor,
    clic: () => abrirDetalleAjuste(a)
  }));
  const filas = movimientos.concat(ajustes).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  if (filas.length === 0) {
    const mensaje = document.createElement('p');
    mensaje.textContent = 'Sin movimientos registrados para este material';
    wrapper.appendChild(mensaje);
    return;
  }
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead><tr><th data-tipo="fecha">Fecha</th><th data-tipo="texto">Tipo</th><th data-tipo="texto">Etapa</th><th data-tipo="numero">Kg</th><th data-tipo="numero">Saldo etapa después</th><th data-tipo="ticket">Ticket / Folio</th></tr></thead>
    <tbody id="inv-movimientos-tabla"></tbody>
  `;
  const tbody = tabla.querySelector('tbody');
  filas.forEach((f) => {
    const filaTr = document.createElement('tr');
    if (f.clic) {
      filaTr.classList.add('inv-celda-clic');
      filaTr.addEventListener('click', f.clic);
    }
    const valores = [
      window.formatearFecha(f.fecha),
      f.tipo,
      f.etapa,
      `${f.kg > 0 ? '+' : ''}${f.kg} Kg`,
      `${f.saldoDespues} Kg`,
      f.referencia || '—'
    ];
    valores.forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      filaTr.appendChild(celda);
    });
    tbody.appendChild(filaTr);
  });
  window.activarOrdenamiento(tabla);
  wrapper.appendChild(tabla);
}

// ── Orquestación de vistas ────────────────────────────────────────────────

function crearSubtabs() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  nav.id = 'inventario-subtabs';
  const definiciones = [
    { id: 'tabla', nombre: 'Inventario' },
    { id: 'ajustes', nombre: 'Historial de Ajustes' },
    { id: 'historialMaterial', nombre: 'Historial por Material' }
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
  document.getElementById('inventario-historial-material-wrapper').style.display = vistaActiva === 'historialMaterial' ? '' : 'none';
  if (vistaActiva === 'tabla') {
    llenarVistaTabla();
  } else if (vistaActiva === 'ajustes') {
    llenarSelectoresHistorialAjustes();
    llenarVistaAjustes();
  } else {
    llenarSelectorHistorialMaterial();
    llenarVistaHistorialMaterial();
  }
}

function renderInventario(container) {
  vistaActiva = 'tabla';
  materialAjusteSeleccionado = '';
  etapaAjusteSeleccionada = '';
  materialHistorialSeleccionado = '';
  filasActuales = [];
  rangoInventario = { desde: '', hasta: '' };
  materialesRangoExpandidos = new Set();

  container.appendChild(crearBarraAcciones());
  container.appendChild(crearSubtabs());
  container.appendChild(crearVistaTabla());
  container.appendChild(crearVistaAjustes());
  container.appendChild(crearVistaHistorialMaterial());
  container.appendChild(crearModalDetalleAjusteHistorial());
  if (puedeAjustarInventario()) {
    container.appendChild(crearModalAjuste());
    container.appendChild(crearModalInventarioInicial());
  }

  renderizarVistaActiva();
}

window.EVE_MODULES.inventario = { render: renderInventario };

})();
