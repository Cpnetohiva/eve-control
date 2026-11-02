(function () {

// ── Datos ────────────────────────────────────────────────────────────────

function usuarioActual() {
  return (window.EVE && window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
}

function yaExisteCxC(cuentasPorCobrar, ventaId) {
  return cuentasPorCobrar.some((c) => c.ventaId === ventaId);
}

function construirDocsCxCDesdeVenta(venta, ventaId, usuario) {
  return (venta.lineas || []).map((l, indice) => ({
    ventaId,
    lineaIndex: indice,
    folio: venta.folio,
    cliente: venta.cliente,
    material: l.material,
    cantidad: Number(l.cantidad) || 0,
    unidad: l.unidad,
    precioUnitario: Number(l.precioUnitario) || 0,
    subtotal: Number(l.subtotal) || 0,
    ivaTrasladado: Number(l.ivaTrasladado) || 0,
    ivaRetenido: Number(l.ivaRetenido) || 0,
    total: Number(l.totalLinea) || 0,
    fechaVenta: venta.fecha,
    fechaEsperadaCobro: venta.fechaEsperadaCobro || venta.fecha,
    pagado: 0,
    saldo: Number(l.totalLinea) || 0,
    estado: 'pendiente',
    abonos: [],
    abonosRevertidos: [],
    creadoPor: usuario
  }));
}

// Replica generarYGuardarCxP de CxP: al generar las CxC de una venta nueva se aplica automáticamente el saldo a favor del
// cliente, línea por línea, en UNA transacción con lectura fresca: abono 'Saldo a favor aplicado automáticamente' en cada CxC y
// un movimiento negativo por línea (mismo grupoPagoId que su abono). El saldo es un fondo común, así que el orden de los
// movimientos de origen no cambia el resultado. No crea cobros: el efectivo ya se contó con el anticipo.
// Devuelve true si las CxC quedaron escritas. false = no se intentó (sin saldo en memoria o sin conexión) o falló la
// transacción (no se escribió nada y se avisó): el llamador crea las CxC sin aplicar.
async function crearCxCAplicandoSaldoAFavor(venta, docs) {
  const SC = window.EVE_SALDO_CLIENTES;
  const cliente = docs.length > 0 ? docs[0].cliente : '';
  if (!SC || !cliente || !navigator.onLine || SC.saldoAFavorDisponibleCliente(cliente) <= 0.01) return false;
  let resultado;
  try {
    resultado = await window.db.runTransaction(async (tx) => {
      const docCliente = await tx.get(SC.refCliente(cliente));
      let disponible = SC.totalSaldoAFavorCliente(docCliente.exists ? docCliente.data().saldoAFavor : []);
      const fecha = window.obtenerFechaMexico();
      const movimientos = [];
      const escritos = docs.map((doc) => {
        let nuevo = doc;
        const aplicado = Math.round(Math.min(disponible, doc.saldo) * 100) / 100;
        if (aplicado > 0.01) {
          const grupoPagoId = window.EVE_CXP.generarGrupoPagoId();
          const abono = {
            monto: aplicado, fecha, referencia: 'Saldo a favor aplicado automáticamente', registradoPor: 'Sistema',
            fechaRegistro: new Date().toISOString(), grupoPagoId, abonoId: window.EVE_CXP.generarAbonoId()
          };
          nuevo = { ...doc, ...window.EVE_CXP.aplicarAbono(doc, abono) };
          movimientos.push({ monto: -aplicado, fecha, motivo: `Aplicado automáticamente a la CxC del folio ${doc.folio}`, grupoPagoId });
          disponible -= aplicado;
        }
        const ref = window.db.collection('cuentas_por_cobrar').doc();
        tx.set(ref, nuevo);
        return { id: ref.id, doc: nuevo };
      });
      const saldo = movimientos.length > 0 ? SC.agregarMovimientoEnTransaccion(tx, cliente, docCliente, movimientos) : null;
      return { escritos, saldo };
    });
  } catch (error) {
    window.showError(`La venta ${venta.folio || ''} se registró, pero no se pudo aplicar el saldo a favor de ${cliente}: ${error.message}. Sus cuentas por cobrar se crearon sin aplicar; usa «Aplicar saldo a favor» en Por Cliente.`);
    return false;
  }
  resultado.escritos.forEach(({ id, doc }) => window.EVE.cuentasPorCobrar.push({ id, ...doc, fechaRegistro: new Date().toISOString() }));
  if (resultado.saldo) await SC.confirmarAlta(resultado.saldo);
  return true;
}

async function generarCxCDesdeVenta(ventaId, venta) {
  if (yaExisteCxC(window.EVE.cuentasPorCobrar, ventaId)) return;
  const docs = construirDocsCxCDesdeVenta(venta, ventaId, usuarioActual());
  if (await crearCxCAplicandoSaldoAFavor(venta, docs)) return;
  for (const doc of docs) {
    const id = await window.guardarDato('cuentas_por_cobrar', doc);
    window.EVE.cuentasPorCobrar.push({ id, ...doc, fechaRegistro: new Date().toISOString() });
  }
}

// `docs` opcional: permite borrar los docs recién leídos de Firestore en vez de los de memoria.
async function eliminarCxCDeVenta(ventaId, docs = window.EVE.cuentasPorCobrar.filter((c) => c.ventaId === ventaId)) {
  for (const doc of docs) {
    await window.eliminarDato('cuentas_por_cobrar', doc.id);
  }
  window.EVE.cuentasPorCobrar = window.EVE.cuentasPorCobrar.filter((c) => c.ventaId !== ventaId);
}

// Abono pagado con saldo a favor del cliente (manual o automático): cuenta como abono activo igual que un cobro.
function esAbonoSaldoAFavorCxC(abono) {
  return String((abono && abono.referencia) || '').startsWith('Saldo a favor aplicado');
}

function cxcConCobrosDeVenta(ventaId) {
  return window.EVE.cuentasPorCobrar.some((c) => c.ventaId === ventaId && c.pagado > 0);
}

// Elimina una venta junto con su CxC y sus cobros revertidos. Relee de Firestore (no de memoria)
// y bloquea si hay cobros vigentes. Orden de hijos a padre: cobros revertidos, CxC, venta.
// Cada paso deja el árbol consistente (nunca un hijo sin padre), así que si uno falla basta
// reintentar: la relectura solo encuentra lo que falta por borrar.
async function eliminarVentaConCxC(venta, motivo) {
  const bloquear = (conSaldoAFavor) => {
    const error = new Error(conSaldoAFavor
      ? `La venta ${venta.folio || ''} tiene saldo a favor aplicado en Cuentas por Cobrar — revierte primero ese abono (Por Cliente → Ver Detalle) antes de eliminarla; el saldo vuelve solo.`
      : `La venta ${venta.folio || ''} tiene cobros registrados en Cuentas por Cobrar — revierte o resuelve los cobros antes de eliminarla.`);
    error.code = 'cxc-con-cobros';
    throw error;
  };
  const snapshot = await window.db.collection('cuentas_por_cobrar').where('ventaId', '==', venta.id).get();
  const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (docs.some((c) => (Number(c.pagado) || 0) > 0 || (c.abonos || []).length > 0)) {
    bloquear(docs.some((c) => (c.abonos || []).some(esAbonoSaldoAFavorCxC)));
  }

  const consultasCobros = [
    window.db.collection('cobros').where('ventaId', '==', venta.id).get(),
    ...docs.map((c) => window.db.collection('cobros').where('cxcId', '==', c.id).get())
  ];
  const cobros = new Map();
  (await Promise.all(consultasCobros)).forEach((s) => s.docs.forEach((d) => cobros.set(d.id, { id: d.id, ...d.data() })));
  if ([...cobros.values()].some((r) => r.revertido !== true)) bloquear();

  for (const r of cobros.values()) {
    await window.eliminarDato('cobros', r.id);
    window.EVE_HISTORIAL.registrar({
      coleccion: 'cobros',
      registroId: r.id,
      accion: 'eliminacion',
      valorAnterior: { ventaId: r.ventaId, cxcId: r.cxcId, folio: r.folio, cliente: r.cliente, pagado: r.pagado, revertido: true },
      valorNuevo: null,
      motivo
    });
  }
  if (cobros.size > 0) window.EVE.cobros = (window.EVE.cobros || []).filter((r) => !cobros.has(r.id));

  await eliminarCxCDeVenta(venta.id, docs);
  docs.forEach((c) => window.EVE_HISTORIAL.registrar({
    coleccion: 'cuentas_por_cobrar',
    registroId: c.id,
    accion: 'eliminacion',
    valorAnterior: { ventaId: c.ventaId, folio: c.folio, cliente: c.cliente, material: c.material, total: c.total },
    valorNuevo: null,
    motivo
  }));
  await window.eliminarDato('ventas', venta.id);
  window.EVE_HISTORIAL.registrar({
    coleccion: 'ventas',
    registroId: venta.id,
    accion: 'eliminacion',
    valorAnterior: { cliente: venta.cliente, fecha: venta.fecha, lineas: venta.lineas, totalVenta: venta.totalVenta },
    valorNuevo: null,
    motivo
  });
}

// Al editar una venta (sin cobros aplicados aún) se regeneran sus líneas de CxC
// desde cero, porque cambiar cantidades/materiales/precios invalida los docs previos.
function validarVentaEditable(ventaId) {
  if (!cxcConCobrosDeVenta(ventaId)) return;
  const conSaldoAFavor = window.EVE.cuentasPorCobrar.some((c) => c.ventaId === ventaId && (c.abonos || []).some(esAbonoSaldoAFavorCxC));
  throw new Error(conSaldoAFavor
    ? 'Esta venta tiene saldo a favor aplicado — revierte primero ese abono (Por Cliente → Ver Detalle) antes de editar sus líneas; el saldo vuelve solo.'
    : 'Esta venta ya tiene cobros registrados — revierte los abonos antes de editar sus líneas.');
}

async function regenerarCxCDesdeVenta(ventaId, venta) {
  validarVentaEditable(ventaId);
  await eliminarCxCDeVenta(ventaId);
  await generarCxCDesdeVenta(ventaId, venta);
}

function agregarPorClienteCxC(cuentas) {
  return window.EVE_CXP.agregarPorClave(cuentas, 'cliente');
}

function filtrarCxC(cuentas, filtros) {
  return window.EVE_CXP.filtrarGenerico(cuentas, filtros, { campoFecha: 'fechaVenta', campoEntidad: 'cliente' });
}

function calcularRangoPeriodoCxC(periodo) {
  const hoy = window.obtenerFechaMexico();
  if (periodo === 'hoy') return { desde: hoy, hasta: hoy };
  if (periodo === 'semana') return { desde: window.obtenerInicioSemana(), hasta: null };
  if (periodo === 'mes') return { desde: window.obtenerInicioMes(), hasta: null };
  if (periodo === 'ultimos30') return { desde: window.obtenerInicioUltimos30Dias(), hasta: hoy };
  return { desde: null, hasta: null };
}

async function actualizarAbonoCxC(cxcId, abono) {
  const cxc = window.EVE.cuentasPorCobrar.find((c) => c.id === cxcId);
  if (!cxc) return;
  const cambios = window.EVE_CXP.aplicarAbono(cxc, { ...abono, abonoId: window.EVE_CXP.generarAbonoId() });
  await window.actualizarDato('cuentas_por_cobrar', cxcId, cambios);
  Object.assign(cxc, cambios);
}

async function revertirCobrosSiExiste(grupoPagoId, cxcId, motivo) {
  if (!grupoPagoId) return;
  const coincidencias = window.EVE.cobros.filter((c) =>
    c.grupoPagoId === grupoPagoId && (cxcId === null || c.cxcId === cxcId || c.origen === 'anticipo') && !c.revertido
  );
  for (const registro of coincidencias) {
    const cambios = { revertido: true, revertidoMotivo: motivo, fechaReversion: new Date().toISOString() };
    await window.actualizarDato('cobros', registro.id, cambios);
    Object.assign(registro, cambios);
  }
}

async function revertirAbonoCxC(cxcId, abonoId, motivo, revertidoPor) {
  const cxc = window.EVE.cuentasPorCobrar.find((c) => c.id === cxcId);
  if (!cxc) return;
  const abono = cxc.abonos.find((a) => a.abonoId === abonoId);
  if (!abono) throw new Error('Este abono no tiene un identificador válido y no puede revertirse.');
  // Un anticipo ya aplicado a otra cuenta no se puede revertir (valida antes de escribir cualquier cosa).
  if (abono.grupoPagoId) await window.EVE_SALDO_CLIENTES.validarAnticipoClienteNoConsumido(cxc.cliente, abono.grupoPagoId);
  const abonos = cxc.abonos.filter((a) => a.abonoId !== abonoId);
  const pagado = abonos.reduce((acc, a) => acc + (Number(a.monto) || 0), 0);
  const saldo = cxc.total - pagado;
  const estado = window.EVE_CXP.calcularEstado(pagado, saldo);
  const abonoRevertido = { ...abono, motivo, revertidoPor, fechaReversion: new Date().toISOString() };
  const abonosRevertidos = [...(cxc.abonosRevertidos || []), abonoRevertido];
  const cambios = { abonos, abonosRevertidos, pagado, saldo, estado };
  await window.actualizarDato('cuentas_por_cobrar', cxcId, cambios);
  Object.assign(cxc, cambios);
  if (abono.grupoPagoId) {
    await window.EVE_SALDO_CLIENTES.revertirMovimientoSaldoAFavorClienteSiExiste(cxc.cliente, abono.grupoPagoId, motivo, revertidoPor);
    await revertirCobrosSiExiste(abono.grupoPagoId, cxc.id, motivo);
  }
}

// Revierte un anticipo (cobro origen 'anticipo', sin cxcId) desde la lista de Cobros: valida que no esté consumido,
// revierte su movimiento en clientes y marca el cobro revertido.
async function revertirAnticipoPorGrupo(cliente, grupoPagoId, motivo, revertidoPor) {
  await window.EVE_SALDO_CLIENTES.validarAnticipoClienteNoConsumido(cliente, grupoPagoId);
  await window.EVE_SALDO_CLIENTES.revertirMovimientoSaldoAFavorClienteSiExiste(cliente, grupoPagoId, motivo, revertidoPor);
  const anticipos = window.EVE.cobros.filter((c) => c.grupoPagoId === grupoPagoId && c.origen === 'anticipo' && !c.revertido);
  for (const cobro of anticipos) {
    const cambios = { revertido: true, revertidoMotivo: motivo, fechaReversion: new Date().toISOString() };
    await window.actualizarDato('cobros', cobro.id, cambios);
    Object.assign(cobro, cambios);
  }
}

async function revertirAnticipoCobro(cobroId, motivo, revertidoPor) {
  const cobro = window.EVE.cobros.find((c) => c.id === cobroId);
  if (!cobro || cobro.origen !== 'anticipo') throw new Error('Este cobro no es un anticipo.');
  if (cobro.revertido) return;
  await revertirAnticipoPorGrupo(cobro.cliente, cobro.grupoPagoId, motivo, revertidoPor);
}

// Documento en `cobros` del sobrante de un cobro (anticipo): sin cxcId, sin IVA (se captura sin IVA) y sin material.
function construirDocAnticipoCobro(cliente, folio, monto, fecha, referencia, referenciaDeposito, grupoPagoId) {
  return {
    cxcId: '', ventaId: '', folio: folio || '', cliente, material: '', cantidad: 0, unidad: '',
    pagado: monto, total: 0, iva: 0, fecha, referencia, referenciaDeposito,
    origen: 'anticipo', revertido: false, grupoPagoId
  };
}

// Nombres de cliente conocidos (ventas, cuentas por cobrar y clientes con saldo a favor, más `extra`), normalizados, sin repetir y
// ordenados: alimentan las sugerencias (datalist) del anticipo, del filtro de CxC Todos y del filtro de Cobros.
function nombresClientesConocidos(extra) {
  const nombres = new Set();
  [...(window.EVE.ventas || []), ...(window.EVE.cuentasPorCobrar || []), ...(window.EVE.clientes || []).map((c) => ({ cliente: c.nombre })), ...(extra || [])].forEach((r) => {
    const nombre = window.normalizarCliente(r.cliente);
    if (nombre) nombres.add(nombre);
  });
  return Array.from(nombres).sort();
}

function llenarSugerenciasClientes(datalist, extra) {
  if (!datalist) return;
  datalist.innerHTML = '';
  nombresClientesConocidos(extra).forEach((nombre) => {
    const option = document.createElement('option');
    option.value = nombre;
    datalist.appendChild(option);
  });
}

// Doc espejo en `cobros` de un abono a una partida de CxC (lo comparten el cobro general y el cobro de factura).
function construirDocCobro(cxc, monto, fecha, referencia, referenciaDeposito, origen, grupoPagoId) {
  return {
    cxcId: cxc.id,
    ventaId: cxc.ventaId,
    folio: cxc.folio,
    cliente: cxc.cliente,
    material: cxc.material,
    cantidad: cxc.cantidad,
    unidad: cxc.unidad,
    pagado: monto,
    total: cxc.total,
    iva: window.calcularIvaProrrateado(monto, cxc.total, cxc.ivaTrasladado),
    fecha,
    referencia,
    referenciaDeposito,
    origen,
    grupoPagoId
  };
}

// Reparte `monto` entre las partidas con saldo de una factura, por lineaIndex ascendente, hasta agotarlo.
// No valida el tope: el llamador compara `monto` contra `saldoTotal` (la vista previa lo usa tal cual).
function repartirCobroFactura(partidas, monto) {
  const conSaldo = partidas
    .filter((p) => p.saldo > 0.001)
    .sort((a, b) => (Number(a.lineaIndex) || 0) - (Number(b.lineaIndex) || 0));
  let restante = monto;
  const aplicaciones = conSaldo.map((cuenta) => {
    const aplicado = Math.max(0, Math.min(cuenta.saldo, restante));
    restante -= aplicado;
    return { cuenta, monto: aplicado };
  });
  return { aplicaciones, saldoTotal: conSaldo.reduce((suma, p) => suma + p.saldo, 0) };
}

// Cobro por el total de una factura (todas las partidas de una venta de un cliente). Una sola transacción con lectura fresca:
// o se escriben todos los abonos y sus docs en `cobros`, o no se escribe nada. Todas las partidas tocadas comparten un
// grupoPagoId. Si el monto excede el saldo de la factura, el excedente se guarda como anticipo en la misma transacción
// (documento en cobros origen 'anticipo' + movimiento positivo en clientes, mismo grupoPagoId).
async function registrarCobroFactura(cliente, ventaId, datos) {
  if (!navigator.onLine) throw new Error('Sin conexión. Vuelve a intentarlo cuando tengas internet.');
  if (!window.puedeEscribir('cxc')) throw new Error('No tienes permiso para registrar cobros');
  const monto = Number(datos.monto);
  if (!Number.isFinite(monto) || monto <= 0) throw new Error('El monto debe ser mayor a 0');
  if (!datos.fecha) throw new Error('La fecha es obligatoria');
  const referencia = datos.referencia || datos.forma || '';
  const referenciaDeposito = datos.referenciaDeposito || '';
  const registradoPor = usuarioActual();
  const grupoPagoId = window.EVE_CXP.generarGrupoPagoId();

  // Una transacción solo lee documentos por referencia: los ids salen de una consulta al servidor y cada doc se relee dentro.
  const coleccion = window.db.collection('cuentas_por_cobrar');
  const consulta = await coleccion.where('ventaId', '==', ventaId).get({ source: 'server' });
  const ids = consulta.docs.filter((d) => d.data().cliente === cliente).map((d) => d.id);
  if (ids.length === 0) throw new Error('No se encontró la factura de este cliente');

  const refCliente = window.EVE_SALDO_CLIENTES.refCliente(cliente);
  const resultado = await window.db.runTransaction(async (tx) => {
    const docs = await Promise.all(ids.map((id) => tx.get(coleccion.doc(id))));
    const cuentas = docs
      .filter((d) => d.exists)
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.cliente === cliente && c.ventaId === ventaId);
    const { aplicaciones, saldoTotal } = repartirCobroFactura(cuentas, monto);
    if (saldoTotal <= 0.001) throw new Error('Esta factura ya no tiene saldo pendiente');
    const excedente = Math.round((monto - saldoTotal) * 100) / 100;
    // Firestore exige todas las lecturas antes de escribir: el documento del cliente se lee aquí, antes de cualquier tx.set.
    const docCliente = excedente > 0.01 ? await tx.get(refCliente) : null;
    const fechaRegistro = new Date().toISOString();
    const partidas = aplicaciones.filter((a) => a.monto > 0).map(({ cuenta, monto: abonado }) => {
      const abono = { monto: abonado, fecha: datos.fecha, referencia, registradoPor, fechaRegistro, grupoPagoId, abonoId: window.EVE_CXP.generarAbonoId() };
      const cambios = window.EVE_CXP.aplicarAbono({ ...cuenta, abonos: cuenta.abonos || [] }, abono);
      const refCobro = window.db.collection('cobros').doc();
      const cobro = { ...construirDocCobro(cuenta, abonado, datos.fecha, referencia, referenciaDeposito, 'cxc_cobro_factura', grupoPagoId), fechaRegistro };
      tx.update(coleccion.doc(cuenta.id), cambios);
      tx.set(refCobro, cobro);
      return { cuenta, cambios, idCobro: refCobro.id, cobro };
    });
    let anticipo = null;
    if (docCliente) {
      const folio = cuentas[0].folio;
      const refAnticipo = window.db.collection('cobros').doc();
      const cobro = { ...construirDocAnticipoCobro(cliente, folio, excedente, datos.fecha, referencia, referenciaDeposito, grupoPagoId), fechaRegistro };
      tx.set(refAnticipo, cobro);
      const saldo = window.EVE_SALDO_CLIENTES.agregarMovimientoEnTransaccion(tx, cliente, docCliente, {
        monto: excedente, fecha: datos.fecha, motivo: `Sobrante de cobro folio ${folio}`, grupoPagoId
      });
      anticipo = { idCobro: refAnticipo.id, cobro, saldo };
    }
    return { partidas, anticipo };
  });
  const escritos = resultado.partidas;

  escritos.forEach(({ cuenta, cambios, idCobro, cobro }) => {
    const enMemoria = window.EVE.cuentasPorCobrar.find((c) => c.id === cuenta.id);
    if (enMemoria) Object.assign(enMemoria, cambios);
    window.EVE.cobros.push({ id: idCobro, ...cobro });
  });
  let sobrante = 0;
  if (resultado.anticipo) {
    window.EVE.cobros.push({ id: resultado.anticipo.idCobro, ...resultado.anticipo.cobro });
    await window.EVE_SALDO_CLIENTES.confirmarAlta(resultado.anticipo.saldo);
    sobrante = resultado.anticipo.cobro.pagado;
  }
  return { grupoPagoId, partidas: escritos.length, total: escritos.reduce((suma, e) => suma + e.cobro.pagado, 0), sobrante };
}

async function registrarCobroGeneral(nombreCliente, monto, fecha, referencia, registradoPor, referenciaDeposito) {
  const cuentasCliente = window.EVE.cuentasPorCobrar.filter((c) => c.cliente === nombreCliente);
  const { actualizaciones, sobrante } = window.EVE_CXP.distribuirPago(cuentasCliente, monto, fecha, referencia, registradoPor, 'fechaVenta');
  const grupoPagoId = window.EVE_CXP.generarGrupoPagoId();
  for (const act of actualizaciones) {
    const cxc = window.EVE.cuentasPorCobrar.find((c) => c.id === act.id);
    const abonos = [...cxc.abonos, { ...act.abono, grupoPagoId }];
    await window.actualizarDato('cuentas_por_cobrar', act.id, { pagado: act.pagado, saldo: act.saldo, estado: act.estado, abonos });
    const registroCobro = construirDocCobro(cxc, act.abono.monto, fecha, referencia, referenciaDeposito, 'cxc_cobro_general', grupoPagoId);
    const idCobro = await window.guardarDato('cobros', registroCobro);
    window.EVE.cobros.push({ id: idCobro, ...registroCobro, fechaRegistro: new Date().toISOString() });
    Object.assign(cxc, { pagado: act.pagado, saldo: act.saldo, estado: act.estado, abonos });
  }
  const sobranteRedondeado = Math.round(sobrante * 100) / 100;
  const sobranteRegistrado = sobranteRedondeado > 0.01
    ? await registrarAnticipoCliente(nombreCliente, sobranteRedondeado, fecha, referencia, referenciaDeposito, grupoPagoId)
    : 0;
  return { actualizaciones, sobrante: sobranteRedondeado > 0.01 ? sobranteRedondeado : 0, sobranteRegistrado };
}

// El sobrante de un cobro general es dinero que ya entró: movimiento positivo en clientes y documento anticipo en cobros, con el
// mismo grupoPagoId que los abonos (como registrarPagoGeneral/registrarAnticipoEnPagos en CxP). Los abonos ya están escritos y
// no se revierten: si algo falla se avisa en pantalla para registrarlo a mano. Devuelve el monto que quedó como saldo a favor.
async function guardarAnticipoCliente(cliente, monto, fecha, referencia, referenciaDeposito, grupoPagoId, motivo, etiqueta, nota) {
  // Si falla el saldo se lanza el error y no queda nada escrito.
  await window.EVE_SALDO_CLIENTES.guardarSaldoAFavorCliente(cliente, { monto, fecha, motivo, grupoPagoId });
  try {
    const cobro = { ...construirDocAnticipoCobro(cliente, '', monto, fecha, referencia, referenciaDeposito, grupoPagoId), ...(nota ? { nota } : {}) };
    const idCobro = await window.guardarDato('cobros', cobro);
    window.EVE.cobros.push({ id: idCobro, ...cobro, fechaRegistro: new Date().toISOString() });
  } catch (error) {
    window.showError(`El ${etiqueta} de ${window.formatearMoneda(monto)} quedó como saldo a favor de ${cliente}, pero no se pudo registrar en Cobros: ${error.message}. Hasta registrarlo no aparecerá en Cobros ni en Flujo de efectivo.`);
  }
}

async function registrarAnticipoCliente(cliente, monto, fecha, referencia, referenciaDeposito, grupoPagoId) {
  try {
    await guardarAnticipoCliente(cliente, monto, fecha, referencia, referenciaDeposito, grupoPagoId, 'Sobrante de cobro', 'sobrante');
  } catch (error) {
    window.showError(`Los cobros se registraron, pero el sobrante de ${window.formatearMoneda(monto)} NO se registró como saldo a favor de ${cliente}: ${error.message}. Regístralo manualmente.`);
    return 0;
  }
  return monto;
}

// Anticipo capturado a mano (botón del encabezado): el monto COMPLETO va a saldo a favor del cliente, tenga o no cuentas
// pendientes; no se reparte contra ellas. Mismo anticipo que el sobrante de un cobro (cobros origen 'anticipo' + movimiento
// positivo en clientes, mismo grupoPagoId), así que se revierte igual (Revertir en Cobros o en Ver Movimientos).
async function registrarAnticipoManual(nombreCliente, monto, fecha, referencia, nota) {
  if (!window.puedeEscribir('cxc')) throw new Error('No tienes permiso para registrar anticipos');
  const cliente = window.normalizarCliente(nombreCliente);
  if (!cliente) throw new Error('El cliente es obligatorio');
  if (!Number.isFinite(Number(monto)) || Number(monto) <= 0) throw new Error('El monto debe ser mayor a 0');
  if (!fecha) throw new Error('La fecha es obligatoria');
  const grupoPagoId = window.EVE_CXP.generarGrupoPagoId();
  const notaLimpia = (nota || '').trim();
  await guardarAnticipoCliente(cliente, Number(monto), fecha, referencia || '', '', grupoPagoId, notaLimpia ? `Anticipo de cliente: ${notaLimpia}` : 'Anticipo de cliente', 'anticipo', notaLimpia);
  return { grupoPagoId, cliente };
}

window.EVE_CXC = {
  yaExisteCxC,
  construirDocsCxCDesdeVenta,
  generarCxCDesdeVenta,
  eliminarCxCDeVenta,
  cxcConCobrosDeVenta,
  validarVentaEditable,
  eliminarVentaConCxC,
  regenerarCxCDesdeVenta,
  agregarPorClienteCxC,
  filtrarCxC,
  calcularRangoPeriodoCxC,
  actualizarAbonoCxC,
  revertirAbonoCxC,
  revertirAnticipoCobro,
  registrarCobroGeneral,
  registrarAnticipoManual,
  nombresClientesConocidos,
  llenarSugerenciasClientes,
  registrarCobroFactura,
  repartirCobroFactura
};

// ── UI ───────────────────────────────────────────────────────────────────

let vistaActiva = 'clientes';
let tabClientePeriodo = 'todos';
let clienteExpandido = null;
let cxcAbonoExpandido = null;
let tabTodos = 'semana';
let filtrosTodos = { desde: '', hasta: '', cliente: '', material: '', estado: '' };
let modalContexto = null;
let envioPagoEnCurso = false;

function crearChip(texto, clase) {
  const span = document.createElement('span');
  span.className = 'chip ' + clase;
  span.textContent = texto;
  return span;
}

function crearResumenGeneral() {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = 'cxc-resumen-general';
  return div;
}

function calcularTotalPorCobrarGeneral() {
  const grupos = agregarPorClienteCxC(window.EVE.cuentasPorCobrar).filter((g) => g.saldo > 0);
  const total = grupos.reduce((suma, g) => suma + g.saldo, 0);
  return { total, cantidadClientes: grupos.length };
}

function obtenerPeriodoActivoInfo() {
  if (vistaActiva === 'clientes' && (tabClientePeriodo === 'hoy' || tabClientePeriodo === 'semana' || tabClientePeriodo === 'mes' || tabClientePeriodo === 'ultimos30')) {
    const nombres = { hoy: 'Hoy', semana: 'Esta Semana', mes: 'Este Mes', ultimos30: 'Últimos 30 días' };
    const { desde, hasta } = calcularRangoPeriodoCxC(tabClientePeriodo);
    return { nombre: nombres[tabClientePeriodo], desde, hasta };
  }
  if (vistaActiva === 'todos' && (tabTodos === 'semana' || tabTodos === 'mes' || tabTodos === 'ultimos30')) {
    const nombres = { semana: 'Esta Semana', mes: 'Este Mes', ultimos30: 'Últimos 30 días' };
    const { desde, hasta } = calcularRangoPeriodoCxC(tabTodos);
    return { nombre: nombres[tabTodos], desde, hasta };
  }
  return null;
}

function llenarResumenGeneral() {
  const div = document.getElementById('cxc-resumen-general');
  if (!div) return;
  div.innerHTML = '';
  const { total, cantidadClientes } = calcularTotalPorCobrarGeneral();
  const fila = document.createElement('div');
  fila.style.cssText = 'display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap';
  const bloqueGeneral = document.createElement('div');
  bloqueGeneral.innerHTML = `<strong>Total por Cobrar General: ${window.formatearMoneda(total)}</strong> (${cantidadClientes} cliente${cantidadClientes === 1 ? '' : 's'} con saldo pendiente)`;
  fila.appendChild(bloqueGeneral);

  const periodoActivo = obtenerPeriodoActivoInfo();
  if (periodoActivo) {
    const cuentasPeriodo = filtrarCxC(window.EVE.cuentasPorCobrar, { desde: periodoActivo.desde, hasta: periodoActivo.hasta });
    const totalPeriodo = agregarPorClienteCxC(cuentasPeriodo).filter((g) => g.saldo > 0).reduce((suma, g) => suma + g.saldo, 0);
    const bloquePeriodo = document.createElement('div');
    bloquePeriodo.innerHTML = `<strong>Total ${periodoActivo.nombre}: ${window.formatearMoneda(totalPeriodo)}</strong>`;
    fila.appendChild(bloquePeriodo);
  }
  // Informativo: el saldo a favor de clientes NO se resta de Total por Cobrar General.
  // Misma regla que las tarjetas: un saldo de 0.01 o menos no cuenta.
  const totalSaldoFavor = Math.round((window.EVE.clientes || []).reduce((suma, c) => { const saldo = saldoFavorDeCliente(c.nombre); return saldo > 0.01 ? suma + saldo : suma; }, 0) * 100) / 100;
  if (totalSaldoFavor > 0.01) {
    const bloqueSaldoFavor = document.createElement('div');
    bloqueSaldoFavor.id = 'cxc-resumen-saldo-favor';
    bloqueSaldoFavor.textContent = `Saldo a favor de clientes: ${window.formatearMoneda(totalSaldoFavor)}`;
    fila.appendChild(bloqueSaldoFavor);
  }
  div.appendChild(fila);
}

function crearTabsPrincipales() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  nav.id = 'cxc-tabs-principales';
  const definiciones = [
    { id: 'clientes', nombre: 'Por Cliente' },
    { id: 'todos', nombre: 'Todos' }
  ];
  definiciones.forEach((def, indice) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (indice === 0 ? ' active' : '');
    boton.textContent = def.nombre;
    boton.addEventListener('click', () => {
      vistaActiva = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === boton));
      renderizarVistaActiva();
    });
    nav.appendChild(boton);
  });
  return nav;
}

