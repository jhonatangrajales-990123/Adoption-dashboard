'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Núcleo del dashboard: los controles compartidos (mes, país, segmento, lente),
// el cálculo común, y las 3 vistas que responden una pregunta cada una:
//   Resumen    → ¿vamos bien?
//   Operación  → ¿dónde se están atorando los clientes?
//   Equipo     → ¿cómo va cada analista y quién necesita apoyo?
// (La cuarta, Explorador, vive en page.js porque es la herramienta libre.)
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { SESSIONS_META } from '@/lib/sessions-data';
import {
  fmtInt, colorOf, inkOf, initials, monthLabel, sessOf, currentYM, prevYM,
  aggregateByAnalista, aggregateByPais, aggregateBySegmento, sortTeamFirst,
  isTeamMember, lastNMonths, teamTotals, stageFunnel, stageFunnelBy, GLOSARIO,
} from '@/lib/analistas-shared';
import { LENTES, mesDe, MES_MINIMO } from '@/lib/metrics';
import { FunnelMes, MultiLineChart, Leyenda } from './metric-explorer';
import {
  Delta, Sparkline, TrendChart, SlaDot, RankingChart, StageFunnelPanel,
  StageRankingChart, AnalystDetailModal, STAGE_META, ALL,
} from './mes-view';

const TREND_MONTHS = 6;
const HS = (id) => `https://app.hubspot.com/contacts/6180490/record/2-40542822/${id}`;
const diasDesde = (ymd) => {
  if (!ymd) return null;
  const d = Math.floor((Date.now() - new Date(ymd + 'T00:00:00').getTime()) / 86400000);
  return d >= 0 ? d : 0;
};

// ─── Cálculo compartido por las 3 vistas ───
export function useDashData(records, ctrl) {
  const { mes, pais, seg, lente } = ctrl;

  const months = useMemo(() => {
    // Solo meses dentro de la ventana del dashboard (desde ene-2026).
    const set = new Set(records.map((r) => mesDe(r, lente)).filter((m) => m && m >= MES_MINIMO));
    return [...set].sort().reverse();
  }, [records, lente]);

  const paisOpts = useMemo(() => {
    const c = {};
    records.forEach((r) => { const k = r.pais_label || 'Sin país'; c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a]);
  }, [records]);
  const segOpts = useMemo(() => {
    const c = {};
    records.forEach((r) => { const k = r.segmento || 'Sin segmento'; c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a]);
  }, [records]);

  const scoped = useMemo(() => records.filter((r) =>
    (pais === ALL || r.pais_label === pais) && (seg === ALL || r.segmento === seg)
  ), [records, pais, seg]);
  const hasFilter = pais !== ALL || seg !== ALL;

  const recsMes = useMemo(() => scoped.filter((r) => mesDe(r, lente) === mes), [scoped, mes, lente]);
  const recsPrev = useMemo(() => { const pm = prevYM(mes); return scoped.filter((r) => mesDe(r, lente) === pm); }, [scoped, mes, lente]);

  const totals = useMemo(() => teamTotals(recsMes), [recsMes]);
  const prevTotals = useMemo(() => teamTotals(recsPrev), [recsPrev]);

  const rows = useMemo(() => sortTeamFirst(aggregateByAnalista(recsMes), 'atendidos'), [recsMes]);
  const prevByName = useMemo(() => Object.fromEntries(aggregateByAnalista(recsPrev).map((r) => [r.analista, r])), [recsPrev]);

  const funnelMes = useMemo(() => stageFunnel(recsMes), [recsMes]);

  const trendMonths = useMemo(() => lastNMonths(mes, TREND_MONTHS), [mes]);
  const trendData = useMemo(() => {
    const by = new Map();
    trendMonths.forEach((m) => by.set(m, teamTotals(scoped.filter((r) => mesDe(r, lente) === m))));
    return {
      bop: trendMonths.map((m) => by.get(m).asignados),
      atendidos: trendMonths.map((m) => by.get(m).atendidos),
      completados: trendMonths.map((m) => by.get(m).completados),
      tasa: trendMonths.map((m) => by.get(m).tasa ?? 0),
      slaAvg: trendMonths.map((m) => by.get(m).slaAvg ?? 0),
      cicloAvg: trendMonths.map((m) => by.get(m).cicloAvg ?? 0),
    };
  }, [scoped, trendMonths, lente]);

  // El registro Connect no distingue país/segmento, así que con filtro no aplica.
  const hasSesData = SESSIONS_META.meses.includes(mes) && !hasFilter;

  return { months, paisOpts, segOpts, scoped, recordsTodos: records, hasFilter, recsMes, recsPrev, totals, prevTotals, rows, prevByName, funnelMes, trendMonths, trendData, hasSesData };
}

