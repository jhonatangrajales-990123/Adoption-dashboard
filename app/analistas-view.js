'use client';
import { useMemo, useState } from 'react';
import { SESSIONS_META } from '@/lib/sessions-data';
import { fmtInt, median, avg1, colorOf, inkOf, initials, monthLabel, sessOf, isTeamMember, SESSION_MONTHS, enRegistroSesiones, aggregateByAnalista, teamTotals } from '@/lib/analistas-shared';

// La ventana sale del propio registro de sesiones, no escrita a mano: cuando se
// carga data nueva (julio, agosto…) la vista se extiende sola.
const MONTHS = SESSION_MONTHS;
const ALL = '__todos__';

// Sesiones: hay 3 casos distintos y antes los 3 se veían igual (un 0 o un guión).
//  · el analista no está en el registro Connect → "sin registro" (NO es que no trabajó)
//  · hay filtro de país/segmento → el registro no distingue esas dimensiones
//  · caso normal → el número
function sesTexto(r, hasFilter) {
  if (!r.enRegistro) return 'sin registro';
  if (hasFilter) return '—';
  return fmtInt(r.sesDadas);
}
function sesTitle(r, hasFilter) {
  if (!r.enRegistro) return `${r.analista} no aparece en el registro Connect. No significa que no haya dado sesiones: significa que no está en el archivo.`;
  if (hasFilter) return 'El registro Connect no distingue país ni segmento, así que no se puede filtrar.';
  return 'Sesiones dadas (registro Connect)';
}

