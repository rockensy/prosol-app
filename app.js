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
  solicitudes: [],       // M9-B: visitas no programadas / urgentes
  seguim: {},            // M9-C: etapas y avances por visita
  avQ: [],               // M9-C: avances pendientes de subir
  contactos: [],         // M9-C: contactos WhatsApp de la nube
  waEnv: {},             // M9-D: lotes de envío WhatsApp con estado por destinatario
  envQ: [],              // M9-D: estados de envío pendientes de subir (ot_envios)
  segQ: {},              // M13: último estado de cada seguimiento del cliente pendiente de publicar (por enlace)
  _pila: [], _pantalla: "login",
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
  setTimeout(() => { try { refrescarSync(); } catch (e) {} }, 0);   // v3.70: contador de pendientes al día
  await DB.set("tecnico", estado.tecnico);
  await DB.set("catalogo", estado.catalogo);
  await DB.set("solicitudes", estado.solicitudes);
  await DB.set("contactos_wa", estado.contactos || []);
  if (estado.tecnico) {
    await DB.set("seguim::" + estado.tecnico, estado.seguim || {});
    await DB.set("avq::" + estado.tecnico, estado.avQ || []);
    await DB.set("waenv::" + estado.tecnico, estado.waEnv || {});
    await DB.set("envq::" + estado.tecnico, estado.envQ || []);
    await DB.set("segq::" + estado.tecnico, estado.segQ || {});
    await DB.set("ordenes::" + estado.tecnico, estado.ordenes);
    await DB.set("envios::" + estado.tecnico, estado.envios);
    await DB.set("historial::" + estado.tecnico, estado.historial);
  }
}
async function cargarLocal() {
  estado.tecnico = (await DB.get("tecnico")) || "";
  estado.catalogo = (await DB.get("catalogo")) || null;
  estado.solicitudes = (await DB.get("solicitudes")) || [];
  estado.asig = (await DB.get("asig")) || {};   // M8: asignación de técnicos por visita (clave PROG:/SOL:)
  estado.contactos = (await DB.get("contactos_wa")) || [];
  const t = estado.tecnico;
  estado.seguim = t ? ((await DB.get("seguim::" + t)) || {}) : [];
  estado.avQ = t ? ((await DB.get("avq::" + t)) || []) : [];
  estado.waEnv = t ? ((await DB.get("waenv::" + t)) || {}) : {};
  estado.envQ = t ? ((await DB.get("envq::" + t)) || []) : [];
  estado.segQ = t ? ((await DB.get("segq::" + t)) || {}) : {};
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
  try { if (typeof API !== "undefined" && API.salirNube) API.salirNube(); } catch (e) {}   // M11 Fase B
  if (estado.tecnico) {
    await DB.set("ordenes::" + estado.tecnico, estado.ordenes);
    await DB.set("envios::" + estado.tecnico, estado.envios);
    await DB.set("historial::" + estado.tecnico, estado.historial);
  }
  await DB.set("tecnico", "");
  estado.tecnico = ""; estado.ordenes = []; estado.envios = []; estado.historial = [];
  estado.seguim = {}; estado.avQ = []; estado.waEnv = {}; estado.envQ = []; estado.segQ = {}; estado._hfVisto = false;
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
function hoyISO() {       // fecha LOCAL (en Ecuador, desde las 19:00 la fecha UTC ya es la de mañana)
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function toast(msg, tipo = "") {
  const t = $("#toast"); t.textContent = msg; t.className = "toast " + tipo;
  t.hidden = false; clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- Navegación ----------
// Pestañas inferiores: pantallas que cuelgan de cada una. Sin barra en login, nueva-ot,
// equipo-detalle y nueva-visita (tienen su propio pie con botones).
const TAB_DE = { inicio: "inicio", oficina: "inicio", enviar: "inicio", contactos: "inicio", programaciones: "hoy", hoy: "hoy",
  equipos: "equipos", clientes: "clientes", historial: "historial" };
const RAICES = ["inicio", "hoy", "equipos", "clientes", "historial"];
function ir(nombre, porAtras) {
  estado._pantalla = nombre;
  if (!porAtras) {                       // pila propia: el botón Atrás del celular la recorre
    if (nombre === "login" || nombre === "inicio") estado._pila = [nombre];
    else if (RAICES.includes(nombre)) estado._pila = ["inicio", nombre];
    else { const p = estado._pila = estado._pila || []; if (p[p.length - 1] !== nombre) p.push(nombre); }
  }
  $$(".screen").forEach(s => s.classList.toggle("active", s.dataset.screen === nombre));
  window.scrollTo(0, 0);
  const tb = $("#tabbar");
  if (tb) {
    tb.hidden = !(nombre in TAB_DE);
    $$("button", tb).forEach(b => b.classList.toggle("on", b.dataset.tab === TAB_DE[nombre]));
  }
  const fab = $("#fab-visita"); if (fab) fab.hidden = !(nombre === "hoy" && estado.catalogo);
  if (nombre === "equipos") pintarEquipos();
  if (nombre === "clientes") pintarClientes();
  if (nombre === "contactos") { pintarContactos(); syncContactos(); }
  if (nombre === "programaciones") pintarProgramaciones();
  if (nombre === "enviar") { pintarPendientes(); if (window._prosolRenderEnvio) window._prosolRenderEnvio(); }
  if (nombre === "historial") pintarHistorial();
  if (nombre === "oficina" || nombre === "inicio") pintarInicio();
  if (nombre === "hoy") { pintarHoy(); syncSolicitudes(); syncAsignaciones(); }
}

// ---------- Sincronización visual ----------
function refrescarSync() {
  const cat = estado.catalogo;
  const dot = $("#dot-catalogo"), txt = $("#chip-catalogo-txt");
  if (cat) {
    dot.classList.add("ok");
    txt.textContent = "Cat. " + (cat.generado || "").slice(0, 10);
  } else { dot.classList.remove("ok"); txt.textContent = "Sin catálogo"; }
  const n = pendOficina();
  // v3.70: el contador superior muestra TODO lo que falta enviar a la nube (OT, avances, seguimientos y envíos)
  const pt = pendientesTotal();
  $("#chip-pend-num").textContent = pt.total;
  const chip = $("#chip-pend-num") && $("#chip-pend-num").parentElement;
  if (chip) chip.title = pt.detalle || "Nada pendiente";
  const set = (id, v) => { const el = $("#" + id); if (el) el.textContent = v; };
  set("badge-pend", n); set("hero-pend", n); set("badge-hist", estado.historial.length);
  // insignias de las pestañas
  const tbO = $("#tab-badge-oficina"); if (tbO) { tbO.textContent = n; tbO.hidden = !n; }
  const tbH = $("#tab-badge-hoy");
  if (tbH) {
    let c = 0;
    if (cat && estado.tecnico) { const a = agendaHoy(); c = esSup() ? a.porAutorizar.length + a.urgentes.length : a.urgentes.length + a.hoy.length; }
    tbH.textContent = c; tbH.hidden = !c;
    set("badge-hoy", c);
  }
  set("badge-prog", (cat?.programaciones || []).filter(p => (p.ESTADO || "PROGRAMADA").toUpperCase() === "PROGRAMADA").length);
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
    const nube = typeof API !== "undefined" && API.hayNube();
    const partes = [];
    if (nube) {
      const p = pendOficina();
      if (p) partes.push(`${p} orden(es) por enviar a oficina` + (navigator.onLine === false ? " (se envían solas cuando haya internet)" : ""));
    } else {
      const sinEmp = estado.ordenes.length, archSinEnv = estado.envios.filter(e => !e.enviado).length;
      if (sinEmp) partes.push(`${sinEmp} orden(es) sin empaquetar`);
      if (archSinEnv) partes.push(`${archSinEnv} archivo(s) sin enviar`);
    }
    if (partes.length) {
      av.hidden = false;
      av.innerHTML = "⚠️ Tienes " + partes.join(" y ") + `. <button class="btn-mini btn-mini-verde" data-go="enviar" style="margin-left:6px">Ver / enviar</button>`;
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
// ---------- Equipos (M9-A): cliente, resumen de visitas y ficha completa ----------
const ESC = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function fmtFecha(f) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || "");
  return m ? m[3] + "/" + m[2] + "/" + m[1] : (f || "—");
}
// El cliente puede venir referenciado por código de escritorio (CLI-0072) o por el
// UUID de la nube (equipos.id_cliente). El índice acepta ambos.
let _idxCli = { ref: null, map: null };
function clientePorId(id) {
  if (!id) return null;
  const arr = estado.catalogo?.clientes || [];
  if (_idxCli.ref !== arr) {
    const m = new Map();
    arr.forEach(c => { if (c.ID_CLIENTE) m.set(c.ID_CLIENTE, c); if (c.ID_SB) m.set(c.ID_SB, c); });
    _idxCli = { ref: arr, map: m };
  }
  return _idxCli.map.get(id) || null;
}
// Historial indexado por serie, de la visita más reciente a la más antigua.
let _idxHist = { ref: null, map: null };
function historialDeSerie(serie) {
  const arr = estado.catalogo?.historial_ot || [];
  if (_idxHist.ref !== arr) {
    const m = new Map();
    arr.forEach(o => { const k = o.SERIE || ""; if (!m.has(k)) m.set(k, []); m.get(k).push(o); });
    m.forEach(v => v.sort((a, b) => (b.FECHA || "").localeCompare(a.FECHA || "")));
    _idxHist = { ref: arr, map: m };
  }
  return _idxHist.map.get(serie || "") || [];
}
function resumenEquipo(e) {
  const h = historialDeSerie(e.SERIE);
  const conHoras = h.find(o => Number(o.HORAS_MAQUINA) > 0) || null;
  let horas = null, horasFecha = null;
  if (conHoras) { horas = Number(conHoras.HORAS_MAQUINA); horasFecha = conHoras.FECHA; }
  else if (Number(e.HORAS_OPERACION) > 0) { horas = Number(e.HORAS_OPERACION); }
  return { total: h.length, ult: h[0] || null, horas, horasFecha };
}
function tituloEquipo(e) {
  const kw = Number(e.POTENCIA_KW) > 0 ? " · " + Number(e.POTENCIA_KW) + " kW" : "";
  return ([e.MARCA, e.MODELO].filter(Boolean).join(" ") || "Equipo") + kw;
}
function equiposFiltrados(q) {
  const eqs = estado.catalogo?.equipos || [];
  q = (q || "").trim().toLowerCase();
  if (!q) return eqs;
  return eqs.filter(e => {
    const cli = clientePorId(e.ID_CLIENTE);
    return [e.SERIE, e.CODIGO, e.MARCA, e.MODELO, e.POTENCIA_KW, cli?.RAZON_SOCIAL]
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
    const r = resumenEquipo(e);
    const li = document.createElement("li");
    li.className = "tw-row";
    li.innerHTML = `<span class="tw-c1">${ESC(e.SERIE) || "—"}</span>
      <span class="tw-c2">
        <div class="t2-main">${ESC(tituloEquipo(e))}</div>
        <div class="t2-sub">${ESC(cli?.RAZON_SOCIAL) || "—"}</div>
        <div class="t2-sub t2-ult">${r.ult ? "Últ. visita " + fmtFecha(r.ult.FECHA) : "Sin visitas registradas"}</div>
      </span>`;
    li.onclick = () => abrirEquipo(e);
    cont.appendChild(li);
  });
  if (!eqs.length) cont.innerHTML = `<li class="tw-empty">Sin coincidencias.</li>`;
  autoActualizarCatalogo();
}

function filaDato(k, v) {
  const vacio = v === null || v === undefined || String(v).trim() === "";
  return `<div class="eq-k">${ESC(k)}</div><div class="eq-v${vacio ? " vacio" : ""}">${vacio ? "—" : ESC(v)}</div>`;
}
function abrirEquipo(e) {
  estado._equipoActual = e;
  const cli = clientePorId(e.ID_CLIENTE);
  const r = resumenEquipo(e);
  $("#eq-titulo").textContent = "Serie " + (e.SERIE || "—");
  const tel = (cli?.TELEFONO || "").replace(/[^\d+]/g, "");
  const dirTxt = [cli?.DIRECCION, e.UBICACION, cli?.CIUDAD].filter(Boolean).join(", ");
  const mapa = dirTxt ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(dirTxt) : "";
  const ult = r.ult;
  $("#eq-datos").innerHTML = `
    <div class="row-title">${ESC(tituloEquipo(e))}</div>
    <div class="eq-cli">${ESC(cli?.RAZON_SOCIAL) || "Cliente no registrado"}</div>
    <div class="eq-acciones">
      ${tel ? `<a class="btn btn-ghost" href="tel:${ESC(tel)}">📞 Llamar</a>` : ""}
      ${mapa ? `<a class="btn btn-ghost" href="${ESC(mapa)}" target="_blank" rel="noopener">🧭 Cómo llegar</a>` : ""}
    </div>
    <h3 class="eq-h">Seguimiento</h3>
    <div class="eq-grid">
      ${filaDato("Última lectura de horas", r.horas != null ? r.horas + " h" + (r.horasFecha ? " · " + fmtFecha(r.horasFecha) : "") : "")}
      ${filaDato("Última visita", ult ? fmtFecha(ult.FECHA) + " · OT " + (ult.NUMERO_OT || "—") : "")}
      ${filaDato("Tipo realizado", ult ? (ult.TIPO_OT || "") : "")}
      ${filaDato("Visitas registradas", r.total)}
    </div>
    <h3 class="eq-h">Datos del equipo</h3>
    <div class="eq-grid">
      ${filaDato("Serie", e.SERIE)}
      ${filaDato("Código", e.CODIGO)}
      ${filaDato("Marca", e.MARCA)}
      ${filaDato("Modelo", e.MODELO)}
      ${filaDato("Potencia", Number(e.POTENCIA_KW) > 0 ? e.POTENCIA_KW + " kW" : "")}
      ${filaDato("Voltaje", e.VOLTAJE)}
      ${filaDato("Combustible", e.COMBUSTIBLE)}
      ${filaDato("Ubicación", e.UBICACION)}
      ${filaDato("Estado", e.ESTADO)}
      ${filaDato("Observación", e.OBSERVACION)}
    </div>
    <h3 class="eq-h">Cliente</h3>
    <div class="eq-grid">
      ${filaDato("Contacto", cli?.CONTACTO)}
      ${filaDato("Teléfono", cli?.TELEFONO)}
      ${filaDato("Ciudad", cli?.CIUDAD)}
      ${filaDato("Dirección", cli?.DIRECCION)}
    </div>
    <button class="btn btn-ghost btn-block" id="btn-eq-editar" style="margin-top:12px">✎ Completar datos del equipo</button>`;
  $("#btn-eq-editar").onclick = abrirEdicionEquipo;
  const hist = historialDeSerie(e.SERIE);
  const ul = $("#eq-historial"); ul.innerHTML = "";
  $("#eq-hist-vacio").hidden = hist.length > 0;
  hist.slice(0, 60).forEach(o => {
    const li = document.createElement("li"); li.className = "tl-item";
    const acts = (o.ACTIVIDADES || []).slice(0, 4).join(", ");
    const hrs = Number(o.HORAS_MAQUINA) > 0 ? " · " + Number(o.HORAS_MAQUINA) + " h" : "";
    li.innerHTML = `<div class="tl-date">${fmtFecha(o.FECHA)} · OT ${ESC(o.NUMERO_OT) || "—"}</div>
      <div class="tl-meta">${ESC(o.TIPO_OT)} · ${ESC(o.ESTADO)}${hrs}</div>
      ${acts ? `<div class="tl-acts">${ESC(acts)}</div>` : ""}
      ${o.PDF_URL ? `<a class="tl-pdf" href="${ESC(o.PDF_URL)}" target="_blank" rel="noopener" style="color:var(--azul);font-weight:600">📄 Ver orden (PDF)</a>` : ""}`;
    ul.appendChild(li);
  });
  ir("equipo-detalle");
}

// ---------- Completar datos del equipo desde el móvil (M9-A) ----------
// Lo que oficina ya cargó (_OF) prevalece y queda de solo lectura; el técnico
// solo completa vacíos. Se guarda en equipos_campo (la nube) y, sin señal, queda en cola.
const CAMPOS_EDIT = [
  ["CLIENTE_TEL", "eqe-cli-tel", "cliente_tel"], ["CONTACTO", "eqe-contacto", "contacto"],
  ["CONTACTO_TEL", "eqe-contacto-tel", "contacto_tel"], ["UBICACION", "eqe-ubic", "ubicacion"],
  ["MODELO", "eqe-modelo", "modelo"], ["POTENCIA_KW", "eqe-kw", "potencia_kw"],
  ["VOLTAJE", "eqe-voltaje", "voltaje"], ["OBSERVACION", "eqe-obs", "observacion"],
];
function abrirEdicionEquipo() {
  const e = estado._equipoActual; if (!e) return;
  const of = e._OF || [];
  CAMPOS_EDIT.forEach(([col, id]) => {
    const el = $("#" + id);
    el.value = e[col] ?? "";
    el.readOnly = of.indexOf(col) >= 0;
    el.parentElement.classList.toggle("bloq", el.readOnly);
  });
  $("#eqe-titulo").textContent = "Serie " + (e.SERIE || "");
  $("#sheet-eq-edit").hidden = false;
}
const COLA_EQ = "prosol_eqcampo_cola";
function leerColaEq() { try { return JSON.parse(localStorage.getItem(COLA_EQ) || "{}"); } catch (x) { return {}; } }
function escribirColaEq(c) { try { localStorage.setItem(COLA_EQ, JSON.stringify(c)); } catch (x) { /* sin almacenamiento */ } }
async function subirEdicionesEquipo() {
  const cola = leerColaEq(); const series = Object.keys(cola);
  if (!series.length || typeof API === "undefined" || !API.hayNube() || !navigator.onLine) return 0;
  let ok = 0;
  for (const serie of series) {
    try {
      const it = cola[serie];
      const ya = await API.select("equipos_campo", { serie });
      const fila = Object.assign({}, it.d, { actualizado_por: it.por || "", actualizado: new Date().toISOString() });
      if (ya && ya.length) await API.update("equipos_campo", ya[0].id, fila);
      else await API.insert("equipos_campo", Object.assign({ serie, id_equipo: it.id_sb || null }, fila));
      const c2 = leerColaEq(); delete c2[serie]; escribirColaEq(c2); ok++;
    } catch (x) { /* queda en cola para el próximo intento */ }
  }
  return ok;
}
window._prosolSubirEdicionesEquipo = subirEdicionesEquipo;
// v3.49: la ubicación de cada servicio queda como la ubicación vigente del equipo (siempre se actualiza)
function registrarGpsEquipo(e, lat, lng) {
  if (!e || !e.SERIE || isNaN(lat) || isNaN(lng)) return;
  const f = new Date().toISOString();
  e.GPS_LAT = lat; e.GPS_LNG = lng; e.GPS_FECHA = f;
  const cola = leerColaEq();
  cola[e.SERIE] = { d: Object.assign((cola[e.SERIE] || {}).d || {}, { gps_lat: lat, gps_lng: lng, gps_fecha: f }), por: estado.tecnico, id_sb: e.ID_SB || null };
  escribirColaEq(cola);
  subirEdicionesEquipo();
}
async function guardarDatosEquipo() {
  const e = estado._equipoActual; if (!e) return;
  const of = e._OF || [];
  const d = {};
  CAMPOS_EDIT.forEach(([col, id, nube]) => {
    if (of.indexOf(col) >= 0) return;               // lo de oficina no se toca
    let v = $("#" + id).value.trim();
    if (col === "POTENCIA_KW") { v = v === "" ? null : Number(String(v).replace(",", ".")); if (v !== null && !(v >= 0)) v = null; }
    e[col] = v === null ? e[col] : v; d[nube] = v === "" ? null : v;
  });
  const cola = leerColaEq();
  cola[e.SERIE] = { d: Object.assign((cola[e.SERIE] || {}).d || {}, d), por: estado.tecnico, id_sb: e.ID_SB || null };
  escribirColaEq(cola);
  await guardarLocal();
  $("#sheet-eq-edit").hidden = true;
  if (estado._eqEditDesde === "ot") { estado._eqEditDesde = null; pintarSitioOT(); } else abrirEquipo(e);
  const n = await subirEdicionesEquipo();
  toast(n ? "Datos guardados en la nube." : "Guardado en tu teléfono; se subirá cuando haya señal.", n ? "ok" : "");
}

// ---------- Geolocalización de la orden ----------
let _ubicacionOT = null;
function capturarUbicacion(despues) {
  const seguir = typeof despues === "function" ? despues : null;
  if (!("geolocation" in navigator)) {
    toast("Tu teléfono no permite ubicación.", "err"); if (seguir) seguir(); return;
  }
  $("#ot-ubicacion").value = "Obteniendo ubicación…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude.toFixed(6);
      const lon = pos.coords.longitude.toFixed(6);
      _ubicacionOT = { lat, lon };
      $("#ot-ubicacion").value = lat + ", " + lon;
      toast("Ubicación capturada.", "ok");
      if (seguir) seguir();
    },
    (err) => {
      $("#ot-ubicacion").value = "";
      toast("No se pudo obtener la ubicación. Activa el GPS y permite el acceso.", "err");
      if (seguir) seguir();
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

// ---------- Escáner QR de equipos ----------
let qrStream = null, qrLoop = null;
async function abrirEscanerQR(cb) {
  estado._pickCb = typeof cb === "function" ? cb : setEquipoOT;
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
    (estado._pickCb || setEquipoOT)(eq);
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
// v3.68 · Agenda programada (calendario) en el celular, con el catálogo guardado (funciona sin internet)
function citasMovil() {
  const progs = (estado.catalogo?.programaciones || []).filter(p => (p.ESTADO || "PROGRAMADA").toUpperCase() !== "CANCELADA");
  const eqs = estado.catalogo?.equipos || [];
  const ots = (estado.catalogo?.historial_ot || []).map(o => ({ serie: o.SERIE, fecha: o.FECHA, numero: o.NUMERO_OT, tipo: o.TIPO_OT }));
  const citas = progs.map(p => {
    const cli = clientePorId(p.ID_CLIENTE) || {};
    const e = eqs.find(x => x.SERIE === p.SERIE) || {};
    const a = (estado.asig || {})["PROG:" + (p.ID_VISITA || p.ID_SB)];
    return { id: String(p.ID_VISITA || p.ID_SB), fecha: p.FECHA_PROGRAMADA || "", hora: p.HORA || "", cliente: cli.RAZON_SOCIAL || "—",
      codCliente: cli.ID_CLIENTE || "", serie: p.SERIE || "", equipo: [e.MARCA, e.MODELO, e.POTENCIA_KW ? e.POTENCIA_KW + " kW" : ""].filter(Boolean).join(" "),
      lugar: [e.UBICACION, e.GPS_LAT != null ? "GPS " + e.GPS_LAT + ", " + e.GPS_LNG : ""].filter(Boolean).join(" · "),
      tipo: p.TIPO_MANTENIMIENTO || "", novedades: p.OBSERVACION || "", contactoCita: p.CONTACTO_CITA, telefonoCita: p.TELEFONO_CITA,
      contactoEquipo: e.CONTACTO, telefonoEquipo: e.CONTACTO_TEL || e.CLIENTE_TEL, atendida: (p.ESTADO || "").toUpperCase() === "EJECUTADA",
      tecnico: a && a.tecnico, registro: [p.REGISTRADO_POR, (p.FECHA_REGISTRO || "").slice(0, 16)].filter(Boolean).join(" · "), _p: p };
  });
  return typeof AGENDA !== "undefined" ? AGENDA.completar(citas, ots) : citas;
}
function pintarAgendaMovil() {
  const c = $("#ag-movil"); if (!c || typeof AGENDA === "undefined") return;
  AGENDA.render(c, citasMovil(), { onCita: (ci) => {
    $("#sheet-cita-titulo").textContent = "Cita · " + (ci.cliente || "");
    $("#sheet-cita-body").innerHTML = AGENDA.detalleHTML(ci) +
      `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="ag-atender">Atender</button>
       ${ci.telefonoCita || ci.telefonoEquipo ? `<a class="btn btn-ghost btn-sm" href="tel:${ESC(ci.telefonoCita || ci.telefonoEquipo)}">📞 Llamar</a>` : ""}</div>`;
    const b = $("#ag-atender");
    if (b) b.onclick = () => {
      $("#sheet-cita").hidden = true;
      const it = itemDeTarjeta("PROG", ci.id);
      if (it) { atenderItem(it); return; }
      const eq = (estado.catalogo.equipos || []).find(e => e.SERIE === ci.serie);
      nuevaOT(eq || { SERIE: ci.serie, ID_CLIENTE: ci._p.ID_CLIENTE }, ci.tipo, { clase: "PROGRAMADA", visita: ci._p });
    };
    $("#sheet-cita").hidden = false;
    $("#sheet-cita-close").onclick = () => { $("#sheet-cita").hidden = true; };
  } });
}
function pintarProgramaciones() {
  pintarAgendaMovil();
  const cont = $("#lista-prog");
  const count = $("#prog-count");
  const todas = (estado.catalogo?.programaciones || []).filter(p => (p.ESTADO || "").toUpperCase() !== "CANCELADA");
  const progs = progsFiltradas($("#buscar-prog").value).filter(p => (p.ESTADO || "").toUpperCase() !== "CANCELADA");
  $("#prog-vacio").hidden = todas.length > 0;
  count.textContent = todas.length ? `${progs.length} de ${todas.length} programada(s)` : "";
  cont.innerHTML = "";
  progs.forEach(p => {
    const cli = clientePorId(p.ID_CLIENTE);
    const li = document.createElement("li"); li.className = "tw-row";
    li.innerHTML = `<span class="tw-c1">${p.FECHA_PROGRAMADA || "—"}${p.HORA ? "<br>" + ESC(p.HORA) : ""}</span>
      <span class="tw-c2">
        <div class="t2-main">${p.TIPO_MANTENIMIENTO || "Mantenimiento"}</div>
        <div class="t2-sub">Serie ${p.SERIE || "—"} · ${cli?.RAZON_SOCIAL || "—"}${(() => { const a = (estado.asig || {})["PROG:" + (p.ID_VISITA || p.ID_SB)]; return a && a.tecnico ? " · 👷 " + ESC(a.tecnico) : ""; })()}</div>
        <div class="prog-acc" style="display:flex;gap:6px;margin-top:6px">
          <button class="btn btn-primary btn-sm" data-pacc="atender">Atender</button>
          <button class="btn btn-ghost btn-sm" data-pacc="seguir">🔎 Seguimiento / avance</button></div>
      </span>`;
    // v3.61: desde Programaciones también se informa el avance al cliente (link de seguimiento)
    li.querySelector('[data-pacc="seguir"]').onclick = (ev) => {
      ev.stopPropagation();
      const it = itemDeTarjeta("PROG", String(p.ID_VISITA || p.ID_SB));
      if (it) abrirSeg(it); else toast("No se encontró la visita en el catálogo.", "err");
    };
    li.onclick = () => {
      // v3.61: la OT queda unida al seguimiento de la visita (mismo enlace para el cliente)
      const it = itemDeTarjeta("PROG", String(p.ID_VISITA || p.ID_SB));
      if (it) { atenderItem(it); return; }
      const eq = (estado.catalogo.equipos || []).find(e => e.SERIE === p.SERIE);
      marcarVisto(p.ID_VISITA || p.ID_SB);
      nuevaOT(eq || { SERIE: p.SERIE, ID_CLIENTE: p.ID_CLIENTE }, p.TIPO_MANTENIMIENTO, { clase: "PROGRAMADA", visita: p });
    };
    cont.appendChild(li);
  });
  if (todas.length && !progs.length) cont.innerHTML = `<li class="tw-empty">Sin coincidencias.</li>`;
}

// ---------- Nueva / editar OT ----------
function nuevaOT(equipo, tipo, ctx) {
  estado._otCtx = ctx || { clase: "NO_PROGRAMADA" };
  estado.edit = { COD_TEMP: "" };
  estado.fotos = []; estado.actividades = [];
  $("#ot-titulo").textContent = { URGENTE: "🚨 Orden urgente", NO_PROGRAMADA: "Orden no programada" }[estado._otCtx.clase] || "Orden programada";
  $("#ot-numero").value = "";
  $("#ot-fecha").value = hoyISO();
  $("#ot-horas").value = "";
  $("#ot-obs").value = "";
  if ($("#ot-ubicacion")) $("#ot-ubicacion").value = "";
  _ubicacionOT = null; estado._gpsPreguntado = false;
  // tipos
  const sel = $("#ot-tipo"); sel.innerHTML = "";
  (estado.catalogo?.tipos_mantenimiento || [TERMINO_PREV]).forEach(t => {
    const o = document.createElement("option"); o.value = t; o.textContent = t; sel.appendChild(o);
  });
  if (tipo) sel.value = tipoEnCatalogo(tipo);
  pintarSelectorActividades();
  // equipo
  if (equipo && equipo.SERIE) setEquipoOT(equipo);
  else { estado._otEquipo = null; $("#ot-serie").value = ""; $("#ot-cliente-info").textContent = ""; pintarSitioOT(); }
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
  // conservar solo las adicionales (y las sub-actividades de combos agregados aparte)
  const adicionales = estado.actividades.filter(a => a.tipo === "adicional" || a.tipo === "adsub");
  estado.actividades = [];
  if (tipo) {
    estado.actividades.push({ tipo: "rubro", texto: tipo });
    // una actividad INDIVIDUAL como tipo principal se aplica sola (no se repite como sub)
    if (!(subs.length === 1 && subs[0] === tipo)) subs.forEach(s => estado.actividades.push({ tipo: "sub", texto: s }));
  }
  adicionales.forEach(a => estado.actividades.push(a));
  pintarActividades();
}
// ---- M9-D (v3.45): catálogo completo de actividades aplicable como combo o individual ----
const TERMINO_PREV = "MANTENIMIENTO PREVENTIVO";
const SIN_PREV = ["MANTENIMIENTO GENERAL", "MANTENIMIENTO COMPLETO", "MANTENIMIENTO PREVENTIVO", "PREVENTIVO"];
// Si la visita trae un sinónimo del preventivo, se elige el combo universal del catálogo.
function tipoEnCatalogo(t) {
  const lista = estado.catalogo?.tipos_mantenimiento || [];
  const u = String(t || "").trim().toUpperCase();
  const igual = lista.find(x => String(x).toUpperCase() === u);
  if (igual) return igual;
  if (SIN_PREV.includes(u)) return lista.find(x => SIN_PREV.includes(String(x).toUpperCase())) || t;
  return t;
}
function pintarSelectorActividades() {
  const sel = $("#ot-act-cat"); if (!sel) return;
  const combos = estado.catalogo?.combos || {}, tipos = estado.catalogo?.tipos_mantenimiento || [];
  const esCombo = (t) => (combos[t] || []).length > 1 || ((combos[t] || []).length === 1 && combos[t][0] !== t);
  const opt = (t) => `<option value="${ESC(t)}">${ESC(t)}</option>`;
  const cs = tipos.filter(esCombo), ind = tipos.filter(t => !esCombo(t));
  sel.innerHTML = `<option value="">＋ Agregar actividad del catálogo (${tipos.length})…</option>` +
    (cs.length ? `<optgroup label="Combos">${cs.map(opt).join("")}</optgroup>` : "") +
    (ind.length ? `<optgroup label="Individuales">${ind.map(opt).join("")}</optgroup>` : "");
}
function agregarActividadCatalogo(t) {
  if (!t) return;
  const ya = estado.actividades.some(a => String(a.texto).toLowerCase() === t.toLowerCase());
  if (ya) { toast("Esa actividad ya está en la orden.", "err"); return; }
  const subs = (estado.catalogo?.combos || {})[t] || [];
  const combo = subs.length > 1 || (subs.length === 1 && subs[0] !== t);
  estado.actividades.push({ tipo: "adicional", texto: t, combo });
  if (combo) subs.forEach(s => estado.actividades.push({ tipo: "adsub", texto: s }));
  pintarActividades();
  toast((combo ? "Combo agregado: " : "Actividad agregada: ") + t, "ok");
}
function setEquipoOT(e) {
  estado._otEquipo = e;
  $("#ot-serie").value = e.SERIE || "";
  $("#ot-cliente-info").textContent = "";
  pintarSitioOT();
}
// ---- v3.49: datos del cliente y del sitio del equipo (para el técnico que atiende) ----
function sitioDe(e) {
  const cli = clientePorId(e ? e.ID_CLIENTE : null) || {};
  const gps = e && e.GPS_LAT != null && e.GPS_LNG != null && !isNaN(Number(e.GPS_LAT)) ? { lat: Number(e.GPS_LAT), lng: Number(e.GPS_LNG), f: e.GPS_FECHA } : null;
  return { cliente: cli.RAZON_SOCIAL || "", cliTel: (e && e.CLIENTE_TEL) || cli.TELEFONO || "",
    contacto: (e && e.CONTACTO) || cli.CONTACTO || "", contactoTel: (e && e.CONTACTO_TEL) || "",
    direccion: (e && e.UBICACION) || cli.DIRECCION || "", ciudad: cli.CIUDAD || "", gps };
}
function botonesTel(tel) {
  const n = numWA(tel); if (!n) return "";
  return ` <a class="sit-b" href="tel:+${n}">📞</a><a class="sit-b" href="https://wa.me/${n}" target="_blank" rel="noopener">💬</a>`;
}
function sitioHTML(e, compacto) {
  const s = sitioDe(e), sd = '<span class="sit-vacio">sin dato</span>';
  const mapa = s.gps ? `<a class="sit-b" href="https://www.google.com/maps/dir/?api=1&destination=${s.gps.lat},${s.gps.lng}" target="_blank" rel="noopener">🧭 Cómo llegar</a>` : "";
  if (compacto) {
    const p = [];
    if (s.direccion) p.push("📍 " + ESC(s.direccion)); else if (s.gps) p.push("📍 ubicación GPS registrada");
    if (s.contacto || s.cliTel) p.push("👤 " + ESC(s.contacto || s.cliente) + botonesTel(s.contactoTel || s.cliTel));
    return p.length || mapa ? `<div class="hc-sitio">${p.join(" · ")}${mapa ? " " + mapa : ""}</div>` : "";
  }
  const f = (ic, lab, val, extra) => `<div class="sit-f"><b>${ic} ${lab}</b><span>${val ? ESC(val) : sd}${extra || ""}</span></div>`;
  return `<div class="sitio-card"><div class="sit-h">Cliente y sitio del servicio</div>
    ${f("👤", "Cliente", s.cliente)}
    ${f("📱", "Celular cliente", s.cliTel, botonesTel(s.cliTel))}
    ${f("🧑‍🔧", "Contacto en sitio", s.contacto)}
    ${f("📱", "Celular contacto", s.contactoTel, botonesTel(s.contactoTel))}
    ${f("🏠", "Dirección del equipo", s.direccion + (s.direccion && s.ciudad ? " · " + s.ciudad : ""))}
    <div class="sit-f"><b>📍 Ubicación GPS</b><span>${s.gps ? `${s.gps.lat.toFixed(5)}, ${s.gps.lng.toFixed(5)}${s.gps.f ? ` <small>(${ESC(fmtFecha(String(s.gps.f).slice(0, 10)))})</small>` : ""} ${mapa}` : sd + " <small>· se carga al guardar esta OT con ubicación</small>"}</span></div>
    <button class="btn btn-ghost btn-block" id="btn-sitio-editar" style="margin-top:8px;min-height:42px">✏️ Completar datos del cliente y del sitio</button></div>`;
}
function pintarSitioOT() {
  const box = $("#ot-sitio"); if (!box) return;
  const e = estado._otEquipo;
  box.innerHTML = e && e.SERIE ? sitioHTML(e, false) : "";
  const b = $("#btn-sitio-editar");
  if (b) b.onclick = () => { estado._equipoActual = e; estado._eqEditDesde = "ot"; abrirEdicionEquipo(); };
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
    if (btn) btn.onclick = () => {
      // quitar un combo agregado retira también sus sub-actividades
      let n = 1;
      if (a.tipo === "adicional" && a.combo) while (estado.actividades[i + n] && estado.actividades[i + n].tipo === "adsub") n++;
      estado.actividades.splice(i, n); pintarActividades();
    };
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
  // v3.49: la ubicación del servicio mantiene al día la del equipo; si no se capturó, se ofrece (una vez por OT)
  if (!_ubicacionOT && !estado._gpsPreguntado && "geolocation" in navigator) {
    estado._gpsPreguntado = true;
    if (confirm("No capturaste la ubicación del servicio.\n\n¿Capturarla ahora? Queda como la ubicación actual de este equipo.")) {
      capturarUbicacion(() => guardarOT()); return;
    }
  }
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
    CLASE_VISITA: (estado._otCtx || {}).clase || "NO_PROGRAMADA",
    SOLICITUD_ID: ((estado._otCtx || {}).sol || {}).id || null,
    TRABAJO_REALIZADO: $("#ot-obs").value.trim(),
    OBSERVACIONES: $("#ot-obs").value.trim(),
    HORAS_MAQUINA: $("#ot-horas").value ? Number($("#ot-horas").value) : null,
    GPS_LAT: _ubicacionOT?.lat || null,
    GPS_LON: _ubicacionOT?.lon || null,
    ACTIVIDADES: estado.actividades.map(d => ({
      DESCRIPCION: d.texto, CANTIDAD: 1, VALOR: 0, NIVEL: d.tipo === "adsub" ? "sub" : d.tipo
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

  // M9-B: solo se cierra la visita que realmente se atendió (antes cerraba la primera de esa serie)
  const ctx = estado._otCtx || {};
  if (ctx.visita) _bajarVisitaProgramada(ctx.visita);
  if (ctx.sol) {
    ctx.sol.atendida = true; ctx.sol.numero_ot = numero;
    ctx.sol._patch = Object.assign(ctx.sol._patch || {}, { atendida: true, numero_ot: numero });
    syncSolicitudes(true);
  }
  cerrarSegPorOT(ctx, numero);
  estado._otCtx = null;

  if (orden.GPS_LAT && orden.GPS_LON) registrarGpsEquipo(e, Number(orden.GPS_LAT), Number(orden.GPS_LON));
  guardarLocal(); refrescarSync();
  volver();
  abrirGuardada(copia);
}
// ---- v3.46: al guardar la OT se ofrece WhatsApp (grupo técnico, cliente, otros) y se envía sola a oficina ----
function estadoNubeTxt(o) {
  if (typeof API === "undefined" || !API.hayNube()) return "Sin nube configurada: usa «Enviar a oficina» → respaldo en archivo.";
  const s = window._prosolEstadoNube ? window._prosolEstadoNube(o) : { cod: "pend" };
  if (s.cod === "ok") return "☁ Enviada a oficina ✅";
  if (s.cod === "err") return "⚠ No se pudo enviar a oficina: " + (s.err || "") + " — se reintenta sola.";
  return navigator.onLine === false ? "📴 Sin internet: se enviará sola a oficina cuando haya señal." : "☁ Enviando a oficina…";
}
function abrirGuardada(h) {
  estado._guardada = h;
  $("#gd-titulo").textContent = "Orden N° " + (h.NUMERO_OT || "—") + " guardada";
  $("#gd-sub").textContent = (h.RAZON_SOCIAL || "") + " · Serie " + (h.SERIE || "") + " · " + (h.TIPO_OT || "");
  const pinta = () => {
    if (estado._guardada !== h) return;
    $("#gd-nube").textContent = estadoNubeTxt(h);
    const s = window._prosolEstadoNube ? window._prosolEstadoNube(h).cod : "pend";
    $("#gd-reintentar").hidden = s === "ok" || typeof API === "undefined" || !API.hayNube();
  };
  pinta();
  $("#sheet-guardada").hidden = false;
  if (window._prosolSubirPendientes) Promise.resolve(window._prosolSubirPendientes({ silencioso: true })).then(pinta, pinta);
  estado._gdPinta = pinta;
}
function enviarGuardadaWhatsApp() {
  const h = estado._guardada; if (!h) return;
  const idx = estado.historial.indexOf(h); if (idx < 0) return;
  estado._ordenHist = idx;
  $("#sheet-guardada").hidden = true;
  enviarOrdenConDestinos();
}
// la nube avisa cuando una o más OT llegaron a oficina
window._prosolTrasSubir = async () => {
  const subidas = new Set(estado.historial.filter(h => window._prosolEstadoNube(h).cod === "ok").map(h => h.COD_TEMP));
  estado.historial.forEach(h => { if (subidas.has(h.COD_TEMP)) h._enviada = true; });
  // ya están en oficina: dejan de estar «sin empaquetar»
  estado.ordenes = estado.ordenes.filter(o => !subidas.has(o.COD_TEMP));
  await guardarLocal(); refrescarSync();
  if (estado._pantalla === "enviar") pintarPendientes();
  if (estado._pantalla === "historial") pintarHistorial();
  if (estado._pantalla === "inicio" || estado._pantalla === "oficina") pintarInicio();
  if (estado._gdPinta) estado._gdPinta();
};
// órdenes que faltan llegar a oficina (con nube: las no subidas; sin nube: las no empaquetadas)
function pendientesTotal() {
  const ot = pendOficina() || 0, av = (estado.avQ || []).length, sg = Object.keys(estado.segQ || {}).length, en = (estado.envQ || []).length;
  const det = [ot ? ot + " orden(es)" : "", av ? av + " avance(s)" : "", sg ? sg + " seguimiento(s) del cliente" : "", en ? en + " envío(s)" : ""].filter(Boolean).join(", ");
  return { ot, av, sg, en, total: ot + av + sg + en, detalle: det };
}
function pendOficina() {
  if (typeof API !== "undefined" && API.hayNube() && window._prosolPendientesNube) return window._prosolPendientesNube();
  return estado.ordenes.length;
}

// Marca como EJECUTADA la visita programada del equipo en Supabase y la retira del catálogo local
async function _bajarVisitaProgramada(visita) {
  if (!visita) return;
  const progs = estado.catalogo?.programaciones || [];
  // Retirar SOLO esa visita del catálogo local (sin esperar respuesta de red)
  estado.catalogo.programaciones = progs.filter(p => p !== visita && (p.ID_VISITA || p.ID_SB) !== (visita.ID_VISITA || visita.ID_SB));
  await guardarLocal();
  if (typeof API === 'undefined' || !API.hayNube()) return;
  try {
    const idSb = visita.ID_SB || visita.ID_VISITA;
    if (!idSb) return;
    await API.update('visitas_programadas', idSb, { estado: 'EJECUTADA' }).catch(() => null);
    toastG('✅ Visita programada marcada como realizada', 'ok');
  } catch (e) { /* no crítico: la baja local ya está hecha */ }
}

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
    const fin = lotesDe(null, h.NUMERO_OT).filter(L => L.tipo === "FINAL").pop();
    const sn = window._prosolEstadoNube && typeof API !== "undefined" && API.hayNube() ? window._prosolEstadoNube(h) : null;
    const estadoTxt = (h._confirmada ? "✅ confirmada"
      : (sn ? sn.txt : (h._enviada ? "📤 enviada" : "• sin enviar"))) + (fin ? " · 📲 " + loteResumen(fin) : "");
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
      <div class="row-sub" style="white-space:normal"><b>Oficina:</b> ${ESC(estadoNubeTxt(h))}</div>
      <div class="row-sub" style="white-space:normal"><b>Cliente:</b> ${h._segCerrado ? "🔎 seguimiento cerrado con el reporte" : "🔎 seguimiento en línea"} ·
        <a href="${ESC(urlSeguimiento(tokenDeOT(h)))}" target="_blank" rel="noopener" style="color:var(--azul)">ver página del cliente</a></div>
    </div>
    <div class="field-label">Actividades</div>
    <div style="margin:4px 0 10px;font-size:.92rem">${acts || "—"}</div>
    <div class="field-label">Trabajo / observaciones</div>
    <div style="margin:4px 0 10px;font-size:.92rem">${h.TRABAJO_REALIZADO || "—"}</div>
    ${h.GPS_LAT && h.GPS_LON ? `<div class="row-sub" style="margin-bottom:6px">📍
      <a href="https://maps.google.com/?q=${h.GPS_LAT},${h.GPS_LON}" target="_blank"
        style="color:var(--azul)">Ver ubicación del servicio en el mapa</a></div>` : ""}
    <div class="row-sub">📷 ${fotosInfo}</div>
    ${(() => { const o = historialDeSerie(h.SERIE).find(x => String(x.NUMERO_OT) === String(h.NUMERO_OT) && x.PDF_URL);
      return o ? `<div class="row-sub" style="margin-top:6px"><a href="${ESC(o.PDF_URL)}" target="_blank" rel="noopener" style="color:var(--azul);font-weight:600">📄 Ver orden (PDF de oficina)</a></div>` : ""; })()}
    ${envBloqueHTML((() => { const sg = sgDeOT(h); return lotesDe(sg ? sg.key : null, h.NUMERO_OT); })())}`;
  $("#btn-orden-confirmar").textContent = h._confirmada ? "Quitar confirmación" : "Marcar confirmada";
  if ($("#btn-orden-avance")) $("#btn-orden-avance").onclick = () => { $("#sheet-orden").hidden = true; abrirSeg(itemDeOT(h)); };
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
// v3.48: formato corporativo del mensaje de WhatsApp (íconos por campo, separadores y pie de identidad)
const SEP_WA = "━━━━━━━━━━━━━━━━━━";
const PIE_WA = "⚙️ _PROSOL Campo · Potenciado por ROCKENSY S.A. & MIG_";
function equipoTxtWA(serie) {
  const e = typeof equipoPorSerie === "function" ? equipoPorSerie(serie) : null;
  if (!e) return "";
  return [(e.MARCA || "GENERAC") + (e.MODELO ? " " + e.MODELO : ""), Number(e.POTENCIA_KW) > 0 ? e.POTENCIA_KW + " kW" : ""].filter(Boolean).join(" · ");
}
function resumenOrdenTexto(h) {
  const L = [];
  L.push("🔧 *PROSOL S.A. · Servicio Autorizado Generac*", SEP_WA);
  L.push("📋 *ORDEN DE TRABAJO N° " + (h.NUMERO_OT || "—") + "*");
  L.push("✅ Estado: *Trabajo finalizado*", SEP_WA);
  L.push("👤 *Cliente:* " + (h.RAZON_SOCIAL || "—"));
  const eq = equipoTxtWA(h.SERIE);
  if (eq) L.push("⚡ *Equipo:* " + eq);
  L.push("🔢 *Serie:* " + (h.SERIE || "—"));
  L.push("📅 *Fecha:* " + (typeof fmtFecha === "function" ? fmtFecha(h.FECHA) : (h.FECHA || "—")));
  L.push("🛠️ *Tipo:* " + (h.TIPO_OT || "—"));
  if (h.HORAS_MAQUINA != null && h.HORAS_MAQUINA !== "") L.push("⏱️ *Horas máquina:* " + h.HORAS_MAQUINA);
  L.push("👷 *Técnico:* " + (estado.tecnico || "—"));
  const acts = h.ACTIVIDADES || [];
  if (acts.length) {
    L.push("", "🧰 *Actividades realizadas*");
    let rubro = "";
    acts.forEach(a => {
      if (a.NIVEL === "rubro") { rubro = a.DESCRIPCION; L.push("▪️ *" + a.DESCRIPCION + "*"); }
      else if (a.NIVEL === "adicional") { rubro = a.DESCRIPCION; L.push("➕ *" + a.DESCRIPCION + "*"); }
      else if (a.DESCRIPCION !== rubro) L.push("      ✔️ " + a.DESCRIPCION);   // no repite la actividad principal
    });
  }
  if (h.TRABAJO_REALIZADO) L.push("", "📝 *Trabajo / observaciones*", h.TRABAJO_REALIZADO);
  if (h.GPS_LAT && h.GPS_LON) L.push("", "📍 *Ubicación del servicio*", "https://maps.google.com/?q=" + h.GPS_LAT + "," + h.GPS_LON);
  const nf = (h._fotos || []).length;
  L.push("");
  L.push("📷 " + nf + " foto(s) adjunta(s)" + (h.FIRMA ? " · ✍️ con firma del cliente" : ""));
  L.push(PIE_WA);
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
  toast("Respaldo creado y guardado abajo.", "ok");
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
  // Android no deja compartir archivos .zip desde una app web: se guarda en Descargas
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = envio.nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  const nube = typeof API !== "undefined" && API.hayNube();
  toast(nube ? "Este celular no permite compartir .zip: quedó en Descargas. No hace falta: tus órdenes llegan a oficina por la nube (☁)."
             : "Este celular no permite compartir .zip: quedó en Descargas. Adjúntalo en WhatsApp como Documento.", "ok");
  return false;
}

// ---------- Hoja: elegir equipo ----------
function abrirSheetEquipo(cb) {
  estado._pickCb = typeof cb === "function" ? cb : setEquipoOT;
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
    li.onclick = () => { (estado._pickCb || setEquipoOT)(e); $("#sheet-equipo").hidden = true; };
    ul.appendChild(li);
  });
}

// ══════════ M9-B: Hoy, visitas no programadas / urgentes y autorización ══════════
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esSup = () => /SUPERVISOR/i.test(((estado.catalogo?.tecnicos || []).find(t => nombreTecnico(t) === estado.tecnico) || {}).ESPECIALIDAD || "");
function esSupervisor() { return esSup(); }
function supervisores() { return (estado.catalogo?.tecnicos || []).filter(t => /SUPERVISOR/i.test(t.ESPECIALIDAD || "")); }
function equipoPorSerie(serie) { return (estado.catalogo?.equipos || []).find(e => e.SERIE === serie) || null; }
function numWA(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.startsWith("593")) return d;
  if (d.startsWith("0")) d = d.slice(1);
  return d.length >= 8 ? "593" + d : "";
}
const CLASE_TXT = { PROGRAMADA: "Programada", NO_PROGRAMADA: "No programada", URGENTE: "Urgente" };

// ---- "NUEVA" y descartes, por técnico, en el teléfono ----
function kVistos() { return "prosol_hoy_vistos::" + (estado.tecnico || ""); }
function leerVistos() { try { return JSON.parse(localStorage.getItem(kVistos()) || "{}"); } catch (x) { return {}; } }
function guardarVistos(v) { try { localStorage.setItem(kVistos(), JSON.stringify(v)); } catch (x) { /* sin almacenamiento */ } }
function marcarVisto(id) { const v = leerVistos(); v.ids = v.ids || {}; v.ids[id] = 1; guardarVistos(v); }
function esNueva(id) { const v = leerVistos(); return !(v.ids && v.ids[id]); }
function baselineVistos() {            // la primera vez, lo que ya existe no cuenta como "nuevo"
  const v = leerVistos(); if (v.base) return;
  v.base = true; v.ids = v.ids || {};
  (estado.catalogo?.programaciones || []).forEach(p => { v.ids[p.ID_VISITA || p.ID_SB] = 1; });
  (estado.solicitudes || []).forEach(s => { v.ids[s.id] = 1; });
  guardarVistos(v);
}

// ---- Agenda: arma los grupos de la pantalla Hoy ----
function datosTarjeta(serie, idCliente, nombreCli) {
  const e = equipoPorSerie(serie), cli = clientePorId(e ? e.ID_CLIENTE : idCliente);
  return { e, equipo: e ? tituloEquipo(e) : "Equipo " + serie, cliente: cli?.RAZON_SOCIAL || nombreCli || "—" };
}
// ---- M8: asignación de técnicos (la hace el supervisor) y filtro «Todas / Mías» ----
const claveAsig = (it) => it.k + ":" + it.id;
const fechaItem = (it) => it.fecha || (it.p && it.p.FECHA_PROGRAMADA) || (it.s && it.s.fecha_prevista) || "";
function asigDe(it) { return (estado.asig || {})[claveAsig(it)] || null; }
function tecnicoAsignado(it) { const a = asigDe(it); return a && a.tecnico ? a.tecnico : ""; }
const asignable = (it) => it.k === "PROG" || (it.k === "SOL" && UUID_RE.test(String(it.id)) && it.s && it.s.estado === "AUTORIZADA");
// por defecto: el supervisor ve «Todas»; el técnico ve «Mías» solo si tiene visitas asignadas (si no, «Todas»,
// para que nadie quede con Hoy vacío mientras el supervisor no asigna). La elección manual se recuerda.
function filtroHoy(nMias) {
  try { const f = localStorage.getItem("prosol_filtro_hoy::" + estado.tecnico); if (f === "MIAS" || f === "TODAS") return f; } catch (e) {}
  return esSup() ? "TODAS" : (nMias > 0 ? "MIAS" : "TODAS");
}
function setFiltroHoy(f) { try { localStorage.setItem("prosol_filtro_hoy::" + estado.tecnico, f); } catch (e) {} pintarHoy(); }
let _asigBusy = false, _asigTs = 0;
async function syncAsignaciones(forzar) {
  if (typeof API === "undefined" || !API.hayNube() || !navigator.onLine || _asigBusy) return;
  if (!forzar && Date.now() - _asigTs < 15000) return;
  _asigBusy = true;
  try {
    const filas = await API.select("visitas_asignacion");
    if (Array.isArray(filas)) {
      const m = {};
      filas.forEach(r => { m[r.clave] = { tecnico: r.tecnico || "", por: r.asignado_por || "", ts: r.actualizado || "", id_sb: r.id }; });
      const antes = JSON.stringify(estado.asig || {});
      estado.asig = m; await DB.set("asig", m);
      if (antes !== JSON.stringify(m) && estado._pantalla === "hoy") pintarHoy();
    }
    _asigTs = Date.now();
  } catch (e) { /* sin red: se usa lo guardado */ } finally { _asigBusy = false; }
}
async function guardarAsignacion(it, tecnico) {
  if (typeof API === "undefined" || !API.hayNube()) { toast("Configura la conexión a la nube para asignar técnicos.", "warn"); return false; }
  if (!navigator.onLine) { toast("Sin internet: no se pudo asignar. Intenta cuando tengas señal.", "warn"); return false; }
  const clave = claveAsig(it);
  const fila = { clave, serie: it.serie || null, fecha: fechaItem(it) || null, tecnico: tecnico || null, asignado_por: estado.tecnico, actualizado: new Date().toISOString() };
  try {
    const ya = await API.select("visitas_asignacion", { clave });
    if (ya && ya.length) await API.update("visitas_asignacion", ya[0].id, fila);
    else await API.insert("visitas_asignacion", fila);
    estado.asig = estado.asig || {};
    estado.asig[clave] = { tecnico: tecnico || "", por: estado.tecnico, ts: fila.actualizado };
    await DB.set("asig", estado.asig);
    return true;
  } catch (e) { toast("No se pudo asignar: " + e.message, "warn"); return false; }
}
function abrirAsignar(it) {
  const tecs = (estado.catalogo?.tecnicos || []).filter(t => !/INACTIV/i.test(t.ESTADO || "")).map(nombreTecnico).filter(Boolean);
  const actual = tecnicoAsignado(it);
  $("#asig-sub").textContent = it.cliente + " · Serie " + it.serie + " · " + (fechaItem(it) ? fmtFecha(fechaItem(it)) : "Sin fecha");
  $("#asig-lista").innerHTML = tecs.map(n => `<button class="btn ${n === actual ? "btn-primary" : "btn-ghost"} btn-block asig-tec" data-t="${ESC(n)}" style="margin-top:6px">👷 ${ESC(n)}${n === actual ? " · asignado" : ""}</button>`).join("")
    + (actual ? `<button class="btn btn-ghost btn-block asig-tec" data-t="" style="margin-top:12px">✕ Quitar asignación</button>` : "")
    + (tecs.length ? "" : `<p class="hint">No hay técnicos en el catálogo. Sincroniza el catálogo.</p>`);
  $$("#asig-lista .asig-tec").forEach(b => b.onclick = async () => {
    b.disabled = true;
    const okA = await guardarAsignacion(it, b.dataset.t);
    b.disabled = false;
    if (okA) { $("#sheet-asig").hidden = true; toast(b.dataset.t ? "Visita asignada a " + b.dataset.t : "Asignación quitada", "ok"); pintarHoy(); }
  });
  $("#sheet-asig").hidden = false;
}

function agendaHoy() {
  const hoy = hoyISO(), yo = estado.tecnico, sup = esSup();
  const a = { porAutorizar: [], urgentes: [], pendientes: [], rechazadas: [], hoy: [], vencidas: [], proximas: [] };
  const v = leerVistos();
  (estado.catalogo?.programaciones || []).filter(p => (p.ESTADO || "PROGRAMADA").toUpperCase() === "PROGRAMADA").forEach(p => {
    const f = p.FECHA_PROGRAMADA || "";
    const it = Object.assign({ k: "PROG", id: p.ID_VISITA || p.ID_SB, p, fecha: f, serie: p.SERIE, tipoMant: p.TIPO_MANTENIMIENTO || "Mantenimiento", clase: "PROGRAMADA" },
      datosTarjeta(p.SERIE, p.ID_CLIENTE));
    (!f || f === hoy ? a.hoy : f < hoy ? a.vencidas : a.proximas).push(it);
  });
  (estado.solicitudes || []).forEach(s => {
    const mia = s.solicitante === yo;
    const it = Object.assign({ k: "SOL", id: s.id, s, fecha: s.fecha_prevista || "", serie: s.serie, tipoMant: s.tipo_mantenimiento || "Mantenimiento", clase: s.clase },
      datosTarjeta(s.serie, s.id_cliente, s.cliente_nombre));
    if (s.estado === "SOLICITADA") {
      if (sup) a.porAutorizar.push(it);
      else if (mia) (s.clase === "URGENTE" && !s.atendida ? a.urgentes : a.pendientes).push(it);
    } else if (s.estado === "AUTORIZADA" && !s.atendida) {
      const f = it.fecha;
      if (s.clase === "URGENTE") a.urgentes.push(it);
      else (!f || f <= hoy ? a.hoy : a.proximas).push(it);
    } else if (s.estado === "RECHAZADA" && mia && !(v.rech && v.rech[s.id])) a.rechazadas.push(it);
  });
  const orden = (x, y) => (x.fecha || "").localeCompare(y.fecha || "");
  ["hoy", "vencidas", "proximas"].forEach(g => a[g].sort(orden));
  // M8: cuántas son «mías» y filtro (no afecta autorizaciones, pendientes ni rechazadas)
  const VIS = ["urgentes", "hoy", "vencidas", "proximas"];
  a.nTodas = VIS.reduce((n, g) => n + a[g].length, 0);
  a.nMias = VIS.reduce((n, g) => n + a[g].filter(it => tecnicoAsignado(it) === yo).length, 0);
  a.filtro = filtroHoy(a.nMias);
  if (a.filtro === "MIAS") VIS.forEach(g => { a[g] = a[g].filter(it => tecnicoAsignado(it) === yo || (it.k === "SOL" && it.s && it.s.solicitante === yo && !tecnicoAsignado(it))); });
  return a;
}
function badgesTarjeta(it, yo) {
  const b = [];
  if (it.clase === "URGENTE") b.push('<span class="hb urg">URGENTE</span>');
  else if (it.clase === "NO_PROGRAMADA") b.push('<span class="hb np">NO PROGRAMADA</span>');
  const s = it.s;
  if (s && s.estado === "SOLICITADA" && it.clase === "URGENTE") b.push('<span class="hb pen">Autorización posterior</span>');
  if (s && s.estado === "AUTORIZADA") b.push('<span class="hb ok">Autorizada' + (s.autorizado_por ? " · " + ESC(s.autorizado_por) : "") + "</span>");
  if (s && s.estado === "RECHAZADA") b.push('<span class="hb rech">Rechazada</span>');
  if (esNueva(it.id) && !(s && s.solicitante === yo)) b.push('<span class="hb nuev">NUEVA</span>');
  return b.join("");
}
function tarjetaHoy(it, modo) {
  const yo = estado.tecnico, s = it.s;
  const acc = [];
  if (modo === "aut") acc.push('<button class="btn btn-primary" data-acc="autorizar">✔ Autorizar</button>', '<button class="btn btn-ghost" data-acc="rechazar">✕ Rechazar</button>');
  else if (modo === "rech") acc.push('<button class="btn btn-ghost" data-acc="entendido">Entendido</button>');
  else if (modo !== "pen") acc.push('<button class="btn btn-primary" data-acc="atender">Atender</button>', '<button class="btn btn-ghost" data-acc="seguir">Seguimiento</button>');
  if (esSup() && asignable(it) && ["hoy", "venc", "prox", "urg"].includes(modo)) acc.push('<button class="btn btn-ghost" data-acc="asignar">👷 Asignar</button>');
  const fecha = it.fecha ? fmtFecha(it.fecha) : "Sin fecha";
  return `<div class="hcard ${modo}" data-k="${it.k}" data-id="${ESC(it.id)}">
    <div class="hc-top"><span class="hc-fecha">${ESC(fecha)}</span>${badgesTarjeta(it, yo)}${(() => { const sg = (estado.seguim || {})[it.k + ":" + it.id]; return sg && sg.etapa !== "PROGRAMADA" ? '<span class="hb et">' + etapaTxt(sg.etapa) + "</span>" : ""; })()}</div>
    <div class="hc-main">${ESC(it.cliente)}</div>
    <div class="hc-sub">Serie ${ESC(it.serie)} · ${ESC(it.equipo)}</div>
    <div class="hc-sub">${ESC(it.tipoMant)}</div>
    ${asignable(it) ? (tecnicoAsignado(it) ? `<div class="hc-asig${tecnicoAsignado(it) === yo ? " mia" : ""}">👷 Asignada a <b>${ESC(tecnicoAsignado(it))}</b>${tecnicoAsignado(it) === yo ? " (tú)" : ""}</div>` : `<div class="hc-asig sin">👷 Sin técnico asignado</div>`) : ""}
    ${it.e ? sitioHTML(it.e, true) : ""}
    ${s && s.motivo ? `<div class="hc-motivo">“${ESC(s.motivo)}”</div>` : ""}
    ${s && modo === "aut" ? `<div class="hc-sub">Pide: ${ESC(s.solicitante)}</div>` : ""}
    ${s && modo === "pen" ? `<div class="hc-sub">Esperando que el supervisor autorice…</div>` : ""}
    ${acc.length ? `<div class="hc-acc">${acc.join("")}</div>` : ""}
  </div>`;
}
function pintarHoy() {
  const cont = $("#hoy-contenido"); if (!cont) return;
  $("#hoy-fecha").textContent = fmtFecha(hoyISO());
  $("#fab-visita").hidden = !estado.catalogo;
  if (!estado.catalogo) {
    cont.innerHTML = `<p class="hint">Carga el catálogo desde <b>Inicio → Sincronizar catálogo</b> para ver tu agenda.</p>`; return;
  }
  baselineVistos();
  const a = agendaHoy();
  const sec = (titulo, arr, modo, cls) => arr.length
    ? `<h2 class="hoy-h ${cls}">${titulo} <span>${arr.length}</span></h2>` + arr.map(i => tarjetaHoy(i, modo)).join("") : "";
  let h = `<div class="hoy-filtro" role="tablist">
    <button class="hf-chip${a.filtro === "MIAS" ? " on" : ""}" data-filtro="MIAS">Mías <span>${a.nMias}</span></button>
    <button class="hf-chip${a.filtro === "TODAS" ? " on" : ""}" data-filtro="TODAS">Todas <span>${a.nTodas}</span></button></div>`;
  h += sec("Por autorizar", a.porAutorizar, "aut", "aut");
  h += sec("🚨 Urgentes", a.urgentes, "urg", "urg");
  h += sec("Esperando autorización", a.pendientes, "pen", "");
  h += sec("Rechazadas", a.rechazadas, "rech", "");
  h += sec("Para hoy", a.hoy, "hoy", "");
  h += sec("Vencidas", a.vencidas, "venc", "venc");
  if (a.proximas.length) h += `<details class="hoy-prox"><summary>Próximas <span>${a.proximas.length}</span></summary>${a.proximas.map(i => tarjetaHoy(i, "prox")).join("")}</details>`;
  if (!/hcard/.test(h)) h += a.filtro === "MIAS" && a.nTodas
    ? `<p class="hint">No tienes visitas asignadas. Toca <b>Todas</b> para ver las ${a.nTodas} visita(s) del equipo.</p>`
    : `<p class="hint">No tienes visitas pendientes. Si surge algo, usa el botón ＋.</p>`;
  cont.innerHTML = h;
  $$("#hoy-contenido .hf-chip").forEach(b => b.onclick = () => setFiltroHoy(b.dataset.filtro));
  autoActualizarCatalogo();
  refrescarSync();
}
async function accionHoy(ev) {
  const btn = ev.target.closest("[data-acc]"); if (!btn) return;
  const card = btn.closest(".hcard"); if (!card) return;
  const acc = btn.dataset.acc, k = card.dataset.k, id = card.dataset.id;
  const it = itemDeTarjeta(k, id); if (!it) return;
  if (acc === "atender") { atenderItem(it); return; }
  if (acc === "seguir") { marcarVisto(id); abrirSeg(it); return; }
  if (acc === "asignar") { abrirAsignar(it); return; }
  const s = it.s; if (!s) return;
  if (acc === "autorizar" || acc === "rechazar") { await resolverSolicitud(s, acc === "autorizar" ? "AUTORIZADA" : "RECHAZADA"); return; }
  if (acc === "entendido") { const v = leerVistos(); v.rech = v.rech || {}; v.rech[s.id] = 1; guardarVistos(v); pintarHoy(); return; }
}

// ---- Solicitudes: subir pendientes y bajar las de la nube ----
let _solBusy = false, _solTs = 0, _solRepetir = false;
async function syncSolicitudes(forzar) {
  if (typeof API === "undefined" || !API.hayNube() || !navigator.onLine) return;
  if (_solBusy) { if (forzar) _solRepetir = true; return; }   // un cambio llegó en pleno envío: se repite al terminar
  if (!forzar && Date.now() - _solTs < 15000) return;
  _solBusy = true;
  try {
    for (const s of estado.solicitudes) {
      try {
        if (s._nuevo) {
          const fila = { serie: s.serie, id_equipo: UUID_RE.test(s.id_equipo || "") ? s.id_equipo : null,
            id_cliente: UUID_RE.test(s.id_cliente || "") ? s.id_cliente : null, cliente_nombre: s.cliente_nombre || "",
            clase: s.clase, tipo_mantenimiento: s.tipo_mantenimiento || "", motivo: s.motivo || "", fecha_prevista: s.fecha_prevista || null,
            solicitante: s.solicitante || "", estado: s.estado, autorizado_por: s.autorizado_por || null,
            fecha_resolucion: s.fecha_resolucion || null, atendida: !!s.atendida, numero_ot: s.numero_ot || null };
          const r = await API.insert("solicitudes_ot", fila);
          if (r && r.id) {
            migrarSeg("SOL:" + s.id, "SOL:" + r.id); s.id = r.id; delete s._nuevo;
            // lo que cambió mientras se enviaba (p. ej. "atendida") se manda como corrección
            const dif = {};
            ["estado", "autorizado_por", "fecha_resolucion", "numero_ot"].forEach(k => { if ((s[k] ?? null) !== (fila[k] ?? null)) dif[k] = s[k] ?? null; });
            if (!!s.atendida !== !!fila.atendida) dif.atendida = !!s.atendida;
            if (Object.keys(dif).length) s._patch = Object.assign(s._patch || {}, dif); else delete s._patch;
          }
        } else if (s._patch && UUID_RE.test(String(s.id))) {
          await API.update("solicitudes_ot", s.id, s._patch); delete s._patch;
        }
      } catch (x) { /* queda pendiente para el próximo intento */ }
    }
    const desde = new Date(Date.now() - 30 * 86400000).toISOString();
    const filas = await API.select("solicitudes_ot", { creado: "gte." + desde });
    if (Array.isArray(filas)) {
      const locales = new Map(estado.solicitudes.map(s => [String(s.id), s]));
      const res = [];
      filas.forEach(r => {
        const l = locales.get(String(r.id));
        if (l) {                      // se actualiza el MISMO objeto (la orden en curso lo referencia)
          const pend = l._patch;
          Object.assign(l, r);
          if (pend) { Object.assign(l, pend); l._patch = pend; }
          res.push(l); locales.delete(String(r.id));
        } else res.push(r);
      });
      locales.forEach(l => { if (l._nuevo || l._patch) res.push(l); });   // pendientes aún sin subir
      res.sort((x, y) => String(y.creado || "").localeCompare(String(x.creado || "")));
      estado.solicitudes = res;
    }
    _solTs = Date.now();
    await guardarLocal();
  } catch (x) { /* sin red: se usa lo guardado */ }
  finally { _solBusy = false; }
  if (_solRepetir) { _solRepetir = false; return syncSolicitudes(true); }
  if ($('[data-screen="hoy"]')?.classList.contains("active")) pintarHoy(); else refrescarSync();
}
window._prosolSyncSolicitudes = syncSolicitudes;
async function resolverSolicitud(s, nuevo) {
  const ahora = new Date().toISOString();
  s.estado = nuevo; s.autorizado_por = estado.tecnico; s.fecha_resolucion = ahora;
  s._patch = Object.assign(s._patch || {}, { estado: nuevo, autorizado_por: estado.tecnico, fecha_resolucion: ahora });
  await guardarLocal(); pintarHoy();
  toast(nuevo === "AUTORIZADA" ? "Visita autorizada." : "Solicitud rechazada.", "ok");
  await syncSolicitudes(true);
}

// ---- Pantalla "Nueva visita" (no programada / urgente) ----
function setEquipoNV(e) {
  estado._nvEquipo = e;
  $("#nv-serie").value = e.SERIE || "";
  const cli = clientePorId(e.ID_CLIENTE);
  $("#nv-cliente").textContent = [cli ? "Cliente: " + cli.RAZON_SOCIAL : "", tituloEquipo(e)].filter(Boolean).join(" · ");
  const progs = (estado.catalogo?.programaciones || []).filter(p => p.SERIE === e.SERIE && (p.ESTADO || "PROGRAMADA").toUpperCase() === "PROGRAMADA");
  $("#nv-progs").hidden = !progs.length;
  const cont = $("#nv-progs-lista"); cont.innerHTML = "";
  progs.forEach(p => {
    const b = document.createElement("button"); b.className = "btn btn-ghost btn-block"; b.style.marginTop = "8px";
    b.textContent = "Atender la del " + fmtFecha(p.FECHA_PROGRAMADA) + " · " + (p.TIPO_MANTENIMIENTO || "Mantenimiento");
    b.onclick = () => { marcarVisto(p.ID_VISITA || p.ID_SB); nuevaOT(e, p.TIPO_MANTENIMIENTO, { clase: "PROGRAMADA", visita: p }); };
    cont.appendChild(b);
  });
  actualizarBotonNV();
}
function claseNV() { const r = document.querySelector('input[name="nv-clase"]:checked'); return r ? r.value : "NO_PROGRAMADA"; }
function actualizarBotonNV() {
  const c = claseNV(), b = $("#btn-nv-crear"); if (!b) return;
  b.textContent = esSup() ? "Crear y atender" : c === "URGENTE" ? "🚨 Atender ya" : "Solicitar autorización";
}
function abrirNuevaVisita(equipo) {
  if (!estado.catalogo) { toast("Primero carga el catálogo de oficina.", "err"); return; }
  estado._nvEquipo = null; $("#nv-serie").value = ""; $("#nv-cliente").textContent = ""; $("#nv-motivo").value = "";
  $("#nv-progs").hidden = true;
  document.querySelector('input[name="nv-clase"][value="NO_PROGRAMADA"]').checked = true;
  const sel = $("#nv-tipo"); sel.innerHTML = "";
  (estado.catalogo.tipos_mantenimiento || [TERMINO_PREV]).forEach(t => {
    const o = document.createElement("option"); o.value = t; o.textContent = t; sel.appendChild(o);
  });
  if (equipo && equipo.SERIE) setEquipoNV(equipo); else actualizarBotonNV();
  ir("nueva-visita");
}
function avisarSupervisor(s) {
  const eq = equipoPorSerie(s.serie);
  const L = ["*PROSOL Campo · Visita " + (s.clase === "URGENTE" ? "URGENTE 🚨" : "NO PROGRAMADA") + " por autorizar*",
    "Técnico: " + s.solicitante, "Cliente: " + (s.cliente_nombre || "—"),
    "Equipo: serie " + s.serie + (eq ? " · " + tituloEquipo(eq) : ""),
    "Tipo: " + (s.tipo_mantenimiento || "—"), "Motivo: " + s.motivo];
  if (s.clase === "URGENTE") L.push("", "⚠ Emergencia: el técnico ya está atendiendo; requiere autorización posterior.");
  L.push("", "Autoriza en PROSOL Campo → Hoy → Por autorizar.");
  const sup = supervisores().map(t => numWA(t.TELEFONO)).find(Boolean) || "";
  try { window.open("https://wa.me/" + sup + "?text=" + encodeURIComponent(L.join("\n")), "_blank"); } catch (x) { /* popup bloqueado */ }
}
function crearVisitaNV() {
  const e = estado._nvEquipo;
  if (!e || !e.SERIE) { toast("Elige el equipo primero.", "err"); return; }
  const motivo = $("#nv-motivo").value.trim();
  if (motivo.length < 3) { toast("Escribe el motivo de la visita.", "err"); return; }
  const clase = claseNV(), tipo = $("#nv-tipo").value || TERMINO_PREV, sup = esSup();
  const cli = clientePorId(e.ID_CLIENTE), ahora = new Date().toISOString();
  const s = { id: "L-" + uid(8), _nuevo: true, serie: e.SERIE, id_equipo: e.ID_SB || null,
    id_cliente: cli?.ID_SB || e.ID_CLIENTE || null, cliente_nombre: cli?.RAZON_SOCIAL || "", clase, tipo_mantenimiento: tipo,
    motivo, fecha_prevista: hoyISO(), solicitante: estado.tecnico, estado: sup ? "AUTORIZADA" : "SOLICITADA",
    autorizado_por: sup ? estado.tecnico : null, fecha_resolucion: sup ? ahora : null, atendida: false, creado: ahora };
  estado.solicitudes.unshift(s);
  if (!sup) avisarSupervisor(s);                 // dentro del toque del usuario (el navegador exige eso)
  guardarLocal(); syncSolicitudes(true);
  if (clase === "URGENTE" || sup) { nuevaOT(e, tipo, { clase, sol: s }); return; }
  toast("Solicitud enviada al supervisor.", "ok"); ir("hoy");
}

// Catálogo anterior a M9-B (sin roles ni vínculo de clientes): se baja de nuevo una vez.
function autoActualizarCatalogo() {
  // v3.70 (etapa 2): el catálogo se baja solo con un usuario dentro (antes también en la pantalla de ingreso)
  if (!estado.tecnico) return;
  if (!navigator.onLine || autoActualizarCatalogo._ya
      || !window._prosolSincronizarCatalogoSupabase || typeof API === "undefined" || !API.hayNube()) return;
  autoActualizarCatalogo._ya = true;
  toast("Actualizando catálogo…", "");
  window._prosolSincronizarCatalogoSupabase().then(() => {
    const act = document.querySelector(".screen.active"); const n = act && act.dataset.screen;
    if (n === "equipos") pintarEquipos(); else if (n === "hoy") pintarHoy();
    pintarLogin();
  });
}

// ══════════ M9-C (v3.44): Atrás del celular, menú, Hoy flotante, Clientes, seguimiento y WhatsApp por categorías ══════════
// ---- Botón Atrás del celular: navega dentro de la app, no la cierra ----
function volver() {
  const p = estado._pila || [];
  if (p.length > 1) { p.pop(); ir(p[p.length - 1], true); } else ir("inicio");
}
function cerrarHoja(h) { if (h.id === "sheet-qr") cerrarEscanerQR(); else h.hidden = true; }
function atras() {
  const abierta = $$(".sheet").filter(s => !s.hidden).pop();
  if (abierta) { cerrarHoja(abierta); return ""; }
  if (estado._pantalla === "nueva-ot") { $("#btn-cancelar-ot").click(); return ""; }   // pide confirmación si hay datos
  const p = estado._pila || [];
  if (p.length > 1) { p.pop(); ir(p[p.length - 1], true); return ""; }
  return "salir?";
}
let _ultAtras = 0;
function instalarAtras() {
  try { history.replaceState({ g: 0 }, ""); history.pushState({ g: 1 }, ""); } catch (x) { return; }
  window.addEventListener("popstate", () => {
    if (document.body.classList.contains("modo-admin")) {     // vista de escritorio dentro del móvil
      const m = document.getElementById("_modal_web");
      if (m && !m.classList.contains("oculto")) m.classList.add("oculto");
      else toast("Usa «Salir» para volver al modo campo.");
      try { history.pushState({ g: 1 }, ""); } catch (x) { /* nada */ }
      return;
    }
    if (atras() === "salir?") {
      if (Date.now() - _ultAtras < 2200) { history.back(); return; }   // segundo Atrás seguido: sale
      _ultAtras = Date.now(); toast("Presiona Atrás otra vez para salir de la app.");
    }
    try { history.pushState({ g: 1 }, ""); } catch (x) { /* nada */ }
  });
}

// ---- Hoy como aviso flotante al iniciar (se puede cerrar) ----
function mostrarHoyFlotante() {
  if (estado._hfVisto || !estado.tecnico || !estado.catalogo) return;
  estado._hfVisto = true;
  const a = agendaHoy();
  const filas = [];
  const add = (txt, n, cls) => { if (n) filas.push(`<div class="hf-fila ${cls}"><b>${n}</b> ${txt}</div>`); };
  add("por autorizar", a.porAutorizar.length, "aut"); add("urgentes", a.urgentes.length, "urg");
  add("para hoy", a.hoy.length, ""); add("vencidas", a.vencidas.length, "venc"); add("próximas", a.proximas.length, "");
  if (!filas.length) return;
  if (a.filtro === "MIAS") filas.unshift(`<div class="hf-fila"><small>Tus visitas asignadas (${a.nMias} de ${a.nTodas}). En Hoy puedes ver «Todas».</small></div>`);
  const top = [].concat(a.urgentes, a.porAutorizar, a.hoy, a.vencidas).slice(0, 4).map(i =>
    `<div class="hf-item"><b>${ESC(i.cliente)}</b><span>Serie ${ESC(i.serie)} · ${ESC(i.tipoMant)}</span></div>`).join("");
  $("#hf-fecha").textContent = fmtFecha(hoyISO());
  $("#hf-cuerpo").innerHTML = `<div class="hf-resumen">${filas.join("")}</div>${top}`;
  $("#sheet-hoy-flot").hidden = false;
}

// ---- Clientes ----
let _idxEqCli = { ref: null, map: null };
function equiposDeCliente(c) {
  const arr = estado.catalogo?.equipos || [];
  if (_idxEqCli.ref !== arr) {
    const m = new Map();
    arr.forEach(e => { if (!m.has(e.ID_CLIENTE)) m.set(e.ID_CLIENTE, []); m.get(e.ID_CLIENTE).push(e); });
    _idxEqCli = { ref: arr, map: m };
  }
  const r = [];
  [c.ID_CLIENTE, c.ID_SB].forEach(k => { if (k && _idxEqCli.map.has(k)) r.push(..._idxEqCli.map.get(k)); });
  return r;
}
function pintarClientes() {
  const ul = $("#lista-clientes"); ul.innerHTML = "";
  const q = ($("#buscar-cliente").value || "").trim().toLowerCase();
  let arr = estado.catalogo?.clientes || [];
  if (q) arr = arr.filter(c => [c.RAZON_SOCIAL, c.IDENTIFICACION, c.TELEFONO, c.CIUDAD, c.CONTACTO, c.ZONA].filter(Boolean).join(" ").toLowerCase().includes(q));
  arr = arr.slice().sort((a, b) => (a.RAZON_SOCIAL || "").localeCompare(b.RAZON_SOCIAL || ""));
  const LIM = 200;
  $("#clientes-count").textContent = !estado.catalogo ? "Carga el catálogo para ver los clientes."
    : arr.length > LIM ? `${arr.length} cliente(s) · se muestran ${LIM}, afina la búsqueda` : `${arr.length} cliente(s)`;
  arr.slice(0, LIM).forEach(c => {
    const n = equiposDeCliente(c).length;
    const li = document.createElement("li"); li.className = "row";
    li.innerHTML = `<div class="row-main"><div class="row-title">${ESC(c.RAZON_SOCIAL) || "—"}</div>
      <div class="row-sub">${ESC([c.CIUDAD, c.TELEFONO].filter(Boolean).join(" · ")) || "Sin datos de contacto"}</div></div>
      <span class="row-tag" style="background:#E8EEF3;color:var(--grafito)">${n} eq.</span><span class="row-chev">›</span>`;
    li.onclick = () => abrirCliente(c);
    ul.appendChild(li);
  });
}
function abrirCliente(c) {
  estado._clienteActual = c;
  $("#cli-titulo").textContent = c.RAZON_SOCIAL || "Cliente";
  const tel = (c.TELEFONO || "").replace(/[^\d+]/g, ""), wa = numWA(c.TELEFONO);
  const dirTxt = [c.DIRECCION, c.CIUDAD].filter(Boolean).join(", ");
  const mapa = dirTxt ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(dirTxt) : "";
  const eqs = equiposDeCliente(c);
  const series = new Set(eqs.map(e => e.SERIE));
  const hist = [];
  series.forEach(s => historialDeSerie(s).forEach(o => hist.push(o)));
  hist.sort((a, b) => (b.FECHA || "").localeCompare(a.FECHA || ""));
  $("#cli-datos").innerHTML = `
    <div class="row-title" style="white-space:normal">${ESC(c.RAZON_SOCIAL) || "—"}</div>
    <div class="eq-acciones" style="margin-top:10px">
      ${tel ? `<a class="btn btn-ghost" href="tel:${ESC(tel)}">📞 Llamar</a>` : ""}
      ${wa ? `<a class="btn btn-ghost" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
    </div>
    <div class="eq-acciones">
      ${c.EMAIL ? `<a class="btn btn-ghost" href="mailto:${ESC(c.EMAIL)}">✉ Correo</a>` : ""}
      ${mapa ? `<a class="btn btn-ghost" href="${ESC(mapa)}" target="_blank" rel="noopener">🧭 Cómo llegar</a>` : ""}
    </div>
    <h3 class="eq-h">Resumen</h3>
    <div class="eq-grid">
      ${filaDato("Equipos", eqs.length)}
      ${filaDato("Visitas registradas", hist.length)}
      ${filaDato("Última visita", hist[0] ? fmtFecha(hist[0].FECHA) + " · OT " + (hist[0].NUMERO_OT || "—") : "")}
      ${filaDato("Último trabajo", hist[0] ? hist[0].TIPO_OT : "")}
    </div>
    <h3 class="eq-h">Datos del cliente</h3>
    <div class="eq-grid">
      ${filaDato("Razón social", c.RAZON_SOCIAL)}
      ${filaDato("Identificación", c.IDENTIFICACION)}
      ${filaDato("Contacto", c.CONTACTO)}
      ${filaDato("Teléfono", c.TELEFONO)}
      ${filaDato("Correo", c.EMAIL)}
      ${filaDato("Ciudad", c.CIUDAD)}
      ${filaDato("Zona", c.ZONA)}
      ${filaDato("Dirección", c.DIRECCION)}
      ${filaDato("Código oficina", c.ID_CLIENTE)}
    </div>`;
  const ule = $("#cli-equipos"); ule.innerHTML = "";
  if (!eqs.length) ule.innerHTML = `<li class="hint">Sin equipos registrados.</li>`;
  eqs.forEach(e => {
    const r = resumenEquipo(e);
    const li = document.createElement("li"); li.className = "row";
    li.innerHTML = `<div class="row-main"><div class="row-title">Serie ${ESC(e.SERIE)}</div>
      <div class="row-sub">${ESC(tituloEquipo(e))}${r.ult ? " · últ. " + fmtFecha(r.ult.FECHA) : ""}</div></div><span class="row-chev">›</span>`;
    li.onclick = () => abrirEquipo(e);
    ule.appendChild(li);
  });
  const ulp = $("#cli-prog"); ulp.innerHTML = "";
  const progs = (estado.catalogo?.programaciones || []).filter(p => (p.ESTADO || "PROGRAMADA").toUpperCase() === "PROGRAMADA" && (series.has(p.SERIE) || p.ID_CLIENTE === c.ID_CLIENTE || p.ID_CLIENTE === c.ID_SB));
  if (!progs.length) ulp.innerHTML = `<li class="hint">Sin visitas programadas.</li>`;
  progs.forEach(p => {
    const li = document.createElement("li"); li.className = "row";
    li.innerHTML = `<div class="row-main"><div class="row-title">${fmtFecha(p.FECHA_PROGRAMADA)} · ${ESC(p.TIPO_MANTENIMIENTO || "Mantenimiento")}</div>
      <div class="row-sub">Serie ${ESC(p.SERIE)}</div></div>`;
    ulp.appendChild(li);
  });
  const ulh = $("#cli-historial"); ulh.innerHTML = "";
  if (!hist.length) ulh.innerHTML = `<li class="hint">Sin trabajos registrados.</li>`;
  hist.slice(0, 15).forEach(o => {
    const li = document.createElement("li"); li.className = "tl-item";
    const hrs = Number(o.HORAS_MAQUINA) > 0 ? " · " + Number(o.HORAS_MAQUINA) + " h" : "";
    li.innerHTML = `<div class="tl-date">${fmtFecha(o.FECHA)} · OT ${ESC(o.NUMERO_OT) || "—"} · serie ${ESC(o.SERIE)}</div>
      <div class="tl-meta">${ESC(o.TIPO_OT)} · ${ESC(o.ESTADO)}${hrs}</div>`;
    ulh.appendChild(li);
  });
  ir("cliente-detalle");
}

// ---- Contactos WhatsApp por categorías ----
const CATS = [["COMERCIAL", "Área comercial"], ["TECNICA", "Área técnica"], ["SUPERVISOR", "Supervisor"], ["TECNICO", "Técnicos"], ["GERENTE", "Gerente"], ["DUENO", "Dueño de la compañía"], ["ADICIONAL", "Adicionales"]];
const GRUPO_TECNICO = ["COMERCIAL", "TECNICA", "SUPERVISOR", "TECNICO", "GERENTE", "DUENO"];
function contactosOficina() {
  return (estado.catalogo?.tecnicos || []).map(t => ({
    id: "of:" + (t.ID_SB || t.ID_TECNICO), cat: /SUPERVISOR/i.test(t.ESPECIALIDAD || "") ? "SUPERVISOR" : "TECNICO",
    nombre: nombreTecnico(t), tel: numWA(t.TELEFONO), origen: "oficina" })).filter(c => c.tel);
}
function contactosTodos() {
  const r = contactosOficina();
  (estado.contactos || []).filter(c => c.activo !== false).forEach(c => {
    const tel = numWA(c.telefono);
    if (tel && !r.some(x => x.cat === c.categoria && x.tel === tel))
      r.push({ id: c.id, cat: c.categoria, nombre: c.nombre, tel, origen: "nube", ref: c });
  });
  return r;
}
async function guardarContactos() { await DB.set("contactos_wa", estado.contactos || []); }
let _ctSyncTs = 0, _ctBusy = false;
async function syncContactos(forzar) {
  if (typeof API === "undefined" || !API.hayNube() || !navigator.onLine || _ctBusy) return;
  if (!forzar && Date.now() - _ctSyncTs < 30000) return;
  _ctBusy = true;
  try {
    for (const c of estado.contactos || []) {
      try {
        if (c._nuevo) {
          const r = await API.insert("contactos_wa", { categoria: c.categoria, nombre: c.nombre, telefono: c.telefono, activo: c.activo !== false, creado_por: c.creado_por || estado.tecnico });
          if (r && r.id) { c.id = r.id; delete c._nuevo; if (c._patch) { /* cambios hechos durante el envío */ } }
        } else if (c._patch && UUID_RE.test(String(c.id))) { await API.update("contactos_wa", c.id, c._patch); delete c._patch; }
      } catch (x) { /* queda pendiente */ }
    }
    const remoto = await API.select("contactos_wa");
    if (Array.isArray(remoto)) {
      const pend = (estado.contactos || []).filter(c => c._nuevo || c._patch);
      estado.contactos = remoto.map(r => pend.find(p => p.id === r.id) || r).concat(pend.filter(p => p._nuevo));
      _ctSyncTs = Date.now();
    }
    await guardarContactos();
  } catch (x) { /* sin red */ } finally { _ctBusy = false; }
  if ($("#contactos-lista") && estado._pantalla === "contactos") pintarContactos();
}
function pintarContactos() {
  const cont = $("#contactos-lista"); const todos = contactosTodos();
  cont.innerHTML = CATS.map(([cat, nom]) => {
    const l = todos.filter(c => c.cat === cat);
    return `<h2 class="hoy-h">${nom} <span>${l.length}</span></h2>` + (l.length ? l.map(c => `
      <div class="row ct-row" data-id="${ESC(c.id)}"><div class="row-main"><div class="row-title">${ESC(c.nombre)}</div>
      <div class="row-sub">+${ESC(c.tel)}${c.origen === "oficina" ? " · de oficina" : ""}</div></div>
      ${c.origen === "nube" ? '<span class="row-chev">✎</span>' : ""}</div>`).join("") : `<p class="hint" style="margin:0 0 4px">Sin contactos.</p>`);
  }).join("");
}
function abrirContacto(c) {
  estado._ctEdit = c || null;
  $("#ct-titulo").textContent = c ? "Editar contacto" : "Nuevo contacto";
  $("#ct-cat").value = c ? c.categoria : "COMERCIAL";
  $("#ct-nombre").value = c ? c.nombre : ""; $("#ct-tel").value = c ? c.telefono : "";
  $("#ct-quitar").hidden = !c;
  $("#sheet-contacto").hidden = false;
}
async function guardarContacto() {
  const nombre = $("#ct-nombre").value.trim(), tel = $("#ct-tel").value.trim();
  if (!nombre || !numWA(tel)) { toast("Escribe el nombre y un teléfono válido.", "err"); return; }
  const f = { categoria: $("#ct-cat").value, nombre, telefono: tel }, c = estado._ctEdit;
  if (c) { Object.assign(c, f); if (!c._nuevo) c._patch = Object.assign(c._patch || {}, f); }
  else (estado.contactos = estado.contactos || []).push(Object.assign({ id: "tmp" + uid(8), _nuevo: true, activo: true, creado_por: estado.tecnico }, f));
  await guardarContactos(); $("#sheet-contacto").hidden = true; pintarContactos(); syncContactos(true);
  toast("Contacto guardado.", "ok");
}
async function quitarContacto() {
  const c = estado._ctEdit; if (!c) return;
  if (c._nuevo) estado.contactos = estado.contactos.filter(x => x !== c);
  else { c.activo = false; c._patch = Object.assign(c._patch || {}, { activo: false }); }
  await guardarContactos(); $("#sheet-contacto").hidden = true; pintarContactos(); syncContactos(true);
}

// ---- Destinatarios WhatsApp: grupo técnico → cliente → adicionales ----
async function abrirDestinos(o) {
  estado._dest = o; estado._lote = null;
  if (typeof API !== "undefined" && API.hayNube() && navigator.onLine !== false)
    await Promise.race([syncContactos(true), new Promise(r => setTimeout(r, 3000))]);
  const todos = contactosTodos();
  const yo = (estado.tecnico || "").toLowerCase();
  $("#dest-titulo").textContent = o.titulo || "Enviar por WhatsApp";
  const sec = (cats, vacio) => cats.map(cat => {
    const l = todos.filter(c => c.cat === cat); if (!l.length) return "";
    return `<div class="dest-cat">${CATS.find(x => x[0] === cat)[1]}</div>` + l.map(c => `
      <label class="dest-fila"><input type="checkbox" class="dest-chk" data-nombre="${ESC(c.nombre)}" data-tel="${c.tel}" ${c.nombre.toLowerCase() === yo ? "" : "checked"}>
      <span>${ESC(c.nombre)}<small>+${c.tel}</small></span></label>`).join("");
  }).join("") || `<p class="hint">${vacio}</p>`;
  const cli = o.cliente || {}; const telCli = numWA(cli.tel);
  const hayFiles = o.files && o.files.length;
  (estado._destUrls || []).forEach(u => { try { URL.revokeObjectURL(u); } catch (x) { /* nada */ } });
  estado._destUrls = hayFiles ? o.files.map(f => URL.createObjectURL(f)) : [];
  // WhatsApp: UN solo envío; el teléfono admite hasta MAX_FOTOS_ENVIO archivos (se marcan las primeras, con la firma)
  const idxFirma = hayFiles ? o.files.findIndex(f => /_firma\./i.test(f.name)) : -1;
  const marcadas = new Set(); if (idxFirma >= 0) marcadas.add(idxFirma);
  if (hayFiles) for (let i = 0; i < o.files.length && marcadas.size < MAX_FOTOS_ENVIO; i++) marcadas.add(i);
  const esFinal = !!(o.reg && o.reg.tipo === "FINAL" && o.h);
  const etiq = (f, i) => /_firma\./i.test(f.name) ? "Firma" : "Foto " + (i + 1);
  const miniaturas = hayFiles ? `<div class="field-label" style="margin-top:4px">Fotos para WhatsApp (un solo envío · mínimo 1, máximo ${MAX_FOTOS_ENVIO})</div>
    <div class="dest-fotos">${o.files.map((f, i) => `<label class="dest-foto"><img src="${estado._destUrls[i]}" alt="">
      <input type="checkbox" class="dest-foto-chk" data-i="${i}" ${marcadas.has(i) ? "checked" : ""}><span>${etiq(f, i)}</span></label>`).join("")}</div>
    <p class="hint" id="dest-fotos-n" style="margin:2px 0 8px"></p>` : "";
  const fotosSeg = esFinal ? (o.h._fotos || []) : [];
  const miniSeg = fotosSeg.length ? `<details class="dest-seg" open><summary>🔎 Fotos para el seguimiento en línea del cliente <span id="dest-seg-n"></span></summary>
    <p class="hint" style="margin:4px 0 6px">Confirma las que verá el cliente en su enlace (sin límite). Se publican al enviar el reporte.</p>
    <div class="dest-fotos">${fotosSeg.map((f, i) => `<label class="dest-foto"><img src="${f.dataUrl}" alt="">
      <input type="checkbox" class="dest-seg-chk" data-n="${ESC(f.nombre)}" ${o.h._segFotos ? (o.h._segFotos.includes(f.nombre) ? "checked" : "") : "checked"}><span>${/_firma\./i.test(f.nombre || "") ? "Firma" : "Foto " + (i + 1)}</span></label>`).join("")}</div></details>` : "";
  $("#dest-cuerpo").innerHTML = (hayFiles ? `${miniaturas}
    <button class="btn btn-primary btn-block dest-wa-libre" id="dest-con-fotos">📲 Enviar reporte con fotos por WhatsApp</button>
    <p class="hint" style="margin:6px 0 8px">Se abre WhatsApp con el reporte y las fotos marcadas: eliges el contacto o grupo y pulsas Enviar.</p>
    <div id="dest-plan-b" class="dest-plan-b" hidden></div>
    <button class="btn btn-ghost btn-block" id="dest-wa-libre">📲 Abrir WhatsApp (solo texto, sin fotos)</button>${miniSeg}`
    : `<button class="btn btn-primary btn-block dest-wa-libre" id="dest-wa-libre">📲 Abrir WhatsApp y elegir contactos o grupos</button>
    <p class="hint" style="margin:6px 0 4px">Se abre WhatsApp con el reporte listo: eliges el chat o grupo (ej. Servicio Técnico PROSOL S.A.) y pulsas Enviar.</p>
    <button class="btn btn-ghost btn-block" id="dest-compartir">📤 Compartir… (eliges contactos o grupos)</button>${miniSeg}`) + `
    <details class="dest-rapida"><summary>Lista rápida (números guardados)</summary>
    <h3 class="eq-h">1 · Grupo técnico</h3>${sec(GRUPO_TECNICO, "Aún no hay contactos. Agrégalos en Inicio → Contactos WhatsApp.")}
    <h3 class="eq-h">2 · Cliente</h3>
    <label class="dest-fila"><input type="checkbox" id="dest-cli" ${o.clienteDefault ? "checked" : ""}>
      <span>Enviar también al cliente (constancia)<small>${ESC(cli.nombre || "Cliente")}${telCli ? " · +" + telCli : ""}</small></span></label>
    ${telCli ? "" : `<input id="dest-cli-tel" type="tel" inputmode="tel" placeholder="Teléfono del cliente" style="width:100%;margin:4px 0 8px">`}
    <h3 class="eq-h">3 · Otros números</h3>${sec(["ADICIONAL"], "")}
    <input id="dest-otro" type="tel" inputmode="tel" placeholder="Otro número (ej. 0991234567)" style="width:100%;margin-top:6px">
    <button class="btn btn-ghost btn-block" id="dest-enviar" style="margin-top:10px">📲 Enviar a los marcados (uno por uno)</button>
    </details>`;
  $("#dest-pie").innerHTML = "";
  $("#dest-enviar").onclick = armarColaDestinos;
  // la línea de fotos del reporte dice la verdad según la vía (con fotos / solo texto)
  const nTot = hayFiles ? o.files.length : 0;
  const sel = () => hayFiles ? $$("#dest-cuerpo .dest-foto-chk").filter(c => c.checked).map(c => o.files[Number(c.dataset.i)]) : [];
  o._sel = sel; o._selFijada = null;
  const conFotos = (fs) => textoConFotos(o.texto, fs.length, fs.some(f => /_firma\./i.test(f.name)), nTot);
  // selección para el seguimiento del cliente (se guarda en la orden y se usa en el cierre)
  o._selSeg = () => $$("#dest-cuerpo .dest-seg-chk").filter(c => c.checked).map(c => c.dataset.n);
  const cuentaSeg = () => { const el = $("#dest-seg-n"); if (el) el.textContent = "(" + o._selSeg().length + " de " + fotosSeg.length + ")"; if (esFinal) o.h._segFotos = o._selSeg(); };
  $$("#dest-cuerpo .dest-seg-chk").forEach(c => c.onchange = cuentaSeg); cuentaSeg();
  const soloTexto = () => hayFiles ? textoSinFotos(o.texto, nTot) : o.texto;
  o._textoSolo = soloTexto();
  if (hayFiles) {
    const cuenta = () => {
      const n = sel().length;
      $("#dest-fotos-n").textContent = n + " de " + nTot + " seleccionada(s)" + (n > MAX_FOTOS_ENVIO ? " · máximo " + MAX_FOTOS_ENVIO + " por envío: desmarca " + (n - MAX_FOTOS_ENVIO) : "") +
        (nTot > MAX_FOTOS_ENVIO && n <= MAX_FOTOS_ENVIO ? " · todas las fotos quedan en el seguimiento del cliente" : "");
      $("#dest-fotos-n").classList.toggle("err", n > MAX_FOTOS_ENVIO);
      $("#dest-con-fotos").disabled = n === 0 || n > MAX_FOTOS_ENVIO;
      $("#dest-con-fotos").textContent = "📲 Enviar reporte con " + n + " foto(s) por WhatsApp";
    };
    $$("#dest-cuerpo .dest-foto-chk").forEach(c => c.onchange = cuenta); cuenta();
    const listo = (fs, como) => {
      registrarCompartido(o, como || ("WhatsApp con " + fs.length + " foto(s) (contacto o grupo elegido)"), "COMPARTIDO");
      if (o.alTerminar) o.alTerminar(); $("#sheet-dest").hidden = true; refrescarEnvViews();
    };
    $("#dest-con-fotos").onclick = async () => {
      const fs = sel(); if (!fs.length) { toast("Marca al menos 1 foto.", "err"); return; }
      const r = await compartirArchivos(conFotos(fs), fs, o.titulo);
      if (r.ok) { listo(fs); return; }
      if (r.err === "AbortError") { toast("Envío cancelado. Puedes intentarlo de nuevo.", ""); return; }
      // plan B (el teléfono no aceptó texto + fotos juntos): copiar el reporte y compartir las fotos en un solo envío
      const pb = $("#dest-plan-b"); pb.hidden = false;
      pb.innerHTML = `<p><b>El teléfono no aceptó el reporte con las fotos juntos</b> (${ESC(r.motivo)}). Hazlo en dos toques:</p>
        <button class="btn btn-ghost btn-block" id="pb-copiar">1 · 📋 Copiar el reporte</button>
        <button class="btn btn-primary btn-block" id="pb-fotos" style="margin-top:6px">2 · 🖼️ Compartir las ${fs.length} foto(s) y pegar el reporte en el chat</button>`;
      $("#pb-copiar").onclick = async () => {
        try { await navigator.clipboard.writeText(conFotos(fs)); toast("Reporte copiado. Ahora comparte las fotos y pégalo en el chat.", "ok"); }
        catch (x) { toast("No se pudo copiar automáticamente; usa «Abrir WhatsApp (solo texto)».", "err"); }
      };
      $("#pb-fotos").onclick = async () => {
        const r2 = await compartirArchivos("", fs, o.titulo);
        if (r2.ok) listo(fs, "WhatsApp: " + fs.length + " foto(s) + reporte pegado (contacto o grupo elegido)");
        else if (r2.err !== "AbortError") toast("El teléfono tampoco aceptó las fotos (" + r2.motivo + "). Usa «Abrir WhatsApp (solo texto)» y adjunta las fotos en el chat.", "err");
      };
    };
  } else {
    $("#dest-compartir").onclick = async () => { if (await compartirNativo(o.texto, [], o.titulo)) { registrarCompartido(o); if (o.alTerminar) o.alTerminar(); $("#sheet-dest").hidden = true; refrescarEnvViews(); } };
  }
  $("#dest-wa-libre").onclick = () => {
    try { window.open("https://wa.me/?text=" + encodeURIComponent(soloTexto()), "_blank"); } catch (x) { /* popup bloqueado */ }
    registrarCompartido(o, "WhatsApp (contacto o grupo elegido en WhatsApp)", "ABIERTO");
    if (o.alTerminar) o.alTerminar(); $("#sheet-dest").hidden = true; refrescarEnvViews();
  };
  $("#sheet-dest").hidden = false;
  syncContactos();
}
function armarColaDestinos() {
  const o = estado._dest, dest = [];
  if (o._sel) o._selFijada = o._sel();   // la cola reemplaza las miniaturas: se guarda la selección para el cierre
  $$("#dest-cuerpo .dest-chk").forEach(c => { if (c.checked) dest.push({ nombre: c.dataset.nombre, tel: c.dataset.tel }); });
  if ($("#dest-cli") && $("#dest-cli").checked) {
    const t = numWA((o.cliente || {}).tel || ($("#dest-cli-tel") ? $("#dest-cli-tel").value : ""));
    if (!t) { toast("Falta el teléfono del cliente.", "err"); return; }
    dest.push({ nombre: "Cliente · " + ((o.cliente || {}).nombre || ""), tel: t });
  }
  const otro = $("#dest-otro") ? numWA($("#dest-otro").value) : "";
  if (otro) dest.push({ nombre: "Otro número", tel: otro });
  const vistos = new Set(); const unicos = dest.filter(d => !vistos.has(d.tel) && vistos.add(d.tel));
  if (!unicos.length) { toast("Marca al menos un destinatario.", "err"); return; }
  pintarCola(nuevoLote(Object.assign({}, o, { texto: o._textoSolo || o.texto }), unicos), o, false);
}
// ---- M9-D (v3.45): estado de envío por destinatario (bitácora local + tabla ot_envios) ----
// wa.me no informa si el mensaje salió: se registra lo que sí se sabe (Abierto en WhatsApp / Compartido / Pendiente).
const ENV_EST = { PENDIENTE: "⏳ Pendiente", ABIERTO: "✓ Abierto en WhatsApp", COMPARTIDO: "📤 Compartido" };
const ENV_TIPO = { ETAPA: "Aviso de etapa", PARCIAL: "Avance parcial", FINAL: "Reporte final" };
async function guardarEnv() {
  if (!estado.tecnico) return;
  await DB.set("waenv::" + estado.tecnico, estado.waEnv || {});
  await DB.set("envq::" + estado.tecnico, estado.envQ || []);
}
function nuevoLote(o, dest) {
  const r = o.reg || {}, id = "L" + Date.now().toString(36) + uid(6);
  const L = { lote: id, tipo: r.tipo || "FINAL", key: r.key || null, numero_ot: r.numero_ot || null, serie: r.serie || "",
    titulo: o.titulo || "", texto: o.texto || "", t: new Date().toISOString(),
    dest: dest.map(d => ({ nombre: d.nombre, tel: d.tel || "", estado: "PENDIENTE", t: null })) };
  (estado.waEnv = estado.waEnv || {})[id] = L; guardarEnv();
  return L;
}
function marcarEnvio(L, d, est) {
  d.estado = est; d.t = new Date().toISOString(); d._sub = true;
  (estado.envQ = estado.envQ || []).push({ fila: { lote: L.lote, tipo: L.tipo, clave_visita: L.key, numero_ot: L.numero_ot, serie: L.serie,
    tecnico: estado.tecnico, destinatario: d.nombre, telefono: d.tel || null, estado: est, ocurrio: d.t } });
  guardarEnv(); syncEnvios();
}
function cerrarLote(L) {
  if (!L || L._cerrado) return;
  L._cerrado = true;
  L.dest.forEach(d => { if (d.estado === "PENDIENTE" && !d._sub) marcarEnvio(L, d, "PENDIENTE"); });
  guardarEnv();
}
const lotePend = L => L.dest.filter(d => d.estado === "PENDIENTE");
const loteResumen = L => (L.dest.length - lotePend(L).length) + "/" + L.dest.length;
function lotesDe(key, numero) {
  return Object.values(estado.waEnv || {}).filter(L => (key && L.key === key) || (numero && L.numero_ot && String(L.numero_ot) === String(numero)))
    .sort((a, b) => a.t.localeCompare(b.t));
}
let _envBusy = false;
async function syncEnvios() {
  if (_envBusy || typeof API === "undefined" || !API.hayNube() || !navigator.onLine || !(estado.envQ || []).length) return;
  _envBusy = true;
  try { let r; while ((r = (estado.envQ || [])[0])) { await API.insert("ot_envios", r.fila); estado.envQ = estado.envQ.filter(x => x !== r); } } catch (x) { /* sin red: queda en cola */ }
  finally { _envBusy = false; guardarEnv(); }
}
function pintarCola(L, o, soloPend) {
  estado._lote = L; L._cerrado = false;
  const lista = L.dest.map((d, i) => ({ d, i })).filter(x => !soloPend || x.d.estado === "PENDIENTE");
  const fila = ({ d, i }) => `<div class="row dest-q ${d.estado !== "PENDIENTE" ? "hecho" : ""}" data-i="${i}"><div class="row-main"><div class="row-title">${ESC(d.nombre)}</div>
      <div class="row-sub">+${ESC(d.tel)} · <b class="env-est">${ENV_EST[d.estado]}</b></div></div>
      <button class="btn btn-primary" style="min-height:42px;padding:0 14px">${d.estado === "PENDIENTE" ? "Abrir ▶" : "Abrir otra vez"}</button></div>`;
  $("#dest-cuerpo").innerHTML = `<p class="hint">Toca cada destinatario: se abre WhatsApp con el mensaje listo y tú pulsas Enviar. Queda registrado el estado de cada uno.</p>` +
    lista.map(fila).join("") + `<p class="hint" id="dest-cont"></p>`;
  const cont = () => { $("#dest-cont").textContent = "Abiertos " + loteResumen(L) + (lotePend(L).length ? " · pendientes " + lotePend(L).length : " · todos abiertos"); };
  $$("#dest-cuerpo .dest-q").forEach(r => r.querySelector("button").onclick = () => {
    const d = L.dest[Number(r.dataset.i)];
    try { window.open("https://wa.me/" + d.tel + "?text=" + encodeURIComponent(L.texto), "_blank"); } catch (x) { /* popup bloqueado */ }
    marcarEnvio(L, d, "ABIERTO");
    r.classList.add("hecho"); r.querySelector("button").textContent = "Abrir otra vez"; r.querySelector(".env-est").textContent = ENV_EST.ABIERTO; cont();
  });
  cont();
  $("#dest-pie").innerHTML = `<button class="btn btn-primary btn-block" id="dest-listo">Listo</button>`;
  $("#dest-listo").onclick = () => { cerrarLote(L); estado._lote = null; if (o.alTerminar) o.alTerminar(); $("#sheet-dest").hidden = true; refrescarEnvViews(); };
}
function registrarCompartido(o, nombre, est) {
  const L = nuevoLote(o, [{ nombre: nombre || "Compartir… (contacto o grupo elegido en el teléfono)", tel: "" }]);
  marcarEnvio(L, L.dest[0], est || "COMPARTIDO"); L._cerrado = true; guardarEnv();
}
function reenviarPendientes(lote) {
  const L = (estado.waEnv || {})[lote]; if (!L || !lotePend(L).length) return;
  $("#dest-titulo").textContent = "Reenviar · " + (L.titulo || ENV_TIPO[L.tipo]);
  pintarCola(L, { titulo: L.titulo, texto: L.texto }, true);
  $("#sheet-dest").hidden = false;
}
function refrescarEnvViews() {
  if (!$("#sheet-seg").hidden && estado._segIt) abrirSeg(estado._segIt);
  if (!$("#sheet-orden").hidden && estado._ordenHist != null) abrirOrdenHistorial(estado._ordenHist);
  if (estado._pantalla === "historial") pintarHistorial();
}
function envBloqueHTML(lotes) {
  if (!lotes.length) return "";
  return `<div class="field-label">Envíos por WhatsApp</div>` + lotes.slice().reverse().map(L => {
    const p = lotePend(L).length;
    return `<div class="env-lote"><div class="row-title" style="white-space:normal">${ESC(ENV_TIPO[L.tipo] || L.tipo)} · ${ESC(hhmm(L.t))} · abiertos ${loteResumen(L)}</div>` +
      L.dest.map(d => `<div class="row-sub env-d env-${d.estado.toLowerCase()}">${ENV_EST[d.estado]} — ${ESC(d.nombre)}${d.tel ? " +" + ESC(d.tel) : ""}</div>`).join("") +
      (p ? `<button class="btn btn-ghost env-reenv" data-lote="${ESC(L.lote)}" style="min-height:38px;margin-top:6px">📲 Reenviar a pendientes (${p})</button>` : "") + `</div>`;
  }).join("");
}
// línea de fotos del reporte según lo que realmente viaja
function textoConFotos(t, n, firma, tot) {
  return String(t).replace(/^📷 .*$/m, "📷 " + n + " foto(s) adjunta(s)" + (firma ? " · con firma del cliente" : "") +
    (n < tot ? " (de " + tot + " registradas; todas en el seguimiento en línea)" : ""));
}
function textoSinFotos(t, tot) {
  return String(t).replace(/^📷 .*$/m, "📷 " + tot + " foto(s) registradas en la orden (no van en este mensaje)");
}
// v3.49: límite de archivos por envío del teléfono (Chrome/Android) y compartir con motivo claro
const MAX_FOTOS_ENVIO = 10;
const MOTIVO_SHARE = { NotAllowedError: "el teléfono no permitió compartir en este momento", DataError: "demasiadas fotos o archivos muy pesados",
  TypeError: "formato no admitido", NotSupportedError: "el teléfono no admite compartir archivos desde la app" };
async function compartirArchivos(texto, files, titulo) {
  const d = { title: titulo || "PROSOL" }; if (texto) d.text = texto;
  if (files && files.length) d.files = files;
  if (!navigator.share) return { ok: false, err: "NotSupportedError", motivo: MOTIVO_SHARE.NotSupportedError };
  if (d.files && navigator.canShare && !navigator.canShare({ files: d.files })) return { ok: false, err: "NotSupportedError", motivo: MOTIVO_SHARE.NotSupportedError };
  try { await navigator.share(d); return { ok: true }; }
  catch (x) { const n = (x && x.name) || "Error"; return { ok: false, err: n, motivo: MOTIVO_SHARE[n] || ((x && x.message) || n) }; }
}
async function compartirNativo(texto, files, titulo) {
  const d = { text: texto, title: titulo || "PROSOL" };
  if (files && files.length) {
    if (navigator.canShare && navigator.canShare({ files })) d.files = files;
    else { toast("Este celular no permite adjuntar las fotos desde la app: usa «Abrir WhatsApp (solo texto)» y adjunta las fotos en el chat.", "err"); return false; }
  }
  if (navigator.share) {
    try { await navigator.share(d); return true; }
    catch (x) { if (!(x && x.name === "AbortError")) toast("No se pudo compartir: " + (MOTIVO_SHARE[x && x.name] || (x && x.message) || "error") + ".", "err"); return false; }
  }
  try { await navigator.clipboard.writeText(texto); toast("Mensaje copiado. Pégalo en WhatsApp.", "ok"); return true; }
  catch (x) { toast("No se pudo compartir.", "err"); return false; }
}

// ---- Seguimiento de la visita: etapas y avances parciales ----
const ETAPAS = [["PROGRAMADA", "Programada", "📅"], ["EN_CAMINO", "En camino", "🚚"], ["EN_SITIO", "En sitio", "📍"], ["EN_PROCESO", "En proceso", "🔧"], ["FINALIZADA", "Finalizada", "✅"]];
const etapaTxt = c => { const x = ETAPAS.find(e => e[0] === c); return x ? x[2] + " " + x[1] : c; };
const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : fmtFecha(iso.slice(0, 10)) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
function segDe(key, crear) {
  estado.seguim = estado.seguim || {};
  if (!estado.seguim[key] && crear) estado.seguim[key] = { key, etapa: "PROGRAMADA", ev: [], av: [] };
  const sg = estado.seguim[key] || null;
  if (sg && !sg.token) sg.token = nuevoTokenSeg();
  return sg;
}
// ════ M13 (v3.48): seguimiento de la orden para el CLIENTE ════
// Enlace propio por visita (32 hex aleatorios) → página pública seguimiento.html; la app publica cada etapa y
// avance (cola sin señal) con la función seguimiento_guardar; el cierre publica el reporte con las fotos elegidas.
function nuevoTokenSeg() {
  const b = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); });
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}
function urlSeguimiento(token) { return location.origin + location.pathname.replace(/[^/]*$/, "") + "seguimiento.html?t=" + token; }
function tokenDeOT(h) {
  if (h._segToken) return h._segToken;
  const sg = sgDeOT(h);
  h._segToken = sg ? sg.token : nuevoTokenSeg();
  guardarLocal();
  return h._segToken;
}
function datosSeg(sg, extra) {
  const m = sg.meta || {};
  return Object.assign({
    clave_visita: sg.key, numero_ot: sg.numero_ot || null, serie: m.serie || null, cliente_nombre: m.cliente || null,
    equipo_txt: m.equipo || null, tecnico: estado.tecnico, tipo_mant: m.tipoMant || null, clase: m.clase || null,
    etapa: sg.etapa, etapas: (sg.ev || []).map(x => ({ e: x.e, t: x.t })),
    avances: (sg.av || []).map(x => ({ t: x.t, texto: x.texto || "", n: x.n || 0, visible: x.visible !== false, fotos: x.fotos || [] }))
  }, extra || {});
}
function publicarSeg(token, datos) {
  if (!token) return;
  (estado.segQ = estado.segQ || {})[token] = datos;   // solo cuenta el último estado de cada enlace
  guardarLocal(); syncSegCliente();
}
function publicarSegDeVisita(key) { const sg = segDe(key, false); if (sg) publicarSeg(sg.token, datosSeg(sg)); }
let _segBusy = false;
async function syncSegCliente() {
  if (_segBusy || typeof API === "undefined" || !API.hayNube() || navigator.onLine === false) return;
  const ks = Object.keys(estado.segQ || {}); if (!ks.length) return;
  _segBusy = true;
  try {
    // v3.69: cada seguimiento se envía por separado; si uno falla, los demás igual salen (antes uno trababa la cola)
    for (const k of ks) {
      const d = estado.segQ[k];
      try {
        await API.rpc("seguimiento_guardar", { p_token: k, p_datos: d });
        if (estado.segQ[k] === d) delete estado.segQ[k];     // si cambió mientras se enviaba, se reenvía luego
      } catch (x) { /* sin red o rechazo: ese queda en cola y se reintenta */ }
    }
  } finally { _segBusy = false; guardarLocal(); if (Object.keys(estado.segQ || {}).length && navigator.onLine !== false) setTimeout(syncSegCliente, 15000); }
}
// reduce una foto para la página del cliente (≈800 px, liviana)
function reducirFoto(dataUrl, max) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => { const e = Math.min(1, (max || 800) / Math.max(img.width, img.height)); const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * e); cv.height = Math.round(img.height * e); cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      res(cv.toDataURL("image/jpeg", 0.72)); };
    img.onerror = () => res(null); img.src = dataUrl;
  });
}
// cierre: el seguimiento termina con el envío del reporte final; queda como constancia (30 días)
async function publicarCierre(h, confirmadas) {
  const token = tokenDeOT(h), sg = sgDeOT(h);
  // v3.49: todas las fotos de la orden que el técnico confirmó para el seguimiento (sin límite; por defecto todas)
  const elegidas = Array.isArray(confirmadas) ? confirmadas : (h._segFotos || null);
  const conf = (f) => !elegidas || elegidas.includes(f.nombre);
  const usar = (h._fotos || []).filter(f => !/_firma\./i.test(f.nombre || "") && conf(f));
  const firmaF = (h._fotos || []).find(f => /_firma\./i.test(f.nombre || ""));
  const firma = firmaF && conf(firmaF) ? firmaF : null;
  const red = [];
  const lado = usar.length > 8 ? 720 : 800;
  for (const f of usar) { const r = await reducirFoto(f.dataUrl, lado); if (r) red.push(r); }
  // v3.51: las fotos del seguimiento van al almacenamiento de Supabase; en el seguimiento queda el enlace.
  // Sin conexión al depósito, la foto se publica como antes (dentro del seguimiento) para no perderla.
  const alAlmacen = async (dataUrl, nombre) => {
    if (!dataUrl || typeof API === "undefined" || !API.hayNube()) return dataUrl;
    try { return await API.subirFoto("seguimiento/" + token + "/" + nombre, dataUrl); } catch (e) { return dataUrl; }
  };
  for (let i = 0; i < red.length; i++) red[i] = await alAlmacen(red[i], Date.now() + "_foto_" + (i + 1) + ".jpg");
  const eq = equipoTxtWA(h.SERIE);
  const base = sg ? datosSeg(sg) : { etapas: [], avances: [], etapa: "FINALIZADA" };
  const reporte = {
    fecha: h.FECHA || null, tipo: h.TIPO_OT || null, horas: h.HORAS_MAQUINA ?? null,
    actividades: (h.ACTIVIDADES || []).filter((a, i, arr) => !(a.NIVEL === "sub" && arr.some(b => b.NIVEL !== "sub" && b.DESCRIPCION === a.DESCRIPCION)))
      .map(a => ({ d: a.DESCRIPCION, n: a.NIVEL })),
    observaciones: h.TRABAJO_REALIZADO || "",
    ubicacion: h.GPS_LAT && h.GPS_LON ? "https://maps.google.com/?q=" + h.GPS_LAT + "," + h.GPS_LON : null,
    fotos: red, firma: firma ? await alAlmacen(await reducirFoto(firma.dataUrl, 500), Date.now() + "_firma.jpg") : null
  };
  publicarSeg(token, Object.assign(base, {
    numero_ot: h.NUMERO_OT || null, serie: h.SERIE || null, cliente_nombre: h.RAZON_SOCIAL || null, equipo_txt: eq || null,
    tecnico: estado.tecnico, tipo_mant: h.TIPO_OT || null, clase: h.CLASE_VISITA || null, etapa: "FINALIZADA",
    estado: "FINALIZADA", reporte }));
  h._segCerrado = new Date().toISOString(); guardarLocal();
}
async function guardarSeg() {
  if (!estado.tecnico) return;
  await DB.set("seguim::" + estado.tecnico, estado.seguim || {});
  await DB.set("avq::" + estado.tecnico, estado.avQ || []);
}
function migrarSeg(viejo, nuevo) {
  if (viejo === nuevo) return;
  if (estado.seguim && estado.seguim[viejo]) { estado.seguim[nuevo] = estado.seguim[viejo]; estado.seguim[nuevo].key = nuevo; delete estado.seguim[viejo]; }
  (estado.avQ || []).forEach(r => { if (r.fila.clave_visita === viejo) r.fila.clave_visita = nuevo; });
  Object.values(estado.waEnv || {}).forEach(L => { if (L.key === viejo) L.key = nuevo; });
  (estado.envQ || []).forEach(r => { if (r.fila.clave_visita === viejo) r.fila.clave_visita = nuevo; });
  guardarEnv();
  if (estado._otCtx && estado._otCtx.segKey === viejo) estado._otCtx.segKey = nuevo;
  guardarSeg();
}
function anotarSeg(key, serie, tipo, etapa, texto, adjuntos, visible, archivos) {
  const sg = segDe(key, true), t = new Date().toISOString();
  const it = estado._segIt;
  if (it && it.k + ":" + it.id === key) sg.meta = { cliente: it.cliente, equipo: it.equipo, serie: it.serie, tipoMant: it.tipoMant, clase: it.clase };
  else if (!sg.meta) sg.meta = { serie };
  if (tipo === "ETAPA") { sg.etapa = etapa; sg.ev.push({ e: etapa, t }); }
  else sg.av.push({ t, texto: texto || "", n: adjuntos || 0, visible: visible !== false });
  publicarSeg(sg.token, datosSeg(sg));
  // v3.59: las FOTOS del avance parcial se guardan en la nube (almacenamiento prosol-fotos); los videos siguen solo por WhatsApp
  const fotosAv = (archivos || []).filter(f => /^image\//.test(f.type || "") || /\.(jpe?g|png|webp|heic)$/i.test(f.name || ""));
  (estado.avQ = estado.avQ || []).push({ fila: { serie, clave_visita: key, numero_ot: sg.numero_ot || null, tecnico: estado.tecnico, tipo, etapa: etapa || sg.etapa, texto: texto || null, adjuntos: adjuntos || 0, ocurrio: t },
    archivos: fotosAv.length ? fotosAv : undefined });
  guardarSeg(); syncAvances();
}
function _leerComoDataURL(f) {
  return new Promise((res) => { try { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); } catch (e) { res(null); } });
}
// sube las fotos pendientes de un avance; devuelve la lista de enlaces o null si no hay conexión al depósito (queda en cola)
async function subirFotosAvance(r) {
  if (!r.archivos || !r.archivos.length) return r.fila.fotos || [];
  const enlaces = (r.fila.fotos || []).slice(), base = "ot/avances/" + String(r.fila.clave_visita || "sin-clave").replace(/[^A-Za-z0-9_-]/g, "_") + "/";
  for (let i = enlaces.length; i < r.archivos.length; i++) {
    const d = await _leerComoDataURL(r.archivos[i]); if (!d) { enlaces.push(null); continue; }
    const red = (await reducirFoto(d, 1280)) || d;
    enlaces.push(await API.subirFoto(base + Date.now() + "_" + (i + 1) + ".jpg", red));   // si falla, lanza y el avance queda en cola
    r.fila.fotos = enlaces.slice();
  }
  return enlaces.filter(Boolean);
}
let _avBusy = false;
async function syncAvances() {
  if (_avBusy || typeof API === "undefined" || !API.hayNube() || !navigator.onLine || !(estado.avQ || []).length) return;
  _avBusy = true;
  try { let r; while ((r = (estado.avQ || [])[0])) {
    const fotos = await subirFotosAvance(r);
    await API.insert("ot_avances", Object.assign({}, r.fila, fotos.length ? { fotos: fotos } : {}));
    estado.avQ = estado.avQ.filter(x => x !== r);
    if (fotos.length) {   // el seguimiento del cliente muestra las fotos del avance (si el avance es visible)
      const sg = segDe(r.fila.clave_visita, false), a = sg && (sg.av || []).find(x => x.t === r.fila.ocurrio);
      if (a) { a.fotos = fotos; publicarSeg(sg.token, datosSeg(sg)); }
    }
  } } catch (x) { /* sin red: queda en cola */ }
  finally { _avBusy = false; guardarSeg(); }
}
function itemDeTarjeta(k, id) {
  if (k === "PROG") {
    const p = (estado.catalogo?.programaciones || []).find(x => String(x.ID_VISITA || x.ID_SB) === id); if (!p) return null;
    return Object.assign({ k, id, p, serie: p.SERIE, tipoMant: p.TIPO_MANTENIMIENTO || "Mantenimiento", clase: "PROGRAMADA" }, datosTarjeta(p.SERIE, p.ID_CLIENTE));
  }
  const s = (estado.solicitudes || []).find(x => String(x.id) === id); if (!s) return null;
  return Object.assign({ k, id, s, serie: s.serie, tipoMant: s.tipo_mantenimiento || "Mantenimiento", clase: s.clase }, datosTarjeta(s.serie, s.id_cliente, s.cliente_nombre));
}
// v3.61: seguimiento de una OT ya guardada (Mis órdenes): usa la visita de origen o crea uno propio de la OT,
// con el MISMO enlace que el cliente ya recibió.
function itemDeOT(h) {
  let sg = sgDeOT(h), k, id;
  if (sg) { const i = sg.key.indexOf(":"); k = sg.key.slice(0, i); id = sg.key.slice(i + 1); }
  else {
    k = "OT"; id = String(h.NUMERO_OT || h.COD_TEMP || h.FECHA);
    sg = segDe(k + ":" + id, true); sg.numero_ot = h.NUMERO_OT || null;
    if (h._segToken) sg.token = h._segToken; else h._segToken = sg.token;
    sg.meta = sg.meta || { serie: h.SERIE, cliente: h.RAZON_SOCIAL, tipoMant: h.TIPO_OT };
    guardarSeg(); guardarLocal();
  }
  return (k !== "OT" && itemDeTarjeta(k, id)) ||
    Object.assign({ k, id, serie: h.SERIE, tipoMant: h.TIPO_OT || "Mantenimiento", clase: "", ot: h }, datosTarjeta(h.SERIE, null, h.RAZON_SOCIAL));
}
function atenderItem(it) {
  if (it.k === "OT" || it.ot) { toast("La orden ya está registrada (OT " + ((it.ot && it.ot.NUMERO_OT) || it.id) + ").", "ok"); return; }
  const key = it.k + ":" + it.id; marcarVisto(it.id);
  if (it.k === "PROG") nuevaOT(it.e || { SERIE: it.p.SERIE, ID_CLIENTE: it.p.ID_CLIENTE }, it.p.TIPO_MANTENIMIENTO, { clase: "PROGRAMADA", visita: it.p, segKey: key });
  else nuevaOT(it.e || { SERIE: it.s.serie, ID_CLIENTE: it.s.id_cliente }, it.s.tipo_mantenimiento, { clase: it.s.clase, sol: it.s, segKey: key });
}
function cabeceraMsg(it, titulo) {
  return ["🔧 *PROSOL S.A. · " + titulo + "*", SEP_WA, "👤 *Cliente:* " + it.cliente, "⚡ *Equipo:* " + it.equipo, "🔢 *Serie:* " + it.serie,
    "🛠️ *Tipo:* " + it.tipoMant + (it.clase === "URGENTE" ? " · 🚨 *URGENTE*" : ""), "👷 *Técnico:* " + estado.tecnico, SEP_WA];
}
function msgEtapa(it, etapa) {
  const L = cabeceraMsg(it, "Seguimiento de servicio");
  L.push("📌 *Estado:* " + etapaTxt(etapa), "🕒 *Hora:* " + hhmm(new Date().toISOString()));
  const sg = segDe(it.k + ":" + it.id, true);
  L.push("", "🔎 *Siga su servicio en línea:*", urlSeguimiento(sg.token), "", PIE_WA);
  return L.join("\n");
}
function msgParcial(it, texto, n) {
  const L = cabeceraMsg(it, "AVANCE PARCIAL (PRESUNTIVO)");
  L.push("🕒 *Hora:* " + hhmm(new Date().toISOString()), "", "📝 *Detalle:* " + (texto || "(ver fotos/video)"));
  if (n) L.push("📎 " + n + " adjunto(s) en este aviso");
  L.push("", "⚠️ _Información preliminar: se confirma en el reporte final de la OT._");
  const sg = segDe(it.k + ":" + it.id, true);
  L.push("", "🔎 *Siga su servicio en línea:*", urlSeguimiento(sg.token), "", PIE_WA);
  return L.join("\n");
}
// M9-D (v3.45): reporte final agrupado — orden + origen/autorización + etapas con tiempos + avances + avisos enviados
function sgDeOT(h) { return Object.values(estado.seguim || {}).find(s => s.numero_ot && String(s.numero_ot) === String(h.NUMERO_OT)) || null; }
function durTxt(a, b) {
  const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000);
  if (!(m >= 0)) return "";
  return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") + " min";
}
function avancesTexto(h) {
  const sg = sgDeOT(h), L = [];
  const clase = h.CLASE_VISITA || "";
  if (clase) {
    L.push("", "🗂️ *Origen de la visita:* " + (CLASE_TXT[clase] || clase) + (clase === "URGENTE" ? " 🚨" : ""));
    const s = h.SOLICITUD_ID ? (estado.solicitudes || []).find(x => String(x.id) === String(h.SOLICITUD_ID)) : null;
    if (s) {
      if (s.solicitante) L.push("🙋 Solicitada por: " + s.solicitante);
      if (s.motivo) L.push("💬 Motivo: " + s.motivo);
      if (s.estado === "AUTORIZADA") L.push("🔓 Autorizada por: " + (s.autorizado_por || "—") + (s.fecha_resolucion ? " · " + hhmm(s.fecha_resolucion) : ""));
      else L.push("🔒 Autorización: " + (s.estado || "PENDIENTE") + (clase === "URGENTE" ? " (urgencia atendida antes de autorizar)" : ""));
    }
  }
  if (sg && (sg.ev.length || sg.av.length)) {
    L.push("", "🕒 *Seguimiento de la visita:*");
    sg.ev.forEach(x => L.push("• " + etapaTxt(x.e) + " — " + hhmm(x.t)));
    const t1 = (e) => { const x = sg.ev.find(v => v.e === e); return x ? x.t : null; };
    const tr = t1("EN_CAMINO") && t1("EN_SITIO") ? durTxt(t1("EN_CAMINO"), t1("EN_SITIO")) : "";
    const si = t1("EN_SITIO") && t1("FINALIZADA") ? durTxt(t1("EN_SITIO"), t1("FINALIZADA")) : "";
    const tot = sg.ev.length && t1("FINALIZADA") ? durTxt(sg.ev[0].t, t1("FINALIZADA")) : "";
    if (tr) L.push("🚗 Tiempo de traslado: " + tr);
    if (si) L.push("🏠 Tiempo en sitio: " + si);
    if (tot) L.push("⏳ Duración total: " + tot);
    if (sg.av.length) {
      L.push("", "🧾 *Avances parciales (presuntivos):*");
      sg.av.forEach(x => L.push("• " + hhmm(x.t) + ": " + (x.texto || "(adjuntos)") + (x.n ? " · 📎 " + x.n : "")));
    }
  }
  const av = lotesDe(sg ? sg.key : null, h.NUMERO_OT).filter(x => x.tipo !== "FINAL");
  if (av.length) {
    const tot = av.reduce((a, x) => a + x.dest.length, 0), ab = av.reduce((a, x) => a + x.dest.length - lotePend(x).length, 0);
    L.push("", "📲 *Avisos enviados durante la visita:* " + av.length + " · destinatarios abiertos " + ab + "/" + tot);
  }
  return L.join("\n");
}
function reporteFinalTexto(h) {
  const base = resumenOrdenTexto(h).split("\n"), pie = base[base.length - 1].indexOf("PROSOL Campo") >= 0 ? base.pop() : "";
  const ex = avancesTexto(h);
  const link = "\n\n🔎 *Reporte y seguimiento en línea:*\n" + urlSeguimiento(tokenDeOT(h));
  return base.join("\n") + (ex ? "\n" + ex : "") + link + (pie ? "\n\n" + SEP_WA + "\n" + pie : "");
}
function abrirSeg(it) {
  estado._segIt = it; estado._segFiles = [];
  const key = it.k + ":" + it.id, sg = segDe(key, false) || { etapa: "PROGRAMADA", ev: [], av: [] };
  $("#seg-titulo").textContent = "Seguimiento · Serie " + it.serie;
  $("#seg-cli").innerHTML = `<div class="row-title" style="white-space:normal">${ESC(it.cliente)}</div><div class="row-sub" style="white-space:normal">${ESC(it.equipo)} · ${ESC(it.tipoMant)}</div>${it.e ? sitioHTML(it.e, true) : ""}`;
  const idx = ETAPAS.findIndex(e => e[0] === sg.etapa);
  $("#seg-etapas").innerHTML = ETAPAS.map((e, i) => `<button class="seg-et ${i < idx ? "hecho" : ""} ${i === idx ? "on" : ""}" data-e="${e[0]}" ${e[0] === "FINALIZADA" ? "disabled" : ""}><span>${e[2]}</span>${e[1]}</button>`).join("");
  $$("#seg-etapas .seg-et").forEach(b => b.onclick = () => {
    anotarSeg(key, it.serie, "ETAPA", b.dataset.e); abrirSeg(it); pintarHoy(); toast("Etapa: " + etapaTxt(b.dataset.e), "ok");
  });
  $("#seg-texto").value = ""; $("#seg-archivos-info").textContent = ""; if ($("#seg-visible")) $("#seg-visible").checked = true;
  if ($("#seg-atender")) $("#seg-atender").style.display = (it.ot || it.k === "OT") ? "none" : "";   // OT ya guardada: no se vuelve a llenar
  const log = [].concat(sg.ev.map(x => ({ t: x.t, h: etapaTxt(x.e) })), sg.av.map(x => ({ t: x.t, h: "Avance parcial" + (x.n ? " · 📎" + x.n : ""), d: x.texto })),
    lotesDe(key, sg.numero_ot).map(L => ({ t: L.t, h: "📲 " + (ENV_TIPO[L.tipo] || L.tipo) + " · abiertos " + loteResumen(L), d: lotePend(L).length ? "Pendientes: " + lotePend(L).map(d => d.nombre).join(", ") : "" }))).sort((a, b) => b.t.localeCompare(a.t));
  $("#seg-log").innerHTML = log.length ? log.map(x => `<li class="tl-item"><div class="tl-date">${ESC(hhmm(x.t))} · ${ESC(x.h)}</div>${x.d ? `<div class="tl-acts">${ESC(x.d)}</div>` : ""}</li>`).join("") : `<li class="hint">Aún sin registros.</li>`;
  $("#sheet-seg").hidden = false;
}
function datosClienteIt(it) { const c = clientePorId(it.e ? it.e.ID_CLIENTE : null); return { nombre: it.cliente, tel: c ? c.TELEFONO : "" }; }
function segAvisarEtapa() {
  const it = estado._segIt; if (!it) return;
  const sg = segDe(it.k + ":" + it.id, true);
  if (!sg.meta) sg.meta = { cliente: it.cliente, equipo: it.equipo, serie: it.serie, tipoMant: it.tipoMant, clase: it.clase };
  publicarSegDeVisita(it.k + ":" + it.id); guardarSeg();
  const et = sg ? sg.etapa : "PROGRAMADA";
  abrirDestinos({ titulo: "Avisar: " + etapaTxt(et), texto: msgEtapa(it, et), files: [], cliente: datosClienteIt(it),
    reg: { tipo: "ETAPA", key: it.k + ":" + it.id, serie: it.serie, numero_ot: sg ? sg.numero_ot : null } });
}
function segInformarParcial() {
  const it = estado._segIt; if (!it) return;
  const texto = $("#seg-texto").value.trim(), files = estado._segFiles || [];
  if (!texto && !files.length) { toast("Escribe el detalle o agrega foto/video.", "err"); return; }
  anotarSeg(it.k + ":" + it.id, it.serie, "PARCIAL", null, texto, files.length, $("#seg-visible") ? $("#seg-visible").checked : true, files);
  const msg = msgParcial(it, texto, files.length);
  const sg = segDe(it.k + ":" + it.id, false);
  $("#sheet-seg").hidden = true; pintarHoy();
  abrirDestinos({ titulo: "Avance parcial (presuntivo)", texto: msg, files, cliente: datosClienteIt(it), clienteDefault: true,
    reg: { tipo: "PARCIAL", key: it.k + ":" + it.id, serie: it.serie, numero_ot: sg ? sg.numero_ot : null } });
}
function cerrarSegPorOT(ctx, numero) {
  if (!ctx || !ctx.segKey) return;
  const serie = ctx.visita ? ctx.visita.SERIE : (ctx.sol ? ctx.sol.serie : "");
  const sg = segDe(ctx.segKey, true); sg.numero_ot = numero;
  lotesDe(ctx.segKey, null).forEach(L => { if (!L.numero_ot) L.numero_ot = numero; }); guardarEnv();
  anotarSeg(ctx.segKey, serie, "ETAPA", "FINALIZADA");
}
function fotosComoFiles(h) {
  const files = [];
  (h._fotos || []).forEach((f, idx) => {
    try {
      const bin = atob(f.dataUrl.split(",")[1]); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      files.push(new File([new Blob([arr], { type: "image/jpeg" })], f.nombre || ("foto_" + (idx + 1) + ".jpg"), { type: "image/jpeg" }));
    } catch (e) { /* foto liberada o ilegible */ }
  });
  return files;
}
function enviarOrdenConDestinos() {
  const h = estado.historial[estado._ordenHist]; if (!h) return;
  const eq = equipoPorSerie(h.SERIE), c = clientePorId(eq ? eq.ID_CLIENTE : null);
  const sg = sgDeOT(h);
  abrirDestinos({ titulo: "Reporte final · OT " + (h.NUMERO_OT || ""), texto: reporteFinalTexto(h), files: fotosComoFiles(h), h: h,
    cliente: { nombre: h.RAZON_SOCIAL, tel: c ? c.TELEFONO : "" }, clienteDefault: true,
    reg: { tipo: "FINAL", key: sg ? sg.key : null, numero_ot: h.NUMERO_OT, serie: h.SERIE },
    alTerminar: function () {
      h._enviada = true; guardarLocal(); pintarHistorial();
      // si la cola uno-por-uno ya reemplazó las miniaturas, vale la selección guardada en la orden (h._segFotos)
      publicarCierre(h, this._selSeg && $$("#dest-cuerpo .dest-seg-chk").length ? this._selSeg() : null);
    } });
}

