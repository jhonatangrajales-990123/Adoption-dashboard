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

// Equipo actual (los owners históricos que no estén aquí caen en "Otro/Sin asignar")
const OWNERS = {
  '177846354': 'Valeria Gallardo',
  '658340665': 'Montserrat Cazares',
  '86100137': 'Leiby Aguilar',
  '181653095': 'Maria Briceño',
  '399036355': 'Luis Kelly',
  '8997355': 'Diana Torres',
};

const PAIS_LABEL = {
  mexico: 'México',
  colombia: 'Colombia',
  republicaDominicana: 'Rep. Dominicana',
  costaRica: 'Costa Rica',
  panama: 'Panamá',
  sin_version: 'Sin país',
};

const PROPS = [
  'hs_pipeline', 'hs_pipeline_stage', 'hs_createdate',
  'fecha_de_solicitud', 'fecha_de_finalizacion',
  'hubspot_owner_id', 'mrr_sync', 'version_sync',
  'csat_score',
  'fecha_primera_sesion', 'fecha_sesion_1',
  'reuniones_asistidas', 'reuniones_agendadas', 'total_de_reuniones_no_asistidas',
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

function cleanRecord(rec) {
  const p = rec.properties || {};
  const stage = STAGE_MAP[p.hs_pipeline_stage] || p.hs_pipeline_stage || '?';
  const cerrado = stage === 'Completada' || stage === 'No completada';
  const version = p.version_sync || 'sin_version';
  const fs = p.fecha_de_solicitud || '';
  const ff = p.fecha_de_finalizacion || '';
  const fp = p.fecha_primera_sesion || p.fecha_sesion_1 || '';
  const diasPrimera = fp && fs ? daysBetween(fs, fp) : null;
  const csat = parseFloat(p.csat_score);

  return {
    id: rec.id,
    stage,
    estado: cerrado ? 'Cerrado' : 'Abierto',
    pais: version,
    pais_label: PAIS_LABEL[version] || version,
    segmento: p.segmento || 'Sin segmento',
    analista: OWNERS[p.hubspot_owner_id] || (p.hubspot_owner_id ? 'Otro' : 'Sin asignar'),
    icp: p.icp_sync_2 || 'Sin ICP',
    es_pago: p.es_pago || 'Sin dato',
    fuente: p.fuente_de_migracion || 'Sin fuente',
    tipo: p.tipo_de_migracion || 'N/A',
    estado_migracion: p.estado_proceso_migracion || 'Sin dato',
    sistema_anterior: p.sistema_anterior || '',
    cliente: p.nombre_del_cliente || '',
    mrr: num(p.mrr_sync),
    num_empresas: num(p.numero_de_empresas_a_migrar),
    reuniones_asistidas: num(p.reuniones_asistidas),
    no_asistidas: num(p.total_de_reuniones_no_asistidas),
    csat: isNaN(csat) ? null : csat,
    // fechas normalizadas
    fecha_solicitud: ymd(fs),          // creación (para filtros de mes)
    mes_solicitud: ymd(fs).slice(0, 7), // YYYY-MM
    fecha_finalizacion: ymd(ff),
    fecha_primera_sesion: ymd(fp),
    // métricas de tiempo (días)
    dias_primera_sesion: diasPrimera != null && diasPrimera >= 0 ? diasPrimera : (diasPrimera != null ? 0 : null),
    dias_a_cierre: (fs && ff) ? Math.max(0, daysBetween(fs, ff) ?? 0) : null,
    tiene_primera_sesion: !!fp,
    id_company_sync: p.id_company_sync || '',
  };
}

export async function fetchRecords(token) {
  const raw = await fetchRaw(token);
  return raw.map(cleanRecord);
}

export { PAIS_LABEL, OWNERS };
