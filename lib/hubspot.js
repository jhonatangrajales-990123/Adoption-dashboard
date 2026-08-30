// Fetch + limpieza de tickets del pipeline de Adoption desde HubSpot.
// Portado de Hermes/scripts/refresh_data.py, usando fetch (serverless-friendly)
// y el token desde process.env.HUBSPOT_TOKEN (nunca hardcodeado).

const OBJECT = '2-40542822';
const PIPELINE_ID = '690980478';
const URL = `https://api.hubapi.com/crm/v3/objects/${OBJECT}/search`;

const STAGE_MAP = {
  '1011270711': 'Nuevo',
  '1350730762': 'En proceso',
  '1011304569': 'Completada',
  '1011304570': 'No completada',
};

// Respaldo por si /crm/v3/owners fallara (la fuente primaria es fetchOwnersMap,
// en vivo desde HubSpot). Nombres completos tal como los devuelve HubSpot.
const OWNERS = {
  '177846354': 'Valeria Gallardo Molina',
  '658340665': 'Montserrat Cazares',
  '86100137': 'Leiby Aguilar',
  '181653095': 'María Briceño',
  '399036355': 'Luis M. Kelly',
  '8997355': 'Diana Torres',
  '95288315': 'Fernando Ibarra',
  '111566340': 'Eliana Katherine Rivera',
  '743842366': 'Eva Serje',
  '1320030740': 'Valentina Benitez',
};

const PAIS_LABEL = {
  mexico: 'México',
  colombia: 'Colombia',
  republicaDominicana: 'Rep. Dominicana',
  costaRica: 'Costa Rica',
  panama: 'Panamá',
  peru: 'Perú',
  argentina: 'Argentina',
  other: 'Otro país',
  sin_version: 'Sin país',
};

const PROPS = [
  'hs_pipeline', 'hs_pipeline_stage', 'hs_createdate',
  'fecha_de_solicitud', 'fecha_de_finalizacion',
  'hubspot_owner_id', 'mrr_sync', 'version_sync',
  'csat_score',
  // Sesiones: HubSpot guarda hasta 3 fechas + el resultado de la 1ª. Con esto se
  // cuenta cuántas sesiones tuvo CADA ticket y si el cliente no se presentó, sin
  // depender del CSV manual de Connect.
  'fecha_primera_sesion', 'fecha_sesion_1', 'fecha_segunda_sesion', 'fecha_tercera_sesion',
  'resultado_primera_sesion',
  // Verificados vacíos en los 3.270 tickets (ago-2026), se dejan por si se empiezan
  // a llenar: reuniones_asistidas, total_de_reuniones_no_asistidas,
  // numero_de_empresas_a_migrar, sistema_anterior.
  'reuniones_asistidas', 'total_de_reuniones_no_asistidas',
  'fuente_de_migracion', 'tipo_de_migracion',
  'numero_de_empresas_a_migrar', 'sistema_anterior',
  'segmento', 'icp_sync_2', 'nombre_del_cliente',
  'id_company_sync', 'es_pago', 'estado_proceso_migracion',
  'hs_date_entered_1350730762', 'hs_date_entered_1011304569',
];

function hsPost(body, token) {
  return fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`HubSpot ${r.status}: ${await r.text()}`);
    return r.json();
  });
}

function hsGet(url, token) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async (r) => {
    if (!r.ok) throw new Error(`HubSpot ${r.status}: ${await r.text()}`);
    return r.json();
  });
}

// Trae TODOS los owners de HubSpot (activos + archivados/desactivados) y arma un mapa
// id → nombre completo. Esto es lo que permite que el equipo se actualice solo: gente
// nueva y gente que ya no está pero cuyos tickets históricos siguen existiendo (no se
// pueden borrar ni reasignar por trazabilidad) aparecen con su nombre real, sin tener
// que tocar código cada vez que cambia el equipo.
export async function fetchOwnersMap(token) {
  const map = {};
  for (const archived of [false, true]) {
    let after = null;
    for (let i = 0; i < 20; i++) {
      const params = new URLSearchParams({ limit: '200', ...(archived ? { archived: 'true' } : {}), ...(after ? { after } : {}) });
      const d = await hsGet(`https://api.hubapi.com/crm/v3/owners?${params}`, token);
      for (const o of d.results || []) {
        const name = `${o.firstName || ''} ${o.lastName || ''}`.trim();
        if (name) map[String(o.id)] = name;
      }
      after = d.paging?.next?.after;
      if (!after) break;
    }
  }
  return map;
}