// ─── Barra de controles: una sola vez, compartida por todas las vistas ───
export function DashControls({ ctrl, setCtrl, months, paisOpts, segOpts, hasFilter }) {
  const { mes, pais, seg, lente } = ctrl;
  const i = months.indexOf(mes);
  const set = (patch) => setCtrl({ ...ctrl, ...patch });
  const step = (dir) => { const n = i - dir; if (n >= 0 && n < months.length) set({ mes: months[n] }); };

  return (
    <div className="panel ctrl-bar">
      <div className="ctrl-row">
        <div className="month-stepper">
          <button className="step-btn" onClick={() => step(1)} disabled={!(i >= 0 && i < months.length - 1)} title="Mes anterior">‹</button>
          <select className="inp" style={{ width: 'auto', fontSize: 14, fontWeight: 700, textAlign: 'center' }} value={mes} onChange={(e) => set({ mes: e.target.value })}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === currentYM() ? ' (en curso)' : ''}</option>)}
          </select>
          <button className="step-btn" onClick={() => step(-1)} disabled={!(i > 0)} title="Mes siguiente">›</button>
        </div>

        <div className="fg fg-inline">
          <label title={LENTES[lente].hint}>Contar el mes por</label>
          <select className="inp" value={lente} onChange={(e) => set({ lente: e.target.value })} title={LENTES[lente].hint}>
            {Object.values(LENTES).map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </div>

        <div className="fg fg-inline"><label>País</label>
          <select className="inp" value={pais} onChange={(e) => set({ pais: e.target.value })}>
            <option value={ALL}>Todos los países</option>
            {paisOpts.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="fg fg-inline"><label>Segmento</label>
          <select className="inp" value={seg} onChange={(e) => set({ seg: e.target.value })}>
            <option value={ALL}>Contador y Pyme</option>
            {segOpts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {hasFilter && <button className="chip" onClick={() => set({ pais: ALL, seg: ALL })}>✕ Limpiar</button>}
      </div>
      <div className="ctrl-hint">{LENTES[lente].hint}</div>
    </div>
  );
}

// ─── Leyenda del semáforo: antes el color solo se explicaba al pasar el mouse ───
export function SemaforoLeyenda() {
  return (
    <div className="semaforo-leyenda">
      <b>Semáforo de SLA:</b>
      <span><i style={{ background: 'var(--g)' }} />igual o mejor que el promedio del equipo</span>
      <span><i style={{ background: 'var(--a)' }} />hasta 50% más lento</span>
      <span><i style={{ background: 'var(--r)' }} />más del 50% más lento</span>
      <span className="hint">Se compara contra el equipo, no contra una meta — todavía no hay meta definida.</span>
    </div>
  );
}

// ═══ VISTA 1 · RESUMEN — ¿vamos bien? ═══
export function ResumenView({ d, ctrl, onNavigate }) {
  const { totals: t, prevTotals: p, trendMonths, trendData, funnelMes, scoped } = d;
  const pctAt = t.asignados ? Math.round(t.atendidos / t.asignados * 100) : 0;
  const pctEx = Math.round(t.tasa);
  const pctExPrev = Math.round(p.tasa);
  const deltaEx = pctEx - pctExPrev;
  const abiertosDelMes = funnelMes.nuevo.n + funnelMes.enProceso.n;
  const esCierre = ctrl.lente === 'cierre';
  // Aviso reusable: el último punto de las mini-tendencias es el mes en curso.
  const sVolumen = [
    { key: 'bop', label: 'Solicitudes', color: 'var(--chart-muted)', vals: trendData.bop },
    { key: 'atendidos', label: 'Atendidas', color: 'var(--blue)', vals: trendData.atendidos },
    { key: 'completados', label: 'Completadas', color: 'var(--g)', vals: trendData.completados },
  ];
  const sVelocidad = [
    { key: 'sla', label: 'A la 1ª sesión', color: 'var(--a)', vals: trendData.slaAvg },
    { key: 'ciclo', label: 'Hasta cerrar', color: 'var(--purple)', vals: trendData.cicloAvg },
  ];
  const parcial = trendMonths[trendMonths.length - 1] === currentYM()
    ? ' El último punto es el mes en curso y va incompleto.'
    : '';

  return (
    <>
      {/* La frase que cualquiera entiende en 10 segundos. Cambia según la lente:
          bajo "fecha de cierre" el universo son SOLO tickets ya cerrados, así que
          decir "atendimos el X%" daría casi siempre 100% — un espejismo del
          denominador, no un logro. Ahí la frase habla de entrega, no de atención. */}
      <div className="titular">
        <div className="titular-mes">{monthLabel(ctrl.mes)}{ctrl.mes === currentYM() && <span className="pill">● mes en curso</span>}</div>
        {esCierre ? (
          <p>
            En {monthLabel(ctrl.mes)} <b>cerramos {fmtInt(t.asignados)} tickets</b>:
            {' '}<b>{fmtInt(t.completados)}</b> completados con éxito y <b>{fmtInt(t.no_completados)}</b> no completados
            {' '}(<b>{pctEx}%</b> de éxito
            {p.asignados > 0 && deltaEx !== 0 && (
              <>, <b className={deltaEx > 0 ? 'txt-good' : 'txt-bad'}>{deltaEx > 0 ? `${deltaEx} puntos más` : `${Math.abs(deltaEx)} puntos menos`}</b> que el mes anterior</>
            )}).
          </p>
        ) : (
          <p>
            En {monthLabel(ctrl.mes)} <b>llegaron {fmtInt(t.asignados)} solicitudes</b>.
            {' '}Le dimos la primera sesión al <b>{pctAt}%</b> y completamos el <b>{pctEx}%</b> de esas
            {p.asignados > 0 && deltaEx !== 0 && (
              <>, <b className={deltaEx > 0 ? 'txt-good' : 'txt-bad'}>{deltaEx > 0 ? `${deltaEx} puntos más` : `${Math.abs(deltaEx)} puntos menos`}</b> que el mes anterior</>
            )}.
            {abiertosDelMes > 0 && (
              <> Quedan <button className="link-num" onClick={() => onNavigate && onNavigate('operacion')} title="Ver el desglose de esos tickets abiertos">{fmtInt(abiertosDelMes)} tickets de ese mes todavía abiertos →</button></>
            )}
          </p>
        )}
        {esCierre && (
          <div className="titular-nota">ℹ️ Estás mirando por <b>fecha de cierre</b>: el universo son solo tickets ya cerrados, por eso aquí no se muestra el % de atención (daría casi siempre 100%). Cambia a «fecha de solicitud» para ver cuánto de lo que llegó alcanzamos a atender.</div>
        )}
        {/* Un mes a medio correr contra uno completo no es una comparación.
            Sin esta línea, todas las flechas rojas de "vs mes ant." se leen como
            una caída del equipo cuando lo único que falta es que pase el mes. */}
        {ctrl.mes === currentYM() && (
          <div className="titular-nota">
            📅 {monthLabel(ctrl.mes)} lleva <b>{new Date().getDate()} días</b> corridos y el mes anterior está completo,
            {' '}así que las comparaciones «vs mes ant.» de abajo <b>no son parejas</b> todavía.
            {' '}Para comparar de verdad, mira <b>Desempeño</b>, que solo usa meses cerrados.
          </div>
        )}
        {t.agendadosNoAtendidos > 0 && (
          <div className="titular-nota">📅 {fmtInt(t.agendadosNoAtendidos)} ticket{t.agendadosNoAtendidos === 1 ? '' : 's'} con sesión agendada que <b>no llegó a darse</b> (no asistió, cancelada o reagendada). No cuentan como atendidos.</div>
        )}
        {t.atendidosSinResultado > 0 && (
          <div className="titular-nota">⚠️ {fmtInt(t.atendidosSinResultado)} de los atendidos <b>no tienen el resultado de la 1ª sesión anotado</b> en HubSpot. Se cuentan como atendidos por la fecha, pero el dato está incompleto.</div>
        )}
        {t.completadosSinSesion > 0 && (
          <div className="titular-nota">⚠️ {fmtInt(t.completadosSinSesion)} ticket{t.completadosSinSesion === 1 ? '' : 's'} completado{t.completadosSinSesion === 1 ? '' : 's'} sin ninguna sesión registrada — se cuentan como éxito, pero conviene registrar la sesión.</div>
        )}
      </div>

      <div className="kpi-hero-row">
        <div className="kpi-hero" title={GLOSARIO.BOP}>
          <div className="kpi-hero-lbl">Solicitudes (BOP)</div>
          <div className="kpi-hero-val">{fmtInt(t.asignados)}</div>
          <div className="kpi-hero-sub"><Delta curr={t.asignados} prev={p.asignados} /></div>
          <div className="kpi-hero-spark"><Sparkline values={trendData.bop} color="var(--chart-muted)" /></div>
        </div>
        <div className="kpi-hero k-blue" title={GLOSARIO.atendido}>
          <div className="kpi-hero-lbl">Atendidos</div>
          <div className="kpi-hero-val">{fmtInt(t.atendidos)}</div>
          <div className="kpi-hero-sub">{pctAt}% de las solicitudes · <Delta curr={t.atendidos} prev={p.atendidos} /></div>
          <div className="kpi-hero-spark"><Sparkline values={trendData.atendidos} color="var(--blue)" /></div>
        </div>
        <div className="kpi-hero k-ok" title={GLOSARIO.completado}>
          <div className="kpi-hero-lbl">Completados</div>
          <div className="kpi-hero-val">{fmtInt(t.completados)}</div>
          <div className="kpi-hero-sub">de {fmtInt(t.atendidos)} atendidos · <Delta curr={t.completados} prev={p.completados} /></div>
          <div className="kpi-hero-spark"><Sparkline values={trendData.completados} color="var(--g)" /></div>
        </div>
        <div className="kpi-hero k-ok" title={GLOSARIO.exito}>
          <div className="kpi-hero-lbl">Tasa de éxito</div>
          <div className="kpi-hero-val">{t.atendidos ? pctEx + '%' : '—'}</div>
          <div className="kpi-hero-sub">completados ÷ atendidos · <Delta curr={t.tasa} prev={p.tasa} fmt={(v) => v.toFixed(0)} suffix=" pts" /></div>
          <div className="kpi-hero-spark"><Sparkline values={trendData.tasa} color="var(--g)" /></div>
        </div>
        <div className="kpi-hero k-warn" title={GLOSARIO['SLA 1ª atención']}>
          <div className="kpi-hero-lbl">Días a la 1ª sesión</div>
          <div className="kpi-hero-val">{t.slaAvg == null ? '—' : t.slaAvg + 'd'}</div>
          <div className="kpi-hero-sub">mediana {t.slaMed == null ? '—' : t.slaMed + 'd'} · <Delta curr={t.slaAvg} prev={p.slaAvg} invert fmt={(v) => v.toFixed(1)} suffix="d" /></div>
          <div className="kpi-hero-spark"><Sparkline values={trendData.slaAvg} color="var(--a)" /></div>
        </div>
        <div className="kpi-hero k-purple" title={GLOSARIO['SLA ciclo completo']}>
          <div className="kpi-hero-lbl">Días hasta cerrar</div>
          <div className="kpi-hero-val">{t.cicloAvg == null ? '—' : t.cicloAvg + 'd'}</div>
          <div className="kpi-hero-sub">mediana {t.cicloMed == null ? '—' : t.cicloMed + 'd'} · <Delta curr={t.cicloAvg} prev={p.cicloAvg} invert fmt={(v) => v.toFixed(1)} suffix="d" /></div>
          <div className="kpi-hero-spark"><Sparkline values={trendData.cicloAvg} color="var(--purple)" /></div>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi" title={GLOSARIO['No-show']}>
          <div className="kpi-lbl">No-show</div>
          <div className="kpi-num">{t.noShowPct == null ? '—' : t.noShowPct.toFixed(0) + '%'}</div>
          <div className="kpi-sub">{t.conResultadoSesion ? `${fmtInt(t.noShow)} de ${fmtInt(t.conResultadoSesion)} con resultado registrado` : 'sin resultados registrados'}</div>
        </div>
        <div className="kpi" title="Sesiones registradas en los tickets del mes (fuente: HubSpot)">
          <div className="kpi-lbl">Sesiones dictadas</div>
          <div className="kpi-num">{fmtInt(t.sesionesTotales)}</div>
          <div className="kpi-sub">en los tickets del mes</div>
        </div>
        <div className="kpi" title={GLOSARIO.CSAT}>
          <div className="kpi-lbl">CSAT</div>
          <div className="kpi-num">{t.csatAvg == null ? '—' : t.csatAvg}</div>
          <div className="kpi-sub">{t.csatN ? `promedio de ${fmtInt(t.csatN)} respuestas` : 'sin respuestas este mes'}</div>
        </div>
        <div className="kpi" title={GLOSARIO.MRR}>
          <div className="kpi-lbl">MRR</div>
          <div className="kpi-num" style={{ fontSize: 22 }}>{t.mrrTotal == null ? '—' : '$' + fmtInt(t.mrrTotal)}</div>
          <div className="kpi-sub">{t.mrrN ? `suma de ${fmtInt(t.mrrN)} tickets con dato` : 'sin dato'}</div>
        </div>
      </div>

      <FunnelMes totals={t} mesLabel={monthLabel(ctrl.mes)} enCurso={ctrl.mes === currentYM()} />

      {/* El progreso histórico SÍ va en la portada —es lo primero que pregunta
          dirección— pero resumido a dos gráficas: volumen y tiempos. Las seis
          gráficas por tema, con sus filtros y divisiones, viven en Desempeño.
          Tenerlas aquí hacía que la portada tardara minutos en leerse, no
          segundos, que es justo lo contrario de para lo que existe. */}
      <div className="seccion-t">Cómo venimos en el tiempo</div>
      <div className="mini-trend-row">
        <div className="chart-card">
          <div className="chart-card-hd"><div>
            <div className="stitle">Volumen de gestión</div>
            <div className="ssub">Últimos {trendMonths.length} meses. Lo que llega frente a lo que cerramos bien.{parcial}</div>
          </div></div>
          <Leyenda series={sVolumen} />
          <div className="chart-card-bd">
            <MultiLineChart months={trendMonths} unidad="conteo" alto={200} ancho={520} series={sVolumen} />
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-card-hd"><div>
            <div className="stitle">Velocidad</div>
            <div className="ssub">Días promedio. Bajar es mejorar.{parcial}</div>
          </div></div>
          <Leyenda series={sVelocidad} />
          <div className="chart-card-bd">
            <MultiLineChart months={trendMonths} unidad="dias" alto={200} ancho={520} series={sVelocidad} />
          </div>
        </div>
      </div>

      <div className="cta-row">
        <button className="cta-card" onClick={() => onNavigate && onNavigate('desempeno')}>
          <span className="cta-icon">📈</span>
          <span className="cta-txt">
            <b>Ver el desempeño del equipo</b>
            <small>Antes vs ahora, capacidad por analista y las seis gráficas por tema, con filtros propios.</small>
          </span>
          <span className="cta-flecha">→</span>
        </button>
        <button className="cta-card" onClick={() => onNavigate && onNavigate('activacion')}>
          <span className="cta-icon">🚀</span>
          <span className="cta-txt">
            <b>Ver la activación (lectura SaaS)</b>
            <small>Time to First Value, % activado a 30/60/90 días, embudo por fases y cuentas en riesgo.</small>
          </span>
          <span className="cta-flecha">→</span>
        </button>
      </div>
    </>
  );
}

// Reparto simple con barra: etiqueta, barra proporcional y conteo.
function Reparto({ rows, color = 'var(--blue)' }) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  const total = rows.reduce((s, r) => s + r.n, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.filter((r) => r.n > 0).map((r) => (
        <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 132, fontSize: 12, color: 'var(--t2)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }} title={r.k}>{r.k}</div>
          <div className="stage-bar-track" style={{ flex: 1, height: 10 }}>
            <div className="stage-bar-fill" style={{ width: `${r.n / max * 100}%`, background: r.color || color }} />
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, minWidth: 62, textAlign: 'right' }}>
            {fmtInt(r.n)} <span style={{ color: 'var(--t3)', fontWeight: 400 }}>{total ? Math.round(r.n / total * 100) : 0}%</span>
          </div>
        </div>
      ))}
      {!rows.some((r) => r.n > 0) && <div className="hint">Sin datos.</div>}
    </div>
  );
}

