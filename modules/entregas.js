// ── Módulo Entregas ─────────────────────────────────────────────
// Envíos a domicilio. Cada venta genera una entrega pendiente que se
// marca como entregada cuando se despacha. Sincroniza la hoja ENTREGAS.

// Las entregas viven dentro de cada venta (estadoEntrega / fechaEntrega).
// Este módulo es la "vista" y las operaciones sobre ese estado.

// ══ CONSULTAS ═════════════════════════════════════════════════════

function _ventasEntregables() {
  if (typeof Ventas === 'undefined') return [];
  // Toda venta es una entrega a gestionar
  return Ventas.obtenerVentas();
}

// Compat: nombre del cliente (modelo nuevo / histórico)
function _nombreEnt(v) {
  return v.nombreCliente || v.clienteNombre || 'Cliente';
}

// Detalle del producto vendido (modelo nuevo de un solo producto)
function _detalleDe(v) {
  const desc = v.codigoCorto || v.codigoCompleto || '';
  const extra = [v.familia, v.talle, v.color].filter(Boolean).join(' · ');
  return `${v.cantidad || 1}× ${desc}${extra ? ' (' + extra + ')' : ''}`;
}

function entregasPendientes() {
  return _ventasEntregables().filter(v => !v.entregado);
}

function entregasEntregadas() {
  return _ventasEntregables().filter(v => v.entregado === true);
}

function totalPendientes() {
  return entregasPendientes().length;
}

// ══ OPERACIONES ═══════════════════════════════════════════════════

function marcarEntregado(ventaId) {
  if (typeof Ventas === 'undefined') return;
  Ventas.actualizarVenta(ventaId, {
    entregado:    true,
    fechaEntrega: new Date().toISOString(),
  });
  _sincronizarEntregas();
}

function marcarPreparado(ventaId, preparado = true) {
  if (typeof Ventas === 'undefined') return;
  Ventas.actualizarVenta(ventaId, { preparado });
  _sincronizarEntregas();
}

function desmarcarEntrega(ventaId) {
  if (typeof Ventas === 'undefined') return;
  Ventas.actualizarVenta(ventaId, { entregado: false, fechaEntrega: '' });
  _sincronizarEntregas();
}

// ══ SINCRONIZACIÓN ════════════════════════════════════════════════

async function _sincronizarEntregas() {
  if (typeof Sync === 'undefined' || !Sync.estaConfigurado()) return;

  const entregas = _ventasEntregables();
  const encabezados = [
    'ventaId', 'fechaVenta', 'cliente', 'detalle',
    'preparado', 'estado', 'fechaEntrega',
  ];
  const filas = [
    encabezados,
    ...entregas.map(v => [
      v.id, v.fecha, _nombreEnt(v), _detalleDe(v),
      v.preparado ? 'Sí' : 'No',
      v.entregado ? 'entregado' : 'pendiente',
      v.fechaEntrega || '',
    ]),
  ];

  try {
    await Sync.syncToSheets('ENTREGAS', filas, 'overwrite');
  } catch (err) {
    console.warn('[Entregas sync]', err.message);
  }
}

// ══ HELPERS ═══════════════════════════════════════════════════════

function _escapar(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtFecha(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  catch { return iso; }
}

// ══ ESTADO DE LA VISTA ════════════════════════════════════════════

let _filtro = 'pendientes';   // 'pendientes' | 'entregadas'

function _setFiltro(f) {
  _filtro = f;
  document.getElementById('entregas-tab-pendientes')?.classList.toggle('activo', f === 'pendientes');
  document.getElementById('entregas-tab-entregadas')?.classList.toggle('activo', f === 'entregadas');
  renderizar();
}

// ══ RENDERIZADO ═══════════════════════════════════════════════════

function renderizar() {
  const lista = document.getElementById('entregas-lista');
  if (!lista) return;

  const datos = _filtro === 'pendientes' ? entregasPendientes() : entregasEntregadas();

  // contador en la pestaña pendientes
  const badge = document.getElementById('entregas-badge-pend');
  if (badge) badge.textContent = entregasPendientes().length;

  if (datos.length === 0) {
    lista.innerHTML = `<li><div class="estado-vacio">
      <span class="icono-grande">${_filtro === 'pendientes' ? '🚚' : '✅'}</span>
      <p>${_filtro === 'pendientes' ? 'No hay entregas pendientes.' : 'Todavía no hay entregas hechas.'}</p>
    </div></li>`;
    return;
  }

  lista.innerHTML = datos.map(v => {
    const detalle = _escapar(_detalleDe(v));
    if (_filtro === 'pendientes') {
      const prep = v.preparado;
      return `<li class="item-entrega">
        <div class="item-entrega-data">
          <div class="item-nombre">${_escapar(_nombreEnt(v))}</div>
          <div class="item-detalle">${detalle}</div>
          <div class="item-meta">🗓 ${_fmtFecha(v.fecha)} · ${prep ? '📦 Preparado' : '⏳ Sin preparar'}</div>
        </div>
        <div class="item-entrega-acciones">
          <button class="btn-preparar ${prep ? 'activo' : ''}" data-id="${v.id}">${prep ? '✓ Listo' : '📦 Preparar'}</button>
          <button class="btn-marcar-entregado" data-id="${v.id}">✓ Entregado</button>
        </div>
      </li>`;
    }
    return `<li class="item-entrega entregada">
      <div class="item-entrega-data">
        <div class="item-nombre">${_escapar(_nombreEnt(v))}</div>
        <div class="item-detalle">${detalle}</div>
        <div class="item-meta" style="color:var(--verde);">✓ Entregado ${_fmtFecha(v.fechaEntrega)}</div>
      </div>
      <button class="btn-desmarcar" data-id="${v.id}">↩</button>
    </li>`;
  }).join('');

  lista.querySelectorAll('.btn-marcar-entregado').forEach(b =>
    b.addEventListener('click', () => {
      marcarEntregado(b.dataset.id);
      window.App?.mostrarToast('✔ Entrega marcada como entregada');
      typeof Ventas !== 'undefined' && Ventas.renderizarListaVentas?.();
      renderizar();
    }));
  lista.querySelectorAll('.btn-preparar').forEach(b =>
    b.addEventListener('click', () => {
      const v = Ventas.obtenerVenta(b.dataset.id);
      marcarPreparado(b.dataset.id, !v?.preparado);
      renderizar();
    }));
  lista.querySelectorAll('.btn-desmarcar').forEach(b =>
    b.addEventListener('click', () => {
      desmarcarEntrega(b.dataset.id);
      window.App?.mostrarToast('↩ Entrega vuelta a pendiente');
      typeof Ventas !== 'undefined' && Ventas.renderizarListaVentas?.();
      renderizar();
    }));
}

function refrescarEntregas() {
  renderizar();
  const elInicio = document.getElementById('metro-entregas-pend');
  if (elInicio) elInicio.textContent = totalPendientes();
}

// ══ INICIALIZACIÓN ════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  renderizar();
  refrescarEntregas();
  document.getElementById('entregas-tab-pendientes')?.addEventListener('click', () => _setFiltro('pendientes'));
  document.getElementById('entregas-tab-entregadas')?.addEventListener('click', () => _setFiltro('entregadas'));
});

// ══ EXPORTAR ══════════════════════════════════════════════════════

window.Entregas = {
  entregasPendientes,
  entregasEntregadas,
  totalPendientes,
  marcarEntregado,
  marcarPreparado,
  desmarcarEntrega,
  renderizar,
  refrescar: refrescarEntregas,
  sincronizarTodo: _sincronizarEntregas,
};
