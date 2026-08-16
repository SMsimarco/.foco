#!/usr/bin/env node
// Revisa eventos que arrancan pronto (5-20min) y manda push a los suscriptos.
// Corre desde GitHub Actions cada 5 minutos (.github/workflows/reminders.yml).
// Usa la secret key de Supabase (bypassea RLS) porque revisa eventos de todos los usuarios.

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

async function main() {
  const nowArg = new Date(Date.now() - ARG_OFFSET_MS);
  const today = nowArg.toISOString().slice(0, 10);
  const weekday = nowArg.getUTCDay();

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
    const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', ev.user_id);

    const payload = JSON.stringify({
      title: 'foco. — en 15 minutos',
      body: ev.title,
      url: '/'
    });

    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        console.error(`Push falló (${err.statusCode}) para suscripción ${sub.id}`);
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.from('push_subscriptions').delete().eq('id', sub.id);
        }
      }
    }

    await db.from('events').update({ reminder_sent_date: today }).eq('id', ev.id);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
