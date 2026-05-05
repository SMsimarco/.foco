/* ── Supabase ── */
const SUPABASE_URL      = 'https://hgvfzwmtepztkdoxjptu.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_Ej3NewanSxjLVwiue6rD7w_PwQfGZ5a'
const { createClient }  = supabase
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

/* ── Constantes ── */
const SLOT_H     = 48   // px por hora → 24 * 48 = 1152px total
const DAYS_ES    = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']
const DAYS_SHORT = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']
const MONTHS_ES  = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

/* ── Estado ── */
let currentUser    = null
let currentProfile = null
let weekOffset     = 0
let monthOffset    = 0
let currentView    = 'semana'
let eventsCache    = {}
let nowLineTimer   = null
let authMode       = 'login'

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
function toISO(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isToday(d) { return toISO(d) === toISO(new Date()) }
function isPast(d)  { return toISO(d) < toISO(new Date()) }

function getWeekDates(offset = 0) {
  const now = new Date()
  const dow = now.getDay()
  const mon = new Date(now)
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7)
  mon.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon)
    d.setDate(mon.getDate() + i)
    return d
  })
}

function getMonthDate() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
}

function toY(h, m)  { return (h + m / 60) * SLOT_H }
function yToTime(y) {
  const total = y / SLOT_H
  const h     = Math.floor(total)
  const frac  = total - h
  const m     = Math.round(frac * 2) * 30
  if (m >= 60) return { h: Math.min(23, h + 1), m: 0 }
  return { h: Math.max(0, Math.min(23, h)), m }
}
function formatTime(h, m) { return `${h}:${String(m).padStart(2, '0')}` }
function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function getWeekOffsetForDate(date) {
  const todayMon = getWeekDates(0)[0]
  const d   = new Date(date)
  const dow = d.getDay()
  const targetMon = new Date(d)
  targetMon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  targetMon.setHours(0, 0, 0, 0)
  return Math.round((targetMon - todayMon) / (7 * 24 * 60 * 60 * 1000))
}

function eventColor(title) {
  const colors = [
    '#6366F1','#8B5CF6','#06B6D4','#10B981',
    '#F43F5E','#F59E0B','#F97316','#EC4899',
    '#14B8A6','#3B82F6'
  ]
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash) + title.charCodeAt(i)
    hash = hash & hash
  }
  return colors[Math.abs(hash) % colors.length]
}

function calcMomentum(events) {
  if (!events.length) return 0
  return Math.round(events.filter(e => e.done).length / events.length * 100)
}
function momentumLabel(score) {
  if (score >= 75) return 'buena semana'
  if (score >= 50) return 'vas bien'
  if (score >= 25) return 'podés más'
  return 'arrancá'
}

function findConflicts(dayEvents) {
  const conflicts = new Set()
  dayEvents.forEach((a, i) => {
    dayEvents.forEach((b, j) => {
      if (i >= j || a.done || b.done) return
      const aS = timeToMinutes(a.start_time), aE = timeToMinutes(a.end_time)
      const bS = timeToMinutes(b.start_time), bE = timeToMinutes(b.end_time)
      if (aS < bE && bS < aE) { conflicts.add(a.id); conflicts.add(b.id) }
    })
  })
  return conflicts
}

