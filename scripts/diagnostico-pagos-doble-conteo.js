// Diagnóstico del doble conteo en Compras > Pagos (SOLO LECTURA). Se PEGA en la consola del navegador con la sesión de EVE Control
// iniciada (F12 → Consola → pegar todo este archivo → Enter). No es parte de la app y no se carga desde index.html.
//
// Qué hace: lista cada ticket (ticket + proveedor + material) con VARIOS pagos activos y, de cada abono, el ticket, proveedor, material,
// kg, total, pagado y fechaRegistro. Por ticket calcula cuántos kg y cuánto total se suman «hoy» (registro por registro, el error) frente
// a lo que debe contar (una vez: el abono más reciente, o la cuenta por pagar del ticket si existe). Al final da los totales: registros
// activos, tickets con varios pagos, kg de más y total de más. Descarga el resultado como JSON (diagnostico-pagos-doble-conteo.json) y
// también lo deja en window.__diagnosticoPagos y, si existe, lo copia con copy().
//
// No escribe ni borra nada: no llama a guardarDato, actualizarDato ni eliminarDato y no usa Firestore. Lee window.EVE.registrosPagos
// (los pagos que la app ya cargó al iniciar sesión) y window.EVE.cuentasPorPagar. Los pagos revertidos se ignoran.
(function diagnosticarPagosDobleConteo() {
  if (!window.EVE || !window.EVE.currentUser || !Array.isArray(window.EVE.registrosPagos)) {
    console.error('Diagnóstico de pagos: abre EVE Control, inicia sesión y vuelve a pegar el script.');
    return;
  }

  const norm = (v) => String(v === undefined || v === null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const noEsCompra = (p) => p.origen === 'anticipo' || !!p.abonoSaldoInicial;
  const claveOrden = (p) => String(p.fechaRegistro || '') + '|' + String(p.fecha || '') + '|' + String(p.id || '');

  const activos = window.EVE.registrosPagos.filter((p) => p && !p.revertido);
  const comprasConTicket = activos.filter((p) => !noEsCompra(p) && norm(p.ticket));
  const grupos = new Map();
  comprasConTicket.forEach((p) => {
    const clave = [norm(p.ticket), norm(p.proveedor), norm(p.material)].join('|');
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(p);
  });

  const cuentas = window.EVE.cuentasPorPagar || [];
  const tickets = [];
  grupos.forEach((abonos, clave) => {
    if (abonos.length < 2) return;
    const [ticket, proveedor, material] = clave.split('|');
    const ordenados = abonos.slice().sort((a, b) => (claveOrden(a) < claveOrden(b) ? 1 : -1)); // más reciente primero
    const cxp = cuentas.find((c) => norm(c.ticket) === ticket && norm(c.proveedor) === proveedor && (!norm(c.material) || norm(c.material) === material)) || null;
    const kgReal = Number(cxp && Number.isFinite(Number(cxp.kg)) ? cxp.kg : ordenados[0].kg) || 0;
    const totalReal = Number(cxp && Number.isFinite(Number(cxp.total)) ? cxp.total : ordenados[0].total) || 0;
    const kgSumadoHoy = abonos.reduce((s, a) => s + (Number(a.kg) || 0), 0);
    const totalSumadoHoy = abonos.reduce((s, a) => s + (Number(a.total) || 0), 0);
    const pagado = redondear(abonos.reduce((s, a) => s + (Number(a.pagado) || 0), 0));
    tickets.push({
      ticket: abonos[0].ticket,
      proveedor: abonos[0].proveedor,
      material: abonos[0].material,
      abonos: ordenados.slice().reverse().map((a) => ({
        id: a.id, ticket: a.ticket, proveedor: a.proveedor, material: a.material,
        kg: Number(a.kg) || 0, total: Number(a.total) || 0, pagado: Number(a.pagado) || 0, fecha: a.fecha || '', fechaRegistro: a.fechaRegistro || '', origen: a.origen || ''
      })),
      cantidadAbonos: abonos.length,
      kgSumadoHoy, kgReal, kgDeMas: redondear(kgSumadoHoy - kgReal),
      totalSumadoHoy: redondear(totalSumadoHoy), totalReal: redondear(totalReal), totalDeMas: redondear(totalSumadoHoy - totalReal),
      pagado, deudaReal: Math.max(0, redondear(totalReal - pagado)),
      kgDistintosEntreAbonos: new Set(abonos.map((a) => Number(a.kg) || 0)).size > 1,
      totalDistintosEntreAbonos: new Set(abonos.map((a) => Number(a.total) || 0)).size > 1,
      usaCuentaPorPagar: !!cxp
    });
  });
  tickets.sort((a, b) => b.kgDeMas - a.kgDeMas || String(a.ticket).localeCompare(String(b.ticket), 'es', { numeric: true }));

  const resultado = {
    generadoEn: new Date().toISOString(),
    fuente: 'memoria de la app (window.EVE.registrosPagos y cuentasPorPagar); sin lecturas ni escrituras en Firestore',
    registrosActivos: activos.length,
    comprasConTicket: comprasConTicket.length,
    ticketsConVariosPagos: tickets.length,
    abonosEnEsosTickets: tickets.reduce((s, t) => s + t.cantidadAbonos, 0),
    kgDeMas: redondear(tickets.reduce((s, t) => s + t.kgDeMas, 0)),
    totalDeMas: redondear(tickets.reduce((s, t) => s + t.totalDeMas, 0)),
    tickets
  };

  console.group(`Pagos: ${resultado.registrosActivos} registros activos, ${resultado.ticketsConVariosPagos} ticket(s) con varios pagos, ${resultado.kgDeMas} kg de más, $${resultado.totalDeMas} de total de más`);
  if (tickets.length > 0) {
    console.table(tickets.map((t) => ({
      ticket: t.ticket, proveedor: t.proveedor, material: t.material, abonos: t.cantidadAbonos,
      kgPorAbono: t.abonos.map((a) => a.kg).join(' + '), totalPorAbono: t.abonos.map((a) => a.total).join(' + '), pagadoPorAbono: t.abonos.map((a) => a.pagado).join(' + '),
      fechasRegistro: t.abonos.map((a) => a.fechaRegistro).join(' → '), kgDeMas: t.kgDeMas, totalDeMas: t.totalDeMas
    })));
  } else {
    console.log('Ningún ticket tiene varios pagos activos.');
  }
  console.groupEnd();

  const json = JSON.stringify(resultado, null, 2);
  window.__diagnosticoPagos = resultado;
  console.log('Resultado completo (JSON):');
  console.log(json);
  try {
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8;' }));
    enlace.download = 'diagnostico-pagos-doble-conteo.json';
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
  } catch (error) {
    console.warn('No se pudo descargar el archivo; usa el JSON de arriba o window.__diagnosticoPagos.', error);
  }
  if (typeof copy === 'function') {
    try { copy(json); } catch (error) { /* sin portapapeles */ }
  }
  return resultado;
})();
