// ── Módulo Stock ─────────────────────────────────────────────────
// Maestro completo de productos con movimientos, conteo físico y
// sincronización automática con Google Sheets.

// ══ STORAGE ══════════════════════════════════════════════════════

const CLAVE_PRODUCTOS = 'convos_productos';

function obtenerProductos() {
  try { return JSON.parse(localStorage.getItem(CLAVE_PRODUCTOS)) || []; }
  catch { return []; }
}

function guardarProductos(productos) {
  localStorage.setItem(CLAVE_PRODUCTOS, JSON.stringify(productos));
}

function obtenerProducto(id) {
  return obtenerProductos().find(p => p.id === id) || null;
}

// ══ CÁLCULOS ═════════════════════════════════════════════════════

function calcularStockDisponible(p) {
  return (Number(p.stockInicial) || 0)
       + (Number(p.pedidos)      || 0)
       + (Number(p.ajustes)      || 0)
       + (Number(p.devoluciones) || 0)
       - (Number(p.ventas)       || 0);
}

// Devuelve número o null si nunca se hizo un conteo
function calcularDiferencia(p) {
  if (p.stockConteo === null || p.stockConteo === undefined || p.stockConteo === '') return null;
  return Number(p.stockConteo) - calcularStockDisponible(p);
}

// ══ CRUD ══════════════════════════════════════════════════════════

const _productoBase = () => ({
  id:                     '',
  codigoCorto:            '',
  codigoCompleto:         '',
  familia:                '',
  caracteristica:         '',
  material:               '',
  marca:                  '',
  articulo:               '',
  talle:                  '',
  color:                  '',
  proveedor:              '',
  costo:                  0,
  costoConIva:            0,
  precio:                 0,
  fechaActualizacionCosto:'',
  stockInicial:           0,
  pedidos:                0,
  ajustes:                0,
  devoluciones:           0,
  ventas:                 0,
  stockConteo:            null,
  fechaConteo:            '',
  explicacionDiferencia:  '',
});

function crearProducto(datos) {
  const productos = obtenerProductos();
  const p = { ..._productoBase(), ...datos, id: Date.now().toString() };
  productos.push(p);
  guardarProductos(productos);
  _sincronizarStockCompleto();
  return p;
}

function actualizarProducto(id, cambios) {
  const productos = obtenerProductos();
  const idx = productos.findIndex(p => p.id === id);
  if (idx === -1) return null;
  productos[idx] = { ...productos[idx], ...cambios };
  guardarProductos(productos);
  _sincronizarStockCompleto();
  return productos[idx];
}

function eliminarProducto(id) {
  guardarProductos(obtenerProductos().filter(p => p.id !== id));
  _sincronizarStockCompleto();
}

// Llamado desde ventas.js al registrar una venta
function actualizarVentaProducto(productoId, cantidadVendida) {
  const productos = obtenerProductos();
  const idx = productos.findIndex(p => p.id === productoId);
  if (idx === -1) return;
  productos[idx].ventas = (Number(productos[idx].ventas) || 0) + Number(cantidadVendida);
  guardarProductos(productos);
  _sincronizarStockCompleto();
}

// ══ MOVIMIENTOS ═══════════════════════════════════════════════════

function registrarMovimiento(productoId, tipo, cantidad, fecha, observaciones, explicacion) {
  const productos = obtenerProductos();
  const idx = productos.findIndex(p => p.id === productoId);
  if (idx === -1) throw new Error('Producto no encontrado');

  const p   = productos[idx];
  const cant = parseFloat(cantidad) || 0;

  switch (tipo) {
    case 'pedido':
      p.pedidos    = (Number(p.pedidos)    || 0) + cant;
      break;
    case 'ajuste':
      p.ajustes    = (Number(p.ajustes)    || 0) + cant;
      break;
    case 'devolucion':
      p.devoluciones = (Number(p.devoluciones) || 0) + cant;
      break;
    case 'conteo':
      p.stockConteo           = cant;
      p.fechaConteo           = fecha || new Date().toISOString().split('T')[0];
      p.explicacionDiferencia = explicacion || '';
      break;
    default:
      throw new Error(`Tipo de movimiento desconocido: ${tipo}`);
  }

  productos[idx] = p;
  guardarProductos(productos);
  _sincronizarStockCompleto();
  return p;
}

