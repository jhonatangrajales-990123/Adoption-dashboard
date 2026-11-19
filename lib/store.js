// Almacenamiento del snapshot de datos del explorador.
// Persiste en Redis / KV según las variables de entorno (ver lib/kvstore.js).
// Sin almacén configurado cae a una caché en memoria (globalThis), que sobrevive
// mientras la instancia serverless esté caliente.
import { kvGet, kvSet } from './kvstore.js';

const KEY = 'adoption_explorer_data';

globalThis.__ADOPTION_CACHE__ = globalThis.__ADOPTION_CACHE__ || null;

export async function saveData(data) {
  await kvSet(KEY, JSON.stringify(data));
  globalThis.__ADOPTION_CACHE__ = data;
}

export async function loadData() {
  if (globalThis.__ADOPTION_CACHE__) return globalThis.__ADOPTION_CACHE__;
  const raw = await kvGet(KEY);
  if (raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    globalThis.__ADOPTION_CACHE__ = parsed;
    return parsed;
  }
  return null;
}
