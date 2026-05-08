# MASTER PROMPT PARA CLAUDE CODE
Sos el arquitecto técnico de foco. — un sistema de vida personal inteligente.
No es un calendario. No es un task manager. Es la primera app que combina
intención + energía + tiempo en una interfaz conversacional.

Lee todo esto antes de escribir una sola línea de código.

═══════════════════════════════════════════════════════════
FILOSOFÍA TÉCNICA
═══════════════════════════════════════════════════════════

1. PERFORMANCE PRIMERO. Cada interacción debe responder en < 100ms.
   Sin loading spinners en el critical path. Los datos se cargan en
   background y la UI se actualiza sin disrupción.

2. OFFLINE FIRST. La app funciona sin internet. Supabase sync en background.
   Si no hay conexión, el usuario no lo nota.

3. ANIMACIONES QUE INFORMAN. Ninguna animación existe por estética.
   Cada movimiento comunica algo: estado, jerarquía, causalidad.
   Duración máxima: 300ms. Easing: cubic-bezier(.4,0,.2,1) siempre.

4. ZERO LAYOUT SHIFT. Nada se mueve cuando carga. Skeleton states o
   dimensiones fijas. El layout es estable antes de que lleguen los datos.

5. INPUTS SIN FRICCIÓN. Ningún input type="date" o type="time" nativo.
   Nunca. Sin selectores, sin date pickers. Solo texto natural.

═══════════════════════════════════════════════════════════
STACK TÉCNICO
═══════════════════════════════════════════════════════════

Frontend: Vanilla JS (ya existente) — mantener, no migrar
Backend: Supabase (Postgres + Auth + Realtime + Storage)
AI: Claude API (claude-haiku-4-5-20251001 para velocidad)
PWA: Service Worker con cache-first strategy
Hosting: Vercel o Netlify (estáticos)
Fuentes: Geist + Instrument Serif via Google Fonts

NO agregar: React, Vue, cualquier framework JS, bundlers,
npm packages de UI, lodash, moment.js, o cualquier librería
que no sea absolutamente necesaria.

═══════════════════════════════════════════════════════════
SISTEMA DE DISEÑO
═══════════════════════════════════════════════════════════

Variables CSS (NUNCA cambiar estos valores):
```css
:root {
  /* Backgrounds */
  --bg:      #09090B;   /* fondo principal — negro casi puro */
  --bg2:     #0C0C0E;   /* un nivel arriba */
  --bg3:     #0F0F12;   /* dos niveles arriba */
  --surface: #111114;   /* cards, panels */

  /* Borders */
  --border:  #18181B;   /* separadores sutiles */
  --border2: #27272A;   /* borders visibles */

  /* Text */
  --text:    #FFFFFF;   /* primario */
  --text2:   #71717A;   /* secundario */
  --text3:   #3F3F46;   /* terciario */
  --text4:   #27272A;   /* placeholder/ghost */

  /* Accent */
  --accent:  #6366F1;   /* violeta — única marca de color */
  --accent2: #8B5CF6;   /* violeta secundario */

  /* Semánticos */
  --success: #10B981;
  --warning: #F59E0B;
  --danger:  #F43F5E;

  /* Calendario */
  --slot-h: 48px;       /* NUNCA cambiar */
}
```

Tipografía:
- Instrument Serif italic → logo "foco.", números grandes (timer, score)
- Geist 300 → body, inputs, contenido
- Geist 500 → labels, botones, énfasis
- Geist italic → mensajes del AI (se distinguen visualmente)

Espaciado: múltiplos de 4px. 4, 8, 12, 16, 20, 24, 32, 48.
Border radius: 6px (elementos pequeños), 10px (inputs), 12px (cards), 16px (modals).

═══════════════════════════════════════════════════════════
ARQUITECTURA DE BASE DE DATOS
═══════════════════════════════════════════════════════════

