import { fetchRecords } from '@/lib/hubspot';
import { loadData, saveData } from '@/lib/store';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    let data = await loadData();
    // Refresh perezoso: si aún no hay snapshot, lo generamos al vuelo.
    if (!data) {
      const token = process.env.HUBSPOT_TOKEN;
      if (!token) throw new Error('HUBSPOT_TOKEN no está configurado');
      const records = await fetchRecords(token);
      data = { refreshed_at: new Date().toISOString(), total: records.length, records };
      await saveData(data);
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
