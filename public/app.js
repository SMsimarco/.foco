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
const COLORS = ['#6366F1','#8B5CF6','#06B6D4','#10B981','#F43F5E','#F59E0B','#F97316','#EC4899','#14B8A6','#3B82F6'];

let currentUser = null;
let currentProfile = null;
let weekOffset = 0;
let monthOffset = 0;
let currentView = 'semana';
let eventsCache = {}; // { 'YYYY-MM-DD': [...events] }
let ghost = null;
let notifOn = true;
let authMode = 'login';

// Panel state
let panelEvent = null;
let panelDateISO = null;
let panelEnergy = null;
let panelRecDays = [];
let focusTimerInterval = null;
let focusTimerSeconds = 25 * 60;
let focusTimerRunning = false;

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
  errorEl.textContent = '';

  try {
    if (authMode === 'login') {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const name = document.getElementById('auth-name').value.trim();
      if (!name) { errorEl.textContent = 'Ingresá tu nombre.'; btn.disabled = false; return; }
      const { data, error } = await db.auth.signUp({ email, password });
      if (error) throw error;
      if (data.user) {
        await db.from('profiles').upsert({ id: data.user.id, display_name: name });
      }
    }
  } catch (err) {
    errorEl.textContent = err.message || 'Error al iniciar sesión.';
    btn.disabled = false;
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
  lbl.textContent = notifOn ? 'notif' : 'off';
  if (notifOn) setupNotifications();
}

// ── INICIALIZACIÓN ──────────────────────────────────────────

async function init() {
  db.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      currentUser = session.user;
      const { data } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
      currentProfile = data;
      showApp();
    } else {
      currentUser = null;
      currentProfile = null;
      showAuth();
    }
  });

  const { data: { session } } = await db.auth.getSession();
  if (!session) showAuth();
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
  setupNotifications();
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
  renderSemana();
  scheduleNotification(data);
}

async function toggleDone(id, dateISO) {
  const ev = (eventsCache[dateISO] || []).find(e => e.id === id);
  if (!ev) return;

  const newDone = !ev.done;
  const { error } = await db.from('events').update({ done: newDone }).eq('id', id);
  if (error) { console.error(error); return; }

  ev.done = newDone;
  renderSemana();
  updateMomentum();
  if (currentView === 'sugerencias') updateSugStats();
}

async function deleteEvent(id, dateISO) {
  const { error } = await db.from('events').delete().eq('id', id);
  if (error) { console.error(error); return; }

  eventsCache[dateISO] = (eventsCache[dateISO] || []).filter(e => e.id !== id);
  ghost = null;
  renderSemana();
  updateMomentum();
}

// ── PARSER LENGUAJE NATURAL ─────────────────────────────────

