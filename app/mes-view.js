'use client';
// Componentes de gráfico y tarjetas que comparten las vistas del dashboard.
// Las vistas en sí (Resumen / Operación / Equipo) viven en app/dash.js.
import { useMemo, useRef, useState } from 'react';
import { SESSIONS_META } from '@/lib/sessions-data';
import {
  fmtInt, colorOf, inkOf, initials, monthLabel, sessOf,
  currentYM, prevYM, aggregateByAnalista, aggregateByPais, aggregateBySegmento,
  sortTeamFirst, isTeamMember, lastNMonths, teamTotals, stageFunnel, stageFunnelBy,
  slaSemaforo,
} from '@/lib/analistas-shared';

const TREND_MONTHS = 6;
export const ALL = '__todos__';

// Etapa actual del ticket → color de estado (no identidad) + qué mide el SLA en esa etapa.
export const STAGE_META = [
  { key: 'nuevo', label: 'Nuevo', color: 'var(--blue)', slaLabel: 'días esperando' },
  { key: 'enProceso', label: 'En proceso', color: 'var(--a)', slaLabel: 'días abiertos' },
  { key: 'completada', label: 'Completada', color: 'var(--g)', slaLabel: 'días de ciclo' },
  { key: 'noCompletada', label: 'No completada', color: 'var(--r)', slaLabel: 'días de ciclo' },
];

// Techo "redondo" para el eje Y. Los escalones son finos a propósito: con solo
// 1/2/2.5/5/10 un máximo de 540 saltaba a 1.000 y el gráfico usaba la mitad del alto.
function niceMax(raw) {
  const v = Math.max(raw, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const c of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) { if (c * mag >= v) return c * mag; }
  return 10 * mag;
}

// invert=true cuando SUBIR es malo (p.ej. días de espera) — la flecha siempre
// refleja la dirección real, el color (bueno/malo) depende de `invert`.
export function Delta({ curr, prev, invert = false, fmt = fmtInt, suffix = '' }) {
  if (curr == null || prev == null || prev === 0) return null;
  const diff = curr - prev;
  if (Math.abs(diff) < 0.05) return <span className="mes-delta mes-delta-flat">= vs mes ant.</span>;
  const up = diff > 0;
  const good = invert ? !up : up;
  return <span className={'mes-delta ' + (good ? 'mes-delta-good' : 'mes-delta-bad')}>{up ? '▲' : '▼'} {up ? '+' : ''}{fmt(diff)}{suffix} vs mes ant.</span>;
}

// ─── Sparkline: línea en gris de-énfasis, último punto en el color de acento ───
export function Sparkline({ values, color, suffix = '' }) {
  const W = 120, H = 26, pad = 4;
  const vals = values.map((v) => v == null ? 0 : v);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = Math.max(max - min, 1);
  const n = vals.length;
  const xFor = (i) => n > 1 ? pad + (i / (n - 1)) * (W - pad * 2) : W / 2;
  const yFor = (v) => pad + (1 - (v - min) / range) * (H - pad * 2);
  const pts = vals.map((v, i) => [xFor(i), yFor(v)]);
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} style={{ height: H, width: '100%' }} preserveAspectRatio="none">
      <path d={path} fill="none" stroke="var(--chart-muted)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} stroke="var(--surface)" strokeWidth="1.5" />
    </svg>
  );
}

