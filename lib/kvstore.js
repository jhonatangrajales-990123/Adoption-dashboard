// Almacén de pares clave → texto, con tres modos (se elige solo según las variables de entorno):
//   1. REDIS_URL                          -> Redis por conexión directa (lo que tiene hoy el proyecto de Vercel)
//   2. KV_REST_API_URL + KV_REST_API_TOKEN -> Vercel KV / Upstash por REST (lo que usaba el explorador anterior)
//   3. ninguna                            -> solo memoria de la instancia (local o sin almacén configurado)
// En 1 y 2 los datos persisten entre visitas; en 3 se pierden al reiniciar.
import { createClient } from 'redis';

export function modoAlmacen() {
  if (process.env.REDIS_URL) return 'redis';
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return 'kv';
  return 'memoria';
}

// Una sola conexión por instancia del servidor (si falla, el siguiente intento vuelve a conectar)
async function redis() {
  if (!globalThis.__REDIS_CONN__) {
    const c = createClient({
      url: process.env.REDIS_URL,
      socket: { connectTimeout: 8000, reconnectStrategy: false },
    });
    c.on('error', () => { globalThis.__REDIS_CONN__ = null; }); // no tumbar el proceso por un error de red
    globalThis.__REDIS_CONN__ = c.connect().then(() => c).catch((e) => { globalThis.__REDIS_CONN__ = null; throw e; });
  }
  return globalThis.__REDIS_CONN__;
}

export async function kvSet(key, valor) {
  const modo = modoAlmacen();
  if (modo === 'redis') { await (await redis()).set(key, valor); return; }
  if (modo === 'kv') { const { kv } = await import('@vercel/kv'); await kv.set(key, valor); }
}

export async function kvGet(key) {
  const modo = modoAlmacen();
  try {
    if (modo === 'redis') return await (await redis()).get(key);
    if (modo === 'kv') { const { kv } = await import('@vercel/kv'); return await kv.get(key); }
  } catch (e) {
    console.error('Almacén no disponible al leer', key, e.message);
  }
  return null;
}
