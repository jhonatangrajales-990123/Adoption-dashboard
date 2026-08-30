// ─────────────────────────────────────────────────────────────────────────────
// DEFINICIONES ÚNICAS DE MÉTRICAS
//
// Este archivo es la ÚNICA fuente de verdad de qué significa cada número del
// dashboard. Antes cada vista calculaba lo suyo y la misma etiqueta daba
// resultados distintos según la pestaña (el SLA de ciclo era mediana en el
// Explorador y promedio en las otras dos). Si una vista necesita un número,
// lo pide acá — no lo vuelve a calcular.
//
// Regla de oro: si cambia una definición, cambia en este archivo y punto.
// ─────────────────────────────────────────────────────────────────────────────

export const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  // Con cantidad par se promedian los dos del centro (la mediana de verdad).
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
};
export const avg1 = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null;

// ─── Predicados: qué es cada cosa, en un solo lugar ───

// Resultados de 1ª sesión que significan que la sesión NO llegó a darse.
// Un ticket con fecha agendada pero que el cliente no atendió no está "atendido":
// atender es haberle dado efectivamente la primera sesión.
const RESULTADO_NO_ATENDIDO = new Set(['No asistió', 'Agendada', 'Reagendada', 'Cancelada', 'Validando']);

/**
 * Atendido = se le dio efectivamente la 1ª sesión.
 * Requiere fecha de 1ª sesión Y que el resultado no sea uno de los "no ocurrió".
 *
 * Ojo con el hueco de registro: 878 de los 2.130 tickets con fecha NO tienen
 * resultado anotado en HubSpot (ago-2026). A esos se les cree la fecha —hay
 * evidencia de que la sesión se agendó y ocurrió— pero el hueco se reporta
 * aparte en `atendidosSinResultado` para que no se confunda con certeza.
 */
export const esAtendido = (r) => {
  // Si la migración se COMPLETÓ, la atención ocurrió sí o sí: no se puede completar
  // una migración sin haber trabajado con el cliente. Sin esta regla el % de éxito
  // podía pasar de 100% (103 tickets completados tenían la sesión mal registrada:
  // 83 sin fecha y 20 marcados como "no asistió"/"agendada"/"cancelada").
  if (r.stage === 'Completada') return true;
  if (!r.tiene_primera_sesion) return false;
  if (RESULTADO_NO_ATENDIDO.has(r.resultado_primera_sesion)) return false;
  return true;
};

/**
 * Completado = la etapa es "Completada".
 * OJO: se cuenta SIEMPRE, tenga o no sesión registrada. Antes el cálculo
 * descartaba el ticket si le faltaba la fecha de 1ª sesión, así que un ticket
 * completado de verdad desaparecía del conteo de éxito por un hueco de registro.
 * El hueco se sigue reportando aparte (ver `completadosSinSesion`).
 */
export const esCompletado = (r) => r.stage === 'Completada';
export const esNoCompletado = (r) => r.stage === 'No completada';

/** Abierto = sigue en el pipeline. Sin condición de sesión. */
export const esAbierto = (r) => r.stage === 'Nuevo' || r.stage === 'En proceso';
export const esCerrado = (r) => esCompletado(r) || esNoCompletado(r);

// ─── Lente de tiempo: ¿de qué mes estamos hablando? ───

// Desde cuándo mira el dashboard. Todo lo anterior a esta fecha queda fuera:
// es data de otra época del proceso y ensucia las comparaciones.
export const MES_MINIMO = '2026-01';

/** ¿Este ticket entra en la ventana del dashboard? Entra si se pidió desde
 *  ene-2026, o si se pidió antes pero se cerró ya dentro de la ventana (así la
 *  lente "por fecha de cierre" no pierde lo que efectivamente entregamos). */
export const enVentana = (r) =>
  (r.mes_solicitud && r.mes_solicitud >= MES_MINIMO) ||
  (r.mes_cierre && r.mes_cierre >= MES_MINIMO);

// Las 4 versiones que Adoption realmente opera. Todo lo demás (sin versión,
// Argentina, Perú, "other") es dato mal puesto en HubSpot: se saca del tablero
// para que los números sean confiables, pero se cuenta aparte y se muestra un
// aviso con el enlace a la lista para corregirlo. Nunca se esconde en silencio.
export const VERSIONES_OPERADAS = ['Colombia', 'México', 'Rep. Dominicana', 'Costa Rica'];
export const esVersionOperada = (r) => VERSIONES_OPERADAS.includes(r.pais_label);