function parseNL(raw) {
  let s = raw.trim();
  let date = null, h1 = 9, m1 = 0, h2 = 10, m2 = 0;

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

  // Rango horario
  const rangePatterns = [
    /(?:desde\s+(?:las?\s+)?|de\s+(?:las?\s+)?)(\d{1,2})(?::(\d{2}))?\s*h?s?\s+(?:hasta\s+(?:las?\s+)?|a\s+(?:las?\s+)?)(\d{1,2})(?::(\d{2}))?\s*h?s?/i,
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
      /(\d{1,2})(?::(\d{2}))?\s*hs/i
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
    .replace(/\s+/g, ' ').trim();

  if (!date) date = new Date();

  return {
    name: s || 'Nuevo evento',
    date,
    h1: Math.min(h1, 23),
    m1,
    h2: Math.min(h2, 23),
    m2
  };
}

// ── RENDER SEMANA ───────────────────────────────────────────

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
      block.style.cssText = `top:${y}px;height:${h}px;background:${color}22;border-left:2px solid ${color}`;
      block.innerHTML = `
        <div class="ev-title">${ev.title}</div>
        ${h > 24 ? `<div class="ev-time">${ev.start_time}–${ev.end_time}</div>` : ''}
        <button class="ev-del" onclick="event.stopPropagation();deleteEvent('${ev.id}','${toISO(d)}')">×</button>
      `;
      block.addEventListener('click', () => openEventPanel(ev, toISO(d)));
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

    col.addEventListener('click', (e) => {
      if (ghost) { ghost = null; renderSemana(); return; }
      const rect = col.getBoundingClientRect();
      const gridWrap = document.getElementById('grid-wrap');
      const relY = e.clientY - rect.top + gridWrap.scrollTop;
      const { h, m } = yToHM(relY);
      const em2 = (m + 30) % 60;
      const eh2 = m + 30 >= 60 ? h + 1 : h;
      ghost = { di, h, m, eh: Math.min(eh2, 23), em: em2, pre: '' };
      renderSemana();
    });

    container.appendChild(col);
  });

  const gridWrap = document.getElementById('grid-wrap');
  const scrollTo = Math.max(0, toY(now.getHours() - 2, 0));
  setTimeout(() => { gridWrap.scrollTop = scrollTo; }, 50);
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
  const { done, total, pct } = calcMomentum();
  const circ = 2 * Math.PI * 11;
  const dash = (pct / 100) * circ;

  const arc = document.getElementById('momentum-arc');
  if (arc) arc.setAttribute('stroke-dasharray', `${dash.toFixed(1)} ${circ.toFixed(1)}`);

  const numEl = document.getElementById('momentum-num');
  if (numEl) numEl.textContent = pct;

  const labelEl = document.getElementById('momentum-label-top');
  if (labelEl) labelEl.textContent = momentumLabel(pct);
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

  resumenEl.textContent = 'Analizando tu semana...';

  const eventsText = week.flatMap(d =>
    (eventsCache[toISO(d)] || []).map(ev =>
      `${DAYS_FULL[d.getDay()]} ${ev.start_time}-${ev.end_time}: ${ev.title}${ev.done ? ' (✓)' : ''}`
    )
  ).join('\n');

  try {
    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: `Sos un asistente de productividad. Analizás la agenda semanal del usuario
                 y dás un resumen conciso en español rioplatense (2-3 oraciones).
                 Mencioná: día más cargado, patrón que notás, algo concreto a mejorar.
                 Sé directo, sin saludos. Máximo 60 palabras.`,
        messages: [{ role: 'user', content: eventsText || 'Sin eventos esta semana.' }]
      })
    });
    const data = await response.json();
    resumenEl.textContent = data.content?.[0]?.text || 'No se pudo generar el análisis.';
  } catch (e) {
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

  ['semana', 'mes', 'sugerencias'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.style.display = v === view ? 'flex' : 'none';

    const btn = document.getElementById('nav-' + v);
    if (btn) btn.classList.toggle('active', v === view);
  });

  const weekNav = document.getElementById('week-nav');
  if (weekNav) weekNav.style.visibility = view === 'semana' ? 'visible' : 'hidden';

  if (view === 'semana') {
    ghost = null;
    await loadWeek();
    renderSemana();
  } else if (view === 'mes') {
    await renderMes();
  } else if (view === 'sugerencias') {
    await renderSugerencias();
  }
}

async function changeWeek(dir) {
  weekOffset += dir;
  ghost = null;
  await loadWeek();
  renderSemana();
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
});

// ── EVENT PANEL ─────────────────────────────────────────────

function openEventPanel(ev, dateISO) {
  panelEvent = ev;
  panelDateISO = dateISO;
  panelEnergy = null;
  panelRecDays = ev.recurring_days ? [...ev.recurring_days] : [];

  document.getElementById('panel-title').textContent = ev.title;

  const week = getWeekDates(weekOffset);
  const d = new Date(dateISO + 'T12:00:00');
  const dayStr = DAYS_FULL[d.getDay()];
  document.getElementById('panel-meta').textContent =
    `${ev.start_time} – ${ev.end_time} · ${dayStr}`;

  const doneBtn = document.getElementById('panel-done-btn');
  doneBtn.textContent = ev.done ? 'Desmarcar hecho' : 'Marcar como hecho';
  doneBtn.classList.toggle('done', !!ev.done);

  document.getElementById('panel-goal').value = '';
  document.getElementById('panel-notes').value = ev.notes || '';

  stopFocusTimer();
  focusTimerSeconds = 25 * 60;
  updateTimerDisplay();

  document.querySelectorAll('.panel-energy-btn').forEach(b => b.classList.remove('selected'));
  renderPanelRecDays();

  document.getElementById('event-panel').classList.add('open');
  document.getElementById('panel-overlay').classList.add('open');
}

