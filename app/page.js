'use client';
import { useEffect, useMemo, useState } from 'react';

// ─── helpers ───
const fmtInt = (n) => Math.round(n || 0).toLocaleString('es-MX');
const fmtMoney = (n) => '$' + fmtInt(n);
const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const HS = (id) => `https://app.hubspot.com/contacts/6180490/record/2-40542822/${id}`;
const todayYMD = () => new Date().toISOString().slice(0, 10);
const daysSince = (ymd) => { if (!ymd) return null; return Math.floor((Date.now() - new Date(ymd + 'T00:00:00').getTime()) / 86400000); };

// SLA de 1ª atención por ticket
function slaStatus(r, thr) {
  if (r.tiene_primera_sesion) return r.dias_primera_sesion <= thr ? 'Cumplió' : 'Incumplió';
  if (r.estado === 'Cerrado') return 'Sin 1ª sesión';
  const d = daysSince(r.fecha_solicitud);
  return d != null && d > thr ? 'Vencido (sin sesión)' : 'En plazo';
}

// Dimensiones para agrupar / filtrar
const DIMS = [
  { key: 'pais_label', label: 'País' },
  { key: 'segmento', label: 'Segmento' },
  { key: 'analista', label: 'Analista' },
  { key: 'estado', label: 'Estado (abierto/cerrado)' },
  { key: 'stage', label: 'Etapa (stage)' },
  { key: 'icp', label: 'ICP' },
  { key: 'es_pago', label: 'Es pago' },
  { key: 'fuente', label: 'Fuente de migración' },
  { key: 'tipo', label: 'Tipo de migración' },
  { key: 'estado_migracion', label: 'Estado migración' },
  { key: 'mes_solicitud', label: 'Mes de creación' },
];

const METRICS = [
  { key: 'count', label: '# Tickets' },
  { key: 'abiertos', label: '# Abiertos' },
  { key: 'pct_cerrados', label: '% Cerrados' },
  { key: 'mrr', label: 'MRR total' },
  { key: 'ciclo', label: 'Ciclo mediana (días)' },
  { key: 'sla', label: 'SLA 1ª atención %' },
];

function computeMetrics(recs, thr) {
  const n = recs.length;
  const cerrados = recs.filter((r) => r.estado === 'Cerrado').length;
  const abiertos = n - cerrados;
  const completados = recs.filter((r) => r.stage === 'Completada').length;
  const mrr = recs.reduce((s, r) => s + (r.mrr || 0), 0);
  const ciclos = recs.filter((r) => r.estado === 'Cerrado' && r.dias_a_cierre != null).map((r) => r.dias_a_cierre);
  const conSesion = recs.filter((r) => r.tiene_primera_sesion);
  const slaOk = conSesion.filter((r) => r.dias_primera_sesion <= thr).length;
  return {
    count: n,
    abiertos,
    cerrados,
    completados,
    pct_cerrados: n ? (cerrados / n) * 100 : 0,
    mrr,
    ciclo: median(ciclos),
    sla: conSesion.length ? (slaOk / conSesion.length) * 100 : null,
    sla_n: conSesion.length,
  };
}

function metricValue(m, key) {
  const v = m[key];
  return v == null ? -1 : v; // -1 para ordenar nulls al final
}
function metricFmt(key, v) {
  if (v == null || v === -1) return '—';
  if (key === 'pct_cerrados' || key === 'sla') return v.toFixed(1) + '%';
  if (key === 'mrr') return fmtMoney(v);
  if (key === 'ciclo') return v + 'd';
  return fmtInt(v);
}

const ALL = '__todos__';

