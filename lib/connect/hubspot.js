// Descarga de tickets de Adoption desde HubSpot (reemplaza a scripts/connect_dashboard/fetch.ps1).
// Baja todos los registros creados desde el 1-ene-2026 de los dos pipelines, en tramos de un mes
// para no chocar con el tope de 10.000 resultados por búsqueda, y la lista de owners.
// El token vive solo en la variable de entorno HUBSPOT_TOKEN (nunca llega al navegador).
import { PIPE_NEW, PIPE_OLD, PROPIEDADES } from './normalizar.js';

const API = 'https://api.hubapi.com';
const OBJETO_TICKETS = '2-40542822';
export const INICIO = Date.UTC(2026, 0, 1);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(token, url, opciones = {}, intentos = 4) {
  for (let i = 0; i < intentos; i++) {
    const res = await fetch(url, {
      ...opciones,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opciones.headers || {}) },
    });
    if (res.ok) return res.json();
    // 429 (límite de velocidad) y 5xx: esperar y reintentar
    if (res.status === 429 || res.status >= 500) { await dormir(800 * (i + 1)); continue; }
    throw new Error(`HubSpot respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error('HubSpot no respondió tras varios intentos');
}

export async function bajarTickets(token, { hasta = Date.now() } = {}) {
  const todos = [];
  for (const pipe of [PIPE_OLD, PIPE_NEW]) {
    for (let d = new Date(INICIO); d.getTime() < hasta; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      const lo = d.getTime();
      const hi = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1;
      let after;
      do {
        const body = {
          filterGroups: [{ filters: [
            { propertyName: 'hs_pipeline', operator: 'EQ', value: pipe },
            { propertyName: 'hs_createdate', operator: 'BETWEEN', value: String(lo), highValue: String(hi) },
          ] }],
          properties: PROPIEDADES,
          limit: 200,
        };
        if (after) body.after = after;
        const r = await pedir(token, `${API}/crm/v3/objects/${OBJETO_TICKETS}/search`, { method: 'POST', body: JSON.stringify(body) });
        for (const x of r.results || []) todos.push(x.properties);
        after = r.paging?.next?.after;
        await dormir(200);
      } while (after);
    }
  }
  return todos;
}

export async function bajarOwners(token) {
  const owners = {};
  for (const archivados of ['false', 'true']) {
    let after;
    do {
      const url = `${API}/crm/v3/owners?limit=500&archived=${archivados}${after ? `&after=${after}` : ''}`;
      const r = await pedir(token, url);
      for (const o of r.results || []) owners[String(o.id)] = `${o.firstName || ''} ${o.lastName || ''}`.trim();
      after = r.paging?.next?.after;
    } while (after);
  }
  return owners;
}
