/* PROSOL Campo · lib/seg_cerrada.js (v3.99.2)
   Hoja «Seguimiento» del celular:
   · Visita/OT CERRADA (etapa «Finalizada», OT ya guardada o visita atendida = mismo criterio del escritorio y la web):
     queda en SOLO CONSULTA. Se ocultan «Avance parcial», «Agregar foto o video», «Informar avance parcial» y
     «Llenar la orden (OT)», y no se cambia la etapa. Solo el administrador corrige, desde la oficina, con justificación.
     Se mantienen el aviso por WhatsApp y el registro de la visita.
   · Visita ABIERTA: además de la galería, «📷 Tomar foto» y «🎥 Grabar video» abren la cámara del celular.
   Módulo fuera del IIFE base. */
const SEG_CERRADA = (() => {
  const est = () => window._prosolEstado || {};
  const $ = (s) => document.querySelector(s);
  function cerrada(it) {
    if (!it) return false;
    if (it.ot || it.k === 'OT') return true;
    const sg = (est().seguim || {})[it.k + ':' + it.id];
    if (sg && (String(sg.etapa || '').toUpperCase() === 'FINALIZADA' || sg.numero_ot)) return true;
    const p = it.p;
    if (p) {
      if (['EJECUTADA', 'REALIZADA'].includes(String(p.ESTADO || '').toUpperCase())) return true;
      if (window.PROG_ATENDIDAS && PROG_ATENDIDAS.atencion(p.SERIE, String(p.FECHA_PROGRAMADA || '').slice(0, 10))) return true;
    }
    return false;
  }
  const EDIT = ['#seg-texto', '#seg-archivos-info', '#seg-informar', '#seg-atender', '#seg-camara'];
  function editables() {
    const out = EDIT.map((s) => $(s)).filter(Boolean);
    const lab = $('#seg-archivos') && $('#seg-archivos').closest('label'); if (lab) out.push(lab);
    const vis = $('#seg-visible') && $('#seg-visible').closest('label'); if (vis) out.push(vis);
    const t = $('#seg-texto'); const fl = t && t.previousElementSibling; if (fl && fl.classList.contains('field-label')) out.push(fl);
    return out;
  }
  function camara() {
    if ($('#seg-camara')) return;
    const lab = $('#seg-archivos') && $('#seg-archivos').closest('label'); if (!lab) return;
    const n = [...lab.childNodes].find((x) => x.nodeType === 3 && x.textContent.trim());
    if (n) n.textContent = '🖼 Galería (fotos o videos) ';
    const box = document.createElement('div');
    box.id = 'seg-camara'; box.style.cssText = 'display:flex;gap:8px;margin-top:8px';
    box.innerHTML = '<label class="btn btn-ghost" style="flex:1">📷 Tomar foto<input id="seg-cam-foto" type="file" accept="image/*" capture="environment" hidden></label>'
      + '<label class="btn btn-ghost" style="flex:1">🎥 Grabar video<input id="seg-cam-video" type="file" accept="video/*" capture="environment" hidden></label>';
    lab.parentNode.insertBefore(box, lab);
    box.querySelectorAll('input').forEach((inp) => inp.onchange = (e) => {
      const E = est();
      E._segFiles = (E._segFiles || []).concat(Array.from(e.target.files)); e.target.value = '';
      const info = $('#seg-archivos-info'); if (info) info.textContent = E._segFiles.length + ' archivo(s) listo(s) para compartir.';
    });
  }
  function aplicar() {
    const sh = $('#sheet-seg'); if (!sh || sh.hidden) return;
    camara();
    const it = est()._segIt, c = cerrada(it);
    editables().forEach((el) => { el.style.display = c ? 'none' : ''; });
    if (!c && $('#seg-atender') && (it && (it.ot || it.k === 'OT'))) $('#seg-atender').style.display = 'none';
    document.querySelectorAll('#seg-etapas .seg-et').forEach((b) => {
      if (c) { b.disabled = true; b.onclick = null; b.style.pointerEvents = 'none'; }
    });
    let av = $('#seg-cerrada-aviso');
    if (c) {
      if (!av) {
        av = document.createElement('div'); av.id = 'seg-cerrada-aviso';
        av.style.cssText = 'background:#eafaf1;border-left:4px solid #1e8449;border-radius:8px;padding:8px 10px;margin:8px 0;color:#145a32;font-size:14px';
        const et = $('#seg-etapas'); if (et) et.parentNode.insertBefore(av, et.nextSibling);
      }
      const T = '✅ Orden cerrada: solo consulta. Cualquier cambio lo hace el administrador desde la oficina, con justificación.';
      if (av.textContent !== T) av.textContent = T;
      if (av.style.display) av.style.display = '';
    } else if (av) av.style.display = 'none';
  }
  function vigilar() {
    const sh = $('#sheet-seg');
    if (!sh) return setTimeout(vigilar, 1000);
    new MutationObserver(() => aplicar()).observe(sh, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
    aplicar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vigilar); else vigilar();
  return { cerrada, aplicar };
})();
window.SEG_CERRADA = SEG_CERRADA;