Tablas actuales (mantener):
- profiles (id, display_name)
- events (id, user_id, title, date, start_time, end_time, done)
- weekly_reviews (id, user_id, week_start, note)

Agregar estas tablas (ejecutar en Supabase SQL Editor):

```sql
-- Check-ins de energía diarios
create table if not exists daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  date date not null,
  energy int check (energy between 1 and 5),
  intention text,           -- "¿Qué es lo más importante hoy?"
  mood text,                -- 'great','good','ok','tired','bad'
  created_at timestamptz default now(),
  unique(user_id, date)
);

-- Patrones de productividad (se actualiza automáticamente)
create table if not exists patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  day_of_week int not null,  -- 0=dom ... 6=sab
  hour int not null,          -- 0-23
  completion_rate float default 0,
  sample_count int default 0,
  avg_energy float default 0,
  updated_at timestamptz default now(),
  unique(user_id, day_of_week, hour)
);

-- Sesiones de foco (Pomodoro)
create table if not exists focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  event_id uuid references events(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  planned_minutes int default 25,
  actual_minutes int,
  completed boolean default false,
  energy_after int,          -- 1-5 rating post-sesión
  notes text
);

-- Digestos semanales generados por AI
create table if not exists weekly_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  week_start date not null,
  commitment_score float,
  completion_rate float,
  best_day text,
  total_focus_minutes int,
  ai_insight text,
  ai_tip text,
  created_at timestamptz default now(),
  unique(user_id, week_start)
);

-- Modificaciones a events existentes
alter table events add column if not exists rescheduled_count int default 0;
alter table events add column if not exists energy_weight int default 3; -- 1-5 auto-inferido
alter table events add column if not exists actual_duration_minutes int;
alter table events add column if not exists is_recurring boolean default false;
alter table events add column if not exists recurring_days int[]; -- [1,3,5] = lun,mié,vie

-- RLS en tablas nuevas
alter table daily_checkins enable row level security;
alter table patterns enable row level security;
alter table focus_sessions enable row level security;
alter table weekly_digests enable row level security;

create policy "own" on daily_checkins for all using (auth.uid() = user_id);
create policy "own" on patterns for all using (auth.uid() = user_id);
create policy "own" on focus_sessions for all using (auth.uid() = user_id);
create policy "own" on weekly_digests for all using (auth.uid() = user_id);
```

═══════════════════════════════════════════════════════════
ESTRUCTURA DEL LAYOUT
═══════════════════════════════════════════════════════════
┌──────────────────────────────────────────┐
│ HEADER (44px)                            │
│ logo · week nav · commitment · momentum  │
├──────────────────────────────────────────┤
│ MORNING BRIEF (0/auto — colapsa a 0     │
│ después del check-in diario)             │
├──────────────────────────────────────────┤
│ TEMPLATES BAR (36px — chips frecuentes) │
├──────────────────────────────────────────┤
│ INPUT BAR (52px)                         │
├──────────────────────────────────────────┤
│ CHIPS (0/30px — collapsible)            │
├──────────────────────────────────────────┤
│                                          │
│   MAIN CONTENT (flex:1)                 │
│   [Semana | Mes | Patrones | Suger.]    │
│                                          │
├──────────────────────────────────────────┤
│ BOTTOM NAV (52px)                        │
└──────────────────────────────────────────┘

REGLA ABSOLUTA: El calendario nunca tiene scroll horizontal.
El scroll es SOLO vertical en el grid-wrap.
day-columns height = 1152px FIJO (24 × 48px).
Sin max-height en ningún contenedor del calendario.

═══════════════════════════════════════════════════════════
FEATURES A IMPLEMENTAR (en orden estricto)
═══════════════════════════════════════════════════════════

━━━ FASE 1: CORE CORRECTO ━━━

