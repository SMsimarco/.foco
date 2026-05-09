// ═══════════════════════════════════════════════════════════
// foco. — app.js
// ═══════════════════════════════════════════════════════════

// ── CONFIGURACIÓN SUPABASE ──────────────────────────────────
const SUPABASE_URL = 'https://hgvfzwmtepztkdoxjptu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Ej3NewanSxjLVwiue6rD7w_PwQfGZ5a';
const CLAUDE_API_KEY = null; // Key en servidor — no exponer en frontend

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── ESTADO GLOBAL ───────────────────────────────────────────
const SLOT_H = 48; // px por hora — NO CAMBIAR
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DAYS_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const COLORS = [
  '#6366F1', // indigo
  '#8B5CF6', // violeta
  '#06B6D4', // cyan
  '#10B981', // esmeralda
  '#F43F5E', // rosa
  '#3B82F6', // azul
  '#A78BFA', // lavanda
  '#34D399', // verde menta
  '#22D3EE', // celeste
  '#818CF8', // índigo claro
];

let currentUser = null;
let currentProfile = null;
let weekOffset = 0;
let monthOffset = 0;
let currentView = 'semana';
let eventsCache = {}; // { 'YYYY-MM-DD': [...events] }
let ghost = null;
let _lastTapTime = 0;
let _lastTapDi = -1;
let notifOn = true;
let authMode = 'login';

// Onboarding state
let obSelectedHour = 9;

// Morning brief state
let morningEnergy = null;

// Panel state
let panelEvent = null;
let panelDateISO = null;
let panelEnergy = null;
let panelRecDays = [];
let focusTimerRAF = null;
let focusTimerEndTime = null;
let focusTimerRunning = false;

let currentSession = {
  mode: 'profundo',
  minutes: 25,
  eventId: null,
  startedAt: null,
  paused: false,
  pausedRemaining: null,
  timeHidden: false,
  worthIt: null
};

// Drag state
let dragEvent = null;

// Ambient mode
let ambientActive = false;

// ── HELPERS ─────────────────────────────────────────────────

function getWeekDates(offset = 0) {
  const now = new Date();
  const dow = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  mon.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });
}

function toISO(date) {
  return date.toISOString().split('T')[0];
}

function toY(h, m) {
  return (h + m / 60) * SLOT_H;
}

function yToHM(y) {
  const total = y / SLOT_H;
  const h = Math.floor(total);
  const m = Math.round((total % 1) * 2) * 30;
  return {
    h: Math.max(0, Math.min(23, h)),
    m: m >= 60 ? 0 : m
  };
}

function fmtTime(h, m) {
  return `${h}:${String(m).padStart(2, '0')}`;
}

function isToday(date) {
  return date.toDateString() === new Date().toDateString();
}

function isPast(date) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return date < now && !isToday(date);
}

function eventColor(title) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash) + title.charCodeAt(i);
    hash = hash & hash;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function calcMomentum() {
  const week = getWeekDates(weekOffset);
  let done = 0, total = 0;
  week.forEach(d => {
    const evs = eventsCache[toISO(d)] || [];
    total += evs.length;
    done += evs.filter(e => e.done).length;
  });
  return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
}

function calcCommitmentScore() {
  const week = getWeekDates(weekOffset);
  const now = new Date();
  let totalPoints = 0, counted = 0;

  week.forEach(d => {
    (eventsCache[toISO(d)] || []).forEach(ev => {
      const [eh, em] = ev.end_time.split(':').map(Number);
      const evEnd = new Date(`${toISO(d)}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00`);
      if (evEnd >= now) return; // eventos futuros no cuentan aún

      counted++;
      const r = ev.rescheduled_count || 0;
      if (ev.done) {
        totalPoints += r === 0 ? 100 : 70;
      } else {
        if (r >= 2) totalPoints += 20;
        else if (r === 1) totalPoints += 50;
        // r === 0 && !done && past → 0pts
      }
    });
  });

  return { pct: counted ? Math.round(totalPoints / (counted * 100) * 100) : 0, counted };
}

function commitmentColor(pct) {
  if (pct > 80) return '#10B981';
  if (pct > 60) return '#6366F1';
  if (pct > 40) return '#F59E0B';
  return '#F43F5E';
}

function momentumLabel(pct) {
  if (pct >= 80) return 'excelente';
  if (pct >= 60) return 'buena semana';
  if (pct >= 40) return 'vas bien';
  if (pct >= 20) return 'podés más';
  return 'arrancá';
}

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function hasConflict(evs, ev) {
  return evs.some(o =>
    o.id !== ev.id &&
    !o.done && !ev.done &&
    timeToMin(o.start_time) < timeToMin(ev.end_time) &&
    timeToMin(ev.start_time) < timeToMin(o.end_time)
  );
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  container.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 320);
  }, 2600);
}

function startLiveClock() {
  const el = document.getElementById('live-clock');
  if (!el) return;
  const tick = () => {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  };
  tick();
  setInterval(tick, 1000);
}

// ── AUTH ────────────────────────────────────────────────────

function switchTab(mode) {
  authMode = mode;
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-register').classList.toggle('active', mode === 'register');
  document.getElementById('field-name').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('auth-btn').textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
  document.getElementById('auth-error').textContent = '';
}

async function handleAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value.trim();
  const errorEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-btn');

  if (!email || !password) {
    errorEl.textContent = 'Completá email y contraseña.';
    return;
  }

  btn.disabled = true;
  btn.textContent = '...';
  errorEl.textContent = '';

  try {
    if (authMode === 'login') {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentUser = data.user;
      const { data: profile } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
      currentProfile = profile;
      showApp();
    } else {
      const name = document.getElementById('auth-name').value.trim();
      if (!name) { errorEl.textContent = 'Ingresá tu nombre.'; btn.disabled = false; btn.textContent = 'Crear cuenta'; return; }
      const { data, error } = await db.auth.signUp({ email, password });
      if (error) throw error;
      if (data.user) {
        currentUser = data.user;
        await db.from('profiles').upsert({ id: data.user.id, display_name: name });
        const { data: profile } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
        currentProfile = profile;
        showApp();
      }
    }
  } catch (err) {
    errorEl.textContent = err.message || 'Error al iniciar sesión.';
    btn.disabled = false;
    btn.textContent = authMode === 'login' ? 'Entrar' : 'Crear cuenta';
  }
}

async function logout() {
  await db.auth.signOut();
}

function toggleNotif() {
  notifOn = !notifOn;
  const btn = document.getElementById('notif-btn');
  const lbl = document.getElementById('notif-label');
  btn.classList.toggle('off', !notifOn);
  if (notifOn) setupNotifications();
}

// ── INICIALIZACIÓN ──────────────────────────────────────────

async function init() {
  // Verificar sesión existente directamente — no depender solo de onAuthStateChange
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    const { data } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
    currentProfile = data;
    showApp();
  } else {
    showAuth();
  }

  // Solo para eventos reactivos posteriores (logout, refresh de token)
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentProfile = null;
      showAuth();
    } else if (event === 'TOKEN_REFRESHED' && session) {
      currentUser = session.user;
    }
  });
}

function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

async function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  await loadWeek();
  renderSemana();
  setTimeout(scrollToCurrentTime, 80);
  setupNotifications();
  loadTemplates();
  checkOnboarding();
  checkMorningBrief();
  checkWeeklyDigest();
  startLiveClock();
}

// ── CARGA DE DATOS ──────────────────────────────────────────

async function loadWeek() {
  if (!currentUser) return;
  const week = getWeekDates(weekOffset);
  const start = toISO(week[0]);
  const end = toISO(week[6]);

  const { data, error } = await db
    .from('events')
    .select('*')
    .eq('user_id', currentUser.id)
    .gte('date', start)
    .lte('date', end)
    .order('start_time', { ascending: true });

  if (error) { console.error(error); return; }

  week.forEach(d => { eventsCache[toISO(d)] = []; });
  (data || []).forEach(ev => {
    ev.start_time = ev.start_time ? ev.start_time.slice(0, 5) : ev.start_time;
    ev.end_time   = ev.end_time   ? ev.end_time.slice(0, 5)   : ev.end_time;
    if (!eventsCache[ev.date]) eventsCache[ev.date] = [];
    eventsCache[ev.date].push(ev);
  });
}

async function loadMonth() {
  if (!currentUser) return;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + monthOffset;
  const start = toISO(new Date(y, m, 1));
  const end = toISO(new Date(y, m + 1, 0));

  const { data } = await db
    .from('events')
    .select('*')
    .eq('user_id', currentUser.id)
    .gte('date', start)
    .lte('date', end);

  (data || []).forEach(ev => {
    if (!eventsCache[ev.date]) eventsCache[ev.date] = [];
    if (!eventsCache[ev.date].find(e => e.id === ev.id)) {
      eventsCache[ev.date].push(ev);
    }
  });
}

// ── CRUD EVENTOS ────────────────────────────────────────────