function crearTabsPeriodoCliente() {
  const nav = document.createElement('div');
  nav.id = 'cxc-tabs-periodo-cliente';
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
    { id: 'mes', nombre: 'Este Mes' },
    { id: 'ultimos30', nombre: 'Últimos 30 días' },
    { id: 'todos', nombre: 'Todos' }
  ];
  definiciones.forEach((def) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (def.id === tabClientePeriodo ? ' active' : '');
    boton.textContent = def.nombre;
    boton.addEventListener('click', () => {
      tabClientePeriodo = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === boton));
      llenarVistaClientes();
      llenarResumenGeneral();
    });
    nav.appendChild(boton);
  });
  return nav;
}

function crearVistaClientes() {
  const wrapper = document.createElement('div');
  wrapper.id = 'cxc-clientes-wrapper';
  wrapper.appendChild(crearTabsPeriodoCliente());
  const contenido = document.createElement('div');
  contenido.id = 'cxc-clientes-contenido';
  wrapper.appendChild(contenido);
  return wrapper;
}

function llenarVistaClientes() {
  const contenido = document.getElementById('cxc-clientes-contenido');
  if (!contenido) return;
  contenido.innerHTML = '';
  if (tabClientePeriodo === 'todos') {
    llenarVistaClientesCompleta(contenido);
  } else {
    llenarVistaClientesPeriodo(contenido, tabClientePeriodo);
  }
}

