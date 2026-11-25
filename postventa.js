/* postventa.js · PROSOL v3.89 · PSR-9 — en la página de seguimiento del cliente:
   · Conformidad remota: si el servicio terminó y el cliente NO firmó en sitio, registra su conformidad (nombre,
     conforme sí/no, calificación 1–5, comentario y firma opcional).
   · Reclamos: registra un reclamo y ve su estado y la respuesta de PROSOL.
   Escribe solo por funciones de la nube que validan el enlace (no tiene acceso directo a las tablas). */
const POSTVENTA = (() => {
  'use strict';
  const SB = 'https://nildkoxrgbdqzrunqogz.supabase.co/rest/v1/rpc/';
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pbGRrb3hyZ2JkcXpydW5xb2d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2Mzg0MjgsImV4cCI6MjA5ODIxNDQyOH0.DmPYmWpAeiwIhm72y2soUG__sVxlok4WQvxrjoGq3Gs';
  const MOTIVOS = ['El equipo falla después del servicio', 'Trabajo incompleto', 'Daño o suciedad en el sitio',
                   'Atención del técnico', 'Facturación o cobro', 'Otro'];
  const ESTADO = { PENDIENTE: 'Recibido · pendiente', EN_GESTION: 'En gestión', ATENDIDO: 'Atendido' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hora = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

  async function rpc(fn, args) {
    const r = await fetch(SB + fn, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
                                     body: JSON.stringify(args) });
    const t = await r.text();
    if (!r.ok) { let m = t; try { m = JSON.parse(t).message || t; } catch (e) {} throw new Error(m); }
    try { return JSON.parse(t); } catch (e) { return t; }
  }

  function firmaCanvas(cv) {
    const ctx = cv.getContext('2d');
    const blanco = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#000'; };
    blanco();                                          // v3.90: fondo blanco y trazo negro siempre
    let dib = false, hay = false;
    const pos = (e) => { const r = cv.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e;
      return [(p.clientX - r.left) * cv.width / r.width, (p.clientY - r.top) * cv.height / r.height]; };
    const ini = (e) => { e.preventDefault(); dib = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
    const mov = (e) => { if (!dib) return; e.preventDefault(); const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); hay = true; };
    const fin = () => { dib = false; };
    cv.addEventListener('mousedown', ini); cv.addEventListener('mousemove', mov); window.addEventListener('mouseup', fin);
    cv.addEventListener('touchstart', ini, { passive: false }); cv.addEventListener('touchmove', mov, { passive: false }); cv.addEventListener('touchend', fin);
    return { limpiar: () => { blanco(); hay = false; }, dato: () => (hay ? cv.toDataURL('image/png') : '') };
  }

  function htmlConformidad(s, pv) {
    if (pv.conformidad) {
      const c = pv.conformidad;
      return `<div class="card"><h2>✅ Conformidad registrada</h2><p style="margin:0">${esc(c.nombre)} · ${c.conforme ? 'Conforme' : 'No conforme'}
        ${c.calificacion ? ' · ' + '★'.repeat(c.calificacion) + '☆'.repeat(5 - c.calificacion) : ''}<br><span class="nota">${esc(hora(c.creado))}</span></p></div>`;
    }
    if ((s.reporte || {}).firma) return '';
    return `<div class="card noprint" id="pv-conf"><h2>✍️ Confirme la recepción del servicio</h2>
      <p class="nota" style="margin-top:0">El servicio terminó sin su firma en sitio. Puede confirmarlo aquí.</p>
      <label>Su nombre</label><input id="pv-nombre" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #ccd1d1;margin:4px 0 10px">
      <div style="display:flex;gap:16px;margin-bottom:10px"><label><input type="radio" name="pv-conf" value="1" checked> Conforme</label>
        <label><input type="radio" name="pv-conf" value="0"> No conforme</label></div>
      <label>Calificación</label><div id="pv-estrellas" style="font-size:1.8rem;letter-spacing:4px;cursor:pointer;margin:2px 0 10px">${'<span data-v="%">☆</span>'.repeat(5).replace(/%/g, () => '')}</div>
      <label>Comentario (opcional)</label><textarea id="pv-coment" rows="2" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #ccd1d1;margin:4px 0 10px"></textarea>
      <label>Firma (opcional)</label><canvas id="pv-firma" width="600" height="180" style="width:100%;height:130px;border:1px dashed #aab7b8;border-radius:8px;background:#fff;touch-action:none"></canvas>
      <button type="button" id="pv-limpiar" style="margin:4px 0 10px;background:none;border:0;color:#2471a3;cursor:pointer">Borrar firma</button>
      <div id="pv-err" style="color:#c0392b;font-size:.9rem;min-height:18px"></div>
      <button class="btn" id="pv-enviar">Enviar conformidad</button></div>`;
  }

  function htmlReclamos(pv) {
    const lst = (pv.reclamos || []).map((r) => `<div class="av"><small>${esc(hora(r.creado))} · ${esc(ESTADO[r.estado] || r.estado)}</small><b>${esc(r.motivo)}</b>
      ${r.respuesta ? `<div style="margin-top:4px">💬 PROSOL: ${esc(r.respuesta)}</div>` : ''}</div>`).join('');
    return `<div class="card noprint" id="pv-rec"><h2>📣 ¿Algún problema con el servicio?</h2>${lst}
      <div id="pv-rec-form" hidden>
        <label>Su nombre</label><input id="pr-nombre" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #ccd1d1;margin:4px 0 8px">
        <label>Teléfono o correo</label><input id="pr-contacto" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #ccd1d1;margin:4px 0 8px">
        <label>Motivo</label><select id="pr-motivo" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ccd1d1;margin:4px 0 8px">
          <option value="">— Elija —</option>${MOTIVOS.map((m) => `<option>${esc(m)}</option>`).join('')}</select>
        <label>Descripción</label><textarea id="pr-desc" rows="3" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #ccd1d1;margin:4px 0 8px"></textarea>
        <div id="pr-err" style="color:#c0392b;font-size:.9rem;min-height:18px"></div>
        <button class="btn" id="pr-enviar">Enviar reclamo</button></div>
      <button class="btn" id="pr-abrir" style="background:#e5e8e8;color:#1b2631">Registrar un reclamo</button></div>`;
  }

  async function montar(cont, s, token) {
    let pv;
    try { pv = await rpc('cliente_postventa', { p_token: token }); } catch (e) { return; }
    if (!pv) return;
    cont.innerHTML = htmlConformidad(s, pv) + htmlReclamos(pv);
    const q = (x) => cont.querySelector(x);
    let estrellas = 0;
    const est = q('#pv-estrellas');
    if (est) {
      const pintarE = () => est.querySelectorAll('span').forEach((sp, i) => { sp.textContent = i < estrellas ? '★' : '☆'; sp.style.color = i < estrellas ? '#f39c12' : '#aab7b8'; });
      est.querySelectorAll('span').forEach((sp, i) => { sp.onclick = () => { estrellas = i + 1; pintarE(); }; }); pintarE();
      const fz = firmaCanvas(q('#pv-firma'));
      q('#pv-limpiar').onclick = fz.limpiar;
      q('#pv-enviar').onclick = async () => {
        const nombre = q('#pv-nombre').value.trim();
        if (!nombre) { q('#pv-err').textContent = 'Escriba su nombre.'; return; }
        q('#pv-enviar').disabled = true; q('#pv-enviar').textContent = 'Enviando…';
        try {
          await rpc('cliente_conformidad', { p_token: token, p_nombre: nombre, p_conforme: (cont.querySelector('input[name="pv-conf"]:checked') || {}).value === '1',
            p_calificacion: estrellas || null, p_comentario: q('#pv-coment').value.trim(), p_firma: fz.dato() });
          montar(cont, s, token);
        } catch (e) { q('#pv-err').textContent = e.message; q('#pv-enviar').disabled = false; q('#pv-enviar').textContent = 'Enviar conformidad'; }
      };
    }
    q('#pr-abrir').onclick = () => { q('#pv-rec-form').hidden = false; q('#pr-abrir').hidden = true; };
    q('#pr-enviar').onclick = async () => {
      const nombre = q('#pr-nombre').value.trim(), motivo = q('#pr-motivo').value;
      if (!nombre || !motivo) { q('#pr-err').textContent = 'Escriba su nombre y elija el motivo.'; return; }
      q('#pr-enviar').disabled = true; q('#pr-enviar').textContent = 'Enviando…';
      try {
        await rpc('cliente_reclamo', { p_token: token, p_nombre: nombre, p_contacto: q('#pr-contacto').value.trim(), p_motivo: motivo,
          p_descripcion: q('#pr-desc').value.trim() });
        montar(cont, s, token);
      } catch (e) { q('#pr-err').textContent = e.message; q('#pr-enviar').disabled = false; q('#pr-enviar').textContent = 'Enviar reclamo'; }
    };
  }
  return { montar, _rpc: rpc };
})();
window.POSTVENTA = POSTVENTA;