async function addEvent(dateISO, title, startTime, endTime) {
  if (!currentUser || !title.trim()) return;

  const { data, error } = await db.from('events').insert({
    user_id: currentUser.id,
    title: title.trim(),
    date: dateISO,
    start_time: startTime,
    end_time: endTime,
    done: false
  }).select().single();

  if (error) { console.error(error); return; }

  if (!eventsCache[dateISO]) eventsCache[dateISO] = [];
  eventsCache[dateISO].push(data);

  ghost = null;
  const weekForAdd = getWeekDates(weekOffset);
  const dayIndex = weekForAdd.findIndex(d => toISO(d) === dateISO);
  if (dayIndex >= 0) {
    addEventToDOM(data, dateISO, dayIndex);
  } else {
    saveScroll(); renderSemana(); restoreScroll();
  }
  scheduleNotification(data);
  showToast(`"${data.title}" agregado`, 'info');
}

async function toggleDone(id, dateISO) {
  const ev = (eventsCache[dateISO] || []).find(e => e.id === id);
  if (!ev) return;

  const newDone = !ev.done;

  if (newDone) {
    const block = document.querySelector(`[data-event-id="${id}"]`);
    if (block) {
      const rect = block.getBoundingClientRect();
      block.classList.add('completing');
      fireParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
      await new Promise(r => setTimeout(r, 380));
    }
  }

  const { error } = await db.from('events').update({ done: newDone }).eq('id', id);
  if (error) { console.error(error); return; }

  ev.done = newDone;
  updateEventDoneInDOM(id, newDone);
  updateMomentum();
  if (currentView === 'sugerencias') updateSugStats();
  updatePattern(ev);

  if (newDone) {
    const dayEvs = eventsCache[dateISO] || [];
    if (dayEvs.length > 0 && dayEvs.every(e => e.done)) {
      setTimeout(fireConfetti, 120);
      showToast('¡Día completado!', 'success');
    }
  }
}

async function updatePattern(ev) {
  if (!currentUser) return;
  const date = new Date((ev.date || '') + 'T12:00:00');
  const dayOfWeek = date.getDay();
  const [hour] = ev.start_time.split(':').map(Number);
  await db.rpc('update_pattern', {
    p_user_id: currentUser.id,
    p_day: dayOfWeek,
    p_hour: hour,
    p_completed: ev.done
  });
}

async function deleteEvent(id, dateISO) {
  const ev = (eventsCache[dateISO] || []).find(e => e.id === id);
  const { error } = await db.from('events').delete().eq('id', id);
  if (error) { console.error(error); return; }

  eventsCache[dateISO] = (eventsCache[dateISO] || []).filter(e => e.id !== id);
  ghost = null;
  removeEventFromDOM(id);
  if (ev) showToast(`"${ev.title}" eliminado`, 'error');
}

// ── PARSER LENGUAJE NATURAL ─────────────────────────────────

function parseNL(raw) {
  let s = raw.trim();
  let date = null, h1 = 9, m1 = 0, h2 = 10, m2 = 0;

  // Eliminar verbos introductorios
  s = s.replace(/^(tengo que|voy a|quiero|necesito|hago|tengo|anoto|agendo|pongo)\s+/i, '');

  // "desde ahora" / "de ahora" → hora actual redondeada a 30min
  if (/desde\s+ahora|de\s+ahora/i.test(s)) {
    const now = new Date();
    const nowH = now.getHours();
    const nowM = now.getMinutes() < 30 ? 0 : 30;
    s = s.replace(/desde\s+ahora|de\s+ahora/i,
      `desde las ${nowH}:${String(nowM).padStart(2, '0')}`);
  }

  // Normalizar minutos en español → "HH:MM"
  s = s.replace(/(\d{1,2})\s+y\s+media\b/gi, (_, h) => `${h}:30`);
  s = s.replace(/(\d{1,2})\s+y\s+cuarto\b/gi, (_, h) => `${h}:15`);
  s = s.replace(/(\d{1,2})\s+y\s+(\d{1,2})\b/gi, (_, h, m) => `${h}:${String(m).padStart(2,'0')}`);
  // "18 30" → "18:30" solo si el segundo número es minutos válidos (01-59)
  s = s.replace(/\b(\d{1,2})\s+(\d{2})\b/g, (full, h, m) =>
    parseInt(m) >= 1 && parseInt(m) <= 59 ? `${h}:${m}` : full);

  const MONTHS = {
    enero:0,febrero:1,marzo:2,abril:3,mayo:4,junio:5,
    julio:6,agosto:7,septiembre:8,octubre:9,noviembre:10,diciembre:11
  };
  const DAYMAP = {
    'hoy':-2,'mañana':-1,'manana':-1,
    'lun':1,'lunes':1,'mar':2,'martes':2,
    'mié':3,'mie':3,'miercoles':3,'miércoles':3,
    'jue':4,'jueves':4,'vie':5,'viernes':5,
    'sáb':6,'sab':6,'sabado':6,'sábado':6,
    'dom':0,'domingo':0
  };

  // Fecha específica "22 de junio"
  const dm = s.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)/i);
  if (dm && MONTHS[dm[2].toLowerCase()] !== undefined) {
    const d = new Date();
    d.setMonth(MONTHS[dm[2].toLowerCase()]);
    d.setDate(parseInt(dm[1]));
    if (d < new Date()) d.setFullYear(d.getFullYear() + 1);
    date = d;
    s = s.replace(dm[0], ' ');
  }

  // Día relativo o nombre de día
  if (!date) {
    for (const [key, val] of Object.entries(DAYMAP)) {
      if (new RegExp('\\b' + key + '\\b', 'i').test(s)) {
        const now = new Date();
        if (val === -2) {
          date = new Date();
        } else if (val === -1) {
          date = new Date();
          date.setDate(date.getDate() + 1);
        } else {
          let diff = (val - now.getDay() + 7) % 7;
          if (!diff) diff = 7;
          date = new Date(now);
          date.setDate(now.getDate() + diff);
        }
        s = s.replace(new RegExp('\\b' + key + '\\b', 'i'), ' ');
        break;
      }
    }
  }

  // Rango horario — orden importa: más específicos primero
  const rangePatterns = [
    // "desde las X hasta/a las Y" / "de las X a/hasta Y"
    /(?:desde\s+(?:las?\s+)?|de\s+(?:las?\s+)?)(\d{1,2})(?::(\d{2}))?\s*h?s?\s+(?:hasta\s+(?:las?\s+)?|a\s+(?:las?\s+)?)(\d{1,2})(?::(\d{2}))?\s*h?s?/i,
    // "a las X hasta las Y"
    /a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*h?s?\s+hasta\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?\s*h?s?/i,
    // "X hasta Y" / "X:MM hasta Y" (números simples)
    /(\d{1,2})(?::(\d{2}))?\s*h?s?\s+hasta\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?\s*h?s?/i,
    // "X a Y" (fallback)
    /(\d{1,2})(?::(\d{2}))?\s*h?s?\s+a\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?\s*h?s?/i,
  ];

  let rangeFound = false;
  for (const p of rangePatterns) {
    const m = s.match(p);
    if (m) {
      h1 = parseInt(m[1]); m1 = parseInt(m[2] || 0);
      h2 = parseInt(m[3]); m2 = parseInt(m[4] || 0);
      s = s.replace(m[0], ' ');
      rangeFound = true;
      break;
    }
  }

  // Hora única
  if (!rangeFound) {
    const sp = [
      /a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*h?s?/i,
      /hasta\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*h?s?/i,
      /(\d{1,2})(?::(\d{2}))?\s*hs/i,
      /\b(\d{1,2}):(\d{2})\b/,       // "14:30" bare (ya normalizado del preprocessor)
      /\b([01]?\d|2[0-3])\b(?!\s*\w)/ // hora sola al final o sin letras pegadas
    ];
    for (const p of sp) {
      const m = s.match(p);
      if (m) {
        h1 = parseInt(m[1]); m1 = parseInt(m[2] || 0);
        h2 = h1 + 1; m2 = m1;
        s = s.replace(m[0], ' ');
        break;
      }
    }
  }

  // Limpiar palabras de tiempo sobrantes
  s = s
    .replace(/\bdesde\b/gi, ' ').replace(/\bhasta\b/gi, ' ')
    .replace(/\bdesde\s+las?\b/gi, ' ').replace(/\bhasta\s+las?\b/gi, ' ')
    .replace(/\ba\s+las?\b/gi, ' ').replace(/\bde\s+las?\b/gi, ' ')
    .replace(/\bahora\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();

  if (!date) date = new Date();

  return {
    name: s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Nuevo evento',
    date,
    h1: Math.min(h1, 23),
    m1,
    h2: Math.min(h2, 23),
    m2
  };
}

// ── RENDER SEMANA ───────────────────────────────────────────

function scrollToCurrentTime() {
  const gridWrap = document.getElementById('grid-wrap');
  if (!gridWrap) return;
  const now = new Date();
  const prefHour = getUserStartHour();
  const targetHour = prefHour ?? Math.max(0, now.getHours() - 2);
  gridWrap.scrollTop = Math.max(0, targetHour * SLOT_H);
}

