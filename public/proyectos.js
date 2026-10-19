// ── PROYECTOS ────────────────────────────────────────────────
// Tablero de proyectos: inicio con la próxima fecha (cuenta regresiva y
// cuánto falta para cada cosa), números (por cobrar, cobrado, horas),
// pendientes de todos los proyectos y tarjetas; y la vista completa de cada
// proyecto (datos, próximo paso, tareas, cobros, horas, cronograma, alcance,
// notas y resumen semanal). Las "fechas" son filas de `proyectos` con
// estado 'recordatorio' (nombre, fecha_limite, hora, repite).
// Se carga después de app.js y usa sus globales (db, currentUser, t, escH…).

// Estado del modal de proyecto
let projModalId = null;
let pmEstado = 'idea';
let pmArea = null;
let pmColor = null;
let checklistItems = [];
let pmCrono = [];

// Datos del tablero (se cargan juntos en fetchProjData)
let projAll = [];
let projBoardCache = [];
let projRecordatorios = [];
let projNotas = [];
let projTareasAll = [];
let projTareasCount = {};   // { proyecto_id: [hechas, total] }
let projHoras = {};         // { proyecto_id: { total, semana, eventos } }
let projDataLoaded = false;
let phubTimer = null;
let projDetailId = null;
let projDetailTareas = [];
let fechaModalId = null;
let fmRepite = null;

const PROJ_COLORS = ['#6366F1', '#06B6D4', '#10B981', '#F59E0B', '#F43F5E', '#A78BFA', '#3B82F6', '#71717A'];
const CRONO_ESTADOS = ['pendiente', 'ahora', 'listo'];
const MONEDAS = ['USD', 'ARS', 'EUR'];

// ── Utilidades ──
function projColor(p) {
  if (p.color) return p.color;
  const col = PROJ_COLS.find(c => c.id === p.estado);
  return col ? col.color : 'var(--accent)';
}

function projEstadoChip(p) {
  const col = PROJ_COLS.find(c => c.id === p.estado);
  const color = col ? col.color : '#71717A';
  return `<span class="ptab-chip" style="--chip:${color}">${escH(projLabel(p.estado))}</span>`;
}

function projAvance(p) {
  const c = projTareasCount[p.id];
  if (c && c[1] > 0) return { hechas: c[0], total: c[1], pct: Math.round(c[0] / c[1] * 100) };
  return { hechas: 0, total: 0, pct: p.progreso || 0 };
}

function asList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split('\n').map(s => s.trim()).filter(Boolean);
  return [];
}

function fmtMoney(n, moneda) {
  const num = Number(n) || 0;
  return `${moneda || 'USD'} ${num.toLocaleString(appLang === 'en' ? 'en-US' : 'es-AR', { maximumFractionDigits: 0 })}`;
}

function fmtHoras(h) {
  if (!h) return '0 h';
  const r = Math.round(h * 2) / 2;
  return `${String(r).replace('.', appLang === 'en' ? '.' : ',')} h`;
}

function projCobrado(p) {
  return (Array.isArray(p.cobros) ? p.cobros : []).reduce((s, c) => s + (Number(c.monto) || 0), 0);
}

function projPendienteCobro(p) {
  if (!p.monto_total) return 0;
  return Math.max(0, Number(p.monto_total) - projCobrado(p));
}

function lunesDeEstaSemana() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d;
}

// Normaliza para comparar nombres ("Pannetería" ≈ "panneteria")
function normTxt(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Carga de datos ──
async function fetchProjData() {
  if (!currentUser) return;
  const [{ data }, tareas, horas] = await Promise.all([
    db.from('proyectos').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: true }),
    db.from('proyecto_tareas').select('id, proyecto_id, texto, done, done_at, orden, created_at').eq('user_id', currentUser.id)
      .order('orden', { ascending: true }).order('created_at', { ascending: true }),
    db.from('events').select('id, proyecto_id, date, start_time, end_time, recurrente').eq('user_id', currentUser.id)
  ]);
  projAll = data || [];
  projRecordatorios = projAll.filter(p => p.estado === 'recordatorio');
  projNotas = projAll.filter(p => p.estado === 'nota').reverse();
  projBoardCache = projAll.filter(p => !['recordatorio', 'nota'].includes(p.estado));

  projTareasAll = tareas.error ? [] : (tareas.data || []);
  projTareasCount = {};
  projTareasAll.forEach(r => {
    const c = projTareasCount[r.proyecto_id] || (projTareasCount[r.proyecto_id] = [0, 0]);
    c[1]++; if (r.done) c[0]++;
  });

  // Horas: eventos puntuales asociados a un proyecto, con hora de inicio y
  // fin, hasta hoy. Los recurrentes no suman (no sabemos qué semanas se hicieron).
  projHoras = {};
  const hoy = toISO(new Date());
  const lunes = toISO(lunesDeEstaSemana());
  (horas.error ? [] : (horas.data || [])).forEach(ev => {
    if (!ev.proyecto_id || ev.recurrente || !ev.start_time || !ev.end_time || ev.date > hoy) return;
    const [h1, m1] = ev.start_time.slice(0, 5).split(':').map(Number);
    const [h2, m2] = ev.end_time.slice(0, 5).split(':').map(Number);
    const dur = ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60;
    if (!(dur > 0)) return;
    const h = projHoras[ev.proyecto_id] || (projHoras[ev.proyecto_id] = { total: 0, semana: 0, eventos: 0 });
    h.total += dur; h.eventos++;
    if (ev.date >= lunes) h.semana += dur;
  });
  projDataLoaded = true;
}

async function ensureProjData() {
  if (!projDataLoaded) await fetchProjData();
}

async function renderProyectos() {
  if (!currentUser) return;
  await fetchProjData();

  const notasList = document.getElementById('notas-list');
  if (notasList) {
    notasList.innerHTML = projNotas.length === 0
      ? `<div class="slab-empty">${t('sinNotas')}</div>`
      : projNotas.map(n => `
          <div class="slab-item nota-item">
            <button class="slab-del" onclick="event.stopPropagation();deleteProyecto('${n.id}')">×</button>
            <span class="slab-item-name nota-text">${escH(n.nombre)}</span>
          </div>`).join('');
  }

  if (projDetailId && projBoardCache.some(p => p.id === projDetailId)) {
    await openProjDetail(projDetailId);
  } else {
    projDetailId = null;
    renderProjHome();
  }
}

function showProjHome(on) {
  const home = document.getElementById('phub-home');
  const det  = document.getElementById('proj-board');
  if (home) home.hidden = !on;
  if (det)  det.hidden  = on;
  document.getElementById('phub-scroll')?.scrollTo?.(0, 0);
}

