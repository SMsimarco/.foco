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

// Onboarding state — _foqOnboarding prendido usa el system prompt de la
// entrevista dentro del chat real de Foquito (ver sendFoquitoMessage)
let _foqOnboarding = false;
let _obHistory = [];

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
      if (!ev.end_time) return; // tareas sin hora de fin no cuentan para el score
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
  // Verificar sesión existente directamente — no depender solo de onAuthStateChange.
  // OJO: getSession() puede colgarse para siempre en Safari/PWA — bug conocido de
  // supabase-js, usa el Web Locks API y si una pestaña anterior murió a mitad de
  // esta misma llamada (típico si el SO mata la PWA en segundo plano), el lock
  // queda tomado y nadie lo libera nunca. Sin este timeout, la pantalla de login
  // quedaba trabada indefinidamente — no es que deslogueaba, el chequeo de sesión
  // ni terminaba. Si se cumple el timeout, se muestra el login (un toque en
  // "Continuar con Google" alcanza para volver a entrar) en vez de colgar para
  // siempre.
  const sessionCheck = db.auth.getSession();
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 4000));
  const result = await Promise.race([sessionCheck, timeout]);
  const session = result?.data?.session;

  if (session?.user) {
    currentUser = session.user;
    const { data } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
    currentProfile = data;
    showApp();
  } else {
    showAuth();
    // Si esto pasó por el timeout de arriba (no por falta real de sesión), la
    // llamada original puede seguir viva y resolver más tarde — si trae una
    // sesión válida y el usuario no se logueó a mano mientras tanto, entrar
    // solo en vez de dejarlo pantalla de login sin necesidad.
    sessionCheck.then(async (late) => {
      if (currentUser) return;
      const lateSession = late?.data?.session;
      if (lateSession?.user) {
        currentUser = lateSession.user;
        const { data } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
        currentProfile = data;
        showApp();
      }
    }).catch(() => {});
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
  scrollHoyToFirstEvent(toISO(diaActual));
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
  initFoquitoDesktop();
  updateViewPills(); // arranca en Día — sincroniza el pill activo
}

// ── CARGA DE DATOS ──────────────────────────────────────────

async function loadWeek(offset = weekOffset) {
  if (!currentUser) return;
  const week = getWeekDates(offset);
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

  // Las dos consultas son independientes — en paralelo tardan lo que tarda
  // la más lenta, no la suma de las dos (antes eran secuenciales).
  const [{ data, error }, { data: recData }] = await Promise.all([
    db.from('events').select('*').eq('user_id', currentUser.id).eq('date', dateISO),
    db.from('events').select('*').eq('user_id', currentUser.id).eq('recurrente', true)
  ]);

  if (error) { console.error(error); return; }

  eventsCache[dateISO] = (data || []).map(ev => {
    ev.start_time = ev.start_time ? ev.start_time.slice(0, 5) : null;
    ev.end_time   = ev.end_time   ? ev.end_time.slice(0, 5)   : null;
    return ev;
  });

  // Inyectar eventos recurrentes que correspondan a este día de semana
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

  refreshDiaOSemanaGrid(dateISO);
  showToast(`"${data.title}" agregado`, 'info');
}

// Re-renderiza la vista temporal activa (Día o Semana) si el cambio le pega —
// ambas son grillas con bloques posicionados, no hace falta tocar un nodo puntual:
// reconstruyen solo su propio subárbol, no la vista entera ni el resto de la página.
function refreshDiaOSemanaGrid(dateISO) {
  if (currentView === 'semana' && dateISO === toISO(diaActual)) {
    renderHoy();
  } else if (currentView === 'semana-grid') {
    renderSemanaGrid();
  }
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
  updateEventDoneInDOM(id, newDone, dateISO);
  updateMomentum();
  if (currentView === 'sugerencias') updateSugStats();
  updatePattern(ev);

  if (newDone) {
    const dayEvs = eventsCache[dateISO] || [];
    if (dayEvs.length > 0 && dayEvs.every(e => e.done)) {
      setTimeout(fireConfetti, 120);
      showToast('¡Día completado!', 'success');
      if (_foqCelebratedDate !== dateISO) {
        _foqCelebratedDate = dateISO;
        setFoquitoState('happy');
        addFoqBubble(pickFoquitoCelebration(), 'foq');
        setTimeout(() => setFoquitoState(null), 4000);
      }
    }
  }
}

function pickFoquitoCelebration() {
  const frases = [
    'Cerraste el día entero. Con toda la razón del mundo, orgullo total.',
    'Todo hecho. Así se hace, día redondo.',
    'Ahí está, terminaste todo lo de hoy. Te la bancaste.'
  ];
  return frases[Math.floor(Math.random() * frases.length)];
}

