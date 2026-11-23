/* v3.59: fechas en HORA LOCAL (Ecuador). toISOString() da UTC: desde las 19:00 proponía el día siguiente. */
window._fechaLocal = function (d) { d = d || new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
window._hoyLocal = function () { return window._fechaLocal(new Date()); };
window._fechaDeISO = function (iso) { return new Date(String(iso).slice(0, 10) + 'T12:00:00'); };   // sin corrimiento de día
/* lib/api.js · SIPM-IA Web — capa de datos unificada
   Dos adaptadores con la MISMA interfaz:
     - NUBE  : Supabase REST (PostgREST). Es la central publicada en Netlify.
     - LOCAL : IndexedDB (modo offline / pruebas / respaldo).
   La app usa API.select/insert/update/delete/rpc sin saber cuál hay debajo.
   Configuración de nube: API.configurar(url, anonKey) guarda en localStorage.
*/
const API = (() => {
  const LS_URL = 'prosol_sb_url', LS_KEY = 'prosol_sb_key';
  let _url = localStorage.getItem(LS_URL) || '';
  let _key = localStorage.getItem(LS_KEY) || '';

  function configurar(url, key) {
    _url = (url || '').replace(/\/+$/, ''); _key = key || '';
    localStorage.setItem(LS_URL, _url); localStorage.setItem(LS_KEY, _key);
  }
  function hayNube() { return !!(_url && _key); }
  function modo() { return hayNube() ? 'nube' : 'local'; }
  function infoNube() { return { url: _url, key: _key ? _key.slice(0, 8) + '…' : '' }; }

  /* ---------------- Adaptador NUBE (Supabase REST) ---------------- */
  function headers(extra) {
    return Object.assign({
      'apikey': _key, 'Authorization': 'Bearer ' + _key,
      'Content-Type': 'application/json'
    }, extra || {});
  }
  const SIN_ID = ['config', 'paquetes_campo'];
  async function sbSelect(tabla, filtros) {
    let q = _url + '/rest/v1/' + tabla + '?select=*';
    if (filtros) for (const k in filtros) {
      const v = String(filtros[k]);
      // Si el valor ya trae operador PostgREST (eq., neq., gt., etc.) no añadir otro eq.
      const op = /^(eq|neq|lt|lte|gt|gte|like|ilike|is|in|cs|cd)\./i.test(v) ? '' : 'eq.';
      q += '&' + k + '=' + op + encodeURIComponent(v);
    }
    // Supabase entrega máximo 1000 filas por consulta: se lee por bloques hasta traer todo.
    // Tablas sin columna id (config, paquetes_campo) se leen en una sola consulta.
    if (SIN_ID.indexOf(tabla) >= 0 || (filtros && filtros.limit)) {
      const r0 = await fetch(q, { headers: headers() });
      if (!r0.ok) throw new Error('Nube select ' + tabla + ': ' + r0.status);
      return await r0.json();
    }
    if (!(filtros && filtros.order)) q += '&order=id.asc';
    const TAM = 1000, todo = [];
    for (let pag = 0; pag < 500; pag++) {
      const r = await fetch(q + '&limit=' + TAM + '&offset=' + (pag * TAM), { headers: headers() });
      if (!r.ok) throw new Error('Nube select ' + tabla + ': ' + r.status);
      const bloque = await r.json();
      if (!Array.isArray(bloque)) return bloque;
      for (let i = 0; i < bloque.length; i++) todo.push(bloque[i]);
      if (bloque.length < TAM) break;
    }
    return todo;
  }
  async function sbInsert(tabla, row) {
    const r = await fetch(_url + '/rest/v1/' + tabla, {
      method: 'POST', headers: headers({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(row)
    });
    if (!r.ok) throw new Error('Nube insert ' + tabla + ': ' + r.status + ' ' + await r.text());
    const j = await r.json(); return Array.isArray(j) ? j[0] : j;
  }
  async function sbUpdate(tabla, id, row) {
    const r = await fetch(_url + '/rest/v1/' + tabla + '?id=eq.' + id, {
      method: 'PATCH', headers: headers({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(row)
    });
    if (!r.ok) throw new Error('Nube update ' + tabla + ': ' + r.status);
    const j = await r.json(); return Array.isArray(j) ? j[0] : j;
  }
  async function sbDelete(tabla, id) {
    const r = await fetch(_url + '/rest/v1/' + tabla + '?id=eq.' + id,
      { method: 'DELETE', headers: headers() });
    if (!r.ok) throw new Error('Nube delete ' + tabla + ': ' + r.status);
    return true;
  }

  /* ---------------- Adaptador LOCAL (IndexedDB) ---------------- */
  const TABLAS = ['usuarios', 'config', 'clientes', 'equipos', 'tecnicos',
    'equipo_variables', 'ordenes', 'mediciones', 'orden_detalle', 'evidencias',
    'comunicaciones'];
  let _db = null;
  function openLocal() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const rq = indexedDB.open('prosol_web', 1);
      rq.onupgradeneeded = (e) => {
        const db = e.target.result;
        TABLAS.forEach((t) => {
          if (!db.objectStoreNames.contains(t)) {
            const kp = (t === 'config') ? 'clave' : 'id';
            db.createObjectStore(t, { keyPath: kp });
          }
        });
      };
      rq.onsuccess = () => { _db = rq.result; resolve(_db); };
      rq.onerror = () => reject(rq.error);
    });
  }
  function uuid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      ('id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  }
  function lTx(t, m) { return openLocal().then((db) => db.transaction(t, m).objectStore(t)); }
  function lAll(t) { return lTx(t, 'readonly').then((os) => new Promise((res, rej) => { const r = os.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); })); }
  function lPut(t, v) { return lTx(t, 'readwrite').then((os) => new Promise((res, rej) => { const r = os.put(v); r.onsuccess = () => res(v); r.onerror = () => rej(r.error); })); }
  function lDel(t, id) { return lTx(t, 'readwrite').then((os) => new Promise((res, rej) => { const r = os.delete(id); r.onsuccess = () => res(true); r.onerror = () => rej(r.error); })); }
  async function lSelect(t, filtros) {
    let rows = await lAll(t);
    if (filtros) rows = rows.filter((x) => Object.keys(filtros).every((k) => String(x[k]) === String(filtros[k])));
    return rows;
  }
  async function lInsert(t, row) {
    const r = Object.assign({}, row);
    if (t !== 'config' && !r.id) r.id = uuid();
    if (!r.creado && t !== 'config') r.creado = new Date().toISOString();
    await lPut(t, r); return r;
  }
  async function lUpdate(t, id, row) {
    const cur = (await lSelect(t, { id }))[0] || { id };
    const n = Object.assign({}, cur, row); await lPut(t, n); return n;
  }

  /* ---------------- Interfaz unificada ---------------- */
  async function select(tabla, filtros) { return hayNube() ? sbSelect(tabla, filtros) : lSelect(tabla, filtros); }
  async function insert(tabla, row) { return hayNube() ? sbInsert(tabla, row) : lInsert(tabla, row); }
  async function update(tabla, id, row) { return hayNube() ? sbUpdate(tabla, id, row) : lUpdate(tabla, id, row); }
  async function remove(tabla, id) { return hayNube() ? sbDelete(tabla, id) : lDel(tabla, id); }

  // Config helpers
  async function getConfig(clave, def) {
    const r = await select('config', { clave });
    return (r && r[0]) ? r[0].valor : (def || '');
  }
  async function setConfig(clave, valor) {
    if (hayNube()) {
      // upsert
      const r = await fetch(_url + '/rest/v1/config', {
        method: 'POST', headers: headers({ 'Prefer': 'resolution=merge-duplicates' }),
        body: JSON.stringify({ clave, valor })
      });
      if (!r.ok) throw new Error('config upsert ' + r.status);
      return true;
    }
    return lPut('config', { clave, valor });
  }

  // Llama a una función RPC de Supabase (PostgREST /rest/v1/rpc/<fn>)
  async function rpc(fn, args) {
    if (!hayNube()) throw new Error('Sin credenciales de nube.');
    const r = await fetch(_url + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers: headers(), body: JSON.stringify(args || {})
    });
    // v3.53: se muestra el motivo que da el servidor (ej. «ya existe un usuario con ese nombre»)
    if (!r.ok) { let m = ''; try { m = (await r.json()).message || ''; } catch (e) {} throw new Error(m || ('Nube rpc ' + fn + ': ' + r.status)); }
    return r.json();
  }

  // v3.51: fotos al almacenamiento de Supabase (depósito prosol-fotos), no dentro de la base.
  // ruta: 'ot/<id_orden>/<nombre>' o 'seguimiento/<token>/<nombre>'. Devuelve el enlace público.
  const BUCKET_FOTOS = 'prosol-fotos';
  function _rutaSegura(r) { return String(r || '').split('/').map((p) => p.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 90)).join('/'); }
  async function subirFoto(ruta, dataUrl) {
    if (!hayNube()) throw new Error('Sin credenciales de nube.');
    if (!/^data:image\//.test(dataUrl || '')) throw new Error('La foto no es una imagen válida.');
    const blob = await (await fetch(dataUrl)).blob();
    const r0 = _rutaSegura(ruta);
    const r = await fetch(_url + '/storage/v1/object/' + BUCKET_FOTOS + '/' + r0, {
      method: 'POST', headers: { 'apikey': _key, 'Authorization': 'Bearer ' + _key, 'Content-Type': blob.type || 'image/jpeg' }, body: blob
    });
    // 409/400 "ya existe": la foto ya se subió antes (reintento) → se usa el mismo enlace
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      if (!(r.status === 409 || /already exists|Duplicate/i.test(t))) throw new Error('Subir foto: ' + r.status + ' ' + t.slice(0, 80));
    }
    return _url + '/storage/v1/object/public/' + BUCKET_FOTOS + '/' + r0;
  }
  function esEnlaceFoto(v) { return /^https?:\/\//.test(v || ''); }

  async function probarNube() {
    if (!hayNube()) throw new Error('Sin credenciales de nube.');
    const r = await fetch(_url + '/rest/v1/config?select=clave&limit=1', { headers: headers() });
    if (!r.ok) throw new Error('Conexión falló (' + r.status + '). Revisa URL/clave y el esquema.');
    return true;
  }

  return {
    configurar, hayNube, modo, infoNube, probarNube, rpc, subirFoto, esEnlaceFoto,
    select, insert, update, remove, getConfig, setConfig, uuid
  };
})();
