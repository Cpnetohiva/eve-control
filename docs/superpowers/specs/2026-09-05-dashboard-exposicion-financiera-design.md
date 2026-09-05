# Dashboard — Exposición Financiera y Producción

Módulo nuevo, separado de Reportes (que se queda igual, exportable por
período único). El Dashboard cruza datos por mes calendario y muestra
matrices en pantalla; no exporta documentos.

## Objetivo

Cinco vistas de análisis que Reportes no puede dar porque su modelo es
"un período elegido → un documento": aquí el eje es siempre el mes
calendario extraído de cada registro, independiente del período que
elija el usuario (porque no hay selector de período).

1. KG por mes × material (`registrosDestaraje`)
2. $ por mes × material (`cuentasPorPagar`, campo `total`, por `fechaTicket`)
3. $ pagado por mes × proveedor (`registrosPagos`, excluyendo `revertido:true`)
4. KG obtenidos por subproducto, real vs. teórico, por mes, para todos los
   materiales con composición vigente ese mes
5. Exposición financiera actual: `cuentasPorPagar` con `saldo > 0`,
   agrupado por proveedor y material (corte del momento actual, sin mes)

## Arquitectura

- **Un archivo nuevo**: `js/dashboard.js`. Sin split lógica/UI — sigue el
  patrón de módulos de tamaño medio ya usado por `rendimientos.js` y
  `control-produccion.js` (lógica pura + render en el mismo archivo), no
  el de `reportes.js`/`reportes-ui.js` (que se separó por el volumen de
  generadores TXT/PDF/CSV/Telegram que no aplican aquí).
- **Namespace `window.EVE_DASHBOARD`** para las funciones puras, siguiendo
  el patrón adoptado desde la Fase 5 (`window.EVE_PAGOS`,
  `window.EVE_CONTROL_PRODUCCION`, `window.EVE_RENDIMIENTOS`) — no
  globals sueltos como en `reportes.js` (patrón anterior, no se repite en
  módulos nuevos).
- **Registro de módulo**: `window.EVE_MODULES.dashboard = { render: renderDashboard }`.
- **Tab nuevo** en `ORDEN_TABS` (`js/auth.js`) y **permiso nuevo**
  `dashboard` en `PERMISOS_DISPLAY` (`js/admin-usuarios.js`), después de
  `reportes` en ambas listas.
- **No modifica ningún archivo existente de lógica** — `dashboard.js` es
  puramente consumidor de `window.EVE.*` (ya cargado por `auth.js`) y, en
  Fase 2, de `window.calcularRendimientoMaterial` (`reportes.js`) y
  `window.EVE_RENDIMIENTOS.composicionVigentePorMaterial`
  (`rendimientos.js`), ninguno de los dos se toca.
- **Sin dependencias nuevas**: no hay export a TXT/PDF/CSV en Fase 1, así
  que no se usa `jspdf` ni `window.exportarCSV`. Si se agrega export más
  adelante, las vistas 1/2/3/5 son triviales de aplanar; la vista 4 (3
  dimensiones: mes × material × subproducto) necesitaría una función de
  aplanado dedicada, fuera de alcance por ahora.

## Funciones puras (`window.EVE_DASHBOARD`)

```javascript
obtenerMesCalendario(fechaISO)
// "2026-03-15" → "2026-03". Fecha vacía/inválida → "".

agruparPorMesY(registros, obtenerFecha, obtenerClave, obtenerValor)
// → Map<mes, Map<clave, totalAcumulado>>
// Genérico: una sola implementación de Map anidado, reusada por las
// vistas 1, 2 y 3 con distinto (obtenerFecha, obtenerClave, obtenerValor).
// Registros sin mes resuelto (fecha vacía) se descartan silenciosamente.

construirMatrizMesClave(mapaPorMes)
// → { meses: string[], claves: string[], filas: [{ mes, [clave]: valor, _total }] }
// meses y claves ordenados ascendente/alfabético. Toda clave aparece en
// toda fila (0 si ese mes no tuvo movimiento para esa clave).

agregarCxPPorProveedorYMaterial(cuentas)
// → [{ proveedor, materiales: [{ material, total, pagado, saldo, cantidad }],
//      totalProveedor, saldoProveedor }]
// Filtra cuentas con saldo > 0 antes de agrupar. Estructura de Map
// anidado (proveedor → material), mismo patrón que agregarPorProveedor
// de reportes.js pero sumando 3 campos en vez de 1.
```