function renderSemana() {
  const week = getWeekDates(weekOffset);

  const fmt = d => `${d.getDate()}/${d.getMonth() + 1}`;
  document.getElementById('week-label').textContent =
    `${fmt(week[0])} — ${fmt(week[6])}`;

  renderDayHeaders(week);
  renderTimeGutter();
  renderDayColumns(week);
  updateMomentum();
}

function renderDayHeaders(week) {
  const container = document.getElementById('day-headers');
  container.innerHTML = '';

  week.forEach(d => {
    const today = isToday(d);
    const past = isPast(d);
    const el = document.createElement('div');
    el.className = 'day-header' + (today ? ' today' : '') + (past ? ' past' : '');
    el.innerHTML = `
      <span class="day-num">${d.getDate()}</span>
      <span class="day-name">${DAYS[d.getDay()]}</span>
      ${today ? '<div class="today-pip"></div>' : ''}
    `;
    container.appendChild(el);
  });
}

function renderTimeGutter() {
  const gutter = document.getElementById('time-gutter');
  gutter.innerHTML = '';
  for (let h = 0; h < 24; h++) {
    const cell = document.createElement('div');
    cell.className = 'time-cell';
    cell.innerHTML = `<span class="time-label">${h}:00</span>`;
    gutter.appendChild(cell);
  }
}

function renderDayColumns(week) {
  const container = document.getElementById('day-columns');
  container.innerHTML = '';

  const now = new Date();

  week.forEach((d, di) => {
    const today = isToday(d);
    const col = document.createElement('div');
    col.className = 'day-col' + (today ? ' today-col' : '');

    for (let h = 0; h < 24; h++) {
      const line = document.createElement('div');
      line.className = 'hour-line';
      line.style.top = (h * SLOT_H) + 'px';
      col.appendChild(line);
    }

    if (today) {
      const y = toY(now.getHours(), now.getMinutes());
      const nowLine = document.createElement('div');
      nowLine.className = 'now-line';
      nowLine.style.top = y + 'px';
      nowLine.innerHTML = '<div class="now-dot"></div><div class="now-bar"></div>';
      col.appendChild(nowLine);
    }

    const evs = eventsCache[toISO(d)] || [];
    evs.sort((a, b) => timeToMin(a.start_time) - timeToMin(b.start_time));

    evs.forEach(ev => {
      const [sh, sm] = ev.start_time.split(':').map(Number);
      const [eh, em] = ev.end_time.split(':').map(Number);
      const y = toY(sh, sm);
      const h = Math.max(toY(eh, em) - y, 18);
      const color = eventColor(ev.title);
      const conflict = hasConflict(evs, ev);

      const block = document.createElement('div');
      block.className = 'event-block' + (ev.done ? ' done' : '') + (conflict ? ' conflict' : '');
      block.style.cssText = `top:${y}px;height:${h}px`;
      block.style.setProperty('--event-color', color);
      block.style.setProperty('--event-color-30', color + '30');
      block.style.setProperty('--event-color-15', color + '15');
      block.setAttribute('data-event-id', ev.id);
      block.setAttribute('draggable', 'true');
      block.innerHTML = `
        <div class="ev-title">${ev.title}</div>
        ${h > 24 ? `<div class="ev-time">${ev.start_time}–${ev.end_time}</div>` : ''}
        <button class="ev-del" onclick="event.stopPropagation();deleteEvent('${ev.id}','${toISO(d)}')">×</button>
      `;
      block.addEventListener('click', (e) => { e.stopPropagation(); openEventPanel(ev, toISO(d)); });

      // Drag start
      block.addEventListener('dragstart', e => {
        dragEvent = { ev: { ...ev }, fromDate: toISO(d) };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', ev.id);
        setTimeout(() => { block.style.opacity = '0.35'; }, 0);
      });
      block.addEventListener('dragend', () => {
        block.style.opacity = '';
        dragEvent = null;
        document.querySelectorAll('.day-col.drag-over').forEach(c => c.classList.remove('drag-over'));
      });

      col.appendChild(block);
    });

    if (ghost && ghost.di === di) {
      const gy = toY(ghost.h, ghost.m);
      const gey = toY(ghost.eh, ghost.em);
      const gh = Math.max(gey - gy, 60);

      const gBlock = document.createElement('div');
      gBlock.className = 'ghost-block';
      gBlock.style.cssText = `top:${gy}px;height:${gh}px`;
      gBlock.innerHTML = `
        <input class="ghost-name-inp" id="ghost-inp" type="text" placeholder="nombre del evento..." value="${ghost.pre || ''}"/>
        <div class="ghost-times">
          <input class="ghost-time-inp" id="ghost-start" type="text" value="${fmtTime(ghost.h, ghost.m)}" placeholder="09:00"/>
          <span class="ghost-sep">→</span>
          <input class="ghost-time-inp" id="ghost-end" type="text" value="${fmtTime(ghost.eh, ghost.em)}" placeholder="10:00"/>
          <button class="ghost-ok" onclick="commitGhost('${toISO(d)}')">✓ ok</button>
        </div>
      `;
      gBlock.addEventListener('click', e => e.stopPropagation());
      col.appendChild(gBlock);

      setTimeout(() => {
        const inp = document.getElementById('ghost-inp');
        if (inp) {
          inp.focus();
          if (ghost.pre) inp.select();
        }
      }, 20);

      setTimeout(() => {
        const inp = document.getElementById('ghost-inp');
        if (inp) {
          inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') commitGhost(toISO(d));
            if (e.key === 'Escape') { ghost = null; renderSemana(); }
            e.stopPropagation();
          });
        }
      }, 25);
    }

    // Drag & drop — recibir eventos de otros días
    col.addEventListener('dragover', e => {
      if (!dragEvent) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', e => {
      if (!e.relatedTarget || !col.contains(e.relatedTarget)) {
        col.classList.remove('drag-over');
      }
    });
    col.addEventListener('drop', async e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (!dragEvent) return;
      const rect = col.getBoundingClientRect();
      const gridWrap = document.getElementById('grid-wrap');
      const relY = e.clientY - rect.top + gridWrap.scrollTop;
      const { h: newH, m: newM } = yToHM(relY);
      const [sh, sm] = dragEvent.ev.start_time.split(':').map(Number);
      const [eh, em] = dragEvent.ev.end_time.split(':').map(Number);
      const durationMin = Math.max((eh * 60 + em) - (sh * 60 + sm), 30);
      const newStartMin = newH * 60 + newM;
      const newEndMin = newStartMin + durationMin;
      const newEndH = Math.min(Math.floor(newEndMin / 60), 23);
      const newEndM = newEndMin % 60;
      const newStart = fmtTime(newH, newM);
      const newEnd = fmtTime(newEndH, newEndM);
      const newDateISO = toISO(d);
      if (newStart === dragEvent.ev.start_time && newDateISO === dragEvent.fromDate) { dragEvent = null; return; }
      const { error } = await db.from('events').update({ date: newDateISO, start_time: newStart, end_time: newEnd }).eq('id', dragEvent.ev.id);
      if (error) { showToast('Error al mover evento', 'error'); dragEvent = null; return; }
      eventsCache[dragEvent.fromDate] = (eventsCache[dragEvent.fromDate] || []).filter(ev => ev.id !== dragEvent.ev.id);
      if (!eventsCache[newDateISO]) eventsCache[newDateISO] = [];
      const moved = { ...dragEvent.ev, date: newDateISO, start_time: newStart, end_time: newEnd };
      eventsCache[newDateISO].push(moved);
      dragEvent = null;
      renderSemana();
      showToast('Evento movido', 'success');
    });

    col.addEventListener('click', (e) => {
      if (ghost) { ghost = null; renderSemana(); return; }

      const now = Date.now();
      if (now - _lastTapTime < 350 && _lastTapDi === di) {
        _lastTapTime = 0;
        const rect = col.getBoundingClientRect();
        const gridWrap = document.getElementById('grid-wrap');
        const relY = e.clientY - rect.top + gridWrap.scrollTop;
        const { h, m } = yToHM(relY);
        const em2 = (m + 30) % 60;
        const eh2 = m + 30 >= 60 ? h + 1 : h;
        ghost = { di, h, m, eh: Math.min(eh2, 23), em: em2, pre: '' };
        renderSemana();
      } else {
        _lastTapTime = now;
        _lastTapDi = di;
      }
    });

    container.appendChild(col);
  });

}

function commitGhost(dateISO) {
  const nameInp = document.getElementById('ghost-inp');
  const startInp = document.getElementById('ghost-start');
  const endInp = document.getElementById('ghost-end');

  const name = nameInp?.value?.trim() || '';
  if (!name) { ghost = null; renderSemana(); return; }

  const parseT = s => {
    const parts = (s || '').split(':');
    return { h: parseInt(parts[0]) || 9, m: parseInt(parts[1]) || 0 };
  };

  const start = parseT(startInp?.value);
  const end = parseT(endInp?.value);

  addEvent(dateISO, name, fmtTime(start.h, start.m), fmtTime(end.h, end.m));
}