function llenarVistaClientesCompleta(contenido) {
  // También los clientes con saldo a favor (> 0.01) aunque su saldo pendiente sea 0, incluso si no tienen ninguna CxC.
  const grupos = agregarPorClienteCxC(window.EVE.cuentasPorCobrar)
    .filter((g) => g.saldo > 0 || saldoFavorDeCliente(g.cliente) > 0.01)
    .sort((a, b) => b.saldo - a.saldo);
  (window.EVE.clientes || []).forEach((c) => {
    if (saldoFavorDeCliente(c.nombre) > 0.01 && !grupos.some((g) => g.cliente === c.nombre)) {
      grupos.push({ cliente: c.nombre, total: 0, pagado: 0, saldo: 0, cuentas: [] });
    }
  });
  if (grupos.length === 0) {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'card';
    const vacio = document.createElement('p');
    vacio.textContent = 'Sin saldo pendiente';
    tarjeta.appendChild(vacio);
    contenido.appendChild(tarjeta);
    return;
  }
  grupos.forEach((grupo) => contenido.appendChild(crearTarjetaClienteCxC(grupo)));
}

function llenarVistaClientesPeriodo(contenido, periodo) {
  const { desde, hasta } = calcularRangoPeriodoCxC(periodo);
  const cuentasPeriodo = filtrarCxC(window.EVE.cuentasPorCobrar, { desde, hasta });
  const grupos = agregarPorClienteCxC(cuentasPeriodo).filter((g) => g.saldo > 0).sort((a, b) => b.saldo - a.saldo);

  const tarjeta = document.createElement('div');
  tarjeta.className = 'card';

  if (grupos.length === 0) {
    const vacio = document.createElement('p');
    vacio.textContent = 'Sin saldo pendiente en este periodo';
    tarjeta.appendChild(vacio);
    contenido.appendChild(tarjeta);
    return;
  }

  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'destaraje-tabla-wrapper';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th data-tipo="texto">Cliente</th><th data-tipo="moneda">Saldo</th></tr>';
  tabla.appendChild(thead);
  const tbody = document.createElement('tbody');

  let total = 0;
  grupos.forEach((grupo) => {
    total += grupo.saldo;
    const fila = document.createElement('tr');
    const celdaCliente = document.createElement('td');
    celdaCliente.textContent = grupo.cliente;
    const celdaSaldo = document.createElement('td');
    celdaSaldo.textContent = window.formatearMoneda(grupo.saldo);
    fila.appendChild(celdaCliente);
    fila.appendChild(celdaSaldo);
    tbody.appendChild(fila);
  });

  const filaTotal = document.createElement('tr');
  const celdaTotal = document.createElement('td');
  celdaTotal.colSpan = 2;
  celdaTotal.style.fontWeight = 'bold';
  celdaTotal.textContent = `TOTAL: ${window.formatearMoneda(total)}`;
  filaTotal.appendChild(celdaTotal);
  tbody.appendChild(filaTotal);

  tabla.appendChild(tbody);
  window.activarOrdenamiento(tabla);
  tablaWrapper.appendChild(tabla);
  tarjeta.appendChild(tablaWrapper);
  contenido.appendChild(tarjeta);

  grupos.forEach((grupo) => contenido.appendChild(crearTarjetaClienteCxC(grupo)));
}

