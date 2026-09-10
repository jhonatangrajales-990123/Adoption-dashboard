'use client';
import { useEffect, useMemo, useState } from 'react';
import AnalistasView from './analistas-view';
import AlegraLogo from './logo';
import { useDashData, DashControls, ResumenView, OperacionView, EquipoView } from './dash';
import { DesempenoView } from './desempeno-view';
import { ActivacionView } from './activacion-view';
import { avg1, teamTotals, GLOSARIO, currentYM, monthLabel } from '@/lib/analistas-shared';
import { enVentana, MES_MINIMO, esVersionOperada } from '@/lib/metrics';

// ─── helpers ───
const fmtInt = (n) => Math.round(n || 0).toLocaleString('es-MX');
const fmtMoney = (n) => '$' + fmtInt(n);
const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const HS = (id) => `https://app.hubspot.com/contacts/6180490/record/2-40542822/${id}`;
const todayYMD = () => new Date().toISOString().slice(0, 10);
const daysSince = (ymd) => { if (!ymd) return null; return Math.floor((Date.now() - new Date(ymd + 'T00:00:00').getTime()) / 86400000); };

// SLA = días entre solicitud y 1ª sesión, por ticket (sin meta/umbral definido aún —
// se reporta el número, no un cumplió/incumplió).
function slaCell(r) {
  if (r.tiene_primera_sesion) return { text: `${r.dias_primera_sesion}d`, tag: 't-b' };
  if (r.estado === 'Cerrado') return { text: 'Sin sesión', tag: 't-gr' };
  const d = daysSince(r.fecha_solicitud);
  return { text: d != null ? `esperando ${d}d` : '—', tag: 't-a' };
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
  { key: 'ciclo', label: 'SLA ciclo completo (días promedio)' },
  { key: 'sla', label: 'SLA 1ª atención (días promedio)' },
];

// Todo sale de lib/metrics.js (definición única). Antes esta vista calculaba el
// SLA de ciclo como MEDIANA mientras las otras dos usaban PROMEDIO: misma etiqueta,
// número distinto según la pestaña. Ahora se muestran los dos, etiquetados.
function computeMetrics(recs) {
  const t = teamTotals(recs);
  const cerrados = t.completados + t.no_completados;
  return {
    count: t.asignados,
    abiertos: t.abiertos,
    cerrados,
    completados: t.completados,
    no_completados: t.no_completados,
    atendidos: t.atendidos,
    pct_cerrados: t.asignados ? (cerrados / t.asignados) * 100 : 0,
    tasa: t.tasa,
    mrr: t.mrrTotal,
    ciclo: t.cicloAvg,
    ciclo_med: t.cicloMed,
    ciclo_n: t.cicloN,
    sla: t.slaAvg,
    sla_med: t.slaMed,
    sla_n: t.slaN,
    csat: t.csatAvg,
    csat_n: t.csatN,
    completadosSinSesion: t.completadosSinSesion,
  };
}

function metricValue(m, key) {
  const v = m[key];
  return v == null ? -1 : v; // -1 para ordenar nulls al final
}
function metricFmt(key, v) {
  if (v == null || v === -1) return '—';
  if (key === 'pct_cerrados') return v.toFixed(1) + '%';
  if (key === 'mrr') return fmtMoney(v);
  if (key === 'ciclo' || key === 'sla') return v + 'd';
  return fmtInt(v);
}

const ALL = '__todos__';
// Vistas que comparten la barra de controles (mes / lente / país / segmento).
const VISTAS_DASH = ['resumen', 'desempeno', 'activacion', 'operacion', 'equipo'];