// ── Inicio del tablero ──
function renderProjHome() {
  showProjHome(true);
  const hoy = new Date();
  const todayEl = document.getElementById('phub-today');
  if (todayEl) todayEl.textContent = `${DAYS_FULL[hoy.getDay()]} ${hoy.getDate()} · ${MONTHS_FULL[hoy.getMonth()]}`;

  renderProjAgenda();
  if (!phubTimer) phubTimer = setInterval(() => { if (currentView === 'patrones' && !projDetailId) renderProjAgenda(); }, 30000);

  renderProjStats();

  // Pendientes de todos los proyectos activos, en el orden de los proyectos
  const activos = projBoardCache.filter(p => p.estado !== 'hecho');
  const orden = Object.fromEntries(activos.map((p, i) => [p.id, i]));
  const deActivos = projTareasAll.filter(x => x.proyecto_id in orden);
  const pend = deActivos.filter(x => !x.done)
    .sort((a, b) => orden[a.proyecto_id] - orden[b.proyecto_id] || (a.orden || 0) - (b.orden || 0))
    .slice(0, 8);
  const hechas = deActivos.filter(x => x.done).length;
  const pendEl = document.getElementById('phub-pend');
  if (pendEl) {
    document.getElementById('phub-pend-count').textContent = `${hechas} ${t('projDe')} ${deActivos.length}`;
    document.getElementById('phub-pend-bar').style.width = (deActivos.length ? hechas / deActivos.length * 100 : 0) + '%';
    pendEl.innerHTML = pend.length ? pend.map(it => {
      const p = projBoardCache.find(x => x.id === it.proyecto_id);
      return `<div class="pdet-check">
        <button class="lm-checklist-check" onclick="toggleHomeTarea('${it.id}')" aria-label="${escH(t('projTildar'))}"></button>
        <span class="pdet-check-txt">${escH(it.texto)}
          <button class="phub-tag" onclick="openProjDetail('${escH(p.id)}')"><span class="ptab-dot" style="background:${projColor(p)}"></span>${escH(p.nombre)}</button>
        </span>
      </div>`;
    }).join('') : `<div class="lm-checklist-empty">${t('phubSinPendientes')}</div>`;
  }

  const grid = document.getElementById('phub-grid');
  if (grid) grid.innerHTML = activos.length
    ? activos.map(proyectoCardHTML).join('')
    : `<div class="ptab-empty">${t('sinProyectosAun')}</div>`;
  const cnt = document.getElementById('phub-count');
  if (cnt) cnt.textContent = `${activos.length} ${t('phubEnMarcha')}`;
  const hechos = projBoardCache.filter(p => p.estado === 'hecho');
  const doneWrap = document.getElementById('phub-done');
  if (doneWrap) {
    doneWrap.hidden = !hechos.length;
    document.getElementById('phub-done-list').innerHTML = hechos.map(p =>
      `<button class="phub-tag big" onclick="openProjDetail('${escH(p.id)}')"><span class="ptab-dot" style="background:${projColor(p)}"></span>${escH(p.nombre)}</button>`).join('');
  }
}

// Números del inicio: por cobrar (por moneda), cobrado este mes, horas de la semana
function renderProjStats() {
  const el = document.getElementById('phub-stats');
  if (!el) return;
  const porCobrar = {}, cobradoMes = {};
  const mes = toISO(new Date()).slice(0, 7);
  projBoardCache.forEach(p => {
    const m = p.moneda || 'USD';
    const pend = projPendienteCobro(p);
    if (pend > 0) porCobrar[m] = (porCobrar[m] || 0) + pend;
    (Array.isArray(p.cobros) ? p.cobros : []).forEach(c => {
      if ((c.fecha || '').slice(0, 7) === mes) cobradoMes[m] = (cobradoMes[m] || 0) + (Number(c.monto) || 0);
    });
  });
  const horasSemana = Object.values(projHoras).reduce((s, h) => s + h.semana, 0);
  const money = obj => Object.keys(obj).length
    ? Object.entries(obj).map(([m, v]) => `<b>${escH(fmtMoney(v, m))}</b>`).join('<br>')
    : '<b>—</b>';
  el.innerHTML = `
    <div class="phub-stat"><span>${t('phubPorCobrar')}</span>${money(porCobrar)}</div>
    <div class="phub-stat"><span>${t('phubCobradoMes')}</span>${money(cobradoMes)}</div>
    <div class="phub-stat"><span>${t('phubHorasSemana')}</span><b>${escH(fmtHoras(horasSemana))}</b></div>`;
}

async function marcarTarea(it, done) {
  it.done = done;
  it.done_at = done ? new Date().toISOString() : null;
  const { error } = await db.from('proyecto_tareas').update({ done, done_at: it.done_at }).eq('id', it.id).eq('user_id', currentUser.id);
  if (error) { console.error(error); it.done = !done; return false; }
  return true;
}

async function toggleHomeTarea(id) {
  const it = projTareasAll.find(x => x.id === id);
  if (!it) return;
  const c = projTareasCount[it.proyecto_id];
  it.done = true; if (c) c[0]++;
  renderProjHome();
  if (!await marcarTarea(it, true)) { if (c) c[0]--; renderProjHome(); }
}

// ── Fechas: próximas, con repetición semanal ──
function ocurrencia(it) {
  // Devuelve {at, fin, fecha} de la próxima ocurrencia que todavía no terminó el día
  const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
  let fecha = it.fecha;
  const mk = f => ({
    fecha: f,
    at: new Date(`${f}T${it.hora || '00:00'}:00`),
    fin: it.hora ? new Date(`${f}T${it.hora}:00`) : new Date(`${f}T23:59:59`)
  });
  let o = mk(fecha);
  if (it.repite === 'semanal') {
    let guard = 0;
    while (new Date(`${o.fecha}T23:59:59`) < hoy0 && guard++ < 600) {
      const d = new Date(`${o.fecha}T12:00:00`); d.setDate(d.getDate() + 7);
      o = mk(toISO(d));
    }
  }
  return o;
}

function agendaItems() {
  const items = [];
  projRecordatorios.forEach(r => {
    if (r.fecha_limite) items.push({ id: r.id, nombre: r.nombre, fecha: r.fecha_limite, hora: r.hora ? r.hora.slice(0, 5) : null, repite: r.repite || null, tipo: 'rec' });
  });
  projBoardCache.forEach(p => {
    if (p.fecha_limite && p.estado !== 'hecho') items.push({ id: p.id, nombre: `${t('phubEntrega')} · ${p.nombre}`, fecha: p.fecha_limite, hora: null, tipo: 'proj' });
  });
  const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
  return items.map(it => Object.assign(it, ocurrencia(it)))
    .filter(it => new Date(`${it.fecha}T23:59:59`) >= hoy0)
    .sort((a, b) => a.at - b.at);
}

function faltaLabel(it, now) {
  const hoy0 = new Date(now); hoy0.setHours(0, 0, 0, 0);
  const dias = Math.round((new Date(`${it.fecha}T00:00:00`) - hoy0) / 86400000);
  if (it.fin < now) return t('phubPaso');
  if (it.hora && dias <= 0) {
    const min = Math.max(0, Math.round((it.at - now) / 60000));
    return min < 60 ? `${t('phubEn')} ${min} min` : `${t('phubEn')} ${Math.floor(min / 60)} h`;
  }
  if (dias <= 0) return t('hoyTitleDefault');
  if (dias === 1) return t('phubManana');
  return `${t('phubEn')} ${dias} ${t('phubDias')}`;
}

function renderProjAgenda() {
  const list = document.getElementById('phub-agenda');
  if (!list) return;
  const now = new Date();
  const items = agendaItems();
  const next = items.find(it => it.fin >= now);
  const title = document.getElementById('phub-next-title');
  const [D, H, M] = ['phub-cd-d', 'phub-cd-h', 'phub-cd-m'].map(id => document.getElementById(id));
  if (next) {
    title.textContent = next.nombre;
    const min = Math.max(0, Math.floor((next.at - now) / 60000));
    D.textContent = Math.floor(min / 1440); H.textContent = Math.floor(min % 1440 / 60); M.textContent = min % 60;
  } else {
    title.textContent = t('phubSinFechas');
    D.textContent = H.textContent = M.textContent = '0';
  }
  list.innerHTML = items.slice(0, 7).map(it => {
    const past = it.fin < now;
    const mes = it.at.getMonth() !== now.getMonth() ? ' ' + MONTHS_SHORT[it.at.getMonth()].toLowerCase() : '';
    const cuando = `${DAYS[it.at.getDay()]} ${it.at.getDate()}${mes}${it.hora ? ' · ' + it.hora : ''}`;
    const open = it.tipo === 'proj' ? `openProjModal('${escH(it.id)}')` : `openFechaModal('${escH(it.id)}')`;
    return `<button class="phub-ag${past ? ' past' : ''}" onclick="${open}" title="${escH(t('phubEditar'))}">
      <b>${escH(cuando)}</b>
      <span class="phub-ag-name">${escH(it.nombre)}${it.repite === 'semanal' ? ' <i class="phub-rep" title="' + escH(t('fmCadaSemana')) + '">↻</i>' : ''}</span>
      <span class="phub-ag-falta">${escH(faltaLabel(it, now))}</span>
    </button>`;
  }).join('') || `<div class="phub-ag-empty">${t('phubAgregaFecha')}</div>`;
}

