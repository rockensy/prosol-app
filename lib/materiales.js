/* PROSOL Campo · lib/materiales.js (v3.88 · PSR-6)
   El técnico confirma los materiales de la guía de bodega de su visita: «Recibí todo» o «Hay diferencias»
   (cantidad recibida por ítem y nota). Se guarda en la nube (guias_campo) y el PC lo anota en la guía y el expediente.
   Sin señal queda en cola. Módulo fuera del IIFE base: el botón se agrega a la lista de programadas. */
const MATERIALES = (() => {
  const LS = 'prosol_materiales_pend';
  let guias = [];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cola = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } };
  const guardarCola = (c) => { try { localStorage.setItem(LS, JSON.stringify(c)); } catch (e) {} };
  const aviso = (m, t) => { try { (window.toast || alert)(m, t); } catch (e) {} };
  const est = () => window._prosolEstado || {};

  async function cargar() {
    if (typeof API === 'undefined' || !API.hayNube() || !navigator.onLine) return;
    try { guias = (await API.select('guias_campo')) || []; } catch (e) { return; }
    for (const c of cola()) { const g = guias.find((x) => x.id === c.id); if (g) Object.assign(g, c.cambios); }
    decorar();
  }
  const guiaDe = (p) => guias.find((g) => g.id_visita && g.id_visita === p.ID_VISITA);

  async function reintentar() {
    if (!navigator.onLine || typeof API === 'undefined' || !API.hayNube()) return;
    const c = cola(); if (!c.length) return;
    const quedan = [];
    for (const it of c) { try { await API.update('guias_campo', it.id, it.cambios); } catch (e) { quedan.push(it); } }
    guardarCola(quedan);
    if (quedan.length < c.length) aviso('Confirmación de materiales enviada.', 'ok');
  }

  function abrir(g, alTerminar) {
    const items = g.items || [];
    const fondo = document.createElement('div');
    fondo.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px';
    fondo.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:92vh;overflow:auto;padding:16px;color:#1b2631">
      <h3 style="margin:0 0 4px">📦 Materiales de la guía ${esc(g.numero || '')}</h3>
      <div style="font-size:13px;color:#5d6d7e;margin-bottom:10px">${esc(g.cliente || '')} · Serie ${esc(g.serie || '—')} · entregada a ${esc(g.entregada_a || '—')}</div>
      <div style="font-size:13px;margin-bottom:6px">Marque lo recibido. Si algo no llegó completo, corrija la cantidad.</div>
      <div id="mt-items">${items.map((it, i) => `
        <div style="display:flex;gap:8px;align-items:center;padding:8px;border:1px solid #d5d8dc;border-radius:8px;margin-bottom:6px">
          <div style="flex:1"><b>${esc(it.codigo)}</b> ${esc(it.descripcion)}<div style="font-size:12px;color:#5d6d7e">Entregado: ${esc(it.cantidad)} ${esc(it.unidad || '')}</div></div>
          <input type="number" min="0" step="any" data-i="${i}" value="${esc(it.cantidad)}" style="width:76px;padding:6px;border-radius:6px;border:1px solid #aab7b8">
        </div>`).join('') || '<div style="color:#5d6d7e">La guía no tiene ítems.</div>'}</div>
      <label style="font-weight:600">Nota (opcional)</label>
      <textarea id="mt-nota" rows="2" style="width:100%;box-sizing:border-box;margin:6px 0 8px;padding:8px;border-radius:8px;border:1px solid #d5d8dc"></textarea>
      <div id="mt-err" style="color:#c0392b;font-size:13px;min-height:18px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-ghost" id="mt-cancelar">Cancelar</button>
        <button class="btn btn-primary" id="mt-ok">Confirmar recepción</button></div></div>`;
    document.body.appendChild(fondo);
    const q = (s) => fondo.querySelector(s);
    q('#mt-cancelar').onclick = () => fondo.remove();
    q('#mt-ok').onclick = async () => {
      const rec = items.map((it, i) => Object.assign({}, it, { recibido: Number(fondo.querySelector(`input[data-i="${i}"]`).value) }));
      if (rec.some((x) => !(x.recibido >= 0))) { q('#mt-err').textContent = 'Revise las cantidades.'; return; }
      const dif = rec.some((x) => Number(x.recibido) !== Number(x.cantidad));
      const nota = q('#mt-nota').value.trim();
      const cambios = { estado: dif ? 'CON_DIFERENCIAS' : 'RECIBIDA', items_recibidos: rec, recibido_por: est().tecnico || '',
                        recibido_en: new Date().toISOString(), observacion: nota };
      Object.assign(g, cambios);
      try { await API.update('guias_campo', g.id, cambios); aviso(dif ? 'Diferencias enviadas a bodega.' : 'Recepción confirmada.', 'ok'); }
      catch (e) { const c = cola().filter((x) => x.id !== g.id); c.push({ id: g.id, cambios }); guardarCola(c);
                  aviso('Sin conexión: la confirmación se enviará al volver la señal.', 'warn'); }
      fondo.remove();
      if (alTerminar) alTerminar();
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
      const p = _visitaDeFila(li); if (!p) return;
      const g = guiaDe(p);
      const prev = acc.querySelector('[data-pacc="materiales"]');
      if (!g) { if (prev) prev.remove(); return; }
      const txt = g.estado === 'RECIBIDA' ? '✅ Materiales recibidos' : g.estado === 'CON_DIFERENCIAS' ? '⚠ Materiales con diferencias' : '📦 Materiales (' + (g.items || []).length + ')';
      if (prev) { prev.textContent = txt; return; }
      const b = document.createElement('button');
      b.className = 'btn btn-ghost btn-sm'; b.dataset.pacc = 'materiales'; b.textContent = txt;
      b.onclick = (ev) => { ev.stopPropagation(); abrir(g, () => decorar()); };
      acc.style.flexWrap = 'wrap'; acc.appendChild(b);
    });
  }
  function vigilar() {
    const lista = document.getElementById('lista-prog');
    if (!lista) return setTimeout(vigilar, 1000);
    new MutationObserver(() => decorar()).observe(lista, { childList: true });
    cargar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilar); else vigilar();
  window.addEventListener('online', () => { reintentar().then(cargar); });
  setInterval(() => { reintentar().then(cargar); }, 120000);
  return { cargar, abrir, decorar, reintentar, pendientes: () => cola().length, _set: (l) => { guias = l || []; decorar(); } };
})();
window.MATERIALES = MATERIALES;