/* ─────────────────────────────────────────
   PARSER LENGUAJE NATURAL
───────────────────────────────────────── */
function parseNL(raw) {
  let s = raw.trim()
  let date = null, h1 = 9, m1 = 0, h2 = 10, m2 = 0

  const MONTHS = {
    enero:0,febrero:1,marzo:2,abril:3,mayo:4,junio:5,
    julio:6,agosto:7,septiembre:8,octubre:9,noviembre:10,diciembre:11
  }

  const DAYMAP = {
    'hoy': -2, 'mañana': -1, 'manana': -1,
    'lun': 1, 'lunes': 1,
    'mar': 2, 'martes': 2,
    'mié': 3, 'mie': 3, 'miercoles': 3, 'miércoles': 3,
    'jue': 4, 'jueves': 4,
    'vie': 5, 'viernes': 5,
    'sáb': 6, 'sab': 6, 'sabado': 6, 'sábado': 6,
    'dom': 0, 'domingo': 0
  }

  // 1. Detectar fecha específica: "22 de junio"
  const dateMatch = s.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)/i)
  if (dateMatch && MONTHS[dateMatch[2].toLowerCase()] !== undefined) {
    const d = new Date()
    d.setMonth(MONTHS[dateMatch[2].toLowerCase()])
    d.setDate(parseInt(dateMatch[1]))
    if (d < new Date()) d.setFullYear(d.getFullYear() + 1)
    date = d
    s = s.replace(dateMatch[0], ' ')
  }

  // 2. Detectar día relativo o nombre de día
  if (!date) {
    for (const [key, val] of Object.entries(DAYMAP)) {
      if (new RegExp('\\b' + key + '\\b', 'i').test(s)) {
        const now = new Date()
        if (val === -2) {
          date = new Date()
        } else if (val === -1) {
          date = new Date()
          date.setDate(date.getDate() + 1)
        } else {
          let diff = (val - now.getDay() + 7) % 7
          if (diff === 0) diff = 7
          date = new Date(now)
          date.setDate(now.getDate() + diff)
        }
        s = s.replace(new RegExp('\\b' + key + '\\b', 'i'), ' ')
        break
      }
    }
  }

  // 3. Detectar rango horario
  const rangePatterns = [
    /(?:desde\s+(?:las?\s+)?|de\s+(?:las?\s+)?)(\d{1,2})(?::(\d{2}))?\s*h?s?\s+(?:hasta\s+(?:las?\s+)?|a\s+(?:las?\s+)?)(\d{1,2})(?::(\d{2}))?\s*h?s?/i,
    /(\d{1,2})(?::(\d{2}))?\s*h?s?\s+a\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?\s*h?s?/i,
  ]

  let rangeFound = false
  for (const pattern of rangePatterns) {
    const m = s.match(pattern)
    if (m) {
      h1 = parseInt(m[1]); m1 = parseInt(m[2] || 0)
      h2 = parseInt(m[3]); m2 = parseInt(m[4] || 0)
      s = s.replace(m[0], ' ')
      rangeFound = true
      break
    }
  }

  // 4. Si no hay rango, detectar hora única
  if (!rangeFound) {
    const singlePatterns = [
      /a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*h?s?/i,
      /(\d{1,2})(?::(\d{2}))?\s*hs/i,
    ]
    for (const pattern of singlePatterns) {
      const m = s.match(pattern)
      if (m) {
        h1 = parseInt(m[1]); m1 = parseInt(m[2] || 0)
        h2 = h1 + 1;        m2 = m1
        s = s.replace(m[0], ' ')
        break
      }
    }
  }

  // 5. Limpiar palabras de tiempo que sobraron
  s = s
    .replace(/\bdesde\b/gi, ' ')
    .replace(/\bhasta\b/gi, ' ')
    .replace(/\bde\b/gi, ' ')
    .replace(/\ba\b/gi, ' ')
    .replace(/\blas?\b/gi, ' ')
    .replace(/\bel\b/gi, ' ')
    .replace(/\bla\b/gi, ' ')
    .replace(/\bcon\b/gi, ' ')
    .replace(/\bpara\b/gi, ' ')
    .replace(/\bdel?\b/gi, ' ')
    .replace(/\bhs\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!date) date = new Date()

  return {
    name: s || 'Nuevo evento',
    date,
    h1, m1, h2, m2
  }
}

/* ─────────────────────────────────────────
   AUTH
───────────────────────────────────────── */
function toggleAuthMode() {
  authMode = authMode === 'login' ? 'register' : 'login'
  const isReg = authMode === 'register'
  document.getElementById('auth-name').classList.toggle('hidden', !isReg)
  document.getElementById('auth-btn').textContent = isReg ? 'Crear cuenta' : 'Entrar'
  document.getElementById('auth-toggle-text').textContent = isReg ? '¿Ya tenés cuenta?' : '¿No tenés cuenta?'
  document.getElementById('auth-toggle-label').textContent = isReg ? 'Iniciá sesión' : 'Registrate'
  document.getElementById('auth-error').textContent = ''
}

