# eve-control-worker

Worker de Cloudflare de EVE Control. Accede a Firestore e Identity Toolkit por REST con una cuenta de servicio (Web Crypto, sin `firebase-admin`).

## Endpoints y autenticación

Todos los endpoints, salvo `/health`, exigen un **ID token de Firebase** en `Authorization: Bearer <token>`. El Worker verifica el JWT con Web Crypto (RS256, claves públicas de Google `securetoken` con caché según `Cache-Control`, `iss` y `aud` = proyecto `everplastic`, `exp`, `iat`, `auth_time`, `sub`). Responde **401** si el token falta o es inválido.

| Endpoint | Quién puede | Notas |
|---|---|---|
| `GET /health` | Cualquiera | `{"status":"ok"}` |
| `POST /device-check` | Cualquier usuario autenticado | El `uid` sale del token; solo registra o consulta los dispositivos de ese uid. 403 = límite de dispositivos alcanzado. El cliente es fail-open ante cualquier otro fallo. |
| `GET /admin/devices?uid=` | Admin con escritura | Lista los dispositivos de un usuario. |
| `DELETE /admin/devices` | Admin con escritura | `{uid, deviceId}`: libera un dispositivo. |
| `POST /admin/reset-password` | Admin con escritura | `{uid}`: asigna una contraseña aleatoria y la devuelve una sola vez. |

"Admin con escritura" = el documento `users/{uid}` del llamador tiene `permisosResueltos.admin == 'escritura'` (el mismo criterio que `esAdminEscritura()` en `firestore.rules`); si no, **403**. No hay ningún secreto compartido en el cliente: `DEVICE_CHECK_SECRET` ya no se usa.

Límite conocido: un ID token ya emitido sigue siendo válido hasta su `exp` (máximo una hora) aunque la cuenta se deshabilite; el permiso Admin sí se lee de Firestore en cada petición.

## Secretos del Worker (`wrangler secret put`)

- `FIREBASE_SERVICE_ACCOUNT_JSON` — llave de la cuenta de servicio (nunca en el repo).
- `FIREBASE_PROJECT_ID` — opcional; por omisión `everplastic`.
- `DEVICE_CHECK_SECRET` — **obsoleto**, hay que borrarlo tras desplegar (ver abajo).

Archivos locales ignorados por git: `service-account.json` y `.dev.vars`.

## Pruebas

`node scripts/verificar-worker-auth.js` (desde la raíz del repo): carga el Worker real con un Google y un Firestore falsos, y JWT firmados con una clave de prueba.

## Desplegar (cuando el usuario lo apruebe)

1. `npx wrangler login` y `npx wrangler whoami` (desde esta carpeta).
2. `npx wrangler dev` y `curl http://localhost:8787/health` para probar en local.
3. `npx wrangler deploy` publica el Worker (esto sí es público).

Orden seguro para el cambio de autenticación (W1): primero el Worker nuevo, después el cliente con push, y solo al final borrar el secreto viejo del Worker.
