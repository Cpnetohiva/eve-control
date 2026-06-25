# Fase 8d — Panel Admin: Gestión de Datos (borrado masivo)

Fuente: `EVERPLASTIC COO.md` (sección "PANEL ADMIN (`admin.js`)", subsección
"3. Gestión de Datos"). Cuarta y última de las 4 sub-fases del Panel
Admin (8a Usuarios → 8b Importación de Datos → 8c Backup/Exportación +
Configuración del Sistema → **8d Gestión de Datos**), decomposición
acordada al iniciar el brainstorming de la Fase 8. Continúa la Fase 8c,
ya fusionada a `master`.

## Objetivo

Una quinta sub-pestaña "Gestión de Datos" en el Panel Admin: borrar
registros de un módulo (total o por rango de fechas) o de los 5 módulos
a la vez ("TODOS"), siempre con vista previa del conteo antes de poder
confirmar.

**Esta es la primera función de todo el proyecto cuyo propósito
explícito es el borrado permanente e irreversible de datos reales**, en
bloque. Todo el diseño y el plan de pruebas en vivo está deliberadamente
escrito con ese riesgo en mente.

## Arquitectura

- **`js/admin-datos.js`** (nuevo): namespace `window.EVE_ADMIN_DATOS`,
  registrado como sub-pestaña "Gestión de Datos" en `js/admin.js`
  (delegando a `EVE_ADMIN_DATOS.crearVistaDatos()`, mismo patrón
  unidireccional ya usado para las 4 sub-pestañas anteriores).
- **Lista blanca estructural y explícita de exactamente 5 módulos
  borrables** — la única fuente de verdad sobre qué se puede borrar:
  ```javascript
  const MODULOS_BORRABLES = {
    destaraje: { nombre: 'Destaraje', coleccion: 'destaraje', campoFecha: 'fechaSalida' },
    produccion: { nombre: 'Producción', coleccion: 'produccion', campoFecha: 'fechaSalida' },
    pagos: { nombre: 'Pagos', coleccion: 'pagos', campoFecha: 'fecha' },
    ministraciones: { nombre: 'Ministraciones', coleccion: 'ministraciones', campoFecha: 'fecha' },
    controlProduccion: { nombre: 'Control de Producción', coleccion: 'control_produccion', campoFecha: 'fechaFin' }
  };
  ```
  "TODOS los módulos" se define literalmente como `Object.keys(MODULOS_BORRABLES)`
  — nunca como "todas las colecciones que existan en Firestore". `users`
  y `config` no aparecen en esta lista ni en ningún otro lugar del
  archivo; es estructuralmente imposible que un borrado masivo los
  alcance, mismo criterio que excluyó `users` de los backups en la
  Fase 8c.
- Los campos de fecha por módulo (confirmados contra el código real de
  `js/reportes.js`'s `obtenerDatosPeriodo` y `js/pagos.js`'s
  `construirMinistracionDesdeFormulario`, más la convención ya
  establecida en la Fase 6 para Control de Producción):
  Destaraje/Producción → `fechaSalida`; Pagos/Ministraciones → `fecha`;
  Control de Producción → `fechaFin`.
- Sin cambios a ningún otro módulo operativo ni a los demás archivos
  `admin-*.js`. El helper de borrado por lotes se implementa de forma
  local en este archivo (no se importa el de `admin-importar.js`),
  manteniendo la independencia entre archivos hermanos ya establecida
  desde la Fase 8a.

## Borrado por módulo (uno a la vez)

- Selector de Módulo: los 5 nombres de `MODULOS_BORRABLES` más
  "TODOS los módulos" al final.
- Si el módulo no es "TODOS": dos campos de fecha opcionales (Desde/
  Hasta). Vacíos = borrar el módulo completo (fiel al mock original del
  spec: "vacío = borrar TODO el módulo").
- Botón "🔍 Ver cuántos registros se eliminarán": filtra el arreglo ya
  cargado en `window.EVE` correspondiente a ese módulo (sin lectura
  nueva a Firestore — mismo criterio que el backup de la Fase 8c) por
  el `campoFecha` de la tabla anterior, y muestra el conteo resultante.
  Destaraje combina `registrosDestaraje` + `registrosVentas` (mismo
  criterio que el backup, ya que ambos viven en la misma colección).
- El botón "🗑️ Eliminar X registros" (el número real inyectado en su
  propio texto) solo existe/se habilita **después** de haber calculado
  una vista previa. Cambiar el módulo o cualquier fecha invalida de
  inmediato la vista previa anterior — el botón de eliminar se oculta y
  hay que volver a dar clic en "Ver cuántos" antes de poder continuar.
  Nunca se borra basándose en un conteo que ya no corresponde a la
  selección actual.
- Campo de texto "Escribe CONFIRMAR": el botón de eliminar permanece
  deshabilitado mientras el texto no sea exactamente `CONFIRMAR`
  (comparación exacta, sensible a mayúsculas — mismo criterio que el
  modo Reemplazar de la Fase 8b).

## Borrar TODOS los módulos (confirmación doble)

