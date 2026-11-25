/* PROSOL Campo · lib/aprobacion.js (v3.92)
   Aprobación y liberación de visitas por día, en el celular y en la web de PC:
   · Administrador o supervisor: botón «📝 Por aprobar (N)», aviso en pantalla de cada nueva solicitud,
     revisión de cada visita (técnico, hora sugerida, tareas/observación, novedad para el técnico, «Revisada / aprobada»)
     y «🔓 Liberar día» cuando todas están revisadas. Constancia imprimible (o PDF) con quién solicitó y quién aprobó.
   · Programadas: marca «⏳ Pendiente de aprobación»; en las liberadas muestra la «📌 Novedad» para el técnico.
   · El técnico no recibe visitas pendientes (lo filtra la nube). Módulo fuera del IIFE base. */
const APROBACION = (() => {
  const LS_VISTAS = 'prosol_aprob_solicitudes_vistas';
  let puede = false, pend = [], novedades = [], tecnicos = [], clientes = {}, equipos = {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fh = (s) => { try { return s ? new Date(s).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : ''; } catch (e) { return s || ''; } };
  const corto = (t) => [String(t.nombres || '').trim().split(/\s+/)[0], String(t.apellidos || '').trim().split(/\s+/)[0]].filter(Boolean).join(' ');
  const completo = (t) => ((t.nombres || '') + ' ' + (t.apellidos || '')).trim();
  const etiqueta = (t) => tecnicos.filter((x) => corto(x) === corto(t)).length > 1 ? completo(t) : corto(t);   // corto repetido → completo
  const cortoDe = (full) => { const t = tecnicos.find((x) => completo(x) === full); return t ? etiqueta(t) : (full || ''); };
  const usuario = () => { try { const s = API.sesionNube && API.sesionNube(); return (s && s.usuario) || (window._prosolEstado || {}).tecnico || ''; } catch (e) { return ''; } };
  const dias = () => {
    const m = {};
    pend.forEach((v) => {
      const d = m[v.fecha_programada] = m[v.fecha_programada] || { fecha: v.fecha_programada, vs: [], sol: '', solEn: '' };
      d.vs.push(v); if (v.solicitado_por) { d.sol = v.solicitado_por; d.solEn = v.solicitud_en || d.solEn; }
    });
    return Object.values(m).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  };

  async function cargar() {
    if (typeof API === 'undefined' || !API.hayNube() || !navigator.onLine) { pintarTodo(); return; }
    if (API.sesionNube && !API.sesionNube()) { pintarTodo(); return; }
    try {
      const [p, nv] = await Promise.all([
        API.select('visitas_programadas', { aprobacion: 'PENDIENTE', estado: 'PROGRAMADA' }).catch(() => []),
        API.select('visitas_programadas', { aprobacion: 'LIBERADA', novedad_tecnico: 'neq.' }).catch(() => [])]);
      pend = Array.isArray(p) ? p : []; novedades = Array.isArray(nv) ? nv : [];
      try { puede = !!(await API.rpc('puede_aprobar', {})); } catch (e) { puede = false; }
      if (puede && pend.length) await cargarCatalogos();
    } catch (e) { /* sin red: se mantiene lo último */ }
    pintarTodo();
    if (puede) avisarSolicitudes();
  }
  async function cargarCatalogos() {
    const ids = (k) => [...new Set(pend.map((v) => v[k]).filter(Boolean))];
    const [ts, cs, es] = await Promise.all([
      API.select('tecnicos').catch(() => []),
      ids('id_cliente').length ? API.select('clientes', { id: 'in.(' + ids('id_cliente').join(',') + ')' }).catch(() => []) : [],
      ids('id_equipo').length ? API.select('equipos', { id: 'in.(' + ids('id_equipo').join(',') + ')' }).catch(() => []) : []]);
    tecnicos = (ts || []).filter((t) => String(t.estado || 'ACTIVO').toUpperCase() !== 'ARCHIVADO')
      .sort((a, b) => completo(a).localeCompare(completo(b)));
    clientes = {}; (cs || []).forEach((c) => { clientes[c.id] = c; });
    equipos = {}; (es || []).forEach((e) => { equipos[e.id] = e; });
  }

  // ── Aviso en pantalla de cada nueva solicitud (una vez por solicitud)
  function avisarSolicitudes() {
    let vistas = {}; try { vistas = JSON.parse(localStorage.getItem(LS_VISTAS) || '{}'); } catch (e) {}
    const nuevas = dias().filter((d) => d.sol && vistas[d.fecha] !== d.solEn);
    if (!nuevas.length || document.getElementById('ap-modal')) return;
    const visto = () => {                    // se marca vista al responder (si la página se recarga antes, se vuelve a mostrar)
      nuevas.forEach((d) => { vistas[d.fecha] = d.solEn; });
      try { localStorage.setItem(LS_VISTAS, JSON.stringify(vistas)); } catch (e) {}
    };
    const fondo = modal(`<h3 style="margin:0 0 6px">📝 Solicitud de liberación de visitas</h3>
      ${nuevas.map((d) => `<div style="margin:4px 0">• <b>${esc(d.fecha)}</b>: ${d.vs.length} visita(s) · solicitado por <b>${esc(d.sol)}</b> ${esc(fh(d.solEn))}</div>`).join('')}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn btn-ghost" data-x="luego">Luego</button><button class="btn btn-primary" data-x="ver">Revisar ahora</button></div>`);
    fondo.querySelector('[data-x="luego"]').onclick = () => { visto(); fondo.remove(); };
    fondo.querySelector('[data-x="ver"]').onclick = () => { visto(); fondo.remove(); abrir(nuevas[0].fecha); };
  }

  function modal(html) {
    const fondo = document.createElement('div');
    fondo.id = 'ap-modal';
    fondo.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:10px';
    fondo.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:820px;width:100%;max-height:94vh;overflow:auto;padding:16px;color:#1b2631">${html}</div>`;
    document.body.appendChild(fondo);
    return fondo;
  }

  // ── Revisión del día
  function abrir(fecha) {
    const ds = dias();
    if (!ds.length) { if (typeof toast === 'function') toast('No hay visitas pendientes de aprobación.', 'ok'); return; }
    const d = ds.find((x) => x.fecha === fecha) || ds.find((x) => x.sol) || ds[0];
    const opts = (sel) => '<option value="">— Técnico —</option>' + tecnicos.map((t) =>
      `<option value="${esc(completo(t))}"${completo(t) === sel ? ' selected' : ''}>${esc(etiqueta(t))}</option>`).join('');
    const tarjeta = (v) => {
      const c = clientes[v.id_cliente] || {}, e = equipos[v.id_equipo] || {};
      return `<div data-v="${esc(v.id)}" style="border:1px solid #d5d8dc;border-left:5px solid ${v.revisada ? '#1e8449' : '#d35400'};border-radius:10px;padding:10px;margin:8px 0">
        <div style="font-weight:700">${esc(c.razon_social || '—')}</div>
        <div style="font-size:13px;color:#5d6d7e">Serie ${esc(v.serie || '—')}${e.potencia_kw ? ' · ' + esc(e.potencia_kw) + ' kW' : ''}${e.ubicacion ? ' · ' + esc(e.ubicacion) : ''}
          ${v.contacto_cita || c.contacto ? ' · 👤 ' + esc(v.contacto_cita || c.contacto) : ''}${v.telefono_cita || c.telefono ? ' · 📞 ' + esc(v.telefono_cita || c.telefono) : ''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <select data-f="tec" style="flex:1;min-width:160px">${opts(v.tecnico_asignado || '')}</select>
          <input data-f="hora" placeholder="Hora sugerida (informativa)" value="${esc(v.hora || '')}" style="width:170px"></div>
        <textarea data-f="obs" rows="2" placeholder="Tareas / observación" style="width:100%;margin-top:6px">${esc(v.observacion || '')}</textarea>
        <textarea data-f="nov" rows="2" placeholder="Novedad para el técnico" style="width:100%;margin-top:6px">${esc(v.novedad_tecnico || '')}</textarea>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:8px;flex-wrap:wrap">
          <label style="font-weight:700"><input type="checkbox" data-f="rev"${v.revisada ? ' checked' : ''}> Revisada / aprobada</label>
          <button class="btn btn-primary btn-sm" data-f="guardar">💾 Guardar visita</button></div></div>`;
    };
    const todas = d.vs.every((v) => v.revisada && v.tecnico_asignado);
    const fondo = modal(`<h3 style="margin:0 0 4px">✅ Revisar y liberar visitas</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${ds.map((x) =>
        `<button class="btn ${x.fecha === d.fecha ? 'btn-primary' : 'btn-ghost'} btn-sm" data-dia="${esc(x.fecha)}">${esc(x.fecha)} (${x.vs.length})${x.sol ? ' 📝' : ''}</button>`).join('')}</div>
      <div style="font-size:13px;color:#5d6d7e">${d.sol ? 'Solicitado por <b>' + esc(d.sol) + '</b> ' + esc(fh(d.solEn)) : 'Aún sin solicitud de liberación'}
        · ${d.vs.filter((v) => v.revisada).length} de ${d.vs.length} revisada(s). La hora es solo sugerida: la real es la de atención del técnico.</div>
      ${puede ? '' : '<div style="color:#c0392b;font-weight:700;margin-top:6px">Solo el administrador o el supervisor pueden aprobar.</div>'}
      ${d.vs.map(tarjeta).join('')}
      <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-ghost" data-x="cerrar">Cerrar</button>
        <span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost" data-x="const">🖨 Constancia</button>
        <button class="btn btn-primary" data-x="liberar"${todas && puede ? '' : ' disabled'} title="Se habilita con todas las visitas revisadas y con técnico">🔓 LIBERAR DÍA</button></span></div>`);
    fondo.querySelector('[data-x="cerrar"]').onclick = () => fondo.remove();
    fondo.querySelectorAll('[data-dia]').forEach((b) => { b.onclick = () => { fondo.remove(); abrir(b.dataset.dia); }; });
    fondo.querySelector('[data-x="const"]').onclick = () => constancia(d);
    fondo.querySelectorAll('[data-v]').forEach((card) => {
      const v = d.vs.find((x) => String(x.id) === card.dataset.v);
      const g = (f) => card.querySelector('[data-f="' + f + '"]');
      if (!puede) card.querySelectorAll('select,input,textarea,button').forEach((el) => { el.disabled = true; });
      g('guardar').onclick = async () => {
        const datos = { p_visita: String(v.id), p_tecnico: g('tec').value, p_hora: g('hora').value.trim(),
          p_observacion: g('obs').value.trim(), p_novedad: g('nov').value.trim(), p_revisada: g('rev').checked };
        if (datos.p_revisada && !datos.p_tecnico) { if (typeof toast === 'function') toast('Asigne el técnico antes de marcarla revisada.', 'warn'); return; }
        try {
          g('guardar').disabled = true;
          await API.rpc('visitas_revisar', datos);
          Object.assign(v, { tecnico_asignado: datos.p_tecnico, hora: datos.p_hora, observacion: datos.p_observacion,
            novedad_tecnico: datos.p_novedad, revisada: datos.p_revisada });
          if (typeof toast === 'function') toast('Visita guardada.', 'ok');
          fondo.remove(); abrir(d.fecha);
        } catch (e) { g('guardar').disabled = false; if (typeof toast === 'function') toast('No se pudo guardar: ' + e.message, 'err'); }
      };
    });
    fondo.querySelector('[data-x="liberar"]').onclick = async () => {
      if (!confirm('¿Liberar el día ' + d.fecha + ' (' + d.vs.length + ' visita(s))? Los técnicos las verán y se habilita WhatsApp.')) return;
      try {
        const r = await API.rpc('visitas_liberar', { p_fecha: d.fecha, p_aprobador: usuario(),
          p_filas: d.vs.map((v) => ({ id: String(v.id), tecnico_asignado: v.tecnico_asignado || '', hora: v.hora || '',
            observacion: v.observacion || '', novedad_tecnico: v.novedad_tecnico || '' })) });
        d.vs.forEach((v) => { v.aprobado_por = usuario(); v.aprobado_en = new Date().toISOString(); });
        constancia(d, true);
        pend = pend.filter((v) => v.fecha_programada !== d.fecha);
        fondo.remove(); pintarTodo();
        if (typeof toast === 'function') toast('Día liberado: ' + ((r && r.liberadas) || d.vs.length) + ' visita(s).', 'ok');
      } catch (e) { if (typeof toast === 'function') toast('No se pudo liberar: ' + e.message, 'err'); }
    };
  }

  // ── Constancia imprimible (o «Guardar como PDF»)
  function constancia(d, liberada) {
    const w = window.open('', '_blank'); if (!w) { if (typeof toast === 'function') toast('Permita ventanas emergentes para la constancia.', 'warn'); return; }
    const filas = d.vs.map((v) => { const c = clientes[v.id_cliente] || {}, e = equipos[v.id_equipo] || {};
      return `<tr><td>${esc(v.hora || '')}</td><td>${esc(cortoDe(v.tecnico_asignado))}</td><td>${esc(c.razon_social || '')}</td>
        <td>${esc(v.contacto_cita || c.contacto || '')} ${esc(v.telefono_cita || c.telefono || '')}</td><td>${esc(e.ubicacion || '')}</td>
        <td>${esc(e.potencia_kw ? e.potencia_kw + ' kW' : '')}</td><td>${esc(v.serie || '')}</td><td>${esc(v.observacion || '')}</td><td>${esc(v.novedad_tecnico || '')}</td></tr>`; }).join('');
    const ap = liberada ? usuario() : (d.vs[0] && d.vs[0].aprobado_por) || '';
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Constancia ${esc(d.fecha)}</title>
      <style>body{font-family:Arial,sans-serif;font-size:11px;margin:18px}table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #888;padding:4px;vertical-align:top}th{background:#1b3a57;color:#fff}
      .f{display:flex;justify-content:space-around;margin-top:50px}.f div{text-align:center;width:40%;border-top:1px solid #000;padding-top:4px}
      .pie{margin-top:24px;text-align:center;color:#555}</style></head><body>
      <h2 style="margin:0">PROSOL · Constancia de revisión y liberación de visitas</h2>
      <div>Fecha de las visitas: <b>${esc(d.fecha)}</b> · Solicitado por: <b>${esc(d.sol || '—')}</b> ${esc(fh(d.solEn))}
        · Aprobado por: <b>${esc(ap || '—')}</b> ${liberada ? esc(fh(new Date().toISOString())) : ''}</div><br>
      <table><tr><th>Hora</th><th>Técnico</th><th>Cliente</th><th>Contacto / teléfono</th><th>Ubicación</th><th>Potencia</th><th>Serie</th><th>Observación</th><th>Novedad técnico</th></tr>${filas}</table>
      <div class="f"><div>Solicitado por: ${esc(d.sol || '')}</div><div>Revisado y aprobado por: ${esc(ap || '')}</div></div>
      <div class="pie">Potenciado por ROCKENSY S.A. &amp; MIG — Tec. Master Luis Martínez Ibáñez</div>
      <script>setTimeout(function(){window.print()},300)<\/script></body></html>`);
    w.document.close();
  }

  // ── Botón flotante (celular y PC)
  function pintarBoton() {
    let b = document.getElementById('ap-fab');
    const n = pend.length, sol = dias().some((d) => d.sol);
    if (!puede || !n) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('button'); b.id = 'ap-fab'; b.type = 'button';
      b.style.cssText = 'position:fixed;left:10px;bottom:76px;z-index:9000;border:0;border-radius:22px;padding:10px 14px;color:#fff;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:pointer';
      b.onclick = () => abrir();
      document.body.appendChild(b);
    }
    b.style.background = sol ? '#d35400' : '#b9770e';
    b.textContent = '📝 Por aprobar: ' + n + (sol ? ' · solicitud' : '');
  }

  // ── Programadas: pendiente / novedad para el técnico
  function pintarProgramadas() {
    const l = document.getElementById('lista-prog'); if (!l) return;
    l.querySelectorAll('li.tw-row').forEach((li) => {
      const m = ((li.querySelector('.t2-sub') || {}).textContent || '').match(/Serie\s+(\S+)/);
      const f = ((li.querySelector('.tw-c1') || {}).textContent || '').slice(0, 10);
      if (!m) return;
      const p = pend.find((v) => v.serie === m[1] && v.fecha_programada === f);
      const nv = novedades.find((v) => v.serie === m[1] && v.fecha_programada === f);
      const acc = li.querySelector('.prog-acc');
      let t = li.querySelector('.ap-marca');
      const txt = p ? '⏳ Pendiente de aprobación' : (nv ? '📌 Novedad: ' + nv.novedad_tecnico : '');
      if (!txt) { if (t) t.remove(); return; }
      if (!t) { t = document.createElement('div'); t.className = 'ap-marca'; (acc ? acc.parentNode.insertBefore(t, acc) : li.appendChild(t)); }
      t.style.cssText = 'font-size:13px;font-weight:700;margin-top:4px;color:' + (p ? '#d35400' : '#1b4f72');
      t.textContent = txt;
    });
  }
  function pintarTodo() { try { pintarBoton(); pintarProgramadas(); } catch (e) {} }

  function vigilar() {
    const l = document.getElementById('lista-prog');
    if (l) new MutationObserver(() => pintarProgramadas()).observe(l, { childList: true });
    cargar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilar); else vigilar();
  window.addEventListener('online', cargar);
  setInterval(cargar, 120000);
  setTimeout(cargar, 8000);                // tras el ingreso (la sesión de nube se abre al entrar)
  return { cargar, abrir, pintarTodo, _estado: () => ({ puede, pend, novedades }) };
})();
window.APROBACION = APROBACION;
