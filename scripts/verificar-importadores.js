// K19 — Verificación de los importadores "todo o nada con lista de errores por fila".
//
// Carga en un contexto vm los js/ reales (sin Firestore ni XLSX; db es un doble que registra los lotes)
// y ejercita los procesadores de js/admin-importar.js. Parte del script del anexo de
// docs/auditoria_importadores.md.
//
// Uso: node scripts/verificar-importadores.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['config.js', 'utils.js', 'rendimientos.js', 'precios.js', 'inventario.js', 'cxp.js', 'pagos.js', 'control-produccion.js', 'control-produccion-reglas.js', 'ventas.js', 'admin-importar.js'];

// Doble mínimo de Firestore: cada db.batch() registra sus operaciones y las deja en db.lotes al hacer commit.
function crearDbFalso() {
  const db = {
    lotes: [],
    batch() {
      const operaciones = [];
      return {
        set(ref, datos) { operaciones.push({ tipo: 'set', coleccion: ref.coleccion, id: ref.id, datos }); },
        update(ref, datos) { operaciones.push({ tipo: 'update', coleccion: ref.coleccion, id: ref.id, datos }); },
        delete(ref) { operaciones.push({ tipo: 'delete', coleccion: ref.coleccion, id: ref.id }); },
        async commit() { db.lotes.push(operaciones); }
      };
    },
    collection(coleccion) {
      return { doc: (id) => ({ coleccion, id: id || `auto${++db.contador}` }) };
    },
    contador: 0
  };
  return db;
}

function crearContexto() {
  const window = { EVE_MODULES: {} };
  window.window = window;
  window.EVE = {
    registrosDestaraje: [], registrosVentas: [], registrosControlProduccion: [], registrosPagos: [], cuentasPorPagar: [],
    proveedores: [], precios: [], ajustesPrecioProveedor: [], comisiones: [], auditorias: [], composiciones: [], ventas: [],
    inventarioInicial: [], inventario: [], fechaCorteAuditoria: '2026-07-01',
    currentUser: { username: 'prueba', permisosResueltos: { admin: 'escritura' } }
  };
  window.db = crearDbFalso();
  window.cargarDatosEnParalelo = async () => {};
  window.showError = (m) => { window.ultimoError = m; };
  window.showSuccess = (m) => { window.ultimoExito = m; };
  const firebase = { initializeApp() {}, firestore: () => ({ enablePersistence: () => ({ catch() {} }) }) };
  const el = () => ({ addEventListener() {}, appendChild() {}, querySelector: () => el(), querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} }, style: {} });
  const ctx = vm.createContext({ window, firebase, console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, XLSX: {}, document: { getElementById: () => null, createElement: el } });
  for (const f of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js', f), 'utf8'), ctx, { filename: f });
  }
  return window;
}

const window = crearContexto();
const I = window.EVE_ADMIN_IMPORTAR;

let fallos = 0;
const ok = (condicion, mensaje) => {
  if (!condicion) fallos++;
  console.log(`${condicion ? 'PASS' : 'FAIL'}  ${mensaje}`);
};
const reiniciar = () => {
  window.db = crearDbFalso();
  window.EVE.precios = []; window.EVE.ajustesPrecioProveedor = []; window.EVE.composiciones = [];
  window.EVE.ventas = []; window.EVE.inventarioInicial = []; window.EVE.registrosControlProduccion = [];
  window.EVE.registrosDestaraje = []; window.EVE.cuentasPorPagar = [];
  window.EVE.currentUser = { username: 'prueba', permisosResueltos: { admin: 'escritura' } };
};
const resultadoVacio = () => ({
  destaraje: [], pagos: [], saldosIniciales: [], inventarioInicial: [], controlProduccion: [],
  composiciones: [], ventas: [], preciosGenerales: [], ajustesProveedor: []
});
const filaPrecio = (material, precio, fecha) => ({ Material: material, Precio: precio, 'Fecha Vigencia': fecha, Notas: '' });
const filaInv = (material, etapa, kg) => ({ Material: material, Etapa: etapa, Kg: kg, Fecha: '', Nota: '' });
const filaVenta = (grupo, kg) => ({ 'Grupo Venta': grupo, Fecha: '10-06-2026', Cliente: 'C', 'Ticket Relacionado': '', Material: 'LECHERO', Kg: kg, Precio: 5, Total: '' });
const filaVacia = () => ({ Material: '', Precio: '', 'Fecha Vigencia': '', Notas: '' });
const rechaza = async (promesa) => { try { await promesa; return null; } catch (e) { return e; } };