async function handleAuth(e) {
  if (e && e.key && e.key !== 'Enter') return
  if (e && e.preventDefault) e.preventDefault()

  const email    = document.getElementById('auth-email').value.trim()
  const password = document.getElementById('auth-password').value
  const errorEl  = document.getElementById('auth-error')
  const btn      = document.getElementById('auth-btn')

  if (!email || !password) { errorEl.textContent = 'Completá todos los campos.'; return }

  btn.disabled = true
  errorEl.textContent = ''

  try {
    if (authMode === 'login') {
      const { error } = await db.auth.signInWithPassword({ email, password })
      if (error) throw error
      const { data: { session } } = await db.auth.getSession()
      if (session) { currentUser = session.user; await afterLogin() }
    } else {
      const name = document.getElementById('auth-name').value.trim()
      if (!name) throw new Error('Ingresá tu nombre.')
      const { data, error } = await db.auth.signUp({ email, password })
      if (error) throw error
      if (data.session) {
        currentUser = data.user
        await db.from('profiles').insert({ id: data.user.id, display_name: name })
        currentProfile = { display_name: name }
        await loadWeek()
        showApp()
      } else {
        errorEl.style.color = '#10B981'
        errorEl.textContent = 'Revisá tu email para confirmar la cuenta.'
      }
    }
  } catch (err) {
    errorEl.style.color = '#F43F5E'
    errorEl.textContent = err.message
  } finally {
    btn.disabled = false
  }
}

async function afterLogin() {
  const { data } = await db.from('profiles').select('*').eq('id', currentUser.id).single()
  currentProfile = data
  await loadWeek()
  showApp()
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden')
  ;['header','input-bar','cal-area','bottom-nav'].forEach(id =>
    document.getElementById(id).classList.remove('hidden')
  )
  renderWeek()
}

function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden')
  ;['header','input-bar','cal-area','bottom-nav'].forEach(id =>
    document.getElementById(id).classList.add('hidden')
  )
  document.getElementById('chips-bar').classList.remove('show')
}

/* ─────────────────────────────────────────
   DATOS
───────────────────────────────────────── */
async function loadWeek() {
  const dates = getWeekDates(weekOffset)
  const isos  = dates.map(toISO)
  isos.forEach(iso => { eventsCache[iso] = [] })

  const { data } = await db.from('events')
    .select('*')
    .eq('user_id', currentUser.id)
    .in('date', isos)

  if (data) {
    data.forEach(e => {
      if (!eventsCache[e.date]) eventsCache[e.date] = []
      eventsCache[e.date].push(e)
    })
    isos.forEach(iso => eventsCache[iso].sort((a, b) => a.start_time.localeCompare(b.start_time)))
  }
}

async function addEvent(date, title, startTime, endTime) {
  const { data, error } = await db.from('events').insert({
    user_id: currentUser.id,
    title, date,
    start_time: startTime,
    end_time:   endTime,
    done: false
  }).select().single()

  if (error) { console.error(error.message); return null }
  if (!eventsCache[date]) eventsCache[date] = []
  eventsCache[date].push(data)
  eventsCache[date].sort((a, b) => a.start_time.localeCompare(b.start_time))
  return data
}

async function toggleDone(id, date) {
  const ev = (eventsCache[date] || []).find(e => e.id === id)
  if (!ev) return
  const { error } = await db.from('events').update({ done: !ev.done }).eq('id', id)
  if (!error) ev.done = !ev.done
}

async function deleteEvent(id, date) {
  const { error } = await db.from('events').delete().eq('id', id)
  if (!error) eventsCache[date] = (eventsCache[date] || []).filter(e => e.id !== id)
}