async function updatePattern(ev) {
  if (!currentUser || !ev.start_time) return;
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

// Confirmación genérica antes de cualquier borrado — un solo modal (sheet
// abajo, mismo estilo que el de repetición) reusado por eventos, proyectos y
// notas. Basado en Promise en vez de confirm() nativo para no romper el
// look de la app con el diálogo feo del navegador.
let _confirmResolve = null;

function askConfirm(message) {
  return new Promise(resolve => {
    document.getElementById('confirm-modal-msg').textContent = message;
    _confirmResolve = resolve;
    document.getElementById('confirm-overlay').classList.add('open');
    document.getElementById('confirm-modal').classList.add('open');
  });
}

function resolveConfirm(result) {
  document.getElementById('confirm-overlay').classList.remove('open');
  document.getElementById('confirm-modal').classList.remove('open');
  const resolve = _confirmResolve;
  _confirmResolve = null;
  if (resolve) resolve(result);
}

// Devuelve true si borró de verdad — panelDeleteEvent la usa para no cerrar
// el panel cuando el usuario cancela en el modal de confirmación.
async function deleteEvent(id, dateISO) {
  const ev = (eventsCache[dateISO] || []).find(e => e.id === id);
  if (!await askConfirm(ev ? `¿Eliminar "${ev.title}"?` : '¿Eliminar este evento?')) return false;

  const { error } = await db.from('events').delete().eq('id', id);
  if (error) { console.error(error); return false; }

  eventsCache[dateISO] = (eventsCache[dateISO] || []).filter(e => e.id !== id);
  removeEventFromDOM(id, dateISO);
  if (ev) showToast(`"${ev.title}" eliminado`, 'error');
  return true;
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
  // OJO: \b de JS es ASCII-only ([A-Za-z0-9_]) — una tilde como la de "mié"
  // NO cuenta como carácter de palabra, entonces \bmié\b matchea adentro de
  // "miércoles" (ve la é como fin de palabra y arranca de nuevo en la r).
  // Como los keys cortos ('mié') se prueban antes que los largos
  // ('miercoles'/'miércoles') en DAYMAP, el replace de abajo cortaba el
  // título a la mitad ("Miércoles..." → "Rcoles..."). Fix: reemplazar el \b
  // de cierre por un lookahead que además excluya letras acentuadas, así
  // ningún key corto puede cortar en medio de una palabra más larga.
  const finDePalabra = '(?![a-zA-ZÀ-ÿ])';
  if (!date) {
    for (const [key, val] of Object.entries(DAYMAP)) {
      if (new RegExp('\\b' + key + finDePalabra, 'i').test(s)) {
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
        // Saca también el artículo pegado antes ("el sábado" → no debe quedar "el" suelto)
        s = s.replace(new RegExp('\\b(el|la|los|las)\\s+' + key + finDePalabra + '|\\b' + key + finDePalabra, 'i'), ' ');
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

  // "Tu foco" sigue siendo una lista chica arriba — no compite con el calendario de abajo
  const foco = dayEvents.filter(e => e.is_focus).slice(0, 3);
  const secFoco = document.getElementById('hoy-section-foco');
  const listFoco = document.getElementById('hoy-list-foco');
  if (listFoco) listFoco.innerHTML = foco.map(ev => hoyRowHTML(ev, dateISO, !!ev.start_time)).join('');
  if (secFoco) secFoco.style.display = foco.length ? '' : 'none';

  renderDiaGrid(dateISO, dayEvents);
  updateMomentum();
}

// Arranca el scroll de la vista Día justo antes de la primera actividad con
// hora, para no dejar horas vacías (6-9am, digamos) ocupando la pantalla al
// entrar. Se llama solo al ENTRAR al día (carga inicial / cambiar de día /
// abrir la vista) — nunca desde renderHoy/renderDiaGrid en sí, porque esas
// corren también en cada toggle/add/delete y reubicar el scroll ahí sería
// molesto en medio de una interacción.
function scrollHoyToFirstEvent(dateISO) {
  const wrap = document.getElementById('hoy-scroll');
  const colEl = document.getElementById('dg-day-col');
  if (!wrap || !colEl) return;

  const conHora = (eventsCache[dateISO] || []).filter(e => !e.is_focus && e.start_time);
  if (!conHora.length) { wrap.scrollTop = 0; return; }

  const earliestMin = Math.min(...conHora.map(e => timeToMin(e.start_time)));
  const { horaBase } = computeGridHourRange([diaActual]);
  const topWithinGrid = ((earliestMin - horaBase * 60) / 60) * ALTO_HORA;

  const wrapRect = wrap.getBoundingClientRect();
  const colRect = colEl.getBoundingClientRect();
  const MARGEN_ARRIBA = 60; // deja algo de aire / la hora anterior visible, no pega el bloque al borde
  const target = wrap.scrollTop + (colRect.top - wrapRect.top) + topWithinGrid - MARGEN_ARRIBA;
  wrap.scrollTop = Math.max(0, target);
}

// Grilla horaria de un solo día — reemplaza lo que antes eran las listas
// "Durante el día" / "Cuando puedas". Comparte la lógica de bloques con la
// vista Semana vía renderGridColumnHTML/buildGridBlockHTML (ver más abajo).
function renderDiaGrid(dateISO, dayEvents) {
  const { horaBase, horaTope } = computeGridHourRange([diaActual]);
  const alturaTotal = (horaTope - horaBase) * ALTO_HORA;

  const sinHora = dayEvents.filter(e => !e.is_focus && !e.start_time);
  const alldayWrap = document.getElementById('dg-allday');
  if (alldayWrap) alldayWrap.style.display = sinHora.length ? 'flex' : 'none';

  const alldayListEl = document.getElementById('dg-allday-list');
  if (alldayListEl) {
    alldayListEl.innerHTML = sinHora.map(ev => {
      const color = eventColor(ev.title, ev.area);
      return `<div class="sg-chip" style="background:${color}4D;border-left-color:${color}"
        onclick="openEventPanel(eventsCache['${dateISO}'].find(e=>e.id==='${ev.id}'), '${dateISO}')">${ev.title}</div>`;
    }).join('');
  }

  const hoursEl = document.getElementById('dg-hours');
  if (hoursEl) {
    let html = '';
    for (let h = horaBase; h < horaTope; h++) {
      html += `<div class="sg-hour-label" style="height:${ALTO_HORA}px">${String(h).padStart(2, '0')}:00</div>`;
    }
    hoursEl.innerHTML = html;
  }

  const colEl = document.getElementById('dg-day-col');
  if (colEl) {
    colEl.style.height = alturaTotal + 'px';
    colEl.innerHTML = renderGridColumnHTML(dateISO, horaBase, horaTope, isToday(diaActual));
  }
}

let _changingDia = false;

async function changeDia(dir) {
  // Sin esto, tocar ‹/› rápido dos veces seguidas en el celu superpone dos
  // animaciones sobre el mismo elemento y el layout queda saltando.
  if (_changingDia) return;
  _changingDia = true;

  // Fade simple (sin slide) — menos piezas moviéndose a la vez, más
  // confiable en mobile que el FLIP de transform que tenía antes.
  const wrap = document.getElementById('hoy-scroll');
  try {
    if (wrap) {
      wrap.style.transition = 'opacity 0.12s ease';
      wrap.style.opacity = '0';
      await new Promise(r => setTimeout(r, 120));
    }

    diaActual.setDate(diaActual.getDate() + dir);
    const dateISO = toISO(diaActual);
    const yaEnCache = !!eventsCache[dateISO];

    // Si el día ya está en cache (caso común: loadWeek trajo la semana actual
    // al entrar) pintamos ya, sin esperar a Supabase. Si NO está en cache,
    // esperamos la respuesta primero — pintar de una mostraría "sin tareas"
    // por un instante y después el contenido real, un parpadeo feo.
    if (!yaEnCache) await loadDia();
    renderHoy();
    scrollHoyToFirstEvent(dateISO); // mientras sigue en opacity:0, no se ve el salto

    if (yaEnCache) {
      await loadDia();
      renderHoy(); // repinta en silencio si Supabase trajo algo distinto de lo cacheado
    }
  } finally {
    // Pase lo que pase arriba (error de red, bug de render), la vista nunca
    // se queda trabada en opacity:0 — antes el restore vivía en medio del
    // try y un throw a mitad de camino dejaba la pantalla invisible.
    if (wrap) {
      wrap.style.transition = 'opacity 0.18s ease';
      wrap.style.opacity = '1';
    }
    _changingDia = false;
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

// ── VISTA SEMANA (grilla horaria) ────────────────────────────
// Convive con la vista Hoy (lista) — no la reemplaza. Reusa loadWeek() (misma
// inyección de recurrentes que ya existía) y eventColor()/openEventPanel() de siempre.

const ALTO_HORA = 44; // px por hora — debe coincidir con background-size de .sg-day-col en style.css
let gridWeekOffset = 0; // semana mostrada acá, independiente de weekOffset (que es para el ring/Sugerencias)

async function changeGridWeek(dir) {
  gridWeekOffset += dir;
  await loadWeek(gridWeekOffset);
  renderSemanaGrid();
}

async function goToCurrentGridWeek() {
  gridWeekOffset = 0;
  await loadWeek(gridWeekOffset);
  renderSemanaGrid();
}

// Rango de horas a mostrar: piso 08:00-20:00, se expande si hay eventos afuera de ese rango
function computeGridHourRange(week) {
  let minH = 6, maxH = 23;
  week.forEach(d => {
    (eventsCache[toISO(d)] || []).forEach(ev => {
      if (!ev.start_time) return;
      const startH = Math.floor(timeToMin(ev.start_time) / 60);
      const endMin = ev.end_time ? timeToMin(ev.end_time) : timeToMin(ev.start_time) + 60;
      const endH = Math.ceil(endMin / 60);
      minH = Math.min(minH, startH);
      maxH = Math.max(maxH, endH);
    });
  });
  return { horaBase: Math.max(0, minH - 1), horaTope: Math.min(24, maxH + 1) };
}

// Agrupa eventos que se solapan en horario (transitivamente) para repartir el
// ancho de la columna entre ellos en vez de superponerlos.
function agruparSolapados(evsOrdenados) {
  const grupos = [];
  let actual = [];
  let finActual = -1;
  evsOrdenados.forEach(ev => {
    const inicio = timeToMin(ev.start_time);
    const fin = ev.end_time ? timeToMin(ev.end_time) : inicio + 60;
    if (actual.length && inicio < finActual) {
      actual.push(ev);
      finActual = Math.max(finActual, fin);
    } else {
      if (actual.length) grupos.push(actual);
      actual = [ev];
      finActual = fin;
    }
  });
  if (actual.length) grupos.push(actual);
  return grupos;
}

function renderNowLine(horaBase, horaTope) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const rangoMin = (horaTope - horaBase) * 60;
  const posMin = nowMin - horaBase * 60;
  if (posMin < 0 || posMin > rangoMin) return '';
  const top = (posMin / 60) * ALTO_HORA;
  return `<div class="sg-now-line" style="top:${top}px"><span class="sg-now-dot"></span></div>`;
}

function renderSemanaGrid() {
  const week = getWeekDates(gridWeekOffset);
  const { horaBase, horaTope } = computeGridHourRange(week);
  const alturaTotal = (horaTope - horaBase) * ALTO_HORA;

  const label = document.getElementById('sg-week-label');
  if (label) {
    if (gridWeekOffset === 0) {
      label.textContent = 'Esta semana';
    } else {
      const ini = week[0], fin = week[6];
      const mesIni = MONTHS_FULL[ini.getMonth()].slice(0, 3).toLowerCase();
      const mesFin = MONTHS_FULL[fin.getMonth()].slice(0, 3).toLowerCase();
      label.textContent = `${ini.getDate()} ${mesIni} – ${fin.getDate()} ${mesFin}`;
    }
  }

  const headersEl = document.getElementById('sg-daylabels-days');
  if (headersEl) {
    headersEl.innerHTML = week.map(d => `
      <div class="sg-daylabel">
        <div class="sg-daylabel-dow">${DAYS[d.getDay()]}</div>
        <div class="sg-daylabel-num${isToday(d) ? ' today' : ''}">${d.getDate()}</div>
      </div>
    `).join('');
  }

  // Banda "Sin horario" — no se pierden los eventos sin hora, se muestran como chips
  const sinHoraPorDia = week.map(d => (eventsCache[toISO(d)] || []).filter(e => !e.is_focus && !e.start_time));
  const alldayWrap = document.getElementById('sg-allday');
  if (alldayWrap) alldayWrap.style.display = sinHoraPorDia.some(evs => evs.length) ? 'flex' : 'none';

  const alldayDaysEl = document.getElementById('sg-allday-days');
  if (alldayDaysEl) {
    alldayDaysEl.innerHTML = week.map((d, i) => {
      const dateISO = toISO(d);
      const chips = sinHoraPorDia[i].map(ev => {
        const color = eventColor(ev.title, ev.area);
        return `<div class="sg-chip" style="background:${color}4D;border-left-color:${color}"
          onclick="openEventPanel(eventsCache['${dateISO}'].find(e=>e.id==='${ev.id}'), '${dateISO}')">${ev.title}</div>`;
      }).join('');
      return `<div class="sg-allday-col">${chips}</div>`;
    }).join('');
  }

  const hoursEl = document.getElementById('sg-hours');
  if (hoursEl) {
    let html = '';
    for (let h = horaBase; h < horaTope; h++) {
      html += `<div class="sg-hour-label" style="height:${ALTO_HORA}px">${String(h).padStart(2, '0')}:00</div>`;
    }
    hoursEl.innerHTML = html;
  }

  const daysEl = document.getElementById('sg-days');
  if (daysEl) {
    daysEl.innerHTML = week.map(d => {
      const dateISO = toISO(d);
      return `<div class="sg-day-col" style="height:${alturaTotal}px">${renderGridColumnHTML(dateISO, horaBase, horaTope, isToday(d))}</div>`;
    }).join('');
  }
}

// Arma el contenido de una columna de día (bloques posicionados + línea de "ahora")
// — la usan tanto la grilla Semana (7 columnas) como la grilla Día (1 columna).
function renderGridColumnHTML(dateISO, horaBase, horaTope, esHoy) {
  const conHora = (eventsCache[dateISO] || []).filter(e => !e.is_focus && e.start_time)
    .sort((a, b) => timeToMin(a.start_time) - timeToMin(b.start_time));

  const grupos = agruparSolapados(conHora);
  const bloques = grupos.map(grupo => grupo.map((ev, col) => {
    const startMin = timeToMin(ev.start_time) - horaBase * 60;
    const endMin = (ev.end_time ? timeToMin(ev.end_time) : timeToMin(ev.start_time) + 60) - horaBase * 60;
    const top = (startMin / 60) * ALTO_HORA;
    const alto = Math.max(18, ((endMin - startMin) / 60) * ALTO_HORA);
    const color = eventColor(ev.title, ev.area);
    const ancho = 100 / grupo.length;
    const izq = ancho * col;
    return buildGridBlockHTML(ev, dateISO, top, alto, izq, ancho, color);
  }).join('')).join('');

  return bloques + (esHoy ? renderNowLine(horaBase, horaTope) : '');
}

// Bloque de evento de la grilla — × visible (bloques altos) + franja roja al
// deslizar (swipe, ver listeners touchstart/touchmove más abajo).
function buildGridBlockHTML(ev, dateISO, top, alto, izq, ancho, color) {
  const abrir = `openEventPanel(eventsCache['${dateISO}'].find(e=>e.id==='${ev.id}'), '${dateISO}')`;
  const cerrarSwipe = `this.closest('.sg-block').classList.remove('swiped')`;
  const delBtn = alto >= 34
    ? `<button class="sg-block-del" onclick="event.stopPropagation();deleteEvent('${ev.id}','${dateISO}')">×</button>`
    : '';
  return `
    <div class="sg-block${ev.done ? ' done' : ''}" data-event-id="${ev.id}"
      style="top:${top}px;height:${alto}px;left:${izq}%;width:calc(${ancho}% - 2px);background:${color}4D;border-left-color:${color}">
      <div class="sg-block-content" onclick="if(this.closest('.sg-block').classList.contains('swiped')){${cerrarSwipe};event.stopPropagation();}else{${abrir}}">
        <span class="sg-block-title">${ev.title}</span>
        ${alto >= 34 ? `<span class="sg-block-time">${ev.start_time}${ev.end_time ? '–' + ev.end_time : ''}</span>` : ''}
      </div>
      ${delBtn}
      <div class="sg-block-swipe-del" onclick="event.stopPropagation();deleteEvent('${ev.id}','${dateISO}')">Eliminar</div>
    </div>
  `;
}

// Swipe para eliminar en los bloques de la grilla (Día/Semana) — solo touch.
let _sgSwipeStartX = null;
let _sgSwipeEl = null;

document.addEventListener('touchstart', (e) => {
  const block = e.target.closest('.sg-block');
  document.querySelectorAll('.sg-block.swiped').forEach(b => { if (b !== block) b.classList.remove('swiped'); });
  if (!block) return;
  _sgSwipeEl = block;
  _sgSwipeStartX = e.touches[0].clientX;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!_sgSwipeEl || _sgSwipeStartX === null) return;
  const dx = e.touches[0].clientX - _sgSwipeStartX;
  if (dx < -24) _sgSwipeEl.classList.add('swiped');
  else if (dx > 12) _sgSwipeEl.classList.remove('swiped');
}, { passive: true });

document.addEventListener('touchend', () => {
  _sgSwipeEl = null;
  _sgSwipeStartX = null;
});

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
  if (!await askConfirm('¿Eliminar este elemento?')) return;
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
  if (!await askConfirm('¿Eliminar este proyecto?')) return;
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
  updateEstadoCard();
}

// Bloque "Pulso" — solo hechas/total + barra. Se sacaron momentum y total
// como métricas separadas (momentum no tenía significado claro, total es
// redundante con el X/10).
function updateSugStats() {
  const { done, total, pct } = calcMomentum();
  document.getElementById('sug-done').textContent = `${done}/${total}`;
  const bar = document.getElementById('pulso-bar-fill');
  if (bar) bar.style.width = `${pct}%`;
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

// Bloque "Insight de la IA" — misma llamada a /api/claude y mismo parseo de
// siempre (no tocado), solo cambia DÓNDE se pinta: título+narrativa en el
// header de la card protagonista, una sola sugerencia (tip) integrada abajo
// en un bloque interno. "Mejor día" se saca como línea aparte — ya lo dice
// la narrativa.
async function generateAISummary() {
  const week = getWeekDates(weekOffset);
  const titleEl = document.getElementById('sug-insight-title');
  const textEl = document.getElementById('sug-insight-text');
  const tipEl = document.getElementById('sug-insight-tip');
  titleEl.textContent = 'Analizando tu semana...';
  textEl.textContent = '';
  tipEl.style.display = 'none';

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

    titleEl.textContent = parsed.headline || 'Tu semana';
    textEl.textContent = parsed.insight || '';
    if (parsed.tip) {
      tipEl.textContent = parsed.tip;
      tipEl.style.display = 'block';
    }
  } catch {
    titleEl.textContent = 'Tu semana';
    textEl.textContent = 'No se pudo conectar con la IA.';
  }
}

// ── NAVEGACIÓN ──────────────────────────────────────────────

async function setView(view) {
  currentView = view;

  ['semana', 'semana-grid', 'mes', 'patrones', 'sugerencias', 'equipo'].forEach(v => {
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
    scrollHoyToFirstEvent(toISO(diaActual));
  } else if (view === 'semana-grid') {
    await loadWeek(gridWeekOffset);
    renderSemanaGrid();
  } else if (view === 'mes') {
    await renderMes();
  } else if (view === 'patrones') {
    await renderProyectos();
  } else if (view === 'sugerencias') {
    await loadWeek();
    await renderSugerencias();
  } else if (view === 'equipo') {
    renderEquipo();
  }

  updateViewPills();
}

// Sincroniza el selector Día/Semana/Mes con la vista activa y lo oculta
// en Proyectos/Sugerencias/Progreso (no son parte de ese trío).
function updateViewPills() {
  const pillsBar = document.getElementById('view-pills');
  const enTemporal = currentView === 'semana' || currentView === 'semana-grid' || currentView === 'mes';
  if (pillsBar) pillsBar.style.display = enTemporal ? 'flex' : 'none';

  document.getElementById('pill-dia')?.classList.toggle('active', currentView === 'semana');
  document.getElementById('pill-semana')?.classList.toggle('active', currentView === 'semana-grid');
  document.getElementById('pill-mes')?.classList.toggle('active', currentView === 'mes');
}

// ── FOQUITO (chat) ──────────────────────────────────────────

let _foqGreeted = false;
let _foqRecognition = null;
let _foqRecording = false;
let _foqOpen = false;
let _foqCelebratedDate = null;

// Cara de Foquito reacciona al momento: idle (default), happy (festejo), thinking (procesando voz)
function setFoquitoState(state) {
  const fab = document.getElementById('foq-fab');
  if (!fab) return;
  fab.classList.remove('state-happy', 'state-thinking');
  if (state) fab.classList.add('state-' + state);
}

// Saludo cambia según cómo viene el día — no es siempre el mismo texto
function getFoquitoGreeting() {
  const dateISO = toISO(new Date());
  const dayEvs = eventsCache[dateISO] || [];
  if (!dayEvs.length) {
    return 'Hola, soy Foquito. Contame qué tenés que hacer, por texto o por audio, y te lo anoto.';
  }
  const done = dayEvs.filter(e => e.done).length;
  const total = dayEvs.length;
  if (done === total) {
    return 'Ya cerraste todo por hoy. ¿Sumamos algo para mañana?';
  }
  const hour = new Date().getHours();
  if (hour >= 18 && done === 0) {
    return 'Vamos que todavía se puede. ¿Con cuál arrancamos?';
  }
  return `Vas ${done} de ${total} hoy. Contame qué más anotamos.`;
}

// En desktop (>=1024px) el panel de Foquito queda fijo y siempre visible por CSS
// (ver style.css), sin pasar por toggleFoquitoWidget — solo falta el saludo inicial.
function initFoquitoDesktop() {
  if (!_foqGreeted && window.matchMedia('(min-width: 1024px)').matches) {
    _foqGreeted = true;
    addFoqBubble(getFoquitoGreeting(), 'foq');
  }
}

function toggleFoquitoWidget() {
  _foqOpen = !_foqOpen;
  document.getElementById('foq-panel').classList.toggle('open', _foqOpen);
  document.getElementById('foq-fab').classList.toggle('open', _foqOpen);

  if (_foqOpen) {
    if (!_foqGreeted) {
      _foqGreeted = true;
      addFoqBubble(getFoquitoGreeting(), 'foq');
    }
    document.getElementById('foq-input')?.focus();
  }
}

function addFoqBubble(text, who) {
  const wrap = document.getElementById('foq-messages');
  const bubble = document.createElement('div');
  bubble.className = 'foq-bubble foq-bubble-' + who;
  bubble.textContent = text;
  wrap.appendChild(bubble);
  wrap.scrollTop = wrap.scrollHeight;
}

// Historial corto de la charla — necesario para que Foquito entienda respuestas
// de seguimiento ("¿para qué día lo pongo?" → "el jueves").
let _foqHistory = [];
function pushFoqHistory(userText, foqText) {
  _foqHistory.push({ role: 'user', content: userText }, { role: 'assistant', content: foqText });
  if (_foqHistory.length > 12) _foqHistory = _foqHistory.slice(-12);
}

// Busca una tarea por nombre en un día del cache (sin tildes, case-insensitive,
// match parcial) — dateISO default hoy. Usada por marcar_hecho, editar_evento
// y borrar_evento.
function findFoqEventByName(nombre, dateISO = toISO(new Date())) {
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
  const target = norm(nombre);
  if (!target) return null;
  const dayEvs = eventsCache[dateISO] || [];
  return dayEvs.find(e => !e.done && (norm(e.title).includes(target) || target.includes(norm(e.title))));
}

// Arma el texto de agenda de los próximos 7 días (hoy incluido) a partir de lo
// que ya está en eventsCache — sin queries nuevas. Días fuera de la semana
// actual pueden no estar cargados; esos se omiten en vez de mostrarlos vacíos
// (evita que la IA piense que no hay nada cuando en realidad no se sabe).
function buildFoqAgendaText() {
  const today = new Date();
  const lines = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const iso = toISO(d);
    const dayEvs = eventsCache[iso];
    if (dayEvs === undefined) continue;
    const label = i === 0 ? 'HOY' : i === 1 ? 'MAÑANA' : DAYS_FULL[d.getDay()];
    const detalle = dayEvs.length
      ? dayEvs.map(ev => `${ev.start_time || 'sin hora'} ${ev.title}${ev.done ? ' (hecho)' : ''}`).join(', ')
      : 'sin tareas';
    lines.push(`${label} (${iso}): ${detalle}`);
  }
  return lines.join('\n');
}

// Le pregunta a Claude qué hacer con el mensaje: anotar (uno o varios), editar,
// borrar, marcar hecho, pedir un dato que falta, o charlar. Devuelve null si la
// IA no responde — ahí se usa el fallback local.
async function interpretFoquitoMessage(text) {
  const dateISO = toISO(new Date());
  const agendaText = buildFoqAgendaText();

  try {
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `Sos Foquito, el asistente de agenda de la app .foco. Hablás en español rioplatense, de vos, cálido y breve (1-2 frases, sin emojis). Nunca reprochás ni hacés sentir mal a la persona.
Hoy es ${DAYS_FULL[new Date().getDay()]} ${dateISO}.

Agenda de los próximos días:
${agendaText || 'sin tareas anotadas'}

Analizá el mensaje del usuario (y la charla previa si la hay) y respondé SOLO con JSON válido, sin markdown ni texto extra. Una de estas 7 formas exactas:

1. Pide anotar/agendar UNA sola actividad y la fecha está clara o no hace falta precisarla:
{"accion":"crear_evento","nombre":"texto corto sin palabras de tiempo","fecha":"YYYY-MM-DD","hora_inicio":"HH:MM o null","hora_fin":"HH:MM o null","respuesta":"confirmación breve y cálida"}

2. Pide organizar/armar una rutina, semana, o cualquier pedido que junte VARIAS actividades en un mismo mensaje (ej: "armame mi semana: gym lunes y miércoles 7am, facultad martes y jueves 14 a 18, estudiar todos los días 20hs"). Un objeto por actividad, NUNCA todo el pedido metido en un solo nombre de evento — separá cada actividad en su propio item:
{"accion":"crear_multiple","eventos":[{"nombre":"texto corto de esa actividad","fecha":"YYYY-MM-DD o null","dia_semana":"0-6 (0=domingo) o null","hora_inicio":"HH:MM o null","hora_fin":"HH:MM o null","recurrente":true o false}],"respuesta":"confirmación breve y cálida, mencionando cuántas cosas anotaste"}
- Si algo se repite cada semana (rutina fija: gym, facultad, cursada) → recurrente:true + dia_semana correspondiente, fecha en null.
- Si es puntual, de una sola vez → recurrente:false + fecha concreta, dia_semana en null.
- Si el pedido es una rutina pero falta el horario de alguna actividad, no inventes: usá la forma 5 (preguntar) por esa actividad antes de crear nada.
- **Si son 3 o más actividades, o es una rutina recurrente que arma/reemplaza buena parte de la semana:** NO crees todavía. Primero resumí en pocos bullets lo que entendiste (actividad, día, hora, si es recurrente) usando la forma 7 (conversar) y preguntá "¿Está bien así o cambio algo?". Recién cuando la persona confirme en su próximo mensaje, devolvé crear_multiple con esos eventos — no antes. Mismo criterio que la entrevista de onboarding.
- Si son 1 o 2 tareas puntuales simples y claras, podés crear directo sin este paso extra.

3. Pide mover, cambiar de día u hora, o reprogramar una actividad que ya está en la agenda (buscala ahí por nombre y día):
{"accion":"editar_evento","fecha_actual":"YYYY-MM-DD del día donde está hoy en la agenda","nombre":"nombre tal cual aparece en la agenda","nueva_fecha":"YYYY-MM-DD o null si no cambia de día","nueva_hora_inicio":"HH:MM o null si no cambia","nueva_hora_fin":"HH:MM o null si no cambia","respuesta":"confirmación breve"}
Solo completá nueva_fecha/nueva_hora_* con lo que el usuario pidió cambiar — null en lo demás, no lo toques.

4. Pide sacar, borrar o cancelar una actividad que ya está en la agenda:
{"accion":"borrar_evento","fecha":"YYYY-MM-DD del día donde está en la agenda","nombre":"nombre tal cual aparece en la agenda","respuesta":"confirmación breve"}

5. Pide anotar, mover o borrar algo pero falta un dato importante (sobre todo día u hora, o no identificás bien cuál actividad es si hay varias parecidas):
{"accion":"preguntar","respuesta":"pregunta corta pidiendo justo lo que falta, una sola cosa por vez"}
No inventes el dato que falta, preguntá.

6. Dice que ya hizo, terminó o completó algo que está en la agenda (usá el nombre tal cual aparece ahí):
{"accion":"marcar_hecho","nombre":"nombre exacto de la tarea en la agenda","respuesta":"festejo breve y genuino"}

7. Cualquier otra cosa — pregunta cómo viene el día, charla, pide un resumen, dice que no hizo nada, o se traba y no sabe por dónde arrancar:
{"accion":"conversar","respuesta":"tu respuesta, usando la agenda si aplica"}
Si viene flojo o no hizo nada, nunca lo retés — ofrecé pasar algo para mañana. Si está trabado con muchas cosas, sugerí UNA para arrancar (la más corta), no un discurso.

Si no da fecha para crear evento puntual y es evidente que es hoy, usá ${dateISO}. Si una actividad para editar/borrar no está en la agenda de arriba, no inventes que existe — usá preguntar.`,
        messages: [..._foqHistory, { role: 'user', content: text }]
      })
    });

    const data = await response.json();
    const raw = (data.content?.[0]?.text || '').trim();
    try {
      return JSON.parse(raw);
    } catch {
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      try { return JSON.parse(m?.[1] || ''); } catch { return null; }
    }
  } catch {
    return null;
  }
}

