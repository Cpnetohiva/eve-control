---
name: cerrar-tarea-eve
description: Ciclo de cierre de una tarea en EVE Control: graphify, pruebas nuevas y existentes, subir CACHE_NAME, commit, push opcional y verificación de que master y origin/master coinciden. Úsala al terminar cualquier cambio de código.
---

# cerrar-tarea-eve

Entradas que da el usuario: el mensaje de commit, las pruebas nuevas o específicas a correr y si debe hacerse `git push origin master`.

## Orden

1. `graphify cluster-only . --no-label`. Si falla, repórtalo y continúa.
2. Pruebas: corre con `node scripts/<archivo>.js` las que indicó el usuario y, además, las suites existentes del área tocada (por ejemplo, para CxP y Pagos: `verificar-captura-cxp`, `verificar-pago-recibo-cuenta`, `verificar-pago-general-sobrante`, `verificar-pagos-saldo-inicial`, `verificar-doble-clic-modulos`). Anota el resultado de cada una.
   - Si una prueba **nueva** falla, **detente antes del commit** y reporta la salida. No subas caché ni hagas commit.
   - `verificar-gastos-tipo` falla 4 de 9 desde antes; si falla igual, repórtalo como conocida y no la toques.
3. Si hubo cambios en `js/`, `css/` o `index.html`, invoca la skill `subir-cache-sw`. Si esa skill se detiene, tú también.
4. `graphify update .`
5. `git add` solo de los archivos de la tarea (nunca `git add -A` a ciegas) y `git commit` con el mensaje exacto del usuario, terminando con la línea Co-Authored-By que indique el entorno.
6. `git push origin master` **solo si el usuario lo pidió**. Si no, dilo en el informe.
7. `git rev-parse master origin/master` y `git status -sb`: confirma si apuntan al mismo hash. Si no hubo push, reporta cuántos commits va adelante.

## Informe final (corto)

- Resultado por prueba (nombre y casos pasados de total, o fallo).
- `CACHE_NAME` nuevo, si se subió.
- Hash final del commit.
- Estado de sincronización: iguales, o adelantado N commits (sin push).
- Cualquier cosa que se omitió o falló, dicha tal cual.

## Reglas

- No despliegues `firestore.rules` ni toques `rules-test/firestore.rules`.
- En `js/cxp.js` y `js/pagos.js` conserva CRLF al editar.
- Si hay archivos sin relación en `git status`, no los incluyas en el commit.
