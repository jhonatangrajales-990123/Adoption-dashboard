'use client';
// ─────────────────────────────────────────────────────────────────────────────
// VISTA · ACTIVACIÓN (lectura SaaS del onboarding)
//
// La pregunta que responde: ¿qué tan rápido y qué tan completo activamos a un
// cliente nuevo, y dónde se nos cae?
//
// Regla que gobierna este archivo: NINGUNA métrica se muestra sin decir de qué
// dato sale. Varias de las métricas SaaS clásicas no se pueden calcular con lo
// que hay en el pipeline de Adoption, y hay dos formas de resolverlo: inventar
// un número que se vea bien, o mostrar el sustituto honesto y nombrarlo como
// tal. Acá se hace lo segundo, y cada tarjeta lleva su nota de origen.
//
// Concretamente:
//  · TTFV       → el reloj arranca en la solicitud de migración, NO en la firma
//                 del contrato: esa fecha no vive en este pipeline.
//  · Completion → sí es calculable tal cual, con guarda de madurez de cohorte.
//  · Churn      → NO es calculable acá. El churn está en Metabase y la app no
//                 puede consultarlo (Metabase solo se abre por MCP, desde el
//                 chat). Se muestra el precursor operativo y se dice que lo es.
//  · Horas ahorradas por automatización → no hay línea base con qué comparar.
//                 Se deja el espacio marcado en vez de rellenarlo con un número
//                 inventado.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { fmtInt, monthLabel, teamTotals, currentYM } from '@/lib/analistas-shared';
import { mesDe, MES_MINIMO } from '@/lib/metrics';
import {
  ttfv, completionRate, embudoActivacion, capacidad, riesgoTemprano,
  coberturaMrr, cohorteMadura, RIESGO_UMBRALES,
} from '@/lib/activacion';

const HS = (id) => `https://app.hubspot.com/contacts/6180490/record/2-40542822/${id}`;
const VENTANAS = [30, 60, 90];

// ─── Tarjeta grande con su procedencia siempre visible ───────────────────────
function KpiSaaS({ tono = '', label, valor, sub, origen, alerta }) {
  return (
    <div className={'saas-card ' + tono}>
      <div className="saas-lbl">{label}</div>
      <div className="saas-val">{valor}</div>
      {sub && <div className="saas-sub">{sub}</div>}
      {alerta && <div className="saas-alerta">{alerta}</div>}
      <div className="saas-origen">{origen}</div>
    </div>
  );
}