// ── Modal de fecha (crear y editar) ──
function openFechaModal(id) {
  fechaModalId = id || null;
  const r = id ? projRecordatorios.find(x => x.id === id) : null;
  document.getElementById('fm-title').textContent = r ? t('fmEditar') : t('fmNueva');
  document.getElementById('fm-nombre').value = r?.nombre || '';
  document.getElementById('fm-fecha').value = r?.fecha_limite || toISO(new Date());
  document.getElementById('fm-hora').value = r?.hora ? r.hora.slice(0, 5) : '';
  fmRepite = r?.repite || null;
  renderFmRepite();
  document.getElementById('fm-del').style.display = r ? 'block' : 'none';
  document.getElementById('fecha-backdrop').style.display = 'block';
  document.getElementById('fecha-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('fm-nombre').focus(), 60);
}
// Compatibilidad con el botón "+ Fecha" anterior
function toggleRecordaForm() { openFechaModal(null); }

function renderFmRepite() {
  document.querySelectorAll('#fm-repite button').forEach(b => b.classList.toggle('active', (b.dataset.v || null) === (fmRepite || null) || (!b.dataset.v && !fmRepite)));
}
function selectFmRepite(v) { fmRepite = v || null; renderFmRepite(); }

function closeFechaModal() {
  document.getElementById('fecha-backdrop').style.display = 'none';
  document.getElementById('fecha-modal').style.display = 'none';
  fechaModalId = null;
}

async function saveFechaModal() {
  const nombre = document.getElementById('fm-nombre').value.trim();
  const fecha = document.getElementById('fm-fecha').value || null;
  if (!nombre) { document.getElementById('fm-nombre').focus(); return; }
  if (!fecha) { document.getElementById('fm-fecha').focus(); return; }
  const payload = {
    nombre, fecha_limite: fecha,
    hora: document.getElementById('fm-hora').value || null,
    repite: fmRepite,
    // Si cambia la fecha u hora, se vuelven a mandar los avisos
    aviso_dia_enviado: null, aviso_previo_enviado: null,
    updated_at: new Date().toISOString()
  };
  if (fechaModalId) {
    await db.from('proyectos').update(payload).eq('id', fechaModalId).eq('user_id', currentUser.id);
  } else {
    await db.from('proyectos').insert({ ...payload, user_id: currentUser.id, estado: 'recordatorio' });
  }
  closeFechaModal();
  renderProyectos();
}

async function deleteFechaModal() {
  if (!fechaModalId) return;
  if (!await askConfirm(t('fmBorrarConfirm'))) return;
  await db.from('proyectos').delete().eq('id', fechaModalId).eq('user_id', currentUser.id);
  closeFechaModal();
  renderProyectos();
}

// ── Tarjeta de proyecto ──
function proyectoCardHTML(p) {
  const color = projColor(p);
  const av = projAvance(p);
  const monto = p.monto_total ? fmtMoney(p.monto_total, p.moneda) : (p.monto || '');
  const sub = [p.cliente, monto].filter(Boolean).map(escH).join(' · ') || (p.descripcion ? escH(p.descripcion) : '');
  const pend = projPendienteCobro(p);
  const horas = projHoras[p.id]?.total || 0;
  let fechaStr = '';
  if (p.fecha_limite) {
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const fl = new Date(p.fecha_limite + 'T00:00:00');
    const diff = Math.ceil((fl - hoy) / 86400000);
    if (diff < 0)        fechaStr = `<span class="pcard-fecha overdue">${t('vencido')}</span>`;
    else if (diff === 0) fechaStr = `<span class="pcard-fecha today">${t('hoyTitleDefault')}</span>`;
    else if (diff <= 3)  fechaStr = `<span class="pcard-fecha soon">${diff}d</span>`;
    else                 fechaStr = `<span class="pcard-fecha">${formatDate(fl, { year: false })}</span>`;
  }
  const extras = [
    pend > 0 ? `<span class="ptab-meta">${escH(t('projFaltaCobrar'))} ${escH(fmtMoney(pend, p.moneda))}</span>` : '',
    horas ? `<span class="ptab-meta">${escH(fmtHoras(horas))}</span>` : ''
  ].filter(Boolean).join('');
  return `
    <button class="ptab-card" style="--pc:${color}" onclick="openProjDetail('${escH(p.id)}')">
      <div class="ptab-card-hd">
        <span class="ptab-card-name">${escH(p.nombre)}</span>
        ${projEstadoChip(p)}
      </div>
      ${sub ? `<div class="ptab-card-sub">${sub}</div>` : ''}
      ${p.proximo_paso ? `<div class="ptab-card-next"><b>${t('projProximo')}:</b> ${escH(p.proximo_paso)}</div>` : ''}
      ${extras ? `<div class="ptab-card-metas">${extras}</div>` : ''}
      <div class="ptab-card-foot">
        <span>${av.total ? `${av.hechas} ${t('projDe')} ${av.total} ${t('projTareasMin')}` : (av.pct ? av.pct + '%' : '')}</span>
        ${fechaStr}
        <span class="ptab-bar"><i style="width:${av.pct}%"></i></span>
      </div>
    </button>`;
}

// ── Vista completa de un proyecto ──
async function openProjDetail(id) {
  await ensureProjData();
  const p = projBoardCache.find(x => x.id === id);
  if (!p) return;
  if (currentView !== 'patrones') await setView('patrones');
  projDetailId = id;
  projDetailTareas = projTareasAll.filter(x => x.proyecto_id === id)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0));
  renderProjDetail();
  showProjHome(false);
}

function closeProjDetail() {
  projDetailId = null;
  renderProjHome();
  renderProyectos();
}

