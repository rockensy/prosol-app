/* PROSOL web PC · lib/web_facturacion.js (v4.00 · W5 + R-1)
   Módulo propio «💵 Facturación y proformas» (igual que el escritorio, que lo saca de Liquidación):
   · Facturación y cobranzas: totales (facturado, cobrado, retenido, por cobrar, vencidas), filtro por estado y búsqueda;
     🧾 Nueva factura (vinculada a una OT; número sin repetir), 📋 Por facturar (expedientes aprobados), 📄 Cartera PDF,
     📑 Estado de cuenta; por factura: ✏️ Editar, 💵 Registrar pago, 🧾 Registrar retención, 👁 Ver detalle, 🗑 Eliminar.
     El saldo y el estado (PENDIENTE / PARCIAL / VENCIDA / CANCELADA) se recalculan como en el escritorio.
   · Cotizaciones / proformas: filtro y búsqueda; 🆕 Nueva / ✏️ Editar (serie → cliente; combos con sus actividades,
     servicios e insumos/repuestos; IVA; número sin repetir), 📄 PDF, 📤 Marcar enviada, ✔ Aprobar, ✖ Rechazar,
     📅 Programar mantenimiento (crea la visita en Programación), 🗑 Eliminar.
   Facturan y cobran ADMIN y OPERADOR; proformas ADMIN, OPERADOR y VENDEDOR. «Eliminar» igual que el escritorio: la web
   no borra filas, deja 'ELIMINADA' (y pagos/retenciones/ítems con borrado = true) y el escritorio la elimina.
   Módulo fuera del IIFE base. */
