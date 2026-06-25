(function () {

function validarFormatoFecha(texto) {
  if (typeof texto !== 'string') return false;
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(texto.trim());
  if (!match) return false;
  const dia = Number(match[1]);
  const mes = Number(match[2]);
  const anio = Number(match[3]);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const fecha = new Date(anio, mes - 1, dia);
  return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia;
}

function convertirFechaAISO(texto) {
  const [dia, mes, anio] = texto.trim().split('-');
  return `${anio}-${mes}-${dia}`;
}

window.EVE_ADMIN_IMPORTAR = {
  validarFormatoFecha,
  convertirFechaAISO
};

function esFilaVacia(fila) {
  return Object.values(fila).every((valor) => String(valor ?? '').trim() === '');
}

function procesarFilaDestaraje(fila) {
  const fechaEntradaTexto = String(fila['Fecha Entrada'] ?? '').trim();
  const fechaSalidaTexto = String(fila['Fecha Salida'] ?? '').trim();
  if (!validarFormatoFecha(fechaEntradaTexto) || !validarFormatoFecha(fechaSalidaTexto)) {
    return { valido: false, motivo: 'Fecha debe tener el formato DD-MM-AAAA', registro: null, original: fila };
  }
  try {
    const registro = window.construirRegistroDesdeFormulario({
      ticket: String(fila.Ticket ?? '').trim(),
      proveedor: String(fila.Proveedor ?? '').trim().toUpperCase(),
      material: String(fila.Material ?? '').trim().toUpperCase(),
      kg: fila.Kg,
      fechaEntrada: convertirFechaAISO(fechaEntradaTexto),
      fechaSalida: convertirFechaAISO(fechaSalidaTexto)
    });
    return { valido: true, motivo: null, registro, original: fila };
  } catch (error) {
    return { valido: false, motivo: error.message, registro: null, original: fila };
  }
}

function procesarFilaProduccion(fila) {
  const fechaEntradaTexto = String(fila['Fecha Entrada'] ?? '').trim();
  const fechaSalidaTexto = String(fila['Fecha Salida'] ?? '').trim();
  if (!validarFormatoFecha(fechaEntradaTexto) || !validarFormatoFecha(fechaSalidaTexto)) {
    return { valido: false, motivo: 'Fecha debe tener el formato DD-MM-AAAA', registro: null, original: fila };
  }
  try {
    const registro = window.construirRegistroDesdeFormularioProduccion({
      cliente: String(fila.Cliente ?? '').trim().toUpperCase(),
      material: String(fila.Material ?? '').trim().toUpperCase(),
      kg: fila.Kg,
      fechaEntrada: convertirFechaAISO(fechaEntradaTexto),
      fechaSalida: convertirFechaAISO(fechaSalidaTexto)
    });
    return { valido: true, motivo: null, registro, original: fila };
  } catch (error) {
    return { valido: false, motivo: error.message, registro: null, original: fila };
  }
}

function procesarFilaPagos(fila) {
  const fechaTexto = String(fila.Fecha ?? '').trim();
  if (!validarFormatoFecha(fechaTexto)) {
    return { valido: false, motivo: 'Fecha debe tener el formato DD-MM-AAAA', registro: null, original: fila };
  }
  try {
    const registro = window.EVE_PAGOS.construirRegistroDesdeFormulario({
      ticket: String(fila.Ticket ?? '').trim(),
      proveedor: String(fila.Proveedor ?? '').trim().toUpperCase(),
      material: String(fila.Material ?? '').trim().toUpperCase(),
      kg: fila.Kg,
      precioPorKg: fila['Precio/Kg'],
      pagado: fila.Pagado,
      fecha: convertirFechaAISO(fechaTexto)
    });
    return { valido: true, motivo: null, registro, original: fila };
  } catch (error) {
    return { valido: false, motivo: error.message, registro: null, original: fila };
  }
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  esFilaVacia,
  procesarFilaDestaraje,
  procesarFilaProduccion,
  procesarFilaPagos
});

function procesarHoja(filasCrudas, procesador) {
  return filasCrudas.filter((fila) => !esFilaVacia(fila)).map((fila) => procesador(fila));
}

function contarResumenHoja(filasProcesadas) {
  const validas = filasProcesadas.filter((f) => f.valido).length;
  return { validas, invalidas: filasProcesadas.length - validas };
}

function obtenerRegistrosValidos(filasProcesadas) {
  return filasProcesadas.filter((f) => f.valido).map((f) => f.registro);
}

function hojaCalificaParaReemplazo(filasProcesadas) {
  return filasProcesadas.some((f) => f.valido);
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  procesarHoja,
  contarResumenHoja,
  obtenerRegistrosValidos,
  hojaCalificaParaReemplazo
});

