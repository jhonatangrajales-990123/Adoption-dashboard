import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const pass = process.env.ADOPTION_PASSWORD;
  const { password } = await req.json().catch(() => ({}));
  if (!pass || password === pass) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set('ae_auth', pass || 'open', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30, // 30 días
      path: '/',
    });
    return res;
  }
  return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 });
}
