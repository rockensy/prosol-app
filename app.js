/* ============================================================
   PROSOL Campo · app.js
   App de campo del técnico (PWA, offline). Carga el catálogo de
   oficina (.prosolcat), permite registrar OT con fotos y firma, y
   exporta un paquete .prosol para enviar por WhatsApp a oficina.

   Formato compatible con el importador del sistema de escritorio:
     .prosolcat = ZIP { catalogo.json, verificacion.txt(sha256 de catalogo.json) }
     .prosol    = ZIP { manifiesto.json, ordenes.json, fotos/<n>, verificacion.txt(sha256 de ordenes.json) }
   ============================================================ */
(() => {
"use strict";

const FORMATO = "1.0";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

// ---------- Estado en memoria ----------
const estado = {
  tecnico: "",
  catalogo: null,
  ordenes: [],           // OT pendientes de empaquetar
  envios: [],            // archivos generados (para enviar)
  historial: [],         // registro permanente de TODAS las órdenes hechas
  edit: null,
  fotos: [],
  actividades: [],
};
// Exponer estado y guardarLocal globalmente para que initSupabase (fuera de IIFE) pueda accederlos
window._prosolEstado = estado;
// Días que se conservan las fotos en el historial antes de liberarlas
const DIAS_FOTOS = 15;

// ---------- Persistencia local (IndexedDB simple) ----------
const DB = {
  _db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("prosol_campo", 1);
      r.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      };
      r.onsuccess = (e) => { this._db = e.target.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  get(k) {
    return new Promise((res) => {
      if (!this._db) return res(null);
      const t = this._db.transaction("kv", "readonly").objectStore("kv").get(k);
      t.onsuccess = () => res(t.result ?? null);
      t.onerror = () => res(null);
    });
  },
  set(k, v) {
    return new Promise((res) => {
      if (!this._db) return res();
      const t = this._db.transaction("kv", "readwrite").objectStore("kv").put(v, k);
      t.onsuccess = () => res(); t.onerror = () => res();
    });
  },
};

async function guardarLocal() {
  await DB.set("tecnico", estado.tecnico);
  await DB.set("catalogo", estado.catalogo);
  if (estado.tecnico) {
    await DB.set("ordenes::" + estado.tecnico, estado.ordenes);
    await DB.set("envios::" + estado.tecnico, estado.envios);
    await DB.set("historial::" + estado.tecnico, estado.historial);
  }
}
async function cargarLocal() {
  estado.tecnico = (await DB.get("tecnico")) || "";
  estado.catalogo = (await DB.get("catalogo")) || null;
  const t = estado.tecnico;
  estado.ordenes = t ? ((await DB.get("ordenes::" + t)) || []) : [];
  estado.envios = t ? ((await DB.get("envios::" + t)) || []) : [];
  estado.historial = t ? ((await DB.get("historial::" + t)) || []) : [];
}
// Libera las FOTOS de las órdenes del historial con más de DIAS_FOTOS días,
// conservando todos los datos (texto). Ahorra espacio sin perder el registro.
function liberarFotosViejas() {
  const limite = Date.now() - DIAS_FOTOS * 86400000;
  let liberadas = 0;
  for (const h of estado.historial) {
    if (!h._fotos || !h._fotos.length) continue;
    const t = Date.parse((h._creado || "").replace(" ", "T")) || 0;
    if (t && t < limite) {
      liberadas += h._fotos.length;
      h._fotosLiberadas = h._fotos.length;
      h._fotos = [];
    }
  }
  return liberadas;
}
async function cerrarSesion() {
  if (estado.tecnico) {
    await DB.set("ordenes::" + estado.tecnico, estado.ordenes);
    await DB.set("envios::" + estado.tecnico, estado.envios);
    await DB.set("historial::" + estado.tecnico, estado.historial);
  }
  await DB.set("tecnico", "");
  estado.tecnico = ""; estado.ordenes = []; estado.envios = []; estado.historial = [];
  refrescarSync();
  pintarLogin();
  ir("login");
}

// ---------- Utilidades ----------
async function sha256Hex(texto) {
  const bytes = new TextEncoder().encode(texto);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function uid(n = 12) {
  const c = "0123456789abcdef"; let s = "";
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * 16)];
  return s;
}
function hoyISO() { return new Date().toISOString().slice(0, 10); }
function toast(msg, tipo = "") {
  const t = $("#toast"); t.textContent = msg; t.className = "toast " + tipo;
  t.hidden = false; clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- Navegación ----------
function ir(nombre) {
  $$(".screen").forEach(s => s.classList.toggle("active", s.dataset.screen === nombre));
  window.scrollTo(0, 0);
  if (nombre === "equipos") pintarEquipos();
  if (nombre === "programaciones") pintarProgramaciones();
  if (nombre === "enviar") pintarPendientes();
  if (nombre === "historial") pintarHistorial();
  if (nombre === "inicio") pintarInicio();
}

// ---------- Sincronización visual ----------
function refrescarSync() {
  const cat = estado.catalogo;
  const dot = $("#dot-catalogo"), txt = $("#chip-catalogo-txt");
  if (cat) {
    dot.classList.add("ok");
    txt.textContent = "Cat. " + (cat.generado || "").slice(0, 10);
  } else { dot.classList.remove("ok"); txt.textContent = "Sin catálogo"; }
  const n = estado.ordenes.length;
  $("#chip-pend-num").textContent = n;
  $("#badge-pend").textContent = n;
  $("#hero-pend").textContent = n;
  $("#badge-prog").textContent = cat ? (cat.programaciones || []).length : 0;
  const bh = $("#badge-hist"); if (bh) bh.textContent = estado.historial.length;
}

function pintarInicio() {
  refrescarSync();
  const tn = $("#hero-tecnico"); if (tn) tn.textContent = estado.tecnico || "";
  // Mostrar tile Liquidación solo para Luis Alfonso (acceso via window)
  if (typeof window._liqMovMostrarTile === 'function') window._liqMovMostrarTile();
  const cat = estado.catalogo;
  const meta = $("#hero-cat-meta"), res = $("#cat-resumen");
  if (cat) {
    const r = cat.resumen || {};
    meta.textContent = `Catálogo del ${(cat.generado || "").slice(0, 10)} cargado.`;
    res.textContent = `${r.clientes || 0} clientes · ${r.equipos || 0} equipos · `
      + `${r.historial_ot || 0} OT de historial · ${r.programaciones || 0} programaciones.`;
  } else {
    meta.textContent = "Carga el catálogo de oficina para empezar.";
    res.textContent = "No has cargado ningún catálogo todavía.";
  }
  // Aviso de pendientes (recordatorio visible para no perder trabajo)
  const av = $("#hero-aviso");
  if (av) {
    const sinEmp = estado.ordenes.length;
    const archSinEnv = estado.envios.filter(e => !e.enviado).length;
    const partes = [];
    if (sinEmp) partes.push(`${sinEmp} orden(es) sin empaquetar`);
    if (archSinEnv) partes.push(`${archSinEnv} archivo(s) sin enviar`);
    if (partes.length) {
      av.hidden = false;
      av.innerHTML = "⚠️ Tienes " + partes.join(" y ") + ". Ve a “Enviar a oficina”.";
    } else { av.hidden = true; }
  }
}

// ---------- Cargar catálogo (.prosolcat) ----------
async function cargarCatalogo(file) {
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    toast("Ese archivo no se pudo abrir. Reenvíalo por WhatsApp como Documento, "
      + "sin comprimir ni renombrar.", "err");
    return;
  }
  try {
    const catFile = zip.file("catalogo.json");
    if (!catFile) {
      toast("El archivo no contiene el catálogo de PROSOL. Pide a oficina que lo "
        + "genere de nuevo y reenvíalo como Documento.", "err");
      return;
    }
    const txt = await catFile.async("string");
    const verFile = zip.file("verificacion.txt");
    if (verFile) {
      const esperado = (await verFile.async("string")).trim();
      const real = await sha256Hex(txt);
      if (esperado && esperado !== real) {
        toast("El catálogo llegó incompleto o dañado. Reenvíalo como Documento.", "err");
        return;
      }
    }
    estado.catalogo = JSON.parse(txt);
    await guardarLocal();
    refrescarSync(); pintarInicio(); pintarLogin();
    const r = estado.catalogo.resumen || {};
    toast(`Catálogo actualizado: ${r.equipos || 0} equipos, ${r.programaciones || 0} programadas.`, "ok");
  } catch (e) {
    toast("No se pudo leer el catálogo: " + e.message, "err");
  }
}

// ---------- Equipos / clientes ----------
function clientePorId(id) {
  return (estado.catalogo?.clientes || []).find(c => c.ID_CLIENTE === id) || null;
}
function equiposFiltrados(q) {
  const eqs = estado.catalogo?.equipos || [];
  q = (q || "").trim().toLowerCase();
  if (!q) return eqs;
  return eqs.filter(e => {
    const cli = clientePorId(e.ID_CLIENTE);
    return [e.SERIE, e.MARCA, e.MODELO, cli?.RAZON_SOCIAL]
      .filter(Boolean).join(" ").toLowerCase().includes(q);
  });
}
function pintarEquipos() {
  const cont = $("#lista-equipos");
  const count = $("#equipos-count");
  if (!estado.catalogo) {
    cont.innerHTML = `<li class="tw-empty">Primero carga el catálogo de oficina.</li>`;
    count.textContent = ""; return;
  }
  const eqs = equiposFiltrados($("#buscar-equipo").value);
  count.textContent = `${eqs.length} equipo(s)`;
  cont.innerHTML = "";
  eqs.slice(0, 500).forEach(e => {
    const cli = clientePorId(e.ID_CLIENTE);
    const li = document.createElement("li");
    li.className = "tw-row";
    li.innerHTML = `<span class="tw-c1">${e.SERIE || "—"}</span>
      <span class="tw-c2">
        <div class="t2-main">${[e.MARCA, e.MODELO].filter(Boolean).join(" ") || "Equipo"}</div>
        <div class="t2-sub">${cli?.RAZON_SOCIAL || "—"}</div>
      </span>`;
    li.onclick = () => abrirEquipo(e);
    cont.appendChild(li);
  });
  if (!eqs.length) cont.innerHTML = `<li class="tw-empty">Sin coincidencias.</li>`;
}

function historialDeSerie(serie) {
  return (estado.catalogo?.historial_ot || []).filter(o => (o.SERIE || "") === serie);
}
function abrirEquipo(e) {
  estado._equipoActual = e;
  const cli = clientePorId(e.ID_CLIENTE);
  $("#eq-titulo").textContent = "Serie " + (e.SERIE || "—");
  $("#eq-datos").innerHTML = `
    <div class="row-title">${[e.MARCA, e.MODELO].filter(Boolean).join(" ") || "Equipo"}</div>
    <div class="row-sub">Cliente: ${cli?.RAZON_SOCIAL || "—"}</div>
    <div class="row-sub">Ubicación: ${e.UBICACION || "—"} · Horas: ${e.HORAS_OPERACION ?? "—"}</div>`;
  const hist = historialDeSerie(e.SERIE).sort((a, b) => (b.FECHA || "").localeCompare(a.FECHA || ""));
  const ul = $("#eq-historial"); ul.innerHTML = "";
  $("#eq-hist-vacio").hidden = hist.length > 0;
  hist.slice(0, 60).forEach(o => {
    const li = document.createElement("li"); li.className = "tl-item";
    const acts = (o.ACTIVIDADES || []).slice(0, 4).join(", ");
    li.innerHTML = `<div class="tl-date">${o.FECHA || "—"} · OT ${o.NUMERO_OT || "—"}</div>
      <div class="tl-meta">${o.TIPO_OT || ""} · ${o.ESTADO || ""}</div>
      ${acts ? `<div class="tl-acts">${acts}</div>` : ""}`;
    ul.appendChild(li);
  });
  ir("equipo-detalle");
}

// ---------- Geolocalización de la orden ----------
let _ubicacionOT = null;
function capturarUbicacion() {
  if (!("geolocation" in navigator)) {
    toast("Tu teléfono no permite ubicación.", "err"); return;
  }
  $("#ot-ubicacion").value = "Obteniendo ubicación…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude.toFixed(6);
      const lon = pos.coords.longitude.toFixed(6);
      _ubicacionOT = { lat, lon };
      $("#ot-ubicacion").value = lat + ", " + lon;
      toast("Ubicación capturada.", "ok");
    },
    (err) => {
      $("#ot-ubicacion").value = "";
      toast("No se pudo obtener la ubicación. Activa el GPS y permite el acceso.", "err");
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

// ---------- Escáner QR de equipos ----------
let qrStream = null, qrLoop = null;
async function abrirEscanerQR() {
  $("#sheet-qr").hidden = false;
  $("#qr-manual").value = "";
  const estadoTxt = $("#qr-estado");
  // ¿El navegador soporta detección de códigos?
  if (!("BarcodeDetector" in window)) {
    estadoTxt.textContent = "Tu teléfono no permite escanear aquí. Escribe la serie abajo.";
    return;
  }
  try {
    const detector = new BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13"] });
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const video = $("#qr-video");
    video.srcObject = qrStream; await video.play();
    estadoTxt.textContent = "Buscando código…";
    qrLoop = setInterval(async () => {
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length) {
          const valor = (codes[0].rawValue || "").trim();
          if (valor) { cerrarEscanerQR(); usarSerieEscaneada(valor); }
        }
      } catch (e) { /* sigue intentando */ }
    }, 400);
  } catch (e) {
    estadoTxt.textContent = "No se pudo abrir la cámara. Escribe la serie abajo.";
  }
}
function cerrarEscanerQR() {
  if (qrLoop) { clearInterval(qrLoop); qrLoop = null; }
  if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; }
  $("#sheet-qr").hidden = true;
}
// Toma el valor escaneado/escrito y busca el equipo por serie.
function usarSerieEscaneada(valor) {
  // El QR puede traer solo la serie, o algo como "SERIE:3015..." → extraemos dígitos/serie
  let serie = valor.trim();
  const m = serie.match(/(\d{6,})/);          // secuencia larga de dígitos = serie típica
  if (m) serie = m[1];
  const eq = (estado.catalogo?.equipos || []).find(e => (e.SERIE || "") === serie);
  if (eq) {
    setEquipoOT(eq);
    toast("Equipo encontrado: serie " + serie, "ok");
  } else {
    toast("No hay un equipo con la serie " + serie + " en el catálogo.", "err");
  }
}

// ---------- Programaciones ----------
function progsFiltradas(q) {
  const progs = estado.catalogo?.programaciones || [];
  q = (q || "").trim().toLowerCase();
  if (!q) return progs;
  return progs.filter(p => {
    const cli = clientePorId(p.ID_CLIENTE);
    return [p.SERIE, p.TIPO_MANTENIMIENTO, p.FECHA_PROGRAMADA, cli?.RAZON_SOCIAL]
      .filter(Boolean).join(" ").toLowerCase().includes(q);
  });
}
function pintarProgramaciones() {
  const cont = $("#lista-prog");
  const count = $("#prog-count");
  const todas = estado.catalogo?.programaciones || [];
  const progs = progsFiltradas($("#buscar-prog").value);
  $("#prog-vacio").hidden = todas.length > 0;
  count.textContent = todas.length ? `${progs.length} de ${todas.length} programada(s)` : "";
  cont.innerHTML = "";
  progs.forEach(p => {
    const cli = clientePorId(p.ID_CLIENTE);
    const li = document.createElement("li"); li.className = "tw-row";
    li.innerHTML = `<span class="tw-c1">${p.FECHA_PROGRAMADA || "—"}</span>
      <span class="tw-c2">
        <div class="t2-main">${p.TIPO_MANTENIMIENTO || "Mantenimiento"}</div>
        <div class="t2-sub">Serie ${p.SERIE || "—"} · ${cli?.RAZON_SOCIAL || "—"}</div>
      </span>`;
    li.onclick = () => {
      const eq = (estado.catalogo.equipos || []).find(e => e.SERIE === p.SERIE);
      nuevaOT(eq || { SERIE: p.SERIE, ID_CLIENTE: p.ID_CLIENTE }, p.TIPO_MANTENIMIENTO);
    };
    cont.appendChild(li);
  });
  if (todas.length && !progs.length) cont.innerHTML = `<li class="tw-empty">Sin coincidencias.</li>`;
}

