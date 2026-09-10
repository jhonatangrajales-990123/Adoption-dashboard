// ─────────────────────────────────────────────────────────────────────────────
// MÉTRICAS DE ACTIVACIÓN — la capa que alimenta la vista SaaS.
//
// Van aparte de lib/metrics.js a propósito: metrics.js define qué es un ticket
// atendido o completado (el vocabulario común de todo el tablero), y esto de
// acá construye encima las métricas de producto que le interesan a dirección.
//
// Cada función lleva escrito de dónde sale el número y —cuando es un
// sustituto— qué es lo que NO estamos midiendo. Esa honestidad es parte de la
// métrica: un TTFV que no dice desde cuándo cuenta el reloj es decoración.
// ─────────────────────────────────────────────────────────────────────────────
import { esAtendido, esCompletado, esNoCompletado, esAbierto, avg1, median } from './metrics.js';

/** Días transcurridos desde una fecha YYYY-MM-DD hasta hoy. */
export const diasDesde = (ymd) => {
  if (!ymd) return null;
  const d = new Date(String(ymd).slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};

/** Días transcurridos desde que terminó el mes YYYY-MM. */
export const diasDesdeFinDeMes = (ym) => {
  if (!ym) return null;
  const [a, m] = ym.split('-').map(Number);
  const fin = new Date(Date.UTC(a, m, 0)); // día 0 del mes siguiente = último de este
  return Math.floor((Date.now() - fin.getTime()) / 86400000);
};

/**
 * ¿La cohorte de este mes ya tuvo tiempo de completarse en `ventana` días?
 *
 * Sin esta guarda el mes en curso siempre se ve como un fracaso: un ticket
 * pedido hace 5 días no "falló" en cerrar en 30, es que todavía no le toca.
 */
export const cohorteMadura = (ym, ventana) => (diasDesdeFinDeMes(ym) ?? -1) >= ventana;

/**
 * ONBOARDING COMPLETION RATE
 * De las solicitudes de la cohorte, qué % llegó a Completada dentro de N días.
 *
 * El denominador son TODAS las solicitudes del período, no solo las cerradas.
 * Si fuera solo las cerradas, el indicador subiría con solo dejar tickets
 * abiertos — premiaría justo lo contrario de lo que queremos.
 */
export function completionRate(recs, ventanaDias) {
  let base = 0, dentro = 0, fuera = 0, enVuelo = 0;
  recs.forEach((r) => {
    base++;
    if (esCompletado(r)) {
      if (r.dias_a_cierre != null && r.dias_a_cierre <= ventanaDias) dentro++;
      else fuera++;
    } else if (esNoCompletado(r)) {
      fuera++;
    } else {
      // Sigue abierto: solo cuenta como fallo si ya se le pasó la ventana.
      const edad = diasDesde(r.fecha_solicitud);
      if (edad != null && edad > ventanaDias) fuera++; else enVuelo++;
    }
  });
  return {
    base, dentro, fuera, enVuelo,
    pct: base ? (dentro / base) * 100 : null,
    // % sobre lo que ya se puede juzgar (deja fuera lo que aún está en plazo)
    pctResueltos: (base - enVuelo) ? (dentro / (base - enVuelo)) * 100 : null,
  };
}

/**
 * TIME TO FIRST VALUE (operativo)
 *
 * El reloj arranca en la FECHA DE SOLICITUD de la migración, no en la firma del
 * contrato: esa fecha no vive en el pipeline de Adoption. Y el "primer valor"
 * que medimos es la primera sesión efectiva, no el primer evento de valor
 * dentro del producto. Las dos salvedades se muestran en la tarjeta.
 */
export function ttfv(recs) {
  const d = recs.filter(esAtendido).map((r) => r.dias_primera_sesion).filter((v) => v != null);
  return { avg: avg1(d), med: median(d), n: d.length, base: recs.length };
}

/**
 * EMBUDO DE ACTIVACIÓN — 4 pasos.
 *
 * HubSpot solo tiene 4 etapas de pipeline (Nuevo / En proceso / Completada /
 * No completada) y ninguna corresponde a una fase del onboarding. Las fases
 * reales se reconstruyen con el contador de sesiones, que sí está poblado.
 *
 * Los pasos son ACUMULATIVOS (quien llegó al 4 cuenta también en el 3) para que
 * el embudo no pueda ensancharse hacia abajo por huecos de registro: hay más
 * tickets completados que tickets con 2+ sesiones anotadas.
 */
export const PASOS_ACTIVACION = [
  { key: 'solicitud', label: 'Solicitud recibida', desc: 'Entró al pipeline de Adoption.' },
  { key: 'kickoff', label: 'Kick-off', desc: 'Recibió efectivamente la primera sesión.' },
  { key: 'capacita', label: 'Capacitación', desc: 'Llegó a una segunda sesión o más.' },
  { key: 'adopcion', label: 'Adopción completa', desc: 'Migración cerrada como Completada.' },
];

export function embudoActivacion(recs) {
  const n = { solicitud: 0, kickoff: 0, capacita: 0, adopcion: 0 };
  recs.forEach((r) => {
    n.solicitud++;
    const compl = esCompletado(r);
    if (esAtendido(r)) n.kickoff++;
    if (compl || (r.sesiones_registradas || 0) >= 2) n.capacita++;
    if (compl) n.adopcion++;
  });
  return PASOS_ACTIVACION.map((p, i) => {
    const prev = i === 0 ? null : n[PASOS_ACTIVACION[i - 1].key];
    return {
      ...p,
      n: n[p.key],
      pctBase: n.solicitud ? (n[p.key] / n.solicitud) * 100 : 0,
      // Conversión contra el paso anterior: ahí se ve dónde está el cuello
      pctPaso: prev == null ? null : (prev ? (n[p.key] / prev) * 100 : 0),
      caida: prev == null ? null : prev - n[p.key],
    };
  });
}

/**
 * CAPACIDAD POR ESPECIALISTA
 * Cuentas gestionadas por analista en el período. La historia que le importa a
 * dirección es esta cruzada con los tiempos: subir volumen sin que los días
 * empeoren es lo que demuestra que el proceso escaló.
 */
export function capacidad(recs) {
  const por = {};
  recs.forEach((r) => { const a = r.analista || 'Sin asignar'; por[a] = (por[a] || 0) + 1; });
  const nombres = Object.keys(por).filter((a) => a !== 'Sin asignar');
  const cargas = nombres.map((a) => por[a]);
  const conAnalista = cargas.reduce((s, v) => s + v, 0);
  return {
    analistas: nombres.length,
    total: recs.length,
    sinAsignar: por['Sin asignar'] || 0,
    promedio: nombres.length ? Math.round(conAnalista / nombres.length * 10) / 10 : null,
    mediana: median(cargas),
    max: cargas.length ? Math.max(...cargas) : null,
    min: cargas.length ? Math.min(...cargas) : null,
    detalle: nombres.map((a) => ({ analista: a, n: por[a] })).sort((x, y) => y.n - x.n),
  };
}

/**
 * RIESGO DE ABANDONO TEMPRANO — proxy operativo.
 *
 * Esto NO es churn. El churn (que una cuenta deje de pagar) vive en Metabase y
 * la app no puede consultarlo: el único acceso vigente a Metabase es por MCP,
 * desde el chat, no desde el navegador. Lo que sí se ve acá es el precursor
 * operativo del abandono: cuentas que entraron, nunca recibieron sesión y
 * llevan semanas esperando.
 */
export const RIESGO_UMBRALES = { medio: 15, alto: 30, critico: 60 };

export function riesgoTemprano(recs) {
  const cubos = { ok: [], medio: [], alto: [], critico: [] };
  recs.filter(esAbierto).forEach((r) => {
    const edad = diasDesde(r.fecha_solicitud);
    if (edad == null) return;
    // Con la sesión ya dada el riesgo baja mucho: la cuenta tuvo contacto real.
    if (esAtendido(r)) { (edad > RIESGO_UMBRALES.critico ? cubos.medio : cubos.ok).push(r); return; }
    if (edad > RIESGO_UMBRALES.critico) cubos.critico.push(r);
    else if (edad > RIESGO_UMBRALES.alto) cubos.alto.push(r);
    else if (edad > RIESGO_UMBRALES.medio) cubos.medio.push(r);
    else cubos.ok.push(r);
  });
  const enRiesgo = [...cubos.critico, ...cubos.alto];
  const conMrr = enRiesgo.filter((r) => r.mrr != null);
  const abiertos = cubos.ok.length + cubos.medio.length + cubos.alto.length + cubos.critico.length;
  return {
    abiertos,
    critico: cubos.critico.length, alto: cubos.alto.length, medio: cubos.medio.length, ok: cubos.ok.length,
    enRiesgo: enRiesgo.length,
    pct: abiertos ? (enRiesgo.length / abiertos) * 100 : 0,
    mrr: conMrr.reduce((s, r) => s + r.mrr, 0),
    mrrN: conMrr.length,
    lista: enRiesgo
      .map((r) => ({ ...r, edad: diasDesde(r.fecha_solicitud) }))
      .sort((a, b) => (b.mrr || 0) - (a.mrr || 0) || b.edad - a.edad),
  };
}

/**
 * COBERTURA DEL MRR — cuántos tickets traen el dato.
 *
 * Le hace falta a la vista porque el hueco no está repartido parejo: Contador
 * tiene el MRR vacío mucho más seguido que Pyme, así que cualquier cifra de
 * ingreso filtrada a Contador queda subestimada si no se advierte.
 */
export function coberturaMrr(recs) {
  const con = recs.filter((r) => r.mrr != null).length;
  return { n: recs.length, con, pct: recs.length ? (con / recs.length) * 100 : null };
}
