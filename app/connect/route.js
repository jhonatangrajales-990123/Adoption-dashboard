import fs from 'node:fs';
import path from 'node:path';
import { cargarTodo } from '@/lib/connect/store';
import { actualizarRecs } from '@/lib/connect/actualizar';
import { aplicarActivacion } from '@/lib/connect/normalizar';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Estructura vacía de retención, para que la pestaña no se rompa si todavía no se ha subido el snapshot
const RET_VACIO = {
  corte: null, cohortes: [], mensual: { ultimoMes: 202609, corte: null, rows: [] }, cascada: [], corteCascada: null,
  hoy: { mes: null, corte: null, n: {} }, zoom: [],
};

function pagina(titulo, cuerpo, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${titulo}</title><body style="font:16px system-ui;max-width:600px;margin:15vh auto;padding:0 16px">${cuerpo}</body>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

// Sirve el tablero de Connect: la misma plantilla de siempre, con los datos inyectados en la página
// (era lo que hacía build.js; ahora lo hace el servidor con los datos vivos).
export async function GET() {
  let { recs, ret, act, actA } = await cargarTodo();

  // Primera visita: aún no hay datos guardados, se bajan de HubSpot en el momento
  if (!recs) {
    try { await actualizarRecs(); ({ recs, ret, act, actA } = await cargarTodo()); }
    catch (e) {
      return pagina('Sin datos', `<h1>Todavía no hay datos</h1><p>No se pudo bajar la información de HubSpot: ${String(e.message).replace(/[<>&]/g, '')}</p>`, 503);
    }
  }

  const registros = aplicarActivacion(structuredClone(recs.recs), actA?.activas || null);
  const data = {
    corte: recs.corte,
    recs: registros,
    ret: ret || RET_VACIO,
    act: act || null,
    actA: actA ? { corte: actA.corte, nota: actA.nota } : null,
  };

  const plantilla = fs.readFileSync(path.join(process.cwd(), 'lib', 'connect', 'template.html'), 'utf8');
  // Mismo escape que build.js: '<' como \u003c para que los datos no puedan cerrar el <script>
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = plantilla.replace('/*__DATA__*/null', () => json);
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}