// ══ SINCRONIZACIÓN ════════════════════════════════════════════════

async function _sincronizarStockCompleto() {
  if (typeof Sync === 'undefined' || !Sync.estaConfigurado()) return;

  const productos = obtenerProductos();
  if (productos.length === 0) return;

  const encabezados = [
    'id', 'codigoCorto', 'codigoCompleto', 'familia', 'caracteristica', 'material',
    'marca', 'articulo', 'talle', 'color', 'proveedor',
    'costo', 'costoConIva', 'precio', 'fechaActualizacionCosto',
    'stockInicial', 'pedidos', 'ajustes', 'devoluciones', 'ventas',
    'stockDisponible', 'stockConteo', 'diferencia', 'fechaConteo', 'explicacionDiferencia',
  ];

  const filas = [
    encabezados,
    ...productos.map(p => {
      const sd  = calcularStockDisponible(p);
      const dif = calcularDiferencia(p);
      return [
        p.id, p.codigoCorto, p.codigoCompleto, p.familia, p.caracteristica, p.material,
        p.marca, p.articulo, p.talle, p.color, p.proveedor,
        p.costo || 0, p.costoConIva || 0, p.precio || 0, p.fechaActualizacionCosto || '',
        p.stockInicial || 0, p.pedidos || 0, p.ajustes || 0, p.devoluciones || 0, p.ventas || 0,
        sd,
        p.stockConteo !== null && p.stockConteo !== undefined ? p.stockConteo : '',
        dif !== null ? dif : '',
        p.fechaConteo || '', p.explicacionDiferencia || '',
      ];
    }),
  ];

  try {
    await Sync.syncToSheets('STOCK', filas, 'overwrite');
  } catch (err) {
    console.warn('[Stock sync]', err.message);
  }
}

// ══ NAVEGACIÓN INTERNA ════════════════════════════════════════════

let _idActual     = null;   // ID del producto en detalle
let _modoForm     = 'nuevo'; // 'nuevo' | 'editar'
let _filtros      = { busqueda: '', familia: '', marca: '', proveedor: '' };

function irA(subvista) {
  document.querySelectorAll('.stock-sv').forEach(el => el.classList.remove('activa'));
  document.getElementById(`stock-${subvista}`)?.classList.add('activa');
  // Scroll al inicio al cambiar de sub-vista
  document.getElementById('contenido')?.scrollTo(0, 0);
}

// ══ FILTROS ════════════════════════════════════════════════════════

function _valorUnico(productos, campo) {
  return [...new Set(productos.map(p => p[campo]).filter(Boolean))].sort();
}

function _poblarFiltros() {
  const todos = obtenerProductos();
  _poblarSelect('filtro-familia',   _valorUnico(todos, 'familia'),   'Familia');
  _poblarSelect('filtro-marca',     _valorUnico(todos, 'marca'),     'Marca');
  _poblarSelect('filtro-proveedor', _valorUnico(todos, 'proveedor'), 'Proveedor');
}

function _poblarSelect(id, opciones, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const actual = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    opciones.map(o => `<option value="${o}"${o === actual ? ' selected' : ''}>${o}</option>`).join('');
}

// ══ RENDERIZADO: Lista ════════════════════════════════════════════

function _claseStock(stock) {
  if (stock <= 0) return 'stock-cero';
  if (stock <= 5) return 'stock-bajo';
  return 'stock-ok';
}

