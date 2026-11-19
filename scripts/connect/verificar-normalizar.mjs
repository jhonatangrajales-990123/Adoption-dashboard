// Prueba: el módulo nuevo (lib/connect/normalizar.js) debe dar EXACTAMENTE lo mismo que el build.js anterior.
// Uso:  node scripts/connect/verificar-normalizar.mjs [carpeta-datos]
// Por defecto lee la carpeta de datos de la versión anterior (tickets.json, owners.json, act_analista.json, recs.json).
import fs from 'node:fs';
import path from 'node:path';
import { normalizar } from '../../lib/connect/normalizar.js';

const DIR = process.argv[2] || 'C:/Users/Alegra/Documents/Claude Code Alegra/datos/connect_dashboard';
const rd = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8').replace(/^﻿/, ''));

const tickets = rd('tickets.json');
const owners = rd('owners.json');
const fAct = path.join(DIR, 'act_analista.json');
const activas = fs.existsSync(fAct) ? rd('act_analista.json').activas : null;
const esperado = rd('recs.json').recs;

const nuevo = normalizar(tickets, owners, activas);

let difs = 0;
if (nuevo.length !== esperado.length) { console.log(`✗ cantidad: nuevo ${nuevo.length} vs anterior ${esperado.length}`); difs++; }
const n = Math.min(nuevo.length, esperado.length);
for (let i = 0; i < n; i++) {
  const a = JSON.stringify(nuevo[i]), b = JSON.stringify(esperado[i]);
  if (a !== b) { if (difs < 5) console.log(`✗ registro ${i} (${esperado[i].id})\n  nuevo:    ${a}\n  anterior: ${b}`); difs++; }
}
console.log(difs === 0 ? `✓ idéntico: ${nuevo.length} registros` : `✗ ${difs} diferencias`);
process.exit(difs === 0 ? 0 : 1);
