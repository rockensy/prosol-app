/* PROSOL web PC · lib/web_ordenes.js (v4.08 · W6-2 Órdenes de trabajo — checklist aprobado por Luis 28/11/2026)
   P1 Lista igual al escritorio: N°, Fecha, Cliente, Serie, Tipo, Técnico, Estado, Valor, Origen; buscador por palabras con
      «Parcial (contiene)»; filtros estado / origen / desde-hasta; orden por columna; OT liquidadas o facturadas en gris.
   P2 Ficha completa: Datos, Mano de obra, Insumos, Fotos, Cierre/Firmas + 📄 PDF, 💬 WhatsApp, 🧾 Facturar, 🚚 Guía.
   P3 ✏️ Editar (ADMIN y OPERADOR): bloqueada si la OT está liquidada o facturada; queda marcada para el escritorio.
   P4 🗑 Borrar: solo ADMIN, con motivo y confirmación (función de la nube ot_borrar; el escritorio también lo aplica).
   P5 ✅ Revisión para facturar (tarjeta de web_exp_modulos), 🧾 Facturar / 🚚 Guía con la OT, 🖨 Reporte PDF de varias OT,
      🔢 Corregir N° físico / OT repetidas.
   P7 🔍 Duplicados (mismo N° en 2+ registros) con 4 decisiones + aviso fijo; 📥 Bajar campo con análisis previo y vista
      previa (nueva · igual · completar · a revisar); la web integra en la nube sin esperar al escritorio.
   Módulo fuera del IIFE base: reemplaza la vista «Órdenes OT». */