### Vistas 1–3 (construidas sobre las funciones anteriores)

```javascript
calcularVistaKgPorMesMaterial()
// agruparPorMesY(EVE.registrosDestaraje, r => r.fechaSalida, r => r.material, r => Number(r.kg) || 0)

calcularVistaMontoPorMesMaterial()
// agruparPorMesY(EVE.cuentasPorPagar, c => c.fechaTicket, c => c.material, c => Number(c.total) || 0)

calcularVistaPagadoPorMesProveedor()
// agruparPorMesY(EVE.registrosPagos.filter(p => !p.revertido), p => p.fecha, p => p.proveedor, p => Number(p.pagado) || 0)
```

Cada una devuelve el resultado ya pasado por `construirMatrizMesClave`.

### Vista 4 (Fase 2 — no se implementa en este spec's Fase 1)

Reutiliza `window.calcularRendimientoMaterial(material, {desde, hasta})`
de `reportes.js` sin modificarlo. Esa función ya resuelve la vigencia de
composición **por entrada individual** dentro del rango, así que el
único uso nuevo de `composicionVigentePorMaterial` es para decidir qué
materiales iterar en cada mes:

```javascript
calcularVistaSubproductosPorMes()
// meses = unión de meses en registrosDestaraje (fechaSalida) y
//         registrosControlProduccion (fechaFin)
// por cada mes:
//   { desde, hasta } = primer/último día calendario del mes
//   materiales = EVE_RENDIMIENTOS.composicionVigentePorMaterial(EVE.composiciones, hasta)
//                  .map(c => c.materialEntrada)
//                  .map(material => window.calcularRendimientoMaterial(material, { desde, hasta }))
//                  .filter(r => r.entradaTotalKg > 0 || r.filas.length > 0)
//   → { mes, materiales }
```

Interpretación confirmada: los materiales se muestran **lado a lado**
dentro de cada mes (arreglo `materiales[]`), sin fusionar subproductos
del mismo nombre entre materiales distintos — se preserva la forma que
ya devuelve `calcularRendimientoMaterial` (agrupado por material →
subproducto).

## UI

- Módulo con 4 sub-tabs (patrón `vistaActiva` + `crearSubtabs` de
  `rendimientos.js`): "KG por Mes y Material", "$ por Mes y Material",
  "Pagado por Mes y Proveedor", "Exposición Actual".
- Vistas 1–3: una tabla genérica (`renderizarTablaMatriz`) — columnas
  Mes + una por clave + Total, una fila por mes. Reusada 3 veces con
  distinto formateador de valor (KG redondeado vs. moneda) y distinta
  etiqueta de columna total.
- Vista 5: una tabla plana Proveedor/Material/Total/Pagado/Saldo/Tickets
  (una fila por combinación proveedor+material), con fila de total
  general al final. Sin agrupamiento visual anidado (YAGNI).
- Todo el contenido dinámico (nombres de material/proveedor, valores
  formateados) se inserta vía `textContent`/`createElement`, nunca por
  interpolación en `innerHTML` — regla ya vigente en todos los módulos
  desde la Fase 5.
- Sin exportación (TXT/PDF/CSV) en Fase 1 ni Fase 2. Pantalla interactiva
  solamente, según lo confirmado.

## Fases

- **Fase 1** (este spec, a implementar ahora): `agruparPorMesY` +
  `construirMatrizMesClave`, vistas 1/2/3/5, alta de tab/permiso/registro
  de módulo, render de las 4 tablas.
- **Fase 2** (sesión aparte): vista 4, reutilizando
  `calcularRendimientoMaterial` sin modificarlo.

## Fuera de alcance

- Exportación TXT/PDF/CSV/Telegram.
- Gráficas.
- Selector de período — el mes calendario sale siempre de la fecha de
  cada registro, no hay filtro de rango en este módulo.
- Cualquier cambio a `reportes.js`, `rendimientos.js` o
  `control-produccion.js`.
