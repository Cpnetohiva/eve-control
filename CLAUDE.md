# EVE Control v2

## Qué es y arquitectura
EVE Control es el sistema operativo de EVERPLASTIC (acopio, producción, ventas, cuentas por pagar y cobrar, flujo).
- PWA sin framework: cada módulo es `js/<modulo>.js` y publica `window.EVE_<MODULO>`; el estado en memoria vive en `window.EVE`.
- Firebase (proyecto `everplastic`): Auth y Firestore vía `window.db` con `guardarDato`, `actualizarDato` y `eliminarDato`.
- `js/offline.js` envuelve esas tres funciones para encolar escrituras sin conexión (IndexedDB); permisos en `js/permisos.js`.
- `service-worker.js` (cache-first, `CACHE_NAME` tipo `eve-control-v3-rNNN`) y `cloudflare-worker/` (dispositivos y reset de contraseña).
- Pruebas: `scripts/verificar-*.js` (Playwright o contexto `vm`), se corren con `node scripts/<archivo>.js`.
- Mapa de módulos, colecciones y flujo entre módulos: `AUDITORIA_PROYECTO.md`, sección 4.

## Ciclo de cierre de tarea
1. `graphify cluster-only . --no-label` al empezar.
2. Hacer el cambio con su prueba nueva en `scripts/verificar-<tema>.js`; la prueba debe fallar sin el cambio y pasar con él.
3. Correr la prueba nueva y las suites existentes del área tocada; si una falla, no se hace commit.
4. Si cambió `js/`, `css/` o `index.html`: subir 1 a `CACHE_NAME` y correr `node scripts/verificar-appshell.js`.
5. `graphify update .`
6. `git commit` con el mensaje indicado (termina con la línea Co-Authored-By que pida el entorno).
7. `git push origin master` solo si se pidió.
8. Verificar con `git rev-parse master origin/master` que ambos hashes coinciden.

Falla conocida, anterior a cualquier cambio reciente: `scripts/verificar-gastos-tipo.js` (4 de 9). No se toca sin que se pida.

## Reglas duras
- Nunca desplegar `firestore.rules` sin aprobación explícita. Se puede commitear el archivo; el despliegue es un paso aparte.
- No tocar `rules-test/firestore.rules` (`verificar-cotizaciones-base.js` lo usa a propósito con el `write` genérico).
- `js/cxp.js` y `js/pagos.js` están en CRLF en la copia de trabajo: editar conservando los finales de línea.
- La semana de CxP no es la semana calendario: usar `calcularCorteSemanalCxP` en `js/cxp.js`.
- Todo archivo nuevo de `js/` va en `index.html` (`<script src>`) y en `APP_SHELL` de `service-worker.js`.
- Escrituras que el usuario puede disparar dos veces van dentro de `window.protegerContraDobleRegistro(clave, accion)`.
- No guardar contraseñas, tokens ni llaves en el repo ni en documentos. `docs/superpowers/credenciales-phase2.json` es local e ignorado.
- Los archivos `CONTEXTO_EVE_CONTROL_*.md` y `docs/auditoria_*.md`, `docs/propuesta_*.md`, `docs/diseno_*.md`, `docs/verificacion_*.md` están en `.gitignore`.

## Convenciones
- Texto de interfaz, comentarios y commits en español de México; código en el estilo del archivo que se edita.
- Montos de CxP en centavos enteros al repartir; PEPS = más antiguo primero (fecha de ticket, ticket, fecha de registro).
- `ticket = 'V'` en `destaraje` es legado de ventas y no se muestra en Báscula.

## Documentación
- `docs/MANUAL_OPERACION.md`: funcionamiento por módulo (desfasado desde 2026-09-12).
- `ESTADO-PROYECTO.md`: estado general (fecha 2026-09-01, desfasado).
- `docs/auditoria_*.md`: auditorías de solo lectura por tema.
- `matriz-pruebas-firestore-rules.md`: pruebas de las reglas de Firestore.
- `cloudflare-worker/README.md`: endpoints y secretos del Worker.
- `AUDITORIA_PROYECTO.md`: inventario, procesos, duplicados y plan de limpieza (2026-10-20).

## Preguntas pendientes
- ¿El `CLAUDE.md` de `C:\Users\cpnet\` (graphify) debe fusionarse con este o quedarse aparte?
- ¿Qué suites son obligatorias en cada cierre? Hoy se elige por área tocada; no hay lista fija ni ejecutor único.
- ¿La rama de trabajo seguirá siendo `master` o se usará `main`?
- ¿Quién actualiza `docs/MANUAL_OPERACION.md` y con qué frecuencia?
