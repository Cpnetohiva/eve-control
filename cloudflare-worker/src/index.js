import { obtenerDocumento, listarDocumentos, escribirDocumento, eliminarDocumento, restablecerPassword } from './firebase.js';

const ALLOWED_ORIGIN = 'https://cpnetohiva.github.io';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN
    }
  });
}

const LIMITE_DISPOSITIVOS_DEFAULT = 2;

async function manejarDeviceCheck(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Body inválido: se esperaba JSON' }, 400);
  }

  const { uid, token, fingerprint, userAgent } = body ?? {};
  if (!uid || !token || !fingerprint || !userAgent) {
    return jsonResponse({ error: 'Faltan campos requeridos: uid, token, fingerprint, userAgent' }, 400);
  }

  if (request.headers.get('x-device-check-secret') !== env.DEVICE_CHECK_SECRET) {
    return jsonResponse({ error: 'no autorizado' }, 401);
  }

  const serviceAccountJson = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const rutaDispositivos = `users/${uid}/dispositivos`;
  const ahora = new Date().toISOString();

  const usuario = await obtenerDocumento(serviceAccountJson, 'users', uid);
  const limiteDispositivos = usuario?.limiteDispositivos ?? LIMITE_DISPOSITIVOS_DEFAULT;
  const exentoDispositivos = usuario?.exentoDispositivos ?? false;

  const dispositivos = await listarDocumentos(serviceAccountJson, rutaDispositivos);

  const porToken = dispositivos.find((d) => d.token === token);
  if (porToken) {
    const { id, ...campos } = porToken;
    await escribirDocumento(serviceAccountJson, rutaDispositivos, id, {
      ...campos,
      ultimoAcceso: ahora
    });
    return jsonResponse({ allowed: true, reason: 'token_match' });
  }

  const porFingerprint = dispositivos.find((d) => d.fingerprint === fingerprint);
  if (porFingerprint) {
    await escribirDocumento(serviceAccountJson, rutaDispositivos, porFingerprint.id, {
      token,
      fingerprint,
      userAgent,
      fechaRegistro: porFingerprint.fechaRegistro,
      ultimoAcceso: ahora
    });
    return jsonResponse({ allowed: true, reason: 'fingerprint_match', reconciled: true });
  }

  if (exentoDispositivos) {
    const deviceId = crypto.randomUUID();
    await escribirDocumento(serviceAccountJson, rutaDispositivos, deviceId, {
      token,
      fingerprint,
      userAgent,
      fechaRegistro: ahora,
      ultimoAcceso: ahora
    });
    return jsonResponse({ allowed: true, reason: 'new_device_registered', exento: true });
  }

  if (dispositivos.length < limiteDispositivos) {
    const deviceId = crypto.randomUUID();
    await escribirDocumento(serviceAccountJson, rutaDispositivos, deviceId, {
      token,
      fingerprint,
      userAgent,
      fechaRegistro: ahora,
      ultimoAcceso: ahora
    });
    return jsonResponse({ allowed: true, reason: 'new_device_registered' });
  }

  return jsonResponse({ allowed: false, reason: 'limit_reached', limite: limiteDispositivos }, 403);
}

async function manejarAdminDevicesGet(request, env) {
  if (request.headers.get('x-device-check-secret') !== env.DEVICE_CHECK_SECRET) {
    return jsonResponse({ error: 'no autorizado' }, 401);
  }

  const url = new URL(request.url);
  const uid = url.searchParams.get('uid');
  if (!uid) {
    return jsonResponse({ error: 'Falta el query param uid' }, 400);
  }

  const serviceAccountJson = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const dispositivos = await listarDocumentos(serviceAccountJson, `users/${uid}/dispositivos`);
  return jsonResponse(dispositivos);
}

async function manejarAdminDevicesDelete(request, env) {
  if (request.headers.get('x-device-check-secret') !== env.DEVICE_CHECK_SECRET) {
    return jsonResponse({ error: 'no autorizado' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Body inválido: se esperaba JSON' }, 400);
  }

  const { uid, deviceId } = body ?? {};
  if (!uid || !deviceId) {
    return jsonResponse({ error: 'Faltan campos requeridos: uid, deviceId' }, 400);
  }

  const serviceAccountJson = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  await eliminarDocumento(serviceAccountJson, `users/${uid}/dispositivos`, deviceId);
  return jsonResponse({ success: true });
}

// Excluye caracteres ambiguos: 0, O, 1, l, I.
const ALFABETO_PASSWORD = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function generarPasswordAleatoria(longitud = 10) {
  const valores = new Uint32Array(longitud);
  crypto.getRandomValues(valores);
  let password = '';
  for (let i = 0; i < longitud; i++) {
    password += ALFABETO_PASSWORD[valores[i] % ALFABETO_PASSWORD.length];
  }
  return password;
}

async function manejarAdminResetPassword(request, env) {
  if (request.headers.get('x-device-check-secret') !== env.DEVICE_CHECK_SECRET) {
    return jsonResponse({ error: 'no autorizado' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Body inválido: se esperaba JSON' }, 400);
  }

  const { uid } = body ?? {};
  if (!uid) {
    return jsonResponse({ error: 'Falta el campo requerido: uid' }, 400);
  }

  // Esta es la única vez que la contraseña generada se expone: el Worker
  // no la persiste en ningún lado, solo la retorna en esta respuesta.
  const nuevaPassword = generarPasswordAleatoria();
  await restablecerPassword(env.FIREBASE_SERVICE_ACCOUNT_JSON, uid, nuevaPassword);
  return jsonResponse({ success: true, nuevaPassword });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-device-check-secret'
        }
      });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse({ status: 'ok' });
    }

    if (request.method === 'POST' && url.pathname === '/device-check') {
      try {
        return await manejarDeviceCheck(request, env);
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

    if (request.method === 'GET' && url.pathname === '/admin/devices') {
      try {
        return await manejarAdminDevicesGet(request, env);
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

    if (request.method === 'DELETE' && url.pathname === '/admin/devices') {
      try {
        return await manejarAdminDevicesDelete(request, env);
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

    if (request.method === 'POST' && url.pathname === '/admin/reset-password') {
      try {
        return await manejarAdminResetPassword(request, env);
      } catch (error) {
        return jsonResponse({ error: error.message }, 500);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }
};
