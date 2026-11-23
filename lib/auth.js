/* lib/auth.js · SIPM-IA Web — autenticación real + usuarios/perfiles/permisos */
const AUTH = (() => {
  const LS_SES = 'prosol_sesion';
  let _user = null;

  // Módulos sobre los que se asignan permisos
  const MODULOS = ['dashboard', 'clientes', 'equipos', 'tecnicos', 'variables',
    'alertas', 'ordenes', 'mediciones', 'programacion', 'inventario',
    'indicadores', 'reportes', 'comunicaciones', 'eliza', 'config'];

  const PERFILES = {
    ADMIN:      Object.fromEntries(MODULOS.map((m) => [m, true])),
    SUPERVISOR: Object.fromEntries(MODULOS.map((m) => [m, m !== 'config'])),
    TECNICO:    { dashboard: true, clientes: true, equipos: true, ordenes: true,
                  mediciones: true, alertas: true, programacion: true,
                  inventario: true, indicadores: false, reportes: false,
                  variables: false, tecnicos: false, comunicaciones: false, eliza: true, config: false },
    CONSULTA:   { dashboard: true, clientes: true, equipos: true, ordenes: true,
                  mediciones: true, alertas: true, programacion: true,
                  inventario: true, indicadores: true, reportes: true,
                  variables: true, tecnicos: true, comunicaciones: false, eliza: true, config: false }
  };

  async function _hash(salt, clave) {
    const buf = new TextEncoder().encode(salt + ':' + clave);
    const h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function _salt() {
    const a = new Uint8Array(8); crypto.getRandomValues(a);
    return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Crea admin/admin si no hay usuarios
  async function asegurarAdmin() {
    // En nube la tabla usuarios no es legible con la anon key (RLS): no se intenta crear admin.
    if (API.hayNube()) return;
    const us = await API.select('usuarios');
    if (us && us.length) return;
    await crearUsuario({ usuario: 'admin', clave: 'admin', nombre: 'Administrador',
                         perfil: 'ADMIN' });
  }

  async function crearUsuario({ usuario, clave, nombre, perfil, permisos }) {
    const ex = await API.select('usuarios', { usuario });
    if (ex && ex.length) throw new Error('El usuario ya existe.');
    const salt = _salt();
    const clave_hash = await _hash(salt, clave);
    const perm = permisos || PERFILES[perfil] || PERFILES.TECNICO;
    return API.insert('usuarios', {
      usuario, clave_hash, salt, nombre: nombre || usuario,
      perfil: perfil || 'TECNICO', permisos: perm, estado: 'ACTIVO'
    });
  }

  async function cambiarClave(id, nuevaClave) {
    const salt = _salt();
    const clave_hash = await _hash(salt, nuevaClave);
    return API.update('usuarios', id, { salt, clave_hash });
  }

  async function actualizarUsuario(id, datos) { return API.update('usuarios', id, datos); }

  async function login(usuario, clave) {
    let u;
    if (API.hayNube()) {
      // Nube: la verificación la hace Supabase (funciones pwa_salt / pwa_login); el hash nunca sale de la base.
      const salt = await API.rpc('pwa_salt', { p_usuario: usuario });
      if (!salt) throw new Error('Usuario o clave incorrectos.');
      const hh = await _hash(salt, clave);
      u = await API.rpc('pwa_login', { p_usuario: usuario, p_hash: hh });
      if (!u) throw new Error('Usuario o clave incorrectos.');
      // v3.53: credencial del administrador solo en memoria (se pierde al recargar) para gestionar usuarios en la nube
      _cred = (u.perfil === 'ADMIN') ? { usuario: usuario, hash: hh } : null;
    } else {
      const us = await API.select('usuarios', { usuario });
      u = us && us[0];
      if (!u) throw new Error('Usuario o clave incorrectos.');
      if (u.estado !== 'ACTIVO') throw new Error('Usuario inactivo.');
      const h = await _hash(u.salt, clave);
      if (h !== u.clave_hash) throw new Error('Usuario o clave incorrectos.');
    }
    _user = u;
    localStorage.setItem(LS_SES, JSON.stringify({ id: u.id, usuario: u.usuario,
      nombre: u.nombre, perfil: u.perfil, permisos: u.permisos }));
    // M11 Fase B: sesión de la nube por usuario y rol (si falla, sigue el acceso anterior)
    if (API.hayNube() && API.ingresarNube) { try { await API.ingresarNube(usuario, clave); } catch (e) {} }
    return u;
  }
  function logout() { _user = null; _cred = null; localStorage.removeItem(LS_SES); if (API.salirNube) API.salirNube(); }

  // ── v3.53: usuarios en la nube por funciones del servidor (la tabla usuarios no es accesible directamente) ──
  let _cred = null;
  function credAdmin() { return _cred; }
  async function confirmarAdmin(clave) {
    const s = sesion(); if (!s || s.perfil !== 'ADMIN') throw new Error('Solo un administrador puede gestionar usuarios.');
    const salt = await API.rpc('pwa_salt', { p_usuario: s.usuario });
    if (!salt) throw new Error('Contraseña incorrecta.');
    const hh = await _hash(salt, clave);
    const u = await API.rpc('pwa_login', { p_usuario: s.usuario, p_hash: hh });
    if (!u) throw new Error('Contraseña incorrecta.');
    _cred = { usuario: s.usuario, hash: hh };
    return true;
  }
  async function listarUsuariosNube() {
    if (!_cred) throw new Error('Confirma tu contraseña de administrador.');
    return await API.rpc('pwa_usuarios_listar', { p_admin: _cred.usuario, p_admin_hash: _cred.hash }) || [];
  }
  // datos: {usuario, nombre, perfil, estado}; clave opcional (obligatoria si es nuevo)
  async function guardarUsuarioNube(id, datos, clave) {
    if (!_cred) throw new Error('Confirma tu contraseña de administrador.');
    const d = Object.assign({}, datos);
    if (clave) { d.salt = _salt(); d.clave_hash = await _hash(d.salt, clave); }
    return await API.rpc('pwa_usuario_guardar', { p_admin: _cred.usuario, p_admin_hash: _cred.hash, p_id: id || null, p_datos: d });
  }
  function sesion() {
    if (_user) return _user;
    try { _user = JSON.parse(localStorage.getItem(LS_SES) || 'null'); } catch (e) { _user = null; }
    return _user;
  }
  function puede(modulo) {
    const s = sesion(); if (!s) return false;
    if (s.perfil === 'ADMIN') return true;
    return !!(s.permisos && s.permisos[modulo]);
  }

  // v3.70: ventana para pedir la clave cuando falta la sesión de la nube (entró sin internet o venció)
  function pedirClave(usuario) {
    return new Promise((res) => {
      const ov = document.createElement('div');
      ov.id = 'pideClaveNube';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';
      ov.innerHTML = '<div style="background:#fff;border-radius:12px;padding:18px;max-width:360px;width:100%;font-family:inherit">' +
        '<h3 style="margin:0 0 6px;color:#1C2733">Conectar con la nube</h3>' +
        '<p style="font-size:13px;color:#555;margin:0 0 10px">Para enviar y recibir datos, ingrese la clave de <b></b>.</p>' +
        '<input type="password" id="pcn_clave" autocomplete="current-password" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:16px;box-sizing:border-box">' +
        '<p id="pcn_msg" style="color:#C0392B;font-size:12px;min-height:16px;margin:6px 0"></p>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end"><button id="pcn_no" style="padding:9px 14px;border:1px solid #999;background:#fff;border-radius:8px">Más tarde</button>' +
        '<button id="pcn_si" style="padding:9px 14px;border:0;background:#F5A623;color:#1C2733;font-weight:700;border-radius:8px">Conectar</button></div></div>';
      ov.querySelector('b').textContent = usuario;
      document.body.appendChild(ov);
      const fin = (v) => { ov.remove(); res(v); };
      const inp = ov.querySelector('#pcn_clave'); setTimeout(() => inp.focus(), 50);
      ov.querySelector('#pcn_no').onclick = () => fin(null);
      const si = async () => {
        const c = inp.value; if (!c) { ov.querySelector('#pcn_msg').textContent = 'Escriba su clave.'; return; }
        const s = await API.ingresarNube(usuario, c);
        if (s) fin(s); else ov.querySelector('#pcn_msg').textContent = 'Clave incorrecta o sin conexión. Intente de nuevo.';
      };
      ov.querySelector('#pcn_si').onclick = si;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') si(); });
    });
  }

  return { MODULOS, PERFILES, asegurarAdmin, crearUsuario, cambiarClave,
           actualizarUsuario, login, logout, sesion, puede,
           credAdmin, confirmarAdmin, listarUsuariosNube, guardarUsuarioNube, pedirClave };
})();