function generarPlantilla() {
  const libro = XLSX.utils.book_new();
  const destaraje = XLSX.utils.aoa_to_sheet([
    ['Ticket', 'Proveedor', 'Material', 'Kg', 'Fecha Entrada', 'Fecha Salida'],
    ['9260', 'JOSE ENRIQUE', 'MIXTO', 1000, '24-06-2026', '25-06-2026']
  ]);
  const produccion = XLSX.utils.aoa_to_sheet([
    ['Ticket', 'Cliente', 'Material', 'Kg', 'Fecha Entrada', 'Fecha Salida'],
    ['P', 'CLIENTE EJEMPLO', 'PELLETS', 500, '24-06-2026', '25-06-2026']
  ]);
  const pagos = XLSX.utils.aoa_to_sheet([
    ['Ticket', 'Proveedor', 'Material', 'Kg', 'Precio/Kg', 'Total', 'Pagado', 'Fecha'],
    ['9260', 'JOSE ENRIQUE', 'MIXTO', 1000, 5, 5000, 4000, '24-06-2026']
  ]);
  XLSX.utils.book_append_sheet(libro, destaraje, 'Destaraje');
  XLSX.utils.book_append_sheet(libro, produccion, 'Produccion');
  XLSX.utils.book_append_sheet(libro, pagos, 'Pagos');
  XLSX.writeFile(libro, 'Plantilla_Importacion_EVE.xlsx');
}

function leerArchivoExcel(arrayBuffer) {
  const libro = XLSX.read(arrayBuffer, { type: 'array' });
  const NOMBRES_HOJA = ['Destaraje', 'Produccion', 'Pagos'];
  const faltantes = NOMBRES_HOJA.filter((nombre) => !libro.Sheets[nombre]);
  if (faltantes.length > 0) {
    throw new Error(`El archivo no tiene la(s) hoja(s): ${faltantes.join(', ')}`);
  }
  return {
    destaraje: XLSX.utils.sheet_to_json(libro.Sheets.Destaraje, { defval: '' }),
    produccion: XLSX.utils.sheet_to_json(libro.Sheets.Produccion, { defval: '' }),
    pagos: XLSX.utils.sheet_to_json(libro.Sheets.Pagos, { defval: '' })
  };
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  generarPlantilla,
  leerArchivoExcel
});

const PROCESADORES_HOJA = {
  destaraje: procesarFilaDestaraje,
  produccion: procesarFilaProduccion,
  pagos: procesarFilaPagos
};

const COLECCION_POR_HOJA = {
  destaraje: 'destaraje',
  produccion: 'produccion',
  pagos: 'pagos'
};

let modoActual = 'agregar';
let resultadoParseo = null;

function obtenerArrayExistente(hoja) {
  if (hoja === 'destaraje') return [...window.EVE.registrosDestaraje, ...window.EVE.registrosVentas];
  if (hoja === 'produccion') return window.EVE.registrosProduccion;
  return window.EVE.registrosPagos;
}

async function ejecutarOperacionesEnLotes(operaciones) {
  const TAMANO_LOTE = 500;
  for (let inicio = 0; inicio < operaciones.length; inicio += TAMANO_LOTE) {
    const grupo = operaciones.slice(inicio, inicio + TAMANO_LOTE);
    const lote = window.db.batch();
    grupo.forEach((operacion) => {
      if (operacion.tipo === 'delete') {
        lote.delete(window.db.collection(operacion.coleccion).doc(operacion.id));
      } else {
        const datosCompletos = { ...operacion.datos };
        if (!datosCompletos.fechaRegistro) {
          datosCompletos.fechaRegistro = new Date().toISOString();
        }
        lote.set(window.db.collection(operacion.coleccion).doc(), datosCompletos);
      }
    });
    await lote.commit();
  }
}

function construirColumnasPreview(filasProcesadas) {
  if (filasProcesadas.length === 0) return [];
  return Object.keys(filasProcesadas[0].original);
}

function renderizarTablaHoja(contenedor, etiqueta, filasProcesadas) {
  const resumen = contarResumenHoja(filasProcesadas);
  const titulo = document.createElement('p');
  titulo.textContent = `${etiqueta}: ${resumen.validas} válidas, ${resumen.invalidas} con error`;
  contenedor.appendChild(titulo);

  if (filasProcesadas.length === 0) return;

  const columnas = construirColumnasPreview(filasProcesadas);
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  const encabezado = document.createElement('tr');
  columnas.concat(['Estado']).forEach((nombreColumna) => {
    const celda = document.createElement('th');
    celda.textContent = nombreColumna;
    encabezado.appendChild(celda);
  });
  const cabecera = document.createElement('thead');
  cabecera.appendChild(encabezado);
  tabla.appendChild(cabecera);

  const cuerpo = document.createElement('tbody');
  filasProcesadas.forEach((filaProcesada) => {
    const fila = document.createElement('tr');
    columnas.forEach((nombreColumna) => {
      const celda = document.createElement('td');
      celda.textContent = String(filaProcesada.original[nombreColumna] ?? '');
      fila.appendChild(celda);
    });
    const celdaEstado = document.createElement('td');
    celdaEstado.textContent = filaProcesada.valido ? '✓' : filaProcesada.motivo;
    fila.appendChild(celdaEstado);
    cuerpo.appendChild(fila);
  });
  tabla.appendChild(cuerpo);

  const envoltura = document.createElement('div');
  envoltura.className = 'destaraje-tabla-wrapper';
  envoltura.appendChild(tabla);
  contenedor.appendChild(envoltura);
}