async function sendFoquitoMessage(rawText) {
  const inp = document.getElementById('foq-input');
  const text = (rawText !== undefined ? rawText : inp.value).trim();
  if (!text) return;

  addFoqBubble(text, 'user');
  inp.value = '';
  setFoquitoState('thinking');

  if (_foqOnboarding) {
    await handleOnboardingReply(text);
    setFoquitoState(null);
    return;
  }

  const result = await interpretFoquitoMessage(text);
  setFoquitoState(null);

  if (result?.accion === 'crear_evento' && result.nombre) {
    const dateISO = result.fecha || toISO(new Date());
    await addEvent(dateISO, result.nombre, result.hora_inicio || null, result.hora_fin || null, false, null, false);
    const respuesta = result.respuesta || `Anotado: "${result.nombre}".`;
    addFoqBubble(respuesta, 'foq');
    pushFoqHistory(text, respuesta);
    return;
  }

  if (result?.accion === 'crear_multiple' && Array.isArray(result.eventos) && result.eventos.length) {
    await createBatchEvents(result.eventos);
    const respuesta = result.respuesta || `Anotadas ${result.eventos.length} actividades.`;
    addFoqBubble(respuesta, 'foq');
    pushFoqHistory(text, respuesta);
    return;
  }

  if (result?.accion === 'editar_evento' && result.nombre) {
    const fechaBusqueda = result.fecha_actual || toISO(new Date());
    const ev = findFoqEventByName(result.nombre, fechaBusqueda);
    let respuesta;
    if (ev) {
      const patch = {};
      if (result.nueva_fecha) patch.date = result.nueva_fecha;
      if (result.nueva_hora_inicio) patch.start_time = result.nueva_hora_inicio;
      if (result.nueva_hora_fin) patch.end_time = result.nueva_hora_fin;

      if (Object.keys(patch).length) {
        await db.from('events').update(patch).eq('id', ev.id);
        const destFecha = patch.date || fechaBusqueda;
        eventsCache[fechaBusqueda] = (eventsCache[fechaBusqueda] || []).filter(e => e.id !== ev.id);
        if (!eventsCache[destFecha]) eventsCache[destFecha] = [];
        eventsCache[destFecha].push({ ...ev, ...patch });
        refreshDiaOSemanaGrid(fechaBusqueda);
        if (destFecha !== fechaBusqueda) refreshDiaOSemanaGrid(destFecha);
      }
      respuesta = result.respuesta || `Listo, actualicé "${ev.title}".`;
    } else {
      respuesta = 'No encontré esa actividad en la agenda. ¿Cómo se llama exacto y qué día está?';
    }
    addFoqBubble(respuesta, 'foq');
    pushFoqHistory(text, respuesta);
    return;
  }

  if (result?.accion === 'borrar_evento' && result.nombre) {
    const fechaBusqueda = result.fecha || toISO(new Date());
    const ev = findFoqEventByName(result.nombre, fechaBusqueda);
    let respuesta;
    if (ev) {
      await db.from('events').delete().eq('id', ev.id);
      eventsCache[fechaBusqueda] = (eventsCache[fechaBusqueda] || []).filter(e => e.id !== ev.id);
      removeEventFromDOM(ev.id, fechaBusqueda);
      refreshDiaOSemanaGrid(fechaBusqueda);
      respuesta = result.respuesta || `Saqué "${ev.title}".`;
    } else {
      respuesta = 'No encontré esa actividad en la agenda. ¿Cómo se llama exacto y qué día está?';
    }
    addFoqBubble(respuesta, 'foq');
    pushFoqHistory(text, respuesta);
    return;
  }

  if (result?.accion === 'marcar_hecho' && result.nombre) {
    const ev = findFoqEventByName(result.nombre);
    let respuesta;
    if (ev) {
      await toggleDone(ev.id, toISO(new Date()));
      respuesta = result.respuesta || `Marcado: "${ev.title}".`;
    } else {
      respuesta = 'No encontré esa tarea en tu agenda de hoy. ¿Cómo se llama exacto?';
    }
    addFoqBubble(respuesta, 'foq');
    pushFoqHistory(text, respuesta);
    return;
  }

  if ((result?.accion === 'conversar' || result?.accion === 'preguntar') && result.respuesta) {
    addFoqBubble(result.respuesta, 'foq');
    pushFoqHistory(text, result.respuesta);
    return;
  }

  // Fallback local: la IA no respondió (sin internet, endpoint caído) o devolvió algo inesperado.
  const { name, date, h1, m1, h2, m2 } = parseNL(text);
  if (!name) {
    addFoqBubble('No te entendí bien. ¿Me lo contás de otra forma?', 'foq');
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
  const fallbackRespuesta = `Anotado: "${name}" ${dayLabel}${timeLabel}.`;
  addFoqBubble(fallbackRespuesta, 'foq');
  pushFoqHistory(text, fallbackRespuesta);
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
    setFoquitoState('thinking');
  };

  _foqRecognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    sendFoquitoMessage(transcript);
  };

  _foqRecognition.onerror = () => {
    showToast('No se pudo escuchar el audio', 'error');
    setFoquitoState(null);
  };

  _foqRecognition.onend = () => {
    _foqRecording = false;
    btn.classList.remove('recording');
    setFoquitoState(null);
  };

  _foqRecognition.start();
}

