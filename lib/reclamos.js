/* PROSOL Campo · lib/reclamos.js (v3.91)
   El técnico VE los reclamos de los clientes (los registra el cliente en su enlace; los responde la oficina):
   · Menú: botón «📣 Reclamos» con el número de reclamos abiertos.
   · Programadas: en la visita de un equipo con reclamo aparece «📣 Reclamo» (rojo si está abierto).
   · Ficha del equipo y nueva orden: aviso rojo con el reclamo de ese equipo.
   Solo lectura. Sin señal muestra la última copia. Módulo fuera del IIFE base. */
const RECLAMOS = (() => {
  const LS = 'prosol_reclamos_cache';
  const DIAS = 60;                      // se muestran los reclamos de los últimos 60 días (y todos los abiertos)
  let lista = [];
  try { lista = JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { lista = []; }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const abierto = (r) => (r.estado || 'PENDIENTE') !== 'ATENDIDO';
  const ESTADO = { PENDIENTE: 'Pendiente', EN_GESTION: 'En gestión', ATENDIDO: 'Atendido' };
  const fecha = (s) => { try { return new Date(s).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return s || ''; } };
  const vigentes = () => {
    const lim = Date.now() - DIAS * 864e5;
    return lista.filter((r) => abierto(r) || new Date(r.creado || 0).getTime() >= lim)
      .sort((a, b) => (abierto(b) - abierto(a)) || String(b.creado || '').localeCompare(String(a.creado || '')));
  };
  const deSerie = (serie) => vigentes().filter((r) => serie && (r.serie || '') === serie);

  async function cargar() {
    if (typeof API === 'undefined' || !API.hayNube() || !navigator.onLine) { pintarTodo(); return; }
    if (API.sesionNube && !API.sesionNube()) { pintarTodo(); return; }       // sin sesión: última copia
    try {
      lista = (await API.select('reclamos_cliente')) || [];
      try { localStorage.setItem(LS, JSON.stringify(lista)); } catch (e) {}
    } catch (e) { /* sin conexión o sin permiso: se mantiene la última copia */ }
    pintarTodo();
  }

  function tarjeta(r) {
    const ab = abierto(r);
    return `<div style="border-left:4px solid ${ab ? '#c0392b' : '#1e8449'};background:${ab ? '#fdedec' : '#eafaf1'};border-radius:8px;padding:8px 10px;margin:6px 0">
      <div style="font-size:12px;color:#5d6d7e">${esc(fecha(r.creado))} · OT ${esc(r.numero_ot || '—')} · Serie ${esc(r.serie || '—')} ·
        <b style="color:${ab ? '#c0392b' : '#1e8449'}">${esc(ESTADO[r.estado] || r.estado || 'Pendiente')}</b></div>
      <div style="font-weight:700">${esc(r.cliente || '')}${r.motivo ? ' — ' + esc(r.motivo) : ''}</div>
      ${r.descripcion ? `<div style="font-size:14px;margin-top:2px">${esc(r.descripcion)}</div>` : ''}
      ${r.respuesta ? `<div style="font-size:13px;margin-top:4px">💬 <b>Oficina:</b> ${esc(r.respuesta)}</div>` : ''}</div>`;
  }

  function abrir(filtroSerie) {
    const rs = filtroSerie ? deSerie(filtroSerie) : vigentes();
    const fondo = document.createElement('div');
    fondo.id = 'rc-modal';
    fondo.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px';
    fondo.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:600px;width:100%;max-height:92vh;overflow:auto;padding:16px;color:#1b2631">
      <h3 style="margin:0 0 4px">📣 Reclamos de clientes${filtroSerie ? ' · Serie ' + esc(filtroSerie) : ''}</h3>
      <div style="font-size:13px;color:#5d6d7e;margin-bottom:6px">Lo que el cliente reportó sobre el servicio y la respuesta de la oficina. Revíselo antes de ir al equipo.</div>
      ${rs.map(tarjeta).join('') || '<div style="color:#5d6d7e;padding:10px 0">No hay reclamos.</div>'}
      <div style="text-align:right;margin-top:8px"><button class="btn btn-primary" id="rc-cerrar">Entendido</button></div></div>`;
    document.body.appendChild(fondo);
    fondo.querySelector('#rc-cerrar').onclick = () => fondo.remove();
    fondo.addEventListener('click', (e) => { if (e.target === fondo) fondo.remove(); });
  }

  // ── Menú: botón con el número de reclamos abiertos
  function pintarMenu() {
    const menu = document.getElementById('menu-modulos'); if (!menu) return;
    let b = document.getElementById('tile-reclamos');
    if (!b) {
      b = document.createElement('button'); b.className = 'tile'; b.id = 'tile-reclamos';
      b.innerHTML = '<span class="tile-ic">📣</span><span class="tile-tx">Reclamos</span><span class="tile-badge" id="badge-reclamos" style="background:#c0392b">0</span>';
      b.onclick = () => abrir();
      const ref = menu.querySelector('[data-go="programaciones"]');
      if (ref && ref.nextSibling) menu.insertBefore(b, ref.nextSibling); else menu.appendChild(b);
    }
    const n = vigentes().filter(abierto).length;
    const bd = document.getElementById('badge-reclamos');
    if (bd) { bd.textContent = n; bd.hidden = n === 0; }
  }

  // ── Programadas: «📣 Reclamo» en la visita del equipo
  function pintarProgramadas() {
    const l = document.getElementById('lista-prog'); if (!l) return;
    l.querySelectorAll('li.tw-row').forEach((li) => {
      const acc = li.querySelector('.prog-acc'); if (!acc) return;
      const m = ((li.querySelector('.t2-sub') || {}).textContent || '').match(/Serie\s+(\S+)/);
      const rs = m ? deSerie(m[1]) : [];
      let b = acc.querySelector('[data-pacc="reclamo"]');
      if (!rs.length) { if (b) b.remove(); return; }
      const ab = rs.some(abierto);
      if (!b) {
        b = document.createElement('button'); b.className = 'btn btn-ghost btn-sm'; b.dataset.pacc = 'reclamo';
        b.onclick = (ev) => { ev.stopPropagation(); abrir(m[1]); };
        acc.style.flexWrap = 'wrap'; acc.appendChild(b);
      }
      b.textContent = '📣 Reclamo' + (rs.length > 1 ? 's (' + rs.length + ')' : '');
      b.style.color = ab ? '#c0392b' : '#1e8449'; b.style.fontWeight = '700';
    });
  }

  // ── Aviso rojo en la ficha del equipo y en la nueva orden
  function aviso(contenedor, serie, id) {
    if (!contenedor) return;
    let a = document.getElementById(id);
    const rs = deSerie(serie);
    if (!rs.length) { if (a) a.remove(); return; }
    if (!a) { a = document.createElement('div'); a.id = id; contenedor.parentNode.insertBefore(a, contenedor); }
    const ab = rs.filter(abierto).length;
    a.style.cssText = `border-radius:10px;padding:10px 12px;margin:8px 0;cursor:pointer;color:#fff;background:${ab ? '#c0392b' : '#1e8449'}`;
    a.innerHTML = `<b>📣 ${ab ? 'Este equipo tiene ' + ab + ' reclamo' + (ab > 1 ? 's' : '') + ' abierto' + (ab > 1 ? 's' : '') : 'Reclamo atendido en este equipo'}</b>
      <div style="font-size:13px">${esc(rs[0].motivo || '')}${rs[0].descripcion ? ': ' + esc(rs[0].descripcion) : ''} — toque para ver</div>`;
    a.onclick = () => abrir(serie);
  }
  function serieFicha() {
    const d = document.getElementById('eq-datos'); if (!d) return '';
    const ks = d.querySelectorAll('.eq-k');
    for (const k of ks) if (k.textContent.trim() === 'Serie') { const v = k.nextElementSibling; return v && !v.classList.contains('vacio') ? v.textContent.trim() : ''; }
    return '';
  }
  function pintarFicha() { aviso(document.getElementById('eq-datos'), serieFicha(), 'rc-aviso-eq'); }
  function pintarOT() {
    const s = document.getElementById('ot-serie');
    aviso(s && s.closest('.field, .row, div'), s ? s.value.trim() : '', 'rc-aviso-ot');
  }
  function pintarTodo() { try { pintarMenu(); pintarProgramadas(); pintarFicha(); pintarOT(); } catch (e) {} }

  function vigilar() {
    const obs = (id, opts) => { const el = document.getElementById(id); if (el) new MutationObserver(() => pintarTodo()).observe(el, opts); return !!el; };
    if (!document.getElementById('menu-modulos')) return setTimeout(vigilar, 1000);
    obs('lista-prog', { childList: true }); obs('eq-datos', { childList: true });
    const s = document.getElementById('ot-serie');
    if (s) { s.addEventListener('change', pintarOT); setInterval(() => { if (s.value !== s.dataset.rcUlt) { s.dataset.rcUlt = s.value; pintarOT(); } }, 800); }
    pintarTodo(); cargar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilar); else vigilar();
  window.addEventListener('online', cargar);
  setInterval(cargar, 300000);
  return { cargar, abrir, pintarTodo, abiertos: () => vigentes().filter(abierto).length, _set: (l) => { lista = l || []; pintarTodo(); } };
})();
window.RECLAMOS = RECLAMOS;
