import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { DOMINIO, googleActivo } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Login con Google restringido a cuentas @alegra.com (la misma regla que tenía adoption-vercel).
// Si faltan las variables de Google, la ruta no existe y solo queda la contraseña del equipo.
function handler(req, ctx) {
  if (!googleActivo()) return new Response('Login con Google no configurado', { status: 404 });
  return NextAuth(req, ctx, {
    secret: process.env.NEXTAUTH_SECRET,
    providers: [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        authorization: { params: { hd: 'alegra.com', prompt: 'select_account' } },
      }),
    ],
    session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
    callbacks: {
      async signIn({ profile }) {
        const email = String(profile?.email || '').toLowerCase();
        return email.endsWith(DOMINIO) && profile?.email_verified !== false;
      },
    },
    pages: { signIn: '/login', error: '/login' },
  });
}

export { handler as GET, handler as POST };
