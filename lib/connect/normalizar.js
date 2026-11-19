// Tablero integral de Alegra Connect: de tickets de HubSpot a registros normalizados.
// Es la misma lógica de scripts/connect_dashboard/build.js (carpeta anterior), pasada a un módulo
// para poder probarla y para que la corra el servidor. Cualquier cambio de regla se hace AQUÍ.

// Etapas. Pipeline nuevo (Adopción New, 915721075): las etapas no retroceden.
export const PIPE_NEW = '915721075';
export const PIPE_OLD = '690980478';
export const ETAPAS_NEW = {
  '1452905319': 'NEW', '1397429350': 'WORK', '1394066092': 'KICK', '1394165346': 'SOL',
  '1394165347': 'PROC', '1394165348': 'CIC', '1394066093': 'CIE', '1458264186': 'NC',
};
export const ETAPAS_OLD = { '1011270711': 'O_NUEVO', '1350730762': 'O_PROC', '1011304569': 'O_COMP', '1011304570': 'O_NC' };
const PAIS = { colombia: 'COL', mexico: 'MEX', republicaDominicana: 'DOM', costaRica: 'CRI' };

// Propiedades que se piden a HubSpot (se usan también en hubspot.js)
export const PROPIEDADES = [
  'hs_object_id', 'nombre_del_cliente', 'hs_pipeline', 'hs_pipeline_stage', 'hs_createdate', 'hubspot_owner_id',
  'segmento', 'version_sync', 'pais_capacitacion', 'es_pago', 'fecha_de_solicitud', 'fecha_de_finalizacion', 'id_company_sync',
  'tipo_de_migracion', 'mnl__estado_de_agendamiento', 'estado_de_la_solicitud_de_informacion',
  'motivo_de_migracion_perdida', 'motivo_de_implementacion_no_completada',
  'resultado_kickoff', 'resultado_primera_sesion', 'fecha_primera_sesion', 'fecha_de_sesion__kickoff',
  'clc__conteo_sesiones_kickoff', 'clc__conteo_sesiones_cliclo_de_adopcion', 'fecha_sesion_1', 'resultado_sesion_1', 'conteo_primera_sesion',
  'adopcion__cantidad_de_empresas_a_migrar', 'adopcion__empresas_migradas_conteo', 'hs_tag_ids',
  ...Object.keys(ETAPAS_NEW).map((s) => 'hs_v2_date_entered_' + s),
  ...Object.keys(ETAPAS_OLD).map((s) => 'hs_v2_date_entered_' + s),
];

const day = (v) => (v ? String(v).slice(0, 10) : null);
const ent = (x, id) => day(x['hs_v2_date_entered_' + id]);
const sinAcentos = (s) => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Sesión realizada (2026-11-10): resultado Completada/Completed/Completadas/Realizada en cualquier campo de sesión.
// Los conteos de sesiones NO sirven: cuentan también agendadas y no-show.
const OKS = /^(completada|completed|completadas|realizada)$/i;
const ETAPAS_POST_KICKOFF = ['1394165346', '1394165347', '1394165348'];

/** Marca en cada registro si su empresa está activada (lista que sube el agente desde Metabase). Modifica y devuelve recs. */
export function aplicarActivacion(recs, activas) {
  if (!activas) return recs;
  const ACT = new Set(activas);
  for (const r of recs) if (r.idc) r.act = ACT.has(+r.idc) ? 1 : 0;
  return recs;
}