/* ─────────────────────────────────────────
   CHIPS (parser en vivo)
───────────────────────────────────────── */
function updateChips(raw) {
  const bar = document.getElementById('chips-bar')
  if (!raw.trim()) { bar.classList.remove('show'); bar.innerHTML = ''; return }

  const p = parseNL(raw)
  bar.innerHTML = ''

  if (p.date && raw.match(/\b(hoy|mañana|manana|lun|mar|mi[eé]|jue|vie|s[aá]b|dom|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|\d{1,2}\s+de\s+[a-z]+)/i)) {
    const dows = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
    const chip = document.createElement('span')
    chip.className = 'chip chip-date'
    chip.textContent = `📅 ${dows[p.date.getDay()]} ${p.date.getDate()}`
    bar.appendChild(chip)
  } else {
    const chip = document.createElement('span')
    chip.className = 'chip chip-warn'
    chip.textContent = '¿cuándo?'
    bar.appendChild(chip)
  }

  const tc = document.createElement('span')
  tc.className = 'chip chip-time'
  tc.textContent = `⏱ ${formatTime(p.h1, p.m1)}–${formatTime(p.h2, p.m2)}`
  bar.appendChild(tc)

  if (p.name) {
    const nc = document.createElement('span')
    nc.className = 'chip chip-name'
    nc.textContent = `✓ ${p.name}`
    bar.appendChild(nc)
  }

  bar.classList.add('show')
}

/* ─────────────────────────────────────────
   RENDER SEMANA
───────────────────────────────────────── */
function renderWeek() {
  const dates = getWeekDates(weekOffset)
  const mon = dates[0], sun = dates[6]

  document.getElementById('week-label').textContent =
    `${mon.getDate()} ${MONTHS_ES[mon.getMonth()].slice(0,3)} — ${sun.getDate()} ${MONTHS_ES[sun.getMonth()].slice(0,3)}`

  const headersEl = document.getElementById('day-headers')
  headersEl.innerHTML = ''
  dates.forEach((d, i) => {
    const hdr = document.createElement('div')
    hdr.className = `day-header${isToday(d) ? ' today' : ''}${isPast(d) ? ' past' : ''}`

    const num = document.createElement('span')
    num.className = 'day-num'
    num.textContent = d.getDate()

    const name = document.createElement('span')
    name.className = 'day-name'
    name.textContent = DAYS_SHORT[i]

    hdr.append(num, name)
    if (isToday(d)) {
      const pip = document.createElement('span')
      pip.className = 'today-pip'
      hdr.appendChild(pip)
    }
    headersEl.appendChild(hdr)
  })

  buildCalGrid(dates)
}

function buildCalGrid(dates) {
  const gutter   = document.getElementById('time-gutter')
  const colsWrap = document.getElementById('day-columns')
  gutter.innerHTML   = ''
  colsWrap.innerHTML = ''

  // Gutter: 24 celdas de 64px
  for (let h = 0; h < 24; h++) {
    const cell = document.createElement('div')
    cell.className = 'time-cell'
    const lbl = document.createElement('span')
    lbl.className = 'time-label'
    lbl.textContent = h === 0 ? '' : `${h}:00`
    cell.appendChild(lbl)
    gutter.appendChild(cell)
  }

  // Columnas de días
  dates.forEach((d) => {
    const iso = toISO(d)
    const col = document.createElement('div')
    col.className = `day-col${isToday(d) ? ' today-col' : ''}`
    col.dataset.iso = iso

    // Líneas de hora
    for (let h = 0; h < 24; h++) {
      const line = document.createElement('div')
      line.className = 'hour-line'
      line.style.top = `${h * SLOT_H}px`
      col.appendChild(line)
    }

    if (isToday(d)) renderNowLine(col)

    const dayEvents = eventsCache[iso] || []
    const conflicts = findConflicts(dayEvents)
    dayEvents.forEach(ev => {
      const el = buildEventEl(ev, iso)
      if (conflicts.has(ev.id)) el.classList.add('conflict')
      col.appendChild(el)
    })

    col.addEventListener('click', (e) => {
      if (e.target.closest('.event-block') || e.target.closest('.ghost-block')) return
      const gridWrap = document.getElementById('grid-wrap')
      const colRect  = col.getBoundingClientRect()
      const y = e.clientY - colRect.top + gridWrap.scrollTop
      showGhost(col, y, iso)
    })

    colsWrap.appendChild(col)
  })

  scrollToNow()
}

