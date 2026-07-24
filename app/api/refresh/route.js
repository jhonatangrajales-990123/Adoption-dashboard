import { fetchRecords } from '@/lib/hubspot';
import { saveData } from '@/lib/store';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req) {
  try {
    // Si hay REFRESH_SECRET, exigirlo (para proteger el cron). El cron de Vercel
    // puede pasarlo como ?secret= o via header Authorization.
    const secret = process.env.REFRESH_SECRET;
    if (secret) {
      const url = new URL(req.url);
      const provided = url.searchParams.get('secret') || (req.headers.get('authorization') || '').replace('Bearer ', '');
      // Vercel Cron manda un header especial; lo aceptamos también.
      const isVercelCron = !!req.headers.get('x-vercel-cron');
      if (provided !== secret && !isVercelCron) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
      }
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Permitir POST también (para el botón "Actualizar ahora")
export const POST = GET;
