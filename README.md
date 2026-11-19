# Adoption · Medición

Dos tableros en una sola app, detrás de la misma contraseña:

| Ruta | Qué es |
|---|---|
| `/connect` | **Alegra Connect · tablero integral** (Resumen, Embudo y fugas, SLA y tiempos, Equipo, Retención, Lista para actuar, Cómo se mide) |
| `/` | **Adoption Explorer**: explorador de tickets, desempeño y activación (descrito más abajo) |

## Tablero de Connect (`/connect`)

Los datos tienen dos orígenes y cada uno trae su fecha de corte:

| Pieza | De dónde sale | Cómo se actualiza |
|---|---|---|
| Tickets (embudo, SLA, equipo) | HubSpot, en vivo desde el servidor | Cron diario 11:00 UTC (6 a.m. Bogotá), botón o `GET /api/connect/refresh` |
| Retención y activación | Metabase (solo se consulta con el conector del agente) | El agente las calcula y las sube: `scripts/connect/exportar-snapshots.cjs` y luego `scripts/connect/subir-snapshots.ps1` |

Código: `lib/connect/normalizar.js` (todas las reglas de negocio, probadas con `scripts/connect/verificar-normalizar.mjs`),
`lib/connect/hubspot.js` (descarga), `lib/connect/store.js` (KV con respaldo en memoria),
`lib/connect/template.html` (la vista; calcula las métricas en el navegador), `app/connect/route.js` (inyecta los datos).

### Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Obligatoria | Para qué |
|---|---|---|
| `HUBSPOT_TOKEN` | Sí | Token de la private app de HubSpot (solo servidor) |
| `ADOPTION_PASSWORD` | Sí | Contraseña del equipo. Sin ella el sitio responde 503 (cerrado a propósito) |
| `CRON_SECRET` | Sí | Secreto del cron; Vercel lo envía solo. Sin él, solo refresca quien tenga sesión |
| `CONNECT_TOKEN` | Para subir retención/activación | Token del agente en `/api/connect/snapshot` |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Recomendadas | Los pone Vercel al conectar el KV; sin KV los datos se pierden al reiniciar |

Seguridad: la cookie de sesión guarda una huella (SHA-256), no la contraseña; las rutas de servicio
(`/api/refresh`, `/api/connect/refresh`, `/api/connect/snapshot`) exigen secreto o sesión y quedan cerradas
si el secreto no existe; no hay claves en el repo.

---

# Adoption Explorer

Dashboard interactivo de tickets de Adoption (pipeline HubSpot `690980478`).
Los datos se leen **en vivo** de HubSpot desde el servidor (el token nunca se expone al navegador),
se refrescan **cada día automáticamente** (cron de Vercel) y con el botón **"Actualizar ahora"**.

Pensado para responder preguntas ad-hoc: filtra por país / segmento / analista / estado /
mes de creación / SLA, agrupa por cualquier dimensión y exporta a CSV.

## Cómo funciona

- `lib/hubspot.js` — trae y limpia los tickets del pipeline (paginado, `fetch`, token en env var).
- `lib/store.js` — guarda el snapshot en **Vercel KV** (producción) o en memoria (local / sin KV).
- `app/api/data` — devuelve el snapshot (lo genera al vuelo la primera vez).
- `app/api/refresh` — vuelve a jalar HubSpot y regraba el snapshot. Lo dispara el cron y el botón.
- `app/page.js` — el explorador (filtros + pivote + tabla + CSV + preguntas frecuentes).
- `proxy.js` — gate por contraseña compartida (si `ADOPTION_PASSWORD` está seteada).

## Correr en local

```bash
npm install
# crea .env.local con HUBSPOT_TOKEN (ver .env.local.example)
npm run dev
# abre http://localhost:3000
```

## Deploy a Vercel (compartido con el equipo)

1. Sube esta carpeta a un repo de GitHub (privado).
2. En Vercel: **Add New → Project → importa el repo**. Framework: Next.js (auto).
3. En **Settings → Environment Variables** agrega:

   | Variable | Obligatoria | Para qué |
   |---|---|---|
   | `HUBSPOT_TOKEN` | ✅ | Token de la private app de HubSpot |
   | `ADOPTION_PASSWORD` | ✅ (recomendada) | Contraseña que pide el dashboard al equipo |
   | `REFRESH_SECRET` | opcional | Protege `/api/refresh` de llamadas externas |

4. **Datos persistentes (recomendado):** crea un **Vercel KV** (Storage → KV) y conéctalo al
   proyecto. Vercel inyecta `KV_REST_API_URL` y `KV_REST_API_TOKEN` solo. Sin KV la app igual
   funciona, pero cada instancia serverless vuelve a jalar HubSpot en su primera visita.
5. El **cron diario** ya está en `vercel.json` (`0 11 * * *` UTC ≈ 6am Bogotá → `/api/refresh`).
6. Deploy. Comparte la URL con el equipo; entran con la contraseña.

## ⚠️ Seguridad — rotar el token

El token de HubSpot estuvo hardcodeado en scripts antiguos (`Hermes/scripts/refresh_data.py`) y en
`.env.local`. **Recomiendo rotarlo** en HubSpot (crear uno nuevo para la private app) y usar ese
solo como env var. Nunca lo subas al repo — `.env.local` está en `.gitignore`.

## Vista "Por Analista" (productividad)

Segunda vista (botón arriba) que mide, por analista, en **enero–junio 2026**:
- **Efectividad** = tickets llevados a Completada.
- **Eficiencia** = SLA de 1ª atención.
- **Productividad** = sesiones dadas (registro Connect).

Doble clic en un analista abre el detalle mes a mes.

Las **sesiones** vienen de `lib/sessions-data.js`, generado desde el CSV *"Registro de Transcripts
y Grabaciones – Connect"* (export manual del Google Sheet). **No se auto-actualiza con HubSpot.**
Para refrescarlas: re-exportar el CSV y volver a generar `lib/sessions-data.js` (script node que
parsea el CSV y agrega por analista/mes: `dadas` = "Asistio", `primeras` = "Sesión 1",
`noAsistio`, `agendadas`). Se normaliza "Montse Cazares" → "Montserrat Cazares".

## Notas de datos

- **SLA 1ª atención** = `(fecha_primera_sesion − fecha_de_solicitud) ≤ N días` (N configurable,
  default 3). Se calcula así porque los campos de SLA nativos de HubSpot vienen vacíos.
- **Estado**: Abierto = Nuevo/En proceso · Cerrado = Completada/No completada.
- **Analista**: los 6 del equipo actual; owners históricos caen en "Otro"/"Sin asignar".