// Mantiene el FAB/panel de Foquito pegados arriba del teclado en mobile
// (position:fixed con bottom fijo queda tapado por el teclado en iOS/Android)
if (window.visualViewport) {
  const vv = window.visualViewport;
  const adjustFoquitoForKeyboard = () => {
    // En desktop el panel está anclado al costado (position:static) — no aplica.
    if (window.matchMedia('(min-width: 1024px)').matches) return;

    const keyboardInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const bottom = keyboardInset > 60 ? keyboardInset + 12 : 68;
    const fab = document.getElementById('foq-fab');
    const panel = document.getElementById('foq-panel');
    if (fab) fab.style.bottom = bottom + 'px';
    if (panel) {
      panel.style.bottom = bottom + 'px';
      // Con el teclado abierto, el panel (altura fija en CSS: min(65vh,520px)
      // calculada contra la pantalla COMPLETA) no entraba en lo que quedaba
      // arriba del teclado — el header y los mensajes de arriba se corrían
      // fuera de la vista. Lo capamos a lo que realmente queda visible.
      panel.style.maxHeight = keyboardInset > 60
        ? `calc(${vv.height}px - ${bottom + 16}px)`
        : '';
    }
  };
  vv.addEventListener('resize', adjustFoquitoForKeyboard);
  vv.addEventListener('scroll', adjustFoquitoForKeyboard);
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

document.addEventListener('DOMContentLoaded', () => {
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
        toggleFoquitoWidget();
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

// ── ONBOARDING (entrevista de Foquito en el primer login) ───
// No es una pantalla propia: usa el panel/FAB real de Foquito, con el
// system prompt de acá abajo en vez del normal mientras _foqOnboarding
// esté prendido. Ver sendFoquitoMessage() para el branching.

// Primer login = perfil sin onboarding_completed (requiere la columna,
// ver SQL avisado aparte) Y sin eventos todavía. Un usuario viejo que
// por lo que sea no tiene la columna en true pero ya tiene eventos
// cargados no es "nuevo" — se marca completado sin mostrar nada.
function checkOnboarding() {
  if (!currentUser) return;
  if (currentProfile?.onboarding_completed) return;

  const hasEvents = Object.values(eventsCache).some(evs => evs.length > 0);
  if (hasEvents) { markOnboardingCompleted(); return; }

  startFoquitoOnboarding();
}

async function markOnboardingCompleted() {
  if (!currentUser) return;
  await db.from('profiles').upsert({ id: currentUser.id, onboarding_completed: true });
  if (currentProfile) currentProfile.onboarding_completed = true;
}

// System prompt de la entrevista — reemplaza al system prompt normal de
// Foquito (interpretFoquitoMessage) SOLO mientras _foqOnboarding es true.
// Formato de respuesta {mensaje, acciones} es propio de la entrevista,
// distinto del {accion,respuesta} del chat normal — no comparten parser,
// pero sí el mismo panel, el mismo input y el mismo addFoqBubble.
const OB_SYSTEM_PROMPT = `Sos Foquito, el asistente de la app .foco, y es la primera vez que hablás con esta
persona. Todavía no sabés nada de ella. Tu trabajo ahora es conocer su rutina semanal
con una charla corta, y al final armarle su semana base cargando los eventos que se
repiten.

# Tono
- Español rioplatense, de vos, cálido y cercano. Sos Foquito, no un consultor.
- Breve: una sola pregunta por mensaje, en 1-2 frases. Nunca listas de preguntas.
- Cero sermones, cero análisis del tiempo, cero motivación genérica.

# Cómo entrevistás
- Arrancá presentándote en una línea y explicando que le vas a hacer unas pocas
  preguntas para armarle la semana. Después, la primera pregunta.
- MÁXIMO 6 preguntas. Si ya tenés lo necesario antes, cortá.
- Una pregunta por mensaje. Esperá la respuesta antes de seguir.
- Adaptá cada pregunta a lo que ya te dijo. No preguntes algo que ya se deduce.
- Si una respuesta es vaga, repreguntá UNA vez con una opción concreta; si sigue
  vaga, avanzá.
- Lo que necesitás descubrir (adaptado, no como checklist rígido):
  1. Qué estudia o en qué trabaja, y sus horarios fijos (facultad, trabajo, cursadas).
  2. Qué cosas hace de forma recurrente (gym, deporte, hobbies, comidas fijas).
  3. Qué días y a qué hora de cada una.
  4. Si algo de eso NO es todas las semanas (para no marcarlo recurrente de más).
  5. A qué le quiere dar prioridad esta etapa.

# Cierre (importante)
- Cuando tengas lo necesario, NO crees nada todavía. Primero resumí en pocos bullets
  la rutina que entendiste (día, hora y si es recurrente) y preguntá: "¿Está bien así
  o cambio algo?".
- Recién cuando la persona confirme, devolvé las acciones para crear los eventos.

# Recurrencia
- Por defecto, lo que es rutina va como recurrente (se repite cada semana ese día).
- Si la persona dijo que algo no es todas las semanas, o si tenés dudas, preguntáselo
  antes de marcarlo recurrente. No asumas.

# Formato de respuesta
Respondé SIEMPRE un JSON válido y nada fuera de él:
{
  "mensaje": "lo que le decís (tu pregunta, o el resumen, o la confirmación final)",
  "acciones": []
}
- Durante la entrevista y en el resumen: "acciones" va VACÍO. Solo conversás.
- Solo DESPUÉS de que confirme el resumen, llená "acciones" con un objeto por evento:
  {"tipo":"crear","titulo":"...","dia_semana":<0-6, 0=domingo>,"hora":"HH:MM" o null,
   "recurrente":true,"esFoco":false}
  - Para rutina semanal: recurrente:true + el dia_semana correspondiente.
  - hora: null si es algo sin horario fijo.
- Si la persona quiere saltear el onboarding en cualquier momento, respondé con un
  mensaje corto de bienvenida y "acciones" vacío. No la obligues.

# Reglas
- Usá solo lo que la persona te dijo. Si falta un dato para crear un evento, preguntalo.
- Nunca inventes horarios ni actividades que no mencionó.
- No des indicaciones médicas, de dieta ni de ayuno. Si aparecen señales de
  agotamiento fuerte o malestar emocional, sugerí hablarlo con alguien, no lo
  resuelvas con la rutina.`;

function pushObHistory(userText, assistantResult) {
  _obHistory.push({ role: 'user', content: userText }, { role: 'assistant', content: JSON.stringify(assistantResult) });
}

// Le pregunta a Claude qué decir/preguntar según el system prompt de arriba.
// Devuelve {mensaje, acciones} o null si la IA no responde.
async function interpretOnboardingMessage(text) {
  try {
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        system: OB_SYSTEM_PROMPT,
        messages: [..._obHistory, { role: 'user', content: text }]
      })
    });

    const data = await response.json();
    const raw = (data.content?.[0]?.text || '').trim();
    try {
      return JSON.parse(raw);
    } catch {
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      try { return JSON.parse(m?.[1] || ''); } catch { return null; }
    }
  } catch {
    return null;
  }
}