export async function fetchRaw(token) {
  const results = [];
  let after = null;
  // Guardrail: máximo 100 páginas (20.000 tickets)
  for (let i = 0; i < 100; i++) {
    const body = {
      filterGroups: [{ filters: [{ propertyName: 'hs_pipeline', operator: 'EQ', value: PIPELINE_ID }] }],
      properties: PROPS,
      limit: 200,
      sorts: [{ propertyName: 'fecha_de_solicitud', direction: 'DESCENDING' }],
      ...(after ? { after } : {}),
    };
    const d = await hsPost(body, token);
    results.push(...(d.results || []));
    after = d.paging?.next?.after;
    if (!after) break;
  }
  return results;
}

// --- helpers de fecha ---
function toDate(s) {
  if (!s) return null;
  if (/^-?\d+$/.test(String(s))) return new Date(parseInt(s, 10));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function ymd(s) {
  const d = toDate(s);
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const da = toDate(a), db = toDate(b);
  if (!da || !db) return null;
  return Math.floor((db - da) / 86400000);
}
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
// Igual que num() pero NO inventa un 0 cuando el dato falta. Se usa para MRR,
// número de empresas y reuniones: ahí "no hay dato" y "es cero de verdad" son
// cosas distintas, y convertir el vacío en 0 hacía que los promedios mintieran.
function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// Inferencia de segmento SOLO dentro de la app (no se escribe de vuelta a HubSpot).
// El campo `segmento` de HubSpot viene vacío en ~28 tickets; el patrón es claro para
// la mayoría: tickets "PODS" (asesoría a un contador) y tickets de Implementación/
// Migración de una empresa (típico del programa Contador MultiRFC) son Contador.
// Los que no calzan ninguno de los 2 patrones se dejan honestamente "Sin segmento".
function inferSegmento(segmentoRaw, nombreCliente, tipoMigracion) {
  if (segmentoRaw) return segmentoRaw;
  const n = nombreCliente || '';
  const t = tipoMigracion || '';
  if (/pod/i.test(n)) return 'Contador';
  if (/implementaci|migraci/i.test(n) || /implementaci|migraci/i.test(t)) return 'Contador';
  return 'Sin segmento';
}

// El resultado de la 1ª sesión viene escrito de 5 formas distintas en HubSpot
// (español/inglés, mayúsculas/minúsculas) porque se cargó desde varias fuentes.
// Acá se normaliza a un solo vocabulario para poder contarlo.
const RESULTADO_SESION = {
  'completada': 'Completada', 'completadas': 'Completada', 'completed': 'Completada',
  'no asistió': 'No asistió', 'no asistio': 'No asistió', 'no_show': 'No asistió',
  'agendado': 'Agendada', 'agendada': 'Agendada',
  'rescheduled': 'Reagendada', 'reagendada': 'Reagendada',
  'canceled': 'Cancelada', 'cancelled': 'Cancelada', 'cancelada': 'Cancelada',
};
function normResultado(v) {
  if (!v) return '';
  return RESULTADO_SESION[String(v).trim().toLowerCase()] || String(v).trim();
}

function cleanRecord(rec, ownersMap) {
  const p = rec.properties || {};
  const stage = STAGE_MAP[p.hs_pipeline_stage] || p.hs_pipeline_stage || '?';
  const cerrado = stage === 'Completada' || stage === 'No completada';
  const version = p.version_sync || 'sin_version';
  // `fecha_de_solicitud` es la fecha de negocio. Cuando viene vacía usamos la fecha
  // real de creación del objeto en HubSpot como respaldo, para que el ticket no
  // desaparezca de todas las vistas por mes (antes quedaba con mes vacío y no lo
  // contaba nadie). Marcamos el respaldo para poder mostrarlo como dato a corregir.
  const fsReal = p.fecha_de_solicitud || '';
  const fs = fsReal || p.hs_createdate || '';
  const ff = p.fecha_de_finalizacion || '';
  const fp = p.fecha_primera_sesion || p.fecha_sesion_1 || '';
  const f2 = p.fecha_segunda_sesion || '';
  const f3 = p.fecha_tercera_sesion || '';
  const resultado1 = normResultado(p.resultado_primera_sesion);
  const fEnProceso = p.hs_date_entered_1350730762 || '';
  const fCompletada = p.hs_date_entered_1011304569 || '';
  const diasPrimera = fp && fs ? daysBetween(fs, fp) : null;
  const csat = parseFloat(p.csat_score);

  // Cuándo entró el ticket a la etapa en la que está HOY. Para "Nuevo" la entrada
  // es la solicitud misma; para "En proceso" y "Completada" HubSpot nos da la marca
  // de tiempo exacta. Esto permite medir días EN LA ETAPA en vez de días desde la
  // solicitud (antes un ticket que pasó 2 días en Nuevo y 60 en proceso marcaba 62).
  const entradaEtapa = stage === 'Nuevo' ? fs
    : stage === 'En proceso' ? (fEnProceso || fs)
    : stage === 'Completada' ? (fCompletada || ff || fs)
    : (ff || fs); // No completada: HubSpot no expone marca de entrada

  return {
    id: rec.id,
    stage,
    estado: cerrado ? 'Cerrado' : 'Abierto',
    pais: version,
    pais_label: PAIS_LABEL[version] || version,
    segmento: inferSegmento(p.segmento, p.nombre_del_cliente, p.tipo_de_migracion),
    // Nombre real desde HubSpot (activos + archivados). El mapa a mano (OWNERS) es solo
    // un respaldo si la API de owners fallara; "Otro" ya casi no debería verse.
    analista: (ownersMap && ownersMap[p.hubspot_owner_id]) || OWNERS[p.hubspot_owner_id] || (p.hubspot_owner_id ? 'Otro' : 'Sin asignar'),
    // Id estable del owner: el nombre puede cambiar (matrimonio, corrección de tildes)
    // y dos personas pueden llamarse igual. Para agrupar, el id es la verdad.
    owner_id: p.hubspot_owner_id || '',
    icp: p.icp_sync_2 || 'Sin ICP',
    es_pago: p.es_pago || 'Sin dato',
    fuente: p.fuente_de_migracion || 'Sin fuente',
    tipo: p.tipo_de_migracion || 'N/A',
    estado_migracion: p.estado_proceso_migracion || 'Sin dato',
    sistema_anterior: p.sistema_anterior || '',
    cliente: p.nombre_del_cliente || '',
    // null = no hay dato (distinto de 0)
    mrr: numOrNull(p.mrr_sync),
    num_empresas: numOrNull(p.numero_de_empresas_a_migrar),
    reuniones_agendadas: numOrNull(p.reuniones_agendadas),
    reuniones_asistidas: numOrNull(p.reuniones_asistidas),
    no_asistidas: numOrNull(p.total_de_reuniones_no_asistidas),
    csat: isNaN(csat) ? null : csat,
    // fechas normalizadas
    fecha_solicitud: ymd(fs),           // fecha de negocio (o creación, si falta)
    mes_solicitud: ymd(fs).slice(0, 7), // YYYY-MM
    sin_fecha_solicitud: !fsReal,       // true = usamos el respaldo; hay que corregir en HubSpot
    fecha_finalizacion: ymd(ff),
    mes_cierre: ymd(ff).slice(0, 7),    // habilita la lente "¿qué cerramos este mes?"
    fecha_primera_sesion: ymd(fp),
    fecha_segunda_sesion: ymd(f2),
    fecha_tercera_sesion: ymd(f3),
    // Sesiones que este ticket realmente tuvo (el modelo tradicional son máx. 3).
    // Es el equivalente por-ticket de lo que hoy se lleva a mano en el CSV Connect.
    sesiones_registradas: (fp ? 1 : 0) + (f2 ? 1 : 0) + (f3 ? 1 : 0),
    // Resultado de la 1ª sesión, ya normalizado: Completada / No asistió / Agendada /
    // Reagendada / Cancelada. Es la fuente de no-show por ticket que antes no existía.
    resultado_primera_sesion: resultado1,
    no_show: resultado1 === 'No asistió',
    fecha_entrada_etapa: ymd(entradaEtapa),
    // métricas de tiempo (días)
    dias_primera_sesion: diasPrimera != null && diasPrimera >= 0 ? diasPrimera : (diasPrimera != null ? 0 : null),
    dias_a_cierre: (fs && ff) ? Math.max(0, daysBetween(fs, ff) ?? 0) : null,
    // Días que tardó en arrancar el trabajo (solicitud → entró a "En proceso")
    dias_a_en_proceso: (fs && fEnProceso) ? Math.max(0, daysBetween(fs, fEnProceso) ?? 0) : null,
    tiene_primera_sesion: !!fp,
    id_company_sync: p.id_company_sync || '',
  };
}

export async function fetchRecords(token) {
  const [raw, ownersMap] = await Promise.all([fetchRaw(token), fetchOwnersMap(token)]);
  return raw.map((r) => cleanRecord(r, ownersMap));
}

export { PAIS_LABEL, OWNERS };