// ── Saldo a favor de clientes (misma presentación que Por Proveedor en CxP) ─────────────────────────────

let saldoFavorClienteExpandido = null;
const historialSaldoClienteAbierto = new Set();

function saldoFavorDeCliente(nombre) {
  return window.EVE_SALDO_CLIENTES.saldoAFavorDisponibleCliente(nombre);
}

function crearTablaSaldoFavorCliente(nombreCliente, movimientos) {
  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'destaraje-tabla-wrapper';
  tablaWrapper.style.marginTop = '0.75rem';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th data-tipo="fecha">Fecha</th><th data-tipo="moneda">Monto</th><th data-tipo="texto">Motivo</th><th data-tipo="texto">Estado</th><th></th></tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tabla.querySelector('tbody');
  tbody.id = 'cxc-tabla-saldo-favor-' + nombreCliente;
  movimientos
    .slice()
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    .forEach((m) => {
      const fila = document.createElement('tr');
      [window.formatearFecha(m.fecha), window.formatearMoneda(m.monto), m.motivo || ''].forEach((valor) => {
        const celda = document.createElement('td');
        celda.textContent = valor;
        fila.appendChild(celda);
      });
      const celdaEstado = document.createElement('td');
      celdaEstado.textContent = m.revertido ? `Revertido${m.revertidoMotivo ? ` — ${m.revertidoMotivo}` : ''}` : 'Activo';
      fila.appendChild(celdaEstado);
      const celdaAccion = document.createElement('td');
      if (!m.revertido && m.monto > 0 && m.grupoPagoId && window.puedeEscribir('cxc')) {
        const btnRevertir = document.createElement('button');
        btnRevertir.className = 'btn-secondary';
        btnRevertir.textContent = 'Revertir';
        btnRevertir.addEventListener('click', async () => {
          const motivo = window.prompt('Motivo de la reversión (obligatorio):');
          if (motivo === null || !motivo.trim()) return;
          btnRevertir.disabled = true;
          try {
            await revertirAnticipoPorGrupo(nombreCliente, m.grupoPagoId, motivo.trim(), usuarioActual());
            window.showSuccess('Movimiento de saldo a favor revertido');
            renderizarVistaActiva();
          } catch (error) {
            window.showError(error.message);
            btnRevertir.disabled = false;
          }
        });
        celdaAccion.appendChild(btnRevertir);
      }
      fila.appendChild(celdaAccion);
      tbody.appendChild(fila);
    });
  window.activarOrdenamiento(tabla);
  tablaWrapper.appendChild(tabla);
  return tablaWrapper;
}

