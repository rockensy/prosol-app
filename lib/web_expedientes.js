/* PROSOL web PC · lib/web_expedientes.js (v3.99 · W4-5)
   «🗂 Expedientes» (órdenes de servicio) igual que el escritorio:
   · Lista por etapa, «Ver cerrados y anulados», «Solo recontactos para hoy», búsqueda; detalle con documentos,
     repuestos reservados, últimos contactos y bitácora.
   · 📝 Agregar nota · 📞 Contacto · ⏸ Postergar · ▶ Reactivar · ✔ Cerrar expediente · ⛔ Anular · ↺ Reabrir
     (cerrar/anular liberan las reservas activas) · 📦 Reservar repuestos · 🚚 Guía / Bodega (crear guía desde la orden,
     PDF, entregar al técnico = salida de stock + reservas consumidas, registrar devolución y liquidar).
   · ✅ Revisión (solo ADMIN): lista de revisión; aprobar para facturar (la proforma desde la OT la genera el escritorio al
     sincronizar) o solicitar corrección con nota; reenviar a revisión.
   Gestionan ADMIN y OPERADOR. Toda acción queda en la bitácora. La etapa se calcula igual que el escritorio.
   Proforma y factura: W5. Módulo fuera del IIFE base. */
(() => {
  const V = window.PROSOL_WEB_VISTAS = window.PROSOL_WEB_VISTAS || {};
  const U = () => PROSOL_WEB.util;
  const esc = (s) => U().ESC(s);
  const n = (x) => { const v = parseFloat(x); return isFinite(v) ? v : 0; };
  const g = (x) => String(Math.round(n(x) * 10000) / 10000);
  const ISO = () => new Date().toISOString();
  const pad = (x) => String(x).padStart(2, '0');
  const AHORA = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
  const HOY = () => AHORA().slice(0, 10);
  const META = () => ({ actualizado: ISO(), sync_origen: 'WEB' });
  function sesion() { try { return (API.sesionNube && API.sesionNube()) || {}; } catch (e) { return {}; } }
  const rol = () => String(sesion().rol || (window._prosolSesion || {}).perfil || '').toUpperCase();
  const usuario = () => sesion().usuario || (window._prosolSesion || {}).usuario || 'web';
  const nombreUsr = () => (window._prosolSesion || {}).nombre || sesion().nombre || '';
  const gestiona = () => ['ADMIN', 'OPERADOR'].includes(rol());
  const revisa = () => rol() === 'ADMIN';
  const ETAPAS = [['ABIERTO', 'Abierto'], ['PROFORMA', 'Proforma'], ['PROGRAMADO', 'Programado'], ['EN_CAMPO', 'En campo'], ['REALIZADO', 'Realizado'],
    ['CORRECCION', 'Corrección solicitada'], ['APROBADO', 'Aprobado p/ facturar'], ['FACTURADO', 'Facturado'], ['COBRADO', 'Cobrado'], ['CERRADO', 'Cerrado'], ['ANULADO', 'Anulado']];
  const ET = Object.fromEntries(ETAPAS);
  const COLOR = { ABIERTO: '#566573', PROFORMA: '#B9770E', PROGRAMADO: '#2471A3', EN_CAMPO: '#AF601A', REALIZADO: '#117A65', CORRECCION: '#C0392B',
    APROBADO: '#1E8449', FACTURADO: '#6C3483', COBRADO: '#145A32', CERRADO: '#424949', ANULADO: '#922B21' };
  const MEDIOS = ['Llamada', 'WhatsApp', 'Correo', 'Visita'];
  const RESULTADOS = ['Contestó', 'No contestó', 'Acepta el servicio', 'Pide postergar', 'Rechaza el servicio', 'Otro'];
  const EST_RES = { RESERVADA: 'Reservada', CONFIRMADA: 'Confirmada', CONSUMIDA: 'Consumida', LIBERADA: 'Liberada' };
  const EST_GUIA = { EMITIDA: 'Emitida (materiales preparados)', ENTREGADA: 'Entregada al técnico', LIQUIDADA: 'Liquidada (devolución registrada)' };
  const REV = { PENDIENTE: 'Pendiente de revisión', APROBADA: 'Aprobada para facturar', CORRECCION: 'Corrección solicitada' };
  const F = { etapa: 'TODAS', cerr: false, rec: false, txt: '', sel: null };
  let turno = 0, D = null;

  // ── datos ─────────────────────────────────────────────────────────
  async function cargar() {
    const T = ['servicios', 'clientes', 'equipos', 'visitas_programadas', 'proformas', 'ordenes', 'guias', 'facturas', 'inv_reservas', 'repuestos'];
    const R = await Promise.all(T.map((t) => API.select(t).catch(() => [])));
    const d = {}; T.forEach((t, i) => { d[t] = R[i]; });
    const by = (L, k) => { const m = {}; L.forEach((x) => { if (x[k] != null) m[x[k]] = x; }); return m; };
    d.CLI = by(d.clientes, 'id_escritorio'); d.EQ = by(d.equipos, 'id_escritorio'); d.VIS = by(d.visitas_programadas, 'id_escritorio');
    d.PRF = by(d.proformas, 'id_escritorio'); d.OT = by(d.ordenes, 'id_escritorio'); d.GUI = by(d.guias, 'id_escritorio');
    d.FAC = by(d.facturas, 'id_escritorio'); d.REP = by(d.repuestos, 'id_escritorio');
    return d;
  }
  // igual que expedientes.calcular_etapa del escritorio
  function etapaDe(s, d) {
    if (['CERRADO', 'ANULADO'].includes(s.estado)) return s.estado;
    if (s.id_factura) { const f = d.FAC[s.id_factura] || {}; return (n(f.total) > 0 && n(f.saldo) <= 0.005) ? 'COBRADO' : 'FACTURADO'; }
    if (s.id_ot) {
      if (s.revision === 'APROBADA') return 'APROBADO';
      if (s.revision === 'CORRECCION') return 'CORRECCION';
      return String((d.OT[s.id_ot] || {}).estado || '').toUpperCase() === 'REALIZADO' ? 'REALIZADO' : 'EN_CAMPO';
    }
    if (s.id_visita && !['CANCELADA', 'ANULADA'].includes(String((d.VIS[s.id_visita] || {}).estado || '').toUpperCase())) return 'PROGRAMADO';
    if (s.id_proforma) return 'PROFORMA';
    return 'ABIERTO';
  }
  async function evento(s, etapa, detalle) {
    return API.insert('servicio_eventos', Object.assign({ id_servicio: s.id_escritorio, fecha: AHORA(), etapa: etapa === undefined ? s.etapa : etapa,
      detalle, usuario: usuario() }, META()));
  }
  // guarda cambios del expediente, recalcula la etapa y deja el evento «Etapa: A → B» si cambió (como _recalcular)
  // orden del escritorio: cambio → evento de la acción → (reservas) → evento «Etapa: A → B»
  async function guardar(s, cambios, detalle, etapaEv, antes) {
    const previa = s.etapa, et = etapaDe(Object.assign({}, s, cambios), D);
    const c = Object.assign({}, cambios, META());
    if (et !== previa) { c.etapa = et; c.fecha_etapa = AHORA(); }
    await API.update('servicios', s.id, c);
    if (detalle) await evento(s, etapaEv === undefined ? previa : etapaEv, detalle);
    if (antes) await antes();
    if (et !== previa) await evento(s, et, 'Etapa: ' + (ET[previa] || previa || '—') + ' → ' + (ET[et] || et));
    Object.assign(s, c);
  }
  async function movimiento(idRep, tipo, cant, motivo, ref) {
    const r = (await API.select('repuestos', { id_escritorio: idRep }))[0];
    const st = n(r && r.stock), saldo = tipo === 'ENTRADA' ? st + cant : st - cant;
    return API.insert('inv_movimientos', Object.assign({ id_repuesto: idRep, fecha: HOY(), tipo, cantidad: cant, saldo, motivo, referencia: ref || '', fecha_creacion: AHORA() }, META()));
  }
  async function cerrarReserva(s, r, estado, motivo) {
    await API.update('inv_reservas', r.id, Object.assign(estado === 'CONFIRMADA' ? { estado } : { estado, fecha_cierre: AHORA(), motivo_cierre: motivo, usuario_cierre: usuario() }, META()));
    const p = D.REP[r.id_repuesto] || {};
    await evento(s, undefined, 'Reserva ' + r.id_escritorio + ' ' + EST_RES[estado].toLowerCase() + ': ' + g(r.cantidad) + ' × ' + (p.codigo || r.id_repuesto) + (motivo ? ' · ' + motivo : ''));
  }

  // ── vista ─────────────────────────────────────────────────────────
  V.expedientes = async () => {
    const main = U().$id('main');
    if (!API.hayNube()) { main.innerHTML = '<div class="card"><h2>🗂 Expedientes</h2><p>☁ Sin conexión a la nube. Ve a <b>Configuración</b>.</p></div>'; return; }
    const t = ++turno;
    main.innerHTML = '<div class="card">Cargando expedientes…</div>';
    const d = await cargar();
    if (t !== turno) return;
    D = d;
    const hoy = HOY();
    const recHoy = d.servicios.filter((s) => s.estado === 'ABIERTO' && s.recontacto_fecha && s.recontacto_fecha <= hoy).length;
    main.innerHTML = `<div class="card"><div class="toolbar" style="flex-wrap:wrap"><b>🗂 Expedientes</b>
      <label style="font-size:13px">Etapa: <select class="inp-web" id="exEt" style="width:auto"><option value="TODAS">TODAS</option>${ETAPAS.map((e) => `<option value="${e[0]}" ${F.etapa === e[0] ? 'selected' : ''}>${e[1]}</option>`).join('')}</select></label>
      <label style="font-size:13px"><input type="checkbox" id="exCerr" ${F.cerr ? 'checked' : ''}> Ver cerrados y anulados</label>
      <input class="inp-web" id="exTxt" placeholder="Buscar" value="${esc(F.txt)}" style="min-width:200px">
      <span id="exN" style="font-size:13px;font-weight:700;color:#2471A3"></span>
      <label style="font-size:13px"><input type="checkbox" id="exRec" ${F.rec ? 'checked' : ''}> Solo recontactos para hoy</label>
      <span style="font-size:13px;font-weight:700;color:#AF601A">${recHoy ? '📞 Recontactos para hoy: ' + recHoy : ''}</span>
      ${gestiona() ? '' : '<span style="font-size:12px;color:#888">Solo consulta (gestionan ADMIN y OPERADOR)</span>'}</div>
      <div id="exLista"></div></div><div class="card" id="exDet" style="display:none"></div>`;
    const pintar = () => {
      const q = F.txt.trim().toUpperCase();
      const L = d.servicios.filter((s) => (F.cerr || s.estado === 'ABIERTO') && (F.etapa === 'TODAS' || etapaDe(s, d) === F.etapa)
        && (!F.rec || (s.estado === 'ABIERTO' && s.recontacto_fecha && s.recontacto_fecha <= hoy)))
        .map((s) => Object.assign(s, { _et: etapaDe(s, d), _cli: (d.CLI[s.id_cliente] || {}).razon_social || '' }))
        .filter((s) => !q || [s.id_escritorio, s._cli, s.serie, ET[s._et], (d.PRF[s.id_proforma] || {}).numero, (d.OT[s.id_ot] || {}).numero_ot, (d.FAC[s.id_factura] || {}).numero].join(' ').toUpperCase().includes(q))
        .sort((a, b) => String(b.id_escritorio).localeCompare(String(a.id_escritorio)));
      U().$id('exN').textContent = L.length + ' expediente(s)';
      U().$id('exLista').innerHTML = U().tabla(['Expediente', 'Apertura', 'Cliente', 'Serie', 'Etapa', 'Días', 'Recontacto', 'Proforma', 'Visita', 'OT', 'Factura', ''], L.map((s) => {
        const dias = (() => { const f = String(s.fecha_etapa || s.fecha_apertura || '').slice(0, 10); if (!f) return ''; return Math.round((new Date(hoy) - new Date(f)) / 864e5); })();
        return [`<b>${esc(s.id_escritorio)}</b>`, esc(String(s.fecha_apertura || '').slice(0, 10)), esc(s._cli), esc(s.serie || ''),
          `<b style="color:${COLOR[s._et] || '#333'}">${esc(ET[s._et] || s._et)}</b>`, dias,
          s.recontacto_fecha ? (s.recontacto_fecha <= hoy && s.estado === 'ABIERTO' ? '📞 ' : '⏸ ') + esc(s.recontacto_fecha) : '',
          esc((d.PRF[s.id_proforma] || {}).numero || ''), esc((d.VIS[s.id_visita] || {}).fecha_programada || ''), esc((d.OT[s.id_ot] || {}).numero_ot || ''),
          esc((d.FAC[s.id_factura] || {}).numero || ''), `<button class="btn-web mini ${F.sel === s.id_escritorio ? 'prim' : 'sec'}" data-ver="${esc(s.id_escritorio)}">🔍 Ver</button>`];
      }));
      U().$id('exLista').querySelectorAll('[data-ver]').forEach((b) => b.onclick = () => { F.sel = b.dataset.ver; pintar(); detalle(); });
    };
    U().$id('exEt').onchange = (e) => { F.etapa = e.target.value; pintar(); };
    U().$id('exCerr').onchange = (e) => { F.cerr = e.target.checked; pintar(); };
    U().$id('exRec').onchange = (e) => { F.rec = e.target.checked; pintar(); };
    U().$id('exTxt').oninput = (e) => { F.txt = e.target.value; pintar(); };
    pintar();
    if (F.sel && d.servicios.some((s) => s.id_escritorio === F.sel)) detalle();
  };
  const recargar = () => V.expedientes();

  async function detalle() {
    const s = D.servicios.find((x) => x.id_escritorio === F.sel); if (!s) return;
    const box = U().$id('exDet'); box.style.display = ''; box.innerHTML = 'Cargando…';
    const [ev, ct] = await Promise.all([API.select('servicio_eventos', { id_servicio: s.id_escritorio }).catch(() => []),
      API.select('servicio_contactos', { id_servicio: s.id_escritorio }).catch(() => [])]);
    if (F.sel !== s.id_escritorio || !U().$id('exDet')) return;
    const et = etapaDe(s, D), cli = D.CLI[s.id_cliente] || {}, eq = D.EQ[s.id_equipo] || {}, v = D.VIS[s.id_visita];
    const docs = [['Visita programada', v && `${v.fecha_programada || ''} ${v.hora || ''} · ${v.tipo_mantenimiento || ''} · ${v.estado || ''}`],
      ['Proforma', D.PRF[s.id_proforma] && ((p) => `N° ${p.numero || ''} · ${p.fecha || ''} · total ${n(p.total).toFixed(2)} · ${p.estado || ''}`)(D.PRF[s.id_proforma])],
      ['Orden de trabajo', D.OT[s.id_ot] && ((o) => `OT ${o.numero_ot || ''} · ${o.fecha || ''} · ${o.tipo_ot || ''} · ${o.estado || ''}`)(D.OT[s.id_ot])],
      ['Guía de remisión', D.GUI[s.id_guia] && ((x) => `Guía ${x.numero || ''} · ${x.fecha_emision || ''} · ${x.estado || ''}`)(D.GUI[s.id_guia])],
      ['Factura', D.FAC[s.id_factura] && ((f) => `Factura ${f.numero || ''} · ${f.fecha_factura || ''} · total ${n(f.total).toFixed(2)} · saldo ${n(f.saldo).toFixed(2)}`)(D.FAC[s.id_factura])]];
    const res = D.inv_reservas.filter((r) => r.id_servicio === s.id_escritorio);
    const abierto = s.estado === 'ABIERTO', G = gestiona();
    const b = (id, txt, ok, cls) => ok ? `<button class="btn-web ${cls || 'sec'}" id="${id}">${txt}</button>` : '';
    box.innerHTML = `<h3 style="margin:0;color:${COLOR[et]}">${esc(s.id_escritorio)} · ${esc(ET[et] || et)}</h3>
      <div style="font-size:13px;color:#444;line-height:1.5">${esc(cli.razon_social || '')}<br>Serie ${esc(s.serie || '')} · ${esc(eq.modelo || '')} · ${esc(eq.ubicacion || '')}<br>
      Origen: ${esc(s.origen || '')} · ${esc(s.tipo_servicio || '')} · abierto ${esc(s.fecha_apertura || '')} por ${esc(s.usuario || '')}
      ${s.observacion ? '<br>Observación: ' + esc(s.observacion) : ''}
      ${v ? '<br>Orden de servicio ' + esc(v.id_escritorio) + ' · técnico ' + esc(v.tecnico_asignado || '—') : ''}
      ${s.revision ? '<br>Revisión: ' + esc(REV[s.revision] || s.revision) + ' · ' + esc(s.revision_por || '') + ' ' + esc(String(s.revision_en || '').slice(0, 16)) + (s.revision_nota ? ' · ' + esc(s.revision_nota) : '') : ''}
      ${s.recontacto_fecha ? '<br>⏸ Postergado / recontactar el ' + esc(s.recontacto_fecha) + (s.postergado_motivo ? ' · ' + esc(s.postergado_motivo) : '') : ''}
      ${!abierto ? '<br><b>' + esc(s.estado.charAt(0) + s.estado.slice(1).toLowerCase()) + '</b> el ' + esc(String(s.fecha_cierre || '').slice(0, 16)) + ' · motivo: ' + esc(s.motivo_cierre || '') : ''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">
        ${b('xNota', '📝 Agregar nota', G)}${b('xCont', '📞 Contacto', G && abierto)}${b('xPost', '⏸ Postergar', G && abierto)}${b('xReac', '▶ Reactivar', G && abierto && s.recontacto_fecha)}
        ${b('xCerr', '✔ Cerrar expediente', G && abierto)}${b('xAnu', '⛔ Anular', G && abierto)}${b('xReab', '↺ Reabrir', G && !abierto)}
        ${b('xRes', '📦 Reservar repuestos', G && abierto)}${b('xBod', '🚚 Guía / Bodega', G)}${b('xRev', '✅ Revisión', true, 'prim')}</div>
      <h4 style="margin:6px 0">Documentos del servicio</h4>${U().tabla(['Documento', 'Detalle'], docs.map((x) => [esc(x[0]), esc(x[1] || '—')]))}
      <h4 style="margin:6px 0">Repuestos reservados</h4>${res.length ? U().tabla(['Reserva', 'Código', 'Repuesto', 'Cant.', 'Estado'], res.map((r) => [esc(r.id_escritorio), esc((D.REP[r.id_repuesto] || {}).codigo || ''),
        esc((D.REP[r.id_repuesto] || {}).descripcion || r.id_repuesto), g(r.cantidad), EST_RES[r.estado] || esc(r.estado)])) : '<p style="font-size:13px">Sin reservas (solo cuando la orden lleva repuestos)</p>'}
      ${ct.length ? '<h4 style="margin:6px 0">Últimos contactos</h4>' + U().tabla(['Fecha', 'Medio', 'Resultado', 'Nota', 'Recontacto'], ct.sort((a, b2) => String(b2.fecha).localeCompare(String(a.fecha))).slice(0, 6).map((c) => [esc(String(c.fecha || '').slice(0, 16)), esc(c.medio || ''), esc(c.resultado || ''), esc(c.nota || ''), esc(c.recontacto || '')])) : ''}
      <h4 style="margin:6px 0">Bitácora</h4><div style="max-height:320px;overflow:auto">${U().tabla(['Fecha', 'Etapa', 'Detalle', 'Usuario'], ev.sort((a, b2) => String(a.fecha).localeCompare(String(b2.fecha)) || String(a.id_escritorio).localeCompare(String(b2.id_escritorio)))
        .map((e) => [esc(String(e.fecha || '').slice(0, 16)), esc(ET[e.etapa] || e.etapa || ''), esc(e.detalle || ''), esc(e.usuario || '')]))}</div>`;
    const on = (id, fn) => { const x = U().$id(id); if (x) x.onclick = () => fn(s); };
    on('xNota', nota); on('xCont', contacto); on('xPost', postergar); on('xReac', reactivar);
    on('xCerr', (x) => cambiarEstado(x, 'CERRADO')); on('xAnu', (x) => cambiarEstado(x, 'ANULADO')); on('xReab', (x) => cambiarEstado(x, 'ABIERTO'));
    on('xRes', reservar); on('xBod', bodega); on('xRev', revision);
  }
  // diálogo de texto (reemplaza el «pedir texto» del escritorio)
  function pedir(titulo, etiqueta, obligatorio, alAceptar) {
    U().modal(`<h3>${titulo}</h3><label style="font-size:12px;font-weight:700">${etiqueta}</label><textarea class="inp-web" id="ptT" rows="3"></textarea>
      <div id="ptErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="ptX">Cancelar</button><button class="btn-web prim" id="ptOk">✔ Aceptar</button></div>`);
    U().$id('ptX').onclick = U().cerrarModal;
    U().$id('ptOk').onclick = async () => {
      const t = U().$id('ptT').value.trim();
      if (obligatorio && !t) { U().$id('ptErr').textContent = obligatorio; return; }
      U().$id('ptOk').disabled = true;
      try { await alAceptar(t); U().cerrarModal(); recargar(); }
      catch (e) { U().$id('ptOk').disabled = false; U().$id('ptErr').textContent = '❌ ' + e.message; }
    };
  }
  const noAbierto = (s) => { if (s.estado !== 'ABIERTO') { U().toast('El expediente ' + s.id_escritorio + ' está ' + s.estado + '.'); return true; } return false; };
  function nota(s) {
    pedir('📝 Agregar nota · ' + esc(s.id_escritorio), 'Nota para la bitácora:', 'Escriba la nota.', async (t) => {
      await evento(s, s.etapa, 'Nota: ' + t); await API.update('servicios', s.id, META()); U().toast('📝 Nota agregada');
    });
  }
  function fechaOk(f) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f || '') || isNaN(new Date(f))) throw new Error('Fecha no válida (use AAAA-MM-DD): ' + f);
    if (f < HOY()) throw new Error('La fecha de recontacto no puede ser anterior a hoy.');
    return f;
  }
  function contacto(s) {
    if (noAbierto(s)) return;
    U().modal(`<h3>📞 Registrar contacto · ${esc(s.id_escritorio)}</h3>
      <div class="grid2"><div><label style="font-size:12px;font-weight:700">Medio</label><select class="inp-web" id="ctM">${MEDIOS.map((m) => `<option>${m}</option>`).join('')}</select></div>
      <div><label style="font-size:12px;font-weight:700">Resultado</label><select class="inp-web" id="ctR"><option value="">— elegir —</option>${RESULTADOS.map((m) => `<option>${m}</option>`).join('')}</select></div></div>
      <label style="font-size:12px;font-weight:700">Nota</label><input class="inp-web" id="ctN">
      <label style="font-size:12px;font-weight:700">Recontactar el</label><input class="inp-web" id="ctF" type="date" style="width:auto">
      <div id="ctErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="ctX">Cancelar</button><button class="btn-web prim" id="ctOk">💾 Guardar contacto</button></div>`);
    U().$id('ctX').onclick = U().cerrarModal;
    U().$id('ctOk').onclick = async () => {
      const m = U().$id('ctM').value, r = U().$id('ctR').value, no = U().$id('ctN').value.trim(), f = U().$id('ctF').value, err = (x) => { U().$id('ctErr').textContent = x; };
      if (!r) return err('Elija el resultado del contacto.');
      if (r === 'Pide postergar' && !f) return err('Con «Pide postergar» indique la fecha de recontacto.');
      let rec = null;
      try { rec = f ? fechaOk(f) : null; } catch (e) { return err(e.message); }
      U().$id('ctOk').disabled = true;
      try {
        await API.insert('servicio_contactos', Object.assign({ id_servicio: s.id_escritorio, fecha: AHORA(), medio: m, resultado: r, nota: no, recontacto: rec, usuario: usuario() }, META()));
        let txt = 'Contacto (' + m + '): ' + r + (no ? ' · ' + no : '');
        if (rec) { await API.update('servicios', s.id, Object.assign({ recontacto_fecha: rec, postergado_motivo: no || r }, META())); txt += ' · recontactar el ' + rec; }
        else if (r === 'Acepta el servicio') await API.update('servicios', s.id, Object.assign({ recontacto_fecha: null, postergado_motivo: null }, META()));
        else await API.update('servicios', s.id, META());
        await evento(s, s.etapa, txt);
        U().toast('📞 Contacto registrado'); U().cerrarModal(); recargar();
      } catch (e) { U().$id('ctOk').disabled = false; err('❌ ' + e.message); }
    };
  }
  function postergar(s) {
    if (noAbierto(s)) return;
    const f0 = new Date(Date.now() + 30 * 864e5); const def = f0.getFullYear() + '-' + pad(f0.getMonth() + 1) + '-' + pad(f0.getDate());
    U().modal(`<h3>⏸ Postergar servicio · ${esc(s.id_escritorio)}</h3>
      <label style="font-size:12px;font-weight:700">Fecha de recontacto</label><input class="inp-web" id="poF" type="date" value="${def}" style="width:auto">
      <label style="font-size:12px;font-weight:700;display:block">Motivo</label><input class="inp-web" id="poM">
      <div id="poErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="poX">Cancelar</button><button class="btn-web prim" id="poOk">⏸ Postergar</button></div>`);
    U().$id('poX').onclick = U().cerrarModal;
    U().$id('poOk').onclick = async () => {
      const m = U().$id('poM').value.trim(), err = (x) => { U().$id('poErr').textContent = x; };
      if (!m) return err('Escriba el motivo de la postergación.');
      let f; try { f = fechaOk(U().$id('poF').value); } catch (e) { return err(e.message); }
      U().$id('poOk').disabled = true;
      try { await API.update('servicios', s.id, Object.assign({ recontacto_fecha: f, postergado_motivo: m }, META()));
            await evento(s, s.etapa, 'Postergado hasta ' + f + ': ' + m); U().toast('⏸ Postergado hasta ' + f); U().cerrarModal(); recargar(); }
      catch (e) { U().$id('poOk').disabled = false; err('❌ ' + e.message); }
    };
  }
  function reactivar(s) {
    if (noAbierto(s)) return;
    pedir('▶ Quitar postergación · ' + esc(s.id_escritorio), 'Motivo (opcional):', null, async (t) => {
      await API.update('servicios', s.id, Object.assign({ recontacto_fecha: null, postergado_motivo: null }, META()));
      await evento(s, s.etapa, 'Postergación quitada' + (t ? ': ' + t : '')); U().toast('▶ Postergación quitada');
    });
  }
  function cambiarEstado(s, estado) {
    const tit = { CERRADO: '✔ Cerrar', ANULADO: '⛔ Anular', ABIERTO: '↺ Reabrir' }[estado];
    const lab = { CERRADO: 'Motivo del cierre:', ANULADO: 'Motivo de la anulación:', ABIERTO: 'Motivo para reabrir (opcional):' }[estado];
    pedir(tit + ' · ' + esc(s.id_escritorio), lab, estado === 'ABIERTO' ? null : 'Indique el motivo.', async (t) => {
      if (estado === 'ABIERTO') {
        await guardar(s, { estado: 'ABIERTO', fecha_cierre: null }, 'Expediente reabierto' + (t ? ' · ' + t : ''), null);
      } else {
        const txt = estado === 'CERRADO' ? 'cerrado' : 'anulado';
        await guardar(s, { estado, motivo_cierre: t, fecha_cierre: AHORA() }, 'Expediente ' + txt + ' · ' + t, estado, async () => {
          for (const r of D.inv_reservas.filter((r) => r.id_servicio === s.id_escritorio && ['RESERVADA', 'CONFIRMADA'].includes(r.estado)))
            await cerrarReserva(s, r, 'LIBERADA', 'expediente ' + txt);
        });
        F.cerr = true;
      }
      U().toast(tit + ' hecho');
    });
  }
  function reservar(s) {
    if (noAbierto(s)) return;
    const rv = {}; D.inv_reservas.filter((r) => ['RESERVADA', 'CONFIRMADA'].includes(r.estado)).forEach((r) => { rv[r.id_repuesto] = (rv[r.id_repuesto] || 0) + n(r.cantidad); });
    const reps = D.repuestos.filter((r) => (r.estado || 'ACTIVO') === 'ACTIVO' && (r.clase || 'REPUESTO') === 'REPUESTO')
      .map((r) => Object.assign({}, r, { _disp: n(r.stock) - (rv[r.id_escritorio] || 0) })).sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion)));
    U().modal(`<h3>📦 Reservar repuestos · ${esc(s.id_escritorio)}</h3>
      <label style="font-size:12px;font-weight:700">Repuesto</label><select class="inp-web" id="rsR"><option value="">— elegir —</option>${reps.map((r) => `<option value="${esc(r.id_escritorio)}">${esc((r.codigo || '') + ' · ' + (r.descripcion || '') + ' · disponible ' + g(r._disp) + ' ' + (r.unidad || ''))}</option>`).join('')}</select>
      <div class="grid2"><div><label style="font-size:12px;font-weight:700">Cantidad</label><input class="inp-web" id="rsC" type="number" step="any" value="1"></div>
      <div><label style="font-size:12px;font-weight:700">Nota</label><input class="inp-web" id="rsN"></div></div>
      <div id="rsErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="rsX">Cancelar</button><button class="btn-web prim" id="rsOk">📦 Reservar</button></div>`);
    U().$id('rsX').onclick = U().cerrarModal;
    U().$id('rsOk').onclick = async () => {
      const id = U().$id('rsR').value, c = parseFloat(U().$id('rsC').value), err = (x) => { U().$id('rsErr').textContent = x; };
      if (!id) return err('Seleccione el repuesto.');
      if (!(c > 0)) return err('La cantidad debe ser mayor a 0.');
      const r = reps.find((x) => x.id_escritorio === id);
      if (c > r._disp + 1e-9) return err('Disponible insuficiente: hay ' + g(r._disp) + ' ' + (r.unidad || '') + ' disponibles de ' + (r.descripcion || '') + '.');
      U().$id('rsOk').disabled = true;
      try {
        const nw = await API.insert('inv_reservas', Object.assign({ id_servicio: s.id_escritorio, id_repuesto: id, cantidad: c, estado: 'RESERVADA', nota: U().$id('rsN').value.trim(), fecha: AHORA(), usuario: usuario() }, META()));
        await evento(s, s.etapa, 'Reserva ' + ((nw && nw.id_escritorio) || '') + ': ' + g(c) + ' × ' + (r.codigo || '') + ' ' + (r.descripcion || ''));
        U().toast('📦 Reservado'); U().cerrarModal(); recargar();
      } catch (e) { U().$id('rsOk').disabled = false; err('❌ ' + e.message); }
    };
  }

  // ── Guía / Bodega ─────────────────────────────────────────────────
  async function bodega(s) {
    const gu = s.id_guia ? (await API.select('guias', { id_escritorio: s.id_guia }).catch(() => []))[0] : null;
    const its = gu ? (await API.select('guia_items', { id_guia: gu.id_escritorio }).catch(() => [])).filter((i) => !i.borrado) : [];
    const v = D.VIS[s.id_visita];
    const est = gu ? (gu.estado || 'EMITIDA') : null;
    let h = `<h3>🚚 Guía de remisión y bodega · ${esc(s.id_escritorio)}</h3>`;
    if (!gu) {
      h += `<p style="font-size:13px"><b>Sin guía de remisión</b><br>La guía se crea desde la orden de servicio con sus repuestos planificados (quedan reservados hasta la entrega). Si la orden no lleva repuestos no necesita guía.</p>
        ${gestiona() && s.estado === 'ABIERTO' ? `<div class="grid2"><div><label style="font-size:12px;font-weight:700">Transportista</label><input class="inp-web" id="bgT" value="${esc((v || {}).tecnico_asignado || '')}"></div>
        <div><label style="font-size:12px;font-weight:700">Placa</label><input class="inp-web" id="bgP"></div></div>
        <button class="btn-web prim" id="bgCrear" style="margin-top:8px">📄 Crear guía desde la orden</button>` : ''}`;
    } else {
      h += `<p style="font-size:13px"><b>Guía N° ${esc(gu.numero || gu.id_escritorio)} · ${esc(EST_GUIA[est] || est)}</b><br>Destino: ${esc(gu.destino || '—')} · Traslado: ${esc(gu.fecha_traslado || '—')} · Transportista: ${esc(gu.transportista || '—')} ${esc(gu.placa || '')}
        ${gu.entregada_a ? '<br>Entregada a ' + esc(gu.entregada_a) + ' el ' + esc(String(gu.fecha_entrega || '').slice(0, 16)) : ''}
        ${est === 'LIQUIDADA' ? '<br>Liquidada el ' + esc(String(gu.fecha_liquidacion || '').slice(0, 16)) + ' · informe escrito ' + (gu.informe_recibido === 'SI' ? 'recibido' : 'NO recibido') + (gu.obs_liquidacion ? ' · ' + esc(gu.obs_liquidacion) : '') : ''}</p>`
        + U().tabla(['Código', 'Descripción', 'Entregado', 'Devuelto', 'Usado'].concat(est === 'ENTREGADA' && gestiona() ? ['Devuelto (sobrante)'] : []), its.map((i) => [esc(i.codigo || ''), esc(i.descripcion || ''), g(i.cantidad), g(i.devuelto),
          est === 'LIQUIDADA' ? g(n(i.cantidad) - n(i.devuelto)) : '—'].concat(est === 'ENTREGADA' && gestiona() ? [`<input class="inp-web" type="number" step="any" data-dev="${i.id}" value="0" style="width:80px">`] : [])))
        + `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px"><button class="btn-web sec" id="bgPdf">📄 PDF de la guía</button>
          ${est === 'EMITIDA' && gestiona() ? `<label style="font-size:13px">Entregar a: <input class="inp-web" id="bgA" value="${esc(gu.transportista || '')}" style="width:220px"></label><button class="btn-web prim" id="bgEnt">🚚 Entregar al técnico</button>` : ''}
          ${est === 'ENTREGADA' && gestiona() ? `<label style="font-size:13px"><input type="checkbox" id="bgInf"> Informe escrito recibido</label><input class="inp-web" id="bgObs" placeholder="Observación" style="width:240px"><button class="btn-web prim" id="bgLiq">✔ Registrar devolución y liquidar</button>` : ''}</div>`;
    }
    U().modal(h + `<div id="bgErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div><div style="text-align:right"><button class="btn-web sec" id="bgX">Cerrar</button></div>`);
    U().$id('bgX').onclick = U().cerrarModal;
    const err = (x) => { U().$id('bgErr').textContent = x; };
    const fin = (msg) => { U().toast(msg); U().cerrarModal(); recargar(); };
    const x = (id, fn) => { const e = U().$id(id); if (e) e.onclick = async () => { e.disabled = true; try { await fn(); } catch (ex) { e.disabled = false; err('❌ ' + ex.message); } }; };
    x('bgPdf', async () => { const c = D.CLI[gu.id_cliente] || {};
      const w = window.open('', '_blank'); if (!w) { err('Permita las ventanas emergentes.'); return; }
      w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Guía ${esc(gu.numero || '')}</title><style>body{font-family:Arial;font-size:11px;margin:18px}table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border:1px solid #AAB7B8;padding:4px}th{background:#1C2733;color:#fff}.pie{margin-top:18px;font-size:9px;text-align:center;color:#566573}</style></head><body>
        <h2>Guía de remisión N° ${esc(gu.numero || gu.id_escritorio)}</h2><p>Cliente: ${esc(c.razon_social || '')} · ${esc(c.identificacion || '')}<br>Serie: ${esc(gu.serie || '')} · Emisión: ${esc(gu.fecha_emision || '')} · Traslado: ${esc(gu.fecha_traslado || '')}<br>Motivo: ${esc(gu.motivo || '')}<br>Partida: ${esc(gu.partida || '')} · Destino: ${esc(gu.destino || '')}<br>Transportista: ${esc(gu.transportista || '')} ${esc(gu.placa || '')}<br>${esc(gu.observacion || '')}</p>
        <table><tr><th>Código</th><th>Descripción</th><th>Unidad</th><th>Cantidad</th></tr>${its.map((i) => `<tr><td>${esc(i.codigo || '')}</td><td>${esc(i.descripcion || '')}</td><td>${esc(i.unidad || '')}</td><td>${g(i.cantidad)}</td></tr>`).join('')}</table>
        <p style="margin-top:40px">____________________ Entregado por &nbsp;&nbsp;&nbsp;&nbsp; ____________________ Recibido por</p><div class="pie">Potenciado por ROCKENSY S.A. &amp; MIG — Tec. Master Luis Martínez Ibáñez</div><script>setTimeout(function(){window.print()},400)<\/script></body></html>`);
      w.document.close(); U().$id('bgPdf').disabled = false; });
    x('bgCrear', async () => {
      if (!v) { err('Primero guarde la orden de servicio (en el escritorio).'); U().$id('bgCrear').disabled = false; return; }
      const reps = (await API.select('visita_repuestos', { id_visita: v.id_escritorio }).catch(() => []));
      if (!reps.length) { err('La orden no lleva repuestos: no necesita guía de materiales.'); U().$id('bgCrear').disabled = false; return; }
      const todas = await API.select('guias').catch(() => []);
      const num = String(todas.map((y) => String(y.numero || '').trim()).filter((y) => /^\d+$/.test(y)).reduce((m, y) => Math.max(m, parseInt(y, 10)), 0) + 1);
      const eq = D.EQ[s.id_equipo] || {}, cl = D.CLI[s.id_cliente] || {};
      const nw = await API.insert('guias', Object.assign({ numero: num, id_cliente: s.id_cliente, serie: v.serie || s.serie, fecha_emision: HOY(), fecha_traslado: v.fecha_programada || HOY(),
        motivo: 'Traslado para mantenimiento', partida: 'Bodega PROSOL', destino: [eq.ubicacion, cl.ciudad, cl.zona, cl.direccion].filter(Boolean).join(' · '),
        transportista: U().$id('bgT').value.trim() || v.tecnico_asignado || '', placa: U().$id('bgP').value.trim(),
        observacion: 'Orden de servicio ' + v.id_escritorio + ' · expediente ' + s.id_escritorio, estado: 'EMITIDA', descontado: 'NO', fecha_creacion: AHORA() }, META()));
      for (const r of reps) await API.insert('guia_items', Object.assign({ id_guia: nw.id_escritorio, id_repuesto: r.id_repuesto, codigo: r.codigo, descripcion: r.descripcion, unidad: r.unidad,
        cantidad: n(r.cantidad), id_reserva: r.id_reserva || null, devuelto: 0, borrado: false, fecha_creacion: AHORA() }, META()));
      await API.update('servicios', s.id, Object.assign({ id_guia: nw.id_escritorio }, META()));
      await evento(s, s.etapa, 'Guía de remisión ' + num + ' vinculada');
      fin('📄 Guía ' + num + ' creada desde la orden');
    });
    x('bgEnt', async () => {
      const a = U().$id('bgA').value.trim();
      if (!a) { err('Indique a quién se entregan los materiales.'); U().$id('bgEnt').disabled = false; return; }
      const faltan = [];
      for (const i of its) if (i.id_repuesto) { const r = (await API.select('repuestos', { id_escritorio: i.id_repuesto }))[0]; if (!r || n(r.stock) + 1e-9 < n(i.cantidad)) faltan.push((i.codigo || i.id_repuesto) + ' (stock ' + g(r && r.stock) + ', guía ' + g(i.cantidad) + ')'); }
      if (faltan.length) { err('Stock insuficiente para entregar: ' + faltan.join(', ')); U().$id('bgEnt').disabled = false; return; }
      const num = gu.numero || gu.id_escritorio;
      if (gu.descontado !== 'SI') for (const i of its) if (i.id_repuesto) await movimiento(i.id_repuesto, 'SALIDA', n(i.cantidad), 'Entrega guía ' + num + ' a ' + a, num);
      await API.update('guias', gu.id, Object.assign({ estado: 'ENTREGADA', descontado: 'SI', entregada_a: a, fecha_entrega: AHORA() }, META()));
      let k = 0;
      for (const i of its) if (i.id_reserva) { const r = D.inv_reservas.find((y) => y.id_escritorio === i.id_reserva); if (r && ['RESERVADA', 'CONFIRMADA'].includes(r.estado)) { await cerrarReserva(s, r, 'CONSUMIDA', 'entregada en guía ' + num); k++; } }
      await evento(s, s.etapa, 'Guía ' + num + ' entregada a ' + a + ' · salida de stock · ' + k + ' reserva(s) consumida(s)');
      fin('🚚 Guía entregada a ' + a);
    });
    x('bgLiq', async () => {
      const dev = {}; let mal = '';
      document.querySelectorAll('[data-dev]').forEach((e) => { const i = its.find((y) => String(y.id) === e.dataset.dev), c = parseFloat(e.value || '0');
        if (!isFinite(c) || c < 0 || c > n(i.cantidad) + 1e-9) mal = 'Devolución de ' + (i.codigo || '') + ' fuera de rango (0 a ' + g(i.cantidad) + ').'; dev[i.id] = c; });
      if (mal) { err(mal); U().$id('bgLiq').disabled = false; return; }
      const num = gu.numero || gu.id_escritorio; let tot = 0;
      for (const i of its) { const c = dev[i.id] || 0; tot += c; if (c > 0 && i.id_repuesto) await movimiento(i.id_repuesto, 'ENTRADA', c, 'Devolución guía ' + num, num); await API.update('guia_items', i.id, Object.assign({ devuelto: c }, META())); }
      const inf = U().$id('bgInf').checked, obs = U().$id('bgObs').value.trim();
      await API.update('guias', gu.id, Object.assign({ estado: 'LIQUIDADA', fecha_liquidacion: AHORA(), informe_recibido: inf ? 'SI' : 'NO', obs_liquidacion: obs }, META()));
      await evento(s, s.etapa, 'Guía ' + num + ' liquidada · devuelto ' + g(tot) + ' · informe escrito ' + (inf ? 'recibido' : 'NO recibido') + (obs ? ' · ' + obs : ''));
      fin('✔ Guía liquidada');
    });
  }

  // ── Revisión (solo ADMIN aprueba / pide corrección) ───────────────
  async function revision(s) {
    const o = D.OT[s.id_ot], gu = s.id_guia ? (await API.select('guias', { id_escritorio: s.id_guia }).catch(() => []))[0] : null, prf = D.PRF[s.id_proforma];
    const ck = [{ t: 'Orden de trabajo vinculada', ok: !!o, ob: true, d: o ? 'OT ' + (o.numero_ot || '') : 'Vincule la OT del servicio' },
      { t: 'OT en estado REALIZADO', ok: !!o && String(o.estado || '').toUpperCase() === 'REALIZADO', ob: true, d: o ? (o.estado || '—') : '—' },
      { t: 'Conformidad del cliente (firma en la OT)', ok: !!o && !!String(o.firma_recibe || '').trim(), ob: false, d: o ? (o.firma_recibe ? 'firmada' : 'sin firma de recibido') : '—' }];
    if (gu) {
      ck.push({ t: 'Guía de materiales liquidada', ok: gu.estado === 'LIQUIDADA', ob: true, d: 'Guía ' + (gu.numero || '') + ' · ' + (EST_GUIA[gu.estado] || gu.estado || '') });
      ck.push({ t: 'Informe escrito recibido', ok: gu.informe_recibido === 'SI', ob: false, d: gu.informe_recibido === 'SI' ? 'Sí' : 'No registrado' });
    } else ck.push({ t: 'Guía de materiales', ok: null, ob: false, d: 'No aplica (sin guía)' });
    ck.push({ t: 'Proforma para facturar (D4)', ok: prf ? true : null, ob: false, d: prf ? 'N° ' + (prf.numero || '') + ' · total ' + n(prf.total).toFixed(2) : 'Se genera sola desde la OT al aprobar (la genera el escritorio al sincronizar)' });
    const rev = s.revision || 'PENDIENTE';
    const ic = (c) => c.ok ? '<b style="color:#1E8449">✔</b>' : (c.ok === null ? '<b style="color:#7F8C8D">—</b>' : (c.ob ? '<b style="color:#C0392B">✖</b>' : '<b style="color:#B9770E">⚠</b>'));
    let pie = '';
    if (rev === 'APROBADA') pie = `<p style="color:#1E8449;font-weight:700">Aprobado por ${esc(s.revision_por || '')} el ${esc(String(s.revision_en || '').slice(0, 16))}</p>`;
    else if (rev === 'CORRECCION') pie = `<p style="color:#C0392B;font-weight:700">Corrección: ${esc(s.revision_nota || '')}</p>` + (gestiona() && s.estado === 'ABIERTO' ? '<button class="btn-web prim" id="rvRe">↩ Reenviar a revisión (corregido)</button>' : '');
    else if (revisa() && s.estado === 'ABIERTO') pie = '<button class="btn-web prim" id="rvAp">✅ Aprobar para facturar</button> <button class="btn-web sec" id="rvCo">✏ Solicitar corrección</button>';
    else if (s.estado === 'ABIERTO') pie = '<p style="font-size:12px;color:#888">La aprobación para facturar la hace solo ADMIN.</p>';
    U().modal(`<h3>✅ Revisión para facturar · ${esc(s.id_escritorio)}</h3><p><b>Estado de la revisión: ${esc(REV[rev] || rev)}</b></p>
      ${U().tabla(['', 'Punto', 'Detalle'], ck.map((c) => [ic(c), esc(c.t) + (c.ob ? ' (obligatorio)' : ''), esc(c.d)]))}
      <label style="font-size:12px;font-weight:700">Nota</label><input class="inp-web" id="rvN">
      <div id="rvMot"></div><div style="margin-top:8px">${pie}</div>
      <div id="rvErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div><div style="text-align:right"><button class="btn-web sec" id="rvX">Cerrar</button></div>`);
    U().$id('rvX').onclick = U().cerrarModal;
    const err = (x) => { U().$id('rvErr').textContent = x; };
    const quien = nombreUsr() || usuario();
    const ap = U().$id('rvAp');
    if (ap) ap.onclick = async () => {
      if (s.revision === 'APROBADA') return err('Ya está aprobado para facturar.');
      const falta = ck.filter((c) => c.ob && !c.ok).map((c) => c.t);
      if (falta.length) return err('No se puede aprobar. Falta: ' + falta.join('; '));
      // Control D2: quien ejecutó la OT no la aprueba; el ADMIN puede, indicando el motivo
      const tecs = o ? await API.select('ot_tecnicos', { id_orden: o.id }).catch(() => []) : [];
      const yo = String(nombreUsr()).trim().toUpperCase();
      const propio = yo && tecs.some((t) => String(t.nombre_tecnico || '').trim().toUpperCase() === yo);
      let mot = '';
      if (propio) {
        if (!U().$id('rvM')) { U().$id('rvMot').innerHTML = '<label style="font-size:12px;font-weight:700;color:#B9770E">Control: usted ejecutó esta OT. Como ADMIN puede aprobarla indicando el motivo:</label><input class="inp-web" id="rvM">'; return; }
        mot = U().$id('rvM').value.trim(); if (!mot) return err('Indique el motivo para aprobar su propia OT.');
      }
      ap.disabled = true;
      try {
        const no = U().$id('rvN').value.trim();
        await guardar(s, { revision: 'APROBADA', revision_nota: no, revision_por: quien, revision_en: AHORA() },
          'Aprobado para facturar' + (prf ? '' : ' · la proforma desde la OT se genera al sincronizar el escritorio') + (no ? ' · ' + no : '') + (propio ? ' · ADMIN aprueba su propia OT: ' + mot : ''));
        U().toast('✅ Aprobado para facturar'); U().cerrarModal(); recargar();
      } catch (e) { ap.disabled = false; err('❌ ' + e.message); }
    };
    const co = U().$id('rvCo');
    if (co) co.onclick = async () => {
      const no = U().$id('rvN').value.trim();
      if (!no) return err('Indique qué debe corregir el técnico.');
      co.disabled = true;
      try { await guardar(s, { revision: 'CORRECCION', revision_nota: no, revision_por: quien, revision_en: AHORA() }, 'Corrección solicitada: ' + no); U().toast('✏ Corrección solicitada'); U().cerrarModal(); recargar(); }
      catch (e) { co.disabled = false; err('❌ ' + e.message); }
    };
    const re = U().$id('rvRe');
    if (re) re.onclick = async () => {
      const no = U().$id('rvN').value.trim();
      re.disabled = true;
      try { await guardar(s, { revision: 'PENDIENTE' }, 'Corrección realizada, reenviado a revisión' + (no ? ' · ' + no : '')); U().toast('↩ Reenviado a revisión'); U().cerrarModal(); recargar(); }
      catch (e) { re.disabled = false; err('❌ ' + e.message); }
    };
  }
  V._expedientes = { etapaDe };
})();