[F1] CALENDARIO FUNCIONAL PERFECTO
- Grilla 00-23hs, slot 48px, total 1152px
- Scroll inicial a hora actual - 2hs
- Eventos: border-left 2px colored, background color22 (10% opacity)
- Click en evento → bottom sheet (NO modal centrado)
- Click en espacio vacío → ghost block con inputs type="text"
- Hover en evento → mostrar botón × para eliminar
- Click en evento → toggle done (opacity .12 si done)
- Detección automática de conflictos → outline rojo

[F2] INPUT NL CON PARSER CORRECTO
Parser que entiende sin incluir palabras de tiempo en el nombre:
- "mañana estudio BD desde las 9 a las 11" → {nombre:"estudio BD", mañana, 9-11}
- "reunión viernes 11 a 12" → {nombre:"reunión", viernes, 11-12}
- "dentista 22 de junio a las 14" → {nombre:"dentista", 22/6, 14-15}
- "gimnasio" → {nombre:"gimnasio", hoy, 9-10 default}

Chips en tiempo real debajo del input mientras escribe.
Enter → agregar. Navegar a la semana correcta si la fecha está fuera.

[F3] COMMITMENT SCORE EN HEADER
Formula: promedio ponderado de la semana
- Completado a tiempo: 100pts
- Completado (evento pasó): 70pts
- Movido 1 vez: 50pts
- Movido 2+ veces: 20pts
- No hecho + pasó: 0pts