- Sin campos de fecha — esta opción siempre es un borrado completo de
  los 5 módulos (el spec la lista aparte de las demás, sin el
  calificador "total o por rango de fechas" que sí tienen las otras 5).
- La vista previa, al darle clic a "Ver cuántos", muestra el desglose
  por módulo y el total general (ej. "Destaraje: 120, Producción: 45,
  Pagos: 80, Ministraciones: 12, Control Producción: 30 — Total: 287").
- Para habilitar el botón final hacen falta **dos gestos
  independientes**, ambos obligatorios:
  1. El campo CONFIRMAR con el texto exacto.
  2. Un checkbox: "Entiendo que esta acción es irreversible y borrará
     TODOS los módulos".
- Cambiar cualquier cosa después de ver la vista previa de TODOS
  también la invalida, igual criterio que el borrado por módulo
  individual.

## Ejecución del borrado

- Mismo patrón de lotes ya usado en la Fase 8b: las operaciones de
  borrado se agrupan en lotes de `window.db.batch()`, máximo 500
  operaciones por lote (el límite de Firestore), ejecutados en orden.
- Tras un borrado exitoso (de un módulo o de TODOS), se refresca
  `window.EVE` por completo vía `window.cargarDatosEnParalelo()` —
  mismo mecanismo ya usado en la Fase 8b tras una importación.
- Mensaje de éxito (`showSuccess`) indicando cuántos registros se
  eliminaron.

## Estrategia de prueba en vivo

**Esta fase nunca ejecuta un borrado real contra datos de producción
en un script automatizado, bajo ninguna circunstancia.** El script de
verificación:

1. Siembra sus propios registros de prueba directamente en Firestore
   (no vía la UI), con fechas conocidas y elegidas a propósito para que
   algunos caigan dentro de un rango de prueba y otros fuera — esto
   permite probar el filtro de fechas con precisión, no solo "borrar
   todo".
2. Usa la UI real para seleccionar un módulo, fijar un rango de fechas
   que cubra solo una parte de los registros de prueba, confirmar que
   la vista previa muestra el conteo correcto, escribir CONFIRMAR, y
   borrar — confirmando después que solo los registros de prueba
   dentro del rango desaparecieron de Firestore y el que quedó fuera
   del rango sigue existiendo.
3. Confirma que la opción "TODOS los módulos" existe en la interfaz
   (aparece en el selector, el checkbox de confirmación doble aparece
   cuando se selecciona) **sin completarla nunca** — mismo criterio ya
   usado para el botón de Telegram en la Fase 7/8c (verificar
   existencia y cableado, jamás ejecutar la acción real).
4. Limpia cualquier dato de prueba que sobreviva al final del script
   (ej. el registro fuera de rango que la prueba dejó intacto a
   propósito), igual que en toda fase anterior — cero residuos.

## Archivos

- Crear `js/admin-datos.js`: namespace `window.EVE_ADMIN_DATOS` —
  `MODULOS_BORRABLES`, cálculo de vista previa (conteo por módulo y
  total), validación de CONFIRMAR (+ checkbox para TODOS), ejecución
  por lotes, vista.
- Modificar `js/admin.js`: agregar la sub-pestaña "Gestión de Datos" a
  `SUBPESTANAS`, delegando a `EVE_ADMIN_DATOS.crearVistaDatos()`.
- Modificar `index.html`: agregar `<script src="js/admin-datos.js">`
  antes de `admin.js` (mismo orden de dependencia ya establecido).
- Modificar `css/styles.css`: estilos para el selector de módulo, los
  campos de fecha, la vista previa con desglose, el checkbox de
  confirmación doble.
- Sin cambios a ningún módulo operativo, ni a `admin-usuarios.js`,
  `admin-importar.js`, `admin-backup.js`, `admin-config.js`.

## Fuera de alcance

- Deshacer un borrado (no existe ningún mecanismo de papelera o
  restauración en esta fase — la única forma de recuperar datos
  borrados por accidente sería reimportar un backup previo, vía la
  Fase 8b, manualmente).
- Borrado de `users` o `config` — no existe ninguna vía para ello en
  esta función, por diseño.
- Cualquier cambio a `js/reportes.js`, `js/admin-usuarios.js`,
  `js/admin-importar.js`, `js/admin-backup.js`, `js/admin-config.js`,
  o a cualquier módulo operativo.

## Criterio de aceptación

- Node: cálculo del conteo de vista previa por módulo y por fecha
  (incluyendo el caso sin fechas = módulo completo), el desglose y
  total para "TODOS", la validación CONFIRMAR (+ checkbox para TODOS),
  y la lógica de invalidación de vista previa al cambiar la selección —
  todo con fixtures en memoria, sin Firestore real.
- Playwright en vivo: sembrar registros de prueba con fechas conocidas
  en al menos un módulo, borrar solo los que caen dentro de un rango de
  fechas elegido a propósito usando la UI real, confirmar que el
  registro fuera de rango sigue existiendo, confirmar que la opción
  "TODOS los módulos" aparece en la interfaz con su checkbox de
  confirmación doble sin ejecutarla nunca, y limpiar cualquier dato de
  prueba restante al final. Sin errores de consola.
