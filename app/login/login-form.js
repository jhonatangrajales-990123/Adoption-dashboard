'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import AlegraLogo from '../logo';

const ERRORES = {
  AccessDenied: 'Acceso denegado. Entra con tu cuenta @alegra.com.',
  default: 'No se pudo iniciar sesión. Intenta de nuevo.',
};

export default function LoginForm({ google, password, next, error }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(error ? ERRORES[error] || ERRORES.default : '');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setErr('');
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (r.ok) { window.location.href = next; }
      else { const d = await r.json().catch(() => ({})); setErr(d.error || 'Error'); }
    } catch { setErr('Error de red'); }
    setLoading(false);
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo" style={{ marginBottom: 18, justifyContent: 'center' }}><AlegraLogo height={32} /></div>
        <h1>Adoption</h1>
        <p>Dashboard interno del equipo de Adoption</p>
        {google && (
          <button type="button" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => signIn('google', { callbackUrl: next })}>
            Entrar con Google (@alegra.com)
          </button>
        )}
        {google && password && <div style={{ margin: '14px 0 4px', fontSize: 12, color: 'var(--muted, #64748b)', textAlign: 'center' }}>o con la contraseña del equipo</div>}
        {password && (
          <>
            <input
              className="inp" type="password" placeholder="Contraseña del equipo"
              value={pw} onChange={(e) => setPw(e.target.value)} autoFocus={!google}
            />
            <button className={'btn ' + (google ? '' : 'btn-primary')} style={{ width: '100%', marginTop: 14, justifyContent: 'center' }} disabled={loading}>
              {loading ? <span className="spin" /> : 'Entrar'}
            </button>
          </>
        )}
        {!google && !password && <div className="err">El acceso no está configurado.</div>}
        {err && <div className="err">{err}</div>}
      </form>
    </div>
  );
}
