'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Gráficas de evolución del Resumen. Una por tema, no una sola con todo mezclado:
//   1. Volumen        — solicitudes, atendidos, completados, no completados, abiertos
//   2. Efectividad    — % atendido, tasa de éxito, no-show
//   3. Tiempos        — días a la 1ª sesión, días hasta cerrar
//   4. Satisfacción   — CSAT
//   5. Dinero         — MRR
//
// Cada una trae sus propios filtros de versión (país) y Contador/Pyme. Arrancan
// heredados del filtro principal de arriba y se resincronizan cuando ese cambia;
// después se pueden mover aparte para comparar sin tocar el resto del tablero.
//
// Regla: nunca se mezclan dos unidades en un mismo eje. Por eso los grupos están
// armados por unidad (tickets / % / días / nota / dinero).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtInt, monthLabel, teamTotals, colorOf, currentYM } from '@/lib/analistas-shared';
import { mesDe, esAtendido, esCompletado, MES_MINIMO } from '@/lib/metrics';

const ALL = '__todos__';

const UNIDADES = {
  conteo: { fmt: (v) => fmtInt(v) },
  pct: { fmt: (v) => Math.round(v) + '%' },
  dias: { fmt: (v) => (v == null ? '—' : v + 'd') },
  dinero: { fmt: (v) => '$' + fmtInt(v) },
  nota: { fmt: (v) => (v == null ? '—' : String(v)) },
};

const M = {
  asignados: { label: 'Solicitudes', unidad: 'conteo', color: 'var(--chart-muted)', get: (t) => t.asignados },
  atendidos: { label: 'Atendidos', unidad: 'conteo', color: 'var(--blue)', get: (t) => t.atendidos },
  completados: { label: 'Completados', unidad: 'conteo', color: 'var(--g)', get: (t) => t.completados },
  no_completados: { label: 'No completados', unidad: 'conteo', color: 'var(--r)', get: (t) => t.no_completados },
  abiertos: { label: 'Siguen en proceso', unidad: 'conteo', color: 'var(--a)', get: (t) => t.abiertos },
  // Los 4 de abajo son % sobre la MISMA base (las solicitudes del mes), por eso
  // se pueden comparar entre sí y leerse como un embudo.
  // Cada porcentaje declara SU base y cuántos casos la cumplen. Sin eso, una caída
  // del % se lee como "lo hicimos peor" cuando muchas veces es que entró más
  // trabajo: de jun a jul la base subió 43% y los atendidos quedaron planos.
  pctAtendidos: {
    label: 'Llegaron a 1ª sesión', unidad: 'pct', color: 'var(--blue)',
    get: (t) => (t.asignados ? t.pctAtendidos : null),
    meta: (t) => ({ n: t.atendidos, base: t.asignados, baseTxt: 'solicitudes' }),
  },
  pctCompletados: {
    label: 'Llegaron al final (completados)', unidad: 'pct', color: 'var(--g)',
    get: (t) => (t.asignados ? t.pctCompletados : null),
    meta: (t) => ({ n: t.completados, base: t.asignados, baseTxt: 'solicitudes' }),
  },
  pctNoCompletados: {
    label: 'Se cayeron (no completados)', unidad: 'pct', color: 'var(--r)',
    get: (t) => (t.asignados ? t.pctNoCompletados : null),
    meta: (t) => ({ n: t.no_completados, base: t.asignados, baseTxt: 'solicitudes' }),
  },
  // Conversión de un paso al siguiente, NO sobre la base de solicitudes. Van en su
  // propia gráfica y con el denominador escrito en el nombre.
  tasa: {
    label: 'De los atendidos, cuántos completaron', unidad: 'pct', color: 'var(--g)',
    get: (t) => (t.atendidos ? t.tasa : null),
    meta: (t) => ({ n: t.completados, base: t.atendidos, baseTxt: 'atendidos' }),
  },
  noShowPct: {
    label: 'No-show sobre sesiones con resultado', unidad: 'pct', color: 'var(--r)',
    get: (t) => t.noShowPct,
    meta: (t) => ({ n: t.noShow, base: t.conResultadoSesion, baseTxt: 'con resultado' }),
  },
  slaAvg: { label: 'Días a la 1ª sesión', unidad: 'dias', color: 'var(--a)', get: (t) => t.slaAvg },
  cicloAvg: { label: 'Días hasta cerrar', unidad: 'dias', color: 'var(--purple)', get: (t) => t.cicloAvg },
  csatAvg: { label: 'CSAT', unidad: 'nota', color: 'var(--g)', get: (t) => t.csatAvg },
  mrrTotal: {
    label: 'MRR', unidad: 'dinero', color: 'var(--brand)', get: (t) => t.mrrTotal,
    // Un total de MRR sin saber cuántos tickets hay detrás no dice nada: $3.462
    // pueden ser 5 clientes grandes o 40 chicos. Se guarda el contexto para
    // mostrarlo en el tooltip y en la tabla.
    meta: (t) => ({ tickets: t.asignados, conDato: t.mrrN, prom: t.mrrN ? Math.round(t.mrrTotal / t.mrrN) : null }),
  },
};