function buildEventEl(ev, date) {
  const color = eventColor(ev.title)
  const el = document.createElement('div')
  el.className = `event-block${ev.done ? ' done' : ''}`
  el.style.background    = color + '20'
  el.style.borderLeft    = `2px solid ${color}`
  el.style.color         = color

  const [sh, sm] = ev.start_time.split(':').map(Number)
  const [eh, em] = ev.end_time.split(':').map(Number)
  const top    = toY(sh, sm)
  const height = Math.max(18, toY(eh, em) - top)

  el.style.top    = `${top}px`
  el.style.height = `${height}px`

  const titleEl = document.createElement('span')
  titleEl.className   = 'ev-title'
  titleEl.textContent = ev.title

  const timeEl = document.createElement('span')
  timeEl.className   = 'ev-time'
  timeEl.textContent = `${formatTime(sh, sm)}–${formatTime(eh, em)}`

  const delBtn = document.createElement('button')
  delBtn.className   = 'ev-del'
  delBtn.textContent = '×'
  delBtn.onclick = async (e) => {
    e.stopPropagation()
    await deleteEvent(ev.id, date)
    renderWeek()
  }

  el.appendChild(titleEl)
  if (height > 30) el.appendChild(timeEl)
  el.appendChild(delBtn)

  el.onclick = async () => {
    await toggleDone(ev.id, date)
    el.classList.toggle('done', ev.done)
  }

  return el
}

/* ── Now-line ── */
function renderNowLine(col) {
  const old = col.querySelector('.now-line')
  if (old) old.remove()

  const now = new Date()
  const top = toY(now.getHours(), now.getMinutes())
  if (top < 0 || top > 24 * SLOT_H) return

  const line = document.createElement('div')
  line.className = 'now-line'
  line.style.top = `${top}px`

  const dot = document.createElement('div')
  dot.className = 'now-dot'

  const bar = document.createElement('div')
  bar.className = 'now-bar'

  line.appendChild(dot)
  line.appendChild(bar)
  col.appendChild(line)
}

function scrollToNow() {
  const wrap = document.getElementById('grid-wrap')
  if (!wrap) return
  const now = new Date()
  const top = toY(now.getHours(), now.getMinutes())
  wrap.scrollTop = Math.max(0, top - 2 * SLOT_H)
}

/* ── Ghost block ── */
function showGhost(col, y, iso) {
  document.querySelectorAll('.ghost-block').forEach(g => g.remove())

  const t    = yToTime(y)
  const endH = Math.min(23, t.h + 1)
  const endM = t.m

  const gh = document.createElement('div')
  gh.className    = 'ghost-block'
  gh.style.top    = `${toY(t.h, t.m)}px`
  gh.style.height = `${Math.max(SLOT_H, toY(endH, endM) - toY(t.h, t.m))}px`

  gh.innerHTML = `
    <div class="ghost-times">
      <input class="ghost-time-inp" type="text" value="${formatTime(t.h, t.m)}" placeholder="09:00">
      <span class="ghost-sep">→</span>
      <input class="ghost-time-inp" type="text" value="${formatTime(endH, endM)}" placeholder="10:00">
    </div>
    <input class="ghost-name-inp" type="text" placeholder="nombre del evento… ↵ para guardar" autocomplete="off">
  `

  col.appendChild(gh)
  gh.addEventListener('click', e => e.stopPropagation())

  const nameIn           = gh.querySelector('.ghost-name-inp')
  const [startIn, endIn] = gh.querySelectorAll('.ghost-time-inp')

  setTimeout(() => nameIn.focus(), 30)

  const save = async () => {
    const title     = nameIn.value.trim()
    const startTime = startIn.value.trim() || formatTime(t.h, t.m)
    const endTime   = endIn.value.trim()   || formatTime(endH, endM)
    if (!title) { gh.remove(); return }
    gh.remove()
    const ev = await addEvent(iso, title, startTime, endTime)
    if (ev) renderWeek()
  }

  nameIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') gh.remove()
  })
  startIn.addEventListener('keydown', e => { if (e.key === 'Escape') gh.remove() })
  endIn.addEventListener('keydown',   e => { if (e.key === 'Escape') gh.remove() })
}

