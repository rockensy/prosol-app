/* PROSOL Campo · lib/prog_atendidas.js (v3.94.1 · v3.99.2)
   Celular › «Mantenimientos programados» (lista): una visita ya atendida deja de ofrecer «Atender».
   Atendida = la visita está EJECUTADA en el catálogo, o el técnico ya tiene una OT del MISMO equipo (serie) con fecha
   igual o posterior a la fecha programada (pendiente de enviar, enviada o en el historial). Es el mismo criterio del
   calendario («Atendida (OT del día)»), del escritorio y de la web.
   En la fila: «✅ Atendida · OT N°»; se ocultan «Atender» y «No se puede realizar» y tocar la fila ya no abre otra OT.
   v3.99.2: una visita atendida ya está CERRADA: tampoco muestra «Seguimiento / avance», «Insumos» ni «Materiales»
   (cambios solo el administrador). Las atendidas van al final, en «✅ Atendidas (solo consulta)», como máximo las
   últimas N que define el ADMIN (por defecto 50). Módulo fuera del IIFE base. */
const PROG_ATENDIDAS = (() => {
  const est = () => window._prosolEstado || {};
  const css = document.createElement('style');
  css.textContent = 'li.pa-atendida [data-pacc="atender"],li.pa-atendida [data-pacc="norealiza"],li.pa-atendida .nv-marca,'
    + 'li.pa-atendida [data-pacc="seguir"],li.pa-atendida [data-pacc="insumos"],li.pa-atendida [data-pacc="materiales"],li.pa-oculta{display:none!important}'
    + 'li.pa-atendida{cursor:default;opacity:.85}.pa-marca{color:#1e8449;font-weight:700;margin-top:4px}'
    + 'li.pa-titulo{list-style:none;padding:10px 4px 4px;font-weight:700;color:#1e8449;border-top:2px solid #d5f5e3;margin-top:6px}';
  (document.head || document.documentElement).appendChild(css);

  function ots() {
    const e = est(), c = e.catalogo || {};
    return [].concat(e.ordenes || [], e.historial || [], c.historial_ot || [])
      .map((o) => ({ serie: String(o.SERIE || o.serie || ''), fecha: String(o.FECHA || o.fecha || '').slice(0, 10), num: o.NUMERO_OT || o.numero_ot || '' }))
      .filter((o) => o.serie && o.fecha);
  }
  function atencion(serie, fecha) {
    const c = est().catalogo || {};
    const p = (c.programaciones || []).find((x) => x.SERIE === serie && x.FECHA_PROGRAMADA === fecha);
    const o = ots().filter((x) => x.serie === serie && x.fecha >= fecha).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
    if (o) return { num: o.num };
    if (p && String(p.ESTADO || '').toUpperCase() === 'EJECUTADA') return { num: '' };
    return null;
  }
  const maxInfo = () => Number(((est().catalogo || {}).movil_cfg || {}).max) || 50;
  let ocupado = false;
  function decorar() {
    if (ocupado) return;
    const l = document.getElementById('lista-prog'); if (!l) return;
    ocupado = true;
    try { marcar(l); ordenar(l); } finally { setTimeout(() => { ocupado = false; }, 0); }
  }
  // v3.99.2: pendientes arriba; atendidas al final (solo consulta), las N más recientes
  function ordenar(l) {
    const filas = [...l.querySelectorAll('li.tw-row')];
    const at = filas.filter((li) => li.classList.contains('pa-atendida'));
    let tit = l.querySelector('li.pa-titulo');
    if (!at.length) { if (tit) tit.remove(); contar(filas.length, 0, 0); return; }
    at.sort((a, b) => ((b.querySelector('.tw-c1') || {}).textContent || '').localeCompare((a.querySelector('.tw-c1') || {}).textContent || ''));
    if (!tit) { tit = document.createElement('li'); tit.className = 'pa-titulo'; }
    l.appendChild(tit);
    const max = maxInfo();
    at.forEach((li, i) => { l.appendChild(li); li.classList.toggle('pa-oculta', i >= max); });
    const vis = Math.min(at.length, max);
    tit.textContent = '✅ Atendidas (solo consulta) · ' + vis + (at.length > vis ? ' de ' + at.length : '');
    contar(filas.length - at.length, vis, at.length);
  }
  function contar(pend, vis, tot) {
    const c = document.getElementById('prog-count'); if (!c || !c.textContent) return;
    c.textContent = pend + ' por atender' + (tot ? ' · ' + vis + ' atendida(s) (solo consulta)' : '');
  }
  function marcar(l) {
    l.querySelectorAll('li.tw-row').forEach((li) => {
      const m = ((li.querySelector('.t2-sub') || {}).textContent || '').match(/Serie\s+(\S+)/);
      const f = ((li.querySelector('.tw-c1') || {}).textContent || '').slice(0, 10);
      const a = m ? atencion(m[1], f) : null;
      let t = li.querySelector('.pa-marca');
      if (!a) { li.classList.remove('pa-atendida'); if (t) t.remove(); return; }
      li.classList.add('pa-atendida');
      li.onclick = null;                                  // ya atendida: tocar la fila no abre otra OT
      if (!t) { t = document.createElement('div'); t.className = 'pa-marca'; (li.querySelector('.tw-c2') || li).appendChild(t); }
      t.textContent = '✅ Atendida' + (a.num ? ' · OT ' + a.num : '');
    });
  }
  function vigilar() {
    const l = document.getElementById('lista-prog');
    if (!l) return setTimeout(vigilar, 1000);
    new MutationObserver(() => decorar()).observe(l, { childList: true });
    const c = document.getElementById('prog-count');
    if (c) new MutationObserver(() => { if (!ocupado && !/por atender/.test(c.textContent)) decorar(); }).observe(c, { childList: true, characterData: true, subtree: true });
    decorar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilar); else vigilar();
  return { decorar, atencion };
})();
window.PROG_ATENDIDAS = PROG_ATENDIDAS;
