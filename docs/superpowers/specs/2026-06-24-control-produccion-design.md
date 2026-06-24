# Fase 6 — Módulo Control de Producción + Trazabilidad

Fuente: `docs/PROMPT_ORIGINAL_EVE_CONTROL.md` (Módulo 4: Control de
Producción). Continúa la Fase 5 (Pagos + Ministraciones), ya fusionada a
`master`.

## Objetivo

Un módulo de control de transformaciones productivas (Selección, Empacado,
Molienda, Lavado, Peletizado): captura con formulario dinámico por tipo de
proceso, múltiples materiales de entrada, cálculos automáticos en tiempo
real (eficiencia, merma, productividad), 3 tabs operativas
(Hoy/Esta Semana/Todos) y una 4ª pestaña de Trazabilidad que reconstruye la
cadena completa ENTRADA → PROCESO(s) → VENTA recorriendo los tickets que
cada registro referencia como origen de su material.

Es el módulo más complejo del proyecto hasta ahora: a diferencia de
Destaraje/Producción/Pagos (un registro = una transacción simple), aquí un
registro representa una transformación con múltiples entradas y un
resultado, y la pestaña de Trazabilidad requiere recorrer esas relaciones
entre registros — no solo filtrar una lista.

## Arquitectura

- **Dos archivos nuevos**, no uno: `js/control-produccion.js` (CRUD,
  formulario dinámico, tabs Hoy/Esta Semana/Todos) y `js/trazabilidad.js`
  (algoritmo de recorrido del grafo de tickets + render de esa pestaña).
  Son responsabilidades distintas y separables: el algoritmo de
  trazabilidad es una función pura sobre los arrays ya cargados en
  memoria (recibe un ticket, regresa una estructura de cadena/ramas), sin
  ninguna dependencia del formulario o del CRUD. Sigue el patrón ya
  establecido de archivos enfocados por responsabilidad (`reportes.js` y
  `voz.js`, separados de `destaraje.js`).
- **Namespace:** ambos archivos exponen sus helpers en un objeto propio —
  `window.EVE_CONTROL_PRODUCCION` y `window.EVE_TRAZABILIDAD`
  respectivamente — en vez de globals individuales. Es el patrón adoptado
  en la Fase 5 (`window.EVE_PAGOS`) y recomendado como plantilla por la
  revisión final de esa fase. Cada uno registra además su pieza en
  `window.EVE_MODULES`: `control-produccion.js` registra
  `window.EVE_MODULES.controlProduccion = { render }` (el tab completo,
  incluyendo las 4 sub-pestañas); `trazabilidad.js` no se registra ahí —
  es consumido directamente por `control-produccion.js` cuando el usuario
  activa la sub-pestaña Trazabilidad, ya que no es un módulo de nivel
  superior en `ORDEN_TABS`, sino una de las 4 sub-pestañas internas de
  Control de Producción (igual que Hoy/Esta Semana/Todos lo son).
- **Modifica `js/destaraje.js`** (ya fusionado) — el único cambio a un
  módulo de una fase anterior en todo el proyecto hasta ahora. Se agrega
  un campo opcional `ticketOrigen` (texto libre, con `<datalist>` que
  sugiere tickets de `registrosControlProduccion`) al formulario y al
  modal de edición del modo Venta. Sin este campo, la cadena de
  Trazabilidad no tendría forma de identificar qué Venta corresponde a
  qué proceso — es la pieza que cierra el último eslabón.

## Datos

```javascript
// Colección control_produccion
{
  ticket: "P-001",              // autogenerado secuencial, nunca editable por el usuario
  tipoProceso: "PELETIZADO",    // SELECCION | EMPACADO | MOLIENDA | LAVADO | PELETIZADO
  inputs: [
    { material: "PET MOLIDO", kg: 1000, ticketOrigen: "9260" }
    // ticketOrigen: texto libre con autocompletado contra tickets reales
    // (Destaraje, Producción, Control de Producción); si no coincide con
    // ningún ticket conocido se guarda igual, pero Trazabilidad no podrá
    // completar esa rama
  ],
  outputs: {
    principal: { material: "Pellets", kg: 900 },
    merma: { kg: 100 }           // SIEMPRE presente, incluso en Empacado
                                  // (decisión de esta fase: el spec original
                                  // no lista merma para Empacado, pero se
                                  // incluye igual por consistencia y porque
                                  // en la práctica también puede haberla)
  },
  operador: "Christian",         // texto libre con autocompletado (mismo
                                  // patrón que proveedor/cliente/material)
  turno: "Matutino",             // Matutino | Vespertino | Nocturno
  fechaInicio: "2026-04-28T08:00",  // datetime-local
  fechaFin:    "2026-04-28T14:00",  // datetime-local; debe ser > fechaInicio
  horasTrabajo: 6.0,             // = (fechaFin - fechaInicio) en horas
  totalInput: 1000,              // = suma de inputs[].kg
  totalOutput: 1000,             // = outputs.principal.kg + outputs.merma.kg
  eficiencia: 90.00,             // = (outputs.principal.kg / totalInput) * 100
  porcentajeMerma: 10.00,        // = (outputs.merma.kg / totalInput) * 100
  observaciones: "",             // opcional
  fechaRegistro: "..."
}
```