function renderProjDetail() {
  const board = document.getElementById('proj-board');
  const p = projBoardCache.find(x => x.id === projDetailId);
  if (!board || !p) return;
  const color = projColor(p);
  const hechas = projDetailTareas.filter(x => x.done).length;
  const total = projDetailTareas.length;
  const pct = total ? Math.round(hechas / total * 100) : (p.progreso || 0);
  const horas = projHoras[p.id] || { total: 0, semana: 0 };
  const montoTxt = p.monto_total ? fmtMoney(p.monto_total, p.moneda) + (p.monto ? ` · ${p.monto}` : '') : p.monto;
  const entrega = p.fecha_limite ? formatDate(new Date(p.fecha_limite + 'T12:00:00')) : null;
  const facts = [
    [t('projCliente'), p.cliente], [t('projMonto'), montoTxt], [t('projEntrega'), entrega], [t('projPlazo'), p.plazo],
    [t('projHoras'), horas.total ? `${fmtHoras(horas.total)} · ${fmtHoras(horas.semana)} ${t('projEstaSemana')}` : null],
    [t('projContactos'), asList(p.contactos).join(', ')]
  ].filter(f => f[1]);
  const crono = Array.isArray(p.cronograma) ? p.cronograma : [];
  const incluye = asList(p.incluye), excluye = asList(p.excluye), notas = asList(p.notas);
  const list = items => `<ul>${items.map(x => `<li>${escH(x)}</li>`).join('')}</ul>`;

  // Cobros
  const cobros = Array.isArray(p.cobros) ? p.cobros : [];
  const cobrado = projCobrado(p);
  const pend = projPendienteCobro(p);
  const pctCobro = p.monto_total ? Math.min(100, Math.round(cobrado / p.monto_total * 100)) : 0;
  const porHora = horas.total && p.monto_total ? Number(p.monto_total) / horas.total : 0;

  board.innerHTML = `
    <div class="pdet" style="--pc:${color}">
      <button class="pdet-back" onclick="closeProjDetail()">‹ ${t('slabProyectos')}</button>

      <div class="pdet-hd">
        <div class="pdet-hd-main">
          ${p.via ? `<div class="pdet-eyebrow">${escH(p.via)}</div>` : ''}
          <h2 class="pdet-title"><span class="ptab-dot" style="background:${color}"></span>${escH(p.nombre)}</h2>
          ${p.descripcion ? `<p class="pdet-lead">${escH(p.descripcion)}</p>` : ''}
        </div>
        <div class="pdet-actions">
          ${projEstadoChip(p)}
          <button class="pdet-btn" onclick="openResumenSemanal('${escH(p.id)}')">${t('projResumen')}</button>
          ${p.link_tablero ? `<a class="pdet-btn" href="${escH(p.link_tablero)}" target="_blank" rel="noopener">${t('projAbrirTablero')} ↗</a>` : ''}
          <button class="pdet-btn" onclick="openProjModal('${escH(p.id)}')">${t('projEditar')}</button>
        </div>
      </div>

      ${facts.length ? `<div class="pdet-facts">${facts.map(f => `<div class="pdet-fact"><span>${escH(f[0])}</span><b>${escH(f[1])}</b></div>`).join('')}</div>` : ''}

      ${p.proximo_paso ? `<div class="pdet-next"><span>${t('projProximoPaso')}</span><b>${escH(p.proximo_paso)}</b></div>` : ''}

      <div class="pdet-cols">
        <div class="pdet-panel">
          <div class="pdet-panel-hd"><span>${t('projTareas')}</span><span class="ptab-n">${hechas} ${t('projDe')} ${total}</span></div>
          <span class="ptab-bar wide"><i style="width:${pct}%"></i></span>
          <div class="pdet-checks">
            ${total ? projDetailTareas.map(it => `
              <div class="pdet-check${it.done ? ' done' : ''}">
                <button class="lm-checklist-check${it.done ? ' done' : ''}" onclick="toggleDetailTarea('${it.id}')" aria-label="${escH(t('projTildar'))}">${it.done ? '✓' : ''}</button>
                <span class="pdet-check-txt">${escH(it.texto)}</span>
                <button class="lm-checklist-del" onclick="deleteDetailTarea('${it.id}')" aria-label="${escH(t('eliminar'))}">×</button>
              </div>`).join('') : `<div class="lm-checklist-empty">${t('lmChecklistEmpty')}</div>`}
          </div>
          <div class="lm-checklist-add">
            <input class="lm-inp" id="pdet-tarea-inp" type="text" placeholder="${escH(t('lmChecklistAddPh'))}"
                   onkeydown="if(event.key==='Enter'){event.preventDefault();addDetailTarea();}"/>
            <button class="lm-checklist-add-btn" onclick="addDetailTarea()" aria-label="${escH(t('lmChecklistAddPh'))}">+</button>
          </div>
        </div>

        <div class="pdet-panel">
          <div class="pdet-panel-hd"><span>${t('projCobros')}</span>
            <span class="ptab-n">${p.monto_total ? `${escH(fmtMoney(cobrado, p.moneda))} ${t('projDe')} ${escH(fmtMoney(p.monto_total, p.moneda))}` : ''}</span></div>
          ${p.monto_total ? `<span class="ptab-bar wide"><i style="width:${pctCobro}%"></i></span>
            <div class="pdet-cobro-sum">${pend > 0 ? `${t('projFaltaCobrar')} <b>${escH(fmtMoney(pend, p.moneda))}</b>` : `<b>${t('projCobradoTodo')}</b>`}
            ${porHora ? `<span class="ptab-meta">≈ ${escH(fmtMoney(porHora, p.moneda))} ${t('projPorHora')}</span>` : ''}</div>`
            : `<div class="lm-checklist-empty">${t('projSinMonto')}</div>`}
          ${cobros.length ? `<div class="pdet-cobros">${cobros.map((c, i) => `
            <div class="pdet-cobro"><span class="pdet-cobro-f">${escH(c.fecha ? formatDate(new Date(c.fecha + 'T12:00:00'), { year: false }) : '')}</span>
              <span class="pdet-cobro-n">${escH(c.nota || t('projCobro'))}</span><b>${escH(fmtMoney(c.monto, p.moneda))}</b>
              <button class="lm-checklist-del" onclick="deleteCobro(${i})" aria-label="${escH(t('eliminar'))}">×</button></div>`).join('')}</div>` : ''}
          <div class="pdet-cobro-add">
            <input class="lm-inp" id="pdet-cobro-monto" type="number" inputmode="decimal" min="0" placeholder="${escH(t('projMonto'))} (${escH(p.moneda || 'USD')})"/>
            <input class="lm-inp" id="pdet-cobro-nota" type="text" placeholder="${escH(t('projCobroNotaPh'))}"
                   onkeydown="if(event.key==='Enter'){event.preventDefault();addCobro();}"/>
            <button class="lm-checklist-add-btn" onclick="addCobro()" aria-label="${escH(t('projAgregarCobro'))}">+</button>
          </div>
        </div>
      </div>

      ${crono.length ? `
      <div class="pdet-panel">
        <div class="pdet-panel-hd"><span>${t('projCronograma')}</span><span class="ptab-n">${t('projCronoTip')}</span></div>
        <ul class="pdet-crono">
          ${crono.map((c, i) => `
            <li class="${escH(c.estado || 'pendiente')}">
              <button class="pdet-crono-dot" title="${escH(t('projCambiarEstado'))}" onclick="cycleCronoEstado(${i})"></button>
              <div><div class="pdet-crono-when">${escH(c.cuando || '')}</div><div>${escH(c.que || '')}</div></div>
            </li>`).join('')}
        </ul>
      </div>` : ''}

      ${(incluye.length || excluye.length || notas.length) ? `
      <div class="pdet-cols three">
        ${incluye.length ? `<div class="pdet-panel pdet-inc"><div class="pdet-panel-hd"><span>${t('projIncluye')}</span></div>${list(incluye)}</div>` : ''}
        ${excluye.length ? `<div class="pdet-panel pdet-exc"><div class="pdet-panel-hd"><span>${t('projExcluye')}</span></div>${list(excluye)}</div>` : ''}
        ${notas.length ? `<div class="pdet-panel"><div class="pdet-panel-hd"><span>${t('lmNotas')}</span></div>${list(notas)}</div>` : ''}
      </div>` : ''}
    </div>`;
}

function syncDetailCount() {
  projTareasCount[projDetailId] = [projDetailTareas.filter(x => x.done).length, projDetailTareas.length];
  projTareasAll = projTareasAll.filter(x => x.proyecto_id !== projDetailId).concat(projDetailTareas);
}