// ---------- Nueva / editar OT ----------
function nuevaOT(equipo, tipo) {
  estado.edit = { COD_TEMP: "" };
  estado.fotos = []; estado.actividades = [];
  $("#ot-titulo").textContent = "Nueva orden";
  $("#ot-numero").value = "";
  $("#ot-fecha").value = hoyISO();
  $("#ot-horas").value = "";
  $("#ot-obs").value = "";
  if ($("#ot-ubicacion")) $("#ot-ubicacion").value = "";
  _ubicacionOT = null;
  // tipos
  const sel = $("#ot-tipo"); sel.innerHTML = "";
  (estado.catalogo?.tipos_mantenimiento || ["MANTENIMIENTO GENERAL"]).forEach(t => {
    const o = document.createElement("option"); o.value = t; o.textContent = t; sel.appendChild(o);
  });
  if (tipo) sel.value = tipo;
  // equipo
  if (equipo && equipo.SERIE) setEquipoOT(equipo);
  else { estado._otEquipo = null; $("#ot-serie").value = ""; $("#ot-cliente-info").textContent = ""; }
  cargarActividadesDelTipo();   // carga automática del combo seleccionado
  pintarFotos(); limpiarFirma();
  ir("nueva-ot");
}
// Carga las actividades del tipo seleccionado como un RUBRO (combo) con sus
// sub-actividades, conservando las actividades adicionales que el técnico haya
// agregado. Reemplaza el rubro anterior si cambió el tipo.
function cargarActividadesDelTipo() {
  const tipo = $("#ot-tipo").value;
  const subs = (estado.catalogo?.combos || {})[tipo] || [];
  // conservar solo las adicionales (las que no son rubro ni sub del combo)
  const adicionales = estado.actividades.filter(a => a.tipo === "adicional");
  estado.actividades = [];
  if (tipo) {
    estado.actividades.push({ tipo: "rubro", texto: tipo });
    subs.forEach(s => estado.actividades.push({ tipo: "sub", texto: s }));
  }
  adicionales.forEach(a => estado.actividades.push(a));
  pintarActividades();
}
function setEquipoOT(e) {
  estado._otEquipo = e;
  $("#ot-serie").value = e.SERIE || "";
  const cli = clientePorId(e.ID_CLIENTE);
  $("#ot-cliente-info").textContent = cli ? "Cliente: " + cli.RAZON_SOCIAL : "";
}
function pintarActividades() {
  const ul = $("#ot-actividades"); ul.innerHTML = "";
  estado.actividades.forEach((a, i) => {
    const li = document.createElement("li");
    li.className = "act-" + a.tipo;   // rubro / sub / adicional
    const esPrincipal = a.tipo === "rubro" || a.tipo === "adicional";
    // el rubro no se quita a mano (cambia al cambiar el tipo); sub y adicional sí
    const x = a.tipo === "rubro" ? "" : `<span class="x" data-i="${i}">✕</span>`;
    li.innerHTML = `<span class="act-tx">${a.texto}</span>${x}`;
    const btn = li.querySelector(".x");
    if (btn) btn.onclick = () => { estado.actividades.splice(i, 1); pintarActividades(); };
    ul.appendChild(li);
  });
}
function pintarFotos() {
  const g = $("#ot-fotos"); g.innerHTML = "";
  estado.fotos.forEach((f, i) => {
    const c = document.createElement("div"); c.className = "foto-cell";
    c.innerHTML = `<img src="${f.dataUrl}" alt=""><button class="foto-del" data-i="${i}">✕</button>`;
    c.querySelector(".foto-del").onclick = () => { estado.fotos.splice(i, 1); pintarFotos(); };
    g.appendChild(c);
  });
}

// Comprimir foto a JPEG ~1280px para que el paquete no pese demasiado
function procesarFoto(file) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const max = 1280, esc = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * esc); cv.height = Math.round(img.height * esc);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      res(cv.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => res(null);
    const fr = new FileReader();
    fr.onload = () => { img.src = fr.result; };
    fr.readAsDataURL(file);
  });
}

// ---------- Firma (canvas) ----------
const firma = { cv: null, ctx: null, dibujando: false, tieneTrazo: false };
function initFirma() {
  firma.cv = $("#firma"); firma.ctx = firma.cv.getContext("2d");
  ajustarFirma(); limpiarFirma();
  const pos = (ev) => {
    const r = firma.cv.getBoundingClientRect();
    const t = ev.touches ? ev.touches[0] : ev;
    return { x: (t.clientX - r.left) * (firma.cv.width / r.width),
             y: (t.clientY - r.top) * (firma.cv.height / r.height) };
  };
  const start = (e) => { firma.dibujando = true; const p = pos(e); firma.ctx.beginPath(); firma.ctx.moveTo(p.x, p.y); e.preventDefault(); };
  const move = (e) => { if (!firma.dibujando) return; const p = pos(e); firma.ctx.lineTo(p.x, p.y); firma.ctx.stroke(); firma.tieneTrazo = true; e.preventDefault(); };
  const end = () => { firma.dibujando = false; };
  ["mousedown", "touchstart"].forEach(ev => firma.cv.addEventListener(ev, start, { passive: false }));
  ["mousemove", "touchmove"].forEach(ev => firma.cv.addEventListener(ev, move, { passive: false }));
  ["mouseup", "mouseleave", "touchend"].forEach(ev => firma.cv.addEventListener(ev, end));
}
function ajustarFirma() {
  if (!firma.cv) return;
  const w = firma.cv.clientWidth || 600;
  firma.cv.width = w; firma.cv.height = 150;
  firma.ctx.lineWidth = 2.5; firma.ctx.lineCap = "round"; firma.ctx.strokeStyle = "#1A2530";
}
function limpiarFirma() {
  if (!firma.ctx) return;
  firma.ctx.clearRect(0, 0, firma.cv.width, firma.cv.height);
  firma.ctx.fillStyle = "#fff"; firma.ctx.fillRect(0, 0, firma.cv.width, firma.cv.height);
  firma.ctx.strokeStyle = "#1A2530"; firma.tieneTrazo = false;
}

// ---------- Guardar OT en la lista de pendientes ----------
function guardarOT() {
  const e = estado._otEquipo;
  if (!e || !e.SERIE) { toast("Elige el equipo (por serie) primero.", "err"); return; }
  const numero = $("#ot-numero").value.trim();
  if (!numero) { toast("Escribe el N° de la orden física que estás usando.", "err"); return; }
  // BLOQUEANTE: dos órdenes sin enviar con el mismo número
  if (estado.ordenes.some(o => (o.NUMERO_OT || "") === numero)) {
    toast("Ya tienes una orden con el N° " + numero + " sin enviar.", "err"); return;
  }
  // AVISO: el número ya se usó antes (está en el historial) — el técnico confirma
  if (estado.historial.some(h => (h.NUMERO_OT || "") === numero)) {
    if (!confirm("Ya registraste antes una orden con el N° " + numero + ".\n\n"
      + "¿Seguro que quieres usar este número otra vez? Podría duplicarse en oficina.")) return;
  }
  // AVISO: serie no está en el catálogo (equipo no reconocido)
  const serieEnCat = (estado.catalogo?.equipos || []).some(eq => eq.SERIE === e.SERIE);
  if (!serieEnCat) {
    if (!confirm("La serie " + e.SERIE + " no está en el catálogo de oficina.\n\n"
      + "Puedes guardar igual, pero oficina la marcará 'por revisar'. ¿Continuar?")) return;
  }
  // AVISO: faltan evidencias (fotos o firma)
  const faltantes = [];
  if (!estado.fotos.length) faltantes.push("fotos");
  if (!firma.tieneTrazo) faltantes.push("firma del cliente");
  if (faltantes.length) {
    if (!confirm("Esta orden no tiene " + faltantes.join(" ni ") + ".\n\n"
      + "¿Guardar de todas formas?")) return;
  }
  const cli = clientePorId(e.ID_CLIENTE);
  const cod = "MOV-" + (estado.tecnico.split(" ")[0] || "T") + "-" + uid(6);
  const orden = {
    COD_TEMP: cod,
    NUMERO_OT: numero,
    SERIE: e.SERIE,
    ID_CLIENTE: e.ID_CLIENTE || null,
    RAZON_SOCIAL: cli?.RAZON_SOCIAL || "",
    FECHA: $("#ot-fecha").value || hoyISO(),
    TIPO_OT: $("#ot-tipo").value || "PREVENTIVO",
    ESTADO: "REALIZADO",
    TRABAJO_REALIZADO: $("#ot-obs").value.trim(),
    OBSERVACIONES: $("#ot-obs").value.trim(),
    HORAS_MAQUINA: $("#ot-horas").value ? Number($("#ot-horas").value) : null,
    GPS_LAT: _ubicacionOT?.lat || null,
    GPS_LON: _ubicacionOT?.lon || null,
    ACTIVIDADES: estado.actividades.map(d => ({
      DESCRIPCION: d.texto, CANTIDAD: 1, VALOR: 0, NIVEL: d.tipo
    })),
    REPUESTOS: [],
    FOTOS: [],
    _fotos: [],
  };
  estado.fotos.forEach((f, i) => {
    const nombre = `${cod}_${i + 1}.jpg`;
    orden.FOTOS.push(nombre);
    orden._fotos.push({ nombre, dataUrl: f.dataUrl });
  });
  if (firma.tieneTrazo) {
    const nombre = `${cod}_firma.jpg`;
    orden.FIRMA = nombre;
    orden._fotos.push({ nombre, dataUrl: firma.cv.toDataURL("image/jpeg", 0.85) });
  }
  estado.ordenes.push(orden);
  // Guardar también en el historial permanente del técnico (copia con sello de tiempo)
  const copia = JSON.parse(JSON.stringify(orden));
  copia._creado = new Date().toISOString().slice(0, 19).replace("T", " ");
  copia._enviada = false;
  copia._confirmada = false;
  estado.historial.unshift(copia);

  // Baja automática de visita programada para este equipo/serie
  _bajarVisitaProgramada(orden.SERIE, orden.ID_CLIENTE);

  guardarLocal(); refrescarSync();
  toast("Orden guardada. Queda lista para enviar.", "ok");
  ir("inicio");
}

// Marca como EJECUTADA la visita programada del equipo en Supabase y la retira del catálogo local
async function _bajarVisitaProgramada(serie, idCliente) {
  if (!serie) return;
  const progs = estado.catalogo?.programaciones || [];
  // Buscar visita pendiente que coincida con la serie del equipo
  const visita = progs.find(p =>
    p.SERIE === serie &&
    (p.ESTADO || '').toUpperCase() === 'PROGRAMADA'
  );
  if (!visita) return;
  // Retirar del catálogo local inmediatamente (sin esperar respuesta de red)
  estado.catalogo.programaciones = progs.filter(p => p !== visita);
  // Actualizar badge
  const badge = document.getElementById('badge-prog-venc');
  if (badge) {
    const hoy = new Date().toISOString().slice(0, 10);
    const venc = (estado.catalogo.programaciones || []).filter(
      p => p.FECHA_PROGRAMADA && p.FECHA_PROGRAMADA < hoy
    ).length;
    badge.textContent = venc;
  }
  await guardarLocal();
  // Marcar como EJECUTADA en Supabase si hay conexión
  if (typeof API === 'undefined' || !API.hayNube()) return;
  try {
    const idSb = visita.ID_SB || visita.ID_VISITA;
    if (!idSb) return;
    // Intentar por id_escritorio primero, luego por id uuid
    await API.update('visitas_programadas', idSb, { estado: 'EJECUTADA' })
      .catch(() => null);
    toastG('✅ Visita programada marcada como realizada', 'ok');
  } catch(e) {
    // No crítico: la baja local ya está hecha
  }
}

