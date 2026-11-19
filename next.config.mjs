import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: __dirname },
  // La plantilla del tablero de Connect se lee del disco en tiempo de ejecución: hay que
  // incluirla en el paquete que Vercel despliega.
  outputFileTracingIncludes: {
    '/connect': ['./lib/connect/template.html'],
  },
};

export default nextConfig;
