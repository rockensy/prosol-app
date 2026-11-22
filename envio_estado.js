/* envio_estado.js · PROSOL Campo · envío de órdenes a OFICINA por la nube (Supabase).
   v3.46: la orden se envía COMPLETA y SOLA (cabecera + actividades + técnico + fotos + firma):
   - al guardarla, al entrar, al volver internet y al regresar a la app; también con «Enviar a oficina ahora».
   - Cada OT queda rastreada (✅ en oficina / ⏳ pendiente / ⚠ error con el motivo), por técnico.
   - Fuente: el historial del técnico (antes solo miraba las órdenes sin empaquetar: al crear el ZIP
     la lista quedaba vacía y la OT ya no se podía subir).
   - No duplica: si la OT (N° + serie, origen CAMPO) ya está en la nube, solo completa lo que le falte.
   - Sin internet no se pierde nada: queda pendiente y se reintenta sola.
   Va FUERA del IIFE de app.js: usa window._prosolEstado y API (lib/api.js). */
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
  const hayNube = () => typeof API !== 'undefined' && API.hayNube();
  let subiendo = null;

  // Todas las órdenes del técnico (historial + las aún no empaquetadas), sin repetir
  function fuente() {
    const e = est(); if (!e || !e.tecnico) return [];
    const vistos = new Set(), out = [];
    (e.historial || []).concat(e.ordenes || []).forEach((o) => { const k = idOT(o); if (!vistos.has(k)) { vistos.add(k); out.push(o); } });
    return out;
  }
  function estadoDe(o) {
    const e = est(); if (!e || !e.tecnico || !o) return { cod: 'pend', txt: '⏳ por enviar a oficina' };
    const r = cargar(e.tecnico).ordenes[idOT(o)];
    if (r && r.ok) return { cod: 'ok', txt: '☁ en oficina', ts: r.ts, nota: r.nota || '' };
    if (r && r.err) return { cod: 'err', txt: '⚠ no se envió', err: r.err, ts: r.ts };
    return { cod: 'pend', txt: '⏳ por enviar a oficina' };
  }
  function pendientes() { return fuente().filter((o) => estadoDe(o).cod !== 'ok'); }

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

  // Sube una OT completa; si ya existe en la nube solo agrega lo que falte (reintento seguro)
  async function subirUna(o, tecnico) {
    const ya = await API.select('ordenes', { numero_ot: o.NUMERO_OT || '', serie: o.SERIE || '', origen: 'CAMPO' });
    let id = ya && ya.length ? ya[0].id : null, nota = id ? 'ya estaba en la nube; se completó' : '';
    if (!id) { const r = await API.insert('ordenes', cuerpo(o, tecnico)); id = r && r.id; }
    if (!id) throw new Error('La nube no devolvió el id de la orden');
    const acts = (o.ACTIVIDADES || []).filter((a) => a && a.DESCRIPCION);
    if (acts.length) {
      const hay = await API.select('ot_actividades', { id_orden: id });
      if (!(hay && hay.length)) {
        for (const a of acts) {
          await API.insert('ot_actividades', { id_orden: id, descripcion: a.DESCRIPCION, cantidad: a.CANTIDAD || 1, valor: a.VALOR || 0, nivel: a.NIVEL || 'rubro' });
        }
      }
    }
    const tec = await API.select('ot_tecnicos', { id_orden: id });
    if (!(tec && tec.length) && tecnico) await API.insert('ot_tecnicos', { id_orden: id, nombre_tecnico: tecnico });
    const fotos = o._fotos || [];
    let nFotos = 0;
    if (fotos.length) {
      const subidas = new Set(((await API.select('ot_fotos', { id_orden: id })) || []).map((f) => f.nombre_archivo));
      for (const f of fotos) {
        if (!f || !f.dataUrl || subidas.has(f.nombre)) continue;
        // v3.51: la foto va al almacenamiento y en la base queda solo el enlace.
        // Si el almacenamiento no responde, se guarda como antes (dentro de la base) para no perder la foto.
        let enlace = f.dataUrl;
        try { enlace = await API.subirFoto('ot/' + id + '/' + (f.nombre || ('foto_' + nFotos + '.jpg')), f.dataUrl); }
        catch (e) { nota = (nota ? nota + '; ' : '') + 'foto ' + (f.nombre || '') + ' guardada sin almacenamiento (' + e.message + ')'; }
        await API.insert('ot_fotos', { id_orden: id, tipo: /_firma\./i.test(f.nombre || '') ? 'FIRMA' : 'EVIDENCIA',
          nombre_archivo: f.nombre, data_url: enlace, descripcion: 'OT ' + (o.NUMERO_OT || '') });
        nFotos++;
      }
    } else if (o._fotosLiberadas) nota = (nota ? nota + '; ' : '') + 'fotos ya liberadas en el celular (más de 15 días)';
    return { id, nota, nFotos };
  }

  // opts.silencioso: sin avisos salvo que algo se haya enviado o fallado
  function subir(opts) {
    if (subiendo) return subiendo;
    subiendo = _subir(opts || {}).finally(() => { subiendo = null; });
    return subiendo;
  }
  async function _subir(opts) {
    const sil = !!opts.silencioso;
    const e = est();
    if (!e || !e.tecnico) { if (!sil) toast('Entra con tu nombre primero.', 'err'); return { ok: 0, fail: 0 }; }
    if (!hayNube()) { if (!sil) toast('Configura Supabase primero', 'err'); return { ok: 0, fail: 0, sinNube: true }; }
    const pend = pendientes();
    if (!pend.length) { if (!sil) toast('Todas tus órdenes ya están en oficina ✅', 'ok'); render(); return { ok: 0, fail: 0 }; }
    const d = cargar(e.tecnico);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (!sil) toast('📴 Sin internet: se enviarán solas cuando haya señal', 'err');
      render(); return { ok: 0, fail: pend.length, sinRed: true };
    }
    const btn = $('btn-reintentar-ot'); if (btn) btn.disabled = true;
    if (!sil) toast('☁ Enviando ' + pend.length + ' orden(es) a oficina…', 'ok');
    let ok = 0, fail = 0;
    for (const o of pend) {
      const k = idOT(o);
      try {
        const r = await subirUna(o, e.tecnico);
        d.ordenes[k] = { ok: true, ts: ahora(), id_sb: r.id, nota: r.nota };
        ok++;
      } catch (err) {
        d.ordenes[k] = { ok: false, ts: ahora(), err: String((err && err.message) || err).slice(0, 300) };
        fail++;
      }
      guardar(e.tecnico, d);
    }
    d.ultimo = { ts: ahora(), ok, fail };
    guardar(e.tecnico, d); if (btn) btn.disabled = false;
    if (ok && window._prosolTrasSubir) { try { await window._prosolTrasSubir(); } catch (x) { /* nada */ } }
    render();
    if (!sil || ok || fail) toast(fail ? '⚠ En oficina: ' + ok + ' · sin enviar: ' + fail + ' (se reintenta sola)' : '✅ ' + ok + ' orden(es) enviada(s) a oficina', fail ? 'err' : 'ok');
    return { ok, fail };
  }

  function render() {
    const e = est(); const card = $('envio-estado');
    if (card) {
      if (!e || !e.tecnico) card.hidden = true;
      else {
        card.hidden = false;
        const d = cargar(e.tecnico), pend = pendientes(), todas = fuente();
        let h = '<b>' + pend.length + '</b> pendiente(s) de enviar a oficina · <b>' + (todas.length - pend.length) + '</b> ya en oficina';
        if (d.ultimo) h += '<br>Último envío: ' + esc(d.ultimo.ts) + ' — ' + d.ultimo.ok + ' correcta(s)' + (d.ultimo.fail ? ', <b style="color:#C0392B">' + d.ultimo.fail + ' con error</b>' : '');
        else h += '<br>Las órdenes se envían solas al guardarlas (con internet).';
        $('envio-resumen').innerHTML = h;
        $('envio-errores').innerHTML = pend.filter((o) => estadoDe(o).err)
          .map((o) => '<li>OT ' + esc(o.NUMERO_OT) + ' (' + esc(o.SERIE) + '): ' + esc(estadoDe(o).err) + '</li>').join('');
        $('btn-reintentar-ot').hidden = pend.length === 0;
      }
    }
    // Pantalla «Enviar a oficina»: lista rastreada de órdenes
    const ul = $('nube-lista');
    if (ul && e && e.tecnico) {
      const todas = fuente().slice(0, 40), pend = pendientes();
      $('nube-resumen').innerHTML = !hayNube() ? 'Sin conexión a la nube configurada: usa el respaldo en archivo de abajo.'
        : (pend.length ? '<b>' + pend.length + '</b> orden(es) por enviar. Se envían solas con internet; o tócalo ahora.' : 'Todas tus órdenes están en oficina ✅');
      const b = $('btn-enviar-oficina'); if (b) { b.hidden = !hayNube() || !pend.length; b.textContent = '☁ Enviar a oficina ahora (' + pend.length + ')'; }
      ul.innerHTML = todas.length ? todas.map((o) => {
        const s = estadoDe(o);
        return '<li class="row"><div class="row-main"><div class="row-title">OT ' + esc(o.NUMERO_OT || '—') + ' · ' + esc(o.RAZON_SOCIAL || '') + '</div>' +
          '<div class="row-sub">' + esc(o.FECHA || '') + ' · Serie ' + esc(o.SERIE || '') + (s.err ? ' · ' + esc(s.err) : (s.nota ? ' · ' + esc(s.nota) : '')) + '</div></div>' +
          '<span class="nube-chip nube-' + s.cod + '">' + esc(s.txt) + '</span></li>';
      }).join('') : '<li class="hint">Todavía no has guardado órdenes.</li>';
    }
  }

  window._prosolSubirPendientes = subir;
  window._prosolRenderEnvio = render;
  window._prosolEstadoNube = estadoDe;
  window._prosolPendientesNube = () => pendientes().length;
  const auto = () => { if (est() && est().tecnico && hayNube() && navigator.onLine !== false && pendientes().length) subir({ silencioso: true }); };
  document.addEventListener('DOMContentLoaded', () => {
    const b = $('btn-reintentar-ot'); if (b) b.addEventListener('click', () => subir());
    const b2 = $('btn-enviar-oficina'); if (b2) b2.addEventListener('click', () => subir());
    const hp = $('hero-pend'); if (hp && window.MutationObserver) new MutationObserver(render).observe(hp, { childList: true, characterData: true, subtree: true });
    window.addEventListener('online', () => { render(); auto(); });
    document.addEventListener('visibilitychange', () => { render(); if (document.visibilityState === 'visible') auto(); });
    render(); setTimeout(() => { render(); auto(); }, 1500);
  });
})();
