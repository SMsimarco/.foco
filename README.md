# foco.

Agenda personal en forma de PWA. Vista principal "Hoy": header con el día
(Hoy / Mañana / Ayer / nombre del día), una sección corta "Tu foco" con hasta
3 actividades marcadas como foco, y debajo una grilla horaria de un solo día
(no una lista simple estilo recordatorios — es un timeline por hora, igual
que la vista Semana pero para un día). Se navega con las flechas ‹ › o
deslizando entre días.

También tiene vista Semana (grilla horaria de 7 días) y vista Mes.

## Funcionalidades

- **Vista Hoy / Día**: grilla horaria del día actual, con eventos "todo el
  día" arriba (sin horario) y sección "Tu foco" para las prioridades.
- **Vista Semana**: grilla horaria de la semana completa.
- **Vista Mes**: calendario mensual.
- **Foquito**: asistente conversacional en español rioplatense (Claude
  Haiku vía `/api/claude`, proxy server-side — la API key nunca llega al
  front). Interpreta mensajes en lenguaje natural y ejecuta directo contra
  Supabase, sin modal de confirmación:
  - crear evento (único o varios de una, ej. "armame mi semana: gym lunes y
    miércoles 7am...")
  - editar evento (mover de día/hora)
  - borrar evento
  - marcar evento como hecho
  - si falta un dato (día, hora, cuál actividad) pregunta en vez de inventar
  - si el pedido incluye algo recurrente, primero resume y pide confirmación
    antes de crear (evita ensuciar semanas futuras por una mala
    interpretación)
- **Eventos recurrentes**: por día de la semana (`dia_semana`), independiente
  de eventos puntuales con fecha fija.
- **Push notifications reales**: service worker (`public/sw.js`) +
  `web-push`/VAPID. Un job en GitHub Actions (`scripts/send-reminders.js`,
  cron cada 5 min) revisa eventos que arrancan en 5-20 min y manda push a
  las suscripciones guardadas en Supabase.
- **Login**: con Google (Google Identity Services) o con email/contraseña
  (Supabase Auth, con flujo de confirmación por email para registro nuevo).
- **Morning brief / Evening check-in**: pantallas de check-in al arrancar y
  cerrar el día (energía, ánimo, intención del día, nota libre).
- **Commitment score**: anillo en el header con métrica de cumplimiento
  semanal.
- **Foco semanal** (goal bar): objetivo de la semana, editable.
- **Tema claro/oscuro** con toggle, persistido en localStorage.
- **PWA instalable**: manifest + iconos + service worker con cacheo
  (network-first para código de la app, cache-first para assets estáticos).

## Stack

- Frontend: HTML/CSS/JS vanilla (sin build, sin framework) — `public/`
- Backend: Node.js + Express (`server.js`), solo sirve estático en local
- Serverless: función `api/claude.js` en Vercel (proxy a la API de
  Anthropic)
- Base de datos / Auth / Push subs: Supabase (`@supabase/supabase-js`,
  cliente cargado desde `public/vendor/supabase.js`)
- Push: `web-push` (VAPID)
- Automatización de recordatorios: GitHub Actions (`.github/workflows/reminders.yml`)
- Deploy: Vercel

`database.js` (sqlite3) y `claudeprompt.md` son restos de una etapa anterior
del proyecto — no forman parte del flujo actual (sqlite3 ni figura en
`package.json`).

## Correr en local

```bash
npm install
npm start
```

Levanta en `http://localhost:3000`. Sirve `public/` como estático. El chat
de Foquito no va a funcionar en local salvo que corras también la función
`api/claude.js` (pensada para el runtime serverless de Vercel) — para
probarla local usá `vercel dev` en su lugar de `npm start`.

## Variables de entorno

Para la función serverless de Vercel (`api/claude.js`):

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_WORKSPACE_ID` (opcional, solo si la API key es "identity-linked")

Para el job de recordatorios (`scripts/send-reminders.js`, corre en GitHub
Actions como secrets del repo):

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

La URL y la key pública (anon) de Supabase, y el Google Client ID, están
hardcodeados en `public/app.js` (son valores públicos por diseño, no
secretos).

## Deploy

Producción: [foco-actweek.vercel.app](https://foco-actweek.vercel.app)
