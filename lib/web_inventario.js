/* PROSOL web PC · lib/web_inventario.js (v3.98 · W4)
   «📦 Inventario» igual que el escritorio, con 4 pestañas:
   · Repuestos: búsqueda, clase, «Reposición (mín./máx.)», totales; 🆕 Nuevo · ✏️ Editar · 🗑 Archivar · 📥 Entrada ·
     📤 Salida · 📊 Kardex · 🕘 Historial de precios · 📄 Reporte PDF · 📈 Excel.
   · Guías de remisión: 🆕 Nueva (vinculada a una OT, número manual sin repetir, ítems del inventario, ¿descontar stock?),
     👁 Ver / Editar, 📄 Imprimir, 📋 Listado PDF, 📈 Excel, 🗑 Eliminar (si descontó, pregunta si repone el stock).
     Las guías de un expediente se manejan desde el expediente.
   · Reservas: ✔ Confirmar · ↩ Liberar (motivo); queda en la bitácora del expediente.
   · Solicitudes de insumos (bandeja de bodega): 📦 Entregado (con N° de guía) · 📦 Entregar toda la visita ·
     ✖ Anular insumo · ↩ Recibir devolución · 🗓 Despacho del día.
   Reglas: el stock solo cambia por movimientos (la nube ajusta su stock y el escritorio lo aplica al sincronizar);
   la web no borra filas: una guía eliminada queda 'ELIMINADA' y un ítem quitado queda borrado = true (el escritorio
   los elimina de su base). Registran ADMIN y OPERADOR; los demás consultan. Módulo fuera del IIFE base. */
