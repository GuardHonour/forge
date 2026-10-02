/* FORGE service worker — an offline shell that opens instantly and still never runs stale code.
 *
 * Strategy, revised after the boot-time investigation (see _s3d_clip_press.js's BAKED note for the
 * other half of that story). It was network-first for the document, on the reasoning that a cached
 * home-screen install ends up running last month's code — but the cost was that EVERY open waited
 * for the network before rendering anything, even with a perfectly good cached copy on the phone.
 * On weak mobile signal that wait was seconds to tens of seconds, and the fetch had no timeout, so
 * a barely-alive connection stalled the splash the whole time it hung. The document is now:
 *
 *   - STALE-WHILE-REVALIDATE for normal navigations: the cached copy is served the moment it is
 *     asked for and a fresh fetch runs in the background for the NEXT open. An open never waits
 *     on the network when a cached copy exists. The trade: for one open after a deploy the app
 *     may run the previous build — and the build-marker machinery below is what keeps that honest.
 *     Each navigation caches under its OWN document: fix-guide.html, install.html and latest.html
 *     are separate pages, never answered with — or cached over — the app shell (docKey below).
 *   - NETWORK-FIRST for navigations carrying ?fresh=: the app's own self-heal (a store whose
 *     forge_build marker is older than this build's APP_BUILD unregisters every SW, wipes every
 *     cache and reloads with ?fresh=1) exists precisely to guarantee fresh bytes on that one hop,
 *     so that hop must not be answered from a cache.
 *
 * Why the update path still works with a cache-first open: index.html bumps
 * localStorage['forge_build'] when the marker it reads is older than its own APP_BUILD, and on
 * that mismatch it wipes the SW + caches and reloads with ?fresh=1 — which this handler serves
 * network-first by the carve-out above. So a stale install self-corrects on the open that notices,
 * instead of waiting for a background refresh; the background refresh is what makes the NEXT
 * ordinary open already current.
 *
 * Everything else same-origin is CACHE-FIRST for instant loads. Cross-origin requests are never
 * intercepted: the page's web fonts are the only ones, and they are loaded non-blocking by the
 * document (media=print swap), so a slow font route costs the typeface, never the boot.
 *
 * BUILD must be bumped in step with APP_BUILD in index.html. Bumping it deletes every older cache
 * on activate, which is what makes an update actually land.
 */
const BUILD = '2026-10-03a';
const CACHE = 'forge-' + BUILD;
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './icon-maskable-512.png', './favicon-96.png'];

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

/* The cache key a navigation reads and writes. The shell under either spelling ('/' and
   '/index.html') shares one key, matching what install() precaches. Every other same-origin
   document (fix-guide.html, install.html, latest.html) gets its OWN key: a navigation to it
   must never be answered with the app shell, and its bytes must never be cached OVER the
   shell — which is exactly what the old always-'./index.html' match/put did, serving the app
   for a guide link and poisoning the shell's cache entry until the next refresh replaced it. */
function docKey(url) {
  if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) return './index.html';
  return url.origin + url.pathname;
}

/* The document fetch, for when there is nothing cached to serve (first ever load) or when the
   ?fresh=1 self-heal demands fresh bytes: network with the cache as a fallback only. */
async function documentFromNetwork(req, key) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const c = await caches.open(CACHE);
      c.put(key, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const c = await caches.open(CACHE);
    /* Offline fallback stays within the document that was asked for: the shell falls back
       across its two spellings, but a guide requested offline must not be answered with the
       app — a 503 says what actually happened. */
    const hit = (await c.match(key)) ||
      (key === './index.html' ? await c.match('./') : null);
    return hit || new Response('FORGE is offline and no cached copy is available yet.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   // fonts and anything else third-party

  if (isDocument(req, url)) {
    const key = docKey(url);
    e.respondWith((async () => {
      /* The self-heal's hop must be fresh bytes — never answered from a cache. */
      if (/[?&]fresh=/.test(url.search)) return documentFromNetwork(req, key);

      const c = await caches.open(CACHE);
      const hit = await c.match(key);
      /* Refresh for the NEXT open, in the background, without making this open wait. waitUntil
         keeps the worker alive until the refresh settles. */
      const refresh = documentFromNetwork(req, key);
      try { e.waitUntil(refresh); } catch (err) {}
      if (hit) return hit;
      /* Nothing cached yet (first ever open): this open must have the network. */
      return refresh;
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