// ─── Embudo por pasos, con el cuello de botella señalado ─────────────────────
function EmbudoActivacion({ pasos, titulo, sub }) {
  const base = pasos[0]?.n || 0;
  if (!base) return null;
  // El cuello es el paso con la caída porcentual más grande respecto al anterior
  const peor = pasos.reduce((acc, p) => (p.pctPaso != null && (acc == null || p.pctPaso < acc.pctPaso) ? p : acc), null);

  return (
    <div className="panel">
      <div className="panel-hd"><div><div className="stitle">{titulo}</div><div className="ssub">{sub}</div></div></div>
      <div className="panel-bd">
        <div className="emb">
          {pasos.map((p, i) => {
            const esCuello = peor && p.key === peor.key;
            return (
              <div key={p.key} className="emb-paso">
                <div className="emb-cab">
                  <div className="emb-nom">
                    <span className="emb-idx">{i + 1}</span>{p.label}
                    {esCuello && <span className="emb-cuello">cuello de botella</span>}
                  </div>
                  <div className="emb-cifras">
                    <b>{fmtInt(p.n)}</b>
                    <span className="emb-pctbase">{Math.round(p.pctBase)}% de la base</span>
                  </div>
                </div>
                <div className="emb-track">
                  <div className={'emb-fill' + (esCuello ? ' emb-fill-cuello' : '')} style={{ width: `${p.pctBase}%` }} />
                </div>
                <div className="emb-desc">{p.desc}</div>
                {p.pctPaso != null && (
                  <div className={'emb-conv' + (esCuello ? ' emb-conv-cuello' : '')}>
                    ↳ Del paso anterior pasa el <b>{Math.round(p.pctPaso)}%</b>
                    {p.caida > 0 && <> · se quedan <b>{fmtInt(p.caida)}</b> en el camino</>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export function ActivacionView({ d, ctrl, onNavigate }) {
  const { scoped } = d;
  const lente = ctrl.lente;
  const [ventana, setVentana] = useState(30);

  const meses = useMemo(() => {
    const s = new Set(scoped.map((r) => mesDe(r, lente)).filter((m) => m && m >= MES_MINIMO));
    return [...s].sort();
  }, [scoped, lente]);

  const recsMes = useMemo(() => scoped.filter((r) => mesDe(r, lente) === ctrl.mes), [scoped, ctrl.mes, lente]);

  // Las cohortes maduras son la referencia estable: el "así estamos" no debe
  // moverse por un mes que apenas empieza.
  const recsMaduros = useMemo(
    () => scoped.filter((r) => { const m = mesDe(r, lente); return m >= MES_MINIMO && cohorteMadura(m, ventana); }),
    [scoped, lente, ventana]
  );

  const tf = useMemo(() => ttfv(recsMaduros), [recsMaduros]);
  const cr = useMemo(() => completionRate(recsMaduros, ventana), [recsMaduros, ventana]);
  const riesgo = useMemo(() => riesgoTemprano(scoped), [scoped]);
  const cap = useMemo(() => capacidad(recsMes), [recsMes]);
  const cob = useMemo(() => coberturaMrr(riesgo.lista), [riesgo.lista]);

  const embudoTotal = useMemo(() => embudoActivacion(recsMaduros), [recsMaduros]);
  const embudoMes = useMemo(() => embudoActivacion(recsMes), [recsMes]);

  // Tabla de cohortes: una fila por mes, una columna por ventana.
  const cohortes = useMemo(() => meses.map((m) => {
    const recs = scoped.filter((r) => mesDe(r, lente) === m);
    const t = teamTotals(recs);
    return {
      mes: m, label: monthLabel(m), base: recs.length,
      ttfv: ttfv(recs).med,
      exito: Math.round(t.tasa),
      ventanas: VENTANAS.map((v) => ({ v, madura: cohorteMadura(m, v), ...completionRate(recs, v) })),
    };
  }), [meses, scoped, lente]);

  const mesesMaduros = meses.filter((m) => cohorteMadura(m, ventana));
  const mesEnCurso = ctrl.mes === currentYM();
  const diaDelMes = new Date().getDate();

  return (
    <>
      <div className="titular">
        <div className="titular-mes">Activación de clientes nuevos</div>
        <p>
          Sobre las <b>{fmtInt(cr.base)}</b> solicitudes de cohortes ya maduras
          {mesesMaduros.length > 0 && <> ({monthLabel(mesesMaduros[0]).replace(' 2026', '')}–{monthLabel(mesesMaduros[mesesMaduros.length - 1])})</>}:
          {' '}el cliente espera una <b>mediana de {tf.med == null ? '—' : tf.med} día{tf.med === 1 ? '' : 's'}</b> hasta su primera sesión,
          {' '}y el <b>{cr.pct == null ? '—' : Math.round(cr.pct)}%</b> queda completamente activado dentro de {ventana} días.
          {riesgo.enRiesgo > 0 && (
            <> Hoy hay <b className="txt-bad">{fmtInt(riesgo.enRiesgo)} cuentas abiertas sin una sola sesión</b> con más de {RIESGO_UMBRALES.alto} días encima.</>
          )}
        </p>
      </div>

      {/* ── A · RESUMEN EJECUTIVO DE IMPACTO ────────────────────────────────── */}
      <div className="seccion-t">A · Resumen ejecutivo de impacto</div>
      <div className="seccion-sub">
        Ventana de activación:
        <span className="chips" style={{ display: 'inline-flex', marginLeft: 8, verticalAlign: 'middle' }}>
          {VENTANAS.map((v) => (
            <button key={v} className={'chip' + (ventana === v ? ' active' : '')} onClick={() => setVentana(v)}>{v} días</button>
          ))}
        </span>
      </div>

      <div className="saas-row">
        <KpiSaaS
          tono="k-blue"
          label="Time to First Value"
          valor={tf.med == null ? '—' : `${tf.med}d`}
          sub={`mediana · promedio ${tf.avg == null ? '—' : tf.avg + 'd'} · n=${fmtInt(tf.n)}`}
          origen="Días entre la solicitud de migración y la primera sesión efectiva."
          alerta="⚠️ El reloj arranca en la solicitud, no en la firma del contrato: esa fecha no está en el pipeline. Y el «valor» que medimos es la sesión, no el primer evento de valor dentro del producto."
        />
        <KpiSaaS
          tono="k-ok"
          label={`Onboarding completion (${ventana}d)`}
          valor={cr.pct == null ? '—' : `${Math.round(cr.pct)}%`}
          sub={`${fmtInt(cr.dentro)} de ${fmtInt(cr.base)} solicitudes cerraron completadas dentro de ${ventana} días`}
          origen="Denominador = todas las solicitudes de la cohorte, no solo las cerradas. Si fueran solo las cerradas, el indicador subiría con solo dejar tickets abiertos."
          alerta={cr.enVuelo > 0 ? `⏳ ${fmtInt(cr.enVuelo)} todavía están dentro del plazo y no cuentan como fallo.` : null}
        />
        <KpiSaaS
          tono="k-warn"
          label="Riesgo de abandono temprano"
          valor={`${Math.round(riesgo.pct)}%`}
          sub={`${fmtInt(riesgo.enRiesgo)} de ${fmtInt(riesgo.abiertos)} cuentas abiertas · $${fmtInt(Math.round(riesgo.mrr))} MRR expuesto`}
          origen={`Cuentas abiertas que nunca recibieron una sesión y llevan más de ${RIESGO_UMBRALES.alto} días esperando.`}
          alerta="⚠️ Esto NO es churn confirmado, es su precursor operativo. El churn real vive en Metabase y esta app no lo puede consultar: el único acceso vigente a Metabase es por MCP, desde el chat."
        />
        <KpiSaaS
          label="Capacidad por especialista"
          valor={cap.promedio == null ? '—' : String(cap.promedio)}
          sub={`cuentas por analista en ${monthLabel(ctrl.mes)} · ${cap.analistas} analistas activos · mediana ${cap.mediana ?? '—'}`}
          origen="Tickets del mes ÷ analistas con al menos un ticket ese mes."
          alerta={
            // El mes en curso va a medio llenar, así que la carga sale baja por
            // el calendario, no por el equipo. Decirlo importa: es el número
            // que alguien podría citar como "bajamos la carga".
            mesEnCurso
              ? `⏳ ${monthLabel(ctrl.mes)} lleva ${diaDelMes} día${diaDelMes === 1 ? '' : 's'} de 30: la cifra va a seguir subiendo hasta fin de mes. Para comparar, mueve el mes de arriba a uno cerrado.`
              : cap.max && cap.min != null && cap.max > cap.min * 3
                ? `⚠️ Reparto muy desigual: entre ${fmtInt(cap.min)} y ${fmtInt(cap.max)} cuentas. El promedio esconde eso.`
                : null}
        />
      </div>

      {/* El hueco que no se rellena con humo */}
      <div className="hueco-card">
        <div className="hueco-t">🚧 Horas ahorradas por automatización — todavía no medible</div>
        <p>
          Para decir «la automatización nos ahorra X horas en la fase Y» hace falta una <b>línea base</b>:
          cuánto tardaba esa fase <i>antes</i> de automatizarla. Hoy no existe ese registro, así que cualquier
          cifra sería inventada y no aguantaría una pregunta del CRO.
        </p>
        <p>
          Lo que sí es evidencia real de que el proceso mejoró está en <b>Desempeño</b>: los días a la primera
          sesión y las cuentas por analista, mes a mes. Si quieres el número de horas, el camino es marcar la
          fecha en que entró cada automatización y comparar los meses de antes contra los de después — se puede
          montar en cuanto tengamos esas fechas.
        </p>
        <button className="btn" onClick={() => onNavigate && onNavigate('desempeno')}>📈 Ver la evidencia de mejora →</button>
      </div>

      {/* ── B · EMBUDO Y VELOCIDAD ──────────────────────────────────────────── */}
      <div className="seccion-t">B · Embudo y velocidad de activación</div>
      <div className="seccion-sub">
        Las cuatro fases se reconstruyen con el contador de sesiones de cada ticket.
        HubSpot solo tiene cuatro etapas de pipeline (Nuevo, En proceso, Completada, No completada) y ninguna
        corresponde a una fase de onboarding, así que la etapa por sí sola no serviría para esto.
      </div>

      <EmbudoActivacion
        pasos={embudoTotal}
        titulo={`Embudo de cohortes maduras · ${fmtInt(embudoTotal[0]?.n || 0)} cuentas`}
        sub="Los pasos son acumulativos: quien llegó al final cuenta también en los anteriores, para que el embudo no pueda ensancharse hacia abajo por un hueco de registro."
      />

      <EmbudoActivacion
        pasos={embudoMes}
        titulo={`Embudo de ${monthLabel(ctrl.mes)} · ${fmtInt(embudoMes[0]?.n || 0)} cuentas`}
        sub="El mismo embudo para el mes que tengas seleccionado arriba. Si es un mes reciente, los pasos finales todavía se van a llenar."
      />

      {/* ── Tabla de cohortes ───────────────────────────────────────────────── */}
      <div className="panel">
        <div className="panel-hd">
          <div>
            <div className="stitle">Activación por cohorte de entrada</div>
            <div className="ssub">
              Cada fila es el grupo que entró ese mes. Se lee en horizontal: de los que llegaron en enero,
              cuántos estaban activados a los 30, 60 y 90 días.
            </div>
          </div>
        </div>
        <div className="panel-bd">
          <div className="tbl-scroll"><table>
            <thead>
              <tr>
                <th>Cohorte</th>
                <th className="tr">Solicitudes</th>
                <th className="tr">TTFV<br /><span className="th-sub">mediana</span></th>
                {VENTANAS.map((v) => <th key={v} className="tr">Activadas<br /><span className="th-sub">≤ {v} días</span></th>)}
                <th className="tr">Éxito<br /><span className="th-sub">completadas ÷ atendidas</span></th>
              </tr>
            </thead>
            <tbody>
              {cohortes.map((c) => (
                <tr key={c.mes}>
                  <td style={{ fontWeight: 700 }}>{c.label}</td>
                  <td className="tr">{fmtInt(c.base)}</td>
                  <td className="tr">{c.ttfv == null ? '—' : c.ttfv + 'd'}</td>
                  {c.ventanas.map((w) => (
                    <td key={w.v} className="tr">
                      {!w.madura ? (
                        <span className="celda-inmadura" title={`La cohorte de ${c.label} todavía no cumple ${w.v} días completos. Lo que se vea aquí sería solo los casos rápidos.`}>
                          ⏳ en curso
                        </span>
                      ) : (
                        <>
                          <b>{w.pct == null ? '—' : Math.round(w.pct) + '%'}</b>
                          <div className="celda-meta">{fmtInt(w.dentro)} de {fmtInt(w.base)}</div>
                        </>
                      )}
                    </td>
                  ))}
                  <td className="tr">{c.exito}%</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>

      {/* ── Lista accionable del riesgo ─────────────────────────────────────── */}
      <div className="panel">
        <div className="panel-hd">
          <div>
            <div className="stitle">Cuentas en riesgo, por MRR expuesto</div>
            <div className="ssub">
              Abiertas, sin una sola sesión, con más de {RIESGO_UMBRALES.alto} días encima. Ordenadas por lo que pagan al mes: son las que hay que desatorar primero.
            </div>
          </div>
          <span className="pill">{fmtInt(riesgo.enRiesgo)} cuentas</span>
        </div>
        <div className="panel-bd">
          {cob.pct != null && cob.pct < 90 && (
            <div className="explorer-nota nota-warn">
              ⚠️ Solo {fmtInt(cob.con)} de {fmtInt(cob.n)} de estas cuentas ({Math.round(cob.pct)}%) traen MRR en HubSpot.
              {' '}El «MRR expuesto» de arriba es un <b>piso</b>: el real es mayor.
            </div>
          )}
          {riesgo.lista.length === 0 ? (
            <div className="muted">Ninguna cuenta abierta lleva más de {RIESGO_UMBRALES.alto} días sin sesión. 👏</div>
          ) : (
            <div className="tbl-scroll" style={{ maxHeight: 420 }}><table>
              <thead><tr>
                <th>Cliente</th><th>País</th><th>Segmento</th><th>Analista</th>
                <th className="tr">Días esperando</th><th className="tr">MRR</th><th />
              </tr></thead>
              <tbody>
                {riesgo.lista.slice(0, 60).map((r) => (
                  <tr key={r.id}>
                    <td>{r.cliente || <span className="muted">sin nombre</span>}</td>
                    <td>{r.pais_label || '—'}</td>
                    <td>{r.segmento || '—'}</td>
                    <td>{r.analista || <span className="muted">sin asignar</span>}</td>
                    <td className="tr">
                      <span className={r.edad > RIESGO_UMBRALES.critico ? 'txt-bad' : ''} style={{ fontWeight: 700 }}>{r.edad}d</span>
                    </td>
                    <td className="tr">{r.mrr == null ? <span className="muted">sin dato</span> : '$' + fmtInt(r.mrr)}</td>
                    <td className="tr"><a className="chip" href={HS(r.id)} target="_blank" rel="noreferrer">HubSpot ↗</a></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          {riesgo.lista.length > 60 && (
            <div className="hint">Se muestran las 60 de mayor MRR de {fmtInt(riesgo.lista.length)}. El resto está en el Explorador.</div>
          )}
        </div>
      </div>
    </>
  );
}
