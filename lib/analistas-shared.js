import { SESSIONS_BY_ANALISTA, SESSIONS_META } from '@/lib/sessions-data';
import { median, avg1 } from '@/lib/metrics';

// Las definiciones de métricas viven en lib/metrics.js (fuente única). Acá solo se
// re-exportan para que las vistas que ya las importaban desde aquí sigan andando.
export {
  median, avg1, teamTotals, aggregateBy, aggregateByAnalista, aggregateByPais,
  aggregateBySegmento, esAtendido, esCompletado, esNoCompletado, esAbierto,
  esCerrado, mesDe, enMes, LENTES, GLOSARIO,
} from '@/lib/metrics';

export const fmtInt = (n) => Math.round(n || 0).toLocaleString('es-MX');

// Paleta categórica validada (dataviz skill): 6 slots en orden fijo 1→6, sin saltos
// (saltar un slot rompe la garantía de separación CVD entre vecinos). Referenciados
// como CSS vars para que el hex correcto de cada tema (claro/oscuro) se resuelva solo.
// Slots 1-8: paleta categórica validada (dataviz skill), orden fijo, sin saltos.
// Slots 9-10: el set validado solo cubre 8 identidades — para el resto se usan
// tonos distintos entre sí pero SIN la misma garantía de separación CVD (ver nota
// en memoria/README). Siempre van acompañados del nombre en texto, nunca solo color.
export const COLORS = {
  'Diana Torres': 'var(--series-1)', 'Leiby Aguilar': 'var(--series-2)', 'Valeria Gallardo Molina': 'var(--series-3)',
  'Montserrat Cazares': 'var(--series-4)', 'María Briceño': 'var(--series-5)', 'Luis M. Kelly': 'var(--series-6)',
  'Fernando Ibarra': 'var(--series-7)', 'Eliana Katherine Rivera': 'var(--series-8)',
  'Eva Serje': 'var(--series-9)', 'Valentina Benitez': 'var(--series-10)',
  'Otro': 'var(--series-other)', 'Sin asignar': 'var(--series-unassigned)',
};
// Fallback para nombres que no están en el mapa curado (gente resuelta dinámicamente
// desde HubSpot: equipo nuevo o histórico que no hemos revisado todavía). Un hash
// estable del nombre elige entre 2 tonos neutros — así NO se confunden con Diana
// (slot 1) ni con ningún otro miembro curado, y el mismo nombre siempre sale igual.
const FALLBACK_TONES = ['var(--series-other)', 'var(--series-unassigned)'];
const FALLBACK_INK = ['var(--series-other-ink)', 'var(--series-unassigned-ink)'];
function hashIdx(n) {
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) | 0;
  return Math.abs(h) % FALLBACK_TONES.length;
}
export const colorOf = (n) => COLORS[n] || FALLBACK_TONES[hashIdx(n)];

// Tinta del texto sobre el fill de colorOf(n) — blanco u oscuro según cuál da más
// contraste contra ESE swatch específico (ver marks-and-anatomy.md: "pick white or
// ink by the fill's luminance"). Varios de los 6 slots fallan WCAG con blanco fijo.
const INK = {
  'Diana Torres': 'var(--series-1-ink)', 'Leiby Aguilar': 'var(--series-2-ink)', 'Valeria Gallardo Molina': 'var(--series-3-ink)',
  'Montserrat Cazares': 'var(--series-4-ink)', 'María Briceño': 'var(--series-5-ink)', 'Luis M. Kelly': 'var(--series-6-ink)',
  'Fernando Ibarra': 'var(--series-7-ink)', 'Eliana Katherine Rivera': 'var(--series-8-ink)',
  'Eva Serje': 'var(--series-9-ink)', 'Valentina Benitez': 'var(--series-10-ink)',
  'Otro': 'var(--series-other-ink)', 'Sin asignar': 'var(--series-unassigned-ink)',
};
export const inkOf = (n) => INK[n] || FALLBACK_INK[hashIdx(n)];
export const initials = (n) => n.split(' ').map((w) => w[0]).slice(0, 2).join('');