(() => {
  const V = window.PROSOL_WEB_VISTAS = window.PROSOL_WEB_VISTAS || {};
  const U = () => PROSOL_WEB.util;
  const esc = (s) => U().ESC(s);
  const n = (x) => { const v = parseFloat(x); return isFinite(v) ? v : 0; };
  const d2 = (x) => n(x).toFixed(2);
  const ISO = () => new Date().toISOString();
  const PIE = 'Potenciado por ROCKENSY S.A. &amp; MIG — Tec. Master Luis Martínez Ibáñez';
  function rol() {
    try { const s = API.sesionNube && API.sesionNube(); if (s && s.rol) return String(s.rol).toUpperCase(); } catch (e) {}
    return String((window._prosolSesion || {}).perfil || '').toUpperCase();
  }
  function usuario() {
    try { const s = API.sesionNube && API.sesionNube(); if (s && s.usuario) return s.usuario; } catch (e) {}
    const s = window._prosolSesion || {}; return s.usuario || s.nombre || 'web';
  }
  const edita = () => ['ADMIN', 'OPERADOR'].includes(rol());
  const esAdmin = () => rol() === 'ADMIN';
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const F = { q: '', parcial: false, est: '', orig: '', desde: '', hasta: '', col: 'num', asc: false, max: 300 };
  let D = null, turno = 0;

  // ── Búsqueda igual al escritorio (coincide_busqueda): palabras con letras = contenidas; con números = exactas
  //    contra N° de OT o serie, salvo «Parcial (contiene)».
  function coincide(o, q, parcial) {
    const terms = norm(q).split(/\s+/).filter(Boolean); if (!terms.length) return true;
    const texto = norm([o.numero_ot, nomCli(o), o.tipo_ot, o.estado, o.serie, o.firma_realiza, o.id_escritorio].join(' '));
    return terms.every((t) => {
      if (parcial || /\d|\*/.test(t)) {
        const tt = t.replace(/\*/g, '');
        const campos = [o.numero_ot, o.serie, o.id_escritorio].map(norm);
        return parcial || t.includes('*') ? campos.some((c) => c.includes(tt)) : campos.some((c) => c === tt);
      }
      return texto.includes(t);
    });
  }
  const nomCli = (o) => ((D && D.C[o.id_cliente]) || {}).razon_social || o.cliente_nombre || '';
  const bloqueo = (o) => (D && D.B[String(o.numero_ot || '')]) || '';

  async function cargar() {
    const [ord, cli, eq, tec, acts, items, bloq, dup] = await Promise.all([
      API.select('ordenes').catch(() => []), API.select('clientes').catch(() => []), API.select('equipos').catch(() => []),
      API.select('tecnicos').catch(() => []), API.select('actividades').catch(() => []), API.select('actividad_items').catch(() => []),
      API.rpc('ots_bloqueadas', {}).catch(() => []), API.rpc('ot_duplicados_pendientes', {}).catch(() => [])]);
    const C = {}; cli.forEach((c) => { C[c.id] = c; }); const E = {}; eq.forEach((e) => { E[e.id] = e; });
    const B = {}; (bloq || []).forEach((b) => { if (!B[b.numero_ot]) B[b.numero_ot] = b.motivo; });
    D = { ord, cli, eq, tec, acts, items, C, E, B, dup: dup || [] };
    return D;
  }

  // ── P1 · Lista ─────────────────────────────────────────────────────
  const COLS = [['num', 'N° Orden'], ['fec', 'Fecha'], ['cli', 'Cliente'], ['ser', 'Serie'], ['tip', 'Tipo'], ['tec', 'Técnico'],
    ['est', 'Estado'], ['val', 'Valor'], ['ori', 'Origen']];
  const CLAVE = { num: (o) => parseInt(o.numero_ot, 10) || 0, fec: (o) => o.fecha || '', cli: (o) => norm(nomCli(o)), ser: (o) => o.serie || '',
    tip: (o) => o.tipo_ot || '', tec: (o) => o.firma_realiza || '', est: (o) => o.estado || '', val: (o) => n(o.valor_total), ori: (o) => o.origen || '' };
  const COL_EST = { REALIZADO: '#27AE60', 'EN PROCESO': '#F39C12', ABIERTA: '#E74C3C', 'POR REVISAR': '#E67E22', FINALIZADA: '#27AE60' };

  V.ordenes = async () => {
    if (!API.hayNube()) return PROSOL_WEB.vistaBase('ordenes')();
    const t = ++turno, main = U().$id('main');
    main.innerHTML = '<div class="card" id="orCard"><h2>📋 Órdenes de trabajo</h2><div id="orLista">Cargando…</div></div>';
    await cargar();
    if (t !== turno || !document.getElementById('orCard')) return;
    const estados = [...new Set(D.ord.map((o) => o.estado).filter(Boolean))].sort();
    const origenes = [...new Set(D.ord.map((o) => o.origen).filter(Boolean))].sort();
    const campo = D.ord.filter((o) => o.origen === 'CAMPO' && !o.integrada_web).length;
    U().$id('orCard').innerHTML = `<h2>📋 Órdenes de trabajo</h2>
      <div class="toolbar" style="flex-wrap:wrap;gap:6px">
        <input id="orQ" class="inp-web" style="max-width:260px" placeholder="Buscar N°, cliente, serie, tipo…" value="${esc(F.q)}">
        <label style="font-size:13px;white-space:nowrap"><input type="checkbox" id="orPar" ${F.parcial ? 'checked' : ''}> Parcial (contiene)</label>
        <select id="orEst" class="inp-web" style="max-width:150px"><option value="">Todos los estados</option>${estados.map((x) => `<option ${F.est === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <select id="orOri" class="inp-web" style="max-width:150px"><option value="">Todos los orígenes</option>${origenes.map((x) => `<option ${F.orig === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <label style="font-size:12px">Desde <input id="orDes" type="date" class="inp-web" style="width:auto" value="${esc(F.desde)}"></label>
        <label style="font-size:12px">Hasta <input id="orHas" type="date" class="inp-web" style="width:auto" value="${esc(F.hasta)}"></label>
      </div>
      <div class="toolbar" style="flex-wrap:wrap;gap:6px;margin-top:4px">
        ${edita() ? '<button class="btn-web prim" id="orNueva">➕ Nueva OT</button>' : ''}
        ${edita() ? `<button class="btn-web verd" id="orBajar">📥 Bajar campo${campo ? ' (' + campo + ')' : ''}</button>` : ''}
        <button class="btn-web sec" id="orDup">🔍 Duplicados: ${D.dup.length}</button>
        <button class="btn-web sec" id="orRep">🖨 Reporte PDF de varias OT</button>
        <span id="orCuenta" style="font-size:12px;color:#566573;margin-left:auto"></span>
      </div><div id="orLista"></div>`;
    const $ = (id) => U().$id(id);
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on('orQ', 'input', (e) => { F.q = e.target.value; F.max = 300; pintar(); });
    on('orPar', 'change', (e) => { F.parcial = e.target.checked; pintar(); });
    on('orEst', 'change', (e) => { F.est = e.target.value; pintar(); });
    on('orOri', 'change', (e) => { F.orig = e.target.value; pintar(); });
    on('orDes', 'change', (e) => { F.desde = e.target.value; pintar(); });
    on('orHas', 'change', (e) => { F.hasta = e.target.value; pintar(); });
    on('orNueva', 'click', () => PROSOL_WEB.formNuevaOT(null, D.eq, D.cli, D.tec, () => V.ordenes(), D.acts, D.items));
    on('orBajar', 'click', () => bajarCampo());
    on('orDup', 'click', () => duplicados());
    on('orRep', 'click', () => reporte());
    pintar();
    tarjetaRevision();
    avisoDup(D.dup.length);
  };

  function filtradas() {
    return D.ord.filter((o) => coincide(o, F.q, F.parcial) && (!F.est || o.estado === F.est) && (!F.orig || o.origen === F.orig)
      && (!F.desde || String(o.fecha || '') >= F.desde) && (!F.hasta || String(o.fecha || '').slice(0, 10) <= F.hasta))
      .sort((a, b) => { const ka = CLAVE[F.col](a), kb = CLAVE[F.col](b); const r = ka < kb ? -1 : ka > kb ? 1 : 0;
        return (F.asc ? r : -r) || (CLAVE.num(b) - CLAVE.num(a)); });
  }
  function pintar() {
    const L = filtradas(), cont = U().$id('orLista'); if (!cont) return;
    const ver = L.slice(0, F.max);
    U().$id('orCuenta').textContent = L.length + ' orden(es)' + (L.length > ver.length ? ' · se muestran ' + ver.length : '');
    const th = COLS.map(([k, x]) => `<th data-col="${k}" style="cursor:pointer;white-space:nowrap">${x}${F.col === k ? (F.asc ? ' ▲' : ' ▼') : ''}</th>`).join('') + '<th></th>';
    const filas = ver.map((o) => {
      const b = bloqueo(o), gris = b ? 'color:#95A5A6;background:#F4F6F6' : '';
      const acc = `<span style="white-space:nowrap">${o.pdf_url ? `<a class="btn-web mini prim" href="${esc(o.pdf_url)}" target="_blank" rel="noopener" title="PDF de la orden">📄</a> ` : ''}`
        + `<button class="btn-web mini sec" data-o="ver" data-id="${o.id}">👁 Ver</button>`
        + (edita() && !b ? ` <button class="btn-web mini sec" data-o="edi" data-id="${o.id}" title="Editar">✏️</button>` : '')
        + (esAdmin() && !b ? ` <button class="btn-web mini" style="background:#C0392B;color:#fff" data-o="del" data-id="${o.id}" title="Borrar (solo ADMIN)">🗑</button>` : '') + '</span>';
      return `<tr style="${gris}" ${b ? `title="${esc(b)}: no se modifica"` : ''}><td><b>${esc(o.numero_ot || '—')}</b></td><td>${esc(String(o.fecha || '').slice(0, 10))}</td><td>${esc(nomCli(o))}</td>
        <td>${esc(o.serie || '')}</td><td>${esc(o.tipo_ot || '')}</td><td>${esc(o.firma_realiza || '')}</td>
        <td><span style="color:${b ? '#95A5A6' : (COL_EST[o.estado] || '#555')};font-weight:700">${esc(o.estado || '')}</span>${b ? `<br><small>🔒 ${esc(b)}</small>` : ''}</td>
        <td style="text-align:right">${d2(o.valor_total)}</td><td><small>${esc(o.origen || '')}${o.editado_web ? ' · ✏️ web' : ''}</small></td><td>${acc}</td></tr>`;
    }).join('');
    cont.innerHTML = `<div class="tbl-wrap"><table id="orTabla"><thead><tr>${th}</tr></thead><tbody>${filas || '<tr><td colspan="10">Sin órdenes con ese filtro.</td></tr>'}</tbody></table></div>`
      + (L.length > ver.length ? `<div style="text-align:center;margin-top:6px"><button class="btn-web sec" id="orMas">Mostrar más</button></div>` : '');
    cont.querySelectorAll('[data-col]').forEach((h) => h.onclick = () => { const k = h.dataset.col; if (F.col === k) F.asc = !F.asc; else { F.col = k; F.asc = k !== 'num' && k !== 'fec' && k !== 'val'; } pintar(); });
    cont.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => { const o = D.ord.find((x) => x.id === b.dataset.id); if (!o) return;
      if (b.dataset.o === 'ver') ficha(o); else if (b.dataset.o === 'edi') editar(o); else borrar(o); });
    const m = U().$id('orMas'); if (m) m.onclick = () => { F.max += 300; pintar(); };
  }

  // P5 · tarjeta «✅ Revisión para facturar» (misma de web_exp_modulos) arriba de la lista
  let revAbierta = false;
  function tarjetaRevision() {
    const main = U().$id('main'); if (!main || !window.PROSOL_EXP || document.getElementById('revFact')) return;
    main.insertAdjacentHTML('afterbegin', `<div class="card" id="revFact"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn-web ${revAbierta ? 'prim' : 'sec'}" id="revFactBtn">✅ Revisión para facturar</button>
      <span style="font-size:12px;color:#566573">Expedientes con OT: lista de revisión, aprobar para facturar o pedir corrección (igual que Expedientes).</span></div>
      <div id="revFactCuerpo" style="margin-top:8px"></div></div>`);
    const pintarR = () => { U().$id('revFactBtn').className = 'btn-web ' + (revAbierta ? 'prim' : 'sec'); const c = U().$id('revFactCuerpo'); if (revAbierta) PROSOL_EXP.panel(c, 'revision'); else c.innerHTML = ''; };
    U().$id('revFactBtn').onclick = () => { revAbierta = !revAbierta; pintarR(); };
    pintarR();
  }

  // ── P2 · Ficha completa ────────────────────────────────────────────
  async function detalle(o) {
    const [acts, fotos, tecs, reps, vis] = await Promise.all([
      API.select('ot_actividades', { id_orden: o.id }).catch(() => []), API.select('ot_fotos', { id_orden: o.id }).catch(() => []),
      API.select('ot_tecnicos', { id_orden: o.id }).catch(() => []), API.select('ot_repuestos', { id_orden: o.id }).catch(() => []),
      o.serie ? API.select('visitas_programadas', { serie: o.serie }).catch(() => []) : []]);
    let fj = o.ot_fotos; if (typeof fj === 'string') { try { fj = JSON.parse(fj); } catch (e) { fj = []; } }
    const todas = fotos.map((f) => ({ id: f.id, url: f.data_url, tipo: f.tipo || 'EVIDENCIA', nombre: f.nombre_archivo || '' }))
      .concat((Array.isArray(fj) ? fj : []).map((f) => ({ url: f.data_url, tipo: f.tipo || 'EVIDENCIA', nombre: f.nombre_archivo || '', json: true })));
    const visita = vis.find((v) => String(v.fecha_programada || '').slice(0, 10) === String(o.fecha || '').slice(0, 10));
    const insVis = visita ? (await API.select('visita_repuestos', { id_visita: visita.id_escritorio }).catch(() => [])).filter((x) => x.estado_ins !== 'ANULADO') : [];
    return { acts, fotos: todas, tecs, reps, visita, insVis };
  }
  const esFirma = (f) => /firma/i.test((f.tipo || '') + ' ' + (f.nombre || ''));
  async function ficha(o) {
    U().modal(`<h3>OT N° ${esc(o.numero_ot || '')}</h3><p>Cargando…</p>`);
    const d = await detalle(o), b = bloqueo(o), e = D.E[o.id_equipo] || {};
    const sec = (t, h) => `<h4 style="margin:12px 0 4px;border-bottom:1px solid #D5DBE1">${t}</h4>${h}`;
    const fila = (k, v) => `<tr><td style="color:#566573;padding:2px 8px 2px 0;white-space:nowrap">${k}</td><td>${v}</td></tr>`;
    const totAct = d.acts.reduce((s, a) => s + n(a.valor) * (n(a.cantidad) || 1), 0);
    const ins = d.insVis.map((x) => [esc(x.descripcion || x.id_repuesto), n(x.cantidad), esc(x.estado_ins || ''), 'Visita ' + esc(d.visita.id_escritorio)])
      .concat(d.reps.map((x) => [esc(x.descripcion || x.id_repuesto), n(x.cantidad), esc(x.movimiento || ''), 'OT (' + esc(x.origen || '') + ')']));
    const evid = d.fotos.filter((f) => !esFirma(f)), firmas = d.fotos.filter(esFirma);
    const img = (f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" style="width:110px;height:110px;object-fit:cover;border-radius:6px;border:1px solid #D5DBE1"></a>`;
    U().modal(`<h3>OT N° ${esc(o.numero_ot || '')} ${b ? `<small style="color:#95A5A6">🔒 ${esc(b)}</small>` : ''}</h3>
      ${sec('Datos', `<table style="font-size:13px">${fila('Fecha', esc(String(o.fecha || '').slice(0, 10)))}${fila('Cliente', esc(nomCli(o)))}
        ${fila('Equipo', esc([e.nombre_equipo || e.modelo, o.serie].filter(Boolean).join(' · ')))}${fila('Tipo', esc(o.tipo_ot || ''))}
        ${fila('Estado', esc(o.estado || ''))}${fila('Técnico', esc(o.firma_realiza || '') + (d.tecs.length ? ' · ' + d.tecs.map((x) => esc(x.nombre_tecnico || '')).join(', ') : ''))}
        ${fila('Horas máquina', esc(o.horas_maquina == null ? '' : o.horas_maquina))}${fila('Origen', esc(o.origen || '') + (o.editado_web ? ' · editada en web por ' + esc(o.editado_por || '') : ''))}
        ${o.gps_link || o.gps_lat ? fila('Ubicación', `<a href="${esc(o.gps_link || ('https://maps.google.com/?q=' + o.gps_lat + ',' + o.gps_lng))}" target="_blank" rel="noopener">📍 Ver mapa</a>`) : ''}
        ${fila('Trabajo realizado', esc(o.trabajo_realizado || '').replace(/\n/g, '<br>'))}${fila('Observaciones', esc(o.observaciones || '').replace(/\n/g, '<br>'))}
        ${fila('Recomendaciones', esc(o.recomendaciones || '').replace(/\n/g, '<br>'))}</table>`)}
      ${sec('Mano de obra', d.acts.length ? U().tabla(['Actividad', 'Cant.', 'Valor'], d.acts.map((a) => [esc(a.descripcion || ''), n(a.cantidad) || 1, d2(a.valor)]))
        + `<p style="text-align:right;font-weight:700">Total actividades: $${d2(totAct)} · Valor OT: $${d2(o.valor_total)}</p>` : '<p style="color:#888">Sin actividades.</p>')}
      ${sec('Insumos', ins.length ? U().tabla(['Insumo', 'Cant.', 'Estado', 'De'], ins) : '<p style="color:#888">Sin insumos.</p>')}
      ${sec('Fotos', evid.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${evid.map(img).join('')}</div>` : '<p style="color:#888">Sin fotos.</p>')}
      ${sec('Cierre / Firmas', `<table style="font-size:13px">${fila('Solicita', esc(o.firma_solicita || ''))}${fila('Recibe', esc(o.firma_recibe || ''))}${fila('Realiza', esc(o.firma_realiza || ''))}</table>
        ${firmas.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${firmas.map(img).join('')}</div>` : ''}`)}
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px">
        ${o.pdf_url ? `<a class="btn-web prim" href="${esc(o.pdf_url)}" target="_blank" rel="noopener">📄 PDF</a>` : `<button class="btn-web sec" id="fiPdf">📄 PDF</button>`}
        <button class="btn-web prim" id="fiWa">💬 WhatsApp</button>
        ${edita() ? '<button class="btn-web sec" id="fiFac">🧾 Facturar OT</button><button class="btn-web sec" id="fiGui">🚚 Guía de remisión</button>' : ''}
        ${edita() && !b ? '<button class="btn-web sec" id="fiEdi">✏️ Editar</button>' : ''}
        <button class="btn-web sec" id="fiX">Cerrar</button></div>`);
    const on = (id, fn) => { const el = U().$id(id); if (el) el.onclick = fn; };
    on('fiX', () => U().cerrarModal());
    on('fiPdf', () => imprimir([o], 'Orden de trabajo N° ' + (o.numero_ot || ''), { [o.id]: d }));
    on('fiWa', () => { U().cerrarModal(); PROSOL_WEB.ir('whatsapp'); setTimeout(() => { const s = U().$id('waOrdSel'); if (s) { s.value = o.id; const p = U().$id('btnWaPrev'); if (p) p.click(); } }, 500); });
    on('fiFac', () => { U().cerrarModal(); window._prosolFacturarOT = o.numero_ot; PROSOL_WEB.ir('facturacion'); });
    on('fiGui', () => { U().cerrarModal(); window._prosolGuiaOT = o.numero_ot; PROSOL_WEB.ir('inventario'); });
    on('fiEdi', () => editar(o));
  }

  // ── P3 · Editar (ADMIN y OPERADOR; nunca liquidada o facturada) ───────
  async function editar(o) {
    if (!edita()) return;
    const b = bloqueo(o); if (b) { U().toast('⛔ La OT ' + o.numero_ot + ' está en ' + b + ': no se modifica'); return; }
    U().modal('<h3>✏️ Editar OT</h3><p>Cargando…</p>');
    const d = await detalle(o);
    let acts = d.acts.map((a) => ({ descripcion: a.descripcion || '', cantidad: n(a.cantidad) || 1, valor: n(a.valor), nivel: a.nivel }));
    let fotos = d.fotos.slice(), nuevas = [], quitar = [];
    const tecs = D.tec.map((x) => ((x.nombres || '') + ' ' + (x.apellidos || '')).trim()).filter(Boolean);
    const inp = (lab, id, val, tipo) => `<div><label style="font-size:12px;font-weight:700">${lab}</label><input class="inp-web" id="${id}" ${tipo ? 'type="' + tipo + '"' : ''} value="${esc(val == null ? '' : val)}"></div>`;
    const area = (lab, id, val) => `<label style="font-size:12px;font-weight:700;display:block;margin-top:6px">${lab}</label><textarea class="inp-web" id="${id}" rows="2">${esc(val || '')}</textarea>`;
    U().modal(`<h3>✏️ Editar OT N° ${esc(o.numero_ot || '')}</h3>
      <div class="grid2">${inp('Fecha', 'edFec', String(o.fecha || '').slice(0, 10), 'date')}${inp('Tipo', 'edTip', o.tipo_ot)}
        <div><label style="font-size:12px;font-weight:700">Estado</label><select class="inp-web" id="edEst">${['REALIZADO', 'EN PROCESO', 'ABIERTA', 'POR REVISAR', 'FINALIZADA']
          .concat(o.estado && !['REALIZADO', 'EN PROCESO', 'ABIERTA', 'POR REVISAR', 'FINALIZADA'].includes(o.estado) ? [o.estado] : []).map((x) => `<option ${o.estado === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div><label style="font-size:12px;font-weight:700">Técnico</label><input class="inp-web" id="edTec" list="edTecL" value="${esc(o.firma_realiza || '')}"><datalist id="edTecL">${tecs.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
        ${inp('Horas máquina', 'edHor', o.horas_maquina, 'number')}${inp('Firma solicita', 'edSol', o.firma_solicita)}${inp('Firma recibe', 'edRec', o.firma_recibe)}</div>
      ${area('Trabajo realizado', 'edTra', o.trabajo_realizado)}${area('Observaciones', 'edObs', o.observaciones)}${area('Recomendaciones', 'edRco', o.recomendaciones)}
      <h4 style="margin:10px 0 4px">Mano de obra</h4><div id="edActs"></div>
      <div style="display:flex;gap:6px;margin-top:4px"><input class="inp-web" id="edANd" placeholder="Actividad" style="flex:1"><input class="inp-web" id="edANc" type="number" step="any" value="1" style="width:70px">
        <input class="inp-web" id="edANv" type="number" step="any" value="0" style="width:90px"><button class="btn-web sec" id="edAAdd">➕</button></div>
      <h4 style="margin:10px 0 4px">Fotos</h4><div id="edFotos" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      <input type="file" id="edFile" accept="image/*" multiple style="display:none"><button class="btn-web sec" id="edFAdd" style="margin-top:4px">📷 Agregar foto(s)</button>
      <div id="edErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn-web sec" id="edX">Cancelar</button><button class="btn-web prim" id="edOk">💾 Guardar cambios</button></div>`);
    const $ = (id) => U().$id(id);
    const pintaActs = () => {
      $('edActs').innerHTML = acts.length ? U().tabla(['Actividad', 'Cant.', 'Valor', ''], acts.map((a, i) => [esc(a.descripcion), a.cantidad, d2(a.valor), `<button class="btn-web mini sec" data-qa="${i}">🗑</button>`]))
        + `<p style="text-align:right;font-weight:700;margin:2px 0">Total: $${d2(acts.reduce((s, a) => s + a.valor * a.cantidad, 0))}</p>` : '<p style="color:#888">Sin actividades.</p>';
      $('edActs').querySelectorAll('[data-qa]').forEach((x) => x.onclick = () => { acts.splice(+x.dataset.qa, 1); pintaActs(); });
    };
    const pintaFotos = () => {
      $('edFotos').innerHTML = fotos.map((f, i) => `<div style="position:relative"><img src="${esc(f.url)}" style="width:90px;height:90px;object-fit:cover;border-radius:6px">
        <button class="btn-web mini" style="position:absolute;top:2px;right:2px;background:#C0392B;color:#fff" data-qf="${i}">✕</button></div>`).join('')
        + nuevas.map((f) => `<img src="${esc(f.dataUrl)}" style="width:90px;height:90px;object-fit:cover;border-radius:6px;outline:2px solid #27AE60">`).join('');
      $('edFotos').querySelectorAll('[data-qf]').forEach((x) => x.onclick = () => { quitar.push(fotos[+x.dataset.qf]); fotos.splice(+x.dataset.qf, 1); pintaFotos(); });
    };
    pintaActs(); pintaFotos();
    $('edAAdd').onclick = () => { const de = $('edANd').value.trim(); if (!de) return; acts.push({ descripcion: de, cantidad: n($('edANc').value) || 1, valor: n($('edANv').value) }); $('edANd').value = ''; pintaActs(); };
    $('edFAdd').onclick = () => $('edFile').click();
    $('edFile').onchange = (ev) => { [...ev.target.files].forEach((f) => { const r = new FileReader(); r.onload = () => { nuevas.push({ dataUrl: r.result, nombre: f.name }); pintaFotos(); }; r.readAsDataURL(f); }); };
    $('edX').onclick = () => U().cerrarModal();
    $('edOk').onclick = async () => {
      $('edOk').disabled = true; $('edErr').textContent = '';
      try {
        // la nube puede haber liquidado/facturado la OT mientras se editaba
        const bl = ((await API.rpc('ots_bloqueadas', {}).catch(() => [])) || []).find((x) => String(x.numero_ot) === String(o.numero_ot));
        if (bl) throw new Error('La OT está en ' + bl.motivo + ': no se modifica');
        const total = acts.reduce((s, a) => s + a.valor * a.cantidad, 0);
        const cambios = { fecha: $('edFec').value || o.fecha, tipo_ot: $('edTip').value.trim(), estado: $('edEst').value, firma_realiza: $('edTec').value.trim(),
          horas_maquina: $('edHor').value === '' ? null : n($('edHor').value), firma_solicita: $('edSol').value.trim(), firma_recibe: $('edRec').value.trim(),
          trabajo_realizado: $('edTra').value, observaciones: $('edObs').value, recomendaciones: $('edRco').value,
          valor_total: acts.length ? total : n(o.valor_total), editado_web: ISO(), editado_por: usuario() };
        await API.update('ordenes', o.id, cambios);
        for (const a of d.acts) await API.remove('ot_actividades', a.id);
        for (const a of acts) await API.insert('ot_actividades', { id_orden: o.id, descripcion: a.descripcion, cantidad: a.cantidad, valor: a.valor, nivel: a.nivel || null });
        for (const f of quitar) if (f.id) await API.remove('ot_fotos', f.id);
        if (quitar.some((f) => f.json)) { const resto = fotos.filter((f) => f.json).map((f) => ({ data_url: f.url, tipo: f.tipo, nombre_archivo: f.nombre })); await API.update('ordenes', o.id, { ot_fotos: resto }); }
        const sello = Date.now();
        for (let i = 0; i < nuevas.length; i++) {
          let url = nuevas[i].dataUrl;
          try { url = await API.subirFoto('ot/pc-' + (o.numero_ot || 'sin-numero') + '/' + sello + '_' + i + '_' + (nuevas[i].nombre || 'foto.jpg'), url); } catch (e) {}
          await API.insert('ot_fotos', { id_orden: o.id, tipo: 'EVIDENCIA', nombre_archivo: nuevas[i].nombre || 'foto.jpg', data_url: url });
        }
        U().cerrarModal(); U().toast('✅ OT ' + o.numero_ot + ' actualizada (llega al escritorio en la próxima sincronización)'); V.ordenes();
      } catch (e) { $('edErr').textContent = '❌ ' + e.message; $('edOk').disabled = false; }
    };
  }

  // ── P4 · Borrar (solo ADMIN, con motivo y confirmación) ──────────────
  function borrar(o, despues) {
    if (!esAdmin()) { U().toast('Solo el ADMIN puede borrar una OT'); return; }
    const b = bloqueo(o); if (b) { U().toast('⛔ La OT ' + o.numero_ot + ' está en ' + b + ': no se borra'); return; }
    U().modal(`<h3 style="color:#C0392B">🗑 Borrar la OT N° ${esc(o.numero_ot || '')}</h3>
      <p>${esc(nomCli(o))} · ${esc(o.serie || '')} · ${esc(String(o.fecha || '').slice(0, 10))} · ${esc(o.id_escritorio || '')}</p>
      <p style="background:#FDEDEC;padding:8px;border-radius:6px;font-size:13px">Se borra de la nube con sus actividades, fotos, técnicos e insumos y el escritorio la borra en su próxima sincronización (con respaldo). <b>No se puede deshacer.</b></p>
      <label style="font-size:12px;font-weight:700">Motivo del borrado *</label><input class="inp-web" id="boMot">
      <label style="font-size:13px;display:block;margin-top:6px"><input type="checkbox" id="boOk"> Confirmo que quiero borrar esta OT para siempre</label>
      <div id="boErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn-web sec" id="boX">Cancelar</button><button class="btn-web" style="background:#C0392B;color:#fff" id="boSi">🗑 Borrar</button></div>`);
    U().$id('boX').onclick = () => U().cerrarModal();
    U().$id('boSi').onclick = async () => {
      const mot = U().$id('boMot').value.trim();
      if (!mot) { U().$id('boErr').textContent = 'Indique el motivo.'; return; }
      if (!U().$id('boOk').checked) { U().$id('boErr').textContent = 'Marque la confirmación.'; return; }
      try { await API.rpc('ot_borrar', { p_id: o.id, p_motivo: mot, p_por: usuario() }); U().cerrarModal(); U().toast('🗑 OT ' + o.numero_ot + ' borrada'); (despues || V.ordenes)(); }
      catch (e) { U().$id('boErr').textContent = '❌ ' + e.message; }
    };
  }

  // ── P5 · Reporte PDF de varias OT (lo filtrado, o un rango de N°) ─────
  function reporte() {
    const L = filtradas();
    U().modal(`<h3>🖨 Reporte PDF de varias órdenes</h3>
      <p style="font-size:13px">Se imprimen las órdenes del filtro actual (${L.length}). Puede limitar por rango de N°:</p>
      <div style="display:flex;gap:8px"><input class="inp-web" id="rpD" type="number" placeholder="N° desde"><input class="inp-web" id="rpH" type="number" placeholder="N° hasta"></div>
      <label style="font-size:13px;display:block;margin-top:6px"><input type="checkbox" id="rpAct" checked> Incluir actividades de cada OT</label>
      <div id="rpErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn-web sec" id="rpX">Cancelar</button><button class="btn-web prim" id="rpOk">🖨 Generar</button></div>`);
    U().$id('rpX').onclick = () => U().cerrarModal();
    U().$id('rpOk').onclick = async () => {
      const de = n(U().$id('rpD').value), ha = n(U().$id('rpH').value);
      const sel = L.filter((o) => { const k = parseInt(o.numero_ot, 10) || 0; return (!de || k >= de) && (!ha || k <= ha); }).sort((a, b) => CLAVE.num(a) - CLAVE.num(b));
      if (!sel.length) { U().$id('rpErr').textContent = 'No hay órdenes en ese rango.'; return; }
      if (sel.length > 400) { U().$id('rpErr').textContent = 'Son ' + sel.length + ' órdenes: limite el rango (máx. 400).'; return; }
      U().$id('rpOk').disabled = true;
      const det = {};
      if (U().$id('rpAct').checked) for (const o of sel) det[o.id] = { acts: await API.select('ot_actividades', { id_orden: o.id }).catch(() => []) };
      U().cerrarModal(); imprimir(sel, 'Reporte de órdenes de trabajo' + (de || ha ? ' · N° ' + (de || '…') + ' a ' + (ha || '…') : ''), det);
    };
  }
  function imprimir(L, titulo, det) {
    const w = window.open('', '_blank'); if (!w) { U().toast('Permita las ventanas emergentes para imprimir'); return; }
    const tot = L.reduce((s, o) => s + n(o.valor_total), 0);
    const cuerpo = L.map((o) => { const a = (det[o.id] || {}).acts || [];
      return `<tr><td><b>${esc(o.numero_ot || '')}</b></td><td>${esc(String(o.fecha || '').slice(0, 10))}</td><td>${esc(nomCli(o))}</td><td>${esc(o.serie || '')}</td>
        <td>${esc(o.tipo_ot || '')}</td><td>${esc(o.firma_realiza || '')}</td><td>${esc(o.estado || '')}</td><td style="text-align:right">${d2(o.valor_total)}</td></tr>`
        + (a.length ? `<tr><td></td><td colspan="7" style="font-size:10px;color:#444">${a.map((x) => esc(x.descripcion || '') + ' (' + (n(x.cantidad) || 1) + ' × $' + d2(x.valor) + ')').join(' · ')}</td></tr>` : '')
        + (L.length === 1 && o.trabajo_realizado ? `<tr><td></td><td colspan="7" style="font-size:11px"><b>Trabajo realizado:</b> ${esc(o.trabajo_realizado).replace(/\n/g, '<br>')}</td></tr>` : ''); }).join('');
    w.document.write(`<html><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:18px}
      h2{margin:0 0 4px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:3px 4px;text-align:left}th{background:#1B4F72;color:#fff}
      .pie{margin-top:14px;font-size:9px;color:#666;text-align:center}</style></head><body><h2>PROSOL — ${esc(titulo)}</h2>
      <div style="font-size:10px;color:#555">Generado ${esc(new Date().toLocaleString())} · ${L.length} orden(es) · Total $${d2(tot)}</div>
      <table><thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Serie</th><th>Tipo</th><th>Técnico</th><th>Estado</th><th>Valor</th></tr></thead><tbody>${cuerpo}</tbody></table>
      <div class="pie">${PIE}</div><script>setTimeout(function(){window.print()},400)<\/script></body></html>`);
    w.document.close();
  }

  // ── P7 · 🔍 Duplicados (mismo N° en 2+ registros) ────────────────────
  async function duplicados() {
    const dup = await API.rpc('ot_duplicados_pendientes', {}).catch(() => []);
    D.dup = dup || []; avisoDup(D.dup.length);
    const grupos = D.dup.map((g) => ({ g, ots: D.ord.filter((o) => String(o.numero_ot) === String(g.numero_ot)) }));
    const html = grupos.map(({ g, ots }) => `<div class="card" style="margin:6px 0;padding:8px">
      <b>N° ${esc(g.numero_ot)}</b> · ${g.n} registros ${g.decision ? `<span style="color:#1E8449">· decisión: ${esc(g.decision)}${g.decision === 'UNIFICAR' ? ' (se unifica en la próxima sincronización del escritorio, con respaldo)' : ''}</span>` : ''}
      ${U().tabla(['Código', 'Fecha', 'Cliente', 'Serie', 'Tipo', 'Valor', 'Origen', ''], ots.map((o) => [esc(o.id_escritorio || ''), esc(String(o.fecha || '').slice(0, 10)), esc(nomCli(o)),
        esc(o.serie || ''), esc(o.tipo_ot || ''), d2(o.valor_total), esc(o.origen || '') + (o.campo_revision ? '<br><small>' + esc(o.campo_revision) + '</small>' : ''),
        `<span style="white-space:nowrap"><button class="btn-web mini sec" data-dv="${o.id}">👁</button>${edita() && !bloqueo(o) ? ` <button class="btn-web mini sec" data-dn="${o.id}">🔢 Corregir N°</button>` : ''}${esAdmin() && !bloqueo(o) ? ` <button class="btn-web mini" style="background:#C0392B;color:#fff" data-dd="${o.id}">🗑</button>` : ''}</span>`]))}
      ${edita() ? `<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:4px"><button class="btn-web mini sec" data-dc="${esc(g.numero_ot)}|${g.n}">✅ Es correcto</button>
        <button class="btn-web mini sec" data-du="${esc(g.numero_ot)}|${g.n}">🧩 Unificar</button></div>` : ''}</div>`).join('');
    U().modal(`<h3>🔍 Duplicados por revisar: ${grupos.length}</h3>
      <p style="font-size:12px;color:#566573">Mismo N° de OT en 2 o más registros. Nada se borra ni se une solo: usted decide en cada caso.</p>
      ${html || '<p>✅ No hay duplicados por revisar.</p>'}<div style="text-align:right;margin-top:8px"><button class="btn-web sec" id="duX">Cerrar</button></div>`);
    U().$id('duX').onclick = () => { U().cerrarModal(); V.ordenes(); };
    const m = U().$id('_modal_web') || document;
    const decidir = async (clave, decision) => {
      try {
        const ya = await API.select('ot_duplicados_decision', { clave }).catch(() => []);
        if (ya[0]) await API.update('ot_duplicados_decision', ya[0].id, { decision, por: usuario(), fecha: ISO() });
        else await API.insert('ot_duplicados_decision', { clave, decision, por: usuario(), fecha: ISO() });
        U().toast(decision === 'CORRECTO' ? '✅ Marcado como correcto: deja de mostrarse' : '🧩 Se unifica en la próxima sincronización del escritorio (con respaldo)');
      } catch (e) { U().toast('❌ ' + e.message); }
      duplicados();
    };
    m.querySelectorAll('[data-dc]').forEach((b) => b.onclick = () => decidir(b.dataset.dc, 'CORRECTO'));
    m.querySelectorAll('[data-du]').forEach((b) => b.onclick = () => decidir(b.dataset.du, 'UNIFICAR'));
    m.querySelectorAll('[data-dv]').forEach((b) => b.onclick = () => ficha(D.ord.find((x) => x.id === b.dataset.dv)));
    m.querySelectorAll('[data-dd]').forEach((b) => b.onclick = () => borrar(D.ord.find((x) => x.id === b.dataset.dd), async () => { await cargar(); duplicados(); }));
    m.querySelectorAll('[data-dn]').forEach((b) => b.onclick = () => corregirNumero(D.ord.find((x) => x.id === b.dataset.dn)));
  }
  function corregirNumero(o) {
    const nuevo = (window.prompt('N° físico real de la hoja de la OT ' + (o.id_escritorio || '') + ' (hoy ' + o.numero_ot + '):', '') || '').trim();
    if (!nuevo) return;
    if (!/^\d+$/.test(nuevo)) { U().toast('El N° debe ser numérico'); return; }
    if (D.ord.some((x) => String(x.numero_ot) === nuevo)) { U().toast('⛔ El N° ' + nuevo + ' ya existe en otra OT'); return; }
    API.update('ordenes', o.id, { numero_ot: nuevo, editado_web: ISO(), editado_por: usuario() })
      .then(async () => { U().toast('🔢 N° corregido: ' + o.numero_ot + ' → ' + nuevo); await cargar(); duplicados(); })
      .catch((e) => U().toast('❌ ' + e.message));
  }

  // P7d · aviso fijo «🔍 Duplicados por revisar: N» (ADMIN y OPERADOR)
  function avisoDup(nPend) {
    const top = document.querySelector('header.topbar'); let btn = document.getElementById('btnDupOT');
    if (!top || !edita()) { if (btn) btn.remove(); return; }
    if (!btn) {
      btn = document.createElement('button'); btn.id = 'btnDupOT'; btn.type = 'button'; btn.className = 'btn-web';
      btn.style.cssText = 'margin-right:8px;white-space:nowrap;background:#8E44AD;color:#fff;border:0;font-weight:700';
      btn.onclick = () => { PROSOL_WEB.ir('ordenes'); setTimeout(() => { if (D) duplicados(); }, 1500); };
      const ref = document.getElementById('btnInsAprobar') || document.getElementById('btnBuscarTop') || document.getElementById('userBadge');
      if (ref && ref.parentNode) ref.parentNode.insertBefore(btn, ref); else top.appendChild(btn);
    }
    btn.textContent = '🔍 Duplicados por revisar: ' + nPend; btn.style.display = nPend ? '' : 'none';
  }
  async function refrescarAviso() {
    if (!API.hayNube() || !document.querySelector('#nav button') || !edita()) return;
    const L = await API.rpc('ot_duplicados_pendientes', {}).catch(() => null); if (L) avisoDup(L.length);
  }
  setInterval(() => { refrescarAviso().catch(() => {}); }, 300000);
  const _ad = setInterval(() => { if (document.querySelector('#nav button')) { clearInterval(_ad); refrescarAviso().catch(() => {}); } }, 1500);

  // ── P7a · 📥 Bajar campo: análisis previo + vista previa; la web integra en la nube ───────────────
  //   NUEVA     el N° no existe en otro registro → se integra (equipo/cliente por serie); el escritorio la baja con su código.
  //   IGUAL     mismo N°, serie y fecha, nada nuevo → se marca RECONCILIADO (no se duplica).
  //   COMPLETAR mismo N°, serie y fecha; a la de oficina le faltan datos que trae campo → se completan y queda RECONCILIADO.
  //   REVISAR   mismo N° con otra serie/fecha, o la de oficina está liquidada/facturada y campo trae datos → no se toca.
  async function analizarCampo() {
    const campo = D.ord.filter((o) => o.origen === 'CAMPO' && !o.integrada_web);
    const porSerie = {}; D.eq.forEach((e) => { if (e.serie) porSerie[String(e.serie).trim()] = e; });
    const res = [];
    for (const c of campo) {
      const otros = D.ord.filter((o) => o.id !== c.id && String(o.numero_ot || '') !== '' && String(o.numero_ot) === String(c.numero_ot) && o.origen !== 'CAMPO');
      if (!otros.length) { res.push({ c, caso: 'NUEVA', eq: porSerie[String(c.serie || '').trim()] || null }); continue; }
      const mismo = otros.find((o) => String(o.serie || '').trim() === String(c.serie || '').trim() && String(o.fecha || '').slice(0, 10) === String(c.fecha || '').slice(0, 10));
      if (!mismo) { res.push({ c, caso: 'REVISAR', motivo: 'Mismo N° con otra serie o fecha (' + otros.map((o) => (o.serie || '—') + ' ' + String(o.fecha || '').slice(0, 10)).join(', ') + ')' }); continue; }
      const [dc, dm] = await Promise.all([detalle(c), detalle(mismo)]);
      const falta = [];
      if (!dm.acts.length && dc.acts.length) falta.push('actividades');
      const urls = new Set(dm.fotos.map((f) => f.url)); const fotosN = dc.fotos.filter((f) => f.url && !urls.has(f.url));
      if (fotosN.length) falta.push(fotosN.length + ' foto(s)');
      if (!dm.tecs.length && dc.tecs.length) falta.push('técnicos');
      if (mismo.gps_lat == null && c.gps_lat != null) falta.push('GPS');
      if (mismo.horas_maquina == null && c.horas_maquina != null) falta.push('horas');
      if (!String(mismo.trabajo_realizado || '').trim() && String(c.trabajo_realizado || '').trim()) falta.push('trabajo realizado');
      const bl = bloqueo(mismo);
      if (!falta.length) res.push({ c, caso: 'IGUAL', o: mismo });
      else if (bl) res.push({ c, caso: 'REVISAR', o: mismo, motivo: 'La OT de oficina está en ' + bl + ' y campo trae: ' + falta.join(', ') });
      else res.push({ c, caso: 'COMPLETAR', o: mismo, falta, dc, dm, fotosN });
    }
    return res;
  }
  async function bajarCampo() {
    U().modal('<h3>📥 Bajar campo</h3><p>Analizando qué existe en cada sistema…</p>');
    await cargar();
    const R = await analizarCampo();
    const cuenta = (k) => R.filter((x) => x.caso === k).length;
    const TXT = { NUEVA: '🆕 Nueva', IGUAL: '✔ Ya existe igual', COMPLETAR: '🔄 Se completa', REVISAR: '⚠ A revisar' };
    const det = (x) => x.caso === 'NUEVA' ? (x.eq ? 'Equipo ' + esc(x.eq.serie) : '⚠ serie sin equipo: llega como POR REVISAR al escritorio')
      : x.caso === 'IGUAL' ? 'Sin datos nuevos · ' + esc(x.o.id_escritorio || '') : x.caso === 'COMPLETAR' ? 'Agrega: ' + esc(x.falta.join(', ')) + ' a ' + esc(x.o.id_escritorio || '') : esc(x.motivo || '');
    U().modal(`<h3>📥 Bajar campo — vista previa</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">${['NUEVA', 'IGUAL', 'COMPLETAR', 'REVISAR'].map((k) => `<span class="btn-web mini sec" id="bc${k}">${TXT[k]}: <b>${cuenta(k)}</b></span>`).join('')}</div>
      ${R.length ? U().tabla(['N° OT', 'Fecha', 'Serie', 'Técnico', 'Caso', 'Detalle'], R.map((x) => [esc(x.c.numero_ot || ''), esc(String(x.c.fecha || '').slice(0, 10)), esc(x.c.serie || ''),
        esc(x.c.firma_realiza || ''), TXT[x.caso], det(x)])) : '<p>✅ No hay órdenes de campo pendientes.</p>'}
      <p style="font-size:12px;color:#566573">Nada se duplica: lo nuevo se integra, lo igual se concilia, lo que falta se completa y lo dudoso queda en «🔍 Duplicados» para su decisión.</p>
      <div id="bcErr" style="color:#C0392B;font-size:13px;min-height:18px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn-web sec" id="bcX">Cancelar</button>${R.length ? '<button class="btn-web prim" id="bcOk">📥 Bajar</button>' : ''}</div>`);
    U().$id('bcX').onclick = () => U().cerrarModal();
    const ok = U().$id('bcOk');
    if (ok) ok.onclick = async () => {
      ok.disabled = true; const hecho = { NUEVA: 0, IGUAL: 0, COMPLETAR: 0, REVISAR: 0 };
      try {
        for (const x of R) {
          if (x.caso === 'NUEVA') {
            const cambio = { integrada_web: ISO(), campo_revision: null };
            if (x.eq) { if (!x.c.id_equipo) cambio.id_equipo = x.eq.id; if (!x.c.id_cliente && x.eq.id_cliente) cambio.id_cliente = x.eq.id_cliente; }
            await API.update('ordenes', x.c.id, cambio);
          } else if (x.caso === 'IGUAL') {
            await API.update('ordenes', x.c.id, { origen: 'RECONCILIADO', campo_revision: null });
          } else if (x.caso === 'COMPLETAR') {
            const o = x.o, cambio = { editado_web: ISO(), editado_por: usuario() + ' (campo)' };
            if (o.gps_lat == null && x.c.gps_lat != null) Object.assign(cambio, { gps_lat: x.c.gps_lat, gps_lng: x.c.gps_lng, gps_link: x.c.gps_link });
            if (o.horas_maquina == null && x.c.horas_maquina != null) cambio.horas_maquina = x.c.horas_maquina;
            if (!String(o.trabajo_realizado || '').trim() && String(x.c.trabajo_realizado || '').trim()) cambio.trabajo_realizado = x.c.trabajo_realizado;
            await API.update('ordenes', o.id, cambio);
            if (!x.dm.acts.length) for (const a of x.dc.acts) await API.insert('ot_actividades', { id_orden: o.id, descripcion: a.descripcion, cantidad: a.cantidad, valor: a.valor, nivel: a.nivel || null });
            if (!x.dm.tecs.length) for (const t of x.dc.tecs) await API.insert('ot_tecnicos', { id_orden: o.id, id_tecnico: t.id_tecnico, nombre_tecnico: t.nombre_tecnico });
            for (const f of x.fotosN) await API.insert('ot_fotos', { id_orden: o.id, tipo: f.tipo || 'EVIDENCIA', nombre_archivo: f.nombre || 'foto.jpg', data_url: f.url });
            await API.update('ordenes', x.c.id, { origen: 'RECONCILIADO', campo_revision: null });
          } else {
            await API.update('ordenes', x.c.id, { campo_revision: String(x.motivo || '').slice(0, 300) });
          }
          hecho[x.caso]++;
        }
        U().cerrarModal();
        U().toast(`📥 Campo: ${hecho.NUEVA} nueva(s) integrada(s), ${hecho.IGUAL} conciliada(s), ${hecho.COMPLETAR} completada(s), ${hecho.REVISAR} a revisar`);
        V.ordenes();
      } catch (e) { U().$id('bcErr').textContent = '❌ ' + e.message; ok.disabled = false; }
    };
  }

  window.PROSOL_ORD_WEB = { coincide, analizarCampo: () => analizarCampo(), cargar, F };
})();
