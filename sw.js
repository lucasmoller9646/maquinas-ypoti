// Service worker: deja el app disponible sin conexión después de la primera visita.
const CACHE = 'maquinas-ypoti-v1-1-0';
const FILES = ['./', './index.html', './manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // fuentes y servidor: siempre a la red
  // index.html: responde al instante con la copia guardada (señal débil en el campo) y la actualiza por detrás;
  // la versión nueva aparece la próxima vez que se abre el app.
  if (e.request.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    e.respondWith(caches.open(CACHE).then(c => c.match('./index.html').then(hit => { const red = fetch(e.request).then(res => { if (res && res.ok) c.put('./index.html', res.clone()); return res; }).catch(() => hit); return hit || red; })));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })));
});