async function toggleDetailTarea(id) {
  const it = projDetailTareas.find(x => x.id === id);
  if (!it) return;
  const nuevo = !it.done;
  it.done = nuevo; syncDetailCount(); renderProjDetail();
  if (!await marcarTarea(it, nuevo)) { syncDetailCount(); renderProjDetail(); }
}

async function addDetailTarea() {
  const inp = document.getElementById('pdet-tarea-inp');
  const texto = inp?.value.trim();
  if (!texto || !projDetailId) return;
  const data = await insertTarea(projDetailId, texto);
  if (!data) return;
  projDetailTareas.push(data); syncDetailCount(); renderProjDetail();
  document.getElementById('pdet-tarea-inp')?.focus();
}

async function insertTarea(proyectoId, texto) {
  const orden = projTareasAll.filter(x => x.proyecto_id === proyectoId).length;
  const { data, error } = await db.from('proyecto_tareas')
    .insert({ proyecto_id: proyectoId, user_id: currentUser.id, texto, orden })
    .select().single();
  if (error) { console.error(error); return null; }
  return data;
}

async function deleteDetailTarea(id) {
  projDetailTareas = projDetailTareas.filter(x => x.id !== id);
  syncDetailCount(); renderProjDetail();
  const { error } = await db.from('proyecto_tareas').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) console.error(error);
}

async function cycleCronoEstado(i) {
  const p = projBoardCache.find(x => x.id === projDetailId);
  if (!p || !Array.isArray(p.cronograma) || !p.cronograma[i]) return;
  const cur = CRONO_ESTADOS.indexOf(p.cronograma[i].estado || 'pendiente');
  p.cronograma = p.cronograma.map((c, j) => j === i ? { ...c, estado: CRONO_ESTADOS[(cur + 1) % CRONO_ESTADOS.length] } : c);
  renderProjDetail();
  const { error } = await db.from('proyectos').update({ cronograma: p.cronograma, updated_at: new Date().toISOString() })
    .eq('id', p.id).eq('user_id', currentUser.id);
  if (error) console.error(error);
}

// ── Cobros ──
async function saveCobros(p) {
  const { error } = await db.from('proyectos').update({ cobros: p.cobros, updated_at: new Date().toISOString() })
    .eq('id', p.id).eq('user_id', currentUser.id);
  if (error) console.error(error);
  return !error;
}

async function registrarCobro(p, monto, nota, fecha) {
  p.cobros = (Array.isArray(p.cobros) ? p.cobros : []).concat([{ fecha: fecha || toISO(new Date()), monto: Number(monto), nota: nota || null }]);
  return saveCobros(p);
}

async function addCobro() {
  const p = projBoardCache.find(x => x.id === projDetailId);
  const montoEl = document.getElementById('pdet-cobro-monto');
  const monto = parseFloat(String(montoEl?.value || '').replace(',', '.'));
  if (!p || !(monto > 0)) { montoEl?.focus(); return; }
  await registrarCobro(p, monto, document.getElementById('pdet-cobro-nota')?.value.trim());
  renderProjDetail();
}

async function deleteCobro(i) {
  const p = projBoardCache.find(x => x.id === projDetailId);
  if (!p || !Array.isArray(p.cobros)) return;
  if (!await askConfirm(t('projBorrarCobro'))) return;
  p.cobros = p.cobros.filter((_, j) => j !== i);
  renderProjDetail();
  await saveCobros(p);
}