// ---------- Historial permanente "Mis órdenes" ----------
function histFiltrado(q) {
  q = (q || "").trim().toLowerCase();
  if (!q) return estado.historial;
  return estado.historial.filter(h =>
    [h.NUMERO_OT, h.SERIE, h.RAZON_SOCIAL, h.TIPO_OT].filter(Boolean)
      .join(" ").toLowerCase().includes(q));
}
function pintarHistorial() {
  const cont = $("#lista-historial");
  const total = estado.historial.length;
  $("#hist-vacio").hidden = total > 0;
  const lista = histFiltrado($("#buscar-hist") ? $("#buscar-hist").value : "");
  $("#hist-count").textContent = total ? `${lista.length} de ${total} orden(es)` : "";
  if (!cont) return;
  cont.innerHTML = "";
  lista.forEach((h) => {
    const idx = estado.historial.indexOf(h);
    const estadoTxt = h._confirmada ? "✅ confirmada"
      : (h._enviada ? "📤 enviada" : "• sin enviar");
    const li = document.createElement("li"); li.className = "row";
    li.innerHTML = `<div class="row-main">
        <div class="row-title">OT ${h.NUMERO_OT || "—"} · ${h.RAZON_SOCIAL || ""}</div>
        <div class="row-sub">${h.FECHA} · Serie ${h.SERIE} · ${estadoTxt}</div>
      </div><span class="row-chev">›</span>`;
    li.onclick = () => abrirOrdenHistorial(idx);
    cont.appendChild(li);
  });
}
function abrirOrdenHistorial(idx) {
  const h = estado.historial[idx];
  if (!h) return;
  estado._ordenHist = idx;
  $("#sheet-orden-titulo").textContent = "OT " + (h.NUMERO_OT || "—");
  const acts = (h.ACTIVIDADES || []).map(a => {
    const niv = a.NIVEL === "sub" ? "&nbsp;&nbsp;&nbsp;– " : (a.NIVEL === "adicional" ? "➕ " : "");
    return `<div style="${a.NIVEL==='rubro'||a.NIVEL==='adicional'?'font-weight:700':''}">${niv}${a.DESCRIPCION}</div>`;
  }).join("");
  const nFotos = (h._fotos && h._fotos.length) || 0;
  const fotosInfo = nFotos ? `${nFotos} foto(s) guardadas`
    : (h._fotosLiberadas ? `${h._fotosLiberadas} foto(s) ya liberadas (más de ${DIAS_FOTOS} días)` : "Sin fotos");
  $("#sheet-orden-body").innerHTML = `
    <div class="card" style="margin:0 0 10px">
      <div class="row-sub">Cliente</div><div class="row-title">${h.RAZON_SOCIAL || "—"}</div>
      <div class="row-sub" style="margin-top:6px">Serie ${h.SERIE} · ${h.FECHA} · ${h.TIPO_OT || ""}</div>
      <div class="row-sub">Horas: ${h.HORAS_MAQUINA ?? "—"} · Estado: ${h._confirmada?"confirmada por oficina":(h._enviada?"enviada":"sin enviar")}</div>
    </div>
    <div class="field-label">Actividades</div>
    <div style="margin:4px 0 10px;font-size:.92rem">${acts || "—"}</div>
    <div class="field-label">Trabajo / observaciones</div>
    <div style="margin:4px 0 10px;font-size:.92rem">${h.TRABAJO_REALIZADO || "—"}</div>
    ${h.GPS_LAT && h.GPS_LON ? `<div class="row-sub" style="margin-bottom:6px">📍
      <a href="https://maps.google.com/?q=${h.GPS_LAT},${h.GPS_LON}" target="_blank"
        style="color:var(--azul)">Ver ubicación del servicio en el mapa</a></div>` : ""}
    <div class="row-sub">📷 ${fotosInfo}</div>`;
  $("#btn-orden-confirmar").textContent = h._confirmada ? "Quitar confirmación" : "Marcar confirmada";
  $("#sheet-orden").hidden = false;
}
async function reenviarOrdenIndividual() {
  const h = estado.historial[estado._ordenHist];
  if (!h) return;
  // Empaquetar SOLO esta orden en un .zip y compartir
  const pid = uid(12);
  const zip = new JSZip();
  const copia = { ...h }; delete copia._fotos; delete copia._creado;
  delete copia._enviada; delete copia._confirmada; delete copia._fotosLiberadas;
  const txt = JSON.stringify([copia], null, 2);
  zip.file("manifiesto.json", JSON.stringify({ version: FORMATO, id_paquete: pid,
    tecnico: estado.tecnico, generado: new Date().toISOString().slice(0,19).replace("T"," "),
    cantidad: 1 }, null, 2));
  zip.file("ordenes.json", txt);
  zip.file("verificacion.txt", await sha256Hex(txt));
  const carpeta = zip.folder("fotos");
  (h._fotos || []).forEach(f => carpeta.file(f.nombre, dataUrlToUint8(f.dataUrl)));
  const dataUrl = "data:application/zip;base64," + await zip.generateAsync({ type: "base64", compression: "DEFLATE" });
  await compartirEnvio({ nombre: `PROSOL_OT${h.NUMERO_OT}_${hoyISO()}.zip`, dataUrl,
    cantidad: 1, tecnico: estado.tecnico });
  h._enviada = true; await guardarLocal(); pintarHistorial();
}
// Arma un resumen legible de la orden y lo comparte a WhatsApp junto con las
// fotos de ESA orden (un envío por orden, para no sobrecargar).
function resumenOrdenTexto(h) {
  const L = [];
  L.push("*ORDEN DE TRABAJO N° " + (h.NUMERO_OT || "—") + "*");
  L.push("Técnico: " + (estado.tecnico || "—"));
  L.push("Cliente: " + (h.RAZON_SOCIAL || "—"));
  L.push("Equipo (serie): " + (h.SERIE || "—"));
  L.push("Fecha: " + (h.FECHA || "—") + "   Tipo: " + (h.TIPO_OT || "—"));
  if (h.HORAS_MAQUINA != null && h.HORAS_MAQUINA !== "")
    L.push("Horas máquina: " + h.HORAS_MAQUINA);
  L.push("");
  L.push("*Actividades:*");
  (h.ACTIVIDADES || []).forEach(a => {
    const niv = a.NIVEL === "sub" ? "   - " : (a.NIVEL === "adicional" ? "➕ " : "▸ ");
    L.push(niv + a.DESCRIPCION);
  });
  if (h.TRABAJO_REALIZADO) {
    L.push("");
    L.push("*Trabajo / observaciones:*");
    L.push(h.TRABAJO_REALIZADO);
  }
  if (h.GPS_LAT && h.GPS_LON) {
    L.push("");
    L.push("📍 *Ubicación del servicio:*");
    L.push("https://maps.google.com/?q=" + h.GPS_LAT + "," + h.GPS_LON);
  }
  const nf = (h._fotos || []).length;
  L.push("");
  L.push("📷 " + nf + " foto(s) adjunta(s)" + (h.FIRMA ? " · con firma del cliente" : ""));
  L.push("— Enviado desde PROSOL Campo —");
  return L.join("\n");
}
async function enviarOrdenWhatsApp() {
  const h = estado.historial[estado._ordenHist];
  if (!h) return;
  const texto = resumenOrdenTexto(h);
  // Preparar las fotos de ESTA orden como archivos para compartir
  const files = [];
  (h._fotos || []).forEach((f, idx) => {
    try {
      const b64 = f.dataUrl.split(",")[1];
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: "image/jpeg" });
      files.push(new File([blob], f.nombre || ("foto_" + (idx + 1) + ".jpg"),
        { type: "image/jpeg" }));
    } catch (e) { /* foto liberada o ilegible: se omite */ }
  });
  // 1) Compartir texto + fotos juntos si el celular lo permite
  if (files.length && navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, text: texto, title: "OT " + (h.NUMERO_OT || "") });
      h._enviada = true; await guardarLocal(); pintarHistorial();
      return;
    } catch (e) { /* canceló o falló: seguimos con alternativas */ }
  }
  // 2) Sin fotos disponibles (liberadas por antigüedad): compartir solo el texto
  if (!files.length) {
    if (navigator.share) {
      try {
        await navigator.share({ text: texto, title: "OT " + (h.NUMERO_OT || "") });
        h._enviada = true; await guardarLocal(); pintarHistorial();
        return;
      } catch (e) { /* sigue a copiar */ }
    }
    try {
      await navigator.clipboard.writeText(texto);
      toast("Resumen copiado. Pégalo en WhatsApp. (Las fotos de esta orden ya no están "
        + "guardadas por antigüedad.)", "ok");
    } catch (e) { toast("No se pudo preparar el envío.", "err"); }
    return;
  }
  // 3) Hay fotos pero el celular no comparte texto+fotos juntos:
  //    compartir las fotos y copiar el texto para pegarlo.
  try {
    await navigator.clipboard.writeText(texto);
    toast("Resumen copiado: pégalo en WhatsApp y se enviará con las fotos.", "ok");
  } catch (e) { /* nada */ }
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: "Fotos OT " + (h.NUMERO_OT || "") });
      h._enviada = true; await guardarLocal(); pintarHistorial();
      return;
    } catch (e) { /* canceló */ }
  }
  toast("No se pudo abrir WhatsApp para compartir.", "err");
}
function toggleConfirmada() {
  const h = estado.historial[estado._ordenHist];
  if (!h) return;
  h._confirmada = !h._confirmada;
  guardarLocal(); pintarHistorial();
  $("#sheet-orden").hidden = true;
  toast(h._confirmada ? "Marcada como confirmada por oficina." : "Confirmación quitada.", "ok");
}

// ---------- Pendientes de enviar ----------
function pintarPendientes() {
  const cont = $("#lista-pendientes");
  cont.innerHTML = ""; const n = estado.ordenes.length;
  $("#enviar-vacio").hidden = n > 0;
  $("#enviar-foot").hidden = n === 0;
  estado.ordenes.forEach((o, i) => {
    const li = document.createElement("li"); li.className = "row";
    li.innerHTML = `<div class="row-main">
        <div class="row-title">OT ${o.NUMERO_OT || "—"} · Serie ${o.SERIE}</div>
        <div class="row-sub">${o.FECHA} · ${o.RAZON_SOCIAL || ""} · ${o.FOTOS.length} foto(s)</div>
      </div><button class="foto-del" data-i="${i}" style="position:static">✕</button>`;
    li.querySelector(".foto-del").onclick = (ev) => {
      ev.stopPropagation();
      if (confirm("¿Quitar esta orden de la lista?")) {
        estado.ordenes.splice(i, 1); guardarLocal(); refrescarSync(); pintarPendientes();
      }
    };
    cont.appendChild(li);
  });
  pintarEnvios();
}

// ---------- Historial de archivos generados ----------
function pintarEnvios() {
  const cont = $("#lista-envios");
  const hay = estado.envios.length > 0;
  $("#envios-vacio").hidden = hay;
  $("#envios-tw").hidden = !hay;
  if (!cont) return;
  cont.innerHTML = "";
  estado.envios.forEach((e, i) => {
    const nums = (e.numeros || []).join(", ") || "—";
    const li = document.createElement("li"); li.className = "envio-item";
    li.innerHTML = `
      <div class="envio-info">
        <div class="t2-main">📄 OT: ${nums}
          ${e.enviado ? '<span class="tag-ok" style="font-size:.65rem">enviado</span>' : ''}</div>
        <div class="t2-sub">${e.cantidad} orden(es) · ${e.generado.slice(0,10)} ${e.generado.slice(11,16)}</div>
      </div>
      <div class="envio-acciones">
        <button class="btn-mini btn-mini-azul" data-acc="descargar" data-i="${i}">📥 Descargar</button>
        <button class="btn-mini btn-mini-verde" data-acc="compartir" data-i="${i}">📤 Compartir</button>
        <button class="btn-mini btn-mini-x" data-acc="borrar" data-i="${i}">✕</button>
      </div>`;
    li.querySelector('[data-acc="descargar"]').onclick = () => descargarEnvio(i);
    li.querySelector('[data-acc="compartir"]').onclick = () => enviarDeNuevo(i);
    li.querySelector('[data-acc="borrar"]').onclick = () => {
      if (confirm("¿Eliminar este archivo del historial?\n\nHazlo solo si ya lo enviaste "
        + "y oficina lo recibió. No se puede recuperar.")) {
        estado.envios.splice(i, 1); guardarLocal(); refrescarSync(); pintarEnvios();
      }
    };
    cont.appendChild(li);
  });
}
// Descargar el archivo a la PC/celular (sin compartir). Útil en la versión web:
// el archivo cae en Descargas y de ahí se carga al sistema de escritorio.
function descargarEnvio(i) {
  const e = estado.envios[i];
  if (!e) return;
  const blob = dataUrlToBlob(e.dataUrl);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = e.nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  e.enviado = true; guardarLocal(); pintarEnvios();
  toast("Archivo descargado: " + e.nombre, "ok");
}
async function enviarDeNuevo(i) {
  const e = estado.envios[i];
  if (!e) return;
  const ok = await compartirEnvio(e);
  if (ok) { e.enviado = true; await guardarLocal(); pintarEnvios(); }
}

// ---------- Exportar paquete .prosol ----------
function dataUrlToUint8(dataUrl) {
  const b64 = dataUrl.split(",")[1];
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
async function exportarPaquete() {
  if (!estado.ordenes.length) { toast("No hay órdenes para enviar.", "err"); return; }
  const pid = uid(12);
  const zip = new JSZip();
  const ordenesSer = estado.ordenes.map(o => { const c = { ...o }; delete c._fotos; return c; });
  const ordenesTxt = JSON.stringify(ordenesSer, null, 2);
  const generado = new Date().toISOString().slice(0, 19).replace("T", " ");
  const manifiesto = {
    version: FORMATO, id_paquete: pid, tecnico: estado.tecnico,
    generado, cantidad: estado.ordenes.length,
  };
  zip.file("manifiesto.json", JSON.stringify(manifiesto, null, 2));
  zip.file("ordenes.json", ordenesTxt);
  zip.file("verificacion.txt", await sha256Hex(ordenesTxt));
  const carpeta = zip.folder("fotos");
  estado.ordenes.forEach(o => (o._fotos || []).forEach(f => {
    carpeta.file(f.nombre, dataUrlToUint8(f.dataUrl));
  }));
  const dataUrl = await zip.generateAsync({ type: "base64", compression: "DEFLATE" })
    .then(b64 => "data:application/zip;base64," + b64);
  const nombre = `PROSOL_${(estado.tecnico.split(" ")[0] || "tecnico")}_${hoyISO()}_${pid.slice(0,4)}.zip`;
  // Guardar en el HISTORIAL DE ENVÍOS (no se pierde nunca)
  const envio = {
    id: pid, nombre, generado,
    numeros: estado.ordenes.map(o => o.NUMERO_OT).filter(Boolean),
    cantidad: estado.ordenes.length,
    dataUrl,                 // el archivo completo guardado
    enviado: false,
  };
  estado.envios.unshift(envio);
  // Marcar en el historial permanente las órdenes que van en este archivo
  const nums = new Set(estado.ordenes.map(o => o.NUMERO_OT));
  estado.historial.forEach(h => { if (nums.has(h.NUMERO_OT)) h._enviada = true; });
  // Las órdenes ya quedaron guardadas DENTRO del archivo generado y en el historial.
  // Se quitan de "pendientes" para no volver a empaquetarlas.
  estado.ordenes = [];
  await guardarLocal();
  refrescarSync();
  toast("Archivo creado y guardado abajo. Ahora compártelo a oficina.", "ok");
  // intentar compartir de una vez
  await compartirEnvio(envio);
  pintarPendientes();
  ir("enviar");
}

function dataUrlToBlob(dataUrl) {
  const b64 = dataUrl.split(",")[1];
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: "application/zip" });
}

async function compartirEnvio(envio) {
  const blob = dataUrlToBlob(envio.dataUrl);
  const file = new File([blob], envio.nombre, { type: "application/octet-stream" });
  // Compartir nativo (WhatsApp aparece en la hoja para enviarlo como documento)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Órdenes PROSOL",
        text: `Órdenes de ${envio.tecnico || estado.tecnico} (${envio.cantidad}).` });
      return true;
    } catch (e) { /* canceló o no soportado: descargamos */ }
  }
  // Descargar como respaldo (queda en el celular para adjuntarlo manual a WhatsApp)
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = envio.nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast("Archivo descargado. Adjúntalo en WhatsApp como Documento.", "ok");
  return false;
}

// ---------- Hoja: elegir equipo ----------
function abrirSheetEquipo() {
  if (!estado.catalogo) { toast("Primero carga el catálogo de oficina.", "err"); return; }
  $("#sheet-buscar").value = ""; pintarSheet(""); $("#sheet-equipo").hidden = false;
  setTimeout(() => $("#sheet-buscar").focus(), 50);
}
function pintarSheet(q) {
  const ul = $("#sheet-lista"); ul.innerHTML = "";
  equiposFiltrados(q).slice(0, 200).forEach(e => {
    const cli = clientePorId(e.ID_CLIENTE);
    const li = document.createElement("li"); li.className = "row";
    li.innerHTML = `<div class="row-main">
        <div class="row-title">Serie ${e.SERIE || "—"}</div>
        <div class="row-sub">${[e.MARCA, e.MODELO].filter(Boolean).join(" ")} · ${cli?.RAZON_SOCIAL || "—"}</div>
      </div><span class="row-chev">›</span>`;
    li.onclick = () => { setEquipoOT(e); $("#sheet-equipo").hidden = true; };
    ul.appendChild(li);
  });
}

