import { NextResponse } from 'next/server';
import { COOKIE, huellaSesion } from '@/lib/auth';

// Portero por contraseña compartida (convención "proxy" de Next.js 16).
// - Con ADOPTION_PASSWORD: exige la cookie de sesión (una huella derivada, no la contraseña).
// - Sin ADOPTION_PASSWORD: en local deja pasar; en producción BLOQUEA todo (503), para que el
//   sitio nunca quede abierto por olvidar la variable.
// - Las rutas de servicio (/api/refresh, /api/connect/refresh, /api/connect/snapshot) se protegen
//   aparte con secretos dentro de la propia ruta; el cron y el agente no tienen cookie.
const RUTAS_DE_SERVICIO = ['/api/refresh', '/api/connect/refresh', '/api/connect/snapshot'];

export async function proxy(req) {
  const { pathname } = req.nextUrl;
  if (RUTAS_DE_SERVICIO.some((r) => pathname.startsWith(r))) return NextResponse.next();

  const pass = process.env.ADOPTION_PASSWORD;
  if (!pass) {
    if (process.env.NODE_ENV !== 'production') return NextResponse.next();
    return new NextResponse(
      '<!doctype html><meta charset="utf-8"><title>Falta configurar</title>' +
        '<body style="font:16px system-ui;max-width:560px;margin:15vh auto;padding:0 16px">' +
        '<h1>Falta configurar la contraseña</h1>' +
        '<p>Este sitio queda cerrado hasta que se defina la variable <b>ADOPTION_PASSWORD</b> ' +
        'en Vercel (Settings → Environment Variables) y se vuelva a desplegar.</p></body>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }

  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/login') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  if (req.cookies.get(COOKIE)?.value === (await huellaSesion(pass))) return NextResponse.next();

  // Una llamada a la API sin sesión recibe 401 en vez de la página de login
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
