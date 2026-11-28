/* PROSOL · lib/visita_adicional.js (v4.06) — «🚨 Visita adicional»: un solo formato en web, celular y escritorio
   (aprobado por Luis 28/11 07:39). La visita no programada (pedido inesperado del cliente / emergencia) se crea como
   visita de Programación: sale en la agenda, en los listados y en «Visitas por aprobar», y la OT del día la cierra.
   · Clase: 🚨 URGENTE o NO PROGRAMADA. Datos: equipo, fecha (hoy), hora, tipo, técnico, N° de OT (opcional, sin repetir),
     contacto, teléfono y motivo. Observación: «VISITA ADICIONAL · 🚨 URGENTE · OT n · motivo».
   · ADMIN o supervisor → queda LIBERADA. Otro usuario o el técnico → PENDIENTE de aprobación, pero el técnico la
     atiende y abre la OT igual (la nube verifica quién puede liberar).
   · Web: botón en Programación. Celular: «Hoy › Nueva visita» (No programada / 🚨 Urgente) agrega N° de OT, contacto y
     teléfono, y además de abrir la OT crea la visita en Programación (sin internet queda en cola y se envía sola).
   Módulo fuera del IIFE base. */
(() => {
  const PREFIJO = 'VISITA ADICIONAL';
  const pad = (x) => String(x).padStart(2, '0');
  const hoy = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const ahoraHM = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function observacion(clase, ot, motivo) {
    const p = [PREFIJO + ' · ' + (clase === 'URGENTE' ? 'URGENTE' : 'NO PROGRAMADA')];
    if (String(ot || '').trim()) p.push('OT ' + String(ot).trim());
    if (String(motivo || '').trim()) p.push(String(motivo).trim());
    return p.join(' · ');
  }
  async function otRepetida(ot) {
    ot = String(ot || '').trim(); if (!ot) return false;
    try { return (await API.select('ordenes', { numero_ot: ot })).length > 0; } catch (e) { return false; }
  }
  async function puedeLiberar() { try { return !!(await API.rpc('puede_aprobar', {})); } catch (e) { return false; } }
  /** d: {id_equipo, serie, id_cliente, clase, fecha, hora, tipo, tecnico, ot, contacto, telefono, motivo, usuario} */
  async function crearEnNube(d, opt) {
    opt = opt || {};
    if (!d.id_equipo && !d.serie) throw new Error('Elija el equipo.');
    if (!String(d.tecnico || '').trim()) throw new Error('Elija el técnico que atiende.');
    if (String(d.motivo || '').trim().length < 3) throw new Error('Escriba el motivo de la visita.');
    if (!opt.sinValidarOT && await otRepetida(d.ot)) throw new Error('La OT N° ' + d.ot + ' ya está registrada; use otro número o déjelo vacío.');
    const libera = await puedeLiberar(), ts = new Date().toISOString();
    const row = {
      id: (API.uuid ? API.uuid() : (crypto.randomUUID ? crypto.randomUUID() : undefined)),
      id_equipo: d.id_equipo || null, serie: d.serie || '', id_cliente: d.id_cliente || null,
      fecha_programada: d.fecha || hoy(), hora: d.hora || '', tipo_mantenimiento: d.tipo || 'MANTENIMIENTO PREVENTIVO',
      observacion: observacion(d.clase, d.ot, d.motivo), estado: 'PROGRAMADA',
      contacto_cita: d.contacto || '', telefono_cita: d.telefono || '', tecnico_asignado: d.tecnico,
      registrado_por: d.usuario || '', fecha_registro: ts.slice(0, 16).replace('T', ' '),
      solicitado_por: d.usuario || '', solicitud_en: ts, rev_en: ts,
      aprobacion: libera ? 'LIBERADA' : 'PENDIENTE', revisada: !!libera,
      aprobado_por: libera ? (d.usuario || '') : null, aprobado_en: libera ? ts : null,
    };
    if (!row.id) delete row.id;
    await API.insertMin('visitas_programadas', row);
    return { libera, row };
  }

  // ── Web: formulario ────────────────────────────────────────────────
  async function abrirWeb(alTerminar) {
    const U = PROSOL_WEB.util;
    const [eqs, clis, tecs, acts] = await Promise.all(['equipos', 'clientes', 'tecnicos', 'actividades'].map((t) => API.select(t).catch(() => [])));
    const C = {}; clis.forEach((c) => { C[c.id] = c; });
    const lista = eqs.filter((e) => e.serie && (e.estado || 'ACTIVO') !== 'ARCHIVADO')
      .map((e) => ({ e, k: e.serie + ' · ' + ((C[e.id_cliente] || {}).razon_social || '') }));
    const tl = tecs.filter((t) => (t.estado || 'ACTIVO') !== 'ARCHIVADO').map((t) => ((t.nombres || '') + ' ' + (t.apellidos || '')).trim()).sort();
    const tipos = ['MANTENIMIENTO PREVENTIVO', 'VISITA TECNICA', 'VISITA EXPRESS', 'VISITA EXPRESS + CAMBIO DE ACEITE', 'ARRANQUE INICIAL']
      .concat(acts.filter((a) => (a.estado || 'ACTIVO') === 'ACTIVO' && String(a.tipo || '').toUpperCase() === 'COMBO').map((a) => a.descripcion))
      .filter((x, i, a) => x && a.indexOf(x) === i);
    const libera = await puedeLiberar();
    U.modal(`<h3>🚨 Visita adicional</h3>
      <p style="font-size:12px;margin:0 0 8px;color:${libera ? '#1E8449' : '#B9770E'}">${libera ? 'Usted es administrador/supervisor: la visita queda LIBERADA al guardar.' : 'Queda PENDIENTE de aprobación (supervisor o administrador); el técnico la atiende y abre la OT igual.'}</p>
      <div style="display:grid;grid-template-columns:150px 1fr;gap:6px 10px;align-items:center;font-size:13px">
        <span>Equipo (serie o cliente)</span><span><input class="inp-web" id="vaEq" list="vaEqL" placeholder="Escriba serie o cliente" style="width:100%"><datalist id="vaEqL">${lista.map((x) => `<option value="${escH(x.k)}">`).join('')}</datalist></span>
        <span>Clase</span><span><label><input type="radio" name="vaCl" value="URGENTE" checked> 🚨 Urgente (emergencia)</label> &nbsp; <label><input type="radio" name="vaCl" value="NO PROGRAMADA"> No programada</label></span>
        <span>Fecha</span><span><input class="inp-web" type="date" id="vaF" value="${hoy()}"> Hora <input class="inp-web" id="vaH" value="${ahoraHM()}" style="width:80px"></span>
        <span>Tipo de trabajo</span><span><input class="inp-web" id="vaT" list="vaTL" value="${escH(tipos[0])}" style="width:100%"><datalist id="vaTL">${tipos.map((t) => `<option value="${escH(t)}">`).join('')}</datalist></span>
        <span>Técnico que atiende</span><span><select class="inp-web" id="vaTec"><option value="">— elegir —</option>${tl.map((t) => `<option>${escH(t)}</option>`).join('')}</select></span>
        <span>N° de OT (opcional)</span><span><input class="inp-web" id="vaOT" style="width:120px"></span>
        <span>Contacto</span><span><input class="inp-web" id="vaCo" style="width:60%"> Tel. <input class="inp-web" id="vaTel" style="width:30%"></span>
        <span>Motivo</span><span><textarea class="inp-web" id="vaM" rows="3" style="width:100%" placeholder="Lo que pidió el cliente / la falla"></textarea></span>
      </div><p id="vaErr" style="color:#C0392B;font-size:12px;min-height:16px"></p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn-web sec" id="vaX">Cancelar</button><button class="btn-web" style="background:#C0392B;color:#fff" id="vaOk">✔ Registrar visita adicional</button></div>`);
    const $ = U.$id, eqDe = () => (lista.find((x) => x.k === $('vaEq').value.trim()) || {}).e;
    $('vaEq').onchange = () => { const e = eqDe(); if (!e) return; const c = C[e.id_cliente] || {};
      if (!$('vaCo').value) $('vaCo').value = e.contacto || c.contacto || ''; if (!$('vaTel').value) $('vaTel').value = e.contacto_tel || c.telefono || ''; };
    $('vaX').onclick = U.cerrarModal;
    $('vaOk').onclick = async () => {
      const e = eqDe(); if (!e) { $('vaErr').textContent = 'Elija el equipo de la lista.'; return; }
      $('vaOk').disabled = true; $('vaErr').textContent = '';
      try {
        const u = (typeof AUTH !== 'undefined' && AUTH.sesion && AUTH.sesion()) || {};
        const r = await crearEnNube({ id_equipo: e.id, serie: e.serie, id_cliente: e.id_cliente,
          clase: (document.querySelector('input[name="vaCl"]:checked') || {}).value, fecha: $('vaF').value, hora: $('vaH').value.trim(),
          tipo: $('vaT').value.trim(), tecnico: $('vaTec').value, ot: $('vaOT').value, contacto: $('vaCo').value.trim(),
          telefono: $('vaTel').value.trim(), motivo: $('vaM').value, usuario: u.nombre || u.usuario || 'web' });
        U.cerrarModal(); U.toast('✅ Visita adicional registrada (' + (r.libera ? 'liberada' : 'pendiente de aprobación') + ')');
        if (alTerminar) alTerminar();
      } catch (ex) { $('vaErr').textContent = ex.message || String(ex); $('vaOk').disabled = false; }
    };
  }

  // ── Celular: «Hoy › Nueva visita» crea también la visita en Programación ──
  const COLA = 'prosol_va_cola';
  const leerCola = () => { try { return JSON.parse(localStorage.getItem(COLA) || '[]'); } catch (e) { return []; } };
  const guardarCola = (c) => { try { localStorage.setItem(COLA, JSON.stringify(c)); } catch (e) { /* lleno */ } };
  let enviando = false;
  async function enviarCola() {
    if (enviando || typeof API === 'undefined' || !API.hayNube() || navigator.onLine === false) return;
    enviando = true;
    try {
      let c = leerCola();
      for (const d of c.slice()) {
        try { await crearEnNube(d, { sinValidarOT: true }); c = c.filter((x) => x._k !== d._k); guardarCola(c); }
        catch (ex) { if (/motivo|equipo|técnico/i.test(String(ex.message))) { c = c.filter((x) => x._k !== d._k); guardarCola(c); } else break; }
      }
    } finally { enviando = false; }
  }
  function camposMovil() {
    const scr = document.querySelector('[data-screen="nueva-visita"]'), mot = document.getElementById('nv-motivo');
    if (!scr || !mot || document.getElementById('nv-ot')) return;
    const div = document.createElement('div');
    div.innerHTML = `<label class="field"><span class="field-label">N° de OT (opcional)</span><input id="nv-ot" type="text" inputmode="numeric" placeholder="Ej. 2598"></label>
      <label class="field"><span class="field-label">Contacto en sitio</span><input id="nv-contacto" type="text" placeholder="Nombre"></label>
      <label class="field"><span class="field-label">Teléfono del contacto</span><input id="nv-telefono" type="tel" placeholder="09…"></label>
      <p class="hint" style="margin:2px 0 8px">Queda en Programación como «VISITA ADICIONAL». Si no eres supervisor, la oficina la aprueba después; tú la atiendes y llenas la OT igual.</p>`;
    mot.closest('label').after(div);
  }
  function alCrearMovil() {
    const E = window._prosolEstado || {}, e = E._nvEquipo, mot = (document.getElementById('nv-motivo') || {}).value || '';
    if (!e || !e.SERIE || mot.trim().length < 3 || !E.tecnico) return;          // la validación base avisa al usuario
    const clase = ((document.querySelector('input[name="nv-clase"]:checked') || {}).value === 'URGENTE') ? 'URGENTE' : 'NO PROGRAMADA';
    const cat = E.catalogo || {}, cli = (cat.clientes || []).find((c) => c.ID_CLIENTE === e.ID_CLIENTE) || {};
    const d = { _k: Date.now() + '-' + Math.random().toString(36).slice(2, 7), id_equipo: e.ID_SB || null, serie: e.SERIE,
      id_cliente: cli.ID_SB || null, clase, fecha: hoy(), hora: ahoraHM(), tipo: (document.getElementById('nv-tipo') || {}).value || '',
      tecnico: E.tecnico, ot: (document.getElementById('nv-ot') || {}).value || '', contacto: (document.getElementById('nv-contacto') || {}).value || '',
      telefono: (document.getElementById('nv-telefono') || {}).value || '', motivo: mot, usuario: E.tecnico };
    guardarCola(leerCola().concat([d]));
    setTimeout(enviarCola, 300);
  }
  function iniciarMovil() {
    camposMovil();
    document.addEventListener('click', (ev) => { if (ev.target && ev.target.closest && ev.target.closest('#btn-nv-crear')) alCrearMovil(); }, true);
    window.addEventListener('online', enviarCola);
    setInterval(enviarCola, 60000); setTimeout(enviarCola, 5000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarMovil); else iniciarMovil();
  window.PROSOL_VA = { abrirWeb, crearEnNube, observacion, enviarCola, leerCola, PREFIJO };
})();
