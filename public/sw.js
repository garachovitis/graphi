// Grafi service worker: offline app shell. Network-first for the HTML (so updates
// arrive), cache-first for hashed assets (immutable), fonts and icons.
const CACHE = 'grafi-v1'
self.addEventListener('install', (e) => { self.skipWaiting() })
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  const isDoc = req.mode === 'navigate' || req.destination === 'document'
  if (isDoc) {
    e.respondWith(fetch(req).then((res) => { const c = res.clone(); caches.open(CACHE).then((ca) => ca.put(req, c)); return res }).catch(() => caches.match(req).then((r) => r || caches.match('./'))))
    return
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const c = res.clone(); caches.open(CACHE).then((ca) => ca.put(req, c)) }
    return res
  })))
})
