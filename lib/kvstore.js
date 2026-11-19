// Almacén de pares clave → texto, con tres modos (se elige solo según las variables de entorno):
//   1. KV_REST_API_URL + KV_REST_API_TOKEN -> Vercel KV / Upstash por REST (lo que pone Vercel al conectar un KV)
//   2. REDIS_URL                          -> Redis por conexión directa
//   3. ninguna                            -> solo memoria de la instancia (local o sin almacén configurado)
// En 1 y 2 los datos persisten entre visitas; en 3 se pierden al reiniciar.
// Si el almacén falla (por ejemplo, la base fue borrada), la app NO se cae: lo registra y sigue con la memoria.
import { createClient } from 'redis';

export function modoAlmacen() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return 'kv';
  if (process.env.REDIS_URL) return 'redis';
  return 'memoria';
}

globalThis.__ALMACEN_ERROR__ = globalThis.__ALMACEN_ERROR__ || null;
/** Último error del almacén en esta instancia (null si todo bien). */
export const errorAlmacen = () => globalThis.__ALMACEN_ERROR__;
const registrar = (accion, key, e) => {
  globalThis.__ALMACEN_ERROR__ = { accion, key, mensaje: e.message, fecha: new Date().toISOString() };
  console.error(`Almacén (${modoAlmacen()}) no disponible al ${accion} ${key}:`, e.message);
};

// Una sola conexión por instancia del servidor (si falla, el siguiente intento vuelve a conectar)
async function redis() {
  if (!globalThis.__REDIS_CONN__) {
    const c = createClient({
      url: process.env.REDIS_URL,
      socket: { connectTimeout: 5000, reconnectStrategy: false },
    });
    c.on('error', () => { globalThis.__REDIS_CONN__ = null; }); // no tumbar el proceso por un error de red
    globalThis.__REDIS_CONN__ = c.connect().then(() => c).catch((e) => { globalThis.__REDIS_CONN__ = null; throw e; });
  }
  return globalThis.__REDIS_CONN__;
}

/** Guarda; devuelve true si quedó persistido y false si solo quedó en memoria. */
export async function kvSet(key, valor) {
  const modo = modoAlmacen();
  try {
    if (modo === 'kv') { const { kv } = await import('@vercel/kv'); await kv.set(key, valor); return true; }
    if (modo === 'redis') { await (await redis()).set(key, valor); return true; }
  } catch (e) {
    registrar('guardar', key, e);
  }
  return false;
}

export async function kvGet(key) {
  const modo = modoAlmacen();
  try {
    if (modo === 'kv') { const { kv } = await import('@vercel/kv'); return await kv.get(key); }
    if (modo === 'redis') return await (await redis()).get(key);
  } catch (e) {
    registrar('leer', key, e);
  }
  return null;
}
