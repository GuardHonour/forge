/* FORGE service worker — an offline shell that never serves a stale app.
 *
 * Strategy, chosen deliberately:
 *   - The document (index.html / navigations) is NETWORK-FIRST. A cached
 *     document is how a home-screen install ends up running last month's code,
 *     so online always wins and the cache is only a fallback.
 *   - Everything else same-origin is CACHE-FIRST for instant loads.
 *   - Cross-origin requests are never intercepted. The page's web fonts are the
 *     only ones, and letting them fail naturally means a blocked font falls back
 *     to the system stack instead of breaking the render.
 *
 * BUILD must be bumped in step with APP_BUILD in index.html. Bumping it deletes
 * every older cache on activate, which is what makes an update actually land.
 */
const BUILD = '2026-08-25h';
const CACHE = 'forge-' + BUILD;
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './favicon-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Individually tolerated: one missing icon must not abort the install.
    await Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isDocument(req, url) {
  if (req.mode === 'navigate') return true;
  if (req.destination === 'document') return true;
  return url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   // fonts and anything else third-party

  if (isDocument(req, url)) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const c = await caches.open(CACHE);
          c.put('./index.html', fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (err) {
        const c = await caches.open(CACHE);
        const hit = (await c.match('./index.html')) || (await c.match('./'));
        return hit || new Response('FORGE is offline and no cached copy is available yet.',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req);
    if (hit) return hit;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === 'basic') c.put(req, fresh.clone()).catch(() => {});
      return fresh;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});