// Abre el panel real de Foquito (en desktop ya está siempre visible; en
// mobile fuerza el toggle a abierto, como pide el punto 2 del pedido) y
// dispara la primera pregunta en modo onboarding. _foqGreeted se prende
// ANTES de tocar el panel para que no se pise con el saludo normal.
async function startFoquitoOnboarding() {
  _foqOnboarding = true;
  _obHistory = [];
  _foqGreeted = true;
  toggleObSkipButton(true);
  if (!_foqOpen) toggleFoquitoWidget();

  setFoquitoState('thinking');
  const kickoffText = 'Arrancá la entrevista.';
  const result = await interpretOnboardingMessage(kickoffText);
  setFoquitoState(null);

  if (result?.mensaje) {
    addFoqBubble(result.mensaje, 'foq');
    pushObHistory(kickoffText, result);
  } else {
    addFoqBubble('¡Hola! Soy Foquito. Contame: ¿estudiás, trabajás, o las dos cosas? ¿Y en qué horarios?', 'foq');
  }
}

function toggleObSkipButton(show) {
  const btn = document.getElementById('foq-ob-skip-btn');
  if (btn) btn.style.display = show ? '' : 'none';
}

function skipFoquitoOnboarding() {
  if (!_foqOnboarding) return;
  addFoqBubble('Salteado. Cuando quieras armamos tu semana, avisame.', 'foq');
  endFoquitoOnboarding();
}

