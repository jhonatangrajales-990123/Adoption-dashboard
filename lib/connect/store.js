// Almacenamiento del tablero de Connect.
// Cuatro piezas, cada una con su fecha de corte:
//   recs  -> registros normalizados de HubSpot (los refresca el cron o el botón)
//   ret   -> retención por cohortes (la calcula el agente con Metabase y la sube)
//   act   -> activación por trimestre (Metabase, la sube el agente)
//   actA  -> activación por analista: { corte, nota, activas[] } (Metabase, la sube el agente)
// En producción con Vercel KV (KV_REST_API_URL) persiste ahí; sin KV cae a memoria (local).
// Los datos van comprimidos (gzip + base64) porque el KV gratuito limita el tamaño de cada valor.
import { gzipSync, gunzipSync } from 'node:zlib';

const PIEZAS = ['recs', 'ret', 'act', 'actA'];
const hasKV = () => !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const key = (p) => `connect_${p}_v1`;

globalThis.__CONNECT_CACHE__ = globalThis.__CONNECT_CACHE__ || {};

const empacar = (obj) => gzipSync(Buffer.from(JSON.stringify(obj))).toString('base64');
const desempacar = (s) => JSON.parse(gunzipSync(Buffer.from(s, 'base64')).toString());

export async function guardar(pieza, valor) {
  if (!PIEZAS.includes(pieza)) throw new Error('pieza no válida: ' + pieza);
  if (hasKV()) {
    const { kv } = await import('@vercel/kv');
    await kv.set(key(pieza), empacar(valor));
  }
  globalThis.__CONNECT_CACHE__[pieza] = valor;
}

export async function cargar(pieza) {
  const cache = globalThis.__CONNECT_CACHE__;
  if (cache[pieza] !== undefined) return cache[pieza];
  if (hasKV()) {
    const { kv } = await import('@vercel/kv');
    const raw = await kv.get(key(pieza));
    if (raw) { cache[pieza] = desempacar(raw); return cache[pieza]; }
  }
  return null;
}

export async function cargarTodo() {
  const [recs, ret, act, actA] = await Promise.all(PIEZAS.map(cargar));
  return { recs, ret, act, actA };
}
