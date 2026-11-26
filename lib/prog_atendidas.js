/* PROSOL Campo · lib/prog_atendidas.js (v3.94.1)
   Celular › «Mantenimientos programados» (lista): una visita ya atendida deja de ofrecer «Atender».
   Atendida = la visita está EJECUTADA en el catálogo, o el técnico ya tiene una OT del MISMO equipo (serie) con fecha
   igual o posterior a la fecha programada (pendiente de enviar, enviada o en el historial). Es el mismo criterio del
   calendario («Atendida (OT del día)»), del escritorio y de la web.
   En la fila: «✅ Atendida · OT N°»; se ocultan «Atender» y «No se puede realizar» y tocar la fila ya no abre otra OT.
   «Seguimiento / avance» se mantiene. Módulo fuera del IIFE base. */
const PROG_ATENDIDAS = (() => {
  const est = () => window._prosolEstado || {};
  const css = document.createElement('style');
  css.textContent = 'li.pa-atendida [data-pacc="atender"],li.pa-atendida [data-pacc="norealiza"],li.pa-atendida .nv-marca{display:none!important}'
    + 'li.pa-atendida{cursor:default}.pa-marca{color:#1e8449;font-weight:700;margin-top:4px}';
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
  function decorar() {
    const l = document.getElementById('lista-prog'); if (!l) return;
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
    decorar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilar); else vigilar();
  return { decorar, atencion };
})();
window.PROG_ATENDIDAS = PROG_ATENDIDAS;
