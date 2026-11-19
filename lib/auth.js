// Autenticación compartida (sirve en el proxy y en las rutas).
//
// Sesión: la cookie `ae_auth` NO guarda la contraseña, guarda una huella (SHA-256) derivada de ella.
// Así, si alguien ve la cookie, no puede leer la contraseña. Cambiar la contraseña cierra todas las sesiones.
//
// Servicios (cron de Vercel, agente): entran con un secreto en la cabecera Authorization: Bearer <secreto>
// o x-connect-token. Si el secreto no está configurado, ESA ruta queda cerrada (nunca abierta por olvido).

async function sha256Hex(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const COOKIE = 'ae_auth';

export async function huellaSesion(password) {
  return sha256Hex('adoption-dashboard|' + password);
}

export async function sesionValida(req) {
  const pass = process.env.ADOPTION_PASSWORD;
  if (!pass) return process.env.NODE_ENV !== 'production'; // sin contraseña: solo se permite en local
  const cookie = req.cookies.get(COOKIE)?.value;
  return !!cookie && cookie === (await huellaSesion(pass));
}

function igual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** ¿La petición trae uno de los secretos de servicio indicados (nombres de variables de entorno)? */
export function secretoValido(req, nombresEnv) {
  const enviado = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.headers.get('x-connect-token') || '';
  return nombresEnv.some((n) => igual(enviado, process.env[n] || ''));
}
