---
name: subir-cache-sw
description: Sube en 1 el número r de CACHE_NAME en service-worker.js y corre scripts/verificar-appshell.js. Úsala antes de cada commit que toque js/, css/ o index.html, para que los usuarios reciban el cambio.
---

# subir-cache-sw

Sin subir `CACHE_NAME` el service worker sigue sirviendo la versión anterior desde caché.

## Pasos

1. Lee la primera línea de `service-worker.js`: `const CACHE_NAME = 'eve-control-v3-rNNN';` (al momento de escribir esta skill, `eve-control-v3-r181`). Guarda el valor actual.
2. Cambia solo ese número: `rNNN` pasa a `r(NNN+1)`. No toques nada más del archivo. Respeta los finales de línea que ya tenga.
3. Corre `node scripts/verificar-appshell.js` desde la raíz del proyecto.
4. Reporta el `CACHE_NAME` anterior, el nuevo y el resultado de la verificación (código de salida y resumen).

## Si verificar-appshell falla

- Detente. No hagas commit ni `git add`.
- Reporta la salida completa del verificador y qué comprobación falló (script local que falta en `APP_SHELL`, ruta inexistente o entrada duplicada).
- No corrijas `APP_SHELL` por tu cuenta salvo que el usuario lo pida. El número de caché ya subido se queda como está para que el usuario decida.

## Reglas

- Solo se sube 1 por commit, aunque el commit toque varios archivos.
- Esta skill no hace commit ni push; eso lo hace quien la invoca.
- Si el commit no toca `js/`, `css/` ni `index.html`, no la uses.