/* ─────────────────────────────────────────
   RENDER MES
───────────────────────────────────────── */
async function buildMonth() {
  const md    = getMonthDate()
  const year  = md.getFullYear()
  const month = md.getMonth()

  document.getElementById('month-title').textContent = `${MONTHS_ES[month]} ${year}`

  const dowRow = document.getElementById('month-dow-row')
  dowRow.innerHTML = ''
  DAYS_SHORT.forEach(d => {
    const el = document.createElement('div')
    el.className   = 'month-dow'
    el.textContent = d
    dowRow.appendChild(el)
  })

  const firstDay = new Date(year, month, 1)
  const lastDay  = new Date(year, month + 1, 0)
  const { data } = await db.from('events')
    .select('id,date,title,done')
    .eq('user_id', currentUser.id)
    .gte('date', toISO(firstDay))
    .lte('date', toISO(lastDay))

  const monthMap = {}
  if (data) {
    data.forEach(e => {
      if (!monthMap[e.date]) monthMap[e.date] = []
      monthMap[e.date].push(e)
    })
  }

  const grid = document.getElementById('month-grid')
  grid.innerHTML = ''

  const startDow   = (firstDay.getDay() + 6) % 7
  const totalCells = Math.ceil((startDow + lastDay.getDate()) / 7) * 7

  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(year, month, 1 - startDow + i)
    const iso      = toISO(cellDate)
    const isCurMon = cellDate.getMonth() === month
    const events   = monthMap[iso] || []

    const cell = document.createElement('div')
    cell.className = [
      'month-cell',
      isToday(cellDate) ? 'today' : '',
      !isCurMon ? 'other-month' : ''
    ].filter(Boolean).join(' ')

    const num = document.createElement('div')
    num.className   = 'month-day-num'
    num.textContent = cellDate.getDate()
    cell.appendChild(num)

    if (events.length > 0) {
      const dotsEl = document.createElement('div')
      dotsEl.className = 'month-dots'
      events.slice(0, 6).forEach(ev => {
        const dot = document.createElement('div')
        dot.className        = 'month-dot'
        dot.style.background = eventColor(ev.title)
        dotsEl.appendChild(dot)
      })
      cell.appendChild(dotsEl)

      const barWrap = document.createElement('div')
      barWrap.className = 'month-load-bar'
      const fill = document.createElement('div')
      fill.className = 'month-load-fill'
      const load = Math.min(1, events.length / 8)
      fill.style.width      = `${load * 100}%`
      fill.style.background = load < 0.4 ? '#10B981' : load < 0.7 ? '#F59E0B' : '#F43F5E'
      barWrap.appendChild(fill)
      cell.appendChild(barWrap)
    }

    cell.onclick = () => {
      weekOffset = getWeekOffsetForDate(cellDate)
      switchView('semana')
      loadWeek().then(renderWeek)
    }

    grid.appendChild(cell)
  }
}