async function endFoquitoOnboarding() {
  _foqOnboarding = false;
  _obHistory = [];
  toggleObSkipButton(false);
  await markOnboardingCompleted();
}

// dia_semana (0-6) sin fecha concreta se ancla a su próxima ocurrencia
// desde hoy (o hoy mismo si coincide) — recurrente:true en addEvent hace
// que después se repita todas las semanas sin importar esta fecha ancla
// (mismo criterio que "hacer recurrente" desde el panel de evento, ver
// confirmRecurrence). Compartido entre la entrevista de onboarding y el
// "crear_multiple" del chat normal — ambos arman rutinas por día de semana.
function nextDateForWeekday(diaSemana) {
  const today = new Date();
  const offset = (diaSemana - today.getDay() + 7) % 7;
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return toISO(d);
}

// Crea los eventos recurrentes que arma la entrevista de onboarding.
async function createOnboardingEvents(acciones) {
  for (const a of acciones) {
    if (a.tipo !== 'crear' || !a.titulo) continue;
    const diaSemana = Number.isInteger(a.dia_semana) ? a.dia_semana : null;
    const dateISO = diaSemana !== null ? nextDateForWeekday(diaSemana) : toISO(new Date());
    await addEvent(dateISO, a.titulo, a.hora || null, null, !!a.recurrente, diaSemana, !!a.esFoco);
  }
}