export const LENTES = {
  solicitud: {
    key: 'solicitud',
    label: 'Fecha de solicitud',
    hint: 'Agrupa por cuándo el cliente pidió la migración. Es la mirada de cohorte: "de lo que llegó en agosto, ¿cuánto completamos?"',
    campoMes: 'mes_solicitud',
  },
  cierre: {
    key: 'cierre',
    label: 'Fecha de cierre',
    hint: 'Agrupa por cuándo se cerró el ticket. Es la mirada de entrega: "¿qué terminamos durante agosto?" — sirve para reportar.',
    campoMes: 'mes_cierre',
  },
};

/** Mes al que pertenece un ticket según la lente elegida. '' si no aplica. */
export const mesDe = (r, lente = 'solicitud') => r[(LENTES[lente] || LENTES.solicitud).campoMes] || '';

/** Filtra records al mes indicado bajo la lente indicada. */
export const enMes = (recs, mes, lente = 'solicitud') => recs.filter((r) => mesDe(r, lente) === mes);

// ─── El cálculo central ───

function empty() {
  return {
    asignados: 0, atendidos: 0, completados: 0, no_completados: 0, abiertos: 0,
    completadosSinSesion: 0, sinFechaSolicitud: 0,
    noShow: 0, conResultadoSesion: 0, sesionesTotales: 0,
    // Para leer el embudo con honestidad: un ticket abierto sin sesión NO es una
    // pérdida, es algo que todavía puede avanzar. Solo los cerrados se perdieron.
    abiertosSinSesion: 0, abiertosConSesion: 0, perdidosSinSesion: 0,
    // Tickets con fecha de 1ª sesión pero sin resultado anotado en HubSpot.
    // Se cuentan como atendidos, pero conviene saber cuántos son.
    atendidosSinResultado: 0,
    // Tickets donde la 1ª sesión se agendó pero no ocurrió (no asistió, cancelada…).
    agendadosNoAtendidos: 0,
    diasPrimera: [], dias: [], csats: [], mrrs: [],
  };
}

function acumular(o, r) {
  o.asignados++;
  if (r.sin_fecha_solicitud) o.sinFechaSolicitud++;
  if (esAtendido(r)) {
    o.atendidos++;
    if (!r.resultado_primera_sesion) o.atendidosSinResultado++;
    if (r.dias_primera_sesion != null) o.diasPrimera.push(r.dias_primera_sesion);
  } else if (r.tiene_primera_sesion) {
    // Tenía fecha pero la sesión no ocurrió (no asistió / cancelada / reagendada)
    o.agendadosNoAtendidos++;
  }
  if (esCompletado(r)) {
    o.completados++;
    if (!esAtendido(r)) o.completadosSinSesion++;
    if (r.dias_a_cierre != null) o.dias.push(r.dias_a_cierre);
  } else if (esNoCompletado(r)) {
    o.no_completados++;
    if (!esAtendido(r)) o.perdidosSinSesion++;
  } else {
    o.abiertos++;
    if (esAtendido(r)) o.abiertosConSesion++; else o.abiertosSinSesion++;
  }
  if (r.csat != null) o.csats.push(r.csat);
  if (r.mrr != null) o.mrrs.push(r.mrr);
  // No-show y sesiones, ahora por ticket desde HubSpot (antes solo existía a nivel
  // de analista/mes en el CSV manual de Connect).
  if (r.resultado_primera_sesion) { o.conResultadoSesion++; if (r.no_show) o.noShow++; }
  o.sesionesTotales += (r.sesiones_registradas || 0);
}

