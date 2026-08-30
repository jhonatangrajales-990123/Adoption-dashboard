// ─────────────────────────────────────────────────────────────────────────────
// Genera el dashboard como UN SOLO index.html autocontenido, para Dashboards Hub.
//
// Por qué un archivo único y no una exportación normal de Next: el Hub sirve el
// repo como sitio estático y no sabemos bajo qué ruta base. Un index.html con
// todo adentro (CSS, JS y datos) es inmune a eso y cumple su requisito de
// "solo HTML/CSS/JS con un index.html".
//
// Por qué los datos van comprimidos: GitHub solo entrega por su API archivos de
// hasta 1 MB. Sin comprimir el HTML pesaba 2,1 MB y el Hub fallaba con
// "Error fetching file". Con gzip + base64 baja a ~0,4 MB.
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
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'dist-hub');
const LIMITE_GITHUB = 1024 * 1024; // la API de contenidos de GitHub corta en 1 MB
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
const ENTRY = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import Page from '__PAGE__';

// Los datos vienen comprimidos en el HTML. Se descomprimen con DecompressionStream,
// que es nativo del navegador, y recién ahí se monta la app.
async function arrancar() {
  const raiz = document.getElementById('root');
  try {
    const bin = atob(window.__ADOPTION_GZ__);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    window.__ADOPTION_DATA__ = JSON.parse(await new Response(flujo).text());
    delete window.__ADOPTION_GZ__;
  } catch (e) {
    raiz.innerHTML =
      '<div style="padding:44px;font-family:Inter,system-ui,sans-serif;color:#0f172a">' +
      '<h1 style="font-size:19px;margin-bottom:10px">No se pudieron cargar los datos</h1>' +
      '<p style="color:#334155;font-size:14px;max-width:60ch">Este tablero necesita un navegador ' +
      'reciente. Abrelo en Chrome, Edge, Firefox o Safari actualizados.</p>' +
      '<p style="color:#64748b;font-size:12px;margin-top:14px">Detalle: ' + (e && e.message) + '</p></div>';
    return;
  }
  createRoot(raiz).render(React.createElement(Page));
}
arrancar();
`;

async function empaquetar() {
  log('Empaquetando la app…');
  const entrada = path.join(SALIDA, '.entry.jsx');
  const pageJs = path.join(RAIZ, 'app', 'page.js').replace(/\\/g, '/');
  fs.writeFileSync(entrada, ENTRY.replace('__PAGE__', pageJs), 'utf8');

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
    alias: { '@': RAIZ },
    loader: { '.js': 'jsx' },
  });
  fs.unlinkSync(entrada);
  return r.outputFiles[0].text;
}

// ── 3. Armar el HTML ─────────────────────────────────────────────────────────
function armarHtml({ js, css, gz, fecha }) {
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
// Datos de HubSpot (gzip + base64) — generados el ${fecha}
window.__ADOPTION_GZ__="${gz}";
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
  const jsonPlano = JSON.stringify(datos);
  const gz = zlib.gzipSync(Buffer.from(jsonPlano, 'utf8'), { level: 9 }).toString('base64');

  const js = await empaquetar();
  const css = fs.readFileSync(path.join(RAIZ, 'app', 'globals.css'), 'utf8');
  const fecha = new Date(datos.refreshed_at).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' });

  const html = armarHtml({ js, css, gz, fecha });
  fs.writeFileSync(path.join(SALIDA, 'index.html'), html, 'utf8');

  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log('');
  log('JS            ', kb(js.length));
  log('CSS           ', kb(css.length));
  log('Datos en claro', kb(jsonPlano.length));
  log('Datos gzip+b64', kb(gz.length), `(${(100 - (gz.length / jsonPlano.length) * 100).toFixed(0)}% menos)`);
  log('TOTAL         ', kb(html.length),
    html.length > LIMITE_GITHUB
      ? '⚠️ PASA EL LÍMITE DE 1 MB DE GITHUB — el Hub va a fallar'
      : '✓ por debajo del límite de 1 MB de GitHub');
  console.log(`\n→ ${path.join(SALIDA, 'index.html')}\n`);
})().catch((e) => { console.error('\nERROR:', e.message, '\n'); process.exit(1); });