// Crea el lote de eventos del "crear_multiple" del chat normal (armar
// rutina/organizar varias actividades en un solo pedido). A diferencia de
// la entrevista, acá cada actividad puede traer fecha puntual en vez de
// día de semana recurrente — mismo addEvent() de siempre, sin lógica nueva
// de guardado.
async function createBatchEvents(eventos) {
  for (const ev of eventos) {
    if (!ev?.nombre) continue;
    const recurrente = !!ev.recurrente;
    const diaSemana = recurrente && Number.isInteger(ev.dia_semana) ? ev.dia_semana : null;
    const dateISO = diaSemana !== null ? nextDateForWeekday(diaSemana) : (ev.fecha || toISO(new Date()));
    await addEvent(dateISO, ev.nombre, ev.hora_inicio || null, ev.hora_fin || null, recurrente, diaSemana, false);
  }
}

// Llamado desde sendFoquitoMessage cuando _foqOnboarding está prendido —
// mismo input, mismo #foq-messages, mismo botón de enviar que el chat
// normal. Devuelve el control a sendFoquitoMessage, que ya puso la
// burbuja del usuario y el estado "thinking".
async function handleOnboardingReply(text) {
  // Salteo por texto además del botón visible (skipFoquitoOnboarding):
  // "acciones vacío" en el JSON es indistinguible de "sigo preguntando"
  // o "muestro el resumen", así que esto no puede depender de la IA.
  if (/\b(saltear|saltalo|salteemos|skip|despu[ée]s lo hago|ahora no|m[aá]s tarde)\b/i.test(text)) {
    addFoqBubble('Dale, sin drama. Cuando quieras armamos tu semana, avisame.', 'foq');
    await endFoquitoOnboarding();
    return;
  }

  const result = await interpretOnboardingMessage(text);

  if (!result?.mensaje) {
    addFoqBubble('No te entendí bien, ¿me lo contás de nuevo?', 'foq');
    return;
  }

  addFoqBubble(result.mensaje, 'foq');
  pushObHistory(text, result);

  if (Array.isArray(result.acciones) && result.acciones.length) {
    await createOnboardingEvents(result.acciones);
    await endFoquitoOnboarding();
  }
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
  // Mismo criterio que la grilla (buildGridBlockHTML): alcanza con start_time,
  // end_time es opcional — antes exigía los dos y mostraba "Sin hora" en
  // eventos que la grilla sí mostraba con hora (ej. "15:30" sin fin).
  const horaStr = ev.start_time ? `${ev.start_time}${ev.end_time ? ' – ' + ev.end_time : ''}` : 'Sin hora';
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
  const recurValueEl = document.getElementById('panel-row-recur-value');
  if (recurValueEl) recurValueEl.textContent = ev.recurrente ? 'Cada semana' : 'Solo esta vez';

  updateFocusButton(!!ev.is_focus);

  // Las filas Área/Repetir arrancan colapsadas — se abren tocándolas
  const areaWrap = document.getElementById('panel-area-wrap');
  const recurWrap = document.getElementById('panel-recur-wrap');
  if (areaWrap) areaWrap.style.display = 'none';
  if (recurWrap) recurWrap.style.display = 'none';

  document.getElementById('event-panel').classList.add('open');
  document.getElementById('panel-overlay').classList.add('open');
}

