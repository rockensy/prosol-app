/* db.js · SIPM-IA Fusion v2.1 — almacenamiento offline campo (IndexedDB)
   Stores: catalogo / registros / meta
   Catálogo incluye: clientes, equipos, tecnicos, variables,
                     programacion, inventario
*/
const SIPMDB = (() => {
  const NAME = 'sipmia_campo';
  const VER = 1;
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const rq = indexedDB.open(NAME, VER);
      rq.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('catalogo'))
          db.createObjectStore('catalogo', { keyPath: 'k' });
        if (!db.objectStoreNames.contains('registros'))
          db.createObjectStore('registros', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta'))
          db.createObjectStore('meta', { keyPath: 'k' });
      };
      rq.onsuccess = () => { _db = rq.result; resolve(_db); };
      rq.onerror = () => reject(rq.error);
    });
  }

  function tx(store, mode) {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }
  function put(store, value) {
    return tx(store, 'readwrite').then((os) => new Promise((res, rej) => {
      const r = os.put(value); r.onsuccess = () => res(value); r.onerror = () => rej(r.error);
    }));
  }
  function get(store, key) {
    return tx(store, 'readonly').then((os) => new Promise((res, rej) => {
      const r = os.get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error);
    }));
  }
  function all(store) {
    return tx(store, 'readonly').then((os) => new Promise((res, rej) => {
      const r = os.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
    }));
  }
  function del(store, key) {
    return tx(store, 'readwrite').then((os) => new Promise((res, rej) => {
      const r = os.delete(key); r.onsuccess = () => res(true); r.onerror = () => rej(r.error);
    }));
  }
  function clear(store) {
    return tx(store, 'readwrite').then((os) => new Promise((res, rej) => {
      const r = os.clear(); r.onsuccess = () => res(true); r.onerror = () => rej(r.error);
    }));
  }

  /* ---- Catálogo ---- */
  async function importarCatalogo(cat) {
    await clear('catalogo');
    const claveDe = {
      clientes: 'ID_CLIENTE', equipos: 'ID_EQUIPO',
      tecnicos: 'ID_TECNICO', variables: 'ID_EQUIPO_VARIABLE',
      programacion: 'ID_PROGRAMACION', inventario: 'ID_ITEM'
    };
    const mapa = {
      clientes: cat.clientes, equipos: cat.equipos,
      tecnicos: cat.tecnicos, variables: cat.variables,
      programacion: cat.programacion || [],
      inventario: cat.inventario || []
    };
    for (const tipo in mapa) {
      const campo = claveDe[tipo];
      let i = 0;
      for (const r of (mapa[tipo] || [])) {
        const id = r[campo] != null ? r[campo] : (tipo + '_' + (i++));
        await put('catalogo', { k: tipo + ':' + id, tipo, id, data: r });
      }
    }
    await put('meta', {
      k: 'catalogo',
      version: cat.version || '', fecha: cat.fecha || '',
      config: cat.config || {}
    });
    return true;
  }

  async function lista(tipo) {
    const todos = await all('catalogo');
    return todos.filter((x) => x.tipo === tipo).map((x) => x.data);
  }

  async function buscarEquipo(texto) {
    const t = String(texto).trim().toLowerCase();
    const eqs = await lista('equipos');
    const eq = eqs.find((e) =>
      String(e.SERIE || '').toLowerCase() === t ||
      String(e.CODIGO_EQUIPO || '').toLowerCase() === t);
    if (!eq) return null;
    const cli = (await lista('clientes')).find((c) => c.ID_CLIENTE === eq.ID_CLIENTE) || null;
    return { equipo: eq, cliente: cli };
  }

  async function variablesDeEquipo(idEquipo) {
    const vs = await lista('variables');
    return vs.filter((v) => v.ID_EQUIPO === idEquipo);
  }

  async function programacionDeEquipo(idEquipo) {
    const prog = await lista('programacion');
    return prog.filter((p) => p.ID_EQUIPO === idEquipo && p.ESTADO !== 'EJECUTADO');
  }

  async function buscarInventario(texto) {
    const t = String(texto || '').toLowerCase();
    const inv = await lista('inventario');
    if (!t) return inv;
    return inv.filter((i) =>
      String(i.NOMBRE_ITEM || '').toLowerCase().includes(t) ||
      String(i.CODIGO_ITEM || '').toLowerCase().includes(t));
  }

  async function metaCatalogo() { return (await get('meta', 'catalogo')) || {}; }
  async function config() { const m = await metaCatalogo(); return m.config || {}; }

  /* ---- Registros ---- */
  function guardarRegistro(reg) { return put('registros', reg); }
  function registros() { return all('registros'); }
  function registro(id) { return get('registros', id); }
  function borrarRegistro(id) { return del('registros', id); }

  return {
    open, importarCatalogo, lista, buscarEquipo, variablesDeEquipo,
    programacionDeEquipo, buscarInventario,
    metaCatalogo, config,
    guardarRegistro, registros, registro, borrarRegistro,
    put, get, all, del, clear
  };
})();
