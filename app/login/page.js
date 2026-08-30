'use client';
import { useState } from 'react';
import AlegraLogo from '../logo';

export default function Login() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
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
      if (r.ok) { window.location.href = '/'; }
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
        <input
          className="inp" type="password" placeholder="Contraseña del equipo"
          value={pw} onChange={(e) => setPw(e.target.value)} autoFocus
        />
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 14, justifyContent: 'center' }} disabled={loading}>
          {loading ? <span className="spin" /> : 'Entrar'}
        </button>
        {err && <div className="err">{err}</div>}
      </form>
    </div>
  );
}
