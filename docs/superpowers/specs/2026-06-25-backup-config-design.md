# Fase 8c — Panel Admin: Backup/Exportación + Configuración del Sistema

Fuente: `EVERPLASTIC COO.md` (sección "PANEL ADMIN (`admin.js`)", subsecciones
"4. Backup / Exportación" y "5. Configuración del Sistema"). Tercera de 4
sub-fases del Panel Admin (8a Usuarios → 8b Importación de Datos →
**8c Backup/Exportación + Configuración del Sistema** → 8d Gestión de
Datos), decomposición acordada al iniciar el brainstorming de la Fase 8.
Continúa la Fase 8b (Importación de Datos), ya fusionada a `master`.

## Objetivo

Dos sub-pestañas nuevas en el Panel Admin (junto a "Usuarios" e "Importar
Datos"):

- **Backup**: descargar un backup completo en JSON, descargar un backup
  completo en Excel (una hoja por módulo), y un botón "Probar Telegram"
  que envía un mensaje de prueba real al chat configurado.
- **Configuración**: editar el token de Telegram, el Chat ID, y la
  preferencia de horario de reporte automático — sin construir el
  mecanismo que realmente dispara ese envío automático (ver "Fuera de
  alcance").

## Arquitectura

- **`js/admin-backup.js`** (nuevo): namespace `window.EVE_ADMIN_BACKUP`
  — backup JSON, backup Excel, "Probar Telegram". Registrado como
  sub-pestaña "Backup" en `js/admin.js`.
- **`js/admin-config.js`** (nuevo): namespace `window.EVE_ADMIN_CONFIG`
  — formulario de configuración de Telegram/horario. Registrado como
  sub-pestaña "Configuración" en `js/admin.js`.
- Ambos archivos leen/escriben el documento `config/telegram` en
  Firestore de forma independiente (sin compartir código entre sí),
  mismo criterio que `admin-usuarios.js`/`admin-importar.js` no se
  referencian entre sí en la Fase 8a/8b.
- Sin cambios a `js/reportes.js`, `js/admin-usuarios.js`,
  `js/admin-importar.js`, ni a ningún módulo operativo
  (`destaraje.js`/`produccion.js`/`pagos.js`/`control-produccion.js`).

## Backup / Exportación

- **Backup JSON completo**: reúne los datos ya cargados en memoria
  (`window.EVE.registrosDestaraje` + `registrosVentas` combinados en un
  solo arreglo `destaraje`, `registrosProduccion`, `registrosPagos`,
  `registrosMinistraciones`, `registrosControlProduccion`) en
  `{ destaraje, produccion, pagos, ministraciones, controlProduccion }`,
  `JSON.stringify(..., null, 2)`, descargado vía
  `window.descargarArchivo` (ya existente en `utils.js`) como
  `Backup_EVE_Control_<fecha>.json` (fecha vía
  `window.obtenerFechaMexico()`). **Sin lecturas nuevas a Firestore** —
  reutiliza los arreglos que ya están en memoria desde el login.
- **Backup Excel completo**: mismos 5 conjuntos de datos, una hoja por
  módulo (`Destaraje`, `Produccion`, `Pagos`, `Ministraciones`,
  `ControlProduccion`). A diferencia de la plantilla de importación de
  la Fase 8b (encabezados fijos, pensada para que un humano la llene a
  mano), aquí cada hoja se genera con `XLSX.utils.json_to_sheet(registros)`
  — las columnas se derivan automáticamente de los campos reales de
  cada registro, ya que es un volcado completo, no una plantilla.
  Descargado como `Backup_EVE_Control_<fecha>.xlsx` vía `XLSX.writeFile`.
- **La colección `users` nunca se incluye** en ningún backup (ni JSON
  ni Excel) — decisión explícita de esta fase, dado que `users` guarda
  contraseñas en texto plano. Si en el futuro se necesita restaurar
  usuarios, será una pieza separada con su propio diseño.
- **"Probar Telegram"**: lee `window.db.collection('config').doc('telegram').get()`;
  si el documento no existe o falta `token`/`chatId`, error claro
  (`showError`) sin intentar ninguna llamada — mismo mensaje y patrón
  de guarda que `js/reportes.js`'s `enviarReporteTelegram` ya usa
  (`'Configura el token de Telegram primero (Firestore: config/telegram)'`).
  Si están, llama `sendMessage` con el texto fijo
  `"✅ Prueba de conexión EVE Control"` al `chatId` configurado — un
  mensaje real, no solo una verificación de token (`getMe`), porque
  confirma de extremo a extremo que el token Y el chatId configurados
  funcionan juntos, que es lo que el spec original pide literalmente
  ("envía mensaje de prueba"). Verifica `resultado.ok` de la respuesta
  de Telegram; si es `false`, lanza un error con
  `resultado.description`, mismo criterio que `enviarReporteTelegram`.

## Configuración del Sistema

- Formulario con 3 campos: Token de Telegram (texto), Chat ID (texto),
  Horario de reporte automático (`<input type="time">`).
- Al renderizar la vista, lee `config/telegram` y prellena los 3
  campos; si el documento no existe todavía (primera vez en un
  ambiente nuevo), los campos de texto quedan vacíos y el de horario
  toma el valor por defecto `"20:00"` (literal del spec: "por defecto
  20:00 hora México").
- Al guardar, escribe `{ token, chatId, horaReporte }` con
  `window.db.collection('config').doc('telegram').set(datos, { merge: true })`
  — **no** se usa el helper genérico `window.actualizarDato` (que hace
  `.update()`, el cual falla si el documento no existe todavía). `.set`
  con `merge: true` funciona tanto si el documento ya existe como si
  es la primera vez que se configura Telegram en un ambiente.
- Validación mínima: solo se exige que Token y Chat ID no estén vacíos
  (después de `trim()`) para guardar; sin validación de formato sobre
  su contenido (son cadenas de Telegram con formatos variados, fuera
  del control de esta app). El campo de horario siempre tiene un valor
  válido por ser `<input type="time">` (el navegador no permite texto
  arbitrario ahí).

## Archivos

- Crear `js/admin-backup.js`, `js/admin-config.js`.
- Modificar `js/admin.js`: agregar las sub-pestañas "Backup" y
  "Configuración" a `SUBPESTANAS`, delegando a
  `EVE_ADMIN_BACKUP.crearVistaBackup()` y
  `EVE_ADMIN_CONFIG.crearVistaConfig()` respectivamente.
- Modificar `index.html`: agregar 2 `<script>` nuevos, después de
  `admin-importar.js` y antes de `admin.js` (mismo orden de dependencia
  ya establecido).
- Modificar `css/styles.css`: estilos para los botones de exportación y
  el formulario de configuración.

## Fuera de alcance

- **El mecanismo real de envío automático programado** (Cloud Function,
  Cloud Scheduler, o cualquier disparador del lado del servidor) — esta
  fase solo construye el campo para que el admin guarde la hora
  deseada en Firestore; nada en este repositorio cliente despierta ni
  envía nada por sí solo a esa hora. Confirmado explícitamente con el
  usuario al inicio del brainstorming.
- Restaurar un backup (subir el JSON/Excel de vuelta a Firestore) — el
  spec solo pide exportar, no importar de vuelta; reimportar un backup
  completo sería una extensión natural de la Fase 8b si se necesita en
  el futuro, no de esta fase.
- Gestión de Datos / borrado masivo — sub-fase futura (8d).
- Cualquier cambio a `js/reportes.js`, `js/admin-usuarios.js`,
  `js/admin-importar.js`, o a cualquier módulo operativo — esta fase
  es enteramente aditiva.

## Criterio de aceptación

- Node: construcción del objeto de backup completo a partir de
  fixtures en memoria (confirmando que `users` nunca aparece, que
  Destaraje combina compra+venta en un solo arreglo), validación del
  formulario de configuración (token/chatId vacíos bloquean el
  guardado), y el payload exacto que se envía a `.set()` — todo con
  fixtures en memoria, sin Firestore real.
- Playwright en vivo: descargar el backup JSON y confirmar que el
  archivo resultante NO contiene la palabra `"password"` en ningún
  lado; descargar el backup Excel y confirmar que se generó con las 5
  hojas esperadas; confirmar que el botón "Probar Telegram" existe
  pero **nunca hacer clic en él** en el script automatizado (mismo
  criterio de seguridad ya establecido en la Fase 7 para el botón de
  Telegram de Reportes — un clic real envía un mensaje real).
  **Riesgo identificado y mitigado explícitamente**: probar el guardado
  de configuración significa escribir sobre el documento real
  `config/telegram`, que ya tiene credenciales de producción sembradas
  desde la Fase 7 — un fallo a mitad del script podría dejarlo con
  datos de prueba. El script de verificación debe, en este orden
  exacto: (1) leer y guardar en una variable los valores originales de
  `config/telegram` ANTES de cualquier escritura, (2) hacer el
  round-trip de guardado/relectura con valores de prueba claramente
  ficticios, (3) **restaurar los valores originales inmediatamente
  después** de confirmar el round-trip — antes de continuar con
  cualquier otro paso de la prueba, no al final del script — para que
  una falla posterior en otro punto del script deje el documento real
  ya restaurado, no a medias. Sin errores de consola.
