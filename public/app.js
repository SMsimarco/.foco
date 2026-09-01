// ═══════════════════════════════════════════════════════════
// foco. — app.js
// ═══════════════════════════════════════════════════════════

// ── CONFIGURACIÓN SUPABASE ──────────────────────────────────
const SUPABASE_URL = 'https://hgvfzwmtepztkdoxjptu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Ej3NewanSxjLVwiue6rD7w_PwQfGZ5a';
const CLAUDE_API_KEY = null; // Key en servidor — no exponer en frontend

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}

// ── ÁREAS DE VIDA ────────────────────────────────────────────
const AREAS = {
  trabajo:     { label: 'Trabajo',     color: '#3B82F6' },
  salud:       { label: 'Salud',       color: '#10B981' },
  relaciones:  { label: 'Relaciones',  color: '#F43F5E' },
  aprendizaje: { label: 'Aprendizaje', color: '#FBBF24' },
  descanso:    { label: 'Descanso',    color: '#06B6D4' }
};

// ── ESTADO GLOBAL ───────────────────────────────────────────
const SLOT_H = 48; // px por hora — NO CAMBIAR
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DAYS_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const COLORS = [
  '#818CF8', // ámbar
  '#8B5CF6', // violeta
  '#06B6D4', // cyan
  '#10B981', // esmeralda
  '#F43F5E', // rosa
  '#3B82F6', // azul
  '#A78BFA', // lavanda
  '#34D399', // verde menta
  '#22D3EE', // celeste
  '#A5B4FC', // dorado claro
];

const PROJ_COLS = [
  { id: 'idea',      label: 'Idea',      color: '#71717A' },
  { id: 'en_curso',  label: 'En curso',  color: '#3B82F6' },
  { id: 'bloqueado', label: 'Bloqueado', color: '#FB923C' },
  { id: 'hecho',     label: 'Hecho',     color: '#10B981' },
];

let currentUser = null;
let currentProfile = null;
let weekOffset = 0; // semana de referencia para métricas globales (ring, Sugerencias) — no navega la vista Hoy
let diaActual = new Date(); // día mostrado en la vista Hoy
diaActual.setHours(0, 0, 0, 0);
let monthOffset = 0;
let currentView = 'semana';
let eventsCache = {}; // { 'YYYY-MM-DD': [...events] }
let notifOn = true;
let authMode = 'login';

// Proyectos state
let draggedProjId = null;
let projModalId = null;
let pmEstado = 'idea';
let pmArea = null;

// Tu año state
let tuanaChartPeriod = 'mes';
let tuanaEventsCache  = [];
let tuanaChartVals    = [];
let tuanaChartLabels  = [];

// Onboarding state
let obSelectedHour = 9;

// Morning brief state
let morningEnergy = null;

// Evening checkin state
let eveningMainChoice = null;
let eveningEnergy = null;

// Weekly review state
let reviewAnswers = {};

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

function isTomorrow(date) {
  const t = new Date(); t.setDate(t.getDate() + 1);
  return date.toDateString() === t.toDateString();
}

function isYesterday(date) {
  const y = new Date(); y.setDate(y.getDate() - 1);
  return date.toDateString() === y.toDateString();
}

function eventColor(title, area) {
  if (area && AREAS[area]) return AREAS[area].color;
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
  if (pct > 60) return '#818CF8';
  if (pct > 40) return '#818CF8';
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

const GOOGLE_CLIENT_ID = '268120297099-c2uml03ln4c3uoffqpgiebju7tm2e2mg.apps.googleusercontent.com';
const VAPID_PUBLIC_KEY = 'BFsTfVDGrFgb523bGBTe-kNZned8b0dojS1DcVp_GIAK-58MJHf0fLIDc664EG2wrPD-RZC8M6Vlsp-GiWF1v7M';

function switchTab(mode) {
  authMode = mode;
  document.getElementById('field-name').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('auth-btn').textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
  document.getElementById('auth-error').textContent = '';
  const sw = document.getElementById('auth-switch');
  sw.innerHTML = mode === 'login'
    ? '¿No tenés cuenta? <span>Registrate</span>'
    : '¿Ya tenés cuenta? <span>Entrá</span>';
  sw.onclick = () => switchTab(mode === 'login' ? 'register' : 'login');
}

function backToLogin() {
  document.getElementById('auth-box-confirm').style.display = 'none';
  document.getElementById('auth-box-form').style.display = 'flex';
  switchTab('login');
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
      if (data.session) {
        currentUser = data.user;
        await db.from('profiles').upsert({ id: data.user.id, display_name: name });
        const { data: profile } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
        currentProfile = profile;
        showApp();
      } else {
        document.getElementById('auth-box-form').style.display = 'none';
        document.getElementById('auth-box-confirm').style.display = 'flex';
      }
    }
  } catch (err) {
    errorEl.textContent = err.message || 'Error al iniciar sesión.';
    btn.disabled = false;
    btn.textContent = authMode === 'login' ? 'Entrar' : 'Crear cuenta';
  }
}

// ── GOOGLE SIGN-IN ──────────────────────────────────────────

async function generarNonce() {
  const nonceCrudo = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const bytes = new TextEncoder().encode(nonceCrudo);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const nonceHasheado = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return { nonceCrudo, nonceHasheado };
}

async function handleGoogleCredential(response) {
  const errorEl = document.getElementById('auth-error');
  const { nonceCrudo } = window.__focoGoogleNonce || {};
  const { data, error } = await db.auth.signInWithIdToken({
    provider: 'google',
    token: response.credential,
    nonce: nonceCrudo
  });
  if (error) {
    errorEl.textContent = error.message;
    return;
  }
  currentUser = data.user;
  let { data: profile } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
  if (!profile) {
    const name = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || 'Usuario';
    await db.from('profiles').upsert({ id: currentUser.id, display_name: name });
    const res = await db.from('profiles').select('*').eq('id', currentUser.id).single();
    profile = res.data;
  }
  currentProfile = profile;
  showApp();
}

async function initGoogleButton() {
  if (!window.google?.accounts?.id || GOOGLE_CLIENT_ID.startsWith('REEMPLAZAR')) return;
  const container = document.getElementById('google-btn');
  if (!container) return;

  window.__focoGoogleNonce = await generarNonce();

  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
    nonce: window.__focoGoogleNonce.nonceHasheado,
    use_fedcm_for_prompt: true
  });

  window.google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text: 'continue_with',
    width: 320
  });
}

async function logout() {
  await db.auth.signOut();
}

function toggleNotif() {
  notifOn = !notifOn;
  const btn = document.getElementById('notif-btn');
  btn.classList.toggle('off', !notifOn);
  if (notifOn) setupNotifications();
  else disableNotifications();
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
  if (window.google?.accounts?.id) {
    initGoogleButton();
  } else {
    document.getElementById('google-identity-script')?.addEventListener('load', initGoogleButton, { once: true });
  }
}

async function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  await loadWeek(); // datos semanales para el ring de commitment y Sugerencias
  await loadDia();
  renderHoy();
  setupNotifications();

  checkOnboarding();
  checkMorningBrief();
  checkEveningCheckin();
  checkEstadoDia();
  checkCartaDomingo();
  checkWeeklyDigest();
  checkMonthlyInsight();
  initGoalBar();
  startLiveClock();
}

// ── CARGA DE DATOS ──────────────────────────────────────────

async function loadWeek() {
  if (!currentUser) return;
  const week = getWeekDates(weekOffset);
  const start = toISO(week[0]);
  const end = toISO(week[week.length - 1]);

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

  // Inyectar eventos recurrentes en los días que correspondan
  const { data: recData } = await db
    .from('events')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('recurrente', true);

  (recData || []).forEach(ev => {
    ev.start_time = ev.start_time ? ev.start_time.slice(0, 5) : ev.start_time;
    ev.end_time   = ev.end_time   ? ev.end_time.slice(0, 5)   : ev.end_time;
    week.forEach(d => {
      // dia_semana null = todos los días; número = ese día de semana
      if (ev.dia_semana === null || d.getDay() === ev.dia_semana) {
        const iso = toISO(d);
        if (!eventsCache[iso]) eventsCache[iso] = [];
        if (!eventsCache[iso].find(e => e.id === ev.id)) {
          eventsCache[iso].push({ ...ev, date: iso });
        }
      }
    });
  });
}

