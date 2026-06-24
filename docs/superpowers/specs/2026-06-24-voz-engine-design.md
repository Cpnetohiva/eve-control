# Fase 3c — Motor de reconocimiento de voz

Fuente: `docs/PROMPT_ORIGINAL_EVE_CONTROL.md` (sección "🎤 RECONOCIMIENTO DE VOZ").
Continúa la Fase 3b (motor de reportes), ya fusionada a `master`.

Descomposición de la Fase 3 (sin cambios):
1. 3a — CRUD + UI + tabs + filtros ✅ (fusionado)
2. 3b — Motor de reporte PDF/TXT/CSV ✅ (fusionado)
3. **3c — Motor de reconocimiento de voz ← este documento**

## Objetivo de 3c

Un motor de voz (`js/voz.js`) reutilizable por los 3 módulos operativos
(Destaraje, Producción, Pagos), con los 3 parsers ya construidos —
Producción y Pagos no tienen módulo propio todavía (fases 4 y 5), así que
solo se conecta un botón 🎤 real al formulario de Destaraje, ya existente.

## Patrón hold-to-record

- `mousedown`/`touchstart` → `recognition.start()`.
- `mouseup`/`touchend`/`mouseleave` → `recognition.stop()`.
- `lang: 'es-MX'`, `continuous: false`, `interimResults: false` (nunca
  `continuous: true` — causa cortes en pausas largas, según el documento
  original).
- Si el navegador no expone `SpeechRecognition`/`webkitSpeechRecognition`,
  el botón existe pero al presionarlo muestra
  `showError('Tu navegador no soporta reconocimiento de voz')` en vez de
  fallar.
- Si el reconocimiento dispara `onerror` (sin habla detectada, permiso de
  micrófono denegado, error de red), se muestra
  `showError('No se pudo reconocer el audio, intenta de nuevo')`.

`crearBotonVoz(onResultado)` es genérico: no sabe nada de Destaraje — solo
crea el botón, maneja el ciclo de grabación, y llama `onResultado(texto)`
con el transcript crudo cuando hay un resultado. Cada módulo (Destaraje
ahora, Producción/Pagos después) decide qué hacer con el texto.

## Parseo

El texto reconocido se separa por comas, igual que los ejemplos exactos del
documento original (que siempre incluyen comas entre segmentos). Cada
parser espera exactamente 5 segmentos:

**Destaraje/Producción** (mismo patrón, distinto nombre de campo de salida):
```
Input:  "Ticket 9260 de Jose Enrique, Mixto, 650, entrada 23 abril, salida 24 abril"
Output: { ticket: "9260", proveedor: "Jose Enrique", material: "Mixto",
          kg: 650, fechaEntrada: "2026-04-23", fechaSalida: "2026-04-24" }

Input:  "Ticket P de Produccion, Peletizado, 1800, entrada 24 abril, salida 24 abril"
Output: { ticket: "P", cliente: "Produccion", material: "Peletizado",
          kg: 1800, fechaEntrada: "2026-04-24", fechaSalida: "2026-04-24" }
```

**Pagos:**
```
Input:  "Ticket 9260 de Jose Enrique, Mixto, 650, a 10, pagado 6500"
Output: { ticket: "9260", proveedor: "Jose Enrique", material: "Mixto",
          kg: 650, precioPorKg: 10, pagado: 6500, total: 6500 }
```
`total = kg * precioPorKg` (regla de negocio del Módulo 3, ya usada en el
formulario manual de Pagos cuando se construya en la fase 5).

Segmento 0 siempre tiene la forma `"Ticket {ticket} de {nombre}"` — un
parser común extrae `{ticket, nombre}` y cada función de módulo decide si
`nombre` va a `proveedor` o `cliente` en la salida.

### Fechas en español

Mapeo de meses (`enero`→1 ... `diciembre`→12). Patrón aceptado: `"{día}
{mes}"` o `"{día} de {mes}"` (con o sin "de"), con el prefijo
`"entrada "`/`"salida "` ya quitado por el parser del módulo antes de
llamar al parser de fecha. El año siempre es el año actual
(`obtenerFechaMexico()`) — no hay lógica de "rodar al año siguiente" si el
mes ya pasó; no está pedida por el spec original y se agrega complejidad
sin un caso de uso claro todavía.

### Manejo de errores de parseo

Si un segmento no coincide con el patrón esperado (frase incompleta, mes no
reconocido, número no reconocido), el parser lanza `Error` con un mensaje
en español describiendo qué no se reconoció. El llamador (el botón de
Destaraje) atrapa el error y lo muestra con `showError`.

## Integración con Destaraje

- Se agrega un botón 🎤 al formulario de Destaraje (`crearFormulario`),
  junto a los campos existentes.
- Al reconocer correctamente: si `datos.ticket === 'V'`, cambia el
  formulario a modo Venta (mismo mecanismo que el radio Compra/Venta
  existente — `tipoFormulario = 'venta'` + `aplicarModoFormulario()`); si
  no, modo Compra y llena `#df-ticket` con el valor reconocido.
  `#df-proveedor`, `#df-material`, `#df-kg`, `#df-entrada`, `#df-salida` se
  llenan en ambos casos.
- **No se guarda automáticamente.** El usuario revisa los campos llenados y
  da clic en "Guardar" como con cualquier captura manual — decisión ya
  acordada, dado que el reconocimiento de voz puede fallar y el usuario
  necesita poder corregir antes de que el dato llegue a Firestore.
- Si el parseo falla, los campos del formulario no se tocan y se muestra el
  error.

## Archivos

- Crear `js/voz.js`: `crearBotonVoz`, los 3 parsers, el parser de fecha y
  el parser de ticket+nombre compartido — todos dentro de un IIFE (mismo
  patrón que `destaraje.js`/`reportes.js`), con la API pública en `window`.
- Modificar `js/destaraje.js`: agregar el botón de voz al formulario y la
  función que aplica el resultado reconocido a los campos.
- Modificar `index.html`: `<script src="js/voz.js">` antes de
  `destaraje.js` (que lo consume).
- Modificar `css/styles.css`: estilos para `.btn-voz` y su estado
  `.grabando` (mientras se mantiene presionado).

## Fuera de alcance

- Conectar el botón a Producción/Pagos → fases 4 y 5 (cuando esos módulos
  existan, solo necesitan llamar `window.crearBotonVoz` + el parser
  correspondiente, ya construidos).
- Cualquier UI nueva fuera del botón y el manejo de resultado.

## Criterio de aceptación

- Node: los 3 parsers reproducen exactamente los 3 ejemplos input→output
  del documento original, más casos de error (segmento faltante, mes no
  reconocido, número no reconocido).
- Playwright en vivo (sin micrófono real): se inyecta una clase
  `SpeechRecognition` falsa en el navegador que dispara un resultado con un
  texto fijo al llamar `.start()`. Mantener presionado el botón llena el
  formulario de Destaraje correctamente en dos escenarios — una compra
  (ticket numérico) y una venta (ticket "V", que además cambia el modo del
  formulario a Venta) — y una frase incompleta muestra el error esperado
  sin tocar el formulario. Sin errores de consola. No se escribe nada en
  Firestore (la voz solo llena el formulario; guardar sigue siendo una
  acción manual ya probada en 3a).
