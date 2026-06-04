// ── Módulo Extras ────────────────────────────────────────────────
// Funcionalidades transversales de la app:
//   · Búsqueda global (productos + ventas)
//   · Accesos rápidos e indicador de última sincronización (inicio)
//   · Exportar a Excel (.xlsx con Stock + Ventas)
//   · Pull-to-refresh y spinner de carga
// Identificadores con prefijo _ex / Extras para no colisionar con otros módulos.

// ══ HELPERS ═══════════════════════════════════════════════════════

function _exEsc(str) {
  if (!str && str !== 0) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _exMoneda(n) {
  return '$' + (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function _exFechaCorta(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  catch { return ''; }
}

// ══ SPINNER DE CARGA ══════════════════════════════════════════════

function _exMostrarSpinner(texto = 'Sincronizando...') {
  const ov = document.getElementById('spinner-overlay');
  const tx = document.getElementById('spinner-texto');
  if (tx) tx.textContent = texto;
  if (ov) ov.style.display = 'flex';
}

function _exOcultarSpinner() {
  const ov = document.getElementById('spinner-overlay');
  if (ov) ov.style.display = 'none';
}

// ══ INDICADOR DE SINCRONIZACIÓN (inicio) ══════════════════════════

function _exRefrescarIndicadorSync() {
  const elFecha = document.getElementById('inicio-ultima-sync');
  const elPunto = document.getElementById('inicio-sync-punto');
  const elUltimaImport = document.getElementById('ultima-sync');
  const elEstado = document.getElementById('estado-planilla');
  const elCola = document.getElementById('cola-pendientes');

  const ts = localStorage.getItem('convos_ultima_sync');
  const texto = ts ? new Date(ts).toLocaleString('es-AR') : 'Nunca';
  if (elFecha) elFecha.textContent = texto;
  if (elUltimaImport) elUltimaImport.textContent = texto;

  const configurado = !!(window.Sync && window.Sync.estaConfigurado && window.Sync.estaConfigurado());
  if (elEstado) {
    elEstado.textContent = configurado ? 'Configurado' : 'No configurado';
    elEstado.className = 'badge ' + (configurado ? 'badge-stock-ok' : 'badge-stock-cero');
  }

  // color del punto: verde si configurado y online, gris si no
  if (elPunto) {
    let color = '#9ca3af';                       // gris (no configurado)
    if (configurado) color = navigator.onLine ? '#16a34a' : '#f59e0b'; // verde / naranja
    elPunto.style.background = color;
  }

  // contador de pendientes offline
  const pendientes = (window.Sync && window.Sync.obtenerCola) ? window.Sync.obtenerCola().length : 0;
  if (elCola) elCola.textContent = pendientes;
}

// ══ SINCRONIZACIÓN CON SPINNER ════════════════════════════════════
// Envolvemos la función global de sync para mostrar el spinner y
// refrescar el indicador, sin duplicar la lógica de sync.js.

(function _exEnvolverSync() {
  const original = window.sincronizarConSheets;
  if (typeof original !== 'function') return;
  window.sincronizarConSheets = async function (...args) {
    if (!(window.Sync && window.Sync.estaConfigurado && window.Sync.estaConfigurado())) {
      return original.apply(this, args);   // abre overlay de config
    }
    _exMostrarSpinner('Sincronizando con Google Sheets...');
    try {
      return await original.apply(this, args);
    } finally {
      _exOcultarSpinner();
      _exRefrescarIndicadorSync();
    }
  };
})();

// ══ BÚSQUEDA GLOBAL ═══════════════════════════════════════════════

function _exBuscarGlobal(texto) {
  const q = (texto || '').toLowerCase().trim();
  const cont = document.getElementById('bg-resultados');
  const btnLimpiar = document.getElementById('bg-limpiar');
  if (!cont) return;

  if (btnLimpiar) btnLimpiar.style.display = q ? 'flex' : 'none';

  if (!q) { cont.style.display = 'none'; cont.innerHTML = ''; return; }

  // Productos
  const productos = (window.Stock ? window.Stock.obtenerProductos() : []).filter(p =>
    (p.codigoCorto    || '').toLowerCase().includes(q) ||
    (p.codigoCompleto || '').toLowerCase().includes(q) ||
    (p.marca          || '').toLowerCase().includes(q) ||
    (p.familia        || '').toLowerCase().includes(q) ||
    (p.color          || '').toLowerCase().includes(q) ||
    (p.talle          || '').toLowerCase().includes(q)
  ).slice(0, 8);

  // Ventas
  const ventas = (window.Ventas ? window.Ventas.obtenerVentas() : []).filter(v =>
    (v.nombreCliente  || v.clienteNombre || '').toLowerCase().includes(q) ||
    (v.codigoCorto    || '').toLowerCase().includes(q) ||
    (v.codigoCompleto || '').toLowerCase().includes(q)
  ).slice(0, 8);

  let html = '';

  if (productos.length) {
    html += `<div class="bg-grupo">📦 Productos</div>`;
    html += productos.map(p => {
      const disp = window.Stock ? window.Stock.calcularStockDisponible(p) : '';
      return `<div class="bg-item" data-tipo="producto" data-id="${p.id}">
        <div class="bg-item-txt">
          <strong>${_exEsc(p.codigoCorto || p.codigoCompleto || '—')}</strong>
          <small>${_exEsc(p.codigoCompleto || '')}</small>
        </div>
        <span class="bg-item-meta">stock ${disp}</span>
      </div>`;
    }).join('');
  }

  if (ventas.length) {
    html += `<div class="bg-grupo">🛒 Ventas</div>`;
    html += ventas.map(v => {
      const cli = v.nombreCliente || v.clienteNombre || 'Cliente';
      const det = v.codigoCorto || v.codigoCompleto || '';
      return `<div class="bg-item" data-tipo="venta" data-id="${v.id}">
        <div class="bg-item-txt">
          <strong>${_exEsc(cli)}</strong>
          <small>${_exEsc(det)} · ${_exFechaCorta(v.fecha)}</small>
        </div>
        <span class="bg-item-meta">${_exMoneda(v.montoVenta)}</span>
      </div>`;
    }).join('');
  }

  if (!html) {
    html = `<div class="bg-vacio">Sin resultados para “${_exEsc(texto)}”.</div>`;
  }

  cont.innerHTML = html;
  cont.style.display = 'block';

  cont.querySelectorAll('.bg-item').forEach(el => {
    el.addEventListener('click', () => {
      const tipo = el.dataset.tipo;
      const id = el.dataset.id;
      _exCerrarBusqueda();
      if (tipo === 'producto') {
        window.App?.navegarA('stock');
        window.Stock?.mostrarDetalle?.(id);
      } else if (tipo === 'venta') {
        window.App?.navegarA('ventas');
        window.Ventas?.mostrarDetalle?.(id);
      }
    });
  });
}

function _exCerrarBusqueda() {
  const input = document.getElementById('bg-input');
  const cont = document.getElementById('bg-resultados');
  const btnLimpiar = document.getElementById('bg-limpiar');
  if (input) input.value = '';
  if (cont) { cont.style.display = 'none'; cont.innerHTML = ''; }
  if (btnLimpiar) btnLimpiar.style.display = 'none';
}

// ══ EXPORTAR A EXCEL ══════════════════════════════════════════════

function _exExportarExcel() {
  if (typeof XLSX === 'undefined') {
    window.App?.mostrarToast('❌ No se pudo cargar el motor de Excel');
    return;
  }

  const productos = window.Stock ? window.Stock.obtenerProductos() : [];
  const ventas    = window.Ventas ? window.Ventas.obtenerVentas() : [];

  if (productos.length === 0 && ventas.length === 0) {
    window.App?.mostrarToast('⚠ No hay datos para exportar');
    return;
  }

  // Hoja 1 · Maestro de Stock actualizado
  const encStock = [
    'Código corto', 'Descripción', 'Familia', 'Marca', 'Artículo', 'Talle', 'Color',
    'Proveedor', 'Costo', 'Costo + IVA', 'Precio', 'Stock inicial', 'Pedidos',
    'Ajustes', 'Devoluciones', 'Ventas', 'Stock disponible', 'Conteo físico', 'Diferencia',
  ];
  const filasStock = [encStock, ...productos.map(p => {
    const disp = window.Stock.calcularStockDisponible(p);
    const dif  = window.Stock.calcularDiferencia(p);
    return [
      p.codigoCorto || '', p.codigoCompleto || '', p.familia || '', p.marca || '',
      p.articulo || '', p.talle || '', p.color || '', p.proveedor || '',
      Number(p.costo) || 0, Number(p.costoConIva) || 0, Number(p.precio) || 0,
      Number(p.stockInicial) || 0, Number(p.pedidos) || 0, Number(p.ajustes) || 0,
      Number(p.devoluciones) || 0, Number(p.ventas) || 0, disp,
      (p.stockConteo === null || p.stockConteo === undefined || p.stockConteo === '') ? '' : Number(p.stockConteo),
      dif === null ? '' : dif,
    ];
  })];

  // Hoja 2 · Ventas del período
  const encVentas = [
    'Fecha', 'Cliente', 'Código', 'Descripción', 'Familia', 'Talle', 'Color',
    'Cantidad', 'Precio unit.', 'Descuento', 'Monto', 'Cobrado', 'Saldo',
    'Tipo cobro', 'Preparado', 'Entregado', 'Fecha entrega', 'Costo', 'Ganancia', 'Observaciones',
  ];
  const filasVentas = [encVentas, ...ventas.map(v => [
    _exFechaCorta(v.fecha), v.nombreCliente || v.clienteNombre || '',
    v.codigoCorto || '', v.codigoCompleto || '', v.familia || '', v.talle || '', v.color || '',
    Number(v.cantidad) || 0, Number(v.precio) || 0, Number(v.descuento) || 0,
    Number(v.montoVenta) || 0, Number(v.cobrado) || 0, Number(v.saldoACobrar) || 0,
    v.tipoCobro || '', v.preparado ? 'Sí' : 'No', v.entregado ? 'Sí' : 'No',
    _exFechaCorta(v.fechaEntrega), Number(v.costo) || 0, Number(v.ganancia) || 0,
    v.observaciones || '',
  ])];

  try {
    const wb = XLSX.utils.book_new();
    const wsStock  = XLSX.utils.aoa_to_sheet(filasStock);
    const wsVentas = XLSX.utils.aoa_to_sheet(filasVentas);
    XLSX.utils.book_append_sheet(wb, wsStock,  'Stock');
    XLSX.utils.book_append_sheet(wb, wsVentas, 'Ventas');

    const hoy = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `ConVos_export_${hoy}.xlsx`);
    window.App?.mostrarToast('✔ Excel descargado');
  } catch (err) {
    console.error('[Exportar]', err);
    window.App?.mostrarToast('❌ Error al generar el Excel');
  }
}

// ══ PULL-TO-REFRESH ═══════════════════════════════════════════════

function _exIniciarPullToRefresh() {
  const cont = document.getElementById('contenido');
  const ind  = document.getElementById('ptr-indicador');
  const txt  = document.getElementById('ptr-texto');
  if (!cont || !ind) return;

  const UMBRAL = 70;       // px que hay que tirar para disparar
  let inicioY = 0;
  let activo  = false;
  let delta   = 0;

  cont.addEventListener('touchstart', (e) => {
    if (cont.scrollTop <= 0) {
      inicioY = e.touches[0].clientY;
      activo  = true;
      delta   = 0;
    } else {
      activo = false;
    }
  }, { passive: true });

  cont.addEventListener('touchmove', (e) => {
    if (!activo) return;
    delta = e.touches[0].clientY - inicioY;
    if (delta <= 0) { ind.classList.remove('visible', 'listo'); return; }

    const d = Math.min(delta, 120);
    ind.style.transform = `translateY(${d}px)`;
    ind.classList.add('visible');
    if (delta >= UMBRAL) {
      ind.classList.add('listo');
      if (txt) txt.textContent = 'Soltá para sincronizar';
    } else {
      ind.classList.remove('listo');
      if (txt) txt.textContent = 'Tirá para sincronizar';
    }
  }, { passive: true });

  cont.addEventListener('touchend', () => {
    if (!activo) return;
    activo = false;
    ind.style.transform = '';
    const disparar = delta >= UMBRAL;
    ind.classList.remove('visible', 'listo');
    if (disparar) {
      if (window.Sync && window.Sync.estaConfigurado && window.Sync.estaConfigurado()) {
        if (typeof window.sincronizarConSheets === 'function') window.sincronizarConSheets();
      } else {
        window.App?.mostrarToast('⚙ Configurá Google Sheets primero');
      }
    }
    delta = 0;
  });
}

// ══ INICIALIZACIÓN ════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // ── Búsqueda global
  const bgInput = document.getElementById('bg-input');
  bgInput?.addEventListener('input', (e) => _exBuscarGlobal(e.target.value));
  document.getElementById('bg-limpiar')?.addEventListener('click', _exCerrarBusqueda);

  // ── Accesos rápidos
  document.getElementById('acc-nueva-venta')?.addEventListener('click', () => window.App?.navegarA('ventas'));
  document.getElementById('acc-ver-stock')?.addEventListener('click', () => window.App?.navegarA('stock'));
  document.getElementById('acc-importar')?.addEventListener('click', () => window.App?.navegarA('importar'));

  // ── Indicador de sincronización (inicio)
  document.getElementById('inicio-sync-btn')?.addEventListener('click', () => {
    if (typeof window.sincronizarConSheets === 'function') window.sincronizarConSheets();
  });
  document.querySelector('.tab[data-vista="inicio"]')?.addEventListener('click', _exRefrescarIndicadorSync);
  _exRefrescarIndicadorSync();

  // ── Exportar a Excel
  document.getElementById('btn-exportar-excel')?.addEventListener('click', _exExportarExcel);

  // ── Pull-to-refresh
  _exIniciarPullToRefresh();

  // ── Actualizar punto de conexión al cambiar estado de red
  window.addEventListener('online',  _exRefrescarIndicadorSync);
  window.addEventListener('offline', _exRefrescarIndicadorSync);
});

// ══ EXPORTAR ══════════════════════════════════════════════════════

window.Extras = {
  buscarGlobal: _exBuscarGlobal,
  cerrarBusqueda: _exCerrarBusqueda,
  exportarExcel: _exExportarExcel,
  refrescarIndicadorSync: _exRefrescarIndicadorSync,
  mostrarSpinner: _exMostrarSpinner,
  ocultarSpinner: _exOcultarSpinner,
};
