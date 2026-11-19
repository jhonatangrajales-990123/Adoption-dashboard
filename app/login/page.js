import LoginForm from './login-form';
import { googleActivo, passwordActivo } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// El servidor decide qué llaves se muestran según las variables de entorno.
export default async function Login({ searchParams }) {
  const sp = await searchParams;
  const next = typeof sp?.next === 'string' && sp.next.startsWith('/') && !sp.next.startsWith('//') ? sp.next : '/';
  return <LoginForm google={googleActivo()} password={passwordActivo()} next={next} error={sp?.error || ''} />;
}