// Lista las CxC con saldo del cliente (más antiguas primero) y aplica el saldo a favor con lectura fresca.
function abrirModalAplicarSaldoFavorCliente(nombreCliente, saldoDisponible) {
  const previo = document.getElementById('cxc-aplicar-saldo-overlay');
  if (previo) previo.remove();
  const cuentas = window.EVE.cuentasPorCobrar
    .filter((c) => c.cliente === nombreCliente && c.saldo > 0.01)
    .sort((a, b) => (a.fechaVenta < b.fechaVenta ? -1 : a.fechaVenta > b.fechaVenta ? 1 : 0));
  if (cuentas.length === 0) {
    window.showError('Este cliente no tiene cuentas con saldo pendiente');
    return;
  }
  const overlay = document.createElement('div');
  overlay.id = 'cxc-aplicar-saldo-overlay';
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Aplicar saldo a favor</h3>
      <p style="font-weight:600"></p>
      <div class="destaraje-tabla-wrapper" style="max-height:50vh;overflow:auto">
        <table class="tabla-destaraje">
          <thead><tr><th></th><th>Folio</th><th>Fecha</th><th>Saldo</th><th>Aplicar</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <p id="cxc-aplicar-saldo-total" style="font-weight:600"></p>
      <button type="button" class="btn-primary" id="cxc-aplicar-saldo-confirmar">Confirmar</button>
      <button type="button" class="btn-secondary" id="cxc-aplicar-saldo-cancelar">Cancelar</button>
    </div>
  `;
  overlay.querySelector('p').textContent = `${nombreCliente} — Saldo a favor disponible: ${window.formatearMoneda(saldoDisponible)}`;
  const redondear = (n) => Math.round(n * 100) / 100;
  const tbody = overlay.querySelector('tbody');
  const btnConfirmar = overlay.querySelector('#cxc-aplicar-saldo-confirmar');
  const filas = [];
  let restante = saldoDisponible;
  cuentas.forEach((cuenta) => {
    const sugerido = redondear(Math.min(cuenta.saldo, Math.max(0, restante)));
    restante -= sugerido;
    const fila = document.createElement('tr');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = sugerido > 0;
    const monto = document.createElement('input');
    monto.type = 'number';
    monto.step = '0.01';
    monto.min = '0.01';
    monto.max = String(cuenta.saldo);
    monto.value = sugerido > 0 ? String(sugerido) : '';
    monto.disabled = !check.checked;
    [check, String(cuenta.folio), window.formatearFecha(cuenta.fechaVenta), window.formatearMoneda(cuenta.saldo), monto].forEach((contenido) => {
      const celda = document.createElement('td');
      if (typeof contenido === 'string') celda.textContent = contenido;
      else celda.appendChild(contenido);
      fila.appendChild(celda);
    });
    tbody.appendChild(fila);
    filas.push({ cuenta, check, monto });
  });

  const seleccionadas = () => filas.filter((f) => f.check.checked);
  const actualizarTotal = () => {
    const elegidas = seleccionadas();
    const total = elegidas.reduce((acc, f) => acc + (Number(f.monto.value) || 0), 0);
    const excede = total > saldoDisponible + 0.01;
    const invalido = elegidas.some((f) => !(Number(f.monto.value) > 0) || Number(f.monto.value) > f.cuenta.saldo + 0.01);
    const totalEl = overlay.querySelector('#cxc-aplicar-saldo-total');
    totalEl.textContent = `Total a aplicar: ${window.formatearMoneda(total)}` + (excede ? ' — excede el saldo a favor disponible' : '');
    totalEl.style.color = excede ? '#c0392b' : '';
    btnConfirmar.disabled = elegidas.length === 0 || excede || invalido;
  };
  filas.forEach((f) => {
    f.monto.addEventListener('input', actualizarTotal);
    f.check.addEventListener('change', () => {
      f.monto.disabled = !f.check.checked;
      if (f.check.checked && !(Number(f.monto.value) > 0)) {
        const otros = seleccionadas().filter((o) => o !== f).reduce((acc, o) => acc + (Number(o.monto.value) || 0), 0);
        f.monto.value = String(redondear(Math.max(0.01, Math.min(f.cuenta.saldo, saldoDisponible - otros))));
      }
      actualizarTotal();
    });
  });
  actualizarTotal();

  const cerrar = () => overlay.remove();
  overlay.querySelector('#cxc-aplicar-saldo-cancelar').addEventListener('click', cerrar);
  btnConfirmar.addEventListener('click', async () => {
    btnConfirmar.disabled = true;
    try {
      const asignaciones = seleccionadas().map((f) => ({ id: f.cuenta.id, monto: Number(f.monto.value) }));
      const { aplicado } = await window.EVE_SALDO_CLIENTES.aplicarSaldoAFavorACuentasCliente(nombreCliente, asignaciones);
      cerrar();
      window.showSuccess(`Se aplicaron ${window.formatearMoneda(aplicado)} de saldo a favor a ${asignaciones.length} cuenta(s)`);
      renderizarVistaActiva();
    } catch (error) {
      window.showError(error.message);
      actualizarTotal();
    }
  });
  document.body.appendChild(overlay);
}

function crearTarjetaClienteCxC(grupo) {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card';

  const encabezado = document.createElement('div');
  encabezado.style.cssText = 'display:flex;justify-content:space-between;flex-wrap:wrap;gap:0.5rem';
  encabezado.innerHTML = `
    <h3 style="margin:0">${grupo.cliente}</h3>
    <div>
      <span>Total: ${window.formatearMoneda(grupo.total)}</span> &nbsp;
      <span>Pagado: ${window.formatearMoneda(grupo.pagado)}</span> &nbsp;
      <span><strong>Saldo: ${window.formatearMoneda(grupo.saldo)}</strong></span>
    </div>
  `;
  tarjeta.appendChild(encabezado);

  const registroCliente = window.EVE_SALDO_CLIENTES.clienteEnMemoria(grupo.cliente);
  const saldoFavor = saldoFavorDeCliente(grupo.cliente);
  const movimientosSaldo = window.EVE_SALDO_CLIENTES.movimientosDeCliente(registroCliente);
  // "Ver Movimientos" y su bloque solo existen mientras haya saldo a favor disponible; con el saldo ya consumido el historial
  // sigue consultable dentro de "Ver Detalle".
  const hayAnticipoDisponible = saldoFavor > 0.01;
  if (hayAnticipoDisponible) {
    const filaSaldoFavor = document.createElement('div');
    filaSaldoFavor.style.cssText = 'display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap';
    filaSaldoFavor.appendChild(crearChip(`✅ ${grupo.cliente} — Saldo a favor: ${window.formatearMoneda(saldoFavor)} (se aplicará a la próxima venta)`, 'chip-ok'));
    const btnMovimientos = document.createElement('button');
    btnMovimientos.className = 'btn-secondary';
    btnMovimientos.textContent = (saldoFavorClienteExpandido === grupo.cliente ? 'Ocultar' : 'Ver') + ` Movimientos (${movimientosSaldo.length})`;
    btnMovimientos.addEventListener('click', () => {
      saldoFavorClienteExpandido = saldoFavorClienteExpandido === grupo.cliente ? null : grupo.cliente;
      llenarVistaClientes();
    });
    filaSaldoFavor.appendChild(btnMovimientos);
    tarjeta.appendChild(filaSaldoFavor);
    if (saldoFavorClienteExpandido === grupo.cliente) tarjeta.appendChild(crearTablaSaldoFavorCliente(grupo.cliente, movimientosSaldo));
  }

  const acciones = document.createElement('div');
  acciones.style.cssText = 'margin-top:0.5rem;display:flex;gap:0.5rem';

  const btnDetalle = document.createElement('button');
  btnDetalle.className = 'btn-secondary';
  btnDetalle.textContent = clienteExpandido === grupo.cliente ? 'Ocultar Detalle' : 'Ver Detalle';
  btnDetalle.addEventListener('click', () => {
    clienteExpandido = clienteExpandido === grupo.cliente ? null : grupo.cliente;
    llenarVistaClientes();
  });
  acciones.appendChild(btnDetalle);

  if (window.puedeEscribir('cxc')) {
    const btnPago = document.createElement('button');
    btnPago.className = 'btn-primary';
    btnPago.textContent = 'Registrar Pago';
    btnPago.addEventListener('click', () => abrirModalPago(grupo.cliente));
    acciones.appendChild(btnPago);

    if (hayAnticipoDisponible) {
      const btnAplicarSaldo = document.createElement('button');
      btnAplicarSaldo.className = 'btn-secondary';
      btnAplicarSaldo.textContent = 'Aplicar saldo a favor';
      btnAplicarSaldo.addEventListener('click', () => abrirModalAplicarSaldoFavorCliente(grupo.cliente, saldoFavor));
      acciones.appendChild(btnAplicarSaldo);
    }
  }

  tarjeta.appendChild(acciones);

  if (clienteExpandido === grupo.cliente) {
    tarjeta.appendChild(crearTablaCuentas(grupo.cuentas, grupo.cliente));
    if (!hayAnticipoDisponible && movimientosSaldo.length > 0) {
      // Mismo patrón que Por Proveedor: <details>/<summary> nativo, cerrado por defecto, con el estado abierto por cliente en memoria.
      const historial = document.createElement('details');
      historial.className = 'cxc-historial-saldo-favor';
      historial.style.marginTop = '0.75rem';
      historial.open = historialSaldoClienteAbierto.has(grupo.cliente);
      historial.addEventListener('toggle', () => {
        if (historial.open) historialSaldoClienteAbierto.add(grupo.cliente);
        else historialSaldoClienteAbierto.delete(grupo.cliente);
      });
      const tituloHistorial = document.createElement('summary');
      tituloHistorial.style.cursor = 'pointer';
      tituloHistorial.style.fontWeight = '600';
      tituloHistorial.textContent = `Historial de movimientos de saldo a favor (${movimientosSaldo.length})`;
      historial.appendChild(tituloHistorial);
      historial.appendChild(crearTablaSaldoFavorCliente(grupo.cliente, movimientosSaldo));
      tarjeta.appendChild(historial);
    }
  }

  return tarjeta;
}

function crearTablaCuentas(cuentas, nombreCliente) {
  const conCliente = !nombreCliente;
  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'destaraje-tabla-wrapper';
  tablaWrapper.style.marginTop = '0.75rem';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th data-tipo="texto">Folio</th>${conCliente ? '<th data-tipo="texto">Cliente</th>' : ''}<th data-tipo="texto">Material</th><th data-tipo="numero">Cantidad</th><th data-tipo="moneda">Precio Unitario</th><th data-tipo="moneda">Total</th><th data-tipo="moneda">Pagado</th><th data-tipo="moneda">Saldo</th><th data-tipo="texto">Estado</th><th data-tipo="fecha">Fecha Venta</th><th>Abonos</th></tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tabla.querySelector('tbody');
  tbody.id = 'cxc-tabla-cuentas-' + (nombreCliente || 'todas');

  const cuentasOrdenadas = cuentas.slice().sort((a, b) => (a.fechaVenta < b.fechaVenta ? 1 : -1));

  cuentasOrdenadas.forEach((c) => {
    const fila = document.createElement('tr');
    const valores = [
      c.folio, ...(conCliente ? [c.cliente] : []), c.material, window.formatearKg(c.cantidad, c.material),
      window.formatearMoneda(c.precioUnitario), window.formatearMoneda(c.total),
      window.formatearMoneda(c.pagado), window.formatearMoneda(c.saldo),
      c.estado, window.formatearFecha(c.fechaVenta)
    ];
    valores.forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });

    const abonos = c.abonos || [];
    const celdaAbonos = document.createElement('td');
    const btnAbonos = document.createElement('button');
    btnAbonos.className = 'btn-secondary';
    btnAbonos.textContent = (cxcAbonoExpandido === c.id ? 'Ocultar' : 'Ver') + ` (${abonos.length})`;
    btnAbonos.disabled = abonos.length === 0;
    btnAbonos.addEventListener('click', () => {
      cxcAbonoExpandido = cxcAbonoExpandido === c.id ? null : c.id;
      renderizarVistaActiva();
    });
    celdaAbonos.appendChild(btnAbonos);
    fila.appendChild(celdaAbonos);
    tbody.appendChild(fila);

    if (cxcAbonoExpandido === c.id && abonos.length > 0) {
      const filaDetalle = document.createElement('tr');
      const celdaDetalle = document.createElement('td');
      celdaDetalle.colSpan = conCliente ? 11 : 10;
      const subtabla = document.createElement('table');
      subtabla.className = 'tabla-destaraje';
      subtabla.style.margin = '0.5rem 0';
      subtabla.innerHTML = `
        <thead><tr><th data-tipo="fecha">Fecha</th><th data-tipo="moneda">Monto</th><th data-tipo="texto">Referencia</th><th data-tipo="texto">Registrado por</th><th></th></tr></thead>
        <tbody></tbody>
      `;
      const subtbody = subtabla.querySelector('tbody');
      abonos.forEach((abono) => {
        const filaAbono = document.createElement('tr');
        [window.formatearFecha(abono.fecha), window.formatearMoneda(abono.monto), abono.referencia || '', abono.registradoPor].forEach((valor) => {
          const celda = document.createElement('td');
          celda.textContent = valor;
          filaAbono.appendChild(celda);
        });
        const celdaAccion = document.createElement('td');
        if (window.puedeEscribir('cxc')) {
          const btnRevertir = document.createElement('button');
          btnRevertir.className = 'btn-secondary';
          btnRevertir.textContent = 'Revertir';
          btnRevertir.addEventListener('click', async () => {
            const motivo = window.prompt('Motivo de la reversión (obligatorio):');
            if (motivo === null || !motivo.trim()) return;
            const botones = Array.from(subtbody.querySelectorAll('button'));
            botones.forEach((btn) => { btn.disabled = true; });
            try {
              await revertirAbonoCxC(c.id, abono.abonoId, motivo.trim(), usuarioActual());
              window.showSuccess('Abono revertido');
              renderizarVistaActiva();
            } catch (error) {
              window.showError(error.message);
              botones.forEach((btn) => { btn.disabled = false; });
            }
          });
          celdaAccion.appendChild(btnRevertir);
        }
        filaAbono.appendChild(celdaAccion);
        subtbody.appendChild(filaAbono);
      });
      window.activarOrdenamiento(subtabla);
      celdaDetalle.appendChild(subtabla);
      filaDetalle.appendChild(celdaDetalle);
      tbody.appendChild(filaDetalle);
    }
  });

  window.activarOrdenamiento(tabla);
  tablaWrapper.appendChild(tabla);
  return tablaWrapper;
}

// ── Vista "Todos" ────────────────────────────────────────────────────────

function crearTabsTodos() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
    { id: 'mes', nombre: 'Este Mes' },
    { id: 'ultimos30', nombre: 'Últimos 30 días' },
    { id: 'personalizado', nombre: 'Personalizado' }
  ];
  definiciones.forEach((def) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (def.id === tabTodos ? ' active' : '');
    boton.textContent = def.nombre;
    boton.addEventListener('click', () => {
      tabTodos = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === boton));
      llenarVistaTodos();
      llenarResumenGeneral();
    });
    nav.appendChild(boton);
  });
  return nav;
}

function crearBarraFiltrosTodos() {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = 'cxc-filtros-todos';
  div.innerHTML = `
    <div class="form-grid">
      <input type="text" id="cxc-filtro-cliente" placeholder="Cliente" list="cxc-filtro-clientes">
      <datalist id="cxc-filtro-clientes"></datalist>
      <input type="text" id="cxc-filtro-folio" placeholder="Folio">
    </div>
    <div class="form-grid" id="cxc-filtros-personalizado">
      <input type="date" id="cxc-filtro-desde" placeholder="Desde">
      <input type="date" id="cxc-filtro-hasta" placeholder="Hasta">
      <input type="text" id="cxc-filtro-material" placeholder="Material">
      <select id="cxc-filtro-estado">
        <option value="">Todos los estados</option>
        <option value="pendiente">Pendiente</option>
        <option value="parcial">Parcial</option>
        <option value="liquidado">Liquidado</option>
      </select>
    </div>
  `;
  // Cliente y Folio filtran mientras se escribe; las fechas, el material y el estado al cambiar.
  ['desde', 'hasta', 'cliente', 'folio', 'material', 'estado'].forEach((campo) => {
    div.querySelector(`#cxc-filtro-${campo}`).addEventListener(campo === 'cliente' || campo === 'folio' ? 'input' : 'change', (evento) => {
      filtrosTodos[campo] = evento.target.value;
      llenarVistaTodos();
    });
  });
  return div;
}

