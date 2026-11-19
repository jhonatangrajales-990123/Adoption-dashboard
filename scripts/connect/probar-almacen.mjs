// Prueba del almacén con REDIS_URL, sin necesidad de un Redis real: levanta un servidor Redis mínimo en memoria,
// guarda los registros reales del tablero, borra la caché y los vuelve a leer desde "Redis".
// Uso:  node scripts/connect/probar-almacen.mjs
import net from 'node:net';
import fs from 'node:fs';

// --- Servidor Redis falso: entiende lo justo (SET, GET, PING, HELLO, CLIENT, AUTH, SELECT) ---
const datos = new Map();
function parsear(buf) { // RESP: *N\r\n$len\r\nvalor\r\n...
  const cmds = []; let i = 0;
  while (i < buf.length) {
    if (buf[i] !== 0x2a) break;
    const fin = buf.indexOf('\r\n', i); const n = +buf.toString('latin1', i + 1, fin); let p = fin + 2; const args = [];
    for (let k = 0; k < n; k++) {
      const f2 = buf.indexOf('\r\n', p); const len = +buf.toString('latin1', p + 1, f2); const ini = f2 + 2;
      if (ini + len + 2 > buf.length) return { cmds, resto: buf.subarray(i) };
      args.push(buf.subarray(ini, ini + len)); p = ini + len + 2;
    }
    cmds.push(args); i = p;
  }
  return { cmds, resto: buf.subarray(i) };
}
const servidor = net.createServer((s) => {
  let pend = Buffer.alloc(0);
  s.on('data', (d) => {
    const { cmds, resto } = parsear(Buffer.concat([pend, d])); pend = resto;
    for (const a of cmds) {
      const c = a[0].toString().toUpperCase();
      if (c === 'SET') { datos.set(a[1].toString(), a[2]); s.write('+OK\r\n'); }
      else if (c === 'GET') { const v = datos.get(a[1].toString()); s.write(v ? `$${v.length}\r\n` : '$-1\r\n'); if (v) { s.write(v); s.write('\r\n'); } }
      else if (c === 'PING') s.write('+PONG\r\n');
      else if (c === 'HELLO') s.write('*14\r\n$6\r\nserver\r\n$5\r\nredis\r\n$7\r\nversion\r\n$5\r\n7.0.0\r\n$5\r\nproto\r\n:2\r\n$2\r\nid\r\n:1\r\n$4\r\nmode\r\n$10\r\nstandalone\r\n$4\r\nrole\r\n$6\r\nmaster\r\n$7\r\nmodules\r\n*0\r\n');
      else s.write('+OK\r\n');
    }
  });
});
await new Promise((r) => servidor.listen(6399, '127.0.0.1', r));
process.env.REDIS_URL = 'redis://127.0.0.1:6399';

const { guardar, cargar } = await import('../../lib/connect/store.js');
const { modoAlmacen } = await import('../../lib/kvstore.js');
console.log('modo del almacén:', modoAlmacen());

const dir = 'C:/Users/Alegra/Documents/Claude Code Alegra/datos/connect_dashboard';
const original = JSON.parse(fs.readFileSync(dir + '/recs.json', 'utf8').replace(/^﻿/, ''));
await guardar('recs', original);
console.log('guardado en "Redis":', Math.round(datos.get('connect_recs_v1').length / 1024), 'KB comprimidos (original', Math.round(JSON.stringify(original).length / 1024), 'KB)');

globalThis.__CONNECT_CACHE__ = {}; // simula una instancia nueva: sin caché, solo lo que hay en Redis
const leido = await cargar('recs');
const ok = JSON.stringify(leido) === JSON.stringify(original);
console.log(ok ? `✓ leído de Redis idéntico: ${leido.recs.length} registros` : '✗ lo leído NO coincide');

// Si Redis no responde, leer no debe tumbar la página (devuelve null) y escribir sí debe avisar
servidor.close(); for (const s of []) s.destroy();
process.exit(ok ? 0 : 1);