// Abre/cierra una fila de propiedad (Área o Repetir) — colapsa la otra si estaba abierta
function togglePanelRow(name) {
  const ids = { area: 'panel-area-wrap', recur: 'panel-recur-wrap' };
  Object.entries(ids).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = (key === name && el.style.display === 'none') ? '' : 'none';
  });
}

async function panelDeleteEvent() {
  if (!panelEvent) return;
  if (await deleteEvent(panelEvent.id, panelDateISO)) closeEventPanel();
}

function updateDoneButton(done) {
  const btn   = document.getElementById('panel-done-main');
  const label = document.getElementById('panel-done-label');
  if (!btn || !label) return;
  label.textContent = done ? 'Completada' : 'Completar';
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
  const recurValueEl = document.getElementById('panel-row-recur-value');
  if (recurValueEl) recurValueEl.textContent = recurrente ? 'Cada semana' : 'Solo esta vez';

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
  { label: 'Nuevo evento',      icon: '+',  hint: 'N', fn: () => { closeCmd(); toggleFoquitoWidget(); } },
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

function updateEventDoneInDOM(id, done, dateISO) {
  refreshDiaOSemanaGrid(dateISO);
}

function removeEventFromDOM(id, dateISO) {
  refreshDiaOSemanaGrid(dateISO);
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
  if (container) {
    container.innerHTML = Object.entries(AREAS).map(([key, a]) => `
      <button class="area-pill${panelCurrentArea === key ? ' selected' : ''}"
              style="--area-color:${a.color}"
              onclick="selectPanelArea('${key}')">
        ${a.label}
      </button>
    `).join('');
  }

  // Sincroniza el dot+texto de la fila "Área" (colapsada) con la selección actual
  const areaInfo = AREAS[panelCurrentArea];
  const dotEl = document.getElementById('panel-row-area-dot');
  const textEl = document.getElementById('panel-row-area-text');
  if (dotEl) dotEl.style.background = areaInfo ? areaInfo.color : 'var(--text3)';
  if (textEl) textEl.textContent = areaInfo ? areaInfo.label : 'Trabajo';
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
            <div class="tuana-legend-dot" style="background:#12141F"></div>
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
          <div class="tuana-hl-val" id="tu-racha">—</div>
          <div class="tuana-hl-lbl">racha actual</div>
        </div>
      </div>

      <div id="tu-tendencia-card"></div>
    </div>
  `;

  const since60d = toISO(new Date(Date.now() - 60  * 86400000));
  const since1y  = toISO(new Date(Date.now() - 365 * 86400000));

  const [evRes, streakRes] = await Promise.all([
    db.from('events').select('date, done').eq('user_id', uid).gte('date', since1y),
    db.from('daily_checkins').select('date').eq('user_id', uid).gte('date', since60d).order('date', { ascending: false })
  ]);

  const events     = evRes.data      || [];
  const streakData = streakRes.data  || [];
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
  // "Mejor semana" se sacó: dependía de una variable `digests` que nunca se
  // declaraba en esta función — tiraba ReferenceError acá mismo y cortaba
  // en seco el resto de renderEquipo(). Por eso racha/tendencia/energía
  // aparecían siempre vacías: no era falta de datos, el código ni llegaba
  // a ejecutarse. Sacar esta métrica de paso arregla el crash.
  const elDone = document.getElementById('tu-total-done');
  if (elDone) elDone.textContent = events.filter(e => e.done).length;

  const elRacha = document.getElementById('tu-racha');
  let streak = 0;
  if (elRacha) {
    const checkinSet = new Set(streakData.map(c => c.date));
    const cursor = new Date(); cursor.setHours(0,0,0,0);
    if (!checkinSet.has(toISO(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (checkinSet.has(toISO(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    // Antes mostraba "—" en 0 — se confundía con "no se pudo calcular".
    elRacha.textContent = streak + (streak === 1 ? ' día' : ' días');
  }

  // ── Tendencia ────────────────────────────────────────────────
  // Antes el gráfico quedaba en blanco sin avisar si no había completadas
  // en el período. Ahora, si el usuario tiene poco recorrido en general
  // (menos de ~2 semanas de días con algo completado), se muestra un
  // estado vacío explícito en vez del gráfico — no hace falta ni mostrar
  // el selector Sem/Mes/Año si no hay con qué compararlo todavía.
  const diasConCompletadas = new Set(events.filter(e => e.done).map(e => e.date)).size;
  renderTendenciaCard(diasConCompletadas >= 14);
}

// Card "Tendencia" — gráfico real si hay suficiente recorrido, si no un
// estado vacío sobrio (nunca un SVG en blanco sin explicación).
function renderTendenciaCard(hayDatos) {
  const el = document.getElementById('tu-tendencia-card');
  if (!el) return;

  if (!hayDatos) {
    el.innerHTML = `
      <div class="tuana-card">
        <div class="tuana-section-label">Tendencia</div>
        <div class="tuana-empty-state">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <polyline points="4,30 14,20 20,25 36,8" stroke="#3A3A3C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="36" cy="8" r="2.5" fill="#3A3A3C"/>
          </svg>
          <div class="tuana-empty">Tu tendencia de tareas aparece acá cuando tengas un par de semanas registradas. Seguí un poco más.</div>
        </div>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <div class="tuana-card">
      <div class="tuana-card-top">
        <div>
          <div class="tuana-section-label">Tendencia</div>
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
  `;
  renderTuanaChart();
}

// ── ARRANCAR ────────────────────────────────────────────────
init();
