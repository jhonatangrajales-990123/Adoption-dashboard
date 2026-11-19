// Exporta los "snapshots" que salen de Metabase para subirlos a la app: retención, activación y activación por analista.
// Es la parte de retención de scripts/connect_dashboard/build.js (carpeta anterior), SIN tocar la lógica:
// lee los archivos de datos\connect_retencion y datos\connect_dashboard y escribe tres JSON.
//
// Uso:  node scripts/connect/exportar-snapshots.cjs [carpeta-base] [carpeta-salida]
//   carpeta-base   por defecto C:/Users/Alegra/Documents/Claude Code Alegra
//   carpeta-salida por defecto ./dist-snapshots
// Después:  powershell -File scripts\connect\subir-snapshots.ps1
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || 'C:/Users/Alegra/Documents/Claude Code Alegra';
const OUT = path.resolve(process.argv[3] || 'dist-snapshots');
const D = path.join(ROOT, 'datos', 'connect_dashboard');
const R = path.join(ROOT, 'datos', 'connect_retencion');
const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

function csv(f) {
  const t = fs.readFileSync(f, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const h = t[0].split(',');
  return t.slice(1).map((l) => { const v = l.split(','); const o = {}; h.forEach((k, i) => (o[k] = v[i])); return o; });
}

// --- Retención por cohortes (corte 2026-10-22/27) ---
// "Pidió y no completó" se parte en: tuvo al menos una sesión vs nunca tuvo sesión.
// La parte "con sesión" = total no completó - sin sesión, celda por celda.
const coh0 = csv(path.join(R, 'dash', 'retencion_cohortes.csv'));
const sinS = csv(path.join(R, 'dash', 'retencion_sin_sesion.csv'));
const kk = (r) => [r.semestre, r.tramo_mrr, r.tiene_contador].join('|');
const cohortes = coh0.filter((r) => !/no completó$/.test(r.grupo));
for (const [nc, ns, cs] of [['Pidió pyme y no completó', 'Pidió pyme y nunca tuvo sesión', 'Pidió pyme, tuvo sesión y no completó'],
  ['Pidió contador y no completó', 'Pidió contador y nunca tuvo sesión', 'Pidió contador, tuvo sesión y no completó']]) {
  const sm = new Map(sinS.filter((r) => r.grupo === ns).map((r) => [kk(r), r]));
  for (const r of coh0.filter((x) => x.grupo === nc)) {
    const s = sm.get(kk(r)) || {};
    const o = { ...r, grupo: cs };
    for (const k of ['pagaban_m0', 'siguen_m3', 'siguen_m6', 'siguen_m12']) o[k] = String(Math.max(0, +r[k] - (+s[k] || 0)));
    cohortes.push(o);
  }
  cohortes.push(...sinS.filter((r) => r.grupo === ns));
}
const ret = {
  corte: '2026-10-22',
  cohortes,
  mensual: (() => { const m = rd(path.join(R, 'dash', 'cohortes_mensual.json')); return { ultimoMes: 202610, corte: m.corte, rows: m.rows }; })(),
  cascada: csv(path.join(R, 'anio', 'cascada_anual.csv')),
  corteCascada: '2026-10-27',
};

// --- Foto de hoy y zoom de por qué se fueron (método del reporte "Retención de Connect Q3") ---
{
  const EH = rd(path.join(R, 'estado_hoy.json')), HT = rd(path.join(R, 'dash', 'hoy_total.json'));
  const GM = rd(path.join(R, 'grupos_mensual.json')), gk = {};
  for (const k of ['P1', 'C1', 'P2', 'C2', 'O']) GM[k].forEach((i) => (gk[i] = k));
  const hoy = {}, add = (k, n) => (hoy[k] = (hoy[k] || 0) + n);
  const KEY = { P1: 'Pyme|0', P2: 'Pyme|1', C1: 'Contador|0', C2: 'Contador|1' };
  for (const [id, fp, , paga, acc] of EH.rows) {
    const g = gk[id]; if (!g) continue;
    if (KEY[g]) add(`${KEY[g]}|${fp}`, paga);
    add(`Pyme|resta|${fp}`, paga); if (acc) add(`Contador|resta|${fp}`, paga);
  }
  for (const [fpk, acc, , h] of HT.rows) { add(`Pyme|2|${fpk}`, h); if (acc) add(`Contador|2|${fpk}`, h); }
  for (const k of Object.keys(hoy)) if (k.includes('|resta|')) { const t = k.replace('|resta|', '|2|'); hoy[t] = (hoy[t] || 0) - hoy[k]; delete hoy[k]; }
  ret.hoy = { mes: HT.mes_hoy, corte: HT.corte, n: hoy };

  // Clasificación de quienes se fueron: Q3 (q3_churn_detalle) > oct (clasificacion_churn_connect) > nov (clasificacion_churn_nov)
  const cls = {};
  const Q3 = { 'Fallo de cobro': 'PAGO', Producto: 'PRODUCTO', Atribuible: 'SIN_EVIDENCIA', 'Sin pago desde 2025': 'SIN_EVIDENCIA',
    'ID errado en el ticket': 'NO_ES_CHURN', 'Empresa-cliente de contador': 'NO_ES_CHURN', 'Pasó a pagar vía contador': 'NO_ES_CHURN' };
  const fnov = path.join(R, 'clasificacion_churn_nov.csv');
  if (fs.existsSync(fnov)) for (const r of csv(fnov)) cls[r.id_empresa] = [r.categoria, r.motivo || ''];
  for (const r of csv(path.join(R, 'clasificacion_churn_connect.csv'))) cls[r.id_empresa] = [r.categoria, ''];
  for (const r of csv(path.join(R, 'dash', 'q3_churn_detalle.csv'))) {
    const c = Q3[r.clase] || 'SIN_EVIDENCIA';
    // en Q3 "Atribuible" no separa no adoptó / precio / sin evidencia: se conserva el detalle de oct si existe
    cls[r.id_empresa] = [c === 'SIN_EVIDENCIA' && cls[r.id_empresa] ? cls[r.id_empresa][0] : c, (r.motivo || '').slice(0, 140)];
  }
  // sub-causa y evidencia por empresa: subcausas_churn.csv (lectura caso por caso, 5-nov-2026)
  const sub = {}; const fsub = path.join(R, 'subcausas_churn.csv');
  if (fs.existsSync(fsub)) for (const r of csv(fsub)) sub[r.id_empresa] = [r.subcausa, r.evidencia];
  const ym = (k) => String(k).slice(0, 4) + '-' + String(k).slice(4);
  ret.zoom = EH.rows.filter((r) => KEY[gk[r[0]]] && r[3] === 0 && r[2] > 0 && r[1] >= 202501).map(([id, fp, ult, , , chm, del, vol]) => {
    const c = cls[String(id)] || ['SIN_CLASIFICAR', ''];
    const sc = sub[String(id)] || ['', ''];
    return [id, KEY[gk[id]], fp, ym(ult), del > 0 ? 'Delinquent' : vol > 0 ? 'Voluntary' : 'sin causa', c[0], c[1], sc[0], sc[1]];
  });
  // Como en Q3: si en realidad no se fue (paga vía su contador, ID errado) cuenta como retenida en "Hoy"
  for (const z of ret.zoom) if (z[5] === 'NO_ES_CHURN') hoy[`${z[1]}|${z[2]}`] = (hoy[`${z[1]}|${z[2]}`] || 0) + 1;
}

// --- Activación por trimestre y por analista ---
const fa = path.join(D, 'activacion.json');
const act = fs.existsSync(fa) ? rd(fa) : null;
const fAct = path.join(D, 'act_analista.json');
const actA = fs.existsSync(fAct) ? rd(fAct) : null;

fs.mkdirSync(OUT, { recursive: true });
const w = (n, v) => { fs.writeFileSync(path.join(OUT, n), JSON.stringify(v)); return (JSON.stringify(v).length / 1024).toFixed(0) + ' KB'; };
console.log('ret.json ', w('ret.json', ret), `· ${ret.cohortes.length} filas de cohortes, ${ret.mensual.rows.length} cohortes mensuales, ${ret.zoom.length} empresas en el zoom`);
if (act) console.log('act.json ', w('act.json', act), `· ${act.filas.length} filas`);
else console.log('act.json  (no existe activacion.json, se omite)');
if (actA) console.log('actA.json', w('actA.json', actA), `· corte ${actA.corte}, ${actA.activas.length} empresas activas`);
else console.log('actA.json (no existe act_analista.json, se omite)');
console.log('Salida en', OUT);