function updateMomentum() {
  const { pct: commitPct, counted } = calcCommitmentScore();
  const { pct: momPct } = calcMomentum();

  const pct = counted > 0 ? commitPct : momPct;
  const color = commitmentColor(pct);

  const circ = 2 * Math.PI * 12;
  const dash = (pct / 100) * circ;

  const arc = document.getElementById('commitment-arc');
  if (arc) {
    arc.setAttribute('stroke-dasharray', `${dash.toFixed(1)} ${circ.toFixed(1)}`);
    arc.setAttribute('stroke', color);
  }

  const numEl = document.getElementById('commitment-num');
  if (numEl) numEl.textContent = pct;
}

// ── RENDER MES ──────────────────────────────────────────────

async function renderMes() {
  await loadMonth();

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + monthOffset;
  const d1 = new Date(y, m, 1);
  const lastDay = new Date(y, m + 1, 0).getDate();

  document.getElementById('mes-title').textContent =
    `${MONTHS_FULL[d1.getMonth()]} ${d1.getFullYear()}`;

  const grid = document.getElementById('mes-grid');
  grid.innerHTML = '';

  const startDay = d1.getDay() === 0 ? 6 : d1.getDay() - 1;
  for (let i = 0; i < startDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'mes-day other-month';
    grid.appendChild(empty);
  }

  for (let day = 1; day <= lastDay; day++) {
    const date = new Date(y, m, day);
    const dateISO = toISO(date);
    const evs = eventsCache[dateISO] || [];
    const today = isToday(date);
    const load = Math.min(evs.length / 5, 1);
    const fillColor = load > 0.7 ? '#F43F5E' : load > 0.4 ? '#F59E0B' : '#6366F1';

    const el = document.createElement('div');
    el.className = 'mes-day' + (today ? ' today' : '');

    const dots = evs.slice(0, 6).map(ev =>
      `<div class="mes-dot" style="background:${eventColor(ev.title)};opacity:${ev.done ? 0.3 : 1}"></div>`
    ).join('');

    el.innerHTML = `
      <span class="mes-day-num">${day}</span>
      <div class="mes-dots">${dots}</div>
      ${evs.length ? `
        <div class="mes-load-bar">
          <div class="mes-load-fill" style="width:${Math.round(load*100)}%;background:${fillColor}"></div>
        </div>
      ` : ''}
    `;

    el.addEventListener('click', () => {
      const now2 = new Date();
      now2.setHours(0, 0, 0, 0);
      const mon = new Date(now2);
      mon.setDate(now2.getDate() - ((now2.getDay() || 7) - 1));
      const tgt = new Date(date);
      tgt.setHours(0, 0, 0, 0);
      weekOffset = Math.round((tgt - mon) / (7 * 86400000));
      setView('semana');
    });

    grid.appendChild(el);
  }
}

function changeMes(dir) {
  monthOffset += dir;
  renderMes();
}

// ── RENDER PATRONES ─────────────────────────────────────────

async function renderPatrones() {
  const grid = document.getElementById('heatmap-grid');
  const insightEl = document.getElementById('hm-insight');
  grid.innerHTML = '';

  const { data, error } = await db
    .from('patterns')
    .select('day_of_week, hour, completion_rate, sample_count')
    .eq('user_id', currentUser.id);

  if (error || !data || !data.length) {
    grid.innerHTML = `<div class="hm-empty" style="grid-column:1/-1">
      Todavía no hay datos.<br>
      <span style="color:var(--text4);font-size:11px">Marcá eventos como hechos para ver tus patrones.</span>
    </div>`;
    insightEl.style.display = 'none';
    return;
  }

  // Índice por día+hora
  const map = {};
  data.forEach(p => { map[`${p.day_of_week}-${p.hour}`] = p; });

  // Días en orden lun-dom (1-7, donde 7=dom=0)
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const dayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  // Header vacío + días
  const emptyHeader = document.createElement('div');
  grid.appendChild(emptyHeader);
  dayLabels.forEach(d => {
    const h = document.createElement('div');
    h.className = 'hm-header';
    h.textContent = d;
    grid.appendChild(h);
  });

  // Filas por hora
  for (let h = 0; h < 24; h++) {
    const label = document.createElement('div');
    label.className = 'hm-hour-label';
    label.textContent = h + 'h';
    grid.appendChild(label);

    dayOrder.forEach(dow => {
      const p = map[`${dow}-${h}`];
      const cell = document.createElement('div');
      cell.className = 'hm-cell';

      if (!p || p.sample_count === 0) {
        cell.dataset.rate = 'none';
      } else if (p.completion_rate >= 0.7) {
        cell.dataset.rate = 'high';
      } else if (p.completion_rate >= 0.3) {
        cell.dataset.rate = 'mid';
      } else {
        cell.dataset.rate = 'low';
      }

      cell.title = p
        ? `${dayLabels[dayOrder.indexOf(dow)]} ${h}h — ${Math.round(p.completion_rate * 100)}% (${p.sample_count} eventos)`
        : '';
      grid.appendChild(cell);
    });
  }

  // Insight: mejor hora y mejor día
  let bestHour = null, bestDay = null, bestHourRate = -1, bestDayRate = -1;
  const dayRates = dayOrder.map(() => ({ sum: 0, count: 0 }));
  const hourRates = Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));

  data.forEach(p => {
    const di = dayOrder.indexOf(p.day_of_week);
    if (di !== -1) {
      dayRates[di].sum += p.completion_rate;
      dayRates[di].count++;
    }
    hourRates[p.hour].sum += p.completion_rate;
    hourRates[p.hour].count++;
  });

  dayRates.forEach((d, i) => {
    if (d.count && d.sum / d.count > bestDayRate) {
      bestDayRate = d.sum / d.count;
      bestDay = dayLabels[i];
    }
  });
  hourRates.forEach((h, i) => {
    if (h.count && h.sum / h.count > bestHourRate) {
      bestHourRate = h.sum / h.count;
      bestHour = i;
    }
  });

  if (bestDay && bestHour !== null) {
    insightEl.style.display = 'block';
    insightEl.textContent = `Tu mejor momento es el ${bestDay} a las ${bestHour}h — completás el ${Math.round(bestHourRate * 100)}% de lo que agendás ahí. Priorizá tareas importantes en esos horarios.`;
  }
}

// ── RENDER SUGERENCIAS ──────────────────────────────────────

async function renderSugerencias() {
  updateSugStats();
  renderConflicts();
  generateAISummary();
}

function updateSugStats() {
  const { done, total, pct } = calcMomentum();
  document.getElementById('sug-done').textContent = `${done}/${total}`;
  document.getElementById('sug-momentum').textContent = pct;
  document.getElementById('sug-total').textContent = total;
}

function renderConflicts() {
  const week = getWeekDates(weekOffset);
  const container = document.getElementById('sug-conflicts');
  container.innerHTML = '';

  week.forEach(d => {
    const evs = eventsCache[toISO(d)] || [];
    evs.forEach(ev => {
      if (hasConflict(evs, ev)) {
        const other = evs.find(o =>
          o.id !== ev.id && !o.done &&
          timeToMin(o.start_time) < timeToMin(ev.end_time) &&
          timeToMin(ev.start_time) < timeToMin(o.end_time)
        );
        if (other && ev.id < other.id) {
          const card = document.createElement('div');
          card.className = 'sug-card conflict';
          card.innerHTML = `
            <div class="sug-tag">
              <div class="sug-tag-dot" style="background:#F43F5E"></div>
              <span style="color:#F43F5E">Conflicto detectado</span>
            </div>
            <div class="sug-title">"${ev.title}" choca con "${other.title}"</div>
            <div class="sug-desc">
              ${DAYS_FULL[d.getDay()]} — ${ev.start_time} a ${ev.end_time} y ${other.start_time} a ${other.end_time} se superponen.
            </div>
            <div class="sug-btns">
              <button class="sug-btn sug-btn-secondary" onclick="this.closest('.sug-card').style.opacity='0.2'">Ignorar</button>
            </div>
          `;
          container.appendChild(card);
        }
      }
    });
  });
}