- **Generación de ticket:** al guardar, se busca el mayor número `P-NNN`
  ya existente en `window.EVE.registrosControlProduccion` y se usa
  `NNN + 1` (con padding a 3 dígitos: `P-001`, `P-010`, `P-100`, `P-1000`
  sin truncar si llega a 4 dígitos). El campo nunca es editable, ni en el
  formulario de creación ni en el modal de edición — igual criterio que el
  ticket fijo de Producción, pero generado en vez de constante.
- **Referencia de fecha para Hoy/Esta Semana/filtro de fechas:**
  **`fechaFin`** (decisión de esta fase: se usa la fecha en que terminó el
  proceso, no en que arrancó).
- **Venta en `destaraje.js`** gana un campo `ticketOrigen` opcional
  (string, puede ser `undefined`/ausente en registros viejos o cuando no
  aplica). Mecanismo exacto: `construirRegistroDesdeFormulario` (compartido
  entre Compra y Venta) acepta `datos.ticketOrigen`; si llega no-vacío, se
  incluye en el objeto devuelto (`ticketOrigen: datos.ticketOrigen.trim()`);
  si llega vacío o ausente, el campo se omite del objeto por completo (no
  se escribe `ticketOrigen: ''`/`undefined` a Firestore). En la UI, el
  input de Ticket Origen solo se muestra (vía `aplicarModoFormulario`,
  alternando con el resto de campos por modo) cuando `tipoFormulario ===
  'venta'` — en modo Compra el campo no aparece y por lo tanto nunca se
  envía.
- Todos los cálculos (`horasTrabajo`, `totalInput`, `totalOutput`,
  `eficiencia`, `porcentajeMerma`) se recalculan desde los datos crudos del
  formulario al momento de guardar — nunca se confía en lo mostrado en el
  resumen en vivo, igual criterio que el campo Total de Pagos.

## Formulario dinámico

- Selector de proceso: 5 botones/radio (ícono + nombre, igual que
  `PROCESOS`). Al elegir uno, el campo de material principal se prellena
  (editable, no bloqueado) con `PROCESOS[tipo].outputs[0]` como sugerencia
  (ej. "Pellets" para Peletizado, "Pacas" para Empacado).
- Inputs múltiples: una fila por material (Material con autocompletado,
  Kg, Ticket Origen con autocompletado), botón "+ Agregar Material" para
  añadir filas y "−" para quitar una fila (mínimo 1 fila, no se puede
  quitar la última).
- Campos de salida: Material principal + Kg, Kg de merma (siempre
  visible, en todos los procesos).
- Operador (autocompletado), Turno (dropdown fijo de 3 opciones), Fecha
  Inicio, Fecha Fin (ambos `datetime-local`), Observaciones (textarea
  opcional).
- Resumen en vivo: tarjeta que se recalcula con cada cambio relevante —
  Total Input, Total Output, Eficiencia % (texto con color: verde ≥90%,
  naranja ≥80%, rojo <80%), % Merma, Horas Trabajo, Productividad (kg/h).
  Mismo criterio de Pagos: estos valores nunca se leen de vuelta al
  guardar, se recalculan desde cero.
- Sin botón de voz — el spec original limita el reconocimiento de voz a
  Destaraje, Producción y Pagos únicamente.
- Editar: modal con los mismos campos; el ticket permanece deshabilitado
  (igual razón que Producción: no hay ambigüedad de tipo que proteger,
  pero tampoco tiene sentido reasignar un ticket autogenerado).