// ─── Gráfico de tendencia: BOP / Atendidos / Completados, 1 sola escala ───
export function TrendChart({ months, bop, atendidos, completados, selectedMonth, onSelectMonth }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);

  const W = 780, H = 220, padL = 40, padR = 54, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = months.length;
  const xFor = (i) => n > 1 ? padL + (i / (n - 1)) * plotW : padL + plotW / 2;
  const maxY = niceMax(Math.max(...bop, ...atendidos, ...completados) * 1.15);
  const yFor = (v) => padT + plotH - (v / maxY) * plotH;
  const baseline = padT + plotH;

  const series = [
    { key: 'bop', label: 'BOP (asignados)', vals: bop, color: 'var(--chart-muted)', area: false, width: 1.75 },
    { key: 'atendidos', label: 'Atendidos', vals: atendidos, color: 'var(--blue)', area: false, width: 1.75 },
    { key: 'completados', label: 'Completados', vals: completados, color: 'var(--g)', area: true, width: 2.25 },
  ].map((s) => {
    const pts = s.vals.map((v, i) => [xFor(i), yFor(v)]);
    const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const area = s.area ? `${path} L ${pts[pts.length - 1][0].toFixed(1)},${baseline} L ${pts[0][0].toFixed(1)},${baseline} Z` : null;
    return { ...s, pts, path, area };
  });

  const ticks = [0.5, 1].map((f) => ({ y: padT + plotH * (1 - f), v: Math.round(maxY * f) }));

  function handleMove(e) {
    const rect = ref.current.getBoundingClientRect();
    const fracX = (e.clientX - rect.left) / rect.width;
    const svgX = fracX * W;
    const idx = Math.max(0, Math.min(n - 1, Math.round((svgX - padL) / plotW * (n - 1))));
    setHover(idx);
  }
  function handleClick() { if (hover != null) onSelectMonth(months[hover]); }

  const selIdx = months.indexOf(selectedMonth);
  const tt = hover != null ? {
    x: xFor(hover),
    yTop: Math.min(...series.map((s) => yFor(s.vals[hover]))),
    month: months[hover],
    rows: series.map((s) => ({ label: s.label, color: s.color, val: s.vals[hover] })),
  } : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={ref} className="chart-svg" viewBox={`0 0 ${W} ${H}`} onMouseMove={handleMove} onMouseLeave={() => setHover(null)} onClick={handleClick} style={{ cursor: 'pointer' }}>
        {selIdx >= 0 && n > 1 && (
          <rect x={xFor(selIdx) - (plotW / (n - 1)) / 2} y={padT} width={plotW / (n - 1)} height={plotH} fill="var(--brand-l)" />
        )}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="var(--chart-grid)" strokeWidth="1" />
            <text x={padL - 8} y={t.y + 3} textAnchor="end" fontSize="9.5" fill="var(--chart-muted)">{fmtInt(t.v)}</text>
          </g>
        ))}
        <line x1={padL} y1={baseline} x2={W - padR} y2={baseline} stroke="var(--chart-axis)" strokeWidth="1" />
        {months.map((m, i) => (
          <text key={m} x={xFor(i)} y={H - 7} textAnchor="middle" fontSize="10" fontWeight={m === selectedMonth ? '700' : '600'} fill={m === selectedMonth ? 'var(--t1)' : 'var(--chart-muted)'}>{monthLabel(m)}</text>
        ))}
        {series.map((s) => (
          <g key={s.key}>
            {s.area && <path d={s.area} fill={s.color} opacity="0.1" />}
            <path d={s.path} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinejoin="round" strokeLinecap="round" />
            <text x={s.pts[s.pts.length - 1][0] + 7} y={s.pts[s.pts.length - 1][1] + 3.5} fontSize="11" fontWeight="700" fill="var(--t1)">{fmtInt(s.vals[s.vals.length - 1])}</text>
          </g>
        ))}
        {hover != null && (
          <g>
            <line x1={xFor(hover)} y1={padT} x2={xFor(hover)} y2={baseline} stroke="var(--chart-axis)" strokeWidth="1" />
            {series.map((s) => (
              <circle key={s.key} cx={s.pts[hover][0]} cy={s.pts[hover][1]} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />
            ))}
          </g>
        )}
      </svg>
      {tt && (
        <div className="chart-tt" style={{
          left: `${Math.min(88, Math.max(2, tt.x / W * 100))}%`,
          top: `${Math.max(2, tt.yTop / H * 100)}%`,
          transform: `translate(${tt.x / W > 0.7 ? '-100%' : tt.x / W < 0.15 ? '0%' : '-50%'}, -112%)`,
        }}>
          <div className="chart-tt-title">{monthLabel(tt.month)}{tt.month === currentYM() ? ' · en curso' : ''}</div>
          {tt.rows.map((r) => (
            <div className="chart-tt-row" key={r.label}>
              <span className="chart-tt-key"><span className="chart-tt-line" style={{ background: r.color }} />{r.label}</span>
              <span className="chart-tt-val">{fmtInt(r.val)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Punto de semáforo + valor. Compara contra el promedio del equipo (no hay meta aún).
export function SlaDot({ value, teamAvg, title }) {
  const s = slaSemaforo(value, teamAvg);
  return <span className="sla-dot" style={{ background: s.color }} title={title || `${value == null ? 'sin datos' : value + 'd'} vs. promedio del equipo ${teamAvg == null ? '—' : teamAvg + 'd'}`} />;
}

// ─── Ranking: Atendidos vs Completados por analista / país / segmento, + SLA ───
export function RankingChart({ rows, teamSla, teamCiclo, onSelect }) {
  const max = Math.max(...rows.map((r) => r.atendidos), 1);
  const exitoColor = (t) => t >= 60 ? 'var(--g)' : t >= 35 ? 'var(--a)' : 'var(--r)';
  return (
    <div className="rank-rows">
      {rows.map((r) => (
        <div className="rank-row" key={r.key} onClick={() => onSelect && onSelect(r.key)} style={onSelect ? { cursor: 'pointer' } : undefined}>
          <div className="rank-name">{r.key}</div>
          <div className="rank-bars">
            <div className="rank-bar-line">
              <div className="rank-bar-track"><div className="rank-bar-fill" style={{ width: `${r.atendidos / max * 100}%`, background: 'var(--blue)' }} /></div>
              <div className="rank-bar-num">{fmtInt(r.atendidos)}</div>
            </div>
            <div className="rank-bar-line">
              <div className="rank-bar-track"><div className="rank-bar-fill" style={{ width: `${r.completados / max * 100}%`, background: 'var(--g)' }} /></div>
              <div className="rank-bar-num">{fmtInt(r.completados)}</div>
            </div>
            <div className="rank-stats">
              <span className="rank-stat" title="Completados ÷ atendidos"><b style={{ color: exitoColor(r.tasa) }}>{r.tasa.toFixed(0)}%</b> éxito</span>
              <span className="rank-stat-sep">·</span>
              <span className="rank-stat" title="Promedio de días hasta la 1ª sesión, vs. equipo"><SlaDot value={r.slaAvg} teamAvg={teamSla} />SLA 1ª <b>{r.slaAvg == null ? '—' : r.slaAvg + 'd'}</b></span>
              <span className="rank-stat-sep">·</span>
              <span className="rank-stat" title="Promedio de días hasta completado, vs. equipo"><SlaDot value={r.avgCompl} teamAvg={teamCiclo} />Ciclo <b>{r.avgCompl == null ? '—' : r.avgCompl + 'd'}</b></span>
            </div>
          </div>
        </div>
      ))}
      {!rows.length && <div className="hint">Sin datos para esta selección.</div>}
    </div>
  );
}

// ─── Embudo por etapa (equipo): cuántos hay en cada etapa + SLA de esa etapa ───
export function StageFunnelPanel({ funnel }) {
  const max = Math.max(funnel.nuevo.n, funnel.enProceso.n, funnel.completada.n, funnel.noCompletada.n, 1);
  return (
    <div className="stage-funnel">
      {STAGE_META.map((s) => {
        const b = funnel[s.key];
        return (
          <div className="stage-tile" key={s.key}>
            <div className="stage-tile-top">
              <span className="stage-tile-lbl" style={{ color: s.color }}>{s.label}</span>
              <span className="stage-tile-num">{fmtInt(b.n)}</span>
            </div>
            <div className="stage-bar-track"><div className="stage-bar-fill" style={{ width: `${b.n / max * 100}%`, background: s.color }} /></div>
            <div className="stage-tile-sla">SLA <b>{b.avg == null ? '—' : b.avg + 'd'}</b> {s.slaLabel}</div>
            {s.key === 'nuevo' && (b.alerta > 0
              ? <div className="stage-alert">⚠️ {b.alerta} ticket{b.alerta === 1 ? '' : 's'} &gt;{b.umbral}d (prom. {b.avg}d)</div>
              : <div className="stage-alert stage-alert-ok">✅ sin estancados fuera de rango</div>)}
          </div>
        );
      })}
    </div>
  );
}

// ─── Ranking · vista "Por etapa": conteo + SLA de cada etapa, por analista/país/segmento ───
export function StageRankingChart({ rows }) {
  const max = Math.max(...rows.flatMap((r) => STAGE_META.map((s) => r[s.key].n)), 1);
  return (
    <div className="rank-rows">
      {rows.map((r) => (
        <div className="rank-row" key={r.key}>
          <div className="rank-name">{r.key}</div>
          <div className="rank-bars">
            {STAGE_META.map((s) => {
              const b = r[s.key];
              return (
                <div className="rank-bar-line" key={s.key}>
                  <div className="rank-bar-track"><div className="rank-bar-fill" style={{ width: `${b.n / max * 100}%`, background: s.color }} /></div>
                  <div className="rank-bar-num">{fmtInt(b.n)}</div>
                </div>
              );
            })}
            <div className="rank-stats">
              <span className="rank-stat">Nuevo <b>{r.nuevo.avg == null ? '—' : r.nuevo.avg + 'd'}</b>{r.nuevo.alerta > 0 && <b style={{ color: 'var(--r)' }}> ⚠️{r.nuevo.alerta}</b>}</span>
              <span className="rank-stat-sep">·</span>
              <span className="rank-stat">En proceso <b>{r.enProceso.avg == null ? '—' : r.enProceso.avg + 'd'}</b></span>
              <span className="rank-stat-sep">·</span>
              <span className="rank-stat">Completada <b>{r.completada.avg == null ? '—' : r.completada.avg + 'd'}</b></span>
              <span className="rank-stat-sep">·</span>
              <span className="rank-stat">No compl. <b>{r.noCompletada.avg == null ? '—' : r.noCompletada.avg + 'd'}</b></span>
            </div>
          </div>
        </div>
      ))}
      {!rows.length && <div className="hint">Sin datos para esta selección.</div>}
    </div>
  );
}

// ─── Barras horizontales chicas (país/segmento dentro del modal de analista) ───
export function MiniBreakdown({ rows }) {
  const max = Math.max(...rows.map((r) => r.asignados), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 92, fontSize: 12, color: 'var(--t2)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{r.key}</div>
          <div className="gbar-track" style={{ flex: 1, height: 14 }}><div className="gbar-fill" style={{ width: `${r.asignados / max * 100}%` }} /></div>
          <div style={{ fontSize: 12, fontWeight: 700, minWidth: 22, textAlign: 'right' }}>{fmtInt(r.asignados)}</div>
        </div>
      ))}
      {!rows.length && <div className="hint">Sin datos.</div>}
    </div>
  );
}

// ─── Vista integral de UN analista para el mes seleccionado ───
export function AnalystDetailModal({ analista, mes, scoped, recsMes, trendMonths, teamStats, hasSesData, hasFilter, onClose }) {
  const mine = useMemo(() => recsMes.filter((r) => r.analista === analista), [recsMes, analista]);
  const stats = useMemo(() => teamTotals(mine), [mine]);
  const funnel = useMemo(() => stageFunnel(mine), [mine]);
  // Estado actual del pipeline: TODOS sus tickets asignados hoy, sin importar en qué mes se crearon.
  const allMine = useMemo(() => scoped.filter((r) => r.analista === analista), [scoped, analista]);
  const funnelAll = useMemo(() => stageFunnel(allMine), [allMine]);
  const abiertosAhora = funnelAll.nuevo.n + funnelAll.enProceso.n;
  const porPais = useMemo(() => [...aggregateByPais(mine)].sort((a, b) => b.asignados - a.asignados), [mine]);
  const porSeg = useMemo(() => [...aggregateBySegmento(mine)].sort((a, b) => b.asignados - a.asignados), [mine]);
  const s = sessOf(analista, mes);

  const trend = useMemo(() => {
    const byMonth = trendMonths.map((m) => teamTotals(scoped.filter((r) => r.analista === analista && r.mes_solicitud === m)));
    return {
      atendidos: byMonth.map((b) => b.atendidos),
      completados: byMonth.map((b) => b.completados),
      slaAvg: byMonth.map((b) => b.slaAvg ?? 0),
    };
  }, [scoped, trendMonths, analista]);

  const pctAtendidos = stats.asignados ? (stats.atendidos / stats.asignados * 100) : 0;
  const tasa = stats.atendidos ? (stats.completados / stats.atendidos * 100) : 0;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="acard-av" style={{ background: colorOf(analista), color: inkOf(analista), width: 42, height: 42, fontSize: 15 }}>{initials(analista)}</div>
          <div>
            <div className="stitle">{analista}</div>
            <div className="ssub">Vista integral · {monthLabel(mes)}</div>
          </div>
          <button className="modal-x" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 18 }}>
          <div className="kpi-row">
            <div className="kpi"><div className="kpi-lbl">BOP</div><div className="kpi-num">{fmtInt(stats.asignados)}</div></div>
            <div className="kpi k-blue"><div className="kpi-lbl">Atendidos</div><div className="kpi-num">{fmtInt(stats.atendidos)}</div><div className="kpi-sub">{pctAtendidos.toFixed(0)}% del BOP</div></div>
            <div className="kpi k-ok"><div className="kpi-lbl">Completados</div><div className="kpi-num">{fmtInt(stats.completados)}</div><div className="kpi-sub">{tasa.toFixed(0)}% éxito</div></div>
            <div className="kpi k-warn"><div className="kpi-lbl">SLA 1ª atención</div><div className="kpi-num" style={{ fontSize: 22, display: 'flex', alignItems: 'center' }}><SlaDot value={stats.slaAvg} teamAvg={teamStats.slaAvg} />{stats.slaAvg == null ? '—' : stats.slaAvg + 'd'}</div><div className="kpi-sub">equipo: {teamStats.slaAvg == null ? '—' : teamStats.slaAvg + 'd'}</div></div>
            <div className="kpi k-purple"><div className="kpi-lbl">SLA ciclo completo</div><div className="kpi-num" style={{ fontSize: 22, display: 'flex', alignItems: 'center' }}><SlaDot value={stats.cicloAvg} teamAvg={teamStats.cicloAvg} />{stats.cicloAvg == null ? '—' : stats.cicloAvg + 'd'}</div><div className="kpi-sub">equipo: {teamStats.cicloAvg == null ? '—' : teamStats.cicloAvg + 'd'}</div></div>
          </div>

          <div>
            <div className="stitle" style={{ fontSize: 13, marginBottom: 8 }}>Tendencia propia · últimos {trendMonths.length} meses</div>
            <div className="kpi-hero-row">
              <div className="kpi-hero"><div className="kpi-hero-lbl">Atendidos</div><div className="kpi-hero-spark"><Sparkline values={trend.atendidos} color="var(--blue)" /></div></div>
              <div className="kpi-hero"><div className="kpi-hero-lbl">Completados</div><div className="kpi-hero-spark"><Sparkline values={trend.completados} color="var(--g)" /></div></div>
              <div className="kpi-hero"><div className="kpi-hero-lbl">SLA 1ª atención</div><div className="kpi-hero-spark"><Sparkline values={trend.slaAvg} color="var(--a)" /></div></div>
            </div>
          </div>

          <div>
            <div className="stitle" style={{ fontSize: 13, marginBottom: 8 }}>
              Estado actual del pipeline
              <span className="pill" style={{ marginLeft: 8 }}>{fmtInt(abiertosAhora)} abiertos ahora</span>
            </div>
            <div className="ssub" style={{ marginBottom: 8 }}>Todos sus tickets asignados hoy, sin importar el mes en que se crearon{hasFilter ? ' · con los filtros de país/segmento activos' : ''}</div>
            <StageFunnelPanel funnel={funnelAll} />
          </div>

          <div>
            <div className="stitle" style={{ fontSize: 13, marginBottom: 8 }}>Embudo del mes</div>
            <div className="ssub" style={{ marginBottom: 8 }}>Solo tickets creados en {monthLabel(mes)}</div>
            <StageFunnelPanel funnel={funnel} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <div className="stitle" style={{ fontSize: 13, marginBottom: 8 }}>Por país</div>
              <MiniBreakdown rows={porPais} />
            </div>
            <div>
              <div className="stitle" style={{ fontSize: 13, marginBottom: 8 }}>Por segmento</div>
              <MiniBreakdown rows={porSeg} />
            </div>
          </div>

          {hasSesData && (
            <div className="hint">🎥 Sesiones dadas este mes (registro Connect): <b style={{ color: 'var(--t1)' }}>{fmtInt(s?.dadas || 0)}</b>{s?.primeras ? ` · ${fmtInt(s.primeras)} primeras` : ''}</div>
          )}
        </div>
      </div>
    </div>
  );
}
