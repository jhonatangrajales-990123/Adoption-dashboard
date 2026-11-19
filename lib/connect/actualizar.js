// Baja los tickets de HubSpot, los normaliza y los guarda. Lo usan el cron, el botón y la primera visita.
import { bajarTickets, bajarOwners } from './hubspot.js';
import { normalizar, ahoraBogota } from './normalizar.js';
import { guardar, cargar } from './store.js';

// Mínimo de registros para aceptar una descarga (el tablero tiene ~5.600). Evita publicar una descarga rota.
const MINIMO = 4000;

export async function actualizarRecs() {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) throw new Error('Falta HUBSPOT_TOKEN en el entorno');
  const t0 = Date.now();
  const [tickets, owners] = await Promise.all([bajarTickets(token), bajarOwners(token)]);
  const recs = normalizar(tickets, owners);

  // Cordura: no reemplazar datos buenos por una descarga sospechosamente chica
  const previo = await cargar('recs');
  const piso = Math.max(MINIMO, previo ? Math.floor(previo.recs.length * 0.95) : 0);
  if (recs.length < piso) {
    const e = new Error(`Descarga sospechosa: ${recs.length} registros (mínimo ${piso}). Se conservan los datos anteriores.`);
    e.status = 502;
    throw e;
  }
  const corte = ahoraBogota();
  await guardar('recs', { corte, recs });
  return { registros: recs.length, corte, ms: Date.now() - t0 };
}