function renderizarListaProductos() {
  const lista = document.getElementById('lista-productos');
  if (!lista) return;

  let productos = obtenerProductos();
  const { busqueda, familia, marca, proveedor } = _filtros;

  if (busqueda) {
    const q = busqueda.toLowerCase();
    productos = productos.filter(p =>
      (p.codigoCorto    || '').toLowerCase().includes(q) ||
      (p.codigoCompleto || '').toLowerCase().includes(q) ||
      (p.marca          || '').toLowerCase().includes(q) ||
      (p.familia        || '').toLowerCase().includes(q) ||
      (p.color          || '').toLowerCase().includes(q) ||
      (p.talle          || '').toLowerCase().includes(q)
    );
  }
  if (familia)   productos = productos.filter(p => p.familia   === familia);
  if (marca)     productos = productos.filter(p => p.marca     === marca);
  if (proveedor) productos = productos.filter(p => p.proveedor === proveedor);

  // Ordenar: sin stock primero, luego stock bajo, luego por código
  productos.sort((a, b) => {
    const sa = calcularStockDisponible(a);
    const sb = calcularStockDisponible(b);
    if (sa !== sb) return sa - sb;
    return (a.codigoCorto || '').localeCompare(b.codigoCorto || '');
  });

  const contador = document.getElementById('contador-productos');
  if (contador) contador.textContent = productos.length;

  if (productos.length === 0) {
    lista.innerHTML = `<li><div class="estado-vacio">
      <span class="icono-grande">📦</span>
      <p>${busqueda || familia || marca || proveedor
        ? 'Sin resultados para el filtro aplicado.'
        : 'No hay productos cargados. Importá desde la pestaña Importar o creá uno con +.'}</p>
    </div></li>`;
    return;
  }

  lista.innerHTML = productos.map(p => {
    const stock = calcularStockDisponible(p);
    const cls   = _claseStock(stock);
    const meta  = [p.marca, p.talle, p.color].filter(Boolean).join(' · ');
    return `<li class="item-producto" data-id="${p.id}">
      <div class="item-producto-data">
        <div class="item-codigo-corto">${_esc(p.codigoCorto) || '(sin código)'}</div>
        <div class="item-descripcion">${_esc(p.codigoCompleto) || '—'}</div>
        ${meta ? `<div class="item-meta">${_esc(meta)}</div>` : ''}
      </div>
      <div class="item-stock-display ${cls}">
        <span class="stock-numero">${stock}</span>
        <span class="stock-label">uds.</span>
      </div>
    </li>`;
  }).join('');

  lista.querySelectorAll('.item-producto').forEach(el => {
    el.addEventListener('click', () => mostrarDetalle(el.dataset.id));
  });
}

// ══ RENDERIZADO: Resumen de stock (en detalle) ════════════════════

function renderizarResumenStock(p) {
  const el = document.getElementById('resumen-stock');
  if (!el) return;

  if (!p) { el.innerHTML = ''; return; }

  const sd  = calcularStockDisponible(p);
  const dif = calcularDiferencia(p);

  let html = `<div class="resumen-stock">
    <div class="resumen-fila">
      <span>Stock inicial</span><span>${p.stockInicial || 0}</span>
    </div>
    <div class="resumen-fila positivo">
      <span>+ Pedidos de compra</span><span>${p.pedidos || 0}</span>
    </div>
    <div class="resumen-fila positivo">
      <span>+ Ajustes de inventario</span><span>${p.ajustes || 0}</span>
    </div>
    <div class="resumen-fila positivo">
      <span>+ Devoluciones</span><span>${p.devoluciones || 0}</span>
    </div>
    <div class="resumen-fila negativo">
      <span>− Ventas registradas</span><span>${p.ventas || 0}</span>
    </div>
    <div class="resumen-fila total">
      <span>= Stock disponible</span>
      <span class="${_claseStock(sd)}">${sd}</span>
    </div>`;

  if (p.stockConteo !== null && p.stockConteo !== undefined && p.stockConteo !== '') {
    const difCls   = dif === 0 ? 'stock-ok' : dif > 0 ? 'stock-bajo' : 'stock-cero';
    const difSigno = dif > 0 ? '+' : '';
    html += `
    <div class="resumen-fila">
      <span>Conteo físico${p.fechaConteo ? ' (' + _fmtFecha(p.fechaConteo) + ')' : ''}</span>
      <span>${p.stockConteo}</span>
    </div>
    <div class="resumen-fila total">
      <span>Diferencia</span>
      <span class="${difCls}">${difSigno}${dif}</span>
    </div>`;
    if (p.explicacionDiferencia) {
      html += `
    <div class="resumen-fila">
      <span>Explicación</span>
      <span style="font-size:.82rem;text-align:right;">${_esc(p.explicacionDiferencia)}</span>
    </div>`;
    }
  }

  html += '</div>';
  el.innerHTML = html;
}

