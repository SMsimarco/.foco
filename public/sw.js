const CACHE = 'foco-v41';
const STATIC = ['/', '/index.html', '/app.js', '/style.css', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/foquito-avatar.png'];

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
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;
  // Supabase y Anthropic siempre van a red — nunca cachear
  if (url.includes('supabase.co') || url.includes('anthropic.com')) return;
  // API interna (proxy Claude) — siempre a red
  if (url.includes('/api/')) return;

  const path = new URL(url).pathname;
  // foquito-avatar.png entra acá con .js/.css/.html — está cambiando seguido
  // esta semana, cache-primero (como los íconos de abajo) dejaba a Marco
  // viendo versiones viejas del personaje sin darse cuenta.
  const esCodigoApp = path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.html')
    || path === '/' || path === '/foquito-avatar.png';

  if (esCodigoApp) {
    // Red primero: sin esto, un celu con la PWA instalada podía quedarse
    // sirviendo un app.js/style.css viejo del cache indefinidamente, aunque
    // ya hubiera un fix pusheado — "reportan bugs que ya arreglamos" era esto.
    // Si no hay internet, cae al cache (la PWA sigue andando offline).
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Assets que casi no cambian (íconos, manifest) — cache primero, más rápido
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || 'foco.';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      if (clients.openWindow) return clients.openWindow(e.notification.data?.url || '/');
    })
  );
});