async function generateAISummary() {
  const week = getWeekDates(weekOffset);
  const resumenEl = document.getElementById('sug-resumen-text');
  resumenEl.innerHTML = `<span style="color:var(--text4)">Analizando tu semana...</span>`;

  const allEvs = week.flatMap(d => eventsCache[toISO(d)] || []);
  const done = allEvs.filter(e => e.done).length;
  const total = allEvs.length;

  const eventsText = week.flatMap(d =>
    (eventsCache[toISO(d)] || []).map(ev =>
      `${DAYS_FULL[d.getDay()]} ${ev.start_time}-${ev.end_time}: ${ev.title}${ev.done ? ' (✓)' : ''} (movido ${ev.rescheduled_count || 0}x)`
    )
  ).join('\n');

  try {
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `Sos el coach personal del usuario. Analizás su semana y dás feedback honesto pero compasivo en español rioplatense.
Respondé SOLO con JSON válido, sin markdown ni texto extra:
{"headline":"frase de 4-5 palabras sobre la semana","insight":"observación específica y útil, máximo 40 palabras","tip":"acción concreta para mejorar, máximo 25 palabras","best_day":"nombre del día con más completación"}`,
        messages: [{
          role: 'user',
          content: `Semana: ${total} eventos, ${done} completados.\n\n${eventsText || 'Sin eventos esta semana.'}`
        }]
      })
    });

    const data = await response.json();
    const raw = (data.content?.[0]?.text || '').trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      try { parsed = JSON.parse(m?.[1] || ''); } catch { parsed = null; }
    }
    if (!parsed || typeof parsed !== 'object') {
      parsed = {
        headline: total ? `${Math.round(done / total * 100)}% completado` : 'Semana sin eventos',
        insight: `Completaste ${done} de ${total} eventos esta semana.`,
        tip: 'La próxima semana, agendá menos pero cumplí más.',
        best_day: null
      };
    }

    resumenEl.innerHTML = `
      ${parsed.headline ? `<div style="font-size:15px;font-weight:500;color:var(--text);margin-bottom:8px;line-height:1.3">${parsed.headline}</div>` : ''}
      ${parsed.insight ? `<div style="font-size:12px;color:var(--text2);line-height:1.6;margin-bottom:10px">${parsed.insight}</div>` : ''}
      ${parsed.tip ? `<div style="font-size:11px;color:var(--accent);background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.15);border-radius:7px;padding:8px 10px;line-height:1.5;margin-bottom:6px">${parsed.tip}</div>` : ''}
      ${parsed.best_day ? `<div style="font-size:10px;color:var(--text4);margin-top:4px">Mejor día: <span style="color:var(--text3)">${parsed.best_day}</span></div>` : ''}
    `;
  } catch {
    resumenEl.textContent = 'No se pudo conectar con la IA.';
  }
}

async function handleAI() {
  const inp = document.getElementById('ai-inp');
  const resp = document.getElementById('ai-response');
  const v = inp.value.trim();
  if (!v) return;

  resp.style.display = 'block';
  resp.textContent = 'Analizando...';
  resp.style.color = '#3F3F46';
  inp.value = '';

  const week = getWeekDates(weekOffset);
  const eventsText = week.flatMap(d =>
    (eventsCache[toISO(d)] || []).map(ev =>
      `${DAYS_FULL[d.getDay()]} ${ev.start_time}-${ev.end_time}: ${ev.title}${ev.done ? ' (hecho)' : ''}`
    )
  ).join('\n');

  try {
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `Sos un asistente de agenda personal. Respondé en español rioplatense,
                 directo y conciso (máx 80 palabras). Si piden reorganizar,
                 sugerí cambios concretos con días y horarios. Sin saludos.`,
        messages: [{ role: 'user', content: `Mi agenda:\n${eventsText}\n\nMi consulta: ${v}` }]
      })
    });
    const data = await response.json();
    resp.style.color = '#71717A';
    resp.textContent = data.content?.[0]?.text || 'No se pudo procesar.';
  } catch (e) {
    resp.style.color = '#71717A';
    resp.textContent = 'Error al conectar con la IA.';
  }
}

// ── NAVEGACIÓN ──────────────────────────────────────────────

async function setView(view) {
  currentView = view;

  ['semana', 'mes', 'patrones', 'sugerencias'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.style.display = v === view ? 'flex' : 'none';

    const btn = document.getElementById('nav-' + v);
    if (btn) btn.classList.toggle('active', v === view);
  });

  const viewEl = document.getElementById('view-' + view);
  if (viewEl) {
    viewEl.style.animation = 'none';
    viewEl.offsetHeight;
    viewEl.style.animation = 'viewEnter 0.28s cubic-bezier(.4,0,.2,1)';
  }

  const weekNav = document.getElementById('week-nav');
  if (weekNav) weekNav.style.visibility = view === 'semana' ? 'visible' : 'hidden';

  if (view === 'semana') {
    ghost = null;
    await loadWeek();
    renderSemana();
    setTimeout(scrollToCurrentTime, 80);
  } else if (view === 'mes') {
    await renderMes();
  } else if (view === 'patrones') {
    await renderPatrones();
  } else if (view === 'sugerencias') {
    await renderSugerencias();
  }
}

async function changeWeek(dir) {
  const semana = document.getElementById('view-semana');
  semana.style.transition = 'transform 0.2s cubic-bezier(.4,0,.2,1), opacity 0.2s';
  semana.style.transform = `translateX(${dir < 0 ? '30px' : '-30px'})`;
  semana.style.opacity = '0';

  weekOffset += dir;
  ghost = null;
  showSkeleton();
  await loadWeek();

  semana.style.transition = 'none';
  semana.style.transform = `translateX(${dir < 0 ? '-30px' : '30px'})`;
  semana.style.opacity = '0';

  await new Promise(r => requestAnimationFrame(r));
  renderSemana();

  semana.style.transition = 'transform 0.24s cubic-bezier(.4,0,.2,1), opacity 0.24s';
  semana.style.transform = 'translateX(0)';
  semana.style.opacity = '1';

  setTimeout(() => {
    semana.style.transition = '';
    semana.style.transform = '';
    semana.style.opacity = '';
    scrollToCurrentTime();
  }, 260);
}

// ── NOTIFICACIONES ──────────────────────────────────────────

async function setupNotifications() {
  if (!notifOn || !('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if (Notification.permission === 'granted') {
    scheduleWeekNotifications();
  }
}

function scheduleWeekNotifications() {
  const week = getWeekDates(weekOffset);
  week.forEach(d => {
    (eventsCache[toISO(d)] || []).forEach(ev => scheduleNotification(ev));
  });
}

function scheduleNotification(ev) {
  if (!notifOn || Notification.permission !== 'granted') return;
  const eventTime = new Date(ev.date + 'T' + ev.start_time + ':00');
  const notifTime = new Date(eventTime.getTime() - 15 * 60 * 1000);
  const delay = notifTime - new Date();
  if (delay > 0) {
    setTimeout(() => {
      new Notification('foco. — en 15 minutos', {
        body: ev.title,
        icon: '/icon-192.png'
      });
    }, delay);
  }
}

// ── INPUT NL LIVE ───────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const nlInput = document.getElementById('nl-input');
  const chipsBar = document.getElementById('chips-bar');
  const chipsContent = document.getElementById('chips-content');

  nlInput.addEventListener('input', () => {
    const v = nlInput.value.trim();
    if (!v) {
      chipsBar.classList.remove('show');
      return;
    }

    const { name, date, h1, m1, h2, m2 } = parseNL(v);
    const chips = [];

    if (date) {
      chips.push(`<span class="chip chip-date">📅 ${DAYS[date.getDay()]} ${date.getDate()}/${date.getMonth() + 1}</span>`);
    }
    chips.push(`<span class="chip chip-time">⏱ ${fmtTime(h1, m1)}–${fmtTime(h2, m2)}</span>`);
    if (name && name !== 'Nuevo evento') {
      chips.push(`<span class="chip chip-name">✓ ${name}</span>`);
    }
    if (!date && v.length > 3) {
      chips.push(`<span class="chip chip-warn">¿cuándo?</span>`);
    }

    chipsContent.innerHTML = chips.join('');
    chipsBar.classList.add('show');
  });

  nlInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && nlInput.value.trim()) {
      const { name, date, h1, m1, h2, m2 } = parseNL(nlInput.value);
      if (!name) return;

      const dateISO = toISO(date);

      const week = getWeekDates(weekOffset);
      if (!week.some(d => toISO(d) === dateISO)) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const mon = new Date(now);
        mon.setDate(now.getDate() - ((now.getDay() || 7) - 1));
        const tgt = new Date(date);
        tgt.setHours(0, 0, 0, 0);
        weekOffset = Math.round((tgt - mon) / (7 * 86400000));
      }

      await addEvent(dateISO, name, fmtTime(h1, m1), fmtTime(h2, m2));

      nlInput.value = '';
      chipsBar.classList.remove('show');

      if (currentView !== 'semana') {
        setView('semana');
      } else {
        await loadWeek();
        renderSemana();
      }
    }

    if (e.key === 'Escape') {
      nlInput.value = '';
      chipsBar.classList.remove('show');
    }
  });

  document.addEventListener('click', (e) => {
    if (ghost &&
        !e.target.closest('.ghost-block') &&
        !e.target.closest('.day-col')) {
      ghost = null;
      if (currentView === 'semana') renderSemana();
    }
  });

  // Atajos de teclado globales
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

    // Cmd/Ctrl+K — command palette
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openCmd();
      return;
    }

    // Escape — cerrar panel y command palette
    if (e.key === 'Escape') {
      closeCmd();
      if (document.getElementById('event-panel')?.classList.contains('open')) closeEventPanel();
      return;
    }

    if (inInput) return;

    switch (e.key) {
      case 't': case 'T':
        weekOffset = 0;
        if (currentView === 'semana') { loadWeek().then(renderSemana); }
        else setView('semana');
        break;
      case 'ArrowLeft':
        if (currentView === 'semana') changeWeek(-1);
        break;
      case 'ArrowRight':
        if (currentView === 'semana') changeWeek(1);
        break;
      case 'n': case 'N':
        document.getElementById('nl-input')?.focus();
        break;
    }
  });

  // Command palette — input listener
  const cmdInp = document.getElementById('cmd-input');
  if (cmdInp) {
    cmdInp.addEventListener('input', e => renderCmdResults(e.target.value));
    cmdInp.addEventListener('keydown', e => {
      const items = document.querySelectorAll('.cmd-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        cmdFocusIdx = Math.min(cmdFocusIdx + 1, items.length - 1);
        renderCmdResults(cmdInp.value);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        cmdFocusIdx = Math.max(cmdFocusIdx - 1, 0);
        renderCmdResults(cmdInp.value);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const focused = document.querySelector('.cmd-item.focused');
        if (focused) focused.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeCmd();
      }
      e.stopPropagation();
    });
  }
});

