/* PROSOL web PC · lib/web_panel_reportes.js (v4.05 · W6-1 Panel + W6-5 Reportes) — igual que el escritorio.
   · Panel de control (db.dashboard_operativo): mantenimientos vencidos (1-30 / 31-60 / 61+ días) y por vencer en 7 días
     (agenda preventiva que calcula el escritorio y publica en la nube), clientes activos, equipos Generac (y OT
     históricas), facturado, por cobrar, facturas vencidas (y monto en mora), clientes con deuda; gráfico de
     mantenimientos por mes; top 10 equipos por N° de OT; clientes con mayor deuda; equipos que requieren atención;
     facturas vencidas; «🗂️ Tablero del proceso» (expedientes abiertos por etapa, días, área y siguiente paso; alerta).
     Antes la web sumaba el valor de las OT como «Total facturado» y «OT abiertas» siempre daba 0.
   · Reportes globales (frm_reportes): Historial por equipo, Servicios por técnico, Liquidaciones por periodo y
     Consolidado gerencial, cada uno con «👁 Ver» y «📄 PDF» (impresión con logo y pie PROSOL).
   Solo lectura. Módulo fuera del IIFE base. */
(() => {
  const V = window.PROSOL_WEB_VISTAS = window.PROSOL_WEB_VISTAS || {};
  const U = () => PROSOL_WEB.util;
  const esc = (s) => U().ESC(s);
  const n = (x) => { const v = parseFloat(x); return isFinite(v) ? v : 0; };
  const $$ = (x) => '$' + n(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const N = (x) => Number(x || 0).toLocaleString('en-US');
  const pad = (x) => String(x).padStart(2, '0');
  const HOY = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const dias = (iso) => Math.round((new Date(String(iso).slice(0, 10) + 'T12:00:00') - new Date(HOY() + 'T12:00:00')) / 864e5);
  const fechaOK = (f) => /^[12]\d{3}-\d{2}-/.test(String(f || ''));
  const PIE = 'Potenciado por ROCKENSY S.A. &amp; MIG — Tec. Master Luis Martínez Ibáñez';
  const sel = (t, f) => API.select(t, f).catch(() => []);
  const viva = (x) => String(x.estado || '').toUpperCase() !== 'ELIMINADA';

  function imprimir(titulo, cuerpo) {
    if (window.PROSOL_FACT && window.PROSOL_FACT.imprimir) return window.PROSOL_FACT.imprimir(titulo, cuerpo);
    const w = window.open('', '_blank'); if (!w) { U().toast('⚠ Permita las ventanas emergentes'); return; }
    w.document.write(`<html><head><meta charset="utf-8"><title>${esc(titulo)}</title></head><body><h1>${esc(titulo)}</h1>${cuerpo}<p>${PIE}</p></body></html>`); w.document.close();
  }
  const tablaPDF = (cols, filas) => `<table><thead><tr>${cols.map((c) => '<th>' + esc(c) + '</th>').join('')}</tr></thead><tbody>${filas.map((f) =>
    '<tr>' + f.map((v) => typeof v === 'number' ? '<td class="n">' + v.toFixed(2) + '</td>' : '<td>' + esc(v == null ? '' : v) + '</td>').join('') + '</tr>').join('')}</tbody></table>`;

  // ── W6-1 · Panel de control ───────────────────────────────────────
  const ORDEN = ['ABIERTO', 'PROFORMA', 'PROGRAMADO', 'EN_CAMPO', 'REALIZADO', 'CORRECCION', 'APROBADO', 'FACTURADO', 'COBRADO'];
  function siguientePaso(s, D) {
    const et = s._et, gu = D.GUI[s.id_guia];
    if (et === 'ABIERTO') return ['Coordinación', 'Crear la orden de servicio'];
    if (et === 'PROFORMA') return ['Coordinación', 'Programar la orden de servicio'];
    if (et === 'PROGRAMADO') {
      if (!gu) return ['Coordinación', 'Enviar la orden a Postventa, Repuestos y Bodega'];
      if (gu.estado === 'EMITIDA') return ['Bodega', 'Entregar materiales al técnico'];
      return ['Técnico', 'Ejecutar el servicio y registrar la OT'];
    }
    if (et === 'EN_CAMPO') return ['Técnico', 'Terminar la OT (estado REALIZADO)'];
    if (et === 'REALIZADO') return gu && gu.estado === 'ENTREGADA' ? ['Bodega', 'Registrar devolución y liquidar la guía'] : ['Postventa', 'Revisar y aprobar para facturar'];
    if (et === 'CORRECCION') return ['Técnico', 'Corregir y reenviar a revisión'];
    if (et === 'APROBADO') return ['Facturación', 'Generar la factura'];
    if (et === 'FACTURADO') return ['Facturación', 'Cobrar (saldo ' + n((D.FAC[s.id_factura] || {}).saldo).toFixed(2) + ')'];
    if (et === 'COBRADO') return ['Coordinación', 'Cerrar el expediente'];
    return ['—', ''];
  }
  async function tablero() {
    const X = V._expedientes; if (!X) return;
    const D = await X.datos();
    let lim = 3; try { const c = (await sel('config', { clave: 'TABLERO_DIAS_ALERTA' }))[0]; if (c && c.valor) lim = Math.max(1, parseInt(c.valor, 10) || 3); } catch (e) {}
    const filas = D.servicios.filter((s) => s.estado === 'ABIERTO').map((s) => {
      const [area, paso] = siguientePaso(s, D), f = String(s.fecha_etapa || s.fecha_apertura || '').slice(0, 10);
      const d = fechaOK(f) ? -dias(f) : null;
      return { s, area, paso, d, alerta: d != null && d > lim && s._et !== 'COBRADO' };
    }).sort((a, b) => (ORDEN.indexOf(a.s._et) - ORDEN.indexOf(b.s._et)) || ((b.d || 0) - (a.d || 0)));
    const res = {}; ORDEN.forEach((e) => { res[e] = { n: 0, al: 0, max: 0 }; });
    filas.forEach((f) => { const r = res[f.s._et]; if (!r) return; r.n++; r.al += f.alerta ? 1 : 0; r.max = Math.max(r.max, f.d || 0); });
    const card = (e) => `<div class="kpi ${res[e].al ? 'warn' : ''}"><div class="v">${res[e].n}</div><div class="l">${esc(X.ET[e] || e)}</div>
      <div style="font-size:11px;color:${res[e].al ? '#C0392B' : '#566573'}">${res[e].al ? res[e].al + ' en alerta · ' : ''}${res[e].n ? 'máx ' + res[e].max + ' d' : ''}</div></div>`;
    const cuerpo = filas.map((f) => [f.s.id_escritorio, (D.CLI[f.s.id_cliente] || {}).razon_social || '', f.s.serie || '', X.ET[f.s._et] || f.s._et,
      f.d == null ? '' : String(f.d), f.area, f.paso, (D.OT[f.s.id_ot] || {}).numero_ot || '', (D.FAC[f.s.id_factura] || {}).numero || '', f.alerta]);
    U().modal(`<h3>🗂️ Tablero del proceso de servicio</h3><p style="font-size:12px;color:#566573;margin:0 0 6px">Alerta: más de ${lim} días en la etapa.</p>
      <div class="kpis">${ORDEN.map(card).join('')}</div>
      <div style="max-height:52vh;overflow:auto">${U().tabla(['Expediente', 'Cliente', 'Serie', 'Etapa', 'Días', 'Área', 'Siguiente paso', 'OT', 'Factura'],
        cuerpo.map((r) => r.slice(0, 9).map((v, i) => `<span style="${r[9] ? 'color:#C0392B;font-weight:700' : ''}">${esc(v)}</span>`)))}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="tbPdf">📄 PDF</button><button class="btn-web sec" id="tbX">Cerrar</button></div>`);
    U().$id('tbX').onclick = U().cerrarModal;
    U().$id('tbPdf').onclick = () => imprimir('Tablero del proceso de servicio', `<p>Alerta: más de ${lim} días en la etapa · ` +
      ORDEN.filter((e) => res[e].n).map((e) => esc(X.ET[e] || e) + ': ' + res[e].n + (res[e].al ? ' (' + res[e].al + ' en alerta)' : '')).join(' · ') + '</p>' +
      tablaPDF(['Expediente', 'Cliente', 'Serie', 'Etapa', 'Días', 'Área', 'Siguiente paso', 'OT', 'Factura'], cuerpo.map((r) => r.slice(0, 9))));
    window._prosolTablero = filas;
  }
  V.dashboard = async () => {
    const main = U().$id('main');
    if (!API.hayNube()) return PROSOL_WEB.vistaBase('dashboard')();
    main.innerHTML = `<div class="card"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">📊 Panel de control</h2>
      <span style="flex:1"></span><button class="btn-web sec" id="pcAct">🔄 Actualizar</button><button class="btn-web verd" id="pcTab">🗂️ Tablero del proceso</button></div>
      <div id="pcK1" class="kpis" style="margin-top:8px">Cargando…</div><div id="pcK2" class="kpis"></div></div>
      <div class="grid2"><div class="card"><h3>Mantenimientos por mes (cantidad de OT)</h3><div id="pcGraf"></div></div>
      <div class="card"><h3>Top 10 equipos por N° de OT</h3><div id="pcTopEq"></div><h3>Clientes con mayor deuda (cartera)</h3><div id="pcDeu"></div></div></div>
      <div class="grid2"><div class="card"><h3 style="color:#C0392B">Equipos que requieren atención (mantenimiento vencido)</h3><div id="pcAten"></div></div>
      <div class="card"><h3 style="color:#C0392B">Facturas vencidas (cobranza)</h3><div id="pcFv"></div></div></div>`;
    U().$id('pcAct').onclick = () => V.dashboard();
    U().$id('pcTab').onclick = () => tablero();
    const [cli, eq, ots, ag, fac] = await Promise.all(['clientes', 'equipos', 'ordenes', 'agenda_preventiva', 'facturas'].map((t) => sel(t)));
    if (!U().$id('pcK1')) return;
    const C = {}; cli.forEach((c) => { C[c.id_escritorio] = c; C[c.id] = c; });
    const hoy = HOY();
    const agv = ag.map((a) => Object.assign({}, a, { _d: fechaOK(a.proximo) ? dias(a.proximo) : null }));
    const venc = agv.filter((a) => a._d != null && a._d < 0).sort((a, b) => a._d - b._d);
    const tramo = (lo, hi) => venc.filter((a) => -a._d >= lo && -a._d <= hi).length;
    const porVencer = agv.filter((a) => a._d != null && a._d >= 0 && a._d <= 7).length;
    const F = fac.filter(viva);
    const facturado = F.reduce((s, f) => s + n(f.total), 0), porCobrar = F.reduce((s, f) => s + n(f.saldo), 0);
    const fv = F.filter((f) => f.estado === 'VENCIDA');
    const deud = {}; F.filter((f) => n(f.saldo) > 0.005).forEach((f) => { const k = f.id_cliente || '—'; deud[k] = deud[k] || { nf: 0, s: 0 }; deud[k].nf++; deud[k].s += n(f.saldo); });
    const topDeu = Object.entries(deud).sort((a, b) => b[1].s - a[1].s).slice(0, 10);
    const kpi = (cls, v, l, sub) => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div>${sub ? '<div style="font-size:11px;color:#566573">' + sub + '</div>' : ''}</div>`;
    U().$id('pcK1').innerHTML = kpi('bad', N(venc.length), '🛠 Mantenimientos vencidos', `1-30 d: ${tramo(1, 30)} · 31-60 d: ${tramo(31, 60)} · 61+ d: ${tramo(61, 1e9)}`)
      + kpi('warn', N(porVencer), '⏰ Por vencer (7 días)', 'agendar esta semana')
      + kpi('ok', N(cli.filter((c) => (c.estado || 'ACTIVO') === 'ACTIVO').length), '👥 Clientes activos', '')
      + kpi('', N(eq.filter((e) => (e.estado || 'ACTIVO') === 'ACTIVO').length), '⚡ Equipos Generac', N(ots.length) + ' órdenes históricas');
    U().$id('pcK2').innerHTML = kpi('', $$(facturado), '💵 Facturado a clientes', '') + kpi('warn', $$(porCobrar), '📥 Por cobrar (cartera)', 'saldo pendiente de clientes')
      + kpi('bad', N(fv.length), '⚠ Facturas vencidas', $$(fv.reduce((s, f) => s + n(f.saldo), 0)) + ' en mora') + kpi('', N(Object.keys(deud).length), '🧾 Clientes con deuda', 'ver detalle abajo');
    const meses = {}; ots.forEach((o) => { if (fechaOK(o.fecha)) { const m = String(o.fecha).slice(0, 7); meses[m] = (meses[m] || 0) + 1; } });
    const ult = Object.keys(meses).sort().slice(-12), mx = Math.max(1, ...ult.map((m) => meses[m]));
    U().$id('pcGraf').innerHTML = ult.length ? `<div style="display:flex;align-items:flex-end;gap:6px;height:200px;padding:6px 0;border-bottom:1px solid #D5D8DC">${ult.map((m) =>
      `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%"><span style="font-size:11px;font-weight:700">${meses[m]}</span>
      <div title="${m}: ${meses[m]} OT" style="width:70%;background:#F39C12;height:${Math.round(meses[m] / mx * 170)}px;border-radius:3px 3px 0 0"></div></div>`).join('')}</div>
      <div style="display:flex;gap:6px">${ult.map((m) => `<span style="flex:1;text-align:center;font-size:10px;color:#566573">${m.slice(2)}</span>`).join('')}</div>` : '<p>Sin datos.</p>';
    const top = {}; ots.forEach((o) => { const s = String(o.serie || '').trim(); if (!s) return; top[s] = top[s] || { n: 0, c: '' }; top[s].n++; top[s].c = top[s].c || (C[o.id_cliente] || {}).razon_social || o.cliente_nombre || ''; });
    U().$id('pcTopEq').innerHTML = U().tabla(['Serie', 'OT', 'Cliente'], Object.entries(top).sort((a, b) => b[1].n - a[1].n).slice(0, 10).map(([s, v]) => [esc(s), v.n, esc(v.c)]));
    U().$id('pcDeu').innerHTML = topDeu.length ? U().tabla(['Cliente', 'Fac.', 'Saldo'], topDeu.map(([k, v]) => [esc((C[k] || {}).razon_social || k), v.nf, $$(v.s)])) : '<p>Sin deudas registradas.</p>';
    U().$id('pcAten').innerHTML = venc.length ? U().tabla(['Cliente', 'Serie', 'Estado'], venc.slice(0, 10).map((a) => [esc(a.cliente || ''), esc(a.serie || ''), 'vencido ' + (-a._d) + ' días'])) : '<p>Sin mantenimientos vencidos.</p>';
    const fvl = F.filter((f) => n(f.saldo) > 0.005 && f.fecha_vence && f.fecha_vence < hoy).sort((a, b) => String(a.fecha_vence).localeCompare(String(b.fecha_vence))).slice(0, 10);
    U().$id('pcFv').innerHTML = fvl.length ? U().tabla(['N° Factura', 'Cliente', 'Saldo', 'Venció'], fvl.map((f) => [esc(f.numero || ''), esc((C[f.id_cliente] || {}).razon_social || ''), $$(f.saldo), esc(f.fecha_vence)])) : '<p>Sin facturas vencidas.</p>';
  };

  // ── W6-5 · Reportes globales ──────────────────────────────────────
  let pest = 'eq';
  const R = { serie: '', tec: '', d1: '', d2: '', l1: '', l2: '', g1: '', g2: '' };
  async function datosOT() {
    const [ots, cli, eq, tec, ott] = await Promise.all(['ordenes', 'clientes', 'equipos', 'tecnicos', 'ot_tecnicos'].map((t) => sel(t)));
    const C = {}; cli.forEach((c) => { C[c.id] = c; C[c.id_escritorio] = c; });
    const T = {}; ott.forEach((x) => { (T[x.id_orden] = T[x.id_orden] || []).push(x); });
    return { ots, cli, C, eq, tec, T };
  }
  const nomTec = (t) => ((t.nombres || '') + ' ' + (t.apellidos || '')).trim();
  V.reportes = async () => {
    const main = U().$id('main');
    if (!API.hayNube()) return PROSOL_WEB.vistaBase('reportes')();
    const b = (k, x) => `<button class="btn-web ${pest === k ? 'prim' : 'sec'}" data-rp="${k}">${x}</button>`;
    main.innerHTML = `<div class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b>📑 Reportes globales</b>
      ${b('eq', 'Historial por equipo')}${b('tec', 'Servicios por técnico')}${b('liq', 'Liquidaciones por periodo')}${b('ger', 'Consolidado gerencial')}
      <button class="btn-web sec" id="rpAnt" title="Búsquedas y listados de la versión anterior">🔍 Búsquedas y listados</button></div><div class="card" id="rpCuerpo">Cargando…</div>`;
    main.querySelectorAll('[data-rp]').forEach((x) => x.onclick = () => { pest = x.dataset.rp; V.reportes(); });
    U().$id('rpAnt').onclick = () => PROSOL_WEB.vistaBase('reportes')();
    const c = U().$id('rpCuerpo');
    const hoy = HOY(), ini = hoy.slice(0, 4) + '-01-01';
    if (pest === 'eq') {
      const eq = await sel('equipos');
      c.innerHTML = `<div class="toolbar" style="flex-wrap:wrap"><label style="font-size:13px">Serie del equipo: <input class="inp-web" id="rpSer" list="rpSerL" value="${esc(R.serie)}" style="width:200px"></label>
        <datalist id="rpSerL">${eq.filter((e) => e.serie && (e.estado || 'ACTIVO') === 'ACTIVO').map((e) => `<option>${esc(e.serie)}</option>`).join('')}</datalist>
        <button class="btn-web prim" id="rpVer">👁 Ver</button><button class="btn-web sec" id="rpPdf">📄 PDF</button></div><div id="rpOut"></div>`;
      const calc = async () => {
        R.serie = U().$id('rpSer').value.trim();
        const e = eq.find((x) => String(x.serie || '').trim() === R.serie);
        if (!e) { U().$id('rpOut').innerHTML = '<p style="color:#C0392B">Serie no encontrada.</p>'; return null; }
        const D = await datosOT(); const cl = D.C[e.id_cliente] || {};
        const ots = D.ots.filter((o) => String(o.serie || '').trim() === R.serie).sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')) || String(a.numero_ot).localeCompare(String(b.numero_ot)));
        const filas = ots.map((o) => [o.numero_ot || '', o.fecha || '', o.tipo_ot || '', o.estado || '', o.horas_maquina == null ? '' : String(o.horas_maquina),
          (D.T[o.id] || []).map((t) => t.nombre_tecnico).filter(Boolean).join(', '), n(o.valor_total)]);
        const cab = `<p><b>${esc(R.serie)}</b> · ${esc([e.marca, e.modelo].filter(Boolean).join(' '))} · ${esc(cl.razon_social || '')} · ${esc(cl.contacto || '')} ${esc(cl.telefono || '')} · ${esc(e.ubicacion || cl.ciudad || '')}</p>`;
        return { cab, filas, tot: filas.reduce((s, f) => s + f[6], 0) };
      };
      const cols = ['N° OT', 'Fecha', 'Tipo', 'Estado', 'Horas', 'Técnico(s)', 'Valor'];
      U().$id('rpVer').onclick = async () => { const r = await calc(); if (!r) return; U().$id('rpOut').innerHTML = r.cab + U().tabla(cols, r.filas.map((f) => f.map((v, i) => i === 6 ? v.toFixed(2) : esc(v)))) + `<p><b>${r.filas.length} OT · valor $${r.tot.toFixed(2)}</b></p>`; };
      U().$id('rpPdf').onclick = async () => { const r = await calc(); if (r) imprimir('Historial del equipo ' + R.serie, r.cab + tablaPDF(cols, r.filas) + `<p><b>${r.filas.length} OT · valor $${r.tot.toFixed(2)}</b></p>`); };
      return;
    }
    if (pest === 'tec') {
      const tec = (await sel('tecnicos')).filter((t) => (t.estado || 'ACTIVO') === 'ACTIVO').sort((a, b) => nomTec(a).localeCompare(nomTec(b)));
      c.innerHTML = `<div class="toolbar" style="flex-wrap:wrap"><label style="font-size:13px">Técnico: <select class="inp-web" id="rpTec" style="width:auto">${tec.map((t) => `<option value="${esc(t.id)}" ${R.tec === t.id ? 'selected' : ''}>${esc(nomTec(t))}</option>`).join('')}</select></label>
        <label style="font-size:13px">Desde <input class="inp-web" type="date" id="rpD1" value="${esc(R.d1 || ini)}"></label><label style="font-size:13px">Hasta <input class="inp-web" type="date" id="rpD2" value="${esc(R.d2 || hoy)}"></label>
        <button class="btn-web prim" id="rpVer">👁 Ver</button><button class="btn-web sec" id="rpPdf">📄 PDF</button></div><div id="rpOut"></div>`;
      const calc = async () => {
        R.tec = U().$id('rpTec').value; R.d1 = U().$id('rpD1').value; R.d2 = U().$id('rpD2').value;
        const t = tec.find((x) => x.id === R.tec); if (!t) return null;
        const D = await datosOT(), nom = nomTec(t).toUpperCase();
        const ots = D.ots.filter((o) => (D.T[o.id] || []).some((x) => x.id_tecnico === t.id || String(x.nombre_tecnico || '').trim().toUpperCase() === nom)
          && (!R.d1 || String(o.fecha || '') >= R.d1) && (!R.d2 || String(o.fecha || '') <= R.d2))
          .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')) || String(a.numero_ot).localeCompare(String(b.numero_ot)));
        const filas = ots.map((o) => [o.numero_ot || '', o.fecha || '', (D.C[o.id_cliente] || {}).razon_social || o.cliente_nombre || '', o.serie || '', o.tipo_ot || '', o.estado || '', n(o.valor_total)]);
        return { t, filas, tot: filas.reduce((s, f) => s + f[6], 0) };
      };
      const cols = ['N° OT', 'Fecha', 'Cliente', 'Serie', 'Tipo', 'Estado', 'Valor'];
      U().$id('rpVer').onclick = async () => { const r = await calc(); if (!r) return; U().$id('rpOut').innerHTML = U().tabla(cols, r.filas.map((f) => f.map((v, i) => i === 6 ? v.toFixed(2) : esc(v)))) + `<p><b>${r.filas.length} OT · valor $${r.tot.toFixed(2)}</b></p>`; };
      U().$id('rpPdf').onclick = async () => { const r = await calc(); if (r) imprimir('Servicios por técnico · ' + nomTec(r.t), `<p>Periodo: ${esc(R.d1 || 'inicio')} a ${esc(R.d2 || 'hoy')}</p>` + tablaPDF(cols, r.filas) + `<p><b>${r.filas.length} OT · valor $${r.tot.toFixed(2)}</b></p>`); };
      return;
    }
    if (pest === 'liq') {
      c.innerHTML = `<div class="toolbar" style="flex-wrap:wrap"><label style="font-size:13px">Desde <input class="inp-web" type="date" id="rpL1" value="${esc(R.l1 || ini)}"></label><label style="font-size:13px">Hasta <input class="inp-web" type="date" id="rpL2" value="${esc(R.l2 || hoy)}"></label>
        <button class="btn-web prim" id="rpVer">👁 Ver</button><button class="btn-web sec" id="rpPdf">📄 PDF</button></div><div id="rpOut"></div>`;
      const calc = async () => {
        R.l1 = U().$id('rpL1').value; R.l2 = U().$id('rpL2').value;
        const L = (await sel('liquidaciones')).filter((l) => (!R.l1 || String(l.fecha_hasta || '') >= R.l1) && (!R.l2 || String(l.fecha_desde || '') <= R.l2))
          .sort((a, b) => String(a.fecha_desde || '').localeCompare(String(b.fecha_desde || '')) || (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0));
        const filas = L.map((l) => [l.numero || '', l.modo_periodo || '', l.fecha_desde || '', l.fecha_hasta || '', n(l.total), n(l.total_pagado), n(l.saldo), l.estado || '']);
        const t = (i) => filas.reduce((s, f) => s + f[i], 0);
        return { filas, pie: `<p><b>${filas.length} liquidaciones · total $${t(4).toFixed(2)} · pagado $${t(5).toFixed(2)} · saldo $${t(6).toFixed(2)}</b></p>` };
      };
      const cols = ['N°', 'Periodo', 'Desde', 'Hasta', 'Total', 'Pagado', 'Saldo', 'Estado'];
      U().$id('rpVer').onclick = async () => { const r = await calc(); U().$id('rpOut').innerHTML = U().tabla(cols, r.filas.map((f) => f.map((v) => typeof v === 'number' ? v.toFixed(2) : esc(v)))) + r.pie; };
      U().$id('rpPdf').onclick = async () => { const r = await calc(); if (!r.filas.length) { U().toast('No hay liquidaciones en ese periodo.'); return; } imprimir('Liquidaciones por periodo', `<p>Periodo: ${esc(R.l1 || 'inicio')} a ${esc(R.l2 || 'hoy')}</p>` + tablaPDF(cols, r.filas) + r.pie); };
      return;
    }
    // Consolidado gerencial (db.reporte_gerencial)
    c.innerHTML = `<div class="toolbar" style="flex-wrap:wrap"><label style="font-size:13px">Desde <input class="inp-web" type="date" id="rpG1" value="${esc(R.g1 !== '' ? R.g1 : ini)}"></label>
      <label style="font-size:13px">Hasta <input class="inp-web" type="date" id="rpG2" value="${esc(R.g2 !== '' ? R.g2 : hoy)}"></label>
      <button class="btn-web sec" id="rpAnio">📅 Año actual</button><button class="btn-web sec" id="rpTodo">🗓 Todo</button>
      <button class="btn-web prim" id="rpVer">👁 Ver resumen</button><button class="btn-web sec" id="rpPdf">📄 PDF gerencial</button></div>
      <pre id="rpOut" style="background:#F7F9FA;padding:10px;border-radius:8px;white-space:pre-wrap;font-size:12px">Elige un rango y pulsa «Ver resumen» o «PDF gerencial».</pre>`;
    U().$id('rpAnio').onclick = () => { U().$id('rpG1').value = ini; U().$id('rpG2').value = hoy; };
    U().$id('rpTodo').onclick = () => { U().$id('rpG1').value = ''; U().$id('rpG2').value = ''; };
    const gerencial = async () => {
      const d = U().$id('rpG1').value, h = U().$id('rpG2').value; R.g1 = d; R.g2 = h;
      const en = (f) => fechaOK(f) && (!d || String(f) >= d) && (!h || String(f).slice(0, 10) <= h);
      const enF = (f) => (!d || String(f || '') >= d) && (!h || String(f || '').slice(0, 10) <= h);
      const [D, vis, fac, mov, rep, prf] = await Promise.all([datosOT(), sel('visitas_programadas'), sel('facturas'), sel('inv_movimientos'), sel('repuestos'), sel('proformas')]);
      const ots = D.ots.filter((o) => en(o.fecha));
      const cnt = (arr, key) => { const m = {}; arr.forEach((x) => { const k = key(x) || '—'; m[k] = (m[k] || 0) + 1; }); return Object.entries(m); };
      const V2 = vis.filter((v) => enF(v.fecha_programada)), vd = {}; V2.forEach((v) => { vd[v.estado] = (vd[v.estado] || 0) + 1; });
      const real = (vd.REALIZADA || 0) + (vd.EJECUTADA || 0);
      const F2 = fac.filter(viva).filter((f) => enF(f.fecha_factura)), s = (k) => F2.reduce((t, f) => t + n(f[k]), 0);
      const M2 = mov.filter((m) => enF(m.fecha)), sm = (t) => M2.filter((m) => m.tipo === t).reduce((a, m) => a + n(m.cantidad), 0);
      const R2 = rep.filter((r) => (r.estado || 'ACTIVO') === 'ACTIVO' && (r.clase || 'REPUESTO') !== 'SERVICIO');
      const P2 = prf.filter(viva).filter((p) => enF(p.fecha)), pd = {}; P2.forEach((p) => { pd[p.estado] = (pd[p.estado] || 0) + 1; });
      const topEq = cnt(ots.filter((o) => String(o.serie || '').trim()), (o) => String(o.serie).trim()).sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([se, k]) => [se, k, (D.C[(ots.find((o) => String(o.serie).trim() === se) || {}).id_cliente] || {}).razon_social || '']);
      const k = {
        desde: d || 'inicio', hasta: h || 'hoy', ot_total: ots.length,
        ot_por_tipo: cnt(ots, (o) => o.tipo_ot).sort((a, b) => b[1] - a[1]),
        ot_por_mes: cnt(ots, (o) => String(o.fecha).slice(0, 7)).sort((a, b) => a[0].localeCompare(b[0])),
        ot_por_tecnico: cnt(ots.flatMap((o) => (D.T[o.id] || []).map((x) => ({ t: x.nombre_tecnico })), (x) => x.t), (x) => x.t).sort((a, b) => b[1] - a[1]),
        vis_total: V2.length, vis_realizadas: real, vis_cumplimiento: V2.length ? Math.round(real / V2.length * 1000) / 10 : 0,
        fact_n: F2.length, fact_facturado: s('total'), fact_cobrado: s('pagado'), fact_retenido: s('retenido'), fact_por_cobrar: s('saldo'),
        fact_vencidas: F2.filter((f) => f.estado === 'VENCIDA').length,
        inv_entradas: sm('ENTRADA'), inv_salidas: sm('SALIDA'), inv_items: R2.length, inv_valor: R2.reduce((a, r) => a + n(r.stock) * n(r.costo), 0),
        inv_bajo: R2.filter((r) => n(r.stock) <= n(r.stock_min)).length,
        prof_total: P2.length, prof_aprobadas: (pd.APROBADA || 0) + (pd.PROGRAMADA || 0) + (pd.EJECUTADA || 0), prof_ejecutadas: pd.EJECUTADA || 0, top_equipos: topEq,
      };
      return k;
    };
    const texto = (k) => ['REPORTE GERENCIAL  ·  Período: ' + k.desde + ' a ' + k.hasta, '='.repeat(60), 'MANTENIMIENTO',
      '  Órdenes de trabajo realizadas : ' + k.ot_total,
      '  Cumplimiento de agenda        : ' + k.vis_cumplimiento.toFixed(1) + '%  (' + k.vis_realizadas + ' realizadas / ' + k.vis_total + ' programadas)', '',
      'CARTERA Y COBRANZA', '  Facturas               : ' + k.fact_n, '  Facturado              : $' + k.fact_facturado.toFixed(2), '  Cobrado                : $' + k.fact_cobrado.toFixed(2),
      '  Retenido               : $' + k.fact_retenido.toFixed(2), '  Por cobrar (cartera)   : $' + k.fact_por_cobrar.toFixed(2), '  Facturas vencidas      : ' + k.fact_vencidas, '',
      'INVENTARIO', '  Entradas / Salidas     : ' + k.inv_entradas + ' / ' + k.inv_salidas + ' unidades', '  Ítems en catálogo      : ' + k.inv_items,
      '  Valor del inventario   : $' + k.inv_valor.toFixed(2), '  Repuestos bajo stock   : ' + k.inv_bajo, '',
      'COMERCIAL (PROFORMAS)', '  Proformas              : ' + k.prof_total + '  (aprobadas ' + k.prof_aprobadas + ' · ejecutadas ' + k.prof_ejecutadas + ')', '',
      'TOP EQUIPOS POR N° DE OT'].concat(k.top_equipos.map(([s, c, cl]) => '  ' + String(s).padEnd(22) + ' ' + String(c).padStart(3) + ' OT   ' + cl)).join('\n');
    U().$id('rpVer').onclick = async () => { U().$id('rpOut').textContent = 'Calculando…'; const k = await gerencial(); U().$id('rpOut').textContent = texto(k); window._prosolGerencial = k; };
    U().$id('rpPdf').onclick = async () => {
      const k = await gerencial();
      imprimir('Reporte gerencial', `<p><b>Período:</b> ${esc(k.desde)} a ${esc(k.hasta)}</p>
        <h3>Mantenimiento</h3>${tablaPDF(['Indicador', 'Valor'], [['Órdenes de trabajo realizadas', String(k.ot_total)], ['Cumplimiento de agenda', k.vis_cumplimiento.toFixed(1) + '% (' + k.vis_realizadas + ' / ' + k.vis_total + ')']])}
        <h3>OT por tipo</h3>${tablaPDF(['Tipo', 'OT'], k.ot_por_tipo.map(([a, b]) => [a, String(b)]))}
        <h3>OT por mes</h3>${tablaPDF(['Mes', 'OT'], k.ot_por_mes.map(([a, b]) => [a, String(b)]))}
        <h3>OT por técnico</h3>${tablaPDF(['Técnico', 'OT'], k.ot_por_tecnico.map(([a, b]) => [a, String(b)]))}
        <h3>Cartera y cobranza</h3>${tablaPDF(['Facturas', 'Facturado', 'Cobrado', 'Retenido', 'Por cobrar', 'Vencidas'], [[String(k.fact_n), k.fact_facturado, k.fact_cobrado, k.fact_retenido, k.fact_por_cobrar, String(k.fact_vencidas)]])}
        <h3>Inventario</h3>${tablaPDF(['Entradas', 'Salidas', 'Ítems', 'Valor', 'Bajo stock'], [[String(k.inv_entradas), String(k.inv_salidas), String(k.inv_items), k.inv_valor, String(k.inv_bajo)]])}
        <h3>Comercial (proformas)</h3>${tablaPDF(['Proformas', 'Aprobadas', 'Ejecutadas'], [[String(k.prof_total), String(k.prof_aprobadas), String(k.prof_ejecutadas)]])}
        <h3>Top equipos por N° de OT</h3>${tablaPDF(['Serie', 'OT', 'Cliente'], k.top_equipos.map(([a, b, c2]) => [a, String(b), c2]))}`);
    };
  };
  window.PROSOL_PANEL = { tablero, siguientePaso };
})();