(() => {
  const V = window.PROSOL_WEB_VISTAS = window.PROSOL_WEB_VISTAS || {};
  const U = () => PROSOL_WEB.util;
  const esc = (s) => U().ESC(s);
  const n = (x) => { const v = parseFloat(x); return isFinite(v) ? v : 0; };
  const d2 = (x) => n(x).toFixed(2);
  const g = (x) => String(Math.round(n(x) * 10000) / 10000);
  const r2 = (x) => Math.round(n(x) * 100) / 100;
  const ISO = () => new Date().toISOString();
  const pad = (x) => String(x).padStart(2, '0');
  const AHORA = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
  const HOY = () => AHORA().slice(0, 10);
  const META = () => ({ actualizado: ISO(), sync_origen: 'WEB' });
  function sesion() { try { return (API.sesionNube && API.sesionNube()) || {}; } catch (e) { return {}; } }
  const rol = () => String(sesion().rol || (window._prosolSesion || {}).perfil || '').toUpperCase();
  const usuario = () => sesion().usuario || (window._prosolSesion || {}).usuario || 'web';
  const factura = () => ['ADMIN', 'OPERADOR'].includes(rol());
  const proforma = () => ['ADMIN', 'OPERADOR', 'VENDEDOR'].includes(rol());
  const FORMAS_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'CHEQUE', 'TARJETA', 'DEPÓSITO', 'OTRO'];
  const TIPOS_RET = ['RET. IVA', 'RET. RENTA'];
  const EST_FAC = ['TODAS', 'POR COBRAR', 'PENDIENTE', 'PARCIAL', 'VENCIDA', 'CANCELADA'];
  const EST_PRF = ['BORRADOR', 'ENVIADA', 'APROBADA', 'PROGRAMADA', 'EJECUTADA', 'RECHAZADA'];
  const PIE = 'Potenciado por ROCKENSY S.A. &amp; MIG — Tec. Master Luis Martínez Ibáñez';
  const viva = (x) => String(x.estado || '').toUpperCase() !== 'ELIMINADA';
  const F = { pest: 'fac', fEst: 'POR COBRAR', fTxt: '', pEst: 'TODAS', pTxt: '' };
  let turno = 0;

  // ── utilidades compartidas (también las usa el expediente) ────────
  function suma(fecha, dias) { try { const d = new Date(fecha.slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() + parseInt(dias, 10)); return d.toISOString().slice(0, 10); } catch (e) { return fecha; } }
  // igual que db._recalc_factura
  async function recalcular(f) {
    const [P, R] = await Promise.all([API.select('factura_pagos', { id_factura: f.id_escritorio }).catch(() => []),
      API.select('factura_retenciones', { id_factura: f.id_escritorio }).catch(() => [])]);
    const pag = P.filter((x) => !x.borrado).reduce((s, x) => s + n(x.valor), 0), ret = R.filter((x) => !x.borrado).reduce((s, x) => s + n(x.valor), 0);
    const saldo = r2(n(f.total) - pag - ret);
    const estado = saldo <= 0.005 ? 'CANCELADA' : (pag + ret > 0 ? 'PARCIAL' : ((f.fecha_vence && f.fecha_vence < HOY()) ? 'VENCIDA' : 'PENDIENTE'));
    const c = Object.assign({ pagado: r2(pag), retenido: r2(ret), saldo, estado }, META());
    await API.update('facturas', f.id, c);
    return Object.assign(f, c);
  }
  // igual que db.guardar_factura (cabecera)
  async function guardarFactura(datos, f0) {
    const sub = n(datos.subtotal), iva = r2(sub * n(datos.iva_pct) / 100), plazo = parseInt(datos.plazo_dias || 0, 10) || 0;
    const base = datos.fecha_factura || HOY();
    const d = Object.assign({}, datos, { iva_valor: iva, total: r2(sub + iva), plazo_dias: plazo, fecha_vence: plazo > 0 ? suma(base, plazo) : base }, META());
    let f;
    if (f0) { await API.update('facturas', f0.id, d); f = Object.assign({}, f0, d); }
    else f = await API.insert('facturas', Object.assign(d, { estado: 'PENDIENTE', pagado: 0, retenido: 0, saldo: d.total, fecha_creacion: AHORA() }));
    return recalcular(f);
  }
  async function agregarPago(f, fecha, forma, valor, ref) {
    await API.insert('factura_pagos', Object.assign({ id_factura: f.id_escritorio, fecha, forma, referencia: ref || '', valor: r2(valor), fecha_creacion: AHORA(), borrado: false }, META()));
    return recalcular(f);
  }
  async function numeroLibre(tabla, num, idExcl) {
    if (!String(num || '').trim()) return true;
    const L = (await API.select(tabla, { numero: String(num).trim() }).catch(() => [])).filter(viva);
    return !L.some((x) => x.id !== idExcl);
  }
  async function siguienteNumero(tabla) {
    const L = await API.select(tabla).catch(() => []);
    return String(L.map((x) => String(x.numero || '').trim()).filter((x) => /^\d+$/.test(x)).reduce((m, x) => Math.max(m, parseInt(x, 10)), 0) + 1);
  }
  async function ivaConfig() {
    try { const r = await API.select('config', { clave: 'IVA_PCT' }); if (r && r[0] && r[0].valor) return n(r[0].valor); } catch (e) {}
    return 15;
  }
  // igual que db.guardar_proforma: calcula totales e (re)inserta los ítems
  async function guardarProforma(cab, items, p0) {
    const sub = r2(items.reduce((s, it) => s + n(it.cantidad) * n(it.valor_unit), 0)), iva = r2(sub * n(cab.iva_pct) / 100);
    const c = Object.assign({}, cab, { subtotal: sub, iva_valor: iva, total: r2(sub + iva) }, META());
    let p;
    if (p0) {
      await API.update('proformas', p0.id, c); p = Object.assign({}, p0, c);
      for (const it of (await API.select('proforma_items', { id_proforma: p0.id_escritorio }).catch(() => [])).filter((x) => !x.borrado))
        await API.update('proforma_items', it.id, Object.assign({ borrado: true }, META()));
    } else p = await API.insert('proformas', Object.assign(c, { estado: c.estado || 'BORRADOR', fecha_creacion: AHORA() }));
    for (const it of items) await API.insert('proforma_items', Object.assign({ id_proforma: p.id_escritorio, tipo: it.tipo, id_ref: it.id_ref || null, codigo: it.codigo || '',
      descripcion: it.descripcion || '', cantidad: n(it.cantidad), valor_unit: n(it.valor_unit), subtotal: r2(n(it.cantidad) * n(it.valor_unit)), fecha_creacion: AHORA(), borrado: false }, META()));
    return p;
  }
  function imprimir(titulo, cuerpo) {
    const w = window.open('', '_blank');
    if (!w) { U().toast('⚠ Permita las ventanas emergentes para imprimir'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
      body{font-family:Arial,sans-serif;font-size:11px;color:#1C2733;margin:18px}h1{font-size:16px;margin:0}
      table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border:1px solid #AAB7B8;padding:4px 5px;text-align:left}
      th{background:#1C2733;color:#fff}td.n{text-align:right}.cab{display:flex;align-items:center;gap:12px;border-bottom:2px solid #1C2733;padding-bottom:6px}
      .pie{margin-top:18px;border-top:1px solid #AAB7B8;padding-top:4px;font-size:9px;color:#566573;text-align:center}.datos td{border:none;padding:2px 6px}
      tr.combo td{background:#EAF2F8;font-weight:700}tr.sub td{color:#566573}</style></head><body>
      <div class="cab"><img src="${location.href.replace(/[^/]*$/, '')}icons/icon-192.png" style="height:44px"><div><h1>${esc(titulo)}</h1><div>PROSOL · ${esc(AHORA().slice(0, 16))}</div></div></div>
      ${cuerpo}<div class="pie">${PIE}</div><script>setTimeout(function(){window.print()},400)<\/script></body></html>`);
    w.document.close();
  }
  const tabla = (cols, filas) => `<table><thead><tr>${cols.map((c) => '<th>' + esc(c) + '</th>').join('')}</tr></thead><tbody>${filas.map((f) => '<tr>' + f.map((v) => typeof v === 'number' ? '<td class="n">' + d2(v) + '</td>' : '<td>' + esc(v == null ? '' : v) + '</td>').join('') + '</tr>').join('')}</tbody></table>`;
  function pdfProforma(p, items, cli) {
    const filas = items.map((it) => {
      const t = String(it.tipo || '').toUpperCase(), sub = t === 'ACTIVIDAD' || t === 'INSUMO';
      const desc = t === 'COMBO' ? '📦 ' + it.descripcion : (sub ? (t === 'ACTIVIDAD' ? '• ' : '- ') + it.descripcion : it.descripcion);
      return `<tr class="${t === 'COMBO' ? 'combo' : (sub ? 'sub' : '')}"><td>${esc(desc)}</td><td class="n">${g(it.cantidad)}</td><td class="n">${sub ? '' : d2(it.valor_unit)}</td><td class="n">${sub ? '' : d2(n(it.cantidad) * n(it.valor_unit))}</td></tr>`;
    }).join('');
    imprimir('Cotización / Proforma N° ' + (p.numero || p.id_escritorio), `<table class="datos"><tr><td><b>Cliente:</b> ${esc(cli.razon_social || '')}</td><td><b>RUC/CI:</b> ${esc(cli.identificacion || '')}</td></tr>
      <tr><td><b>Serie:</b> ${esc(p.serie || '')}</td><td><b>Fecha:</b> ${esc(p.fecha || '')} · <b>Validez:</b> ${esc(p.validez_dias || '')} días</td></tr>
      <tr><td colspan="2"><b>Tipo:</b> ${esc(p.tipo_mantenimiento || '')}</td></tr></table>
      <table><thead><tr><th>Descripción</th><th>Cant.</th><th>V. unit.</th><th>Subtotal</th></tr></thead><tbody>${filas}</tbody></table>
      <p style="text-align:right;font-size:13px"><b>Subtotal:</b> $${d2(p.subtotal)} · <b>IVA ${g(p.iva_pct)}%:</b> $${d2(p.iva_valor)} · <b>TOTAL: $${d2(p.total)}</b></p>
      ${p.observacion ? '<p><b>Observación:</b> ' + esc(p.observacion) + '</p>' : ''}`);
  }

  // ── vista ─────────────────────────────────────────────────────────
  V.facturacion = async () => {
    const main = U().$id('main');
    if (!API.hayNube()) { main.innerHTML = '<div class="card"><h2>💵 Facturación y proformas</h2><p>☁ Sin conexión a la nube. Ve a <b>Configuración</b>.</p></div>'; return; }
    if (!proforma()) { main.innerHTML = '<div class="card"><h2>💵 Facturación y proformas</h2><p>Su rol no tiene acceso a este módulo.</p></div>'; return; }
    if (window._prosolFacturarOT) F.pest = 'fac';
    const t = ++turno;
    const b = (k, x) => `<button class="btn-web ${F.pest === k ? 'prim' : 'sec'}" data-fp="${k}">${x}</button>`;
    main.innerHTML = `<div class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b>💵 Facturación y proformas</b>
      ${b('fac', 'Facturación y cobranzas')}${b('prf', 'Cotizaciones / proformas')}${b('exp', '🗂 Expedientes: proforma y factura')}</div><div class="card" id="fpCuerpo">Cargando…</div>`;
    main.querySelectorAll('[data-fp]').forEach((x) => x.onclick = () => { F.pest = x.dataset.fp; V.facturacion(); });
    if (F.pest === 'exp') return window.PROSOL_EXP ? window.PROSOL_EXP.panel(U().$id('fpCuerpo'), 'facturacion') : null;   // v4.04 · R-4
    const [fac, prf, cls, eqs] = await Promise.all(['facturas', 'proformas', 'clientes', 'equipos'].map((x) => API.select(x).catch(() => [])));
    if (t !== turno || !U().$id('fpCuerpo')) return;
    const C = {}; cls.forEach((c) => { C[c.id_escritorio] = c; });
    const D = { fac: fac.filter(viva), prf: prf.filter(viva), cls, C, eqs };
    return F.pest === 'prf' ? proformas(D) : facturas(D);
  };
  const recargar = () => V.facturacion();

  // ── Facturación y cobranzas ───────────────────────────────────────
  function diasVence(f) {
    if (!f.fecha_vence || f.estado === 'CANCELADA') return null;
    return Math.round((new Date(f.fecha_vence + 'T12:00:00') - new Date(HOY() + 'T12:00:00')) / 864e5);
  }
  function facturas(D) {
    const c = U().$id('fpCuerpo'), ed = factura();
    const k = { fac: D.fac.reduce((s, f) => s + n(f.total), 0), cob: D.fac.reduce((s, f) => s + n(f.pagado), 0), ret: D.fac.reduce((s, f) => s + n(f.retenido), 0),
      xc: D.fac.reduce((s, f) => s + n(f.saldo), 0), v: D.fac.filter((f) => f.estado === 'VENCIDA') };
    c.innerHTML = `<div style="font-weight:700;color:#1C2733;margin-bottom:6px">Facturado: $${d2(k.fac)}    Cobrado: $${d2(k.cob)}    Retenido: $${d2(k.ret)}    Por cobrar: $${d2(k.xc)}    Vencidas: ${k.v.length} ($${d2(k.v.reduce((s, f) => s + n(f.saldo), 0))})</div>
      <div class="toolbar" style="flex-wrap:wrap"><label style="font-size:13px">Estado: <select class="inp-web" id="fcEst" style="width:auto">${EST_FAC.map((e) => `<option ${e === F.fEst ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
      <input class="inp-web" id="fcTxt" placeholder="Cliente, N° factura u OT" value="${esc(F.fTxt)}" style="min-width:200px">
      ${ed ? '<button class="btn-web prim" id="fcNueva">🧾 Nueva factura</button><button class="btn-web sec" id="fcPor">📋 Por facturar</button>' : ''}
      <button class="btn-web sec" id="fcCart">📄 Cartera PDF</button><button class="btn-web sec" id="fcEc">📑 Estado de cuenta</button></div><div id="fcLista"></div>`;
    const lista = () => D.fac.filter((f) => (F.fEst === 'TODAS' || (F.fEst === 'POR COBRAR' ? ['PENDIENTE', 'PARCIAL', 'VENCIDA'].includes(f.estado) : f.estado === F.fEst))
      && (!F.fTxt.trim() || [(D.C[f.id_cliente] || {}).razon_social, f.numero, f.numero_ot].join(' ').toUpperCase().includes(F.fTxt.trim().toUpperCase())))
      .sort((a, b) => String(b.fecha_factura || '').localeCompare(String(a.fecha_factura || '')) || (parseInt(b.numero, 10) || 0) - (parseInt(a.numero, 10) || 0));
    const pintar = () => {
      U().$id('fcLista').innerHTML = U().tabla(['N° Factura', 'OT', 'Cliente', 'Serie', 'F. Factura', 'Vence', 'Días', 'Total', 'Pagado', 'Retenido', 'Saldo', 'Estado', ''], lista().map((f) => {
        const dd = diasVence(f), dt = dd == null ? '' : (dd === 0 ? 'hoy' : (dd > 0 ? dd + ' d' : 'venc ' + (-dd) + ' d'));
        const col = f.estado === 'VENCIDA' ? '#922B21' : (f.estado === 'CANCELADA' ? '#196F3D' : '');
        return [esc(f.numero || ''), esc(f.numero_ot || ''), esc((D.C[f.id_cliente] || {}).razon_social || ''), esc(f.serie || ''), esc(f.fecha_factura || ''), esc(f.fecha_vence || ''), dt,
          d2(f.total), d2(f.pagado), d2(f.retenido), d2(f.saldo), `<b style="color:${col}">${esc(f.estado || '')}</b>`,
          '<span style="white-space:nowrap">' + (ed ? `<button class="btn-web mini sec" data-f="ed" data-id="${f.id}">✏️</button> <button class="btn-web mini sec" data-f="pag" data-id="${f.id}">💵</button> <button class="btn-web mini sec" data-f="ret" data-id="${f.id}">🧾</button> ` : '')
          + `<button class="btn-web mini sec" data-f="ver" data-id="${f.id}">👁</button>` + (ed ? ` <button class="btn-web mini sec" data-f="del" data-id="${f.id}">🗑</button>` : '') + '</span>'];
      }));
      U().$id('fcLista').querySelectorAll('[data-f]').forEach((b) => b.onclick = () => {
        const f = D.fac.find((x) => String(x.id) === b.dataset.id), a = b.dataset.f;
        if (a === 'ed') dlgFactura(f, D); else if (a === 'pag') dlgPago(f); else if (a === 'ret') dlgRetencion(f); else if (a === 'ver') verFactura(f, D); else eliminarFactura(f);
      });
    };
    U().$id('fcEst').onchange = (e) => { F.fEst = e.target.value; pintar(); };
    U().$id('fcTxt').oninput = (e) => { F.fTxt = e.target.value; pintar(); };
    if (ed && window._prosolFacturarOT) { const nOt = window._prosolFacturarOT; window._prosolFacturarOT = null;   // v4.08: «🧾 Facturar» desde Órdenes
      setTimeout(() => { dlgFactura(null, D, nOt); const bb = U().$id('dfBus'); if (bb) bb.click(); }, 50); }
    if (ed) { U().$id('fcNueva').onclick = () => dlgFactura(null, D); U().$id('fcPor').onclick = () => { window._prosolExpEtapa = 'APROBADO'; PROSOL_WEB.ir('expedientes'); }; }
    U().$id('fcCart').onclick = () => imprimir('Cartera de facturas', `<p>Filtro: ${esc(F.fEst)} · ${esc(c.firstElementChild.textContent)}</p>` + tabla(['N° Factura', 'OT', 'Cliente', 'F. Factura', 'Vence', 'Total', 'Pagado', 'Retenido', 'Saldo', 'Estado'],
      lista().map((f) => [f.numero || '', f.numero_ot || '', (D.C[f.id_cliente] || {}).razon_social || '', f.fecha_factura || '', f.fecha_vence || '', n(f.total), n(f.pagado), n(f.retenido), n(f.saldo), f.estado || ''])));
    U().$id('fcEc').onclick = () => estadoCuenta(D);
    pintar();
  }
  function dlgFactura(f, D, numOt) {
    f = f || null; const ctx = { id_ot: f ? f.id_ot : null, id_cliente: f ? f.id_cliente : null, serie: f ? f.serie : null };
    const fl = (lab, id, val, tipo, w) => `<div><label style="font-size:12px;font-weight:700">${lab}</label><input class="inp-web" id="${id}" ${tipo ? 'type="' + tipo + '" step="any"' : ''} value="${esc(val == null ? '' : val)}" ${w ? 'style="width:' + w + '"' : ''}></div>`;
    U().modal(`<h3>🧾 ${f ? 'Factura ' + esc(f.numero || '') : 'Nueva factura'}</h3>
      <div style="display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap"><div><label style="font-size:12px;font-weight:700">N° de OT (vincula cliente/serie)</label><input class="inp-web" id="dfOt" value="${esc((f && f.numero_ot) || numOt || '')}" style="width:120px"></div>
      <button class="btn-web sec" id="dfBus">Buscar</button><span id="dfOtInfo" style="font-size:12px;color:#117A65"></span></div>
      <div class="grid2">${fl('N° de factura', 'dfNum', f && f.numero)}${fl('Fecha de trabajo', 'dfFt', f && f.fecha_trabajo, 'date')}${fl('Fecha de factura', 'dfFf', (f && f.fecha_factura) || HOY(), 'date')}
      ${fl('Subtotal (sin IVA)', 'dfSub', f ? f.subtotal : '', 'number')}${fl('IVA %', 'dfIva', f ? f.iva_pct : '15', 'number')}${fl('Plazo de crédito (días)', 'dfPl', f ? f.plazo_dias : 0, 'number')}</div>
      ${fl('Observación', 'dfObs', f && f.observacion)}
      <div id="dfErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="dfX">Cancelar</button><button class="btn-web prim" id="dfOk">💾 Guardar</button></div>`);
    U().$id('dfX').onclick = U().cerrarModal;
    if (!f) ivaConfig().then((v) => { const e = U().$id('dfIva'); if (e && e.value === '15') e.value = v; });
    const info = U().$id('dfOtInfo');
    const buscar = async () => {
      const num = U().$id('dfOt').value.trim();
      const o = num ? (await API.select('ordenes', { numero_ot: num }).catch(() => []))[0] : null;
      if (!o) { info.textContent = 'OT no encontrada'; info.style.color = '#C0392B'; ctx.id_cliente = null; return; }
      const cl = o.id_cliente ? (await API.select('clientes', { id: o.id_cliente }).catch(() => []))[0] : null;
      ctx.id_ot = o.id_escritorio; ctx.id_cliente = cl ? cl.id_escritorio : null; ctx.serie = o.serie;
      info.textContent = '✓ ' + (cl ? cl.razon_social : '—') + ' · ' + (o.serie || ''); info.style.color = '#117A65';
      if (!U().$id('dfFt').value) U().$id('dfFt').value = o.fecha || '';
    };
    U().$id('dfBus').onclick = buscar;
    if (f || numOt) buscar();
    U().$id('dfOk').onclick = async () => {
      const err = (m) => { U().$id('dfErr').textContent = m; U().$id('dfOk').disabled = false; };
      U().$id('dfOk').disabled = true;
      if (!ctx.id_cliente) { await buscar(); if (!ctx.id_cliente) return err('Vincula una OT válida (cliente/serie).'); }
      const num = U().$id('dfNum').value.trim();
      if (!(await numeroLibre('facturas', num, f && f.id))) return err('Ya existe una factura con ese número.');
      const sub = parseFloat(U().$id('dfSub').value || '0'), iva = parseFloat(U().$id('dfIva').value || '0'), pl = parseFloat(U().$id('dfPl').value || '0');
      if (![sub, iva, pl].every(isFinite)) return err('Revisa los valores numéricos.');
      try {
        await guardarFactura({ numero: num, id_ot: ctx.id_ot, numero_ot: U().$id('dfOt').value.trim(), id_cliente: ctx.id_cliente, serie: ctx.serie,
          fecha_trabajo: U().$id('dfFt').value, fecha_factura: U().$id('dfFf').value, subtotal: sub, iva_pct: iva, plazo_dias: Math.trunc(pl), observacion: U().$id('dfObs').value.trim() }, f);
        U().toast('✅ Factura guardada'); U().cerrarModal(); recargar();
      } catch (e) { err('❌ ' + e.message); }
    };
  }
  function dlgPago(f) {
    U().modal(`<h3>💵 Pago a factura ${esc(f.numero || '')}</h3><p style="color:#C0392B;font-weight:700;margin:0 0 6px">Saldo actual: $${d2(f.saldo)}</p>
      <div class="grid2"><div><label style="font-size:12px;font-weight:700">Fecha</label><input class="inp-web" id="pgF" type="date" value="${HOY()}"></div>
      <div><label style="font-size:12px;font-weight:700">Forma</label><select class="inp-web" id="pgFo">${FORMAS_PAGO.map((x) => `<option ${x === 'TRANSFERENCIA' ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div><label style="font-size:12px;font-weight:700">Valor</label><input class="inp-web" id="pgV" type="number" step="any" value="${d2(f.saldo)}"></div>
      <div><label style="font-size:12px;font-weight:700">Referencia</label><input class="inp-web" id="pgR"></div></div>
      <p style="font-size:11px;color:#566573">Puedes registrar varios pagos (formas combinadas) repitiendo esta acción.</p>
      <div id="pgErr" style="color:#C0392B;font-size:13px;min-height:18px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="pgX">Cancelar</button><button class="btn-web prim" id="pgOk">💵 Registrar</button></div>`);
    U().$id('pgX').onclick = U().cerrarModal;
    U().$id('pgOk').onclick = async () => {
      const v = parseFloat(U().$id('pgV').value);
      if (!isFinite(v)) { U().$id('pgErr').textContent = 'Valor inválido.'; return; }
      if (v <= 0) { U().$id('pgErr').textContent = 'El valor debe ser mayor a 0.'; return; }
      U().$id('pgOk').disabled = true;
      try { await agregarPago(f, U().$id('pgF').value, U().$id('pgFo').value, v, U().$id('pgR').value.trim()); U().toast('💵 Pago registrado'); U().cerrarModal(); recargar(); }
      catch (e) { U().$id('pgOk').disabled = false; U().$id('pgErr').textContent = '❌ ' + e.message; }
    };
  }
  function dlgRetencion(f) {
    U().modal(`<h3>🧾 Retención a factura ${esc(f.numero || '')}</h3><p style="margin:0 0 6px">Subtotal: $${d2(f.subtotal)} · IVA: $${d2(f.iva_valor)} · Saldo: $${d2(f.saldo)}</p>
      <div class="grid2"><div><label style="font-size:12px;font-weight:700">Fecha</label><input class="inp-web" id="rtF" type="date" value="${HOY()}"></div>
      <div><label style="font-size:12px;font-weight:700">Tipo</label><select class="inp-web" id="rtT">${TIPOS_RET.map((x) => `<option>${x}</option>`).join('')}</select></div>
      <div><label style="font-size:12px;font-weight:700">N° comprobante</label><input class="inp-web" id="rtC"></div>
      <div><label style="font-size:12px;font-weight:700">Base</label><input class="inp-web" id="rtB" type="number" step="any" value="${d2(f.subtotal)}"></div>
      <div><label style="font-size:12px;font-weight:700">Porcentaje %</label><input class="inp-web" id="rtP" type="number" step="any" value="0"></div>
      <div><label style="font-size:12px;font-weight:700">o Valor directo</label><input class="inp-web" id="rtV" type="number" step="any"></div></div>
      <p style="font-size:11px;color:#566573">RET. IVA: base = IVA de la factura. RET. RENTA: base = subtotal. Las retenciones también abonan a la factura (la cuadran).</p>
      <div id="rtErr" style="color:#C0392B;font-size:13px;min-height:18px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="rtX">Cancelar</button><button class="btn-web prim" id="rtOk">🧾 Registrar</button></div>`);
    U().$id('rtX').onclick = U().cerrarModal;
    U().$id('rtOk').onclick = async () => {
      const base = parseFloat(U().$id('rtB').value || '0'), pct = parseFloat(U().$id('rtP').value || '0'), vd = U().$id('rtV').value.trim();
      const val = vd ? parseFloat(vd) : r2(base * pct / 100);
      if (![base, pct, val].every(isFinite)) { U().$id('rtErr').textContent = 'Revisa los valores numéricos.'; return; }
      U().$id('rtOk').disabled = true;
      try {
        await API.insert('factura_retenciones', Object.assign({ id_factura: f.id_escritorio, fecha: U().$id('rtF').value, tipo: U().$id('rtT').value, comprobante: U().$id('rtC').value.trim(),
          base, porcentaje: pct, valor: val, fecha_creacion: AHORA(), borrado: false }, META()));
        await recalcular(f); U().toast('🧾 Retención registrada'); U().cerrarModal(); recargar();
      } catch (e) { U().$id('rtOk').disabled = false; U().$id('rtErr').textContent = '❌ ' + e.message; }
    };
  }
  async function verFactura(f, D) {
    const [P, R] = await Promise.all([API.select('factura_pagos', { id_factura: f.id_escritorio }).catch(() => []), API.select('factura_retenciones', { id_factura: f.id_escritorio }).catch(() => [])]);
    U().modal(`<h3>Factura ${esc(f.numero || '')} — ${esc((D.C[f.id_cliente] || {}).razon_social || '')}</h3>
      <p>OT ${esc(f.numero_ot || '')} · Serie ${esc(f.serie || '')} · Total $${d2(f.total)} · Pagado $${d2(f.pagado)} · Retenido $${d2(f.retenido)} · Saldo $${d2(f.saldo)} · ${esc(f.estado || '')}</p>
      <h4 style="margin:6px 0">Pagos</h4>${U().tabla(['Fecha', 'Forma', 'Valor', 'Referencia'], P.filter((x) => !x.borrado).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).map((p) => [esc(p.fecha || ''), esc(p.forma || ''), d2(p.valor), esc(p.referencia || '')]))}
      <h4 style="margin:6px 0">Retenciones</h4>${U().tabla(['Fecha', 'Tipo', 'Comprobante', 'Base', '%', 'Valor'], R.filter((x) => !x.borrado).map((r) => [esc(r.fecha || ''), esc(r.tipo || ''), esc(r.comprobante || ''), d2(r.base), d2(r.porcentaje), d2(r.valor)]))}
      <div style="text-align:right;margin-top:8px"><button class="btn-web sec" id="vfX">Cerrar</button></div>`);
    U().$id('vfX').onclick = U().cerrarModal;
  }
  async function eliminarFactura(f) {
    if (!confirm('¿Eliminar esta factura y sus pagos/retenciones?')) return;
    try {
      for (const t of ['factura_pagos', 'factura_retenciones'])
        for (const x of (await API.select(t, { id_factura: f.id_escritorio }).catch(() => [])).filter((y) => !y.borrado)) await API.update(t, x.id, Object.assign({ borrado: true }, META()));
      await API.update('facturas', f.id, Object.assign({ estado: 'ELIMINADA' }, META()));
      U().toast('🗑 Factura eliminada'); recargar();
    } catch (e) { U().toast('❌ ' + e.message); }
  }
  async function estadoCuenta(D) {
    const ids = [...new Set(D.fac.map((f) => f.id_cliente).filter(Boolean))];
    const cl = ids.map((i) => D.C[i]).filter(Boolean).sort((a, b) => String(a.razon_social).localeCompare(String(b.razon_social)));
    if (!cl.length) { U().toast('Aún no hay clientes con facturas registradas.'); return; }
    U().modal(`<h3>📑 Estado de cuenta por cliente</h3><label style="font-size:12px;font-weight:700">Cliente</label>
      <select class="inp-web" id="ecC">${cl.map((c) => `<option value="${esc(c.id_escritorio)}">${esc(c.razon_social)}</option>`).join('')}</select>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn-web sec" id="ecX">Cancelar</button><button class="btn-web prim" id="ecOk">📑 Generar PDF</button></div>`);
    U().$id('ecX').onclick = U().cerrarModal;
    U().$id('ecOk').onclick = async () => {
      const c = D.C[U().$id('ecC').value], F2 = D.fac.filter((f) => f.id_cliente === c.id_escritorio);
      const mov = [];
      for (const f of F2) {
        const [P, R] = await Promise.all([API.select('factura_pagos', { id_factura: f.id_escritorio }).catch(() => []), API.select('factura_retenciones', { id_factura: f.id_escritorio }).catch(() => [])]);
        P.filter((x) => !x.borrado).forEach((p) => mov.push([p.fecha || '', f.numero || '', 'Pago ' + (p.forma || ''), p.referencia || '', n(p.valor)]));
        R.filter((x) => !x.borrado).forEach((r) => mov.push([r.fecha || '', f.numero || '', r.tipo || '', r.comprobante || '', n(r.valor)]));
      }
      const tot = (k) => F2.reduce((s, f) => s + n(f[k]), 0);
      U().cerrarModal();
      imprimir('Estado de cuenta · ' + c.razon_social, `<p><b>${esc(c.razon_social)}</b> · ${esc(c.identificacion || '')} · ${esc(c.telefono || '')}</p>
        <p><b>Facturado:</b> $${d2(tot('total'))} · <b>Cobrado:</b> $${d2(tot('pagado'))} · <b>Retenido:</b> $${d2(tot('retenido'))} · <b>Saldo:</b> $${d2(tot('saldo'))}</p>`
        + tabla(['N° Factura', 'OT', 'F. Factura', 'Vence', 'Total', 'Pagado', 'Retenido', 'Saldo', 'Estado'], F2.map((f) => [f.numero || '', f.numero_ot || '', f.fecha_factura || '', f.fecha_vence || '', n(f.total), n(f.pagado), n(f.retenido), n(f.saldo), f.estado || '']))
        + '<h3>Movimientos</h3>' + tabla(['Fecha', 'Factura', 'Movimiento', 'Referencia', 'Valor'], mov.sort((a, b) => String(a[0]).localeCompare(String(b[0])))));
    };
  }

  // ── Cotizaciones / proformas ──────────────────────────────────────
  function proformas(D) {
    const c = U().$id('fpCuerpo'), ed = proforma();
    c.innerHTML = `<div class="toolbar" style="flex-wrap:wrap"><label style="font-size:13px">Estado: <select class="inp-web" id="prEst" style="width:auto">${['TODAS'].concat(EST_PRF).map((e) => `<option ${e === F.pEst ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
      <input class="inp-web" id="prTxt" placeholder="N°, cliente o serie" value="${esc(F.pTxt)}" style="min-width:200px">
      ${ed ? '<button class="btn-web prim" id="prNueva">🆕 Nueva proforma</button>' : ''}</div><div id="prLista"></div>`;
    const lista = () => D.prf.filter((p) => (F.pEst === 'TODAS' || p.estado === F.pEst)
      && (!F.pTxt.trim() || [p.numero, (D.C[p.id_cliente] || {}).razon_social, p.serie].join(' ').toUpperCase().includes(F.pTxt.trim().toUpperCase())))
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || String(b.id_escritorio).localeCompare(String(a.id_escritorio)));
    const COL = { APROBADA: '#1E8449', PROGRAMADA: '#1E8449', RECHAZADA: '#922B21', EJECUTADA: '#2471A3' };
    const pintar = () => {
      U().$id('prLista').innerHTML = U().tabla(['N° Proforma', 'Cliente', 'Serie', 'Fecha', 'Total', 'Estado', 'OT', ''], lista().map((p) => [esc(p.numero || ''), esc((D.C[p.id_cliente] || {}).razon_social || ''),
        esc(p.serie || ''), esc(p.fecha || ''), d2(p.total), `<b style="color:${COL[p.estado] || ''}">${esc(p.estado || '')}</b>`, esc(p.numero_ot || ''),
        '<span style="white-space:nowrap">' + (ed ? `<button class="btn-web mini sec" data-p="ed" data-id="${p.id}">✏️</button> ` : '') + `<button class="btn-web mini sec" data-p="pdf" data-id="${p.id}">📄</button>`
        + (ed ? ` <button class="btn-web mini sec" data-p="ENVIADA" data-id="${p.id}" title="Marcar enviada">📤</button> <button class="btn-web mini sec" data-p="APROBADA" data-id="${p.id}" title="Aprobar">✔</button>`
          + ` <button class="btn-web mini sec" data-p="RECHAZADA" data-id="${p.id}" title="Rechazar">✖</button> <button class="btn-web mini sec" data-p="prog" data-id="${p.id}" title="Programar mantenimiento">📅</button> <button class="btn-web mini sec" data-p="del" data-id="${p.id}">🗑</button>` : '') + '</span>']));
      U().$id('prLista').querySelectorAll('[data-p]').forEach((b) => b.onclick = async () => {
        const p = D.prf.find((x) => String(x.id) === b.dataset.id), a = b.dataset.p;
        if (a === 'ed') { if (['EJECUTADA', 'PROGRAMADA'].includes(p.estado)) { U().toast('Esta proforma ya está ' + p.estado.toLowerCase() + ' y no debe modificarse.'); return; } return dlgProforma(p, D); }
        if (a === 'pdf') { const it = (await API.select('proforma_items', { id_proforma: p.id_escritorio }).catch(() => [])).filter((x) => !x.borrado); return pdfProforma(p, it, D.C[p.id_cliente] || {}); }
        if (a === 'prog') return programar(p, D);
        if (a === 'del') { if (!confirm('¿Eliminar esta proforma?')) return; return eliminarProforma(p); }
        try { await API.update('proformas', p.id, Object.assign({ estado: a }, META())); U().toast('Proforma ' + a.toLowerCase()); recargar(); } catch (e) { U().toast('❌ ' + e.message); }
      });
    };
    U().$id('prEst').onchange = (e) => { F.pEst = e.target.value; pintar(); };
    U().$id('prTxt').oninput = (e) => { F.pTxt = e.target.value; pintar(); };
    if (ed) U().$id('prNueva').onclick = () => dlgProforma(null, D);
    pintar();
  }
  async function eliminarProforma(p) {
    try {
      for (const it of (await API.select('proforma_items', { id_proforma: p.id_escritorio }).catch(() => [])).filter((x) => !x.borrado)) await API.update('proforma_items', it.id, Object.assign({ borrado: true }, META()));
      await API.update('proformas', p.id, Object.assign({ estado: 'ELIMINADA' }, META()));
      U().toast('🗑 Proforma eliminada'); recargar();
    } catch (e) { U().toast('❌ ' + e.message); }
  }
  async function dlgProforma(p, D) {
    const [acts, aitems, reps] = await Promise.all(['actividades', 'actividad_items', 'repuestos'].map((x) => API.select(x).catch(() => [])));
    const combos = acts.filter((a) => String(a.tipo || '').toUpperCase() === 'COMBO' && (a.estado || 'ACTIVO') === 'ACTIVO');
    const servicios = reps.filter((r) => (r.estado || 'ACTIVO') === 'ACTIVO' && r.clase === 'SERVICIO');
    const repuestos = reps.filter((r) => (r.estado || 'ACTIVO') === 'ACTIVO' && (r.clase || 'REPUESTO') === 'REPUESTO');
    let items = p ? (await API.select('proforma_items', { id_proforma: p.id_escritorio }).catch(() => [])).filter((x) => !x.borrado)
      .sort((a, b) => String(a.id_escritorio).localeCompare(String(b.id_escritorio))).map((it) => ({ tipo: it.tipo, id_ref: it.id_ref, codigo: it.codigo, descripcion: it.descripcion, cantidad: n(it.cantidad), valor_unit: n(it.valor_unit) })) : [];
    const ctx = { id_cliente: p ? p.id_cliente : null, serie: p ? p.serie : '', id_equipo: p ? p.id_equipo : null, tipo: p ? p.tipo_mantenimiento : '' };
    const cls = D.cls.filter((c) => (c.estado || 'ACTIVO') === 'ACTIVO').sort((a, b) => String(a.razon_social).localeCompare(String(b.razon_social)));
    const fl = (lab, id, val, tipo, w) => `<div><label style="font-size:12px;font-weight:700">${lab}</label><input class="inp-web" id="${id}" ${tipo ? 'type="' + tipo + '" step="any"' : ''} value="${esc(val == null ? '' : val)}" ${w ? 'style="width:' + w + '"' : ''}></div>`;
    U().modal(`<h3>Cotización / Proforma ${p ? esc(p.numero || '') : ''}</h3>
      <div style="display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap"><div><label style="font-size:12px;font-weight:700">Serie del equipo</label><input class="inp-web" id="dpS" value="${esc(ctx.serie || '')}" style="width:160px"></div>
        <button class="btn-web sec" id="dpBus">Buscar</button><span id="dpInfo" style="font-size:12px;font-weight:700"></span></div>
      <label style="font-size:12px;font-weight:700">Cliente (se llena solo al buscar la serie; o elígelo aquí)</label>
      <select class="inp-web" id="dpC"><option value="">—</option>${cls.map((c) => `<option value="${esc(c.id_escritorio)}" ${c.id_escritorio === ctx.id_cliente ? 'selected' : ''}>${esc(c.razon_social)}</option>`).join('')}</select>
      <div class="grid2">${fl('N° proforma', 'dpN', p && p.numero)}${fl('Fecha', 'dpF', (p && p.fecha) || HOY(), 'date')}${fl('Validez (días)', 'dpV', p ? p.validez_dias : 15, 'number')}${fl('IVA %', 'dpI', p ? p.iva_pct : 15, 'number')}</div>
      <h4 style="margin:8px 0 4px">Detalle de la cotización</h4>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><select class="inp-web" id="dpCombo" style="flex:1;min-width:200px"><option value="">— combo de mantenimiento —</option>${combos.map((a) => `<option value="${esc(a.id_escritorio)}">${esc(a.descripcion)}</option>`).join('')}</select>
        <input class="inp-web" id="dpCP" type="number" step="any" placeholder="Precio" style="width:90px"><label style="font-size:12px"><input type="checkbox" id="dpCI"> con insumos incluidos</label><button class="btn-web sec" id="dpAddC">➕ Combo</button></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"><select class="inp-web" id="dpSv" style="flex:1;min-width:200px"><option value="">— actividad/servicio independiente —</option>${servicios.map((s) => `<option value="${esc(s.id_escritorio)}">${esc((s.codigo || '?') + ' — ' + s.descripcion + ' ($' + d2(s.precio) + ')')}</option>`).join('')}</select>
        <input class="inp-web" id="dpSvQ" type="number" step="any" value="1" style="width:70px"><button class="btn-web sec" id="dpAddS">➕ Servicio</button></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px"><select class="inp-web" id="dpRp" style="flex:1;min-width:200px"><option value="">— insumo/repuesto —</option>${repuestos.map((r) => `<option value="${esc(r.id_escritorio)}">${esc((r.codigo || '?') + ' — ' + r.descripcion + ' ($' + d2(r.precio) + ')')}</option>`).join('')}</select>
        <input class="inp-web" id="dpRpQ" type="number" step="any" value="1" style="width:70px"><label style="font-size:12px"><input type="checkbox" id="dpRpS"> incluido en el combo (sin valor)</label><button class="btn-web sec" id="dpAddR">➕ Repuesto</button></div>
      <div id="dpItems" style="margin-top:6px"></div><div id="dpTot" style="text-align:right;font-weight:700"></div>
      ${fl('Observación', 'dpO', p && p.observacion)}
      <div id="dpErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="dpX">Cancelar</button><button class="btn-web prim" id="dpOk">💾 Guardar</button></div>`);
    U().$id('dpX').onclick = U().cerrarModal;
    if (!p) ivaConfig().then((v) => { const e = U().$id('dpI'); if (e && e.value === '15') e.value = v; });
    const pintar = () => {
      let sub = 0;
      U().$id('dpItems').innerHTML = U().tabla(['Descripción', 'Cant.', 'V. unit.', 'Subtotal', ''], items.map((it, i) => {
        const t = String(it.tipo || '').toUpperCase(), sb = t === 'ACTIVIDAD' || t === 'INSUMO', st = n(it.cantidad) * n(it.valor_unit); sub += st;
        const d = t === 'COMBO' ? '<b>📦 ' + esc(it.descripcion) + '</b>' : (sb ? '&nbsp;&nbsp;&nbsp;' + (t === 'ACTIVIDAD' ? '• ' : '- ') + esc(it.descripcion) : (t === 'SERVICIO' ? '🔧 ' : '🧩 ') + esc(it.descripcion));
        return [d, g(it.cantidad), sb ? '' : d2(it.valor_unit), sb ? '' : d2(st), `<button class="btn-web mini sec" data-q="${i}">🗑</button>`];
      }));
      const iva = sub * n(U().$id('dpI').value) / 100;
      U().$id('dpTot').textContent = 'Subtotal: $' + d2(sub) + '    IVA: $' + d2(iva) + '    TOTAL: $' + d2(sub + iva);
      U().$id('dpItems').querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { items.splice(+b.dataset.q, 1); pintar(); });
    };
    pintar(); U().$id('dpI').oninput = pintar;
    const info = U().$id('dpInfo');
    const buscar = async () => {
      const s = U().$id('dpS').value.trim(); if (!s) return;
      const e = D.eqs.find((x) => String(x.serie || '').trim() === s);
      if (!e) { info.textContent = '✖ Equipo no encontrado'; info.style.color = '#C0392B'; ctx.id_equipo = null; return; }
      const cl = D.cls.find((c) => c.id === e.id_cliente);
      ctx.serie = s; ctx.id_equipo = e.id_escritorio; ctx.id_cliente = cl ? cl.id_escritorio : ctx.id_cliente;
      info.textContent = '✓ Cliente: ' + (cl ? cl.razon_social : '—'); info.style.color = '#117A65';
      if (cl) U().$id('dpC').value = cl.id_escritorio;
    };
    U().$id('dpBus').onclick = buscar; if (p && p.serie) buscar();
    U().$id('dpC').onchange = (e) => { ctx.id_cliente = e.target.value || null; };
    const precioServicio = (nombre) => { const s = servicios.find((x) => String(x.descripcion || '').toUpperCase() === String(nombre || '').toUpperCase() || String(x.codigo || '').toUpperCase() === String(nombre || '').toUpperCase()); return s ? { pr: n(s.precio), id: s.id_escritorio } : { pr: 0, id: null }; };
    U().$id('dpCombo').onchange = () => { const a = combos.find((x) => x.id_escritorio === U().$id('dpCombo').value); U().$id('dpCP').value = a ? d2(precioServicio(a.descripcion).pr) : ''; };
    U().$id('dpAddC').onclick = () => {
      const a = combos.find((x) => x.id_escritorio === U().$id('dpCombo').value); if (!a) return;
      const ps = precioServicio(a.descripcion);
      items.push({ tipo: 'COMBO', id_ref: ps.id, codigo: '', descripcion: a.descripcion, cantidad: 1, valor_unit: parseFloat(U().$id('dpCP').value || '0') || 0 });
      aitems.filter((i) => i.id_actividad === a.id && (i.orden == null || n(i.orden) >= 0) && !i.borrado).sort((x, y) => n(x.orden) - n(y.orden))
        .forEach((i) => items.push({ tipo: 'ACTIVIDAD', id_ref: null, codigo: '', descripcion: i.descripcion, cantidad: 1, valor_unit: 0 }));
      if (!ctx.tipo) ctx.tipo = a.descripcion;
      if (U().$id('dpCI').checked) U().$id('dpRpS').checked = true;
      pintar();
    };
    U().$id('dpAddS').onclick = () => { const s = servicios.find((x) => x.id_escritorio === U().$id('dpSv').value); if (!s) return;
      items.push({ tipo: 'SERVICIO', id_ref: s.id_escritorio, codigo: s.codigo || '', descripcion: s.descripcion, cantidad: parseFloat(U().$id('dpSvQ').value) || 1, valor_unit: n(s.precio) }); pintar(); };
    U().$id('dpAddR').onclick = () => { const r = repuestos.find((x) => x.id_escritorio === U().$id('dpRp').value); if (!r) return; const sin = U().$id('dpRpS').checked;
      items.push({ tipo: sin ? 'INSUMO' : 'REPUESTO', id_ref: r.id_escritorio, codigo: r.codigo || '', descripcion: r.descripcion, cantidad: parseFloat(U().$id('dpRpQ').value) || 1, valor_unit: sin ? 0 : n(r.precio) }); pintar(); };
    U().$id('dpOk').onclick = async () => {
      const err = (m) => { U().$id('dpErr').textContent = m; U().$id('dpOk').disabled = false; };
      U().$id('dpOk').disabled = true;
      ctx.id_cliente = U().$id('dpC').value || ctx.id_cliente;
      if (!ctx.id_cliente) return err('Indica la serie (carga el cliente) o elige un cliente.');
      if (!items.length) return err('Agrega al menos un ítem.');
      const num = U().$id('dpN').value.trim();
      if (!(await numeroLibre('proformas', num, p && p.id))) return err('Ya existe una proforma con ese número.');
      const serie = U().$id('dpS').value.trim();
      if (serie && !ctx.id_equipo) { const e = D.eqs.find((x) => String(x.serie || '').trim() === serie); ctx.id_equipo = e ? e.id_escritorio : null; }
      const val = parseFloat(U().$id('dpV').value || '0'), iva = parseFloat(U().$id('dpI').value || '0');
      if (![val, iva].every(isFinite)) return err('Revisa los valores numéricos.');
      try {
        await guardarProforma({ numero: num, id_cliente: ctx.id_cliente, serie, id_equipo: ctx.id_equipo, fecha: U().$id('dpF').value, validez_dias: Math.trunc(val),
          tipo_mantenimiento: ctx.tipo || '', iva_pct: iva, observacion: U().$id('dpO').value.trim() }, items, p);
        U().toast('✅ Cotización guardada'); U().cerrarModal(); recargar();
      } catch (e) { err('❌ ' + e.message); }
    };
  }
  async function programar(p, D) {
    if (p.estado !== 'APROBADA') { U().toast('Primero aprueba la proforma (estado actual: ' + p.estado + ').'); return; }
    const acts = await API.select('actividades').catch(() => []);
    const tipos = acts.filter((a) => (a.estado || 'ACTIVO') === 'ACTIVO').map((a) => a.descripcion).filter(Boolean);
    U().modal(`<h3>📅 Programar mantenimiento desde proforma ${esc(p.numero || '')}</h3><p>Cliente: ${esc((D.C[p.id_cliente] || {}).razon_social || '')} · Serie: ${esc(p.serie || '')}</p>
      <div class="grid2"><div><label style="font-size:12px;font-weight:700">Fecha programada</label><input class="inp-web" id="ppF" type="date" value="${HOY()}"></div>
      <div><label style="font-size:12px;font-weight:700">Tipo</label><input class="inp-web" id="ppT" list="ppTL" value="${esc(p.tipo_mantenimiento || tipos[0] || '')}"><datalist id="ppTL">${tipos.map((t) => `<option>${esc(t)}</option>`).join('')}</datalist></div></div>
      <p style="font-size:11px;color:#566573">Se creará una visita en Programación de mantenimiento, enlazada a esta proforma. Al ejecutarla y crear la OT, quedarán vinculadas.</p>
      <div id="ppErr" style="color:#C0392B;font-size:13px;min-height:18px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="ppX">Cancelar</button><button class="btn-web prim" id="ppOk">📅 Programar</button></div>`);
    U().$id('ppX').onclick = U().cerrarModal;
    U().$id('ppOk').onclick = async () => {
      const f = U().$id('ppF').value; if (!f) { U().$id('ppErr').textContent = 'Indique la fecha.'; return; }
      U().$id('ppOk').disabled = true;
      try {
        const e = D.eqs.find((x) => x.id_escritorio === p.id_equipo) || D.eqs.find((x) => p.serie && String(x.serie || '').trim() === p.serie);
        const cl = D.C[p.id_cliente];
        const v = await API.insert('visitas_programadas', Object.assign({ id_equipo: e ? e.id : null, serie: p.serie || '', id_cliente: cl ? cl.id : (e ? e.id_cliente : null),
          fecha_programada: f, tipo_mantenimiento: U().$id('ppT').value.trim() || 'MANTENIMIENTO PREVENTIVO', observacion: 'Generada desde proforma ' + (p.numero || ''),
          estado: 'PROGRAMADA', hora: '', registrado_por: usuario(), fecha_registro: AHORA().slice(0, 16) }, META()));
        await API.update('proformas', p.id, Object.assign({ estado: 'PROGRAMADA', id_visita: v && v.id_escritorio }, META()));
        U().toast('📅 Mantenimiento programado. La proforma quedó PROGRAMADA.'); U().cerrarModal(); recargar();
      } catch (e) { U().$id('ppOk').disabled = false; U().$id('ppErr').textContent = '❌ ' + e.message; }
    };
  }
  // web Liquidación: «Facturación» y «Proformas» pasaron a este módulo (como el escritorio)
  const css = document.createElement('style'); css.textContent = '#liq-tab-fact,#liq-tab-prof{display:none!important}'; document.head.appendChild(css);
  window.PROSOL_FACT = { recalcular, guardarFactura, agregarPago, numeroLibre, siguienteNumero, ivaConfig, guardarProforma, pdfProforma, imprimir };
})();
