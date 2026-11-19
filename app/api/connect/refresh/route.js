import { NextResponse } from 'next/server';
import { actualizarRecs } from '@/lib/connect/actualizar';
import { sesionValida, secretoValido } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Lo dispara el cron diario de Vercel (CRON_SECRET) y el botón de actualizar (sesión iniciada).
export async function GET(req) {
  if (!secretoValido(req, ['CRON_SECRET', 'REFRESH_SECRET']) && !(await sesionValida(req))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await actualizarRecs()) });
  } catch (err) {
    console.error('Refresh Connect:', err);
    return NextResponse.json({ error: err.status === 502 ? err.message : 'No se pudo actualizar desde HubSpot' }, { status: err.status || 500 });
  }
}
export const POST = GET;
