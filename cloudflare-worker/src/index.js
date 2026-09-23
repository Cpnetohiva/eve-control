import { obtenerDocumento, listarDocumentos, escribirDocumento } from './firebase.js';

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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

    return jsonResponse({ error: 'Not found' }, 404);
  }
};