## Tabs Hoy / Esta Semana / Todos

- Mismo patrón de 3 sub-tabs que los módulos anteriores, criterio de fecha
  `fechaFin`.
- Filtros (solo en "Todos"): Proceso (dropdown), Operador, Turno, Fecha
  Desde/Hasta.
- Tabla: Ticket, Proceso (ícono + nombre), Operador, Turno, Total Input,
  Total Output, Eficiencia % (coloreada), % Merma, F. Inicio, F. Fin,
  acciones (Editar/Eliminar).
- Stats: Registros, Total Input, Total Output, Eficiencia promedio del
  conjunto filtrado.
- **Sin botones de exportar en esta fase** — el reporte específico de
  Control de Producción (orientado a eficiencia/merma/trazabilidad, no a
  kg por proveedor) es una opción de reporte separada que el spec ubica en
  el futuro módulo de Reportes UI, todavía no construido. Agregar
  exportación aquí significaría o (a) tocar `reportes.js` para una
  sección que ese módulo no está diseñado para producir, o (b) mostrar un
  reporte general sin ningún dato de este módulo — ninguna de las dos
  tiene sentido antes de que exista esa fase.

## Trazabilidad (4ª sub-pestaña)

- Input: buscar por número de ticket (cualquier ticket: de Destaraje, de
  Producción o de Control de Producción).
- **Naturaleza de grafo, no de lista lineal:** cada registro de Control de
  Producción puede tener varios `inputs[]` (cada uno con su propio
  `ticketOrigen`, posiblemente de tickets distintos) y un mismo ticket de
  salida puede ser el origen de varios registros distintos (un lote
  dividido entre dos procesos). La cadena del mock del spec
  ("ENTRADA → PROCESO1 → PROCESO2 → ... → VENTA") es el caso simple de un
  grafo que en general puede ramificarse en ambas direcciones.
- **Algoritmo** (en `js/trazabilidad.js`, puro, sobre los arrays ya
  cargados en memoria):
  1. A partir del ticket buscado, **retroceder**: si el ticket coincide
     con el `ticket` de un registro de Control de Producción, explorar
     cada uno de sus `inputs[].ticketOrigen` recursivamente (cada uno
     puede a su vez ser otro proceso, ramificando hacia atrás). Un ticket
     que no coincide con ningún registro de Control de Producción se
     busca en Destaraje (por `ticket` exacto) y se trata como **ENTRADA**,
     identificada (se muestra material/kg) o no identificada (no hay
     ningún registro con ese ticket — se muestra el ticket solo, sin
     detalle). **Producción se excluye deliberadamente de esta búsqueda:**
     su `ticket` es siempre la constante `"P"` (Fase 4), no un
     identificador único, así que nunca puede usarse para encontrar un
     registro específico sin ambigüedad.
  2. **Avanzar**: buscar todos los registros de Control de Producción
     cuyo `inputs[].ticketOrigen` apunte al ticket actual (puede haber
     más de uno → ramifica hacia adelante), y todas las Ventas cuyo
     `ticketOrigen` apunte aquí. Si no se encuentra ningún siguiente paso,
     ese punto es terminal: el último proceso conocido (aún no vendido) en
     vez de una Venta.
  3. Un guardia de visitados (por rama, no global) evita ciclos infinitos
     (no deberían existir si `ticketOrigen` siempre apunta a un ticket
     anterior en el tiempo, pero el guardia es necesario para no confiar
     en esa suposición), sin impedir que el mismo ticket aparezca en
     ramas hermanas distintas (ver siguiente punto).
- **Render: árbol, no cadenas planas independientes.** El ticket buscado
  se muestra al centro, con una lista "viene de" (ramas hacia atrás, una
  por cada material de entrada) y una lista "va hacia" (ramas hacia
  adelante, una por cada proceso/venta que lo consume), cada rama
  expandible recursivamente. Si un mismo ticket es alcanzable por más de
  un camino (ej. dos procesos que consumen el mismo lote), aparece una vez
  por cada camino en el árbol — es información visualmente correcta para
  un árbol, no una duplicación de datos. (Decisión tomada al detallar el
  algoritmo: una representación de "todas las cadenas planas
  independientes" requeriría producto cartesiano, generaría duplicación
  visual sin aportar información nueva, y complicaría el cálculo del
  resumen global al poder contar el mismo nodo más de una vez.)