// ── ONBOARDING ──────────────────────────────────────────────

function checkOnboarding() {
  if (!currentUser) return;
  const key = `foco_onboarded_${currentUser.id}`;
  if (localStorage.getItem(key)) return;

  // Usuario existente con eventos = ya usó la app, no mostrar
  const hasEvents = Object.values(eventsCache).some(evs => evs.length > 0);
  if (hasEvents) { localStorage.setItem(key, '1'); return; }

  showOnboarding();
}

function showOnboarding() {
  const name = currentProfile?.display_name || '';
  const titleEl = document.getElementById('ob-title-1');
  if (titleEl) titleEl.textContent = name ? `Hola, ${name.split(' ')[0]}.` : 'Hola.';
  const nameInp = document.getElementById('ob-name');
  if (nameInp) nameInp.value = name;
  document.getElementById('onboarding-screen').style.display = 'flex';
}

function obGoToStep(step) {
  [1, 2, 3].forEach(s => {
    document.getElementById(`ob-step-${s}`).classList.toggle('active', s === step);
    document.getElementById(`ob-dot-${s}`).classList.toggle('active', s === step);
  });
}

async function obNext(step) {
  if (step === 1) {
    const name = document.getElementById('ob-name').value.trim();
    if (!name) return;
    if (name !== currentProfile?.display_name) {
      await db.from('profiles').upsert({ id: currentUser.id, display_name: name });
      if (currentProfile) currentProfile.display_name = name;
    }
    obGoToStep(2);
    setTimeout(() => document.getElementById('ob-goal')?.focus(), 100);
  } else if (step === 2) {
    const goal = document.getElementById('ob-goal').value.trim();
    if (goal) {
      localStorage.setItem(`foco_week_goal_${currentUser.id}`, goal);
    }
    obGoToStep(3);
  }
}

function selectObHour(btn, h) {
  obSelectedHour = h;
  document.querySelectorAll('.time-option').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

async function obFinish() {
  localStorage.setItem(`foco_start_hour_${currentUser.id}`, obSelectedHour);
  localStorage.setItem(`foco_onboarded_${currentUser.id}`, '1');
  document.getElementById('onboarding-screen').style.display = 'none';
  // Hacer scroll al horario preferido
  const gridWrap = document.getElementById('grid-wrap');
  if (gridWrap) gridWrap.scrollTop = Math.max(0, (obSelectedHour - 1) * SLOT_H);
}

function getUserStartHour() {
  if (!currentUser) return null;
  const stored = localStorage.getItem(`foco_start_hour_${currentUser.id}`);
  return stored ? parseInt(stored) : null;
}

// ── WEEKLY DIGEST ───────────────────────────────────────────

async function checkWeeklyDigest() {
  if (!currentUser) return;
  const now = new Date();
  if (now.getDay() !== 0) return;   // solo domingo
  if (now.getHours() < 20) return;  // solo >= 20hs

  const weekStart = toISO(getWeekDates(weekOffset)[0]);
  const { data } = await db
    .from('weekly_digests')
    .select('id')
    .eq('user_id', currentUser.id)
    .eq('week_start', weekStart)
    .limit(1);

  if (!data || !data.length) {
    const digest = await generateWeeklyDigest();
    if (digest) showDigestModal(digest);
  }
}

async function generateWeeklyDigest() {
  const week = getWeekDates(weekOffset);
  const allEvs = week.flatMap(d => eventsCache[toISO(d)] || []);
  const done = allEvs.filter(e => e.done).length;
  const total = allEvs.length;
  if (!total) return null;

  const { pct: score } = calcCommitmentScore();

  const eventsText = week.flatMap(d =>
    (eventsCache[toISO(d)] || []).map(ev =>
      `${DAYS_FULL[d.getDay()]} ${ev.start_time}: ${ev.title} — ${ev.done ? 'completado' : 'no completado'} (movido ${ev.rescheduled_count || 0}x)`
    )
  ).join('\n');

  try {
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `Sos el coach personal del usuario. Analizás su semana y dás feedback honesto pero compasivo en español rioplatense.
Respondé SOLO con JSON válido, sin markdown:
{"headline":"frase de 5 palabras sobre la semana","insight":"observación específica y útil, máximo 40 palabras","tip":"acción concreta para la próxima semana, máximo 25 palabras","best_day":"nombre del día con más completación"}`,
        messages: [{
          role: 'user',
          content: `Semana: ${total} eventos, ${done} completados (${Math.round(done/total*100)}%)\n\n${eventsText}`
        }]
      })
    });

    const apiData = await response.json();
    const raw = (apiData.content?.[0]?.text || '').trim();

    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object') {
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      try { parsed = JSON.parse(m?.[1] || ''); } catch { parsed = null; }
    }
    if (!parsed || typeof parsed !== 'object') {
      parsed = {
        headline: `${Math.round(done/total*100)}% completado`,
        insight: `Completaste ${done} de ${total} eventos esta semana.`,
        tip: 'La próxima semana, agendá menos pero cumplí más.',
        best_day: 'Lunes'
      };
    }

    const weekStart = toISO(week[0]);
    await db.from('weekly_digests').upsert({
      user_id: currentUser.id,
      week_start: weekStart,
      commitment_score: score,
      completion_rate: done / total,
      best_day: parsed.best_day,
      total_focus_minutes: 0,
      ai_insight: parsed.insight,
      ai_tip: parsed.tip
    });

    return { ...parsed, done, total, score };
  } catch {
    return null;
  }
}

function showDigestModal(d) {
  const week = getWeekDates(weekOffset);
  document.getElementById('digest-week-label').textContent =
    `${toISO(week[0])} → ${toISO(week[6])}`;
  document.getElementById('digest-headline').textContent = d.headline || '—';
  document.getElementById('digest-stat-done').textContent = d.done;
  document.getElementById('digest-stat-score').textContent = (d.score || 0) + '%';
  document.getElementById('digest-stat-total').textContent = d.total;
  document.getElementById('digest-insight').textContent = d.insight || '';
  document.getElementById('digest-tip').textContent = d.tip || '';
  document.getElementById('digest-overlay').style.display = 'flex';
}

function closeDigest() {
  document.getElementById('digest-overlay').style.display = 'none';
}

// ── MORNING BRIEF ───────────────────────────────────────────

async function checkMorningBrief() {
  if (!currentUser) return;
  if (new Date().getHours() >= 11) return;

  const { data } = await db
    .from('daily_checkins')
    .select('id')
    .eq('user_id', currentUser.id)
    .eq('date', toISO(new Date()))
    .limit(1);

  if (!data || !data.length) showMorningBrief();
}

function showMorningBrief() {
  const firstName = (currentProfile?.display_name || '').split(' ')[0] || 'ahí';
  document.getElementById('morning-greeting').textContent = `Buenos días, ${firstName}.`;

  const today = toISO(new Date());
  const count = (eventsCache[today] || []).length;
  document.getElementById('morning-sub').textContent =
    count === 0 ? 'No tenés nada agendado hoy todavía.' :
    count === 1 ? 'Hoy tenés 1 cosa agendada.' :
    `Hoy tenés ${count} cosas agendadas.`;

  document.getElementById('morning-screen').style.display = 'flex';
  document.getElementById('morning-intention').focus();
}

function selectMorningEnergy(e) {
  morningEnergy = e;
  document.querySelectorAll('.energy-btn').forEach(btn => {
    btn.classList.toggle('selected', parseInt(btn.dataset.e) === e);
  });
}

async function submitMorningBrief() {
  const btn = document.getElementById('morning-cta');
  btn.disabled = true;

  const intention = document.getElementById('morning-intention').value.trim();
  const moodMap = ['bad', 'tired', 'ok', 'good', 'great'];

  await db.from('daily_checkins').upsert({
    user_id: currentUser.id,
    date: toISO(new Date()),
    energy: morningEnergy,
    intention: intention || null,
    mood: morningEnergy ? moodMap[morningEnergy - 1] : null
  });

  document.getElementById('morning-screen').style.display = 'none';
  morningEnergy = null;
  btn.disabled = false;
}