// Las pestañas van en DOS GRUPOS con etiqueta, no en una fila plana de siete.
// El criterio es "quién la abre", que es lo que el lector se pregunta primero.
// Con siete pestañas seguidas, un stakeholder que entra por primera vez tiene
// que abrirlas todas para saber cuál es la suya — y eso ya rompe los 30
// segundos antes de haber leído un solo número.
const GRUPOS_VISTA = [
  {
    id: 'direccion', label: 'Para dirección',
    tabs: [
      { k: 'resumen', icon: '📊', label: 'Resumen', hint: '¿Cómo vamos este mes? Lo esencial en 30 segundos.' },
      { k: 'desempeno', icon: '📈', label: 'Desempeño', hint: '¿Hemos mejorado? Volumen y tiempos, mes a mes.' },
      { k: 'activacion', icon: '🚀', label: 'Activación', hint: 'Métricas SaaS de onboarding: TTFV, activación y embudo por fases.' },
    ],
  },
  {
    id: 'operacion', label: 'Día a día',
    tabs: [
      { k: 'operacion', icon: '🚦', label: 'Hoy', hint: '¿Dónde se están atorando los clientes ahora mismo?' },
      { k: 'equipo', icon: '👥', label: 'Analistas', hint: '¿Cómo va cada analista y quién necesita apoyo?' },
      { k: 'explorador', icon: '🔎', label: 'Explorador', hint: 'Preguntas libres sobre cualquier ticket.' },
      { k: 'historico', icon: '🗂️', label: 'Histórico', hint: 'Mes a mes con las sesiones del registro Connect.' },
    ],
  },
];
const VISTAS_VALIDAS = GRUPOS_VISTA.flatMap((g) => g.tabs.map((t) => t.k));

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
  // Una vista por pregunta. Resumen es la de entrada porque es la que cualquiera
  // entiende sin contexto; el histórico queda como anexo del Equipo.
  const [view, setView] = useState('resumen'); // resumen | operacion | equipo | explorador | historico
  // Controles compartidos: se ponen una vez y siguen al usuario entre vistas
  // (antes cada pestaña tenía sus propios filtros y se borraban al cambiar).
  const [ctrl, setCtrl] = useState({ mes: currentYM(), pais: ALL, seg: ALL, lente: 'solicitud' });

  // En el build estático (Dashboards Hub) los datos vienen embebidos en el bundle:
  // no hay servidor al que pedirle nada. Es la MISMA app, solo cambia de dónde
  // salen los datos — así no existe una segunda versión que se desincronice.
  const [estatico, setEstatico] = useState(false);
  useEffect(() => {
    const emb = typeof window !== 'undefined' ? window.__ADOPTION_DATA__ : null;
    if (emb) { setData(emb); setEstatico(true); setLoading(false); return; }
    load();
  }, []);

  // La vista vive en la URL (?v=equipo), así se puede compartir un enlace directo
  // a la pestaña que a uno le interesa, y recargar no te devuelve al inicio.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('v');
    if (v && VISTAS_VALIDAS.includes(v)) setView(v);
  }, []);
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set('v', view);
    window.history.replaceState(null, '', u);
  }, [view]);

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

  // El dashboard mira desde enero 2026 en adelante. Lo anterior es de otra época
  // del proceso y ensuciaba las comparaciones. Se filtra en un solo punto para que
  // TODAS las vistas hereden la misma ventana.
  const todos = useMemo(() => (data?.records || []).filter(enVentana), [data]);
  // El tablero solo mira las 4 versiones que Adoption opera (COL, MEX, RD, CRI).
  // La lista de tickets con la versión o el segmento mal puestos se genera aparte,
  // fuera de la app: es material de corrección interno, no del tablero.
  const records = useMemo(() => todos.filter(esVersionOperada), [todos]);

  // Cálculo compartido por Resumen / Operación / Equipo (una sola vez, no por vista)
  const dash = useDashData(records, ctrl);

  // Si el mes elegido no existe en los datos (p. ej. al cambiar de lente), se
  // salta al más reciente que sí exista, para no mostrar una pantalla vacía.
  useEffect(() => {
    if (dash.months.length && !dash.months.includes(ctrl.mes)) {
      setCtrl((c) => ({ ...c, mes: dash.months[0] }));
    }
  }, [dash.months, ctrl.mes]);

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

  const totals = useMemo(() => computeMetrics(filtered), [filtered]);

  // agrupación (pivote)
  const groups = useMemo(() => {
    if (groupBy === '__none__') return [];
    const map = {};
    filtered.forEach((r) => { const k = r[groupBy] ?? 'Sin dato'; (map[k] = map[k] || []).push(r); });
    const rows = Object.entries(map).map(([k, recs]) => ({ k, recs, m: computeMetrics(recs) }));
    rows.sort((a, b) => metricValue(b.m, metric) - metricValue(a.m, metric));
    return rows;
  }, [filtered, groupBy, metric]);

  const maxMetric = Math.max(...groups.map((g) => Math.max(0, metricValue(g.m, metric))), 1);

  function setFilter(k, v) { setF((p) => ({ ...p, [k]: v })); }
  function reset() {
    setF({ pais: ALL, segmento: ALL, analista: ALL, estado: ALL, stage: ALL, icp: ALL, es_pago: ALL, fuente: ALL, tipo: ALL, mes: ALL, desde: '', hasta: '', soloEstancados: false, q: '' });
    setGroupBy('estado'); setMetric('count');
  }

  // preguntas frecuentes
  // El mes más reciente que existe en los datos: antes un atajo decía "junio" con
  // la fecha fija en el código, así que iba a devolver cero en silencio al pasar el año.
  const mesReciente = opts.mes[0] || currentYM();
  const PRESETS = [
    { label: `📅 Contadores de ${monthLabel(mesReciente)}: abiertos vs cerrados`, apply: () => { reset(); setF((p) => ({ ...p, segmento: 'Contador', mes: mesReciente })); setGroupBy('estado'); setMetric('count'); } },
    { label: '⏱️ Días a la 1ª sesión, por país', apply: () => { reset(); setGroupBy('pais_label'); setMetric('sla'); } },
    { label: '👥 Tickets abiertos por analista', apply: () => { reset(); setF((p) => ({ ...p, estado: 'Abierto' })); setGroupBy('analista'); setMetric('count'); } },
    { label: '🔄 Días hasta cerrar, por segmento', apply: () => { reset(); setGroupBy('segmento'); setMetric('ciclo'); } },
    { label: '⏳ Abiertos hace más de 30 días, por analista', apply: () => { reset(); setF((p) => ({ ...p, soloEstancados: true })); setGroupBy('analista'); setMetric('count'); } },
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

  const estadoTag = (s) => s === 'Cerrado' ? 't-g' : 't-a';

  const lastUpd = data?.refreshed_at ? new Date(data.refreshed_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <>
      <header className="hdr">
        <div className="hdr-inner">
          <div className="hdr-l">
            <div className="logo"><AlegraLogo /></div>
            <div className="hdr-div" />
            <div>
              <div className="hdr-title">Adoption</div>
              <div className="hdr-sub">
                {estatico ? 'Datos de HubSpot al' : 'Datos en vivo de HubSpot · actualizado'} {lastUpd}
              </div>
            </div>
          </div>
          <div className="hdr-r">
            <span className="pill">📊 {fmtInt(records.length)} tickets</span>
            <button className="btn" title="Cambiar entre modo claro y oscuro" onClick={() => {
              const el = document.documentElement;
              const next = el.dataset.theme === 'dark' ? 'light' : 'dark';
              el.dataset.theme = next;
              try { localStorage.setItem('ae_theme', next); } catch {}
            }}>🌓 Tema</button>
            {/* En el build estático no hay a quién pedirle un refresh: los datos se
                regeneran solos cada mañana y el Hub se actualiza con el push. */}
            {!estatico && (
              <button className="btn btn-primary" onClick={refresh} disabled={refreshing}>
                {refreshing ? <span className="spin" /> : '🔄'} Actualizar ahora
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="main" style={{ opacity: refreshing ? 0.55 : 1, transition: 'opacity .2s', pointerEvents: refreshing ? 'none' : 'auto' }}>
        {err && <div className="panel" style={{ borderColor: 'var(--rbrd)', background: 'var(--rbg)' }}><div className="panel-bd" style={{ color: 'var(--r)' }}>⚠️ {err}</div></div>}
        {loading && !data && <div className="panel"><div className="panel-bd muted">Cargando datos de HubSpot… (la primera carga puede tardar unos segundos)</div></div>}

        {data && (
          <div className="vtabs">
            {GRUPOS_VISTA.map((g, gi) => (
              <div key={g.id} className="vtab-grupo">
                <div className="vtab-grupo-lbl">{g.label}</div>
                <div className="vtab-grupo-tabs">
                  {g.tabs.map((t) => (
                    <button key={t.k} className={'vtab' + (view === t.k ? ' active' : '')}
                      onClick={() => setView(t.k)} title={t.hint}>
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
                {gi === 0 && <div className="vtab-sep" />}
              </div>
            ))}
          </div>
        )}

        {/* Una línea que dice qué responde la vista abierta. Es barata y le ahorra
            al lector el "¿esto qué es?" que se come la mitad de los 30 segundos. */}
        {data && (
          <div className="vista-hint">
            {GRUPOS_VISTA.flatMap((g) => g.tabs).find((t) => t.k === view)?.hint}
          </div>
        )}

        {data && VISTAS_DASH.includes(view) && (
          <>
            <DashControls ctrl={{ ...ctrl, setMes: (m) => setCtrl((c) => ({ ...c, mes: m })) }} setCtrl={setCtrl}
              months={dash.months} paisOpts={dash.paisOpts} segOpts={dash.segOpts} hasFilter={dash.hasFilter} />
            {view === 'resumen' && <ResumenView d={dash} ctrl={{ ...ctrl, setMes: (m) => setCtrl((c) => ({ ...c, mes: m })) }} onNavigate={setView} />}
            {view === 'desempeno' && <DesempenoView d={dash} ctrl={ctrl} onNavigate={setView} />}
            {view === 'activacion' && <ActivacionView d={dash} ctrl={ctrl} onNavigate={setView} />}
            {view === 'operacion' && <OperacionView d={dash} ctrl={ctrl} />}
            {view === 'equipo' && <EquipoView d={dash} ctrl={ctrl} onVerHistorial={() => setView('historico')} />}
          </>
        )}

        {data && view === 'historico' && (
          <AnalistasView records={records} />
        )}

        {data && view === 'explorador' && (
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
              <div className="kpi k-blue" title={GLOSARIO.BOP}><div className="kpi-lbl">Tickets (selección)</div><div className="kpi-num">{fmtInt(totals.count)}</div><div className="kpi-sub">de {fmtInt(records.length)} totales</div></div>
              <div className="kpi k-ok" title={GLOSARIO.completado}><div className="kpi-lbl">Completados</div><div className="kpi-num">{fmtInt(totals.completados)}</div><div className="kpi-sub">{totals.tasa.toFixed(0)}% de éxito · {fmtInt(totals.no_completados)} no completadas</div></div>
              <div className="kpi k-warn"><div className="kpi-lbl">Abiertos</div><div className="kpi-num">{fmtInt(totals.abiertos)}</div><div className="kpi-sub">nuevos o en proceso</div></div>
              <div className="kpi" title={GLOSARIO['SLA 1ª atención']}><div className="kpi-lbl">SLA · 1ª atención</div><div className="kpi-num">{totals.sla == null ? '—' : totals.sla + 'd'}</div><div className="kpi-sub">prom. · mediana {totals.sla_med == null ? '—' : totals.sla_med + 'd'} · n={fmtInt(totals.sla_n)}</div></div>
              <div className="kpi k-purple" title={GLOSARIO['SLA ciclo completo']}><div className="kpi-lbl">SLA · ciclo completo</div><div className="kpi-num">{totals.ciclo == null ? '—' : totals.ciclo + 'd'}</div><div className="kpi-sub">prom. · mediana {totals.ciclo_med == null ? '—' : totals.ciclo_med + 'd'} · n={fmtInt(totals.ciclo_n)}</div></div>
              <div className="kpi k-ok" title={GLOSARIO.CSAT}><div className="kpi-lbl">CSAT</div><div className="kpi-num">{totals.csat == null ? '—' : totals.csat}</div><div className="kpi-sub">{totals.csat_n ? `promedio · n=${fmtInt(totals.csat_n)}` : 'sin respuestas en la selección'}</div></div>
              <div className="kpi" title={GLOSARIO.MRR}><div className="kpi-lbl">MRR (selección)</div><div className="kpi-num" style={{ fontSize: 22 }}>{totals.mrr == null ? '—' : fmtMoney(totals.mrr)}</div><div className="kpi-sub">suma de la selección</div></div>
            </div>

            {/* Filtros */}
            <div className="panel">
              <div className="panel-hd">
                <div><div className="stitle">Acota la búsqueda</div><div className="ssub">Todo lo de abajo se recalcula al instante.</div></div>
                <button className="btn" onClick={reset}>✕ Limpiar filtros</button>
              </div>
              <div className="panel-bd filters">
                <div className="fg"><label>Buscar cliente o ID</label><input className="inp" value={f.q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Nombre del cliente o número de ticket…" /></div>
                <Sel label="País" val={f.pais} set={(v) => setFilter('pais', v)} opts={opts.pais} />
                <Sel label="Segmento" val={f.segmento} set={(v) => setFilter('segmento', v)} opts={opts.segmento} />
                <Sel label="Analista" val={f.analista} set={(v) => setFilter('analista', v)} opts={opts.analista} />
                <Sel label="Etapa" val={f.stage} set={(v) => setFilter('stage', v)} opts={opts.stage} />
                <Sel label="Mes de creación" val={f.mes} set={(v) => setFilter('mes', v)} opts={opts.mes} />
                <div className="fg"><label title={GLOSARIO.estancado}>Solo los estancados</label>
                  <button className={'chip' + (f.soloEstancados ? ' active' : '')} title="Tickets abiertos hace más de 30 días" onClick={() => setFilter('soloEstancados', !f.soloEstancados)}>{f.soloEstancados ? '✓ Abiertos +30d' : 'Todos'}</button>
                </div>
              </div>
              {/* Los filtros de uso ocasional van plegados: antes eran 13 a la vista
                  y el panel ocupaba más pantalla que los datos. */}
              <details className="mas-filtros">
                <summary>Más filtros</summary>
                <div className="panel-bd filters" style={{ paddingTop: 0 }}>
                  <Sel label="Abierto / Cerrado" val={f.estado} set={(v) => setFilter('estado', v)} opts={['Abierto', 'Cerrado']} />
                  <Sel label="ICP" val={f.icp} set={(v) => setFilter('icp', v)} opts={opts.icp} />
                  <Sel label="Es pago" val={f.es_pago} set={(v) => setFilter('es_pago', v)} opts={opts.es_pago} />
                  <Sel label="Fuente de migración" val={f.fuente} set={(v) => setFilter('fuente', v)} opts={opts.fuente} />
                  <Sel label="Tipo de migración" val={f.tipo} set={(v) => setFilter('tipo', v)} opts={opts.tipo} />
                  <div className="fg"><label>Creado entre estas fechas</label><div className="row2">
                    <input className="inp" type="date" value={f.desde} onChange={(e) => setFilter('desde', e.target.value)} />
                    <input className="inp" type="date" value={f.hasta} onChange={(e) => setFilter('hasta', e.target.value)} />
                  </div></div>
                </div>
              </details>
            </div>

            {/* Pivote por dimensión */}
            <div className="panel">
              <div className="panel-hd">
                <div><div className="stitle">Compara grupos entre sí</div><div className="ssub">Parte la selección por el campo que elijas y ordena por la métrica que te interese.</div></div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select className="inp" style={{ width: 'auto' }} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                    <option value="__none__">Sin agrupar</option>
                    {DIMS.map((d) => <option key={d.key} value={d.key}>Agrupar por: {d.label}</option>)}
                  </select>
                  <select className="inp" style={{ width: 'auto' }} value={metric} onChange={(e) => setMetric(e.target.value)}>
                    {METRICS.map((m) => <option key={m.key} value={m.key}>Ordenar por: {m.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="panel-bd">
                {groupBy === '__none__' ? <div className="hint">Elige un campo arriba para ver el desglose.</div> : groups.length === 0 ? (
                  <div className="muted">No hay tickets con los filtros actuales. Prueba a limpiar alguno.</div>
                ) : (
                  <div className="tbl-scroll"><table>
                    <thead><tr>
                      <th>{DIMS.find((d) => d.key === groupBy)?.label}</th>
                      <th className="tr">Tickets</th>
                      <th className="tr" title={GLOSARIO.completado}>Completados</th>
                      <th className="tr">No completados</th>
                      <th className="tr">Abiertos</th>
                      <th className="tr" title={GLOSARIO.exito}>% éxito</th>
                      <th className="tr" title={GLOSARIO.MRR}>MRR</th>
                      <th className="tr" title={GLOSARIO['SLA 1ª atención']}>Días a 1ª sesión</th>
                      <th className="tr" title={GLOSARIO['SLA ciclo completo']}>Días a cerrar</th>
                      <th style={{ width: '24%' }} title="Barra comparativa de la métrica por la que estás ordenando">Comparación · {METRICS.find((m) => m.key === metric)?.label}</th>
                    </tr></thead>
                    <tbody>{groups.map((g) => {
                      const v = metricValue(g.m, metric);
                      const w = v > 0 ? (v / maxMetric) * 100 : 0;
                      return <tr key={g.k}>
                        <td style={{ fontWeight: 700 }}>{g.k || '(vacío)'}</td>
                        <td className="tr">{fmtInt(g.m.count)}</td>
                        <td className="tr" style={{ color: 'var(--g)', fontWeight: 700 }}>{fmtInt(g.m.completados)}</td>
                        <td className="tr" style={{ color: 'var(--r)' }}>{fmtInt(g.m.no_completados)}</td>
                        <td className="tr" style={{ color: 'var(--a)' }}>{fmtInt(g.m.abiertos)}</td>
                        <td className="tr">{g.m.atendidos ? g.m.tasa.toFixed(0) + '%' : '—'}</td>
                        <td className="tr">{g.m.mrr == null ? '—' : fmtMoney(g.m.mrr)}</td>
                        <td className="tr">{g.m.sla == null ? '—' : g.m.sla + 'd'}</td>
                        <td className="tr">{g.m.ciclo == null ? '—' : g.m.ciclo + 'd'}</td>
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
                <div><div className="stitle">Los tickets, uno por uno ({fmtInt(filtered.length)})</div><div className="ssub">Clic en el ID para abrirlo en HubSpot{filtered.length > 300 ? ' · en pantalla van los primeros 300, el CSV trae todos' : ''}</div></div>
                <button className="btn btn-primary" onClick={exportCSV}>📥 Descargar CSV ({fmtInt(filtered.length)})</button>
              </div>
              {filtered.length === 0 ? (
                <div className="panel-bd muted">No hay ningún ticket con estos filtros. Prueba a quitar alguno o usa «✕ Limpiar filtros».</div>
              ) : (
              <div className="tbl-scroll"><table>
                <thead><tr>
                  <th>ID</th><th>Creado</th><th>Etapa</th><th>País</th><th>Segmento</th><th>Analista</th>
                  <th className="tr" title={GLOSARIO.MRR}>MRR</th>
                  <th className="tc" title={GLOSARIO['SLA 1ª atención']}>Días a 1ª sesión</th>
                  <th className="tr" title={GLOSARIO['SLA ciclo completo']}>Días a cerrar</th>
                  <th className="tc" title="Resultado de la 1ª sesión según HubSpot">1ª sesión</th>
                  <th>Cliente</th>
                </tr></thead>
                <tbody>{filtered.slice(0, 300).map((r) => {
                  const sla = slaCell(r);
                  return <tr key={r.id}>
                    <td><a href={HS(r.id)} target="_blank" rel="noreferrer" style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.id}</a></td>
                    <td title={r.sin_fecha_solicitud ? 'Sin fecha de solicitud en HubSpot: se usa la fecha de creación del ticket' : ''}>{r.fecha_solicitud || '—'}{r.sin_fecha_solicitud && <span style={{ color: 'var(--a)' }}> *</span>}</td>
                    <td><span className={'tag ' + estadoTag(r.estado)}>{r.stage}</span></td>
                    <td>{r.pais_label}</td>
                    <td>{r.segmento}</td>
                    <td>{r.analista}</td>
                    <td className="tr">{r.mrr == null ? '—' : fmtMoney(r.mrr)}</td>
                    <td className="tc"><span className={'tag ' + sla.tag}>{sla.text}</span></td>
                    <td className="tr">{r.dias_a_cierre == null ? '—' : r.dias_a_cierre + 'd'}</td>
                    <td className="tc">{r.resultado_primera_sesion ? <span className={'tag ' + (r.no_show ? 't-r' : 't-gr')}>{r.resultado_primera_sesion}</span> : '—'}</td>
                    <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cliente || '—'}</td>
                  </tr>;
                })}</tbody>
              </table></div>
              )}
              <div className="panel-bd hint">* fecha tomada de la creación del ticket porque falta la fecha de solicitud en HubSpot.</div>
            </div>
          </>
        )}
        <div className="ftr">
          Adoption · Alegra · datos en vivo de HubSpot · solo COL, MEX, RD y CRI · «días a 1ª sesión» = desde la solicitud hasta la primera sesión · «días a cerrar» = desde la solicitud hasta el cierre. Todavía no hay una meta de SLA definida, por eso se muestran días y no un % de cumplimiento.
        </div>
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
