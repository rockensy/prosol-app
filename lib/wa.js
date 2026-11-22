/* lib/wa.js · SIPM-IA Web — envío por WhatsApp (wa.me, sin API) */
const WA = (() => {
  function soloDigitos(tel) { return String(tel || '').replace(/\D/g, ''); }

  // Abre WhatsApp Web/app con el mensaje pre-cargado (el usuario pulsa ENVIAR)
  function enviar(telefono, texto) {
    const num = soloDigitos(telefono);
    if (num.length < 8) throw new Error('Número incompleto. Usa formato internacional, ej: +593987654321');
    const url = 'https://wa.me/' + num + '?text=' + encodeURIComponent(texto || '');
    window.open(url, '_blank');
    return url;
  }

  // Arma el detalle de una OT (mismo estilo que el reporte de campo)
  function mensajeOrden(o, cfg) {
    const L = [];
    L.push('*SIPM-IA — Reporte de servicio*');
    if (o.cliente_nombre) L.push('Cliente: ' + o.cliente_nombre);
    L.push('Equipo: ' + (o.codigo_equipo || o.serie || '') + (o.serie ? ('  ·  Serie: ' + o.serie) : ''));
    L.push('OT N°: ' + (o.numero || '') + '   Fecha: ' + (o.fecha || ''));
    if (o.tecnico) L.push('Técnico: ' + o.tecnico);
    if (o.trabajo) { L.push(''); L.push('Trabajo realizado:'); L.push(o.trabajo); }
    if (o.total) L.push('Total: $' + Number(o.total).toFixed(2));
    L.push('');
    L.push((cfg && cfg.WA_FIRMA) || 'Potenciado por ROCKENSY S.A. & MIG — Tec. Master Luis Martínez Ibáñez');
    return L.join('\n');
  }

  return { enviar, mensajeOrden, soloDigitos };
})();
