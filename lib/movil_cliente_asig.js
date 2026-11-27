/* PROSOL Campo · lib/movil_cliente_asig.js (v4.05.1) — corrección del celular aprobada por Luis 27/11 05:20.
   A · «📲 Avisar esta etapa por WhatsApp»: el primer botón es «Enviar al cliente (nombre · número)», que abre
       directamente el chat del cliente con el aviso y el enlace de seguimiento. Número: contacto que confirmó la
       cita → contacto del equipo → teléfono del cliente. El cliente queda marcado también en la lista rápida.
   B · Técnico asignado: el celular usa la asignación hecha en el escritorio o la web. Antes la lista local solo se
       actualizaba al entrar a «Hoy», y el calendario mostraba «— sin asignar —»; ahora se actualiza también al
       descargar el catálogo y al abrir el calendario, y si falta se completa con el técnico de la programación.
   Módulo fuera del IIFE base. */
(() => {
  const E = () => window._prosolEstado;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const numWA = (tel) => { let d = String(tel || '').replace(/\D/g, ''); if (d.startsWith('593')) return d; if (d.startsWith('0')) d = d.slice(1); return d.length >= 8 ? '593' + d : ''; };

  // ── B · técnico asignado ───────────────────────────────────────────
  function completar() {
    const e = E(); if (!e) return;
    e.asig = e.asig || {};
    ((e.catalogo && e.catalogo.programaciones) || []).forEach((p) => {
      const k = 'PROG:' + (p.ID_VISITA || p.ID_SB);
      if (p.TECNICO_ASIGNADO && !(e.asig[k] && e.asig[k].tecnico)) e.asig[k] = { tecnico: p.TECNICO_ASIGNADO, por: 'programación', ts: '' };
    });
  }
  let ts = 0, busy = false;
  async function refrescar(forzar) {
    const e = E(); if (!e || busy) return false;
    if (!forzar && Date.now() - ts < 15000) { completar(); return false; }
    busy = true; const antes = JSON.stringify(e.asig || {});
    try {
      const sesion = !API.sesionNube || API.sesionNube();
      if (typeof API !== 'undefined' && API.hayNube() && navigator.onLine !== false && sesion) {
        const f = await API.select('visitas_asignacion');
        if (Array.isArray(f)) {
          const m = {}; f.forEach((r) => { m[r.clave] = { tecnico: r.tecnico || '', por: r.asignado_por || '', ts: r.actualizado || '', id_sb: r.id }; });
          e.asig = m; ts = Date.now();
        }
      }
    } catch (x) { /* sin red: se usa lo guardado */ } finally { busy = false; }
    completar();
    return antes !== JSON.stringify(e.asig);
  }
  const tecnicoDe = (idVisita) => { const e = E() || {}; const a = (e.asig || {})['PROG:' + idVisita]; return a && a.tecnico ? a.tecnico : ''; };

  // ── A · aviso de etapa: primero el cliente ─────────────────────────
  function telCliente(it) {
    const e = E() || {}, cat = e.catalogo || {};
    const p = it.p || {}, eq = it.e || (cat.equipos || []).find((x) => x.SERIE === it.serie) || {};
    const idCli = p.ID_CLIENTE || eq.ID_CLIENTE || (it.s && it.s.id_cliente);
    const cli = (cat.clientes || []).find((c) => c.ID_CLIENTE === idCli || c.ID_SB === idCli || c.ID === idCli) || {};
    const cands = [[p.CONTACTO_CITA, p.TELEFONO_CITA], [eq.CONTACTO, eq.CONTACTO_TEL], [cli.RAZON_SOCIAL || it.cliente, eq.CLIENTE_TEL || cli.TELEFONO]];
    for (const [nom, tel] of cands) { const n = numWA(tel); if (n) return { nombre: nom || it.cliente || 'Cliente', tel: n }; }
    return null;
  }
  function alAbrirDestinos() {
    const e = E(); if (!e) return;
    const o = e._dest, cuerpo = document.getElementById('dest-cuerpo');
    if (!o || !o.reg || o.reg.tipo !== 'ETAPA' || !cuerpo || cuerpo.querySelector('#dest-al-cliente')) return;
    const c = telCliente(e._segIt || {});
    const div = document.createElement('div');
    div.innerHTML = c
      ? `<button class="btn btn-primary btn-block" id="dest-al-cliente">📲 Enviar al cliente: ${esc(c.nombre)} · +${c.tel}</button>
         <p class="hint" style="margin:6px 0 8px">Abre el chat del cliente con el aviso y el enlace de seguimiento.</p>`
      : `<p class="hint" id="dest-al-cliente" style="margin:0 0 8px">⚠ El cliente no tiene número registrado: elige el contacto en WhatsApp o escríbelo en «Lista rápida».</p>`;
    cuerpo.insertBefore(div, cuerpo.firstChild);
    const libre = document.getElementById('dest-wa-libre');
    if (libre && c) { libre.classList.remove('btn-primary'); libre.classList.add('btn-ghost'); }
    const chk = document.getElementById('dest-cli'); if (chk) chk.checked = true;
    const tin = document.getElementById('dest-cli-tel'); if (tin && c && !tin.value) tin.value = c.tel;
    const b = document.getElementById('dest-al-cliente');
    if (c && b && b.tagName === 'BUTTON') b.onclick = () => {
      const url = 'https://wa.me/' + c.tel + '?text=' + encodeURIComponent(o._textoSolo || o.texto || '');
      // se reutiliza el botón base para que el envío quede registrado igual que siempre (constancia del aviso)
      const orig = window.open;
      window.open = () => orig.call(window, url, '_blank');
      try { if (libre) libre.click(); else orig.call(window, url, '_blank'); } finally { window.open = orig; }
    };
  }
  function vigilar() {
    const cuerpo = document.getElementById('dest-cuerpo');
    if (!cuerpo) return;
    new MutationObserver(() => alAbrirDestinos()).observe(cuerpo, { childList: true });
  }
  function iniciar() {
    vigilar(); completar();
    setTimeout(() => refrescar(true), 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  window.PROSOL_ASIG = { completar, refrescar, tecnicoDe, telCliente };
})();
