/* prosol_web.js — PROSOL WEB PC v3.0
   Se activa solo cuando window.innerWidth >= 700px.
   La app móvil v16 (app.js) sigue intacta para < 700px.
*/
const PROSOL_WEB = (() => {
'use strict';

const $id = id => document.getElementById(id);
const ESC = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let _vista = 'dashboard';
let _waFiltrarOrd, _waGenerar, _cargarActsCatalogo, _irConfig, _reenviarComm;

/* ── Utilidades ─────────────────────────────────────────────────────── */
function toast(msg) {
  let t = $id('_toast_web');
  if (!t) {
    t = document.createElement('div'); t.id = '_toast_web';
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1C2733;color:#fff;padding:10px 20px;border-radius:999px;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:9998;white-space:nowrap';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._t); t._t = setTimeout(() => { t.style.opacity = '0'; }, 2800);
}

function modal(html) {
  let m = $id('_modal_web');
  if (!m) {
    m = document.createElement('div'); m.id = '_modal_web';
    m.className = 'modal-web oculto';
    m.innerHTML = '<div class="modal-web-box" id="_modal_box"></div>';
    document.body.appendChild(m);
  }
  $id('_modal_box').innerHTML = html;
  m.classList.remove('oculto');
}
function cerrarModal() { const m = $id('_modal_web'); if(m) m.classList.add('oculto'); }

function tabla(cols, filas) {
  return '<div class="tbl-wrap"><table><thead><tr>' +
    cols.map(c=>'<th>'+c+'</th>').join('') + '</tr></thead><tbody>' +
    (filas.length
      ? filas.map(f=>'<tr>'+f.map(c=>'<td>'+(c==null?'':c)+'</td>').join('')+'</tr>').join('')
      : '<tr><td colspan="'+cols.length+'" style="text-align:center;color:#888;padding:16px">Sin registros.</td></tr>')
    + '</tbody></table></div>';
}

/* ── Supabase config panel ──────────────────────────────────────────── */
function initConfigPanel() {
  const guardar = $id('sb-guardar-btn');
  const probar  = $id('sb-probar-btn');
  const cerrar  = $id('sb-cerrar-btn');
  if (guardar) guardar.addEventListener('click', () => {
    const url = ($id('sb-url-inp').value||'').trim().replace(/\/+$/,'');
    const key = ($id('sb-key-inp').value||'').trim();
    API.configurar(url, key);
    const m = $id('sb-cfg-msg');
    if(m) m.textContent = API.hayNube() ? '✅ Guardado correctamente.' : '⚠ Completa los dos campos.';
    toast('Credenciales Supabase guardadas');
  });
  if (probar) probar.addEventListener('click', async () => {
    const m = $id('sb-cfg-msg'); if(m) m.textContent = '⏳ Probando...';
    try {
      await API.probarNube();
      if(m) m.textContent = '✅ Conexión OK con Supabase';
      toast('✅ Conexión OK');
    } catch(e) {
      if(m) m.textContent = '❌ ' + e.message;
    }
  });
  if (cerrar) cerrar.addEventListener('click', () => {
    const p = $id('supabase-cfg-panel'); if(p) p.style.display = 'none';
  });
}

function abrirConfigPanel() {
  const p = $id('supabase-cfg-panel');
  if (p) p.style.display = 'flex';
}

/* ── Login web PC ───────────────────────────────────────────────────── */
function mostrarLogin() {
  // Ocultar elementos móviles (el CSS media query también lo hace, esto es seguridad extra)
  const sb = $id('syncbar'); const ap = $id('app');
  if(sb) sb.style.display='none'; if(ap) ap.style.display='none';

  const div = document.createElement('div'); div.id = 'loginWebPC';
  div.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1C2733 0%,#0C1A26 100%);z-index:100';
  div.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:32px 28px;width:92%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.5)">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:48px">⚡</div>
        <div style="font-size:2rem;font-weight:900;color:#1C2733;margin-top:4px">PROSOL</div>
        <div style="font-size:.85rem;color:#5A6B7B;margin-top:4px;line-height:1.4">Sistema de Mantenimiento<br>de Generadores Generac</div>
      </div>
      <label style="display:block;font-size:.82rem;font-weight:700;color:#1C2733;margin-bottom:4px">Usuario</label>
      <input id="wl_user" style="width:100%;padding:11px 14px;border:1.5px solid #D5DBE1;border-radius:10px;font-size:.95rem;box-sizing:border-box;margin-bottom:10px" value="admin">
      <label style="display:block;font-size:.82rem;font-weight:700;color:#1C2733;margin-bottom:4px">Contraseña</label>
      <input id="wl_pass" type="password" style="width:100%;padding:11px 14px;border:1.5px solid #D5DBE1;border-radius:10px;font-size:.95rem;box-sizing:border-box" value="admin">
      <p id="wl_msg" style="color:#E74C3C;font-size:.82rem;text-align:center;margin:8px 0 0;min-height:18px"></p>
      <button id="wl_btn" style="width:100%;padding:12px;background:#F5A623;color:#1C2733;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;margin-top:10px">
        Ingresar al sistema</button>
      <button id="wl_cfg" style="width:100%;padding:9px;background:#F1F4F7;color:#1C2733;border:none;border-radius:8px;font-size:.85rem;cursor:pointer;margin-top:8px">
        ⚙ Configurar conexión Supabase</button>
      <div style="text-align:center;margin-top:16px;font-size:.74rem;color:#8899AA;line-height:1.7">
        ROCKENSY S.A. &amp; MIG<br>
        Tec. Master Luis Martinez Ibáñez · Cel: 096 701 5684<br>
        <strong>Versión PROSOL v4.05</strong>
      </div>
    </div>`;
  document.body.appendChild(div);

  // Cargar credenciales guardadas en los campos del panel
  const info = API.infoNube ? API.infoNube() : {};
  if (info && info.url && $id('sb-url-inp')) $id('sb-url-inp').value = info.url;

  // Pre-llenar el panel de config con la URL conocida
  const sbUrlInp = $id('sb-url-inp');
  const sbKeyInp = $id('sb-key-inp');
  if (sbUrlInp) sbUrlInp.value = API.infoNube ? (API.infoNube().url||'').replace('…','') || 'https://nildkoxrgbdqzrunqogz.supabase.co' : 'https://nildkoxrgbdqzrunqogz.supabase.co';

  // Si no hay KEY guardada, mostrar el panel de config automáticamente
  if (!API.hayNube()) {
    const m = $id('wl_msg');
    if (m) m.textContent = 'ℹ Ingresa tu anon key de Supabase para conectar.';
    // Abrir panel Supabase automáticamente
    setTimeout(() => {
      const p = $id('supabase-cfg-panel');
      if (p) p.style.display = 'flex';
    }, 300);
  }

  // Event listeners — sin onclick en el HTML
  $id('wl_btn').addEventListener('click', doLogin);
  $id('wl_pass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  $id('wl_cfg').addEventListener('click', abrirConfigPanel);
}

async function doLogin() {
  const user = ($id('wl_user').value||'').trim();
  const pass = $id('wl_pass').value||'';
  const msg  = $id('wl_msg');
  if(msg) msg.textContent = '';
  const _adm = !!window._prosolAdminMovil;
  if (_adm && !API.hayNube()) { if(msg) msg.textContent = '⚠ Conecta Supabase (⚙) para el acceso administrador.'; return; }
  const _noAdmin = (ses) => { if (_adm && String(ses.perfil||'').toUpperCase() !== 'ADMIN') { if(msg) msg.textContent = 'Solo el administrador puede usar este acceso.'; try{AUTH.logout();}catch(x){} return true; } return false; };

  function quitarLogin() {
    const lv = $id('loginWebPC'); if(lv) lv.remove();
  }

  // Sin Supabase: advertir pero permitir entrar (modo local)
  if (!API.hayNube()) {
    if(msg) msg.textContent = '⚠ Sin Supabase — entrando en modo local.';
    // Mostrar panel para que pueda configurar, pero no bloquear el acceso
    abrirConfigPanel();
    // Entrar igual como admin local después de 800ms si no configura
    setTimeout(() => {
      if (!API.hayNube()) {
        const lv = $id('loginWebPC'); if(lv) lv.remove();
        const p = $id('supabase-cfg-panel'); if(p) p.style.display = 'none';
        arrancarApp({ USUARIO: user || 'admin', ROL: 'ADMIN', NOMBRE: user || 'Administrador' });
      }
    }, 800);
    return;
  }
  // Con Supabase: intentar login normal
  try {
    if(msg) msg.textContent = '⏳ Verificando...';
    await AUTH.asegurarAdmin().catch(()=>{});
    const sesion = await AUTH.login(user, pass);
    if (_noAdmin(sesion)) return;
    quitarLogin();
    arrancarApp(sesion);
  } catch(e) {
    // Si auth falla pero Supabase responde, entrar como admin local
    if(msg) msg.textContent = '⏳ Accediendo...';
    try {
      await AUTH.asegurarAdmin();
      const sesion = await AUTH.login(user, pass);
      if (_noAdmin(sesion)) return;
      quitarLogin();
      arrancarApp(sesion);
    } catch(e2) {
      if(msg) msg.textContent = e2.message || 'Usuario o contraseña incorrectos.';
    }
  }
}

/* ── Arrancar app web PC ────────────────────────────────────────────── */
function arrancarApp(sesion) {
  $id('appView').style.display = 'block';

  // Si no hay KEY de Supabase, redirigir automáticamente a Configuración
  if (!API.hayNube()) {
    const aviso = document.createElement('div');
    aviso.id = 'aviso-sin-key';
    aviso.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#FFF3CD;border:2px solid #F5A623;border-radius:12px;padding:14px 20px;z-index:500;font-size:13px;text-align:center;max-width:420px;box-shadow:0 4px 12px rgba(0,0,0,.15)';
    aviso.innerHTML = '<b>⚠ Sin conexión a Supabase</b><br>Ve a <b>Configuración</b> e ingresa tu <b>anon key</b> para ver los datos.<br><br>' +
      '<button onclick="PROSOL_WEB.irConfig()" ' +
      'style="padding:8px 18px;background:#F5A623;color:#1C2733;border:none;border-radius:8px;font-weight:700;cursor:pointer">⚙ Ir a Configuración</button>';
    document.body.appendChild(aviso);
    // Auto-ocultar después de 10 seg
    setTimeout(() => { const a = document.getElementById('aviso-sin-key'); if(a) a.remove(); }, 10000);
  }

  // Red
  const netEl = $id('netStatus');
  const setNet = () => { if(netEl) netEl.className='net-dot '+(navigator.onLine?'online':'offline'); };
  window.addEventListener('online',setNet); window.addEventListener('offline',setNet); setNet();

  // Usuario
  const ub = $id('userBadge');
  if(ub) ub.textContent = (sesion.nombre||sesion.usuario||'Admin')+' · '+(sesion.perfil||'ADMIN');

  if($id('footerVersion')) $id('footerVersion').textContent = 'Versión PROSOL v4.05';

  // Menú — solo módulos reales del escritorio PROSOL
  // Orden del menú PROSOL — igual que escritorio
  // Guardar sesión globalmente para control de acceso por módulo
  window._prosolSesion = sesion;

  // Solo ADMIN ve Liquidación — ni técnicos ni usuarios con otro perfil
  const esAdmin = (sesion.perfil||'').toUpperCase() === 'ADMIN';

  const MENU = [
    ['dashboard',    '📊 Panel control'],
    ['clientes',     '👥 Clientes'],
    ['equipos',      '⚡ Equipos Generac'],
    ['tecnicos',     '👷 Técnicos'],        // v3.96 · W2 (lib/web_catalogos.js)
    ['actividades',  '🛠 Actividades'],
    ...(esAdmin ? [['liquidacion','💰 Liquidación']] : []),
    ['ordenes',      '📋 Órdenes OT'],
    ['programacion', '📅 Programación'],
    ['solicitudes',  '🚨 Solicitudes de visita'],
    ['novedades',    '📥 Novedades y reclamos'],   // v3.97 · W3 (lib/web_postventa.js)
    ['buscar',       '🔎 Buscar'],               // v3.97 · W3 (lib/web_buscador.js)
    ['inventario',   '📦 Inventario'],
    ['expedientes',  '🗂 Expedientes'],          // v3.99 · W4-5 (lib/web_expedientes.js)
    ['facturacion',  '💵 Facturación y proformas'],   // v4.00 · W5 + R-1 (lib/web_facturacion.js)
    ['reportes',     '📄 Reportes'],
    ['whatsapp',     '💬 WhatsApp'],
    ['config',       '⚙ Configuración'],
  ];
  // Nav — llenar la fila 2 del topbar (estructura ya en HTML)
  const nav = $id('nav');
  nav.innerHTML = '';
  MENU.forEach(([id,txt]) => {
    const btn = document.createElement('button');
    btn.textContent = txt; btn.dataset.v = id;
    btn.addEventListener('click', () => ir(id));
    nav.appendChild(btn);
  });

  ir('dashboard');
}

function ir(v) {
  _vista = v;
  document.querySelectorAll('#nav button').forEach(b => {
    b.classList.toggle('activo', b.dataset.v === v);
  });
  const fn = (window.PROSOL_WEB_VISTAS||{})[v] || VIEWS[v] || VIEWS.dashboard;   // v3.94: pantallas en lib/web_*.js
  const _err = e => {
    $id('main').innerHTML = '<div class="card"><p style="color:#E74C3C">❌ '+ESC(e.message)+'</p></div>';
  };
  try { Promise.resolve(fn()).catch(_err); } catch (e) { _err(e); }
}

/* ═══════════════════ VISTAS ════════════════════════════════════════════ */
const VIEWS = {};

/* ── Dashboard ──────────────────────────────────────────────────────── */
VIEWS.dashboard = async () => {
  // Verificar credenciales disponibles
  if (!API.hayNube()) {
    $id('main').innerHTML = `<div class="card"><h2>📊 Panel de control</h2>
      <div style="background:#FFF3CD;border:1px solid #F5A623;border-radius:10px;padding:16px;text-align:center">
        <p style="font-weight:700;color:#1C2733">☁ Sin conexión a Supabase</p>
        <p style="font-size:13px;color:#555;margin:8px 0">Las credenciales no están configuradas o se perdieron.</p>
        <button class="btn-web prim" onclick="PROSOL_WEB.ir('config')">⚙ Ir a Configuración</button>
      </div></div>`;
    return;
  }
  $id('main').innerHTML =
    '<div class="card"><h2>📊 Panel de control</h2><div id="kpis" class="kpis">Cargando…</div></div>' +
    '<div class="grid2"><div class="card"><h3>📅 Próximas visitas</h3><div id="dProg">…</div></div>' +
    '<div class="card"><h3>📋 Últimas OT</h3><div id="dOT">…</div></div></div>';

  const [eq,cli,ord,tec,prog] = await Promise.all([
    API.select('equipos').catch(()=>[]),
    API.select('clientes').catch(()=>[]),
    API.select('ordenes').catch(()=>[]),
    API.select('tecnicos').catch(()=>[]),
    API.select('visitas_programadas').catch(()=>[])
  ]);
  const hoy = _hoyLocal();
  const eqMap={}; eq.forEach(e=>eqMap[e.id]=e);
  const cliMap={}; cli.forEach(c=>cliMap[c.id]=c);
  const ordAb = ord.filter(o=>['ABIERTA','EN PROCESO','PENDIENTE'].includes(o.estado||''));
  const visitas = prog.filter(p=>p.estado!=='EJECUTADA'&&p.estado!=='CANCELADA');
  const costo = ord.reduce((s,o)=>s+Number(o.valor_total||0),0);

  $id('kpis').innerHTML = [
    ['ok',  eq.length,  '⚡ Equipos'],
    ['',    cli.length, '👥 Clientes'],
    ['warn',ordAb.length,'📋 OT abiertas'],
    ['warn',visitas.length,'📅 Visitas pendientes'],
    ['',    tec.length, '🧑‍🔧 Técnicos'],
    ['',    ord.length, '📄 Total OT'],
    ['',    '$'+costo.toFixed(2),'💰 Total facturado'],
  ].map(([cls,v,l])=>`<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

  $id('dProg').innerHTML = tabla(['Fecha','Equipo','Tipo','Estado'],
    visitas.sort((a,b)=>(a.fecha_programada||'').localeCompare(b.fecha_programada||'')).slice(0,8).map(p=>{
      const e=eqMap[p.id_equipo]||{};
      const venc=p.fecha_programada&&p.fecha_programada<hoy;
      return [`<span style="color:${venc?'#E74C3C':'inherit'}">${ESC(p.fecha_programada||'—')}${venc?' ⚠':''}</span>`,
        ESC(e.nombre_equipo||p.serie||'—'),ESC(p.tipo_mantenimiento||'—'),ESC(p.estado||'PROGRAMADA')];
    }));

  $id('dOT').innerHTML = tabla(['N°','Fecha','Cliente','Serie','Estado'],
    [...ord].sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')).slice(0,10).map(o=>{
      const c=cliMap[o.id_cliente]||{}; const col={'REALIZADO':'#27AE60','EN PROCESO':'#F39C12','POR REVISAR':'#E67E22'}[o.estado]||'#888';
      return [`<b>${ESC(o.numero_ot||'—')}</b>`,ESC(o.fecha||'—'),
        ESC(c.razon_social||o.cliente_nombre||'—'),ESC(o.serie||'—'),
        `<span style="color:${col};font-weight:700">${ESC(o.estado||'—')}</span>`];
    }));
};

/* ── Programación ───────────────────────────────────────────────────── */
VIEWS.programacion = async () => {
  if (!API.hayNube()) {
    $id('main').innerHTML = '<div class="card"><h2>📅 Programación</h2>' +
      '<div style="background:#FFF3CD;border:1px solid #F5A623;border-radius:10px;padding:14px;text-align:center">' +
      '<p><b>☁ Sin conexión a Supabase</b></p>' +
      '<p style="font-size:13px;color:#555;margin:6px 0">Ve a <b>Configuración</b> e ingresa la anon key para ver los datos.</p>' +
      '<button class="btn-web prim" onclick="PROSOL_WEB.ir(\'config\')">⚙ Ir a Configuración</button></div></div>';
    return;
  }
  $id('main').innerHTML = `<div class="card"><h2>📅 Agenda programada</h2>
    <p style="font-size:12px;color:#666;margin:0 0 4px">Citas confirmadas con los clientes (se registran en el escritorio). Clic en un cliente para ver el detalle.</p>
    <div id="agWeb">Cargando…</div></div>
    <div class="card"><h2>📅 Programación de mantenimiento</h2>
    <div class="toolbar">
      <input id="q" class="inp-web" style="max-width:280px" placeholder="Buscar equipo, tipo, serie...">
      <select id="filtEst" class="inp-web" style="max-width:180px">
        <option value="">Todos los estados</option>
        <option>PROGRAMADA</option><option>EJECUTADA</option><option>CANCELADA</option>
      </select>
    </div><div id="lista">Cargando…</div></div>`;
  const [prog,eq,cli,ord,asig] = await Promise.all([
    API.select('visitas_programadas').catch(()=>[]),
    API.select('equipos').catch(()=>[]),
    API.select('clientes').catch(()=>[]),
    API.select('ordenes').catch(()=>[]),
    API.select('visitas_asignacion').catch(()=>[])
  ]);
  const eqMap={}; eq.forEach(e=>eqMap[e.id]=e);
  const cliMap={}; cli.forEach(c=>cliMap[c.id]=c);
  const hoy = _hoyLocal();
  // v3.68 · Agenda programada (calendario)
  const asigMap={}; asig.forEach(a=>{ if(a.clave) asigMap[a.clave]=a.tecnico; });
  const citas = prog.filter(p=>(p.estado||'')!=='CANCELADA').map(p=>{
    const e=eqMap[p.id_equipo]||{}, c=cliMap[p.id_cliente]||{};
    return { id:String(p.id), fecha:p.fecha_programada||'', hora:p.hora||'', cliente:c.razon_social||'—', codCliente:c.id_escritorio||'',
      serie:p.serie||e.serie||'', equipo:[e.marca,e.modelo,e.potencia_kw?e.potencia_kw+' kW':''].filter(Boolean).join(' '),
      lugar:[e.ubicacion||c.direccion,c.zona,c.ciudad,(e.gps_lat!=null?'GPS '+e.gps_lat+', '+e.gps_lng:'')].filter(Boolean).join(' · '),
      tipo:p.tipo_mantenimiento||'', novedades:p.observacion||'', contactoCita:p.contacto_cita, telefonoCita:p.telefono_cita,
      contactoEquipo:e.contacto||c.contacto, telefonoEquipo:e.contacto_tel||c.telefono, atendida:p.estado==='EJECUTADA', estado:p.estado,
      tecnico:asigMap['PROG:'+(p.id_escritorio||p.id)], registro:[p.registrado_por,(p.fecha_registro||'').slice(0,16)].filter(Boolean).join(' · ') };
  });
  AGENDA.completar(citas, ord.map(o=>({serie:o.serie, fecha:o.fecha, numero:o.numero_ot, tipo:o.tipo_ot})));
  AGENDA.render($id('agWeb'), citas, { onCita: ci => modal(AGENDA.detalleHTML(ci) +
    '<div style="text-align:right;margin-top:12px"><button class="btn-web" onclick="PROSOL_WEB.cerrarModal()">Cerrar</button></div>') });
  function pintar() {
    const q=($id('q').value||'').toLowerCase(), est=$id('filtEst').value;
    const filas = prog.filter(p=>{
      const e=eqMap[p.id_equipo]||{}, c=cliMap[p.id_cliente]||{};
      return (!q||[p.serie,p.tipo_mantenimiento,e.nombre_equipo,c.razon_social].some(x=>String(x||'').toLowerCase().includes(q)))
        && (!est||(p.estado||'PROGRAMADA')===est);
    }).sort((a,b)=>(a.fecha_programada||'').localeCompare(b.fecha_programada||''))
      .map(p=>{
        const e=eqMap[p.id_equipo]||{}, c=cliMap[p.id_cliente]||{};
        const venc=p.fecha_programada&&p.fecha_programada<hoy;
        const col=venc?'#E74C3C':p.estado==='EJECUTADA'?'#27AE60':'#1C2733';
        return [`<span style="color:${col};font-weight:${venc?700:400}">${ESC(p.fecha_programada||'—')}${p.hora?' '+ESC(p.hora):''}${venc?' ⚠':''}</span>`,
          ESC(e.nombre_equipo||p.serie||'—'),ESC(e.codigo||'—'),ESC(c.razon_social||'—'),
          ESC(p.tipo_mantenimiento||'—'),`<span style="color:${col};font-weight:700">${ESC(p.estado||'PROGRAMADA')}</span>`,
          `<button class="btn-web mini prim" data-pid="${p.id}">+ OT</button>`];
      });
    const lista=$id('lista'); if(!lista) return;
    lista.innerHTML = tabla(['Fecha','Equipo','Código','Cliente','Tipo','Estado',''],filas);
    lista.querySelectorAll('[data-pid]').forEach(b=>b.addEventListener('click',()=>_nuevaOTDesde(b.dataset.pid,prog,eq,cli)));
  }
  const inpQ=$id('q'), selE=$id('filtEst');
  if(inpQ) inpQ.addEventListener('input',pintar);
  if(selE) selE.addEventListener('change',pintar);
  pintar();
};

