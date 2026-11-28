/* PROSOL web PC · lib/web_catalogos.js (v3.96 · W2)
   «👷 Técnicos» y «🛠 Actividades» (con «🧾 Insumos de los combos») en la web, con los mismos datos y códigos que el escritorio.
   · Crean y editan ADMIN y OPERADOR; los demás consultan. El costo técnico (lo que se paga al técnico) y el costo por
     hora solo los ve ADMIN.
   · Código nuevo (TEC / ACT / AIT / RCT) lo da la nube; lo hecho aquí baja solo al escritorio (gana el más reciente).
   · Ítems de combo retirados quedan con orden −1 (igual que el escritorio). Módulo fuera del IIFE base. */
(() => {
  const V = window.PROSOL_WEB_VISTAS = window.PROSOL_WEB_VISTAS || {};
  const U = () => PROSOL_WEB.util;
  const esc = (s) => U().ESC(s);
  const ahora = () => new Date().toISOString();
  const n = (x) => { const v = Number(x); return isFinite(v) ? v : 0; };
  function rol() {
    try { const s = API.sesionNube && API.sesionNube(); if (s && s.rol) return String(s.rol).toUpperCase(); } catch (e) {}
    return String((window._prosolSesion || {}).perfil || '').toUpperCase();
  }
  const edita = () => ['ADMIN', 'OPERADOR'].includes(rol());
  const verCosto = () => rol() === 'ADMIN';
  const sinNube = (t) => { U().$id('main').innerHTML = `<div class="card"><h2>${t}</h2><p>☁ Sin conexión a la nube. Ve a <b>Configuración</b>.</p></div>`; };
  const lbl = (t) => `<label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">${t}</label>`;
  let turno = 0;
  const vigente = (t, id) => t === turno && document.getElementById(id);

  // ── 👷 Técnicos ─────────────────────────────────────────────────────
  const ESPECIALIDADES = ['TECNICO', 'MECANICO', 'ELECTRICO', 'SUPERVISOR', 'AYUDANTE', 'OTRO'];
  V.tecnicos = async () => {
    if (!API.hayNube()) return sinNube('👷 Técnicos');
    const t = ++turno;
    U().$id('main').innerHTML = '<div class="card" id="tcCard"><h2>👷 Técnicos</h2><div id="tcLista">Cargando…</div></div>';
    const tecs = await API.select('tecnicos').catch(() => []);
    if (!vigente(t, 'tcCard')) return;
    const c = U().$id('tcCard');
    c.innerHTML = `<h2>👷 Técnicos</h2>
      <div class="toolbar" style="flex-wrap:wrap">
        <input id="tcQ" class="inp-web" style="max-width:260px" placeholder="Buscar código, nombre, cédula…">
        <select id="tcEst" class="inp-web" style="max-width:170px"><option value="act">Activos</option><option value="arch">Archivados</option><option value="">Todos</option></select>
        ${edita() ? '<button class="btn-web prim" id="tcNuevo">➕ Nuevo técnico</button>' : ''}
      </div><div id="tcLista"></div>`;
    const pintar = () => {
      const q = (U().$id('tcQ').value || '').toLowerCase(), e = U().$id('tcEst').value;
      const L = tecs.filter((x) => (!q || [x.id_escritorio, x.nombres, x.apellidos, x.cedula, x.especialidad, x.telefono].some((v) => String(v || '').toLowerCase().includes(q)))
        && (!e || (e === 'arch' ? x.estado === 'ARCHIVADO' : x.estado !== 'ARCHIVADO')))
        .sort((a, b) => String(a.id_escritorio).localeCompare(String(b.id_escritorio)));
      const cab = ['', 'Código', 'Nombres', 'Apellidos', 'Especialidad', 'Teléfono', 'Correo', 'Cédula'].concat(verCosto() ? ['Costo/hora'] : []).concat(['Estado', '']);
      U().$id('tcLista').innerHTML = U().tabla(cab, L.map((x) => [
        x.foto_url ? `<img src="${esc(x.foto_url)}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:50%">` : '👤',
        `<b>${esc(x.id_escritorio || '')}</b>`, esc(x.nombres || ''), esc(x.apellidos || ''), esc(x.especialidad || ''), esc(x.telefono || ''),
        esc(x.correo || ''), esc(x.cedula || '')].concat(verCosto() ? [x.costo_hora != null ? n(x.costo_hora).toFixed(2) : ''] : []).concat([
        esc(x.estado || 'ACTIVO'),
        edita() ? `<button class="btn-web mini sec" data-ed="${x.id}">✎</button> <button class="btn-web mini sec" data-ar="${x.id}">${x.estado === 'ARCHIVADO' ? '♻ Reactivar' : '🗄 Archivar'}</button>` : ''])));
      U().$id('tcLista').querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => formTec(tecs.find((x) => String(x.id) === b.dataset.ed)));
      U().$id('tcLista').querySelectorAll('[data-ar]').forEach((b) => b.onclick = async () => {
        const x = tecs.find((y) => String(y.id) === b.dataset.ar);
        const nuevo = x.estado === 'ARCHIVADO' ? 'REACTIVADO' : 'ARCHIVADO';
        if (!confirm((nuevo === 'ARCHIVADO' ? '¿Archivar a ' : '¿Reactivar a ') + (x.nombres || '') + ' ' + (x.apellidos || '') + '?')) return;
        try { await API.update('tecnicos', x.id, { estado: nuevo, actualizado: ahora(), sync_origen: 'WEB' }); x.estado = nuevo; pintar();
              U().toast(nuevo === 'ARCHIVADO' ? '🗄 Técnico archivado' : '♻ Técnico reactivado'); }
        catch (e) { U().toast('❌ ' + e.message); }
      });
    };
    U().$id('tcQ').addEventListener('input', pintar); U().$id('tcEst').addEventListener('change', pintar);
    if (edita()) U().$id('tcNuevo').onclick = () => formTec(null);
    pintar();
  };
  function formTec(x) {
    const nuevo = !x; x = x || { estado: 'ACTIVO', especialidad: 'TECNICO' };
    let foto = x.foto_url || '', fotoData = null;
    U().modal(`<h3>${nuevo ? '➕ Nuevo técnico' : '✎ Técnico ' + esc(x.id_escritorio || '')}</h3>
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:6px">
        <div id="ftFoto" style="width:72px;height:72px;border-radius:50%;background:#EAECEE;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:30px">${foto ? `<img src="${esc(foto)}" style="width:100%;height:100%;object-fit:cover">` : '👤'}</div>
        <label class="btn-web sec" style="cursor:pointer">📷 Foto<input id="ftArch" type="file" accept="image/*" style="display:none"></label></div>
      <div class="grid2">
        <div>${lbl('Nombres *')}<input class="inp-web" id="ftNom" value="${esc(x.nombres || '')}"></div>
        <div>${lbl('Apellidos')}<input class="inp-web" id="ftApe" value="${esc(x.apellidos || '')}"></div>
        <div>${lbl('Cédula')}<input class="inp-web" id="ftCed" value="${esc(x.cedula || '')}"></div>
        <div>${lbl('Especialidad')}<select class="inp-web" id="ftEsp">${ESPECIALIDADES.map((e) => `<option ${e === x.especialidad ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
        <div>${lbl('Teléfono')}<input class="inp-web" id="ftTel" value="${esc(x.telefono || '')}"></div>
        <div>${lbl('Correo')}<input class="inp-web" id="ftCor" value="${esc(x.correo || '')}"></div>
        ${verCosto() ? `<div>${lbl('Costo / hora')}<input class="inp-web" id="ftCos" type="number" step="any" value="${esc(x.costo_hora ?? '')}"></div>` : ''}
        <div>${lbl('Estado')}<select class="inp-web" id="ftEst">${['ACTIVO', 'ARCHIVADO', 'REACTIVADO'].map((e) => `<option ${e === (x.estado || 'ACTIVO') ? 'selected' : ''}>${e}</option>`).join('')}</select></div></div>
      <div id="ftErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end"><button class="btn-web sec" id="ftX">Cancelar</button><button class="btn-web prim" id="ftOk">💾 Guardar</button></div>`);
    U().$id('ftX').onclick = U().cerrarModal;
    U().$id('ftArch').onchange = (ev) => {
      const f = ev.target.files && ev.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { fotoData = rd.result; U().$id('ftFoto').innerHTML = `<img src="${fotoData}" style="width:100%;height:100%;object-fit:cover">`; };
      rd.readAsDataURL(f);
    };
    U().$id('ftOk').onclick = async () => {
      const nom = U().$id('ftNom').value.trim();
      if (!nom) { U().$id('ftErr').textContent = 'Los nombres son obligatorios.'; return; }
      const row = { nombres: nom, apellidos: U().$id('ftApe').value.trim(), cedula: U().$id('ftCed').value.trim(),
        especialidad: U().$id('ftEsp').value, telefono: U().$id('ftTel').value.trim(), correo: U().$id('ftCor').value.trim(),
        estado: U().$id('ftEst').value, actualizado: ahora(), sync_origen: 'WEB' };
      if (verCosto()) { const c = U().$id('ftCos').value; row.costo_hora = c === '' ? null : n(c); }
      try {
        if (fotoData) row.foto_url = await API.subirFoto('tecnicos/' + (x.id_escritorio || 'nuevo') + '/web_' + Date.now() + '.jpg', fotoData);
        if (nuevo) { const r = await API.insert('tecnicos', row); const y = Array.isArray(r) ? r[0] : r; U().toast('✅ Técnico ' + ((y && y.id_escritorio) || '') + ' creado'); }
        else { await API.update('tecnicos', x.id, row); U().toast('✅ Técnico guardado'); }
        U().cerrarModal(); V.tecnicos();
      } catch (e) { U().$id('ftErr').textContent = '❌ ' + e.message; }
    };
  }

  // ── 🛠 Actividades + 🧾 Insumos de los combos ───────────────────────────
  let subAct = 'act';
  V.actividades = async () => {
    if (!API.hayNube()) return sinNube('🛠 Actividades');
    const t = ++turno;
    U().$id('main').innerHTML = `<div class="card" id="acBarra" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b>🛠 Actividades</b>
      <button class="btn-web ${subAct === 'act' ? 'prim' : 'sec'}" data-sa="act">🛠 Actividades y combos</button>
      <button class="btn-web ${subAct === 'rec' ? 'prim' : 'sec'}" data-sa="rec">🧾 Insumos de los combos</button></div><div class="card" id="acCuerpo">Cargando…</div>`;
    document.querySelectorAll('[data-sa]').forEach((b) => b.onclick = () => { subAct = b.dataset.sa; V.actividades(); });
    if (subAct === 'rec') return recetas(t);
    const [acts, items] = await Promise.all([API.select('actividades').catch(() => []), API.select('actividad_items').catch(() => [])]);
    if (!vigente(t, 'acCuerpo')) return;
    const itemsDe = (a) => items.filter((i) => i.id_actividad === a.id && n(i.orden) >= 0).sort((x, y) => n(x.orden) - n(y.orden));
    const c = U().$id('acCuerpo');
    c.innerHTML = `<div class="toolbar" style="flex-wrap:wrap">
        <input id="acQ" class="inp-web" style="max-width:260px" placeholder="Buscar código o descripción…">
        <select id="acTipo" class="inp-web" style="max-width:150px"><option value="">Todos los tipos</option><option>INDIVIDUAL</option><option>COMBO</option></select>
        <select id="acEst" class="inp-web" style="max-width:150px"><option value="ACTIVO">Activas</option><option value="INACTIVO">Archivadas</option><option value="">Todas</option></select>
        ${edita() ? '<button class="btn-web prim" id="acNuevo">➕ Nueva actividad</button>' : ''}</div><div id="acLista"></div>`;
    const pintar = () => {
      const q = (U().$id('acQ').value || '').toLowerCase(), tp = U().$id('acTipo').value, e = U().$id('acEst').value;
      const L = acts.filter((a) => (!q || [a.id_escritorio, a.descripcion].some((v) => String(v || '').toLowerCase().includes(q)))
        && (!tp || a.tipo === tp) && (!e || (e === 'ACTIVO' ? (a.estado || 'ACTIVO') === 'ACTIVO' : (a.estado || 'ACTIVO') !== 'ACTIVO')))
        .sort((x, y) => String(x.id_escritorio).localeCompare(String(y.id_escritorio)));
      const cab = ['Código', 'Descripción', 'Tipo', 'Unidad'].concat(verCosto() ? ['Costo técnico'] : []).concat(['Precio cliente', 'Ítems', 'Estado', '']);
      U().$id('acLista').innerHTML = U().tabla(cab, L.map((a) => [`<b>${esc(a.id_escritorio || '')}</b>`, esc(a.descripcion || ''), esc(a.tipo || 'INDIVIDUAL'),
        esc(a.unidad || '')].concat(verCosto() ? [n(a.valor_referencia).toFixed(2)] : []).concat([n(a.valor_cliente).toFixed(2),
        a.tipo === 'COMBO' ? itemsDe(a).length : '', esc(a.estado || 'ACTIVO'),
        edita() ? `<button class="btn-web mini sec" data-ed="${a.id}">✎</button>` : ''])));
      U().$id('acLista').querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => { const a = acts.find((x) => String(x.id) === b.dataset.ed); formAct(a, itemsDe(a)); });
    };
    ['acQ'].forEach((i) => U().$id(i).addEventListener('input', pintar));
    ['acTipo', 'acEst'].forEach((i) => U().$id(i).addEventListener('change', pintar));
    if (edita()) U().$id('acNuevo').onclick = () => formAct(null, []);
    pintar();
  };
  function formAct(a, itemsPrev) {
    const nueva = !a; a = a || { tipo: 'INDIVIDUAL', unidad: 'SERVICIO', estado: 'ACTIVO' };
    let lista = itemsPrev.map((i) => ({ id: i.id, descripcion: i.descripcion }));
    U().modal(`<h3>${nueva ? '➕ Nueva actividad' : '✎ Actividad ' + esc(a.id_escritorio || '')}</h3>
      ${lbl('Descripción *')}<input class="inp-web" id="faDes" value="${esc(a.descripcion || '')}">
      <div class="grid2">
        <div>${lbl('Tipo')}<select class="inp-web" id="faTipo">${['INDIVIDUAL', 'COMBO'].map((x) => `<option ${x === a.tipo ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div>${lbl('Unidad')}<select class="inp-web" id="faUni">${['SERVICIO', 'HORA', 'VISITA', 'GLOBAL'].map((x) => `<option ${x === a.unidad ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        ${verCosto() ? `<div>${lbl('Costo técnico (se paga al técnico)')}<input class="inp-web" id="faRef" type="number" step="any" value="${esc(a.valor_referencia ?? 0)}"></div>` : ''}
        <div>${lbl('Precio cliente')}<input class="inp-web" id="faCli" type="number" step="any" value="${esc(a.valor_cliente ?? 0)}"></div>
        <div>${lbl('Estado')}<select class="inp-web" id="faEst">${['ACTIVO', 'INACTIVO'].map((x) => `<option ${x === (a.estado || 'ACTIVO') ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
      ${lbl('Observación')}<textarea class="inp-web" id="faObs" rows="2">${esc(a.observacion || '')}</textarea>
      <div id="faCombo"></div>
      <div id="faErr" style="color:#C0392B;font-size:13px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end"><button class="btn-web sec" id="faX">Cancelar</button><button class="btn-web prim" id="faOk">💾 Guardar</button></div>`);
    const pintarCombo = () => {
      const box = U().$id('faCombo');
      if (U().$id('faTipo').value !== 'COMBO') { box.innerHTML = ''; return; }
      box.innerHTML = `${lbl('Actividades incluidas en el combo')}
        ${lista.map((it, i) => `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px"><span style="width:22px;text-align:right">${i + 1}.</span>
          <input class="inp-web" data-it="${i}" value="${esc(it.descripcion)}">
          <button class="btn-web mini sec" data-up="${i}" title="Subir">▲</button><button class="btn-web mini sec" data-dn="${i}" title="Bajar">▼</button>
          <button class="btn-web mini sec" data-rm="${i}" title="Quitar">🗑</button></div>`).join('')}
        <div style="display:flex;gap:6px;margin-top:6px"><input class="inp-web" id="faNuevoIt" placeholder="Nueva actividad del combo"><button class="btn-web sec" id="faAddIt">➕</button></div>`;
      const leer = () => box.querySelectorAll('[data-it]').forEach((inp) => { lista[+inp.dataset.it].descripcion = inp.value; });
      box.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => { leer(); const i = +b.dataset.up; if (i > 0) [lista[i - 1], lista[i]] = [lista[i], lista[i - 1]]; pintarCombo(); });
      box.querySelectorAll('[data-dn]').forEach((b) => b.onclick = () => { leer(); const i = +b.dataset.dn; if (i < lista.length - 1) [lista[i + 1], lista[i]] = [lista[i], lista[i + 1]]; pintarCombo(); });
      box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { leer(); lista.splice(+b.dataset.rm, 1); pintarCombo(); });
      U().$id('faAddIt').onclick = () => { leer(); const v = U().$id('faNuevoIt').value.trim(); if (v) { lista.push({ descripcion: v }); pintarCombo(); } };
    };
    U().$id('faTipo').onchange = () => { pintarCombo(); pintarIns(); }; pintarCombo();
    async function pintarIns() {                        // v4.07 · insumos del combo (se guardan al momento)
      let box = U().$id('faIns'); if (!box) { U().$id('faCombo').insertAdjacentHTML('afterend', '<div id="faIns"></div>'); box = U().$id('faIns'); }
      if (U().$id('faTipo').value !== 'COMBO' || !a.id_escritorio) { box.innerHTML = U().$id('faTipo').value === 'COMBO' ? '<p style="font-size:12px;color:#888">Guarde el combo para agregarle insumos.</p>' : ''; return; }
      const [rec, reps] = await Promise.all([API.select('recetas_insumos', { id_actividad: a.id_escritorio }).catch(() => []), API.select('repuestos').catch(() => [])]);
      const R = {}; reps.forEach((r) => { R[r.id_escritorio] = r; });
      const L = rec.filter((r) => (r.estado || 'ACTIVO') === 'ACTIVO');
      box.innerHTML = `${lbl('📦 Insumos del combo (se cargan a la visita y a la OT)')}
        ${L.map((r) => `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;font-size:13px"><span style="flex:1">${esc((R[r.id_repuesto] || {}).codigo || r.id_repuesto)} · ${esc((R[r.id_repuesto] || {}).descripcion || '')}</span><b>${n(r.cantidad)}</b>
          ${edita() ? `<button class="btn-web mini sec" data-qi="${r.id}">🗑</button>` : ''}</div>`).join('') || '<p style="font-size:12px;color:#888">Sin insumos.</p>'}
        ${edita() ? `<div style="display:flex;gap:6px;margin-top:6px"><select class="inp-web" id="faInsRep"><option value="">— insumo —</option>${reps.filter((r) => (r.estado || 'ACTIVO') === 'ACTIVO')
          .sort((x, y) => String(x.descripcion).localeCompare(String(y.descripcion))).map((r) => `<option value="${esc(r.id_escritorio)}">${esc(r.codigo || '')} · ${esc(r.descripcion || '')}</option>`).join('')}</select>
          <input class="inp-web" id="faInsCant" type="number" step="any" value="1" style="max-width:80px"><button class="btn-web sec" id="faInsAdd">➕</button></div>` : ''}`;
      box.querySelectorAll('[data-qi]').forEach((b) => b.onclick = async () => { await API.update('recetas_insumos', b.dataset.qi, { estado: 'INACTIVO', actualizado: ahora(), sync_origen: 'WEB' }); pintarIns(); });
      const add = U().$id('faInsAdd');
      if (add) add.onclick = async () => {
        const idr = U().$id('faInsRep').value, cant = n(U().$id('faInsCant').value);
        if (!idr || !(cant > 0)) { U().$id('faErr').textContent = 'Elija el insumo y una cantidad mayor que cero.'; return; }
        const ya = L.find((r) => r.id_repuesto === idr && !n(r.potencia_kw));
        if (ya) await API.update('recetas_insumos', ya.id, { cantidad: cant, actualizado: ahora(), sync_origen: 'WEB' });
        else await API.insert('recetas_insumos', { tipo: String(a.descripcion || '').toUpperCase().trim(), id_actividad: a.id_escritorio, potencia_kw: 0, id_repuesto: idr,
          cantidad: cant, orden: L.length + 1, estado: 'ACTIVO', nota: '', actualizado: ahora(), sync_origen: 'WEB' });
        pintarIns();
      };
    }
    pintarIns();
    U().$id('faX').onclick = U().cerrarModal;
    U().$id('faOk').onclick = async () => {
      const des = U().$id('faDes').value.trim();
      if (!des) { U().$id('faErr').textContent = 'La descripción es obligatoria.'; return; }
      const box = U().$id('faCombo');
      box.querySelectorAll('[data-it]').forEach((inp) => { lista[+inp.dataset.it].descripcion = inp.value; });
      const tipo = U().$id('faTipo').value;
      const row = { descripcion: des, tipo, unidad: U().$id('faUni').value, valor_cliente: n(U().$id('faCli').value),
        estado: U().$id('faEst').value, observacion: U().$id('faObs').value.trim(), actualizado: ahora(), sync_origen: 'WEB' };
      if (verCosto()) row.valor_referencia = n(U().$id('faRef').value);
      else if (nueva) row.valor_referencia = 0;
      try {
        let id = a.id, cod = a.id_escritorio;
        if (nueva) { const r = await API.insert('actividades', row); const y = Array.isArray(r) ? r[0] : r; id = y.id; cod = y.id_escritorio; }
        else await API.update('actividades', a.id, row);
        if (tipo === 'COMBO' || itemsPrev.length) {
          const vivos = tipo === 'COMBO' ? lista.filter((it) => (it.descripcion || '').trim()) : [];
          const quedan = new Set(vivos.filter((it) => it.id).map((it) => String(it.id)));
          for (const old of itemsPrev) if (!quedan.has(String(old.id))) await API.update('actividad_items', old.id, { orden: -1, actualizado: ahora(), sync_origen: 'WEB' });
          for (let i = 0; i < vivos.length; i++) {
            const it = vivos[i], fila = { descripcion: it.descripcion.trim(), orden: i, actualizado: ahora(), sync_origen: 'WEB' };
            if (it.id) await API.update('actividad_items', it.id, fila);
            else await API.insert('actividad_items', Object.assign({ id_actividad: id }, fila));
          }
        }
        U().toast('✅ Actividad ' + (cod || '') + (nueva ? ' creada' : ' guardada'));
        U().cerrarModal(); V.actividades();
      } catch (e) { U().$id('faErr').textContent = '❌ ' + e.message; }
    };
  }

  async function recetas(t) {     // v4.07: insumos de cada actividad COMBO (antes: receta por tipo de mantenimiento)
    const [rec, reps, acts] = await Promise.all([API.select('recetas_insumos').catch(() => []), API.select('repuestos').catch(() => []),
      API.select('actividades').catch(() => [])]);
    if (!vigente(t, 'acCuerpo')) return;
    const rep = {}; reps.forEach((r) => { rep[r.id_escritorio] = r; });
    const combos = acts.filter((a) => (a.estado || 'ACTIVO') === 'ACTIVO' && String(a.tipo || '').toUpperCase() === 'COMBO')
      .sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion)));
    const CB = {}; combos.forEach((a) => { CB[a.id_escritorio] = a; });
    const c = U().$id('acCuerpo');
    const act = rec.filter((r) => (r.estado || 'ACTIVO') === 'ACTIVO' && r.id_actividad)
      .sort((a, b) => String(a.tipo).localeCompare(String(b.tipo)) || n(a.potencia_kw) - n(b.potencia_kw) || n(a.orden) - n(b.orden));
    c.innerHTML = `<h2>🧾 Insumos de los combos</h2>
      <p style="font-size:12px;color:#666;margin:0 0 8px">Insumos de cada actividad COMBO: se cargan solos a la visita (según sus tareas o el combo que se llama como su tipo de mantenimiento) y a la OT, y quedan «Por aprobar». Potencia 0 = todas.</p>
      ${edita() ? `<div class="toolbar" style="flex-wrap:wrap">
        <select class="inp-web" id="rcTipo" style="max-width:280px"><option value="">— combo —</option>${combos.map((a) => `<option value="${esc(a.id_escritorio)}">${esc(a.descripcion)}</option>`).join('')}</select>
        <input class="inp-web" id="rcPot" type="number" step="any" value="0" style="max-width:110px" title="Potencia kW (0 = todas)">
        <select class="inp-web" id="rcRep" style="max-width:320px"><option value="">— insumo —</option>${reps.filter((r) => (r.estado || 'ACTIVO') === 'ACTIVO')
          .sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion))).map((r) => `<option value="${esc(r.id_escritorio)}">${esc(r.codigo || '')} · ${esc(r.descripcion || '')}</option>`).join('')}</select>
        <input class="inp-web" id="rcCant" type="number" step="any" value="1" style="max-width:90px" title="Cantidad">
        <button class="btn-web prim" id="rcAdd">➕ Agregar al combo</button></div><div id="rcErr" style="color:#C0392B;font-size:13px;min-height:18px"></div>` : ''}
      <div id="rcLista"></div>`;
    U().$id('rcLista').innerHTML = act.length ? U().tabla(['Combo (actividad)', 'Potencia kW', 'Código', 'Insumo', 'Cantidad', 'Unidad', 'Stock', ''],
      act.map((r) => { const p = rep[r.id_repuesto] || {}; return [esc((CB[r.id_actividad] || {}).descripcion || r.tipo), n(r.potencia_kw) ? n(r.potencia_kw) : 'Todas', esc(p.codigo || r.id_repuesto),
        esc(p.descripcion || ''), n(r.cantidad), esc(p.unidad || ''), p.stock != null ? n(p.stock) : '',
        edita() ? `<button class="btn-web mini sec" data-q="${r.id}">✖ Quitar</button>` : '']; })) : '<p>Sin insumos en los combos todavía.</p>';
    U().$id('rcLista').querySelectorAll('[data-q]').forEach((b) => b.onclick = async () => {
      if (!confirm('¿Quitar este insumo del combo? (Las visitas ya cargadas no cambian.)')) return;
      try { await API.update('recetas_insumos', b.dataset.q, { estado: 'INACTIVO', actualizado: ahora(), sync_origen: 'WEB' }); V.actividades(); }
      catch (e) { U().toast('❌ ' + e.message); }
    });
    if (edita()) U().$id('rcAdd').onclick = async () => {
      const ida = U().$id('rcTipo').value, id_repuesto = U().$id('rcRep').value,
        pot = n(U().$id('rcPot').value), cant = n(U().$id('rcCant').value);
      const tipo = String((CB[ida] || {}).descripcion || '').toUpperCase().trim().replace(/\s+/g, ' ');
      if (!ida || !id_repuesto || !(cant > 0)) { U().$id('rcErr').textContent = 'Indique el combo, el insumo y una cantidad mayor que cero.'; return; }
      const ya = act.find((r) => r.id_actividad === ida && n(r.potencia_kw) === pot && r.id_repuesto === id_repuesto);
      try {
        if (ya) await API.update('recetas_insumos', ya.id, { cantidad: cant, actualizado: ahora(), sync_origen: 'WEB' });
        else await API.insert('recetas_insumos', { tipo, id_actividad: ida, potencia_kw: pot, id_repuesto, cantidad: cant, orden: act.filter((r) => r.id_actividad === ida).length + 1,
          estado: 'ACTIVO', nota: '', actualizado: ahora(), sync_origen: 'WEB' });
        U().toast('✅ Insumo del combo guardado'); V.actividades();
      } catch (e) { U().$id('rcErr').textContent = '❌ ' + e.message; }
    };
  }
})();