function finalizar(o) {
  return {
    ...o,
    // ── Porcentajes del EMBUDO: todos sobre la MISMA base (las solicitudes) ──
    // Así se pueden comparar entre sí y leerse como un embudo de verdad. Antes
    // convivían tres denominadores distintos en la misma gráfica y no cuadraba:
    // la "tasa de éxito" salía por encima del "% atendido" pese a que los
    // completados son un subconjunto de los atendidos.
    pctAtendidos: o.asignados ? (o.atendidos / o.asignados) * 100 : 0,
    pctCompletados: o.asignados ? (o.completados / o.asignados) * 100 : 0,
    pctNoCompletados: o.asignados ? (o.no_completados / o.asignados) * 100 : 0,
    pctAbiertos: o.asignados ? (o.abiertos / o.asignados) * 100 : 0,
    pctNoShow: o.asignados ? (o.noShow / o.asignados) * 100 : 0,
    // Conversión de un paso al siguiente (no sobre la base): de los que sí
    // recibieron sesión, cuántos terminaron bien.
    tasa: o.atendidos ? (o.completados / o.atendidos) * 100 : 0, // "éxito" — nombre único en toda la app
    // SLA 1ª atención: solicitud → 1ª sesión. Siempre promedio Y mediana.
    slaAvg: avg1(o.diasPrimera), slaMed: median(o.diasPrimera), slaN: o.diasPrimera.length,
    // SLA ciclo completo: solicitud → cierre, sobre las completadas.
    cicloAvg: avg1(o.dias), cicloMed: median(o.dias), cicloN: o.dias.length,
    // Alias heredados para no romper las vistas que ya los usan.
    avgCompl: avg1(o.dias), medCompl: median(o.dias),
    // Métricas que antes se traían de HubSpot y nunca se mostraban.
    csatAvg: avg1(o.csats), csatN: o.csats.length,
    mrrTotal: o.mrrs.length ? o.mrrs.reduce((a, b) => a + b, 0) : null, mrrN: o.mrrs.length,
    // % de no-show sobre los tickets que SÍ tienen resultado registrado (no sobre
    // todos, que inventaría un denominador que no existe).
    noShowPct: o.conResultadoSesion ? (o.noShow / o.conResultadoSesion) * 100 : null,
  };
}

/** Totales del equipo (sin desagregar) para un set de records ya filtrado. */
export function teamTotals(recs) {
  const o = empty();
  recs.forEach((r) => acumular(o, r));
  return finalizar(o);
}

/** Agrupa por cualquier dimensión. Devuelve exactamente la misma forma que teamTotals + `key`. */
export function aggregateBy(recs, keyFn) {
  const map = {};
  recs.forEach((r) => {
    const k = keyFn(r);
    if (!map[k]) map[k] = { key: k, ...empty() };
    acumular(map[k], r);
  });
  return Object.values(map).map(finalizar);
}

export const aggregateByAnalista = (recs) => aggregateBy(recs, (r) => r.analista || 'Sin asignar').map((o) => ({ ...o, analista: o.key }));
export const aggregateByPais = (recs) => aggregateBy(recs, (r) => r.pais_label || 'Sin país');
export const aggregateBySegmento = (recs) => aggregateBy(recs, (r) => r.segmento || 'Sin segmento');

// ─── Glosario: cada término se explica donde se usa, no en el pie de página ───

export const GLOSARIO = {
  BOP: 'Beginning of Period — los tickets que entraron al pipeline en el período. Es el universo contra el que se mide todo lo demás.',
  atendido: 'Un ticket al que se le dio efectivamente la primera sesión. Si la sesión se agendó pero el cliente no asistió, o se canceló, NO cuenta como atendido.',
  completado: 'Un ticket que llegó a la etapa "Completada", o sea que la migración terminó con éxito.',
  exito: 'Completados ÷ Atendidos. De los casos que tomamos, cuántos terminaron bien.',
  SLA: 'Los días que tarda una parte del proceso. No hay meta definida todavía, así que se muestra el número de días, no un % de cumplimiento.',
  'SLA 1ª atención': 'Días entre que el cliente pide la migración y su primera sesión.',
  'SLA ciclo completo': 'Días entre que el cliente pide la migración y el cierre del ticket.',
  ICP: 'Ideal Customer Profile — qué tan bien calza el cliente con el perfil al que le sirve mejor el producto.',
  MRR: 'Monthly Recurring Revenue — lo que ese cliente paga cada mes.',
  CSAT: 'Customer Satisfaction — la nota que el cliente le puso a la atención.',
  'No-show': 'Reuniones agendadas a las que el cliente no llegó.',
  estancado: 'Un ticket abierto que lleva mucho más tiempo que el promedio de su etapa sin moverse.',
  Connect: 'El registro de sesiones del equipo (hoy un export manual del Google Sheet). Desde septiembre vive en HubSpot.',
};