// Los 5 temas del Resumen
export const GRUPOS = [
  {
    id: 'volumen', titulo: '¿Cuánto llega y en qué termina?',
    subtitulo: 'De las solicitudes del mes: a cuántas les dimos sesión, cuántas cerraron bien, cuántas no, y cuántas siguen en proceso.',
    metricas: ['asignados', 'atendidos', 'completados', 'no_completados', 'abiertos'],
  },
  {
    id: 'efectividad', titulo: '¿Cuántas llegan al final del embudo?',
    subtitulo: 'Todo sobre la misma base: de cada 100 solicitudes del mes, cuántas recibieron primera sesión, cuántas terminaron completadas y cuántas se cayeron. Pasa el mouse para ver el tamaño de la base — un % que baja muchas veces es que entró más trabajo, no que se hiciera peor.',
    metricas: ['pctAtendidos', 'pctCompletados', 'pctNoCompletados'],
  },
  // Antes estas dos iban juntas bajo "¿Qué tan bien convertimos en cada paso?"
  // y no se entendía qué medían. El título prometía pasos consecutivos de un
  // embudo, pero no lo son: se calculan sobre denominadores distintos, no
  // encadenan, y encima van en direcciones opuestas (la verde sube = bien, la
  // roja sube = mal). Dos preguntas distintas necesitan dos gráficas.
  {
    id: 'exito', titulo: 'De los clientes que sí atendimos, ¿cuántos terminan la migración?',
    subtitulo: 'Completadas ÷ atendidas. OJO al denominador: NO son las solicitudes del mes, son solo las que alcanzaron a recibir su primera sesión. Mide qué tan bien cerramos lo que empezamos. ↑ Subir es mejor.',
    metricas: ['tasa'],
  },
  {
    id: 'noshow', titulo: '¿Cuántas sesiones agendadas se caen?',
    subtitulo: 'Sesiones a las que el cliente no llegó ÷ sesiones con resultado anotado en HubSpot. No entra aquí la sesión sin resultado registrado, porque no sabríamos si ocurrió. ↓ Bajar es mejor.',
    metricas: ['noShowPct'],
  },
  {
    id: 'tiempos', titulo: '¿Cuánto nos tardamos?',
    subtitulo: 'Días promedio. Todavía no hay una meta de SLA definida, así que se reporta el número, no un cumplimiento.',
    metricas: ['slaAvg', 'cicloAvg'],
  },
  {
    id: 'csat', titulo: '¿Qué tan contentos quedan?',
    subtitulo: 'Nota promedio de satisfacción. Ojo: muy pocos tickets tienen CSAT, así que el promedio se mueve mucho con pocas respuestas.',
    metricas: ['csatAvg'],
  },
  {
    id: 'mrr', titulo: '¿Cuánto ingreso hay detrás?',
    subtitulo: 'Suma del MRR de los tickets del mes. Solo cuentan los que tienen el dato en HubSpot.',
    metricas: ['mrrTotal'],
  },
];

// Por qué se puede dividir. "Versión" es como Alegra llama al país (version_sync).
export const DIVISIONES = {
  ninguna: { label: 'Sin dividir', campo: null },
  pais_label: { label: 'Versión (país)', campo: 'pais_label' },
  segmento: { label: 'Contador / Pyme', campo: 'segmento' },
  analista: { label: 'Analista', campo: 'analista' },
  stage: { label: 'Etapa', campo: 'stage' },
  tipo: { label: 'Tipo de migración', campo: 'tipo' },
  fuente: { label: 'Fuente de migración', campo: 'fuente' },
};

