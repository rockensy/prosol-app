/* sync.js · SIPM-IA Fusion v2.1 — sincronización campo ↔ nube ↔ archivo */
const SYNC = (() => {
  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function importarCatalogoArchivo(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = async () => {
        try {
          const cat = JSON.parse(fr.result);
          if (!cat || cat.tipo !== 'PROSOL_CATALOGO')
            throw new Error('El archivo no es un catálogo SIPM-IA válido.');
          await SIPMDB.importarCatalogo(cat);
          resolve({
            version: cat.version || '', fecha: cat.fecha || '',
            clientes: (cat.clientes || []).length, equipos: (cat.equipos || []).length,
            tecnicos: (cat.tecnicos || []).length, variables: (cat.variables || []).length
          });
        } catch (e) { reject(e); }
      };
      fr.onerror = () => reject(fr.error);
      fr.readAsText(file);
    });
  }

  async function exportarPaquete(soloPendientes = true) {
    let regs = await SIPMDB.registros();
    if (soloPendientes) regs = regs.filter((r) => r.estado_envio !== 'ENVIADO');
    if (!regs.length) throw new Error('No hay registros pendientes para enviar.');
    const meta = await SIPMDB.metaCatalogo();
    const canon = JSON.stringify(regs.map((r) => ({
      numero: r.numero, codigo_equipo: r.codigo_equipo, serie: r.serie, fecha: r.fecha,
      id_local: r.id, mediciones: r.mediciones, actividades: r.actividades
    })));
    const hash = await sha256(canon);
    const paquete = {
      tipo: 'PROSOL_PAQUETE_CAMPO',
      version_catalogo: meta.version || '',
      fecha_export: new Date().toISOString(),
      tecnico: (await SIPMDB.get('meta', 'tecnico_activo'))?.valor || '',
      hash, registros: regs
    };
    return { paquete, count: regs.length, hash };
  }

  function descargarJSON(obj, nombre) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
    document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function compartirPaquete(paquete, nombre) {
    const blob = new Blob([JSON.stringify(paquete)], { type: 'application/json' });
    const file = new File([blob], nombre, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Registros SIPM-IA', text: 'Paquete de campo SIPM-IA' });
        return 'compartido';
      } catch (e) {}
    }
    descargarJSON(paquete, nombre);
    return 'descargado';
  }

  function configurarNube(url, key) { API.configurar(url, key); }
  function modoNube() { return API.hayNube(); }

  async function actualizarDesdeNube() {
    if (!API.hayNube()) throw new Error('Configura la conexión a la app web (nube) primero.');
    const [clientes, equipos, tecnicos, variables, config, programacion, inventario] = await Promise.all([
      API.select('clientes'), API.select('equipos'), API.select('tecnicos'),
      API.select('equipo_variables'), API.select('config'),
      API.select('programacion').catch(() => []),
      API.select('inventario').catch(() => [])
    ]);
    const cfg = {}; (config || []).forEach((c) => cfg[c.clave] = c.valor);
    const cat = {
      tipo: 'PROSOL_CATALOGO',
      version: new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''),
      fecha: new Date().toISOString().slice(0, 10),
      config: cfg,
      clientes: (clientes || []).map((c) => ({
        ID_CLIENTE: c.id_escritorio || c.id,
        RAZON_SOCIAL: c.razon_social, CONTACTO: c.contacto,
        TELEFONO: c.telefono, CIUDAD: c.ciudad
      })),
      equipos: (equipos || []).map((e) => ({
        ID_EQUIPO: e.id_escritorio || e.id,
        CODIGO_EQUIPO: e.codigo_equipo, ID_CLIENTE: e.id_cliente,
        NOMBRE_EQUIPO: e.nombre_equipo, MARCA: e.marca, MODELO: e.modelo,
        SERIE: e.serie, POTENCIA_KW: e.potencia_kw, COMBUSTIBLE: e.combustible
      })),
      tecnicos: (tecnicos || []).map((t) => ({
        ID_TECNICO: t.id_escritorio || t.id,
        NOMBRES: t.nombres, APELLIDOS: t.apellidos, CARGO: t.cargo
      })),
      variables: (variables || []).map((v) => ({
        ID_EQUIPO_VARIABLE: v.id_escritorio || v.id,
        ID_EQUIPO: v.id_equipo, ID_VARIABLE: v.id,
        VARIABLE: v.variable, UNIDAD: v.unidad,
        VALOR_REFERENCIA: v.valor_referencia,
        LIMITE_INF: v.limite_inf, LIMITE_SUP: v.limite_sup
      })),
      programacion: (programacion || []).map((p) => ({
        ID_PROGRAMACION: p.id_escritorio || p.id,
        ID_EQUIPO: p.id_equipo,
        FECHA_PROGRAMADA: p.fecha_programada,
        TIPO_MANTENIMIENTO: p.tipo_mantenimiento,
        PRIORIDAD: p.prioridad, ESTADO: p.estado,
        RESPONSABLE: p.responsable, OBSERVACION: p.observacion
      })),
      inventario: (inventario || []).map((i) => ({
        ID_ITEM: i.id_escritorio || i.id,
        CODIGO_ITEM: i.codigo_item, NOMBRE_ITEM: i.nombre_item,
        CATEGORIA: i.categoria, MARCA: i.marca,
        UNIDAD: i.unidad, STOCK: i.stock, STOCK_MINIMO: i.stock_minimo
      }))
    };
    await SIPMDB.importarCatalogo(cat);
    return {
      clientes: cat.clientes.length, equipos: cat.equipos.length,
      tecnicos: cat.tecnicos.length, variables: cat.variables.length,
      programacion: cat.programacion.length, inventario: cat.inventario.length
    };
  }

  async function cargarANube() {
    if (!API.hayNube()) throw new Error('Configura la conexión a la app web (nube) primero.');
    let regs = await SIPMDB.registros();
    regs = regs.filter((r) => r.estado_envio !== 'ENVIADO');
    if (!regs.length) throw new Error('No hay registros nuevos para subir.');
    let subidas = 0;
    for (const r of regs) {
      const orden = await API.insert('ordenes', {
        numero: r.numero, fecha: r.fecha, id_equipo: r.id_equipo, serie: r.serie,
        codigo_equipo: r.codigo_equipo, id_cliente: r.id_cliente,
        cliente_nombre: r.cliente_nombre, tipo: r.tipo, tecnico: r.tecnico,
        trabajo: r.trabajo, observaciones: r.observaciones,
        total: r.total || 0, gps: r.gps || null, origen: 'CAMPO', estado: 'REALIZADO'
      });
      const idOrden = orden && orden.id;
      for (const m of (r.mediciones || [])) {
        let val = parseFloat(m.VALOR); if (isNaN(val)) continue;
        const li = m.LIMITE_INF, ls = m.LIMITE_SUP;
        let resultado = 'NORMAL';
        try {
          if ((li != null && li !== '' && val < parseFloat(li)) ||
              (ls != null && ls !== '' && val > parseFloat(ls))) resultado = 'FUERA';
        } catch (e) {}
        await API.insert('mediciones', {
          id_orden: idOrden, id_equipo: r.id_equipo,
          id_equipo_variable: m.ID_EQUIPO_VARIABLE, variable: m.VARIABLE,
          unidad: m.UNIDAD, fecha: r.fecha, valor_medido: val,
          valor_referencia: m.VALOR_REFERENCIA,
          limite_inf: li, limite_sup: ls, resultado
        });
      }
      for (const a of (r.actividades || []))
        await API.insert('orden_detalle', { id_orden: idOrden, tipo_linea: 'ACTIVIDAD', descripcion: a.DESCRIPCION, cantidad: 1 });
      for (const rp of (r.repuestos || []))
        await API.insert('orden_detalle', {
          id_orden: idOrden, tipo_linea: 'REPUESTO',
          descripcion: rp.DESCRIPCION, cantidad: rp.CANTIDAD || 1,
          tipo_mov: rp.TIPO_MOV, contabiliza: rp.CONTABILIZA
        });
      for (const f of (r.fotos || []))
        await API.insert('evidencias', { id_orden: idOrden, tipo: f.tipo, data_url: f.data, descripcion: f.nombre });
      if (r.firma)
        await API.insert('evidencias', { id_orden: idOrden, tipo: 'FIRMA', data_url: r.firma, descripcion: 'Firma cliente' });
      r.estado_envio = 'ENVIADO'; await SIPMDB.guardarRegistro(r); subidas++;
    }
    return { subidas };
  }

  return {
    sha256, importarCatalogoArchivo, exportarPaquete,
    descargarJSON, compartirPaquete,
    actualizarDesdeNube, cargarANube, configurarNube, modoNube
  };
})();