// ═══ VISTA 2 · OPERACIÓN — ¿dónde se están atorando los clientes? ═══
export function OperacionView({ d, ctrl }) {
  const [dim, setDim] = useState('analista');
  const { recsMes, funnelMes, scoped } = d;

  // Estado del pipeline HOY: todos los tickets abiertos, sin importar en qué mes
  // se pidieron. Un ticket atorado lo está aunque venga de hace tres meses — si
  // esto se filtrara por mes, en el mes en curso nunca saldría nada (un ticket de
  // agosto no puede llevar 30 días atorado si estamos a 28 de agosto).
  const funnelHoy = useMemo(() => stageFunnel(scoped), [scoped]);

  // Los tickets DEL MES seleccionado que siguen abiertos. Es a donde lleva el
  // enlace del Resumen: no la lista uno por uno, sino de qué están hechos —
  // en qué etapa, hace cuánto esperan, de quién son y de dónde vienen.
  const abiertosMes = useMemo(() => recsMes.filter((r) => r.stage === 'Nuevo' || r.stage === 'En proceso')
    .map((r) => ({ ...r, diasEtapa: diasDesde(r.fecha_entrada_etapa || r.fecha_solicitud) })), [recsMes]);

  const desglose = useMemo(() => {
    const buckets = [
      { k: 'Menos de 1 semana', n: 0, color: 'var(--g)' },
      { k: 'Entre 1 y 2 semanas', n: 0, color: 'var(--g)' },
      { k: 'Entre 2 y 4 semanas', n: 0, color: 'var(--a)' },
      { k: 'Más de 1 mes', n: 0, color: 'var(--r)' },
    ];
    const porEtapa = {}, porAnalista = {}, porPais = {}, porSeg = {};
    let sinSesion = 0;
    abiertosMes.forEach((r) => {
      const d = r.diasEtapa ?? 0;
      if (d < 7) buckets[0].n++; else if (d < 15) buckets[1].n++; else if (d < 30) buckets[2].n++; else buckets[3].n++;
      porEtapa[r.stage] = (porEtapa[r.stage] || 0) + 1;
      porAnalista[r.analista] = (porAnalista[r.analista] || 0) + 1;
      porPais[r.pais_label] = (porPais[r.pais_label] || 0) + 1;
      porSeg[r.segmento] = (porSeg[r.segmento] || 0) + 1;
      if (!r.tiene_primera_sesion) sinSesion++;
    });
    const arr = (o) => Object.entries(o).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n);
    return {
      buckets,
      etapa: arr(porEtapa).map((x) => ({ ...x, color: x.k === 'Nuevo' ? 'var(--blue)' : 'var(--a)' })),
      analista: arr(porAnalista).slice(0, 10),
      pais: arr(porPais),
      segmento: arr(porSeg),
      sinSesion,
      diasProm: abiertosMes.length ? Math.round(abiertosMes.reduce((s, r) => s + (r.diasEtapa ?? 0), 0) / abiertosMes.length) : null,
    };
  }, [abiertosMes]);

  const stageRankRows = useMemo(() => {
    const keyFn = dim === 'pais' ? (r) => r.pais_label || 'Sin país'
      : dim === 'segmento' ? (r) => r.segmento || 'Sin segmento'
      : (r) => r.analista || 'Sin asignar';
    let list = stageFunnelBy(recsMes, keyFn);
    if (dim === 'analista') list = list.filter((r) => isTeamMember(r.key));
    return list.sort((a, b) => b.total - a.total);
  }, [dim, recsMes]);

  // Tickets abiertos que llevan más tiempo del razonable en su etapa. Es la lista
  // accionable: a quién hay que desatorar hoy, con nombre y enlace a HubSpot.
  const estancados = useMemo(() => {
    const umbralNuevo = funnelHoy.nuevo.umbral || 30;
    return scoped
      .filter((r) => r.stage === 'Nuevo' || r.stage === 'En proceso')
      .map((r) => ({ ...r, diasEtapa: diasDesde(r.fecha_entrada_etapa || r.fecha_solicitud) }))
      .filter((r) => r.diasEtapa != null && r.diasEtapa > (r.stage === 'Nuevo' ? umbralNuevo : 30))
      .sort((a, b) => b.diasEtapa - a.diasEtapa);
  }, [scoped, funnelHoy]);

  return (
    <>
      {/* A donde lleva el enlace del Resumen: de qué están hechos los abiertos del mes */}
      <div className="chart-card" id="abiertos-del-mes">
        <div className="chart-card-hd">
          <div>
            <div className="stitle">Los {fmtInt(abiertosMes.length)} tickets de {monthLabel(ctrl.mes)} que siguen abiertos</div>
            <div className="ssub">
              {abiertosMes.length
                ? <>Llevan <b>{desglose.diasProm} días en promedio</b> en su etapa actual{desglose.sinSesion > 0 && <> · <b>{fmtInt(desglose.sinSesion)}</b> todavía sin ninguna sesión</>}</>
                : <>Todos los tickets de {monthLabel(ctrl.mes)} ya están cerrados.</>}
            </div>
          </div>
        </div>
        {abiertosMes.length > 0 && (
          <div className="chart-card-bd desglose-grid">
            <div>
              <div className="desglose-t">¿Hace cuánto esperan?</div>
              <Reparto rows={desglose.buckets} />
            </div>
            <div>
              <div className="desglose-t">¿En qué etapa están?</div>
              <Reparto rows={desglose.etapa} />
            </div>
            <div>
              <div className="desglose-t">¿De quién son?</div>
              <Reparto rows={desglose.analista} color="var(--purple)" />
            </div>
            <div>
              <div className="desglose-t">¿De dónde vienen?</div>
              <Reparto rows={desglose.pais} color="var(--blue)" />
              <div className="desglose-t" style={{ marginTop: 14 }}>¿Contador o Pyme?</div>
              <Reparto rows={desglose.segmento} color="var(--blue)" />
            </div>
          </div>
        )}
      </div>

      <div className="chart-card">
        <div className="chart-card-hd">
          <div>
            <div className="stitle">Estado del pipeline hoy</div>
            <div className="ssub">Todos los tickets, sin importar el mes en que se pidieron · los días son el tiempo <b>en esa etapa</b>, no desde la solicitud</div>
          </div>
          <span className="pill">{fmtInt(funnelHoy.nuevo.n + funnelHoy.enProceso.n)} abiertos ahora</span>
        </div>
        <div className="chart-card-bd"><StageFunnelPanel funnel={funnelHoy} /></div>
      </div>

      <div className="panel">
        <div className="panel-hd">
          <div>
            <div className="stitle">¿A quién hay que desatorar?</div>
            <div className="ssub">{estancados.length ? `${estancados.length} tickets abiertos llevan más días en su etapa de lo razonable. Del más viejo al más nuevo.` : 'Ningún ticket abierto está por encima del umbral de su etapa.'}</div>
          </div>
        </div>
        {estancados.length > 0 ? (
          <div className="tbl-scroll"><table>
            <thead><tr>
              <th>Cliente</th><th>Etapa</th><th className="tr">Días ahí</th><th>Analista</th><th>País</th><th>Segmento</th><th>ID</th>
            </tr></thead>
            <tbody>{estancados.slice(0, 60).map((r) => (
              <tr key={r.id}>
                <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cliente || '—'}</td>
                <td><span className={'tag ' + (r.stage === 'Nuevo' ? 't-b' : 't-a')}>{r.stage}</span></td>
                <td className="tr" style={{ fontWeight: 800, color: 'var(--r)' }}>{r.diasEtapa}d</td>
                <td>{r.analista}</td>
                <td>{r.pais_label}</td>
                <td>{r.segmento}</td>
                <td><a href={HS(r.id)} target="_blank" rel="noreferrer" style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.id} ↗</a></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : (
          <div className="panel-bd muted">✅ Nada estancado con los filtros actuales.</div>
        )}
        {estancados.length > 60 && <div className="panel-bd hint">Mostrando los 60 más viejos de {estancados.length}.</div>}
      </div>

      <div className="chart-card">
        <div className="chart-card-hd">
          <div>
            <div className="stitle">¿Dónde se acumulan los tickets del mes?</div>
            <div className="ssub">Solo los de {monthLabel(ctrl.mes)} · reparto por etapa y días promedio en cada una</div>
          </div>
          <div className="chips">
            {[['analista', 'Analista'], ['pais', 'País'], ['segmento', 'Segmento']].map(([k, l]) => (
              <button key={k} className={'chip' + (dim === k ? ' active' : '')} onClick={() => setDim(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="chart-legend">
          {STAGE_META.map((s) => (
            <span className="chart-legend-item" key={s.key}><span className="chart-legend-key" style={{ background: s.color }} />{s.label}</span>
          ))}
        </div>
        <div className="chart-card-bd"><StageRankingChart rows={stageRankRows} /></div>
      </div>
    </>
  );
}

// ═══ VISTA 3 · EQUIPO — ¿cómo va cada quién y quién necesita apoyo? ═══
export function EquipoView({ d, ctrl, onVerHistorial }) {
  const [dim, setDim] = useState('analista');
  const [sel, setSel] = useState(null);
  const { recsMes, rows, prevByName, totals, hasSesData, scoped, trendMonths, hasFilter } = d;

  const rankRows = useMemo(() => {
    let list;
    if (dim === 'pais') list = aggregateByPais(recsMes);
    else if (dim === 'segmento') list = aggregateBySegmento(recsMes);
    else list = rows.filter((r) => isTeamMember(r.analista)).map((r) => ({ ...r, key: r.analista }));
    return [...list].sort((a, b) => b.atendidos - a.atendidos);
  }, [dim, recsMes, rows]);

  return (
    <>
      <SemaforoLeyenda />

      <div className="chart-card">
        <div className="chart-card-hd">
          <div>
            <div className="stitle">¿Quién atendió y completó más?</div>
            <div className="ssub">Barras = volumen · el punto de color compara el SLA contra el equipo · {monthLabel(ctrl.mes)}</div>
          </div>
          <div className="chips">
            {[['analista', 'Analista'], ['pais', 'País'], ['segmento', 'Segmento']].map(([k, l]) => (
              <button key={k} className={'chip' + (dim === k ? ' active' : '')} onClick={() => setDim(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="chart-legend">
          <span className="chart-legend-item"><span className="chart-legend-key" style={{ background: 'var(--blue)' }} />Atendidos</span>
          <span className="chart-legend-item"><span className="chart-legend-key" style={{ background: 'var(--g)' }} />Completados</span>
        </div>
        <div className="chart-card-bd">
          <RankingChart rows={rankRows} teamSla={totals.slaAvg} teamCiclo={totals.cicloAvg} onSelect={dim === 'analista' ? setSel : undefined} />
        </div>
      </div>

      <div className="cards-analistas">
        {rows.map((r) => {
          const pctAt = r.asignados ? (r.atendidos / r.asignados * 100) : 0;
          const pctCo = r.asignados ? (r.completados / r.asignados * 100) : 0;
          const s = sessOf(r.analista, ctrl.mes);
          const prev = prevByName[r.analista];
          return (
            <div className="panel acard" key={r.analista} onClick={() => setSel(r.analista)} title="Clic para ver el detalle completo del analista">
              <div className="acard-hd">
                <div className="acard-av" style={{ background: colorOf(r.analista), color: inkOf(r.analista) }}>{initials(r.analista)}</div>
                <div className="acard-nm">{r.analista}</div>
              </div>
              <div className="acard-main">
                <div><div className="acard-big">{fmtInt(r.asignados)}</div><div className="acard-lbl">Solicitudes</div></div>
                <div><div className="acard-big" style={{ color: 'var(--blue)' }}>{fmtInt(r.atendidos)}</div><div className="acard-lbl">{pctAt.toFixed(0)}% atendido</div></div>
                <div><div className="acard-big" style={{ color: 'var(--g)' }}>{fmtInt(r.completados)}</div><div className="acard-lbl"><Delta curr={r.completados} prev={prev?.completados} /></div></div>
              </div>
              <div style={{ padding: '0 16px 10px' }}>
                <div className="meter">
                  <div className="meter-fill" style={{ width: `${pctAt}%` }} />
                  <div className="meter-cap" style={{ left: `${pctCo}%` }} title={`${fmtInt(r.completados)} completados`} />
                </div>
              </div>
              <div className="acard-foot">
                <span className="tag t-b" title="Días promedio hasta la 1ª sesión, comparado con el equipo"><SlaDot value={r.slaAvg} teamAvg={totals.slaAvg} />{r.slaAvg == null ? '1ª —' : `1ª ${r.slaAvg}d`}</span>
                <span className="tag t-gr" title="Días promedio hasta cerrar, comparado con el equipo"><SlaDot value={r.avgCompl} teamAvg={totals.cicloAvg} />{r.avgCompl == null ? 'Ciclo —' : `Ciclo ${r.avgCompl}d`}</span>
                <span title="Sesiones registradas en sus tickets (HubSpot)">🎥 {fmtInt(r.sesionesTotales)}</span>
              </div>
            </div>
          );
        })}
        {!rows.length && <div className="panel" style={{ gridColumn: '1/-1' }}><div className="panel-bd muted">No hay tickets para esta selección en {monthLabel(ctrl.mes)}.</div></div>}
      </div>

      <div className="panel">
        <div className="panel-bd" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div className="hint">El histórico mes a mes con las sesiones del registro Connect vive en una vista aparte.</div>
          <button className="btn" onClick={onVerHistorial}>📊 Ver histórico con sesiones →</button>
        </div>
      </div>

      {sel && (
        <AnalystDetailModal
          analista={sel} mes={ctrl.mes} scoped={scoped} recsMes={recsMes}
          trendMonths={trendMonths} teamStats={totals} hasSesData={hasSesData}
          hasFilter={hasFilter} onClose={() => setSel(null)}
        />
      )}
    </>
  );
}