// ══ RENDERIZADO: Métricas del inicio ══════════════════════════════

function renderizarMetricasInicio() {
  const productos = obtenerProductos();

  const elTotal    = document.getElementById('metro-productos');
  const elBajo     = document.getElementById('metro-stock-bajo');
  const listaAbajo = document.getElementById('lista-stock-bajo');

  if (elTotal) elTotal.textContent = productos.length;

  // En el inicio "stock bajo" = productos con 2 unidades o menos
  const bajos = productos.filter(p => calcularStockDisponible(p) <= 2);
  if (elBajo)  elBajo.textContent = bajos.length;

  if (listaAbajo) {
    if (bajos.length === 0) {
      listaAbajo.innerHTML = `<li><div class="estado-vacio">
        <span class="icono-grande">✅</span>
        <p>Todo el stock está en orden.</p>
      </div></li>`;
    } else {
      listaAbajo.innerHTML = bajos.slice(0, 6).map(p => {
        const stock = calcularStockDisponible(p);
        const cls   = stock === 0 ? 'badge-stock-cero' : 'badge-stock-bajo';
        return `<li>
          <div>
            <div class="item-nombre">${_esc(p.codigoCorto || p.codigoCompleto || '—')}</div>
            <div class="item-detalle">${_esc([p.familia, p.talle].filter(Boolean).join(' · '))}</div>
          </div>
          <span class="badge ${cls}">${stock} uds.</span>
        </li>`;
      }).join('');
    }
  }
}

// ══ RENDERIZADO: Diferencias ══════════════════════════════════════

function renderizarDiferencias() {
  const lista = document.getElementById('lista-diferencias');
  if (!lista) return;

  const conDif = obtenerProductos().filter(p => {
    const dif = calcularDiferencia(p);
    return dif !== null && dif !== 0;
  }).sort((a, b) => {
    // Los más negativos (faltante) primero
    return calcularDiferencia(a) - calcularDiferencia(b);
  });

  if (conDif.length === 0) {
    lista.innerHTML = `<li><div class="estado-vacio">
      <span class="icono-grande">✅</span>
      <p>No hay diferencias de inventario registradas.</p>
    </div></li>`;
    return;
  }

  lista.innerHTML = conDif.map(p => {
    const dif    = calcularDiferencia(p);
    const cls    = dif > 0 ? 'stock-bajo' : 'stock-cero';
    const signo  = dif > 0 ? '+' : '';
    return `<li class="item-producto" data-id="${p.id}">
      <div class="item-producto-data">
        <div class="item-codigo-corto">${_esc(p.codigoCorto) || '—'}</div>
        <div class="item-descripcion">${_esc(p.codigoCompleto) || '—'}</div>
        ${p.fechaConteo ? `<div class="item-meta">Conteo: ${_fmtFecha(p.fechaConteo)}</div>` : ''}
        ${p.explicacionDiferencia
          ? `<div class="item-meta" style="color:var(--naranja);">${_esc(p.explicacionDiferencia)}</div>`
          : ''}
      </div>
      <div class="item-stock-display ${cls}">
        <span class="stock-numero">${signo}${dif}</span>
        <span class="stock-label">dif.</span>
      </div>
    </li>`;
  }).join('');

  lista.querySelectorAll('.item-producto').forEach(el => {
    el.addEventListener('click', () => {
      mostrarDetalle(el.dataset.id);
    });
  });
}