// ---------- Listeners ----------
function wire() {
  // navegación por data-go
  document.body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b) ir(b.dataset.go);
  });
  $("#btn-entrar").onclick = async () => {
    const n = ($("#login-tecnico").value || "").trim();
    if (!n) { toast("Elige tu nombre de la lista.", "err"); return; }
    estado.tecnico = n;
    // cargar órdenes y envíos guardados de ESTE técnico
    estado.ordenes = (await DB.get("ordenes::" + n)) || [];
    estado.envios = (await DB.get("envios::" + n)) || [];
    await guardarLocal();
    ir("inicio");
  };
  $("#btn-logout").onclick = async () => {
    const n = estado.ordenes.length;
    const msg = n
      ? `Vas a cerrar la sesión de ${estado.tecnico}.\n\nTus ${n} orden(es) sin enviar `
        + `quedan guardadas y reaparecen cuando vuelvas a entrar con tu nombre.\n\n¿Cerrar sesión?`
      : `¿Cerrar la sesión de ${estado.tecnico}?`;
    if (confirm(msg)) cerrarSesion();
  };
  const onCat = (e) => { if (e.target.files[0]) cargarCatalogo(e.target.files[0]); e.target.value = ""; };
  $("#file-catalogo").onchange = onCat;
  $("#login-file-catalogo").onchange = onCat;
  // BUGFIX (04-jul-2026): antes estos dos botones descargaban un
  // catalogo.zip estático subido a Netlify — un segundo proceso de
  // actualización, distinto y potencialmente desactualizado respecto
  // a "Sincronizar catálogo desde Supabase". Ahora ambos ejecutan
  // exactamente el mismo proceso en vivo (window._prosolSincronizarCatalogoSupabase,
  // definido fuera del IIFE en initSupabase()) — un solo camino, siempre.
  const _sincronizarUnico = () => {
    if (window._prosolSincronizarCatalogoSupabase) {
      window._prosolSincronizarCatalogoSupabase();
    } else {
      toast("Todavía cargando, espera un segundo e intenta de nuevo.", "err");
    }
  };
  $("#login-btn-fijo").onclick = _sincronizarUnico;
  $("#btn-actualizar-cat").onclick = _sincronizarUnico;
  $("#buscar-equipo").oninput = () => pintarEquipos();
  $("#buscar-prog").oninput = () => pintarProgramaciones();
  if ($("#buscar-hist")) $("#buscar-hist").oninput = () => pintarHistorial();
  if ($("#sheet-orden-close")) $("#sheet-orden-close").onclick = () => $("#sheet-orden").hidden = true;
  if ($("#btn-orden-reenviar")) $("#btn-orden-reenviar").onclick = reenviarOrdenIndividual;
  if ($("#btn-orden-whatsapp")) $("#btn-orden-whatsapp").onclick = enviarOrdenWhatsApp;
  if ($("#btn-orden-confirmar")) $("#btn-orden-confirmar").onclick = toggleConfirmada;
  $("#btn-ot-desde-eq").onclick = () => nuevaOT(estado._equipoActual);
  $("#btn-nueva-ot").onclick = () => {
    if (!estado.catalogo) { toast("Primero carga el catálogo de oficina.", "err"); return; }
    nuevaOT(null);
  };
  if ($("#btn-ubicacion")) $("#btn-ubicacion").onclick = capturarUbicacion;
  $("#btn-elegir-equipo").onclick = abrirSheetEquipo;
  if ($("#btn-qr-equipo")) $("#btn-qr-equipo").onclick = abrirEscanerQR;
  if ($("#sheet-qr-close")) $("#sheet-qr-close").onclick = cerrarEscanerQR;
  if ($("#qr-manual-btn")) $("#qr-manual-btn").onclick = () => {
    const v = $("#qr-manual").value.trim();
    if (v) { cerrarEscanerQR(); usarSerieEscaneada(v); }
  };
  $("#sheet-equipo-close").onclick = () => $("#sheet-equipo").hidden = true;
  $("#sheet-buscar").oninput = (e) => pintarSheet(e.target.value);
  $("#btn-add-act").onclick = () => {
    const v = $("#ot-act-nueva").value.trim();
    if (v) {
      estado.actividades.push({ tipo: "adicional", texto: v });
      $("#ot-act-nueva").value = ""; pintarActividades();
    }
  };
  $("#ot-act-nueva").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btn-add-act").click(); });
  $("#ot-tipo").addEventListener("change", cargarActividadesDelTipo);
  $("#file-foto").onchange = async (e) => {
    for (const f of e.target.files) {
      const d = await procesarFoto(f);
      if (d) estado.fotos.push({ nombre: "f" + uid(6) + ".jpg", dataUrl: d });
    }
    pintarFotos(); e.target.value = "";
  };
  $("#btn-limpiar-firma").onclick = limpiarFirma;
  $("#btn-guardar-ot").onclick = guardarOT;
  $("#btn-cancelar-ot").onclick = () => {
    // Si hay datos escritos, confirmar para no perder el trabajo
    const hayDatos = $("#ot-numero").value.trim() || estado._otEquipo ||
      estado.fotos.length || $("#ot-obs").value.trim() ||
      (firma && firma.tieneTrazo);
    if (hayDatos && !confirm("¿Descartar esta orden sin guardar?\n\nSe perderá lo que escribiste.")) return;
    ir("inicio");
  };
  $("#btn-exportar").onclick = exportarPaquete;
  window.addEventListener("resize", ajustarFirma);
}

// ---------- Recibir catálogo compartido desde WhatsApp (share_target) ----------
async function revisarArchivoCompartido() {
  // Cuando se comparte un archivo a la app, llega como POST multipart al SW,
  // que lo guarda temporalmente y nos avisa. También soportamos ?share al abrir.
  try {
    if (location.search.includes("share")) {
      const r = await caches.match("/__shared__");
      if (r) {
        const blob = await r.blob();
        await caches.open("prosol-share").then(c => c.delete("/__shared__")).catch(() => {});
        await cargarCatalogo(blob);
        history.replaceState({}, "", "./index.html");
      }
    }
  } catch (e) { /* sin share, normal */ }
}

// ---------- Login: combo de técnicos del catálogo ----------
function nombreTecnico(t) {
  return [t.NOMBRES, t.APELLIDOS].filter(Boolean).join(" ").trim()
    || t.NOMBRE || t.CODIGO || "Técnico";
}
function pintarLogin() {
  const hayCat = !!estado.catalogo;
  $("#login-sin-cat").hidden = hayCat;
  $("#login-con-cat").hidden = !hayCat;
  const vtag = $("#app-version-login");
  if (vtag) vtag.textContent = "Versión " + APP_VERSION;
  if (!hayCat) return;
  // llenar combo con técnicos del catálogo
  const sel = $("#login-tecnico"); sel.innerHTML = "";
  const tecnicos = (estado.catalogo.tecnicos || []).map(nombreTecnico)
    .filter(Boolean).sort((a, b) => a.localeCompare(b));
  if (!tecnicos.length) {
    const o = document.createElement("option");
    o.value = ""; o.textContent = "(El catálogo no trae técnicos)"; sel.appendChild(o);
  } else {
    const ph = document.createElement("option");
    ph.value = ""; ph.textContent = "— Elige tu nombre —"; sel.appendChild(ph);
    tecnicos.forEach(n => {
      const o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o);
    });
    if (estado.tecnico && tecnicos.includes(estado.tecnico)) sel.value = estado.tecnico;
  }
  const r = estado.catalogo.resumen || {};
  $("#login-cat-info").textContent =
    `Catálogo del ${(estado.catalogo.generado || "").slice(0,10)} · ${tecnicos.length} técnico(s).`;
}

// ---------- Abrir archivo con la app (file_handlers / launchQueue) ----------
function escucharArchivosEntrantes() {
  try {
    if ("launchQueue" in window) {
      window.launchQueue.setConsumer(async (params) => {
        if (!params || !params.files || !params.files.length) return;
        try {
          const file = await params.files[0].getFile();
          await cargarCatalogo(file);
        } catch (e) { toast("No se pudo abrir el archivo.", "err"); }
      });
    }
  } catch (e) { /* navegador sin soporte */ }
}

// ---------- Arranque ----------
const APP_VERSION = "v3.43";
async function init() {
  try { await DB.open(); } catch (e) { /* sin IndexedDB seguimos en memoria */ }
  await cargarLocal();
  const lib = liberarFotosViejas();
  if (lib) await guardarLocal();
  wire(); initFirma(); refrescarSync();
  ir(estado.tecnico ? "inicio" : "login");
  pintarLogin();
  escucharArchivosEntrantes();
  await revisarArchivoCompartido();
  // Aviso al cerrar/recargar si hay órdenes sin empaquetar o archivos sin enviar
  window.addEventListener("beforeunload", (ev) => {
    const sinEnviar = estado.ordenes.length;
    const archivosSinEnviar = estado.envios.filter(e => !e.enviado).length;
    if (sinEnviar > 0 || archivosSinEnviar > 0) {
      ev.preventDefault(); ev.returnValue = "";
      return "";
    }
  });
  const vtag = $("#app-version"); if (vtag) vtag.textContent = "Versión " + APP_VERSION;
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.register("service-worker.js");
      // Revisa si hay una versión nueva cada vez que se abre la app
      reg.update();
      // Cuando el nuevo service worker toma control, recarga para mostrar lo nuevo
      let recargado = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (recargado) return; recargado = true; location.reload();
      });
      // Si encuentra una versión nueva esperando, la activa de inmediato
      reg.addEventListener("updatefound", () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener("statechange", () => {
          if (nuevo.state === "installed" && navigator.serviceWorker.controller) {
            nuevo.postMessage("activar-ya");
          }
        });
      });
    } catch (e) { /* sin SW seguimos igual */ }
  }
}
// En PC (≥700px) la controla prosol_web.js
if (window.innerWidth < 700) {
  init().then(() => {
    // Inicializar integración Supabase después del arranque
    try { initSupabase(); } catch(e) { console.error('initSupabase:', e); }
  }).catch(e => { console.error('init:', e); });
}
// Exponer funciones internas para que initSupabase (fuera de IIFE) pueda usarlas
window._prosolGuardarLocal = guardarLocal;
window._prosolPintarLogin  = pintarLogin;
window._prosolRefrescarSync = refrescarSync;
})();

// ══════════════════════════════════════════════════════════════
// INTEGRACIÓN SUPABASE — Agregado sobre v16 sin modificar nada
// ══════════════════════════════════════════════════════════════