// Carga los eventos del día mostrado en la vista Hoy (independiente de loadWeek,
// que sigue existiendo solo para las métricas semanales del header/Sugerencias).
async function loadDia() {
  if (!currentUser) return;
  const dateISO = toISO(diaActual);
  const diaSemana = diaActual.getDay();

  const { data, error } = await db
    .from('events')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('date', dateISO);

  if (error) { console.error(error); return; }

  eventsCache[dateISO] = (data || []).map(ev => {
    ev.start_time = ev.start_time ? ev.start_time.slice(0, 5) : null;
    ev.end_time   = ev.end_time   ? ev.end_time.slice(0, 5)   : null;
    return ev;
  });

  // Inyectar eventos recurrentes que correspondan a este día de semana
  const { data: recData } = await db
    .from('events')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('recurrente', true);

  (recData || []).forEach(ev => {
    if (ev.dia_semana !== null && ev.dia_semana !== diaSemana) return;
    if (eventsCache[dateISO].find(e => e.id === ev.id)) return;
    eventsCache[dateISO].push({
      ...ev,
      date: dateISO,
      start_time: ev.start_time ? ev.start_time.slice(0, 5) : null,
      end_time: ev.end_time ? ev.end_time.slice(0, 5) : null
    });
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

let _pendingEvent = null;
let addAsFocus = false;

function toggleAddFocus(e) {
  e.stopPropagation();
  addAsFocus = !addAsFocus;
  const btn = document.getElementById('input-focus-toggle');
  btn.classList.toggle('active', addAsFocus);
  btn.textContent = addAsFocus ? '★' : '☆';
}

function promptAndAddEvent(dateISO, title, startTime, endTime, isFocus = false) {
  if (!title.trim()) return;
  _pendingEvent = { dateISO, title, startTime, endTime, isFocus };
  document.getElementById('recur-modal-title').textContent = `"${title}"`;
  document.getElementById('recur-modal').classList.add('open');
  document.getElementById('recur-overlay').classList.add('open');
}

async function confirmRecurrence(type) {
  if (!_pendingEvent) return;
  const { dateISO, title, startTime, endTime, isFocus } = _pendingEvent;
  _pendingEvent = null;
  closeRecurModal();

  let recurrente = false;
  let diaSemana = null;
  if (type === 'weekly') {
    recurrente = true;
    diaSemana = new Date(dateISO + 'T12:00:00').getDay();
  } else if (type === 'daily') {
    recurrente = true;
    diaSemana = null;
  }

  await addEvent(dateISO, title, startTime, endTime, recurrente, diaSemana, isFocus);
}

function closeRecurModal() {
  document.getElementById('recur-modal').classList.remove('open');
  document.getElementById('recur-overlay').classList.remove('open');
}

function cancelRecurModal() {
  _pendingEvent = null;
  closeRecurModal();
}

async function addEvent(dateISO, title, startTime, endTime, recurrente = false, diaSemana = null, isFocus = false) {
  if (!currentUser || !title.trim()) return;

  const { data, error } = await db.from('events').insert({
    user_id: currentUser.id,
    title: title.trim(),
    date: dateISO,
    start_time: startTime,
    end_time: endTime,
    done: false,
    recurrente,
    dia_semana: diaSemana,
    is_focus: isFocus
  }).select().single();

  if (error) { console.error(error); return; }

  if (!eventsCache[dateISO]) eventsCache[dateISO] = [];
  eventsCache[dateISO].push(data);

  if (dateISO === toISO(diaActual)) renderHoy();
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
  let horaFound = rangeFound;
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
        horaFound = true;
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
    // sin hora detectada → null (cae en "Cuando puedas" en vez de 9-10 default)
    h1: horaFound ? Math.min(h1, 23) : null,
    m1: horaFound ? m1 : null,
    h2: horaFound ? Math.min(h2, 23) : null,
    m2: horaFound ? m2 : null
  };
}

// ── RENDER HOY ──────────────────────────────────────────────

const MONTHS_LOWER = MONTHS_FULL.map(m => m.toLowerCase());

function checkIconSVG() {
  return `<svg width="10" height="10" viewBox="0 0 14 14" fill="none">
    <polyline points="2,7 5.5,10.5 12,3" stroke="#fff" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function hoyRowHTML(ev, dateISO, mostrarHora) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let horaHTML = '';
  if (mostrarHora) {
    const startMin = timeToMin(ev.start_time);
    const endMin = ev.end_time ? timeToMin(ev.end_time) : startMin + 60;
    const esAhora = isToday(diaActual) && nowMin >= startMin && nowMin < endMin;
    horaHTML = esAhora
      ? `<span class="hoy-row-time"><span class="hoy-now-pill">ahora</span></span>`
      : `<span class="hoy-row-time">${ev.start_time}</span>`;
  }
  return `
    <div class="hoy-row" data-event-id="${ev.id}" onclick="openEventPanel(eventsCache['${dateISO}'].find(e=>e.id==='${ev.id}'), '${dateISO}')">
      <button class="hoy-check${ev.done ? ' done' : ''}" onclick="event.stopPropagation();toggleDone('${ev.id}','${dateISO}')">
        ${ev.done ? checkIconSVG() : ''}
      </button>
      <span class="hoy-row-title${ev.done ? ' done' : ''}">${ev.title}</span>
      ${horaHTML}
      <span class="hoy-row-chevron">›</span>
    </div>
  `;
}

// Enfoca el input de agregar y lo trae a la vista (arriba, siempre visible)
function focusNlInput() {
  const inp = document.getElementById('nl-input');
  if (!inp) return;
  inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
  inp.focus();
}

function renderHoy() {
  const dateISO = toISO(diaActual);
  const dayEvents = eventsCache[dateISO] || [];

  // Header: título grande + fecha
  const titleEl = document.getElementById('hoy-title');
  const dateEl = document.getElementById('hoy-date');
  if (titleEl) {
    titleEl.textContent = isToday(diaActual) ? 'Hoy'
      : isTomorrow(diaActual) ? 'Mañana'
      : isYesterday(diaActual) ? 'Ayer'
      : DAYS_FULL[diaActual.getDay()];
  }
  if (dateEl) dateEl.textContent = `${diaActual.getDate()} de ${MONTHS_LOWER[diaActual.getMonth()]}`;

  // Agrupar: foco (máx 3, no se repiten abajo) / con hora / sin hora
  const foco = dayEvents.filter(e => e.is_focus).slice(0, 3);
  const conHora = dayEvents.filter(e => !e.is_focus && e.start_time)
    .sort((a, b) => timeToMin(a.start_time) - timeToMin(b.start_time));
  const sinHora = dayEvents.filter(e => !e.is_focus && !e.start_time);

  const secFoco = document.getElementById('hoy-section-foco');
  const listFoco = document.getElementById('hoy-list-foco');
  if (listFoco) listFoco.innerHTML = foco.map(ev => hoyRowHTML(ev, dateISO, !!ev.start_time)).join('');
  if (secFoco) secFoco.style.display = foco.length ? '' : 'none';

  const secHora = document.getElementById('hoy-section-hora');
  const listHora = document.getElementById('hoy-list-hora');
  if (listHora) listHora.innerHTML = conHora.map(ev => hoyRowHTML(ev, dateISO, true)).join('');
  if (secHora) secHora.style.display = conHora.length ? '' : 'none';

  const secLibre = document.getElementById('hoy-section-libre');
  const listLibre = document.getElementById('hoy-list-libre');
  if (listLibre) listLibre.innerHTML = sinHora.map(ev => hoyRowHTML(ev, dateISO, false)).join('');
  if (secLibre) secLibre.style.display = sinHora.length ? '' : 'none';

  updateMomentum();
}

async function changeDia(dir) {
  const wrap = document.getElementById('hoy-scroll');
  if (wrap) {
    wrap.style.transition = 'transform 0.2s cubic-bezier(.4,0,.2,1), opacity 0.2s';
    wrap.style.transform = `translateX(${dir < 0 ? '30px' : '-30px'})`;
    wrap.style.opacity = '0';
  }

  diaActual.setDate(diaActual.getDate() + dir);
  await loadDia();

  if (wrap) {
    wrap.style.transition = 'none';
    wrap.style.transform = `translateX(${dir < 0 ? '-30px' : '30px'})`;
    await new Promise(r => requestAnimationFrame(r));
  }

  renderHoy();

  if (wrap) {
    wrap.style.transition = 'transform 0.24s cubic-bezier(.4,0,.2,1), opacity 0.24s';
    wrap.style.transform = 'translateX(0)';
    wrap.style.opacity = '1';
    setTimeout(() => { wrap.style.transition = ''; wrap.style.transform = ''; wrap.style.opacity = ''; }, 260);
  }
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
    const fillColor = load > 0.7 ? '#F43F5E' : load > 0.4 ? '#818CF8' : '#818CF8';

    const el = document.createElement('div');
    el.className = 'mes-day' + (today ? ' today' : '');

    const dots = evs.slice(0, 6).map(ev =>
      `<div class="mes-dot" style="background:${eventColor(ev.title, ev.area)};opacity:${ev.done ? 0.3 : 1}"></div>`
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
      diaActual = new Date(date);
      diaActual.setHours(0, 0, 0, 0);
      setView('semana');
    });

    grid.appendChild(el);
  }
}

function changeMes(dir) {
  monthOffset += dir;
  renderMes();
}

// ── PROYECTOS ────────────────────────────────────────────────

async function renderProyectos() {
  if (!currentUser) return;
  const { data } = await db.from('proyectos')
    .select('*').eq('user_id', currentUser.id)
    .order('created_at', { ascending: true });
  const all = data || [];

  const recordatorios = all.filter(p => p.estado === 'recordatorio')
    .sort((a, b) => {
      if (!a.fecha_limite) return 1;
      if (!b.fecha_limite) return -1;
      return new Date(a.fecha_limite) - new Date(b.fecha_limite);
    });
  const notas    = all.filter(p => p.estado === 'nota').reverse();
  const projs    = all.filter(p => !['recordatorio','nota'].includes(p.estado));

  // Recordatorios
  const recList = document.getElementById('recordatorios-list');
  if (recList) {
    recList.innerHTML = recordatorios.length === 0
      ? '<div class="slab-empty">Sin fechas próximas</div>'
      : recordatorios.map(r => {
          const hoy = new Date(); hoy.setHours(0,0,0,0);
          let rightHtml = '';
          if (r.fecha_limite) {
            const fl = new Date(r.fecha_limite + 'T00:00:00');
            const diff = Math.ceil((fl - hoy) / 86400000);
            const cls = diff < 0 ? 'overdue' : diff <= 2 ? 'soon' : diff <= 7 ? 'week' : '';
            const label = diff < 0 ? 'Vencido' : diff === 0 ? 'Hoy' : `${diff}d`;
            const dateStr = fl.getDate() + '/' + (fl.getMonth()+1);
            rightHtml = `<div class="recorda-right">
              <span class="recorda-date">${dateStr}</span>
              <span class="recorda-badge ${cls}">${label}</span>
            </div>`;
          }
          return `<div class="slab-item">
            <button class="slab-del" onclick="event.stopPropagation();deleteProyecto('${r.id}')">×</button>
            <span class="slab-item-name">${escH(r.nombre)}</span>
            ${rightHtml}
          </div>`;
        }).join('');
  }

  // Notas
  const notasList = document.getElementById('notas-list');
  if (notasList) {
    notasList.innerHTML = notas.length === 0
      ? '<div class="slab-empty">Sin notas</div>'
      : notas.map(n => `
          <div class="slab-item nota-item">
            <button class="slab-del" onclick="event.stopPropagation();deleteProyecto('${n.id}')">×</button>
            <span class="slab-item-name nota-text">${escH(n.nombre)}</span>
          </div>`).join('');
  }

  // Proyectos
  const projList = document.getElementById('proyectos-simple-list');
  if (projList) {
    projList.innerHTML = projs.length === 0
      ? '<div class="slab-empty">Sin proyectos aún</div>'
      : projs.map(p => {
          const col = PROJ_COLS.find(c => c.id === p.estado) || PROJ_COLS[0];
          const area = p.area && AREAS[p.area] ? AREAS[p.area] : null;
          const prog = p.progreso || 0;
          return `<div class="slab-item proj-item" onclick="openProjModal('${p.id}')">
            <div class="proj-item-top">
              <span class="proj-dot" style="background:${col.color}"></span>
              <span class="slab-item-name">${escH(p.nombre)}</span>
              <span class="proj-chip" style="color:${col.color};border-color:${col.color}20">${col.label}</span>
            </div>
            ${area || prog > 0 ? `<div class="proj-item-foot">
              ${area ? `<span class="proj-area" style="color:${area.color}">${area.label}</span>` : '<span></span>'}
              ${prog > 0 ? `<span class="proj-pct">${prog}%</span>` : ''}
            </div>` : ''}
            ${prog > 0 ? `<div class="proj-progress"><div class="proj-progress-fill" style="width:${prog}%;background:${col.color}40;--fill:${col.color}"></div></div>` : ''}
          </div>`;
        }).join('');
  }
}

async function deleteProyecto(id) {
  await db.from('proyectos').delete().eq('id', id).eq('user_id', currentUser.id);
  renderProyectos();
}

function toggleRecordaForm() {
  const f = document.getElementById('recorda-form');
  const open = f.style.display === 'none';
  f.style.display = open ? 'flex' : 'none';
  if (open) setTimeout(() => document.getElementById('recorda-nombre').focus(), 50);
}

function toggleNotaForm() {
  const f = document.getElementById('nota-form');
  const open = f.style.display === 'none';
  f.style.display = open ? 'flex' : 'none';
  if (open) setTimeout(() => document.getElementById('nota-texto').focus(), 50);
}

async function saveRecordatorio() {
  const nombre = document.getElementById('recorda-nombre').value.trim();
  if (!nombre) return;
  const fecha = document.getElementById('recorda-fecha').value || null;
  await db.from('proyectos').insert({
    user_id: currentUser.id, nombre, fecha_limite: fecha,
    estado: 'recordatorio', updated_at: new Date().toISOString()
  });
  document.getElementById('recorda-nombre').value = '';
  document.getElementById('recorda-fecha').value  = '';
  document.getElementById('recorda-form').style.display = 'none';
  renderProyectos();
}

async function saveNota() {
  const texto = document.getElementById('nota-texto').value.trim();
  if (!texto) return;
  await db.from('proyectos').insert({
    user_id: currentUser.id, nombre: texto,
    estado: 'nota', updated_at: new Date().toISOString()
  });
  document.getElementById('nota-texto').value = '';
  document.getElementById('nota-form').style.display = 'none';
  renderProyectos();
}

function proyectoCardHTML(p, color) {
  const area = p.area && AREAS[p.area] ? AREAS[p.area] : null;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  let fechaStr = '';
  if (p.fecha_limite) {
    const fl = new Date(p.fecha_limite + 'T00:00:00');
    const diff = Math.ceil((fl - hoy) / 86400000);
    if (diff < 0)        fechaStr = `<span class="pcard-fecha overdue">Vencido</span>`;
    else if (diff === 0) fechaStr = `<span class="pcard-fecha today">Hoy</span>`;
    else if (diff <= 3)  fechaStr = `<span class="pcard-fecha soon">${diff}d</span>`;
    else                 fechaStr = `<span class="pcard-fecha">${fl.getDate()}/${fl.getMonth()+1}</span>`;
  }
  const progreso = p.progreso || 0;
  return `
    <div class="lead-card"
         data-id="${escH(p.id)}"
         draggable="true"
         style="--cc:${color}"
         onclick="openProjModal('${escH(p.id)}')">
      <div class="lcard-name">${escH(p.nombre)}</div>
      ${p.descripcion ? `<div class="lcard-tipo">${escH(p.descripcion)}</div>` : ''}
      <div class="lcard-foot">
        ${area
          ? `<span class="pcard-area"><span class="pcard-area-dot" style="background:${area.color}"></span><span style="color:${area.color}">${area.label}</span></span>`
          : '<span></span>'}
        ${fechaStr}
      </div>
      ${progreso > 0 ? `
        <div class="pcard-progress-bar">
          <div class="pcard-progress-fill" style="width:${progreso}%;background:${color}"></div>
        </div>
      ` : ''}
    </div>
  `;
}

function escH(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function moverProyecto(id, estado) {
  await db.from('proyectos')
    .update({ estado, updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', currentUser.id);
  renderProyectos();
}

async function openProjModal(id, estadoDefault) {
  projModalId = id || null;
  pmEstado = estadoDefault || 'idea';
  pmArea = null;

  const title  = document.getElementById('lm-title');
  const delBtn = document.getElementById('lm-del');

  if (id) {
    const { data } = await db.from('proyectos').select('*').eq('id', id).single();
    if (!data) return;
    document.getElementById('lm-nombre').value              = data.nombre      || '';
    document.getElementById('lm-desc').value                = data.descripcion || '';
    document.getElementById('lm-fecha').value               = data.fecha_limite || '';
    document.getElementById('lm-progreso').value            = data.progreso || 0;
    document.getElementById('lm-progreso-val').textContent  = (data.progreso || 0) + '%';
    document.getElementById('lm-notas').value               = data.notas || '';
    pmEstado = data.estado || 'idea';
    pmArea   = data.area   || null;
    title.textContent    = 'Editar proyecto';
    delBtn.style.display = 'block';
  } else {
    document.getElementById('lm-nombre').value             = '';
    document.getElementById('lm-desc').value               = '';
    document.getElementById('lm-fecha').value              = '';
    document.getElementById('lm-progreso').value           = 0;
    document.getElementById('lm-progreso-val').textContent = '0%';
    document.getElementById('lm-notas').value              = '';
    title.textContent    = 'Nuevo proyecto';
    delBtn.style.display = 'none';
  }

  renderPmEstados();
  renderPmAreas();

  document.getElementById('lead-backdrop').style.display = 'block';
  document.getElementById('lead-modal').style.display    = 'flex';
  setTimeout(() => document.getElementById('lm-nombre').focus(), 60);
}

function renderPmEstados() {
  document.getElementById('lm-estados').innerHTML = PROJ_COLS.map(col => `
    <button class="lm-estado-btn${pmEstado === col.id ? ' active' : ''}"
            style="${pmEstado === col.id ? `background:${col.color};border-color:${col.color};color:#fff` : ''}"
            onclick="selectPmEstado('${col.id}')">
      ${col.label}
    </button>
  `).join('');
}

function selectPmEstado(id) {
  pmEstado = id;
  renderPmEstados();
}

function renderPmAreas() {
  document.getElementById('lm-areas').innerHTML = Object.entries(AREAS).map(([key, a]) => `
    <button class="lm-area-btn${pmArea === key ? ' active' : ''}"
            style="${pmArea === key ? `border-color:${a.color};color:${a.color}` : ''}"
            onclick="selectPmArea('${key}')">
      <span class="lm-area-dot" style="background:${a.color}"></span>
      ${a.label}
    </button>
  `).join('');
}

function selectPmArea(key) {
  pmArea = pmArea === key ? null : key;
  renderPmAreas();
}

function closeProjModal() {
  document.getElementById('lead-backdrop').style.display = 'none';
  document.getElementById('lead-modal').style.display    = 'none';
  projModalId = null;
}

async function saveProjModal() {
  const nombre = document.getElementById('lm-nombre').value.trim();
  if (!nombre) { document.getElementById('lm-nombre').focus(); return; }

  const payload = {
    nombre,
    descripcion:   document.getElementById('lm-desc').value.trim()    || null,
    fecha_limite:  document.getElementById('lm-fecha').value           || null,
    progreso:      parseInt(document.getElementById('lm-progreso').value) || 0,
    area:          pmArea  || null,
    notas:         document.getElementById('lm-notas').value.trim()   || null,
    estado:        pmEstado,
    updated_at:    new Date().toISOString()
  };

  if (projModalId) {
    await db.from('proyectos').update(payload).eq('id', projModalId).eq('user_id', currentUser.id);
  } else {
    await db.from('proyectos').insert({ ...payload, user_id: currentUser.id });
  }

  closeProjModal();
  renderProyectos();
}

async function deleteProjModal() {
  if (!projModalId) return;
  if (!confirm('¿Eliminar este proyecto?')) return;
  await db.from('proyectos').delete().eq('id', projModalId).eq('user_id', currentUser.id);
  closeProjModal();
  renderProyectos();
}

// ── RENDER PATRONES (legacy stub) ───────────────────────────

async function renderPatrones() {
  const uid = currentUser.id;
  const dayOrder  = [1, 2, 3, 4, 5, 6, 0];
  const dayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  // ── Fetch en paralelo ────────────────────────────────────────
  const [patternsRes, doneRes, totalRes] = await Promise.all([
    db.from('patterns').select('day_of_week,hour,completion_rate,sample_count').eq('user_id', uid),
    db.from('events').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('done', true),
    db.from('events').select('id', { count: 'exact', head: true }).eq('user_id', uid)
  ]);

  const patterns  = patternsRes.data || [];
  const totalDone = doneRes.count  || 0;
  const totalAll  = totalRes.count || 0;

  // ── Stats cards ──────────────────────────────────────────────
  const rate = totalAll > 0 ? Math.round(totalDone / totalAll * 100) : 0;

  const hourMap = {};
  patterns.forEach(p => {
    if (p.sample_count > 1) {
      if (!hourMap[p.hour]) hourMap[p.hour] = { sum: 0, n: 0 };
      hourMap[p.hour].sum += p.completion_rate;
      hourMap[p.hour].n++;
    }
  });
  let bestHourStat = null, bestHourStatRate = -1;
  Object.entries(hourMap).forEach(([h, v]) => {
    const avg = v.sum / v.n;
    if (avg > bestHourStatRate) { bestHourStatRate = avg; bestHourStat = Number(h); }
  });

  const elDone = document.getElementById('stat-done');
  const elRate = document.getElementById('stat-rate');
  const elHour = document.getElementById('stat-hour');
  if (elDone) elDone.textContent = totalDone;
  if (elRate) elRate.textContent = totalAll > 0 ? rate + '%' : '—';
  if (elHour) elHour.textContent = bestHourStat !== null ? bestHourStat + 'h' : '—';

  // ── Bar chart por día ────────────────────────────────────────
  const chartEl = document.getElementById('day-bar-chart');
  if (chartEl) {
    if (!patterns.length) {
      chartEl.innerHTML = '';
    } else {
      const dayMap = {};
      patterns.forEach(p => {
        if (p.sample_count > 0) {
          if (!dayMap[p.day_of_week]) dayMap[p.day_of_week] = { sum: 0, n: 0 };
          dayMap[p.day_of_week].sum += p.completion_rate;
          dayMap[p.day_of_week].n++;
        }
      });
      const rates   = dayOrder.map(dow => dayMap[dow] ? dayMap[dow].sum / dayMap[dow].n : 0);
      const maxRate = Math.max(...rates, 0.01);

      chartEl.innerHTML = `
        <div class="day-bar-wrap">
          ${rates.map((r) => `
            <div class="day-bar-col">
              <div class="day-bar-pct">${r > 0.05 ? Math.round(r * 100) + '%' : ''}</div>
              <div class="day-bar-inner${r < 0.05 ? ' bar-empty' : ''}"
                   style="height:${Math.round((r / maxRate) * 64)}px"></div>
            </div>
          `).join('')}
        </div>
        <div class="day-bar-labels">
          ${dayLabels.map(d => `<div class="day-bar-label">${d}</div>`).join('')}
        </div>
      `;
    }
  }

  // ── Heatmap ──────────────────────────────────────────────────
  const grid      = document.getElementById('heatmap-grid');
  const insightEl = document.getElementById('hm-insight');
  grid.innerHTML  = '';

  if (!patterns.length) {
    grid.innerHTML = `<div class="hm-empty" style="grid-column:1/-1">
      Todavía no hay datos.<br>
      <span style="color:var(--text4);font-size:11px">Marcá eventos como hechos para ver tus patrones.</span>
    </div>`;
    if (insightEl) insightEl.style.display = 'none';
    return;
  }

  const map = {};
  patterns.forEach(p => { map[`${p.day_of_week}-${p.hour}`] = p; });

  const emptyHeader = document.createElement('div');
  grid.appendChild(emptyHeader);
  dayLabels.forEach(d => {
    const h = document.createElement('div');
    h.className = 'hm-header';
    h.textContent = d;
    grid.appendChild(h);
  });

  for (let h = 0; h < 24; h++) {
    const label = document.createElement('div');
    label.className = 'hm-hour-label';
    label.textContent = h + 'h';
    grid.appendChild(label);

    dayOrder.forEach(dow => {
      const p    = map[`${dow}-${h}`];
      const cell = document.createElement('div');
      cell.className = 'hm-cell';
      if (!p || p.sample_count === 0)     cell.dataset.rate = 'none';
      else if (p.completion_rate >= 0.7)  cell.dataset.rate = 'high';
      else if (p.completion_rate >= 0.3)  cell.dataset.rate = 'mid';
      else                                cell.dataset.rate = 'low';
      cell.title = p
        ? `${dayLabels[dayOrder.indexOf(dow)]} ${h}h — ${Math.round(p.completion_rate * 100)}% (${p.sample_count} eventos)`
        : '';
      grid.appendChild(cell);
    });
  }

  // Insight
  let bestDay = null, bestHour = null, bestHourRate = -1, bestDayRate = -1;
  const dayRates  = dayOrder.map(() => ({ sum: 0, count: 0 }));
  const hourRates = Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));
  patterns.forEach(p => {
    const di = dayOrder.indexOf(p.day_of_week);
    if (di !== -1) { dayRates[di].sum += p.completion_rate; dayRates[di].count++; }
    hourRates[p.hour].sum += p.completion_rate;
    hourRates[p.hour].count++;
  });
  dayRates.forEach((d, i)  => { if (d.count && d.sum / d.count > bestDayRate)  { bestDayRate  = d.sum / d.count; bestDay  = dayLabels[i]; } });
  hourRates.forEach((hr, i) => { if (hr.count && hr.sum / hr.count > bestHourRate) { bestHourRate = hr.sum / hr.count; bestHour = i; } });

  if (insightEl && bestDay && bestHour !== null) {
    insightEl.style.display = 'block';
    insightEl.textContent = `Tu mejor momento es el ${bestDay} a las ${bestHour}h — completás el ${Math.round(bestHourRate * 100)}% de lo que agendás ahí.`;
  }

  renderMoodTimeline();
  renderAreasTimeline();
}

// ── RENDER SUGERENCIAS ──────────────────────────────────────

async function renderSugerencias() {
  updateSugStats();
  renderConflicts();
  generateAISummary();
  renderAreasBreakdown();
  renderPalabrasHistoria();
  updateEstadoCard();
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
      ${parsed.tip ? `<div style="font-size:11px;color:var(--accent);background:rgba(129,140,248,.08);border:1px solid rgba(129,140,248,.15);border-radius:7px;padding:8px 10px;line-height:1.5;margin-bottom:6px">${parsed.tip}</div>` : ''}
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

  ['semana', 'mes', 'patrones', 'sugerencias', 'equipo', 'foquito'].forEach(v => {
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

  if (view === 'semana') {
    await loadDia();
    renderHoy();
  } else if (view === 'mes') {
    await renderMes();
  } else if (view === 'patrones') {
    await renderProyectos();
  } else if (view === 'sugerencias') {
    await loadWeek();
    await renderSugerencias();
  } else if (view === 'equipo') {
    renderEquipo();
  } else if (view === 'foquito') {
    renderFoquito();
  }
}

// ── FOQUITO (chat) ──────────────────────────────────────────

let _foqGreeted = false;
let _foqRecognition = null;
let _foqRecording = false;

function renderFoquito() {
  if (_foqGreeted) return;
  _foqGreeted = true;
  addFoqBubble('Hola, soy Foquito. Contame qué tenés que hacer, por texto o por audio, y te lo anoto.', 'foq');
}

function addFoqBubble(text, who) {
  const wrap = document.getElementById('foq-messages');
  const bubble = document.createElement('div');
  bubble.className = 'foq-bubble foq-bubble-' + who;
  bubble.textContent = text;
  wrap.appendChild(bubble);
  wrap.scrollTop = wrap.scrollHeight;
}

async function sendFoquitoMessage(rawText) {
  const inp = document.getElementById('foq-input');
  const text = (rawText !== undefined ? rawText : inp.value).trim();
  if (!text) return;

  addFoqBubble(text, 'user');
  inp.value = '';

  const { name, date, h1, m1, h2, m2 } = parseNL(text);
  if (!name) {
    addFoqBubble('No entendí bien qué querés anotar. ¿Podés contarme de nuevo?', 'foq');
    return;
  }

  const dateISO = toISO(date);
  const startTime = h1 !== null ? fmtTime(h1, m1) : null;
  const endTime = h2 !== null ? fmtTime(h2, m2) : null;

  await addEvent(dateISO, name, startTime, endTime, false, null, false);

  const dayLabel = dateISO === toISO(new Date())
    ? 'hoy'
    : `el ${DAYS[date.getDay()]} ${date.getDate()}/${date.getMonth() + 1}`;
  const timeLabel = startTime ? ` a las ${startTime}` : '';
  addFoqBubble(`Anotado: "${name}" ${dayLabel}${timeLabel}.`, 'foq');

  if (currentView === 'semana') {
    await loadDia();
    renderHoy();
  }
}

function toggleFoquitoMic() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Tu navegador no soporta dictado por voz', 'error');
    return;
  }

  const btn = document.getElementById('foq-mic-btn');

  if (_foqRecording) {
    _foqRecognition?.stop();
    return;
  }

  _foqRecognition = new SpeechRecognition();
  _foqRecognition.lang = 'es-AR';
  _foqRecognition.interimResults = false;
  _foqRecognition.maxAlternatives = 1;

  _foqRecognition.onstart = () => {
    _foqRecording = true;
    btn.classList.add('recording');
  };

  _foqRecognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    sendFoquitoMessage(transcript);
  };

  _foqRecognition.onerror = () => {
    showToast('No se pudo escuchar el audio', 'error');
  };

  _foqRecognition.onend = () => {
    _foqRecording = false;
    btn.classList.remove('recording');
  };

  _foqRecognition.start();
}

// ── NOTIFICACIONES PUSH ─────────────────────────────────────
// Suscripción real vía Push API + Service Worker: llegan aunque
// la app esté cerrada. El disparo (15min antes del evento) lo
// hace un GitHub Action server-side, no el navegador.

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function setupNotifications() {
  const btn = document.getElementById('notif-btn');
  if (!notifOn) return;

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // iOS: Push solo funciona instalada como PWA (Compartir > Agregar a inicio), no en Safari
    btn?.classList.add('error');
    return;
  }

  try {
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { btn?.classList.add('error'); return; }
    }
    if (Notification.permission !== 'granted') { btn?.classList.add('error'); return; }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    const raw = sub.toJSON();
    await db.from('push_subscriptions').upsert({
      user_id: currentUser.id,
      endpoint: raw.endpoint,
      p256dh: raw.keys.p256dh,
      auth: raw.keys.auth
    }, { onConflict: 'endpoint' });
    btn?.classList.remove('error');
  } catch (err) {
    console.error('setupNotifications:', err);
    btn?.classList.add('error');
  }
}

async function disableNotifications() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
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
    chips.push(h1 !== null
      ? `<span class="chip chip-time">⏱ ${fmtTime(h1, m1)}–${fmtTime(h2, m2)}</span>`
      : `<span class="chip chip-time">◌ sin hora</span>`);
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

      if (dateISO !== toISO(diaActual)) {
        diaActual = new Date(date);
        diaActual.setHours(0, 0, 0, 0);
      }

      const startTime = h1 !== null ? fmtTime(h1, m1) : null;
      const endTime = h2 !== null ? fmtTime(h2, m2) : null;
      promptAndAddEvent(dateISO, name, startTime, endTime, addAsFocus);

      nlInput.value = '';
      chipsBar.classList.remove('show');
      if (addAsFocus) toggleAddFocus(e);

      if (currentView !== 'semana') {
        setView('semana');
      } else {
        await loadDia();
        renderHoy();
      }
    }

    if (e.key === 'Escape') {
      nlInput.value = '';
      chipsBar.classList.remove('show');
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
        diaActual = new Date(); diaActual.setHours(0, 0, 0, 0);
        if (currentView === 'semana') { loadDia().then(renderHoy); }
        else setView('semana');
        break;
      case 'ArrowLeft':
        if (currentView === 'semana') changeDia(-1);
        break;
      case 'ArrowRight':
        if (currentView === 'semana') changeDia(1);
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

// swipe horizontal para navegar entre días en mobile
(function() {
  let tx = 0, ty = 0;
  document.addEventListener('touchstart', e => {
    if (!document.getElementById('view-semana') || document.getElementById('view-semana').style.display === 'none') return;
    tx = e.touches[0].clientX;
    ty = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!document.getElementById('view-semana') || document.getElementById('view-semana').style.display === 'none') return;
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      changeDia(dx < 0 ? 1 : -1);
    }
  }, { passive: true });
})();

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
  const horaStr = ev.start_time && ev.end_time ? `${ev.start_time} – ${ev.end_time}` : 'Sin hora';
  document.getElementById('panel-meta').textContent = `${horaStr} · ${dayStr}`;

  const color = eventColor(ev.title, ev.area);
  document.getElementById('event-panel').style.setProperty('--event-color', color);
  const bar = document.getElementById('panel-color-bar');
  if (bar) bar.style.background = color;

  const detailsEl = document.getElementById('panel-details');
  if (detailsEl) {
    detailsEl.value = ev.notes || '';
    autoresizeDetails(detailsEl);
  }

  updateDoneButton(!!ev.done);
  renderAreaPills(ev.area || 'trabajo');

  const recOnce = document.getElementById('recur-once');
  const recWeekly = document.getElementById('recur-weekly');
  if (recOnce && recWeekly) {
    recOnce.classList.toggle('active', !ev.recurrente);
    recWeekly.classList.toggle('active', !!ev.recurrente);
  }
  updateFocusButton(!!ev.is_focus);

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

async function setPanelRecurrence(recurrente) {
  if (!panelEvent) return;
  const diaSemana = new Date(panelDateISO + 'T12:00:00').getDay();

  const { error } = await db.from('events').update({
    recurrente,
    dia_semana: recurrente ? diaSemana : null
  }).eq('id', panelEvent.id);

  if (error) { console.error(error); return; }

  panelEvent.recurrente = recurrente;
  panelEvent.dia_semana = recurrente ? diaSemana : null;

  const cached = (eventsCache[panelDateISO] || []).find(e => e.id === panelEvent.id);
  if (cached) {
    cached.recurrente = recurrente;
    cached.dia_semana = recurrente ? diaSemana : null;
  }

  document.getElementById('recur-once').classList.toggle('active', !recurrente);
  document.getElementById('recur-weekly').classList.toggle('active', recurrente);

  renderHoy();
  showToast(recurrente ? 'Se repite cada semana' : 'Solo esta vez', 'success');
}

// "Foco del día" — máx 3 tareas prioritarias por día
async function setPanelFocus() {
  if (!panelEvent) return;
  const newVal = !panelEvent.is_focus;

  if (newVal) {
    const dayEvs = eventsCache[panelDateISO] || [];
    const focusCount = dayEvs.filter(e => e.is_focus && e.id !== panelEvent.id).length;
    if (focusCount >= 3) { showToast('Ya tenés 3 tareas en Tu foco', 'error'); return; }
  }

  const { error } = await db.from('events').update({ is_focus: newVal }).eq('id', panelEvent.id);
  if (error) { console.error(error); return; }

  panelEvent.is_focus = newVal;
  const cached = (eventsCache[panelDateISO] || []).find(e => e.id === panelEvent.id);
  if (cached) cached.is_focus = newVal;

  updateFocusButton(newVal);
  renderHoy();
  showToast(newVal ? 'Agregado a Tu foco' : 'Sacado de Tu foco', 'success');
}

function updateFocusButton(active) {
  const btn = document.getElementById('panel-focus-toggle');
  const icon = document.getElementById('panel-focus-icon');
  if (!btn) return;
  btn.classList.toggle('active', active);
  if (icon) icon.textContent = active ? '★' : '☆';
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

// ── PARTÍCULAS & CONFETTI ────────────────────────────────────

function fireParticles(x, y) {
  const canvas = document.getElementById('particles-canvas');
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  const colors = ['#818CF8','#A5B4FC','#06B6D4','#34D399','#FB923C','#A78BFA'];
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
  const colors = ['#818CF8','#8B5CF6','#06B6D4','#10B981','#818CF8','#F43F5E','#A78BFA','#67E8F9'];
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
  { label: 'Ir a hoy',          icon: '📅', hint: 'T', fn: () => { diaActual = new Date(); diaActual.setHours(0,0,0,0); setView('semana'); } },
  { label: 'Día anterior',      icon: '‹',  hint: '←', fn: () => changeDia(-1) },
  { label: 'Día siguiente',     icon: '›',  hint: '→', fn: () => changeDia(1) },
  { label: 'Vista Hoy',         icon: '▦',  hint: '',  fn: () => setView('semana') },
  { label: 'Vista Mes',         icon: '◉',  hint: '',  fn: () => setView('mes') },
  { label: 'Vista Proyectos',   icon: '◈',  hint: '',  fn: () => setView('patrones') },
  { label: 'Vista Sugerencias', icon: '✦',  hint: '',  fn: () => setView('sugerencias') },
  { label: 'Vista Progreso',    icon: '◎',  hint: '',  fn: () => setView('equipo') },
  { label: 'Revisión semanal',  icon: '✳',  hint: '',  fn: () => { closeCmd(); startWeeklyReview(); } },
  { label: 'Objetivo semanal',  icon: '◈',  hint: '',  fn: () => { closeCmd(); openGoalEdit(); } },
  { label: 'Pulso del día',     icon: '◉',  hint: '',  fn: () => { closeCmd(); showEstadoDia(); } },
  { label: 'Palabra de semana', icon: '❋',  hint: '',  fn: () => { closeCmd(); showPalabra(); } },
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

// ── RE-RENDER TRAS CAMBIOS ───────────────────────────────────
// La vista Hoy es una lista agrupada (no bloques posicionados
// absolutamente), así que un re-render completo es simple y barato.

function updateEventDoneInDOM(id, done) {
  renderHoy();
}

function removeEventFromDOM(id) {
  renderHoy();
}

// ── EVENING CHECK-IN ─────────────────────────────────────────

async function checkEveningCheckin() {
  if (!currentUser) return;
  if (new Date().getHours() < 18) return;

  const { data } = await db
    .from('evening_checkins')
    .select('id')
    .eq('user_id', currentUser.id)
    .eq('date', toISO(new Date()))
    .limit(1);

  if (!data || !data.length) showEveningCheckin();
}

function showEveningCheckin() {
  const today = toISO(new Date());
  const count = (eventsCache[today] || []).length;
  const done = (eventsCache[today] || []).filter(e => e.done).length;

  const sub = document.getElementById('evening-sub');
  if (sub) {
    sub.textContent = count
      ? `Completaste ${done} de ${count} cosas hoy.`
      : 'Tomá 2 minutos para reflexionar.';
  }

  eveningMainChoice = null;
  eveningEnergy = null;
  document.querySelectorAll('.evening-main-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('#evening-screen .energy-btn').forEach(b => b.classList.remove('selected'));
  const noteEl = document.getElementById('evening-note');
  if (noteEl) noteEl.value = '';
  document.getElementById('evening-screen').style.display = 'flex';
}

function selectEveningMain(v) {
  eveningMainChoice = v;
  document.querySelectorAll('.evening-main-btn').forEach(b =>
    b.classList.toggle('selected', b.dataset.v === v)
  );
}

function selectEveningEnergy(e) {
  eveningEnergy = e;
  document.querySelectorAll('#evening-screen .energy-btn').forEach(btn =>
    btn.classList.toggle('selected', parseInt(btn.dataset.e) === e)
  );
}

async function submitEveningCheckin() {
  const btn = document.getElementById('evening-cta');
  if (btn) btn.disabled = true;

  const note = document.getElementById('evening-note')?.value.trim() || null;

  await db.from('evening_checkins').upsert({
    user_id: currentUser.id,
    date: toISO(new Date()),
    completed_main: eveningMainChoice,
    energy_evening: eveningEnergy,
    note
  });

  document.getElementById('evening-screen').style.display = 'none';
  eveningMainChoice = null;
  eveningEnergy = null;
  if (btn) btn.disabled = false;
  showToast('Día cerrado', 'success');
}

// ── GOAL BAR ─────────────────────────────────────────────────

function initGoalBar() {
  if (!currentUser) return;
  const weekStart = toISO(getWeekDates(0)[0]);
  const key = `foco_goal_${currentUser.id}_${weekStart}`;
  const goal = localStorage.getItem(key)
    || localStorage.getItem(`foco_week_goal_${currentUser.id}`);

  const bar = document.getElementById('goal-bar');
  const text = document.getElementById('goal-bar-text');
  if (!bar || !text) return;

  if (goal) {
    text.textContent = goal;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

function openGoalEdit() {
  if (!currentUser) return;
  const weekStart = toISO(getWeekDates(0)[0]);
  const key = `foco_goal_${currentUser.id}_${weekStart}`;
  const current = localStorage.getItem(key)
    || localStorage.getItem(`foco_week_goal_${currentUser.id}`) || '';

  const inp = document.getElementById('goal-edit-inp');
  if (inp) inp.value = current;

  document.getElementById('goal-edit-overlay').style.display = 'block';
  document.getElementById('goal-edit-modal').style.display = 'flex';
  setTimeout(() => inp?.focus(), 80);
}

function closeGoalEdit() {
  document.getElementById('goal-edit-overlay').style.display = 'none';
  document.getElementById('goal-edit-modal').style.display = 'none';
}

function saveGoalEdit() {
  const val = document.getElementById('goal-edit-inp')?.value.trim();
  const weekStart = toISO(getWeekDates(0)[0]);
  const key = `foco_goal_${currentUser.id}_${weekStart}`;

  if (val) {
    localStorage.setItem(key, val);
    localStorage.setItem(`foco_week_goal_${currentUser.id}`, val);
  } else {
    localStorage.removeItem(key);
    localStorage.removeItem(`foco_week_goal_${currentUser.id}`);
  }

  closeGoalEdit();
  initGoalBar();
  showToast('Objetivo guardado', 'success');
}

// ── WEEKLY REVIEW ─────────────────────────────────────────────

function startWeeklyReview() {
  reviewAnswers = {};
  ['rv-1','rv-2','rv-3','rv-loading','rv-result'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === 'rv-1' ? 'flex' : 'none';
  });
  ['rv-ans-1','rv-ans-2','rv-ans-3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('review-progress').textContent = '1 de 3';
  document.getElementById('review-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('rv-ans-1')?.focus(), 100);
}

function reviewNext(step) {
  const ans = document.getElementById(`rv-ans-${step}`)?.value.trim();
  reviewAnswers[step] = ans || '—';

  if (step < 3) {
    document.getElementById(`rv-${step}`).style.display = 'none';
    document.getElementById(`rv-${step + 1}`).style.display = 'flex';
    document.getElementById('review-progress').textContent = `${step + 1} de 3`;
    setTimeout(() => document.getElementById(`rv-ans-${step + 1}`)?.focus(), 80);
  } else {
    document.getElementById('rv-3').style.display = 'none';
    document.getElementById('rv-loading').style.display = 'flex';
    document.getElementById('review-progress').textContent = '';
    generateReviewFicha();
  }
}

async function generateReviewFicha() {
  const week = getWeekDates(weekOffset);
  const allEvs = week.flatMap(d => eventsCache[toISO(d)] || []);
  const done = allEvs.filter(e => e.done).length;
  const total = allEvs.length;
  const weekGoal = localStorage.getItem(`foco_week_goal_${currentUser.id}`) || 'sin objetivo definido';

  let parsed = null;
  try {
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: `Sos el coach personal del usuario. Recibís sus respuestas de revisión semanal y generás una "ficha de la semana" personalizada, honesta y concisa, en español rioplatense.
Respondé SOLO con JSON válido sin markdown:
{"titulo":"frase de 5-6 palabras que define la semana","patron":"patrón que observás en sus respuestas, máx 40 palabras","fortaleza":"algo concreto que hicieron bien, máx 30 palabras","reto":"desafío principal para la próxima semana, máx 30 palabras"}`,
        messages: [{
          role: 'user',
          content: `Objetivo: ${weekGoal}\nEstadísticas: ${done}/${total} completados.\n\n1. Lo mejor que logré: ${reviewAnswers[1]}\n2. Lo que no salió: ${reviewAnswers[2]}\n3. Lo que voy a cambiar: ${reviewAnswers[3]}`
        }]
      })
    });
    const data = await response.json();
    const raw = (data.content?.[0]?.text || '').trim();
    try { parsed = JSON.parse(raw); } catch {
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      try { parsed = JSON.parse(m?.[1] || ''); } catch { parsed = null; }
    }
  } catch { parsed = null; }

  if (!parsed) {
    parsed = {
      titulo: `Semana de ${done}/${total}`,
      patron: 'Seguís construyendo el hábito de reflexionar.',
      fortaleza: reviewAnswers[1] || 'Tu disposición a reflexionar.',
      reto: reviewAnswers[3] || 'Mantener el rumbo.'
    };
  }

  const weekStart = toISO(week[0]);
  await db.from('weekly_reviews').upsert({
    user_id: currentUser.id,
    week_start: weekStart,
    answer_1: reviewAnswers[1],
    answer_2: reviewAnswers[2],
    answer_3: reviewAnswers[3],
    ai_ficha: JSON.stringify(parsed)
  });

  const fichaEl = document.getElementById('rv-ficha-content');
  if (fichaEl) {
    fichaEl.innerHTML = `
      <div class="ficha-titulo">${parsed.titulo}</div>
      <div class="ficha-section">
        <div class="ficha-label">Patrón</div>
        <div class="ficha-text">${parsed.patron}</div>
      </div>
      <div class="ficha-section">
        <div class="ficha-label">Fortaleza</div>
        <div class="ficha-text">${parsed.fortaleza}</div>
      </div>
      <div class="ficha-section">
        <div class="ficha-label">Reto próxima semana</div>
        <div class="ficha-text" style="color:var(--accent)">${parsed.reto}</div>
      </div>
    `;
  }

  document.getElementById('rv-loading').style.display = 'none';
  document.getElementById('rv-result').style.display = 'flex';
}

function closeReview() {
  document.getElementById('review-overlay').style.display = 'none';
}

// ── MONTHLY INSIGHT ───────────────────────────────────────────

async function checkMonthlyInsight() {
  if (!currentUser) return;
  const now = new Date();
  if (now.getDate() < 3) return;

  const monthStart = toISO(new Date(now.getFullYear(), now.getMonth(), 1));
  const key = `foco_monthly_${currentUser.id}_${monthStart}`;
  if (localStorage.getItem(key)) return;

  const { data } = await db
    .from('weekly_digests')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('week_start', { ascending: false })
    .limit(4);

  if (!data || data.length < 2) return;

  const insight = await generateMonthlyInsight(data);
  if (insight) {
    localStorage.setItem(key, '1');
    showMonthlyInsightModal(insight, monthStart);
  }
}

async function generateMonthlyInsight(digests) {
  const summary = digests.map(d =>
    `Semana ${d.week_start}: ${Math.round((d.completion_rate || 0) * 100)}% completado, commitment ${d.commitment_score || 0}%${d.ai_insight ? `, insight: "${d.ai_insight}"` : ''}`
  ).join('\n');

  try {
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        system: `Sos el coach de productividad. Analizás el último mes del usuario y generás un insight profundo que no podría ver sin mirar los datos longitudinalmente. En español rioplatense.
Respondé SOLO con JSON válido sin markdown:
{"titular":"observación de 6 palabras sobre el mes","patron":"patrón que emerge de las semanas, no obvio, máx 50 palabras","tendencia":"si va subiendo bajando o estable con contexto, máx 30 palabras","consejo":"una sola acción para el próximo mes, máx 25 palabras"}`,
        messages: [{ role: 'user', content: `Datos del último mes:\n${summary}` }]
      })
    });
    const data = await response.json();
    const raw = (data.content?.[0]?.text || '').trim();
    try { return JSON.parse(raw); } catch { return null; }
  } catch { return null; }
}

function showMonthlyInsightModal(insight, monthStart) {
  const [, m] = monthStart.split('-');
  const mesNombre = MONTHS_FULL[parseInt(m) - 1] || '';
  document.getElementById('monthly-period').textContent = `Tu mes de ${mesNombre}`;
  document.getElementById('monthly-headline').textContent = insight.titular || '—';
  document.getElementById('monthly-insight-text').textContent = [insight.patron, insight.tendencia].filter(Boolean).join(' ');
  document.getElementById('monthly-tip').textContent = insight.consejo ? `→ ${insight.consejo}` : '';
  document.getElementById('monthly-overlay').style.display = 'flex';
}

function closeMonthlyInsight() {
  document.getElementById('monthly-overlay').style.display = 'none';
}

// ── ÁREAS — panel pills ───────────────────────────────────────

let panelCurrentArea = 'trabajo';

function renderAreaPills(selectedArea) {
  panelCurrentArea = selectedArea || 'trabajo';
  const container = document.getElementById('panel-area-pills');
  if (!container) return;
  container.innerHTML = Object.entries(AREAS).map(([key, a]) => `
    <button class="area-pill${panelCurrentArea === key ? ' selected' : ''}"
            style="--area-color:${a.color}"
            onclick="selectPanelArea('${key}')">
      ${a.label}
    </button>
  `).join('');
}

async function selectPanelArea(areaKey) {
  if (!panelEvent) return;
  panelCurrentArea = areaKey;
  renderAreaPills(areaKey);
  panelEvent.area = areaKey;
  await db.from('events').update({ area: areaKey }).eq('id', panelEvent.id);
  const color = eventColor(panelEvent.title, areaKey);
  document.getElementById('event-panel').style.setProperty('--event-color', color);
  const bar = document.getElementById('panel-color-bar');
  if (bar) bar.style.background = color;
  const block = document.querySelector(`[data-event-id="${panelEvent.id}"]`);
  if (block) {
    block.style.setProperty('--event-color', color);
    block.style.setProperty('--event-color-30', color + '30');
    block.style.setProperty('--event-color-15', color + '15');
  }
}

// ── ESTADO DEL DÍA ────────────────────────────────────────────

async function checkEstadoDia() {
  if (!currentUser) return;
  const h = new Date().getHours();
  if (h < 10 || h >= 20) return; // solo entre 10 y 20hs

  const { data } = await db
    .from('daily_states')
    .select('id')
    .eq('user_id', currentUser.id)
    .eq('date', toISO(new Date()))
    .limit(1);

  // no auto-mostrar — accesible desde sugerencias
  updateEstadoCard(data && data.length > 0);
}

async function updateEstadoCard(alreadyFilled) {
  if (!currentUser) return;
  const titleEl = document.getElementById('sug-estado-title');
  const descEl = document.getElementById('sug-estado-desc');
  const btnEl = document.getElementById('sug-estado-btn');

  if (alreadyFilled === undefined) {
    const { data } = await db
      .from('daily_states')
      .select('como_estas')
      .eq('user_id', currentUser.id)
      .eq('date', toISO(new Date()))
      .limit(1);
    alreadyFilled = data && data.length > 0;
    if (alreadyFilled && data[0].como_estas && titleEl) {
      titleEl.textContent = `"${data[0].como_estas.slice(0, 50)}"`;
      if (descEl) descEl.textContent = 'Pulso registrado hoy.';
      if (btnEl) btnEl.textContent = 'Editar →';
      return;
    }
  }

  if (alreadyFilled) {
    if (titleEl) titleEl.textContent = 'Pulso registrado hoy.';
    if (descEl) descEl.textContent = 'Volvé mañana o editalo.';
    if (btnEl) btnEl.textContent = 'Editar →';
  }
}

function showEstadoDia() {
  const now = new Date();
  const fechaEl = document.getElementById('estado-fecha');
  if (fechaEl) {
    fechaEl.textContent = now.toLocaleDateString('es-AR', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }
  ['estado-como','estado-preocupa','estado-orgullo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('estado-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('estado-como')?.focus(), 100);
}

function closeEstadoDia() {
  document.getElementById('estado-overlay').style.display = 'none';
}

async function submitEstadoDia() {
  const como = document.getElementById('estado-como')?.value.trim() || null;
  const preocupa = document.getElementById('estado-preocupa')?.value.trim() || null;
  const orgullo = document.getElementById('estado-orgullo')?.value.trim() || null;

  await db.from('daily_states').upsert({
    user_id: currentUser.id,
    date: toISO(new Date()),
    como_estas: como,
    preocupacion: preocupa,
    orgullo
  });

  closeEstadoDia();
  updateEstadoCard(true);
  showToast('Pulso guardado', 'success');
}

// ── CARTA DEL DOMINGO ─────────────────────────────────────────

async function checkCartaDomingo() {
  if (!currentUser) return;
  const now = new Date();
  if (now.getDay() !== 0) return;     // solo domingos
  if (now.getHours() < 19) return;    // desde las 19hs

  const weekStart = toISO(getWeekDates(weekOffset)[0]);
  const key = `foco_carta_${currentUser.id}_${weekStart}`;
  if (localStorage.getItem(key)) return;

  const carta = await generateCartaDomingo();
  if (carta) {
    localStorage.setItem(key, '1');
    showCartaModal(carta);
  }
}

async function generateCartaDomingo() {
  const week = getWeekDates(weekOffset);
  const allEvs = week.flatMap(d => eventsCache[toISO(d)] || []);
  const done = allEvs.filter(e => e.done).length;
  const total = allEvs.length;
  if (!total) return null;

  const firstName = (currentProfile?.display_name || '').split(' ')[0] || 'vos';

  const eventsText = week.flatMap(d =>
    (eventsCache[toISO(d)] || []).map(ev =>
      `${DAYS_FULL[d.getDay()]}: ${ev.title}${ev.done ? ' ✓' : ''} [${ev.area || 'trabajo'}]`
    )
  ).join('\n');

  // Buscar estados del día de la semana
  const { data: estados } = await db
    .from('daily_states')
    .select('date, como_estas, preocupacion, orgullo')
    .eq('user_id', currentUser.id)
    .gte('date', toISO(week[0]))
    .lte('date', toISO(week[6]));

  const estadosText = (estados || []).map(e =>
    `${e.date}: "${e.como_estas || ''}" / preocupación: "${e.preocupacion || ''}" / orgullo: "${e.orgullo || ''}"`
  ).join('\n');

  try {
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: `Sos un coach y mentor que escribe una carta personal al usuario cada domingo. Tenés acceso a su semana completa.
Escribís en español rioplatense, cálido pero honesto. La carta tiene:
- Un saludo personalizado con el nombre
- Una observación específica sobre la semana (NO genérica)
- Una conexión entre lo que hicieron y cómo se sintieron
- Una pregunta reflexiva para la próxima semana
- Cierre breve

Máximo 120 palabras. Sin listas. Prosa fluida. Como un mentor de verdad.
Respondé SOLO con JSON: {"saludo":"texto del saludo","cuerpo":"el cuerpo de la carta"}`,
        messages: [{
          role: 'user',
          content: `Nombre: ${firstName}\nEventos: ${total}, completados: ${done}\n\nAgenda:\n${eventsText}\n\nEstados del día:\n${estadosText || 'Sin registros.'}`
        }]
      })
    });
    const data = await response.json();
    const raw = (data.content?.[0]?.text || '').trim();
    try { return JSON.parse(raw); } catch {
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      try { return JSON.parse(m?.[1] || ''); } catch { return null; }
    }
  } catch { return null; }
}

function showCartaModal(carta) {
  const now = new Date();
  document.getElementById('carta-meta').textContent =
    now.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('carta-saludo').textContent = carta.saludo || '';
  document.getElementById('carta-cuerpo').textContent = carta.cuerpo || '';
  document.getElementById('carta-overlay').style.display = 'flex';
}

function closeCarta() {
  document.getElementById('carta-overlay').style.display = 'none';
}

// ── PALABRA DE LA SEMANA ──────────────────────────────────────

async function showPalabra() {
  const weekStart = toISO(getWeekDates(0)[0]);

  // Ver si ya existe para esta semana
  const { data: existing } = await db
    .from('weekly_words')
    .select('word')
    .eq('user_id', currentUser.id)
    .eq('week_start', weekStart)
    .limit(1);

  const inp = document.getElementById('palabra-inp');
  if (inp) inp.value = existing?.[0]?.word || '';

  // Cargar historial (últimas 8 semanas)
  const { data: historia } = await db
    .from('weekly_words')
    .select('week_start, word')
    .eq('user_id', currentUser.id)
    .order('week_start', { ascending: false })
    .limit(8);

  const prevEl = document.getElementById('palabras-previas');
  if (prevEl && historia?.length) {
    prevEl.innerHTML = historia.map(w =>
      `<span class="palabra-chip">${w.word}</span>`
    ).join('');
  }

  document.getElementById('palabra-overlay').style.display = 'flex';
  setTimeout(() => inp?.focus(), 100);
}

function closePalabra() {
  document.getElementById('palabra-overlay').style.display = 'none';
}

async function submitPalabra() {
  const word = document.getElementById('palabra-inp')?.value.trim();
  if (!word) { closePalabra(); return; }

  const weekStart = toISO(getWeekDates(0)[0]);
  await db.from('weekly_words').upsert({
    user_id: currentUser.id,
    week_start: weekStart,
    word
  });

  closePalabra();
  renderPalabrasHistoria();
  showToast(`"${word}" — tu semana`, 'success');
}

async function renderPalabrasHistoria() {
  if (!currentUser) return;
  const { data } = await db
    .from('weekly_words')
    .select('week_start, word')
    .eq('user_id', currentUser.id)
    .order('week_start', { ascending: false })
    .limit(12);

  const el = document.getElementById('palabras-historia');
  if (!el) return;

  if (!data || !data.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--text4);font-family:\'Geist\',sans-serif">Todavía no hay palabras.</div>';
    return;
  }

  el.innerHTML = data.map(w =>
    `<span class="palabra-chip">${w.word}</span>`
  ).join('');
}

// ── MOOD TIMELINE ─────────────────────────────────────────────

async function renderMoodTimeline() {
  const el = document.getElementById('mood-timeline');
  if (!el || !currentUser) return;

  const since = toISO(new Date(Date.now() - 56 * 86400000)); // 8 semanas
  const { data } = await db
    .from('daily_checkins')
    .select('date, energy')
    .eq('user_id', currentUser.id)
    .gte('date', since)
    .order('date', { ascending: true });

  if (!data || !data.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--text4);font-family:\'Geist\',sans-serif;padding:8px 0">Completá el morning brief algunos días para ver tu energía en el tiempo.</div>';
    return;
  }

  const energyColors = ['','#F43F5E','#818CF8','#71717A','#818CF8','#10B981'];
  el.innerHTML = `
    <div class="mood-dots">
      ${data.map(d => {
        const c = energyColors[d.energy] || '#27272A';
        const dateObj = new Date(d.date + 'T12:00:00');
        const label = DAYS[dateObj.getDay()] + ' ' + dateObj.getDate();
        return `<div class="mood-dot" style="background:${c}" title="${label} — energía ${d.energy}/5"></div>`;
      }).join('')}
    </div>
    <div class="mood-legend">
      <span style="color:var(--text4);font-size:9px">${data[0].date}</span>
      <span style="color:var(--text4);font-size:9px">${data[data.length-1].date}</span>
    </div>
  `;
}

// ── AREAS TIMELINE & BREAKDOWN ───────────────────────────────

async function renderAreasTimeline() {
  const el = document.getElementById('areas-timeline');
  if (!el || !currentUser) return;

  const since = toISO(new Date(Date.now() - 28 * 86400000)); // 4 semanas
  const { data } = await db
    .from('events')
    .select('area')
    .eq('user_id', currentUser.id)
    .gte('date', since);

  if (!data || !data.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--text4);font-family:\'Geist\',sans-serif;padding:8px 0">Categorizá eventos en el panel para ver el balance.</div>';
    return;
  }

  const counts = {};
  data.forEach(ev => {
    const a = ev.area || 'trabajo';
    counts[a] = (counts[a] || 0) + 1;
  });
  const total = data.length;

  el.innerHTML = Object.entries(AREAS).map(([key, area]) => {
    const n = counts[key] || 0;
    const pct = Math.round(n / total * 100);
    if (!n) return '';
    return `
      <div class="area-row">
        <span class="area-row-label">${area.label}</span>
        <div class="area-row-bar">
          <div class="area-row-fill" style="width:${pct}%;background:${area.color}"></div>
        </div>
        <span class="area-row-pct">${pct}%</span>
      </div>
    `;
  }).filter(Boolean).join('');
}

async function renderAreasBreakdown() {
  const el = document.getElementById('areas-breakdown');
  if (!el || !currentUser) return;

  const week = getWeekDates(weekOffset);
  const allEvs = week.flatMap(d => eventsCache[toISO(d)] || []);

  if (!allEvs.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--text4)">Sin eventos esta semana.</div>';
    return;
  }

  const counts = {};
  allEvs.forEach(ev => {
    if (!ev.area) return;
    counts[ev.area] = (counts[ev.area] || 0) + 1;
  });
  const total = allEvs.length;

  el.innerHTML = Object.entries(AREAS).map(([key, area]) => {
    const n = counts[key] || 0;
    if (!n) return '';
    const pct = Math.round(n / total * 100);
    return `
      <div class="area-row">
        <span class="area-row-label">${area.label}</span>
        <div class="area-row-bar">
          <div class="area-row-fill" style="width:${pct}%;background:${area.color}"></div>
        </div>
        <span class="area-row-pct">${n}</span>
      </div>
    `;
  }).filter(Boolean).join('');
}

// ── EQUIPO ────────────────────────────────────────────────────

function showChartTip(idx, leftPct) {
  const tip = document.getElementById('tu-chart-tip');
  if (!tip) return;
  const val = tuanaChartVals[idx] ?? 0;
  const lbl = tuanaChartLabels[idx] ?? '';
  tip.innerHTML = `<span class="tip-lbl">${lbl}</span><span class="tip-val">${val} ${val === 1 ? 'tarea' : 'tareas'}</span>`;
  const clamped = Math.min(Math.max(leftPct, 10), 85);
  tip.style.left = `${clamped}%`;
  tip.style.display = 'flex';
  clearTimeout(tip._t);
  tip._t = setTimeout(() => { tip.style.display = 'none'; }, 2000);
}

function hideChartTip() {
  const tip = document.getElementById('tu-chart-tip');
  if (!tip) return;
  clearTimeout(tip._t);
  tip.style.display = 'none';
}

function setTuanaChartPeriod(p) {
  tuanaChartPeriod = p;
  document.querySelectorAll('.tuana-period-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.p === p)
  );
  renderTuanaChart();
}

function renderTuanaChart() {
  const chartEl  = document.getElementById('tu-chart');
  const labelsEl = document.getElementById('tu-chart-labels');
  const bigEl    = document.getElementById('tu-chart-big');
  const subEl    = document.getElementById('tu-chart-sub');
  if (!chartEl) return;

  const done = tuanaEventsCache.filter(e => e.done);
  let vals = [], labels = [];

  if (tuanaChartPeriod === 'semana') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
      vals.push(done.filter(e => e.date === toISO(d)).length);
      labels.push(DAYS[d.getDay()]);
    }
  } else if (tuanaChartPeriod === 'mes') {
    for (let i = 3; i >= 0; i--) {
      const end   = new Date(); end.setHours(0,0,0,0); end.setDate(end.getDate() - i * 7);
      const start = new Date(end); start.setDate(end.getDate() - 6);
      const s = toISO(start), e2 = toISO(end);
      vals.push(done.filter(ev => ev.date >= s && ev.date <= e2).length);
      labels.push(`${start.getDate()}/${start.getMonth()+1}`);
    }
  } else {
    const MN = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,'0');
      vals.push(done.filter(ev => ev.date.startsWith(`${yy}-${mm}`)).length);
      labels.push(MN[d.getMonth()]);
    }
  }

  tuanaChartVals   = vals;
  tuanaChartLabels = labels;

  const total = vals.reduce((s, v) => s + v, 0);
  const subMap = { semana: 'esta semana', mes: 'último mes', año: 'este año' };
  if (bigEl) bigEl.textContent = total;
  if (subEl) subEl.textContent = subMap[tuanaChartPeriod];

  const W = 300, H = 72;
  const pT = 8, pB = 6, pL = 12, pR = 12;
  const cW = W - pL - pR, cH = H - pT - pB;
  const maxVal = Math.max(...vals, 1);
  const n = vals.length;

  const pts = vals.map((v, i) => ({
    x: pL + (n < 2 ? cW / 2 : i * cW / (n - 1)),
    y: pT + cH - (v / maxVal) * cH
  }));

  const floorY = pT + cH;

  function curvePath(pts) {
    if (pts.length < 2) return `M${pts[0].x},${pts[0].y}`;
    const t = 0.3;
    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i-1] || pts[i];
      const p1 = pts[i], p2 = pts[i+1];
      const p3 = pts[i+2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) * t;
      const cp1y = Math.min(p1.y + (p2.y - p0.y) * t, floorY);
      const cp2x = p2.x - (p3.x - p1.x) * t;
      const cp2y = Math.min(p2.y - (p3.y - p1.y) * t, floorY);
      d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  }

  if (!vals.some(v => v > 0)) {
    chartEl.innerHTML = '';
    if (labelsEl) labelsEl.innerHTML = '';
    return;
  }

  const line = curvePath(pts);
  const area = `${line} L${pts[pts.length-1].x.toFixed(1)},${floorY} L${pts[0].x.toFixed(1)},${floorY} Z`;

  const dots = pts.map((pt, i) => vals[i] > 0
    ? `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="2.5" fill="#818CF8"/>`
    : ''
  ).join('');

  chartEl.innerHTML = `
    <defs>
      <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#818CF8" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="#818CF8" stop-opacity="0"/>
      </linearGradient>
      <filter id="lg" x="-5%" y="-80%" width="110%" height="260%">
        <feGaussianBlur stdDeviation="2" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <path d="${area}" fill="url(#ag)"/>
    <path d="${line}" fill="none" stroke="#4338CA" stroke-width="5" stroke-opacity="0.22" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${line}" fill="none" stroke="#C7D2FE" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" filter="url(#lg)"/>
    ${dots}
  `;

  // Evento único para hover + touch
  chartEl.onmousemove = chartEl.onclick = (e) => {
    const r = chartEl.getBoundingClientRect();
    const relX = e.clientX - r.left;
    const pct  = relX / r.width;
    const svgX  = pct * 300;
    const idx   = Math.max(0, Math.min(n - 1, Math.round((svgX - pL) / cW * (n - 1))));
    showChartTip(idx, pct * 100);
  };
  chartEl.ontouchstart = (e) => {
    e.preventDefault();
    const r    = chartEl.getBoundingClientRect();
    const relX = e.touches[0].clientX - r.left;
    const pct  = relX / r.width;
    const svgX  = pct * 300;
    const idx   = Math.max(0, Math.min(n - 1, Math.round((svgX - pL) / cW * (n - 1))));
    showChartTip(idx, pct * 100);
  };
  chartEl.onmouseleave = hideChartTip;

  if (labelsEl) {
    const step = tuanaChartPeriod === 'año' ? 3 : 1;
    labelsEl.innerHTML = labels.map((l, i) => {
      const visible = i % step === 0 || i === labels.length - 1;
      return `<span style="visibility:${visible ? 'visible' : 'hidden'};font-size:9px;color:var(--text4);font-family:'Geist',sans-serif">${l}</span>`;
    }).join('');
  }
}

async function renderEquipo() {
  const uid  = currentUser.id;
  const wrap = document.getElementById('view-equipo');
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="tuana-wrap">
      <div class="tuana-header">
        <div class="tuana-title">Progreso.</div>
      </div>

      <div class="tuana-card">
        <div class="tuana-section-label">Actividad — últimos 6 meses</div>
        <div class="tuana-heatmap-scroll">
          <div class="tuana-hm-grid" id="tu-heatmap"></div>
        </div>
        <div class="tuana-heatmap-legend">
          <span>Menos</span>
          <div class="tuana-legend-dots">
            <div class="tuana-legend-dot" style="background:#1C1C1F"></div>
            <div class="tuana-legend-dot" style="background:#1C2045"></div>
            <div class="tuana-legend-dot" style="background:#3B4280"></div>
            <div class="tuana-legend-dot" style="background:#818CF8"></div>
            <div class="tuana-legend-dot" style="background:#C7D2FE"></div>
          </div>
          <span>Más</span>
        </div>
      </div>

      <div class="tuana-highlights">
        <div class="tuana-hl">
          <div class="tuana-hl-val" id="tu-total-done">—</div>
          <div class="tuana-hl-lbl">completadas</div>
        </div>
        <div class="tuana-hl">
          <div class="tuana-hl-val" id="tu-best-week">—</div>
          <div class="tuana-hl-lbl">mejor semana</div>
        </div>
        <div class="tuana-hl">
          <div class="tuana-hl-val" id="tu-racha">—</div>
          <div class="tuana-hl-lbl">racha actual</div>
        </div>
      </div>

      <div class="tuana-card">
        <div class="tuana-card-top">
          <div>
            <div class="tuana-section-label">Tareas completadas</div>
            <div class="tuana-chart-stat">
              <span class="tuana-chart-big" id="tu-chart-big">—</span>
              <span class="tuana-chart-sub" id="tu-chart-sub"></span>
            </div>
          </div>
          <div class="tuana-period-toggle">
            <button class="tuana-period-btn${tuanaChartPeriod==='semana'?' active':''}" data-p="semana" onclick="setTuanaChartPeriod('semana')">Sem</button>
            <button class="tuana-period-btn${tuanaChartPeriod==='mes'?' active':''}" data-p="mes" onclick="setTuanaChartPeriod('mes')">Mes</button>
            <button class="tuana-period-btn${tuanaChartPeriod==='año'?' active':''}" data-p="año" onclick="setTuanaChartPeriod('año')">Año</button>
          </div>
        </div>
        <div class="tuana-chart-wrap">
          <div class="tuana-chart-tip" id="tu-chart-tip"></div>
          <svg class="tuana-chart" id="tu-chart" viewBox="0 0 300 72" preserveAspectRatio="none"></svg>
        </div>
        <div class="tuana-chart-labels" id="tu-chart-labels"></div>
      </div>

      <div class="tuana-card">
        <div class="tuana-section-label">Energía — últimos 30 días</div>
        <div class="tuana-energy-dots" id="tu-energy"></div>
      </div>

      <div class="tuana-card">
        <div class="tuana-section-label">Palabras del año</div>
        <div class="tuana-palabras" id="tu-palabras"></div>
      </div>
    </div>
  `;

  const since6m  = toISO(new Date(Date.now() - 182 * 86400000));
  const since30d = toISO(new Date(Date.now() - 30  * 86400000));
  const since60d = toISO(new Date(Date.now() - 60  * 86400000));
  const since1y  = toISO(new Date(Date.now() - 365 * 86400000));

  const [evRes, checkinRes, streakRes, wordsRes] = await Promise.all([
    db.from('events').select('date, done').eq('user_id', uid).gte('date', since1y),
    db.from('daily_checkins').select('date, energy').eq('user_id', uid).gte('date', since30d).order('date', { ascending: true }),
    db.from('daily_checkins').select('date').eq('user_id', uid).gte('date', since60d).order('date', { ascending: false }),
    db.from('weekly_words').select('week_start, word').eq('user_id', uid).gte('week_start', since1y).order('week_start', { ascending: false })
  ]);

  const events     = evRes.data      || [];
  const checkins   = checkinRes.data || [];
  const streakData = streakRes.data  || [];
  const words      = wordsRes.data   || [];
  tuanaEventsCache = events;

  // ── Heatmap ──────────────────────────────────────────────────
  const doneByDate = {};
  events.forEach(e => { if (e.done) doneByDate[e.date] = (doneByDate[e.date] || 0) + 1; });

  const heatmapEl = document.getElementById('tu-heatmap');
  if (heatmapEl) {
    const today = new Date(); today.setHours(0,0,0,0);
    const start = new Date(today);
    start.setDate(start.getDate() - 181);
    const dow = start.getDay();
    start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1));

    const totalDays = Math.ceil((today - start) / 86400000) + 1;
    const weeks     = Math.ceil(totalDays / 7);
    const heatColors = ['#12141F','#1C2045','#3B4280','#818CF8','#C7D2FE'];
    heatmapEl.style.gridTemplateRows = 'repeat(7, 10px)';

    let html = '';
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const cellDate = new Date(start);
        cellDate.setDate(start.getDate() + w * 7 + d);
        if (cellDate > today) { html += `<div class="tuana-hm-cell" style="background:transparent"></div>`; continue; }
        const iso   = toISO(cellDate);
        const count = doneByDate[iso] || 0;
        const lvl   = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 3 : 4;
        const ring  = iso === toISO(today) ? ' today' : '';
        html += `<div class="tuana-hm-cell${ring}" style="background:${heatColors[lvl]}" title="${iso}: ${count} completadas"></div>`;
      }
    }
    heatmapEl.innerHTML = html;
  }

  // ── Highlights ───────────────────────────────────────────────
  const elDone = document.getElementById('tu-total-done');
  if (elDone) elDone.textContent = events.filter(e => e.done && e.date >= since6m).length;

  const elBest = document.getElementById('tu-best-week');
  if (elBest && digests.length) {
    const best = digests.reduce((m, d) => (d.commitment_score || 0) > (m.commitment_score || 0) ? d : m, digests[0]);
    elBest.textContent = (best.commitment_score || 0) + '%';
  }

  const elRacha = document.getElementById('tu-racha');
  if (elRacha) {
    const checkinSet = new Set(streakData.map(c => c.date));
    let streak = 0;
    const cursor = new Date(); cursor.setHours(0,0,0,0);
    if (!checkinSet.has(toISO(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (checkinSet.has(toISO(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    elRacha.textContent = streak > 0 ? streak + (streak === 1 ? ' día' : ' días') : '—';
  }

  // ── Chart ────────────────────────────────────────────────────
  renderTuanaChart();

  // ── Energía ──────────────────────────────────────────────────
  const energyEl = document.getElementById('tu-energy');
  if (energyEl) {
    if (!checkins.length) {
      energyEl.innerHTML = '<div class="tuana-empty">Completá el morning brief para ver tu energía.</div>';
    } else {
      const EC = ['','#F43F5E','#818CF8','#71717A','#818CF8','#10B981'];
      energyEl.innerHTML = checkins.map(c => {
        const dt = new Date(c.date + 'T12:00:00');
        return `<div class="tuana-energy-dot" style="background:${EC[c.energy]||'#27272A'}" title="${DAYS[dt.getDay()]} ${dt.getDate()}/${dt.getMonth()+1} — ${c.energy}/5"></div>`;
      }).join('');
    }
  }

  // ── Palabras ─────────────────────────────────────────────────
  const palabrasEl = document.getElementById('tu-palabras');
  if (palabrasEl) {
    palabrasEl.innerHTML = words.length
      ? words.map(w => `<span class="palabra-chip">${escH(w.word)}</span>`).join('')
      : '<div class="tuana-empty">Todavía no hay palabras. Agregá una desde Sugerencias.</div>';
  }
}

// ── ARRANCAR ────────────────────────────────────────────────
init();
