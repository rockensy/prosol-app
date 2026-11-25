/* firma_blanca.js · PROSOL v3.90 — la firma del cliente SIEMPRE con fondo blanco y trazo negro.
   Causa del problema: al cambiar el tamaño de la pantalla (abrir/cerrar el teclado, girar el celular) el recuadro de
   firma se redimensiona y queda transparente; al guardarlo como JPEG lo transparente se vuelve NEGRO y el trazo oscuro
   no se ve (o se borra si ya se había firmado).
   · Al guardar (#firma → imagen): se compone sobre blanco y cada punto queda blanco o negro puro.
   · Al cambiar el tamaño de la pantalla: la firma ya trazada se conserva (no se pierde).
   Se carga ANTES de app.js (su aviso de cambio de tamaño debe correr primero). No modifica app.js. */
(function () {
  'use strict';
  const original = HTMLCanvasElement.prototype.toDataURL;

  function blancoYNegro(cv) {
    const c = document.createElement('canvas');
    c.width = cv.width || 1; c.height = cv.height || 1;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(cv, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const v = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) < 160 ? 0 : 255;
      p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255;
    }
    x.putImageData(d, 0, 0);
    return c;
  }

  function esFirma(cv) { return cv && (cv.id === 'firma' || (cv.dataset && cv.dataset.firma === '1')); }

  HTMLCanvasElement.prototype.toDataURL = function (tipo, calidad) {
    if (esFirma(this)) {
      try { return original.call(blancoYNegro(this), tipo, calidad); } catch (e) { /* se usa el original */ }
    }
    return original.call(this, tipo, calidad);
  };

  // Conservar la firma al cambiar el tamaño de la pantalla
  window.addEventListener('resize', () => {
    const cv = document.getElementById('firma');
    if (!cv || !cv.width || !cv.height) return;
    let copia = null;
    try {
      copia = document.createElement('canvas'); copia.width = cv.width; copia.height = cv.height;
      copia.getContext('2d').drawImage(cv, 0, 0);
    } catch (e) { copia = null; }
    setTimeout(() => {
      try {
        const x = cv.getContext('2d');
        x.save();
        x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height);
        if (copia) x.drawImage(copia, 0, 0);
        x.restore();
      } catch (e) { /* nada */ }
    }, 0);
  });

  window.FIRMA_BLANCA = { blancoYNegro };
})();