function crearVistaTodos() {
  const wrapper = document.createElement('div');
  wrapper.id = 'cxc-todos-wrapper';
  wrapper.style.display = 'none';
  wrapper.appendChild(crearTabsTodos());
  wrapper.appendChild(crearBarraFiltrosTodos());
  const contenido = document.createElement('div');
  contenido.id = 'cxc-todos-contenido';
  wrapper.appendChild(contenido);
  return wrapper;
}

// Cuentas que muestra la pestaña Todos: el periodo de la subpestaña (Personalizado: sus fechas; vacías = sin límite de fecha, así
// un cliente liquidado y viejo se encuentra) más el filtro por cliente y por folio, que aplican en TODAS las subpestañas.
// Cliente y folio buscan por contenido, sin distinguir mayúsculas; la lista y el CSV usan este mismo resultado.
function cuentasDeVistaTodos() {
  const cuentas = window.EVE.cuentasPorCobrar || [];
  const porPeriodo = tabTodos === 'personalizado'
    ? filtrarCxC(cuentas, { ...filtrosTodos, cliente: '' })
    : filtrarCxC(cuentas, calcularRangoPeriodoCxC(tabTodos));
  const cliente = window.normalizarCliente(filtrosTodos.cliente);
  const folio = String(filtrosTodos.folio || '').trim().toLowerCase();
  return porPeriodo.filter((c) => (!cliente || window.normalizarCliente(c.cliente).includes(cliente))
    && (!folio || String(c.folio).toLowerCase().includes(folio)));
}

function llenarVistaTodos() {
  const personalizado = document.getElementById('cxc-filtros-personalizado');
  if (personalizado) personalizado.style.display = tabTodos === 'personalizado' ? '' : 'none';
  llenarSugerenciasClientes(document.getElementById('cxc-filtro-clientes'));

  const cuentas = cuentasDeVistaTodos();

  const contenido = document.getElementById('cxc-todos-contenido');
  if (!contenido) return;
  contenido.innerHTML = '';
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card';
  if (cuentas.length === 0) {
    const vacio = document.createElement('p');
    vacio.textContent = filtrosTodos.cliente || filtrosTodos.folio ? 'Sin registros con ese filtro' : 'Sin registros en este periodo';
    tarjeta.appendChild(vacio);
  } else {
    tarjeta.appendChild(crearTablaCuentas(cuentas, null));
  }
  contenido.appendChild(tarjeta);
  actualizarVisibilidadBotonCapturaCxC();
}

function renderizarVistaActiva() {
  llenarResumenGeneral();
  const wrapperClientes = document.getElementById('cxc-clientes-wrapper');
  const wrapperTodos = document.getElementById('cxc-todos-wrapper');
  if (wrapperClientes) wrapperClientes.style.display = vistaActiva === 'clientes' ? '' : 'none';
  if (wrapperTodos) wrapperTodos.style.display = vistaActiva === 'todos' ? '' : 'none';
  if (vistaActiva === 'clientes') {
    llenarVistaClientes();
  } else {
    llenarVistaTodos();
  }
  actualizarVisibilidadBotonCapturaCxC();
}

// ── Modal Registrar Pago ────────────────────────────────────────────────

// Facturas del cliente con saldo: una por venta, con sus partidas y el saldo total (suma de los saldos de las partidas).
function listarFacturasPendientes(cliente) {
  const facturas = new Map();
  window.EVE.cuentasPorCobrar
    .filter((c) => c.cliente === cliente && c.saldo > 0.001)
    .forEach((c) => {
      if (!facturas.has(c.ventaId)) facturas.set(c.ventaId, { ventaId: c.ventaId, folio: c.folio, partidas: [], saldo: 0 });
      const factura = facturas.get(c.ventaId);
      factura.partidas.push(c);
      factura.saldo += c.saldo;
    });
  return Array.from(facturas.values());
}

function buscarFacturaPendiente(cliente, folio) {
  return listarFacturasPendientes(cliente).find((f) => String(f.folio) === String(folio)) || null;
}

function llenarDatalistFoliosCliente(cliente) {
  const datalist = document.getElementById('cxc-modal-folios');
  if (!datalist) return;
  datalist.innerHTML = '';
  listarFacturasPendientes(cliente).forEach((f) => {
    const option = document.createElement('option');
    option.value = f.folio;
    option.textContent = `${f.folio} — saldo de la factura ${window.formatearMoneda(f.saldo)}`;
    datalist.appendChild(option);
  });
}

