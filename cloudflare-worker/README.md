# eve-control-worker

Esqueleto mínimo de Cloudflare Worker (sin lógica de Firebase todavía). Expone un único endpoint:

- `GET /health` -> `{"status":"ok"}`

## Pasos manuales para autenticar y dejarlo listo para el primer deploy

Ejecutar en orden, desde esta carpeta (`cloudflare-worker/`):

1. **Autenticarte con Cloudflare** (abre el navegador para login OAuth):
   ```
   npx wrangler login
   ```

2. **Verificar que la sesión quedó activa:**
   ```
   npx wrangler whoami
   ```

3. **Probar el Worker en local** (levanta un servidor de desarrollo, no publica nada):
   ```
   npx wrangler dev
   ```
   Con el servidor corriendo, confirma en otra terminal:
   ```
   curl http://localhost:8787/health
   ```
   Debe responder `{"status":"ok"}`.

4. **Primer deploy** (cuando decidas publicarlo — esto sí es público):
   ```
   npx wrangler deploy
   ```
   La primera vez que corras `deploy`, Wrangler puede pedirte confirmar el `name` del Worker (`eve-control-worker`, definido en `wrangler.toml`) y la cuenta de Cloudflare a usar si tienes más de una.

## Notas

- No se instaló `wrangler` globalmente ni como dependencia local: cada comando usa `npx`, que descarga/cachea la versión más reciente por invocación.
- `wrangler.toml` fija `compatibility_date = "2026-09-23"` (fecha de creación de este esqueleto). Revísala antes del primer deploy si pasó mucho tiempo.
- Este Worker todavía no tiene lógica de Firebase ni variables de entorno/secrets configurados — eso se agrega en una iteración posterior.