/* ─────────────────────────────────────────
   RENDER SUGERENCIAS
───────────────────────────────────────── */
async function buildSuggestions() {
  const sv = document.getElementById('suggestions-view')
  sv.innerHTML = ''

  const dates     = getWeekDates(weekOffset)
  const allEvents = dates.flatMap(d => eventsCache[toISO(d)] || [])
  const done      = allEvents.filter(e => e.done).length
  const score     = calcMomentum(allEvents)

  const summaryCard = document.createElement('div')
  summaryCard.className = 'suggest-card'
  summaryCard.innerHTML = `
    <div class="card-header">
      <span class="card-dot dot-accent"></span>
      <span class="card-title">Resumen semanal</span>
      <span class="card-tag">${momentumLabel(score)}</span>
    </div>
    <div class="card-stats">
      <div class="card-stat">
        <span class="card-stat-val">${done}/${allEvents.length}</span>
        <span class="card-stat-lbl">completadas</span>
      </div>
      <div class="card-stat">
        <span class="card-stat-val">${score}</span>
        <span class="card-stat-lbl">momentum</span>
      </div>
    </div>
    <div class="card-body loading">Analizando tu semana…</div>
  `
  sv.appendChild(summaryCard)

  dates.forEach(d => {
    const iso       = toISO(d)
    const dayEvents = eventsCache[iso] || []
    const conflicts = findConflicts(dayEvents)
    if (!conflicts.size) return

    const pairs = []
    dayEvents.forEach((a, i) => dayEvents.forEach((b, j) => {
      if (i >= j || !conflicts.has(a.id) || !conflicts.has(b.id)) return
      const aS = timeToMinutes(a.start_time), aE = timeToMinutes(a.end_time)
      const bS = timeToMinutes(b.start_time), bE = timeToMinutes(b.end_time)
      if (aS < bE && bS < aE) pairs.push([a, b])
    }))

    if (!pairs.length) return
    const [a, b]   = pairs[0]
    const dowIdx   = (d.getDay() + 6) % 7
    const card     = document.createElement('div')
    card.className = 'suggest-card'
    card.innerHTML = `
      <div class="card-header">
        <span class="card-dot dot-danger"></span>
        <span class="card-title">Conflicto detectado</span>
        <span class="card-tag">${DAYS_ES[dowIdx]}</span>
      </div>
      <div class="card-body">"${a.title}" (${a.start_time}–${a.end_time}) se superpone con "${b.title}" (${b.start_time}–${b.end_time}).</div>
      <div class="card-actions">
        <button class="card-btn secondary">Ignorar</button>
      </div>
    `
    card.querySelector('.secondary').onclick = () => card.remove()
    sv.appendChild(card)
  })

  sv.appendChild(buildAISection(allEvents))

  if (allEvents.length > 0) {
    generateWeeklySummary(allEvents).then(text => {
      const body = summaryCard.querySelector('.card-body')
      if (body) { body.textContent = text; body.classList.remove('loading') }
    }).catch(() => {
      const body = summaryCard.querySelector('.card-body')
      if (body) body.textContent = 'No se pudo generar el resumen.'
    })
  } else {
    const body = summaryCard.querySelector('.card-body')
    if (body) { body.textContent = 'Agregá eventos a tu semana para ver el análisis.'; body.classList.remove('loading') }
  }
}

function buildAISection(events) {
  const section = document.createElement('div')
  section.className = 'suggest-card'
  section.innerHTML = `
    <div class="card-header">
      <span class="card-dot dot-accent2"></span>
      <span class="card-title">Pedile algo a tu semana</span>
    </div>
    <div class="ai-section">
      <div class="ai-input-row">
        <input class="ai-input" type="text"
          placeholder="reorganizame la semana, ¿qué día tengo más espacio?…"
          autocomplete="off">
        <button class="ai-send">✦</button>
      </div>
    </div>
  `

  const input   = section.querySelector('.ai-input')
  const sendBtn = section.querySelector('.ai-send')
  const wrapper = section.querySelector('.ai-section')

  const send = async () => {
    const msg = input.value.trim()
    if (!msg) return

    sendBtn.disabled    = true
    sendBtn.textContent = '…'

    const prev = wrapper.querySelector('.ai-response')
    if (prev) prev.remove()

    const loading = document.createElement('div')
    loading.className   = 'ai-response'
    loading.style.color = '#3F3F46'
    loading.textContent = 'Analizando…'
    wrapper.appendChild(loading)

    try {
      const text = await askAI(msg, events)
      loading.textContent = text
      loading.style.color = ''
    } catch {
      loading.textContent = 'Error al conectar con la IA.'
    }

    sendBtn.disabled    = false
    sendBtn.textContent = '✦'
    input.value = ''
  }

  sendBtn.onclick = send
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send() })

  return section
}

