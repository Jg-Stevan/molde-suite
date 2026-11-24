/*
 * Service Worker de Tamiz — offline-first a mano (SIN Workbox).
 *
 * Estrategia (PLAN-AGENTE-LAYOUT F5):
 *  · App shell: NO se precachea la lista de assets hasheados de Next (cambia
 *    en cada build) — se usa RUNTIME CACHING: /_next/static/ (hashed,
 *    inmutable), /vendor/ y /scanner/ (el motor que materializa `bun run
 *    preparar`: Tesseract core/lenguajes, OpenCV, workers), fuentes y cualquier
 *    .wasm (ONNX Runtime viene de un chunk o de CDN) entran a `tamiz-shell-v1`
 *    con CACHE-FIRST la primera vez que se piden.
 *  · Navegaciones: NETWORK-FIRST — red, y si falla se responde con lo que haya
 *    en cache para esa URL, luego `/` y por último `/offline.html`.
 *  · Modelos versionados (`/models/`, pp_doclayout*.onnx): cache `tamiz-modelos-v1`
 *    CACHE-FIRST — la URL lleva el nombre del archivo; el sha256 se verifica en
 *    la app ANTES de escribir el modelo en este cache (Panel de modelos).
 *  · PRIVACIDAD (decisión del plan): JAMÁS se cachean fotos de documentos.
 *    Las fotos viven en memoria / dataURLs dentro de la app — nunca viajan por
 *    una URL cacheable. Además: toda petición que NO es GET o que apunta a
 *    `/api/` pasa a red SIN escribir en ningún cache.
 */

const CACHE_SHELL = 'tamiz-shell-v1';
const CACHE_MODELOS = 'tamiz-modelos-v1';
/** Nombres de cache VIVOS — los caches viejos de Tamiz se borran en activate. */
const CACHES_VIVOS = [CACHE_SHELL, CACHE_MODELOS];

/** Base del despliegue derivada del scope real del SW: '' en la raíz
 *  (Cloudflare/local) o '/molde-suite/tamiz' en la subruta de GitHub Pages.
 *  El SW no pasa por el router de Next: sus rutas se prefijan aquí. */
function rutaBase() {
  return new URL(self.registration.scope).pathname.replace(/\/+$/, '');
}

function rutaPublica(ruta) {
  return `${rutaBase()}${ruta}`;
}

/** Instalación: respaldo mínimo del shell. allSettled para que un 404
 *  momentáneo no bloquee la instalación del SW. */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL);
      // Bloque 2.7 — los workers IIFE del núcleo entran al respaldo mínimo
      // (allSettled: un 404 momentáneo NO aborta la instalación del SW).
      await Promise.allSettled(
        [
          '/',
          '/offline.html',
          '/scanner/detection-worker.js',
          '/scanner/fallback-canvas.worker.js',
          '/scanner/reescalar-import.worker.js',
          '/scanner/capa0-qr.worker.js',
          '/scanner/db-postprocess.worker.js',
          '/models/rapidocr/ppocr_keys.txt',
        ].map((url) =>
          cache.add(new Request(rutaPublica(url), { cache: 'reload' })),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

/** Activación: limpieza de caches viejos (lista blanca de nombres vivos). */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(
        nombres
          // Solo caches de Tamiz: el origen de GitHub Pages aloja más sitios.
          .filter((n) => n.startsWith('tamiz-') && !CACHES_VIVOS.includes(n))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Mensajes del cliente: SKIP_WAITING activa el SW nuevo al instante
 *  (el banner de PwaRegister ofrece "RECARGAR AHORA"). */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ── Clasificación de peticiones ────────────────────────────────────────────

/** CDN de tesseract.js (el paquete baja worker/core/lenguajes desde jsdelivr
 *  o unpkg): mismo tratamiento que /tesseract/ local. */
function esCdnTesseract(url) {
  return (
    (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'unpkg.com') &&
    url.pathname.includes('tesseract')
  );
}

/** Estáticos inmutables: assets hasheados de Next, el vendor mismo-origin del
 *  motor (Tesseract/OpenCV/jsQR — lo materializa `bun run preparar`), los
 *  workers IIFE de `public/scanner`, fuentes y WebAssembly (ONNX Runtime —
 *  chunk local o CDN). */
function esEstatico(url) {
  return (
    url.pathname.startsWith(rutaPublica('/_next/static/')) ||
    url.pathname.startsWith(rutaPublica('/vendor/')) ||
    url.pathname.startsWith(rutaPublica('/scanner/')) ||
    esCdnTesseract(url) ||
    /\.(woff2?|ttf|otf|wasm)$/i.test(url.pathname)
  );
}

/** Modelos de layout: archivos versionados bajo /models/ (inmutables por
 *  convención — el nombre lleva el contenido; el sha256 se verifica en la app). */
function esModelo(url) {
  return url.pathname.startsWith(rutaPublica('/models/'));
}

// ── Estrategias ────────────────────────────────────────────────────────────

/** Navegación: red primero; si no hay red, lo cacheado de esa URL, luego `/`
 *  (el shell precacheado) y por último la página offline en español. */
async function manejarNavegacion(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_SHELL);
    return (
      (await cache.match(request)) ||
      (await cache.match(rutaPublica('/'))) ||
      (await cache.match(rutaPublica('/offline.html'))) ||
      new Response('Sin conexión — Tamiz ya está en tu celular.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

/** CACHE-FIRST: el cache manda; la red llena el cache la primera vez. Los
 *  respuestas opacas (CDN) y ok se escriben; los errores de red devuelven 504. */
async function cachePrimero(request, nombreCache) {
  const cache = await caches.open(nombreCache);
  const golpe = await cache.match(request);
  if (golpe) return golpe;
  try {
    const respuesta = await fetch(request);
    if (respuesta && (respuesta.ok || respuesta.type === 'opaque')) {
      await cache.put(request, respuesta.clone());
    }
    return respuesta;
  } catch {
    return new Response('', { status: 504, statusText: 'Sin conexión' });
  }
}

// ── Router principal ───────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // PRIVACIDAD: peticiones que NO son GET (POST de envío, uploads) y todo lo
  // que apunta a /api/ — SOLO red, jamás escribir cache. Las fotos de
  // documentos no tienen URL cacheable (viven en memoria/dataURLs), y esta
  // guarda cierra la puerta a cualquier upload accidental.
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return; // rango (video/partial): passthrough
  const url = new URL(request.url);
  if (url.pathname.startsWith(rutaPublica('/api/'))) return;

  if (request.mode === 'navigate') {
    event.respondWith(manejarNavegacion(request));
    return;
  }
  if (esModelo(url)) {
    event.respondWith(cachePrimero(request, CACHE_MODELOS));
    return;
  }
  if (esEstatico(url)) {
    event.respondWith(cachePrimero(request, CACHE_SHELL));
    return;
  }
  // El resto (documentos HTML no navegación, JSON de desarrollo, etc.): red
  // directa, sin respondWith — comportamiento por defecto del navegador.
});