export default function Page() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // filtros
  const [f, setF] = useState({
    pais: ALL, segmento: ALL, analista: ALL, estado: ALL, stage: ALL,
    icp: ALL, es_pago: ALL, fuente: ALL, tipo: ALL, mes: ALL,
    desde: '', hasta: '', soloEstancados: false, q: '',
  });
  const [groupBy, setGroupBy] = useState('estado');
  const [metric, setMetric] = useState('count');
  const [slaThr, setSlaThr] = useState(3);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setErr('');
    try {
      const r = await fetch('/api/data');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error');
      setData(d);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  async function refresh() {
    setRefreshing(true); setErr('');
    try {
      const r = await fetch('/api/refresh', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error');
      await load();
    } catch (e) { setErr(e.message); }
    setRefreshing(false);
  }

  const records = data?.records || [];

  // valores únicos por dimensión (para los dropdowns)
  const opts = useMemo(() => {
    const uniq = (k) => [...new Set(records.map((r) => r[k]).filter((x) => x !== '' && x != null))].sort();
    return {
      pais: uniq('pais_label'), segmento: uniq('segmento'), analista: uniq('analista'),
      stage: uniq('stage'), icp: uniq('icp'), es_pago: uniq('es_pago'),
      fuente: uniq('fuente'), tipo: uniq('tipo'), mes: uniq('mes_solicitud').reverse(),
    };
  }, [records]);

  // aplicar filtros
  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (f.pais !== ALL && r.pais_label !== f.pais) return false;
      if (f.segmento !== ALL && r.segmento !== f.segmento) return false;
      if (f.analista !== ALL && r.analista !== f.analista) return false;
      if (f.estado !== ALL && r.estado !== f.estado) return false;
      if (f.stage !== ALL && r.stage !== f.stage) return false;
      if (f.icp !== ALL && r.icp !== f.icp) return false;
      if (f.es_pago !== ALL && r.es_pago !== f.es_pago) return false;
      if (f.fuente !== ALL && r.fuente !== f.fuente) return false;
      if (f.tipo !== ALL && r.tipo !== f.tipo) return false;
      if (f.mes !== ALL && r.mes_solicitud !== f.mes) return false;
      if (f.desde && (!r.fecha_solicitud || r.fecha_solicitud < f.desde)) return false;
      if (f.hasta && (!r.fecha_solicitud || r.fecha_solicitud > f.hasta)) return false;
      if (f.soloEstancados) {
        if (r.estado !== 'Abierto') return false;
        const d = daysSince(r.fecha_solicitud);
        if (!(d != null && d > 30)) return false;
      }
      if (f.q) {
        const q = f.q.toLowerCase();
        if (!((r.cliente || '').toLowerCase().includes(q) || String(r.id).includes(q))) return false;
      }
      return true;
    });
  }, [records, f]);

  const totals = useMemo(() => computeMetrics(filtered, slaThr), [filtered, slaThr]);

  // agrupación (pivote)
  const groups = useMemo(() => {
    if (groupBy === '__none__') return [];
    const map = {};
    filtered.forEach((r) => { const k = r[groupBy] ?? 'Sin dato'; (map[k] = map[k] || []).push(r); });
    const rows = Object.entries(map).map(([k, recs]) => ({ k, recs, m: computeMetrics(recs, slaThr) }));
    rows.sort((a, b) => metricValue(b.m, metric) - metricValue(a.m, metric));
    return rows;
  }, [filtered, groupBy, metric, slaThr]);

  const maxMetric = Math.max(...groups.map((g) => Math.max(0, metricValue(g.m, metric))), 1);

  function setFilter(k, v) { setF((p) => ({ ...p, [k]: v })); }
  function reset() {
    setF({ pais: ALL, segmento: ALL, analista: ALL, estado: ALL, stage: ALL, icp: ALL, es_pago: ALL, fuente: ALL, tipo: ALL, mes: ALL, desde: '', hasta: '', soloEstancados: false, q: '' });
    setGroupBy('estado'); setMetric('count');
  }

  // preguntas frecuentes
  const PRESETS = [
    { label: '📅 Contadores creados en junio: abiertos vs cerrados', apply: () => { reset(); setF((p) => ({ ...p, segmento: 'Contador', mes: '2026-06' })); setGroupBy('estado'); setMetric('count'); } },
    { label: '⏱️ SLA 1ª atención por país', apply: () => { reset(); setGroupBy('pais_label'); setMetric('sla'); } },
    { label: '👥 Tickets abiertos por analista', apply: () => { reset(); setF((p) => ({ ...p, estado: 'Abierto' })); setGroupBy('analista'); setMetric('count'); } },
    { label: '🔄 Ciclo de cierre por segmento', apply: () => { reset(); setGroupBy('segmento'); setMetric('ciclo'); } },
    { label: '⏳ Estancados (>30d) por analista', apply: () => { reset(); setF((p) => ({ ...p, soloEstancados: true })); setGroupBy('analista'); setMetric('count'); } },
    { label: '💰 MRR abierto por país', apply: () => { reset(); setF((p) => ({ ...p, estado: 'Abierto' })); setGroupBy('pais_label'); setMetric('mrr'); } },
  ];

  function exportCSV() {
    const cols = ['id', 'fecha_solicitud', 'estado', 'stage', 'pais_label', 'segmento', 'analista', 'icp', 'es_pago', 'mrr', 'dias_primera_sesion', 'dias_a_cierre', 'fuente', 'tipo', 'cliente'];
    const header = cols.join(',');
    const lines = filtered.map((r) => cols.map((c) => {
      const v = r[c] == null ? '' : String(r[c]).replace(/"/g, '""');
      return /[",\n]/.test(v) ? `"${v}"` : v;
    }).join(','));
    const blob = new Blob(['﻿' + header + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `adoption_tickets_${todayYMD()}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  const slaTag = (s) => s === 'Cumplió' ? 't-g' : s === 'Incumplió' || s === 'Vencido (sin sesión)' ? 't-r' : s === 'En plazo' ? 't-a' : 't-gr';
  const estadoTag = (s) => s === 'Cerrado' ? 't-g' : 't-a';

  const lastUpd = data?.refreshed_at ? new Date(data.refreshed_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <>
      <header className="hdr">
        <div className="hdr-inner">
          <div className="hdr-l">
            <div className="logo">A</div>
            <div>
              <div className="hdr-title">Adoption Explorer</div>
              <div className="hdr-sub">HubSpot en vivo · pipeline 690980478 · Actualizado: {lastUpd}</div>
            </div>
          </div>
          <div className="hdr-r">
            <span className="pill">📊 {fmtInt(records.length)} tickets</span>
            <button className="btn" onClick={() => { const el = document.documentElement; el.dataset.theme = el.dataset.theme === 'dark' ? 'light' : 'dark'; }}>🌓 Tema</button>
            <button className="btn btn-primary" onClick={refresh} disabled={refreshing}>
              {refreshing ? <span className="spin" /> : '🔄'} Actualizar ahora
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {err && <div className="panel" style={{ borderColor: 'var(--rbrd)', background: 'var(--rbg)' }}><div className="panel-bd" style={{ color: 'var(--r)' }}>⚠️ {err}</div></div>}
        {loading && <div className="panel"><div className="panel-bd muted">Cargando datos de HubSpot… (la primera carga puede tardar unos segundos)</div></div>}

        {!loading && data && (
          <>
            {/* Preguntas frecuentes */}
            <div className="panel">
              <div className="panel-hd"><div><div className="stitle">Preguntas frecuentes</div><div className="ssub">Un clic configura el explorador. Luego puedes ajustar cualquier filtro.</div></div></div>
              <div className="panel-bd"><div className="chips">
                {PRESETS.map((p, i) => <button key={i} className="chip" onClick={p.apply}>{p.label}</button>)}
              </div></div>
            </div>

            {/* KPIs de la selección */}
            <div className="kpi-row">
              <div className="kpi k-blue"><div className="kpi-lbl">Tickets (selección)</div><div className="kpi-num">{fmtInt(totals.count)}</div><div className="kpi-sub">de {fmtInt(records.length)} totales</div></div>
              <div className="kpi k-ok"><div className="kpi-lbl">Cerrados</div><div className="kpi-num">{fmtInt(totals.cerrados)}</div><div className="kpi-sub">{totals.pct_cerrados.toFixed(1)}% · {fmtInt(totals.completados)} completados</div></div>
              <div className="kpi k-warn"><div className="kpi-lbl">Abiertos</div><div className="kpi-num">{fmtInt(totals.abiertos)}</div><div className="kpi-sub">en proceso o nuevos</div></div>
              <div className="kpi"><div className="kpi-lbl">SLA 1ª atención</div><div className="kpi-num">{totals.sla == null ? '—' : totals.sla.toFixed(0) + '%'}</div><div className="kpi-sub">≤{slaThr}d · n={fmtInt(totals.sla_n)}</div></div>
              <div className="kpi k-purple"><div className="kpi-lbl">Ciclo cierre (mediana)</div><div className="kpi-num">{totals.ciclo == null ? '—' : totals.ciclo + 'd'}</div><div className="kpi-sub">solicitud → cierre</div></div>
              <div className="kpi k-ok"><div className="kpi-lbl">MRR (selección)</div><div className="kpi-num" style={{ fontSize: 22 }}>{fmtMoney(totals.mrr)}</div><div className="kpi-sub">suma de la selección</div></div>
            </div>

            {/* Filtros */}
            <div className="panel">
              <div className="panel-hd">
                <div><div className="stitle">Filtros</div><div className="ssub">Segmenta la data. Todo lo demás se recalcula al instante.</div></div>
                <button className="btn" onClick={reset}>✕ Limpiar filtros</button>
              </div>
              <div className="panel-bd filters">
                <Sel label="País" val={f.pais} set={(v) => setFilter('pais', v)} opts={opts.pais} />
                <Sel label="Segmento" val={f.segmento} set={(v) => setFilter('segmento', v)} opts={opts.segmento} />
                <Sel label="Analista" val={f.analista} set={(v) => setFilter('analista', v)} opts={opts.analista} />
                <Sel label="Estado" val={f.estado} set={(v) => setFilter('estado', v)} opts={['Abierto', 'Cerrado']} />
                <Sel label="Etapa (stage)" val={f.stage} set={(v) => setFilter('stage', v)} opts={opts.stage} />
                <Sel label="ICP" val={f.icp} set={(v) => setFilter('icp', v)} opts={opts.icp} />
                <Sel label="Es pago" val={f.es_pago} set={(v) => setFilter('es_pago', v)} opts={opts.es_pago} />
                <Sel label="Fuente" val={f.fuente} set={(v) => setFilter('fuente', v)} opts={opts.fuente} />
                <Sel label="Tipo migración" val={f.tipo} set={(v) => setFilter('tipo', v)} opts={opts.tipo} />
                <Sel label="Mes de creación" val={f.mes} set={(v) => setFilter('mes', v)} opts={opts.mes} />
                <div className="fg"><label>Creado entre</label><div className="row2">
                  <input className="inp" type="date" value={f.desde} onChange={(e) => setFilter('desde', e.target.value)} />
                  <input className="inp" type="date" value={f.hasta} onChange={(e) => setFilter('hasta', e.target.value)} />
                </div></div>
                <div className="fg"><label>Buscar (cliente / ID)</label><input className="inp" value={f.q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Nombre o ID…" /></div>
                <div className="fg"><label>SLA objetivo (días)</label><input className="inp" type="number" min="1" value={slaThr} onChange={(e) => setSlaThr(Math.max(1, +e.target.value || 1))} /></div>
                <div className="fg"><label>Solo estancados (&gt;30d)</label>
                  <button className={'chip' + (f.soloEstancados ? ' active' : '')} onClick={() => setFilter('soloEstancados', !f.soloEstancados)}>{f.soloEstancados ? '✓ Activado' : 'Desactivado'}</button>
                </div>
              </div>
            </div>

            {/* Pivote por dimensión */}
            <div className="panel">
              <div className="panel-hd">
                <div><div className="stitle">Análisis por dimensión</div><div className="ssub">Agrupa la selección por cualquier campo y compara métricas.</div></div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select className="inp" style={{ width: 'auto' }} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                    <option value="__none__">Sin agrupar</option>
                    {DIMS.map((d) => <option key={d.key} value={d.key}>Agrupar por: {d.label}</option>)}
                  </select>
                  <select className="inp" style={{ width: 'auto' }} value={metric} onChange={(e) => setMetric(e.target.value)}>
                    {METRICS.map((m) => <option key={m.key} value={m.key}>Ordenar/barra: {m.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="panel-bd">
                {groupBy === '__none__' ? <div className="hint">Elige una dimensión para ver el desglose.</div> : (
                  <div className="tbl-scroll"><table>
                    <thead><tr>
                      <th>{DIMS.find((d) => d.key === groupBy)?.label}</th>
                      <th className="tr"># Tickets</th><th className="tr">Cerrados</th><th className="tr">Abiertos</th>
                      <th className="tr">% Cerr.</th><th className="tr">MRR</th><th className="tr">Ciclo med.</th><th className="tr">SLA%</th>
                      <th style={{ width: '30%' }}>{METRICS.find((m) => m.key === metric)?.label}</th>
                    </tr></thead>
                    <tbody>{groups.map((g) => {
                      const v = metricValue(g.m, metric);
                      const w = v > 0 ? (v / maxMetric) * 100 : 0;
                      return <tr key={g.k}>
                        <td style={{ fontWeight: 700 }}>{g.k}</td>
                        <td className="tr">{fmtInt(g.m.count)}</td>
                        <td className="tr" style={{ color: 'var(--g)' }}>{fmtInt(g.m.cerrados)}</td>
                        <td className="tr" style={{ color: 'var(--a)' }}>{fmtInt(g.m.abiertos)}</td>
                        <td className="tr">{g.m.pct_cerrados.toFixed(0)}%</td>
                        <td className="tr">{fmtMoney(g.m.mrr)}</td>
                        <td className="tr">{g.m.ciclo == null ? '—' : g.m.ciclo + 'd'}</td>
                        <td className="tr">{g.m.sla == null ? '—' : g.m.sla.toFixed(0) + '%'}</td>
                        <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="gbar-track" style={{ flex: 1 }}><div className="gbar-fill" style={{ width: w + '%' }} /></div>
                          <div className="gbar-val">{metricFmt(metric, g.m[metric])}</div>
                        </div></td>
                      </tr>;
                    })}</tbody>
                  </table></div>
                )}
              </div>
            </div>

            {/* Detalle de tickets */}
            <div className="panel">
              <div className="panel-hd">
                <div><div className="stitle">Tickets ({fmtInt(filtered.length)})</div><div className="ssub">Detalle de la selección {filtered.length > 300 ? '· mostrando los primeros 300' : ''}</div></div>
                <button className="btn btn-primary" onClick={exportCSV}>📥 Descargar CSV ({fmtInt(filtered.length)})</button>
              </div>
              <div className="tbl-scroll"><table>
                <thead><tr>
                  <th>ID</th><th>Creado</th><th>Estado</th><th>Etapa</th><th>País</th><th>Segmento</th><th>Analista</th>
                  <th className="tr">MRR</th><th className="tc">Días 1ª ses.</th><th className="tc">SLA</th><th className="tr">Ciclo</th><th>Cliente</th>
                </tr></thead>
                <tbody>{filtered.slice(0, 300).map((r) => {
                  const sla = slaStatus(r, slaThr);
                  return <tr key={r.id}>
                    <td><a href={HS(r.id)} target="_blank" rel="noreferrer" style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.id}</a></td>
                    <td>{r.fecha_solicitud || '—'}</td>
                    <td><span className={'tag ' + estadoTag(r.estado)}>{r.estado}</span></td>
                    <td>{r.stage}</td>
                    <td>{r.pais_label}</td>
                    <td>{r.segmento}</td>
                    <td>{r.analista}</td>
                    <td className="tr">{r.mrr ? fmtMoney(r.mrr) : '—'}</td>
                    <td className="tc">{r.dias_primera_sesion == null ? '—' : r.dias_primera_sesion + 'd'}</td>
                    <td className="tc"><span className={'tag ' + slaTag(sla)}>{sla}</span></td>
                    <td className="tr">{r.dias_a_cierre == null ? '—' : r.dias_a_cierre + 'd'}</td>
                    <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cliente || '—'}</td>
                  </tr>;
                })}</tbody>
              </table></div>
            </div>
          </>
        )}
        <div className="ftr">Adoption Explorer · Alegra · datos en vivo de HubSpot · SLA 1ª atención = (1ª sesión − solicitud) ≤ {slaThr}d</div>
      </main>
    </>
  );
}

function Sel({ label, val, set, opts }) {
  return (
    <div className="fg">
      <label>{label}</label>
      <select className="inp" value={val} onChange={(e) => set(e.target.value)}>
        <option value="__todos__">Todos</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