function closeEventPanel() {
  document.getElementById('event-panel').classList.remove('open');
  document.getElementById('panel-overlay').classList.remove('open');
  stopFocusTimer();
  panelEvent = null;
  panelDateISO = null;
}

async function panelToggleDone() {
  if (!panelEvent) return;
  await toggleDone(panelEvent.id, panelDateISO);
  panelEvent = (eventsCache[panelDateISO] || []).find(e => e.id === panelEvent.id);
  if (!panelEvent) { closeEventPanel(); return; }
  const doneBtn = document.getElementById('panel-done-btn');
  doneBtn.textContent = panelEvent.done ? 'Desmarcar hecho' : 'Marcar como hecho';
  doneBtn.classList.toggle('done', !!panelEvent.done);
}

async function panelDeleteEvent() {
  if (!panelEvent) return;
  await deleteEvent(panelEvent.id, panelDateISO);
  closeEventPanel();
}

function selectPanelEnergy(e) {
  panelEnergy = e;
  document.querySelectorAll('.panel-energy-btn').forEach(btn => {
    btn.classList.toggle('selected', parseInt(btn.dataset.e) === e);
  });
}

function toggleRecDay(d) {
  const idx = panelRecDays.indexOf(d);
  if (idx === -1) panelRecDays.push(d);
  else panelRecDays.splice(idx, 1);
  renderPanelRecDays();
}

function renderPanelRecDays() {
  document.querySelectorAll('.rec-day-btn').forEach(btn => {
    btn.classList.toggle('active', panelRecDays.includes(parseInt(btn.dataset.d)));
  });
}

function updateTimerDisplay() {
  const m = Math.floor(focusTimerSeconds / 60);
  const s = focusTimerSeconds % 60;
  const el = document.getElementById('panel-timer');
  if (el) el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function toggleFocusTimer() {
  if (focusTimerRunning) stopFocusTimer();
  else startFocusTimer();
}

function startFocusTimer() {
  focusTimerRunning = true;
  document.getElementById('panel-timer').classList.add('running');
  document.getElementById('focus-start-btn').classList.add('running');
  document.getElementById('focus-start-btn').textContent = '■  Detener';

  focusTimerInterval = setInterval(() => {
    if (focusTimerSeconds <= 0) {
      stopFocusTimer();
      saveFocusSession(true);
      return;
    }
    focusTimerSeconds--;
    updateTimerDisplay();
  }, 1000);
}

function stopFocusTimer() {
  focusTimerRunning = false;
  clearInterval(focusTimerInterval);
  focusTimerInterval = null;
  const display = document.getElementById('panel-timer');
  const btn = document.getElementById('focus-start-btn');
  if (display) display.classList.remove('running');
  if (btn) {
    btn.classList.remove('running');
    btn.textContent = '▶  Iniciar foco';
  }
}

async function saveFocusSession(completed) {
  if (!currentUser || !panelEvent) return;
  const plannedMin = 25;
  const actualMin = Math.round((plannedMin * 60 - focusTimerSeconds) / 60);
  await db.from('focus_sessions').insert({
    user_id: currentUser.id,
    event_id: panelEvent.id,
    started_at: new Date(Date.now() - actualMin * 60000).toISOString(),
    ended_at: new Date().toISOString(),
    planned_minutes: plannedMin,
    actual_minutes: actualMin,
    completed,
    energy_after: panelEnergy,
    notes: document.getElementById('panel-notes')?.value || null
  });
}

// ── ARRANCAR ────────────────────────────────────────────────
init();
