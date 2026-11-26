/* PROSOL web PC · lib/web_programacion.js (v3.94.1 · W1)
   Programación completa en la web, con los mismos datos y códigos que el escritorio:
   · 📅 Agenda programada (calendario de citas, igual que antes).
   · 🗓 Visitas programadas: ➕ nueva, ✎ editar, reprogramar (al cambiar la fecha vuelve a ⏳ Pendiente),
     📨 Solicitar liberación por día, 💬 WhatsApp SOLO en visitas 🔓 Liberadas, 🖨 Informe (imprimir o PDF).
     La visita creada aquí recibe su código VIS de la nube y baja sola al escritorio.
   · ⏰ Agenda preventiva: por vencer y vencidos, calculada por el motor del escritorio; «Programar» abre la visita.
   Módulo fuera del IIFE base: se registra en window.PROSOL_WEB_VISTAS. */
(() => {
  const V = window.PROSOL_WEB_VISTAS = window.PROSOL_WEB_VISTAS || {};
  const TIPOS = ['PREVENTIVO', 'PRIMER MANTENIMIENTO', 'ARRANQUE INICIAL', 'VISITA EXPRESS LITE', 'VISITA EXPRESS PLUS',
    'CORRECTIVO', 'INSPECCIÓN', 'OTRO'];
  const U = () => PROSOL_WEB.util;
  const esc = (s) => U().ESC(s);
  const ahora = () => new Date().toISOString();
  let sub = 'visitas';
  let D = { vis: [], eq: [], cli: [], tec: [], ord: [], eqMap: {}, cliMap: {}, puede: false, rol: '' };
  // v3.94.1: cada apertura tiene su turno; si el usuario cambia de pestaña o de menú mientras carga, la carga vieja
  // se descarta (antes escribía en una pantalla que ya no existía: «Cannot set properties of null»).
  let turno = 0;
  class Vencida extends Error {}
  const vigente = (t) => { if (t !== turno || !document.getElementById('progSub')) throw new Vencida(); };

  function rolActual() {
    try { const s = API.sesionNube && API.sesionNube(); if (s && s.rol) return String(s.rol).toUpperCase(); } catch (e) {}
    return String((window._prosolSesion || {}).perfil || '').toUpperCase();
  }
  function usuario() {
    try { const s = API.sesionNube && API.sesionNube(); if (s && s.usuario) return s.usuario; } catch (e) {}
    const s = window._prosolSesion || {}; return s.usuario || s.nombre || '';
  }
  const puedeEditar = () => ['ADMIN', 'OPERADOR', 'VENDEDOR'].includes(D.rol) || D.puede;
  const diasA = (f) => { if (!f) return null; const h = new Date(U().hoy() + 'T00:00:00'), x = new Date(f + 'T00:00:00'); return Math.round((x - h) / 86400000); };
  const badge = (a) => a === 'LIBERADA' ? '<span style="color:#1E8449;font-weight:700">🔓 Liberada</span>'
    : '<span style="color:#B9770E;font-weight:700">⏳ Pendiente</span>';

  function barra() {
    const b = (k, t) => `<button class="btn-web ${sub === k ? 'prim' : 'sec'}" data-sub="${k}">${t}</button>`;
    return `<div class="card" id="progSub" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <b style="margin-right:6px">📅 Programación</b>${b('agenda', '📅 Agenda programada')}${b('visitas', '🗓 Visitas programadas')}${b('preventiva', '⏰ Agenda preventiva')}</div>`;
  }
  function enlazarBarra() {
    document.querySelectorAll('#progSub [data-sub]').forEach((x) => x.addEventListener('click', () => { sub = x.dataset.sub; V.programacion(); }));
  }

  V.programacion = async () => {
    const main = U().$id('main');
    if (!API.hayNube()) return PROSOL_WEB.vistaBase('programacion')();
    D.rol = rolActual();
    const t = ++turno;
    try {
      if (sub === 'agenda') {
        main.innerHTML = barra() + '<div class="card">Cargando…</div>'; enlazarBarra();
        try { await PROSOL_WEB.vistaBase('programacion')(); } catch (e) { if (t !== turno || !document.getElementById('agWeb')) return; throw e; }
        if (t !== turno || !document.getElementById('agWeb')) return;      // ya se abrió otra pantalla
        main.insertAdjacentHTML('afterbegin', barra()); enlazarBarra(); return;
      }
      main.innerHTML = barra() + '<div id="progCuerpo" class="card">Cargando…</div>';
      enlazarBarra();
      try { D.puede = !!(await API.rpc('puede_aprobar', {})); } catch (e) { D.puede = false; }
      vigente(t);
      if (sub === 'preventiva') return await pintarPreventiva(t);
      return await pintarVisitas(t);
    } catch (e) {
      if (e instanceof Vencida || t !== turno || !document.getElementById('progSub')) return;   // carga vieja: se ignora
      throw e;
    }
  };

  async function cargarBase() {
    const [vis, eq, cli, tec, ord] = await Promise.all([
      API.select('visitas_programadas').catch(() => []), API.select('equipos').catch(() => []),
      API.select('clientes').catch(() => []), API.select('tecnicos').catch(() => []), API.select('ordenes').catch(() => [])]);
    D.vis = vis; D.eq = eq; D.cli = cli; D.tec = tec; D.ord = ord;
    D.eqMap = {}; eq.forEach((e) => { D.eqMap[e.id] = e; });
    D.cliMap = {}; cli.forEach((c) => { D.cliMap[c.id] = c; });
  }
  const cliDe = (v) => D.cliMap[v.id_cliente] || D.cliMap[(D.eqMap[v.id_equipo] || {}).id_cliente] || {};
  const eqTxt = (e, v) => [e.marca, e.modelo, e.potencia_kw ? e.potencia_kw + ' kW' : ''].filter(Boolean).join(' ') || (v && v.serie) || '';

  // v3.94.1 · visita PROGRAMADA cuyo equipo ya tiene una OT con fecha igual o posterior = atendida (mismo criterio que el
  // escritorio): se muestra EJECUTADA y, si el usuario puede editar, queda así en la nube.
  const ATENDIDA = ['EJECUTADA', 'REALIZADA'];
  const NO_CUENTA = ['ANULADA', 'ANULADO', 'CANCELADA', 'CANCELADO'];
  function otDe(v) {
    if (!v.fecha_programada) return null;
    return D.ord.filter((o) => ((v.id_equipo && o.id_equipo === v.id_equipo) || (v.serie && o.serie === v.serie))
      && (o.fecha || '') >= v.fecha_programada && !NO_CUENTA.includes(String(o.estado || '').toUpperCase()))
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))[0] || null;
  }
  async function cerrarAtendidas() {
    const cerrar = [];
    D.vis.forEach((v) => {
      if ((v.estado || 'PROGRAMADA') !== 'PROGRAMADA') return;
      const o = otDe(v); if (!o) return;
      v.estado = 'EJECUTADA'; v._ot = o.numero_ot || ''; cerrar.push(v);
    });
    if (!cerrar.length || !puedeEditar()) return;
    await Promise.all(cerrar.map((v) => API.update('visitas_programadas', v.id, { estado: 'EJECUTADA', actualizado: ahora(), sync_origen: 'WEB' })
      .catch(() => null)));
  }
  const estTxt = (v) => ATENDIDA.includes(v.estado) ? 'EJECUTADA' + (v._ot ? ' · OT ' + v._ot : '') : (v.estado || 'PROGRAMADA');

  // ── 🗓 Visitas programadas ──────────────────────────────────────────
  async function pintarVisitas(t) {
    await cargarBase(); vigente(t);
    await cerrarAtendidas(); vigente(t);
    const c = U().$id('progCuerpo');
    const ed = puedeEditar();
    c.innerHTML = `<h2>🗓 Visitas programadas</h2>
      <div class="toolbar" style="flex-wrap:wrap">
        <input id="pvQ" class="inp-web" style="max-width:240px" placeholder="Buscar código, cliente, serie, tipo…">
        <select id="pvEst" class="inp-web" style="max-width:160px"><option value="">Todos los estados</option>
          <option selected>PROGRAMADA</option><option>EJECUTADA</option><option>CANCELADA</option></select>
        <select id="pvAp" class="inp-web" style="max-width:170px"><option value="">Toda aprobación</option>
          <option value="PENDIENTE">⏳ Pendiente</option><option value="LIBERADA">🔓 Liberada</option></select>
        <label style="font-size:12px">Desde <input id="pvDe" type="date" class="inp-web" style="max-width:150px"></label>
        <label style="font-size:12px">Hasta <input id="pvHa" type="date" class="inp-web" style="max-width:150px"></label>
        ${ed ? '<button class="btn-web prim" id="pvNueva">➕ Nueva visita</button><button class="btn-web sec" id="pvSol">📨 Solicitar liberación</button>' : ''}
        <button class="btn-web sec" id="pvInf">🖨 Informe</button>
      </div>
      <p style="font-size:12px;color:#666;margin:0 0 6px">Visita nueva o reprogramada queda ⏳ Pendiente hasta que el supervisor o administrador la libere.
        WhatsApp solo en visitas 🔓 Liberadas. Lo creado aquí baja solo al escritorio con su código VIS.</p>
      <div id="pvLista">Cargando…</div>`;
    const filtradas = () => {
      const q = (U().$id('pvQ').value || '').toLowerCase(), est = U().$id('pvEst').value, ap = U().$id('pvAp').value,
        de = U().$id('pvDe').value, ha = U().$id('pvHa').value;
      return D.vis.filter((v) => {
        const e = D.eqMap[v.id_equipo] || {}, cl = cliDe(v);
        return (!q || [v.id_escritorio, v.serie, v.tipo_mantenimiento, cl.razon_social, e.modelo, v.observacion].some((x) => String(x || '').toLowerCase().includes(q)))
          && (!est || (ATENDIDA.includes(v.estado) ? 'EJECUTADA' : (v.estado || 'PROGRAMADA')) === est) && (!ap || (v.aprobacion || 'PENDIENTE') === ap)
          && (!de || (v.fecha_programada || '') >= de) && (!ha || (v.fecha_programada || '') <= ha);
      }).sort((a, b) => ((a.fecha_programada || '') + (a.hora || '')).localeCompare((b.fecha_programada || '') + (b.hora || '')));
    };
    const pintar = () => {
      const hoy = U().hoy();
      const filas = filtradas().map((v) => {
        const e = D.eqMap[v.id_equipo] || {}, cl = cliDe(v), venc = v.fecha_programada && v.fecha_programada < hoy && (v.estado || 'PROGRAMADA') === 'PROGRAMADA';
        const lib = v.aprobacion === 'LIBERADA';
        return [`<b>${esc(v.id_escritorio || '—')}</b>`,
          `<span style="color:${venc ? '#E74C3C' : 'inherit'};font-weight:${venc ? 700 : 400}">${esc(v.fecha_programada || '—')}${v.hora ? ' ' + esc(v.hora) : ''}${venc ? ' ⚠' : ''}</span>`,
          esc(cl.razon_social || '—'), esc(eqTxt(e, v)) + '<br><small>' + esc(v.serie || '') + '</small>', esc(v.tipo_mantenimiento || '—'),
          esc(estTxt(v)), badge(v.aprobacion), esc(v.tecnico_asignado || ''),
          (ed ? `<button class="btn-web mini sec" data-ed="${v.id}" title="Editar / reprogramar">✎</button> ` : '')
          + (lib ? `<button class="btn-web mini sec" data-wa="${v.id}" title="Enviar por WhatsApp">💬</button>` : '')];
      });
      const L = U().$id('pvLista');
      L.innerHTML = U().tabla(['Código', 'Fecha', 'Cliente', 'Equipo', 'Tipo', 'Estado', 'Aprobación', 'Técnico', ''], filas);
      L.querySelectorAll('[data-ed]').forEach((b) => b.addEventListener('click', () => formVisita(D.vis.find((x) => String(x.id) === b.dataset.ed))));
      L.querySelectorAll('[data-wa]').forEach((b) => b.addEventListener('click', () => whatsapp(D.vis.find((x) => String(x.id) === b.dataset.wa))));
    };
    ['pvQ', 'pvEst', 'pvAp', 'pvDe', 'pvHa'].forEach((i) => U().$id(i).addEventListener(i === 'pvQ' ? 'input' : 'change', pintar));
    if (ed) {
      U().$id('pvNueva').addEventListener('click', () => formVisita(null));
      U().$id('pvSol').addEventListener('click', solicitarLiberacion);
    }
    U().$id('pvInf').addEventListener('click', () => informe(filtradas()));
    pintar();
  }

  // ── Formulario: nueva / editar / reprogramar ──────────────────────
  function formVisita(v, pre) {
    const nueva = !v; v = v || {};
    pre = pre || {};
    const eqSel = D.eqMap[v.id_equipo] || D.eq.find((e) => e.id_escritorio === pre.id_equipo_esc) || null;
    const opc = D.eq.filter((e) => String(e.estado || 'ACTIVO').toUpperCase() !== 'INACTIVO').map((e) => {
      const cl = D.cliMap[e.id_cliente] || {};
      return `<option value="${esc(e.serie || e.id_escritorio)} — ${esc(cl.razon_social || '')} — ${esc(eqTxt(e))}">`;
    }).join('');
    const txtEq = (e) => e ? `${e.serie || e.id_escritorio} — ${(D.cliMap[e.id_cliente] || {}).razon_social || ''} — ${eqTxt(e)}` : '';
    const tipos = [...new Set([...TIPOS, v.tipo_mantenimiento, pre.tipo].filter(Boolean))];
    const lbl = (t) => `<label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">${t}</label>`;
    U().modal(`<h3>${nueva ? '➕ Nueva visita' : '✎ Editar visita ' + esc(v.id_escritorio || '')}</h3>
      ${lbl('Equipo (serie — cliente — modelo)')}<input class="inp-web" id="fvEq" list="fvEqL" value="${esc(txtEq(eqSel))}" ${nueva ? '' : 'disabled'}>
      <datalist id="fvEqL">${opc}</datalist>
      <div class="grid2"><div>${lbl('Fecha')}<input class="inp-web" id="fvFe" type="date" value="${esc(v.fecha_programada || pre.fecha || '')}"></div>
        <div>${lbl('Hora')}<input class="inp-web" id="fvHo" type="time" value="${esc(v.hora || '')}"></div>
        <div>${lbl('Tipo de mantenimiento')}<select class="inp-web" id="fvTi">${tipos.map((t) => `<option ${t === (v.tipo_mantenimiento || pre.tipo || 'PREVENTIVO') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div>${lbl('Estado')}<select class="inp-web" id="fvEs" ${nueva ? 'disabled' : ''}>${['PROGRAMADA', 'EJECUTADA', 'CANCELADA'].map((t) => `<option ${t === (v.estado || 'PROGRAMADA') ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div>${lbl('Contacto que confirma la cita')}<input class="inp-web" id="fvCo" value="${esc(v.contacto_cita || '')}"></div>
        <div>${lbl('Teléfono de la cita')}<input class="inp-web" id="fvTe" value="${esc(v.telefono_cita || '')}"></div></div>
      ${lbl('Observación / tareas')}<textarea class="inp-web" id="fvOb" rows="2">${esc(v.observacion || pre.obs || '')}</textarea>
      ${nueva ? '' : '<p style="font-size:12px;color:#B9770E;margin:6px 0 0">Si cambias la fecha, la visita vuelve a ⏳ Pendiente de aprobación.</p>'}
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
        <button class="btn-web sec" id="fvX">Cancelar</button><button class="btn-web prim" id="fvOk">💾 Guardar</button></div>`);
    U().$id('fvX').addEventListener('click', U().cerrarModal);
    U().$id('fvOk').addEventListener('click', async () => {
      const fecha = U().$id('fvFe').value;
      if (!fecha) { U().toast('⚠ Indica la fecha'); return; }
      const row = { fecha_programada: fecha, hora: U().$id('fvHo').value || '', tipo_mantenimiento: U().$id('fvTi').value,
        observacion: U().$id('fvOb').value.trim(), contacto_cita: U().$id('fvCo').value.trim(), telefono_cita: U().$id('fvTe').value.trim(),
        actualizado: ahora(), sync_origen: 'WEB' };
      try {
        if (nueva) {
          const t = U().$id('fvEq').value.trim(), clave = t.split(' — ')[0];
          const e = D.eq.find((x) => (x.serie || x.id_escritorio) === clave);
          if (!e) { U().toast('⚠ Elige el equipo de la lista'); return; }
          Object.assign(row, { id_equipo: e.id, serie: e.serie || '', id_cliente: e.id_cliente || null, estado: 'PROGRAMADA',
            registrado_por: usuario(), fecha_registro: new Date().toLocaleString('sv-SE').slice(0, 16) });
          const r = await API.insert('visitas_programadas', row);
          const x = Array.isArray(r) ? r[0] : r;
          U().toast('✅ Visita ' + ((x && x.id_escritorio) || '') + ' creada · ⏳ pendiente de aprobación');
        } else {
          row.estado = U().$id('fvEs').value;
          await API.update('visitas_programadas', v.id, row);
          U().toast(fecha !== v.fecha_programada ? '✅ Reprogramada · vuelve a ⏳ Pendiente' : '✅ Visita guardada');
        }
        U().cerrarModal(); sub = 'visitas'; V.programacion();
        try { if (typeof APROBACION !== 'undefined' && APROBACION.cargar) APROBACION.cargar(); } catch (e2) {}
      } catch (e) { U().toast('❌ ' + e.message); }
    });
  }

  // ── 📨 Solicitar liberación (por día) ──────────────────────────────
  function solicitarLiberacion() {
    const m = {};
    D.vis.filter((v) => (v.aprobacion || 'PENDIENTE') === 'PENDIENTE' && (v.estado || 'PROGRAMADA') === 'PROGRAMADA')
      .forEach((v) => { const d = m[v.fecha_programada] = m[v.fecha_programada] || { n: 0, sol: '' }; d.n++; if (v.solicitado_por) d.sol = v.solicitado_por; });
    const dias = Object.keys(m).sort();
    U().modal(`<h3>📨 Solicitar liberación</h3>
      <p style="font-size:13px;color:#555">Días con visitas ⏳ pendientes. Al solicitar, el supervisor o administrador recibe el aviso para revisar y liberar.</p>
      ${dias.length ? U().tabla(['Día', 'Pendientes', 'Solicitado por', ''], dias.map((d) => [esc(d), m[d].n, esc(m[d].sol || '—'),
        `<button class="btn-web mini prim" data-dia="${esc(d)}">📨 Solicitar</button>`])) : '<p>No hay visitas pendientes.</p>'}
      <div style="text-align:right;margin-top:12px"><button class="btn-web sec" id="slX">Cerrar</button></div>`);
    U().$id('slX').addEventListener('click', U().cerrarModal);
    document.querySelectorAll('[data-dia]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await API.rpc('visitas_solicitar', { p_fecha: b.dataset.dia, p_usuario: usuario() });
        U().toast('✅ Liberación solicitada para ' + b.dataset.dia); U().cerrarModal(); V.programacion();
      } catch (e) { U().toast('❌ ' + e.message); }
    }));
  }

  // ── 💬 WhatsApp (solo liberadas) ───────────────────────────────────
  function whatsapp(v) {
    if (!v || v.aprobacion !== 'LIBERADA') { U().toast('⚠ Solo visitas 🔓 Liberadas'); return; }
    const e = D.eqMap[v.id_equipo] || {}, cl = cliDe(v);
    const tel = v.telefono_cita || e.contacto_tel || cl.telefono || '';
    const L = ['*PROSOL — Visita programada*', 'Cliente: ' + (cl.razon_social || ''), 'Equipo: ' + eqTxt(e, v) + (v.serie ? ' · Serie ' + v.serie : ''),
      'Fecha: ' + (v.fecha_programada || '') + (v.hora ? ' · ' + v.hora : ''), 'Tipo: ' + (v.tipo_mantenimiento || '')];
    if (v.tecnico_asignado) L.push('Técnico: ' + v.tecnico_asignado);
    if (v.observacion) L.push('Tareas: ' + v.observacion);
    L.push('Código: ' + (v.id_escritorio || ''));
    const num = prompt('Número de WhatsApp (formato internacional):', tel);
    if (num == null) return;
    let d = String(num).replace(/\D/g, '');
    if (/^0\d{9}$/.test(d)) d = '593' + d.slice(1);          // celular de Ecuador 09… → +593 9…
    try { WA.enviar(d, L.join('\n')); } catch (er) { U().toast('⚠ ' + er.message); }
  }

  // ── 🖨 Informe (imprimir o guardar como PDF) ───────────────────────
  function informe(lista) {
    const filas = lista.map((v) => {
      const e = D.eqMap[v.id_equipo] || {}, cl = cliDe(v);
      return `<tr><td>${esc(v.id_escritorio || '')}</td><td>${esc(v.fecha_programada || '')} ${esc(v.hora || '')}</td><td>${esc(cl.razon_social || '')}</td>
        <td>${esc(eqTxt(e, v))}<br>${esc(v.serie || '')}</td><td>${esc(v.tipo_mantenimiento || '')}</td><td>${esc(estTxt(v))}</td>
        <td>${v.aprobacion === 'LIBERADA' ? 'Liberada' : 'Pendiente'}</td><td>${esc(v.tecnico_asignado || '')}</td><td>${esc(v.observacion || '')}</td></tr>`;
    }).join('');
    const w = window.open('', '_blank');
    if (!w) { U().toast('⚠ Permite ventanas emergentes para el informe'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Informe de visitas programadas</title>
      <style>body{font-family:Arial,sans-serif;font-size:11px;margin:18px}h1{font-size:16px;margin:0}table{border-collapse:collapse;width:100%;margin-top:10px}
      th,td{border:1px solid #999;padding:4px;vertical-align:top}th{background:#1C2733;color:#fff}footer{margin-top:14px;font-size:10px;color:#555;text-align:center}
      @media print{button{display:none}}</style></head><body>
      <h1>PROSOL — Informe de visitas programadas</h1><div>Generado: ${esc(new Date().toLocaleString('es-EC'))} · ${lista.length} visita(s) · ${esc(usuario())}</div>
      <table><thead><tr><th>Código</th><th>Fecha</th><th>Cliente</th><th>Equipo</th><th>Tipo</th><th>Estado</th><th>Aprobación</th><th>Técnico</th><th>Observación</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="9">Sin visitas.</td></tr>'}</tbody></table>
      <footer>Potenciado por ROCKENSY S.A. &amp; MIG — Tec. Master Luis Martínez Ibáñez</footer>
      <p><button onclick="print()">🖨 Imprimir / Guardar PDF</button></p></body></html>`);
    w.document.close();
  }

  // ── ⏰ Agenda preventiva ───────────────────────────────────────────
  async function pintarPreventiva(t) {
    const [ag] = await Promise.all([API.select('agenda_preventiva').catch(() => []), cargarBase()]);
    vigente(t);
    D.vis.forEach((v) => { if ((v.estado || 'PROGRAMADA') === 'PROGRAMADA' && otDe(v)) v.estado = 'EJECUTADA'; });
    const c = U().$id('progCuerpo');
    const ed = puedeEditar();
    const programadas = new Set(D.vis.filter((v) => (v.estado || 'PROGRAMADA') === 'PROGRAMADA')
      .map((v) => (D.eqMap[v.id_equipo] || {}).id_escritorio || v.serie));
    c.innerHTML = `<h2>⏰ Agenda preventiva</h2>
      <div class="toolbar" style="flex-wrap:wrap">
        <select id="apVer" class="inp-web" style="max-width:220px"><option value="30">Por vencer (30 días) + vencidos</option>
          <option value="V">Solo vencidos</option><option value="60">Por vencer (60 días) + vencidos</option><option value="T">Todos los equipos</option></select>
        <input id="apQ" class="inp-web" style="max-width:240px" placeholder="Buscar cliente, serie, ciudad…">
        <label style="font-size:12px"><input type="checkbox" id="apSin"> Ocultar los que ya tienen visita</label>
      </div>
      <p style="font-size:12px;color:#666;margin:0 0 6px">Calculada por el motor de reglas del escritorio (lo primero entre fecha y horas). Se actualiza en cada sincronización del escritorio.</p>
      <div id="apLista">${ag.length ? '' : 'Sin datos: la agenda se publica cuando el escritorio sincroniza con la versión v3.94.'}</div>`;
    if (!ag.length) return;
    const pintar = () => {
      const ver = U().$id('apVer').value, q = (U().$id('apQ').value || '').toLowerCase(), sin = U().$id('apSin').checked;
      const filas = ag.map((a) => Object.assign({}, a, { d: diasA(a.proximo) })).filter((a) => {
        const venc = a.d != null && a.d < 0;
        const okVer = ver === 'T' || (ver === 'V' ? venc : (venc || (a.d != null && a.d <= Number(ver))));
        return okVer && (!q || [a.cliente, a.serie, a.ciudad, a.zona, a.equipo].some((x) => String(x || '').toLowerCase().includes(q)))
          && (!sin || !programadas.has(a.id_escritorio));
      }).sort((x, y) => String(x.proximo || '').localeCompare(String(y.proximo || ''))).map((a) => {
        const venc = a.d != null && a.d < 0, ya = programadas.has(a.id_escritorio);
        return [`<span style="color:${venc ? '#E74C3C' : '#B9770E'};font-weight:700">${esc(a.proximo || '—')}</span>`,
          `<span style="color:${venc ? '#E74C3C' : 'inherit'}">${venc ? 'Vencido hace ' + (-a.d) + ' d' : 'En ' + a.d + ' d'}</span>`,
          esc(a.cliente || ''), esc(a.equipo || '') + '<br><small>' + esc(a.serie || '') + '</small>', esc([a.ciudad, a.zona].filter(Boolean).join(' · ')),
          esc(a.ultimo || '—'), esc(a.criterio || ''), esc(a.prox_tipo || ''), esc(a.situacion || ''),
          ya ? '<span style="color:#1E8449">📅 Programada</span>' : (ed ? `<button class="btn-web mini prim" data-prog="${esc(a.id_escritorio)}">📅 Programar</button>` : '')];
      });
      const L = U().$id('apLista');
      L.innerHTML = U().tabla(['Próximo', 'Días', 'Cliente', 'Equipo', 'Ciudad / zona', 'Último', 'Criterio', 'Tipo sugerido', 'Situación', ''], filas);
      L.querySelectorAll('[data-prog]').forEach((b) => b.addEventListener('click', () => {
        const a = ag.find((x) => x.id_escritorio === b.dataset.prog) || {};
        formVisita(null, { id_equipo_esc: a.id_escritorio, fecha: a.proximo && a.proximo >= U().hoy() ? a.proximo : U().hoy(),
          tipo: a.prox_tipo && TIPOS.includes(a.prox_tipo) ? a.prox_tipo : 'PREVENTIVO' });
      }));
    };
    ['apVer', 'apSin'].forEach((i) => U().$id(i).addEventListener('change', pintar));
    U().$id('apQ').addEventListener('input', pintar);
    pintar();
  }

  V._prog = { formVisita, whatsapp, informe };   // para pruebas
})();