- **Resumen global:** se calcula aparte del árbol de render, mediante un
  recorrido propio que junta en mapas (por ticket) todas las ENTRADAs,
  todos los PROCESOs y todos los puntos terminales alcanzables desde el
  ticket buscado — así cada nodo cuenta exactamente una vez sin importar
  cuántos caminos lo alcancen. Resumen = suma de kg de las ENTRADAs
  recolectadas, suma de kg de los terminales recolectados, suma de merma
  de los procesos recolectados, eficiencia global = kg salida / kg
  entrada × 100 (0 si kg entrada es 0).

## Archivos

- Crear `js/control-produccion.js`: IIFE, helpers puros (generación de
  ticket, cálculos, filtros, validación) + formulario dinámico + CRUD +
  tabs/tabla/stats/filtros (sin exportar). Expone
  `window.EVE_CONTROL_PRODUCCION` y registra
  `window.EVE_MODULES.controlProduccion = { render(container) {...} }`.
- Crear `js/trazabilidad.js`: IIFE, función pura de recorrido del grafo +
  función de render de la sub-pestaña Trazabilidad (recibe el contenedor
  DOM y los arrays de `window.EVE`). Expone `window.EVE_TRAZABILIDAD`.
  `control-produccion.js` lo consume al activar esa sub-pestaña.
- Modificar `js/destaraje.js`: agregar `ticketOrigen` opcional al
  formulario y modal de edición de Venta (con autocompletado), y al
  builder de registro (`construirRegistroDesdeFormulario`).
- Modificar `index.html`: agregar `<script src="js/trazabilidad.js">` y
  `<script src="js/control-produccion.js">` (en ese orden, ya que el
  segundo consume al primero), después de `pagos.js`.
- Modificar `css/styles.css`: estilos nuevos para el selector de proceso
  con íconos, las filas dinámicas de inputs múltiples, el resumen en vivo
  coloreado por eficiencia, y la visualización de cadena/ramas de
  Trazabilidad. Reutilizar clases genéricas existentes
  (`.card`, `.tabs`, `.modal-overlay`, `.tabla-destaraje`, etc.) donde
  aplique.

## Fuera de alcance

- Botones de exportar para Control de Producción (ver justificación
  arriba) — quedan para la fase del módulo de Reportes UI.
- Cualquier cambio a `js/reportes.js`, `js/voz.js`, `js/produccion.js`,
  `js/pagos.js` o `js/auth.js`.
- Edición del campo `ticketOrigen` de Ventas ya existentes vía algo
  distinto al modal normal de edición de Venta (no se agrega una pantalla
  especial para "vincular después" — el campo se llena igual que cualquier
  otro campo del modal).
- El módulo de Reportes UI (dropdown con filtros, opción "Control de
  Producción") y el Admin panel — fases futuras, no confundir con este
  módulo operativo.

## Criterio de aceptación

- Node: helpers puros con casos de prueba — generación de ticket
  secuencial (incl. cruce de 3 a 4 dígitos), cálculos (eficiencia, merma,
  horas, productividad) con casos límite (totalInput = 0 → sin división
  entre 0), validación del formulario, y el algoritmo de trazabilidad
  sobre un grafo de prueba construido a mano que incluya al menos una
  ramificación hacia adelante (un ticket de salida usado por 2 procesos)
  y una hacia atrás (un proceso con 2 materiales de entrada de orígenes
  distintos), verificando que el resumen global suma correctamente across
  todas las ramas.
- Playwright en vivo: crear un registro de prueba de Control de
  Producción (proceso, ticket de prueba claramente marcado, sin
  `ticketOrigen` real para no afectar datos reales), verificar que aparece
  en Hoy, filtrar en Todos, editar, eliminar (limpieza). Probar
  Trazabilidad buscando el ticket de prueba recién creado y verificando
  que se muestra como ENTRADA→PROCESO (sin Venta, ya que no se vinculó
  ninguna). Verificar también el nuevo campo `ticketOrigen` en el flujo de
  Venta de Destaraje (crear una venta de prueba con `ticketOrigen` igual
  al ticket de prueba de Control de Producción, confirmar que Trazabilidad
  ahora muestra la cadena completa hasta VENTA, eliminar ambos registros
  de prueba al final). Sin errores de consola. Selectores siempre acotados
  a los registros de prueba (lección de la Fase 3a).
