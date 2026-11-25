/* lib/agenda.js · PROSOL v3.68 — Agenda programada (calendario) compartida por la web PC y el celular.
   Mismo modelo que el escritorio: encabezado del mes, días 1..N en columnas (número + día de la semana) y, bajo cada
   día, los clientes citados ordenados por hora. Días hábiles sin citas resaltados (captar clientes). Clic en un
   cliente → detalle de la cita. Solo lectura: las citas se registran en el escritorio.
   Cita normalizada: { id, fecha:'AAAA-MM-DD', hora, cliente, codCliente, serie, equipo, lugar, tipo, novedades,
   contactoCita, telefonoCita, contactoEquipo, telefonoEquipo, atendida, ot, ultimo, tecnico, registro } */
const AGENDA = (() => {
  const MESES = ['', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p2 = n => String(n).padStart(2, '0');
  const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  let _css = false;
  function css() {
    if (_css) return; _css = true;
    const s = document.createElement('style');
    s.textContent = `.ag-wrap{font-family:inherit}.ag-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 0 6px}
.ag-bar b{font-size:15px;min-width:130px;text-align:center}.ag-bar button{border:1px solid #2471A3;background:#2471A3;color:#fff;border-radius:6px;padding:5px 10px;font-size:13px;cursor:pointer}
.ag-res{font-size:12px;color:#1B2631;margin-left:auto}.ag-ley{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#444;margin:2px 0 6px}
.ag-ley i{display:inline-block;width:12px;height:12px;border:1px solid #999;vertical-align:-2px;margin-right:4px}
.ag-scroll{overflow-x:auto;border:1px solid #D5D8DC;border-radius:8px;background:#fff;-webkit-overflow-scrolling:touch}
.ag-grid{display:grid;grid-auto-flow:column;grid-auto-columns:150px;align-items:start}
.ag-mes{background:#1B2631;color:#fff;font-weight:700;font-size:12px;padding:4px 6px;height:16px;white-space:nowrap}
.ag-dia{border-right:1px solid #E5E8E8;min-height:170px;padding:4px}.ag-dia.vacio{background:#FCF3CF}.ag-dia.hoy{outline:2px solid #E67E22;outline-offset:-2px}
.ag-num{font-size:18px;font-weight:700;text-align:center;color:#1B2631}.ag-sem{font-size:12px;font-weight:700;text-align:center;color:#1B2631}
.ag-cnt{font-size:11px;text-align:center;color:#555;margin-bottom:4px}.ag-dia.pasado .ag-num,.ag-dia.pasado .ag-sem{color:#909497}
.ag-dia.vacio .ag-num,.ag-dia.vacio .ag-sem,.ag-dia.vacio .ag-cnt{color:#7D6608}
.ag-cita{display:block;width:100%;text-align:left;border:1px solid #85C1E9;background:#D6EAF8;color:#1B4F72;border-radius:5px;padding:3px 5px;margin:3px 0;font-size:11px;line-height:1.25;cursor:pointer}
.ag-cita.at{background:#D5F5E3;border-color:#82E0AA;color:#145A32}.ag-cita b{font-size:11px}
.ag-det td{padding:3px 6px;vertical-align:top;font-size:13px}.ag-det td:first-child{color:#566573;white-space:nowrap;font-weight:600}
.ag-est{display:inline-block;padding:2px 8px;border-radius:5px;font-size:12px;font-weight:700;background:#D6EAF8;color:#1B4F72}.ag-est.at{background:#D5F5E3;color:#145A32}`;
    document.head.appendChild(s);
  }

  /** Pinta el calendario en `cont`. citas: lista normalizada. op: { onCita(cita), anio, mes } */
  function render(cont, citas, op) {
    css(); op = op || {};
    const h = new Date();
    let anio = op.anio || h.getFullYear(), mes = op.mes || (h.getMonth() + 1);
    const pintar = () => {
      const n = new Date(anio, mes, 0).getDate(), hoy = hoyISO();
      const pref = anio + '-' + p2(mes) + '-';
      const delMes = citas.filter(c => (c.fecha || '').slice(0, 8) === pref);
      const porDia = {};
      delMes.forEach(c => (porDia[c.fecha.slice(0, 10)] = porDia[c.fecha.slice(0, 10)] || []).push(c));
      Object.values(porDia).forEach(l => l.sort((a, b) => (a.hora || '99:99').localeCompare(b.hora || '99:99') || String(a.cliente).localeCompare(String(b.cliente))));
      let vacios = 0, cols = '';
      for (let d = 1; d <= n; d++) {
        const f = pref + p2(d), wd = new Date(anio, mes - 1, d).getDay(), lista = porDia[f] || [];
        const habil = wd >= 1 && wd <= 5, vacio = habil && !lista.length && f >= hoy;
        if (vacio) vacios++;
        const cls = ['ag-dia', vacio ? 'vacio' : '', f === hoy ? 'hoy' : '', f < hoy ? 'pasado' : ''].join(' ');
        const cnt = lista.length ? lista.length + (lista.length === 1 ? ' cita' : ' citas') : (vacio ? 'sin citas · captar' : '—');
        cols += `<div><div class="ag-mes">${d === 1 || wd === 1 ? MESES[mes] + ' ' + anio : ''}</div>
          <div class="${cls}" data-dia="${f}"><div class="ag-num">${d}</div><div class="ag-sem">${DIAS[wd]}${f === hoy ? ' · HOY' : ''}</div>
          <div class="ag-cnt">${cnt}</div>${lista.map(c => `<button class="ag-cita${c.atendida ? ' at' : ''}" data-cid="${E(c.id)}">
          <b>${E(c.hora || '—:—')}</b> ${E(String(c.cliente || '').slice(0, 24))}<br>${E(c.serie || '')} · ${E(String(c.tipo || '').slice(0, 16))}</button>`).join('')}</div></div>`;
      }
      const at = delMes.filter(c => c.atendida).length;
      cont.innerHTML = `<div class="ag-wrap"><div class="ag-bar"><button data-ag="-1" aria-label="Mes anterior">◀</button>
        <b>${MESES[mes].charAt(0) + MESES[mes].slice(1).toLowerCase()} ${anio}</b><button data-ag="1" aria-label="Mes siguiente">▶</button>
        <button data-ag="hoy">Hoy</button>
        <span class="ag-res">Mes: ${delMes.length} cita${delMes.length === 1 ? '' : 's'} · ${at} atendida${at === 1 ? '' : 's'} · ${vacios} día${vacios === 1 ? '' : 's'} hábil${vacios === 1 ? '' : 'es'} sin citas</span></div>
        <div class="ag-ley"><span><i style="background:#D6EAF8"></i>Cita programada</span><span><i style="background:#D5F5E3"></i>Atendida (OT del día)</span>
        <span><i style="background:#FCF3CF"></i>Día hábil sin citas: captar clientes</span></div>
        <div class="ag-scroll"><div class="ag-grid">${cols}</div></div></div>`;
      cont.querySelectorAll('[data-ag]').forEach(b => b.onclick = () => {
        const v = b.dataset.ag;
        if (v === 'hoy') { anio = h.getFullYear(); mes = h.getMonth() + 1; }
        else { mes += Number(v); if (mes < 1) { mes = 12; anio--; } if (mes > 12) { mes = 1; anio++; } }
        pintar();
      });
      cont.querySelectorAll('[data-cid]').forEach(b => b.onclick = () => {
        const c = delMes.find(x => String(x.id) === b.dataset.cid); if (c && op.onCita) op.onCita(c);
      });
      // v3.90: siempre abre mostrando HOY (también si la vista aún no estaba dibujada al pintar)
      const irHoy = () => { const sc = cont.querySelector('.ag-scroll'), dh = cont.querySelector('[data-dia="' + hoy + '"]');
        if (sc && dh && sc.clientWidth) sc.scrollLeft = Math.max(0, sc.scrollLeft + dh.getBoundingClientRect().left - sc.getBoundingClientRect().left - 8); };
      irHoy(); requestAnimationFrame(irHoy); setTimeout(irHoy, 200);
    };
    pintar();
    return { ir: (a, m) => { anio = a; mes = m; pintar(); } };
  }

  /** HTML del detalle de una cita. */
  function detalleHTML(c) {
    const f = new Date((c.fecha || '').slice(0, 10) + 'T12:00:00');
    const fh = isNaN(f) ? (c.fecha || '') : DIAS[f.getDay()] + ' ' + p2(f.getDate()) + '-' + p2(f.getMonth() + 1) + '-' + f.getFullYear();
    const j = (...xs) => xs.filter(x => x != null && String(x).trim() !== '').map(E).join(' · ');
    const fila = (k, v) => `<tr><td>${k}</td><td>${v || '—'}</td></tr>`;
    return `<h3 style="margin:0 0 4px">Cita · ${E(fh)} · ${E(c.hora || 'hora por confirmar')}</h3>
      <span class="ag-est${c.atendida ? ' at' : ''}">${c.atendida ? 'ATENDIDA' + (c.ot ? ' (OT ' + E(c.ot) + ')' : '') : 'PROGRAMADA'}</span>
      <table class="ag-det" style="margin-top:8px;border-collapse:collapse">
      ${fila('Cliente', j(c.cliente, c.codCliente))}
      ${fila('Contacto que confirmó', j(c.contactoCita, c.telefonoCita))}
      ${fila('Contacto del equipo', j(c.contactoEquipo, c.telefonoEquipo))}
      ${fila('Equipo', j(c.serie, c.equipo))}
      ${fila('Lugar', E(c.lugar))}
      ${fila('Mantenimiento', E(c.tipo))}
      ${fila('Novedades', E(c.novedades).replace(/\n/g, '<br>'))}
      ${fila('Último servicio', c.ultimo ? j('OT ' + (c.ultimo.numero || ''), c.ultimo.fecha, c.ultimo.tipo) : 'sin OT anteriores')}
      ${fila('Técnico asignado (app)', E(c.tecnico || '— sin asignar —'))}
      ${fila('Registró', E(c.registro))}</table>`;
  }

  /** Último servicio y OT del día a partir de una lista de OT {serie, fecha, numero, tipo}. */
  function completar(citas, ots) {
    const porSerie = {};
    (ots || []).forEach(o => { if (o.serie) (porSerie[o.serie] = porSerie[o.serie] || []).push(o); });
    citas.forEach(c => {
      const l = porSerie[c.serie] || [], f = (c.fecha || '').slice(0, 10);
      const delDia = l.find(o => (o.fecha || '').slice(0, 10) === f);
      if (delDia) { c.atendida = true; c.ot = c.ot || delDia.numero; }
      const prev = l.filter(o => (o.fecha || '').slice(0, 10) < f).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
      if (prev && !c.ultimo) c.ultimo = { numero: prev.numero, fecha: (prev.fecha || '').slice(0, 10), tipo: prev.tipo };
    });
    return citas;
  }

  return { render, detalleHTML, completar, hoyISO };
})();
if (typeof window !== 'undefined') window.AGENDA = AGENDA;
