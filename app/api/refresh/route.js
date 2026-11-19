import { fetchRecords } from '@/lib/hubspot';
import { saveData } from '@/lib/store';
import { sesionValida, secretoValido } from '@/lib/auth';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req) {
  try {
    // Entra quien traiga el secreto del cron (CRON_SECRET, que Vercel envía solo, o REFRESH_SECRET)
    // o quien tenga sesión iniciada (botón "Actualizar ahora"). Sin ninguna de las dos: 401.
    if (!secretoValido(req, ['CRON_SECRET', 'REFRESH_SECRET']) && !(await sesionValida(req))) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const token = process.env.HUBSPOT_TOKEN;
    if (!token) throw new Error('HUBSPOT_TOKEN no está configurado');

    const t0 = Date.now();
    const records = await fetchRecords(token);
    const payload = {
      refreshed_at: new Date().toISOString(),
      total: records.length,
      records,
    };
    await saveData(payload);

    return NextResponse.json({
      ok: true,
      total: records.length,
      ms: Date.now() - t0,
      refreshed_at: payload.refreshed_at,
    });
  } catch (err) {
    console.error('Refresh error:', err);
    return NextResponse.json({ error: 'No se pudo actualizar' }, { status: 500 });
  }
}

// Permitir POST también (para el botón "Actualizar ahora")
export const POST = GET;