const MONTH_LBL = { '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr', '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Ago', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic' };
export const monthLabel = (ym) => `${MONTH_LBL[ym.slice(5, 7)]} ${ym.slice(2, 4)}`;

export const sessOf = (analista, mes) => SESSIONS_BY_ANALISTA[analista]?.[mes] || null;

// ─── Registro de sesiones (Connect) ───
// Hoy es un export manual del Google Sheet. Desde septiembre 2026 las sesiones viven
// en el pipeline nuevo de HubSpot: cuando eso pase, solo hay que cambiar la fuente
// acá arriba (sessions-data) — el resto de la app no se entera.

/** Meses que el registro de sesiones realmente cubre. Antes estaba escrito a mano
 *  como ene–jun; ahora sale del propio archivo, así que se extiende solo cuando
 *  cargamos data nueva. */
export const SESSION_MONTHS = SESSIONS_META.meses || [];

/** ¿Este analista aparece del todo en el registro de sesiones?
 *  Sirve para distinguir "dio 0 sesiones" de "no está en el registro" — antes ambos
 *  casos mostraban 0, y la gente que no estaba en el CSV parecía no haber trabajado. */
export const enRegistroSesiones = (analista) => Object.prototype.hasOwnProperty.call(SESSIONS_BY_ANALISTA, analista);

/** Sesiones de un analista en un mes, distinguiendo los 3 casos posibles.
 *  → { estado: 'ok' | 'sin-registro' | 'fuera-de-ventana', dadas, primeras, noAsistio, agendadas } */
export function sesionesDe(analista, mes) {
  if (!SESSION_MONTHS.includes(mes)) return { estado: 'fuera-de-ventana' };
  if (!enRegistroSesiones(analista)) return { estado: 'sin-registro' };
  const s = sessOf(analista, mes);
  return { estado: 'ok', dadas: 0, primeras: 0, noAsistio: 0, agendadas: 0, ...(s || {}) };
}

export function currentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function prevYM(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1); // m-1 (0-index) - 1 mes
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// N meses terminando en endYM (inclusive), orden ascendente.
export function lastNMonths(endYM, n) {
  const [y, m] = endYM.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// Suma de sesiones dadas por todo el equipo en un mes (registro Connect).
export function teamSessionsForMonth(mes) {
  return Object.values(SESSIONS_BY_ANALISTA).reduce((s, byMonth) => s + (byMonth[mes]?.dadas || 0), 0);
}

// Semáforo de SLA: como todavía no hay una meta/umbral definido para SLA, se compara
// CADA analista contra el PROMEDIO DEL EQUIPO de ese mismo período (benchmark relativo,
// no absoluto). value = días del analista; teamAvg = promedio del equipo ese mes.
// 'up' = true cuando MÁS días es mejor (no aplica hoy, queda por si acaso).
export function slaSemaforo(value, teamAvg, up = false) {
  if (value == null || teamAvg == null || teamAvg === 0) return { level: 'na', color: 'var(--t3)' };
  const ratio = up ? teamAvg / value : value / teamAvg;
  if (ratio <= 1.1) return { level: 'good', color: 'var(--g)' };
  if (ratio <= 1.5) return { level: 'warn', color: 'var(--a)' };
  return { level: 'bad', color: 'var(--r)' };
}

// Umbral histórico del proyecto para "ticket estancado" (usado en dashboards previos
// de este mismo equipo): más de 30 días abierto sin resolver.
const ZOMBIE_DAYS = 30;

function daysSinceYMD(ymd) {
  if (!ymd) return null;
  const d = new Date(ymd + 'T00:00:00');
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  return days >= 0 ? days : 0;
}

// Embudo por ETAPA ACTUAL + SLA (días) de cada etapa, sobre TODOS los tickets
// asignados (no solo los "atendidos" — esto es visibilidad operativa del pipeline
// completo, distinta de la métrica de éxito/atendido usada en el resto del dashboard).
//  - Nuevo / En proceso: días EN ESA ETAPA = entró a la etapa → hoy. Usamos la marca
//    de tiempo real de HubSpot (fecha_entrada_etapa), no la fecha de solicitud: antes
//    un ticket que pasó 2 días en Nuevo y 60 en proceso marcaba 62 días "en proceso",
//    exagerando el estancamiento de esa etapa.
//  - Completada / No completada: días de ciclo = fecha de solicitud → fecha de cierre.
// `alerta` (solo en Nuevo) = cuántos tickets están MUY por encima del promedio de su
// propia etapa (más del doble del promedio, o 30 días — lo que sea mayor).
function stageBucket(dias, conAlerta) {
  const avg = avg1(dias);
  const out = { n: dias.length, avg, med: median(dias) };
  if (conAlerta) {
    const umbral = avg != null ? Math.max(ZOMBIE_DAYS, Math.round(avg * 2)) : ZOMBIE_DAYS;
    out.umbral = umbral;
    out.alerta = dias.filter((d) => d > umbral).length;
  }
  return out;
}

export function stageFunnel(recs) {
  const dNuevo = [], dEnProceso = [], dCompletada = [], dNoCompletada = [];
  let nNuevo = 0, nEnProceso = 0, nCompletada = 0, nNoCompletada = 0;
  recs.forEach((r) => {
    if (r.stage === 'Nuevo') { nNuevo++; const d = daysSinceYMD(r.fecha_entrada_etapa || r.fecha_solicitud); if (d != null) dNuevo.push(d); }
    else if (r.stage === 'En proceso') { nEnProceso++; const d = daysSinceYMD(r.fecha_entrada_etapa || r.fecha_solicitud); if (d != null) dEnProceso.push(d); }
    else if (r.stage === 'Completada') { nCompletada++; if (r.dias_a_cierre != null) dCompletada.push(r.dias_a_cierre); }
    else if (r.stage === 'No completada') { nNoCompletada++; if (r.dias_a_cierre != null) dNoCompletada.push(r.dias_a_cierre); }
  });
  return {
    total: recs.length,
    nuevo: { ...stageBucket(dNuevo, true), n: nNuevo },
    enProceso: { ...stageBucket(dEnProceso, false), n: nEnProceso },
    completada: { ...stageBucket(dCompletada, false), n: nCompletada },
    noCompletada: { ...stageBucket(dNoCompletada, false), n: nNoCompletada },
  };
}

// Igual que stageFunnel pero agrupado por cualquier dimensión (analista, país, segmento).
export function stageFunnelBy(recs, keyFn) {
  const map = {};
  recs.forEach((r) => { const k = keyFn(r); (map[k] = map[k] || []).push(r); });
  return Object.entries(map).map(([key, group]) => ({ key, ...stageFunnel(group) }));
}

export const isTeamMember = (n) => n !== 'Otro' && n !== 'Sin asignar';
export function sortTeamFirst(list, key) {
  return [...list].sort((a, b) => (isTeamMember(b.analista) - isTeamMember(a.analista)) || (b[key] - a[key]));
}