/* ── Solicitudes de visita no programada / urgente (M9-B) ─────────────── */
VIEWS.solicitudes = async () => {
  if (!API.hayNube()) {
    $id('main').innerHTML = '<div class="card"><h2>🚨 Solicitudes de visita</h2><p>☁ Sin conexión a Supabase. Ve a <b>Configuración</b>.</p></div>';
    return;
  }
  const quien = () => { const s = window._prosolSesion || {}; return s.nombre || s.usuario || 'OFICINA'; };
  $id('main').innerHTML = `<div class="card"><h2>🚨 Solicitudes de visita no programada / urgente</h2>
    <div class="toolbar">
      <select id="solEst" class="inp-web" style="max-width:200px">
        <option value="">Todos los estados</option><option>SOLICITADA</option><option>AUTORIZADA</option><option>RECHAZADA</option>
      </select>
      <button class="btn-web prim" id="solNueva">＋ Nueva visita autorizada</button>
    </div>
    <div id="solForm"></div><div id="solLista">Cargando…</div></div>
    <div class="card"><h2>✍️ Autorizaciones de clientes (mensajes de Programación)</h2>
      <div class="toolbar"><select id="autF" class="inp-web" style="max-width:260px">
        <option value="">Todas</option><option value="SIN">Respondidas sin gestionar</option><option value="PEND">Pendientes de respuesta</option>
        <option value="AUTORIZADO">Autorizó</option><option value="NO_AUTORIZADO">No autorizó</option><option value="MAS_INFO">Pide más información</option>
        <option value="GES">Gestionadas</option></select>
        <button class="btn-web sec" id="autAct">🔄 Actualizar</button></div>
      <div id="autLista">Cargando…</div></div>`;
  const [sol, eq, cli, acts] = await Promise.all([
    API.select('solicitudes_ot').catch(()=>[]), API.select('equipos').catch(()=>[]),
    API.select('clientes').catch(()=>[]), API.select('actividades').catch(()=>[])]);
  const cliMap = {}; cli.forEach(c => cliMap[c.id] = c);
  let filas = sol.slice().sort((a,b) => String(b.creado||'').localeCompare(String(a.creado||'')));
  function pintar() {
    const est = $id('solEst').value;
    const f = filas.filter(r => !est || r.estado === est).map(r => {
      const col = r.estado === 'SOLICITADA' ? '#E67E22' : r.estado === 'AUTORIZADA' ? '#27AE60' : '#E74C3C';
      const acc = r.estado === 'SOLICITADA'
        ? `<button class="btn-web mini prim" data-a="${r.id}" data-r="AUTORIZADA">Autorizar</button> <button class="btn-web mini" data-a="${r.id}" data-r="RECHAZADA">Rechazar</button>` : '';
      return [ESC(String(r.creado||'').slice(0,16).replace('T',' ')),
        `<b style="color:${r.clase==='URGENTE'?'#E74C3C':'#2471A3'}">${r.clase==='URGENTE'?'URGENTE':'NO PROGRAMADA'}</b>`,
        ESC(r.serie), ESC(r.cliente_nombre||(cliMap[r.id_cliente]||{}).razon_social||'—'), ESC(r.tipo_mantenimiento||'—'),
        ESC(r.motivo||''), ESC(r.solicitante||''),
        `<span style="color:${col};font-weight:700">${ESC(r.estado)}</span>${r.autorizado_por?'<br><small>'+ESC(r.autorizado_por)+'</small>':''}${r.atendida?'<br><small>✔ atendida'+(r.numero_ot?' · OT '+ESC(r.numero_ot):'')+'</small>':''}`, acc];
    });
    const l = $id('solLista'); if (!l) return;
    l.innerHTML = tabla(['Creada','Clase','Serie','Cliente','Tipo','Motivo','Pide','Estado',''], f);
    l.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', async () => {
      const r = filas.find(x => String(x.id) === b.dataset.a); if (!r) return;
      const cambios = { estado: b.dataset.r, autorizado_por: quien(), fecha_resolucion: new Date().toISOString() };
      try { await API.update('solicitudes_ot', r.id, cambios); Object.assign(r, cambios); toast(b.dataset.r === 'AUTORIZADA' ? '✅ Autorizada' : 'Rechazada'); pintar(); }
      catch (e) { toast('❌ ' + e.message); }
    }));
  }
  $id('solEst').addEventListener('change', pintar);
  $id('solNueva').addEventListener('click', () => {
    const opt = eq.slice().sort((a,b)=>String(a.serie).localeCompare(String(b.serie)))
      .map(e => `<option value="${ESC(e.id)}">${ESC(e.serie)} · ${ESC((cliMap[e.id_cliente]||{}).razon_social||'—')}</option>`).join('');
    const tipos = acts.map(a => `<option>${ESC(a.descripcion)}</option>`).join('');
    $id('solForm').innerHTML = `<div class="card" style="background:#F4F8FB"><h3>Nueva visita ya autorizada</h3>
      <div class="toolbar">
        <select id="nvEq" class="inp-web" style="max-width:340px">${opt}</select>
        <select id="nvClase" class="inp-web" style="max-width:170px"><option value="NO_PROGRAMADA">No programada</option><option value="URGENTE">Urgente</option></select>
        <select id="nvTipo" class="inp-web" style="max-width:260px">${tipos}</select>
      </div>
      <input id="nvMotivo" class="inp-web" placeholder="Motivo de la visita" style="width:100%;margin:8px 0">
      <button class="btn-web prim" id="nvGuardar">Crear y autorizar</button>
      <button class="btn-web" id="nvCancel">Cancelar</button>
      <p style="font-size:12px;color:#777">El técnico la verá en su pantalla Hoy como NUEVA, al sincronizar.</p></div>`;
    $id('nvCancel').addEventListener('click', () => { $id('solForm').innerHTML = ''; });
    $id('nvGuardar').addEventListener('click', async () => {
      const e = eq.find(x => String(x.id) === $id('nvEq').value), motivo = $id('nvMotivo').value.trim();
      if (!e) { toast('Elige el equipo'); return; }
      if (motivo.length < 3) { toast('Escribe el motivo'); return; }
      const hoy = new Date(); const f = hoy.getFullYear()+'-'+String(hoy.getMonth()+1).padStart(2,'0')+'-'+String(hoy.getDate()).padStart(2,'0');
      const fila = { serie: e.serie, id_equipo: e.id, id_cliente: e.id_cliente || null, cliente_nombre: (cliMap[e.id_cliente]||{}).razon_social || '',
        clase: $id('nvClase').value, tipo_mantenimiento: $id('nvTipo').value || '', motivo, fecha_prevista: f,
        solicitante: 'OFICINA', estado: 'AUTORIZADA', autorizado_por: quien(), fecha_resolucion: new Date().toISOString() };
      try { const r = await API.insert('solicitudes_ot', fila); filas.unshift(r || fila); $id('solForm').innerHTML = ''; toast('✅ Visita creada y autorizada'); pintar(); }
      catch (err) { toast('❌ ' + err.message); }
    });
  });
  pintar();
  _autorizacionesWeb(quien);
};

// v3.64: respuestas de los clientes al enlace de autorización (las crea Programación del escritorio)
async function _autorizacionesWeb(quien){
  const TXT={PENDIENTE:'⏳ Pendiente',AUTORIZADO:'✅ Autorizó',NO_AUTORIZADO:'❌ No autorizó',MAS_INFO:'💬 Más información'};
  const GES=['AGENDADA','RECHAZO REGISTRADO','INFORMACIÓN ENVIADA','SIN RESPUESTA','OTRO'];
  const hora=(i)=>{ if(!i) return ''; const d=new Date(i); return isNaN(d)?'':d.toLocaleString('es-EC',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); };
  let lista=[];
  async function cargar(){
    try{ lista=await API.rpc('autorizaciones_listar',{p_dias:120})||[]; pintar(); }
    catch(e){ $id('autLista').innerHTML='<p style="color:#888;font-size:13px">No disponible: '+ESC(e.message)+'</p>'; }
  }
  function pintar(){
    const f=$id('autF').value;
    const v=lista.filter(a=>!f||(f==='SIN'?(a.respondido&&!a.gestion):f==='PEND'?!a.respondido:f==='GES'?!!a.gestion:a.estado===f));
    $id('autLista').innerHTML=v.length?tabla(['Enviado','Cliente','Serie','Servicio','Respuesta','Fecha pref.','Comentario','Gestión',''],
      v.map(a=>[ESC(hora(a.creado)),ESC(a.cliente||''),ESC(a.serie||''),ESC(a.servicio||''),
        `<b style="color:${a.estado==='AUTORIZADO'?'#1E8449':a.estado==='NO_AUTORIZADO'?'#C0392B':a.estado==='MAS_INFO'?'#B9770E':'#888'}">${ESC(TXT[a.estado]||a.estado)}</b>${a.respondido?'<br><small>'+ESC(hora(a.respondido))+'</small>':''}`,
        ESC(a.fecha_preferida||''),ESC(a.comentario||''),ESC(a.gestion?(a.gestion+(a.gestion_nota?' · '+a.gestion_nota:'')):''),
        `<button class="btn-web mini prim" data-aut="${ESC(a.token)}">📝 Gestión</button>`]))
      :'<p style="color:#888;font-size:13px">Sin solicitudes.</p>';
    $id('autLista').querySelectorAll('[data-aut]').forEach(b=>b.addEventListener('click',()=>gestionar(lista.find(x=>x.token===b.dataset.aut))));
  }
  function gestionar(a){
    if(!a) return;
    const sug={AUTORIZADO:'AGENDADA',NO_AUTORIZADO:'RECHAZO REGISTRADO',MAS_INFO:'INFORMACIÓN ENVIADA'}[a.estado]||'OTRO';
    modal(`<h3>Registrar gestión</h3><p style="margin:0 0 6px"><b>${ESC(a.cliente||'')}</b> · serie ${ESC(a.serie||'')}<br>Respuesta: ${ESC(TXT[a.estado]||a.estado)}${a.fecha_preferida?' · fecha preferida '+ESC(a.fecha_preferida):''}</p>
      ${a.comentario?`<p style="font-size:13px;margin:0 0 8px">💬 ${ESC(a.comentario)}</p>`:''}
      <label style="display:block;font-size:12px;font-weight:700;margin:6px 0 4px">Gestión</label>
      <select class="inp-web" id="agG">${GES.map(g=>`<option ${((a.gestion||sug)===g)?'selected':''}>${g}</option>`).join('')}</select>
      <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Nota</label>
      <input class="inp-web" id="agN" value="${ESC(a.gestion_nota||'')}">
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end"><button class="btn-web sec" id="agC">Cancelar</button><button class="btn-web prim" id="agOk">Guardar</button></div>`);
    $id('agC').addEventListener('click',cerrarModal);
    $id('agOk').addEventListener('click',async()=>{
      try{ await API.rpc('autorizacion_gestionar',{p_token:a.token,p_gestion:$id('agG').value,p_nota:$id('agN').value,p_por:quien()}); cerrarModal(); toast('✅ Gestión registrada'); cargar(); }
      catch(e){ toast('❌ '+(e.message||e)); }
    });
  }
  $id('autF').addEventListener('change',pintar);
  $id('autAct').addEventListener('click',cargar);
  cargar();
}

/* ── Órdenes ────────────────────────────────────────────────────────── */
VIEWS.ordenes = async () => {
  if (!API.hayNube()) {
    $id('main').innerHTML = '<div class="card"><h2>📋 Órdenes de trabajo</h2>' +
      '<div style="background:#FFF3CD;border:1px solid #F5A623;border-radius:10px;padding:14px;text-align:center">' +
      '<p><b>☁ Sin conexión a Supabase</b></p>' +
      '<p style="font-size:13px;color:#555;margin:6px 0">Ve a <b>Configuración</b> e ingresa la anon key para ver los datos.</p>' +
      '<button class="btn-web prim" onclick="PROSOL_WEB.ir(\'config\')">⚙ Ir a Configuración</button></div></div>';
    return;
  }
  $id('main').innerHTML = `<div class="card"><h2>📋 Órdenes de trabajo</h2>
    <div class="toolbar">
      <input id="q" class="inp-web" style="max-width:240px" placeholder="N°, cliente, serie...">
      <select id="fEst" class="inp-web" style="max-width:150px">
        <option value="">Todos</option><option>REALIZADO</option><option>EN PROCESO</option>
        <option>ABIERTA</option><option>POR REVISAR</option>
      </select>
      <select id="fOrig" class="inp-web" style="max-width:140px">
        <option value="">Todos orígenes</option><option>ESCRITORIO</option><option>CAMPO</option>
      </select>
      <button class="btn-web prim" id="btnNuevaOT">➕ Nueva OT</button>
      <button class="btn-web verd" id="btnBajar">📥 Bajar campo</button>
    </div><div id="lista">Cargando…</div></div>`;

  const [ord,eq,cli,tec,acts,actItems] = await Promise.all([
    API.select('ordenes').catch(()=>[]),
    API.select('equipos').catch(()=>[]),
    API.select('clientes').catch(()=>[]),
    API.select('tecnicos').catch(()=>[]),
    API.select('actividades').catch(()=>[]),
    API.select('actividad_items').catch(()=>[])
  ]);
  const eqMap={}; eq.forEach(e=>eqMap[e.id]=e);
  const cliMap={}; cli.forEach(c=>cliMap[c.id]=c);

  // Deduplicar por numero_ot (defensa contra duplicados en la nube)
  const _vw={};
  ord.forEach(o=>{
    const k=String(o.numero_ot||o.id), prev=_vw[k];
    const sc=(x)=>(x.id_equipo?2:0)+(x.id_cliente?2:0)+(x.serie?1:0)+((x.estado&&x.estado!=='POR REVISAR')?1:0);
    if(!prev||sc(o)>sc(prev)) _vw[k]=o;
  });
  const ordUnicas=Object.values(_vw);

  function nomCli(o){return(cliMap[o.id_cliente]||{}).razon_social||o.cliente_nombre||'—';}
  function pintar(){
    const q=($id('q').value||'').toLowerCase(),est=$id('fEst').value,orig=$id('fOrig').value;
    const filas=ordUnicas.filter(o=>{
      return(!q||[o.numero_ot,nomCli(o),(eqMap[o.id_equipo]||{}).nombre_equipo,o.serie].some(x=>String(x||'').toLowerCase().includes(q)))
        &&(!est||o.estado===est)&&(!orig||o.origen===orig);
    }).sort((a,b)=>{
      const na=parseInt(a.numero_ot||'0'), nb=parseInt(b.numero_ot||'0');
      if(nb!==na) return nb-na;
      return (b.fecha||'').localeCompare(a.fecha||'');
    }).map(o=>{
      const COL={'REALIZADO':'#27AE60','EN PROCESO':'#F39C12','ABIERTA':'#E74C3C','POR REVISAR':'#E67E22'};
      const col=COL[o.estado]||'#888';
      const e=eqMap[o.id_equipo]||{};
      return [`<b>${ESC(o.numero_ot||'—')}</b>`,ESC(o.fecha||'—'),ESC(nomCli(o)),
        ESC(e.nombre_equipo||o.serie||'—'),ESC(o.tipo_ot||'—'),
        ESC(o.firma_realiza||'—'),
        `<span style="color:${col};font-weight:700">${ESC(o.estado||'—')}</span>`,
        `<span style="font-size:11px;color:${o.origen==='CAMPO'?'#1ABC9C':'#3498DB'};font-weight:700">${ESC(o.origen||'—')}</span>`,
        `<div style="display:flex;gap:6px;justify-content:flex-end">${o.pdf_url?`<a class="btn-web mini prim" href="${ESC(o.pdf_url)}" target="_blank" rel="noopener" title="PDF de la orden finalizada">📄 Ver orden</a>`:''}<button class="btn-web mini sec" data-oid="${o.id}">Ver</button><button class="btn-web mini" style="background:#C0392B;color:#fff" data-del-oid="${o.id}" data-del-num="${ESC(o.numero_ot||'')}">🗑</button></div>`];
    });
    const lista=$id('lista'); if(!lista) return;
    lista.innerHTML=tabla(['N°','Fecha','Cliente','Equipo','Tipo','Técnico','Estado','Origen',''],filas);
    lista.querySelectorAll('[data-oid]').forEach(b=>b.addEventListener('click',()=>_verOT(b.dataset.oid,ord,eqMap,cliMap)));
    lista.querySelectorAll('[data-del-oid]').forEach(b=>b.addEventListener('click',async()=>{
      if(!confirm('¿Eliminar la OT N° '+b.dataset.delNum+'? Esta acción no se puede deshacer.'))return;
      try{
        await API.remove('ot_actividades',{id_orden:'eq.'+b.dataset.delOid}).catch(()=>{});
        await API.remove('ordenes',b.dataset.delOid);
        toast('✅ OT eliminada');VIEWS.ordenes();
      }catch(e){toast('❌ '+e.message);}
    }));
  }
  const iq=$id('q'),ie=$id('fEst'),io=$id('fOrig');
  if(iq)iq.addEventListener('input',pintar);
  if(ie)ie.addEventListener('change',pintar);
  if(io)io.addEventListener('change',pintar);
  pintar();
  const bN=$id('btnNuevaOT'); if(bN)bN.addEventListener('click',()=>_formNuevaOT(null,eq,cli,tec,()=>{VIEWS.ordenes();},acts,actItems));
  const bB=$id('btnBajar'); if(bB)bB.addEventListener('click',async()=>{
    toast('⏳ Buscando OT de campo...');
    try{const r=await API.select('ordenes',{'origen':'eq.CAMPO'});toast('✅ '+r.length+' OT de campo. Recarga la vista.');}
    catch(e){toast('❌ '+e.message);}
  });
};

/* ── Clientes ───────────────────────────────────────────────────────── */
// ══════════════════════════════════════════════════════════════════════
// MÓDULO: LIQUIDACIÓN SEMANAL
// ══════════════════════════════════════════════════════════════════════
let _liqDatos = { ots:[], liqList:[], filtroLiq:null, selLiq:null };