/** Fecha y hora de Bogotá como AAAA-MM-DDTHH:mm:ss (el tablero usa el día de Bogotá, no el UTC del servidor). */
export function ahoraBogota(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/**
 * @param {object[]} tickets  propiedades de cada ticket tal como las devuelve HubSpot
 * @param {Record<string,string>} owners  id de owner -> nombre
 * @param {number[]|null} activas  ids de empresa activadas (snapshot de Metabase), o null si no hay
 */
export function normalizar(tickets, owners = {}, activas = null) {
  const ACT = activas ? new Set(activas) : null;
  const recs = [];
  for (const x of tickets) {
    const isNew = x.hs_pipeline === PIPE_NEW;
    const st = isNew ? ETAPAS_NEW[x.hs_pipeline_stage] : ETAPAS_OLD[x.hs_pipeline_stage];
    if (!st) continue;
    const r = {
      id: x.hs_object_id,
      n: (x.nombre_del_cliente || '').slice(0, 70),
      p: isNew ? 'N' : 'O',
      st,
      seg: x.segmento === 'Contador' ? 'Contador' : x.segmento === 'Pyme' ? 'Pyme' : 'Sin segmento',
      pa: PAIS[x.version_sync] || 'Otro',
      ow: x.hubspot_owner_id ? (owners[x.hubspot_owner_id] || 'Owner ' + x.hubspot_owner_id) : '',
      cre: day(x.hs_createdate),
      idc: x.id_company_sync || '',
    };
    if (isNew) {
      r.d = {};
      for (const [sid, k] of Object.entries(ETAPAS_NEW)) { const v = ent(x, sid); if (v) r.d[k] = v; }
      // Carga retroactiva: creado directo en Cierre / No completado (no pasó por ninguna etapa de trabajo)
      const trabajo = ['WORK', 'KICK', 'SOL', 'PROC', 'CIC'].some((k) => r.d[k]);
      r.retro = (st === 'CIE' || st === 'NC') && !trabajo ? 1 : 0;
      r.mot = x.motivo_de_migracion_perdida || x.motivo_de_implementacion_no_completada || '';
    } else {
      r.d = {
        O_NUEVO: ent(x, '1011270711'), O_PROC: ent(x, '1350730762'),
        O_COMP: ent(x, '1011304569'), O_NC: ent(x, '1011304570'),
      };
      for (const k of Object.keys(r.d)) if (!r.d[k]) delete r.d[k];
      r.sol = day(x.fecha_de_solicitud) || r.cre;
      r.ff = day(x.fecha_de_finalizacion) || '';
      // El equipo abre un ticket de migración y otro de implementación por empresa: el título dice cuál es
      // (acordado con Jhonatan 21-oct-2026; tipo_de_migracion solo se llena al cerrar)
      const tn = sinAcentos(x.nombre_del_cliente), im = tn.indexOf('migr'), ii = tn.indexOf('implement'), tv = sinAcentos(x.tipo_de_migracion);
      r.tp = (im >= 0 || ii >= 0) ? ((ii < 0 || (im >= 0 && im < ii)) ? 'M' : 'I')
        : tv.startsWith('implement') ? 'I' : tv.startsWith('migraci') ? 'M' : '?';
      r.ses = x.fecha_primera_sesion || x.resultado_primera_sesion || x.fecha_de_sesion__kickoff ? 1 : 0;
      r.mot = x.motivo_de_migracion_perdida || x.motivo_de_implementacion_no_completada || '';
    }
    // Sesión hecha: resultado completado en algún campo de sesión, o pasó del kick-off (Solicitud, Proceso o Ciclo)
    r.sh = [x.resultado_primera_sesion, x.resultado_sesion_1, x.resultado_kickoff].some((v) => OKS.test(String(v || '').trim()))
      || ETAPAS_POST_KICKOFF.some((s) => x['hs_v2_date_entered_' + s]) ? 1 : 0;
    // Fecha de la primera sesión realizada (cohorte del scorecard por analista)
    const sd = [];
    if (OKS.test(String(x.resultado_kickoff || '').trim())) sd.push(x.fecha_de_sesion__kickoff);
    if (OKS.test(String(x.resultado_primera_sesion || '').trim())) sd.push(x.fecha_primera_sesion);
    if (OKS.test(String(x.resultado_sesion_1 || '').trim())) sd.push(x.fecha_sesion_1);
    for (const s of ETAPAS_POST_KICKOFF) sd.push(x['hs_v2_date_entered_' + s]);
    r.s1 = sd.filter(Boolean).map(day).filter((v) => v >= '2025-01-01').sort()[0] || null;
    // Etapa donde abandonó (solo Adopción New): la etapa de trabajo más avanzada antes de No completado
    if (isNew && st === 'NC') {
      const ORDK = ['WORK', 'KICK', 'SOL', 'PROC', 'CIC'];
      r.abSt = ORDK.filter((k) => r.d[k]).pop() || null;
    }
    if (ACT && r.idc) r.act = ACT.has(+r.idc) ? 1 : 0;
    recs.push(r);
  }
  return recs;
}