export default function AnalistasView({ records }) {
  const [matrixMetric, setMatrixMetric] = useState('atendidos'); // atendidos | completados | sesiones
  const [selected, setSelected] = useState(null); // analista para drill-down
  const [filPais, setFilPais] = useState(ALL);
  const [filSeg, setFilSeg] = useState(ALL);

  const monthSet = useMemo(() => new Set(MONTHS), []);
  const win = useMemo(
    () => records.filter((r) => r.mes_solicitud && monthSet.has(r.mes_solicitud)),
    [records, monthSet]
  );

  const paisOpts = useMemo(() => {
    const c = {};
    win.forEach((r) => { const k = r.pais_label || 'Sin país'; c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a]);
  }, [win]);
  const segOpts = useMemo(() => {
    const c = {};
    win.forEach((r) => { const k = r.segmento || 'Sin segmento'; c[k] = (c[k] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a]);
  }, [win]);
  const hasFilter = filPais !== ALL || filSeg !== ALL;

  const winScoped = useMemo(() => win.filter((r) =>
    (filPais === ALL || r.pais_label === filPais) && (filSeg === ALL || r.segmento === filSeg)
  ), [win, filPais, filSeg]);

  // Todo el cálculo viene de lib/metrics.js (definición única). Antes esta vista
  // tenía su propia versión, que descartaba los tickets sin sesión antes de contar
  // completados — por eso no cuadraba con las otras pestañas.
  const rows = useMemo(() => {
    const porAnalista = {};
    winScoped.forEach((r) => { const a = r.analista || 'Sin asignar'; (porAnalista[a] = porAnalista[a] || []).push(r); });
    const list = aggregateByAnalista(winScoped).map((o) => {
      const mios = porAnalista[o.analista] || [];
      const porMes = {};
      MONTHS.forEach((mes) => { porMes[mes] = teamTotals(mios.filter((r) => r.mes_solicitud === mes)); });
      // Sesiones (productividad) desde el registro Connect, en la ventana
      let dadas = 0, primeras = 0, noAsistio = 0, agendadas = 0;
      MONTHS.forEach((mes) => { const s = sessOf(o.analista, mes); if (s) { dadas += s.dadas; primeras += s.primeras; noAsistio += s.noAsistio; agendadas += s.agendadas; } });
      return {
        ...o, porMes,
        // Distingue "no dio sesiones" de "no está en el registro" — antes ambos daban 0.
        enRegistro: enRegistroSesiones(o.analista),
        sesDadas: dadas, primeras, noAsistio, agendadas,
        noShow: agendadas ? (noAsistio / agendadas) * 100 : null,
      };
    });
    const isTeam = (n) => (isTeamMember(n) ? 1 : 0);
    list.sort((a, b) => (isTeam(b.analista) - isTeam(a.analista)) || (b.atendidos - a.atendidos));
    return list;
  }, [winScoped]);

  const totals = useMemo(() => teamTotals(winScoped), [winScoped]);
  const totalAsignados = totals.asignados;
  const totalAtendidos = totals.atendidos;
  const totalCompletados = totals.completados;
  const totalSlaAvg = totals.slaAvg;
  const totalCicloAvg = totals.cicloAvg;
  const maxAtendidos = Math.max(...rows.map((r) => r.atendidos), 1);

  const cellVal = (r, m) => matrixMetric === 'sesiones' ? (sessOf(r.analista, m)?.dadas || 0) : (r.porMes[m]?.[matrixMetric] || 0);
  const maxCell = Math.max(...rows.flatMap((r) => MONTHS.map((m) => cellVal(r, m))), 1);

  const sel = selected ? rows.find((r) => r.analista === selected) : null;
  // Rango real cubierto por el registro de sesiones, para no escribirlo a mano.
  const winLabel = MONTHS.length ? `${monthLabel(MONTHS[0])} – ${monthLabel(MONTHS[MONTHS.length - 1])}` : 'sin datos';

  return (
    <>
      <div className="panel">
        <div className="panel-hd">
          <div>
            <div className="stitle">Desempeño por analista · {winLabel}</div>
            <div className="ssub"><b>BOP</b> = asignados · <b>Atendido</b> = con ≥1 sesión · <b>Completado</b> = éxito · <b>SLA</b> = días de 1ª atención y de ciclo completo (sin meta aún) · <b>Productividad</b> = sesiones (Connect). Clic en un analista para ver su detalle mes a mes.</div>
          </div>
        </div>
        <div className="panel-bd filters" style={{ paddingTop: 4, paddingBottom: 4, gridTemplateColumns: 'repeat(auto-fill,minmax(160px,220px))' }}>
          <div className="fg"><label>País</label>
            <select className="inp" value={filPais} onChange={(e) => setFilPais(e.target.value)}>
              <option value={ALL}>Todos los países</option>
              {paisOpts.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="fg"><label>Segmento</label>
            <select className="inp" value={filSeg} onChange={(e) => setFilSeg(e.target.value)}>
              <option value={ALL}>Contador y Pyme</option>
              {segOpts.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {hasFilter && <button className="chip" style={{ alignSelf: 'end', height: 34 }} onClick={() => { setFilPais(ALL); setFilSeg(ALL); }}>✕ Limpiar</button>}
        </div>
        <div className="panel-bd" style={{ paddingTop: 0 }}>
          <div className="kpi-row">
            <div className="kpi"><div className="kpi-lbl">BOP · tickets asignados</div><div className="kpi-num">{fmtInt(totalAsignados)}</div><div className="kpi-sub">creados {winLabel}</div></div>
            <div className="kpi k-blue"><div className="kpi-lbl">Atendidos (con sesión)</div><div className="kpi-num">{fmtInt(totalAtendidos)}</div><div className="kpi-sub">{totalAsignados ? Math.round(totalAtendidos / totalAsignados * 100) : 0}% del BOP</div></div>
            <div className="kpi k-ok"><div className="kpi-lbl">Completados</div><div className="kpi-num">{fmtInt(totalCompletados)}</div><div className="kpi-sub">{totalAtendidos ? Math.round(totalCompletados / totalAtendidos * 100) : 0}% de atendidos · éxito</div></div>
            <div className="kpi k-warn"><div className="kpi-lbl">SLA · 1ª atención</div><div className="kpi-num">{totalSlaAvg == null ? '—' : totalSlaAvg + 'd'}</div><div className="kpi-sub">prom. · mediana {totals.slaMed == null ? '—' : totals.slaMed + 'd'} · n={fmtInt(totals.slaN)}</div></div>
            <div className="kpi k-purple"><div className="kpi-lbl">SLA · ciclo completo</div><div className="kpi-num">{totalCicloAvg == null ? '—' : totalCicloAvg + 'd'}</div><div className="kpi-sub">prom. · mediana {totals.cicloMed == null ? '—' : totals.cicloMed + 'd'} · n={fmtInt(totals.cicloN)}</div></div>
          </div>
        </div>
      </div>

      {/* Scorecards */}
      <div className="cards-analistas">
        {rows.map((r) => {
          const pctBop = r.asignados ? Math.round(r.atendidos / r.asignados * 100) : 0;
          return (
          <div className="panel acard" key={r.analista} onClick={() => setSelected(r.analista)} style={{ cursor: 'pointer' }} title="Ver el detalle mes a mes">
            <div className="acard-hd">
              <div className="acard-av" style={{ background: colorOf(r.analista), color: inkOf(r.analista) }}>{initials(r.analista)}</div>
              <div className="acard-nm">{r.analista}</div>
            </div>
            <div className="acard-main">
              <div><div className="acard-big">{fmtInt(r.asignados)}</div><div className="acard-lbl">BOP</div></div>
              <div><div className="acard-big" style={{ color: 'var(--blue)' }}>{fmtInt(r.atendidos)}</div><div className="acard-lbl">{pctBop}% BOP</div></div>
              <div><div className="acard-big" style={{ color: 'var(--g)' }}>{fmtInt(r.completados)}</div><div className="acard-lbl">{r.tasa.toFixed(0)}% éxito</div></div>
            </div>
            <div className="acard-foot">
              <span className="tag t-b" title="Promedio de días hasta la 1ª sesión">{r.slaAvg == null ? 'SLA 1ª —' : `SLA 1ª ${r.slaAvg}d`}</span>
              <span className="tag t-gr" title="Promedio de días hasta completado">{r.avgCompl == null ? 'Ciclo —' : `Ciclo ${r.avgCompl}d`}</span>
              <span title={sesTitle(r, hasFilter)}>🎥 {sesTexto(r, hasFilter)}</span>
            </div>
            <div className="acard-dc">ver mes a mes ↗</div>
          </div>
        );})}
      </div>

      {/* Tabla detallada */}
      <div className="panel">
        <div className="panel-hd"><div><div className="stitle">Tabla detallada</div><div className="ssub">Efectividad · SLA · eficiencia · productividad por analista</div></div></div>
        <div className="tbl-scroll"><table>
          <thead><tr>
            <th>Analista</th><th className="tr">Atendidos</th><th className="tr">Completados</th><th className="tr" title="Completados ÷ atendidos">% éxito</th>
            <th className="tr" title="Días promedio entre la solicitud y la 1ª sesión">SLA 1ª (días)</th><th className="tr" title="Días promedio entre la solicitud y el cierre">SLA ciclo (días)</th><th className="tr" title="Sesiones dadas · registro Connect">Sesiones</th><th className="tr" title="Reuniones agendadas a las que el cliente no llegó">No-show</th><th style={{ width: '16%' }}>Volumen atendido</th>
          </tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.analista} onClick={() => setSelected(r.analista)} style={{ cursor: 'pointer' }}>
              <td style={{ fontWeight: 700 }}>{r.analista}</td>
              <td className="tr">{fmtInt(r.atendidos)}</td>
              <td className="tr" style={{ color: 'var(--g)', fontWeight: 700 }}>{fmtInt(r.completados)}</td>
              <td className="tr">{r.tasa.toFixed(0)}%</td>
              <td className="tr" style={{ fontWeight: 700 }}>{r.slaAvg == null ? '—' : r.slaAvg + 'd'}</td>
              <td className="tr">{r.avgCompl == null ? '—' : r.avgCompl + 'd'}</td>
              <td className="tr" style={{ color: 'var(--brand)', fontWeight: 700 }} title={sesTitle(r, hasFilter)}>{sesTexto(r, hasFilter)}</td>
              <td className="tr">{r.noShow == null ? '—' : r.noShow.toFixed(0) + '%'}</td>
              <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="gbar-track" style={{ flex: 1 }}><div className="gbar-fill" style={{ width: (r.atendidos / maxAtendidos * 100) + '%', background: colorOf(r.analista) }} /></div>
                <div className="gbar-val">{fmtInt(r.atendidos)}</div>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>

      {/* Matriz mensual */}
      <div className="panel">
        <div className="panel-hd">
          <div><div className="stitle">Evolución mes a mes</div><div className="ssub">{matrixMetric === 'atendidos' ? 'Tickets atendidos' : matrixMetric === 'completados' ? 'Tickets completados' : 'Sesiones dadas'} por analista y mes · {winLabel}</div></div>
          <div className="chips">
            {[['atendidos', 'Atendidos'], ['completados', 'Completados'], ['sesiones', 'Sesiones']].map(([k, l]) => (
              <button key={k} className={'chip' + (matrixMetric === k ? ' active' : '')} onClick={() => setMatrixMetric(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="tbl-scroll"><table>
          <thead><tr>
            <th>Analista</th>
            {MONTHS.map((m) => <th key={m} className="tc">{monthLabel(m)}</th>)}
            <th className="tr">Total</th>
          </tr></thead>
          <tbody>{rows.map((r) => {
            const total = MONTHS.reduce((s, m) => s + cellVal(r, m), 0);
            return <tr key={r.analista} onClick={() => setSelected(r.analista)} style={{ cursor: 'pointer' }}>
              <td style={{ fontWeight: 700 }}>{r.analista}</td>
              {MONTHS.map((m) => {
                const v = cellVal(r, m);
                const op = v ? (0.15 + 0.85 * (v / maxCell)) : 0;
                return <td key={m} className="tc" style={{ background: v ? `color-mix(in srgb, ${colorOf(r.analista)} ${Math.round(op * 100)}%, transparent)` : 'transparent', fontWeight: v ? 700 : 400, color: v ? 'var(--t1)' : 'var(--t3)' }}>{v || '·'}</td>;
              })}
              <td className="tr" style={{ fontWeight: 800 }}>{fmtInt(total)}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div>

      {sel && <DrillDown r={sel} onClose={() => setSelected(null)} hasFilter={hasFilter} winLabel={winLabel} />}
    </>
  );
}

function DrillDown({ r, onClose, hasFilter, winLabel }) {
  const color = colorOf(r.analista);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="acard-av" style={{ background: color, color: inkOf(r.analista) }}>{initials(r.analista)}</div>
          <div>
            <div className="stitle">{r.analista}</div>
            <div className="ssub">Detalle mes a mes · {winLabel}</div>
          </div>
          <button className="modal-x" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 18 }}>
          <div className="kpi-row" style={{ marginBottom: 16 }}>
            <div className="kpi"><div className="kpi-lbl">BOP (asignados)</div><div className="kpi-num">{fmtInt(r.asignados)}</div></div>
            <div className="kpi k-blue"><div className="kpi-lbl">Atendidos (con sesión)</div><div className="kpi-num">{fmtInt(r.atendidos)}</div><div className="kpi-sub">{r.asignados ? Math.round(r.atendidos / r.asignados * 100) : 0}% del BOP</div></div>
            <div className="kpi k-ok"><div className="kpi-lbl">Completados</div><div className="kpi-num">{fmtInt(r.completados)}</div><div className="kpi-sub">{r.tasa.toFixed(0)}% éxito</div></div>
            <div className="kpi k-warn"><div className="kpi-lbl">SLA · 1ª atención</div><div className="kpi-num" style={{ fontSize: 22 }}>{r.slaAvg == null ? '—' : r.slaAvg + 'd'}</div><div className="kpi-sub">mediana {r.slaMed == null ? '—' : r.slaMed + 'd'}</div></div>
            <div className="kpi k-purple"><div className="kpi-lbl">SLA · ciclo completo</div><div className="kpi-num" style={{ fontSize: 22 }}>{r.avgCompl == null ? '—' : r.avgCompl + 'd'}</div><div className="kpi-sub">mediana {r.medCompl == null ? '—' : r.medCompl + 'd'} · no-show {r.noShow == null ? '—' : r.noShow.toFixed(0) + '%'}</div></div>
          </div>
          <div className="tbl-scroll"><table>
            <thead><tr>
              <th>Mes</th><th className="tr">BOP</th><th className="tr">Atendidos</th><th className="tr">Completados</th><th className="tr">% éxito</th>
              <th className="tr">SLA 1ª</th><th className="tr">SLA ciclo</th><th className="tr">Sesiones</th><th className="tr">No-show</th>
            </tr></thead>
            <tbody>{MONTHS.map((m) => {
              const t = r.porMes[m] || { asignados: 0, atendidos: 0, completados: 0, no_completados: 0, slaAvg: null, cicloAvg: null };
              const s = sessOf(r.analista, m);
              const tasa = t.atendidos ? (t.completados / t.atendidos * 100) : 0;
              return <tr key={m}>
                <td style={{ fontWeight: 700 }}>{monthLabel(m)}</td>
                <td className="tr" style={{ color: 'var(--t3)' }}>{fmtInt(t.asignados)}</td>
                <td className="tr">{fmtInt(t.atendidos)}</td>
                <td className="tr" style={{ color: 'var(--g)' }}>{fmtInt(t.completados)}</td>
                <td className="tr">{t.atendidos ? tasa.toFixed(0) + '%' : '—'}</td>
                <td className="tr">{t.slaAvg == null ? '—' : t.slaAvg + 'd'}</td>
                <td className="tr">{t.cicloAvg == null ? '—' : t.cicloAvg + 'd'}</td>
                <td className="tr" style={{ color: 'var(--brand)', fontWeight: 700 }}>{hasFilter ? '—' : (s ? fmtInt(s.dadas) : '·')}</td>
                <td className="tr" style={{ color: 'var(--a)' }}>{hasFilter ? '—' : (s ? fmtInt(s.noAsistio) : '·')}</td>
              </tr>;
            })}</tbody>
          </table></div>
          <div className="acard-dc" style={{ textAlign: 'left', paddingTop: 10 }}>Sesiones: {SESSIONS_META.fuente}, datos hasta {monthLabel(SESSIONS_META.hasta)}. Desde septiembre viven en HubSpot.</div>
        </div>
      </div>
    </div>
  );
}