// ── TEMPLATES BAR ───────────────────────────────────────────

async function loadTemplates() {
  if (!currentUser) return;
  const since = toISO(new Date(Date.now() - 30 * 86400000));
  const { data } = await db
    .from('events')
    .select('title, start_time, end_time')
    .eq('user_id', currentUser.id)
    .gte('date', since);

  if (!data || !data.length) return;

  const groups = {};
  data.forEach(ev => {
    const key = ev.title.toLowerCase().trim();
    if (!groups[key]) groups[key] = { title: ev.title, starts: [], ends: [], count: 0 };
    groups[key].count++;
    groups[key].starts.push(timeToMin(ev.start_time));
    groups[key].ends.push(timeToMin(ev.end_time));
  });

  const top5 = Object.values(groups)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(g => ({
      title: g.title,
      avgStart: Math.round(g.starts.reduce((a, b) => a + b, 0) / g.starts.length),
      avgEnd: Math.round(g.ends.reduce((a, b) => a + b, 0) / g.ends.length)
    }));

  renderTemplates(top5);
}

function renderTemplates(templates) {
  const bar = document.getElementById('templates-bar');
  if (!bar || !templates.length) return;

  bar.style.display = 'flex';
  bar.innerHTML = '';

  templates.forEach(t => {
    const startH = Math.floor(t.avgStart / 60), startM = t.avgStart % 60;
    const endH = Math.floor(t.avgEnd / 60), endM = t.avgEnd % 60;
    const pill = document.createElement('button');
    pill.className = 'template-pill';
    pill.textContent = t.title;
    pill.addEventListener('click', () =>
      addFromTemplate(t.title, fmtTime(startH, startM), fmtTime(endH, endM))
    );
    bar.appendChild(pill);
  });
}

async function addFromTemplate(title, startTime, endTime) {
  const today = toISO(new Date());
  if (!getWeekDates(weekOffset).some(d => toISO(d) === today)) weekOffset = 0;
  await addEvent(today, title, startTime, endTime);
  if (currentView !== 'semana') setView('semana');
}

// ── EVENT PANEL ─────────────────────────────────────────────

function openEventPanel(ev, dateISO) {
  panelEvent = ev;
  panelDateISO = dateISO;
  panelEnergy = null;
  currentSession.eventId = ev.id;
  currentSession.startedAt = null;
  currentSession.paused = false;
  currentSession.pausedRemaining = null;

  stopFocusTimer();
  hidePanelTimer();

  document.getElementById('panel-title').textContent = ev.title;

  const d = new Date(dateISO + 'T12:00:00');
  const dayStr = DAYS_FULL[d.getDay()];
  document.getElementById('panel-meta').textContent =
    `${ev.start_time} – ${ev.end_time} · ${dayStr}`;

  const color = eventColor(ev.title);
  document.getElementById('event-panel').style.setProperty('--event-color', color);
  const bar = document.getElementById('panel-color-bar');
  if (bar) bar.style.background = color;

  const detailsEl = document.getElementById('panel-details');
  if (detailsEl) {
    detailsEl.value = ev.notes || '';
    autoresizeDetails(detailsEl);
  }

  updateDoneButton(!!ev.done);

  document.getElementById('event-panel').classList.add('open');
  document.getElementById('panel-overlay').classList.add('open');
}

function updateDoneButton(done) {
  const btn   = document.getElementById('panel-done-main');
  const label = document.getElementById('panel-done-label');
  if (!btn || !label) return;
  label.textContent = done ? 'Completada' : 'Marcar como completada';
  btn.classList.toggle('done', done);
}

