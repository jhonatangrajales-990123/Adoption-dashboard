// Autenticación compartida (sirve en el proxy y en las rutas). Hay dos llaves de entrada:
//
// 1. Google, solo cuentas @alegra.com (si están GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y NEXTAUTH_SECRET).
// 2. Contraseña del equipo (si está ADOPTION_PASSWORD). La cookie `ae_auth` NO guarda la contraseña,
//    guarda una huella (SHA-256) derivada de ella; cambiar la contraseña cierra todas las sesiones.
//
// Si no hay ninguna de las dos configurada: en local se deja pasar; en producción todo queda cerrado.
//
// Servicios (cron de Vercel, agente): entran con un secreto en la cabecera Authorization: Bearer <secreto>
// o x-connect-token. Si el secreto no está configurado, ESA ruta queda cerrada (nunca abierta por olvido).
import { getToken } from 'next-auth/jwt';

export const DOMINIO = '@alegra.com';
export const COOKIE = 'ae_auth';

export const googleActivo = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.NEXTAUTH_SECRET);
export const passwordActivo = () => !!process.env.ADOPTION_PASSWORD;
export const accesoConfigurado = () => googleActivo() || passwordActivo();

async function sha256Hex(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function huellaSesion(password) {
  return sha256Hex('adoption-dashboard|' + password);
}

async function sesionPassword(req) {
  if (!passwordActivo()) return false;
  const cookie = req.cookies.get(COOKIE)?.value;
  return !!cookie && cookie === (await huellaSesion(process.env.ADOPTION_PASSWORD));
}

async function sesionGoogle(req) {
  if (!googleActivo()) return false;
  try {
    const t = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    return !!t?.email && String(t.email).toLowerCase().endsWith(DOMINIO);
  } catch {
    return false;
  }
}

export async function sesionValida(req) {
  if (!accesoConfigurado()) return process.env.NODE_ENV !== 'production'; // sin llaves: solo se permite en local
  return (await sesionGoogle(req)) || (await sesionPassword(req));
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