// ══ NAVEGACIÓN: Mostrar detalle / nuevo ═══════════════════════════

function mostrarDetalle(id) {
  const p = id ? obtenerProducto(id) : null;

  _idActual = id || null;
  _modoForm = id ? 'editar' : 'nuevo';

  // Header
  const elTitulo   = document.getElementById('titulo-detalle');
  const btnElim    = document.getElementById('btn-eliminar-producto');
  const btnMov     = document.getElementById('btn-ir-movimiento');

  if (elTitulo) elTitulo.textContent = id ? (p?.codigoCorto || 'Producto') : 'Nuevo producto';
  if (btnElim)  btnElim.style.display  = id ? 'flex' : 'none';
  if (btnMov)   btnMov.style.display   = id ? 'flex' : 'none';

  // Rellenar campos
  const textFields = [
    'codigoCorto', 'codigoCompleto', 'familia', 'caracteristica', 'material',
    'marca', 'articulo', 'talle', 'color', 'proveedor', 'fechaActualizacionCosto',
  ];
  const numFields = ['costo', 'costoConIva', 'precio', 'stockInicial'];

  textFields.forEach(c => {
    const el = document.getElementById(`d-${c}`);
    if (el) el.value = p ? (p[c] ?? '') : '';
  });
  numFields.forEach(c => {
    const el = document.getElementById(`d-${c}`);
    if (el) el.value = p ? (p[c] || '') : '';
  });

  renderizarResumenStock(p);
  irA('detalle');
}

// ══ NAVEGACIÓN: Mostrar formulario de movimiento ══════════════════

