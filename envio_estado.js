/* envio_estado.js · PROSOL Campo · M7 — estado de envío a Supabase visible + reintento.
   Va FUERA del IIFE de app.js: usa window._prosolEstado (órdenes del técnico) y API (lib/api.js).
   - Cada OT queda registrada como enviada / pendiente con su error exacto (localStorage por técnico).
   - Antes de insertar revisa en Supabase si la OT (N° + serie, origen CAMPO) ya existe: no duplica.
   - Sin internet: no pierde nada, queda pendiente y lo avisa. "Reintentar" reenvía solo las pendientes. */
(() => {
  'use strict';
  const KEY = (t) => 'prosol_subidas::' + t;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const est = () => window._prosolEstado;
  const idOT = (o) => o.COD_TEMP || ((o.NUMERO_OT || '') + '|' + (o.SERIE || ''));
  const cargar = (t) => { try { return JSON.parse(localStorage.getItem(KEY(t)) || 'null') || { ordenes: {}, ultimo: null }; } catch (e) { return { ordenes: {}, ultimo: null }; } };
  const guardar = (t, d) => { try { localStorage.setItem(KEY(t), JSON.stringify(d)); } catch (e) { /* sin almacenamiento */ } };
  const ahora = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const toast = (m, t) => { if (typeof toastG === 'function') toastG(m, t); };
  let subiendo = false;

  function pendientes() {
    const e = est(); if (!e || !e.tecnico) return [];
    const d = cargar(e.tecnico);
    return (e.ordenes || []).filter((o) => !(d.ordenes[idOT(o)] && d.ordenes[idOT(o)].ok));
  }

  function render() {
    const card = $('envio-estado'); if (!card) return;
    const e = est(); if (!e || !e.tecnico) { card.hidden = true; return; }
    card.hidden = false;
    const d = cargar(e.tecnico), pend = pendientes();
    const enviadas = (e.ordenes || []).length - pend.length;
    let h = '<b>' + pend.length + '</b> pendiente(s) de subir · <b>' + enviadas + '</b> ya subida(s)';
    if (d.ultimo) h += '<br>Último intento: ' + esc(d.ultimo.ts) + ' — ' + d.ultimo.ok + ' correcta(s)' + (d.ultimo.fail ? ', <b style="color:#C0392B">' + d.ultimo.fail + ' con error</b>' : '');
    else h += '<br>Aún no has subido órdenes a Supabase.';
    $('envio-resumen').innerHTML = h;
    const lista = $('envio-errores');
    lista.innerHTML = pend.filter((o) => d.ordenes[idOT(o)] && d.ordenes[idOT(o)].err)
      .map((o) => '<li>OT ' + esc(o.NUMERO_OT) + ' (' + esc(o.SERIE) + '): ' + esc(d.ordenes[idOT(o)].err) + '</li>').join('');
    $('btn-reintentar-ot').hidden = pend.length === 0;
  }

  const cuerpo = (o, tecnico) => ({
    numero_ot: o.NUMERO_OT || '', fecha: o.FECHA || null, serie: o.SERIE || '',
    cliente_nombre: o.RAZON_SOCIAL || '', tipo_ot: o.TIPO_OT || 'PREVENTIVO', estado: o.ESTADO || 'REALIZADO',
    trabajo_realizado: o.TRABAJO_REALIZADO || '',
    observaciones: o.CLASE_VISITA === 'URGENTE' ? '[URGENTE]' : o.CLASE_VISITA === 'NO_PROGRAMADA' ? '[NO PROGRAMADA]' : '',
    clase_visita: o.CLASE_VISITA || null, horas_maquina: o.HORAS_MAQUINA || null,
    gps_lat: o.GPS_LAT || null, gps_lng: o.GPS_LON || null,
    gps_link: (o.GPS_LAT && o.GPS_LON) ? 'https://maps.google.com/?q=' + o.GPS_LAT + ',' + o.GPS_LON : null,
    firma_realiza: tecnico || '', origen: 'CAMPO'
  });

  async function subir() {
    if (subiendo) return;
    const e = est();
    if (!e || !e.tecnico) { toast('Entra con tu nombre primero.', 'err'); return; }
    if (typeof API === 'undefined' || !API.hayNube()) { toast('Configura Supabase primero', 'err'); return; }
    const pend = pendientes();
    if (!pend.length) { toast('No hay OT pendientes de subir', ''); render(); return; }
    const d = cargar(e.tecnico);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      d.ultimo = { ts: ahora(), ok: 0, fail: pend.length };
      pend.forEach((o) => { d.ordenes[idOT(o)] = { ok: false, ts: ahora(), err: 'Sin conexión a internet. Se reintentará cuando haya señal.' }; });
      guardar(e.tecnico, d); render(); toast('📴 Sin internet: las OT siguen pendientes', 'err'); return;
    }
    subiendo = true; const btn = $('btn-reintentar-ot'); if (btn) btn.disabled = true;
    toast('📤 Subiendo ' + pend.length + ' OT a Supabase…', 'ok');
    let ok = 0, fail = 0;
    for (const o of pend) {
      const k = idOT(o);
      try {
        const ya = await API.select('ordenes', { numero_ot: o.NUMERO_OT || '', serie: o.SERIE || '', origen: 'CAMPO' });
        if (!(ya && ya.length)) await API.insert('ordenes', cuerpo(o, e.tecnico));
        d.ordenes[k] = { ok: true, ts: ahora(), nota: (ya && ya.length) ? 'ya existía en la nube' : '' };
        ok++;
      } catch (err) {
        d.ordenes[k] = { ok: false, ts: ahora(), err: String((err && err.message) || err).slice(0, 300) };
        fail++;
      }
    }
    d.ultimo = { ts: ahora(), ok, fail };
    guardar(e.tecnico, d); subiendo = false; if (btn) btn.disabled = false; render();
    toast(fail ? '⚠ Subidas: ' + ok + ' · con error: ' + fail + ' (ver detalle en Inicio)' : '✅ Subidas: ' + ok, fail ? 'err' : 'ok');
  }

  window._prosolSubirPendientes = subir;
  window._prosolRenderEnvio = render;
  document.addEventListener('DOMContentLoaded', () => {
    const b = $('btn-reintentar-ot'); if (b) b.addEventListener('click', subir);
    const hp = $('hero-pend'); if (hp && window.MutationObserver) new MutationObserver(render).observe(hp, { childList: true, characterData: true, subtree: true });
    window.addEventListener('online', render); document.addEventListener('visibilitychange', render);
    render(); setTimeout(render, 1500);
  });
})();
