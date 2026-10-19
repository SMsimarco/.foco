#!/usr/bin/env node
// Manda push a los suscriptos:
//  1. Eventos que arrancan pronto (5-20 min).
//  2. "Próximas fechas" y entregas de proyectos: aviso el día anterior (desde
//     las 20 h) y, si la fecha tiene hora, ~30 min antes. Las fechas que se
//     repiten cada semana avisan en cada ocurrencia.
// Corre desde GitHub Actions cada 5 minutos (.github/workflows/reminders.yml).
// Usa la secret key de Supabase (bypassea RLS) porque revisa datos de todos los usuarios.

const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Faltan variables de entorno (SUPABASE_URL, SUPABASE_SECRET_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)');
  process.exit(1);
}

webpush.setVapidDetails('mailto:ssimonmarconi@gmail.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

// Argentina es UTC-3 fijo (sin horario de verano desde 2009) — restar el offset
// y leer los campos UTC da directamente la hora de pared de Buenos Aires.
const ARG_OFFSET_MS = 3 * 60 * 60 * 1000;

async function sendPush(userId, payload) {
  const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', userId);
  for (const sub of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    } catch (err) {
      console.error(`Push falló (${err.statusCode}) para suscripción ${sub.id}`);
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }
}

function addDaysISO(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function avisarEventos(today, weekday) {
  const [{ data: normal, error: e1 }, { data: recurrentes, error: e2 }] = await Promise.all([
    db.from('events').select('*')
      .eq('date', today).eq('done', false)
      .or(`reminder_sent_date.is.null,reminder_sent_date.neq.${today}`),
    db.from('events').select('*')
      .eq('recurrente', true).eq('done', false)
      .or(`dia_semana.is.null,dia_semana.eq.${weekday}`)
      .or(`reminder_sent_date.is.null,reminder_sent_date.neq.${today}`)
  ]);

  if (e1) throw e1;
  if (e2) throw e2;

  const vistos = new Set();
  const candidatos = [...(normal || []), ...(recurrentes || [])].filter(ev => {
    if (vistos.has(ev.id) || !ev.start_time) return false;
    vistos.add(ev.id);
    return true;
  });

  const ahora = Date.now();
  const eventosParaAvisar = candidatos.filter(ev => {
    const inicioMs = new Date(`${today}T${ev.start_time.slice(0, 5)}:00-03:00`).getTime();
    const minutosFaltan = (inicioMs - ahora) / 60000;
    return minutosFaltan >= 5 && minutosFaltan <= 20;
  });

  console.log(`${eventosParaAvisar.length} evento(s) para recordar`);

  for (const ev of eventosParaAvisar) {
    await sendPush(ev.user_id, { title: 'foco. — en 15 minutos', body: ev.title, url: '/' });
    await db.from('events').update({ reminder_sent_date: today }).eq('id', ev.id);
  }
}

async function avisarFechas(today, horaArg) {
  const { data: filas, error } = await db.from('proyectos')
    .select('id, user_id, nombre, estado, fecha_limite, hora, repite, aviso_dia_enviado, aviso_previo_enviado')
    .not('fecha_limite', 'is', null)
    .not('estado', 'in', '("nota","hecho")');
  if (error) throw error;

  const manana = addDaysISO(today, 1);
  const ahora = Date.now();
  let enviados = 0;

  for (const f of filas || []) {
    // Próxima ocurrencia que no pasó (las semanales avanzan de a 7 días)
    let fecha = f.fecha_limite;
    if (f.repite === 'semanal') {
      let guard = 0;
      while (fecha < today && guard++ < 600) fecha = addDaysISO(fecha, 7);
    }
    if (fecha < today) continue;
    const hora = f.hora ? f.hora.slice(0, 5) : null;
    const esEntrega = f.estado !== 'recordatorio';
    const nombre = esEntrega ? `Entrega: ${f.nombre}` : f.nombre;
    const patch = {};

    // El día anterior, desde las 20 h
    if (fecha === manana && horaArg >= 20 && f.aviso_dia_enviado !== fecha) {
      await sendPush(f.user_id, { title: 'foco. — mañana', body: `${nombre}${hora ? ' · ' + hora : ''}`, url: '/' });
      patch.aviso_dia_enviado = fecha;
    }

    // ~30 min antes (ventana de 35 min porque el job corre cada 5)
    if (hora && fecha === today && f.aviso_previo_enviado !== fecha) {
      const min = (new Date(`${fecha}T${hora}:00-03:00`).getTime() - ahora) / 60000;
      if (min > 0 && min <= 35) {
        await sendPush(f.user_id, { title: `foco. — en ${Math.max(5, Math.round(min / 5) * 5)} minutos`, body: nombre, url: '/' });
        patch.aviso_previo_enviado = fecha;
      }
    }

    if (Object.keys(patch).length) {
      enviados++;
      await db.from('proyectos').update(patch).eq('id', f.id);
    }
  }
  console.log(`${enviados} fecha(s) avisada(s)`);
}

async function main() {
  const nowArg = new Date(Date.now() - ARG_OFFSET_MS);
  const today = nowArg.toISOString().slice(0, 10);
  const weekday = nowArg.getUTCDay();
  const horaArg = nowArg.getUTCHours();

  await avisarEventos(today, weekday);
  // Si la migración de fechas todavía no corrió, que no frene los avisos de eventos
  try { await avisarFechas(today, horaArg); }
  catch (err) { console.error('Avisos de fechas:', err.message || err); }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