// Con un folio de factura elegido muestra el reparto por partida del monto capturado y, si lo excede, avisa que el sobrante quedará como saldo a favor.
function actualizarVistaPreviaFactura() {
  const preview = document.getElementById('cxc-modal-preview');
  const botonGuardar = document.getElementById('cxc-modal-guardar');
  if (!preview || !botonGuardar) return;
  preview.innerHTML = '';
  botonGuardar.disabled = false;
  const folio = document.getElementById('cxc-modal-folio').value.trim();
  const factura = modalContexto && folio ? buscarFacturaPendiente(modalContexto.cliente, folio) : null;
  if (!factura) return;
  const monto = Number(document.getElementById('cxc-modal-monto').value) || 0;
  const { aplicaciones, saldoTotal } = window.EVE_CXC.repartirCobroFactura(factura.partidas, monto);
  const excede = monto > saldoTotal + 0.01;

  const resumen = document.createElement('p');
  resumen.textContent = `Saldo de la factura ${factura.folio}: ${window.formatearMoneda(saldoTotal)}`
    + (excede ? ` — el sobrante de ${window.formatearMoneda(monto - saldoTotal)} se registrará como saldo a favor del cliente` : '');
  if (excede) resumen.style.color = '#1a5276';
  preview.appendChild(resumen);

  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = '<thead><tr><th>Material</th><th>Saldo antes</th><th>Cobro</th><th>Saldo después</th></tr></thead><tbody></tbody>';
  const tbody = tabla.querySelector('tbody');
  aplicaciones.forEach(({ cuenta, monto: cobro }) => {
    const fila = document.createElement('tr');
    [cuenta.material, cuenta.saldo, cobro, Math.max(0, cuenta.saldo - cobro)].forEach((valor, i) => {
      const celda = document.createElement('td');
      celda.textContent = i === 0 ? valor : window.formatearMoneda(valor);
      fila.appendChild(celda);
    });
    tbody.appendChild(fila);
  });
  preview.appendChild(tabla);
}

function alCambiarFolioModal() {
  const folio = document.getElementById('cxc-modal-folio').value.trim();
  const factura = modalContexto && folio ? buscarFacturaPendiente(modalContexto.cliente, folio) : null;
  if (factura) document.getElementById('cxc-modal-monto').value = String(Math.round(factura.saldo * 100) / 100);
  actualizarVistaPreviaFactura();
}

function crearModalPago() {
  const overlay = document.createElement('div');
  overlay.id = 'cxc-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Registrar Pago</h3>
      <form id="cxc-modal-form">
        <p id="cxc-modal-cliente" style="font-weight:600"></p>
        <input type="text" id="cxc-modal-folio" placeholder="Folio de la factura (opcional — vacío = pago general)" list="cxc-modal-folios">
        <datalist id="cxc-modal-folios"></datalist>
        <input type="number" id="cxc-modal-monto" placeholder="Monto" step="0.01" min="0.01" required>
        <div id="cxc-modal-preview"></div>
        <input type="date" id="cxc-modal-fecha" required>
        <input type="text" id="cxc-modal-referencia-deposito" placeholder="Referencia de depósito (opcional)">
        <select id="cxc-modal-referencia">
          <option value="Efectivo">Efectivo</option>
          <option value="Transferencia">Transferencia</option>
          <option value="Cheque">Cheque</option>
        </select>
        <button type="submit" id="cxc-modal-guardar" class="btn-primary">Guardar</button>
        <button type="button" id="cxc-modal-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#cxc-modal-form').addEventListener('submit', manejarEnvioPago);
  overlay.querySelector('#cxc-modal-folio').addEventListener('input', alCambiarFolioModal);
  overlay.querySelector('#cxc-modal-monto').addEventListener('input', actualizarVistaPreviaFactura);
  overlay.querySelector('#cxc-modal-cancelar').addEventListener('click', () => cerrarModalPago());
  return overlay;
}

function abrirModalPago(cliente) {
  modalContexto = { cliente };
  document.getElementById('cxc-modal-form').reset();
  document.getElementById('cxc-modal-cliente').textContent = cliente;
  document.getElementById('cxc-modal-fecha').value = window.obtenerFechaMexico();
  llenarDatalistFoliosCliente(cliente);
  actualizarVistaPreviaFactura();
  document.getElementById('cxc-modal-overlay').classList.add('open');
}

function cerrarModalPago() {
  document.getElementById('cxc-modal-overlay').classList.remove('open');
  modalContexto = null;
}

// Si el monto supera lo adeudado, pide confirmar con el cliente y el monto que quedará como saldo a favor. true = continuar.
function confirmarSobranteCobro(cliente, monto, adeudado) {
  const sobrante = Math.round((monto - adeudado) * 100) / 100;
  if (sobrante <= 0.01) return true;
  const detalle = adeudado > 0.01
    ? `Se aplicarán ${window.formatearMoneda(adeudado)} a las cuentas de ${cliente} y ${window.formatearMoneda(sobrante)} se registrarán como saldo a favor de ${cliente}.`
    : `${cliente} no tiene cuentas pendientes: los ${window.formatearMoneda(monto)} completos se registrarán como saldo a favor de ${cliente}.`;
  return window.confirm(`${detalle}\n\n¿Confirmas?`);
}

function avisoSobranteCobro(cliente, sobrante) {
  return `El sobrante de ${window.formatearMoneda(sobrante)} quedó registrado como saldo a favor de ${cliente}`;
}

async function manejarEnvioPago(evento) {
  evento.preventDefault();
  if (!modalContexto || envioPagoEnCurso) return;
  const folio = document.getElementById('cxc-modal-folio').value.trim();
  const monto = Number(document.getElementById('cxc-modal-monto').value);
  const fecha = document.getElementById('cxc-modal-fecha').value;
  const referencia = document.getElementById('cxc-modal-referencia').value;
  const referenciaDeposito = document.getElementById('cxc-modal-referencia-deposito').value.trim();
  const usuario = usuarioActual();

  if (!Number.isFinite(monto) || monto <= 0) {
    window.showError('El monto debe ser mayor a 0');
    return;
  }

  const botonGuardar = document.getElementById('cxc-modal-guardar');
  await window.protegerContraDobleRegistro('cxc-cobro', async () => {
    envioPagoEnCurso = true;
    botonGuardar.disabled = true;
    try {
      let mensajeExito;
      if (folio) {
        const factura = buscarFacturaPendiente(modalContexto.cliente, folio);
        if (!factura) {
          window.showError('No se encontró una factura con saldo pendiente con ese folio para este cliente');
          return false;
        }
        if (!confirmarSobranteCobro(modalContexto.cliente, monto, repartirCobroFactura(factura.partidas, monto).saldoTotal)) return false;
        const resultado = await registrarCobroFactura(modalContexto.cliente, factura.ventaId, { monto, fecha, referencia, referenciaDeposito });
        mensajeExito = `Cobro registrado: ${window.formatearMoneda(resultado.total)} aplicados a ${resultado.partidas} partida(s) de la factura ${factura.folio}`
          + (resultado.sobrante > 0 ? `. ${avisoSobranteCobro(modalContexto.cliente, resultado.sobrante)}` : '');
      } else {
        // Sin cuentas pendientes ya no se rechaza: todo el monto va a saldo a favor (con confirmación).
        const adeudado = window.EVE.cuentasPorCobrar
          .filter((c) => c.cliente === modalContexto.cliente && c.saldo > 0)
          .reduce((suma, c) => suma + c.saldo, 0);
        if (!confirmarSobranteCobro(modalContexto.cliente, monto, adeudado)) return false;
        const resultado = await registrarCobroGeneral(modalContexto.cliente, monto, fecha, referencia, usuario, referenciaDeposito);
        mensajeExito = resultado.sobranteRegistrado > 0
          ? `Pago aplicado. ${avisoSobranteCobro(modalContexto.cliente, resultado.sobranteRegistrado)}`
          : 'Pago registrado';
      }
      cerrarModalPago();
      renderizarVistaActiva();
      window.showSuccess(mensajeExito);
    } catch (error) {
      window.showError(error.message);
      return false;
    } finally {
      envioPagoEnCurso = false;
      actualizarVistaPreviaFactura();
    }
  });
}

// ── Registrar anticipo de cliente (botón del encabezado) ─────────────────────────────────────────────────

let envioAnticipoEnCurso = false;

function crearBarraAnticipoCliente() {
  const div = document.createElement('div');
  div.id = 'cxc-barra-anticipo';
  div.style.cssText = 'margin:0.5rem 0';
  if (window.puedeEscribir('cxc')) {
    const boton = document.createElement('button');
    boton.className = 'btn-secondary';
    boton.id = 'cxc-anticipo-abrir';
    boton.textContent = 'Registrar anticipo de cliente';
    boton.addEventListener('click', abrirModalAnticipo);
    div.appendChild(boton);
  }
  return div;
}

function crearModalAnticipo() {
  const overlay = document.createElement('div');
  overlay.id = 'cxc-anticipo-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Registrar anticipo de cliente</h3>
      <p>El monto completo se registra como saldo a favor del cliente; no se reparte contra sus cuentas pendientes.</p>
      <form id="cxc-anticipo-form">
        <input type="text" id="cxc-anticipo-cliente" placeholder="Cliente" list="cxc-anticipo-clientes" required>
        <datalist id="cxc-anticipo-clientes"></datalist>
        <input type="number" id="cxc-anticipo-monto" placeholder="Monto" step="0.01" min="0.01" required>
        <input type="date" id="cxc-anticipo-fecha" required>
        <select id="cxc-anticipo-referencia">
          <option value="Efectivo">Efectivo</option>
          <option value="Transferencia">Transferencia</option>
          <option value="Cheque">Cheque</option>
        </select>
        <input type="text" id="cxc-anticipo-nota" placeholder="Nota (opcional)">
        <button type="submit" id="cxc-anticipo-guardar" class="btn-primary">Guardar</button>
        <button type="button" id="cxc-anticipo-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#cxc-anticipo-form').addEventListener('submit', manejarEnvioAnticipo);
  overlay.querySelector('#cxc-anticipo-cancelar').addEventListener('click', cerrarModalAnticipo);
  return overlay;
}

function abrirModalAnticipo() {
  llenarSugerenciasClientes(document.getElementById('cxc-anticipo-clientes'));
  document.getElementById('cxc-anticipo-form').reset();
  document.getElementById('cxc-anticipo-fecha').value = window.obtenerFechaMexico();
  document.getElementById('cxc-anticipo-overlay').classList.add('open');
}

function cerrarModalAnticipo() {
  document.getElementById('cxc-anticipo-overlay').classList.remove('open');
}

// Confirmación del anticipo: siempre va íntegro a saldo a favor, tenga o no cuentas pendientes.
function confirmarAnticipoCliente(cliente, monto) {
  return window.confirm(`Se registrarán ${window.formatearMoneda(monto)} como saldo a favor de ${cliente}. No se aplicarán a sus cuentas pendientes.\n\n¿Confirmas?`);
}

