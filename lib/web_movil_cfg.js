/* PROSOL web PC · lib/web_movil_cfg.js (v3.99.2)
   Configuración › «📱 Celulares: historial a mostrar» (solo ADMIN): cuántas OT de historial y cuántas visitas ya
   atendidas baja el catálogo del celular (últimas N, por defecto 50) y, si se quiere, solo desde una fecha.
   Así el catálogo no crece día a día ni gasta datos/memoria del celular. Se guarda en la nube (config_movil_guardar)
   y los celulares lo toman al actualizar el catálogo. Módulo fuera del IIFE base. */
(() => {
  const V = window.PROSOL_WEB_VISTAS = window.PROSOL_WEB_VISTAS || {};
  const U = () => PROSOL_WEB.util;
  const rol = () => { try { return String((API.sesionNube && API.sesionNube() || {}).rol || '').toUpperCase(); } catch (e) { return ''; } };
  V.config = async () => {
    await PROSOL_WEB.vistaBase('config')();
    if (rol() !== 'ADMIN' || typeof API === 'undefined' || !API.hayNube()) return;
    const main = U().$id('main'); if (!main || document.getElementById('mcfgCard')) return;
    const card = document.createElement('div'); card.className = 'card'; card.id = 'mcfgCard';
    card.innerHTML = `<h3 style="margin-top:0">📱 Celulares: historial a mostrar</h3>
      <p style="font-size:13px;color:#555;margin:0 0 8px">El catálogo del celular baja todas las visitas por atender y, de lo ya hecho, solo las
      <b>últimas N</b> órdenes de trabajo y visitas atendidas (solo consulta). Si indica una fecha, además solo desde esa fecha.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div><label style="font-size:12px;font-weight:700;display:block">Máximo (N)</label><input class="inp-web" id="mcfgMax" type="number" min="1" max="5000" style="width:110px"></div>
        <div><label style="font-size:12px;font-weight:700;display:block">Desde (opcional)</label><input class="inp-web" id="mcfgDesde" type="date" style="width:auto"></div>
        <button class="btn-web prim" id="mcfgOk">💾 Guardar</button></div>
      <p id="mcfgMsg" style="font-size:13px;min-height:18px;margin:6px 0 0"></p>`;
    main.appendChild(card);
    try { const r = await API.rpc('historial_movil', {}); U().$id('mcfgMax').value = r.max || 50; U().$id('mcfgDesde').value = r.desde || ''; }
    catch (e) { U().$id('mcfgMax').value = 50; }
    U().$id('mcfgOk').onclick = async () => {
      const m = parseInt(U().$id('mcfgMax').value, 10), d = U().$id('mcfgDesde').value, msg = U().$id('mcfgMsg');
      if (!(m >= 1 && m <= 5000)) { msg.style.color = '#C0392B'; msg.textContent = 'Indique un número entre 1 y 5000.'; return; }
      try { await API.rpc('config_movil_guardar', { p_max: m, p_desde: d || '' });
            msg.style.color = '#1E8449'; msg.textContent = '✅ Guardado: los celulares lo aplican al actualizar el catálogo.'; }
      catch (e) { msg.style.color = '#C0392B'; msg.textContent = '❌ ' + e.message; }
    };
  };
})();
