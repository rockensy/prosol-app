/* PROSOL Campo · lib/ot_unica.js (v3.99.2)
   «Nueva orden» del celular: NO se puede guardar una OT con un número ya registrado (antes solo avisaba y se podía
   seguir, y así se duplicó la OT 2583 con dos clientes). Se revisa:
   · en el celular: órdenes por enviar, enviadas e historial del catálogo;
   · en la nube (si hay señal): todas las OT de oficina (función ot_numero_existe).
   Sin señal solo se puede revisar lo que está en el celular.
   Módulo fuera del IIFE base: actúa antes del «Guardar orden» original. */
const OT_UNICA = (() => {
  const est = () => window._prosolEstado || {};
  let aprobado = '';                       // número ya verificado (deja pasar el clic que re-dispara)
  const norm = (x) => String(x || '').trim();
  function local(num) {
    const E = est(), c = E.catalogo || {};
    const L = [].concat(E.historial || [], c.historial_ot || []);
    const h = L.find((o) => norm(o.NUMERO_OT || o.numero_ot) === num);
    return h ? { numero: num, serie: h.SERIE || h.serie || '', fecha: h.FECHA || h.fecha || '', cliente: h.RAZON_SOCIAL || h.cliente_nombre || '' } : null;
  }
  async function nube(num) {
    if (typeof API === 'undefined' || !API.hayNube() || !navigator.onLine) return undefined;
    try { return await API.rpc('ot_numero_existe', { p_numero: num }); } catch (e) { return undefined; }
  }
  function avisar(num, r) {
    const msg = 'El N° de orden ' + num + ' ya está registrado' + (r.cliente ? ' para ' + r.cliente : '') + (r.serie ? ' (serie ' + r.serie + ')' : '')
      + (r.fecha ? ' el ' + String(r.fecha).slice(0, 10) : '') + '.\n\nRevise el número de la orden física: no se puede repetir.';
    alert(msg);
    const i = document.getElementById('ot-numero'); if (i) { i.focus(); i.select && i.select(); }
  }
  async function revisar(ev) {
    const b = ev.target && ev.target.closest && ev.target.closest('#btn-guardar-ot'); if (!b) return;
    const num = norm((document.getElementById('ot-numero') || {}).value);
    if (!num || (est().ordenes || []).some((o) => norm(o.NUMERO_OT) === num)) return;   // vacío o repetido sin enviar: lo maneja la app
    if (aprobado === num) { aprobado = ''; return; }
    const l = local(num);
    if (l) { ev.stopImmediatePropagation(); ev.preventDefault(); avisar(num, l); return; }
    ev.stopImmediatePropagation(); ev.preventDefault();
    b.disabled = true;
    const r = await nube(num);
    b.disabled = false;
    if (r) { avisar(num, r); return; }
    aprobado = num; b.click();             // libre (o sin señal): sigue el guardado normal
  }
  document.addEventListener('click', revisar, true);
  return { local, nube };
})();
window.OT_UNICA = OT_UNICA;