// Deja la vista en Por Cliente → Todos para que la tarjeta del cliente se vea aunque no tenga deuda.
function mostrarPorClienteTodos() {
  vistaActiva = 'clientes';
  tabClientePeriodo = 'todos';
  [['cxc-tabs-principales', 'Por Cliente'], ['cxc-tabs-periodo-cliente', 'Todos']].forEach(([idNav, texto]) => {
    const nav = document.getElementById(idNav);
    if (nav) nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.textContent === texto));
  });
}

async function manejarEnvioAnticipo(evento) {
  evento.preventDefault();
  if (envioAnticipoEnCurso) return;
  const cliente = window.normalizarCliente(document.getElementById('cxc-anticipo-cliente').value);
  const monto = Number(document.getElementById('cxc-anticipo-monto').value);
  const fecha = document.getElementById('cxc-anticipo-fecha').value;
  const referencia = document.getElementById('cxc-anticipo-referencia').value;
  const nota = document.getElementById('cxc-anticipo-nota').value.trim();
  if (!cliente) { window.showError('El cliente es obligatorio'); return; }
  if (!Number.isFinite(monto) || monto <= 0) { window.showError('El monto debe ser mayor a 0'); return; }
  if (!fecha) { window.showError('La fecha es obligatoria'); return; }

  const botonGuardar = document.getElementById('cxc-anticipo-guardar');
  await window.protegerContraDobleRegistro('cxc-anticipo', async () => {
    envioAnticipoEnCurso = true;
    botonGuardar.disabled = true;
    try {
      if (!confirmarAnticipoCliente(cliente, monto)) return false;
      await registrarAnticipoManual(cliente, monto, fecha, referencia, nota);
      cerrarModalAnticipo();
      mostrarPorClienteTodos();
      renderizarVistaActiva();
      window.showSuccess(`Anticipo de ${window.formatearMoneda(monto)} registrado como saldo a favor de ${cliente}`);
    } catch (error) {
      window.showError(error.message);
      return false;
    } finally {
      envioAnticipoEnCurso = false;
      botonGuardar.disabled = false;
    }
  });
}

// ── Exportar CSV ─────────────────────────────────────────────────────────

function construirFilasCSVCxCResumen(cuentas) {
  return cuentas.map((c) => ({
    'Folio': c.folio,
    'Cliente': c.cliente,
    'Material': c.material,
    'Cantidad': c.cantidad,
    'Fecha Venta': c.fechaVenta,
    'Precio Unitario': c.precioUnitario,
    'Total': c.total,
    'Pagado': c.pagado,
    'Saldo': c.saldo,
    'Estado': c.estado,
    'Cantidad Abonos': (c.abonos || []).length
  }));
}

function construirFilasCSVCxCAbonos(cuentas) {
  const filas = [];
  cuentas.forEach((c) => {
    (c.abonos || []).forEach((a) => {
      filas.push({
        'Folio': c.folio,
        'Cliente': c.cliente,
        'Material': c.material,
        'Monto': a.monto,
        'Fecha': a.fecha,
        'Referencia': a.referencia || '',
        'Registrado Por': a.registradoPor || '',
        'Grupo Pago ID': a.grupoPagoId || ''
      });
    });
  });
  return filas;
}

function obtenerCuentasSegunTabActivo() {
  if (vistaActiva === 'todos') return cuentasDeVistaTodos();
  const cuentas = window.EVE.cuentasPorCobrar || [];
  const periodoActivo = obtenerPeriodoActivoInfo();
  if (!periodoActivo) return cuentas;
  return filtrarCxC(cuentas, { desde: periodoActivo.desde, hasta: periodoActivo.hasta });
}

function exportarCxCCSV() {
  const cuentas = obtenerCuentasSegunTabActivo();
  const fecha = window.obtenerFechaMexico();
  window.exportarCSV(construirFilasCSVCxCResumen(cuentas), `cuentas_por_cobrar_detalle_${fecha}.csv`);
  window.exportarCSV(construirFilasCSVCxCAbonos(cuentas), `cuentas_por_cobrar_abonos_${fecha}.csv`);
}

function crearBarraExportarCxC() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const btn = document.createElement('button');
  btn.textContent = 'Exportar CSV';
  btn.className = 'btn-secondary';
  btn.addEventListener('click', () => exportarCxCCSV());
  div.appendChild(btn);

  const btnCaptura = document.createElement('button');
  btnCaptura.id = 'btn-vista-captura-cxc';
  btnCaptura.textContent = 'Vista para captura';
  btnCaptura.className = 'btn-secondary';
  btnCaptura.addEventListener('click', () => {
    if (vistaActiva === 'todos') {
      abrirVistaCapturaCxCTodosPersonalizado();
    } else {
      abrirVistaCapturaCxC();
    }
  });
  div.appendChild(btnCaptura);
  return div;
}

// ===== Vista para captura (Por Cliente, todos los tabs de periodo) =====

const COLUMNAS_CAPTURA_CXC = [
  { clave: 'cliente', etiqueta: 'Cliente', ancho: '65%', truncar: false },
  {
    clave: 'saldo', etiqueta: 'Saldo por cobrar', ancho: '35%', alineacion: 'right', truncar: true,
    formato: (valor) => window.formatearMoneda(valor)
  }
];

function construirEtiquetaPeriodoCapturaCxC() {
  const periodoActivo = obtenerPeriodoActivoInfo();
  if (!periodoActivo) return 'Todos';
  const rango = periodoActivo.desde === periodoActivo.hasta
    ? window.formatearFecha(periodoActivo.desde)
    : `${window.formatearFecha(periodoActivo.desde)} al ${window.formatearFecha(periodoActivo.hasta)}`;
  return `${periodoActivo.nombre} · ${rango}`;
}

function abrirVistaCapturaCxC() {
  const cuentas = obtenerCuentasSegunTabActivo();
  const grupos = agregarPorClienteCxC(cuentas)
    .filter((g) => g.saldo > 0)
    .sort((a, b) => b.saldo - a.saldo);
  const hayGrupos = grupos.length > 0;
  const totalPeriodo = grupos.reduce((suma, g) => suma + g.saldo, 0);
  const { total: totalGeneral } = calcularTotalPorCobrarGeneral();

  window.VistaCaptura.abrir({
    titulo: 'CxC · Por Cliente',
    periodo: construirEtiquetaPeriodoCapturaCxC(),
    kpis: [
      { label: 'Total del periodo', valor: window.formatearMoneda(totalPeriodo) },
      { label: 'Total por Cobrar General', valor: window.formatearMoneda(totalGeneral) }
    ],
    columnas: COLUMNAS_CAPTURA_CXC,
    filas: hayGrupos ? grupos : undefined,
    vacioMensaje: 'Sin saldo pendiente en este periodo'
  });
}

// ===== Vista para captura (Todos · Personalizado, con filtro de fecha) =====
// CxC no tiene un tab "Rango" dentro de Por Cliente (a diferencia de CxP) —
// el único filtro por fecha real en el módulo vive en el tab 'Todos' →
// 'Personalizado' (filtrosTodos.desde/hasta), así que ambos casos pedidos
// (periodo personalizado con rango, y filtro de fecha con resultados) se
// resuelven aquí, reutilizando filtrarCxC(cuentas, filtrosTodos) — el mismo
// filtro que ya usa llenarVistaTodos() para esa pestaña, sin consulta aparte.

function construirEtiquetaDiaORangoCxC(desde, hasta) {
  if (desde && hasta && desde !== hasta) {
    return `Del ${window.formatearFecha(desde)} al ${window.formatearFecha(hasta)}`;
  }
  const fecha = desde || hasta;
  return `Día ${window.formatearFecha(fecha)}`;
}

function hayFiltroFechaActivoCxCTodos() {
  return tabTodos === 'personalizado' && Boolean(filtrosTodos.desde || filtrosTodos.hasta);
}

function abrirVistaCapturaCxCTodosPersonalizado() {
  const cuentas = cuentasDeVistaTodos();
  const grupos = agregarPorClienteCxC(cuentas)
    .filter((g) => g.saldo > 0)
    .sort((a, b) => b.saldo - a.saldo);
  const hayGrupos = grupos.length > 0;
  const totalPeriodo = grupos.reduce((suma, g) => suma + g.saldo, 0);
  const { total: totalGeneral } = calcularTotalPorCobrarGeneral();

  window.VistaCaptura.abrir({
    titulo: 'CxC · Todos (Personalizado)',
    periodo: construirEtiquetaDiaORangoCxC(filtrosTodos.desde, filtrosTodos.hasta),
    kpis: [
      { label: 'Total del periodo', valor: window.formatearMoneda(totalPeriodo) },
      { label: 'Total por Cobrar General', valor: window.formatearMoneda(totalGeneral) }
    ],
    columnas: COLUMNAS_CAPTURA_CXC,
    filas: hayGrupos ? grupos : undefined,
    vacioMensaje: 'Sin saldo pendiente en este periodo'
  });
}

function actualizarVisibilidadBotonCapturaCxC() {
  const boton = document.getElementById('btn-vista-captura-cxc');
  if (!boton) return;
  if (vistaActiva === 'clientes') {
    boton.style.display = '';
    return;
  }
  if (vistaActiva === 'todos' && hayFiltroFechaActivoCxCTodos()) {
    const hayGrupos = agregarPorClienteCxC(cuentasDeVistaTodos()).some((g) => g.saldo > 0);
    boton.style.display = hayGrupos ? '' : 'none';
    return;
  }
  boton.style.display = 'none';
}

function renderCxC(container) {
  vistaActiva = 'clientes';
  tabClientePeriodo = 'todos';
  clienteExpandido = null;
  saldoFavorClienteExpandido = null;
  cxcAbonoExpandido = null;
  tabTodos = 'semana';
  filtrosTodos = { desde: '', hasta: '', cliente: '', material: '', estado: '' };

  container.appendChild(crearResumenGeneral());
  container.appendChild(crearBarraAnticipoCliente());
  container.appendChild(crearTabsPrincipales());
  container.appendChild(crearBarraExportarCxC());
  container.appendChild(crearVistaClientes());
  container.appendChild(crearVistaTodos());
  container.appendChild(crearModalPago());
  container.appendChild(crearModalAnticipo());

  renderizarVistaActiva();
}

window.EVE_MODULES.cxc = { render: renderCxC };

})();
