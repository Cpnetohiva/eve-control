# Fase 8d — Panel Admin: Gestión de Datos — Implementation Plan

> Design spec: `docs/superpowers/specs/2026-06-25-gestion-datos-design.md`  
> Continues Fase 8c (already merged to master).

**Goal:** Quinta sub-pestaña "Gestión de Datos" en el Panel Admin que permite borrar registros de un módulo (total o por rango de fechas) o de los 5 módulos a la vez ("TODOS"), con vista previa del conteo antes de confirmar.

---

## Files

- **Create:** `js/admin-datos.js` (namespace `window.EVE_ADMIN_DATOS`)
- **Modify:** `js/admin.js` — agregar sub-pestaña `{ id: 'datos', nombre: 'Gestión de Datos' }` a `SUBPESTANAS` y su rama en `renderizarSubpestana`
- **Modify:** `index.html` — `<script src="js/admin-datos.js">` antes de `admin.js`
- **Modify:** `css/styles.css` — estilos `.admin-datos`, `.btn-danger`, `.ad-vista-previa-texto`, `.admin-datos-checkbox-label`
- **Create:** `docs/superpowers/verify-phase8d.js`

---

## Tasks

- [x] **Task 1:** Crear `js/admin-datos.js`

  Pure helpers expuestos en `window.EVE_ADMIN_DATOS`:
  - `MODULOS_BORRABLES` (lista blanca de 5 módulos con `coleccion` y `campoFecha`)
  - `obtenerRegistrosModulo(clave)` — lee de `window.EVE`; Destaraje combina `registrosDestaraje + registrosVentas`
  - `normalizarFechaISO(valor)` — maneja strings y Firestore Timestamps
  - `filtrarPorRango(registros, campoFecha, desde, hasta)` — comparación ISO; vacío = todos
  - `calcularVistaPrevia(clave, desde, hasta)` → número de registros a eliminar
  - `calcularVistaPreviaTodos()` → `{ desglose, total }`
  - `esConfirmarValido(texto)` → `texto === 'CONFIRMAR'`
  - `ejecutarBorradoEnLotes(coleccion, ids)` — lotes de 500 (límite Firestore)
  - `crearVistaDatos()` — retorna DOM card; resetea `vistaPrevia = null` en cada llamada

  Comportamiento UI clave:
  - Módulo selector → cambia a TODOS oculta la sección de fechas
  - "Ver cuántos" calcula `vistaPrevia` y muestra el botón de eliminar
  - Cambiar selector o fechas invalida `vistaPrevia` (oculta botón de nuevo)
  - Botón de eliminar habilitado solo si: `vistaPrevia` calculada + texto `CONFIRMAR` + (para TODOS: checkbox marcado)
  - Texto del botón inyecta el conteo: `🗑️ Eliminar N registros`
  - Tras borrado exitoso: `cargarDatosEnParalelo()`, reset UI, `showSuccess`

- [x] **Task 2:** Modificar `js/admin.js`

  Agregar a `SUBPESTANAS`:
  ```javascript
  { id: 'datos', nombre: 'Gestión de Datos' }
  ```
  Agregar rama en `renderizarSubpestana`:
  ```javascript
  } else if (subpestanaActiva === 'datos') {
    contenedor.appendChild(window.EVE_ADMIN_DATOS.crearVistaDatos());
  }
  ```

- [x] **Task 3:** Modificar `index.html`

  Agregar antes de `<script src="js/admin.js">`:
  ```html
  <script src="js/admin-datos.js"></script>
  ```

- [x] **Task 4:** Modificar `css/styles.css`

  - `.btn-danger` — fondo `var(--rojo-error)`, blanco, 700, radio, disabled opacity 0.45
  - `.admin-datos` + `.admin-datos-fila` + `.admin-datos-select` — layout selector
  - `.admin-datos-fechas` + `input[type="date"]` — row de fechas
  - `.ad-vista-previa` + `.ad-vista-previa-texto` — box de conteo
  - `.admin-datos-confirmar` — flex column gap
  - `#ad-confirmar-texto` — input de confirmación
  - `.admin-datos-checkbox-label` — label rojo para el checkbox de TODOS

- [x] **Task 5:** Crear `docs/superpowers/verify-phase8d.js`

  Playwright en vivo:
  1. Login como admin
  2. Sembrar 3 registros en Destaraje con fechas 2099 (nunca se superponen con datos reales):
     - A: `fechaSalida: '2099-01-15'` (dentro del rango)
     - B: `fechaSalida: '2099-01-20'` (dentro del rango)
     - C: `fechaSalida: '2099-03-01'` (fuera del rango)
  3. `cargarDatosEnParalelo()` para refrescar `window.EVE`
  4. Abrir Admin → Gestión de Datos
  5. Seleccionar Destaraje, rango 2099-01-01 a 2099-01-31
  6. "Ver cuántos" → verificar que muestra conteo
  7. Verificar botón visible pero deshabilitado sin CONFIRMAR
  8. Verificar que cambiar una fecha invalida la vista previa (botón oculto)
  9. Restaurar rango, re-ver, escribir CONFIRMAR, ejecutar borrado
  10. Verificar en Firestore: A y B borrados, C intacto
  11. Verificar opción "TODOS" en selector + sección checkbox aparece tras "Ver cuántos"
  12. Sin ejecutar el borrado TODOS nunca
  13. Limpiar: borrar registro C directamente en Firestore

---

## Verification

Run from `eve-control-v2/`:
```bash
node -e "
global.window = global;
const EVE = { registrosDestaraje: [
  { id: '1', fechaSalida: '2026-01-10' },
  { id: '2', fechaSalida: '2026-03-05' }
], registrosVentas: [], registrosProduccion: [], registrosPagos: [],
registrosMinistraciones: [], registrosControlProduccion: [] };
window.EVE = EVE;
require('./js/admin-datos.js');
const { calcularVistaPrevia, calcularVistaPreviaTodos, esConfirmarValido, filtrarPorRango } = window.EVE_ADMIN_DATOS;
const assert = require('assert');
assert.strictEqual(calcularVistaPrevia('destaraje', '2026-01-01', '2026-01-31'), 1);
assert.strictEqual(calcularVistaPrevia('destaraje', '', ''), 2);
assert.strictEqual(calcularVistaPrevia('destaraje', '2026-02-01', '2026-02-28'), 0);
const { total, desglose } = calcularVistaPreviaTodos();
assert.strictEqual(total, 2);
assert.strictEqual(desglose.destaraje.conteo, 2);
assert.strictEqual(esConfirmarValido('CONFIRMAR'), true);
assert.strictEqual(esConfirmarValido('confirmar'), false);
assert.strictEqual(esConfirmarValido(''), false);
console.log('ADMIN_DATOS_NODE_OK');
"
```

Expected: `ADMIN_DATOS_NODE_OK`

Playwright (live Firebase):
```bash
# Start server first: python -m http.server 8765
node docs/superpowers/verify-phase8d.js
```

All lines must print `_OK: true` and `CONSOLE_ERRORS: []`.