// ── Resumen semanal (texto listo para copiar) ──
function resumenSemanalTexto(p) {
  const lunes = lunesDeEstaSemana();
  const dom = new Date(lunes); dom.setDate(dom.getDate() + 6);
  const rango = `${formatDate(lunes, { year: false })} – ${formatDate(dom, { year: false })}`;
  const tareas = projTareasAll.filter(x => x.proyecto_id === p.id);
  const hechas = tareas.filter(x => x.done && x.done_at && new Date(x.done_at) >= lunes);
  const pend = tareas.filter(x => !x.done);
  const prox = agendaItems().filter(it => it.fin >= new Date() && normTxt(it.nombre).includes(normTxt(p.nombre).split(' ')[0]))[0];
  const horas = projHoras[p.id]?.semana || 0;
  const L = [];
  L.push(`${t('rsTitulo')} · ${p.nombre} (${rango})`);
  L.push('');
  L.push(`${t('rsHecho')}:`);
  L.push(...(hechas.length ? hechas.map(x => `• ${x.texto}`) : [`• ${t('rsNada')}`]));
  L.push('');
  if (p.proximo_paso) { L.push(`${t('projProximoPaso')}: ${p.proximo_paso}`); L.push(''); }
  if (pend.length) {
    L.push(`${t('rsPendiente')}:`);
    L.push(...pend.slice(0, 6).map(x => `• ${x.texto}`));
    L.push('');
  }
  if (prox) L.push(`${t('rsProxFecha')}: ${DAYS_FULL[prox.at.getDay()]} ${prox.at.getDate()}${prox.hora ? ' ' + prox.hora : ''} · ${prox.nombre}`);
  if (horas) L.push(`${t('rsHoras')}: ${fmtHoras(horas)}`);
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function openResumenSemanal(id) {
  const p = projBoardCache.find(x => x.id === id);
  if (!p) return;
  document.getElementById('rs-title').textContent = `${t('rsTitulo')} · ${p.nombre}`;
  document.getElementById('rs-text').value = resumenSemanalTexto(p);
  document.getElementById('rs-copied').textContent = '';
  document.getElementById('rs-backdrop').style.display = 'block';
  document.getElementById('rs-modal').style.display = 'flex';
}
function closeResumenSemanal() {
  document.getElementById('rs-backdrop').style.display = 'none';
  document.getElementById('rs-modal').style.display = 'none';
}
async function copyResumenSemanal() {
  const ta = document.getElementById('rs-text');
  try { await navigator.clipboard.writeText(ta.value); }
  catch { ta.select(); document.execCommand('copy'); }
  document.getElementById('rs-copied').textContent = t('rsCopiado');
}

// ── Notas y borrado genérico ──
async function deleteProyecto(id) {
  if (!await askConfirm('¿Eliminar este elemento?')) return;
  await db.from('proyectos').delete().eq('id', id).eq('user_id', currentUser.id);
  renderProyectos();
}

function toggleNotaForm() {
  const f = document.getElementById('nota-form');
  const open = f.style.display === 'none';
  f.style.display = open ? 'flex' : 'none';
  if (open) setTimeout(() => document.getElementById('nota-texto').focus(), 50);
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

async function moverProyecto(id, estado) {
  await db.from('proyectos')
    .update({ estado, updated_at: new Date().toISOString() })
    .eq('id', id).eq('user_id', currentUser.id);
  renderProyectos();
}

// ── Modal de proyecto (simple: lo esencial arriba, el resto en "Más detalles") ──
const PROJ_TEXT_FIELDS = ['cliente', 'via', 'monto', 'plazo', 'proximo_paso', 'link_tablero'];
const PROJ_LIST_FIELDS = ['incluye', 'excluye', 'contactos'];

async function openProjModal(id, estadoDefault) {
  projModalId = id || null;
  pmEstado = estadoDefault || 'en_curso';
  pmArea = 'trabajo';
  pmColor = null;
  let data = {};
  if (id) {
    const res = await db.from('proyectos').select('*').eq('id', id).single();
    if (!res.data) return;
    data = res.data;
    pmEstado = data.estado || 'idea';
    pmArea = data.area || null;
    pmColor = data.color || null;
  }
  document.getElementById('lm-title').textContent = id ? t('lmEditProject') : t('lmNewProject');
  document.getElementById('lm-del').style.display = id ? 'block' : 'none';
  document.getElementById('lm-nombre').value = data.nombre || '';
  document.getElementById('lm-desc').value = data.descripcion || '';
  document.getElementById('lm-fecha').value = data.fecha_limite || '';
  document.getElementById('lm-notas').value = data.notas || '';
  document.getElementById('lm-monto_total').value = data.monto_total ?? '';
  document.getElementById('lm-moneda').value = data.moneda || 'USD';
  PROJ_TEXT_FIELDS.forEach(f => { const el = document.getElementById('lm-' + f); if (el) el.value = data[f] || ''; });
  PROJ_LIST_FIELDS.forEach(f => { const el = document.getElementById('lm-' + f); if (el) el.value = asList(data[f]).join('\n'); });
  pmCrono = (Array.isArray(data.cronograma) ? data.cronograma : []).map(c => ({ ...c }));
  renderPmCrono();
  // "Más detalles" abierto solo si ya hay algo cargado ahí
  const tieneDetalles = !!(data.descripcion || data.via || data.monto || data.plazo || data.link_tablero || data.notas ||
    asList(data.incluye).length || asList(data.excluye).length || asList(data.contactos).length || pmCrono.length);
  document.getElementById('lm-more').open = tieneDetalles;

  renderPmEstados();
  renderPmAreas();
  renderPmColors();

  // El checklist necesita un proyecto ya guardado (proyecto_id real)
  const checklistWrap = document.getElementById('lm-checklist-wrap');
  if (checklistWrap) checklistWrap.style.display = id ? 'flex' : 'none';
  if (id) await loadChecklist(id); else checklistItems = [];

  document.getElementById('lead-backdrop').style.display = 'block';
  document.getElementById('lead-modal').style.display    = 'flex';
  setTimeout(() => document.getElementById('lm-nombre').focus(), 60);
}

function renderPmEstados() {
  document.getElementById('lm-estados').innerHTML = PROJ_COLS.map(col => `
    <button class="lm-estado-btn${pmEstado === col.id ? ' active' : ''}"
            style="${pmEstado === col.id ? `background:${col.color};border-color:${col.color};color:#fff` : ''}"
            onclick="selectPmEstado('${col.id}')">
      ${projLabel(col.id)}
    </button>
  `).join('');
}
function selectPmEstado(id) { pmEstado = id; renderPmEstados(); }

function renderPmAreas() {
  document.getElementById('lm-areas').innerHTML = Object.entries(AREAS).map(([key, a]) => `
    <button class="lm-area-btn${pmArea === key ? ' active' : ''}"
            style="${pmArea === key ? `border-color:${a.color};color:${a.color}` : ''}"
            onclick="selectPmArea('${key}')">
      <span class="lm-area-dot" style="background:${a.color}"></span>
      ${areaLabel(key)}
    </button>
  `).join('');
}
function selectPmArea(key) { pmArea = pmArea === key ? null : key; renderPmAreas(); }

function renderPmColors() {
  const el = document.getElementById('lm-colors');
  if (!el) return;
  el.innerHTML = PROJ_COLORS.map(c => `
    <button class="lm-color${pmColor === c ? ' active' : ''}" style="background:${c}" onclick="selectPmColor('${c}')" aria-label="${c}"></button>`).join('');
}
function selectPmColor(c) { pmColor = pmColor === c ? null : c; renderPmColors(); }

// Cronograma como filas (cuándo · qué · estado) en vez de texto con "|"
function renderPmCrono() {
  const el = document.getElementById('lm-crono-rows');
  if (!el) return;
  el.innerHTML = pmCrono.map((c, i) => `
    <div class="lm-crono-row">
      <input class="lm-inp lm-crono-when" type="text" value="${escH(c.cuando || '')}" placeholder="${escH(t('lmCronoCuando'))}" oninput="pmCrono[${i}].cuando=this.value"/>
      <input class="lm-inp" type="text" value="${escH(c.que || '')}" placeholder="${escH(t('lmCronoQue'))}" oninput="pmCrono[${i}].que=this.value"/>
      <button class="lm-crono-est ${escH(c.estado || 'pendiente')}" onclick="cyclePmCrono(${i})" title="${escH(t('projCambiarEstado'))}">${escH(t('crono_' + (c.estado || 'pendiente')))}</button>
      <button class="lm-checklist-del" onclick="removePmCrono(${i})" aria-label="${escH(t('eliminar'))}">×</button>
    </div>`).join('');
}
function addPmCrono() {
  pmCrono.push({ cuando: '', que: '', estado: 'pendiente' });
  renderPmCrono();
  document.querySelector('#lm-crono-rows .lm-crono-row:last-child .lm-crono-when')?.focus();
}
function cyclePmCrono(i) {
  const cur = CRONO_ESTADOS.indexOf(pmCrono[i].estado || 'pendiente');
  pmCrono[i].estado = CRONO_ESTADOS[(cur + 1) % CRONO_ESTADOS.length];
  renderPmCrono();
}
function removePmCrono(i) { pmCrono.splice(i, 1); renderPmCrono(); }

function closeProjModal() {
  document.getElementById('lead-backdrop').style.display = 'none';
  document.getElementById('lead-modal').style.display    = 'none';
  projModalId = null;
  checklistItems = [];
}

// Checklist dentro del modal
async function loadChecklist(proyectoId) {
  const { data, error } = await db.from('proyecto_tareas')
    .select('*').eq('proyecto_id', proyectoId).eq('user_id', currentUser.id)
    .order('orden', { ascending: true }).order('created_at', { ascending: true });
  if (error) { console.error(error); checklistItems = []; } else { checklistItems = data || []; }
  renderChecklist();
}

function renderChecklist() {
  const el = document.getElementById('lm-checklist-list');
  if (!el) return;
  el.innerHTML = checklistItems.length === 0
    ? `<div class="lm-checklist-empty">${t('lmChecklistEmpty')}</div>`
    : checklistItems.map(item => `
        <div class="lm-checklist-item">
          <button class="lm-checklist-check${item.done ? ' done' : ''}" onclick="toggleChecklistItem('${item.id}')">
            ${item.done ? '✓' : ''}
          </button>
          <span class="lm-checklist-text${item.done ? ' done' : ''}">${escH(item.texto)}</span>
          <button class="lm-checklist-del" onclick="deleteChecklistItem('${item.id}')">×</button>
        </div>
      `).join('');
}

async function addChecklistItem() {
  const inp = document.getElementById('lm-checklist-inp');
  const texto = inp.value.trim();
  if (!texto || !projModalId) return;
  inp.value = '';
  const data = await insertTarea(projModalId, texto);
  if (!data) return;
  checklistItems.push(data);
  projTareasAll.push(data);
  renderChecklist();
  inp.focus();
}

async function toggleChecklistItem(id) {
  const item = checklistItems.find(i => i.id === id);
  if (!item) return;
  const nuevo = !item.done;
  item.done = nuevo;
  renderChecklist();
  if (!await marcarTarea(item, nuevo)) renderChecklist();
}

async function deleteChecklistItem(id) {
  checklistItems = checklistItems.filter(i => i.id !== id);
  renderChecklist();
  const { error } = await db.from('proyecto_tareas').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) console.error(error);
}

async function saveProjModal() {
  const nombre = document.getElementById('lm-nombre').value.trim();
  if (!nombre) { document.getElementById('lm-nombre').focus(); return; }
  const montoRaw = String(document.getElementById('lm-monto_total').value || '').replace(',', '.');
  const montoTotal = montoRaw ? parseFloat(montoRaw) : null;
  const fecha = document.getElementById('lm-fecha').value || null;

  const payload = {
    nombre,
    descripcion:  document.getElementById('lm-desc').value.trim() || null,
    fecha_limite: fecha,
    area:         pmArea || null,
    notas:        document.getElementById('lm-notas').value.trim() || null,
    estado:       pmEstado,
    color:        pmColor || null,
    monto_total:  montoTotal > 0 ? montoTotal : null,
    moneda:       document.getElementById('lm-moneda').value || 'USD',
    cronograma:   pmCrono.filter(c => (c.cuando || '').trim() || (c.que || '').trim())
                         .map(c => ({ cuando: (c.cuando || '').trim(), que: (c.que || '').trim(), estado: c.estado || 'pendiente' })),
    updated_at:   new Date().toISOString()
  };
  PROJ_TEXT_FIELDS.forEach(f => { const el = document.getElementById('lm-' + f); if (el) payload[f] = el.value.trim() || null; });
  PROJ_LIST_FIELDS.forEach(f => { const el = document.getElementById('lm-' + f); if (el) payload[f] = asList(el.value); });

  if (projModalId) {
    const prev = projBoardCache.find(p => p.id === projModalId);
    if (prev && prev.fecha_limite !== fecha) { payload.aviso_dia_enviado = null; payload.aviso_previo_enviado = null; }
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
  if (projDetailId === projModalId) projDetailId = null;
  closeProjModal();
  renderProyectos();
}

// ── Proyecto de un evento (para sumar horas) ──
function renderPanelProyecto(ev) {
  const wrap = document.getElementById('panel-proj-pills');
  const val = document.getElementById('panel-row-proj-text');
  const dot = document.getElementById('panel-row-proj-dot');
  if (!wrap) return;
  const activos = projBoardCache.filter(p => p.estado !== 'hecho' || p.id === ev.proyecto_id);
  const actual = projBoardCache.find(p => p.id === ev.proyecto_id);
  if (val) val.textContent = actual ? actual.nombre : t('panelSinProyecto');
  if (dot) dot.style.background = actual ? projColor(actual) : 'transparent';
  wrap.innerHTML = `<button class="area-pill${!ev.proyecto_id ? ' selected' : ''}" style="--area-color:var(--text-muted)" onclick="selectPanelProyecto(null)">${t('panelSinProyecto')}</button>` +
    activos.map(p => `<button class="area-pill${ev.proyecto_id === p.id ? ' selected' : ''}" style="--area-color:${projColor(p)}" onclick="selectPanelProyecto('${escH(p.id)}')">${escH(p.nombre)}</button>`).join('');
}

async function setupPanelProyecto(ev) {
  await ensureProjData();
  if (panelEvent && panelEvent.id === ev.id) renderPanelProyecto(ev);
}

async function selectPanelProyecto(id) {
  if (!panelEvent) return;
  panelEvent.proyecto_id = id;
  renderPanelProyecto(panelEvent);
  const { error } = await db.from('events').update({ proyecto_id: id }).eq('id', panelEvent.id);
  if (error) console.error(error);
  projDataLoaded = false; // recalcular horas la próxima vez
}

// ── Resumen de la mañana: próxima fecha y pendientes de proyectos ──
async function fillMorningProjects() {
  const el = document.getElementById('morning-proj');
  if (!el) return;
  try { await fetchProjData(); } catch { return; }
  const now = new Date();
  const next = agendaItems().find(it => it.fin >= now);
  const activos = projBoardCache.filter(p => p.estado !== 'hecho');
  const ids = new Set(activos.map(p => p.id));
  const pend = projTareasAll.filter(x => !x.done && ids.has(x.proyecto_id)).slice(0, 3);
  if (!next && !pend.length) { el.style.display = 'none'; return; }
  el.innerHTML = `
    <div class="morning-section-label">${t('mbProyectos')}</div>
    ${next ? `<div class="mb-proj-next"><b>${escH(next.nombre)}</b><span>${escH(faltaLabel(next, now))}${next.hora ? ' · ' + escH(next.hora) : ''}</span></div>` : ''}
    ${pend.map(x => {
      const p = projBoardCache.find(pp => pp.id === x.proyecto_id);
      return `<div class="mb-proj-task"><span class="ptab-dot" style="background:${projColor(p)}"></span>${escH(x.texto)}<small>${escH(p.nombre)}</small></div>`;
    }).join('')}`;
  el.style.display = 'block';
}

// ── Foquito: contexto y acciones sobre proyectos ──
async function buildFoqProjText() {
  try { await ensureProjData(); } catch { return ''; }
  const activos = projBoardCache.filter(p => p.estado !== 'hecho');
  const lines = activos.map(p => {
    const pend = projTareasAll.filter(x => x.proyecto_id === p.id && !x.done).map(x => x.texto);
    const hechas = projTareasAll.filter(x => x.proyecto_id === p.id && x.done).length;
    const cobro = p.monto_total ? ` | cobrado ${fmtMoney(projCobrado(p), p.moneda)} de ${fmtMoney(p.monto_total, p.moneda)}` : '';
    const horas = projHoras[p.id]?.total ? ` | ${fmtHoras(projHoras[p.id].total)} trabajadas` : '';
    return `- ${p.nombre} [${projLabel(p.estado)}]${p.cliente ? ' cliente: ' + p.cliente : ''}${p.fecha_limite ? ' | entrega ' + p.fecha_limite : ''}${cobro}${horas}` +
      `${p.proximo_paso ? '\n  próximo paso: ' + p.proximo_paso : ''}` +
      `\n  tareas pendientes (${pend.length}, ${hechas} hechas): ${pend.length ? pend.join('; ') : 'ninguna'}`;
  });
  const now = new Date();
  const fechas = agendaItems().filter(it => it.fin >= now && it.tipo === 'rec').slice(0, 10)
    .map(it => `- ${it.nombre}: ${it.fecha}${it.hora ? ' ' + it.hora : ''}${it.repite === 'semanal' ? ' (se repite cada semana)' : ''}`);
  return `Proyectos activos:\n${lines.join('\n') || 'ninguno'}\n\nPróximas fechas:\n${fechas.join('\n') || 'ninguna'}`;
}

const FOQ_PROJ_ACCIONES = `
ACCIONES SOBRE PROYECTOS (usá los nombres tal cual aparecen en "Proyectos activos" y "Próximas fechas"):
8. Dice que terminó/hizo una tarea de un proyecto:
{"accion":"tarea_hecha","proyecto":"nombre del proyecto","tarea":"texto de la tarea como figura","respuesta":"festejo breve"}
9. Pide agregar una tarea a un proyecto:
{"accion":"agregar_tarea","proyecto":"nombre del proyecto","tarea":"texto corto de la tarea","respuesta":"confirmación breve"}
10. Pide anotar una fecha importante, reunión, entrega o seguimiento (no una actividad del día a día):
{"accion":"crear_fecha","nombre":"texto corto","fecha":"YYYY-MM-DD o null","dia_semana":"0-6 o null","hora":"HH:MM o null","repite":"semanal o null","respuesta":"confirmación breve"}
   Mismas reglas de días que la forma 1: si nombra un día de la semana, completá dia_semana y dejá fecha en null.
11. Pide mover o cambiar una fecha de "Próximas fechas":
{"accion":"editar_fecha","nombre":"nombre tal cual figura","nueva_fecha":"YYYY-MM-DD o null","nuevo_dia_semana":"0-6 o null","nueva_hora":"HH:MM o null","respuesta":"confirmación breve"}
12. Pide borrar una fecha de "Próximas fechas":
{"accion":"borrar_fecha","nombre":"nombre tal cual figura","respuesta":"confirmación breve"}
13. Dice que le pagaron / cobró plata de un proyecto:
{"accion":"registrar_cobro","proyecto":"nombre del proyecto","monto":número sin símbolos,"nota":"texto corto o null","respuesta":"confirmación breve"}
14. Pide cambiar el estado o el próximo paso de un proyecto:
{"accion":"actualizar_proyecto","proyecto":"nombre del proyecto","estado":"idea|en_curso|bloqueado|hecho o null","proximo_paso":"texto o null","respuesta":"confirmación breve"}
- Si pregunta qué le falta, cómo viene un proyecto o cuánto le deben: usá la forma 7 (conversar) con los datos de arriba. No inventes tareas ni montos.
- En la forma 1 y 2 podés sumar "proyecto":"nombre del proyecto" a una actividad si es trabajo de ese proyecto (ej. "trabajé en Contartese de 9 a 12"): así suma horas. Si dice que YA trabajó, creala con fecha de hoy y esas horas.
- Si el nombre de proyecto, tarea o fecha es ambiguo o no está arriba, usá preguntar.`;

function findProjByName(nombre) {
  const n = normTxt(nombre);
  if (!n) return null;
  const cands = projBoardCache.filter(p => normTxt(p.nombre) === n);
  if (cands.length) return cands[0];
  const parc = projBoardCache.filter(p => normTxt(p.nombre).includes(n) || n.includes(normTxt(p.nombre)) ||
    normTxt(p.nombre).split(' ').some(w => w.length > 3 && n.split(' ').includes(w)));
  return parc.length === 1 ? parc[0] : null;
}

function findTareaByText(p, texto, soloPendientes) {
  const n = normTxt(texto);
  const ts = projTareasAll.filter(x => x.proyecto_id === p.id && (!soloPendientes || !x.done));
  const exact = ts.filter(x => normTxt(x.texto) === n);
  if (exact.length === 1) return exact[0];
  const parc = ts.filter(x => normTxt(x.texto).includes(n) || n.includes(normTxt(x.texto)));
  return parc.length === 1 ? parc[0] : null;
}

function findFechaByName(nombre) {
  const n = normTxt(nombre);
  const exact = projRecordatorios.filter(r => normTxt(r.nombre) === n);
  const lista = exact.length ? exact : projRecordatorios.filter(r => normTxt(r.nombre).includes(n) || n.includes(normTxt(r.nombre)));
  if (lista.length <= 1) return lista[0] || null;
  // Si hay varias con el mismo nombre (ej. dos seguimientos), la más próxima
  const hoy = toISO(new Date());
  return lista.filter(r => (r.fecha_limite || '') >= hoy).sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite))[0] || lista[0];
}

function refrescarSiProyectos() {
  if (currentView === 'patrones') renderProyectos(); else projDataLoaded = false;
}

// Devuelve true si la acción era de proyectos (y ya respondió)
async function handleFoqProjectAction(result, text) {
  const a = result?.accion;
  if (!['tarea_hecha', 'agregar_tarea', 'crear_fecha', 'editar_fecha', 'borrar_fecha', 'registrar_cobro', 'actualizar_proyecto'].includes(a)) return false;
  await ensureProjData();
  let respuesta = null;
  const noProj = () => `No encontré el proyecto "${result.proyecto || ''}". ¿Cuál de estos es? ${projBoardCache.filter(p => p.estado !== 'hecho').map(p => p.nombre).join(', ')}`;

  if (a === 'tarea_hecha') {
    const p = findProjByName(result.proyecto);
    const it = p && findTareaByText(p, result.tarea, true);
    if (!p) respuesta = noProj();
    else if (!it) respuesta = `No encontré esa tarea pendiente en ${p.nombre}. ¿Cómo figura?`;
    else { await marcarTarea(it, true); respuesta = result.respuesta || `Tildada: "${it.texto}".`; }
  } else if (a === 'agregar_tarea') {
    const p = findProjByName(result.proyecto);
    if (!p) respuesta = noProj();
    else if (!result.tarea) respuesta = '¿Qué tarea agrego?';
    else { const d = await insertTarea(p.id, String(result.tarea).trim()); respuesta = d ? (result.respuesta || `Agregada a ${p.nombre}.`) : 'No pude guardarla, probá de nuevo.'; }
  } else if (a === 'crear_fecha') {
    const ds = Number.isInteger(result.dia_semana) ? result.dia_semana : null;
    const fecha = ds !== null ? nextDateForWeekday(ds) : result.fecha;
    if (!result.nombre || !fecha) respuesta = '¿Qué día es?';
    else {
      await db.from('proyectos').insert({ user_id: currentUser.id, estado: 'recordatorio', nombre: result.nombre, fecha_limite: fecha,
        hora: result.hora || null, repite: result.repite === 'semanal' ? 'semanal' : null, updated_at: new Date().toISOString() });
      respuesta = result.respuesta || `Anotada: ${result.nombre}.`;
    }
  } else if (a === 'editar_fecha') {
    const r = findFechaByName(result.nombre);
    if (!r) respuesta = 'No encontré esa fecha. ¿Cómo se llama?';
    else {
      const patch = { aviso_dia_enviado: null, aviso_previo_enviado: null, updated_at: new Date().toISOString() };
      const ds = Number.isInteger(result.nuevo_dia_semana) ? result.nuevo_dia_semana : null;
      if (ds !== null) patch.fecha_limite = nextDateForWeekday(ds);
      else if (result.nueva_fecha) patch.fecha_limite = result.nueva_fecha;
      if (result.nueva_hora) patch.hora = result.nueva_hora;
      await db.from('proyectos').update(patch).eq('id', r.id).eq('user_id', currentUser.id);
      respuesta = result.respuesta || `Listo, moví "${r.nombre}".`;
    }
  } else if (a === 'borrar_fecha') {
    const r = findFechaByName(result.nombre);
    if (!r) respuesta = 'No encontré esa fecha. ¿Cómo se llama?';
    else { await db.from('proyectos').delete().eq('id', r.id).eq('user_id', currentUser.id); respuesta = result.respuesta || `Saqué "${r.nombre}".`; }
  } else if (a === 'registrar_cobro') {
    const p = findProjByName(result.proyecto);
    const monto = Number(result.monto);
    if (!p) respuesta = noProj();
    else if (!(monto > 0)) respuesta = '¿Cuánto te pagaron?';
    else {
      await registrarCobro(p, monto, result.nota || null);
      const pend = projPendienteCobro(p);
      respuesta = (result.respuesta || `Anotado el cobro de ${fmtMoney(monto, p.moneda)} en ${p.nombre}.`) +
        (p.monto_total ? (pend > 0 ? ` Falta cobrar ${fmtMoney(pend, p.moneda)}.` : ' Ya está todo cobrado.') : '');
    }
  } else if (a === 'actualizar_proyecto') {
    const p = findProjByName(result.proyecto);
    if (!p) respuesta = noProj();
    else {
      const patch = { updated_at: new Date().toISOString() };
      if (['idea', 'en_curso', 'bloqueado', 'hecho'].includes(result.estado)) patch.estado = result.estado;
      if (result.proximo_paso) patch.proximo_paso = result.proximo_paso;
      await db.from('proyectos').update(patch).eq('id', p.id).eq('user_id', currentUser.id);
      respuesta = result.respuesta || `Actualicé ${p.nombre}.`;
    }
  }

  refrescarSiProyectos();
  addFoqBubble(respuesta, 'foq');
  pushFoqHistory(text, respuesta);
  return true;
}

// Si Foquito creó una actividad "de" un proyecto, la asocia para sumar horas
function foqProyectoId(nombre) {
  if (!nombre) return null;
  return findProjByName(nombre)?.id || null;
}