// ---------- Listeners ----------
function wire() {
  // navegación por data-go
  document.body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b) ir(b.dataset.go);
  });
  $("#btn-nueva-ot").onclick = () => { if (!estado.catalogo) { toast("Primero carga el catálogo de oficina.", "err"); return; } nuevaOT(null); };
  $("#btn-admin-movil").onclick = () => { if (typeof PROSOL_WEB !== "undefined" && PROSOL_WEB.abrirLoginAdmin) PROSOL_WEB.abrirLoginAdmin(); };
  $("#hf-cerrar").onclick = $("#hf-cerrar2").onclick = () => { $("#sheet-hoy-flot").hidden = true; };
  $("#sheet-hoy-flot").addEventListener("click", (e) => { if (e.target.id === "sheet-hoy-flot") e.target.hidden = true; });
  $("#hf-ir").onclick = () => { $("#sheet-hoy-flot").hidden = true; ir("hoy"); };
  $("#buscar-cliente").addEventListener("input", pintarClientes);
  $("#seg-cerrar").onclick = () => { $("#sheet-seg").hidden = true; };
  $("#seg-avisar").onclick = segAvisarEtapa;
  $("#seg-informar").onclick = segInformarParcial;
  $("#seg-atender").onclick = () => { const it = estado._segIt; $("#sheet-seg").hidden = true; if (it) atenderItem(it); };
  $("#seg-archivos").onchange = (e) => {
    estado._segFiles = (estado._segFiles || []).concat(Array.from(e.target.files)); e.target.value = "";
    $("#seg-archivos-info").textContent = estado._segFiles.length + " archivo(s) listo(s) para compartir.";
  };
  $("#dest-cerrar").onclick = () => { if (estado._lote) { cerrarLote(estado._lote); estado._lote = null; refrescarEnvViews(); } $("#sheet-dest").hidden = true; };
  $("#sheet-orden-body").addEventListener("click", (e) => { const b = e.target.closest(".env-reenv"); if (b) reenviarPendientes(b.dataset.lote); });
  window.addEventListener("online", () => { syncAvances(); syncEnvios(); syncSegCliente(); });
  $("#ct-cerrar").onclick = () => { $("#sheet-contacto").hidden = true; };
  $("#ct-guardar").onclick = guardarContacto; $("#ct-quitar").onclick = quitarContacto;
  $("#btn-contacto-nuevo").onclick = () => abrirContacto(null);
  $("#contactos-lista").addEventListener("click", (e) => {
    const r = e.target.closest(".ct-row"); if (!r) return;
    const c = (estado.contactos || []).find(x => String(x.id) === r.dataset.id); if (c) abrirContacto(c);
  });
  $("#btn-entrar").onclick = async () => {
    const usr = ($("#login-tecnico").value || "").trim(), clave = $("#login-clave").value || "";
    if (!usr) { toast("Elige tu usuario de la lista.", "err"); return; }
    if (!clave) { toast("Escribe tu contraseña.", "err"); return; }
    let u;
    try { u = await verificarIngreso(usr, clave); } catch (e) { toast(e.message, "err"); return; }
    if (!u) { toast("Usuario o contraseña incorrectos.", "err"); return; }
    $("#login-clave").value = "";
    estado.usuarioIngreso = usr;
    try { localStorage.setItem("prosol_usuario_ingreso", usr); } catch (e) {}
    const reg = usuariosIngreso().find(x => x.usuario === usr) || {};
    const n = tecnicoDeUsuario(u.nombre || reg.nombre || usr, u.id_tecnico || reg.id_tecnico);
    estado.tecnico = n;
    // cargar órdenes y envíos guardados de ESTE técnico
    estado.ordenes = (await DB.get("ordenes::" + n)) || [];
    estado.envios = (await DB.get("envios::" + n)) || [];
    estado.seguim = (await DB.get("seguim::" + n)) || {}; estado.avQ = (await DB.get("avq::" + n)) || [];
    estado.waEnv = (await DB.get("waenv::" + n)) || {}; estado.envQ = (await DB.get("envq::" + n)) || [];
    estado.segQ = (await DB.get("segq::" + n)) || {};
    syncAvances(); syncEnvios(); syncContactos(true); syncSegCliente();
    if (window._prosolSubirPendientes) setTimeout(() => window._prosolSubirPendientes({ silencioso: true }), 800);
    await guardarLocal();
    ir("inicio");
    estado._hfVisto = false; setTimeout(mostrarHoyFlotante, 400);
  };
  $("#btn-logout").onclick = async () => {
    // v3.70: aviso si quedan trabajos sin enviar a la nube
    const pt = pendientesTotal();
    if (pt.total > 0) {
      if (confirm(`Tiene trabajos SIN ENVIAR a la nube: ${pt.detalle}.\n\nQuedan guardados en este celular y se envían al volver a entrar, `
          + `pero si se borran los datos del navegador o se desinstala la app, SE PIERDEN.\n\n¿Enviar ahora? (Aceptar = enviar y seguir en la app)`)) {
        syncAvances(); syncEnvios(); syncSegCliente();
        if (window._prosolSubirPendientes) window._prosolSubirPendientes({ silencioso: false });
        toast("Enviando pendientes…", "ok"); setTimeout(refrescarSync, 4000);
        return;
      }
      if (confirm(`¿Cerrar la sesión de ${estado.tecnico} de todas formas?\nLos ${pt.total} pendiente(s) quedan guardados en este celular.`)) cerrarSesion();
      return;
    }
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
  if ($("#btn-orden-whatsapp")) $("#btn-orden-whatsapp").onclick = enviarOrdenConDestinos;
  $("#gd-whatsapp").onclick = enviarGuardadaWhatsApp;
  $("#gd-reintentar").onclick = () => { if (window._prosolSubirPendientes) Promise.resolve(window._prosolSubirPendientes()).then(() => estado._gdPinta && estado._gdPinta()); };
  $("#gd-listo").onclick = $("#gd-cerrar").onclick = () => { $("#sheet-guardada").hidden = true; estado._guardada = null; };
  $("#asig-cerrar").onclick = () => { $("#sheet-asig").hidden = true; };
  if ($("#btn-orden-confirmar")) $("#btn-orden-confirmar").onclick = toggleConfirmada;
  $("#btn-ot-desde-eq").onclick = () => abrirNuevaVisita(estado._equipoActual);
  if ($("#sheet-eq-edit-close")) $("#sheet-eq-edit-close").onclick = () => $("#sheet-eq-edit").hidden = true;
  if ($("#eqe-guardar")) $("#eqe-guardar").onclick = guardarDatosEquipo;
  if ($("#fab-visita")) $("#fab-visita").onclick = () => abrirNuevaVisita(null);
  if ($("#hoy-contenido")) $("#hoy-contenido").addEventListener("click", accionHoy);
  if ($("#btn-nv-elegir")) $("#btn-nv-elegir").onclick = () => abrirSheetEquipo(setEquipoNV);
  if ($("#btn-nv-qr")) $("#btn-nv-qr").onclick = () => abrirEscanerQR(setEquipoNV);
  if ($("#btn-nv-crear")) $("#btn-nv-crear").onclick = crearVisitaNV;
  $$('input[name="nv-clase"]').forEach(r => r.addEventListener("change", actualizarBotonNV));
  window.addEventListener("online", () => syncSolicitudes(true));
  window.addEventListener("online", () => syncAsignaciones(true));
  if ($("#btn-ubicacion")) $("#btn-ubicacion").onclick = () => capturarUbicacion();
  $("#btn-elegir-equipo").onclick = () => abrirSheetEquipo(setEquipoOT);
  if ($("#btn-qr-equipo")) $("#btn-qr-equipo").onclick = () => abrirEscanerQR(setEquipoOT);
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
  $("#ot-act-cat").addEventListener("change", (e) => { agregarActividadCatalogo(e.target.value); e.target.value = ""; });
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
    volver();
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
  // v3.70: el catálogo se baja después de ingresar; con la lista de usuarios ya se puede entrar
  if (!estado.catalogo && usuariosIngreso().length) estado.catalogo = { rev: 0, generado: "", equipos: [], clientes: [], tecnicos: [], programaciones: [] };
  const hayCat = !!estado.catalogo;
  $("#login-sin-cat").hidden = hayCat;
  $("#login-con-cat").hidden = !hayCat;
  const vtag = $("#app-version-login");
  if (vtag) vtag.textContent = "PROSOL Campo " + APP_VERSION;
  if (!hayCat) return;
  // llenar combo con técnicos del catálogo
  // v3.57: el ingreso lista los USUARIOS del sistema (iguales en escritorio, web y celular), no los técnicos
  const sel = $("#login-tecnico"); sel.innerHTML = "";
  const tecnicos = (estado.catalogo.tecnicos || []).map(nombreTecnico).filter(Boolean);
  const usuarios = usuariosIngreso();
  if (!usuarios.length) {
    const o = document.createElement("option");
    o.value = ""; o.textContent = "(Conéctate a internet para cargar los usuarios)"; sel.appendChild(o);
  } else {
    const ph = document.createElement("option");
    ph.value = ""; ph.textContent = "— Elige tu usuario —"; sel.appendChild(ph);
    usuarios.forEach(u => {
      const o = document.createElement("option"); o.value = u.usuario; o.textContent = u.nombre || u.usuario; sel.appendChild(o);
    });
    if (estado.usuarioIngreso && usuarios.some(u => u.usuario === estado.usuarioIngreso)) sel.value = estado.usuarioIngreso;
  }
  const r = estado.catalogo.resumen || {};
  $("#login-cat-info").textContent =
    `Catálogo del ${(estado.catalogo.generado || "").slice(0,10)} · ${usuarios.length} usuario(s).`;
}

