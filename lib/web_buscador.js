/* PROSOL web PC · lib/web_buscador.js (v3.97 · W3)
   «🔎 Buscar» global, como el buscador del escritorio: clientes, equipos, OT, facturas, guías, repuestos, visitas y
   órdenes de servicio (RPC buscar_global en la nube: cada rol ve solo lo que sus permisos le dejan ver).
   Acciones por resultado: historial/datos/visitas del equipo · equipos/OT/estado de cuenta del cliente ·
   detalle de OT, factura (con pagos), guía (con ítems), visita y orden de servicio (con eventos) · kardex del repuesto.
   Estado de cuenta y pagos: ADMIN y OPERADOR. Botón fijo «🔎 Buscar» en la barra superior. Módulo fuera del IIFE base. */
(() => {
  const V = window.PROSOL_WEB_VISTAS = window.PROSOL_WEB_VISTAS || {};
  const U = () => PROSOL_WEB.util;
  const esc = (s) => U().ESC(s);
  function rol() {
    try { const s = API.sesionNube && API.sesionNube(); if (s && s.rol) return String(s.rol).toUpperCase(); } catch (e) {}
    return String((window._prosolSesion || {}).perfil || '').toUpperCase();
  }
  const finanzas = () => ['ADMIN', 'OPERADOR'].includes(rol());
  const dinero = (x) => '$ ' + Number(x || 0).toFixed(2);
  const ICO = { 'Cliente': '👥', 'Equipo': '⚡', 'Orden de Trabajo': '📋', 'Factura': '🧾', 'Guía': '🚚', 'Repuesto': '📦', 'Visita': '📅', 'Orden de servicio': '🗂' };
  let ultimo = '', turno = 0;

  // ── botón fijo en la barra superior ───────────────────────────────
  function boton() {
    const top = document.querySelector('header.topbar'); if (!top || document.getElementById('btnBuscarTop')) return !!top;
    const b = document.createElement('button');
    b.id = 'btnBuscarTop'; b.type = 'button'; b.className = 'btn-web sec'; b.textContent = '🔎 Buscar';
    b.style.cssText = 'margin-right:8px;white-space:nowrap';
    b.onclick = () => (window.PROSOL_WEB && PROSOL_WEB.ir ? PROSOL_WEB.ir('buscar') : V.buscar());
    const badge = document.getElementById('userBadge');
    if (badge && badge.parentNode) badge.parentNode.insertBefore(b, badge); else top.appendChild(b);
    return true;
  }
  const _b = setInterval(() => { if (document.getElementById('nav') && document.querySelector('#nav button') && boton()) clearInterval(_b); }, 1000);

  V.buscar = async () => {
    const main = U().$id('main');
    if (!API.hayNube()) { main.innerHTML = '<div class="card"><h2>🔎 Buscar</h2><p>☁ Sin conexión a la nube. Ve a <b>Configuración</b>.</p></div>'; return; }
    main.innerHTML = `<div class="card"><h2 style="margin-top:0">🔎 Buscar</h2>
      <div class="toolbar"><input class="inp-web" id="bgQ" style="flex:1;min-width:260px" placeholder="Cliente, RUC/cédula, teléfono, serie, Nº OT, factura, guía, repuesto, VIS-…, SRV-…" value="${esc(ultimo)}">
      <button class="btn-web prim" id="bgIr">🔎 Buscar</button></div>
      <p style="font-size:12px;color:#666;margin:4px 0 0">Mínimo 2 caracteres. Busca en toda la base de la nube.</p></div>
      <div class="card" id="bgRes"></div><div class="card" id="bgDet" style="display:none"></div>`;
    const q = U().$id('bgQ');
    let tm = null;
    q.oninput = () => { clearTimeout(tm); tm = setTimeout(buscar, 450); };
    q.onkeydown = (e) => { if (e.key === 'Enter') { clearTimeout(tm); buscar(); } };
    U().$id('bgIr').onclick = buscar;
    q.focus();
    if (ultimo) buscar();
  };

  async function buscar() {
    const q = (U().$id('bgQ') || {}).value || ''; ultimo = q.trim();
    const res = U().$id('bgRes'); if (!res) return;
    const t = ++turno;
    if (ultimo.length < 2) { res.innerHTML = '<p style="color:#666">Escriba al menos 2 caracteres.</p>'; return; }
    res.innerHTML = 'Buscando…';
    let L = [];
    try { L = await API.rpc('buscar_global', { p_q: ultimo, p_lim: 15 }) || []; }
    catch (e) { if (t === turno) res.innerHTML = '<p style="color:#C0392B">❌ ' + esc(e.message) + '</p>'; return; }
    if (t !== turno || !U().$id('bgRes')) return;
    if (!L.length) { res.innerHTML = '<p>Sin resultados para «' + esc(ultimo) + '».</p>'; return; }
    const grupos = {};
    L.forEach((x) => (grupos[x.tipo] = grupos[x.tipo] || []).push(x));
    res.innerHTML = `<b>${L.length} resultado(s)</b>` + Object.keys(grupos).map((g) => `<h3 style="margin:12px 0 4px">${ICO[g] || '•'} ${esc(g)} (${grupos[g].length})</h3>`
      + U().tabla(['Código', 'Descripción', 'Detalle', ''], grupos[g].map((x) => [esc(x.codigo || ''), esc(x.titulo || ''), esc(x.detalle || ''), acciones(x)]))).join('');
    res.querySelectorAll('[data-ac]').forEach((b) => b.onclick = () => abrir(b.dataset.ac, L.find((x) => x.tipo === b.dataset.tipo && String(x.id) === b.dataset.id)));
  }
  function acciones(x) {
    const b = (ac, txt) => `<button class="btn-web mini sec" data-ac="${ac}" data-tipo="${esc(x.tipo)}" data-id="${esc(x.id)}">${txt}</button>`;
    switch (x.tipo) {
      case 'Equipo': return b('eq_hist', '📋 Historial') + ' ' + b('eq_datos', '⚡ Datos') + ' ' + b('eq_vis', '📅 Visitas');
      case 'Cliente': return b('cl_eq', '⚡ Equipos') + ' ' + b('cl_ot', '📋 OT') + (finanzas() ? ' ' + b('cl_ec', '💲 Estado de cuenta') : '');
      case 'Orden de Trabajo': return b('ot', '🔍 Detalle');
      case 'Factura': return b('fac', '🔍 Detalle');
      case 'Guía': return b('gui', '🔍 Detalle');
      case 'Repuesto': return b('kardex', '📦 Kardex');
      case 'Visita': return b('vis', '🔍 Detalle');
      case 'Orden de servicio': return b('srv', '🔍 Detalle');
      default: return '';
    }
  }
  const uno = async (tabla, id) => (await API.select(tabla, { id }).catch(() => []))[0] || null;
  const fichas = (pares) => '<div class="grid2" style="font-size:13px">' + pares.filter((p) => p[1] !== undefined && p[1] !== null && p[1] !== '')
    .map((p) => `<div><b>${esc(p[0])}:</b> ${esc(p[1])}</div>`).join('') + '</div>';
  const otFilas = (L) => U().tabla(['Nº OT', 'Fecha', 'Tipo', 'Estado', 'Serie', 'Cliente', 'Horas', ''], L.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    .map((o) => [esc(o.numero_ot || ''), esc(o.fecha || ''), esc(o.tipo_ot || ''), esc(o.estado || ''), esc(o.serie || ''), esc(o.cliente_nombre || ''), esc(o.horas_maquina ?? ''),
      o.pdf_url ? `<a class="btn-web mini sec" target="_blank" rel="noopener" href="${esc(o.pdf_url)}">📄 PDF</a>` : '']));

  async function abrir(ac, x) {
    const d = U().$id('bgDet'); if (!d || !x) return;
    d.style.display = ''; d.innerHTML = 'Cargando…'; d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const t = turno;
    let h = '';
    try {
      if (ac.startsWith('eq_')) {
        const e = await uno('equipos', x.id); if (!e) throw new Error('Equipo no encontrado');
        const cli = e.id_cliente ? await uno('clientes', e.id_cliente) : null;
        if (ac === 'eq_datos') h = `<h3>⚡ Equipo ${esc(e.serie)}</h3>` + fichas([['Código', e.id_escritorio], ['Cliente', cli && cli.razon_social], ['Marca', e.marca], ['Modelo', e.modelo],
          ['Potencia', e.potencia_kw ? e.potencia_kw + ' kW' : ''], ['Voltaje', e.voltaje], ['Combustible', e.combustible], ['Ubicación', e.ubicacion], ['Horas', e.horas_operacion],
          ['Contacto', e.contacto], ['Teléfono contacto', e.contacto_tel], ['Estado', e.estado], ['Observación', e.observacion]])
          + (e.gps_lat && e.gps_lng ? `<p><a class="btn-web mini sec" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${e.gps_lat},${e.gps_lng}">📍 Ver en mapa</a></p>` : '');
        if (ac === 'eq_hist') { const L = await API.select('ordenes', { serie: e.serie }).catch(() => []); h = `<h3>📋 Historial del equipo ${esc(e.serie)} (${L.length} OT)</h3>` + (L.length ? otFilas(L) : '<p>Sin OT.</p>'); }
        if (ac === 'eq_vis') { const L = await API.select('visitas_programadas', { id_equipo: e.id }).catch(() => []);
          h = `<h3>📅 Visitas del equipo ${esc(e.serie)} (${L.length})</h3>` + (L.length ? U().tabla(['Visita', 'Fecha', 'Hora', 'Tipo', 'Técnico', 'Estado', 'Aprobación'],
            L.sort((a, b) => String(b.fecha_programada).localeCompare(String(a.fecha_programada))).map((v) => [esc(v.id_escritorio || ''), esc(v.fecha_programada || ''), esc(v.hora || ''),
              esc(v.tipo_mantenimiento || ''), esc(v.tecnico_asignado || ''), esc(v.estado || ''), esc(v.aprobacion || '')])) : '<p>Sin visitas.</p>'); }
      } else if (ac.startsWith('cl_')) {
        const c = await uno('clientes', x.id); if (!c) throw new Error('Cliente no encontrado');
        const cab = `<h3>👥 ${esc(c.razon_social)}</h3>` + fichas([['Código', c.id_escritorio], ['RUC/Cédula', c.identificacion], ['Contacto', c.contacto], ['Teléfono', c.telefono], ['Correo', c.email], ['Ciudad', c.ciudad], ['Dirección', c.direccion]]);
        if (ac === 'cl_eq') { const L = await API.select('equipos', { id_cliente: c.id }).catch(() => []);
          h = cab + `<h4>⚡ Equipos (${L.length})</h4>` + (L.length ? U().tabla(['Serie', 'Marca', 'Modelo', 'kW', 'Ubicación', 'Estado'], L.map((e) => [esc(e.serie || ''), esc(e.marca || ''), esc(e.modelo || ''), esc(e.potencia_kw ?? ''), esc(e.ubicacion || ''), esc(e.estado || '')])) : '<p>Sin equipos.</p>'); }
        if (ac === 'cl_ot') { const L = await API.select('ordenes', { id_cliente: c.id }).catch(() => []); h = cab + `<h4>📋 Órdenes de trabajo (${L.length})</h4>` + (L.length ? otFilas(L) : '<p>Sin OT.</p>'); }
        if (ac === 'cl_ec') {
          if (!finanzas()) throw new Error('El estado de cuenta es solo para ADMIN y OPERADOR.');
          const L = (await API.select('facturas', { id_cliente: c.id_escritorio }).catch(() => [])).filter((f) => f.estado !== 'ANULADA');
          const tot = L.reduce((s, f) => s + Number(f.total || 0), 0), pag = L.reduce((s, f) => s + Number(f.pagado || 0) + Number(f.retenido || 0), 0), sal = L.reduce((s, f) => s + Number(f.saldo || 0), 0);
          const hoy = U().hoy(), venc = L.filter((f) => Number(f.saldo || 0) > 0.004 && f.fecha_vence && f.fecha_vence < hoy).reduce((s, f) => s + Number(f.saldo || 0), 0);
          h = cab + `<h4>💲 Estado de cuenta</h4><p style="font-size:14px"><b>Facturado:</b> ${dinero(tot)} · <b>Pagado+retenido:</b> ${dinero(pag)} · <b style="color:${sal > 0.004 ? '#A93226' : '#1E8449'}">Saldo: ${dinero(sal)}</b>${venc > 0.004 ? ` · <b style="color:#A93226">Vencido: ${dinero(venc)}</b>` : ''}</p>`
            + (L.length ? U().tabla(['Factura', 'Fecha', 'OT', 'Total', 'Pagado', 'Retenido', 'Saldo', 'Vence', 'Estado'], L.sort((a, b) => String(b.fecha_factura).localeCompare(String(a.fecha_factura)))
              .map((f) => [esc(f.numero || f.id_escritorio), esc(f.fecha_factura || ''), esc(f.numero_ot || ''), dinero(f.total), dinero(f.pagado), dinero(f.retenido), dinero(f.saldo), esc(f.fecha_vence || ''), esc(f.estado || '')])) : '<p>Sin facturas.</p>');
        }
      } else if (ac === 'ot') {
        const o = await uno('ordenes', x.id); if (!o) throw new Error('OT no encontrada');
        const acts = await API.select('ot_actividades', { id_orden: o.id }).catch(() => []);
        h = `<h3>📋 OT ${esc(o.numero_ot)}</h3>` + fichas([['Fecha', o.fecha], ['Cliente', o.cliente_nombre], ['Serie', o.serie], ['Tipo', o.tipo_ot], ['Estado', o.estado], ['Prioridad', o.prioridad],
          ['Horas máquina', o.horas_maquina], ['Origen', o.origen], ['Trabajo realizado', o.trabajo_realizado], ['Observaciones', o.observaciones], ['Recomendaciones', o.recomendaciones],
          ['Realizó', o.firma_realiza], ['Recibió', o.firma_recibe]].concat(finanzas() ? [['Valor total', o.valor_total != null ? dinero(o.valor_total) : '']] : []))
          + (o.pdf_url ? `<p><a class="btn-web mini sec" target="_blank" rel="noopener" href="${esc(o.pdf_url)}">📄 Ver PDF</a></p>` : '')
          + `<h4>🛠 Actividades (${acts.length})</h4>` + (acts.length ? U().tabla(['Actividad', 'Cantidad', 'Nivel'], acts.map((a) => [esc(a.descripcion || ''), esc(a.cantidad ?? ''), esc(a.nivel || '')])) : '<p>Sin actividades.</p>');
      } else if (ac === 'fac') {
        const f = await uno('facturas', x.id); if (!f) throw new Error('Factura no encontrada');
        h = `<h3>🧾 Factura ${esc(f.numero || f.id_escritorio)}</h3>` + fichas([['Código', f.id_escritorio], ['Cliente', f.id_cliente], ['OT', f.numero_ot], ['Serie', f.serie], ['Fecha factura', f.fecha_factura],
          ['Fecha trabajo', f.fecha_trabajo], ['Subtotal', dinero(f.subtotal)], ['IVA', dinero(f.iva_valor)], ['Total', dinero(f.total)], ['Pagado', dinero(f.pagado)], ['Retenido', dinero(f.retenido)],
          ['Saldo', dinero(f.saldo)], ['Vence', f.fecha_vence], ['Estado', f.estado], ['Observación', f.observacion]]);
        if (finanzas()) { const P = await API.select('factura_pagos', { id_factura: f.id_escritorio }).catch(() => []);
          h += `<h4>💵 Pagos (${P.length})</h4>` + (P.length ? U().tabla(['Fecha', 'Forma', 'Referencia', 'Valor'], P.map((p) => [esc(p.fecha || ''), esc(p.forma || ''), esc(p.referencia || ''), dinero(p.valor)])) : '<p>Sin pagos.</p>'); }
      } else if (ac === 'gui') {
        const g = await uno('guias', x.id); if (!g) throw new Error('Guía no encontrada');
        const I = await API.select('guia_items', { id_guia: g.id_escritorio }).catch(() => []);
        h = `<h3>🚚 Guía ${esc(g.numero || g.id_escritorio)}</h3>` + fichas([['Código', g.id_escritorio], ['OT', g.numero_ot], ['Serie', g.serie], ['Emisión', g.fecha_emision], ['Traslado', g.fecha_traslado],
          ['Motivo', g.motivo], ['Destino', g.destino], ['Transportista', g.transportista], ['Entregada a', g.entregada_a], ['Estado', g.estado], ['Recepción', g.recepcion_estado], ['Observación', g.observacion]])
          + `<h4>📦 Ítems (${I.length})</h4>` + (I.length ? U().tabla(['Código', 'Descripción', 'Unidad', 'Cantidad', 'Devuelto'], I.map((i) => [esc(i.codigo || ''), esc(i.descripcion || ''), esc(i.unidad || ''), esc(i.cantidad ?? ''), esc(i.devuelto ?? '')])) : '<p>Sin ítems.</p>');
      } else if (ac === 'kardex') {
        const p = await uno('repuestos', x.id); if (!p) throw new Error('Repuesto no encontrado');
        const M = await API.select('inv_movimientos', { id_repuesto: p.id_escritorio }).catch(() => []);
        h = `<h3>📦 Kardex · ${esc(p.codigo || '')} ${esc(p.descripcion || '')}</h3>` + fichas([['Código interno', p.id_escritorio], ['Stock', p.stock], ['Mínimo', p.stock_min], ['Máximo', p.stock_max], ['Unidad', p.unidad], ['Ubicación', p.ubicacion], ['Clase', p.clase]])
          + (M.length ? U().tabla(['Fecha', 'Tipo', 'Cantidad', 'Saldo', 'Motivo', 'Referencia'], M.sort((a, b) => String(b.fecha_creacion || b.fecha).localeCompare(String(a.fecha_creacion || a.fecha)))
            .map((m) => [esc(m.fecha || ''), esc(m.tipo || ''), esc(m.cantidad ?? ''), esc(m.saldo ?? ''), esc(m.motivo || ''), esc(m.referencia || '')])) : '<p>Sin movimientos.</p>');
      } else if (ac === 'vis') {
        const v = await uno('visitas_programadas', x.id); if (!v) throw new Error('Visita no encontrada');
        h = `<h3>📅 Visita ${esc(v.id_escritorio)}</h3>` + fichas([['Fecha', v.fecha_programada], ['Hora', v.hora], ['Serie', v.serie], ['Tipo', v.tipo_mantenimiento], ['Técnico', v.tecnico_asignado],
          ['Estado', v.estado], ['Aprobación', v.aprobacion], ['Solicitado por', v.solicitado_por], ['Aprobado por', v.aprobado_por], ['Contacto cita', v.contacto_cita], ['Teléfono cita', v.telefono_cita],
          ['Novedad del técnico', v.novedad_tecnico], ['Observación', v.observacion]]);
      } else if (ac === 'srv') {
        const s = await uno('servicios', x.id); if (!s) throw new Error('Orden de servicio no encontrada');
        const E = await API.select('servicio_eventos', { id_servicio: s.id_escritorio }).catch(() => []);
        h = `<h3>🗂 Orden de servicio ${esc(s.id_escritorio)}</h3>` + fichas([['Apertura', s.fecha_apertura], ['Cliente', s.id_cliente], ['Serie', s.serie], ['Tipo', s.tipo_servicio], ['Origen', s.origen],
          ['Etapa', s.etapa], ['Estado', s.estado], ['Visita', s.id_visita], ['OT', s.id_ot], ['Guía', s.id_guia], ['Factura', s.id_factura], ['Observación', s.observacion]])
          + `<h4>🕑 Eventos (${E.length})</h4>` + (E.length ? U().tabla(['Fecha', 'Etapa', 'Detalle', 'Usuario'], E.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
            .map((e) => [esc(String(e.fecha || '').replace('T', ' ').slice(0, 16)), esc(e.etapa || ''), esc(e.detalle || ''), esc(e.usuario || '')])) : '<p>Sin eventos.</p>');
      }
    } catch (e) { h = '<p style="color:#C0392B">❌ ' + esc(e.message) + '</p>'; }
    if (t !== turno && !U().$id('bgDet')) return;
    const d2 = U().$id('bgDet'); if (d2) d2.innerHTML = h + '<div style="text-align:right"><button class="btn-web sec" id="bgDetX">Cerrar detalle</button></div>';
    const x2 = U().$id('bgDetX'); if (x2) x2.onclick = () => { d2.style.display = 'none'; };
  }
  V._buscador = { boton, buscar };
})();