Mostrar en header como número grande con label "esta semana".
Ring SVG de progreso igual que el momentum actual pero coloreado:
- >80%: verde (#10B981)
- >60%: violeta (#6366F1)
- >40%: amber (#F59E0B)
- <40%: rojo (#F43F5E)

━━━ FASE 2: INTELIGENCIA ━━━

[F4] MORNING BRIEF
Condición: primer open del día antes de las 11am.
Si no hizo check-in hoy → mostrar pantalla completa (no modal):
Buenos días, Simón.
Hoy tenés 3 cosas agendadas.
¿Cómo llegás hoy?
[😴] [😐] [🙂] [⚡] [🚀]
¿Cuál es la cosa más importante?
[___________________________]
[Arrancar el día →]

Al confirmar:
- Guardar en daily_checkins
- Si energía 1-2 → el AI reorganiza eventos cognitivos pesados para otro momento
- Si energía 4-5 → el AI sugiere agregar algo importante si hay espacio

CSS de la pantalla de morning brief:
```css
.morning-screen {
  position: fixed;
  inset: 0;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
  animation: fadeIn .4s ease;
}

.morning-box {
  max-width: 320px;
  width: 90%;
  padding: 32px 24px;
}

.morning-greeting {
  font-family: 'Instrument Serif', serif;
  font-style: italic;
  font-size: 28px;
  color: var(--text);
  margin-bottom: 8px;
  line-height: 1.2;
}

.morning-sub {
  font-size: 13px;
  color: var(--text3);
  margin-bottom: 32px;
}

.energy-btns {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin: 16px 0;
}

.energy-btn {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  border: 1px solid var(--border2);
  background: transparent;
  font-size: 24px;
  cursor: pointer;
  transition: all .15s;
}

.energy-btn:hover { border-color: var(--accent); background: var(--bg3); }
.energy-btn.selected { border-color: var(--accent); background: var(--accent)20; }

.morning-inp {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border2);
  color: var(--text);
  font-size: 16px;
  font-family: 'Geist', sans-serif;
  padding: 8px 0;
  outline: none;
  margin: 16px 0 32px;
  -webkit-appearance: none;
}

.morning-inp::placeholder { color: var(--text4); }

.morning-cta {
  width: 100%;
  background: var(--text);
  color: var(--bg);
  border: none;
  border-radius: 10px;
  height: 48px;
  font-size: 15px;
  font-weight: 500;
  font-family: 'Geist', sans-serif;
  cursor: pointer;
  transition: opacity .15s;
}
```

[F5] FOCUS TIMER (bottom sheet al click en evento)
Al hacer click en cualquier evento → slide up desde abajo:
[drag handle]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reunión Velar                      [×]
11:00 – 12:00 · Hoy
    25:00            ← Instrument Serif 64px
[▶  Iniciar foco]
─────────────────────────────────
¿Qué vas a lograr?
[________________________________]
─────────────────────────────────
📝 Notas
[________________________________]
⚡ ¿Cómo saliste?
[ 😫 ] [ 😐 ] [ 🙂 ] [ ⚡ ] [ 🚀 ]
🔁 Repetir esta semana
[ Lun ] [ Mar ] [ Mié ] [ Jue ] [ Vie ]

Timer logic:
- 25 min trabajo, 5 min pausa (configurable solo por Pro)
- Al terminar → vibración (si móvil) + sonido sutil
- Guardar en focus_sessions
- Actualizar patterns según si el evento estaba completado

CSS del panel:
```css
.event-panel {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: #0F0F12;
  border: 1px solid var(--border2);
  border-bottom: none;
  border-radius: 16px 16px 0 0;
  padding: 12px 20px 32px;
  transform: translateY(100%);
  transition: transform .3s cubic-bezier(.4,0,.2,1);
  z-index: 200;
  max-height: 90vh;
  overflow-y: auto;
}

.event-panel.open { transform: translateY(0); }

.panel-drag {
  width: 36px;
  height: 4px;
  background: var(--border2);
  border-radius: 2px;
  margin: 0 auto 20px;
}

.panel-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.6);
  z-index: 199;
  display: none;
  backdrop-filter: blur(2px);
}

.panel-overlay.open { display: block; }

.panel-title {
  font-size: 18px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 4px;
}

.panel-meta {
  font-size: 12px;
  color: var(--text3);
  margin-bottom: 24px;
}

.focus-timer-display {
  font-family: 'Instrument Serif', serif;
  font-size: 64px;
  color: var(--text);
  text-align: center;
  letter-spacing: -2px;
  margin: 16px 0;
  line-height: 1;
}

.focus-timer-display.running {
  color: var(--accent);
}

.focus-start-btn {
  width: 100%;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 10px;
  height: 46px;
  font-size: 14px;
  font-weight: 500;
  font-family: 'Geist', sans-serif;
  cursor: pointer;
  transition: all .15s;
  margin-bottom: 24px;
}

.focus-start-btn.running {
  background: var(--danger);
}

.panel-section {
  border-top: 1px solid var(--border);
  padding-top: 16px;
  margin-top: 16px;
}

.panel-section-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--text3);
  margin-bottom: 8px;
}

.panel-inp {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-size: 13px;
  font-family: 'Geist', sans-serif;
  padding: 6px 0;
  outline: none;
  -webkit-appearance: none;
}

.panel-inp::placeholder { color: var(--text4); }

.panel-energy-row {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 8px;
}

.panel-energy-btn {
  flex: 1;
  background: transparent;
  border: 1px solid var(--border2);
  border-radius: 8px;
  padding: 8px 4px;
  font-size: 20px;
  cursor: pointer;
  transition: all .12s;
  text-align: center;
}

.panel-energy-btn.selected {
  background: var(--accent)20;
  border-color: var(--accent);
}

.recurring-days {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.rec-day-btn {
  background: transparent;
  border: 1px solid var(--border2);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text3);
  cursor: pointer;
  font-family: 'Geist', sans-serif;
  transition: all .12s;
}

.rec-day-btn.active {
  background: var(--accent)15;
  color: var(--accent);
  border-color: var(--accent)40;
}
```

[F6] TEMPLATES BAR
Encima del input, debajo del morning brief (si existe):
Los 5 eventos más frecuentes del usuario como chips.
Al cargar la app: query a events agrupado por title, top 5.
Click en chip → agregar hoy con las horas más frecuentes de ese evento.

```css
.templates-bar {
  display: flex;
  gap: 6px;
  padding: 8px 16px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  scrollbar-width: none;
  -ms-overflow-style: none;
  background: var(--bg);
}

.templates-bar::-webkit-scrollbar { display: none; }

.template-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 99px;
  padding: 4px 12px;
  font-size: 11px;
  color: var(--text3);
  cursor: pointer;
  white-space: nowrap;
  font-family: 'Geist', sans-serif;
  transition: all .12s;
  flex-shrink: 0;
}

.template-pill:hover {
  color: var(--text);
  border-color: var(--border2);
  background: var(--border);
}

.template-plus {
  font-size: 12px;
  color: var(--text4);
}
```

━━━ FASE 3: PATRONES ━━━

[F7] HEATMAP DE PRODUCTIVIDAD
Nueva tab en el bottom nav: reemplazar "Mes" por "Patrones" (◈).
O agregar una cuarta tab.

Mostrar grid 7 días × 24 horas.
Cada celda coloreada según completion_rate de la tabla patterns.

Lógica de actualización:
Cada vez que un evento se marca done → actualizar patterns:
```js
async function updatePattern(event) {
  const date = new Date(event.date);
  const dayOfWeek = date.getDay();
  const [hour] = event.start_time.split(':').map(Number);

  await db.rpc('update_pattern', {
    p_user_id: currentUser.id,
    p_day: dayOfWeek,
    p_hour: hour,
    p_completed: event.done
  });
}
```

Crear función RPC en Supabase:
```sql
create or replace function update_pattern(
  p_user_id uuid,
  p_day int,
  p_hour int,
  p_completed boolean
)
returns void language plpgsql as $$
begin
  insert into patterns (user_id, day_of_week, hour, completion_rate, sample_count)
  values (p_user_id, p_day, p_hour,
    case when p_completed then 1 else 0 end, 1)
  on conflict (user_id, day_of_week, hour)
  do update set
    completion_rate = (patterns.completion_rate * patterns.sample_count +
      case when p_completed then 1 else 0 end) / (patterns.sample_count + 1),
    sample_count = patterns.sample_count + 1,
    updated_at = now();
end;
$$;
```

CSS del heatmap:
```css
.heatmap-wrap {
  padding: 16px;
  overflow-x: auto;
}

.heatmap-grid {
  display: grid;
  grid-template-columns: 36px repeat(7, 1fr);
  gap: 3px;
  min-width: 320px;
}

.hm-header {
  font-size: 9px;
  font-weight: 500;
  color: var(--text4);
  text-align: center;
  padding: 4px 0;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.hm-hour-label {
  font-size: 8px;
  color: var(--text4);
  text-align: right;
  padding-right: 6px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}

.hm-cell {
  height: 18px;
  border-radius: 3px;
  background: var(--border);
  transition: opacity .1s;
  cursor: default;
  position: relative;
}

.hm-cell[data-rate="high"] { background: #10B981; }
.hm-cell[data-rate="mid"]  { background: #10B981; opacity: .5; }
.hm-cell[data-rate="low"]  { background: #064E3B; opacity: .6; }
.hm-cell[data-rate="none"] { background: var(--border); }

.hm-insight {
  margin-top: 20px;
  padding: 14px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 13px;
  color: var(--text2);
  line-height: 1.6;
  font-style: italic;
}
```

[F8] WEEKLY AUTO-DRAFT (domingo 18hs)
Condición: día domingo + hora >= 18 + no existe draft para next week.

Llamar a Claude API con:
- Eventos de la semana que termina
- Completion rate y commitment score
- Patterns del usuario (sus mejores horarios)
- Intención que escribió el lunes
- Preguntar: "¿Qué querés lograr la próxima semana?" (input simple)

El AI devuelve una lista de eventos sugeridos para la próxima semana.
Mostrar en pantalla completa: "Tu próxima semana, borrador"
El usuario aprueba, edita, o descarta cada evento.

[F9] WEEKLY DIGEST MODAL
Condición: día domingo + hora >= 20 + no existe digest para esta semana.

```js
async function generateWeeklyDigest() {
  const week = getWeekDates(weekOffset);
  const allEvents = week.flatMap(d => eventsCache[toISO(d)] || []);
  const done = allEvents.filter(e => e.done).length;
  const total = allEvents.length;

  const score = calcWeekCommitmentScore(allEvents);

  const eventsText = allEvents.map(e =>
    `${e.date} ${e.start_time}: ${e.title} — ${e.done ? 'completado' : 'no completado'} (movido ${e.rescheduled_count}x)`
  ).join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Sos el coach personal del usuario. Analizás su semana y dás
               feedback honesto pero compasivo en español rioplatense.
               Respondé SOLO con JSON válido, sin markdown:
               {
                 "headline": "frase de 5 palabras sobre la semana",
                 "insight": "observación específica y útil (40 palabras max)",
                 "tip": "acción concreta para la próxima semana (25 palabras max)",
                 "best_day": "nombre del día con más completación"
               }`,
      messages: [{
        role: 'user',
        content: `Semana: ${total} eventos, ${done} completados (${Math.round(done/total*100)}%)\n\n${eventsText}`
      }]
    })
  });

  const data = await response.json();
  const text = data.content[0].text;

  try {
    return JSON.parse(text);
  } catch {
    return {
      headline: `${Math.round(done/total*100)}% completado`,
      insight: `Completaste ${done} de ${total} eventos esta semana.`,
      tip: "La próxima semana, agendá menos pero cumplí más.",
      best_day: "Lunes"
    };
  }
}
```

CSS del digest modal:
```css
.digest-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.8);
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn .3s ease;
}