// ---------- v3.57: usuarios del sistema para el ingreso del celular ----------
const LS_USR_ING = "prosol_usuarios_ingreso", LS_CRED_ING = "prosol_cred_ingreso";
function usuariosIngreso() { try { return JSON.parse(localStorage.getItem(LS_USR_ING) || "[]") || []; } catch (e) { return []; } }
async function cargarUsuariosIngreso() {
  if (typeof API === "undefined" || !API.hayNube() || !navigator.onLine) return;
  try {
    const l = await API.rpc("pwa_usuarios_ingreso", {});
    if (Array.isArray(l)) { localStorage.setItem(LS_USR_ING, JSON.stringify(l)); pintarLogin(); }
  } catch (e) { console.warn("usuarios ingreso:", e); }
}
async function sha256Hex(t) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join("");
}
function _normN(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(w => w.length > 2); }
// Técnico del catálogo que corresponde al usuario (para OT, asignaciones y liquidación)
function tecnicoDeUsuario(nombreUsuario, idTecnico) {
  // v3.62: primero el técnico VINCULADO al usuario (exacto); si no tiene, se busca por nombre
  if (idTecnico) { const t = (estado.catalogo?.tecnicos || []).find(x => String(x.ID_TECNICO) === String(idTecnico)); if (t) return nombreTecnico(t); }
  const pu = new Set(_normN(nombreUsuario)); let mejor = null, pts = 0;
  (estado.catalogo?.tecnicos || []).forEach(t => {
    const n = nombreTecnico(t), c = _normN(n).filter(w => pu.has(w)).length;
    if (c > pts) { pts = c; mejor = n; }
  });
  return pts >= 2 ? mejor : (nombreUsuario || "");
}
// Verifica la contraseña en la nube (misma función que la web); sin internet, con la última verificación de este celular
async function verificarIngreso(usuario, clave) {
  let cred = {}; try { cred = JSON.parse(localStorage.getItem(LS_CRED_ING) || "{}") || {}; } catch (e) {}
  if (typeof API !== "undefined" && API.hayNube() && navigator.onLine) {
    const salt = await API.rpc("pwa_salt", { p_usuario: usuario });
    if (!salt) return null;
    const h = await sha256Hex(salt + ":" + clave);
    const u = await API.rpc("pwa_login", { p_usuario: usuario, p_hash: h });
    if (!u) return null;
    cred[usuario] = { salt: salt, h: h }; localStorage.setItem(LS_CRED_ING, JSON.stringify(cred));
    if (API.ingresarNube) { try { await API.ingresarNube(usuario, clave); } catch (e) {} }   // M11 Fase B: sesión por usuario y rol
    // v3.70: el catálogo ya no se baja antes de ingresar; si este celular aún no tiene técnicos, se baja ahora (con sesión)
    if (!(estado.catalogo?.tecnicos || []).length && window._prosolSincronizarCatalogoSupabase) {
      try { await window._prosolSincronizarCatalogoSupabase(); } catch (e) {}
    }
    return u;
  }
  const c = cred[usuario];
  if (c && (await sha256Hex(c.salt + ":" + clave)) === c.h) return (usuariosIngreso().find(x => x.usuario === usuario) || { usuario: usuario });
  throw new Error("Sin internet: este usuario aún no ha ingresado en este celular.");
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
const APP_VERSION = "v4.07";
async function init() {
  // v3.70: pedir al navegador que NO borre solo los datos de la app (órdenes y fotos sin enviar)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => p || navigator.storage.persist()); } catch (e) {}
  try { await DB.open(); } catch (e) { /* sin IndexedDB seguimos en memoria */ }
  await cargarLocal();
  const lib = liberarFotosViejas();
  if (lib) await guardarLocal();
  wire(); initFirma(); refrescarSync();
  instalarAtras();
  ir(estado.tecnico ? "inicio" : "login");
  pintarLogin();
  if (estado.tecnico) setTimeout(mostrarHoyFlotante, 600);
  // v3.70: sin sesión de la nube (entró sin internet o venció) se pide la clave del usuario de este celular
  if (typeof API !== "undefined" && API.alNecesitarSesion && typeof AUTH !== "undefined" && AUTH.pedirClave)
    API.alNecesitarSesion(async () => {
      const u = estado.usuarioIngreso || localStorage.getItem("prosol_usuario_ingreso") || "";
      if (!estado.tecnico || !u) return null;
      return AUTH.pedirClave(u);
    });
  setTimeout(() => { if (estado.tecnico) { syncContactos(true); syncSegCliente(); } }, 1200);   // v3.70: solo con usuario dentro
  escucharArchivosEntrantes();
  await revisarArchivoCompartido();
  // Aviso al cerrar/recargar si hay órdenes sin empaquetar o archivos sin enviar
  window.addEventListener("beforeunload", (ev) => {
    const nube = typeof API !== "undefined" && API.hayNube();
    const sinEnviar = nube ? pendOficina() : estado.ordenes.length;
    const archivosSinEnviar = nube ? 0 : estado.envios.filter(e => !e.enviado).length;
    if (sinEnviar > 0 || archivosSinEnviar > 0) {
      ev.preventDefault(); ev.returnValue = "";
      return "";
    }
  });
  const vtag = $("#app-version"); if (vtag) vtag.textContent = "Versión " + APP_VERSION;
  const bv = $("#brand-ver"); if (bv) bv.textContent = APP_VERSION;
  const vi = $("#app-version-inicio"); if (vi) vi.textContent = "PROSOL Campo " + APP_VERSION;
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.register("service-worker.js", { updateViaCache: "none" });
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
    // v3.70: al abrir la app baja técnicos, equipos y visitas SOLO si ya hay un usuario dentro (etapa 2)
    try { autoActualizarCatalogo(); } catch(e) { console.error('autoCat:', e); }
    try { estado.usuarioIngreso = localStorage.getItem("prosol_usuario_ingreso") || ""; cargarUsuariosIngreso(); } catch(e) {}
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
      // M9-A: primero se suben los datos de equipo completados en el móvil
      if (window._prosolSubirEdicionesEquipo) { try { await window._prosolSubirEdicionesEquipo(); } catch (x) {} }
      let [eq, cli, tec, prog, acts, actItems, ots, eqCampo] = await Promise.all([
        API.select('equipos').catch(() => []),
        API.select('clientes').catch(() => []),
        API.select('tecnicos').catch(() => []),
        API.select('visitas_programadas').catch(() => []),
        API.select('actividades').catch(() => []),
        API.select('actividad_items').catch(() => []),
        // v3.99.2: solo las últimas N OT (o desde una fecha) que define el ADMIN en la web; antes bajaban todas
        API.rpc('historial_movil', {}).then((r) => { window._prosolCfgMovil = { max: r.max, desde: r.desde }; return r.ots || []; })
          .catch(() => API.select('ordenes').catch(() => [])),
        API.select('equipos_campo').catch(() => [])
      ]);

      const _e = window._prosolEstado;
      if (!_e) { toastG('❌ Error interno: app no inicializada', 'err'); return; }
      if (!_e.catalogo) _e.catalogo = {};

      // 1. Equipos
      // Oficina (tabla equipos) prevalece; lo completado en el móvil (equipos_campo)
      // solo rellena vacíos. _OF = campos que oficina ya tiene cargados (solo lectura en el móvil).
      const campoPorSerie = {};
      eqCampo.forEach(c => { if (c.serie) campoPorSerie[c.serie] = c; });
      const _txt = x => x !== null && x !== undefined && String(x).trim() !== '';
      // v3.49: celular del cliente (ficha de oficina) y última ubicación GPS de las órdenes de campo
      const telCli = {}; cli.forEach(c => { if (_txt(c.telefono)) telCli[c.id] = c.telefono; });
      const gpsOT = {};
      ots.forEach(o => { if (o.serie && o.gps_lat != null && o.gps_lng != null) { const f = o.creado || o.fecha || '';
        if (!gpsOT[o.serie] || f > gpsOT[o.serie].f) gpsOT[o.serie] = { lat: Number(o.gps_lat), lng: Number(o.gps_lng), f }; } });
      const gpsMasNuevo = (...cs) => cs.filter(g => g && g.lat != null && g.lng != null && !isNaN(g.lat))
        .sort((a, b) => String(b.f || '').localeCompare(String(a.f || '')))[0] || null;
      _e.catalogo.equipos = eq.map(e => {
        const ov = campoPorSerie[e.serie] || {}, OF = [];
        const elegir = (col, base, extra, num) => {
          const hay = num ? Number(base) > 0 : _txt(base);
          if (hay) { OF.push(col); return base; }
          const ok = num ? Number(extra) > 0 : _txt(extra);
          return ok ? extra : (num ? null : '');
        };
        const modelo = elegir('MODELO', e.modelo, ov.modelo);
        const kw = elegir('POTENCIA_KW', e.potencia_kw, ov.potencia_kw, true);
        const volt = elegir('VOLTAJE', e.voltaje, ov.voltaje);
        const ubic = elegir('UBICACION', e.ubicacion, ov.ubicacion);
        const obs = elegir('OBSERVACION', e.observacion, ov.observacion);
        const contacto = elegir('CONTACTO', e.contacto, ov.contacto);
        const contactoTel = elegir('CONTACTO_TEL', e.contacto_tel, ov.contacto_tel);
        const cliTel = elegir('CLIENTE_TEL', telCli[e.id_cliente], ov.cliente_tel);
        const gps = gpsMasNuevo(e.gps_lat != null ? { lat: Number(e.gps_lat), lng: Number(e.gps_lng), f: e.gps_fecha } : null,
          ov.gps_lat != null ? { lat: Number(ov.gps_lat), lng: Number(ov.gps_lng), f: ov.gps_fecha } : null, gpsOT[e.serie]);
        return {
          CONTACTO: contacto, CONTACTO_TEL: contactoTel, CLIENTE_TEL: cliTel,
          GPS_LAT: gps ? gps.lat : null, GPS_LNG: gps ? gps.lng : null, GPS_FECHA: gps ? gps.f : null,
          ID_EQUIPO: e.id_escritorio || e.id, ID_SB: e.id,
          SERIE: e.serie || '', CODIGO: e.codigo || '',
          ID_CLIENTE: e.id_cliente, MARCA: e.marca || 'GENERAC',
          MODELO: modelo, POTENCIA_KW: kw, VOLTAJE: volt,
          COMBUSTIBLE: e.combustible || '', HORAS_OPERACION: e.horas_operacion,
          UBICACION: ubic, OBSERVACION: obs, ESTADO: e.estado || 'ACTIVO',
          NOMBRE_EQUIPO: (e.marca||'GENERAC') + ' ' + (modelo||e.serie||''),
          _OF: OF
        };
      });

      // 2. Clientes
      _e.catalogo.clientes = cli.map(c2 => ({
        ID_CLIENTE: c2.id_escritorio || c2.id, ID_SB: c2.id,
        RAZON_SOCIAL: c2.razon_social || '',
        CONTACTO: c2.contacto || '', TELEFONO: c2.telefono || '',
        CIUDAD: c2.ciudad || '', CIUDAD_EQUIPO: c2.ciudad || '',
        IDENTIFICACION: c2.identificacion || '', EMAIL: c2.email || '',
        ZONA: c2.zona || '', DIRECCION: c2.direccion || ''
      }));

      // 3. Técnicos
      _e.catalogo.tecnicos = tec.map(t => ({
        ID_TECNICO: t.id_escritorio || t.id, ID_SB: t.id,
        ESPECIALIDAD: t.especialidad || '', TELEFONO: t.telefono || '',
        NOMBRES: t.nombres || '', APELLIDOS: t.apellidos || '',
        NOMBRE_COMPLETO: ((t.nombres||'') + ' ' + (t.apellidos||'')).trim()
      }));

      // 4. Visitas programadas
      // v3.99.2: van todas las visitas por atender; las ya atendidas solo las últimas N (informativas), como el historial
      const _cfgM = window._prosolCfgMovil || { max: 50, desde: null };
      const _hecha = (p) => ['EJECUTADA', 'REALIZADA'].includes(String(p.estado || '').toUpperCase());
      const _hechas = prog.filter(p => _hecha(p) && (!_cfgM.desde || String(p.fecha_programada || '') >= _cfgM.desde))
        .sort((x, y) => String(y.fecha_programada || '').localeCompare(String(x.fecha_programada || ''))).slice(0, _cfgM.max || 50);
      prog = prog.filter(p => !_hecha(p)).concat(_hechas);
      _e.catalogo.movil_cfg = { max: _cfgM.max || 50, desde: _cfgM.desde || null };
      _e.catalogo.programaciones = prog.filter(p => (p.estado || '') !== 'CANCELADA').map(p => ({   // v3.68: sin canceladas
        HORA: p.hora || '', CONTACTO_CITA: p.contacto_cita || '', TELEFONO_CITA: p.telefono_cita || '',
        REGISTRADO_POR: p.registrado_por || '', FECHA_REGISTRO: p.fecha_registro || '',
        ID_VISITA: p.id_escritorio || p.id,
        ID_SB: p.id,
        ID_EQUIPO: p.id_equipo, SERIE: p.serie || '',
        ID_CLIENTE: p.id_cliente,
        FECHA_PROGRAMADA: p.fecha_programada || '',
        TIPO_MANTENIMIENTO: p.tipo_mantenimiento || '',
        OBSERVACION: p.observacion || '', ESTADO: p.estado || 'PROGRAMADA',
        TECNICO_ASIGNADO: p.tecnico_asignado || ''   // v4.05.1: técnico asignado en el escritorio o la web
      }));
      if (window.PROSOL_ASIG) { PROSOL_ASIG.completar(); PROSOL_ASIG.refrescar(true); }

      // 5. Actividades y combos desde Supabase
      // TODAS las actividades (COMBO e INDIVIDUAL) van al selector de tipo
      // Los COMBO pre-cargan sus ítems; los INDIVIDUAL se seleccionan solos
      const combosObj = {};
      acts.forEach(a => {
        if ((a.tipo||'').toUpperCase() === 'COMBO') {
          // Buscar ítems de este combo en actividad_items
          const items = actItems
            .filter(i => i.id_actividad === a.id && (i.orden == null || Number(i.orden) >= 0))
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
        : ['MANTENIMIENTO PREVENTIVO', 'MANTENIMIENTO CORRECTIVO',
           'MANTENIMIENTO INTERNO', 'MANTENIMIENTO EXTERNO',
           'ARRANQUE INICIAL', 'VISITA EXPRESS + CAMBIO DE ACEITE'];
      _e.catalogo.combos = combosObj;

      // 6. Historial OT desde Supabase (origen=ESCRITORIO para el historial completo)
      // Incluye tanto las del escritorio como las del campo ya importadas
      _e.catalogo.historial_ot = ots.map(o => ({
        PDF_URL: o.pdf_url || '',   // v3.70: PDF de la orden finalizada
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

      { const d = new Date(); _e.catalogo.generado = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }   // fecha local
      _e.catalogo.rev = 3;   // M9-A/B: clientes por UUID y código; técnicos con rol y teléfono
      _e.catalogo.resumen = {
        equipos: eq.length, clientes: cli.length,
        tecnicos: tec.length, programaciones: prog.length,
        actividades: acts.length, historial_ot: ots.length
      };
      await (window._prosolGuardarLocal || (async()=>{}))();
      if (window._prosolSyncSolicitudes) { try { await window._prosolSyncSolicitudes(true); } catch (x) {} }
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
    const hoy = _hoyLocal();
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
  const hoy = _hoyLocal();

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
    const venc = o.fecha && o.fecha < _hoyLocal()
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
          (o.pdf_url ? '<a href="' + String(o.pdf_url).replace(/["<>]/g, '') + '" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;color:#2471A3;font-weight:700">📄 Ver orden (PDF)</a> ' : '') +
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
    const hoy = _hoyLocal();

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
  const hoy = _hoyLocal();
  const d = _fechaDeISO(hoy); d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1));
  const lunes = _fechaLocal(d);
  const dom = new Date(d); dom.setDate(dom.getDate() + 6);
  const domingo = _fechaLocal(dom);
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
  const desde = document.getElementById('liqm-desde')?.value || _hoyLocal();
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
  const desde = document.getElementById('liqm-desde')?.value || _hoyLocal();
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
    const pagosList = [...(l._pagos||[]), {fecha: _hoyLocal(), forma, valor: val}];
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
    const hoy = _hoyLocal();
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