function mostrarMovimiento() {
  const p = _idActual ? obtenerProducto(_idActual) : null;
  if (!p) return;

  // Info del producto
  const infoEl = document.getElementById('mov-producto-info');
  if (infoEl) {
    const sd  = calcularStockDisponible(p);
    const cls = _claseStock(sd);
    infoEl.innerHTML = `
      <div class="mov-header-producto">
        <span class="mov-codigo">${_esc(p.codigoCorto) || '—'}</span>
        <div class="item-stock-display ${cls}" style="flex-direction:row;gap:6px;min-width:auto;">
          <span class="stock-numero" style="font-size:1.3rem;">${sd}</span>
          <span class="stock-label">en stock</span>
        </div>
      </div>
      <div class="item-descripcion" style="margin-bottom:4px;">${_esc(p.codigoCompleto) || ''}</div>`;
  }

  // Resetear formulario
  const fechaEl = document.getElementById('mov-fecha');
  if (fechaEl) fechaEl.value = new Date().toISOString().split('T')[0];

  ['mov-cantidad', 'mov-observaciones', 'mov-explicacion'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const tipoEl = document.getElementById('mov-tipo');
  if (tipoEl) tipoEl.value = 'pedido';
  _actualizarUIMovimiento('pedido');

  const infoMov = document.getElementById('info-movimiento');
  if (infoMov) infoMov.innerHTML = '';

  irA('movimiento');
}

function _actualizarUIMovimiento(tipo) {
  const labelCant  = document.getElementById('label-mov-cantidad');
  const campoExpl  = document.getElementById('campo-mov-explicacion');
  const infoEl     = document.getElementById('info-movimiento');
  const cantEl     = document.getElementById('mov-cantidad');

  const labels = {
    pedido:    'Unidades recibidas (cantidad positiva)',
    ajuste:    'Cantidad (positivo suma, negativo resta)',
    devolucion:'Unidades devueltas al stock',
    conteo:    'Stock físico contado (cantidad total real)',
  };

  if (labelCant) labelCant.textContent = labels[tipo] || 'Cantidad';
  if (campoExpl) campoExpl.style.display = tipo === 'conteo' ? 'block' : 'none';

  if (tipo === 'conteo') {
    const p  = _idActual ? obtenerProducto(_idActual) : null;
    const sd = p ? calcularStockDisponible(p) : '?';
    if (infoEl) infoEl.innerHTML = `
      <strong>Stock disponible actual: ${sd} uds.</strong><br>
      Ingresá el total real contado en el depósito.<br>
      La diferencia se calcula automáticamente.`;
    if (cantEl) cantEl.placeholder = sd.toString();
  } else {
    if (infoEl) infoEl.innerHTML = '';
    if (cantEl) cantEl.placeholder = '0';
  }
}

// ══ HELPERS ═══════════════════════════════════════════════════════

function _esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtFecha(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch { return iso; }
}

function _leerFormDetalle() {
  const leer    = id => document.getElementById(id)?.value.trim() || '';
  const leerNum = id => parseFloat(document.getElementById(id)?.value) || 0;
  return {
    codigoCorto:             leer('d-codigoCorto'),
    codigoCompleto:          leer('d-codigoCompleto'),
    familia:                 leer('d-familia'),
    caracteristica:          leer('d-caracteristica'),
    material:                leer('d-material'),
    marca:                   leer('d-marca'),
    articulo:                leer('d-articulo'),
    talle:                   leer('d-talle'),
    color:                   leer('d-color'),
    proveedor:               leer('d-proveedor'),
    costo:                   leerNum('d-costo'),
    costoConIva:             leerNum('d-costoConIva'),
    precio:                  leerNum('d-precio'),
    fechaActualizacionCosto: leer('d-fechaActualizacionCosto'),
    stockInicial:            leerNum('d-stockInicial'),
  };
}

// ══ INICIALIZACIÓN Y EVENTOS ══════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  renderizarListaProductos();
  renderizarMetricasInicio();
  _poblarFiltros();

  // ── Búsqueda
  document.getElementById('buscar-producto')?.addEventListener('input', e => {
    _filtros.busqueda = e.target.value;
    renderizarListaProductos();
  });

  // ── Filtros desplegables
  ['filtro-familia', 'filtro-marca', 'filtro-proveedor'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', e => {
      _filtros[id.replace('filtro-', '')] = e.target.value;
      renderizarListaProductos();
    });
  });

  // ── FAB → nuevo producto (solo cuando la pestaña Stock está activa)
  document.getElementById('fab-agregar')?.addEventListener('click', () => {
    if (document.getElementById('vista-stock')?.classList.contains('activa')) {
      mostrarDetalle(null);
    }
  });

  // ── Volver a lista desde detalle
  document.getElementById('btn-volver-lista')?.addEventListener('click', () => {
    _poblarFiltros();
    renderizarListaProductos();
    irA('lista');
  });

  // ── Guardar producto
  document.getElementById('btn-guardar-producto')?.addEventListener('click', () => {
    const datos = _leerFormDetalle();

    if (!datos.codigoCorto) {
      window.App?.mostrarToast('⚠ El código corto es obligatorio');
      return;
    }

    const btn = document.getElementById('btn-guardar-producto');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      if (_modoForm === 'editar' && _idActual) {
        const p = actualizarProducto(_idActual, datos);
        renderizarResumenStock(p);
        window.App?.mostrarToast('✔ Producto actualizado');
      } else {
        const p = crearProducto(datos);
        _idActual = p.id;
        _modoForm = 'editar';
        document.getElementById('titulo-detalle').textContent    = p.codigoCorto || 'Producto';
        document.getElementById('btn-eliminar-producto').style.display = 'flex';
        document.getElementById('btn-ir-movimiento').style.display     = 'flex';
        renderizarResumenStock(p);
        window.App?.mostrarToast('✔ Producto creado');
      }
      renderizarMetricasInicio();
    } finally {
      btn.disabled    = false;
      btn.textContent = '💾 Guardar producto';
    }
  });

  // ── Eliminar producto
  document.getElementById('btn-eliminar-producto')?.addEventListener('click', () => {
    if (!_idActual) return;
    const p = obtenerProducto(_idActual);
    if (!confirm(`¿Eliminás "${p?.codigoCorto || 'este producto'}"?\nEsta acción no se puede deshacer.`)) return;

    eliminarProducto(_idActual);
    _idActual = null;
    _poblarFiltros();
    renderizarListaProductos();
    renderizarMetricasInicio();
    irA('lista');
    window.App?.mostrarToast('🗑 Producto eliminado');
  });

  // ── Ir a movimiento desde detalle
  document.getElementById('btn-ir-movimiento')?.addEventListener('click', mostrarMovimiento);

  // ── Volver a detalle desde movimiento
  document.getElementById('btn-volver-a-detalle')?.addEventListener('click', () => {
    const p = _idActual ? obtenerProducto(_idActual) : null;
    renderizarResumenStock(p);
    irA('detalle');
  });

  // ── Cambio de tipo en movimiento → actualizar UI
  document.getElementById('mov-tipo')?.addEventListener('change', e => {
    _actualizarUIMovimiento(e.target.value);
  });

  // ── Confirmar movimiento
  document.getElementById('btn-confirmar-movimiento')?.addEventListener('click', () => {
    if (!_idActual) return;

    const tipo       = document.getElementById('mov-tipo')?.value;
    const cantidad   = parseFloat(document.getElementById('mov-cantidad')?.value);
    const fecha      = document.getElementById('mov-fecha')?.value;
    const obs        = document.getElementById('mov-observaciones')?.value.trim();
    const explicacion = document.getElementById('mov-explicacion')?.value.trim();

    if (isNaN(cantidad) || cantidad < 0) {
      window.App?.mostrarToast('⚠ Ingresá una cantidad válida (≥ 0)');
      return;
    }

    // Para conteo: si hay diferencia, pedir explicación
    if (tipo === 'conteo') {
      const sd  = calcularStockDisponible(obtenerProducto(_idActual));
      const dif = cantidad - sd;
      if (dif !== 0 && !explicacion) {
        window.App?.mostrarToast('⚠ Explicá el motivo de la diferencia');
        document.getElementById('mov-explicacion')?.focus();
        return;
      }
    }

    const btn = document.getElementById('btn-confirmar-movimiento');
    btn.disabled    = true;
    btn.textContent = 'Guardando...';

    try {
      const p = registrarMovimiento(_idActual, tipo, cantidad, fecha, obs, explicacion);
      window.App?.mostrarToast('✔ Movimiento registrado');
      renderizarResumenStock(p);
      renderizarMetricasInicio();
      irA('detalle');
    } catch (err) {
      window.App?.mostrarToast('❌ ' + err.message);
    } finally {
      btn.disabled    = false;
      btn.textContent = '✔ Confirmar movimiento';
    }
  });

  // ── Ver diferencias de inventario
  document.getElementById('btn-ver-diferencias')?.addEventListener('click', () => {
    renderizarDiferencias();
    irA('diferencias');
  });

  // ── Volver desde diferencias
  document.getElementById('btn-volver-desde-diferencias')?.addEventListener('click', () => {
    irA('lista');
  });
});

// ══ EXPORTAR ══════════════════════════════════════════════════════

window.Stock = {
  // Storage
  obtenerProductos,
  guardarProductos,
  obtenerProducto,
  // Cálculos
  calcularStockDisponible,
  calcularDiferencia,
  // CRUD
  crearProducto,
  actualizarProducto,
  actualizarVentaProducto,
  eliminarProducto,
  // Movimientos
  registrarMovimiento,
  // Sync completo (backup) — usado por sync.js
  sincronizarTodo: _sincronizarStockCompleto,
  // Renderizado (llamado desde otros módulos)
  renderizarListaProductos,
  renderizarMetricasInicio,
  renderizarDiferencias,
  // Navegación
  mostrarDetalle,
  mostrarMovimiento,
  irA,
};
