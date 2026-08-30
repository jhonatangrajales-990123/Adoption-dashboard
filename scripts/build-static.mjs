// ─────────────────────────────────────────────────────────────────────────────
// Genera el dashboard como UN SOLO index.html autocontenido, para Dashboards Hub.
//
// Por qué un archivo único y no una exportación normal de Next: el Hub sirve el
// repo como sitio estático y no sabemos bajo qué ruta base. Un index.html con
// todo adentro (CSS, JS y datos) es inmune a eso y cumple su requisito de
// "solo HTML/CSS/JS con un index.html".
//
// Importante: es la MISMA app de siempre. No hay una segunda versión que se
// desincronice — page.js detecta los datos embebidos y se salta la llamada a la
// API. Todo lo demás (las 5 vistas, el embudo, los gráficos) es el mismo código.
//
//   node scripts/build-static.mjs
//
// Salida: dist-hub/index.html
// ─────────────────────────────────────────────────────────────────────────────
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'dist-hub');
const log = (...a) => console.log('  ', ...a);

// ── 1. Traer los datos de HubSpot ────────────────────────────────────────────
async function traerDatos() {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    // Permite regenerar sin token reusando el último snapshot (útil para probar el HTML)
    const cache = path.join(SALIDA, 'datos.json');
    if (fs.existsSync(cache)) {
      log('Sin HUBSPOT_TOKEN — reuso el snapshot anterior');
      return JSON.parse(fs.readFileSync(cache, 'utf8'));
    }
    throw new Error('Falta HUBSPOT_TOKEN y no hay snapshot previo en dist-hub/datos.json');
  }
  log('Consultando HubSpot…');
  const { fetchRecords } = await import('../lib/hubspot.js');
  const records = await fetchRecords(token);
  return { refreshed_at: new Date().toISOString(), total: records.length, records };
}

// Solo los campos que las vistas usan: baja el peso a la mitad sin perder nada.
const CAMPOS = [
  'id', 'stage', 'estado', 'pais_label', 'segmento', 'analista', 'icp', 'es_pago',
  'fuente', 'tipo', 'estado_migracion', 'cliente', 'mrr', 'csat', 'num_empresas',
  'mes_solicitud', 'mes_cierre', 'fecha_solicitud', 'fecha_finalizacion',
  'fecha_entrada_etapa', 'fecha_primera_sesion', 'dias_primera_sesion',
  'dias_a_cierre', 'dias_a_en_proceso', 'tiene_primera_sesion',
  'resultado_primera_sesion', 'no_show', 'sesiones_registradas',
  'sin_fecha_solicitud', 'id_company_sync',
];
const adelgazar = (r) => {
  const o = {};
  for (const c of CAMPOS) {
    const v = r[c];
    // Se omiten vacíos: el lector los trata igual y el archivo pesa la mitad
    if (v !== '' && v !== null && v !== undefined && v !== false) o[c] = v;
  }
  return o;
};

// ── 2. Empaquetar la app en un solo JS ───────────────────────────────────────
async function empaquetar() {
  log('Empaquetando la app…');
  const entrada = path.join(SALIDA, '.entry.jsx');
  fs.writeFileSync(entrada, `
import React from 'react';
import { createRoot } from 'react-dom/client';
import Page from '${path.join(RAIZ, 'app', 'page.js').replace(/\\/g, '/')}';
createRoot(document.getElementById('root')).render(React.createElement(Page));
`, 'utf8');

  const r = await build({
    entryPoints: [entrada],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110', 'firefox110', 'safari16', 'edge110'],
    jsx: 'automatic',
    minify: true,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    // El alias @/ que usa el proyecto
    alias: { '@': RAIZ },
    loader: { '.js': 'jsx' },
  });
  fs.unlinkSync(entrada);
  return r.outputFiles[0].text;
}

// ── 3. Armar el HTML ─────────────────────────────────────────────────────────
const esc = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

function armarHtml({ js, css, datos, fecha }) {
  return `<!doctype html>
<html lang="es" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Adoption · Alegra</title>
<link rel="icon" href="https://cdn1.alegra.com/images/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>
// Preferencia de tema guardada, antes del primer pintado
(function(){try{var t=localStorage.getItem('ae_theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}})();
// Datos de HubSpot embebidos — generados el ${fecha}
window.__ADOPTION_DATA__ = ${esc(JSON.stringify(datos))};
</script>
<script>${js}</script>
</body>
</html>`;
}

// ── Correr ───────────────────────────────────────────────────────────────────
(async () => {
  console.log('\nGenerando el dashboard estático para Dashboards Hub\n');
  fs.mkdirSync(SALIDA, { recursive: true });

  const crudo = await traerDatos();
  fs.writeFileSync(path.join(SALIDA, 'datos.json'), JSON.stringify(crudo), 'utf8');
  log(`${crudo.records.length} tickets traídos`);

  const datos = { refreshed_at: crudo.refreshed_at, total: crudo.total, records: crudo.records.map(adelgazar) };

  const js = await empaquetar();
  const css = fs.readFileSync(path.join(RAIZ, 'app', 'globals.css'), 'utf8');
  const fecha = new Date(datos.refreshed_at).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' });

  const html = armarHtml({ js, css, datos, fecha });
  const destino = path.join(SALIDA, 'index.html');
  fs.writeFileSync(destino, html, 'utf8');

  const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
  console.log('');
  log('JS   ', mb(js.length));
  log('CSS  ', (css.length / 1024).toFixed(0) + ' KB');
  log('Datos', mb(JSON.stringify(datos).length));
  log('TOTAL', mb(html.length), html.length > 20 * 1024 * 1024 ? '⚠️ pasa el límite de 20 MB del Hub' : '✓ dentro del límite de 20 MB');
  console.log(`\n→ ${destino}\n`);
})().catch((e) => { console.error('\nERROR:', e.message, '\n'); process.exit(1); });
