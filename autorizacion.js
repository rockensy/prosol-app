/* autorizacion.js · PROSOL v3.64 — página pública del cliente para AUTORIZAR (o no) el mantenimiento propuesto
   desde Programación. No lleva ninguna clave: lee y responde por la función de borde «autorizacion».
   La respuesta llega a la nube y la ven el escritorio (Programación › Autorizaciones) y la web. */
(() => {
  'use strict';
  const FN = 'https://nildkoxrgbdqzrunqogz.supabase.co/functions/v1/autorizacion';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fecha = (f) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : (f || ''); };
  const hora = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const token = (new URLSearchParams(location.search).get('t') || '').toLowerCase();
  const TXT = { AUTORIZADO: '✅ Autorizo el mantenimiento', NO_AUTORIZADO: '❌ No autorizo por ahora', MAS_INFO: '💬 Necesito más información' };
  const RESP = { AUTORIZADO: '✅ Usted AUTORIZÓ el mantenimiento. Nos comunicaremos para coordinar la visita.',
    NO_AUTORIZADO: 'Registramos que por ahora NO autoriza el mantenimiento. Gracias por informarnos.',
    MAS_INFO: '💬 Registramos su pedido de más información. Un asesor de PROSOL se comunicará con usted.' };

  function vacio(ic, titulo, txt) {
    $('#app').innerHTML = `<div class="card vacio"><div style="font-size:2.4rem">${ic}</div><h2 style="font-size:1rem;color:var(--texto);text-transform:none;letter-spacing:0">${esc(titulo)}</h2><p class="nota">${esc(txt)}</p></div>`;
  }

  function pintar(a) {
    const acts = (a.actividades || []).map((x) => `<li>✓ ${esc(x)}</li>`).join('');
    let h = `<div class="card"><h2>Mantenimiento propuesto</h2>
      ${a.cliente ? `<div class="dato"><b>👤 Cliente</b><span>${esc(a.cliente)}</span></div>` : ''}
      ${a.equipo ? `<div class="dato"><b>⚡ Equipo</b><span>${esc(a.equipo)}</span></div>` : ''}
      ${a.serie ? `<div class="dato"><b>🔢 Serie</b><span>${esc(a.serie)}</span></div>` : ''}
      ${a.ultimo ? `<div class="dato"><b>📅 Último</b><span>${esc(fecha(a.ultimo))}</span></div>` : ''}
      ${a.proximo ? `<div class="dato"><b>⏭️ Sugerido</b><span>${esc(fecha(a.proximo))}</span></div>` : ''}
      ${a.servicio ? `<div class="dato"><b>🛠️ Servicio</b><span>${esc(a.servicio)}</span></div>` : ''}
      ${acts ? `<ul class="acts" style="margin-top:8px">${acts}</ul>` : ''}</div>`;
    if (a.respondido) h += `<div class="card"><div class="ok">${esc(RESP[a.estado] || '')}</div>
      <p class="nota" style="margin:8px 0 0">Respondido el ${esc(hora(a.respondido))}${a.fecha_preferida ? ' · fecha preferida ' + esc(fecha(a.fecha_preferida)) : ''}.</p></div>`;
    if (a.gestion) {
      h += `<div class="card"><p class="nota" style="margin:0">La oficina ya registró su respuesta. Para cambios comuníquese con PROSOL.</p></div>`;
    } else {
      h += `<div class="card"><h2>${a.respondido ? 'Cambiar mi respuesta' : 'Su respuesta'}</h2>
        <div class="opc">${Object.keys(TXT).map((k) => `<label data-k="${k}"><input type="radio" name="r" value="${k}" ${a.estado === k ? 'checked' : ''}>${TXT[k]}</label>`).join('')}</div>
        <label class="nota" for="fp">Fecha preferida para la visita (opcional)</label>
        <input type="date" id="fp" value="${esc(a.fecha_preferida || '')}" style="margin:4px 0 10px">
        <label class="nota" for="cm">Comentario o consulta (opcional)</label>
        <textarea id="cm" rows="3" maxlength="1000" placeholder="Ej.: prefiero en la mañana / quisiera saber el costo">${esc(a.comentario || '')}</textarea>
        <div id="msg" style="margin:10px 0"></div>
        <button class="btn" id="enviar">Enviar respuesta</button></div>`;
    }
    $('#app').innerHTML = h;
    const marcar = () => document.querySelectorAll('.opc label').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    document.querySelectorAll('.opc input').forEach((i) => i.addEventListener('change', marcar)); marcar();
    const b = $('#enviar'); if (b) b.onclick = enviar;
  }

  async function enviar() {
    const sel = document.querySelector('.opc input:checked');
    if (!sel) { $('#msg').innerHTML = '<div class="err">Elija una opción.</div>'; return; }
    const b = $('#enviar'); b.disabled = true; b.textContent = 'Enviando…';
    try {
      const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token, estado: sel.value, comentario: $('#cm').value.trim(), fecha: $('#fp').value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('error ' + r.status));
      await cargar();
    } catch (e) {
      $('#msg').innerHTML = `<div class="err">No se pudo enviar: ${esc(e.message)}. Intente de nuevo o responda por WhatsApp.</div>`;
      b.disabled = false; b.textContent = 'Enviar respuesta';
    }
  }

  async function cargar() {
    if (!/^[0-9a-f]{32}$/.test(token)) { vacio('🔗', 'Enlace no válido', 'Revise que el enlace esté completo o solicítelo nuevamente a PROSOL.'); return; }
    try {
      const r = await fetch(FN + '/' + token, { cache: 'no-store' });
      if (r.status === 404) { vacio('🔎', 'Solicitud no encontrada', 'El enlace no corresponde a una solicitud vigente.'); return; }
      if (r.status === 410) { vacio('⌛', 'Solicitud vencida', 'Este enlace ya no está vigente. Comuníquese con PROSOL.'); return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      pintar(await r.json());
    } catch (e) { vacio('📶', 'Sin conexión', 'No se pudo cargar la solicitud. Revise su conexión e intente de nuevo.'); }
  }
  cargar();
})();
