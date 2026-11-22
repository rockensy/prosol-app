/* seguimiento.js · PROSOL M13 (v3.48) — página pública del cliente: estado de su servicio y, al cierre, el
   reporte del trabajo realizado como constancia. No lleva ninguna clave: lee por la función de borde
   «seguimiento», que devuelve solo la visita del enlace (válido hasta 30 días después del cierre). */
(() => {
  'use strict';
  const FN = 'https://nildkoxrgbdqzrunqogz.supabase.co/functions/v1/seguimiento/';
  const ETAPAS = [['PROGRAMADA', 'Programada', '📅'], ['EN_CAMINO', 'Técnico en camino', '🚚'], ['EN_SITIO', 'Técnico en sitio', '📍'],
    ['EN_PROCESO', 'Trabajo en proceso', '🔧'], ['FINALIZADA', 'Servicio finalizado', '✅']];
  const CLASE = { PROGRAMADA: 'Programada', NO_PROGRAMADA: 'No programada', URGENTE: 'Urgente' };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hora = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const fecha = (f) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : (f || ''); };
  const token = (new URLSearchParams(location.search).get('t') || '').toLowerCase();
  let timer = null;

  function vacio(ic, titulo, txt) {
    $('#app').innerHTML = `<div class="card vacio"><div style="font-size:2.4rem">${ic}</div><h2 style="font-size:1rem;color:var(--texto);text-transform:none;letter-spacing:0">${esc(titulo)}</h2><p class="nota">${esc(txt)}</p></div>`;
  }

  function pintar(s) {
    const fin = s.estado === 'FINALIZADA';
    const hechas = {}; (s.etapas || []).forEach((x) => { if (!hechas[x.e]) hechas[x.e] = x.t; });
    const actual = fin ? 'FINALIZADA' : (s.etapa || 'PROGRAMADA');
    const iAct = ETAPAS.findIndex((e) => e[0] === actual);
    const r = s.reporte || null;
    let h = `<div class="card"><div class="estado"><span class="ic">${fin ? '✅' : (ETAPAS[iAct] || ETAPAS[0])[2]}</span>
      <div>${fin ? 'Servicio finalizado' : esc((ETAPAS[iAct] || ETAPAS[0])[1])}<br>
      <span class="chip ${fin ? 'fin' : 'curso'}">${fin ? 'Reporte de trabajo disponible' : 'En curso · se actualiza solo'}</span>
      ${s.clase === 'URGENTE' ? ' <span class="chip urg">🚨 Urgente</span>' : ''}</div></div></div>`;
    h += `<div class="card"><h2>Datos del servicio</h2>
      ${s.cliente_nombre ? `<div class="dato"><b>👤 Cliente</b><span>${esc(s.cliente_nombre)}</span></div>` : ''}
      ${s.equipo_txt ? `<div class="dato"><b>⚡ Equipo</b><span>${esc(s.equipo_txt)}</span></div>` : ''}
      ${s.serie ? `<div class="dato"><b>🔢 Serie</b><span>${esc(s.serie)}</span></div>` : ''}
      ${s.tipo_mant ? `<div class="dato"><b>🛠️ Servicio</b><span>${esc(s.tipo_mant)}${s.clase ? ' · ' + esc(CLASE[s.clase] || s.clase) : ''}</span></div>` : ''}
      ${s.tecnico ? `<div class="dato"><b>👷 Técnico</b><span>${esc(s.tecnico)}</span></div>` : ''}
      ${s.numero_ot ? `<div class="dato"><b>📋 Orden N°</b><span>${esc(s.numero_ot)}</span></div>` : ''}</div>`;
    h += `<div class="card"><h2>Estado del servicio</h2><ul class="linea">` + ETAPAS.map((e, i) => {
      const t = hechas[e[0]] || (e[0] === 'FINALIZADA' && fin ? (s.cerrado || '') : '');
      const cls = (e[0] === actual) ? 'actual' : (t || i < iAct ? 'hecho' : 'pend');
      return `<li class="${cls}"><span class="p">${e[2]}</span><div><div class="t">${esc(e[1])}</div><div class="h">${t ? esc(hora(t)) : (cls === 'pend' ? 'Pendiente' : '')}</div></div></li>`;
    }).join('') + `</ul></div>`;
    const av = s.avances || [];
    if (av.length) {
      h += `<div class="card"><h2>Novedades informadas por el técnico</h2>` + av.map((a) => `<div class="av"><small>${esc(hora(a.t))}${a.n ? ' · 📎 ' + a.n + ' adjunto(s) enviados por WhatsApp' : ''}</small>${esc(a.texto || '(fotos o video enviados por WhatsApp)')}</div>`).join('') +
        `<p class="nota">⚠️ Información preliminar durante el servicio; prevalece el reporte final.</p></div>`;
    }
    if (fin && r) {
      h += `<div class="card"><h2>Reporte del trabajo realizado</h2>
        ${r.fecha ? `<div class="dato"><b>📅 Fecha</b><span>${esc(fecha(r.fecha))}</span></div>` : ''}
        ${r.tipo ? `<div class="dato"><b>🛠️ Tipo</b><span>${esc(r.tipo)}</span></div>` : ''}
        ${r.horas != null && r.horas !== '' ? `<div class="dato"><b>⏱️ Horas máquina</b><span>${esc(r.horas)}</span></div>` : ''}
        ${(r.actividades || []).length ? `<h2 style="margin-top:12px">🧰 Actividades realizadas</h2><ul class="acts">` + r.actividades.map((a) =>
          `<li class="${a.n === 'sub' ? 's' : 'r'}">${a.n === 'sub' ? '✔️ ' : (a.n === 'adicional' ? '➕ ' : '▪️ ')}${esc(a.d)}</li>`).join('') + `</ul>` : ''}
        ${r.observaciones ? `<h2 style="margin-top:12px">📝 Trabajo / observaciones</h2><p style="margin:0;font-size:.92rem;white-space:pre-wrap">${esc(r.observaciones)}</p>` : ''}
        ${r.ubicacion ? `<p style="margin:10px 0 0;font-size:.88rem">📍 <a href="${esc(r.ubicacion)}" target="_blank" rel="noopener">Ubicación del servicio</a></p>` : ''}
        </div>`;
      if ((r.fotos || []).length) h += `<div class="card"><h2>📷 Evidencia fotográfica</h2><div class="fotos">` + r.fotos.map((f) => `<img src="${esc(f)}" alt="Foto del servicio">`).join('') + `</div></div>`;
      if (r.firma) h += `<div class="card"><h2>✍️ Conformidad del cliente</h2><img class="firma" src="${esc(r.firma)}" alt="Firma del cliente"></div>`;
      h += `<div class="card noprint"><button class="btn" id="btn-pdf">🖨️ Guardar / imprimir PDF</button>
        <p class="nota" style="margin:8px 0 0">Constancia disponible hasta el ${esc(fecha((s.expira || '').slice(0, 10)))}.</p></div>`;
    } else if (fin) {
      h += `<div class="card"><p class="nota" style="margin:0">El servicio finalizó. El reporte del trabajo realizado se publica aquí en cuanto el técnico lo envíe.</p></div>`;
    }
    h += `<p class="nota noprint" style="text-align:center">Actualizado: ${esc(hora(s.actualizado))}</p>`;
    $('#app').innerHTML = h;
    const b = $('#btn-pdf'); if (b) b.onclick = () => window.print();
    document.title = (s.numero_ot ? 'OT ' + s.numero_ot + ' · ' : '') + 'Seguimiento PROSOL';
    clearTimeout(timer);
    if (!fin || !r) timer = setTimeout(cargar, 30000);
  }

  async function cargar() {
    if (!/^[0-9a-f]{32}$/.test(token)) { vacio('🔗', 'Enlace incompleto', 'Abra el enlace tal como lo recibió por WhatsApp.'); return; }
    try {
      const r = await fetch(FN + token, { cache: 'no-store' });
      if (r.status === 404) { vacio('⏳', 'Seguimiento aún no disponible', 'El técnico todavía no ha registrado avances. Vuelva a intentar en unos minutos.'); clearTimeout(timer); timer = setTimeout(cargar, 30000); return; }
      if (r.status === 410) { vacio('📁', 'Enlace vencido', 'Este seguimiento estuvo disponible hasta 30 días después del cierre. Solicite su reporte a PROSOL.'); return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      pintar(await r.json());
    } catch (e) {
      vacio('📶', 'Sin conexión', 'No se pudo consultar el estado. Se reintentará en 30 segundos.');
      clearTimeout(timer); timer = setTimeout(cargar, 30000);
    }
  }
  window.__seguimientoRecargar = cargar;
  cargar();
})();
