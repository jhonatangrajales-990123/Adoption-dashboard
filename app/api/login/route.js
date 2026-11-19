import { NextResponse } from 'next/server';
import { COOKIE, huellaSesion } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const pass = process.env.ADOPTION_PASSWORD;
  if (!pass) {
    // En producción nunca se abre sin contraseña; en local se deja entrar.
    if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Falta configurar ADOPTION_PASSWORD' }, { status: 503 });
    return NextResponse.json({ ok: true });
  }
  const { password } = await req.json().catch(() => ({}));
  if (password !== pass) {
    await new Promise((r) => setTimeout(r, 600)); // frena los intentos por fuerza bruta
    return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await huellaSesion(pass), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 días
    path: '/',
  });
  return res;
}
