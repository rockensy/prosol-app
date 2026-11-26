/* PROSOL web PC · lib/web_postventa.js (v3.97 · W3)
   «📥 Novedades y reclamos» — igual que el escritorio (Novedades de campo):
   · Novedades de campo («No se puede realizar» del celular): 📅 Reprogramar (fecha, hora, técnico: la visita vuelve a
     PROGRAMADA y a ⏳ pendiente de aprobación) · ⛔ Cerrar sin reprogramar (motivo) · 📷 Ver fotos · 📍 Ver mapa.
   · Reclamos de clientes: 🛠 En gestión · ✅ Atendido (respuesta que el cliente ve en su enlace).
   · Conformidades por enlace.
   Gestionan ADMIN y OPERADOR; los demás consultan. Contador de pendientes en el menú. Módulo fuera del IIFE base. */
(() => {
  const V = window.PROSOL_WEB_VISTAS = window.PROSOL_WEB_VISTAS || {};
  const U = () => PROSOL_WEB.util;
  const esc = (s) => U().ESC(s);
  const ahora = () => new Date().toISOString();
  function rol() {
    try { const s = API.sesionNube && API.sesionNube(); if (s && s.rol) return String(s.rol).toUpperCase(); } catch (e) {}
    return String((window._prosolSesion || {}).perfil || '').toUpperCase();
  }
  function usuario() {
    try { const s = API.sesionNube && API.sesionNube(); if (s && s.usuario) return s.usuario; } catch (e) {}
    const s = window._prosolSesion || {}; return s.usuario || s.nombre || 'web';
  }
  const gestiona = () => ['ADMIN', 'OPERADOR'].includes(rol());
  const fecha = (x) => String(x || '').replace('T', ' ').slice(0, 16);
  const EST_REC = { PENDIENTE: '⏳ Pendiente', EN_GESTION: '🛠 En gestión', ATENDIDO: '✅ Atendido' };
  const EST_NOV = { PENDIENTE: '⏳ Pendiente', REPROGRAMADA: '📅 Reprogramada', CERRADA: '⛔ Cerrada' };
  let sub = 'nov', turno = 0;

  // ── contador del menú ─────────────────────────────────────────────
  async function contar() {
    if (typeof API === 'undefined' || !API.hayNube()) return 0;
    try {
      const [nv, rc] = await Promise.all([API.select('novedades_campo', { estado: 'PENDIENTE' }).catch(() => []),
        API.select('reclamos_cliente').catch(() => [])]);
      const n = nv.length + rc.filter((r) => (r.estado || 'PENDIENTE') !== 'ATENDIDO').length;
      const b = document.querySelector('#nav button[data-v="novedades"]');
      if (b) { b.textContent = '📥 Novedades y reclamos' + (n ? ' (' + n + ')' : ''); b.style.color = n ? '#F5B041' : ''; }
      return n;
    } catch (e) { return 0; }
  }
  setInterval(contar, 120000);
  const _arranque = setInterval(() => { if (document.querySelector('#nav button[data-v="novedades"]')) { clearInterval(_arranque); contar(); } }, 1500);

  V.novedades = async () => {
    const main = U().$id('main');
    if (!API.hayNube()) { main.innerHTML = '<div class="card"><h2>📥 Novedades y reclamos</h2><p>☁ Sin conexión a la nube. Ve a <b>Configuración</b>.</p></div>'; return; }
    const t = ++turno;
    const b = (k, x) => `<button class="btn-web ${sub === k ? 'prim' : 'sec'}" data-sub="${k}">${x}</button>`;
    main.innerHTML = `<div class="card" id="pvBar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b>📥 Novedades y reclamos</b>
      ${b('nov', '📥 Novedades de campo')}${b('rec', '📣 Reclamos de clientes')}${b('conf', '✍ Conformidades por enlace')}</div>
      <div class="card" id="pvCuerpo">Cargando…</div>`;
    main.querySelectorAll('[data-sub]').forEach((x) => x.onclick = () => { sub = x.dataset.sub; V.novedades(); });
    contar();
    if (sub === 'rec') return reclamos(t);
    if (sub === 'conf') return conformidades(t);
    return novedades(t);
  };
  const vigente = (t) => t === turno && document.getElementById('pvCuerpo');

  // ── Novedades de campo ────────────────────────────────────────────
  async function novedades(t) {
    const [nov, tecs] = await Promise.all([API.select('novedades_campo').catch(() => []), API.select('tecnicos').catch(() => [])]);
    if (!vigente(t)) return;
    const c = U().$id('pvCuerpo');
    c.innerHTML = `<div class="toolbar"><label style="font-size:13px"><input type="checkbox" id="nvSolo" checked> Solo pendientes</label>
      <span id="nvRes" style="font-size:13px;font-weight:700"></span></div>
      <p style="font-size:12px;color:#666;margin:0 0 6px">Lo que el técnico marcó «No se puede realizar» en el celular. Al reprogramar, la visita vuelve a PROGRAMADA (⏳ pendiente de aprobación) y baja sola al escritorio y al celular.</p>
      <div id="nvLista"></div>`;
    const pintar = () => {
      const solo = U().$id('nvSolo').checked;
      const L = nov.filter((n) => !solo || (n.estado || 'PENDIENTE') === 'PENDIENTE').sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
      const pend = nov.filter((n) => (n.estado || 'PENDIENTE') === 'PENDIENTE').length;
      U().$id('nvRes').textContent = pend ? pend + ' pendiente(s)' : 'Sin novedades pendientes';
      U().$id('nvRes').style.color = pend ? '#A93226' : '#1E8449';
      U().$id('nvLista').innerHTML = U().tabla(['Fecha', 'Visita', 'Cliente', 'Serie', 'Técnico', 'Motivo', 'Nota', 'Estado', 'Resolución', ''], L.map((n) => {
        const fotos = Array.isArray(n.fotos) ? n.fotos : [];
        const pendiente = (n.estado || 'PENDIENTE') === 'PENDIENTE';
        return [esc(fecha(n.creado)), esc(n.id_visita || ''), esc(n.cliente || ''), esc(n.serie || ''), esc(n.tecnico || ''), esc(n.motivo || ''),
          esc(n.nota || ''), EST_NOV[n.estado || 'PENDIENTE'] || esc(n.estado), esc(n.resolucion || ''),
          (pendiente && gestiona() ? `<button class="btn-web mini prim" data-rp="${n.id}">📅 Reprogramar</button> <button class="btn-web mini sec" data-cn="${n.id}">⛔ Cerrar</button> ` : '')
          + (fotos.length ? `<button class="btn-web mini sec" data-ft="${n.id}">📷 ${fotos.length}</button> ` : '')
          + (n.gps_lat && n.gps_lng ? `<a class="btn-web mini sec" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${n.gps_lat},${n.gps_lng}">📍 Mapa</a>` : '')];
      }));
      const de = (id) => nov.find((x) => String(x.id) === String(id));
      U().$id('nvLista').querySelectorAll('[data-rp]').forEach((x) => x.onclick = () => reprogramar(de(x.dataset.rp), tecs));
      U().$id('nvLista').querySelectorAll('[data-cn]').forEach((x) => x.onclick = () => cerrarNov(de(x.dataset.cn)));
      U().$id('nvLista').querySelectorAll('[data-ft]').forEach((x) => x.onclick = () => verFotos(de(x.dataset.ft)));
    };
    U().$id('nvSolo').onchange = pintar;
    pintar();
  }
  function reprogramar(n, tecs) {
    const man = new Date(Date.now() + 86400000); const f0 = man.toISOString().slice(0, 10);
    const activos = tecs.filter((x) => x.estado !== 'ARCHIVADO').map((x) => [x.nombres, x.apellidos].filter(Boolean).join(' '));
    U().modal(`<h3>📅 Reprogramar visita ${esc(n.id_visita || '')}</h3>
      <p style="font-size:13px;color:#555;margin:0 0 6px">${esc(n.cliente || '')} · serie ${esc(n.serie || '')}<br>Motivo: ${esc(n.motivo || '')}${n.nota ? ' · ' + esc(n.nota) : ''}</p>
      <div class="grid2"><div><label style="font-size:12px;font-weight:700">Nueva fecha</label><input class="inp-web" id="rpF" type="date" value="${f0}"></div>
        <div><label style="font-size:12px;font-weight:700">Hora</label><input class="inp-web" id="rpH" type="time" value="09:00"></div></div>
      <label style="font-size:12px;font-weight:700;display:block;margin-top:8px">Técnico</label>
      <select class="inp-web" id="rpT"><option value="">— sin cambiar —</option>${activos.map((x) => `<option ${x === n.tecnico ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <div id="rpErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn-web sec" id="rpX">Cancelar</button><button class="btn-web prim" id="rpOk">💾 Guardar</button></div>`);
    U().$id('rpX').onclick = U().cerrarModal;
    U().$id('rpOk').onclick = async () => {
      const f = U().$id('rpF').value, h = U().$id('rpH').value, tec = U().$id('rpT').value;
      if (!f) { U().$id('rpErr').textContent = 'Indique la nueva fecha.'; return; }
      try {
        const vs = n.id_visita ? await API.select('visitas_programadas', { id_escritorio: n.id_visita }).catch(() => []) : [];
        const v = vs[0];
        if (!v) { U().$id('rpErr').textContent = 'La visita ' + (n.id_visita || '—') + ' no existe en la nube; ciérrela o prográmela de nuevo en Programación.'; return; }
        const cambios = { fecha_programada: f, hora: h || '', estado: 'PROGRAMADA',
          observacion: ((v.observacion || '') + '\nReprogramada por novedad de campo: ' + (n.motivo || '')).trim(), actualizado: ahora(), sync_origen: 'WEB' };
        if (tec) cambios.tecnico_asignado = tec;
        await API.update('visitas_programadas', v.id, cambios);
        const texto = 'Reprogramada para ' + f + (h ? ' ' + h : '') + (tec ? ' · ' + tec : '');
        await API.update('novedades_campo', n.id, { estado: 'REPROGRAMADA', resolucion: texto, resuelto_por: usuario(), resuelto_en: ahora() });
        U().toast('✅ ' + texto + ' · ⏳ pendiente de aprobación'); U().cerrarModal(); V.novedades();
      } catch (e) { U().$id('rpErr').textContent = '❌ ' + e.message; }
    };
  }
  function cerrarNov(n) {
    U().modal(`<h3>⛔ Cerrar novedad sin reprogramar</h3>
      <p style="font-size:13px;color:#555;margin:0 0 6px">${esc(n.cliente || '')} · ${esc(n.motivo || '')}</p>
      <label style="font-size:12px;font-weight:700">Motivo del cierre</label><textarea class="inp-web" id="cnM" rows="3"></textarea>
      <div id="cnErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn-web sec" id="cnX">Cancelar</button><button class="btn-web prim" id="cnOk">⛔ Cerrar novedad</button></div>`);
    U().$id('cnX').onclick = U().cerrarModal;
    U().$id('cnOk').onclick = async () => {
      const m = U().$id('cnM').value.trim();
      if (!m) { U().$id('cnErr').textContent = 'Escriba el motivo del cierre.'; return; }
      try { await API.update('novedades_campo', n.id, { estado: 'CERRADA', resolucion: 'Cerrada sin reprogramar: ' + m, resuelto_por: usuario(), resuelto_en: ahora() });
            U().toast('⛔ Novedad cerrada'); U().cerrarModal(); V.novedades(); }
      catch (e) { U().$id('cnErr').textContent = '❌ ' + e.message; }
    };
  }
  function verFotos(n) {
    const fotos = (Array.isArray(n.fotos) ? n.fotos : []).map((f) => (typeof f === 'string' ? f : (f && (f.url || f.ruta)) || '')).filter(Boolean);
    U().modal(`<h3>📷 Fotos · ${esc(n.cliente || n.serie || '')}</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px">${fotos.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" style="width:180px;height:140px;object-fit:cover;border-radius:8px"></a>`).join('') || 'Sin fotos.'}</div>
      <div style="text-align:right;margin-top:10px"><button class="btn-web sec" id="vfX">Cerrar</button></div>`);
    U().$id('vfX').onclick = U().cerrarModal;
  }

  // ── Reclamos de clientes ──────────────────────────────────────────
  async function reclamos(t) {
    const rec = await API.select('reclamos_cliente').catch(() => []);
    if (!vigente(t)) return;
    const c = U().$id('pvCuerpo');
    c.innerHTML = `<div class="toolbar"><label style="font-size:13px"><input type="checkbox" id="rcSolo" checked> Solo abiertos</label>
      <span id="rcRes" style="font-size:13px;font-weight:700"></span></div><div id="rcLista2"></div>`;
    const pintar = () => {
      const solo = U().$id('rcSolo').checked;
      const L = rec.filter((r) => !solo || (r.estado || 'PENDIENTE') !== 'ATENDIDO')
        .sort((a, b) => ((a.estado === 'ATENDIDO') - (b.estado === 'ATENDIDO')) || String(b.creado).localeCompare(String(a.creado)));
      const p = rec.filter((r) => (r.estado || 'PENDIENTE') !== 'ATENDIDO').length;
      U().$id('rcRes').textContent = p ? p + ' reclamo(s) abierto(s) · ' + rec.length + ' en total' : 'Sin reclamos pendientes · ' + rec.length + ' en total';
      U().$id('rcRes').style.color = p ? '#A93226' : '#1E8449';
      U().$id('rcLista2').innerHTML = U().tabla(['Fecha', 'Cliente', 'OT', 'Serie', 'Nombre', 'Contacto', 'Motivo', 'Descripción', 'Estado', 'Respuesta', ''], L.map((r) => [
        esc(fecha(r.creado)), esc(r.cliente || ''), esc(r.numero_ot || ''), esc(r.serie || ''), esc(r.nombre || ''), esc(r.contacto || ''), esc(r.motivo || ''),
        esc(r.descripcion || ''), EST_REC[r.estado || 'PENDIENTE'] || esc(r.estado), esc(r.respuesta || ''),
        (r.estado !== 'ATENDIDO' && gestiona()) ? `<button class="btn-web mini sec" data-g="EN_GESTION" data-id="${r.id}">🛠 En gestión</button> <button class="btn-web mini prim" data-g="ATENDIDO" data-id="${r.id}">✅ Atendido</button>` : '']));
      U().$id('rcLista2').querySelectorAll('[data-g]').forEach((x) => x.onclick = () => gestionar(rec.find((r) => String(r.id) === x.dataset.id), x.dataset.g));
    };
    U().$id('rcSolo').onchange = pintar;
    pintar();
  }
  function gestionar(r, estado) {
    U().modal(`<h3>${estado === 'ATENDIDO' ? '✅ Reclamo atendido' : '🛠 Reclamo en gestión'}</h3>
      <p style="font-size:13px;color:#555;margin:0 0 6px">${esc(r.nombre || '')} · OT ${esc(r.numero_ot || '—')} · ${esc(r.motivo || '')}<br>${esc(r.descripcion || '')}</p>
      <label style="font-size:12px;font-weight:700">Respuesta para el cliente (la verá en su enlace)${estado === 'ATENDIDO' ? '' : ' — opcional'}</label>
      <textarea class="inp-web" id="gsR" rows="3">${esc(r.respuesta || '')}</textarea>
      <div id="gsErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn-web sec" id="gsX">Cancelar</button><button class="btn-web prim" id="gsOk">💾 Guardar</button></div>`);
    U().$id('gsX').onclick = U().cerrarModal;
    U().$id('gsOk').onclick = async () => {
      const resp = U().$id('gsR').value.trim();
      if (estado === 'ATENDIDO' && !resp) { U().$id('gsErr').textContent = 'Para marcar ATENDIDO escriba la respuesta al cliente.'; return; }
      try { await API.update('reclamos_cliente', r.id, { estado, respuesta: resp || r.respuesta || null, atendido_por: usuario(), atendido_en: ahora() });
            U().toast(estado === 'ATENDIDO' ? '✅ Reclamo atendido · el cliente ve la respuesta en su enlace' : '🛠 Reclamo en gestión');
            U().cerrarModal(); V.novedades(); }
      catch (e) { U().$id('gsErr').textContent = '❌ ' + e.message; }
    };
  }

  // ── Conformidades ─────────────────────────────────────────────────
  async function conformidades(t) {
    const cf = await API.select('conformidades_cliente').catch(() => []);
    if (!vigente(t)) return;
    U().$id('pvCuerpo').innerHTML = cf.length ? U().tabla(['Fecha', 'Cliente', 'OT', 'Serie', 'Nombre', 'Conforme', 'Calificación', 'Firma', 'Comentario'],
      cf.sort((a, b) => String(b.creado).localeCompare(String(a.creado))).map((x) => [esc(fecha(x.creado)), esc(x.cliente || ''), esc(x.numero_ot || ''),
        esc(x.serie || ''), esc(x.nombre || ''), x.conforme ? '✅ Sí' : '<span style="color:#A93226">❌ No</span>', x.calificacion ? '★'.repeat(x.calificacion) : '',
        x.firma ? 'Sí' : '', esc(x.comentario || '')])) : '<p>Sin conformidades registradas.</p>';
  }
  V._postventa = { contar };
})();