(async () => {
  console.log('--- 1. Una fila inválida en CUALQUIER hoja bloquea todo (y no se escribe nada)');
  reiniciar();
  let r = resultadoVacio();
  r.preciosGenerales = I.procesarHojaPreciosGenerales([filaPrecio('LECHERO', 5, '01-08-2026')]);
  r.inventarioInicial = I.procesarHojaInventarioInicial([filaInv('LECHERO', 'RECEPCIÓN', 10), filaInv('LECHERO', 'ETAPA RARA', 5)]);
  ok(r.preciosGenerales[0].valido && r.inventarioInicial[0].valido && !r.inventarioInicial[1].valido, '1a. hay filas válidas en Precios e Inventario y una inválida en Inventario');
  ok(I.recopilarErrores(r).length === 1, '1b. recopilarErrores devuelve exactamente 1 error');
  ok(I.motivoBloqueoImportacion(r, 'agregar', true) !== null, '1c. motivoBloqueoImportacion bloquea (botón deshabilitado)');
  let e = await rechaza(I.ejecutarImportacion(r, 'agregar'));
  ok(e && e.bloqueo === true && window.db.lotes.length === 0 && window.db.contador === 0, '1d. ejecutarImportacion rechaza y NO escribe nada (0 lotes)');
  e = await rechaza(I.ejecutarImportacion(r, 'reemplazar'));
  ok(e && e.bloqueo === true && window.db.lotes.length === 0, '1e. en modo Reemplazar un error también bloquea ANTES de borrar nada');

  console.log('--- 2. Cero filas válidas bloquea; las advertencias/info NO bloquean');
  reiniciar();
  ok(I.motivoBloqueoImportacion(resultadoVacio(), 'agregar', true) !== null, '2a. archivo sin filas válidas: bloqueado');
  window.EVE.inventarioInicial = [{ material: 'LECHERO', etapa: 'SELECCIÓN', kg: 100, fecha: '2026-06-01' }];
  r = resultadoVacio();
  r.ventas = I.procesarHojaVentas([filaVenta('V1', 80), filaVenta('V2', 80)]);
  ok(r.ventas.every((x) => x.valido) && r.ventas.some((x) => x.advertencia), '2b. dos ventas válidas, una con advertencia de stock');
  ok(I.motivoBloqueoImportacion(r, 'agregar', true) === null, '2c. válidas con advertencia NO bloquean');

  console.log('--- 3. Inventario inicial: duplicado Material+Etapa en el archivo o ya existente');
  reiniciar();
  const ii = I.procesarHojaInventarioInicial([filaInv('LECHERO', 'RECEPCIÓN', 10), filaInv('LECHERO', 'RECEPCIÓN', 20)]);
  ok(ii.every((x) => !x.valido) && /Duplicado en el archivo/.test(ii[0].motivo), '3a. dos filas iguales quedan inválidas con el motivo');
  r = resultadoVacio(); r.inventarioInicial = ii;
  e = await rechaza(I.ejecutarImportacion(r, 'agregar'));
  ok(e && e.bloqueo && window.db.lotes.length === 0, '3b. el duplicado en el archivo bloquea todo');
  window.EVE.inventarioInicial = [{ material: 'LECHERO', etapa: 'RECEPCIÓN', kg: 5, fecha: '2026-06-01' }];
  r = resultadoVacio();
  r.preciosGenerales = I.procesarHojaPreciosGenerales([filaPrecio('LECHERO', 5, '01-08-2026')]);
  r.inventarioInicial = I.procesarHojaInventarioInicial([filaInv('LECHERO', 'RECEPCIÓN', 10)]);
  e = await rechaza(I.ejecutarImportacion(r, 'agregar'));
  ok(!r.inventarioInicial[0].valido && e && e.bloqueo && window.db.lotes.length === 0, '3c. el inventario ya existente bloquea todo (incluida la hoja de Precios válida)');

  console.log('--- 4. Duplicados dentro del archivo en Precios y Ajustes');
  reiniciar();
  const pr = I.procesarHojaPreciosGenerales([filaPrecio('LECHERO', 5, '01-08-2026'), filaPrecio('LECHERO', 6, '01-08-2026'), filaPrecio('LECHERO', 6, '02-08-2026')]);
  ok(!pr[0].valido && !pr[1].valido && pr[2].valido, '4a. Precios: mismo Material+Fecha inválidas; otra fecha válida');
  const aj = (prov, fecha) => ({ Material: 'LECHERO', Proveedor: prov, 'Tipo Ajuste': 'Monto', Valor: 0.5, 'Fecha Vigencia': fecha });
  const ajustes = I.procesarHojaAjustesProveedor([aj('JOSE', '01-08-2026'), aj('JOSE', '01-08-2026'), aj('FELIX', '01-08-2026')]);
  ok(!ajustes[0].valido && !ajustes[1].valido && ajustes[2].valido, '4b. Ajustes: mismo Material+Proveedor+Fecha inválidas; otro proveedor válido');

  console.log('--- 5. Ventas: el stock se acumula entre ventas del mismo archivo');
  reiniciar();
  window.EVE.inventarioInicial = [{ material: 'LECHERO', etapa: 'SELECCIÓN', kg: 100, fecha: '2026-06-01' }];
  const v = I.procesarHojaVentas([filaVenta('V1', 80), filaVenta('V2', 80)]);
  ok(v.every((x) => x.valido) && !v[0].advertencia && !!v[1].advertencia, '5. dos ventas de 80 kg con 100 kg de stock: la primera sin aviso y la SEGUNDA advierte');

  console.log('--- 6. Número de fila de Excel real, con filas vacías intermedias');
  reiniciar();
  const filas = [filaPrecio('LECHERO', 5, '01-08-2026'), filaVacia(), filaVacia(), filaPrecio('NO EXISTE', 5, '01-08-2026')];
  const pf = I.procesarHojaPreciosGenerales(filas);
  ok(pf.length === 2 && pf[0].filaExcel === 2 && pf[1].filaExcel === 5, '6a. sin __rowNum__: filas 2 y 5 (el índice cuenta las vacías)');
  const conRowNum = [filaPrecio('LECHERO', 5, '01-08-2026'), filaPrecio('NO EXISTE', 5, '01-08-2026')];
  Object.defineProperty(conRowNum[0], '__rowNum__', { value: 1, enumerable: false });
  Object.defineProperty(conRowNum[1], '__rowNum__', { value: 6, enumerable: false });
  const pr2 = I.procesarHojaPreciosGenerales(conRowNum);
  ok(pr2[0].filaExcel === 2 && pr2[1].filaExcel === 7, '6b. con __rowNum__ (sheet_to_json): filas 2 y 7');
  r = resultadoVacio(); r.preciosGenerales = pf;
  const errores = I.recopilarErrores(r);
  ok(errores.length === 1 && errores[0].hoja === 'Precios Generales' && errores[0].fila === 5 && /catálogo/.test(errores[0].motivo), '6c. recopilarErrores: {hoja, fila: 5, motivo}');
  const fv = (g, mat) => ({ 'Grupo Venta': g, Fecha: '10-06-2026', Cliente: 'C', 'Ticket Relacionado': '', Material: mat, Kg: 10, Precio: 5, Total: '' });
  const vg = I.procesarHojaVentas([fv('A', 'LECHERO'), { 'Grupo Venta': '', Fecha: '', Cliente: '', 'Ticket Relacionado': '', Material: '', Kg: '', Precio: '', Total: '' }, fv('A', 'XXX')]);
  ok(vg.length === 1 && !vg[0].valido && vg[0].filaExcel === 2 && vg[0].filasExcel.join() === '2,4' && /Fila 4/.test(vg[0].motivo), '6d. grupo de Ventas: filas 2 y 4 (la vacía no corre la numeración), motivo "Fila 4"');

  console.log('--- 7. Precios: cierre + nuevo en el MISMO db.batch()');
  reiniciar();
  window.EVE.precios = [{ id: 'viejo', material: 'LECHERO', precio: 4, fechaInicio: '2026-01-01', fechaFin: null }];
  r = resultadoVacio();
  r.preciosGenerales = I.procesarHojaPreciosGenerales([filaPrecio('LECHERO', 5, '01-08-2026')]);
  ok(r.preciosGenerales[0].valido && !!r.preciosGenerales[0].registro.cierre, '7a. la fila válida trae cierre del vigente anterior');
  const importadas = await I.ejecutarImportacion(r, 'agregar');
  const lote = window.db.lotes[0] || [];
  ok(importadas === 1 && window.db.lotes.length === 1 && lote.length === 2 && lote[0].tipo === 'update' && lote[0].id === 'viejo' && lote[1].tipo === 'set', '7b. UN solo lote con update del cierre + set del nuevo');
  ok(window.EVE.precios.length === 2 && window.EVE.precios[0].fechaFin !== null, '7c. la memoria local queda actualizada (cierre y nuevo)');
  const ops = [];
  for (let i = 0; i < 4; i++) ops.push({ tipo: 'update', unidoConSiguiente: true }, { tipo: 'set' });
  ok(I.dividirEnLotes(ops, 3).every((l) => l.length % 2 === 0) && I.dividirEnLotes(ops, 3).length === 4, '7d. dividirEnLotes nunca separa un cierre de su nuevo (lotes de 2 con tope 3)');

  console.log('--- 8. Modo Reemplazar solo para Admin');
  reiniciar();
  window.EVE.currentUser = { username: 'operador', permisosResueltos: { admin: 'lectura' } };
  r = resultadoVacio();
  r.preciosGenerales = I.procesarHojaPreciosGenerales([filaPrecio('LECHERO', 5, '01-08-2026')]);
  ok(I.motivoBloqueoImportacion(r, 'reemplazar', false) !== null, '8a. no-Admin: Reemplazar bloqueado');
  e = await rechaza(I.ejecutarImportacion(r, 'reemplazar'));
  ok(e && e.bloqueo && window.db.lotes.length === 0, '8b. no-Admin: ejecutarImportacion en Reemplazar no escribe ni borra');
  ok(I.motivoBloqueoImportacion(r, 'agregar', false) === null, '8c. no-Admin puede importar en modo Agregar');
  window.EVE.currentUser = { username: 'admin', permisosResueltos: { admin: 'escritura' } };
  window.EVE.registrosPagos = [{ id: 'p1' }];
  r.pagos = I.procesarHoja([{ Ticket: '9999', Proveedor: 'JOSE', Material: 'MIXTO', Kg: 100, 'Precio/Kg': 5, Total: 500, Pagado: 100, Fecha: '10-06-2026' }], I.procesarFilaPagos);
  ok(r.pagos[0].valido && I.motivoBloqueoImportacion(r, 'reemplazar', true) === null, '8d. Admin con archivo limpio: Reemplazar permitido');

  console.log('--- 9. Un error de escritura a mitad de importación se propaga (la limpieza del handler de la vista no se prueba aquí)');
  reiniciar();
  r = resultadoVacio();
  r.preciosGenerales = I.procesarHojaPreciosGenerales([filaPrecio('LECHERO', 5, '01-08-2026')]);
  window.db.batch = () => ({ set() {}, update() {}, delete() {}, async commit() { throw new Error('falla de red'); } });
  e = await rechaza(I.ejecutarImportacion(r, 'agregar'));
  ok(e && !e.bloqueo && /falla de red/.test(e.message), '9. el error de escritura se propaga a manejarConfirmarImportacion, que limpia resultadoParseo y deshabilita el botón');

  console.log('--- 10. Control Producción: avisos de etapa de origen (K18) como advertencia no bloqueante');
  reiniciar();
  const cp = (grupo, tipoProceso, tipoFila, material, kg, esMerma) => ({
    'Grupo/Proceso': grupo, 'Tipo Proceso': tipoProceso, 'Tipo Fila': tipoFila, Material: material, Kg: kg,
    'Ticket Origen': '', 'Es Merma': esMerma || '', Operador: 'ANA', Turno: 'Matutino', Fecha: '10-06-2026'
  });
  const filasCadena = [
    cp('A', 'SELECCION', 'ENTRADA', 'MIXTO', 100), cp('A', 'SELECCION', 'SALIDA', 'LECHERO', 90), cp('A', 'SELECCION', 'SALIDA', 'BASURA', 10, 'SI'),
    cp('B', 'MOLIENDA', 'ENTRADA', 'LECHERO', 90), cp('B', 'MOLIENDA', 'SALIDA', 'LECHERO MOLIDO', 85), cp('B', 'MOLIENDA', 'SALIDA', 'LODOS', 5, 'SI')
  ];
  window.EVE.inventarioInicial = [{ material: 'MIXTO', etapa: 'RECEPCIÓN', kg: 100, fecha: '2026-06-01' }];
  let cadena = I.procesarHojaControlProduccion(filasCadena);
  ok(cadena.length === 2 && cadena.every((x) => x.valido) && cadena.every((x) => !x.advertencia), '10a. Selección → Molienda en el mismo archivo con stock de RECEPCIÓN: sin avisos');
  window.EVE.inventarioInicial = [];
  cadena = I.procesarHojaControlProduccion(filasCadena);
  ok(cadena.every((x) => x.valido) && !!cadena[0].advertencia && !cadena[1].advertencia, '10b. sin stock de MIXTO solo la Selección avisa (la Molienda toma de la Selección del archivo) y ninguno bloquea');
  ok(I.motivoBloqueoImportacion({ ...resultadoVacio(), controlProduccion: cadena }, 'agregar', true) === null, '10c. las advertencias de origen no bloquean la importación');

  console.log('--- 11. Control Producción: advertencias de reglas del proceso (K21m), no bloqueantes y sin cambiar el esquema');
  reiniciar();
  window.EVE.inventarioInicial = [
    { material: 'MIXTO', etapa: 'RECEPCIÓN', kg: 1000, fecha: '2026-06-01' }, { material: 'LECHERO', etapa: 'SELECCIÓN', kg: 1000, fecha: '2026-06-01' },
    { material: 'P.E.', etapa: 'SELECCIÓN', kg: 1000, fecha: '2026-06-01' }, { material: 'P.E. MOLIDO', etapa: 'MOLIENDA', kg: 1000, fecha: '2026-06-01' },
    { material: 'PELLET CAJAS', etapa: 'PELETIZADO', kg: 1000, fecha: '2026-06-01' }
  ];
  const avisoDe = (filas) => { const r = I.procesarHojaControlProduccion(filas); return { r, aviso: r[0].advertencia || '' }; };
  let x = avisoDe([cp('A', 'MOLIENDA', 'ENTRADA', 'LECHERO', 100), cp('A', 'MOLIENDA', 'SALIDA', 'P.E. MOLIDO', 95), cp('A', 'MOLIENDA', 'SALIDA', 'LODOS', 5, 'SI')]);
  ok(x.r[0].valido && /no es el molido de la entrada \(se espera LECHERO MOLIDO\)/.test(x.aviso), '11a. Molienda de LECHERO con salida P.E. MOLIDO: advierte y la fila sigue siendo válida');
  x = avisoDe([cp('A', 'EMPACADO', 'ENTRADA', 'P.E.', 100), cp('A', 'EMPACADO', 'SALIDA', 'P.E. MOLIDO', 100)]);
  ok(x.r[0].valido && /no corresponde a Empacado/.test(x.aviso), '11b. Empacado con salida distinta de la entrada: advierte');
  x = avisoDe([cp('A', 'EMPACADO', 'ENTRADA', 'P.E.', 100), cp('A', 'EMPACADO', 'SALIDA', 'P.E.', 100)]);
  ok(x.r[0].valido && !x.aviso, '11c. Empacado correcto: sin advertencias');
  x = avisoDe([cp('A', 'PELETIZADO', 'ENTRADA', 'P.E. MOLIDO', 100), cp('A', 'PELETIZADO', 'SALIDA', 'P.E. MOLIDO', 95), cp('A', 'PELETIZADO', 'SALIDA', 'PIEDRAS', 5, 'SI')]);
  ok(x.r[0].valido && /no es un pellet/.test(x.aviso), '11d. Peletizado con un molido como salida: advierte');
  x = avisoDe([cp('A', 'PELETIZADO', 'ENTRADA', 'P.E. MOLIDO', 100), cp('A', 'PELETIZADO', 'SALIDA', 'PELLET CAJAS', 95), cp('A', 'PELETIZADO', 'SALIDA', 'PIEDRAS', 5, 'SI')]);
  ok(x.r[0].valido && !x.aviso, '11e. Peletizado con un pellet de salida: sin advertencias (no se modela ninguna fórmula)');
  x = avisoDe([cp('A', 'PRODUCCION_CAJAS', 'ENTRADA', 'PELLET CAJAS', 100), cp('A', 'PRODUCCION_CAJAS', 'SALIDA', 'CAJA AGRO20', 400), cp('A', 'PRODUCCION_CAJAS', 'SALIDA', 'RECHAZO TAMBOS', 5)]);
  ok(x.r[0].valido && /Para CAJA AGRO20 se espera PELLET AGRO20/.test(x.aviso) && /no es el rechazo de CAJA AGRO20/.test(x.aviso), '11f. pieza con pellet y rechazo que no son los del producto: dos advertencias');
  x = avisoDe([cp('A', 'PRODUCCION_CAJAS', 'ENTRADA', 'PELLET CAJAS', 100), cp('A', 'PRODUCCION_CAJAS', 'SALIDA', 'TAMBO', 400)]);
  ok(x.r[0].valido && /'TAMBO' no se produce en Inyección/.test(x.aviso), '11g. un producto de otro proceso: advierte');
  x = avisoDe([cp('A', 'SELECCION', 'ENTRADA', 'MIXTO', 100), cp('A', 'SELECCION', 'SALIDA', 'LECHERO', 90), cp('A', 'SELECCION', 'SALIDA', 'BASURA', 10, 'SI')]);
  ok(x.r[0].valido && !x.aviso, '11h. Selección sin composición vigente: no hay con qué comparar y no advierte');
  window.EVE.composiciones = [{ id: 'c1', materialEntrada: 'MIXTO', version: 1, fechaVigencia: '2026-01-01', fechaCierre: null, totalPorcentaje: 100,
    componentes: [{ subproducto: 'P.E.', porcentaje: 90, esMerma: false }, { subproducto: 'BASURA', porcentaje: 10, esMerma: true }] }];
  x = avisoDe([cp('A', 'SELECCION', 'ENTRADA', 'MIXTO', 100), cp('A', 'SELECCION', 'SALIDA', 'LECHERO', 90), cp('A', 'SELECCION', 'SALIDA', 'BASURA', 10, 'SI')]);
  ok(x.r[0].valido && /Salida 'LECHERO' no está en la composición vigente/.test(x.aviso), '11i. Selección con composición: una salida fuera de ella advierte');
  const importado = I.procesarHojaControlProduccion([cp('A', 'MOLIENDA', 'ENTRADA', 'LECHERO', 100), cp('A', 'MOLIENDA', 'SALIDA', 'P.E. MOLIDO', 95)]);
  const sinCambios = importado[0].registro;
  ok(Object.keys(sinCambios).join(',') === 'ticket,tipoProceso,inputs,outputs,operador,turno,fecha,totalInput,totalOutput,eficiencia,porcentajeMerma,observaciones' && !('mermaCalculada' in sinCambios) && sinCambios.inputs.every((i) => !('ticketOrigenInferido' in i)), '11j. el registro importado conserva el esquema de siempre: sin mermaCalculada ni ticketOrigenInferido (el archivo es explícito)');
  ok(I.motivoBloqueoImportacion({ ...resultadoVacio(), controlProduccion: importado }, 'agregar', true) === null, '11k. las advertencias de reglas no bloquean la importación (todo o nada de K19 intacto)');

  console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} caso(s) FALLARON`);
  process.exit(fallos === 0 ? 0 : 1);
})();