VIEWS.liquidacion = async () => {
  if (!API.hayNube()) {
    $id('main').innerHTML = '<div class="card"><h2>💰 Liquidación semanal</h2><div style="background:#FFF3CD;border:1.5px solid #F5A623;border-radius:10px;padding:14px;text-align:center"><p><b>☁ Sin conexión Supabase</b></p><button class="btn-web prim" onclick="PROSOL_WEB.irConfig()">⚙ Configuración</button></div></div>';
    return;
  }
  $id('main').innerHTML = '<div class="card"><p>⏳ Cargando liquidación...</p></div>';
  try {
    const [ots, liqs, cli, eq] = await Promise.all([
      API.select('ordenes').catch(() => []),
      API.select('liquidaciones').catch(() => []),
      API.select('clientes').catch(() => []),
      API.select('equipos').catch(() => [])
    ]);
    const cliMap = {}; cli.forEach(c => cliMap[c.id] = c.razon_social || '');
    const eqMap  = {}; eq.forEach(e => eqMap[e.id]  = e.modelo || '');
    // Parsear ots_json y pagos_json que vienen del escritorio
    const liqList = liqs.map(l => ({
      ...l,
      _ots:   (() => { try { return JSON.parse(l.ots_json   || '[]'); } catch(e) { return []; } })(),
      _pagos: (() => { try { return JSON.parse(l.pagos_json || '[]'); } catch(e) { return []; } })()
    }));
    // Construir mapa OT → id_liquidacion desde ots_json
    const otNumToLiqId = {};
    liqList.forEach(l => {
      (l._ots || []).forEach(o => { if (o.numero_ot) otNumToLiqId[String(o.numero_ot)] = l.id; });
    });
    // Deduplicar OT por numero_ot (defensa: la nube puede tener duplicados
    // hasta que se corra limpiar_duplicados_nube.py). Conservar la más completa.
    const _vistas = {};
    ots.forEach(o => {
      const k = String(o.numero_ot || o.id);
      const prev = _vistas[k];
      const score = (x) => (x.id_equipo?2:0)+(x.id_cliente?2:0)+(x.serie?1:0)+((x.estado&&x.estado!=='POR REVISAR')?1:0);
      if (!prev || score(o) > score(prev)) _vistas[k] = o;
    });
    const otsUnicas = Object.values(_vistas);
    _liqDatos.ots = otsUnicas.map(o => ({
      ...o,
      _cli: cliMap[o.id_cliente] || o.cliente_nombre || '—',
      _modelo: eqMap[o.id_equipo] || '',
      _marcada: false,
      // Si la OT está en algún ots_json, marcarla como liquidada
      id_liquidacion: o.id_liquidacion || otNumToLiqId[String(o.numero_ot)] || null
    }));
    _liqDatos.liqList = liqList;
    _liqDatos.filtroLiq = null;
    _liqDatos.selLiq = null;
    _liqRender();
  } catch(e) {
    $id('main').innerHTML = '<div class="card"><p style="color:#E74C3C">❌ ' + ESC(e.message) + '</p></div>';
  }
};

function _liqRender() {
  const hoy = _hoyLocal();
  const lunes = _liqLunes(hoy);
  const domingo = _liqDomingo(hoy);

  $id('main').innerHTML = `<div class="card" style="max-width:100%">
  <h2>💰 Liquidación semanal</h2>

  <!-- Tabs -->
  <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--linea)">
    <button class="btn-web" id="liq-tab-liq" onclick="_liqTab('liq')" style="border-radius:6px 6px 0 0;margin-bottom:-2px;border-bottom:2px solid var(--naranja);font-weight:700">💰 Liquidación</button>
    <button class="btn-web sec" id="liq-tab-fact" onclick="_liqTab('fact')" style="border-radius:6px 6px 0 0;margin-bottom:-2px">🧾 Facturación</button>
    <button class="btn-web sec" id="liq-tab-prof" onclick="_liqTab('prof')" style="border-radius:6px 6px 0 0;margin-bottom:-2px">📋 Proformas</button>
  </div>

  <!-- TAB LIQUIDACIÓN -->
  <div id="liq-panel-liq">
    <div style="background:#F8F9FA;border:1px solid var(--linea);border-radius:8px;padding:12px;margin-bottom:12px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <label style="font-size:13px;font-weight:600">Modo:</label>
        <select id="liq-modo" class="inp-web" style="width:120px" onchange="_liqOnModo()">
          <option value="SEMANA">Semana</option>
          <option value="RANGO">Rango libre</option>
        </select>
        <label style="font-size:13px;font-weight:600">Desde:</label>
        <input id="liq-desde" type="date" class="inp-web" value="${lunes}" style="width:150px">
        <label style="font-size:13px;font-weight:600" id="liq-lbl-hasta">Hasta:</label>
        <input id="liq-hasta" type="date" class="inp-web" value="${domingo}" style="width:150px" readonly>
        <button class="btn-web prim" onclick="_liqBuscar()">🔍 Buscar OT del periodo</button>
        <button class="btn-web sec" onclick="_liqVerPendientes()">➕ Solo pendientes</button>
        <button class="btn-web sec" onclick="_liqVerTodas()">↺ Ver todas</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 380px;gap:12px">
      <!-- Panel izquierdo: OT -->
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span id="liq-rotulo" style="font-weight:600;font-size:13px;color:var(--azul)">Todas las órdenes</span>
          <input id="liq-q" type="search" placeholder="Buscar cliente, N° OT, serie..." class="inp-web" style="width:260px" oninput="_liqFiltrar()">
        </div>
        <div style="overflow-x:auto">
          <table class="tbl-web" id="liq-tbl-ot" style="width:100%;font-size:12px">
            <thead><tr>
              <th style="width:40px">Incl.</th>
              <th>N° OT</th><th>Fecha</th><th>Cliente</th>
              <th>Serie</th><th>Valor</th><th>Liquidación</th>
            </tr></thead>
            <tbody id="liq-tbody-ot"></tbody>
          </table>
        </div>
        <div style="display:flex;gap:16px;padding:8px 4px;font-weight:700;font-size:13px">
          <span id="liq-sub">Subtotal: $0.00</span>
          <span id="liq-iva">IVA: $0.00</span>
          <span id="liq-tot" style="color:var(--naranja);margin-left:auto">TOTAL: $0.00</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <button class="btn-web prim" onclick="_liqGenerar()">🧮 Generar liquidación</button>
          <button class="btn-web" style="background:#117A65;color:#fff" onclick="_liqPagarDirecto()">💵 Pagar / Liquidar</button>
          <button class="btn-web sec" onclick="_liqRefrescar()">🔄 Refrescar</button>
        </div>
      </div>

      <!-- Panel derecho: liquidaciones + abonos -->
      <div style="border:1px solid var(--linea);border-radius:8px;padding:12px">
        <div style="font-weight:700;font-size:13px;margin-bottom:6px">Liquidaciones registradas</div>
        <div style="overflow-y:auto;max-height:200px">
          <table class="tbl-web" style="width:100%;font-size:12px">
            <thead><tr><th>N°</th><th>Periodo</th><th>Total</th><th>Saldo</th><th>Estado</th></tr></thead>
            <tbody id="liq-tbody-liq"></tbody>
          </table>
        </div>
        <div style="font-weight:700;font-size:13px;margin:10px 0 4px">Abonos</div>
        <div style="overflow-y:auto;max-height:120px">
          <table class="tbl-web" style="width:100%;font-size:12px">
            <thead><tr><th>Fecha</th><th>Forma</th><th>Valor</th></tr></thead>
            <tbody id="liq-tbody-pag"></tbody>
          </table>
        </div>
        <div id="liq-saldo-txt" style="font-weight:700;font-size:12px;color:var(--azul);margin:6px 0">Saldo: —</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
          <select id="liq-pg-forma" class="inp-web" style="font-size:12px">
            <option>EFECTIVO</option><option selected>TRANSFERENCIA</option><option>CHEQUE</option>
          </select>
          <input id="liq-pg-val" type="number" class="inp-web" value="0" step="0.01" style="font-size:12px" placeholder="Valor abono">
        </div>
        <button class="btn-web prim" style="width:100%;margin-top:6px;font-size:12px" onclick="_liqAbonar()">💵 Registrar abono</button>
        <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap">
          <button class="btn-web sec" style="font-size:11px" onclick="_liqLiberar()">🔓 Liberar OT</button>
          <button class="btn-web" style="font-size:11px;background:#922B21;color:#fff" onclick="_liqAnular()">🗑 Anular</button>
          <button class="btn-web" style="font-size:11px;background:#6C3483;color:#fff" onclick="_liqPdf()">📄 PDF</button>
        </div>
      </div>
    </div>
  </div>

  <!-- TAB FACTURACIÓN -->
  <div id="liq-panel-fact" style="display:none">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <select id="fact-estado" class="inp-web" style="width:160px" onchange="_factCargar()">
        <option>TODAS</option><option selected>POR COBRAR</option><option>PENDIENTE</option>
        <option>PARCIAL</option><option>VENCIDA</option><option>CANCELADA</option>
      </select>
      <input id="fact-q" type="search" placeholder="Buscar factura, cliente, OT..." class="inp-web" style="width:240px" oninput="_factCargar()">
      <button class="btn-web prim" onclick="_factNueva()">🧾 Nueva factura</button>
    </div>
    <div id="fact-kpis" style="background:#F0F3F7;border-radius:6px;padding:8px 12px;font-size:12px;font-weight:600;margin-bottom:10px"></div>
    <div style="overflow-x:auto">
      <table class="tbl-web" style="width:100%;font-size:12px" id="fact-tbl">
        <thead><tr>
          <th>N° Factura</th><th>OT</th><th>Cliente</th><th>Serie</th>
          <th>F.Factura</th><th>Vence</th><th>Total</th><th>Pagado</th>
          <th>Saldo</th><th>Estado</th><th>Acción</th>
        </tr></thead>
        <tbody id="fact-tbody"></tbody>
      </table>
    </div>
  </div>

  <!-- TAB PROFORMAS -->
  <div id="liq-panel-prof" style="display:none">
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <select id="prof-estado" class="inp-web" style="width:160px" onchange="_profCargar()">
        <option>TODAS</option><option>PENDIENTE</option><option>ENVIADA</option>
        <option>APROBADA</option><option>RECHAZADA</option><option>EJECUTADA</option>
      </select>
      <input id="prof-q" type="search" placeholder="Buscar proforma, cliente, serie..." class="inp-web" style="width:240px" oninput="_profCargar()">
      <button class="btn-web prim" onclick="_profNueva()">🆕 Nueva proforma</button>
    </div>
    <div style="overflow-x:auto">
      <table class="tbl-web" style="width:100%;font-size:12px">
        <thead><tr>
          <th>N° Proforma</th><th>Cliente</th><th>Serie</th>
          <th>Fecha</th><th>Total</th><th>Estado</th><th>OT</th><th>Acciones</th>
        </tr></thead>
        <tbody id="prof-tbody"></tbody>
      </table>
    </div>
  </div>

</div>`;

  _liqPintarOTs();
  _liqPintarLiqs();
  _factCargar();
  _profCargar();
}

// ── Helpers fecha ────────────────────────────────────────────────────
function _liqLunes(iso) {
  const d = _fechaDeISO(iso); d.setDate(d.getDate() - d.getDay() + (d.getDay()===0?-6:1));
  return _fechaLocal(d);
}
function _liqDomingo(iso) {
  const d = _fechaDeISO(_liqLunes(iso)); d.setDate(d.getDate()+6);
  return _fechaLocal(d);
}

// ── Tabs ─────────────────────────────────────────────────────────────
window._liqTab = function(tab) {
  ['liq','fact','prof'].forEach(t => {
    const p = $id('liq-panel-'+t), b = $id('liq-tab-'+t);
    if (!p||!b) return;
    const on = t===tab;
    p.style.display = on ? '' : 'none';
    b.className = on ? 'btn-web' : 'btn-web sec';
    b.style.borderBottom = on ? '2px solid var(--naranja)' : '';
    b.style.fontWeight = on ? '700' : '';
  });
};

// ── Modo semana/rango ────────────────────────────────────────────────
window._liqOnModo = function() {
  const modo = $id('liq-modo')?.value;
  const ent = $id('liq-hasta');
  if (!ent) return;
  if (modo === 'SEMANA') {
    ent.readOnly = true;
    const d = $id('liq-desde')?.value;
    if (d) ent.value = _liqDomingo(d);
  } else {
    ent.readOnly = false;
  }
};

// ── Buscar OT del periodo ────────────────────────────────────────────
window._liqBuscar = function() {
  const desde = $id('liq-desde')?.value;
  const modo  = $id('liq-modo')?.value;
  let hasta   = $id('liq-hasta')?.value;
  if (!desde) return;
  if (modo === 'SEMANA') {
    hasta = _liqDomingo(desde);
    if ($id('liq-hasta')) $id('liq-hasta').value = hasta;
  }
  _liqDatos.ots.forEach(o => {
    const en = o.fecha && o.fecha >= desde && o.fecha <= hasta;
    if (en && !o.id_liquidacion) o._marcada = true;
  });
  const rot = $id('liq-rotulo');
  if (rot) rot.textContent = 'Pendiente de liquidar del ' + desde + ' al ' + hasta;
  _liqPintarOTs();
  _liqRecalcular();
};

window._liqVerPendientes = function() {
  _liqDatos.filtroLiq = null;
  const rot = $id('liq-rotulo');
  if (rot) rot.textContent = 'Órdenes PENDIENTES de liquidación';
  _liqPintarOTs(true);
  _liqRecalcular();
};

window._liqVerTodas = function() {
  _liqDatos.filtroLiq = null;
  const rot = $id('liq-rotulo');
  if (rot) rot.textContent = 'Todas las órdenes';
  _liqPintarOTs(false);
  _liqRecalcular();
};

window._liqFiltrar = function() { _liqPintarOTs(); };

function _liqPintarOTs(soloPend) {
  const tbody = $id('liq-tbody-ot');
  if (!tbody) return;
  const q = ($id('liq-q')?.value || '').toLowerCase().trim();
  let rows = _liqDatos.ots;
  if (soloPend === true) rows = rows.filter(o => !o.id_liquidacion);
  if (_liqDatos.filtroLiq) rows = rows.filter(o => o.id_liquidacion === _liqDatos.filtroLiq);
  if (q) rows = rows.filter(o =>
    [o.numero_ot, o._cli, o.serie, o.tipo_ot, o.estado].some(x => String(x||'').toLowerCase().includes(q))
  );
  // Ordenar OT descendente por número
  rows = [...rows].sort((a,b) => parseInt(b.numero_ot||'0') - parseInt(a.numero_ot||'0'));
  // Paleta de colores para grupos de liquidación
  const LIQ_COLORES = ['#E8F8F5','#EBF5FB','#FEF9E7','#F5EEF8','#FDFEFE','#EAFAF1','#FEF5E7','#EAF2F8'];
  const liqColorMap = {};
  let colorIdx = 0;
  (_liqDatos.liqList||[]).forEach(l => {
    if (l.id && !liqColorMap[l.id]) {
      liqColorMap[l.id] = LIQ_COLORES[colorIdx % LIQ_COLORES.length];
      colorIdx++;
    }
  });
  tbody.innerHTML = rows.slice(0,200).map(o => {
    const pend = !o.id_liquidacion;
    const marc = o._marcada;
    const incl = pend ? (marc ? '☑' : '☐') : (marc ? '🔓☑' : '🔒☐');
    const bgColor = pend ? '' : (liqColorMap[o.id_liquidacion] || '#F0F0F0');
    const liqNum = pend ? '' : ((_liqDatos.liqList||[]).find(l=>l.id===o.id_liquidacion)||{}).numero||'';
    const liqTxt = pend ? '<span style="color:#888;font-size:11px">PENDIENTE</span>'
      : '<span style="color:#117A65;font-size:11px;font-weight:600">N°' + liqNum + '</span>';
    return `<tr onclick="_liqToggle('${o.id}','${pend}')" style="cursor:pointer;background:${bgColor}">
      <td style="text-align:center;font-size:14px">${incl}</td>
      <td>${ESC(o.numero_ot||'—')}</td>
      <td>${ESC(o.fecha||'—')}</td>
      <td>${ESC(o._cli)}</td>
      <td>${ESC(o.serie||'—')}</td>
      <td>$${parseFloat(o.valor_total||0).toFixed(2)}</td>
      <td>${liqTxt}</td>
    </tr>`;
  }).join('');
  _liqRecalcular();
}

window._liqToggle = function(id, pend) {
  const o = _liqDatos.ots.find(x => x.id === id);
  if (!o) return;
  o._marcada = !o._marcada;
  _liqPintarOTs();
};

function _liqRecalcular() {
  const marcadasPend = _liqDatos.ots.filter(o => o._marcada && !o.id_liquidacion);
  const sub = marcadasPend.reduce((s,o) => s + parseFloat(o.valor_total||0), 0);
  const iva = Math.round(sub * 0.15 * 100) / 100;
  if ($id('liq-sub')) $id('liq-sub').textContent = 'Subtotal: $' + sub.toFixed(2);
  if ($id('liq-iva')) $id('liq-iva').textContent = 'IVA (15%): $' + iva.toFixed(2);
  if ($id('liq-tot')) $id('liq-tot').textContent = 'TOTAL: $' + (sub+iva).toFixed(2);
}

