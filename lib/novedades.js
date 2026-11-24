/* PROSOL Campo · lib/novedades.js (v3.87 · PSR-7)
   «No se puede realizar»: el técnico registra motivo, nota, hasta 3 fotos y GPS de una visita programada.
   Se envía a la nube (novedades_campo) y la visita queda NO_REALIZADA. Sin señal: queda en cola y se reintenta.
   Módulo fuera del IIFE base (regla de la app). */
const NOVEDADES = (() => {
  const LS = 'prosol_novedades_pend';
  const MOTIVOS = ['Cliente ausente', 'Sin acceso al equipo', 'Equipo no disponible o apagado por el cliente',
                   'Falta repuesto o material', 'Clima o seguridad', 'Otro'];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cola = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } };
  const guardarCola = (c) => { try { localStorage.setItem(LS, JSON.stringify(c)); } catch (e) {} };
  const aviso = (m, t) => { try { (window.toast || alert)(m, t); } catch (e) {} };

  function gps() {
    return new Promise((res) => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => res(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
    });
  }
  function leerFoto(file) {
    return new Promise((res) => {
      const fr = new FileReader();
      fr.onload = async () => res(typeof reducirFoto === 'function' ? await reducirFoto(fr.result, 1280) : fr.result);
      fr.onerror = () => res(null);
      fr.readAsDataURL(file);
    });
  }

  async function enviar(item) {
    const urls = [];
    for (let i = 0; i < item.fotos.length; i++) {
      urls.push(await API.subirFoto('ot/novedades/' + item.fila.id + '/n_' + (i + 1) + '.jpg', item.fotos[i]));
    }
    const fila = Object.assign({}, item.fila, { fotos: urls });
    try { await API.insert('novedades_campo', fila); }
    catch (e) { if (!/duplicate|23505|409/.test(String(e.message || e))) throw e; }   // reintento: ya estaba
    if (item.visitaSb) await API.update('visitas_programadas', item.visitaSb, { estado: 'NO_REALIZADA' }).catch(() => null);
  }

  async function reintentar() {
    if (!navigator.onLine || typeof API === 'undefined' || !API.hayNube()) return;
    const c = cola(); if (!c.length) return;
    const quedan = [];
    for (const it of c) { try { await enviar(it); } catch (e) { quedan.push(it); } }
    guardarCola(quedan);
    if (quedan.length < c.length) aviso('Novedades de campo enviadas: ' + (c.length - quedan.length), 'ok');
  }

  function abrir(p, cliente, tecnico, alTerminar) {
    const fondo = document.createElement('div');
    fondo.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px';
    fondo.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:92vh;overflow:auto;padding:16px;color:#1b2631">
      <h3 style="margin:0 0 4px">⛔ No se puede realizar</h3>
      <div style="font-size:13px;color:#5d6d7e;margin-bottom:10px">${esc(cliente)} · Serie ${esc(p.SERIE || '—')} · ${esc(p.FECHA_PROGRAMADA || '')} ${esc(p.HORA || '')}</div>
      <label style="font-weight:600">Motivo</label>
      <div id="nv-motivos" style="display:flex;flex-direction:column;gap:6px;margin:6px 0 10px">
        ${MOTIVOS.map((m, i) => `<label style="display:flex;gap:8px;align-items:center;padding:8px;border:1px solid #d5d8dc;border-radius:8px">
          <input type="radio" name="nv-mot" value="${esc(m)}" ${i === 0 ? '' : ''}> ${esc(m)}</label>`).join('')}
      </div>
      <label style="font-weight:600">Nota para la oficina</label>
      <textarea id="nv-nota" rows="3" style="width:100%;box-sizing:border-box;margin:6px 0 10px;padding:8px;border-radius:8px;border:1px solid #d5d8dc"
        placeholder="Qué pasó y qué se necesita para volver"></textarea>
      <label style="font-weight:600">Fotos (hasta 3)</label>
      <input id="nv-fotos" type="file" accept="image/*" capture="environment" multiple style="display:block;margin:6px 0 4px">
      <div id="nv-prev" style="display:flex;gap:6px;margin-bottom:10px"></div>
      <div id="nv-err" style="color:#c0392b;font-size:13px;min-height:18px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
        <button class="btn btn-ghost" id="nv-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="nv-enviar">Enviar a oficina</button></div></div>`;
    document.body.appendChild(fondo);
    let fotos = [];
    const q = (s) => fondo.querySelector(s);
    q('#nv-fotos').onchange = async (ev) => {
      const fs = Array.from(ev.target.files || []).slice(0, 3 - fotos.length);
      for (const f of fs) { const d = await leerFoto(f); if (d) fotos.push(d); }
      q('#nv-prev').innerHTML = fotos.map((d) => `<img src="${d}" style="width:72px;height:72px;object-fit:cover;border-radius:6px">`).join('');
      ev.target.value = '';
    };
    fondo.querySelectorAll('input[name="nv-mot"]').forEach((r) => { r.onchange = () => { q('#nv-err').textContent = ''; }; });
    q('#nv-cancelar').onclick = () => fondo.remove();
    q('#nv-enviar').onclick = async () => {
      const mot = (fondo.querySelector('input[name="nv-mot"]:checked') || {}).value;
      const nota = q('#nv-nota').value.trim();
      if (!mot) { q('#nv-err').textContent = 'Elija el motivo.'; return; }
      if (mot === 'Otro' && !nota) { q('#nv-err').textContent = 'Con «Otro», escriba la nota.'; return; }
      q('#nv-enviar').disabled = true; q('#nv-enviar').textContent = 'Enviando…';
      const g = await gps();
      const item = { visitaSb: p.ID_SB || null, fotos, fila: {
        id: API.uuid(), id_visita: p.ID_VISITA || null, id_visita_sb: p.ID_SB || null, serie: p.SERIE || '', cliente: cliente || '',
        tecnico: tecnico || '', motivo: mot, nota, gps_lat: g ? g.lat : null, gps_lng: g ? g.lng : null, estado: 'PENDIENTE' } };
      p.ESTADO = 'NO_REALIZADA';
      try { await enviar(item); aviso('Novedad enviada a oficina.', 'ok'); }
      catch (e) { const c = cola(); c.push(item); guardarCola(c); aviso('Sin conexión: la novedad se enviará al volver la señal.', 'warn'); }
      fondo.remove();
      if (alTerminar) alTerminar();
    };
  }

  // ── Botón en la lista de programadas (inyectado desde fuera del IIFE base: no se toca app.js) ──────────────
  function _est() { return window._prosolEstado || {}; }
  function _visitaDeFila(li) {
    const progs = ((_est().catalogo || {}).programaciones || []);
    const sub = (li.querySelector('.t2-sub') || {}).textContent || '';
    const partes = ((li.querySelector('.tw-c1') || {}).innerHTML || '').split(/<br\s*\/?>/i)
      .map((x) => { const d = document.createElement('div'); d.innerHTML = x; return d.textContent.trim(); });
    const m = sub.match(/Serie\s+(\S+)/); if (!m) return null;
    const fecha = partes[0] || '', hora = partes[1] || '';
    return progs.find((p) => (p.SERIE || '') === m[1] && (p.FECHA_PROGRAMADA || '—') === fecha && (p.HORA || '') === hora) || null;
  }
  function _cliente(p) {
    const c = (((_est().catalogo || {}).clientes) || []).find((x) => x.ID_CLIENTE === p.ID_CLIENTE);
    return c ? c.RAZON_SOCIAL : '';
  }
  function decorar() {
    const lista = document.getElementById('lista-prog'); if (!lista) return;
    lista.querySelectorAll('li.tw-row').forEach((li) => {
      const acc = li.querySelector('.prog-acc');
      if (!acc || acc.querySelector('[data-pacc="norealiza"]')) return;
      const p = _visitaDeFila(li); if (!p) return;
      const b = document.createElement('button');
      b.className = 'btn btn-ghost btn-sm'; b.dataset.pacc = 'norealiza'; b.style.color = '#c0392b';
      b.textContent = '⛔ No se puede realizar';
      b.onclick = (ev) => { ev.stopPropagation(); abrir(p, _cliente(p), _est().tecnico || '', () => {
        try { (li.querySelector('.nv-marca') || {}).hidden = false; } catch (e) {} decorar(); marcar(li, p); }); };
      acc.style.flexWrap = 'wrap'; acc.appendChild(b);
      marcar(li, p);
    });
  }
  function marcar(li, p) {
    if ((p.ESTADO || '').toUpperCase() !== 'NO_REALIZADA' || li.querySelector('.nv-marca')) return;
    const d = document.createElement('div'); d.className = 'nv-marca';
    d.style.cssText = 'color:#c0392b;font-weight:600;margin-top:4px'; d.textContent = '⛔ No realizada · enviada a oficina';
    (li.querySelector('.tw-c2') || li).appendChild(d);
  }
  function vigilar() {
    const lista = document.getElementById('lista-prog');
    if (!lista) return setTimeout(vigilar, 1000);
    new MutationObserver(() => decorar()).observe(lista, { childList: true });
    decorar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilar); else vigilar();

  window.addEventListener('online', () => { reintentar(); });
  setInterval(() => { reintentar(); }, 60000);
  setTimeout(() => { reintentar(); }, 5000);
  return { abrir, reintentar, decorar, pendientes: () => cola().length, MOTIVOS };
})();
window.NOVEDADES = NOVEDADES;
