// Almacenamiento del snapshot de datos.
// - En producción con Vercel KV configurado (KV_REST_API_URL): persiste en KV.
// - Sin KV (local o Vercel sin KV): cae a una caché en memoria (globalThis),
//   que sobrevive mientras la instancia serverless esté caliente.

const KEY = 'adoption_explorer_data';
const hasKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

globalThis.__ADOPTION_CACHE__ = globalThis.__ADOPTION_CACHE__ || null;

export async function saveData(data) {
  if (hasKV) {
    const { kv } = await import('@vercel/kv');
    await kv.set(KEY, JSON.stringify(data));
  }
  globalThis.__ADOPTION_CACHE__ = data;
}

export async function loadData() {
  if (globalThis.__ADOPTION_CACHE__) return globalThis.__ADOPTION_CACHE__;
  if (hasKV) {
    const { kv } = await import('@vercel/kv');
    const raw = await kv.get(KEY);
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      globalThis.__ADOPTION_CACHE__ = parsed;
      return parsed;
    }
  }
  return null;
}