function autoresizeDetails(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

const _debouncedSaveDetails = debounce(async (id, notes) => {
  await db.from('events').update({ notes }).eq('id', id);
}, 800);

function savePanelDetails() {
  if (!panelEvent) return;
  const val = document.getElementById('panel-details')?.value ?? '';
  if (panelEvent) panelEvent.notes = val;
  _debouncedSaveDetails(panelEvent.id, val);
}

function closeEventPanel() {
  document.getElementById('event-panel').classList.remove('open');
  document.getElementById('panel-overlay').classList.remove('open');
  stopFocusTimer();
  exitAmbientMode();
  panelEvent = null;
  panelDateISO = null;
}

async function panelToggleDone() {
  if (!panelEvent) return;
  await toggleDone(panelEvent.id, panelDateISO);
  panelEvent = (eventsCache[panelDateISO] || []).find(e => e.id === panelEvent.id);
  if (!panelEvent) { closeEventPanel(); return; }
  updateDoneButton(!!panelEvent.done);
}

async function panelDeleteEvent() {
  if (!panelEvent) return;
  await deleteEvent(panelEvent.id, panelDateISO);
  closeEventPanel();
}

// ── FOCUS TIMER — panel compacto ────────────────────────────

const PANEL_TIMER_TOTAL = 25 * 60;
const PANEL_RING_CIRC = 88;

function startSession() {
  currentSession.startedAt = Date.now();
  currentSession.paused = false;
  currentSession.pausedRemaining = null;
  focusTimerEndTime = Date.now() + PANEL_TIMER_TOTAL * 1000;

  showPanelTimer();
  enterAmbientMode();
  runPanelTimer();
}

function showPanelTimer() {
  const row = document.getElementById('panel-timer-row');
  const btn = document.getElementById('focus-start-btn');
  if (row) row.style.display = 'flex';
  if (btn) btn.style.display = 'none';
  updatePanelTimerDisplay(PANEL_TIMER_TOTAL);
}

function hidePanelTimer() {
  const row = document.getElementById('panel-timer-row');
  const btn = document.getElementById('focus-start-btn');
  if (row) row.style.display = 'none';
  if (btn) btn.style.display = 'flex';
}

function updatePanelTimerDisplay(secondsLeft) {
  const el = document.getElementById('panel-timer-count');
  if (!el) return;
  const m = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const s = String(secondsLeft % 60).padStart(2, '0');
  el.textContent = `${m}:${s}`;

  const ring = document.getElementById('panel-ring');
  if (ring) {
    const elapsed = 1 - Math.max(0, secondsLeft / PANEL_TIMER_TOTAL);
    ring.style.strokeDashoffset = PANEL_RING_CIRC * elapsed;
  }
}

function runPanelTimer() {
  focusTimerRunning = true;
  let lastSec = -1;

  const tick = () => {
    if (!focusTimerRunning) return;
    const remainingMs = Math.max(0, focusTimerEndTime - Date.now());
    const remainingSec = Math.ceil(remainingMs / 1000);

    if (remainingSec !== lastSec) {
      lastSec = remainingSec;
      updatePanelTimerDisplay(remainingSec);
    }

    if (remainingMs <= 0) {
      stopFocusTimer();
      hidePanelTimer();
      exitAmbientMode();
      saveFocusSession(true);
      showToast('Sesión de 25 min completada', 'success');
      return;
    }
    focusTimerRAF = requestAnimationFrame(tick);
  };
  focusTimerRAF = requestAnimationFrame(tick);
}

function stopFocusTimer() {
  focusTimerRunning = false;
  if (focusTimerRAF) { cancelAnimationFrame(focusTimerRAF); focusTimerRAF = null; }
  focusTimerEndTime = null;
}

function stopPanelTimer() {
  stopFocusTimer();
  hidePanelTimer();
  exitAmbientMode();
  saveFocusSession(false);
}

function togglePause() {
  const btn = document.getElementById('panel-timer-pause');
  if (!currentSession.paused) {
    currentSession.paused = true;
    currentSession.pausedRemaining = focusTimerEndTime ? focusTimerEndTime - Date.now() : null;
    stopFocusTimer();
    focusTimerRunning = false;
    if (btn) btn.textContent = 'Reanudar';
  } else {
    currentSession.paused = false;
    if (currentSession.pausedRemaining !== null) {
      focusTimerEndTime = Date.now() + currentSession.pausedRemaining;
    }
    runPanelTimer();
    if (btn) btn.textContent = 'Pausar';
  }
}

async function saveFocusSession(completed) {
  if (!currentUser || !panelEvent) return;
  const elapsedMs = currentSession.startedAt ? Date.now() - currentSession.startedAt : 0;
  const actualMin = Math.max(1, Math.round(elapsedMs / 60000));
  await db.from('focus_sessions').insert({
    user_id: currentUser.id,
    event_id: panelEvent.id,
    started_at: new Date(currentSession.startedAt || Date.now()).toISOString(),
    ended_at: new Date().toISOString(),
    planned_minutes: 25,
    actual_minutes: actualMin,
    completed,
    energy_after: panelEnergy,
    notes: null
  });
}

// ── SKELETON LOADING ────────────────────────────────────────

function showSkeleton() {
  const container = document.getElementById('day-columns');
  if (!container) return;
  container.innerHTML = '';
  const slotPatterns = [
    [{ top: 120, h: 96 }, { top: 288, h: 144 }, { top: 528, h: 72 }],
    [{ top: 96, h: 72 }, { top: 336, h: 96 }],
    [{ top: 192, h: 120 }, { top: 432, h: 96 }, { top: 672, h: 72 }],
    [{ top: 144, h: 144 }],
    [{ top: 240, h: 96 }, { top: 480, h: 72 }],
    [{ top: 168, h: 120 }, { top: 384, h: 96 }],
    [{ top: 96, h: 96 }],
  ];
  for (let d = 0; d < 7; d++) {
    const col = document.createElement('div');
    col.className = 'day-col';
    col.style.height = '1152px';
    (slotPatterns[d] || []).forEach(({ top, h }) => {
      const block = document.createElement('div');
      block.className = 'skeleton-block';
      block.style.cssText = `top:${top}px;height:${h}px`;
      col.appendChild(block);
    });
    container.appendChild(col);
  }
}

// ── PARTÍCULAS & CONFETTI ────────────────────────────────────

function fireParticles(x, y) {
  const canvas = document.getElementById('particles-canvas');
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  const colors = ['#6366F1','#8B5CF6','#06B6D4','#10B981','#F59E0B','#A78BFA'];
  const particles = Array.from({ length: 18 }, () => ({
    x, y,
    vx: (Math.random() - 0.5) * 9,
    vy: (Math.random() - 0.5) * 9 - 3,
    size: Math.random() * 5 + 2,
    color: colors[Math.floor(Math.random() * colors.length)],
    life: 1,
    decay: Math.random() * 0.025 + 0.018
  }));
  const animate = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    particles.forEach(p => {
      if (p.life <= 0) return;
      alive = true;
      p.x += p.vx; p.y += p.vy; p.vy += 0.22; p.life -= p.decay;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (alive) requestAnimationFrame(animate);
    else canvas.style.display = 'none';
  };
  requestAnimationFrame(animate);
}

function fireConfetti() {
  const canvas = document.getElementById('particles-canvas');
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  const colors = ['#6366F1','#8B5CF6','#06B6D4','#10B981','#F59E0B','#F43F5E','#A78BFA','#67E8F9'];
  const pieces = Array.from({ length: 70 }, () => ({
    x: Math.random() * canvas.width,
    y: -10 - Math.random() * 80,
    vx: (Math.random() - 0.5) * 5,
    vy: Math.random() * 4 + 2,
    size: Math.random() * 9 + 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.18,
    dead: false
  }));
  const animate = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach(p => {
      if (p.dead) return;
      p.x += p.vx; p.y += p.vy; p.rotation += p.rotSpeed;
      if (p.y > canvas.height + 20) { p.dead = true; return; }
      alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    });
    if (alive) requestAnimationFrame(animate);
    else canvas.style.display = 'none';
  };
  requestAnimationFrame(animate);
}

// ── COMMAND PALETTE ──────────────────────────────────────────

const CMD_ACTIONS = [
  { label: 'Ir a hoy',          icon: '📅', hint: 'T', fn: () => { weekOffset = 0; setView('semana'); } },
  { label: 'Semana anterior',   icon: '‹',  hint: '←', fn: () => changeWeek(-1) },
  { label: 'Semana siguiente',  icon: '›',  hint: '→', fn: () => changeWeek(1) },
  { label: 'Vista Semana',      icon: '▦',  hint: '',  fn: () => setView('semana') },
  { label: 'Vista Mes',         icon: '◉',  hint: '',  fn: () => setView('mes') },
  { label: 'Vista Patrones',    icon: '◈',  hint: '',  fn: () => setView('patrones') },
  { label: 'Vista Sugerencias', icon: '✦',  hint: '',  fn: () => setView('sugerencias') },
  { label: 'Nuevo evento',      icon: '+',  hint: 'N', fn: () => { closeCmd(); document.getElementById('nl-input').focus(); } },
  { label: 'Modo foco ambiente',icon: '✿',  hint: '',  fn: () => { closeCmd(); toggleAmbientMode(); } },
  { label: 'Cerrar sesión',     icon: '↪',  hint: '',  fn: () => logout() },
];

let cmdFocusIdx = 0;

function openCmd() {
  const overlay = document.getElementById('cmd-overlay');
  const palette = document.getElementById('cmd-palette');
  if (!overlay || !palette) return;
  overlay.classList.add('open');
  palette.classList.add('open');
  const inp = document.getElementById('cmd-input');
  if (inp) { inp.value = ''; inp.focus(); }
  cmdFocusIdx = 0;
  renderCmdResults('');
}

function closeCmd() {
  document.getElementById('cmd-overlay')?.classList.remove('open');
  document.getElementById('cmd-palette')?.classList.remove('open');
}

function renderCmdResults(query) {
  const results = document.getElementById('cmd-results');
  if (!results) return;
  const q = query.toLowerCase();
  const filtered = CMD_ACTIONS.filter(a => !q || a.label.toLowerCase().includes(q));
  results.innerHTML = filtered.map((a, i) => `
    <div class="cmd-item${i === cmdFocusIdx ? ' focused' : ''}" data-idx="${CMD_ACTIONS.indexOf(a)}" onclick="execCmd(${CMD_ACTIONS.indexOf(a)})">
      <span class="cmd-item-icon">${a.icon}</span>
      <span class="cmd-item-label">${a.label}</span>
      ${a.hint ? `<span class="cmd-item-hint">${a.hint}</span>` : ''}
    </div>
  `).join('');
}

function execCmd(idx) {
  closeCmd();
  CMD_ACTIONS[idx]?.fn();
}

// ── AMBIENT MODE ─────────────────────────────────────────────

function enterAmbientMode() {
  ambientActive = true;
  document.body.classList.add('ambient');
}

function exitAmbientMode() {
  ambientActive = false;
  document.body.classList.remove('ambient');
}

function toggleAmbientMode() {
  ambientActive ? exitAmbientMode() : enterAmbientMode();
  showToast(ambientActive ? 'Modo foco activo' : 'Modo foco desactivado', 'info');
}

// ── RENDERIZADO SELECTIVO ────────────────────────────────────

let _savedScroll = 0;
function saveScroll() {
  const gw = document.getElementById('grid-wrap');
  _savedScroll = gw ? gw.scrollTop : 0;
}
function restoreScroll() {
  const gw = document.getElementById('grid-wrap');
  if (gw) gw.scrollTop = _savedScroll;
}

function updateEventDoneInDOM(id, done) {
  const block = document.querySelector(`[data-event-id="${id}"]`);
  if (!block) { saveScroll(); renderSemana(); restoreScroll(); return; }
  block.classList.remove('completing');
  block.classList.toggle('done', done);
}

function removeEventFromDOM(id) {
  const block = document.querySelector(`[data-event-id="${id}"]`);
  if (!block) { saveScroll(); renderSemana(); restoreScroll(); return; }
  block.style.transition = 'all 0.22s cubic-bezier(.4,0,.2,1)';
  block.style.opacity = '0';
  block.style.transform = 'scale(0.92) translateX(6px)';
  block.style.filter = 'blur(2px)';
  setTimeout(() => { block.remove(); updateMomentum(); }, 230);
}

function addEventToDOM(ev, dateISO, dayIndex) {
  const cols = document.querySelectorAll('.day-col');
  const col = cols[dayIndex];
  if (!col) { saveScroll(); renderSemana(); restoreScroll(); return; }

  document.querySelector('.ghost-block')?.remove();

  const [sh, sm] = ev.start_time.split(':').map(Number);
  const [eh, em] = ev.end_time.split(':').map(Number);
  const y = toY(sh, sm);
  const h = Math.max(toY(eh, em) - y, 18);
  const color = eventColor(ev.title);
  const conflict = hasConflict(eventsCache[dateISO] || [], ev);

  const block = document.createElement('div');
  block.className = 'event-block' + (conflict ? ' conflict' : '');
  block.style.cssText = `top:${y}px;height:${h}px`;
  block.style.setProperty('--event-color', color);
  block.style.setProperty('--event-color-30', color + '30');
  block.style.setProperty('--event-color-15', color + '15');
  block.setAttribute('data-event-id', ev.id);
  block.setAttribute('draggable', 'true');
  block.innerHTML = `
    <div class="ev-title">${ev.title}</div>
    ${h > 24 ? `<div class="ev-time">${ev.start_time}–${ev.end_time}</div>` : ''}
    <button class="ev-del" onclick="event.stopPropagation();deleteEvent('${ev.id}','${dateISO}')">×</button>
  `;
  block.addEventListener('click', () => openEventPanel(ev, dateISO));
  block.addEventListener('dragstart', e => {
    dragEvent = { ev: { ...ev }, fromDate: dateISO };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ev.id);
    setTimeout(() => { block.style.opacity = '0.35'; }, 0);
  });
  block.addEventListener('dragend', () => {
    block.style.opacity = '';
    dragEvent = null;
    document.querySelectorAll('.day-col.drag-over').forEach(c => c.classList.remove('drag-over'));
  });

  col.appendChild(block);
  updateMomentum();
}

// ── ARRANCAR ────────────────────────────────────────────────
init();