.digest-box {
  background: #0F0F12;
  border: 1px solid var(--border2);
  border-radius: 20px;
  padding: 28px 24px;
  max-width: 360px;
  width: 90%;
  animation: slideUp .35s cubic-bezier(.4,0,.2,1);
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.digest-week-label {
  font-size: 11px;
  color: var(--text4);
  font-variant-numeric: tabular-nums;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: .06em;
}

.digest-headline {
  font-family: 'Instrument Serif', serif;
  font-size: 24px;
  color: var(--text);
  margin-bottom: 20px;
  line-height: 1.2;
}

.digest-stats {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.digest-stat {
  flex: 1;
  background: var(--bg2);
  border-radius: 10px;
  padding: 12px 8px;
  text-align: center;
}

.digest-stat-n {
  font-size: 22px;
  font-weight: 500;
  color: var(--text);
  display: block;
}

.digest-stat-l {
  font-size: 9px;
  color: var(--text4);
  text-transform: uppercase;
  letter-spacing: .05em;
  margin-top: 3px;
  display: block;
}

.digest-insight {
  font-size: 13px;
  color: var(--text2);
  line-height: 1.6;
  margin-bottom: 12px;
  font-style: italic;
}

.digest-tip {
  font-size: 12px;
  color: var(--accent);
  background: var(--accent)10;
  border: 1px solid var(--accent)20;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 20px;
  line-height: 1.5;
}

.digest-close {
  width: 100%;
  background: var(--border2);
  color: var(--text);
  border: none;
  border-radius: 10px;
  height: 44px;
  font-size: 14px;
  font-weight: 500;
  font-family: 'Geist', sans-serif;
  cursor: pointer;
  transition: opacity .15s;
}
```

━━━ FASE 4: ONBOARDING ━━━

[F10] ONBOARDING DE 3 PASOS (solo primera vez)
Después del registro exitoso, antes de mostrar la app:

Paso 1 — "¿Cómo te llamás?" (ya está en auth)

Paso 2 — "¿Cuál es tu objetivo principal esta semana?"
Input libre. El AI lo guarda y lo usa en sugerencias.

Paso 3 — "¿A qué hora solés empezar el día?"
3 opciones visuales: "Temprano (7-9)", "A la mañana (9-11)", "A la tarde (11+)"
Esto setea el scroll default del calendario y los defaults del Morning Brief.

CSS onboarding (pantalla completa animada):
```css
.onboarding-screen {
  position: fixed;
  inset: 0;
  background: var(--bg);
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
}

.onboarding-box {
  max-width: 340px;
  width: 90%;
  padding: 0 24px;
}

.onboarding-step {
  display: none;
  flex-direction: column;
  gap: 16px;
  animation: fadeIn .3s ease;
}

.onboarding-step.active { display: flex; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.onboarding-num {
  font-size: 11px;
  color: var(--text4);
  letter-spacing: .06em;
}

.onboarding-title {
  font-family: 'Instrument Serif', serif;
  font-size: 28px;
  color: var(--text);
  line-height: 1.2;
}

.onboarding-sub {
  font-size: 13px;
  color: var(--text3);
}

.time-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.time-option {
  background: var(--surface);
  border: 1px solid var(--border2);
  border-radius: 10px;
  padding: 14px 16px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text2);
  font-family: 'Geist', sans-serif;
  text-align: left;
  transition: all .15s;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.time-option:hover { border-color: var(--accent); color: var(--text); }
.time-option.selected { border-color: var(--accent); background: var(--accent)10; color: var(--text); }

.onboarding-dots {
  display: flex;
  gap: 6px;
  justify-content: center;
  margin-top: 24px;
}

.onboarding-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border2);
  transition: background .2s;
}

.onboarding-dot.active { background: var(--accent); }
```

═══════════════════════════════════════════════════════════
ANIMACIONES Y MOTION
═══════════════════════════════════════════════════════════

Principio: las animaciones comunican, no decoran.

```css
/* Transición entre vistas */
.view-enter {
  animation: slideFromRight .28s cubic-bezier(.4,0,.2,1);
}

@keyframes slideFromRight {
  from { transform: translateX(16px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

/* Bottom sheet */
.panel-enter {
  animation: slideUp .3s cubic-bezier(.4,0,.2,1);
}

/* Evento nuevo en el calendario */
.event-block.new {
  animation: eventPop .25s cubic-bezier(.34,1.56,.64,1);
}

@keyframes eventPop {
  from { transform: scaleY(0); opacity: 0; transform-origin: top; }
  to { transform: scaleY(1); opacity: 1; }
}

/* Marcar como hecho */
.event-block.completing {
  animation: completingFade .3s ease forwards;
}

@keyframes completingFade {
  50% { transform: scale(.97); }
  100% { opacity: .12; }
}

/* Chips del parser */
.chip {
  animation: chipIn .15s ease;
}

@keyframes chipIn {
  from { opacity: 0; transform: scale(.9); }
  to { opacity: 1; transform: scale(1); }
}

/* Morning brief */
.morning-screen {
  animation: morningFade .5s ease;
}

@keyframes morningFade {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Timer pulsing cuando corre */
.focus-timer-display.running {
  animation: timerPulse 2s ease-in-out infinite;
}

@keyframes timerPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .7; }
}
```

═══════════════════════════════════════════════════════════
AI ORCHESTRATION
═══════════════════════════════════════════════════════════

El AI tiene 3 modos:

1. REACTIVO (ya existe): responde al input del usuario
2. PROACTIVO: analiza datos y notifica insights
3. ANTICIPATORIO: predice y sugiere antes de que se pida

Para el modo proactivo, correr estas verificaciones al cargar la app:

```js
async function runProactiveChecks() {
  const checks = [
    checkMorningBrief,
    checkWeeklyDigest,
    checkConflicts,
    checkPostponedEvents,
    checkEnergyOverload
  ];

  for (const check of checks) {
    const result = await check();
    if (result.shouldShow) {
      await showNotification(result);
      break;
    }
  }
}

async function checkPostponedEvents() {
  const events = Object.values(eventsCache).flat();
  const postponed = events.filter(e => e.rescheduled_count >= 3 && !e.done);
  return {
    shouldShow: postponed.length > 0,
    type: 'postponed',
    data: postponed[0]
  };
}

async function checkEnergyOverload() {
  const today = getWeekDates(weekOffset).find(d => isToday(d));
  if (!today) return { shouldShow: false };

  const todayEvents = eventsCache[toISO(today)] || [];
  const totalHours = todayEvents.reduce((acc, e) => {
    const [sh, sm] = e.start_time.split(':').map(Number);
    const [eh, em] = e.end_time.split(':').map(Number);
    return acc + (eh * 60 + em - sh * 60 - sm) / 60;
  }, 0);

  return {
    shouldShow: totalHours > 8,
    type: 'overload',
    data: { totalHours, eventCount: todayEvents.length }
  };
}
```

═══════════════════════════════════════════════════════════
PERFORMANCE
═══════════════════════════════════════════════════════════

1. CACHE PRIMERO: Antes de cualquier fetch a Supabase, mostrar lo que
   hay en eventsCache. Actualizar silenciosamente.

2. PREFETCH: Cuando el usuario está en la semana N, precargar semana N+1
   y N-1 en background.

3. RENDERIZADO SELECTIVO: No re-renderizar toda la semana al marcar
   un evento como done. Solo actualizar ese evento específico en el DOM.

4. LAZY LOAD AI: El análisis de IA (patterns, digest) se carga después
   de que la UI principal está visible. Nunca bloquea el render inicial.

5. SERVICE WORKER: Cache de assets estáticos. La app carga en < 1 segundo
   en visitas repetidas.

```js
// En sw.js
const CACHE = 'foco-v2';
const STATIC = ['/', '/index.html', '/app.js', '/style.css'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('supabase') ||
      e.request.url.includes('anthropic')) return;

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
```

═══════════════════════════════════════════════════════════
REGLAS ABSOLUTAS QUE NUNCA SE VIOLAN
═══════════════════════════════════════════════════════════

1. SLOT_HEIGHT = 48px. NUNCA cambiar.
2. #day-columns height = 1152px FIJO. Sin max-height.
3. NUNCA input type="time" o type="date" en ningún lugar.
4. NUNCA background color en inputs (solo transparent).
5. NUNCA selectores nativos de fecha/hora del browser.
6. Todo input tiene -webkit-appearance: none y el override de autofill.
7. El placeholder de todo input es color var(--text4) (#27272A) — casi invisible.
8. Las animaciones no superan 350ms.
9. Sin librerías de UI externas. Vanilla JS puro.
10. Todo funciona offline. Supabase sync en background.

═══════════════════════════════════════════════════════════
ORDEN DE IMPLEMENTACIÓN
═══════════════════════════════════════════════════════════

Implementá en este orden exacto. Confirmame al terminar cada uno.

[ ] 1. Ejecutar SQL de nuevas tablas en Supabase
[ ] 2. Calendario base correcto (slot 48px, 24hs, sin bugs visuales)
[ ] 3. Input NL con parser correcto (sin palabras de tiempo en el nombre)
[ ] 4. Event panel (bottom sheet al click en evento)
[ ] 5. Focus Timer en el panel (25min, guardar en focus_sessions)
[ ] 6. Energy rating post-timer (guardar en events.energy_after)
[ ] 7. Commitment Score en header (basado en rescheduled_count)
[ ] 8. Templates bar (top 5 eventos frecuentes)
[ ] 9. Morning Brief (primer open del día antes de las 11am)
[ ] 10. Update patterns al completar/no completar eventos
[ ] 11. Heatmap view (nueva tab o dentro de Sugerencias)
[ ] 12. Sugerencias IA mejoradas con JSON estructurado
[ ] 13. Weekly Digest modal (domingo 20hs)
[ ] 14. Onboarding de 3 pasos (primera vez)
[ ] 15. Service Worker con cache offline
[ ] 16. Notificaciones push 15min antes

No pases al siguiente punto sin que el anterior funcione perfectamente.
Si algo no está claro, preguntá antes de implementar.