(() => {
  const V = window.PROSOL_WEB_VISTAS = window.PROSOL_WEB_VISTAS || {};
  const U = () => PROSOL_WEB.util;
  const esc = (s) => U().ESC(s);
  const n = (x) => { const v = parseFloat(x); return isFinite(v) ? v : 0; };
  const g = (x) => String(Math.round(n(x) * 10000) / 10000);
  const din = (x) => n(x).toFixed(2);
  const ISO = () => new Date().toISOString();
  const pad = (x) => String(x).padStart(2, '0');
  const AHORA = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
  const HOY = () => AHORA().slice(0, 10);
  function rol() {
    try { const s = API.sesionNube && API.sesionNube(); if (s && s.rol) return String(s.rol).toUpperCase(); } catch (e) {}
    return String((window._prosolSesion || {}).perfil || '').toUpperCase();
  }
  function usuario() {
    try { const s = API.sesionNube && API.sesionNube(); if (s && s.usuario) return s.usuario; } catch (e) {}
    const s = window._prosolSesion || {}; return s.usuario || s.nombre || 'web';
  }
  const registra = () => ['ADMIN', 'OPERADOR'].includes(rol());
  const META = () => ({ actualizado: ISO(), sync_origen: 'WEB' });
  const MOTIVOS_GUIA = ['Traslado para mantenimiento', 'Entrega de repuestos', 'Devolución', 'Garantía', 'Otro'];
  const EST_RES = { RESERVADA: 'Reservada', CONFIRMADA: 'Confirmada', CONSUMIDA: 'Consumida', LIBERADA: 'Liberada' };
  const EST_INS = { POR_APROBAR: '⏸ Por aprobar', SOLICITADO: 'Por despachar', ENTREGADO: 'Entregado (por confirmar)', RECIBIDO: 'Recibido', NO_RECIBIDO: 'No recibido', ANULADO: 'Anulado' };
  const FILTROS = { POR_APROBAR: '⏸ Por aprobar', POR_DESPACHAR: 'Por despachar', SIN_CONFIRMAR: 'Entregados sin confirmar', NO_RECIBIDOS: 'No recibidos',
    ADICIONALES: 'Pedidos adicionales', DEVOLUCIONES: 'Devoluciones pendientes', SIN_STOCK: 'Sin stock', TODOS: 'Todos' };
  const PIE = 'Potenciado por ROCKENSY S.A. &amp; MIG — Tec. Master Luis Martínez Ibáñez';
  let sub = 'rep', turno = 0;
  const F = { rTxt: '', rClase: 'TODAS', rRepo: false, gTxt: '', resTodas: false, iFiltro: 'POR_DESPACHAR', iTxt: '' };

  // ── base común ────────────────────────────────────────────────────
  async function movimiento(idRep, tipo, cant, motivo, ref) {
    const r = (await API.select('repuestos', { id_escritorio: idRep }))[0];
    const stock = n(r && r.stock);
    const saldo = tipo === 'ENTRADA' ? stock + cant : (tipo === 'SALIDA' ? stock - cant : cant);
    return API.insert('inv_movimientos', Object.assign({ id_repuesto: idRep, fecha: HOY(), tipo, cantidad: cant, saldo,
      motivo: motivo || '', referencia: ref || '', fecha_creacion: AHORA() }, META()));
  }
  async function evento(idSrv, detalle) {
    if (!idSrv) return;
    const s = (await API.select('servicios', { id_escritorio: idSrv }).catch(() => []))[0];
    await API.insert('servicio_eventos', Object.assign({ id_servicio: idSrv, fecha: AHORA(), etapa: s ? s.etapa : null,
      detalle, usuario: usuario() }, META())).catch(() => null);
  }
  const reservado = (res) => { const m = {}; res.filter((r) => ['RESERVADA', 'CONFIRMADA'].includes(r.estado)).forEach((r) => { m[r.id_repuesto] = (m[r.id_repuesto] || 0) + n(r.cantidad); }); return m; };
  function completar(reps, res) {
    const rv = reservado(res);
    return reps.map((r) => {
      const serv = (r.clase || 'REPUESTO') === 'SERVICIO', x = Object.assign({}, r);
      x._res = rv[r.id_escritorio] || 0; x._disp = n(r.stock) - x._res; x._sit = ''; x._repo = 0;
      if (!serv) {
        const mn = n(r.stock_min), mx = n(r.stock_max);
        if (x._disp <= mn) { x._sit = 'REPONER'; x._repo = Math.max((mx > 0 ? mx : mn) - x._disp, 0); }
        else if (mx > 0 && n(r.stock) > mx) x._sit = 'SOBRE MÁXIMO';
      }
      return x;
    });
  }
  // impresión (PDF desde el navegador) con la identidad PROSOL
  function imprimir(titulo, cuerpo) {
    const w = window.open('', '_blank');
    if (!w) { U().toast('⚠ Permita las ventanas emergentes para imprimir'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
      body{font-family:Arial,sans-serif;font-size:11px;color:#1C2733;margin:18px}h1{font-size:16px;margin:0}
      table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border:1px solid #AAB7B8;padding:4px 5px;text-align:left}
      th{background:#1C2733;color:#fff}.cab{display:flex;align-items:center;gap:12px;border-bottom:2px solid #1C2733;padding-bottom:6px}
      .pie{margin-top:18px;border-top:1px solid #AAB7B8;padding-top:4px;font-size:9px;color:#566573;text-align:center}
      .datos td{border:none;padding:2px 6px}</style></head><body>
      <div class="cab"><img src="${location.href.replace(/[^/]*$/, '')}icons/icon-192.png" style="height:44px"><div><h1>${esc(titulo)}</h1>
      <div>PROSOL · ${esc(AHORA().slice(0, 16))}</div></div></div>${cuerpo}<div class="pie">${PIE}</div>
      <script>setTimeout(function(){window.print()},400)<\/script></body></html>`);
    w.document.close();
  }
  // Excel (.xlsx) real con JSZip
  async function excel(nombre, hoja, cols, filas) {
    if (typeof JSZip === 'undefined') { U().toast('⚠ No se pudo generar el Excel'); return; }
    const x = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const col = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    const celda = (v, r, c, est) => (typeof v === 'number' && isFinite(v)) ? `<c r="${col(c)}${r}"${est}><v>${v}</v></c>`
      : `<c r="${col(c)}${r}" t="inlineStr"${est}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
    const filasXml = [cols].concat(filas).map((f, i) => `<row r="${i + 1}">${f.map((v, j) => celda(v, i + 1, j, i ? '' : ' s="1"')).join('')}</row>`).join('');
    const z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x(hoja).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    z.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    z.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filasXml}</sheetData></worksheet>`);
    const blob = await z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    window._prosolUltimoExcel = { nombre, hoja, cols, filas };
  }

  V.inventario = async () => {
    const main = U().$id('main');
    if (!API.hayNube()) { main.innerHTML = '<div class="card"><h2>📦 Inventario</h2><p>☁ Sin conexión a la nube. Ve a <b>Configuración</b>.</p></div>'; return; }
    const t = ++turno;
    const b = (k, x) => `<button class="btn-web ${sub === k ? 'prim' : 'sec'}" data-si="${k}">${x}</button>`;
    main.innerHTML = `<div class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b>📦 Inventario</b>
      ${b('rep', 'Repuestos (inventario)')}${b('gui', 'Guías de remisión')}${b('res', 'Reservas')}${b('ins', '📥 Solicitudes de insumos')}${b('bod', '🚚 Bodega de expedientes')}
      ${registra() ? '' : '<span style="font-size:12px;color:#888">Solo consulta (registran ADMIN y OPERADOR)</span>'}</div>
      <div class="card" id="invCuerpo">Cargando…</div>`;
    main.querySelectorAll('[data-si]').forEach((x) => x.onclick = () => { sub = x.dataset.si; V.inventario(); });
    if (sub === 'gui') return guias(t);
    if (sub === 'res') return reservas(t);
    if (sub === 'ins') return insumos(t);
    if (sub === 'bod') return window.PROSOL_EXP ? window.PROSOL_EXP.panel(U().$id('invCuerpo'), 'bodega') : null;   // v4.04 · R-2
    return repuestos(t);
  };
  const vigente = (t) => t === turno && document.getElementById('invCuerpo');
  const recargar = () => V.inventario();

  // ── W4-1 · Repuestos ──────────────────────────────────────────────
  async function repuestos(t) {
    const [reps, res] = await Promise.all([API.select('repuestos').catch(() => []), API.select('inv_reservas').catch(() => [])]);
    if (!vigente(t)) return;
    const todos = completar(reps.filter((r) => (r.estado || 'ACTIVO') === 'ACTIVO'), res);
    const c = U().$id('invCuerpo'), ed = registra();
    c.innerHTML = `<div class="toolbar" style="flex-wrap:wrap">
      <input class="inp-web" id="rpTxt" placeholder="Buscar código o descripción" value="${esc(F.rTxt)}" style="min-width:220px">
      <label style="font-size:13px">Clase: <select class="inp-web" id="rpCl" style="width:auto">${['TODAS', 'REPUESTO', 'SERVICIO'].map((x) => `<option ${x === F.rClase ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label style="font-size:13px"><input type="checkbox" id="rpRepo" ${F.rRepo ? 'checked' : ''}> Reposición (mín./máx.)</label>
      ${ed ? '<button class="btn-web prim" id="rpNuevo">🆕 Nuevo repuesto</button>' : ''}
      <button class="btn-web sec" id="rpPdf">📄 Reporte PDF</button><button class="btn-web sec" id="rpXls">📈 Excel</button></div>
      <div id="rpKpi" style="font-size:13px;font-weight:700;color:#2471A3;margin:4px 0"></div><div id="rpLista"></div>`;
    const lista = () => todos.filter((r) => {
      const q = F.rTxt.trim().toUpperCase();
      if (q && ![r.codigo, r.codigo_prov, r.descripcion].join(' ').toUpperCase().includes(q)) return false;
      if (F.rClase !== 'TODAS' && (r.clase || 'REPUESTO') !== F.rClase) return false;
      if (F.rRepo && !r._sit) return false;
      return true;
    }).sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion)));
    const pintar = () => {
      const L = lista();
      const k = { items: todos.length, u: todos.reduce((s, r) => s + n(r.stock), 0), val: todos.reduce((s, r) => s + n(r.stock) * n(r.costo), 0), bajo: todos.filter((r) => r._sit === 'REPONER').length };
      U().$id('rpKpi').textContent = `Ítems: ${k.items}    Unidades: ${g(k.u)}    Valor: $ ${din(k.val)}    Por reponer: ${k.bajo}`;
      U().$id('rpLista').innerHTML = U().tabla(['Código', 'Cód. prov.', 'Descripción', 'Clase', 'Unidad', 'Stock', 'Reservado', 'Disponible', 'Mín.', 'Máx.', 'Costo', 'Precio', 'Ubicación', 'Situación', ''],
        L.map((r) => [esc(r.codigo || ''), esc(r.codigo_prov || ''), esc(r.descripcion || ''), esc(r.clase || 'REPUESTO'), esc(r.unidad || ''), g(r.stock), g(r._res), g(r._disp),
          g(r.stock_min), g(r.stock_max), din(r.costo), din(r.precio), esc(r.ubicacion || ''),
          r._sit ? `<b style="color:${r._sit === 'REPONER' ? '#A93226' : '#B9770E'}">${r._sit}${r._repo ? ' (' + g(r._repo) + ')' : ''}</b>` : '',
          '<span style="white-space:nowrap">' + (ed ? `<button class="btn-web mini sec" data-a="ed" data-id="${r.id}">✏️</button> ` + ((r.clase || 'REPUESTO') === 'REPUESTO'
            ? `<button class="btn-web mini sec" data-a="ENTRADA" data-id="${r.id}">📥</button> <button class="btn-web mini sec" data-a="SALIDA" data-id="${r.id}">📤</button> ` : '') : '')
          + `<button class="btn-web mini sec" data-a="kx" data-id="${r.id}">📊</button> <button class="btn-web mini sec" data-a="pr" data-id="${r.id}">🕘</button>`
          + (ed ? ` <button class="btn-web mini sec" data-a="ar" data-id="${r.id}">🗑</button>` : '') + '</span>']));
      U().$id('rpLista').querySelectorAll('[data-a]').forEach((x) => x.onclick = () => {
        const r = todos.find((y) => String(y.id) === x.dataset.id), a = x.dataset.a;
        if (a === 'ed') dlgRep(r, reps); else if (a === 'kx') kardex(r); else if (a === 'pr') precios(r);
        else if (a === 'ar') archivar(r); else dlgMov(r, a);
      });
    };
    U().$id('rpTxt').oninput = (e) => { F.rTxt = e.target.value; pintar(); };
    U().$id('rpCl').onchange = (e) => { F.rClase = e.target.value; pintar(); };
    U().$id('rpRepo').onchange = (e) => { F.rRepo = e.target.checked; pintar(); };
    if (ed) U().$id('rpNuevo').onclick = () => dlgRep(null, reps);
    const COLS = ['Código', 'Cód. prov.', 'Descripción', 'Clase', 'Unidad', 'Stock', 'Reservado', 'Disponible', 'Mín.', 'Máx.', 'Costo', 'Precio', 'Ubicación', 'Situación'];
    const fila = (r) => [r.codigo || '', r.codigo_prov || '', r.descripcion || '', r.clase || 'REPUESTO', r.unidad || '', n(r.stock), n(r._res), n(r._disp), n(r.stock_min), n(r.stock_max), n(r.costo), n(r.precio), r.ubicacion || '', r._sit];
    U().$id('rpPdf').onclick = () => imprimir('Reporte de inventario', `<p>${esc(U().$id('rpKpi').textContent)}</p><table><thead><tr>${COLS.map((x) => '<th>' + x + '</th>').join('')}</tr></thead><tbody>${lista().map((r) => '<tr>' + fila(r).map((v) => '<td>' + esc(typeof v === 'number' ? g(v) : v) + '</td>').join('') + '</tr>').join('')}</tbody></table>`);
    U().$id('rpXls').onclick = () => excel('Inventario_' + HOY() + '.xlsx', 'Inventario', COLS, lista().map(fila));
    pintar();
  }
  function dlgRep(r, reps) {
    const nuevo = !r; r = r || {};
    const f = (lab, id, val, tipo) => `<div><label style="font-size:12px;font-weight:700">${lab}</label><input class="inp-web" id="${id}" ${tipo ? 'type="' + tipo + '" step="any"' : ''} value="${esc(val == null ? '' : val)}"></div>`;
    U().modal(`<h3>${nuevo ? '🆕 Nuevo repuesto' : '✏️ Editar repuesto ' + esc(r.id_escritorio || '')}</h3>
      <div><label style="font-size:12px;font-weight:700">Clase de ítem</label><select class="inp-web" id="drCl">${['REPUESTO', 'SERVICIO'].map((x) => `<option ${x === (r.clase || 'REPUESTO') ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <span style="font-size:11px;color:#566573">SERVICIO = mano de obra / actividad, sin stock</span></div>
      <div class="grid2">${f('Código de sistema', 'drCod', r.codigo)}${f('Código proveedor/fab.', 'drCp', r.codigo_prov)}</div>
      ${f('Descripción', 'drDes', r.descripcion)}
      <div class="grid2">${f('Unidad', 'drUni', r.unidad || 'UNIDAD')}${f('Ubicación', 'drUbi', r.ubicacion)}
      ${f('Costo', 'drCos', r.costo || 0, 'number')}${f('Precio', 'drPre', r.precio || 0, 'number')}
      ${f('Stock mínimo', 'drMin', r.stock_min || 0, 'number')}${f('Stock máximo', 'drMax', r.stock_max || 0, 'number')}
      ${nuevo ? f('Stock inicial', 'drSt', 0, 'number') : ''}</div>
      <div id="drErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="drX">Cancelar</button><button class="btn-web prim" id="drOk">💾 Guardar</button></div>`);
    U().$id('drX').onclick = U().cerrarModal;
    U().$id('drOk').onclick = async () => {
      const v = (id) => U().$id(id).value.trim(), err = (m) => { U().$id('drErr').textContent = m; };
      const cod = v('drCod'), clase = v('drCl');
      if (!v('drDes')) return err('La descripción es obligatoria.');
      if (cod && reps.some((x) => String(x.codigo || '') === cod && x.id !== r.id)) return err('Ya existe un repuesto con ese código.');
      const d = { codigo: cod, codigo_prov: v('drCp'), descripcion: v('drDes'), unidad: v('drUni') || 'UNIDAD', costo: n(v('drCos')), precio: n(v('drPre')),
        stock_min: n(v('drMin')), stock_max: n(v('drMax')), ubicacion: v('drUbi'), clase };
      if (d.stock_max && d.stock_max < d.stock_min) return err('El stock máximo no puede ser menor que el mínimo.');
      U().$id('drOk').disabled = true;
      try {
        if (nuevo) {
          const ini = clase === 'SERVICIO' ? 0 : n(v('drSt'));
          const nw = await API.insert('repuestos', Object.assign(d, { stock: 0, estado: 'ACTIVO', fecha_creacion: AHORA() }, META()));
          if (ini > 0 && nw && nw.id_escritorio) await movimiento(nw.id_escritorio, 'ENTRADA', ini, 'Stock inicial', '');
          U().toast('✅ Repuesto creado' + (nw && nw.id_escritorio ? ' · ' + nw.id_escritorio : ''));
        } else {
          await API.update('repuestos', r.id, Object.assign(d, META()));
          if (Math.abs(n(r.costo) - d.costo) > 1e-9 || Math.abs(n(r.precio) - d.precio) > 1e-9)
            await API.insert('repuesto_precios', Object.assign({ id_repuesto: r.id_escritorio, fecha: AHORA(), costo_ant: n(r.costo), costo_nuevo: d.costo,
              precio_ant: n(r.precio), precio_nuevo: d.precio, usuario: usuario() }, META()));
          U().toast('✅ Repuesto guardado');
        }
        U().cerrarModal(); recargar();
      } catch (e) { U().$id('drOk').disabled = false; err('❌ ' + e.message); }
    };
  }
  function dlgMov(r, tipo) {
    U().modal(`<h3>${tipo === 'ENTRADA' ? '📥 Entrada' : '📤 Salida'} — ${esc(r.descripcion || '')}</h3><p style="margin:0 0 6px">Stock actual: <b>${g(r.stock)}</b></p>
      <div class="grid2"><div><label style="font-size:12px;font-weight:700">Cantidad</label><input class="inp-web" id="dmC" type="number" step="any"></div>
      <div><label style="font-size:12px;font-weight:700">Motivo</label><input class="inp-web" id="dmM" value="${tipo === 'ENTRADA' ? 'Compra' : 'Consumo'}"></div></div>
      <label style="font-size:12px;font-weight:700">Referencia</label><input class="inp-web" id="dmR">
      <div id="dmErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="dmX">Cancelar</button><button class="btn-web prim" id="dmOk">✔ Registrar</button></div>`);
    U().$id('dmX').onclick = U().cerrarModal;
    U().$id('dmOk').onclick = async () => {
      const c = parseFloat(U().$id('dmC').value);
      if (!isFinite(c)) { U().$id('dmErr').textContent = 'Cantidad inválida.'; return; }
      if (c <= 0) { U().$id('dmErr').textContent = 'La cantidad debe ser mayor a 0.'; return; }
      U().$id('dmOk').disabled = true;
      try { await movimiento(r.id_escritorio, tipo, c, U().$id('dmM').value.trim(), U().$id('dmR').value.trim());
            U().toast('✅ ' + (tipo === 'ENTRADA' ? 'Entrada' : 'Salida') + ' registrada'); U().cerrarModal(); recargar(); }
      catch (e) { U().$id('dmOk').disabled = false; U().$id('dmErr').textContent = '❌ ' + e.message; }
    };
  }
  async function kardex(r) {
    const M = (await API.select('inv_movimientos', { id_repuesto: r.id_escritorio }).catch(() => []))
      .sort((a, b) => String(a.fecha_creacion || a.fecha).localeCompare(String(b.fecha_creacion || b.fecha)));
    U().modal(`<h3>📊 Kardex — ${esc(r.codigo || '')} ${esc(r.descripcion || '')}</h3><p style="margin:0 0 6px">Stock: <b>${g(r.stock)}</b> · Reservado ${g(r._res)} · Disponible ${g(r._disp)}</p>
      <div style="max-height:60vh;overflow:auto">${U().tabla(['Fecha', 'Tipo', 'Cantidad', 'Saldo', 'Motivo', 'Referencia'], M.map((m) => [esc(m.fecha || ''), esc(m.tipo || ''), g(m.cantidad), g(m.saldo), esc(m.motivo || ''), esc(m.referencia || '')]))}</div>
      <div style="text-align:right;margin-top:8px"><button class="btn-web sec" id="kxX">Cerrar</button></div>`);
    U().$id('kxX').onclick = U().cerrarModal;
  }
  async function precios(r) {
    const H = (await API.select('repuesto_precios', { id_repuesto: r.id_escritorio }).catch(() => [])).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    U().modal(`<h3>🕘 Historial de precios — ${esc(r.descripcion || '')} (${esc(r.codigo || '')})</h3>
      ${H.length ? U().tabla(['Fecha', 'Costo ant.', 'Costo nuevo', 'Precio ant.', 'Precio nuevo', 'Usuario'], H.map((h) => [esc(String(h.fecha || '').slice(0, 16)), din(h.costo_ant), din(h.costo_nuevo), din(h.precio_ant), din(h.precio_nuevo), esc(h.usuario || '')]))
        : '<p>Sin cambios de costo o precio registrados.</p>'}
      <div style="text-align:right;margin-top:8px"><button class="btn-web sec" id="prX">Cerrar</button></div>`);
    U().$id('prX').onclick = U().cerrarModal;
  }
  async function archivar(r) {
    if (!confirm('¿Archivar este repuesto?\n' + (r.descripcion || ''))) return;
    try { await API.update('repuestos', r.id, Object.assign({ estado: 'ARCHIVADO' }, META())); U().toast('🗑 Repuesto archivado'); recargar(); }
    catch (e) { U().toast('❌ ' + e.message); }
  }

  // ── W4-2 · Guías de remisión ──────────────────────────────────────
  async function guias(t) {
    const [gs, cls, srv] = await Promise.all([API.select('guias').catch(() => []), API.select('clientes').catch(() => []), API.select('servicios').catch(() => [])]);
    if (!vigente(t)) return;
    const cli = {}; cls.forEach((c) => { cli[c.id_escritorio] = c; });
    const vivas = gs.filter((x) => String(x.estado || '').toUpperCase() !== 'ELIMINADA');
    const c = U().$id('invCuerpo'), ed = registra();
    c.innerHTML = `<div class="toolbar" style="flex-wrap:wrap"><input class="inp-web" id="gTxt" placeholder="N° guía, OT o cliente" value="${esc(F.gTxt)}" style="min-width:220px">
      ${ed ? '<button class="btn-web prim" id="gNueva">🆕 Nueva guía</button>' : ''}
      <button class="btn-web sec" id="gPdf">📋 Listado PDF</button><button class="btn-web sec" id="gXls">📈 Excel</button></div><div id="gLista"></div>`;
    const lista = () => vivas.filter((x) => { const q = F.gTxt.trim().toUpperCase(); return !q || [x.numero, x.numero_ot, (cli[x.id_cliente] || {}).razon_social].join(' ').toUpperCase().includes(q); })
      .sort((a, b) => String(b.fecha_emision || '').localeCompare(String(a.fecha_emision || '')) || String(b.id_escritorio).localeCompare(String(a.id_escritorio)));
    const pintar = () => {
      U().$id('gLista').innerHTML = U().tabla(['N° Guía', 'OT', 'Cliente', 'Serie', 'Emisión', 'Motivo', 'Stock', 'Estado', ''], lista().map((x) => [esc(x.numero || ''), esc(x.numero_ot || ''),
        esc((cli[x.id_cliente] || {}).razon_social || ''), esc(x.serie || ''), esc(x.fecha_emision || ''), esc(x.motivo || ''), x.descontado === 'SI' ? 'Descontado' : 'No descontado', esc(x.estado || ''),
        `<span style="white-space:nowrap"><button class="btn-web mini sec" data-g="ver" data-id="${x.id}">👁 Ver${ed ? ' / Editar' : ''}</button> <button class="btn-web mini sec" data-g="pdf" data-id="${x.id}">📄</button>`
        + (ed ? ` <button class="btn-web mini sec" data-g="del" data-id="${x.id}">🗑</button>` : '') + '</span>']));
      U().$id('gLista').querySelectorAll('[data-g]').forEach((b) => b.onclick = () => {
        const x = vivas.find((y) => String(y.id) === b.dataset.id);
        if (b.dataset.g === 'pdf') return pdfGuia(x, cli);
        const exp = srv.find((s) => s.id_guia === x.id_escritorio && s.estado !== 'ANULADO');
        if (exp && b.dataset.g === 'del') { U().toast('ℹ La guía pertenece al expediente ' + exp.id_escritorio + ': se elimina desde el expediente.'); return; }
        if (b.dataset.g === 'del') return eliminarGuia(x);
        dlgGuia(x, vivas, cli, exp && ed ? exp : null);
      });
    };
    U().$id('gTxt').oninput = (e) => { F.gTxt = e.target.value; pintar(); };
    if (ed) U().$id('gNueva').onclick = () => dlgGuia(null, vivas, cli, null);
    const COLS = ['N° Guía', 'OT', 'Cliente', 'Serie', 'Emisión', 'Motivo', 'Stock', 'Estado'];
    const fila = (x) => [x.numero || '', x.numero_ot || '', (cli[x.id_cliente] || {}).razon_social || '', x.serie || '', x.fecha_emision || '', x.motivo || '', x.descontado === 'SI' ? 'Descontado' : 'No descontado', x.estado || ''];
    U().$id('gPdf').onclick = () => imprimir('Listado de guías de remisión', `<table><thead><tr>${COLS.map((x) => '<th>' + x + '</th>').join('')}</tr></thead><tbody>${lista().map((x) => '<tr>' + fila(x).map((v) => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('')}</tbody></table>`);
    U().$id('gXls').onclick = () => excel('Guias_' + HOY() + '.xlsx', 'Guías', COLS, lista().map(fila));
    pintar();
  }
  const itemsVivos = async (code) => (await API.select('guia_items', { id_guia: code }).catch(() => [])).filter((i) => !i.borrado);
  async function dlgGuia(gu, vivas, cli, expediente) {
    const ed = registra() && !expediente, nueva = !gu; gu = gu || {};
    const reps = (await API.select('repuestos').catch(() => [])).filter((r) => (r.estado || 'ACTIVO') === 'ACTIVO' && (r.clase || 'REPUESTO') === 'REPUESTO')
      .sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion)));
    let items = nueva ? [] : (await itemsVivos(gu.id_escritorio)).map((i) => ({ id_repuesto: i.id_repuesto, codigo: i.codigo, descripcion: i.descripcion, unidad: i.unidad, cantidad: n(i.cantidad) }));
    const ctx = { id_ot: gu.id_ot || null, id_cliente: gu.id_cliente || null, serie: gu.serie || null };
    const dis = ed ? '' : 'disabled';
    const f = (lab, id, val, ancho) => `<div style="flex:1;min-width:${ancho || 140}px"><label style="font-size:12px;font-weight:700">${lab}</label><input class="inp-web" id="${id}" value="${esc(val || '')}" ${dis}></div>`;
    U().modal(`<h3>🚚 Guía de remisión ${esc(gu.numero || gu.id_escritorio || '')}</h3>
      ${expediente ? `<p style="background:#FEF5E7;padding:6px;border-radius:6px;font-size:13px">Esta guía pertenece al expediente <b>${esc(expediente.id_escritorio)}</b>: se modifica desde el expediente. Aquí solo se consulta.</p>` : ''}
      <div style="display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap"><div><label style="font-size:12px;font-weight:700">N° de OT</label><input class="inp-web" id="dgOt" value="${esc(gu.numero_ot || '')}" style="width:110px" ${dis}></div>
        ${ed ? '<button class="btn-web sec" id="dgBus">Buscar</button>' : ''}<span id="dgOtInfo" style="font-size:12px;color:#117A65"></span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${f('N° de guía', 'dgNum', gu.numero)}${f('Fecha emisión', 'dgFe', gu.fecha_emision || HOY(), 110)}${f('Fecha traslado', 'dgFt', gu.fecha_traslado, 110)}</div>
      <div style="margin-top:4px"><label style="font-size:12px;font-weight:700">Motivo</label><input class="inp-web" id="dgMot" list="dgMotL" value="${esc(gu.motivo || MOTIVOS_GUIA[0])}" ${dis}><datalist id="dgMotL">${MOTIVOS_GUIA.map((m) => `<option>${esc(m)}</option>`).join('')}</datalist></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${f('Punto de partida', 'dgPar', gu.partida || 'Bodega PROSOL')}${f('Destino', 'dgDes', gu.destino, 200)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${f('Transportista', 'dgTr', gu.transportista)}${f('Placa', 'dgPl', gu.placa, 90)}${f('Observación', 'dgObs', gu.observacion, 180)}</div>
      <h4 style="margin:10px 0 4px">Repuestos (del catálogo de inventario)</h4>
      ${ed ? `<div style="display:flex;gap:6px;flex-wrap:wrap"><select class="inp-web" id="dgRep" style="flex:1;min-width:220px"><option value="">— elegir repuesto —</option>${reps.map((r) => `<option value="${esc(r.id_escritorio)}">${esc((r.codigo || '?') + ' — ' + r.descripcion + ' (stock ' + g(r.stock) + ')')}</option>`).join('')}</select>
        <input class="inp-web" id="dgCant" type="number" step="any" value="1" style="width:80px"><button class="btn-web sec" id="dgAdd">➕ Agregar</button></div>` : ''}
      <div id="dgItems"></div>
      <div id="dgPreg"></div>
      <div id="dgErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="dgX">${ed ? 'Cancelar' : 'Cerrar'}</button>${ed ? '<button class="btn-web prim" id="dgOk">💾 Guardar guía</button>' : ''}</div>`);
    U().$id('dgX').onclick = U().cerrarModal;
    const pintarItems = () => {
      U().$id('dgItems').innerHTML = U().tabla(['Código', 'Descripción', 'Unidad', 'Cantidad', ''], items.map((i, k) => [esc(i.codigo || ''), esc(i.descripcion || ''), esc(i.unidad || ''), g(i.cantidad),
        ed ? `<button class="btn-web mini sec" data-q="${k}">🗑 Quitar</button>` : '']));
      U().$id('dgItems').querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { items.splice(+b.dataset.q, 1); pintarItems(); });
    };
    pintarItems();
    const info = U().$id('dgOtInfo');
    const buscarOt = async (rellenar) => {
      const num = U().$id('dgOt').value.trim();
      const o = num ? (await API.select('ordenes', { numero_ot: num }).catch(() => []))[0] : null;
      if (!o) { info.textContent = 'OT no encontrada'; info.style.color = '#C0392B'; ctx.id_ot = ctx.id_cliente = null; return; }
      const cl = o.id_cliente ? (await API.select('clientes', { id: o.id_cliente }).catch(() => []))[0] : null;
      ctx.id_ot = o.id_escritorio; ctx.id_cliente = cl ? cl.id_escritorio : null; ctx.serie = o.serie;
      info.textContent = '✓ ' + (cl ? cl.razon_social : '—') + ' · serie ' + (o.serie || ''); info.style.color = '#117A65';
      if (rellenar && !U().$id('dgDes').value && cl) U().$id('dgDes').value = [cl.ciudad, cl.zona, cl.direccion].filter(Boolean).join(' ');
    };
    if (!nueva && gu.id_cliente) info.textContent = '✓ ' + ((cli[gu.id_cliente] || {}).razon_social || '—') + ' · serie ' + (gu.serie || '');
    if (!ed) return;
    U().$id('dgBus').onclick = () => buscarOt(true);
    U().$id('dgAdd').onclick = () => {
      const id = U().$id('dgRep').value, c = parseFloat(U().$id('dgCant').value);
      if (!id) { U().$id('dgErr').textContent = 'Elija un repuesto.'; return; }
      if (!(c > 0)) { U().$id('dgErr').textContent = 'Cantidad inválida.'; return; }
      const r = reps.find((x) => x.id_escritorio === id);
      items.push({ id_repuesto: id, codigo: r.codigo, descripcion: r.descripcion, unidad: r.unidad, cantidad: c });
      U().$id('dgErr').textContent = ''; pintarItems();
    };
    const guardar = async (descontar) => {
      const v = (id) => U().$id(id).value.trim(), err = (m) => { U().$id('dgErr').textContent = m; U().$id('dgOk').disabled = false; };
      const num = v('dgNum');
      const cab = { numero: num, id_ot: ctx.id_ot, numero_ot: v('dgOt'), id_cliente: ctx.id_cliente, serie: ctx.serie, fecha_emision: v('dgFe'), fecha_traslado: v('dgFt'),
        motivo: v('dgMot'), partida: v('dgPar'), destino: v('dgDes'), transportista: v('dgTr'), placa: v('dgPl'), observacion: v('dgObs') };
      U().$id('dgOk').disabled = true;
      try {
        let code = gu.id_escritorio, id = gu.id;
        if (nueva) {
          const nw = await API.insert('guias', Object.assign(cab, { estado: 'EMITIDA', descontado: 'NO', fecha_creacion: AHORA() }, META()));
          code = nw.id_escritorio; id = nw.id;
        } else {
          await API.update('guias', id, Object.assign(cab, META()));
          for (const i of await itemsVivos(code)) await API.update('guia_items', i.id, Object.assign({ borrado: true }, META()));   // igual que el escritorio: se reemplazan los ítems
        }
        for (const i of items) await API.insert('guia_items', Object.assign({ id_guia: code, id_repuesto: i.id_repuesto, codigo: i.codigo, descripcion: i.descripcion,
          unidad: i.unidad, cantidad: i.cantidad, fecha_creacion: AHORA(), borrado: false }, META()));
        if (descontar && gu.descontado !== 'SI') {
          for (const i of items) if (i.id_repuesto) await movimiento(i.id_repuesto, 'SALIDA', i.cantidad, 'Guía de remisión', num || code);
          await API.update('guias', id, Object.assign({ descontado: 'SI' }, META()));
        }
        U().toast('✅ Guía guardada' + (descontar && gu.descontado !== 'SI' ? ' y stock descontado' : '')); U().cerrarModal(); recargar();
      } catch (e) { err('❌ ' + e.message); }
    };
    U().$id('dgOk').onclick = async () => {
      const err = (m) => { U().$id('dgErr').textContent = m; };
      if (!ctx.id_cliente) { await buscarOt(false); if (!ctx.id_cliente) return err('Vincula una OT válida primero.'); }
      const num = U().$id('dgNum').value.trim();
      if (num && vivas.some((x) => String(x.numero || '') === num && x.id !== gu.id)) return err('Ya existe una guía con ese número.');
      if (!items.length) return err('Agrega al menos un repuesto.');
      err('');
      if (gu.descontado === 'SI') return guardar(false);           // ya estaba descontada: no volver a descontar
      U().$id('dgPreg').innerHTML = `<div style="background:#EBF5FB;border-radius:8px;padding:8px;margin-top:8px"><b>¿Descontar del inventario los repuestos de esta guía?</b>
        <div style="font-size:12px;margin:4px 0">Sí = registra la guía y descuenta el stock · No = solo registra la guía (sin tocar el stock).</div>
        <button class="btn-web prim" id="dgSi">Sí</button> <button class="btn-web sec" id="dgNo">No</button> <button class="btn-web sec" id="dgCan">Cancelar</button></div>`;
      U().$id('dgSi').onclick = () => guardar(true);
      U().$id('dgNo').onclick = () => guardar(false);
      U().$id('dgCan').onclick = () => { U().$id('dgPreg').innerHTML = ''; };
    };
  }
  async function eliminarGuia(x) {
    let reponer = false;
    if (x.descontado === 'SI') reponer = confirm('Esta guía descontó inventario.\n¿Reponer el stock al eliminarla?');
    if (!confirm('¿Eliminar esta guía de remisión?\n' + (x.numero || x.id_escritorio))) return;
    try {
      const its = await itemsVivos(x.id_escritorio);
      if (reponer) for (const i of its) if (i.id_repuesto) await movimiento(i.id_repuesto, 'ENTRADA', n(i.cantidad), 'Anulación de guía', x.numero || x.id_escritorio);
      for (const i of its) await API.update('guia_items', i.id, Object.assign({ borrado: true }, META()));
      await API.update('guias', x.id, Object.assign({ estado: 'ELIMINADA' }, META()));
      U().toast('🗑 Guía eliminada' + (reponer ? ' · stock repuesto' : '')); recargar();
    } catch (e) { U().toast('❌ ' + e.message); }
  }
  async function pdfGuia(x, cli) {
    const its = await itemsVivos(x.id_escritorio), c = cli[x.id_cliente] || {};
    const d = [['N° de guía', x.numero], ['OT', x.numero_ot], ['Cliente', c.razon_social], ['RUC/Cédula', c.identificacion], ['Serie', x.serie], ['Fecha emisión', x.fecha_emision],
      ['Fecha traslado', x.fecha_traslado], ['Motivo', x.motivo], ['Punto de partida', x.partida], ['Destino', x.destino], ['Transportista', x.transportista], ['Placa', x.placa], ['Observación', x.observacion]];
    imprimir('Guía de remisión N° ' + (x.numero || x.id_escritorio), `<table class="datos">${d.map((p) => `<tr><td><b>${esc(p[0])}:</b></td><td>${esc(p[1] || '')}</td></tr>`).join('')}</table>
      <table><thead><tr><th>Código</th><th>Descripción</th><th>Unidad</th><th>Cantidad</th></tr></thead><tbody>${its.map((i) => `<tr><td>${esc(i.codigo || '')}</td><td>${esc(i.descripcion || '')}</td><td>${esc(i.unidad || '')}</td><td>${g(i.cantidad)}</td></tr>`).join('')}</tbody></table>
      <table class="datos" style="margin-top:40px"><tr><td style="width:50%;text-align:center">____________________<br>Entregado por</td><td style="text-align:center">____________________<br>Recibido por</td></tr></table>`);
  }

  // ── W4-3 · Reservas ───────────────────────────────────────────────
  async function reservas(t) {
    const [res, reps, srv, cls] = await Promise.all(['inv_reservas', 'repuestos', 'servicios', 'clientes'].map((x) => API.select(x).catch(() => [])));
    if (!vigente(t)) return;
    const R = {}, S = {}, C = {}; reps.forEach((r) => { R[r.id_escritorio] = r; }); srv.forEach((s) => { S[s.id_escritorio] = s; }); cls.forEach((c) => { C[c.id_escritorio] = c; });
    const c = U().$id('invCuerpo'), ed = registra();
    c.innerHTML = `<div class="toolbar"><label style="font-size:13px"><input type="checkbox" id="rsT" ${F.resTodas ? 'checked' : ''}> Ver también liberadas y consumidas</label></div><div id="rsLista"></div>`;
    const pintar = () => {
      const L = res.filter((r) => F.resTodas || ['RESERVADA', 'CONFIRMADA'].includes(r.estado)).sort((a, b) => String(a.id_escritorio).localeCompare(String(b.id_escritorio)));
      U().$id('rsLista').innerHTML = U().tabla(['Reserva', 'Expediente', 'Cliente', 'Serie', 'Código', 'Repuesto', 'Cant.', 'Estado', 'Fecha', 'Usuario', 'Nota / motivo', ''], L.map((r) => {
        const s = S[r.id_servicio] || {}, p = R[r.id_repuesto] || {}, act = ['RESERVADA', 'CONFIRMADA'].includes(r.estado);
        return [esc(r.id_escritorio || ''), esc(r.id_servicio || ''), esc((C[s.id_cliente] || {}).razon_social || ''), esc(s.serie || ''), esc(p.codigo || ''), esc(p.descripcion || r.id_repuesto || ''),
          g(r.cantidad), EST_RES[r.estado] || esc(r.estado || ''), esc(String(r.fecha || '').slice(0, 16)), esc(r.usuario || ''), esc(r.motivo_cierre || r.nota || ''),
          (ed && act ? '<span style="white-space:nowrap">' + (r.estado === 'RESERVADA' ? `<button class="btn-web mini prim" data-r="conf" data-id="${r.id}">✔ Confirmar</button> ` : '') + `<button class="btn-web mini sec" data-r="lib" data-id="${r.id}">↩ Liberar</button></span>` : '')];
      }));
      U().$id('rsLista').querySelectorAll('[data-r]').forEach((b) => b.onclick = () => cerrarReserva(res.find((r) => String(r.id) === b.dataset.id), b.dataset.r === 'conf' ? 'CONFIRMADA' : 'LIBERADA', R));
    };
    U().$id('rsT').onchange = (e) => { F.resTodas = e.target.checked; pintar(); };
    pintar();
  }
  async function cerrarReserva(r, estado, R, motivo, silencio) {
    if (!['RESERVADA', 'CONFIRMADA'].includes(r.estado)) { U().toast('La reserva ya está ' + (EST_RES[r.estado] || r.estado).toLowerCase() + '.'); return false; }
    if (estado === 'LIBERADA' && motivo == null) {
      motivo = prompt('Motivo para liberar ' + r.id_escritorio + ':');
      if (motivo == null) return false;
      if (!motivo.trim()) { U().toast('Indique el motivo para liberar la reserva.'); return false; }
    }
    const c = estado === 'CONFIRMADA' ? { estado } : { estado, fecha_cierre: AHORA(), motivo_cierre: motivo.trim(), usuario_cierre: usuario() };
    try {
      await API.update('inv_reservas', r.id, Object.assign(c, META()));
      const p = (R || {})[r.id_repuesto] || {};
      await evento(r.id_servicio, 'Reserva ' + r.id_escritorio + ' ' + EST_RES[estado].toLowerCase() + ': ' + g(r.cantidad) + ' × ' + (p.codigo || r.id_repuesto) + (estado === 'LIBERADA' ? ' · ' + motivo.trim() : ''));
      if (!silencio) { U().toast('✅ Reserva ' + EST_RES[estado].toLowerCase()); recargar(); }
      return true;
    } catch (e) { U().toast('❌ ' + e.message); return false; }
  }

  // ── W4-4 · Solicitudes de insumos (bandeja de bodega) ─────────────
  const devPend = (r) => (r.estado_ins !== 'RECIBIDO' || r.cant_usada == null || r.cant_usada === '') ? 0 : Math.max(0, Math.round((n(r.cantidad) - n(r.cant_usada) - n(r.devuelto)) * 10000) / 10000);
  async function datosInsumos() {
    const [vr, vis, cls, reps, srv, ots] = await Promise.all(['visita_repuestos', 'visitas_programadas', 'clientes', 'repuestos', 'servicios', 'ordenes'].map((x) => API.select(x).catch(() => [])));
    const Vi = {}, Ci = {}, Cc = {}, Ri = {}, Si = {}, Oi = {};
    vis.forEach((v) => { Vi[v.id_escritorio] = v; }); cls.forEach((c) => { Ci[c.id] = c; Cc[c.id_escritorio] = c; }); reps.forEach((r) => { Ri[r.id_escritorio] = r; });
    srv.forEach((s) => { Si[s.id_escritorio] = s; }); ots.forEach((o) => { Oi[o.id_escritorio] = o; });
    return vr.filter((i) => i.estado_ins && Vi[i.id_visita]).map((i) => {
      const v = Vi[i.id_visita], s = Si[i.id_servicio] || {};
      return Object.assign({}, i, { _fecha: v.fecha_programada || '', _tec: v.tecnico_asignado || '', _serie: v.serie || '', _cli: (Ci[v.id_cliente] || {}).razon_social || '',
        _stock: n((Ri[i.id_repuesto] || {}).stock), _ot: (Oi[s.id_ot] || {}).numero_ot || '', _dev: devPend(i) });
    }).sort((a, b) => String(a._fecha).localeCompare(String(b._fecha)) || String(a.id_visita).localeCompare(String(b.id_visita)) || String(a.id_escritorio).localeCompare(String(b.id_escritorio)));
  }
  async function insumos(t) {
    const todas = await datosInsumos();
    if (!vigente(t)) return;
    // v4.07: aprobación de insumos (ADMIN o supervisor); si hay pendientes se abre en «⏸ Por aprobar»
    let puedeAp = false; try { puedeAp = !!(await API.rpc('puede_aprobar', {})); } catch (e) { puedeAp = false; }
    if (!insumos._yaFiltro && todas.some((f) => f.estado_ins === 'POR_APROBAR')) { F.iFiltro = 'POR_APROBAR'; }
    insumos._yaFiltro = true;
    const c = U().$id('invCuerpo'), ed = registra();
    c.innerHTML = `<div class="toolbar" style="flex-wrap:wrap"><select class="inp-web" id="inF" style="width:auto">${Object.keys(FILTROS).map((k) => `<option value="${k}" ${k === F.iFiltro ? 'selected' : ''}>${FILTROS[k]}</option>`).join('')}</select>
      <input class="inp-web" id="inTxt" placeholder="Visita, cliente, serie, insumo, técnico, guía, OT" value="${esc(F.iTxt)}" style="min-width:220px">
      <button class="btn-web sec" id="inAct">⟳ Actualizar</button><button class="btn-web sec" id="inDesp">🗓 Despacho del día</button></div>
      <div id="inRes" style="font-size:13px;font-weight:700;margin:4px 0"></div><div id="inLista"></div>`;
    const ok = (f) => {
      const e = f.estado_ins;
      return { POR_APROBAR: e === 'POR_APROBAR', POR_DESPACHAR: e === 'SOLICITADO', SIN_CONFIRMAR: e === 'ENTREGADO', NO_RECIBIDOS: e === 'NO_RECIBIDO',
        ADICIONALES: f.origen === 'ADICIONAL' && ['POR_APROBAR', 'SOLICITADO', 'ENTREGADO', 'NO_RECIBIDO'].includes(e), DEVOLUCIONES: f._dev > 0,
        SIN_STOCK: n(f.falta_stock) > 0 && e === 'SOLICITADO', TODOS: true }[F.iFiltro];
    };
    const lista = () => { const q = F.iTxt.trim().toUpperCase(); return todas.filter((f) => ok(f) && (!q || [f.id_visita, f.id_servicio, f._cli, f._serie, f.descripcion, f.codigo, f._tec, f.numero_guia, f._ot].join(' ').toUpperCase().includes(q))); };
    const pintar = () => {
      const L = lista();
      U().$id('inRes').textContent = L.length + ' insumo(s) · ' + FILTROS[F.iFiltro];
      U().$id('inLista').innerHTML = U().tabla(['Fecha', 'Visita', 'Cliente', 'Serie', 'Técnico', 'Insumo', 'Cant.', 'Stock', 'Origen', 'Estado', 'Guía', 'Usado', 'Devolver', 'OT', 'Motivo / nota', ''], L.map((f) => {
        const e = f.estado_ins, desp = ['SOLICITADO', 'NO_RECIBIDO'].includes(e);
        return [esc(f._fecha), esc(f.id_visita || ''), esc(f._cli), esc(f._serie), esc(f._tec), esc(((f.codigo ? f.codigo + ' — ' : '') + (f.descripcion || ''))), g(f.cantidad),
          n(f.falta_stock) > 0 ? `<b style="color:#A93226">${g(f._stock)} (falta ${g(f.falta_stock)})</b>` : g(f._stock), esc(f.origen || ''), EST_INS[e] || esc(e), esc(f.numero_guia || ''),
          f.cant_usada == null || f.cant_usada === '' ? '' : g(f.cant_usada), f._dev ? g(f._dev) : '', esc(f._ot), esc(f.motivo || f.nota || ''),
          ed ? '<span style="white-space:nowrap">' + (e === 'POR_APROBAR' && puedeAp ? `<button class="btn-web mini prim" data-i="apr" data-id="${f.id}">✅ Aprobar</button> <button class="btn-web mini sec" data-i="rec" data-id="${f.id}">⛔ Rechazar</button> ` : '')
            + (desp ? `<button class="btn-web mini prim" data-i="ent" data-id="${f.id}">📦 Entregado</button> <button class="btn-web mini sec" data-i="vis" data-id="${f.id}">📦 Toda la visita</button> ` : '')
            + (e !== 'RECIBIDO' && e !== 'ANULADO' ? `<button class="btn-web mini sec" data-i="anu" data-id="${f.id}">✖ Anular</button> ` : '')
            + (f._dev > 0 ? `<button class="btn-web mini sec" data-i="dev" data-id="${f.id}">↩ Devolución</button>` : '') + '</span>' : ''];
      }));
      U().$id('inLista').querySelectorAll('[data-i]').forEach((b) => b.onclick = () => {
        const f = todas.find((x) => String(x.id) === b.dataset.id), a = b.dataset.i;
        if (a === 'apr') aprobarIns([f]);
        else if (a === 'rec') rechazarIns(f);
        else if (a === 'ent') entregar([f]);
        else if (a === 'vis') entregar(todas.filter((x) => x.id_visita === f.id_visita && ['SOLICITADO', 'NO_RECIBIDO'].includes(x.estado_ins)));
        else if (a === 'anu') anularIns(f); else devolucion(f);
      });
    };
    U().$id('inF').onchange = (e) => { F.iFiltro = e.target.value; pintar(); };
    U().$id('inTxt').oninput = (e) => { F.iTxt = e.target.value; pintar(); };
    U().$id('inAct').onclick = recargar;
    U().$id('inDesp').onclick = () => despacho(todas);
    pintar();
  }
  async function aprobarIns(L) {                       // v4.07 · «Por aprobar» → «Por despachar»
    try {
      for (const f of L) await API.update('visita_repuestos', f.id, Object.assign({ estado_ins: 'SOLICITADO', aprobado_por: usuario(), aprobado_en: AHORA().slice(0, 16) }, META()));
      for (const f of L) await evento(f.id_servicio, 'Insumo aprobado por ' + usuario() + ': ' + g(f.cantidad) + ' × ' + (f.descripcion || '') + ' (visita ' + f.id_visita + ') → por despachar');
      U().toast('✅ ' + L.length + ' insumo(s) aprobados'); recargar(); avisoIns().catch(() => {});
    } catch (e) { U().toast('❌ ' + e.message); }
  }
  async function rechazarIns(f) {
    const m = prompt('Motivo del rechazo de ' + (f.descripcion || 'el insumo') + ':');
    if (!m || m.trim().length < 3) { if (m !== null) U().toast('Escriba el motivo (mínimo 3 letras).'); return; }
    try {
      if (f.id_reserva) { const rs = (await API.select('inv_reservas', { id_escritorio: f.id_reserva }).catch(() => []))[0]; if (rs && ['RESERVADA', 'CONFIRMADA'].includes(rs.estado)) await API.update('inv_reservas', rs.id, Object.assign({ estado: 'LIBERADA', fecha_cierre: AHORA(), motivo_cierre: 'insumo rechazado: ' + m.trim(), usuario_cierre: usuario() }, META())); }
      await API.update('visita_repuestos', f.id, Object.assign({ estado_ins: 'ANULADO', motivo: 'Rechazado por ' + usuario() + ': ' + m.trim() }, META()));
      await evento(f.id_servicio, 'Insumo rechazado: ' + (f.descripcion || '') + ' · motivo: ' + m.trim());
      U().toast('Insumo rechazado'); recargar(); avisoIns().catch(() => {});
    } catch (e) { U().toast('❌ ' + e.message); }
  }
  window.PROSOL_INS_WEB = { aprobarIns, rechazarIns };
  // v4.07 · aviso «📦 Insumos por aprobar: N» en la barra superior (solo ADMIN / supervisor)
  async function avisoIns() {
    const top = document.querySelector('header.topbar'); if (!top || !document.querySelector('#nav button') || !API.hayNube()) return;
    let ap = false; try { ap = !!(await API.rpc('puede_aprobar', {})); } catch (e) { ap = false; }
    let btn = document.getElementById('btnInsAprobar');
    if (!ap) { if (btn) btn.remove(); return; }
    let nPend = 0; try { nPend = ((await API.select('visita_repuestos', { estado_ins: 'POR_APROBAR' })) || []).length; } catch (e) { return; }
    if (!btn) {
      btn = document.createElement('button'); btn.id = 'btnInsAprobar'; btn.type = 'button'; btn.className = 'btn-web';
      btn.style.cssText = 'margin-right:8px;white-space:nowrap;background:#F39C12;color:#fff;border:0;font-weight:700';
      btn.onclick = () => { sub = 'ins'; F.iFiltro = 'POR_APROBAR'; insumos._yaFiltro = true; (window.PROSOL_WEB && PROSOL_WEB.ir ? PROSOL_WEB.ir('inventario') : V.inventario()); };
      const ref = document.getElementById('btnBuscarTop') || document.getElementById('userBadge');
      if (ref && ref.parentNode) ref.parentNode.insertBefore(btn, ref); else top.appendChild(btn);
    }
    btn.textContent = '📦 Insumos por aprobar: ' + nPend; btn.style.display = nPend ? '' : 'none';
  }
  window.PROSOL_INS_WEB.aviso = avisoIns;
  setInterval(() => { avisoIns().catch(() => {}); }, 60000);
  const _ai = setInterval(() => { if (document.querySelector('#nav button')) { clearInterval(_ai); avisoIns().catch(() => {}); } }, 1500);
  function entregar(L) {
    U().modal(`<h3>📦 Entregado (con N° de guía)</h3><p style="font-size:13px;margin:0 0 6px">${L.length} insumo(s) · visita ${esc(L[0].id_visita)} · ${esc(L[0]._cli)}<br>${L.map((f) => esc(g(f.cantidad) + ' × ' + (f.descripcion || ''))).join('<br>')}</p>
      <label style="font-size:12px;font-weight:700">N° de guía</label><input class="inp-web" id="enG">
      <div id="enErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="enX">Cancelar</button><button class="btn-web prim" id="enOk">📦 Entregado</button></div>`);
    U().$id('enX').onclick = U().cerrarModal;
    U().$id('enOk').onclick = async () => {
      const num = U().$id('enG').value.trim();
      if (!num) { U().$id('enErr').textContent = 'Ingrese el número de guía.'; return; }
      U().$id('enOk').disabled = true; let k = 0;
      try {
        for (const f of L) {
          if (!['SOLICITADO', 'NO_RECIBIDO'].includes(f.estado_ins || 'SOLICITADO')) continue;
          await API.update('visita_repuestos', f.id, Object.assign({ estado_ins: 'ENTREGADO', numero_guia: num, entregado_por: usuario(), entregado_en: AHORA().slice(0, 16), motivo: null }, META()));
          await evento(f.id_servicio, 'Bodega (' + usuario() + ') entregó ' + g(f.cantidad) + ' × ' + (f.descripcion || '') + ' · guía ' + num + ' · visita ' + f.id_visita);
          k++;
        }
        U().toast('📦 ' + k + ' insumo(s) entregado(s) con guía ' + num); U().cerrarModal(); recargar();
      } catch (e) { U().$id('enOk').disabled = false; U().$id('enErr').textContent = '❌ ' + e.message; }
    };
  }
  async function anularIns(f) {
    if (f.estado_ins === 'RECIBIDO') { U().toast('Ya fue recibido por el técnico: use «Recibir devolución».'); return; }
    const m = prompt('Motivo para anular ' + (f.descripcion || '') + ':');
    if (m == null) return;
    if (!m.trim()) { U().toast('Indique el motivo.'); return; }
    try {
      if (f.id_reserva) {
        const r = (await API.select('inv_reservas', { id_escritorio: f.id_reserva }).catch(() => []))[0];
        if (r && ['RESERVADA', 'CONFIRMADA'].includes(r.estado)) {
          const R = {}; (await API.select('repuestos', { id_escritorio: r.id_repuesto }).catch(() => [])).forEach((x) => { R[x.id_escritorio] = x; });
          await cerrarReserva(r, 'LIBERADA', R, 'insumo anulado: ' + m.trim(), true);
        }
      }
      await API.update('visita_repuestos', f.id, Object.assign({ estado_ins: 'ANULADO', motivo: m.trim() }, META()));
      await evento(f.id_servicio, 'Insumo anulado: ' + (f.descripcion || '') + ' · motivo: ' + m.trim());
      U().toast('✖ Insumo anulado'); recargar();
    } catch (e) { U().toast('❌ ' + e.message); }
  }
  function devolucion(f) {
    U().modal(`<h3>↩ Recibir devolución</h3><p style="font-size:13px;margin:0 0 6px">${esc(f.descripcion || '')} · visita ${esc(f.id_visita)}<br>Recibido ${g(f.cantidad)} · usado ${g(f.cant_usada)} · devuelto ${g(f.devuelto)} · <b>pendiente ${g(f._dev)}</b></p>
      <label style="font-size:12px;font-weight:700">Cantidad devuelta</label><input class="inp-web" id="dvC" type="number" step="any" value="${g(f._dev)}">
      <div id="dvErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn-web sec" id="dvX">Cancelar</button><button class="btn-web prim" id="dvOk">↩ Recibir</button></div>`);
    U().$id('dvX').onclick = U().cerrarModal;
    U().$id('dvOk').onclick = async () => {
      const c = parseFloat(U().$id('dvC').value);
      if (!(c > 0) || c > f._dev + 1e-9) { U().$id('dvErr').textContent = 'Cantidad inválida (pendiente: ' + g(f._dev) + ').'; return; }
      U().$id('dvOk').disabled = true;
      try {
        await movimiento(f.id_repuesto, 'ENTRADA', c, 'Devolución de insumo no usado · visita ' + f.id_visita, f.id_servicio || f.id_visita);
        await API.update('visita_repuestos', f.id, Object.assign({ devuelto: n(f.devuelto) + c }, META()));
        await evento(f.id_servicio, 'Bodega (' + usuario() + ') recibió devolución: ' + g(c) + ' × ' + (f.descripcion || ''));
        U().toast('↩ Devolución recibida · stock +' + g(c)); U().cerrarModal(); recargar();
      } catch (e) { U().$id('dvOk').disabled = false; U().$id('dvErr').textContent = '❌ ' + e.message; }
    };
  }
  function despacho(todas) {
    const calc = (fecha) => {
      const m = {};
      todas.filter((f) => f._fecha === fecha && ['SOLICITADO', 'NO_RECIBIDO'].includes(f.estado_ins)).forEach((f) => {
        const k = (f._tec || '(sin técnico)') + '|' + f.id_repuesto;
        m[k] = m[k] || { tec: f._tec || '(sin técnico)', id: f.id_repuesto, cod: f.codigo, des: f.descripcion, uni: f.unidad, cant: 0, vis: new Set(), stock: f._stock };
        m[k].cant += n(f.cantidad); m[k].vis.add(f.id_visita);
      });
      const L = Object.values(m).sort((a, b) => a.tec.localeCompare(b.tec) || String(a.des).localeCompare(String(b.des)));
      const tot = {}; L.forEach((x) => { tot[x.id] = (tot[x.id] || 0) + x.cant; });
      return L.map((x) => Object.assign(x, { falta: Math.max(0, Math.round((tot[x.id] - x.stock) * 10000) / 10000) }));
    };
    U().modal(`<h3>🗓 Despacho del día</h3><input class="inp-web" id="dsF" type="date" value="${HOY()}" style="width:auto"> <button class="btn-web sec" id="dsImp">📄 Imprimir</button>
      <div id="dsL" style="margin-top:6px;max-height:60vh;overflow:auto"></div><div style="text-align:right;margin-top:8px"><button class="btn-web sec" id="dsX">Cerrar</button></div>`);
    const COLS = ['Técnico', 'Código', 'Insumo', 'Unidad', 'Cantidad', 'Visitas', 'Stock', 'Falta'];
    const filas = () => calc(U().$id('dsF').value).map((x) => [x.tec, x.cod || '', x.des || '', x.uni || '', g(x.cant), x.vis.size, g(x.stock), x.falta ? g(x.falta) : '']);
    const pintar = () => { U().$id('dsL').innerHTML = U().tabla(COLS, filas().map((f) => f.map((v) => esc(v)))); };
    U().$id('dsF').onchange = pintar;
    U().$id('dsImp').onclick = () => imprimir('Despacho del día ' + U().$id('dsF').value, `<table><thead><tr>${COLS.map((x) => '<th>' + x + '</th>').join('')}</tr></thead><tbody>${filas().map((f) => '<tr>' + f.map((v) => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('')}</tbody></table>`);
    U().$id('dsX').onclick = U().cerrarModal;
    pintar();
  }
  V._inventario = { movimiento, excel, completar, devPend };
})();