// Toast global accesible fuera de la IIFE
function toastG(msg, tipo) {
  const t = document.getElementById('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = msg; t.className = 'toast ' + (tipo||'');
  t.hidden = false;
  clearTimeout(toastG._t);
  toastG._t = setTimeout(() => { t.hidden = true; }, 2600);
}

// Inicializar listeners de Supabase al arrancar
function initSupabase() {
  // Config panel en login
  const btnCfg = document.getElementById('btn-cfg-supabase');
  if (btnCfg) {
    btnCfg.addEventListener('click', () => {
      const panel = document.getElementById('supabase-cfg-movil');
      if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
  }

  // Cargar credenciales guardadas en los campos
  const urlInp = document.getElementById('sb-url-movil');
  const keyInp = document.getElementById('sb-key-movil');
  if (urlInp && typeof API !== 'undefined') {
    const info = API.infoNube ? API.infoNube() : {};
    if (info && info.url) urlInp.value = info.url;
  }

  // Guardar credenciales
  const btnGuardar = document.getElementById('sb-guardar-movil');
  if (btnGuardar) {
    btnGuardar.addEventListener('click', () => {
      const url = (urlInp ? urlInp.value : '').trim().replace(/\/+$/, '');
      const key = (keyInp ? keyInp.value : '').trim();
      const msg = document.getElementById('sb-msg-movil');
      if (!url || !key) { if (msg) msg.textContent = '⚠ Completa URL y anon key'; return; }
      if (typeof API !== 'undefined') API.configurar(url, key);
      if (msg) msg.textContent = '✅ Credenciales guardadas';
      toastG('✅ Credenciales Supabase guardadas', 'ok');
    });
  }

  // Probar conexión
  const btnProbar = document.getElementById('sb-probar-movil');
  if (btnProbar) {
    btnProbar.addEventListener('click', async () => {
      const msg = document.getElementById('sb-msg-movil');
      if (msg) msg.textContent = '⏳ Probando...';
      try {
        if (typeof API === 'undefined' || !API.hayNube()) {
          if (msg) msg.textContent = '⚠ Guarda las credenciales primero';
          return;
        }
        await API.probarNube();
        if (msg) msg.textContent = '✅ Conexión OK con Supabase';
        toastG('✅ Conexión OK', 'ok');
      } catch(e) {
        if (msg) msg.textContent = '❌ ' + e.message;
        toastG('❌ ' + e.message, 'err');
      }
    });
  }

  // Sincronizar catálogo desde Supabase — ÚNICO proceso de actualización
  // de catálogo en toda la app (04-jul-2026). Antes existían DOS caminos
  // distintos apuntando a cosas diferentes: este (datos en vivo desde
  // Supabase) y "Actualizar catálogo (URL fija)" (un catalogo.zip
  // estático subido a Netlify, que podía quedar desactualizado sin que
  // nadie lo notara). Se unificaron en una sola función, expuesta
  // globalmente, para que los 3 botones que actualizan catálogo (login
  // por URL fija, "Actualizar catálogo" e "Sincronizar desde Supabase")
  // ejecuten EXACTAMENTE el mismo proceso, siempre.
  async function sincronizarCatalogoDesdeSupabase() {
    if (typeof API === 'undefined' || !API.hayNube()) {
      // Mostrar panel de config
      const panel = document.getElementById('supabase-cfg-movil');
      if (panel) panel.style.display = 'block';
      ir('login');
      toastG('Configura Supabase primero', 'err');
      return;
    }
    toastG('☁ Sincronizando catálogo desde Supabase…', 'ok');
    try {
      toastG('☁ Descargando las 6 tablas desde Supabase…', '');
      const [eq, cli, tec, prog, acts, actItems, ots] = await Promise.all([
        API.select('equipos').catch(() => []),
        API.select('clientes').catch(() => []),
        API.select('tecnicos').catch(() => []),
        API.select('visitas_programadas').catch(() => []),
        API.select('actividades').catch(() => []),
        API.select('actividad_items').catch(() => []),
        API.select('ordenes').catch(() => [])
      ]);

      const _e = window._prosolEstado;
      if (!_e) { toastG('❌ Error interno: app no inicializada', 'err'); return; }
      if (!_e.catalogo) _e.catalogo = {};

      // 1. Equipos
      _e.catalogo.equipos = eq.map(e => ({
        ID_EQUIPO: e.id_escritorio || e.id,
        SERIE: e.serie || '', CODIGO: e.codigo || '',
        ID_CLIENTE: e.id_cliente, MARCA: e.marca || 'GENERAC',
        MODELO: e.modelo || '', POTENCIA_KW: e.potencia_kw,
        UBICACION: e.ubicacion || '', ESTADO: e.estado || 'ACTIVO',
        NOMBRE_EQUIPO: (e.marca||'GENERAC') + ' ' + (e.modelo||e.serie||'')
      }));

      // 2. Clientes
      _e.catalogo.clientes = cli.map(c2 => ({
        ID_CLIENTE: c2.id_escritorio || c2.id,
        RAZON_SOCIAL: c2.razon_social || '',
        CONTACTO: c2.contacto || '', TELEFONO: c2.telefono || '',
        CIUDAD: c2.ciudad || '', CIUDAD_EQUIPO: c2.ciudad || ''
      }));

      // 3. Técnicos
      _e.catalogo.tecnicos = tec.map(t => ({
        ID_TECNICO: t.id_escritorio || t.id,
        NOMBRES: t.nombres || '', APELLIDOS: t.apellidos || '',
        NOMBRE_COMPLETO: ((t.nombres||'') + ' ' + (t.apellidos||'')).trim()
      }));

      // 4. Visitas programadas
      _e.catalogo.programaciones = prog.map(p => ({
        ID_VISITA: p.id_escritorio || p.id,
        ID_SB: p.id,
        ID_EQUIPO: p.id_equipo, SERIE: p.serie || '',
        ID_CLIENTE: p.id_cliente,
        FECHA_PROGRAMADA: p.fecha_programada || '',
        TIPO_MANTENIMIENTO: p.tipo_mantenimiento || '',
        OBSERVACION: p.observacion || '', ESTADO: p.estado || 'PROGRAMADA'
      }));

      // 5. Actividades y combos desde Supabase
      // TODAS las actividades (COMBO e INDIVIDUAL) van al selector de tipo
      // Los COMBO pre-cargan sus ítems; los INDIVIDUAL se seleccionan solos
      const combosObj = {};
      acts.forEach(a => {
        if ((a.tipo||'').toUpperCase() === 'COMBO') {
          // Buscar ítems de este combo en actividad_items
          const items = actItems
            .filter(i => i.id_actividad === a.id)
            .sort((x, y) => (x.orden||0) - (y.orden||0))
            .map(i => i.descripcion || '');
          combosObj[a.descripcion] = items;
        } else {
          // INDIVIDUAL: el ítem es la actividad misma
          combosObj[a.descripcion] = [a.descripcion];
        }
      });
      // Ordenar: primero COMBOs, luego INDIVIDUALes, ambos alfabéticamente
      const combosOrden = acts
        .filter(a => (a.tipo||'').toUpperCase() === 'COMBO')
        .map(a => a.descripcion);
      const indivOrden = acts
        .filter(a => (a.tipo||'').toUpperCase() !== 'COMBO')
        .map(a => a.descripcion)
        .sort();
      _e.catalogo.tipos_mantenimiento = acts.length > 0
        ? [...combosOrden, ...indivOrden]
        : ['MANTENIMIENTO GENERAL', 'MANTENIMIENTO CORRECTIVO',
           'MANTENIMIENTO INTERNO', 'MANTENIMIENTO EXTERNO',
           'ARRANQUE INICIAL', 'VISITA EXPRESS + CAMBIO DE ACEITE'];
      _e.catalogo.combos = combosObj;

      // 6. Historial OT desde Supabase (origen=ESCRITORIO para el historial completo)
      // Incluye tanto las del escritorio como las del campo ya importadas
      _e.catalogo.historial_ot = ots.map(o => ({
        ID_OT: o.id_escritorio || o.id,
        NUMERO_OT: o.numero_ot || '',
        FECHA: o.fecha || '',
        SERIE: o.serie || '',
        ID_CLIENTE: o.id_cliente,
        TIPO_OT: o.tipo_ot || '',
        ESTADO: o.estado || '',
        TRABAJO_REALIZADO: o.trabajo_realizado || '',
        HORAS_MAQUINA: o.horas_maquina || null,
        VALOR_TOTAL: o.valor_total || 0,
        ORIGEN: o.origen || 'ESCRITORIO',
        ACTIVIDADES: []
      }));

      _e.catalogo.generado = new Date().toISOString().slice(0, 10);
      _e.catalogo.resumen = {
        equipos: eq.length, clientes: cli.length,
        tecnicos: tec.length, programaciones: prog.length,
        actividades: acts.length, historial_ot: ots.length
      };
      await (window._prosolGuardarLocal || (async()=>{}))();
      (window._prosolPintarLogin || (()=>{}))(); (window._prosolRefrescarSync || (()=>{}))();
      toastG('✅ Catálogo sincronizado: ' + eq.length + ' equipos · ' +
             acts.length + ' actividades · ' + ots.length + ' OT historial', 'ok');
    } catch(e) {
      toastG('❌ Error sync: ' + e.message, 'err');
    }
  }
  // Expuesta globalmente: la usan también los botones del IIFE v16
  // (login por URL fija y "Actualizar catálogo"), que antes usaban un
  // catalogo.zip estático — ahora ejecutan este mismo proceso en vivo.
  window._prosolSincronizarCatalogoSupabase = sincronizarCatalogoDesdeSupabase;

  const btnSync = document.getElementById('btn-sync-supabase');
  if (btnSync) {
    btnSync.addEventListener('click', sincronizarCatalogoDesdeSupabase);
  }

  // Subir OT pendientes a Supabase
  const btnSubir = document.getElementById('btn-subir-ot-supabase');
  if (btnSubir) {
    // M7: la subida (estado por OT, sin duplicar, reintento) vive en envio_estado.js
    btnSubir.addEventListener('click', () => {
      if (window._prosolSubirPendientes) window._prosolSubirPendientes();
      else toastG('Todavía cargando, espera un segundo e intenta de nuevo.', 'err');
    });
  }
}

// Llamar al arranque
const _origInit = typeof init === 'function' ? init : null;


// ══════════════════════════════════════════════════════════════
// MÓDULOS NUEVOS MÓVIL v3.22 — Panel, Clientes, Inventario,
// Reportes, WhatsApp, Configuración — carga datos desde Supabase
// ══════════════════════════════════════════════════════════════

// CSS para módulos nuevos
(function(){
  const s = document.createElement('style');
  s.textContent = `
    .kpi-m{background:#fff;border-radius:10px;padding:12px;text-align:center;
      border-left:3px solid #1C2733;box-sizing:border-box}
    .kpi-m.ok{border-left-color:#27AE60}.kpi-m.warn{border-left-color:#F39C12}
    .kpi-m-v{font-size:26px;font-weight:800;color:#1C2733}
    .kpi-m-l{font-size:11px;color:#5A6B7B;margin-top:2px}
    #m-kpis{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px}
    .m-item{padding:10px 0;border-bottom:1px solid #eee}
    .m-item:last-child{border-bottom:none}
    .m-item-title{font-size:14px;font-weight:600;color:#1C2733}
    .m-item-sub{font-size:12px;color:#5A6B7B;margin-top:2px}
    .m-tag{display:inline-block;padding:1px 7px;border-radius:8px;font-size:11px;font-weight:700}
    .m-tag.ok{background:#27AE6022;color:#27AE60}
    .m-tag.warn{background:#E74C3C22;color:#E74C3C}
    .m-tag.info{background:#3498DB22;color:#3498DB}
    .m-empty{color:#888;font-size:13px;padding:16px;text-align:center}
    .m-no-data{color:#E74C3C;font-size:12px;padding:8px;background:#FFF5F5;border-radius:8px;margin-top:8px}
  `;
  document.head.appendChild(s);
})();

// Cache de datos de Supabase para evitar múltiples requests
const _cache = {};
async function _getData(tabla) {
  if (_cache[tabla]) return _cache[tabla];
  if (typeof API === 'undefined' || !API.hayNube()) return [];
  try {
    _cache[tabla] = await API.select(tabla);
    return _cache[tabla];
  } catch(e) { return []; }
}

function _invalidarCache() { Object.keys(_cache).forEach(k => delete _cache[k]); }

// Sistema de navegación que intercepta data-go clicks (funciona fuera de la IIFE)
document.addEventListener('click', async function(e) {
  // Buscar el botón con data-go más cercano
  const btn = e.target.closest('[data-go]');
  if (!btn) return;
  const pantalla = btn.getAttribute('data-go');

  // Esperar un tick para que v16 aplique la clase active
  setTimeout(() => _onPantallaActiva(pantalla), 100);
}, true); // capture=true para interceptar antes que v16

async function _onPantallaActiva(pantalla) {
  switch(pantalla) {
    case 'panel-control': await _cargarPanel(); break;
    case 'clientes':      await _cargarClientes(); break;
    case 'inventario':    await _cargarInventario(); break;
    case 'reportes':      _initReportes(); break;
    case 'whatsapp-movil': await _initWhatsApp(); break;
    case 'config-movil':       _initConfig(); break;
    case 'ordenes-movil':      await _cargarOrdenesMov(); break;
    case 'programacion-movil': await _cargarProgMov(); break;
    case 'liquidacion-movil':   await _cargarLiqMov(); break;
  }
}

// ── Panel de control ─────────────────────────────────────────
async function _cargarPanel() {
  const kpis = document.getElementById('m-kpis');
  const progP = document.getElementById('m-prog-panel');
  const otP   = document.getElementById('m-ot-panel');
  if (!kpis) return;

  if (!API.hayNube()) {
    kpis.innerHTML = '<p class="m-empty">☁ Conecta Supabase en Configuración para ver datos.</p>';
    return;
  }
  kpis.innerHTML = '<p class="m-empty">⏳ Cargando…</p>';
  try {
    const [eq, cli, ord, prog] = await Promise.all([
      _getData('equipos'), _getData('clientes'),
      _getData('ordenes'), _getData('visitas_programadas')
    ]);
    const hoy = new Date().toISOString().slice(0,10);
    const ab = ord.filter(o => ['ABIERTA','EN PROCESO','PENDIENTE'].includes(o.estado||''));
    const vp = prog.filter(p => p.estado !== 'EJECUTADA' && p.estado !== 'CANCELADA');
    const costo = ord.reduce((s,o) => s+Number(o.valor_total||0), 0);

    kpis.innerHTML = [
      ['ok',   eq.length,              '⚡ Equipos Generac'],
      ['ok',   cli.length,             '👥 Clientes'],
      ['warn', ab.length,              '📋 OT abiertas'],
      ['warn', vp.length,              '📅 Visitas pendientes'],
      ['',     ord.length,             '📄 Total OT'],
      ['',     '$'+costo.toFixed(2),   '💰 Facturado'],
    ].map(([cls,v,l]) =>
      `<div class="kpi-m ${cls}"><div class="kpi-m-v">${v}</div><div class="kpi-m-l">${l}</div></div>`
    ).join('');

    // Próximas visitas
    const eqMap = {}; eq.forEach(e => eqMap[e.id]=e);
    const cliMap = {}; cli.forEach(c => cliMap[c.id]=c);
    if (progP) {
      const proximas = vp.sort((a,b)=>(a.fecha_programada||'').localeCompare(b.fecha_programada||'')).slice(0,5);
      progP.innerHTML = proximas.length ? proximas.map(p => {
        const e=eqMap[p.id_equipo]||{}, c2=cliMap[p.id_cliente]||{};
        const venc = p.fecha_programada && p.fecha_programada < hoy;
        return `<div class="m-item">
          <div class="m-item-title" style="color:${venc?'#E74C3C':'inherit'}">
            ${p.fecha_programada||'—'} ${venc?'⚠ VENCIDO':''}
          </div>
          <div class="m-item-sub">Serie: ${p.serie||e.serie||'—'} · ${p.tipo_mantenimiento||'—'}</div>
          <div class="m-item-sub">Cliente: ${c2.razon_social||'—'}</div>
          <span class="m-tag ${p.estado==='PROGRAMADA'?'warn':'ok'}">${p.estado||'PROGRAMADA'}</span>
        </div>`;
      }).join('') : '<p class="m-empty">Sin visitas pendientes.</p>';
    }

    // Últimas OT
    if (otP) {
      const ultimas = [...ord].sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')).slice(0,8);
      otP.innerHTML = ultimas.length ? ultimas.map(o => {
        const col = {'REALIZADO':'ok','EN PROCESO':'warn','POR REVISAR':'warn'}[o.estado]||'info';
        return `<div class="m-item">
          <div class="m-item-title">OT N° ${o.numero_ot||'—'} · ${o.cliente_nombre||'—'}</div>
          <div class="m-item-sub">Serie: ${o.serie||'—'} · ${o.fecha||'—'} · ${o.tipo_ot||'—'}</div>
          <span class="m-tag ${col}">${o.estado||'—'}</span>
        </div>`;
      }).join('') : '<p class="m-empty">Sin OT.</p>';
    }
  } catch(e) {
    kpis.innerHTML = `<p class="m-no-data">❌ Error: ${e.message}</p>`;
  }
}

// ── Clientes ──────────────────────────────────────────────────
async function _cargarClientes() {
  const lista  = document.getElementById('m-lista-clientes');
  let buscar = document.getElementById('m-buscar-cli');
  if (!lista) return;

  if (!API.hayNube()) {
    lista.innerHTML = '<li class="m-empty">☁ Conecta Supabase en Configuración.</li>'; return;
  }
  lista.innerHTML = '<li class="m-empty">⏳ Cargando 468 clientes…</li>';
  const todos = await _getData('clientes');

  function pintar() {
    const q = ((buscar&&buscar.value)||'').toLowerCase().trim();
    const ff = q ? todos.filter(c =>
      [c.razon_social,c.ciudad,c.zona,c.contacto,c.telefono,c.identificacion]
        .some(x => String(x||'').toLowerCase().includes(q))
    ) : todos;
    lista.innerHTML = ff.slice(0,100).map(c =>
      `<li class="row" style="padding:10px 0">
        <div class="row-main">
          <div class="row-title">${c.razon_social||'—'}</div>
          <div class="row-sub">${c.ciudad||''} ${c.zona?'· '+c.zona:''} · Tel: ${c.telefono||'—'}</div>
          <div class="row-sub">${c.contacto||''} ${c.email?'· '+c.email:''}</div>
        </div>
        <span class="m-tag ${c.estado==='ACTIVO'?'ok':'warn'}">${c.estado||'—'}</span>
      </li>`
    ).join('') || '<li class="m-empty">Sin resultados.</li>';
  }

  // Limpiar listeners anteriores y agregar nuevo
  const nuevo = buscar.cloneNode(true);
  buscar.parentNode.replaceChild(nuevo, buscar);
  buscar = nuevo; // BUGFIX: pintar() lee buscar.value; sin esto quedaba apuntando al nodo viejo (desconectado del DOM) y q siempre era ''
  nuevo.addEventListener('input', pintar);
  pintar();
}

// ── Inventario ────────────────────────────────────────────────
async function _cargarInventario() {
  const cont   = document.getElementById('m-lista-inv');
  const buscar = document.getElementById('m-buscar-inv');
  if (!cont) return;

  if (!API.hayNube()) {
    cont.innerHTML = '<p class="m-empty">☁ Conecta Supabase en Configuración.</p>'; return;
  }
  cont.innerHTML = '<p class="m-empty">⏳ Cargando inventario…</p>';
  const todos = await _getData('inventario');

  if (!todos.length) {
    cont.innerHTML = '<p class="m-empty">Sin registros de inventario.<br>Publica el inventario desde el escritorio PROSOL.</p>';
    return;
  }

  // Filtros disponibles
  const cats = [...new Set(todos.map(i=>i.categoria||'Sin categoría'))].sort();
  let filtroActivo = '';

  function pintar(q='', cat='', soloLow=false) {
    const ff = todos.filter(i => {
      const bajo = Number(i.stock||0) <= Number(i.stock_minimo||0);
      const matchQ = !q || [i.codigo_item,i.nombre_item,i.categoria]
        .some(x => String(x||'').toLowerCase().includes(q));
      const matchCat = !cat || (i.categoria||'Sin categoría') === cat;
      return matchQ && matchCat && (!soloLow || bajo);
    });
    const bajoStock = todos.filter(i => Number(i.stock||0) <= Number(i.stock_minimo||0)).length;
    cont.innerHTML = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <button onclick="_filtroInv('')" class="btn btn-ghost" style="font-size:12px;padding:4px 8px">Todos (${todos.length})</button>
        ${cats.map(c => `<button onclick="_filtroInv('${c.replace(/'/g,'')}')" class="btn btn-ghost" style="font-size:12px;padding:4px 8px">${c}</button>`).join('')}
        <button onclick="_filtroInv('','',true)" class="btn" style="font-size:12px;padding:4px 8px;background:#E74C3C22;color:#E74C3C">⚠ Bajo stock (${bajoStock})</button>
      </div>
      ${ff.slice(0,60).map(i => {
        const bajo = Number(i.stock||0) <= Number(i.stock_minimo||0);
        return `<div class="m-item">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div class="m-item-title">${i.nombre_item||'—'} <span style="font-size:11px;color:#888">${i.codigo_item||''}</span></div>
              <div class="m-item-sub">Categoría: ${i.categoria||'—'}</div>
              <div class="m-item-sub">Stock: <b style="color:${bajo?'#E74C3C':'#27AE60'}">${i.stock||0}</b> / Mín: ${i.stock_minimo||0}${bajo?' <span style="color:#E74C3C;font-weight:700">⚠ REPONER</span>':''}</div>
            </div>
            <span class="m-tag ${i.estado==='ACTIVO'?'ok':'warn'}">${i.estado||'—'}</span>
          </div>
        </div>`;
      }).join('')}
      ${ff.length > 60 ? `<p class="m-empty">…y ${ff.length-60} más. Usa el filtro para acotar.</p>` : ''}
    `;
  }

  window._filtroInv = (cat='', q='', soloLow=false) => {
    const inp = document.getElementById('m-buscar-inv');
    pintar(inp?inp.value.toLowerCase():'', cat, soloLow);
  };

  const nuevo = buscar.cloneNode(true);
  buscar.parentNode.replaceChild(nuevo, buscar);
  nuevo.addEventListener('input', () => pintar(nuevo.value.toLowerCase()));
  pintar();
}

// ── Reportes ──────────────────────────────────────────────────
function _initReportes() {
  const btnOT  = document.getElementById('m-btn-rep-ot');
  const btnGen = document.getElementById('m-btn-rep-gen');
  const out    = document.getElementById('m-rep-out');
  const inp    = document.getElementById('m-rep-num');
  if (!btnOT || !out) return;

  // Limpiar listeners previos
  const nb = btnOT.cloneNode(true); btnOT.parentNode.replaceChild(nb, btnOT);
  const ng = btnGen.cloneNode(true); btnGen.parentNode.replaceChild(ng, btnGen);

  nb.addEventListener('click', async () => {
    const num = (inp.value||'').trim(); if (!num) { toastG('⚠ Ingresa el N° de OT'); return; }
    if (!API.hayNube()) { toastG('⚠ Conecta Supabase'); return; }
    out.innerHTML = '<p class="m-empty">⏳ Buscando…</p>';
    try {
      const rows = await API.select('ordenes', {numero_ot: num});
      if (!rows.length) { out.innerHTML = '<p class="m-no-data">No se encontró OT N° '+num+'</p>'; return; }
      const o = rows[0];
      const acts = await API.select('ot_actividades', {id_orden: o.id}).catch(()=>[]);
      out.innerHTML = `
        <div style="background:#fff;border-radius:10px;padding:14px;border-left:4px solid #F5A623">
          <div class="m-item-title">OT N° ${o.numero_ot||'—'}</div>
          <div class="m-item-sub">Fecha: ${o.fecha||'—'} · Tipo: ${o.tipo_ot||'—'}</div>
          <div class="m-item-sub">Cliente: <b>${o.cliente_nombre||'—'}</b></div>
          <div class="m-item-sub">Serie: ${o.serie||'—'}</div>
          <div class="m-item-sub">Técnico: ${o.firma_realiza||'—'}</div>
          <div class="m-item-sub">Horas máq.: ${o.horas_maquina||'—'}</div>
          <span class="m-tag ${{'REALIZADO':'ok','EN PROCESO':'warn'}[o.estado]||'info'}">${o.estado||'—'}</span>
          ${o.trabajo_realizado?`<div class="m-item-sub" style="margin-top:6px"><b>Trabajo:</b> ${o.trabajo_realizado}</div>`:''}
          ${acts.length?`<div style="margin-top:6px"><b style="font-size:12px">Actividades:</b><ul style="margin:4px 0 0;padding-left:16px;font-size:12px">${acts.map(a=>`<li>${a.descripcion||''}</li>`).join('')}</ul></div>`:''}
          ${o.gps_link?`<div style="margin-top:6px"><a href="${o.gps_link}" target="_blank" style="color:#3498DB;font-size:12px">📍 Ver ubicación en Maps</a></div>`:''}
        </div>`;
    } catch(e) { out.innerHTML = '<p class="m-no-data">❌ '+e.message+'</p>'; }
  });

  ng.addEventListener('click', async () => {
    if (!API.hayNube()) { toastG('⚠ Conecta Supabase'); return; }
    const tipo = (document.getElementById('m-rep-tipo')||{}).value||'estado';
    out.innerHTML = '<p class="m-empty">⏳ Generando…</p>';
    try {
      const [ord, cli] = await Promise.all([_getData('ordenes'), _getData('clientes')]);
      const cliMap = {}; cli.forEach(c => cliMap[c.id]=c);
      const g = {};
      if (tipo === 'estado') { ord.forEach(o => {const k=o.estado||'SIN';(g[k]=g[k]||[]).push(o);}); }
      else if (tipo === 'tecnico') { ord.forEach(o => {const k=o.firma_realiza||'Sin asignar';(g[k]=g[k]||[]).push(o);}); }
      else if (tipo === 'cliente') { ord.forEach(o => {const k=(cliMap[o.id_cliente]||{}).razon_social||o.cliente_nombre||'Sin';(g[k]=g[k]||[]).push(o);}); }
      out.innerHTML = Object.entries(g).sort((a,b)=>b[1].length-a[1].length).map(([k,ots]) =>
        `<div style="background:#fff;border-radius:10px;padding:12px;margin-bottom:8px">
          <div class="m-item-title">${k} <span style="color:#888;font-size:12px">(${ots.length} OT)</span></div>
          ${ots.slice(0,5).map(o=>`<div class="m-item-sub">· N°${o.numero_ot||'—'} ${o.fecha||''} ${o.serie||''}</div>`).join('')}
          ${ots.length>5?`<div class="m-item-sub" style="color:#888">...y ${ots.length-5} más</div>`:''}
        </div>`
      ).join('') || '<p class="m-empty">Sin datos.</p>';
    } catch(e) { out.innerHTML = '<p class="m-no-data">❌ '+e.message+'</p>'; }
  });
}

// ── WhatsApp ──────────────────────────────────────────────────
async function _initWhatsApp() {
  const sel    = document.getElementById('m-wa-sel');
  const prev   = document.getElementById('m-wa-preview');
  const btnP   = document.getElementById('m-btn-wa-prev');
  const btnE   = document.getElementById('m-btn-wa-env');
  if (!sel || sel.dataset.loaded) return;
  sel.dataset.loaded = '1';

  sel.innerHTML = '<option value="">⏳ Cargando órdenes…</option>';
  let todosOrd = [];

  // Cargar OT: Supabase primero, fallback a historial local
  if (API.hayNube()) {
    todosOrd = await _getData('ordenes');
  } else if (typeof estado !== 'undefined' && estado.historial) {
    todosOrd = estado.historial;
  }

  sel.innerHTML = '<option value="">— Selecciona una OT —</option>';
  [...todosOrd].sort((a,b)=>(b.fecha||b.FECHA||'').localeCompare(a.fecha||a.FECHA||'')).slice(0,50).forEach(o => {
    const op = document.createElement('option'); op.value = o.id||o.NUMERO_OT;
    op.textContent = `N° ${o.numero_ot||o.NUMERO_OT||'—'} · ${o.cliente_nombre||o.RAZON_SOCIAL||'—'} (${o.fecha||o.FECHA||'—'})`;
    sel.appendChild(op);
  });

  const plantilla = localStorage.getItem('prosol_wa_plantilla') ||
    '— Enviado desde PROSOL · ROCKENSY S.A. & MIG — Tec. Master Luis Martínez Ibáñez · Cel: 096 701 5684';

  async function generarMensaje() {
    const id = sel.value; if (!id) return null;
    const o = todosOrd.find(x=>(x.id||x.NUMERO_OT)===id); if (!o) return null;
    const acts = API.hayNube() ? await API.select('ot_actividades',{id_orden:id}).catch(()=>[]) : (o.ACTIVIDADES||[]);
    const L = [];
    L.push('*ORDEN DE TRABAJO N° '+(o.numero_ot||o.NUMERO_OT||'—')+'*');
    L.push('Técnico: '+(o.firma_realiza||o.tecnico||(typeof estado!=='undefined'?estado.tecnico:'')||'—'));
    L.push('Cliente: '+(o.cliente_nombre||o.RAZON_SOCIAL||'—'));
    L.push('Equipo (serie): '+(o.serie||o.SERIE||'—'));
    L.push('Fecha: '+(o.fecha||o.FECHA||'—')+'   Tipo: '+(o.tipo_ot||o.TIPO_OT||'—'));
    if (o.horas_maquina||o.HORAS_MAQUINA) L.push('Horas máquina: '+(o.horas_maquina||o.HORAS_MAQUINA));
    if (acts.length) {
      L.push(''); L.push('*Actividades realizadas:*');
      acts.forEach(a => L.push('✓ '+(a.descripcion||a.DESCRIPCION||'')));
    }
    if (o.trabajo_realizado||o.TRABAJO_REALIZADO) {
      L.push(''); L.push('*Trabajo / observaciones:*');
      L.push(o.trabajo_realizado||o.TRABAJO_REALIZADO);
    }
    const lat=o.gps_lat||o.GPS_LAT, lng=o.gps_lng||o.GPS_LON;
    if (lat&&lng) { L.push(''); L.push('📍 Ubicación: https://maps.google.com/?q='+lat+','+lng); }
    L.push(''); L.push(plantilla);
    return L.join('\n');
  }

  sel.addEventListener('change', async () => {
    const msg = await generarMensaje();
    if (prev) prev.textContent = msg || 'Selecciona una OT para ver el mensaje.';
  });

  const nbP = btnP.cloneNode(true); btnP.parentNode.replaceChild(nbP, btnP);
  nbP.addEventListener('click', async () => {
    const msg = await generarMensaje();
    if (prev) prev.textContent = msg || 'Selecciona una OT.';
  });

  const nbE = btnE.cloneNode(true); btnE.parentNode.replaceChild(nbE, btnE);
  nbE.addEventListener('click', async () => {
    const msg = await generarMensaje();
    if (!msg) { toastG('⚠ Selecciona una OT'); return; }
    const tel = ((document.getElementById('m-wa-tel')||{}).value||'').replace(/\D/g,'');
    if (!tel) { toastG('⚠ Ingresa el número'); return; }
    window.open('https://wa.me/'+tel+'?text='+encodeURIComponent(msg), '_blank');
    toastG('✅ WhatsApp abierto');
  });
}

// ── Configuración ─────────────────────────────────────────────
function _initConfig() {
  const urlI = document.getElementById('m-cfg-url');
  const keyI = document.getElementById('m-cfg-key');
  const msg  = document.getElementById('m-cfg-msg');
  const ver  = document.getElementById('m-ver-cfg');
  if (!urlI || urlI.dataset.loaded) return;
  urlI.dataset.loaded = '1';

  if (ver) ver.textContent = typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'v3.22';

  // Cargar credenciales guardadas
  if (typeof API !== 'undefined') {
    const info = API.infoNube ? API.infoNube() : {};
    if (info && info.url) urlI.value = info.url;
  }

  document.getElementById('m-cfg-guardar').addEventListener('click', () => {
    const url=(urlI.value||'').trim().replace(/\/+$/,''), key=(keyI.value||'').trim();
    if (!url||!key) { if(msg) msg.textContent='⚠ Completa ambos campos'; return; }
    API.configurar(url, key);
    _invalidarCache();
    if(msg) msg.textContent='✅ Credenciales guardadas. Navega a los módulos para ver los datos.';
    toastG('✅ Guardado');
  });
  document.getElementById('m-cfg-probar').addEventListener('click', async () => {
    if(msg) msg.textContent='⏳ Probando...';
    try { await API.probarNube(); if(msg) msg.textContent='✅ Conexión OK con Supabase'; toastG('✅ OK'); }
    catch(e) { if(msg) msg.textContent='❌ '+e.message; }
  });
  document.getElementById('m-cfg-sync') && document.getElementById('m-cfg-sync').addEventListener('click', async () => {
    _invalidarCache();
    const btnS = document.getElementById('btn-sync-supabase');
    if (btnS) btnS.click(); else toastG('☁ Ve a Inicio → Sincronizar catálogo');
  });
  document.getElementById('m-cfg-subir') && document.getElementById('m-cfg-subir').addEventListener('click', async () => {
    const btnU = document.getElementById('btn-subir-ot-supabase');
    if (btnU) btnU.click(); else toastG('📤 Ve a Inicio → Subir OT');
  });
}

// ── Órdenes OT (módulo móvil desde Supabase) ─────────────────
let _todasOrdMov = [];
let _filtroOTActivo = 'abiertas';

async function _cargarOrdenesMov() {
  const cont   = document.getElementById('m-lista-ot');
  const buscar = document.getElementById('m-buscar-ot');
  const count  = document.getElementById('m-ot-count');
  if (!cont) return;

  if (!API.hayNube()) {
    cont.innerHTML = '<p class="m-empty">☁ Conecta Supabase en Configuración para ver las órdenes.</p>';
    return;
  }
  cont.innerHTML = '<p class="m-empty">⏳ Cargando órdenes…</p>';

  try {
    const [ord, cli, eq] = await Promise.all([
      _getData('ordenes'),
      _getData('clientes'),
      _getData('equipos')
    ]);
    const cliMap = {}; cli.forEach(c => cliMap[c.id] = c);
    const eqMap  = {}; eq.forEach(e  => eqMap[e.id]  = e);
    // Deduplicar por numero_ot (defensa contra duplicados en la nube)
    const _vo = {};
    ord.forEach(o => {
      const k = String(o.numero_ot || o.id);
      const prev = _vo[k];
      const sc = (x) => (x.id_equipo?2:0)+(x.id_cliente?2:0)+(x.serie?1:0)+((x.estado&&x.estado!=='POR REVISAR')?1:0);
      if (!prev || sc(o) > sc(prev)) _vo[k] = o;
    });
    _todasOrdMov = Object.values(_vo).map(o => ({
      ...o,
      _cli: (cliMap[o.id_cliente] || {}).razon_social || o.cliente_nombre || '—',
      _eq:  (eqMap[o.id_equipo]  || {}).modelo        || ''
    }));

    // Actualizar badge en inicio
    const ab = ord.filter(o => ['ABIERTA','EN PROCESO','PENDIENTE'].includes(o.estado || '')).length;
    const badge = document.getElementById('badge-ot-ab');
    if (badge) badge.textContent = ab;

    // Clonar buscar para limpiar listeners previos
    if (buscar) {
      const nb = buscar.cloneNode(true);
      buscar.parentNode.replaceChild(nb, buscar);
      nb.addEventListener('input', () => _pintarOrdenes(nb.value));
    }

    _pintarOrdenes('');
  } catch(e) {
    cont.innerHTML = '<p class="m-no-data">❌ Error: ' + e.message + '</p>';
  }
}

function _pintarOrdenes(q) {
  const cont  = document.getElementById('m-lista-ot');
  const count = document.getElementById('m-ot-count');
  if (!cont) return;

  const buscar = (q || '').toLowerCase().trim();
  const hoy = new Date().toISOString().slice(0, 10);

  let ff = _todasOrdMov.filter(o => {
    // Filtro por estado
    const est = (o.estado || '').toUpperCase();
    if (_filtroOTActivo === 'abiertas')   { if (!['ABIERTA','EN PROCESO','PENDIENTE'].includes(est)) return false; }
    if (_filtroOTActivo === 'realizadas') { if (est !== 'REALIZADO') return false; }
    if (_filtroOTActivo === 'vencidas') {
      // OT abiertas cuya fecha es anterior a hoy
      const esAb = ['ABIERTA','EN PROCESO','PENDIENTE'].includes(est);
      if (!esAb || !o.fecha || o.fecha >= hoy) return false;
    }
    // Filtro de búsqueda
    if (buscar) {
      return [o.numero_ot, o._cli, o.serie, o.tipo_ot, o.estado]
        .some(x => String(x || '').toLowerCase().includes(buscar));
    }
    return true;
  });

  // Ordenar por N° desc
  ff.sort((a, b) => Number(b.numero_ot || 0) - Number(a.numero_ot || 0));

  if (count) count.textContent = ff.length + ' órdenes' + (buscar ? ' (filtradas)' : '');

  if (!ff.length) {
    cont.innerHTML = '<p class="m-empty">Sin órdenes para este filtro.</p>';
    return;
  }

  const COLS = {
    'REALIZADO':  'ok',
    'EN PROCESO': 'warn',
    'ABIERTA':    'warn',
    'PENDIENTE':  'warn',
    'POR REVISAR':'warn',
    'CANCELADA':  'info'
  };

  const _esAdminOT = (() => {
    const nombre = (window._prosolEstado && window._prosolEstado.tecnico) || '';
    return nombre.toLowerCase().includes('luis') && nombre.toLowerCase().includes('mart');
  })();

  cont.innerHTML = ff.slice(0, 80).map(o => {
    const est = (o.estado || '—').toUpperCase();
    const col = COLS[est] || 'info';
    const venc = o.fecha && o.fecha < new Date().toISOString().slice(0,10)
                 && ['ABIERTA','EN PROCESO','PENDIENTE'].includes(est);
    const btnDel = _esAdminOT
      ? '<button class="btn" style="background:#C0392B;color:#fff;font-size:11px;padding:3px 8px;margin-top:6px" onclick="_eliminarOTMov(&quot;' + o.id + '&quot;,&quot;' + (o.numero_ot||'') + '&quot;)">🗑 Eliminar</button>'
      : '';
    return '<div class="m-item" style="border-left:3px solid ' + (venc ? '#E74C3C' : '#F5A623') + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
        '<div style="flex:1">' +
          '<div class="m-item-title">OT N° ' + (o.numero_ot || '—') + (venc ? ' <span style="color:#E74C3C;font-size:11px">⚠ ATRASADA</span>' : '') + '</div>' +
          '<div class="m-item-sub">📅 ' + (o.fecha || '—') + ' · ' + (o.tipo_ot || '—') + '</div>' +
          '<div class="m-item-sub">👤 ' + o._cli + '</div>' +
          '<div class="m-item-sub">🔧 Serie: ' + (o.serie || '—') + ' · ' + (o.firma_realiza || '—') + '</div>' +
          btnDel +
        '</div>' +
        '<span class="m-tag ' + col + '">' + (o.estado || '—') + '</span>' +
      '</div>' +
    '</div>';
  }).join('') + (ff.length > 80 ? '<p class="m-empty">…y ' + (ff.length - 80) + ' más. Usa el filtro para acotar.</p>' : '');
}

window._filtroOT = function(tipo) {
  _filtroOTActivo = tipo;
  const buscar = document.getElementById('m-buscar-ot');
  _pintarOrdenes(buscar ? buscar.value : '');
};

// ── Programación de Mantenimiento (módulo móvil desde Supabase) ─
let _todasProgMov = [];
let _filtroProgActivo = 'vencidas';

async function _cargarProgMov() {
  const cont   = document.getElementById('m-lista-prog-movil');
  const buscar = document.getElementById('m-buscar-prog');
  const count  = document.getElementById('m-prog-count');
  if (!cont) return;

  if (!API.hayNube()) {
    cont.innerHTML = '<p class="m-empty">☁ Conecta Supabase en Configuración para ver la programación.</p>';
    return;
  }
  cont.innerHTML = '<p class="m-empty">⏳ Cargando programación…</p>';

  try {
    const [prog, cli, eq] = await Promise.all([
      _getData('visitas_programadas'),
      _getData('clientes'),
      _getData('equipos')
    ]);
    const cliMap = {}; cli.forEach(c => cliMap[c.id] = c);
    const eqMap  = {}; eq.forEach(e  => eqMap[e.id]  = e);
    const hoy = new Date().toISOString().slice(0, 10);

    _todasProgMov = prog
      .filter(p => p.estado !== 'EJECUTADA' && p.estado !== 'CANCELADA')
      .map(p => {
        const c2 = cliMap[p.id_cliente] || {};
        const e2 = eqMap[p.id_equipo]   || {};
        // Calcular días restantes
        let dias = null;
        if (p.fecha_programada) {
          const diff = new Date(p.fecha_programada) - new Date(hoy);
          dias = Math.ceil(diff / (1000 * 60 * 60 * 24));
        }
        return {
          ...p,
          _cli:  c2.razon_social || '—',
          _tel:  c2.telefono     || '',
          _serie: p.serie || e2.serie || '—',
          _modelo: e2.modelo || '',
          _dias: dias
        };
      })
      .sort((a, b) => (a.fecha_programada || '').localeCompare(b.fecha_programada || ''));

    // Actualizar badge: vencidas
    const venc = _todasProgMov.filter(p => p._dias !== null && p._dias < 0).length;
    const badge = document.getElementById('badge-prog-venc');
    if (badge) badge.textContent = venc;

    // Clonar buscar
    if (buscar) {
      const nb = buscar.cloneNode(true);
      buscar.parentNode.replaceChild(nb, buscar);
      nb.addEventListener('input', () => _pintarProg(nb.value));
    }

    _pintarProg('');
  } catch(e) {
    cont.innerHTML = '<p class="m-no-data">❌ Error: ' + e.message + '</p>';
  }
}

function _pintarProg(q) {
  const cont  = document.getElementById('m-lista-prog-movil');
  const count = document.getElementById('m-prog-count');
  if (!cont) return;

  const buscar = (q || '').toLowerCase().trim();

  let ff = _todasProgMov.filter(p => {
    if (_filtroProgActivo === 'vencidas')  { if (p._dias === null || p._dias >= 0) return false; }
    if (_filtroProgActivo === 'proximas')  { if (p._dias === null || p._dias < 0 || p._dias > 21) return false; }
    if (buscar) {
      return [p._serie, p._cli, p.tipo_mantenimiento, p.fecha_programada]
        .some(x => String(x || '').toLowerCase().includes(buscar));
    }
    return true;
  });

  if (count) count.textContent = ff.length + ' registros';

  if (!ff.length) {
    cont.innerHTML = '<p class="m-empty">Sin registros para este filtro.</p>';
    return;
  }

  cont.innerHTML = ff.slice(0, 100).map(p => {
    const dias = p._dias;
    let colorBorde, etiqueta, colorEtq;
    if (dias === null) {
      colorBorde = '#95A5A6'; etiqueta = 'Sin fecha'; colorEtq = '#95A5A6';
    } else if (dias < 0) {
      colorBorde = '#E74C3C';
      etiqueta = 'VENCIDO ' + Math.abs(dias) + ' días';
      colorEtq = '#E74C3C';
    } else if (dias === 0) {
      colorBorde = '#E67E22'; etiqueta = '¡HOY!'; colorEtq = '#E67E22';
    } else if (dias <= 7) {
      colorBorde = '#E67E22'; etiqueta = 'en ' + dias + ' días'; colorEtq = '#E67E22';
    } else if (dias <= 21) {
      colorBorde = '#F5A623'; etiqueta = 'en ' + dias + ' días'; colorEtq = '#F5A623';
    } else {
      colorBorde = '#27AE60'; etiqueta = 'en ' + dias + ' días'; colorEtq = '#27AE60';
    }

    return '<div class="m-item" style="border-left:4px solid ' + colorBorde + ';margin-bottom:8px">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
        '<div style="flex:1">' +
          '<div class="m-item-title">📅 ' + (p.fecha_programada || '—') + '</div>' +
          '<div class="m-item-sub">🔧 Serie: <b>' + p._serie + '</b>' + (p._modelo ? ' · ' + p._modelo : '') + '</div>' +
          '<div class="m-item-sub">👤 ' + p._cli + (p._tel ? ' · 📞 ' + p._tel : '') + '</div>' +
          '<div class="m-item-sub">⚙ ' + (p.tipo_mantenimiento || '—') + '</div>' +
          (p.horas_programadas ? '<div class="m-item-sub">⏱ Horas prog.: ' + p.horas_programadas + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right;min-width:70px">' +
          '<span style="font-size:11px;font-weight:700;color:' + colorEtq + '">' + etiqueta + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('') + (ff.length > 100 ? '<p class="m-empty">…y ' + (ff.length - 100) + ' más. Usa el filtro para acotar.</p>' : '');
}

window._filtroProg = function(tipo) {
  _filtroProgActivo = tipo;
  const buscar = document.getElementById('m-buscar-prog');
  _pintarProg(buscar ? buscar.value : '');
};

// ── Control de acceso Liquidación ── solo Luis Alfonso (ADMIN) ────
window._liqMovMostrarTile = function() {
  const tile = document.getElementById('tile-liquidacion-movil');
  if (!tile) return;
  // estado es privado en la IIFE — acceder via window._prosolEstado
  const _e = window._prosolEstado;
  const nombre = (_e && _e.tecnico) || '';
  const esAdmin = nombre.toLowerCase().includes('luis') &&
                  nombre.toLowerCase().includes('mart');
  tile.style.display = esAdmin ? '' : 'none';
};

// ── MIS ÓRDENES — incluir últimas 50 de Supabase ─────────────────
// Este módulo ya funciona en v16 (historial local)
// Solo agregar las de Supabase si están disponibles
async function _enriquecerMisOrdenes() {
  if (!API.hayNube()) return;
  // Las OT de Supabase con origen=CAMPO del técnico actual
  // se mostrarán en el historial v16 al cargar
  // No modificar el v16 — solo asegurar que las OT subidas se reflejen
}


// ══════════════════════════════════════════════════════════════════════
// MÓDULO LIQUIDACIÓN MÓVIL — solo visible para Luis Alfonso Martínez
// ══════════════════════════════════════════════════════════════════════
let _liqMovDatos = { ots: [], liqs: [], selLiq: null };

async function _cargarLiqMov() {
  const cont = document.getElementById('liqm-lista-ot');
  if (!cont) return;
  if (!API.hayNube()) {
    cont.innerHTML = '<p class="m-empty">☁ Configura Supabase en Configuración.</p>';
    return;
  }
  cont.innerHTML = '<p class="m-empty">⏳ Cargando...</p>';
  try {
    const [ots, liqs, cli] = await Promise.all([
      API.select('ordenes').catch(() => []),
      API.select('liquidaciones').catch(() => []),
      API.select('clientes').catch(() => [])
    ]);
    const cliMap = {}; cli.forEach(c => cliMap[c.id] = c.razon_social || '');
    // Parsear ots_json para saber qué OT pertenecen a cada liq
    const liqList = liqs.map(l => ({
      ...l,
      _ots:   (() => { try { return JSON.parse(l.ots_json   || '[]'); } catch(e) { return []; } })(),
      _pagos: (() => { try { return JSON.parse(l.pagos_json || '[]'); } catch(e) { return []; } })()
    }));
    const otNumToLiqId = {};
    liqList.forEach(l => {
      (l._ots || []).forEach(o => { if (o.numero_ot) otNumToLiqId[String(o.numero_ot)] = l.id; });
    });
    // Deduplicar OT por numero_ot (defensa contra duplicados en la nube)
    const _vm = {};
    ots.forEach(o => {
      const k = String(o.numero_ot || o.id);
      const prev = _vm[k];
      const sc = (x) => (x.id_equipo?2:0)+(x.id_cliente?2:0)+(x.serie?1:0)+((x.estado&&x.estado!=='POR REVISAR')?1:0);
      if (!prev || sc(o) > sc(prev)) _vm[k] = o;
    });
    _liqMovDatos.ots = Object.values(_vm).map(o => ({
      ...o,
      _cli: cliMap[o.id_cliente] || o.cliente_nombre || '—',
      _marcada: false,
      id_liquidacion: o.id_liquidacion || otNumToLiqId[String(o.numero_ot)] || null
    }));
    _liqMovDatos.liqs = liqList;
    _liqMovDatos.selLiq = null;
    _liqMovPintarOts();
    _liqMovPintarLiqs();
  } catch(e) {
    cont.innerHTML = '<p class="m-no-data">❌ ' + e.message + '</p>';
  }
}

function _liqMovPintarOts(soloPend) {
  const cont = document.getElementById('liqm-lista-ot');
  if (!cont) return;
  let ff = _liqMovDatos.ots;
  if (soloPend) ff = ff.filter(o => !o.id_liquidacion);
  // BUGFIX: ordenar por N° OT ANTES de recortar a 100, si no el recorte toma un
  // subconjunto arbitrario (orden de llegada de Supabase, sin order=) que puede
  // excluir las OT más altas/recientes (ej. 2118, 2119, 8001).
  ff = [...ff].sort((a,b) => parseInt(b.numero_ot||'0') - parseInt(a.numero_ot||'0'));
  ff = ff.slice(0, 100);
  if (!ff.length) {
    cont.innerHTML = '<p class="m-empty">Sin órdenes para este filtro.</p>';
    _liqMovRecalcular();
    return;
  }
  // Colores por grupo de liquidación
  const MOV_COLORES = ['#E8F8F5','#EBF5FB','#FEF9E7','#F5EEF8','#EAFAF1','#FEF5E7'];
  const movColorMap = {};
  let movCI = 0;
  (_liqMovDatos.liqs||[]).forEach(l => {
    if (l.id && !movColorMap[l.id]) { movColorMap[l.id] = MOV_COLORES[movCI % MOV_COLORES.length]; movCI++; }
  });
  cont.innerHTML = ff.map(o => {
    const pend = !o.id_liquidacion;
    const marc = o._marcada;
    const ic = pend ? (marc ? '☑' : '☐') : (marc ? '🔓☑' : '🔒☐');
    const bg = pend ? '' : 'background:' + (movColorMap[o.id_liquidacion]||'#F0F0F0') + ';';
    const liqNum = pend ? '' : ((_liqMovDatos.liqs||[]).find(l=>l.id===o.id_liquidacion)||{}).numero||'';
    return '<div class="m-item" style="' + bg + 'border-left:3px solid ' + (pend ? '#F5A623' : '#27AE60') + ';cursor:pointer" onclick="_liqMovToggle(&quot;' + o.id + '&quot;)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div style="flex:1">' +
          '<div class="m-item-title">' + ic + ' OT N° ' + (o.numero_ot || '—') + '</div>' +
          '<div class="m-item-sub">📅 ' + (o.fecha || '—') + ' · ' + (o._cli) + '</div>' +
          '<div class="m-item-sub">🔧 ' + (o.serie || '—') + (liqNum ? ' · <b style="color:#117A65">Liq N°'+liqNum+'</b> <button class="btn btn-ghost" style="font-size:10px;padding:1px 6px" onclick="event.stopPropagation();_liqMovVerDesdeOT(&quot;'+o.id_liquidacion+'&quot;)">👁 Ver liquidación</button>' : '') + '</div>' +
        '</div>' +
        '<span style="font-weight:700;font-size:13px">$' + parseFloat(o.valor_total || 0).toFixed(2) + '</span>' +
      '</div>' +
    '</div>';
  }).join('');
  _liqMovRecalcular();
}

// Ir desde una OT directamente a su liquidación (sin perder el scroll manual):
// selecciona la liquidación (filtra sus OT y muestra sus abonos) y baja la
// vista hasta el rótulo de resultados.
window._liqMovVerDesdeOT = function(idLiq) {
  if (!idLiq) return;
  _liqMovSelLiq(idLiq);
  const rot = document.getElementById('liqm-rotulo');
  if (rot) rot.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// Ir directo a la lista de "Liquidaciones registradas" sin bajar manualmente
// por todo el listado de OT.
window._liqMovVerListaLiqs = function() {
  const cont = document.getElementById('liqm-lista-liqs');
  if (cont) cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window._liqMovToggle = function(id) {
  const o = _liqMovDatos.ots.find(x => x.id === id);
  if (!o) return;
  o._marcada = !o._marcada;
  _liqMovPintarOts();
};

function _liqMovRecalcular() {
  const marc = _liqMovDatos.ots.filter(o => o._marcada && !o.id_liquidacion);
  const sub = marc.reduce((s, o) => s + parseFloat(o.valor_total || 0), 0);
  const iva = Math.round(sub * 0.15 * 100) / 100;
  const el_sub = document.getElementById('liqm-sub');
  const el_iva = document.getElementById('liqm-iva');
  const el_tot = document.getElementById('liqm-tot');
  if (el_sub) el_sub.textContent = 'Subtotal: $' + sub.toFixed(2);
  if (el_iva) el_iva.textContent = 'IVA 15%: $' + iva.toFixed(2);
  if (el_tot) el_tot.textContent = 'TOTAL: $' + (sub + iva).toFixed(2);
}

function _liqMovPintarLiqs() {
  const cont = document.getElementById('liqm-lista-liqs');
  if (!cont) return;
  const liqs = _liqMovDatos.liqs || [];
  if (!liqs.length) {
    cont.innerHTML = '<p class="m-empty">Sin liquidaciones registradas.</p>';
    return;
  }
  const liqsOrd = [...liqs].sort((a,b) => parseInt(b.numero||'0') - parseInt(a.numero||'0'));
  cont.innerHTML = liqsOrd.map(l => {
    const color = l.estado === 'PAGADA' ? '#27AE60' : (parseFloat(l.saldo || 0) > 0 ? '#E74C3C' : '#888');
    return '<div class="m-item" style="border-left:3px solid ' + color + ';cursor:pointer" onclick="_liqMovSelLiq(&quot;' + l.id + '&quot;)">' +
      '<div style="display:flex;justify-content:space-between">' +
        '<div>' +
          '<div class="m-item-title">N° ' + (l.numero || '—') + ' · <span style="color:' + color + '">' + (l.estado || '') + '</span></div>' +
          '<div class="m-item-sub">📅 ' + (l.fecha_desde || '') + ' al ' + (l.fecha_hasta || '') + '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="font-weight:700">$' + parseFloat(l.total || 0).toFixed(2) + '</div>' +
          '<div style="font-size:11px;color:' + color + '">Saldo: $' + parseFloat(l.saldo || 0).toFixed(2) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

window._liqMovSelLiq = function(id) {
  _liqMovDatos.selLiq = id;
  const l = (_liqMovDatos.liqs || []).find(x => x.id === id);
  if (!l) return;
  // Filtrar OT de esta liquidación
  const rot = document.getElementById('liqm-rotulo');
  if (rot) rot.textContent = 'OT de liquidación N°' + (l.numero || '');
  _liqMovDatos.ots.forEach(o => {
    const perteneceAEstaLiq = (o.id_liquidacion === id);
    o._visible_liq = perteneceAEstaLiq;
  });
  // Mostrar sección de abonos
  const sec = document.getElementById('liqm-abonos-sec');
  if (sec) sec.style.display = '';
  const saldo = document.getElementById('liqm-saldo-txt');
  if (saldo) saldo.textContent = 'Liq N°' + (l.numero || '') + ' · Saldo: $' + parseFloat(l.saldo || 0).toFixed(2) + ' (Total $' + parseFloat(l.total || 0).toFixed(2) + ')';
  // Mostrar abonos desde pagos_json
  const abCont = document.getElementById('liqm-lista-abonos');
  if (abCont) {
    const pagos = l._pagos || [];
    abCont.innerHTML = pagos.length
      ? pagos.map(p => '<div class="m-item" style="padding:6px 8px"><span style="font-size:12px">📅 ' + (p.fecha || '') + ' · ' + (p.forma || '') + ' · <b>$' + parseFloat(p.valor || 0).toFixed(2) + '</b></span></div>').join('')
      : '<p class="m-empty" style="font-size:12px">Sin abonos registrados.</p>';
  }
  // Pintar solo las OT de esta liquidación
  const cont = document.getElementById('liqm-lista-ot');
  if (!cont) return;
  const otsLiq = (l._ots || []);
  cont.innerHTML = otsLiq.length
    ? otsLiq.map(o => '<div class="m-item" style="border-left:3px solid #27AE60">' +
        '<div class="m-item-title">OT N° ' + (o.numero_ot || '—') + '</div>' +
        '<div class="m-item-sub">📅 ' + (o.fecha || '—') + ' · ' + (o.cliente || '—') + '</div>' +
        '<div class="m-item-sub">🔧 ' + (o.serie || '—') + ' · <b>$' + parseFloat(o.valor || 0).toFixed(2) + '</b></div>' +
      '</div>').join('')
    : '<p class="m-empty">Sin OT en esta liquidación.</p>';
  if (rot) rot.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window._liqMovBuscar = function() {
  const hoy = new Date().toISOString().slice(0, 10);
  const d = new Date(hoy); d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1));
  const lunes = d.toISOString().slice(0, 10);
  const dom = new Date(d); dom.setDate(dom.getDate() + 6);
  const domingo = dom.toISOString().slice(0, 10);
  const elD = document.getElementById('liqm-desde');
  const elH = document.getElementById('liqm-hasta');
  if (elD) elD.value = lunes;
  if (elH) elH.value = domingo;
  _liqMovDatos.ots.forEach(o => {
    const en = o.fecha && o.fecha >= lunes && o.fecha <= domingo && !o.id_liquidacion;
    o._marcada = en;
  });
  const rot = document.getElementById('liqm-rotulo');
  if (rot) rot.textContent = 'Pendiente del ' + lunes + ' al ' + domingo;
  _liqMovPintarOts();
};

window._liqMovPendientes = function() {
  const rot = document.getElementById('liqm-rotulo');
  if (rot) rot.textContent = 'Órdenes PENDIENTES de liquidación';
  _liqMovPintarOts(true);
};

window._liqMovTodas = function() {
  _liqMovDatos.ots.forEach(o => o._marcada = false);
  const rot = document.getElementById('liqm-rotulo');
  if (rot) rot.textContent = 'Todas las órdenes';
  _liqMovPintarOts(false);
};

window._liqMovGenerar = async function() {
  const marc = _liqMovDatos.ots.filter(o => o._marcada && !o.id_liquidacion);
  if (!marc.length) { toastG('⚠ Marca al menos una OT pendiente', 'err'); return; }
  const desde = document.getElementById('liqm-desde')?.value || new Date().toISOString().slice(0,10);
  const hasta = document.getElementById('liqm-hasta')?.value || desde;
  const sub = marc.reduce((s,o) => s + parseFloat(o.valor_total||0), 0);
  const iva = Math.round(sub*0.15*100)/100;
  const total = Math.round((sub+iva)*100)/100;
  const numero = 'LIQ-' + Date.now().toString().slice(-6);
  try {
    const liq = await API.insert('liquidaciones', {
      numero, fecha_desde: desde, fecha_hasta: hasta,
      subtotal: sub, iva_pct: 15, iva_valor: iva,
      total, total_pagado: 0, saldo: total,
      estado: 'PENDIENTE',
      ots_json: JSON.stringify(marc.map(o=>({numero_ot:o.numero_ot,fecha:o.fecha,serie:o.serie,valor:o.valor_total,cliente:o._cli}))),
      pagos_json: '[]'
    });
    for (const o of marc) {
      await API.update('ordenes', o.id, {id_liquidacion: liq.id}).catch(()=>{});
      o.id_liquidacion = liq.id; o._marcada = false;
    }
    toastG('✅ Liquidación ' + numero + ' generada — $' + total.toFixed(2), 'ok');
    await _cargarLiqMov();
  } catch(e) { toastG('❌ ' + e.message, 'err'); }
};

window._liqMovPagar = async function() {
  const marc = _liqMovDatos.ots.filter(o => o._marcada && !o.id_liquidacion);
  if (!marc.length) { toastG('⚠ Marca al menos una OT pendiente', 'err'); return; }
  const desde = document.getElementById('liqm-desde')?.value || new Date().toISOString().slice(0,10);
  const hasta = document.getElementById('liqm-hasta')?.value || desde;
  const sub = marc.reduce((s,o) => s + parseFloat(o.valor_total||0), 0);
  const iva = Math.round(sub*0.15*100)/100;
  const total = Math.round((sub+iva)*100)/100;
  const numero = 'LIQ-' + Date.now().toString().slice(-6);
  try {
    const liq = await API.insert('liquidaciones', {
      numero, fecha_desde: desde, fecha_hasta: hasta,
      subtotal: sub, iva_pct: 15, iva_valor: iva,
      total, total_pagado: total, saldo: 0,
      estado: 'PAGADA',
      ots_json: JSON.stringify(marc.map(o=>({numero_ot:o.numero_ot,fecha:o.fecha,serie:o.serie,valor:o.valor_total,cliente:o._cli}))),
      pagos_json: JSON.stringify([{fecha:hasta,forma:'TRANSFERENCIA',valor:total}])
    });
    for (const o of marc) {
      await API.update('ordenes', o.id, {id_liquidacion: liq.id}).catch(()=>{});
      o.id_liquidacion = liq.id; o._marcada = false;
    }
    toastG('✅ Liquidación ' + numero + ' PAGADA — $' + total.toFixed(2), 'ok');
    await _cargarLiqMov();
  } catch(e) { toastG('❌ ' + e.message, 'err'); }
};

window._liqMovAbonar = async function() {
  if (!_liqMovDatos.selLiq) { toastG('⚠ Selecciona una liquidación', 'err'); return; }
  const forma = document.getElementById('liqm-pg-forma')?.value || 'EFECTIVO';
  const val   = parseFloat(document.getElementById('liqm-pg-val')?.value || 0);
  if (val <= 0) { toastG('⚠ Ingresa un valor mayor a 0', 'err'); return; }
  const l = (_liqMovDatos.liqs || []).find(x => x.id === _liqMovDatos.selLiq);
  if (!l) return;
  try {
    const nuevoPag = Math.min(parseFloat(l.total_pagado||0) + val, parseFloat(l.total||0));
    const nuevoSal = Math.max(parseFloat(l.total||0) - nuevoPag, 0);
    const nuevoEst = nuevoSal <= 0 ? 'PAGADA' : 'PARCIAL';
    const pagosList = [...(l._pagos||[]), {fecha: new Date().toISOString().slice(0,10), forma, valor: val}];
    await API.update('liquidaciones', l.id, {
      total_pagado: nuevoPag, saldo: nuevoSal, estado: nuevoEst,
      pagos_json: JSON.stringify(pagosList)
    });
    l.total_pagado = nuevoPag; l.saldo = nuevoSal; l.estado = nuevoEst; l._pagos = pagosList;
    toastG('✅ Abono de $' + val.toFixed(2) + ' registrado', 'ok');
    _liqMovPintarLiqs();
    _liqMovSelLiq(_liqMovDatos.selLiq);
  } catch(e) { toastG('❌ ' + e.message, 'err'); }
};

window._liqMovAnular = async function() {
  if (!_liqMovDatos.selLiq) { toastG('⚠ Selecciona una liquidación', 'err'); return; }
  if (!confirm('¿Anular esta liquidación? Se liberarán sus OT.')) return;
  const id = _liqMovDatos.selLiq;
  const ots = _liqMovDatos.ots.filter(o => o.id_liquidacion === id);
  for (const o of ots) {
    await API.update('ordenes', o.id, {id_liquidacion: null}).catch(()=>{});
  }
  await API.remove('liquidaciones', id).catch(()=>{});
  toastG('✅ Liquidación anulada', 'ok');
  await _cargarLiqMov();
};

window._liqMovPdf = function() {
  if (!_liqMovDatos.selLiq) { toastG('⚠ Selecciona una liquidación', 'err'); return; }
  const l = (_liqMovDatos.liqs || []).find(x => x.id === _liqMovDatos.selLiq);
  if (!l) return;
  const filas = (l._ots || []).map(o =>
    '<tr><td>' + (o.numero_ot||'') + '</td><td>' + (o.fecha||'') + '</td>' +
    '<td>' + (o.cliente||'') + '</td><td>' + (o.serie||'') + '</td>' +
    '<td style="text-align:right">$' + parseFloat(o.valor||0).toFixed(2) + '</td></tr>'
  ).join('');
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Liq ' + (l.numero||'') + '</title>' +
    '<style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse;margin:12px 0}' +
    'th{background:#1C2733;color:#fff;padding:5px 8px;text-align:left}td{padding:4px 8px;border-bottom:1px solid #eee}' +
    '.tot{font-size:14px;font-weight:700;color:#F5A623;margin-top:12px}' +
    '.pie{font-size:9px;color:#888;margin-top:24px;text-align:center}</style></head><body>' +
    '<h2>LIQUIDACIÓN N° ' + (l.numero||'') + '</h2>' +
    '<p>Periodo: ' + (l.fecha_desde||'') + ' al ' + (l.fecha_hasta||'') + ' | Estado: <b>' + (l.estado||'') + '</b></p>' +
    '<table><thead><tr><th>N° OT</th><th>Fecha</th><th>Cliente</th><th>Serie</th><th>Valor</th></tr></thead>' +
    '<tbody>' + filas + '</tbody></table>' +
    '<div class="tot">Total: $' + parseFloat(l.total||0).toFixed(2) + ' | Pagado: $' + parseFloat(l.total_pagado||0).toFixed(2) + ' | Saldo: $' + parseFloat(l.saldo||0).toFixed(2) + '</div>' +
    '<div class="pie">PROSOL — ROCKENSY S.A. & MIG — Tec. Master Luis Martínez Ibáñez</div>' +
    '</body></html>';
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); w.print(); }
};

window._liqMovTab = function(tab) {
  ['liq','fact','prof'].forEach(t => {
    const p = document.getElementById('liqm-tab-' + t);
    if (p) p.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'fact') _liqMovCargarFact();
  if (tab === 'prof') _liqMovCargarProf();
};

async function _liqMovCargarFact() {
  const cont = document.getElementById('liqm-lista-fact');
  if (!cont) return;
  const est = document.getElementById('liqm-fact-est')?.value || 'TODAS';
  try {
    let ff = await API.select('facturas').catch(() => []);
    if (est !== 'TODAS') ff = ff.filter(f => f.estado === est);
    const kpis = document.getElementById('liqm-fact-kpis');
    if (kpis) {
      const tot = ff.reduce((s,f) => s+parseFloat(f.total||0), 0);
      const sal = ff.reduce((s,f) => s+parseFloat(f.saldo||0), 0);
      kpis.textContent = 'Total: $' + tot.toFixed(2) + '  Por cobrar: $' + sal.toFixed(2);
    }
    const hoy = new Date().toISOString().slice(0,10);
    cont.innerHTML = ff.length
      ? ff.map(f => {
          const venc = f.fecha_vence && f.fecha_vence < hoy && f.estado !== 'CANCELADA';
          return '<div class="m-item" style="border-left:3px solid ' + (venc?'#E74C3C':'#27AE60') + '">' +
            '<div style="display:flex;justify-content:space-between">' +
              '<div><div class="m-item-title">' + (f.numero||'—') + ' · OT ' + (f.numero_ot||'—') + '</div>' +
              '<div class="m-item-sub">👤 ' + (f.cliente_nombre||'—') + ' · ' + (f.serie||'') + '</div>' +
              '<div class="m-item-sub">📅 ' + (f.fecha_factura||'') + (f.fecha_vence?' | Vence: '+f.fecha_vence:'') + '</div></div>' +
              '<div style="text-align:right"><div style="font-weight:700">$' + parseFloat(f.total||0).toFixed(2) + '</div>' +
              '<div style="font-size:11px;color:' + (venc?'#E74C3C':'#27AE60') + '">' + (f.estado||'') + '</div></div>' +
            '</div></div>';
        }).join('')
      : '<p class="m-empty">Sin facturas.</p>';
  } catch(e) { cont.innerHTML = '<p class="m-no-data">❌ ' + e.message + '</p>'; }
}

window._liqMovNuevaFact = function() {
  toastG('ℹ Usa la App Web PC para crear facturas completas', '');
};

async function _liqMovCargarProf() {
  const cont = document.getElementById('liqm-lista-prof');
  if (!cont) return;
  const est = document.getElementById('liqm-prof-est')?.value || 'TODAS';
  try {
    let ff = await API.select('proformas').catch(() => []);
    if (est !== 'TODAS') ff = ff.filter(p => p.estado === est);
    cont.innerHTML = ff.length
      ? ff.map(p => {
          const color = p.estado==='APROBADA'?'#1E8449':p.estado==='RECHAZADA'?'#922B21':'#2471A3';
          return '<div class="m-item" style="border-left:3px solid ' + color + '">' +
            '<div style="display:flex;justify-content:space-between">' +
              '<div><div class="m-item-title">' + (p.numero||'—') + '</div>' +
              '<div class="m-item-sub">👤 ' + (p.razon_social||'—') + ' · ' + (p.serie||'') + '</div>' +
              '<div class="m-item-sub">📅 ' + (p.fecha||'') + ' · ⚙ ' + (p.tipo_mantenimiento||'') + '</div></div>' +
              '<div style="text-align:right"><div style="font-weight:700">$' + parseFloat(p.total||0).toFixed(2) + '</div>' +
              '<div style="font-size:11px;color:' + color + '">' + (p.estado||'') + '</div></div>' +
            '</div>' +
            '<div style="display:flex;gap:4px;margin-top:4px">' +
              '<button class="btn btn-ghost" style="font-size:11px;padding:2px 6px" onclick="_liqMovProfEst(&quot;' + p.id + '&quot;,&quot;APROBADA&quot;)">✔ Aprobar</button>' +
              '<button class="btn btn-ghost" style="font-size:11px;padding:2px 6px" onclick="_liqMovProfEst(&quot;' + p.id + '&quot;,&quot;APROBADA&quot;)">✔ Aprobar</button>' +
            '</div>' +
          '</div>';
        }).join('')
      : '<p class="m-empty">Sin proformas.</p>';
  } catch(e) { cont.innerHTML = '<p class="m-no-data">❌ ' + e.message + '</p>'; }
}

window._liqMovNuevaProf = function() {
  toastG('ℹ Usa la App Web PC para crear proformas completas', '');
};

window._liqMovProfEst = async function(id, estado) {
  try {
    await API.update('proformas', id, {estado});
    toastG('✅ Estado → ' + estado, 'ok');
    _liqMovCargarProf();
  } catch(e) { toastG('❌ ' + e.message, 'err'); }
};

// ── Eliminar OT desde móvil (solo admin) ─────────────────────────────
window._eliminarOTMov = async function(id, num) {
  if (!confirm('¿Eliminar la OT N° ' + num + '? Esta acción no se puede deshacer.')) return;
  try {
    await API.remove('ot_actividades', {id_orden: 'eq.' + id}).catch(() => {});
    await API.remove('ordenes', id);
    toastG('✅ OT eliminada', 'ok');
    await _cargarOrdenesMov();
  } catch(e) { toastG('❌ ' + e.message, 'err'); }
};
