import { NextResponse } from 'next/server';
import { guardar, cargar } from '@/lib/connect/store';
import { secretoValido } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// El agente sube aquí lo que sale de Metabase (el servidor no puede llamar a Metabase por su cuenta).
//   POST { tipo: 'ret',  datos: {...} }   retención por cohortes (misma forma que `ret` del tablero)
//   POST { tipo: 'act',  datos: {...} }   activación por trimestre ({ filas: [...] })
//   POST { tipo: 'actA', datos: { corte, nota, activas: [ids] } }   activación por analista
// Cabecera: x-connect-token = CONNECT_TOKEN (si la variable no existe, la ruta queda cerrada).
const VALIDADORES = {
  // registros ya normalizados (respaldo si HubSpot falla; normalmente los baja el cron solo)
  recs: (d) => d && typeof d.corte === 'string' && Array.isArray(d.recs) && d.recs.length >= 4000,
  ret: (d) => d && Array.isArray(d.cohortes) && d.mensual && Array.isArray(d.mensual.rows),
  act: (d) => d && Array.isArray(d.filas),
  actA: (d) => d && typeof d.corte === 'string' && Array.isArray(d.activas),
};

export async function POST(req) {
  if (!secretoValido(req, ['CONNECT_TOKEN'])) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { tipo, datos } = await req.json().catch(() => ({}));
  if (!VALIDADORES[tipo]) return NextResponse.json({ error: 'tipo debe ser recs, ret, act o actA' }, { status: 400 });
  if (!VALIDADORES[tipo](datos)) return NextResponse.json({ error: `datos no tienen la forma esperada para ${tipo}` }, { status: 400 });
  await guardar(tipo, datos);
  return NextResponse.json({ ok: true, tipo });
}

// Estado de las piezas (sin devolver los datos): para saber qué tan frescas están
export async function GET(req) {
  if (!secretoValido(req, ['CONNECT_TOKEN'])) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const [recs, ret, act, actA] = await Promise.all(['recs', 'ret', 'act', 'actA'].map(cargar));
  return NextResponse.json({
    recs: recs ? { corte: recs.corte, registros: recs.recs.length } : null,
    ret: ret ? { corte: ret.corte, mensual: ret.mensual?.corte } : null,
    act: act ? { filas: act.filas.length } : null,
    actA: actA ? { corte: actA.corte, empresas: actA.activas.length } : null,
  });
}