// Universo sobre el que se cuenta (para responder "el MRR de lo atendido")
export const BASES = {
  todas: { label: 'Todas las solicitudes', filtro: null },
  atendidas: { label: 'Solo las atendidas', filtro: esAtendido },
  completadas: { label: 'Solo las completadas', filtro: esCompletado },
};

const PALETA = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];

function niceMax(raw) {
  const v = Math.max(raw, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const c of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) { if (c * mag >= v) return c * mag; }
  return 10 * mag;
}

// El contexto que va debajo de cada número en el tooltip y en la tabla.
// Para un porcentaje: cuántos casos de qué base (así se ve si el % bajó porque
// se hizo peor o porque entró más trabajo). Para el MRR: cuántos tickets y
// cuánto vale cada uno.
function MetaTxt({ m }) {
  if (!m) return null;
  if (m.base != null) return <>{fmtInt(m.n)} de {fmtInt(m.base)} {m.baseTxt}</>;
  return (
    <>
      {fmtInt(m.tickets)} ticket{m.tickets === 1 ? '' : 's'}
      {m.conDato < m.tickets && <> · {fmtInt(m.conDato)} con MRR</>}
      {m.prom != null && <> · ${fmtInt(m.prom)} c/u</>}
    </>
  );
}

// ─── Gráfica de líneas: un solo eje, una sola unidad ───
// `ancho` NO es el ancho en pantalla: el SVG siempre ocupa el 100% de su
// contenedor. Es el ancho del LIENZO interno, y por eso decide el tamaño con el
// que se ve la letra. Un lienzo de 900 metido en una columna de 660px se
// encoge a 0,73 y la fuente de 9,5px acaba en 7px, ilegible. Para una gráfica
// que va en media pantalla hay que pedir un lienzo más angosto, no una fuente
// más grande — así el mismo componente se lee igual de bien en los dos tamaños.
export function MultiLineChart({ months, series, unidad, alto = 230, totalMes = null, ancho = 900 }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const U = UNIDADES[unidad] || UNIDADES.conteo;

  const W = ancho, H = alto, padL = 56, padR = 54, padT = 14, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = months.length;
  const xFor = (i) => (n > 1 ? padL + (i / (n - 1)) * plotW : padL + plotW / 2);
  const todos = series.flatMap((s) => s.vals.filter((v) => v != null));
  const maxY = niceMax(Math.max(...todos, 0) * 1.12);
  const yFor = (v) => padT + plotH - (v / maxY) * plotH;
  const baseline = padT + plotH;

  // Los tramos sin dato se cortan, en vez de dibujar una recta que nunca existió
  const paths = series.map((s) => {
    let d = '', abierto = false, ultimo = null;
    s.vals.forEach((v, i) => {
      if (v == null) { abierto = false; return; }
      d += (abierto ? 'L' : 'M') + xFor(i).toFixed(1) + ',' + yFor(v).toFixed(1) + ' ';
      abierto = true; ultimo = { x: xFor(i), y: yFor(v), v };
    });
    return { ...s, d, ultimo };
  });

  // Etiquetas del último punto. Tres cuidados: no repetir el mismo valor varias
  // veces (con 4 líneas en 0% salían cuatro "0%" apilados), no pisarse entre sí,
  // y no salirse del área del gráfico.
  const vistos = new Set();
  const etiquetas = paths.filter((s) => s.ultimo)
    .map((s) => ({ key: s.key, ...s.ultimo }))
    .filter((e) => { const k = U.fmt(e.v); if (vistos.has(k)) return false; vistos.add(k); return true; })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < etiquetas.length; i++) {
    const min = etiquetas[i - 1].y + 12;
    if (etiquetas[i].y < min) etiquetas[i].y = min;
  }
  // Si el apilado se pasó del piso, se empuja todo hacia arriba
  const exceso = etiquetas.length ? etiquetas[etiquetas.length - 1].y - baseline : 0;
  if (exceso > 0) etiquetas.forEach((e) => { e.y = Math.max(padT + 4, e.y - exceso); });

  const ticks = [0, 0.5, 1].map((f) => ({ y: padT + plotH * (1 - f), v: maxY * f }));
  const paso = Math.max(1, Math.ceil(n / 12));
  const pocas = series.length <= 5;

  function move(e) {
    const r = ref.current.getBoundingClientRect();
    const svgX = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((svgX - padL) / plotW) * (n - 1)))));
  }

  if (!n) return <div className="hint" style={{ padding: 20 }}>No hay meses con datos para esta selección.</div>;
  if (!series.length) return <div className="hint" style={{ padding: 20 }}>Todas las líneas están apagadas. Vuelve a prender alguna en la leyenda.</div>;

  const tt = hover != null ? {
    x: xFor(hover),
    filas: series.map((s) => ({ label: s.label, color: s.color, v: s.vals[hover], meta: s.meta ? s.meta[hover] : null }))
      .filter((f) => f.v != null).sort((a, b) => b.v - a.v).slice(0, 10),
    // El total del mes NO es la suma de las líneas cuando la métrica es un
    // porcentaje o un promedio (sumar tres "% de éxito" no significa nada).
    // Por eso viene calculado sobre el mes completo, sin dividir.
    total: totalMes ? totalMes.vals[hover] : null,
    totalMeta: totalMes && totalMes.meta ? totalMes.meta[hover] : null,
  } : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={ref} className="chart-svg" viewBox={'0 0 ' + W + ' ' + H} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="var(--chart-grid)" strokeWidth="1" />
            <text x={padL - 8} y={t.y + 3} textAnchor="end" fontSize="9.5" fill="var(--chart-muted)">{U.fmt(t.v)}</text>
          </g>
        ))}
        <line x1={padL} y1={baseline} x2={W - padR} y2={baseline} stroke="var(--chart-axis)" strokeWidth="1" />
        {months.map((m, i) => ((i % paso === 0 || i === n - 1) ? (
          <text key={m} x={xFor(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="var(--chart-muted)">{monthLabel(m)}</text>
        ) : null))}
        {hover != null && <line x1={xFor(hover)} y1={padT} x2={xFor(hover)} y2={baseline} stroke="var(--chart-axis)" strokeWidth="1" />}
        {paths.map((s) => <path key={s.key} d={s.d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
        {/* Con pocas líneas se etiqueta el último valor; con muchas sería una maraña */}
        {pocas && etiquetas.map((e) => (
          <text key={e.key} x={e.x + 7} y={e.y + 3.5} fontSize="11" fontWeight="700" fill="var(--t1)">{U.fmt(e.v)}</text>
        ))}
        {hover != null && series.map((s) => (s.vals[hover] != null ? (
          <circle key={s.key} cx={xFor(hover)} cy={yFor(s.vals[hover])} r="3.5" fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />
        ) : null))}
      </svg>
      {tt && tt.filas.length > 0 && (
        <div className="chart-tt" style={{
          left: Math.min(88, Math.max(2, (tt.x / W) * 100)) + '%',
          top: '4%',
          transform: 'translate(' + (tt.x / W > 0.6 ? '-100%' : '0%') + ', 0)',
        }}>
          <div className="chart-tt-title">{monthLabel(months[hover])}</div>
          {tt.total != null && tt.filas.length > 1 && (
            <div className="chart-tt-total">
              <span>Total del mes</span>
              <span>{U.fmt(tt.total)}</span>
            </div>
          )}
          {tt.totalMeta && tt.filas.length > 1 && (
            <div className="chart-tt-meta" style={{ marginBottom: 6 }}><MetaTxt m={tt.totalMeta} /></div>
          )}
          {tt.filas.map((f) => (
            <div key={f.label}>
              <div className="chart-tt-row">
                <span className="chart-tt-key"><span className="chart-tt-line" style={{ background: f.color }} />{f.label}</span>
                <span className="chart-tt-val">{U.fmt(f.v)}</span>
              </div>
              {f.meta && <div className="chart-tt-meta"><MetaTxt m={f.meta} /></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Leyenda donde cada entrada se prende y apaga con un clic
// Leyenda simple, para las gráficas que no llevan filtros propios.
// No es opcional: con dos o más líneas, sin leyenda el lector ve trazos de
// colores y tiene que adivinar cuál es cuál. La etiqueta del último punto dice
// el valor, no la identidad.
export function Leyenda({ series }) {
  if (series.length < 2) return null;
  return (
    <div className="chart-legend">
      {series.map((s) => (
        <span key={s.key} className="chart-legend-item">
          <span className="chart-legend-key" style={{ background: s.color }} />{s.label}
        </span>
      ))}
    </div>
  );
}

function LeyendaFiltrable({ series, ocultas, toggle }) {
  if (series.length < 2) return null;
  return (
    <div className="chart-legend leyenda-filtrable">
      {series.map((s) => {
        const off = ocultas.has(s.key);
        return (
          <button key={s.key} className={'chart-legend-item' + (off ? ' off' : '')} onClick={() => toggle(s.key)}
            title={off ? 'Mostrar ' + s.label : 'Ocultar ' + s.label}>
            <span className="chart-legend-key" style={{ background: off ? 'var(--t3)' : s.color }} />{s.label}
          </button>
        );
      })}
      {ocultas.size > 0 && <button className="chart-legend-item link-reset" onClick={() => toggle(null)}>mostrar todas</button>}
    </div>
  );
}

// El mes en curso NO entra en las series de tendencia. Un mes a medio llenar
// hunde todas las líneas en el último punto y se lee como una caída del equipo
// cuando lo único que pasa es que el mes no ha terminado. Para el mes en curso
// está la vista Resumen, que sí lo trata como lo que es.
const mesesDe = (records, lente) => {
  const actual = currentYM();
  return [...new Set(records.map((r) => mesDe(r, lente)).filter((m) => m && m >= MES_MINIMO && m !== actual))].sort();
};

// ═══ EL EMBUDO DEL MES ═══
// Los tres pasos con la MISMA base, para ver de verdad cuántas llegan al final
// y dónde se pierde más gente. Los completados son un subconjunto de los
// atendidos, así que el embudo siempre va de más a menos.
export function FunnelMes({ totals: t, mesLabel, enCurso }) {
  const base = t.asignados || 0;
  if (!base) return null;
  const pct = (n) => (base ? (n / base) * 100 : 0);
  const p0 = (n) => Math.round(pct(n));

  const pasos = [
    { k: 'base', label: 'Solicitudes que entraron', n: base, color: 'var(--chart-muted)' },
    { k: 'sesion', label: 'Recibieron su 1ª sesión', n: t.atendidos, color: 'var(--blue)' },
    { k: 'fin', label: 'Llegaron al final (completadas)', n: t.completados, color: 'var(--g)' },
  ];

  // En cada escalón se separa lo que TODAVÍA puede avanzar de lo que ya se perdió.
  // Un ticket abierto sin sesión no es una fuga: es trabajo pendiente.
  const escalones = [
    {
      tras: 0,
      pendiente: t.abiertosSinSesion, pendienteTxt: 'siguen abiertas, aún sin su primera sesión',
      perdido: t.perdidosSinSesion, perdidoTxt: 'se cerraron sin que nunca hubiera una sesión',
    },
    {
      tras: 1,
      pendiente: t.abiertosConSesion, pendienteTxt: 'ya tuvieron sesión y siguen en proceso',
      perdido: t.no_completados - t.perdidosSinSesion, perdidoTxt: 'tuvieron sesión pero se cerraron sin completar',
    },
  ];

  return (
    <div className="panel">
      <div className="panel-hd">
        <div>
          <div className="stitle">El embudo de {mesLabel}</div>
          <div className="ssub">
            De cada solicitud que entró, cuántas avanzaron a cada paso. Todos los porcentajes son sobre la misma base.
            {enCurso && <> El mes está en curso, así que lo que sigue abierto todavía puede avanzar.</>}
          </div>
        </div>
        <span className="pill">{p0(t.completados)}% llega al final</span>
      </div>
      <div className="panel-bd funnel-wrap">
        {pasos.map((p, i) => (
          <div key={p.k}>
            <div className="funnel-paso">
              <div className="funnel-lbl">{p.label}</div>
              <div className="funnel-track">
                <div className="funnel-fill" style={{ width: pct(p.n) + '%', background: p.color }} />
                <span className="funnel-n">{fmtInt(p.n)}</span>
              </div>
              <div className="funnel-pct">{p0(p.n)}%</div>
            </div>
            {escalones.filter((e) => e.tras === i).map((e) => (
              <div className="funnel-gap" key={e.tras}>
                {e.pendiente > 0 && (
                  <span className="funnel-pend">⏳ <b>{fmtInt(e.pendiente)}</b> ({p0(e.pendiente)}%) {e.pendienteTxt}</span>
                )}
                {e.perdido > 0 && (
                  <span className="funnel-perd">✕ <b>{fmtInt(e.perdido)}</b> ({p0(e.perdido)}%) {e.perdidoTxt}</span>
                )}
              </div>
            ))}
          </div>
        ))}
        <div className="funnel-cierre">
          De las <b>{fmtInt(base)}</b> solicitudes de {mesLabel}: <b>{fmtInt(t.completados)}</b> completadas
          {' '}({p0(t.completados)}%), <b>{fmtInt(t.no_completados)}</b> no completadas ({p0(t.no_completados)}%)
          {' '}y <b>{fmtInt(t.abiertos)}</b> todavía abiertas ({p0(t.abiertos)}%).
          {t.abiertos > 0 && (
            <> Si todas las abiertas terminaran bien, el embudo cerraría en <b>{p0(t.completados + t.abiertos)}%</b>.</>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══ UNA GRÁFICA DE UN TEMA ═══
export function ChartPanel({
  grupo, records, lente, paisOpts = [], segOpts = [],
  globalPais = ALL, globalSeg = ALL, rangoInicial = 12, alto = 230, conBase = false,
}) {
  const [pais, setPais] = useState(globalPais);
  const [seg, setSeg] = useState(globalSeg);
  const [division, setDivision] = useState('ninguna');
  const [base, setBase] = useState('todas');
  const [rango, setRango] = useState(rangoInicial);
  const [ocultas, setOcultas] = useState(() => new Set());

  // Al mover el filtro principal de arriba, todas las gráficas vuelven a alinearse.
  // Después se puede mover cada una por su cuenta sin tocar las demás.
  useEffect(() => { setPais(globalPais); }, [globalPais]);
  useEffect(() => { setSeg(globalSeg); }, [globalSeg]);

  const campo = DIVISIONES[division].campo;
  const dividido = !!campo;

  // Un filtro no puede pelearse con la división de la misma gráfica: si estás
  // dividiendo POR país y a la vez filtras A un país, te queda una sola línea y
  // la división deja de decir nada. Cuando eso pasa, el filtro en conflicto se
  // apaga solo (y el select queda deshabilitado explicando por qué), en vez de
  // dejarte creer que estás comparando algo.
  const chocaPais = campo === 'pais_label';
  const chocaSeg = campo === 'segmento';
  const paisEf = chocaPais ? ALL : pais;
  const segEf = chocaSeg ? ALL : seg;
  // "Filtro propio" solo si TÚ moviste un filtro que sigue activo. Un filtro
  // anulado por la división no es una divergencia que tengas que deshacer —
  // eso ya lo explica la nota de conflicto de abajo.
  const propio = (!chocaPais && pais !== globalPais) || (!chocaSeg && seg !== globalSeg);

  const filtrados = useMemo(() => {
    const f = BASES[base].filtro;
    return records.filter((r) =>
      (paisEf === ALL || r.pais_label === paisEf) &&
      (segEf === ALL || r.segmento === segEf) &&
      (!f || f(r))
    );
  }, [records, paisEf, segEf, base]);

  const todosMeses = useMemo(() => mesesDe(filtrados, lente), [filtrados, lente]);
  const months = useMemo(() => (rango ? todosMeses.slice(-rango) : todosMeses), [todosMeses, rango]);

  // Al dividir se grafica una sola métrica: si no, serían métricas × grupos de líneas
  const [metricaSel, setMetricaSel] = useState(grupo.metricas[0]);
  const metricaDiv = grupo.metricas.includes(metricaSel) ? metricaSel : grupo.metricas[0];

  const grupos = useMemo(() => {
    if (!campo) return [];
    const c = {};
    filtrados.forEach((r) => { const k = r[campo] || '(sin dato)'; c[k] = (c[k] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [filtrados, campo]);

  // Totales del mes SIN dividir. Sirven para dos cosas: las series cuando no hay
  // división, y el "total del mes" del tooltip cuando sí la hay.
  const totalesMes = useMemo(
    () => months.map((m) => teamTotals(filtrados.filter((r) => mesDe(r, lente) === m))),
    [months, filtrados, lente]
  );

  const series = useMemo(() => {
    if (dividido) {
      const def = M[metricaDiv];
      const top = grupos.slice(0, 8).map(([k]) => k);
      return top.map((g, i) => {
        const tot = months.map((m) => teamTotals(filtrados.filter((r) => mesDe(r, lente) === m && (r[campo] || '(sin dato)') === g)));
        return {
          key: g, label: g,
          color: campo === 'analista' ? colorOf(g) : PALETA[i % PALETA.length],
          vals: tot.map(def.get),
          meta: def.meta ? tot.map(def.meta) : null,
        };
      });
    }
    return grupo.metricas.map((k) => ({
      key: k, label: M[k].label, color: M[k].color,
      vals: totalesMes.map(M[k].get),
      meta: M[k].meta ? totalesMes.map(M[k].meta) : null,
    }));
  }, [dividido, metricaDiv, grupos, months, filtrados, lente, campo, grupo.metricas, totalesMes]);

  // El total del mes que se muestra en el tooltip cuando hay división
  const totalMes = useMemo(() => {
    if (!dividido) return null;
    const def = M[metricaDiv];
    return { vals: totalesMes.map(def.get), meta: def.meta ? totalesMes.map(def.meta) : null };
  }, [dividido, metricaDiv, totalesMes]);

  const unidad = dividido ? M[metricaDiv].unidad : M[grupo.metricas[0]].unidad;

  // ── Guardas de lectura ─────────────────────────────────────────────────────
  // Sin esto, dos gráficas se leen como hechos cuando no lo son:
  //
  // CSAT: el promedio de 2 respuestas se ve igual de sólido que el de 200. Al
  // filtrar a un país chico la línea salta y parece una caída de calidad.
  //
  // MRR: el dato falta en un tercio de los tickets, y falta MUCHO más en
  // Contador que en Pyme. Una suma filtrada a Contador queda subestimada sin
  // que nada lo advierta, y eso lleva a conclusiones al revés.
  const N_MINIMO = 10;
  const mesesFlojos = useMemo(() => {
    if (grupo.id !== 'csat') return 0;
    return totalesMes.filter((t) => t.csatN > 0 && t.csatN < N_MINIMO).length;
  }, [grupo.id, totalesMes]);

  const cobertura = useMemo(() => {
    if (grupo.id !== 'mrr') return null;
    const n = filtrados.length;
    const con = filtrados.filter((r) => r.mrr != null).length;
    return { n, con, pct: n ? Math.round((con / n) * 100) : 0 };
  }, [grupo.id, filtrados]);
  const visibles = series.filter((s) => !ocultas.has(s.key));
  const toggleSerie = (k) => setOcultas((prev) => {
    if (k === null) return new Set();
    const s = new Set(prev); if (s.has(k)) s.delete(k); else s.add(k); return s;
  });
  const cambiarDivision = (v) => { setDivision(v); setOcultas(new Set()); };

  return (
    <div className="chart-card">
      <div className="chart-card-hd">
        <div>
          <div className="stitle">{grupo.titulo}</div>
          <div className="ssub">{grupo.subtitulo}</div>
        </div>
        {propio && (
          <button className="chip" title="Volver a los filtros de arriba" onClick={() => { setPais(globalPais); setSeg(globalSeg); }}>
            ↺ Filtro propio · volver al general
          </button>
        )}
      </div>

      <div className="panel-ctrl">
        <div className="fg fg-inline"><label>Versión</label>
          <select className="inp" value={paisEf} disabled={chocaPais}
            title={chocaPais ? 'Esta gráfica ya está dividida por país: filtrar a uno solo dejaría una única línea.' : undefined}
            onChange={(e) => setPais(e.target.value)}>
            <option value={ALL}>{chocaPais ? 'Todas (dividido por país)' : 'Todas'}</option>
            {paisOpts.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="fg fg-inline"><label>Segmento</label>
          <select className="inp" value={segEf} disabled={chocaSeg}
            title={chocaSeg ? 'Esta gráfica ya está dividida por segmento: filtrar a uno solo dejaría una única línea.' : undefined}
            onChange={(e) => setSeg(e.target.value)}>
            <option value={ALL}>{chocaSeg ? 'Ambos (dividido por segmento)' : 'Contador y Pyme'}</option>
            {segOpts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="fg fg-inline"><label>Dividir por</label>
          <select className="inp" value={division} onChange={(e) => cambiarDivision(e.target.value)}>
            {Object.entries(DIVISIONES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        {dividido && grupo.metricas.length > 1 && (
          <div className="fg fg-inline"><label>Métrica</label>
            <select className="inp" value={metricaDiv} onChange={(e) => setMetricaSel(e.target.value)}>
              {grupo.metricas.map((k) => <option key={k} value={k}>{M[k].label}</option>)}
            </select>
          </div>
        )}
        {conBase && (
          <div className="fg fg-inline"><label>Contar sobre</label>
            <select className="inp" value={base} onChange={(e) => setBase(e.target.value)}>
              {Object.entries(BASES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        )}
        <div className="chips" style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>
          {[[6, '6m'], [12, '12m'], [0, 'Todo']].map(([v, l]) => (
            <button key={v} className={'chip' + (rango === v ? ' active' : '')} onClick={() => setRango(v)}>{l}</button>
          ))}
        </div>
      </div>

      {dividido && grupos.length > 8 && (
        <div className="explorer-nota">Se dibujan los 8 grupos con más tickets de {grupos.length}. Clic en la leyenda para apagar o prender una línea.</div>
      )}
      {(chocaPais || chocaSeg) && (
        <div className="explorer-nota">
          ℹ️ Estás dividiendo por <b>{chocaPais ? 'país' : 'segmento'}</b>, así que ese filtro queda en «todos»:
          {' '}filtrarlo dejaría una sola línea y no habría nada que comparar. Cada línea del gráfico ya <b>es</b> un {chocaPais ? 'país' : 'segmento'}.
        </div>
      )}
      {mesesFlojos > 0 && (
        <div className="explorer-nota nota-warn">
          ⚠️ <b>Pocas respuestas:</b> {mesesFlojos} de los {months.length} meses tienen menos de {N_MINIMO} CSAT.
          {' '}Con esa cantidad, un solo cliente descontento mueve el promedio un punto entero — mira la tendencia, no el mes suelto.
        </div>
      )}
      {cobertura && cobertura.pct < 90 && (
        <div className="explorer-nota nota-warn">
          ⚠️ <b>Cobertura del dato: {cobertura.pct}%</b> — solo {fmtInt(cobertura.con)} de {fmtInt(cobertura.n)} tickets de esta selección traen MRR en HubSpot.
          {' '}Lo que ves es un <b>piso, no el total</b>. El hueco no está repartido parejo: en Contador falta mucho más seguido que en Pyme,
          {' '}así que comparar los dos segmentos por esta gráfica subestima a Contador.
        </div>
      )}

      <LeyendaFiltrable series={series} ocultas={ocultas} toggle={toggleSerie} />
      <div className="chart-card-bd"><MultiLineChart months={months} series={visibles} unidad={unidad} alto={alto} totalMes={totalMes} /></div>

      <details className="mas-filtros">
        <summary>Ver los números</summary>
        <div className="tbl-scroll" style={{ maxHeight: 300 }}><table>
          <thead><tr><th>Mes</th>{visibles.map((s) => <th key={s.key} className="tr">{s.label}</th>)}{totalMes && <th className="tr" style={{ borderLeft: '1px solid var(--brd)' }}>Total del mes</th>}</tr></thead>
          <tbody>{months.map((m, i) => (
            <tr key={m}>
              <td style={{ fontWeight: 700 }}>{monthLabel(m)}</td>
              {visibles.map((s) => (
                <td key={s.key} className="tr">
                  {s.vals[i] == null ? '—' : UNIDADES[unidad].fmt(s.vals[i])}
                  {s.meta && s.meta[i] && <div className="celda-meta"><MetaTxt m={s.meta[i]} /></div>}
                </td>
              ))}
              {totalMes && (
                <td className="tr" style={{ fontWeight: 800, borderLeft: '1px solid var(--brd)' }}>
                  {totalMes.vals[i] == null ? '—' : UNIDADES[unidad].fmt(totalMes.vals[i])}
                  {totalMes.meta && totalMes.meta[i] && <div className="celda-meta"><MetaTxt m={totalMes.meta[i]} /></div>}
                </td>
              )}
            </tr>
          ))}</tbody>
        </table></div>
      </details>
    </div>
  );
}
