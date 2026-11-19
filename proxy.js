import { NextResponse } from 'next/server';
import { accesoConfigurado, sesionValida } from '@/lib/auth';

// Portero de la app (convención "proxy" de Next.js 16). Entra quien tenga sesión con Google (@alegra.com)
// o con la contraseña del equipo; ver lib/auth.js.
// - Sin ninguna llave configurada: en local deja pasar; en producción BLOQUEA todo (503).
// - Las rutas de servicio (refrescos y snapshot) se protegen con secretos dentro de la propia ruta:
//   el cron y el agente no tienen sesión.
const RUTAS_DE_SERVICIO = ['/api/refresh', '/api/connect/refresh', '/api/connect/snapshot'];
const RUTAS_PUBLICAS = ['/login', '/api/login', '/api/auth', '/_next', '/favicon.ico'];

export async function proxy(req) {
  const { pathname, search } = req.nextUrl;
  if (RUTAS_DE_SERVICIO.some((r) => pathname.startsWith(r))) return NextResponse.next();

  if (!accesoConfigurado() && process.env.NODE_ENV === 'production') {
    return new NextResponse(
      '<!doctype html><meta charset="utf-8"><title>Falta configurar</title>' +
        '<body style="font:16px system-ui;max-width:560px;margin:15vh auto;padding:0 16px">' +
        '<h1>Falta configurar el acceso</h1>' +
        '<p>Este sitio queda cerrado hasta que se configure el login con Google ' +
        '(<b>GOOGLE_CLIENT_ID</b>, <b>GOOGLE_CLIENT_SECRET</b>, <b>NEXTAUTH_SECRET</b>) o la contraseña ' +
        '<b>ADOPTION_PASSWORD</b> en Vercel, y se vuelva a desplegar.</p></body>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }

  if (RUTAS_PUBLICAS.some((r) => pathname.startsWith(r))) return NextResponse.next();
  if (await sesionValida(req)) return NextResponse.next();

  // Una llamada a la API sin sesión recibe 401 en vez de la página de login
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  if (pathname !== '/') url.searchParams.set('next', pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