/* ─────────────────────────────────────────
   CLAUDE API
───────────────────────────────────────── */
async function generateWeeklySummary(events) {
  const eventsText = events.map(e =>
    `${e.date} ${e.start_time}-${e.end_time}: ${e.title}${e.done ? ' (completado)' : ''}`
  ).join('\n')

  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `Sos un asistente de productividad. Analizás la agenda semanal del usuario y dás un resumen conciso en español rioplatense (2-3 oraciones). Mencioná: día más cargado, patrón que notás, algo a mejorar. Sé directo, sin saludos ni introducción. Máximo 60 palabras.`,
      messages: [{ role: 'user', content: `Mis eventos esta semana:\n${eventsText}` }]
    })
  })

  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data.content[0].text
}

async function askAI(userMessage, events) {
  const eventsText = events.map(e =>
    `${e.date} ${e.start_time}-${e.end_time}: ${e.title}${e.done ? ' (hecho)' : ''}`
  ).join('\n')

  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: `Sos un asistente de agenda personal. El usuario te pide ayuda con su semana. Respondé en español rioplatense, de forma directa y concisa (máx 80 palabras). Si te piden reorganizar, sugerí cambios concretos con días y horarios. Si hay conflictos, mencioná cómo resolverlos.`,
      messages: [{ role: 'user', content: `Mi agenda:\n${eventsText}\n\nMi consulta: ${userMessage}` }]
    })
  })

  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data.content[0].text
}

/* ─────────────────────────────────────────
   NAVEGACIÓN
───────────────────────────────────────── */
function switchView(view) {
  currentView = view
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'))
  document.getElementById(`nav-${view}`).classList.add('active')
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))
  document.getElementById(`view-${view}`).classList.add('active')
  document.getElementById('week-nav').style.visibility = view === 'semana' ? 'visible' : 'hidden'

  if (view === 'semana')      renderWeek()
  else if (view === 'mes')    buildMonth()
  else                        buildSuggestions()
}

async function prevWeek() {
  weekOffset--
  await loadWeek()
  renderWeek()
}

async function nextWeek() {
  weekOffset++
  await loadWeek()
  renderWeek()
}

function prevMonth() { monthOffset--; buildMonth() }
function nextMonth() { monthOffset++; buildMonth() }

/* ─────────────────────────────────────────
   INIT
───────────────────────────────────────── */
async function init() {
  document.getElementById('auth-btn').onclick = handleAuth
  document.getElementById('auth-password').addEventListener('keydown', handleAuth)

  const mainInput = document.getElementById('nl-input')
  mainInput.addEventListener('input', e => updateChips(e.target.value))
  mainInput.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return
    const raw = mainInput.value.trim()
    if (!raw) return

    const parsed    = parseNL(raw)
    const iso       = toISO(parsed.date)
    const startTime = formatTime(parsed.h1, parsed.m1)
    const endTime   = formatTime(parsed.h2, parsed.m2)

    mainInput.value = ''
    updateChips('')

    const ev = await addEvent(iso, parsed.name || raw, startTime, endTime)
    if (!ev) return

    const weekISOs = getWeekDates(weekOffset).map(toISO)
    if (!weekISOs.includes(iso)) {
      weekOffset = getWeekOffsetForDate(parsed.date)
      await loadWeek()
    }

    if (currentView === 'semana') renderWeek()
    else if (currentView === 'sugerencias') buildSuggestions()
  })

  let logoTaps = 0
  document.getElementById('logo').addEventListener('click', () => {
    logoTaps++
    if (logoTaps === 1) setTimeout(() => { logoTaps = 0 }, 500)
    if (logoTaps >= 2) { logoTaps = 0; if (confirm('¿Cerrar sesión?')) db.auth.signOut() }
  })

  const { data: { session } } = await db.auth.getSession()
  if (session) { currentUser = session.user; await afterLogin() }
  else showAuth()

  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      currentUser = null; currentProfile = null
      eventsCache = {}; weekOffset = 0; monthOffset = 0
      clearInterval(nowLineTimer)
      showAuth()
    }
  })

  nowLineTimer = setInterval(() => {
    if (currentView !== 'semana') return
    const col = document.querySelector('.day-col.today-col')
    if (col) renderNowLine(col)
  }, 60000)

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }
}

document.addEventListener('DOMContentLoaded', init)
