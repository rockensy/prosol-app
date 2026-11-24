/* PROSOL Campo · service worker — cachea la app para uso sin internet. */
const CACHE = "prosol-campo-v70";
const ASSETS = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./prosol_web.js",
  "./db.js",
  "./sync.js",
  "./envio_estado.js",
  "./seguimiento.html",
  "./seguimiento.js",
  "./autorizacion.html",
  "./autorizacion.js",
  "./lib/jszip.min.js",
  "./lib/api.js",
  "./lib/auth.js",
  "./lib/wa.js",
  "./lib/agenda.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  // v3.50: cada archivo se pide fresco a GitHub (nunca la copia vieja del navegador)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

// Permite que la app pida activar la versión nueva sin esperar
self.addEventListener("message", (e) => {
  if (e.data === "activar-ya") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first: la app funciona aunque no haya señal en el sitio del trabajo.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Orígenes externos (Supabase, CDN, etc.): SIEMPRE a la red, nunca desde caché ni se guardan en caché.
  if (url.origin !== self.location.origin) return;
  // Recepción de archivo compartido desde WhatsApp (share_target POST)
  if (e.request.method === "POST" && url.pathname.endsWith("/index.html")) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const archivo = form.get("archivo") || form.get("files");
        if (archivo) {
          const cache = await caches.open("prosol-share");
          await cache.put("/__shared__", new Response(archivo));
        }
      } catch (err) { /* nada */ }
      return Response.redirect("./index.html?share=1", 303);
    })());
    return;
  }
  if (e.request.method !== "GET") return;
  // El catálogo nunca se cachea: siempre se trae el más reciente de la red.
  if (url.pathname.endsWith("/catalogo.zip") || url.pathname.endsWith("catalogo.zip")) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