function _liqPintarLiqs() {
  const tbody = $id('liq-tbody-liq');
  if (!tbody) return;
  const liqOrdenadas = [...(_liqDatos.liqList || [])].sort((a,b) =>
    parseInt(b.numero||'0') - parseInt(a.numero||'0'));
  tbody.innerHTML = liqOrdenadas.map(l => {
    const color = l.estado === 'PAGADA' ? '#117A65' : (parseFloat(l.saldo||0) > 0 ? '#922B21' : '#888');
    return `<tr onclick="_liqSelLiq('${l.id}')" style="cursor:pointer">
      <td>${ESC(l.numero||'')}</td>
      <td style="font-size:11px">${ESC((l.fecha_desde||'').slice(5))} - ${ESC((l.fecha_hasta||'').slice(5))}</td>
      <td>$${parseFloat(l.total||0).toFixed(2)}</td>
      <td style="color:${color}">$${parseFloat(l.saldo||0).toFixed(2)}</td>
      <td style="color:${color};font-size:11px">${ESC(l.estado||'')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="color:#888;text-align:center;padding:8px">Sin liquidaciones</td></tr>';
}

window._liqSelLiq = function(id) {
  _liqDatos.selLiq = id;
  const l = (_liqDatos.liqList || []).find(x => x.id === id);
  if (!l) return;
  const saldoEl = $id('liq-saldo-txt');
  if (saldoEl) saldoEl.textContent = 'Liq. N°' + (l.numero||'') + ' — Saldo: $' +
    parseFloat(l.saldo||0).toFixed(2) + '   (Total $' + parseFloat(l.total||0).toFixed(2) + ')';
  // Marcar las OT de esta liquidación en el treeview
  _liqDatos.filtroLiq = id;
  const rot = $id('liq-rotulo');
  if (rot) rot.textContent = 'OT de la liquidación N°' + (l.numero||'');
  _liqPintarOTs();
  // Mostrar abonos desde pagos_json (ya vienen del escritorio vía sync)
  const tb = $id('liq-tbody-pag');
  if (tb) {
    const pagos = l._pagos || [];
    tb.innerHTML = pagos.map(p =>
      `<tr><td>${ESC(p.fecha||'')}</td><td>${ESC(p.forma||'')}</td><td>$${parseFloat(p.valor||0).toFixed(2)}</td></tr>`
    ).join('') || '<tr><td colspan="3" style="color:#888;padding:6px">Sin abonos registrados</td></tr>';
  }
};

// ── Generar liquidación ──────────────────────────────────────────────
window._liqGenerar = async function() {
  const marcadas = _liqDatos.ots.filter(o => o._marcada && !o.id_liquidacion);
  if (!marcadas.length) { toast('⚠ Marca al menos una OT pendiente'); return; }
  const desde = $id('liq-desde')?.value || _hoyLocal();
  const hasta = $id('liq-hasta')?.value || desde;
  const sub = marcadas.reduce((s,o) => s + parseFloat(o.valor_total||0), 0);
  const iva = Math.round(sub * 0.15 * 100) / 100;
  const total = Math.round((sub+iva)*100)/100;
  const numero = 'LIQ-' + Date.now().toString().slice(-6);
  try {
    const liq = await API.insert('liquidaciones', {
      numero, fecha_desde: desde, fecha_hasta: hasta,
      subtotal: sub, iva_pct: 15, iva_valor: iva,
      total, total_pagado: 0, saldo: total,
      estado: 'PENDIENTE', observacion: ''
    });
    // Actualizar las OT con el id de liquidación
    for (const o of marcadas) {
      await API.update('ordenes', o.id, {id_liquidacion: liq.id}).catch(()=>{});
      o.id_liquidacion = liq.id;
      o._marcada = false;
    }
    _liqDatos.liqList.unshift(liq);
    toast('✅ Liquidación ' + numero + ' generada — $' + total.toFixed(2));
    _liqPintarOTs();
    _liqPintarLiqs();
    _liqRecalcular();
  } catch(e) { toast('❌ ' + e.message); }
};

window._liqPagarDirecto = async function() {
  const marcadas = _liqDatos.ots.filter(o => o._marcada && !o.id_liquidacion);
  if (!marcadas.length) { toast('⚠ Marca al menos una OT pendiente'); return; }
  const forma = prompt('Forma de pago: EFECTIVO / TRANSFERENCIA / CHEQUE', 'TRANSFERENCIA');
  if (!forma) return;
  const desde = $id('liq-desde')?.value || _hoyLocal();
  const hasta = $id('liq-hasta')?.value || desde;
  const sub = marcadas.reduce((s,o) => s + parseFloat(o.valor_total||0), 0);
  const iva = Math.round(sub * 0.15 * 100) / 100;
  const total = Math.round((sub+iva)*100)/100;
  const numero = 'LIQ-' + Date.now().toString().slice(-6);
  try {
    const liq = await API.insert('liquidaciones', {
      numero, fecha_desde: desde, fecha_hasta: hasta,
      subtotal: sub, iva_pct: 15, iva_valor: iva,
      total, total_pagado: total, saldo: 0,
      estado: 'PAGADA', observacion: 'Pagada en un solo acto'
    });
    await API.insert('liquidacion_pagos', {
      id_liquidacion: liq.id, fecha: hasta, forma: forma.toUpperCase(), valor: total
    }).catch(()=>{});
    for (const o of marcadas) {
      await API.update('ordenes', o.id, {id_liquidacion: liq.id}).catch(()=>{});
      o.id_liquidacion = liq.id; o._marcada = false;
    }
    _liqDatos.liqList.unshift(liq);
    toast('✅ Liquidación ' + numero + ' PAGADA — $' + total.toFixed(2) + ' (' + forma + ')');
    _liqPintarOTs(); _liqPintarLiqs(); _liqRecalcular();
  } catch(e) { toast('❌ ' + e.message); }
};

window._liqAbonar = async function() {
  if (!_liqDatos.selLiq) { toast('⚠ Selecciona una liquidación'); return; }
  const forma = $id('liq-pg-forma')?.value || 'EFECTIVO';
  const val   = parseFloat($id('liq-pg-val')?.value || 0);
  if (val <= 0) { toast('⚠ Ingresa un valor mayor a 0'); return; }
  const l = (_liqDatos.liqList||[]).find(x => x.id === _liqDatos.selLiq);
  if (!l) return;
  try {
    await API.insert('liquidacion_pagos', {
      id_liquidacion: l.id,
      fecha: _hoyLocal(),
      forma, valor: val
    });
    const nuevoTotal = Math.min(parseFloat(l.total_pagado||0) + val, parseFloat(l.total||0));
    const nuevoSaldo = Math.max(parseFloat(l.total||0) - nuevoTotal, 0);
    const nuevoEst   = nuevoSaldo <= 0 ? 'PAGADA' : 'PARCIAL';
    await API.update('liquidaciones', l.id, {
      total_pagado: nuevoTotal, saldo: nuevoSaldo, estado: nuevoEst
    });
    l.total_pagado = nuevoTotal; l.saldo = nuevoSaldo; l.estado = nuevoEst;
    toast('✅ Abono de $' + val.toFixed(2) + ' registrado');
    _liqPintarLiqs();
    _liqSelLiq(_liqDatos.selLiq);
  } catch(e) { toast('❌ ' + e.message); }
};

window._liqLiberar = async function() {
  const marcadas = _liqDatos.ots.filter(o => o._marcada && o.id_liquidacion);
  if (!marcadas.length) { toast('⚠ Marca OT ya liquidadas para liberarlas'); return; }
  if (!confirm('¿Liberar ' + marcadas.length + ' OT de su liquidación?')) return;
  for (const o of marcadas) {
    await API.update('ordenes', o.id, {id_liquidacion: null}).catch(()=>{});
    o.id_liquidacion = null; o._marcada = false;
  }
  toast('✅ ' + marcadas.length + ' OT liberadas');
  await VIEWS.liquidacion();
};

window._liqAnular = async function() {
  if (!_liqDatos.selLiq) { toast('⚠ Selecciona una liquidación'); return; }
  if (!confirm('¿Anular esta liquidación? Se liberarán sus OT.')) return;
  const id = _liqDatos.selLiq;
  const ots = _liqDatos.ots.filter(o => o.id_liquidacion === id);
  for (const o of ots) {
    await API.update('ordenes', o.id, {id_liquidacion: null}).catch(()=>{});
  }
  await API.remove('liquidaciones', id).catch(()=>{});
  _liqDatos.liqList = _liqDatos.liqList.filter(l => l.id !== id);
  _liqDatos.selLiq = null; _liqDatos.filtroLiq = null;
  toast('✅ Liquidación anulada');
  await VIEWS.liquidacion();
};

window._liqPdf = function() {
  if (!_liqDatos.selLiq) { toast('⚠ Selecciona una liquidación'); return; }
  const l = (_liqDatos.liqList||[]).find(x => x.id === _liqDatos.selLiq);
  if (!l) return;
  const ots = _liqDatos.ots.filter(o => o.id_liquidacion === l.id);
  const filas = ots.map(o =>
    '<tr><td>' + ESC(o.numero_ot||'') + '</td><td>' + ESC(o.fecha||'') + '</td>' +
    '<td>' + ESC(o._cli) + '</td><td>' + ESC(o.serie||'') + '</td>' +
    '<td style="text-align:right">$' + parseFloat(o.valor_total||0).toFixed(2) + '</td></tr>'
  ).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Liquidación ${ESC(l.numero||'')}</title>
  <style>body{font-family:Arial,sans-serif;padding:24px;color:#1C2733}
  h2{color:#1C2733}table{width:100%;border-collapse:collapse;margin:16px 0}
  th{background:#1C2733;color:#fff;padding:6px 8px;text-align:left}
  td{padding:5px 8px;border-bottom:1px solid #E5E8EA}
  .tot{font-size:15px;font-weight:700;color:#F5A623;margin-top:16px}
  .pie{font-size:10px;color:#888;margin-top:32px;text-align:center}
  </style></head><body>
  <h2>LIQUIDACIÓN N° ${ESC(l.numero||'')}</h2>
  <p>Periodo: ${ESC(l.fecha_desde||'')} al ${ESC(l.fecha_hasta||'')} &nbsp;|&nbsp; Estado: <b>${ESC(l.estado||'')}</b></p>
  <table><thead><tr><th>N° OT</th><th>Fecha</th><th>Cliente</th><th>Serie</th><th>Valor</th></tr></thead>
  <tbody>${filas}</tbody></table>
  <div class="tot">Subtotal: $${parseFloat(l.subtotal||0).toFixed(2)} &nbsp;|&nbsp;
  IVA (${l.iva_pct||15}%): $${parseFloat(l.iva_valor||0).toFixed(2)} &nbsp;|&nbsp;
  TOTAL: $${parseFloat(l.total||0).toFixed(2)}</div>
  <div class="tot" style="font-size:13px">Pagado: $${parseFloat(l.total_pagado||0).toFixed(2)} &nbsp;|&nbsp;
  Saldo: $${parseFloat(l.saldo||0).toFixed(2)}</div>
  <div class="pie">PROSOL — ROCKENSY S.A. &amp; MIG — Tec. Master Luis Martínez Ibáñez</div>
  </body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); w.print(); }
};

window._liqRefrescar = function() { VIEWS.liquidacion(); };

// ── Facturación ──────────────────────────────────────────────────────
let _factList = [];
let _cliCod = null;   // v3.94 · W0: facturas/proformas guardan el código del cliente (CLI-…) → nombre
const _ahoraISO = () => new Date().toISOString();
async function _cliPorCodigo() {
  if (!_cliCod) { _cliCod = {}; (await API.select('clientes').catch(() => [])).forEach(c => { _cliCod[c.id_escritorio] = c; _cliCod[c.id] = c; }); }
  return _cliCod;
}
const _cliNom = (r) => r.cliente_nombre || r.razon_social || ((_cliCod || {})[r.id_cliente] || {}).razon_social || '';
async function _factCargar() {
  await _cliPorCodigo();
  const est = $id('fact-estado')?.value || 'TODAS';
  const q   = ($id('fact-q')?.value || '').toLowerCase();
  if (!_factList.length || !q) {
    try {
      _factList = await API.select('facturas').catch(() => []);
    } catch(e) { return; }
  }
  let ff = est === 'TODAS' ? _factList : _factList.filter(f => f.estado === est);
  if (q) ff = ff.filter(f => [f.numero, f.numero_ot, _cliNom(f), f.serie].some(x => String(x||'').toLowerCase().includes(q)));
  const tbody = $id('fact-tbody');
  if (!tbody) return;
  const hoy = _hoyLocal();
  tbody.innerHTML = ff.map(f => {
    const venc = f.fecha_vence && f.fecha_vence < hoy && f.estado !== 'CANCELADA';
    const color = venc ? '#E74C3C' : (f.estado==='CANCELADA' ? '#117A65' : '');
    return `<tr style="color:${color}">
      <td>${ESC(f.numero||'')}</td><td>${ESC(f.numero_ot||'')}</td>
      <td>${ESC(_cliNom(f))}</td><td>${ESC(f.serie||'')}</td>
      <td>${ESC(f.fecha_factura||'')}</td><td>${ESC(f.fecha_vence||'—')}</td>
      <td>$${parseFloat(f.total||0).toFixed(2)}</td>
      <td>$${parseFloat(f.pagado||0).toFixed(2)}</td>
      <td style="font-weight:700">$${parseFloat(f.saldo||0).toFixed(2)}</td>
      <td style="font-size:11px">${ESC(f.estado||'')}</td>
      <td><button class="btn-web sec" style="font-size:11px;padding:2px 6px" onclick="_factEditar('${f.id}')">✏</button>
          <button class="btn-web sec" style="font-size:11px;padding:2px 6px" onclick="_factPago('${f.id}')">💵</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="11" style="color:#888;text-align:center;padding:10px">Sin facturas</td></tr>';
  // KPIs
  const tot = ff.reduce((s,f) => s + parseFloat(f.total||0), 0);
  const pag = ff.reduce((s,f) => s + parseFloat(f.pagado||0), 0);
  const sal = ff.reduce((s,f) => s + parseFloat(f.saldo||0), 0);
  const kpiEl = $id('fact-kpis');
  if (kpiEl) kpiEl.textContent = 'Total facturado: $' + tot.toFixed(2) + '   Cobrado: $' + pag.toFixed(2) + '   Por cobrar: $' + sal.toFixed(2);
}

window._factNueva = function() { _factDialogo(null); };
window._factEditar = function(id) { _factDialogo(id); };

function _factDialogo(id) {
  const f = id ? (_factList.find(x => x.id === id) || {}) : {};
  cerrarModal();
  const hoy = _hoyLocal();
  $id('modal-body').innerHTML = `
  <h3 style="margin:0 0 12px">${id ? 'Editar factura' : 'Nueva factura'}</h3>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <div><label class="lbl-web">N° OT (vincula cliente/serie)</label>
      <div style="display:flex;gap:4px">
        <input id="fv-numot" class="inp-web" value="${ESC(f.numero_ot||'')}" placeholder="N° OT" style="flex:1">
        <button class="btn-web sec" onclick="_factBuscarOT()">Buscar</button>
      </div>
      <div id="fv-cli-info" style="font-size:11px;color:#117A65;margin-top:2px">${_cliNom(f) ? '✓ ' + ESC(_cliNom(f)) : ''}</div>
    </div>
    <div><label class="lbl-web">N° de factura</label>
      <input id="fv-num" class="inp-web" value="${ESC(f.numero||'')}"></div>
    <div><label class="lbl-web">Fecha de trabajo</label>
      <input id="fv-fectrab" type="date" class="inp-web" value="${ESC(f.fecha_trabajo||hoy)}"></div>
    <div><label class="lbl-web">Fecha de factura</label>
      <input id="fv-fecfact" type="date" class="inp-web" value="${ESC(f.fecha_factura||hoy)}"></div>
    <div><label class="lbl-web">Subtotal (sin IVA)</label>
      <input id="fv-sub" type="number" class="inp-web" value="${f.subtotal||0}" step="0.01"></div>
    <div><label class="lbl-web">IVA %</label>
      <input id="fv-iva" type="number" class="inp-web" value="${f.iva_pct||15}" step="1"></div>
    <div><label class="lbl-web">Plazo crédito (días)</label>
      <input id="fv-plazo" type="number" class="inp-web" value="${f.plazo_dias||0}"></div>
    <div><label class="lbl-web">Observación</label>
      <input id="fv-obs" class="inp-web" value="${ESC(f.observacion||'')}"></div>
  </div>
  <input type="hidden" id="fv-idot" value="${f.id_ot||''}">
  <input type="hidden" id="fv-idcli" value="${f.id_cliente||''}">
  <input type="hidden" id="fv-serie" value="${f.serie||''}">
  <div style="display:flex;gap:8px;margin-top:16px">
    <button class="btn-web prim" onclick="_factGuardar('${id||''}')">💾 Guardar</button>
    <button class="btn-web sec" onclick="cerrarModal()">Cancelar</button>
  </div>`;
  $id('modal-overlay').style.display = 'flex';
}

window._factBuscarOT = async function() {
  const num = $id('fv-numot')?.value?.trim();
  if (!num) return;
  try {
    const ots = await API.select('ordenes', {numero_ot: num});
    const o = ots && ots[0];
    if (!o) { const el = $id('fv-cli-info'); if (el) { el.textContent = '✖ OT no encontrada'; el.style.color='#E74C3C'; } return; }
    const clis = await API.select('clientes', {id: o.id_cliente}).catch(()=>[]);
    const c = clis && clis[0];
    if ($id('fv-idot'))  $id('fv-idot').value  = o.id_escritorio || o.id;
    if ($id('fv-idcli')) $id('fv-idcli').value = (c && c.id_escritorio) || o.id_cliente || '';
    if ($id('fv-serie')) $id('fv-serie').value  = o.serie||'';
    if ($id('fv-fectrab')  && !$id('fv-fectrab').value)  $id('fv-fectrab').value  = o.fecha||'';
    if ($id('fv-sub')   && parseFloat($id('fv-sub').value)==0) $id('fv-sub').value = parseFloat(o.valor_total||0).toFixed(2);
    const el = $id('fv-cli-info');
    if (el) { el.textContent = '✓ ' + ((c&&c.razon_social)||o.cliente_nombre||'—'); el.style.color='#117A65'; }
  } catch(e) { toast('❌ ' + e.message); }
};

window._factGuardar = async function(id) {
  const idcli = $id('fv-idcli')?.value;
  if (!idcli) { toast('⚠ Vincula una OT válida (necesita cliente)'); return; }
  const sub   = parseFloat($id('fv-sub')?.value || 0);
  const ivap  = parseFloat($id('fv-iva')?.value || 15);
  const ivaV  = Math.round(sub * ivap / 100 * 100) / 100;
  const total = Math.round((sub + ivaV) * 100) / 100;
  const datos = {
    numero: $id('fv-num')?.value?.trim() || '',
    id_ot: $id('fv-idot')?.value || null,
    numero_ot: $id('fv-numot')?.value?.trim() || '',
    id_cliente: idcli,
    serie: $id('fv-serie')?.value || '',
    fecha_trabajo: $id('fv-fectrab')?.value || '',
    fecha_factura: $id('fv-fecfact')?.value || '',
    subtotal: sub, iva_pct: ivap, iva_valor: ivaV, total,
    pagado: id ? undefined : 0,
    saldo:  id ? undefined : total,
    estado: id ? undefined : 'POR COBRAR',
    plazo_dias: parseInt($id('fv-plazo')?.value||0),
    observacion: $id('fv-obs')?.value?.trim() || '',
    actualizado: _ahoraISO(), sync_origen: 'WEB'
  };
  Object.keys(datos).forEach(k => datos[k] === undefined && delete datos[k]);
  try {
    if (id) { await API.update('facturas', id, datos); }
    else     { await API.insert('facturas', datos); }
    cerrarModal();
    _factList = [];
    await _factCargar();
    toast('✅ Factura guardada');
  } catch(e) { toast('❌ ' + e.message); }
};

window._factPago = function(id) {
  const f = _factList.find(x => x.id === id);
  if (!f) return;
  cerrarModal();
  $id('modal-body').innerHTML = `
  <h3 style="margin:0 0 8px">Registrar pago — Factura ${ESC(f.numero||'')}</h3>
  <p style="margin:0 0 12px;font-size:13px">Saldo actual: <b>$${parseFloat(f.saldo||0).toFixed(2)}</b></p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <div><label class="lbl-web">Fecha</label><input id="fp-fec" type="date" class="inp-web" value="${_hoyLocal()}"></div>
    <div><label class="lbl-web">Forma</label>
      <select id="fp-forma" class="inp-web"><option>EFECTIVO</option><option selected>TRANSFERENCIA</option><option>CHEQUE</option></select></div>
    <div><label class="lbl-web">Valor</label><input id="fp-val" type="number" class="inp-web" value="${parseFloat(f.saldo||0).toFixed(2)}" step="0.01"></div>
    <div><label class="lbl-web">Referencia</label><input id="fp-ref" class="inp-web" placeholder="N° transf., cheque..."></div>
  </div>
  <div style="display:flex;gap:8px;margin-top:16px">
    <button class="btn-web prim" onclick="_factRegistrarPago('${id}')">💵 Registrar</button>
    <button class="btn-web sec" onclick="cerrarModal()">Cancelar</button>
  </div>`;
  $id('modal-overlay').style.display = 'flex';
};

window._factRegistrarPago = async function(id) {
  const f = _factList.find(x => x.id === id);
  if (!f) return;
  const val = parseFloat($id('fp-val')?.value || 0);
  if (val <= 0) { toast('⚠ Valor inválido'); return; }
  const nuevo_pag = Math.min(parseFloat(f.pagado||0) + val, parseFloat(f.total||0));
  const nuevo_sal = Math.max(parseFloat(f.total||0) - nuevo_pag, 0);
  const est = nuevo_sal <= 0 ? 'CANCELADA' : 'PARCIAL';
  try {
    await API.insert('factura_pagos', {
      id_factura: f.id_escritorio || id, fecha: $id('fp-fec')?.value, forma: $id('fp-forma')?.value,
      valor: val, referencia: $id('fp-ref')?.value?.trim(), actualizado: _ahoraISO(), sync_origen: 'WEB'
    });
    await API.update('facturas', id, {pagado: nuevo_pag, saldo: nuevo_sal, estado: est, actualizado: _ahoraISO(), sync_origen: 'WEB'});
    f.pagado = nuevo_pag; f.saldo = nuevo_sal; f.estado = est;
    cerrarModal(); _factCargar();
    toast('✅ Pago de $' + val.toFixed(2) + ' registrado');
  } catch(e) { toast('❌ ' + e.message); }
};

// ── Proformas ────────────────────────────────────────────────────────
let _profList = [];
async function _profCargar() {
  const est = $id('prof-estado')?.value || 'TODAS';
  const q   = ($id('prof-q')?.value || '').toLowerCase();
  try {
    _profList = await API.select('proformas').catch(() => []);
    await _cliPorCodigo();
  } catch(e) { return; }
  let ff = est === 'TODAS' ? _profList : _profList.filter(p => p.estado === est);
  if (q) ff = ff.filter(p => [p.numero, _cliNom(p), p.serie].some(x => String(x||'').toLowerCase().includes(q)));
  const tbody = $id('prof-tbody');
  if (!tbody) return;
  tbody.innerHTML = ff.map(p => {
    const color = p.estado==='APROBADA'||p.estado==='PROGRAMADA' ? '#1E8449' :
                  p.estado==='RECHAZADA' ? '#922B21' :
                  p.estado==='EJECUTADA' ? '#2471A3' : '';
    return `<tr style="color:${color}">
      <td>${ESC(p.numero||'')}</td><td>${ESC(_cliNom(p)||'—')}</td>
      <td>${ESC(p.serie||'')}</td><td>${ESC(p.fecha||'')}</td>
      <td>$${parseFloat(p.total||0).toFixed(2)}</td>
      <td style="font-size:11px">${ESC(p.estado||'')}</td>
      <td>${ESC(p.numero_ot||'')}</td>
      <td style="display:flex;gap:4px">
        <button class="btn-web sec" style="font-size:11px;padding:2px 5px" onclick="_profEstado('${p.id}','APROBADA')">✔</button>
        <button class="btn-web sec" style="font-size:11px;padding:2px 5px;background:#922B21;color:#fff" onclick="_profEstado('${p.id}','RECHAZADA')">✖</button>
        <button class="btn-web sec" style="font-size:11px;padding:2px 5px;background:#117A65;color:#fff" onclick="_profEstado('${p.id}','ENVIADA')">📤</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="color:#888;text-align:center;padding:10px">Sin proformas</td></tr>';
}

window._profNueva = function() { _profDialogo(null); };

function _profDialogo(id) {
  const p = id ? (_profList.find(x => x.id === id) || {}) : {};
  cerrarModal();
  const hoy = _hoyLocal();
  $id('modal-body').innerHTML = `
  <h3 style="margin:0 0 12px">${id ? 'Editar proforma' : 'Nueva proforma / cotización'}</h3>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <div><label class="lbl-web">Serie del equipo</label>
      <div style="display:flex;gap:4px">
        <input id="pv-serie" class="inp-web" value="${ESC(p.serie||'')}" placeholder="Número de serie" style="flex:1">
        <button class="btn-web sec" onclick="_profBuscarSerie()">Buscar</button>
      </div>
      <div id="pv-cli-info" style="font-size:11px;color:#117A65;margin-top:2px">${p.razon_social ? '✓ ' + ESC(p.razon_social) : ''}</div>
    </div>
    <div><label class="lbl-web">N° proforma</label>
      <input id="pv-num" class="inp-web" value="${ESC(p.numero||'')}"></div>
    <div><label class="lbl-web">Fecha</label>
      <input id="pv-fecha" type="date" class="inp-web" value="${ESC(p.fecha||hoy)}"></div>
    <div><label class="lbl-web">Validez (días)</label>
      <input id="pv-validez" type="number" class="inp-web" value="${p.validez_dias||15}"></div>
    <div><label class="lbl-web">Tipo mantenimiento</label>
      <input id="pv-tipo" class="inp-web" value="${ESC(p.tipo_mantenimiento||'')}" placeholder="Ej: MANTENIMIENTO PREVENTIVO"></div>
    <div><label class="lbl-web">IVA %</label>
      <input id="pv-iva" type="number" class="inp-web" value="${p.iva_pct||15}"></div>
    <div style="grid-column:1/-1"><label class="lbl-web">Total (con IVA)</label>
      <input id="pv-total" type="number" class="inp-web" value="${p.total||0}" step="0.01"></div>
    <div style="grid-column:1/-1"><label class="lbl-web">Observación / detalle</label>
      <textarea id="pv-obs" class="inp-web" rows="3" style="width:100%">${ESC(p.observacion||'')}</textarea></div>
  </div>
  <input type="hidden" id="pv-idcli" value="${p.id_cliente||''}">
  <input type="hidden" id="pv-idequipo" value="${p.id_equipo||''}">
  <div style="display:flex;gap:8px;margin-top:16px">
    <button class="btn-web prim" onclick="_profGuardar('${id||''}')">💾 Guardar</button>
    <button class="btn-web sec" onclick="cerrarModal()">Cancelar</button>
  </div>`;
  $id('modal-overlay').style.display = 'flex';
}

window._profBuscarSerie = async function() {
  const serie = $id('pv-serie')?.value?.trim();
  if (!serie) return;
  try {
    const eqs = await API.select('equipos', {serie});
    const eq  = eqs && eqs[0];
    if (!eq) { const el=$id('pv-cli-info'); if(el){el.textContent='✖ Equipo no encontrado';el.style.color='#E74C3C';} return; }
    const clis = await API.select('clientes', {id: eq.id_cliente}).catch(()=>[]);
    const c = clis && clis[0];
    if ($id('pv-idcli'))    $id('pv-idcli').value    = eq.id_cliente||'';
    if ($id('pv-idequipo')) $id('pv-idequipo').value = eq.id||'';
    const el = $id('pv-cli-info');
    if (el) { el.textContent = '✓ ' + ((c&&c.razon_social)||'—'); el.style.color='#117A65'; }
  } catch(e) { toast('❌ ' + e.message); }
};

window._profGuardar = async function(id) {
  const idcli = $id('pv-idcli')?.value;
  if (!idcli) { toast('⚠ Busca una serie para vincular el cliente'); return; }
  const total = parseFloat($id('pv-total')?.value || 0);
  const ivap  = parseFloat($id('pv-iva')?.value   || 15);
  const datos = {
    numero: $id('pv-num')?.value?.trim() || 'PRF-' + Date.now().toString().slice(-6),
    id_cliente: idcli, id_equipo: $id('pv-idequipo')?.value || null,
    razon_social: ($id('pv-cli-info')?.textContent||'').replace('✓ ',''),
    serie: $id('pv-serie')?.value?.trim() || '',
    fecha: $id('pv-fecha')?.value || '', validez_dias: parseInt($id('pv-validez')?.value||15),
    tipo_mantenimiento: $id('pv-tipo')?.value?.trim() || '',
    iva_pct: ivap, total,
    observacion: $id('pv-obs')?.value?.trim() || '',
    estado: id ? undefined : 'PENDIENTE'
  };
  try {
    if (id) await API.update('proformas', id, datos);
    else    await API.insert('proformas', datos);
    cerrarModal(); _profList = []; await _profCargar();
    toast('✅ Proforma guardada');
  } catch(e) { toast('❌ ' + e.message); }
};

window._profEstado = async function(id, estado) {
  try {
    await API.update('proformas', id, {estado});
    _profList = []; await _profCargar();
    toast('✅ Estado → ' + estado);
  } catch(e) { toast('❌ ' + e.message); }
};

VIEWS.clientes = ()=>{
  if (!API.hayNube()) { $id('main').innerHTML='<div class="card"><h2>👥 Clientes</h2><div style="background:#FFF3CD;border:1.5px solid #F5A623;border-radius:10px;padding:14px;text-align:center"><p><b>☁ Sin conexión Supabase</b></p><p style="font-size:13px">Ve a Configuración e ingresa la anon key.</p><button class="btn-web prim" onclick="PROSOL_WEB.irConfig()">⚙ Configuración</button></div></div>'; return; }
  crudSimple({
  tabla:'clientes',titulo:'👥 Clientes',
  cols:[{k:'id_escritorio',t:'Código'},{k:'razon_social',t:'Razón social'},{k:'contacto',t:'Contacto'},{k:'telefono',t:'Teléfono'},{k:'ciudad',t:'Ciudad'},{k:'estado',t:'Estado',pill:1}],
  campos:[{k:'razon_social',t:'Razón social'},{k:'identificacion',t:'RUC/Cédula'},{k:'contacto',t:'Contacto'},{k:'telefono',t:'Teléfono'},{k:'email',t:'Email'},{k:'ciudad',t:'Ciudad'},{k:'direccion',t:'Dirección'},{k:'estado',t:'Estado',tipo:'sel',opts:['ACTIVO','INACTIVO']}]
}); };

/* ── Equipos ────────────────────────────────────────────────────────── */
VIEWS.equipos = ()=>{
  if (!API.hayNube()) { $id('main').innerHTML='<div class="card"><h2>⚡ Equipos Generac</h2><div style="background:#FFF3CD;border:1.5px solid #F5A623;border-radius:10px;padding:14px;text-align:center"><p><b>☁ Sin conexión Supabase</b></p><button class="btn-web prim" onclick="PROSOL_WEB.irConfig()">⚙ Configuración</button></div></div>'; return; }
  crudSimple({
  tabla:'equipos',titulo:'⚡ Equipos Generac',
  cols:[{k:'id_escritorio',t:'Código'},{k:'serie',t:'Serie'},{k:'marca',t:'Marca'},{k:'modelo',t:'Modelo'},{k:'potencia_kw',t:'kW'},{k:'estado',t:'Estado',pill:1}],
  campos:[{k:'serie',t:'Serie'},{k:'marca',t:'Marca'},{k:'modelo',t:'Modelo'},{k:'potencia_kw',t:'kW',tipo:'num'},{k:'voltaje',t:'Voltaje'},{k:'combustible',t:'Combustible'},{k:'ubicacion',t:'Ubicación'},{k:'estado',t:'Estado',tipo:'sel',opts:['ACTIVO','INACTIVO']}]
}); };

/* ── Inventario completo ──────────────────────────────────────────────────── */
VIEWS.inventario = async ()=>{
  if (!API.hayNube()) { $id('main').innerHTML='<div class="card"><h2>📦 Inventario</h2><div style="background:#FFF3CD;border:1.5px solid #F5A623;border-radius:10px;padding:14px;text-align:center"><p><b>☁ Sin conexión Supabase</b></p><button class="btn-web prim" onclick="PROSOL_WEB.irConfig()">⚙ Configuración</button></div></div>'; return; }
  $id('main').innerHTML=`<div class="card"><h2>📦 Inventario y guías</h2>
    <div class="toolbar">
      <input id="invQ" class="inp-web" style="max-width:220px" placeholder="Buscar código, nombre...">
      <select id="invCat" class="inp-web" style="max-width:180px"><option value="">Todas las categorías</option></select>
      <select id="invEst" class="inp-web" style="max-width:160px">
        <option value="">Todos los estados</option>
        <option value="BAJO">⚠ Stock bajo</option>
        <option value="ACTIVO">Activo</option>
        <option value="INACTIVO">Inactivo</option>
      </select>
    </div>
    <p style="font-size:12px;color:#666;margin:0 0 6px">📦 Repuestos reales del escritorio (stock por movimientos). Consulta en la web; altas, ingresos y salidas se hacen en el escritorio por ahora.</p>
    <div id="listaInv">Cargando…</div>
  </div>`;
  let inv=await API.select('inventario').catch(()=>[]);
  // Llenar categorías
  const cats=[...new Set(inv.map(i=>i.categoria||'Sin categoría').filter(Boolean))].sort();
  const selCat=$id('invCat');
  cats.forEach(cat=>{const o=document.createElement('option');o.value=cat;o.textContent=cat;selCat.appendChild(o);});
  function pintar(){
    const q=($id('invQ').value||'').toLowerCase();
    const cat=$id('invCat').value;
    const est=$id('invEst').value;
    const filas=inv.filter(i=>{
      const bajo=Number(i.stock||0)<=Number(i.stock_minimo||0);
      return (!q||[i.codigo_item,i.nombre_item,i.categoria].some(x=>String(x||'').toLowerCase().includes(q)))
        &&(!cat||(i.categoria||'Sin categoría')===cat)
        &&(!est||(est==='BAJO'?bajo:i.estado===est));
    }).map(i=>{
      const bajo=Number(i.stock||0)<=Number(i.stock_minimo||0);
      return[ESC(i.codigo_item||'—'),ESC(i.nombre_item||'—'),ESC(i.categoria||'—'),
        `<span style="font-weight:700;color:${bajo?'#E74C3C':'#1C2733'}">${i.stock||0}</span>`,
        i.stock_minimo||0,
        bajo?`<span style="color:#E74C3C;font-weight:700">⚠ REPONER (faltan ${Number(i.stock_minimo||0)-Number(i.stock||0)})</span>`
            :`<span style="color:#27AE60;font-weight:700">OK</span>`,
        ESC(i.unidad||'')];
    });
    $id('listaInv').innerHTML=tabla(['Código','Nombre','Categoría','Stock actual','Stock mín.','Estado','Unidad'],filas)||'<p style="color:#888;padding:16px">Sin registros.</p>';
  }
  $id('invQ').addEventListener('input',pintar);
  $id('invCat').addEventListener('change',pintar);
  $id('invEst').addEventListener('change',pintar);
  pintar();
};

function _editarInv(id,inv,onSave){
  const i=id?inv.find(x=>x.id===id):null;
  modal(`<h3>${i?'Editar':'Nuevo'} ítem de inventario</h3>
    <div class="grid2">
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">Código</label>
        <input class="inp-web" id="iv_cod" value="${ESC(i?i.codigo_item||'':'')}">
        <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Nombre</label>
        <input class="inp-web" id="iv_nom" value="${ESC(i?i.nombre_item||'':'')}">
        <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Categoría</label>
        <input class="inp-web" id="iv_cat" value="${ESC(i?i.categoria||'':'')}">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">Stock actual</label>
        <input class="inp-web" id="iv_stk" type="number" value="${i?i.stock||0:0}">
        <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Stock mínimo</label>
        <input class="inp-web" id="iv_min" type="number" value="${i?i.stock_minimo||0:0}">
        <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Estado</label>
        <select class="inp-web" id="iv_est">
          <option ${(!i||i.estado==='ACTIVO')?'selected':''}>ACTIVO</option>
          <option ${(i&&i.estado==='INACTIVO')?'selected':''}>INACTIVO</option>
        </select>
      </div>
    </div>
    <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Descripción / observaciones</label>
    <textarea class="inp-web" id="iv_obs" rows="2">${ESC(i?i.descripcion||'':'')}</textarea>
    <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
      <button class="btn-web sec" id="ivCerrar">Cancelar</button>
      <button class="btn-web prim" id="ivGuardar">Guardar</button>
    </div>`);
  $id('ivCerrar').addEventListener('click',cerrarModal);
  $id('ivGuardar').addEventListener('click',async()=>{
    const row={codigo_item:$id('iv_cod').value.trim(),nombre_item:$id('iv_nom').value.trim(),
      categoria:$id('iv_cat').value.trim(),stock:parseFloat($id('iv_stk').value)||0,
      stock_minimo:parseFloat($id('iv_min').value)||0,estado:$id('iv_est').value,
      descripcion:$id('iv_obs').value.trim()};
    try{
      if(i) await API.update('inventario',i.id,row);
      else await API.insert('inventario',row);
      cerrarModal();toast('✅ Guardado');
      if(onSave) onSave(); else VIEWS.inventario();
    }catch(e){toast('❌ '+e.message);}
  });
}

/* ── Reportes completos con treeview y filtros ─────────────────────────────── */
VIEWS.reportes = async ()=>{
  $id('main').innerHTML=`<div class="card"><h2>📄 Reportes globales</h2>
    <div class="toolbar" style="flex-wrap:wrap;gap:8px">
      <input id="bOT" class="inp-web" style="max-width:150px" placeholder="N° de OT exacto">
      <button class="btn-web prim" id="btnBusOT">🔍 Buscar OT</button>
      <input id="bCli" class="inp-web" style="max-width:200px" placeholder="Nombre cliente...">
      <button class="btn-web prim" id="btnBusCli">👥 Buscar cliente</button>
      <input id="bSer" class="inp-web" style="max-width:150px" placeholder="N° serie equipo...">
      <button class="btn-web prim" id="btnBusSer">⚡ Buscar serie</button>
    </div>
    <div class="toolbar" style="gap:8px;border-top:1px solid #D5DBE1;padding-top:8px;margin-top:0">
      <select id="tipoRep" class="inp-web" style="max-width:220px">
        <option value="estado">OT por estado</option>
        <option value="tecnico">OT por técnico</option>
        <option value="cliente">OT por cliente</option>
        <option value="prog">Visitas programadas</option>
      </select>
      <input id="repFiltro" class="inp-web" style="max-width:200px" placeholder="Filtrar resultados...">
      <button class="btn-web sec" id="btnGenRep">📊 Generar</button>
      <button class="btn-web sec" onclick="window.print()">🖨 Imprimir</button>
    </div>
    <div id="repOut" style="margin-top:12px"><p style="color:#888">Usa los filtros para generar un reporte.</p></div>
  </div>`;

  let _ordenes=[], _clientes=[], _equipos=[], _prog=[];
  async function cargarDatos(){
    if(!_ordenes.length){
      [_ordenes,_clientes,_equipos,_prog]=await Promise.all([
        API.select('ordenes').catch(()=>[]),API.select('clientes').catch(()=>[]),
        API.select('equipos').catch(()=>[]),API.select('visitas_programadas').catch(()=>[])
      ]);
    }
  }

  // Buscar OT por número
  $id('btnBusOT').addEventListener('click',async()=>{
    const num=($id('bOT').value||'').trim();if(!num){toast('⚠ Ingresa el N° de OT');return;}
    await cargarDatos();
    const rows=_ordenes.filter(o=>(o.numero_ot||'').toString()===num);
    if(!rows.length){$id('repOut').innerHTML='<p style="color:#E74C3C">No se encontró OT N° '+ESC(num)+'</p>';return;}
    const o=rows[0];
    const acts=await API.select('ot_actividades',{id_orden:o.id}).catch(()=>[]);
    $id('repOut').innerHTML=_fichaOT(o,acts,_clientes,_equipos);
  });

  // Buscar por cliente
  $id('btnBusCli').addEventListener('click',async()=>{
    const q=($id('bCli').value||'').trim().toLowerCase();if(!q){toast('⚠ Ingresa nombre del cliente');return;}
    await cargarDatos();
    const cliMap={}; _clientes.forEach(c=>cliMap[c.id]=c);
    const eqMap={}; _equipos.forEach(e=>eqMap[e.id]=e);
    const clis=_clientes.filter(c=>(c.razon_social||'').toLowerCase().includes(q));
    if(!clis.length){$id('repOut').innerHTML='<p style="color:#E74C3C">No se encontraron clientes con "'+ESC($id('bCli').value)+'"</p>';return;}
    let html='';
    for(const cli of clis){
      const eqsCli=_equipos.filter(e=>e.id_cliente===cli.id);
      const otsCli=_ordenes.filter(o=>o.id_cliente===cli.id||o.cliente_nombre===cli.razon_social);
      html+=`<div class="card" style="border-left:4px solid #F5A623">
        <h3>👥 ${ESC(cli.razon_social||'—')}</h3>
        <p style="font-size:13px"><b>RUC/Cédula:</b> ${ESC(cli.identificacion||'—')} · <b>Tel:</b> ${ESC(cli.telefono||'—')} · <b>Ciudad:</b> ${ESC(cli.ciudad||'—')}</p>
        <p style="font-size:13px"><b>Equipos:</b> ${eqsCli.length} · <b>OT:</b> ${otsCli.length}</p>
        ${eqsCli.length?`<div style="margin-top:8px"><b style="font-size:12px">Equipos Generac:</b>`+
          tabla(['Serie','Código','Modelo','kW','Estado'],
            eqsCli.map(e=>[ESC(e.serie||'—'),ESC(e.codigo||'—'),ESC(e.modelo||'—'),e.potencia_kw||'—',
              `<span style="color:${e.estado==='ACTIVO'?'#27AE60':'#888'};font-weight:700">${ESC(e.estado||'—')}</span>`]))+'</div>':''}
        ${otsCli.length?`<div style="margin-top:8px"><b style="font-size:12px">Historial de OT:</b>`+
          tabla(['N°','Fecha','Serie','Tipo','Técnico','Estado'],
            otsCli.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')).slice(0,20)
              .map(o=>[`<b>${ESC(o.numero_ot||'—')}</b>`,ESC(o.fecha||'—'),ESC(o.serie||'—'),
                ESC(o.tipo_ot||'—'),ESC(o.firma_realiza||'—'),
                `<span style="color:${{'REALIZADO':'#27AE60','EN PROCESO':'#F39C12','POR REVISAR':'#E67E22'}[o.estado]||'#888'};font-weight:700">${ESC(o.estado||'—')}</span>`]))+'</div>':''}
      </div>`;
    }
    $id('repOut').innerHTML=html;
  });

  // Buscar por serie
  $id('btnBusSer').addEventListener('click',async()=>{
    const ser=($id('bSer').value||'').trim().toLowerCase();if(!ser){toast('⚠ Ingresa la serie');return;}
    await cargarDatos();
    const cliMap={}; _clientes.forEach(c=>cliMap[c.id]=c);
    const eq=_equipos.find(e=>(e.serie||'').toLowerCase()===ser||(e.serie||'').toLowerCase().includes(ser));
    if(!eq){$id('repOut').innerHTML='<p style="color:#E74C3C">No se encontró equipo con serie "'+ESC($id('bSer').value)+'"</p>';return;}
    const cli=cliMap[eq.id_cliente]||{};
    const ots=_ordenes.filter(o=>o.id_equipo===eq.id||(o.serie||'').toLowerCase()===ser).sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
    $id('repOut').innerHTML=`<div class="card" style="border-left:4px solid #27AE60">
      <h3>⚡ Equipo Serie: ${ESC(eq.serie||'—')}</h3>
      <div class="grid2">
        <div><p><b>Código:</b> ${ESC(eq.codigo||'—')}</p><p><b>Marca:</b> ${ESC(eq.marca||'GENERAC')}</p>
          <p><b>Modelo:</b> ${ESC(eq.modelo||'—')}</p><p><b>Potencia:</b> ${eq.potencia_kw||'—'} kW</p></div>
        <div><p><b>Cliente:</b> ${ESC(cli.razon_social||'—')}</p><p><b>Tel:</b> ${ESC(cli.telefono||'—')}</p>
          <p><b>Ciudad:</b> ${ESC(cli.ciudad||'—')}</p><p><b>Estado:</b> ${ESC(eq.estado||'—')}</p></div>
      </div>
      ${ots.length?`<div style="margin-top:12px"><b>Historial de mantenimiento (${ots.length} OT):</b>`+
        tabla(['N°','Fecha','Tipo','Técnico','Horas máq.','Estado'],
          ots.map(o=>[`<b>${ESC(o.numero_ot||'—')}</b>`,ESC(o.fecha||'—'),ESC(o.tipo_ot||'—'),
            ESC(o.firma_realiza||'—'),o.horas_maquina||'—',
            `<span style="color:${{'REALIZADO':'#27AE60','EN PROCESO':'#F39C12','POR REVISAR':'#E67E22'}[o.estado]||'#888'};font-weight:700">${ESC(o.estado||'—')}</span>`]))+'</div>':'<p style="color:#888">Sin OT registradas para este equipo.</p>'}
    </div>`;
  });

  // Reporte por tipo con filtro en vivo
  $id('btnGenRep').addEventListener('click',async()=>{
    await cargarDatos();
    await _generarTipoRep($id('tipoRep').value,$id('repFiltro').value||'',_ordenes,_clientes,_equipos,_prog);
  });
  $id('repFiltro').addEventListener('input',async()=>{
    await cargarDatos();
    await _generarTipoRep($id('tipoRep').value,$id('repFiltro').value||'',_ordenes,_clientes,_equipos,_prog);
  });
};

function _fichaOT(o,acts,clientes,equipos){
  const cliMap={}; clientes.forEach(c=>cliMap[c.id]=c);
  const eqMap={}; equipos.forEach(e=>eqMap[e.id]=e);
  const cli=cliMap[o.id_cliente]||{};
  return `<div class="card" style="border-left:4px solid #F5A623">
    <h3>OT N° ${ESC(o.numero_ot||o.id_escritorio||'—')}</h3>
    <div class="grid2">
      <div><p><b>Fecha:</b> ${ESC(o.fecha||'—')}</p><p><b>Cliente:</b> ${ESC(cli.razon_social||o.cliente_nombre||'—')}</p>
        <p><b>RUC:</b> ${ESC(cli.identificacion||'—')}</p><p><b>Serie:</b> ${ESC(o.serie||'—')}</p></div>
      <div><p><b>Tipo:</b> ${ESC(o.tipo_ot||'—')}</p><p><b>Técnico:</b> ${ESC(o.firma_realiza||'—')}</p>
        <p><b>Estado:</b> <b style="color:${ {'REALIZADO':'#27AE60','EN PROCESO':'#F39C12','POR REVISAR':'#E67E22'}[o.estado]||'#888' }">${ESC(o.estado||'—')}</b></p>
        <p><b>Origen:</b> ${ESC(o.origen||'—')}</p></div>
    </div>
    ${o.horas_maquina?`<p><b>Horas máquina:</b> ${o.horas_maquina}</p>`:''}
    ${o.trabajo_realizado?`<p><b>Trabajo realizado:</b><br>${ESC(o.trabajo_realizado)}</p>`:''}
    ${o.observaciones?`<p><b>Observaciones:</b><br>${ESC(o.observaciones)}</p>`:''}
    ${o.gps_link?`<p><b>GPS:</b> <a href="${ESC(o.gps_link)}" target="_blank">Ver en Maps</a></p>`:''}
    ${acts&&acts.length?`<p><b>Actividades:</b></p><ul>${acts.map(a=>`<li>${ESC(a.descripcion||a.DESCRIPCION||'')}</li>`).join('')}</ul>`:''}
  </div>`;
}

async function _generarTipoRep(tipo,filtro,ord,cli,eq,prog){
  filtro=(filtro||'').toLowerCase();
  const cliMap={}; cli.forEach(c=>cliMap[c.id]=c);
  const hoy=_hoyLocal();
  let html='';
  if(tipo==='estado'){
    const g={}; ord.forEach(o=>{const k=o.estado||'SIN';(g[k]=g[k]||[]).push(o);});
    html=Object.entries(g).map(([est,ots])=>{
      const ff=filtro?ots.filter(o=>[o.numero_ot,o.cliente_nombre,(cliMap[o.id_cliente]||{}).razon_social,o.serie].some(x=>String(x||'').toLowerCase().includes(filtro))):ots;
      if(!ff.length) return '';
      return `<div class="card"><h3>${ESC(est)} <span style="font-size:13px;color:#888">(${ff.length} OT)</span></h3>`+
        tabla(['N°','Fecha','Cliente','Serie','Tipo','Técnico'],ff.slice(0,50).map(o=>[
          `<b>${ESC(o.numero_ot||'—')}</b>`,ESC(o.fecha||'—'),
          ESC((cliMap[o.id_cliente]||{}).razon_social||o.cliente_nombre||'—'),
          ESC(o.serie||'—'),ESC(o.tipo_ot||'—'),ESC(o.firma_realiza||'—')]))+`</div>`;
    }).join('');
  } else if(tipo==='tecnico'){
    const g={}; ord.forEach(o=>{const k=o.firma_realiza||'Sin asignar';(g[k]=g[k]||[]).push(o);});
    html=Object.entries(g).map(([t,ots])=>{
      const ff=filtro?ots.filter(o=>t.toLowerCase().includes(filtro)||[o.numero_ot,o.cliente_nombre,o.serie].some(x=>String(x||'').toLowerCase().includes(filtro))):ots;
      if(!ff.length) return '';
      return `<div class="card"><h3>🧑‍🔧 ${ESC(t)} <span style="font-size:13px;color:#888">(${ff.length} OT)</span></h3>`+
        tabla(['N°','Fecha','Cliente','Serie','Tipo','Estado'],ff.slice(0,20).map(o=>[
          `<b>${ESC(o.numero_ot||'—')}</b>`,ESC(o.fecha||'—'),
          ESC((cliMap[o.id_cliente]||{}).razon_social||o.cliente_nombre||'—'),
          ESC(o.serie||'—'),ESC(o.tipo_ot||'—'),ESC(o.estado||'—')]))+`</div>`;
    }).join('');
  } else if(tipo==='cliente'){
    const g={}; ord.forEach(o=>{const k=(cliMap[o.id_cliente]||{}).razon_social||o.cliente_nombre||'Sin';(g[k]=g[k]||[]).push(o);});
    html=Object.entries(g).filter(([k])=>!filtro||k.toLowerCase().includes(filtro)).map(([cl,ots])=>
      `<div class="card"><h3>👥 ${ESC(cl)} <span style="font-size:13px;color:#888">(${ots.length} OT)</span></h3>`+
      tabla(['N°','Fecha','Serie','Tipo','Técnico','Estado'],ots.slice(0,20).map(o=>[
        `<b>${ESC(o.numero_ot||'—')}</b>`,ESC(o.fecha||'—'),ESC(o.serie||'—'),
        ESC(o.tipo_ot||'—'),ESC(o.firma_realiza||'—'),ESC(o.estado||'—')]))+`</div>`).join('');
  } else if(tipo==='prog'){
    const ff=filtro?prog.filter(p=>[p.serie,p.tipo_mantenimiento,({})[p.id_equipo]].some(x=>String(x||'').toLowerCase().includes(filtro))):prog;
    const eqMap={}; eq.forEach(e=>eqMap[e.id]=e);
    html=`<div class="card"><h3>📅 Visitas programadas <span style="font-size:13px;color:#888">(${ff.length})</span></h3>`+
      tabla(['Fecha','Equipo','Serie','Tipo','Estado'],ff.sort((a,b)=>(a.fecha_programada||'').localeCompare(b.fecha_programada||'')).map(p=>{
        const e=eqMap[p.id_equipo]||{};const venc=p.fecha_programada&&p.fecha_programada<hoy;
        return [`<span style="color:${venc?'#E74C3C':'inherit'};font-weight:${venc?'700':'400'}">${ESC(p.fecha_programada||'—')}${venc?' ⚠':''}</span>`,
          ESC(e.nombre_equipo||p.serie||'—'),ESC(p.serie||'—'),ESC(p.tipo_mantenimiento||'—'),ESC(p.estado||'PROGRAMADA')];
      }))+`</div>`;
  }
  $id('repOut').innerHTML=html||'<p style="color:#888">Sin resultados con los filtros aplicados.</p>';
}

/* ── WhatsApp — formato exacto del v16 con filtro cliente ──────────────────── */
VIEWS.whatsapp = async ()=>{
  if (!API.hayNube()) { $id('main').innerHTML='<div class="card"><h2>💬 WhatsApp</h2><div style="background:#FFF3CD;border:1.5px solid #F5A623;border-radius:10px;padding:14px;text-align:center"><p><b>☁ Sin conexión Supabase</b></p><button class="btn-web prim" onclick="PROSOL_WEB.irConfig()">⚙ Configuración</button></div></div>'; return; }
  $id('main').innerHTML=`<div class="card"><h2>💬 Comunicaciones — WhatsApp</h2>
    <div class="grid2">
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">Destinatario (con código de país)</label>
        <input id="waTel" class="inp-web" placeholder="+593987654321" value="${ESC(localStorage.getItem('prosol_wa_tel')||'+593970155684')}">
        <label style="display:block;font-size:12px;font-weight:700;margin:10px 0 4px">Filtrar por cliente</label>
        <input id="waCliFiltro" class="inp-web" placeholder="Escribe nombre del cliente...">
        <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Seleccionar OT (escribe para filtrar)</label>
        <input id="waOrdInput" class="inp-web" placeholder="Escribe N° OT o nombre cliente..." list="waOrdList">
        <datalist id="waOrdList"></datalist>
        <input type="hidden" id="waOrdSel">
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn-web sec" id="btnWaPrev">🔄 Vista previa</button>
          <button class="btn-web prim" id="btnWaEnv">📲 Enviar WhatsApp</button>
        </div>
        <p style="font-size:11px;color:#888;margin-top:8px">El mensaje incluirá el detalle completo de la OT.<br>
          Las fotos adjuntas se comparten automáticamente si están disponibles.</p>
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">Vista previa del mensaje</label>
        <textarea id="waMsg" style="width:100%;height:240px;font-size:12px;font-family:monospace;border:1.5px solid #D5DBE1;border-radius:8px;padding:10px;box-sizing:border-box;resize:vertical"></textarea>
        <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Editar mensaje antes de enviar</label>
        <p style="font-size:11px;color:#888">Puedes modificar el texto en el área de arriba antes de enviar.</p>
      </div>
    </div>
  </div>
  <div class="card" style="margin-top:12px">
    <h3>📋 Historial de comunicaciones</h3>
    <div id="histWA">Cargando…</div>
  </div>`;

  let _todosOrd = [];
  const [ord,cli,eq] = await Promise.all([
    API.select('ordenes').catch(()=>[]),
    API.select('clientes').catch(()=>[]),
    API.select('equipos').catch(()=>[])
  ]);
  _todosOrd = [...ord].sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''));
  const cliMap={}; cli.forEach(c=>cliMap[c.id]=c);
  const eqMap={}; eq.forEach(e=>eqMap[e.id]=e);
  window._waTodosOrd = _todosOrd;
  window._waCliMap = cliMap;
  window._waEqMap = eqMap;

  // Mapa id → orden para búsqueda rápida
  window._waOrdMap = {};
  _todosOrd.forEach(o => { window._waOrdMap[o.id] = o; });

  function llenarDatalist(lista) {
    const dl = $id('waOrdList'); if(!dl) return;
    dl.innerHTML = '';
    [...lista].sort((a,b) => {
      const na = parseInt(a.numero_ot||'0'), nb = parseInt(b.numero_ot||'0');
      return nb - na;
    }).forEach(o => {
      const c2 = cliMap[o.id_cliente]||{};
      const opt = document.createElement('option');
      opt.value = `N° ${o.numero_ot||'—'} — ${c2.razon_social||o.cliente_nombre||'—'} (Serie: ${o.serie||'—'}) — ${o.fecha||'—'}`;
      opt.dataset.oid = o.id;
      dl.appendChild(opt);
    });
  }
  llenarDatalist(_todosOrd);

  // Al escribir en el input, buscar en datalist y actualizar waOrdSel
  $id('waOrdInput').addEventListener('change', () => {
    const val = ($id('waOrdInput').value||'').trim();
    const opts = Array.from($id('waOrdList').options);
    const found = opts.find(o => o.value === val);
    if (found) {
      $id('waOrdSel').value = found.dataset.oid || '';
      _waGenerar && _waGenerar();
    }
  });
  // También al perder foco (móvil)
  $id('waOrdInput').addEventListener('blur', () => {
    $id('waOrdInput').dispatchEvent(new Event('change'));
  });

  // Filtro por cliente con addEventListener
  $id('waCliFiltro').addEventListener('input', () => {
    const q = ($id('waCliFiltro').value||'').toLowerCase().trim();
    if (!q) { llenarDatalist(_todosOrd); return; }
    const filtrado = _todosOrd.filter(o => {
      const c2 = cliMap[o.id_cliente]||{};
      return (c2.razon_social||o.cliente_nombre||'').toLowerCase().includes(q);
    });
    llenarDatalist(filtrado);
    // Limpiar selección actual
    $id('waOrdInput').value = '';
    $id('waOrdSel').value = '';
  });
  // Mantener compatibilidad por si se llama externamente
  _waFiltrarOrd = () => $id('waCliFiltro').dispatchEvent(new Event('input'));

  _waGenerar = async () => {
    const id=($id('waOrdSel')||{}).value; if(!id) return;
    const o=_todosOrd.find(x=>x.id===id)||(window._waOrdMap&&window._waOrdMap[id]); if(!o) return;
    const cli2=_waCliMap[o.id_cliente]||{};
    const eq2=_waEqMap[o.id_equipo]||{};
    const acts=await API.select('ot_actividades',{id_orden:id}).catch(()=>[]);
    const plantilla=localStorage.getItem('prosol_wa_plantilla')||'— Enviado desde PROSOL · ROCKENSY S.A. & MIG — Tec. Master Luis Martínez Ibáñez · Cel: 096 701 5684';
    const L=[];
    // Cabecera empresa
    L.push('*PROSOL · ROCKENSY S.A.*');
    L.push('_Mantenimiento de generadores Generac_');
    L.push('');
    L.push('Estimado/a *'+(cli2.razon_social||o.cliente_nombre||'—')+'*,');
    L.push('Reciba un cordial saludo de parte de *PROSOL*.');
    L.push('');
    L.push('Le escribimos respecto al mantenimiento de su equipo:');
    L.push('• *Equipo:* GENERAC');
    L.push('• *Serie:* '+(o.serie||'—'));
    L.push('');
    // Resumen de mantenimiento
    L.push('*Resumen de mantenimiento*');
    L.push('• *N° OT:* '+(o.numero_ot||'—'));
    L.push('• *Fecha:* '+(o.fecha||'—'));
    L.push('• *Tipo:* '+(o.tipo_ot||'—'));
    L.push('• *Técnico:* '+(o.firma_realiza||'—'));
    if(o.horas_maquina!=null&&o.horas_maquina!=='') L.push('• *Horas máquina:* '+o.horas_maquina);
    // Actividades
    if(acts.length){
      L.push('');
      L.push('*Servicio a realizar:* '+( o.tipo_ot||'MANTENIMIENTO'));
      L.push('_Incluye las siguientes actividades:_');
      acts.forEach(a=>{
        const desc=a.descripcion||a.DESCRIPCION||'';
        const nivel=a.nivel||'rubro';
        const pref=nivel==='sub'?'   - ':nivel==='adicional'?'+ ':'✓ ';
        L.push(pref+desc);
      });
    }
    // Trabajo realizado
    if(o.trabajo_realizado){
      L.push('');L.push('*Trabajo / observaciones:*');L.push(o.trabajo_realizado);
    }
    // GPS
    if(o.gps_link){L.push('');L.push('📍 *Ubicación del servicio:*');L.push(o.gps_link);}
    // Cierre
    L.push('');
    L.push(plantilla);
    const wa=$id('waMsg'); if(wa) wa.value=L.join('\n');
    return id;
  };

  $id('btnWaPrev').addEventListener('click', () => _waGenerar && _waGenerar());

  $id('btnWaEnv').addEventListener('click',async()=>{
    const id=await _waGenerar(); if(!id){toast('⚠ Selecciona una OT');return;}
    const msg=($id('waMsg').value||'').trim();
    const tel=($id('waTel').value||'').replace(/\D/g,'');
    if(!tel){toast('⚠ Ingresa el número de destino');return;}
    window.open('https://wa.me/'+tel+'?text='+encodeURIComponent(msg),'_blank');
    try{
      await API.insert('comunicaciones',{destinatario:'+'+tel,telefono:'+'+tel,id_orden:id,mensaje:msg,estado:'ENVIADO'});
      toast('✅ Enviado y guardado en historial');_cargarHistWA();
    }catch(e){toast('✅ Enviado (historial no disponible)');}
  });

  async function _cargarHistWA(){
    try{
      const h=await API.select('comunicaciones').catch(()=>[]);
      const out=$id('histWA'); if(!out) return;
      out.innerHTML=h.length
        ? tabla(['Fecha','Destinatario','N° OT','Estado',''],
            h.sort((a,b)=>(b.fecha||b.creado||'').localeCompare(a.fecha||a.creado||'')).slice(0,30)
              .map(h2=>[ESC((h2.fecha||h2.creado||'').slice(0,16).replace('T',' ')),
                ESC(h2.destinatario||h2.telefono||'—'),ESC(h2.id_orden||'—'),
                ESC(h2.estado||'—'),
                `<button class="btn-web mini sec" onclick="PROSOL_WEB._reenviarComm('${h2.id}')">↻</button>`]))
        : '<p style="color:#888;padding:8px">Sin comunicaciones enviadas aún.</p>';
    }catch(e){$id('histWA').innerHTML='<p style="color:#888">Tabla comunicaciones no disponible.</p>';}
  }
  _cargarHistWA();
};

/* ── Configuración ──────────────────────────────────────────────────── */
VIEWS.config = async ()=>{
  const info=API.infoNube?API.infoNube():{};
  $id('main').innerHTML=`<div class="card"><h2>⚙ Configuración</h2>
    <h3>☁ Conexión Supabase</h3>
    <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">Project URL</label>
    <input id="cfgUrl" class="inp-web" value="${ESC(info.url||'')}">
    <label style="display:block;font-size:12px;font-weight:700;margin:10px 0 4px">anon key</label>
    <input id="cfgKey" class="inp-web" type="password" placeholder="eyJhbGci...">
    <div style="display:flex;gap:8px;margin:12px 0">
      <button class="btn-web prim" id="cfgGuardar">💾 Guardar</button>
      <button class="btn-web verd" id="cfgProbar">🔌 Probar conexión</button>
    </div>
    <p id="cfgMsg" style="font-size:13px;color:#27AE60;min-height:18px"></p>
    <hr style="margin:16px 0;border:none;border-top:1px solid #D5DBE1">
    <h3>📲 WhatsApp remitente</h3>
    <p style="font-size:12px;color:#888;margin-bottom:6px">Número desde el que se envían los mensajes (con código de país). Se pre-llena automáticamente en el módulo WhatsApp.</p>
    <input id="cfgWaTel" class="inp-web" placeholder="+593987654321" value="${ESC(localStorage.getItem('prosol_wa_tel')||'+593970155684')}">
    <div style="margin-top:8px">
      <button class="btn-web prim" id="cfgGuardarTel">💾 Guardar número</button>
    </div>
    <p id="cfgTelMsg" style="font-size:12px;color:#27AE60;min-height:16px;margin-top:4px"></p>
    <hr style="margin:16px 0;border:none;border-top:1px solid #D5DBE1">
    <h3>👥 Usuarios del sistema</h3>
    <div id="cfgUsuarios">Cargando…</div>
    <button class="btn-web prim" id="btnNuevoUsr" style="margin-top:10px">➕ Nuevo usuario</button>
    <hr style="margin:16px 0;border:none;border-top:1px solid #D5DBE1">
    <h3>💬 Plantilla WhatsApp</h3>
    <p style="font-size:12px;color:#888;margin-bottom:6px">Edita el texto fijo que se agrega al final de cada mensaje de OT. Usa {N_OT}, {TECNICO}, {CLIENTE}, {SERIE}, {FECHA}, {TIPO} como variables.</p>
    <textarea id="cfgPlantilla" class="inp-web" rows="5" style="resize:vertical;font-size:12px">${ESC(localStorage.getItem('prosol_wa_plantilla')||'— Enviado desde PROSOL · ROCKENSY S.A. & MIG — Tec. Master Luis Martínez Ibáñez · Cel: 096 701 5684')}</textarea>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn-web prim" id="cfgGuardarPlant">💾 Guardar plantilla</button>
      <button class="btn-web sec" id="cfgResetPlant">↺ Restaurar default</button>
    </div>
    <p id="cfgPlantMsg" style="font-size:12px;color:#27AE60;min-height:16px;margin-top:4px"></p>
    <hr style="margin:16px 0;border:none;border-top:1px solid #D5DBE1">
    <h3>ℹ App Móvil</h3>
    <p style="font-size:13px">URL: <b>https://rockensy.github.io/prosol-app/</b></p>
    <p style="font-size:13px">Usa las mismas credenciales Supabase que el sistema de escritorio.</p>
    <p style="font-size:12px;color:#888;margin-top:4px">Versión actual: <b>PROSOL v4.05</b></p>
  </div>`;
  $id('cfgGuardar').addEventListener('click',()=>{
    const url=($id('cfgUrl').value||'').trim().replace(/\/+$/,'');
    const key=($id('cfgKey').value||'').trim();
    if (!url || !key) { $id('cfgMsg').textContent='⚠ Completa URL y anon key.'; return; }
    API.configurar(url,key);
    if($id('sb-url-inp')) $id('sb-url-inp').value=url;
    if($id('sb-key-inp')) $id('sb-key-inp').value=key;
    // Quitar el aviso si está visible
    const av = document.getElementById('aviso-sin-key'); if(av) av.remove();
    $id('cfgMsg').textContent='✅ Credenciales guardadas. Navega a otro módulo para ver los datos.';
    // Actualizar el badge de conexión
    const net = document.getElementById('netStatus');
    if (net) net.className = 'net-dot online';
  });
  $id('cfgProbar').addEventListener('click',async()=>{
    $id('cfgMsg').textContent='⏳ Probando...';
    try{await API.probarNube();$id('cfgMsg').textContent='✅ Conexión OK con Supabase';}
    catch(e){$id('cfgMsg').textContent='❌ '+e.message;}
  });

  // Guardar número de remitente WhatsApp
  $id('cfgGuardarTel').addEventListener('click',()=>{
    const tel=($id('cfgWaTel').value||'').trim();
    if(!tel){$id('cfgTelMsg').textContent='⚠ Ingresa el número'; return;}
    localStorage.setItem('prosol_wa_tel', tel);
    $id('cfgTelMsg').textContent='✅ Número guardado correctamente';
    setTimeout(()=>{ const m=$id('cfgTelMsg'); if(m) m.textContent=''; }, 2500);
  });

  // Plantilla WhatsApp
  const PLANTILLA_DEFAULT = '— Enviado desde PROSOL · ROCKENSY S.A. & MIG — Tec. Master Luis Martínez Ibáñez · Cel: 096 701 5684';
  $id('cfgGuardarPlant').addEventListener('click',()=>{
    const v=$id('cfgPlantilla').value||PLANTILLA_DEFAULT;
    localStorage.setItem('prosol_wa_plantilla',v);
    $id('cfgPlantMsg').textContent='✅ Plantilla guardada';
    setTimeout(()=>{ const m=$id('cfgPlantMsg'); if(m) m.textContent=''; },2000);
  });
  $id('cfgResetPlant').addEventListener('click',()=>{
    $id('cfgPlantilla').value=PLANTILLA_DEFAULT;
    localStorage.removeItem('prosol_wa_plantilla');
    $id('cfgPlantMsg').textContent='✅ Plantilla restaurada al default';
  });

  // Usuarios
  async function cargarUsuarios(){
    // v3.53: en la nube la tabla usuarios está protegida; se lista con la función del servidor
    // y solo con la contraseña del administrador confirmada (se guarda solo en memoria).
    if(API.hayNube() && !AUTH.credAdmin()){
      $id('cfgUsuarios').innerHTML=`<p style="color:#555;font-size:13px;margin:0 0 6px">🔒 Para ver y editar usuarios confirma tu contraseña de administrador.</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><input class="inp-web" id="cfgAdmPwd" type="password" placeholder="Tu contraseña" style="max-width:220px">
        <button class="btn-web prim" id="cfgAdmOk">Confirmar</button></div><p id="cfgAdmMsg" style="color:#E74C3C;font-size:12px;margin:6px 0 0"></p>`;
      const ok=async()=>{ try{ await AUTH.confirmarAdmin($id('cfgAdmPwd').value); cargarUsuarios(); }catch(e){ $id('cfgAdmMsg').textContent='❌ '+e.message; } };
      $id('cfgAdmOk').addEventListener('click',ok);
      $id('cfgAdmPwd').addEventListener('keydown',e=>{ if(e.key==='Enter') ok(); });
      return;
    }
    try{
      const usrs=API.hayNube() ? await AUTH.listarUsuariosNube() : await API.select('usuarios').catch(()=>[]);
      _usrsCache=usrs;
      $id('cfgUsuarios').innerHTML=usrs.length
        ? tabla(['Usuario','Nombre','Perfil','Estado','Técnico vinculado',''],
            usrs.map(u=>[ESC(u.usuario||'—'),ESC(u.nombre||'—'),ESC(u.perfil||'—'),
              `<span style="color:${u.estado==='ACTIVO'?'#27AE60':'#E74C3C'};font-weight:700">${ESC(u.estado||'—')}</span>`,
              ESC(u.id_tecnico||'—'),
              `<button class="btn-web mini sec" data-uid="${u.id}">✎ Editar</button>`]))
        : '<p style="color:#888;font-size:13px">Sin usuarios. Agrega uno.</p>';
      $id('cfgUsuarios').querySelectorAll('[data-uid]').forEach(b=>
        b.addEventListener('click',()=>_editarUsuario(b.dataset.uid,usrs)));
    }catch(e){$id('cfgUsuarios').innerHTML='<p style="color:#888;font-size:13px">No disponible (tabla usuarios no encontrada).</p>';}
  }
  cargarUsuarios();

  $id('btnNuevoUsr').addEventListener('click',()=>{ if(API.hayNube() && !AUTH.credAdmin()){ toast('🔒 Primero confirma tu contraseña de administrador (en Usuarios del sistema)'); const i=$id('cfgAdmPwd'); if(i) i.focus(); return; } _editarUsuario(null,_usrsCache||[]); });
};
let _usrsCache=[];

async function _editarUsuario(id, lista){
  const u=id?lista.find(x=>x.id===id):null;
  // v3.62: vínculo OPCIONAL con un técnico registrado (técnicos activos sin usuario + el ya vinculado)
  const tecs=(await API.select('tecnicos').catch(()=>[]))||[];
  const usados=new Set((lista||[]).filter(x=>x.id_tecnico && (!u || x.id!==u.id)).map(x=>x.id_tecnico));
  const tecOpc=tecs.filter(t=>t.id_escritorio && !/INACTIV|ARCHIV/i.test(t.estado||'') && !usados.has(t.id_escritorio))
    .map(t=>({id:t.id_escritorio, nom:[t.nombres,t.apellidos].filter(Boolean).join(' ')})).sort((a,b)=>a.nom.localeCompare(b.nom));
  modal(`<h3>${u?'Editar':'Nuevo'} usuario</h3>
    <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">Usuario (login)</label>
    <input class="inp-web" id="uu_usr" value="${ESC(u?u.usuario||'':'')}" placeholder="ej. admin">
    <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Nombre completo</label>
    <input class="inp-web" id="uu_nom" value="${ESC(u?u.nombre||'':'')}">
    <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Vincular con técnico (opcional)</label>
    <select class="inp-web" id="uu_tec"><option value="">(ninguno)</option>${tecOpc.map(t=>`<option value="${ESC(t.id)}" data-nom="${ESC(t.nom)}" ${u&&u.id_tecnico===t.id?'selected':''}>${ESC(t.id)} · ${ESC(t.nom)}</option>`).join('')}</select>
    <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Nueva contraseña</label>
    <input class="inp-web" id="uu_pwd" type="password" placeholder="${u?'Dejar vacío para no cambiar':'Contraseña nueva'}">
    <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Perfil</label>
    <select class="inp-web" id="uu_per">
      <option ${(!u||u.perfil==='ADMIN')?'selected':''}>ADMIN</option>
      <option ${u&&u.perfil==='VENDEDOR'?'selected':''}>VENDEDOR</option>
      <option ${u&&u.perfil==='TECNICO'?'selected':''}>TECNICO</option>
      <option ${u&&u.perfil==='OPERADOR'?'selected':''}>OPERADOR</option>
    </select>
    <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Estado</label>
    <select class="inp-web" id="uu_est">
      <option ${(!u||u.estado==='ACTIVO')?'selected':''}>ACTIVO</option>
      <option ${u&&u.estado==='INACTIVO'?'selected':''}>INACTIVO</option>
    </select>
    <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
      <button class="btn-web sec" id="uuCerrar">Cancelar</button>
      <button class="btn-web prim" id="uuGuardar">Guardar</button>
    </div>`);
  $id('uuCerrar').addEventListener('click',cerrarModal);
  $id('uu_tec').addEventListener('change',()=>{ const o=$id('uu_tec').selectedOptions[0];
    if(o&&o.value){ if(!$id('uu_nom').value.trim()) $id('uu_nom').value=o.dataset.nom||''; if(!u) $id('uu_per').value='TECNICO'; } });
  $id('uuGuardar').addEventListener('click',async()=>{
    const usr=$id('uu_usr').value.trim();
    const nom=$id('uu_nom').value.trim();
    const pwd=$id('uu_pwd').value;
    if(!usr){toast('⚠ El nombre de usuario es obligatorio');return;}
    const row={usuario:usr,nombre:nom,perfil:$id('uu_per').value,estado:$id('uu_est').value,id_tecnico:$id('uu_tec').value||''};
    // v3.53: en la nube se guarda con la función del servidor (valida al administrador, sal aleatoria por usuario)
    if(API.hayNube()){
      if(!u && !pwd){toast('⚠ La contraseña es obligatoria para un usuario nuevo');return;}
      try{ await AUTH.guardarUsuarioNube(u?u.id:null,row,pwd||null); cerrarModal(); toast('✅ Usuario guardado'); VIEWS.config(); }
      catch(e){ toast('❌ '+(e.message||e)); }
      return;
    }
    // Hash de contraseña si se ingresó
    if(pwd){
      try{
        const enc=new TextEncoder().encode('prosol2026:'+pwd);
        const buf=await crypto.subtle.digest('SHA-256',enc);
        row.clave_hash=Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
        row.salt='prosol2026';
      }catch(e){toast('❌ Error al cifrar contraseña');return;}
    }
    try{
      if(u) await API.update('usuarios',u.id,row);
      else await API.insert('usuarios',row);
      cerrarModal();toast('✅ Usuario guardado');VIEWS.config();
    }catch(e){toast('❌ '+e.message);}
  });
}

/* ── Helpers: CRUD simple y formulario OT ───────────────────────────── */
async function crudSimple(cfg){
  $id('main').innerHTML=`<div class="card"><h2>${cfg.titulo}</h2>
    <div class="toolbar"><input id="q" class="inp-web" style="max-width:240px" placeholder="Buscar...">
    <button class="btn-web prim" id="btnNuevo">➕ Nuevo</button></div>
    <div id="lista">Cargando…</div></div>`;
  let datos=await API.select(cfg.tabla).catch(()=>[]);
  function pintar(){
    const q=($id('q').value||'').toLowerCase();
    const filas=datos.filter(d=>!q||cfg.cols.some(c=>String(d[c.k]||'').toLowerCase().includes(q))).map(d=>{
      const celdas=cfg.cols.map(c=>c.pill
        ?`<span style="background:${d[c.k]==='ACTIVO'?'#27AE6022':'#E74C3C22'};color:${d[c.k]==='ACTIVO'?'#27AE60':'#E74C3C'};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">${ESC(d[c.k]||'')}</span>`
        :ESC(d[c.k]||''));
      celdas.push(`<span style="display:flex;gap:4px">
        <button class="btn-web mini sec" data-ed="${d.id}">✎</button>
        <button class="btn-web mini" style="background:#E74C3C22;color:#E74C3C" data-del="${d.id}">🗑</button></span>`);
      return celdas;
    });
    $id('lista').innerHTML=tabla(cfg.cols.map(c=>c.t).concat(['Acciones']),filas);
    $id('lista').querySelectorAll('[data-ed]').forEach(b=>b.addEventListener('click',()=>_formCrud(datos.find(x=>x.id===b.dataset.ed),cfg,async()=>{datos=await API.select(cfg.tabla).catch(()=>[]);pintar();})));
    $id('lista').querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',async()=>{
      if(!confirm('¿Eliminar?'))return;
      await API.remove(cfg.tabla,b.dataset.del);
      datos=await API.select(cfg.tabla).catch(()=>[]);pintar();toast('Eliminado');
    }));
  }
  $id('q').addEventListener('input',pintar);
  $id('btnNuevo').addEventListener('click',()=>_formCrud(null,cfg,async()=>{datos=await API.select(cfg.tabla).catch(()=>[]);pintar();}));
  pintar();
}

function _formCrud(d,cfg,onSave){
  d=d||{};
  modal(`<h3>${d.id?'Editar':'Nuevo'} — ${cfg.titulo}</h3>
    <div class="grid2">${cfg.campos.map(f=>{
      if(f.tipo==='sel') return`<div><label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">${ESC(f.t)}</label>
        <select class="inp-web" id="ff_${f.k}">${f.opts.map(o=>`<option ${d[f.k]===o?'selected':''}>${o}</option>`).join('')}</select></div>`;
      return`<div><label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">${ESC(f.t)}</label>
        <input class="inp-web" id="ff_${f.k}" type="${f.tipo==='num'?'number':'text'}" value="${ESC(d[f.k]||'')}"></div>`;
    }).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
      <button class="btn-web sec" id="fCerrar">Cancelar</button>
      <button class="btn-web prim" id="fGuardar">Guardar</button></div>`);
  $id('fCerrar').addEventListener('click',cerrarModal);
  $id('fGuardar').addEventListener('click',async()=>{
    const row={};
    cfg.campos.forEach(f=>{const v=$id('ff_'+f.k).value;row[f.k]=f.tipo==='num'?(parseFloat(v)||0):v;});
    try{
      let res=null;
      if(d.id) await API.update(cfg.tabla,d.id,row);
      else res=await API.insert(cfg.tabla,row);
      const nuevo=(Array.isArray(res)?res[0]:res)||{};   // M10: la nube asigna el código CLI-/EQ-
      cerrarModal();toast('✅ Guardado'+(nuevo.id_escritorio?' · código '+nuevo.id_escritorio:''));onSave();
    }catch(e){toast('❌ '+e.message);}
  });
}

async function _formNuevaOT(prefill,eq,cli,tec,onSave,acts,actItems){
  prefill=prefill||{};
  acts=acts||[]; actItems=actItems||[];
  const actsActivas = acts.filter(a=>(a.estado||'ACTIVO')==='ACTIVO');
  const combos = actsActivas.filter(a=>a.tipo==='COMBO').sort((a,b)=>(a.descripcion||'').localeCompare(b.descripcion||''));
  const individuales = actsActivas.filter(a=>a.tipo!=='COMBO').sort((a,b)=>(a.descripcion||'').localeCompare(b.descripcion||''));
  const actsOrdenadas = [...combos,...individuales];
  const eqLabel = e => `${ESC(e.serie||'')} — ${ESC(e.codigo||'')} — ${ESC(e.nombre_equipo||e.modelo||'')}`;
  const eqInicial = eq.find(e=>e.id===prefill.id_equipo);
  const cliInicial = cli.find(c=>c.id===prefill.id_cliente);
  modal(`<h3>➕ Nueva Orden de Trabajo</h3>
    <div class="grid2">
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">N° de orden (talonario físico) *</label>
        <input class="inp-web" id="ot_num" placeholder="Ej. 1550" value="${ESC(prefill.numero_ot||'')}">
        <p style="font-size:11px;color:#888;margin:2px 0 8px">Número del talonario físico. Se registra en oficina exactamente así.</p>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">Equipo</label>
        <div style="position:relative">
          <input class="inp-web" id="ot_eq_q" autocomplete="off" placeholder="Escribe serie, código o nombre..." value="${eqInicial?eqLabel(eqInicial).replace(/<[^>]*>/g,''):''}">
          <input type="hidden" id="ot_eq" value="${prefill.id_equipo||''}">
          <div id="ot_eq_list" style="display:none;position:absolute;z-index:50;left:0;right:0;top:100%;background:#fff;border:1px solid #D5DBE1;border-radius:6px;max-height:220px;overflow-y:auto;box-shadow:0 4px 10px rgba(0,0,0,.12)"></div>
        </div>
        <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Cliente</label>
        <div style="position:relative">
          <input class="inp-web" id="ot_cli_q" autocomplete="off" placeholder="Escribe el nombre del cliente..." value="${cliInicial?ESC(cliInicial.razon_social||''):''}">
          <input type="hidden" id="ot_cli" value="${prefill.id_cliente||''}">
          <div id="ot_cli_list" style="display:none;position:absolute;z-index:50;left:0;right:0;top:100%;background:#fff;border:1px solid #D5DBE1;border-radius:6px;max-height:220px;overflow-y:auto;box-shadow:0 4px 10px rgba(0,0,0,.12)"></div>
        </div>
        <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Tipo de mantenimiento / actividad</label>
        <select class="inp-web" id="ot_tipo" onchange="PROSOL_WEB._cargarActsCatalogo()">
          <option value="">— Seleccionar —</option>
          ${combos.map(a=>`<option value="${ESC(a.id)}" data-desc="${ESC(a.descripcion||'')}">🧩 ${ESC(a.descripcion||'')}</option>`).join('')}
          ${individuales.map(a=>`<option value="${ESC(a.id)}" data-desc="${ESC(a.descripcion||'')}">${ESC(a.descripcion||'')}</option>`).join('')}
          ${prefill.tipo_ot&&!actsOrdenadas.some(a=>a.descripcion===prefill.tipo_ot)?`<option value="__custom__" selected data-desc="${ESC(prefill.tipo_ot)}">${ESC(prefill.tipo_ot)}</option>`:''}
        </select>
        <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Fecha</label>
        <input class="inp-web" id="ot_fecha" type="date" value="${_hoyLocal()}">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">Técnico</label>
        <select class="inp-web" id="ot_tec"><option value="">— Seleccionar —</option>
          ${tec.map(t=>`<option value="${t.id}">${ESC((t.nombres||'')+' '+(t.apellidos||''))}</option>`).join('')}</select>
        <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Estado</label>
        <select class="inp-web" id="ot_est">
          <option>REALIZADO</option><option>EN PROCESO</option><option>ABIERTA</option>
        </select>
        <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Horas máquina (lectura)</label>
        <input class="inp-web" id="ot_horas" type="number" placeholder="Ej. 1450">
        <label style="display:block;font-size:12px;font-weight:700;margin:8px 0 4px">Ubicación GPS (opcional)</label>
        <div style="display:flex;gap:8px">
          <input class="inp-web" id="ot_gps" placeholder="Lat, Lng o link Maps" style="flex:1" readonly>
          <button class="btn-web sec" id="btnGpsOT">📍</button>
        </div>
      </div>
    </div>
    <label style="display:block;font-size:12px;font-weight:700;margin:12px 0 4px">Actividades realizadas</label>
    <div id="ot_acts_container" style="border:1px solid #D5DBE1;border-radius:8px;padding:8px;min-height:60px;margin-bottom:8px">
      <p style="color:#888;font-size:12px;margin:0" id="ot_acts_hint">Se cargan según el tipo de mantenimiento.</p>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <input class="inp-web" id="ot_act_nueva" placeholder="Agregar actividad adicional..." style="flex:1">
      <button class="btn-web sec" id="btnAddAct">➕</button>
    </div>
    <label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">Trabajo realizado / observaciones</label>
    <textarea class="inp-web" id="ot_trab" rows="3" style="resize:vertical" placeholder="Describe el trabajo realizado..."></textarea>
    <label style="display:block;font-size:12px;font-weight:700;margin:12px 0 4px">📷 Fotos (evidencias)</label>
    <div id="ot_fotos_grid" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px"></div>
    <input type="file" id="ot_fotos_input" accept="image/*" capture="environment" multiple style="display:none">
    <button class="btn-web sec" id="btnAddFoto" type="button">📷 Agregar foto(s)</button>
    <p style="font-size:11px;color:#888;margin:4px 0 0">Se guardan junto con la OT y llegan al escritorio en la próxima sincronización.</p>
    <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
      <button class="btn-web sec" id="otCerrar">Cancelar</button>
      <button class="btn-web prim" id="otGuardar">💾 Guardar OT</button>
    </div>`);

  // GPS
  $id('btnGpsOT').addEventListener('click',()=>{
    if(!navigator.geolocation){toast('GPS no disponible');return;}
    toast('📍 Capturando ubicación...');
    navigator.geolocation.getCurrentPosition(pos=>{
      const lat=pos.coords.latitude.toFixed(6),lng=pos.coords.longitude.toFixed(6);
      $id('ot_gps').value=lat+','+lng;
      $id('ot_gps').dataset.lat=lat; $id('ot_gps').dataset.lng=lng;
      toast('✅ GPS capturado');
    },()=>toast('⚠ No se pudo obtener GPS'),{timeout:10000});
  });

  // Actividades del catálogo (reales: 32 actividades, igual que escritorio/móvil)
  const _actsExtra = [];
  _cargarActsCatalogo = () => {
    const sel=$id('ot_tipo'); if(!sel) return;
    const idAct=sel.value;
    const opt=sel.options[sel.selectedIndex];
    const descTipo=opt?(opt.dataset.desc||opt.textContent.replace(/^🧩\s*/,'')):'';
    const cont=$id('ot_acts_container'); if(!cont) return;
    cont.innerHTML='';
    const actividad = actsOrdenadas.find(a=>a.id===idAct);
    let base=[];
    if(actividad && actividad.tipo==='COMBO'){
      base = actItems.filter(it=>it.id_actividad===actividad.id)
                      .sort((a,b)=>(a.orden||0)-(b.orden||0))
                      .map(it=>it.descripcion||'');
    } else if(descTipo){
      base = [descTipo];
    }
    base.forEach((desc,i) => {
      const div=document.createElement('div');
      div.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0f0f0;font-size:13px';
      div.innerHTML=`<span>▸ ${ESC(desc)}</span><button class="btn-web mini" style="background:#E74C3C22;color:#E74C3C;padding:2px 6px" data-ai="${i}">✕</button>`;
      div.querySelector('button').addEventListener('click',()=>div.remove());
      cont.appendChild(div);
    });
    // Agregar extras que se añadieron
    _actsExtra.forEach((desc,i)=>{
      const div=document.createElement('div');
      div.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0f0f0;font-size:13px;font-weight:700';
      div.innerHTML=`<span>➕ ${ESC(desc)}</span><button class="btn-web mini" style="background:#E74C3C22;color:#E74C3C;padding:2px 6px" data-ei="${i}">✕</button>`;
      div.querySelector('button').addEventListener('click',()=>div.remove());
      cont.appendChild(div);
    });
    if(base.length||_actsExtra.length){const h=$id('ot_acts_hint');if(h)h.remove();}
  };
  _cargarActsCatalogo();

  // Combos buscables (Equipo / Cliente) — filtro dinámico, parcial, insensible a mayúsculas
  function _wireComboBuscable(qId,hidId,listId,items,getLabel,getSub,onSelect){
    const inp=$id(qId), hid=$id(hidId), list=$id(listId);
    if(!inp||!hid||!list) return;
    function render(filtro){
      const f=(filtro||'').toLowerCase().trim();
      const filtrados = f
        ? items.filter(it=>getLabel(it).toLowerCase().includes(f) || (getSub&&getSub(it)||'').toLowerCase().includes(f))
        : items;
      const top = filtrados.slice(0,80);
      if(!top.length){ list.innerHTML='<div style="padding:8px;color:#888;font-size:12px">Sin resultados</div>'; list.style.display='block'; return; }
      list.innerHTML = top.map(it=>`<div class="combo-op" data-id="${ESC(it.id)}" style="padding:6px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid #f2f2f2">${ESC(getLabel(it))}</div>`).join('');
      list.style.display='block';
      list.querySelectorAll('[data-id]').forEach(op=>{
        op.addEventListener('mouseenter',()=>op.style.background='#F5F7FA');
        op.addEventListener('mouseleave',()=>op.style.background='');
        op.addEventListener('click',()=>{
          const it=items.find(x=>x.id===op.dataset.id);
          hid.value = it?it.id:'';
          inp.value = it?getLabel(it):'';
          list.style.display='none';
          if(onSelect) onSelect(it);
        });
      });
    }
    inp.addEventListener('focus',()=>render(inp.value));
    inp.addEventListener('input',()=>{ hid.value=''; render(inp.value); });
    inp.addEventListener('blur',()=>setTimeout(()=>{list.style.display='none';},150));
  }
  // Cadena de datos Equipo↔Cliente: al elegir un equipo, autocompleta el cliente
  // dueño de ese equipo (igual que el escritorio al "Cargar" por N° de serie).
  // Al elegir un cliente directamente, filtra la lista de equipos a los suyos.
  let _eqListaActiva = eq;
  _wireComboBuscable('ot_eq_q','ot_eq','ot_eq_list',eq,eqLabel,e=>e.nombre_equipo||e.modelo||'', function(equipoSel){
    if(!equipoSel || !equipoSel.id_cliente) return;
    const cliRelacionado = cli.find(c=>c.id===equipoSel.id_cliente);
    if(cliRelacionado){
      $id('ot_cli').value = cliRelacionado.id;
      $id('ot_cli_q').value = cliRelacionado.razon_social || '';
    }
  });
  _wireComboBuscable('ot_cli_q','ot_cli','ot_cli_list',cli,c=>c.razon_social||'',c=>c.identificacion||'', function(cliSel){
    if(!cliSel) return;
    // Si el equipo actualmente cargado no pertenece a este cliente, lo limpiamos
    // para no dejar una combinación equipo/cliente inconsistente.
    const idEqActual=$id('ot_eq').value;
    const eqActual = idEqActual?eq.find(e=>e.id===idEqActual):null;
    if(eqActual && eqActual.id_cliente && eqActual.id_cliente!==cliSel.id){
      $id('ot_eq').value=''; $id('ot_eq_q').value='';
    }
  });

  // Fotos (evidencias) — mismo formato que ya espera el escritorio al bajar
  // OT de campo: array de {data_url, nombre_archivo, tipo}. v3.51: data_url es el
  // enlace a la foto en el almacenamiento de Supabase (depósito prosol-fotos).
  const _fotosOT = [];
  function _pintarFotosOT(){
    const grid=$id('ot_fotos_grid'); if(!grid) return;
    grid.innerHTML = _fotosOT.map((f,i)=>`
      <div style="position:relative;width:84px;height:84px">
        <img src="${f.dataUrl}" style="width:84px;height:84px;object-fit:cover;border-radius:6px;border:1px solid #D5DBE1">
        <button type="button" class="btn-web mini" data-fi="${i}" style="position:absolute;top:2px;right:2px;background:#E74C3C;color:#fff;border-radius:50%;width:20px;height:20px;padding:0;line-height:1;font-size:11px">✕</button>
      </div>`).join('');
    grid.querySelectorAll('[data-fi]').forEach(b=>b.addEventListener('click',()=>{
      _fotosOT.splice(Number(b.dataset.fi),1); _pintarFotosOT();
    }));
  }
  const fotoInp=$id('ot_fotos_input'), btnFoto=$id('btnAddFoto');
  if(btnFoto&&fotoInp){
    btnFoto.addEventListener('click',()=>fotoInp.click());
    fotoInp.addEventListener('change',()=>{
      const files=[...fotoInp.files];
      let pendientes=files.length;
      files.forEach(file=>{
        const reader=new FileReader();
        reader.onload=()=>{
          _fotosOT.push({dataUrl:reader.result, nombre:file.name||('foto_'+Date.now()+'.jpg')});
          pendientes--; if(pendientes===0){ _pintarFotosOT(); toast('📷 '+files.length+' foto(s) agregada(s)'); }
        };
        reader.readAsDataURL(file);
      });
      fotoInp.value='';
    });
  }

  // Agregar actividad manual
  $id('btnAddAct').addEventListener('click',()=>{
    const inp=$id('ot_act_nueva'); const desc=(inp.value||'').trim(); if(!desc) return;
    _actsExtra.push(desc); inp.value=''; _cargarActsCatalogo();
  });

  $id('otCerrar').addEventListener('click',cerrarModal);
  $id('otGuardar').addEventListener('click',async()=>{
    const num=($id('ot_num').value||'').trim();
    if(!num){toast('⚠ El N° de orden es obligatorio');return;}
    // Recopilar actividades visibles
    const actsGuardar=[...$id('ot_acts_container').querySelectorAll('div')].map(d=>{
      const t=(d.querySelector('span')||{}).textContent||'';
      const nivel=t.startsWith('➕')?'adicional':t.startsWith('▸')?'sub':'rubro';
      return {descripcion:t.replace(/^[▸➕]\s*/,'').trim(),cantidad:1,valor:0,nivel};
    }).filter(a=>a.descripcion);
    const tecSel=$id('ot_tec'); const tecOpt=tecSel&&tecSel.options[tecSel.selectedIndex];
    const gpsInp=$id('ot_gps');
    const idEqSel=$id('ot_eq').value||null;
    // Buscar la serie real del equipo seleccionado (necesaria para que el
    // escritorio pueda resolver el equipo al bajar la OT desde Supabase)
    const eqSel=idEqSel?(eq||[]).find(e=>e.id===idEqSel):null;
    const tipoSel=$id('ot_tipo'); const tipoOpt=tipoSel&&tipoSel.options[tipoSel.selectedIndex];
    const tipoOtTexto = tipoOpt ? (tipoOpt.dataset.desc || tipoOpt.textContent.replace(/^🧩\s*/,'').trim()) : '';
    // v3.51: las fotos van al almacenamiento de Supabase; en la orden queda solo el enlace.
    // Si el almacenamiento no responde, la foto se guarda como antes (dentro de la orden) para no perderla.
    const fotosGuardar=[]; let fotosSinAlm=0; const sello=Date.now();
    for(let i=0;i<_fotosOT.length;i++){
      const f=_fotosOT[i]; let enlace=f.dataUrl;
      if(!API.esEnlaceFoto(f.dataUrl)){
        try{ enlace=await API.subirFoto('ot/pc-'+(num||'sin-numero')+'/'+sello+'_'+i+'_'+(f.nombre||'foto.jpg'),f.dataUrl); }
        catch(e){ fotosSinAlm++; }
      }
      fotosGuardar.push({data_url:enlace, nombre_archivo:f.nombre, tipo:'EVIDENCIA'});
    }
    if(fotosSinAlm) toast('⚠ '+fotosSinAlm+' foto(s) se guardaron sin almacenamiento (sin conexión al depósito); igual quedan en la orden');
    const row={
      numero_ot:num, id_equipo:idEqSel, id_cliente:$id('ot_cli').value||null,
      serie:eqSel?(eqSel.serie||''):'',
      tipo_ot:tipoOtTexto, fecha:$id('ot_fecha').value,
      firma_realiza:tecOpt&&tecOpt.value?tecOpt.text:'',
      estado:$id('ot_est').value,
      horas_maquina:$id('ot_horas').value?Number($id('ot_horas').value):null,
      trabajo_realizado:$id('ot_trab').value.trim(),
      gps_lat:gpsInp&&gpsInp.dataset.lat?Number(gpsInp.dataset.lat):null,
      gps_lng:gpsInp&&gpsInp.dataset.lng?Number(gpsInp.dataset.lng):null,
      gps_link:gpsInp&&gpsInp.dataset.lat?'https://maps.google.com/?q='+gpsInp.dataset.lat+','+gpsInp.dataset.lng:null,
      origen:'CAMPO', // BUGFIX: 'ESCRITORIO' hacía que bajar_ordenes_campo (que
      // filtra origen=CAMPO) nunca detectara las OT creadas desde la web —
      // el escritorio jamás las bajaba. Debe ser el mismo valor que usa móvil.
      ot_fotos: fotosGuardar
    };
    try{
      // Guardado resiliente: si Supabase rechaza el insert/update porque le
      // falta alguna columna en el esquema (error PGRST204, "Could not find
      // the 'X' column..."), se quita ese campo del payload y se reintenta
      // automáticamente. Así la OT se guarda igual aunque la nube todavía
      // no tenga esa columna creada (ej. ot_fotos), sin bloquear nada.
      async function _guardarConReintento(accion){
        let intentos=0;
        while(true){
          try{ return await accion(); }
          catch(e){
            const m=/['"]([a-zA-Z0-9_]+)['"]\s*column/.exec(e.message||'');
            if(m && row.hasOwnProperty(m[1]) && intentos<5){
              intentos++;
              console.warn('Columna "'+m[1]+'" no existe en Supabase todavía — se guarda la OT sin ese campo.');
              delete row[m[1]];
              continue;
            }
            throw e;
          }
        }
      }
      // Anti-duplicado: verificar si ya existe una OT con este número
      let nuevaOT;
      const numOT=(row.numero_ot||'').trim();
      let existentes=[];
      if(numOT){
        existentes=await API.select('ordenes',{numero_ot:'eq.'+numOT}).catch(()=>[]);
      }
      if(existentes && existentes.length){
        // Ya existe → actualizar la primera, no crear otra
        const idExist=existentes[0].id;
        // v3.58: al editar, las fotos que la orden ya tenía se conservan; las nuevas se agregan (antes se reemplazaban)
        if(row.hasOwnProperty('ot_fotos')){
          let prev=existentes[0].ot_fotos; if(typeof prev==='string'){ try{prev=JSON.parse(prev);}catch(e){prev=[];} }
          prev=Array.isArray(prev)?prev:[];
          const ya=new Set(prev.map(f=>f&&f.data_url));
          row.ot_fotos=prev.concat(fotosGuardar.filter(f=>!ya.has(f.data_url)));
        }
        await _guardarConReintento(()=>API.update('ordenes',idExist,row));
        nuevaOT=[{id:idExist}];
        // Limpiar actividades previas para no duplicarlas
        await API.remove('ot_actividades',{id_orden:'eq.'+idExist}).catch(()=>{});
      }else{
        nuevaOT=await _guardarConReintento(()=>API.insert('ordenes',row));
      }
      // Insertar actividades
      if(actsGuardar.length&&nuevaOT&&nuevaOT[0]){
        const idOrd=nuevaOT[0].id;
        for(const a of actsGuardar){
          await API.insert('ot_actividades',{id_orden:idOrd,descripcion:a.descripcion,
            cantidad:a.cantidad,valor:a.valor,nivel:a.nivel}).catch(()=>{});
        }
      }
      cerrarModal();toast('✅ OT guardada');if(onSave)onSave();
    }catch(e){toast('❌ '+e.message);}
  });
}


async function _nuevaOTDesde(pid,prog,eq,cli){
  const p=prog.find(x=>x.id===pid); if(!p) return;
  const [tec,acts,actItems]=await Promise.all([
    API.select('tecnicos').catch(()=>[]),
    API.select('actividades').catch(()=>[]),
    API.select('actividad_items').catch(()=>[])
  ]);
  ir('ordenes');
  setTimeout(()=>_formNuevaOT({id_equipo:p.id_equipo,id_cliente:p.id_cliente,tipo_ot:p.tipo_mantenimiento},eq,cli,tec,()=>VIEWS.ordenes(),acts,actItems),400);
}

async function _verOT(id,ord,eqMap,cliMap){
  const o=ord.find(x=>x.id===id); if(!o) return;
  const acts=await API.select('ot_actividades',{id_orden:id}).catch(()=>[]);
  const e=eqMap[o.id_equipo]||{}, c=cliMap[o.id_cliente]||{};
  modal(`<h3>OT N° ${ESC(o.numero_ot||'—')}</h3>
    <div class="grid2">
      <div><p><b>Fecha:</b> ${ESC(o.fecha||'—')}</p><p><b>Cliente:</b> ${ESC(c.razon_social||o.cliente_nombre||'—')}</p>
        <p><b>Serie:</b> ${ESC(o.serie||'—')}</p><p><b>Tipo:</b> ${ESC(o.tipo_ot||'—')}</p></div>
      <div><p><b>Técnico:</b> ${ESC(o.firma_realiza||'—')}</p><p><b>Estado:</b> ${ESC(o.estado||'—')}</p>
        <p><b>Origen:</b> ${ESC(o.origen||'—')}</p><p><b>Horas:</b> ${o.horas_maquina||'—'}</p></div>
    </div>
    ${o.trabajo_realizado?`<p><b>Trabajo:</b> ${ESC(o.trabajo_realizado)}</p>`:''}
    ${o.observaciones?`<p><b>Obs.:</b> ${ESC(o.observaciones)}</p>`:''}
    ${o.gps_link?`<p><b>GPS:</b> <a href="${ESC(o.gps_link)}" target="_blank">Ver en Maps</a></p>`:''}
    ${acts.length?`<ul>${acts.map(a=>`<li>${ESC(a.descripcion||'')}</li>`).join('')}</ul>`:''}
    <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
      <button class="btn-web prim" id="verWA">💬 WhatsApp</button>
      <button class="btn-web sec" id="verCerrar">Cerrar</button></div>`);
  $id('verCerrar').addEventListener('click',cerrarModal);
  $id('verWA').addEventListener('click',()=>{cerrarModal();ir('whatsapp');setTimeout(()=>{const s=$id('waOrdSel');if(s){s.value=id;$id('btnWaPrev')&&$id('btnWaPrev').click();}},500);});
}

/* ── Acceso administrador desde el móvil (<700px): muestra los módulos de escritorio ── */
function abrirLoginAdmin() {
  if ($id('loginWebPC')) return;
  window._prosolAdminMovil = true;
  document.body.classList.add('modo-admin');
  mostrarLogin();
  const btn = $id('wl_btn');
  if (btn && btn.parentElement) {
    const v = document.createElement('button');
    v.id = 'wl_volver'; v.textContent = '← Volver al modo campo';
    v.style.cssText = 'width:100%;padding:10px;background:#eee;color:#1C2733;border:none;border-radius:10px;font-weight:700;margin-top:8px;cursor:pointer';
    v.addEventListener('click', () => {
      const lv = $id('loginWebPC'); if (lv) lv.remove();
      window._prosolAdminMovil = false; document.body.classList.remove('modo-admin');
      const sb = $id('syncbar'), ap = $id('app'); if (sb) sb.style.display = ''; if (ap) ap.style.display = '';
    });
    btn.parentElement.appendChild(v);
  }
}

/* ── Logout ─────────────────────────────────────────────────────────── */
function logout(){
  if(typeof AUTH!=='undefined') AUTH.logout();
  location.reload();
}

/* ── Arranque ───────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  // Inicializar botones del panel Supabase (siempre, PC y móvil)
  initConfigPanel();
  // Solo en pantalla PC
  if (window.innerWidth >= 700) {
    mostrarLogin();
    activarActualizacionPC();
    // v3.70: datos del navegador protegidos y, si la sesión de la nube vence, se pide la clave del usuario
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    if (API.alNecesitarSesion && typeof AUTH !== 'undefined' && AUTH.pedirClave)
      API.alNecesitarSesion(async () => { const s = AUTH.sesion(); return s && s.usuario ? AUTH.pedirClave(s.usuario) : null; });
  }
});

/* v3.50: la vista PC también busca la versión nueva al abrir y se recarga sola al activarla
   (antes solo lo hacía la vista celular y el PC quedaba en la versión anterior). */
function activarActualizacionPC() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' }).then((reg) => {
    let recargado = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recargado) return; recargado = true; location.reload();
    });
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing; if (!nuevo) return;
      nuevo.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) nuevo.postMessage('activar-ya');
      });
    });
    reg.update().catch(() => {});
  }).catch(() => { /* sin service worker la vista PC sigue funcionando */ });
}

_irConfig = function() {
  const a = document.getElementById('aviso-sin-key'); if(a) a.remove();
  ir('config');
}
return { vistaBase: (v) => VIEWS[v], util: { $id, ESC, toast, modal, cerrarModal, tabla, hoy: () => _hoyLocal() }, logout, ir, abrirLoginAdmin, irConfig: _irConfig, _cargarActsCatalogo, _waFiltrarOrd: ()=>_waFiltrarOrd&&_waFiltrarOrd(), _waGenerar: ()=>_waGenerar&&_waGenerar(), _reenviarComm: (id)=>{ toast('ℹ Función pendiente de implementar'); }, abrirConfigPanel, cerrarModal };
})();
