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
    return u;
  }
  function logout() { _user = null; localStorage.removeItem(LS_SES); }
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

  return { MODULOS, PERFILES, asegurarAdmin, crearUsuario, cambiarClave,
           actualizarUsuario, login, logout, sesion, puede };
})();
