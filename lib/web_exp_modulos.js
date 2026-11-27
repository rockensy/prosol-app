/* PROSOL web PC · lib/web_exp_modulos.js (v4.04 · R-2, R-3, R-4)
   Las funciones del expediente también en su módulo, igual que el escritorio (aprobado por Luis 26/11/2026). Son las
   MISMAS ventanas y reglas de «🗂 Expedientes» (lib/web_expedientes.js → V._expedientes.accion):
   · Inventario › «🚚 Bodega de expedientes»: 📦 Reservar repuestos y 🚚 Guía / Bodega (crear desde la orden, entregar, liquidar).
   · Órdenes OT › «✅ Revisión para facturar»: lista de revisión, aprobar (solo ADMIN), corrección, reenviar.
   · Facturación y proformas › «🗂 Expedientes: proforma y factura»: 🧾 proforma desde la orden y 💵 factura del expediente.
   El expediente conserva sus botones. Módulo fuera del IIFE base. */
(() => {
  const V = window.PROSOL_WEB_VISTAS = window.PROSOL_WEB_VISTAS || {};
  const U = () => PROSOL_WEB.util;
  const esc = (s) => U().ESC(s);
  const n = (x) => { const v = parseFloat(x); return isFinite(v) ? v : 0; };
  const GUIA = { EMITIDA: 'Emitida', ENTREGADA: 'Entregada al técnico', LIQUIDADA: 'Liquidada' };
  const REV = { PENDIENTE: 'Pendiente', APROBADA: 'Aprobada p/ facturar', CORRECCION: 'Corrección solicitada' };
  const F = { bodega: { solo: true, q: '' }, revision: { solo: true, q: '' }, facturacion: { solo: true, q: '' } };
  const MODOS = {
    bodega: { titulo: '🚚 Bodega de expedientes — guías y repuestos de cada orden de servicio', filtro: 'Solo pendientes de bodega (sin guía liquidada)',
      cols: ['Expediente', 'Cliente', 'Serie', 'Etapa', 'Orden de servicio', 'Técnico', 'Guía', 'Estado de la guía', ''] },
    revision: { titulo: '✅ Revisión para facturar — órdenes de trabajo de cada expediente', filtro: 'Solo pendientes de revisión (sin aprobar)',
      cols: ['Expediente', 'Cliente', 'Serie', 'OT', 'Etapa', 'Revisión', 'Revisó', ''] },
    facturacion: { titulo: '🗂 Expedientes: proforma desde la orden de servicio y factura del expediente', filtro: 'Solo con algo por hacer (sin proforma, por facturar o con saldo)',
      cols: ['Expediente', 'Cliente', 'Serie', 'Etapa', 'Proforma', 'OT', 'Factura', 'Saldo', 'Por hacer', ''] },
  };
  function porHacer(s, D) {
    if (s.estado !== 'ABIERTO') return '';
    if (!s.id_proforma && s.id_visita) return 'Crear proforma desde la orden';
    if (s.revision === 'APROBADA' && !s.id_factura) return 'Por facturar';
    const f = D.FAC[s.id_factura];
    if (f && n(f.saldo) > 0.005) return 'Cobrar saldo';
    return '';
  }
  async function panel(cont, modo) {
    const X = V._expedientes; if (!X) { cont.innerHTML = 'Expedientes no disponible.'; return; }
    const M = MODOS[modo], st = F[modo], P = X.permisos;
    cont.innerHTML = 'Cargando expedientes…';
    const D = await X.datos();
    if (!cont.isConnected) return;
    cont.innerHTML = `<div style="font-weight:700;color:#1C2733;margin-bottom:6px">${M.titulo}</div>
      <div class="toolbar" style="flex-wrap:wrap"><label style="font-size:13px"><input type="checkbox" data-px="solo" ${st.solo ? 'checked' : ''}> ${M.filtro}</label>
      <input class="inp-web" data-px="q" placeholder="Buscar" value="${esc(st.q)}" style="min-width:200px"><span data-px="n" style="font-size:13px;font-weight:700;color:#2471A3"></span></div>
      <div data-px="lista"></div>`;
    const $ = (k) => cont.querySelector('[data-px="' + k + '"]');
    const recargar = () => panel(cont, modo);
    const pintar = () => {
      const q = st.q.trim().toUpperCase();
      const filas = [];
      D.servicios.filter((s) => s.estado === 'ABIERTO').sort((a, b) => String(b.id_escritorio).localeCompare(String(a.id_escritorio))).forEach((s) => {
        const cli = (D.CLI[s.id_cliente] || {}).razon_social || '', et = `<b style="color:${X.COLOR[s._et] || '#333'}">${esc(X.ET[s._et] || s._et)}</b>`;
        const btn = (acc, txt, okk) => okk ? `<button class="btn-web mini sec" data-acc="${acc}" data-id="${esc(s.id_escritorio)}">${txt}</button> ` : '';
        let celdas, texto;
        if (modo === 'bodega') {
          if (!s.id_visita && !s.id_guia) return;
          const gu = D.GUI[s.id_guia], v = D.VIS[s.id_visita] || {};
          if (st.solo && gu && gu.estado === 'LIQUIDADA') return;
          const estG = gu ? (GUIA[gu.estado] || gu.estado || '') : 'Sin guía';
          celdas = [esc(s.id_escritorio), esc(cli), esc(s.serie || ''), et, esc(v.fecha_programada || ''), esc(v.tecnico_asignado || ''), esc(gu ? gu.numero || '' : ''), esc(estG),
            '<span style="white-space:nowrap">' + btn('reservar', '📦 Reservar', P.gestiona()) + btn('bodega', '🚚 Guía / Bodega', P.gestiona()) + '</span>'];
          texto = [s.id_escritorio, cli, s.serie, v.tecnico_asignado, estG].join(' ');
        } else if (modo === 'revision') {
          if (!s.id_ot) return;
          const rev = s.revision || 'PENDIENTE';
          if (st.solo && rev === 'APROBADA') return;
          celdas = [esc(s.id_escritorio), esc(cli), esc(s.serie || ''), esc((D.OT[s.id_ot] || {}).numero_ot || ''), et, esc(REV[rev] || rev),
            esc(((s.revision_por || '') + ' ' + String(s.revision_en || '').slice(0, 10)).trim()), btn('revision', '✅ Revisión', true)];
          texto = [s.id_escritorio, cli, s.serie, (D.OT[s.id_ot] || {}).numero_ot, REV[rev]].join(' ');
        } else {
          const ph = porHacer(s, D);
          if (st.solo && !ph) return;
          const f = D.FAC[s.id_factura];
          celdas = [esc(s.id_escritorio), esc(cli), esc(s.serie || ''), et, esc((D.PRF[s.id_proforma] || {}).numero || ''), esc((D.OT[s.id_ot] || {}).numero_ot || ''),
            esc(f ? f.numero || '' : ''), f ? n(f.saldo).toFixed(2) : '', `<b>${esc(ph)}</b>`,
            '<span style="white-space:nowrap">' + btn('proforma', '🧾 Proforma', P.cotiza()) + btn('factura', '💵 Factura', P.factura()) + '</span>'];
          texto = [s.id_escritorio, cli, s.serie, ph].join(' ');
        }
        if (q && !String(texto).toUpperCase().includes(q)) return;
        filas.push(celdas);
      });
      $('n').textContent = filas.length + ' expediente(s)';
      $('lista').innerHTML = U().tabla(M.cols, filas);
      $('lista').querySelectorAll('[data-acc]').forEach((b) => b.onclick = () => X.accion(b.dataset.id, b.dataset.acc, recargar));
    };
    $('solo').onchange = (e) => { st.solo = e.target.checked; pintar(); };
    $('q').oninput = (e) => { st.q = e.target.value; pintar(); };
    pintar();
  }

  // Órdenes OT (vista base): tarjeta «✅ Revisión para facturar» arriba de la lista
  let abierta = false;
  V.ordenes = async () => {
    await PROSOL_WEB.vistaBase('ordenes')();
    const main = U().$id('main'); if (!main || document.getElementById('revFact')) return;
    main.insertAdjacentHTML('afterbegin', `<div class="card" id="revFact"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn-web ${abierta ? 'prim' : 'sec'}" id="revFactBtn">✅ Revisión para facturar</button>
      <span style="font-size:12px;color:#566573">Expedientes con OT: lista de revisión, aprobar para facturar o pedir corrección (igual que Expedientes).</span></div>
      <div id="revFactCuerpo" style="margin-top:8px"></div></div>`);
    const pintar = () => { U().$id('revFactBtn').className = 'btn-web ' + (abierta ? 'prim' : 'sec'); const c = U().$id('revFactCuerpo'); if (abierta) panel(c, 'revision'); else c.innerHTML = ''; };
    U().$id('revFactBtn').onclick = () => { abierta = !abierta; pintar(); };
    pintar();
  };
  window.PROSOL_EXP = { panel, porHacer };
})();