function renderizarVistaPrevia() {
  const contenedor = document.getElementById('ai-vista-previa');
  contenedor.innerHTML = '';
  if (!resultadoParseo) return;
  renderizarTablaHoja(contenedor, 'Destaraje', resultadoParseo.destaraje);
  renderizarTablaHoja(contenedor, 'Producción', resultadoParseo.produccion);
  renderizarTablaHoja(contenedor, 'Pagos', resultadoParseo.pagos);
}

function actualizarBotonConfirmar() {
  const boton = document.getElementById('ai-confirmar-importacion');
  if (!resultadoParseo) {
    boton.disabled = true;
    return;
  }
  if (modoActual === 'reemplazar') {
    const texto = document.getElementById('ai-confirmar-texto').value;
    boton.disabled = texto !== 'CONFIRMAR';
  } else {
    boton.disabled = false;
  }
}

function manejarCambioModo(nuevoModo) {
  modoActual = nuevoModo;
  document.getElementById('ai-confirmar-texto').style.display = nuevoModo === 'reemplazar' ? '' : 'none';
  document.getElementById('ai-confirmar-texto').value = '';
  actualizarBotonConfirmar();
}

function manejarDescargarPlantilla() {
  generarPlantilla();
}

function manejarSeleccionArchivo(evento) {
  const archivo = evento.target.files[0];
  if (!archivo) return;
  const lector = new FileReader();
  lector.onload = () => {
    try {
      const datosHojas = leerArchivoExcel(lector.result);
      resultadoParseo = {
        destaraje: procesarHoja(datosHojas.destaraje, PROCESADORES_HOJA.destaraje),
        produccion: procesarHoja(datosHojas.produccion, PROCESADORES_HOJA.produccion),
        pagos: procesarHoja(datosHojas.pagos, PROCESADORES_HOJA.pagos)
      };
      renderizarVistaPrevia();
      actualizarBotonConfirmar();
    } catch (error) {
      resultadoParseo = null;
      renderizarVistaPrevia();
      actualizarBotonConfirmar();
      window.showError(error.message);
    }
  };
  lector.readAsArrayBuffer(archivo);
}

async function manejarConfirmarImportacion() {
  document.getElementById('ai-confirmar-importacion').disabled = true;
  try {
    for (const hoja of Object.keys(PROCESADORES_HOJA)) {
      const filasProcesadas = resultadoParseo[hoja];
      const registrosValidos = obtenerRegistrosValidos(filasProcesadas);
      if (registrosValidos.length === 0) continue;
      const operaciones = [];
      if (modoActual === 'reemplazar' && hojaCalificaParaReemplazo(filasProcesadas)) {
        obtenerArrayExistente(hoja).forEach((registroExistente) => {
          operaciones.push({ tipo: 'delete', coleccion: COLECCION_POR_HOJA[hoja], id: registroExistente.id });
        });
      }
      registrosValidos.forEach((registro) => {
        operaciones.push({ tipo: 'set', coleccion: COLECCION_POR_HOJA[hoja], datos: registro });
      });
      await ejecutarOperacionesEnLotes(operaciones);
    }
    await window.cargarDatosEnParalelo();
    resultadoParseo = null;
    document.getElementById('ai-archivo').value = '';
    renderizarVistaPrevia();
    actualizarBotonConfirmar();
    window.showSuccess('Importación completada');
  } catch (error) {
    window.showError(error.message);
    actualizarBotonConfirmar();
  }
}

function crearVistaImportar() {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card admin-importar';
  tarjeta.innerHTML = `
    <div class="admin-importar-header">
      <h3>Importar Datos</h3>
      <button type="button" id="ai-descargar-plantilla" class="btn-secondary">Descargar plantilla</button>
    </div>
    <input type="file" id="ai-archivo" accept=".xlsx">
    <div class="admin-importar-modo">
      <label><input type="radio" name="ai-modo" value="agregar" id="ai-modo-agregar" checked> Agregar</label>
      <label><input type="radio" name="ai-modo" value="reemplazar" id="ai-modo-reemplazar"> Reemplazar todo</label>
    </div>
    <input type="text" id="ai-confirmar-texto" placeholder="Escribe CONFIRMAR" style="display:none">
    <div id="ai-vista-previa"></div>
    <button type="button" id="ai-confirmar-importacion" class="btn-primary" disabled>Confirmar importación</button>
  `;
  tarjeta.querySelector('#ai-descargar-plantilla').addEventListener('click', manejarDescargarPlantilla);
  tarjeta.querySelector('#ai-archivo').addEventListener('change', manejarSeleccionArchivo);
  tarjeta.querySelector('#ai-modo-agregar').addEventListener('change', () => manejarCambioModo('agregar'));
  tarjeta.querySelector('#ai-modo-reemplazar').addEventListener('change', () => manejarCambioModo('reemplazar'));
  tarjeta.querySelector('#ai-confirmar-texto').addEventListener('input', actualizarBotonConfirmar);
  tarjeta.querySelector('#ai-confirmar-importacion').addEventListener('click', manejarConfirmarImportacion);
  return tarjeta;
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  crearVistaImportar
});

})();
