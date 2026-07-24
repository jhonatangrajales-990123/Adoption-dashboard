import { NextResponse } from 'next/server';

// Gate por contraseña compartida (convención "proxy" de Next.js 16).
// - Si ADOPTION_PASSWORD está vacío/no seteado -> acceso abierto (útil en local).
// - Si está seteado -> exige la cookie `ae_auth` == ADOPTION_PASSWORD.
export function proxy(req) {
  const pass = process.env.ADOPTION_PASSWORD;
  if (!pass) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/login') ||
    pathname.startsWith('/api/refresh') || // protegido aparte por REFRESH_SECRET / cron
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get('ae_auth')?.value;
  if (cookie === pass) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
