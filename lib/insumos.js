/* PROSOL Campo · lib/insumos.js (v3.95 · Fase 1 flujo de insumos)
   En cada visita programada: «📦 Insumos» con lo que bodega preparó para la orden de servicio (receta por tipo y potencia).
   P4 · el técnico marca cada artículo ✅ Recibido o ❌ No recibido (con motivo).
   P5 · ➕ Pedir insumo: cantidad + motivo → llega a la bandeja de bodega.
   P6 · anota lo USADO de cada insumo recibido; va al WhatsApp de la OT («📦 Insumos utilizados») y al PDF de la OT del PC.
   Sin señal: los cambios quedan en cola y se envían al volver. Módulo fuera del IIFE base. */
const INSUMOS = (() => {
  const LS = 'prosol_insumos_pend';
  let items = [];
  let catalogo = null;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cola = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } };
  const guardarCola = (c) => { try { localStorage.setItem(LS, JSON.stringify(c)); } catch (e) {} };
  const aviso = (m, t) => { try { (window.toast || alert)(m, t); } catch (e) {} };
  const est = () => window._prosolEstado || {};
  const hayNube = () => typeof API !== 'undefined' && API.hayNube();
  const n = (x) => { const v = Number(x); return isFinite(v) ? v : 0; };
  const fmt = (x) => String(Math.round(n(x) * 1000) / 1000);
  const ahora = () => new Date().toISOString();
  const TXT = { SOLICITADO: '⏳ Bodega aún no entrega', ENTREGADO: '📦 Entregado · confirme', RECIBIDO: '✅ Recibido',
                NO_RECIBIDO: '❌ No recibido', ANULADO: 'Anulado' };

  async function cargar() {
    if (!hayNube() || !navigator.onLine) { decorar(); return; }
    try { items = (await API.select('visita_repuestos')) || []; } catch (e) { return; }
    for (const c of cola()) {
      if (c.op === 'upd') { const it = items.find((x) => x.id === c.id); if (it) Object.assign(it, c.cambios); }
      else if (c.op === 'ins') items.push(Object.assign({ id: c.tmp, id_escritorio: '(pendiente)' }, c.fila));
    }
    decorar();
  }
  const deVisita = (idv) => items.filter((x) => x.id_visita === idv && x.estado_ins && x.estado_ins !== 'ANULADO');

  async function reintentar() {
    if (!navigator.onLine || !hayNube()) return;
    const c = cola(); if (!c.length) return;
    const quedan = [];
    for (const it of c) {
      try { if (it.op === 'upd') await API.update('visita_repuestos', it.id, it.cambios); else await API.insert('visita_repuestos', it.fila); }
      catch (e) { quedan.push(it); }
    }
    guardarCola(quedan);
    if (quedan.length < c.length) aviso('Insumos enviados a oficina.', 'ok');
  }
  async function actualizar(it, cambios) {
    Object.assign(cambios, { actualizado: ahora(), sync_origen: 'APP' });
    Object.assign(it, cambios);
    try { await API.update('visita_repuestos', it.id, cambios); return true; }
    catch (e) { const c = cola().filter((x) => !(x.op === 'upd' && x.id === it.id)); const prev = cola().find((x) => x.op === 'upd' && x.id === it.id);
                c.push({ op: 'upd', id: it.id, cambios: Object.assign({}, prev ? prev.cambios : {}, cambios) }); guardarCola(c);
                aviso('Sin conexión: se enviará al volver la señal.', 'warn'); return false; }
  }

  function abrir(p) {
    const lista = () => deVisita(p.ID_VISITA);
    const fondo = document.createElement('div');
    fondo.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px';
    document.body.appendChild(fondo);
    const pintar = () => {
      const L = lista();
      const srv = (L.find((x) => x.id_servicio) || {}).id_servicio || '';
      const guias = [...new Set(L.map((x) => x.numero_guia).filter(Boolean))].join(', ');
      fondo.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:600px;width:100%;max-height:92vh;overflow:auto;padding:16px;color:#1b2631">
        <h3 style="margin:0 0 4px">📦 Insumos de la visita ${esc(p.ID_VISITA || '')}</h3>
        <div style="font-size:13px;color:#5d6d7e;margin-bottom:10px">Serie ${esc(p.SERIE || '—')} · ${esc(p.TIPO_MANTENIMIENTO || '')}${srv ? ' · orden de servicio ' + esc(srv) : ''}${guias ? ' · guía ' + esc(guias) : ''}</div>
        ${L.length ? L.map((it) => fila(it)).join('') : '<div style="color:#5d6d7e;margin-bottom:8px">Aún no hay insumos cargados para esta visita.</div>'}
        <div id="in-err" style="color:#c0392b;font-size:13px;min-height:18px"></div>
        <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;margin-top:6px">
          <button class="btn btn-ghost" data-in="pedir">➕ Pedir insumo</button>
          <button class="btn btn-primary" data-in="cerrar">Cerrar</button></div></div>`;
      fondo.querySelector('[data-in="cerrar"]').onclick = () => { fondo.remove(); decorar(); };
      fondo.querySelector('[data-in="pedir"]').onclick = () => pedir(p, pintar);
      fondo.querySelectorAll('[data-acc]').forEach((b) => b.onclick = async () => {
        const it = L.find((x) => String(x.id) === b.dataset.id); if (!it) return;
        const quien = est().tecnico || '';
        if (b.dataset.acc === 'rec') await actualizar(it, { estado_ins: 'RECIBIDO', recibido_por: quien, recibido_en: ahora(), motivo: null });
        else if (b.dataset.acc === 'norec') {
          const m = prompt('¿Por qué no lo recibió? (motivo para bodega)', '');
          if (m === null) return;
          if (!m.trim()) { fondo.querySelector('#in-err').textContent = 'Indique el motivo.'; return; }
          await actualizar(it, { estado_ins: 'NO_RECIBIDO', motivo: m.trim(), recibido_por: quien, recibido_en: ahora() });
        } else if (b.dataset.acc === 'uso') {
          const v = fondo.querySelector(`input[data-uso="${it.id}"]`).value;
          if (v === '' || !(n(v) >= 0) || n(v) > n(it.cantidad)) { fondo.querySelector('#in-err').textContent = 'Lo usado debe estar entre 0 y ' + fmt(it.cantidad) + '.'; return; }
          await actualizar(it, { cant_usada: n(v) });
          aviso('Uso anotado: ' + fmt(v) + ' ' + (it.unidad || ''), 'ok');
        }
        pintar();
      });
    };
    pintar();
  }
  function fila(it) {
    const e = it.estado_ins;
    let acc = '';
    if (e === 'ENTREGADO') acc = `<button class="btn btn-primary btn-sm" data-acc="rec" data-id="${it.id}">✅ Recibido</button>
                                  <button class="btn btn-ghost btn-sm" data-acc="norec" data-id="${it.id}">❌ No recibido</button>`;
    else if (e === 'RECIBIDO') acc = `<label style="font-size:12px">Usado <input type="number" min="0" step="any" data-uso="${it.id}"
        value="${esc(it.cant_usada ?? it.cantidad)}" style="width:70px;padding:5px;border-radius:6px;border:1px solid #aab7b8"></label>
        <button class="btn btn-ghost btn-sm" data-acc="uso" data-id="${it.id}">Guardar uso</button>`;
    else if (e === 'NO_RECIBIDO') acc = `<span style="font-size:12px;color:#c0392b">Motivo: ${esc(it.motivo || '')} · bodega lo revisa</span>`;
    return `<div style="padding:8px;border:1px solid #d5d8dc;border-radius:8px;margin-bottom:6px">
      <div><b>${esc(it.codigo || '')}</b> ${esc(it.descripcion || '')}${it.origen === 'ADICIONAL' ? ' <span style="font-size:11px;color:#7d3c98">(pedido por técnico)</span>' : ''}</div>
      <div style="font-size:12px;color:#5d6d7e">${fmt(it.cantidad)} ${esc(it.unidad || '')} · ${TXT[e] || esc(e || '')}${it.numero_guia ? ' · guía ' + esc(it.numero_guia) : ''}${it.cant_usada != null && e === 'RECIBIDO' ? ' · usado ' + fmt(it.cant_usada) : ''}</div>
      ${acc ? `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px">${acc}</div>` : ''}</div>`;
  }

  async function pedir(p, alTerminar) {
    if (!catalogo) { try { catalogo = (await API.select('repuestos')) || []; } catch (e) { catalogo = []; } }
    const act = catalogo.filter((r) => String(r.estado || 'ACTIVO').toUpperCase() === 'ACTIVO')
      .sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion)));
    const caja = document.createElement('div');
    caja.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:12px';
    caja.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:480px;width:100%;padding:16px;color:#1b2631">
      <h3 style="margin:0 0 8px">➕ Pedir insumo · ${esc(p.ID_VISITA)}</h3>
      <label style="font-weight:600">Insumo</label>
      <select id="pi-rep" style="width:100%;padding:8px;margin:4px 0 8px;border-radius:8px;border:1px solid #d5d8dc">
        <option value="">— elegir —</option>${act.map((r) => `<option value="${esc(r.id_escritorio)}">${esc(r.codigo || '')} · ${esc(r.descripcion || '')}</option>`).join('')}</select>
      <label style="font-weight:600">Cantidad</label>
      <input id="pi-cant" type="number" min="0" step="any" value="1" style="width:100%;padding:8px;margin:4px 0 8px;border-radius:8px;border:1px solid #d5d8dc;box-sizing:border-box">
      <label style="font-weight:600">Motivo</label>
      <textarea id="pi-mot" rows="2" style="width:100%;box-sizing:border-box;margin:4px 0 6px;padding:8px;border-radius:8px;border:1px solid #d5d8dc"></textarea>
      <div id="pi-err" style="color:#c0392b;font-size:13px;min-height:18px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" id="pi-x">Cancelar</button>
        <button class="btn btn-primary" id="pi-ok">Enviar a bodega</button></div></div>`;
    document.body.appendChild(caja);
    const q = (s) => caja.querySelector(s);
    q('#pi-x').onclick = () => caja.remove();
    q('#pi-ok').onclick = async () => {
      const r = act.find((x) => x.id_escritorio === q('#pi-rep').value), cant = n(q('#pi-cant').value), mot = q('#pi-mot').value.trim();
      if (!r) { q('#pi-err').textContent = 'Elija el insumo.'; return; }
      if (!(cant > 0)) { q('#pi-err').textContent = 'La cantidad debe ser mayor que cero.'; return; }
      if (!mot) { q('#pi-err').textContent = 'Indique el motivo.'; return; }
      const filaN = { id_visita: p.ID_VISITA, id_repuesto: r.id_escritorio, codigo: r.codigo || '', descripcion: r.descripcion || '',
        unidad: r.unidad || '', cantidad: cant, origen: 'ADICIONAL', estado_ins: 'SOLICITADO', solicitado_por: est().tecnico || '',
        solicitado_en: ahora(), nota: mot, actualizado: ahora(), sync_origen: 'APP' };
      try { const res = await API.insert('visita_repuestos', filaN); items.push(Array.isArray(res) ? res[0] : Object.assign({ id: 'tmp' + Date.now() }, filaN));
            aviso('Pedido enviado a bodega.', 'ok'); }
      catch (e) { const tmp = 'tmp' + Date.now(); const c = cola(); c.push({ op: 'ins', tmp, fila: filaN }); guardarCola(c);
                  items.push(Object.assign({ id: tmp }, filaN)); aviso('Sin conexión: el pedido se enviará al volver la señal.', 'warn'); }
      caja.remove(); if (alTerminar) alTerminar();
    };
  }

  function _visitaDeFila(li) {
    if (typeof NOVEDADES !== 'undefined' && NOVEDADES._visitaDeFila) return NOVEDADES._visitaDeFila(li);
    return null;
  }
  function decorar() {
    const lista = document.getElementById('lista-prog'); if (!lista) return;
    lista.querySelectorAll('li.tw-row').forEach((li) => {
      const acc = li.querySelector('.prog-acc'); if (!acc) return;
      const p = _visitaDeFila(li); if (!p || !p.ID_VISITA) return;
      const L = deVisita(p.ID_VISITA);
      const porConfirmar = L.filter((x) => x.estado_ins === 'ENTREGADO').length;
      const txt = !L.length ? '📦 Insumos' : porConfirmar ? '📦 Insumos · ' + porConfirmar + ' por confirmar'
        : L.every((x) => x.estado_ins === 'RECIBIDO') ? '✅ Insumos recibidos' : '📦 Insumos (' + L.length + ')';
      let b = acc.querySelector('[data-pacc="insumos"]');
      if (L.length) { const m = acc.querySelector('[data-pacc="materiales"]'); if (m) m.remove(); }   // reemplaza «Materiales» (guía completa)
      if (b) { b.textContent = txt; return; }
      b = document.createElement('button');
      b.className = 'btn btn-ghost btn-sm'; b.dataset.pacc = 'insumos'; b.textContent = txt;
      b.onclick = (ev) => { ev.stopPropagation(); abrir(p); };
      acc.style.flexWrap = 'wrap'; acc.appendChild(b);
    });
  }

  // P6 · WhatsApp de la OT: se agrega «📦 Insumos utilizados» (el mensaje lo arma la app; aquí solo se completa)
  const _open = window.open.bind(window);
  window.open = function (url, ...resto) {
    try {
      const u = String(url || '');
      if (u.startsWith('https://wa.me/') && u.includes('?text=')) {
        const i = u.indexOf('?text=') + 6, txt = decodeURIComponent(u.slice(i));
        if (/ORDEN DE TRABAJO/i.test(txt) && !txt.includes('Insumos utilizados')) {
          const extra = bloqueOT(txt);
          if (extra) return _open(u.slice(0, i) + encodeURIComponent(txt + extra), ...resto);
        }
      }
    } catch (e) {}
    return _open(url, ...resto);
  };
  function bloqueOT(txt) {
    const m = txt.match(/Serie:\*?\s*([A-Za-z0-9\-]+)/i); if (!m) return '';
    const serie = m[1], c = est().catalogo || {};
    const vis = (c.programaciones || []).filter((p) => p.SERIE === serie && items.some((x) => x.id_visita === p.ID_VISITA && x.estado_ins === 'RECIBIDO'))
      .sort((a, b) => String(b.FECHA_PROGRAMADA).localeCompare(String(a.FECHA_PROGRAMADA)));   // la visita más reciente de esa serie
    if (!vis.length) return '';
    const L = items.filter((x) => x.id_visita === vis[0].ID_VISITA && x.estado_ins === 'RECIBIDO');
    if (!L.length) return '';
    return '\n\n📦 *Insumos utilizados*\n' + L.map((x) => '• ' + (x.descripcion || x.codigo) + ': ' + fmt(x.cant_usada ?? x.cantidad) + ' ' + (x.unidad || '')).join('\n');
  }

  function vigilar() {
    const lista = document.getElementById('lista-prog');
    if (!lista) return setTimeout(vigilar, 1000);
    new MutationObserver(() => decorar()).observe(lista, { childList: true });
    reintentar().then(cargar);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilar); else vigilar();
  window.addEventListener('online', () => { reintentar().then(cargar); });
  setInterval(() => { reintentar().then(cargar); }, 120000);
  return { cargar, abrir, decorar, reintentar, bloqueOT, pendientes: () => cola().length, _set: (l) => { items = l || []; decorar(); } };
})();
window.INSUMOS = INSUMOS;
