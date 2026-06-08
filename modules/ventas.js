// ── Módulo Control de Ventas ────────────────────────────────────
// Cada venta es de UN producto. Estructura:
//   id, fecha, nombreCliente, codigoCompleto, codigoCorto, familia, talle,
//   color, precio, cantidad, descuento, montoVenta(calc), cobrado, tipoCobro,
//   fechaCobro, saldoACobrar(calc), preparado, entregado, fechaEntrega,
//   costo, ganancia(calc), observaciones, productoId
//
// Al guardar: descuenta del stock del producto (Stock.actualizarVentaProducto)
// y sincroniza VENTAS (acá) + STOCK (lo hace Stock automáticamente).

const CLAVE_VENTAS = 'convos_ventas';

// ══ STORAGE ══════════════════════════════════════════════════════

function obtenerVentas() {
  try { return JSON.parse(localStorage.getItem(CLAVE_VENTAS)) || []; }
  catch { return []; }
}

function guardarVentas(ventas) {
  localStorage.setItem(CLAVE_VENTAS, JSON.stringify(ventas));
}

function obtenerVenta(id) {
  return obtenerVentas().find(v => v.id === id) || null;
}

// ══ CÁLCULOS ══════════════════════════════════════════════════════

// Rellena los campos calculados (montoVenta, saldoACobrar, ganancia).
function _calcular(v) {
  const precio    = Number(v.precio)    || 0;
  const cantidad  = Number(v.cantidad)  || 0;
  const descuento = Number(v.descuento) || 0;
  const costo     = Number(v.costo)     || 0;
  const cobrado   = Number(v.cobrado)   || 0;

  v.montoVenta    = Math.max(0, precio * cantidad - descuento);
  v.saldoACobrar  = Math.max(0, v.montoVenta - cobrado);
  v.ganancia      = v.montoVenta - (costo * cantidad);
  return v;
}

// ══ REGISTRO ══════════════════════════════════════════════════════

function registrarVenta(datos) {
  const ventas = obtenerVentas();

  const v = _calcular({
    id:             datos.id || ('vta_' + Date.now().toString(36)),
    fecha:          datos.fecha || new Date().toISOString(),
    nombreCliente:  datos.nombreCliente || 'Sin cliente',
    productoId:     datos.productoId || null,
    codigoCompleto: datos.codigoCompleto || '',
    codigoCorto:    datos.codigoCorto || '',
    familia:        datos.familia || '',
    talle:          datos.talle || '',
    color:          datos.color || '',
    precio:         Number(datos.precio) || 0,
    cantidad:       Number(datos.cantidad) || 1,
    descuento:      Number(datos.descuento) || 0,
    cobrado:        Number(datos.cobrado) || 0,
    tipoCobro:      datos.tipoCobro || 'efectivo',
    fechaCobro:     datos.fechaCobro || '',
    preparado:      datos.preparado === true,
    entregado:      datos.entregado === true,
    fechaEntrega:   datos.fechaEntrega || '',
    costo:          Number(datos.costo) || 0,
    // La venta sólo descuenta del stock cuando está confirmada.
    confirmada:     datos.confirmada !== false,   // por defecto confirmada
    observaciones:  datos.observaciones || '',
  });

  ventas.unshift(v);
  guardarVentas(ventas);

  // Descontar stock del producto SOLO si la venta está confirmada.
  // Esto a su vez sincroniza STOCK con Sheets.
  if (v.productoId && v.confirmada && typeof Stock !== 'undefined') {
    Stock.actualizarVentaProducto(v.productoId, v.cantidad);
  }

  _sincronizarVentas();   // syncToSheets('VENTAS', ...)
  return v;
}

function actualizarVenta(id, cambios) {
  const ventas = obtenerVentas();
  const idx = ventas.findIndex(v => v.id === id);
  if (idx === -1) return null;

  // Estado previo para calcular el impacto en stock
  const anterior        = ventas[idx];
  const cantidadPrevia  = (anterior.confirmada !== false) ? (Number(anterior.cantidad) || 0) : 0;

  ventas[idx] = _calcular({ ...anterior, ...cambios });
  const nueva           = ventas[idx];
  const cantidadNueva   = (nueva.confirmada !== false) ? (Number(nueva.cantidad) || 0) : 0;

  guardarVentas(ventas);

  // Ajustar el stock por la diferencia (confirmar/desconfirmar o cambio de cantidad)
  const delta = cantidadNueva - cantidadPrevia;
  if (delta !== 0 && nueva.productoId && typeof Stock !== 'undefined') {
    Stock.actualizarVentaProducto(nueva.productoId, delta);
  }

  _sincronizarVentas();
  return ventas[idx];
}

function eliminarVenta(id) {
  guardarVentas(obtenerVentas().filter(v => v.id !== id));
  _sincronizarVentas();
}

// Compat: cobranzas.js recalcula el saldo tras un pago.
function recalcularCobranza(ventaId) {
  return actualizarVenta(ventaId, {});   // _calcular re-deriva saldoACobrar
}

// ══ MÉTRICAS / DASHBOARD ══════════════════════════════════════════

function ventasDeHoy() {
  const hoy = new Date().toDateString();
  return obtenerVentas().filter(v => new Date(v.fecha).toDateString() === hoy);
}

function totalDeHoy() {
  return ventasDeHoy().reduce((acc, v) => acc + (Number(v.montoVenta) || 0), 0);
}

// Resumen del período (por defecto: todo el histórico).
function resumen(ventas = obtenerVentas()) {
  const r = { vendido: 0, cobrado: 0, porCobrar: 0, ganancia: 0, pendientesEntrega: 0, cantidad: ventas.length };
  ventas.forEach(v => {
    r.vendido   += Number(v.montoVenta)   || 0;
    r.cobrado   += Number(v.cobrado)      || 0;
    r.porCobrar += Number(v.saldoACobrar) || 0;
    r.ganancia  += Number(v.ganancia)     || 0;
    if (!v.entregado) r.pendientesEntrega += 1;
  });
  return r;
}

// ══ SINCRONIZACIÓN ════════════════════════════════════════════════

const _ENCABEZADOS_VENTAS = [
  'id', 'fecha', 'nombreCliente', 'codigoCompleto', 'codigoCorto', 'familia',
  'talle', 'color', 'precio', 'cantidad', 'descuento', 'montoVenta', 'cobrado',
  'tipoCobro', 'fechaCobro', 'saldoACobrar', 'preparado', 'entregado',
  'fechaEntrega', 'costo', 'ganancia', 'confirmada', 'observaciones',
];

async function _sincronizarVentas() {
  if (typeof Sync === 'undefined' || !Sync.estaConfigurado()) return;

  const filas = [
    _ENCABEZADOS_VENTAS,
    ...obtenerVentas().map(v => [
      v.id, v.fecha, v.nombreCliente || '', v.codigoCompleto || '', v.codigoCorto || '',
      v.familia || '', v.talle || '', v.color || '',
      Number(v.precio) || 0, Number(v.cantidad) || 0, Number(v.descuento) || 0,
      Number(v.montoVenta) || 0, Number(v.cobrado) || 0, v.tipoCobro || '',
      v.fechaCobro || '', Number(v.saldoACobrar) || 0,
      v.preparado ? 'Sí' : 'No', v.entregado ? 'Sí' : 'No', v.fechaEntrega || '',
      Number(v.costo) || 0, Number(v.ganancia) || 0,
      (v.confirmada !== false) ? 'Sí' : 'No', v.observaciones || '',
    ]),
  ];

  try {
    await Sync.syncToSheets('VENTAS', filas, 'overwrite');
  } catch (err) {
    console.warn('[Ventas sync]', err.message);
  }
}

// ══ HELPERS ═══════════════════════════════════════════════════════

function _esc(str) {
  if (!str && str !== 0) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtMoneda(n) {
  return '$' + (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function _fmtFecha(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  catch { return '—'; }
}

const _ETIQUETA_COBRO = {
  efectivo:         'Efectivo',
  mercadopago:      'Mercado Pago',
  transferencia:    'Transferencia',
  cuenta_corriente: 'Cuenta corriente',
};

function _stockDisp(p) {
  return (typeof Stock !== 'undefined' && p) ? Stock.calcularStockDisponible(p) : 0;
}

// ══ NAVEGACIÓN INTERNA (sub-vistas) ═══════════════════════════════

function _irVentas(subvista) {
  document.querySelectorAll('.ventas-sv').forEach(el => el.classList.remove('activa'));
  document.getElementById(`ventas-${subvista}`)?.classList.add('activa');
  document.getElementById('ventas-tab-nueva')?.classList.toggle('activo', subvista === 'nueva');
  document.getElementById('ventas-tab-lista')?.classList.toggle('activo', subvista === 'lista');
  document.getElementById('contenido')?.scrollTo(0, 0);
}

// ══ NUEVA VENTA: estado y buscador de producto ════════════════════

let _productoSel = null;   // producto elegido del stock

function _renderSugerenciasProducto(texto) {
  const sug = document.getElementById('venta-sugerencias');
  if (!sug) return;
  const q = (texto || '').toLowerCase().trim();
  if (!q) { sug.style.display = 'none'; sug.innerHTML = ''; return; }

  const productos = (typeof Stock !== 'undefined' ? Stock.obtenerProductos() : [])
    .filter(p =>
      (p.codigoCorto    || '').toLowerCase().includes(q) ||
      (p.codigoCompleto || '').toLowerCase().includes(q))
    .slice(0, 8);

  if (productos.length === 0) {
    sug.innerHTML = `<div class="sugerencia-vacia">Sin productos que coincidan.</div>`;
    sug.style.display = 'block';
    return;
  }

  sug.innerHTML = productos.map(p => {
    const disp = _stockDisp(p);
    return `<div class="sugerencia" data-id="${p.id}">
       <strong>${_esc(p.codigoCorto || p.codigoCompleto)}</strong>
       <small>${_esc(p.codigoCompleto)} · ${_fmtMoneda(p.precio)} · stock ${disp}</small>
     </div>`;
  }).join('');
  sug.style.display = 'block';
  sug.querySelectorAll('.sugerencia').forEach(el =>
    el.addEventListener('click', () => _seleccionarProducto(el.dataset.id)));
}

function _seleccionarProducto(id) {
  const p = typeof Stock !== 'undefined' ? Stock.obtenerProducto(id) : null;
  _productoSel = p;

  const sug  = document.getElementById('venta-sugerencias');
  const busc = document.getElementById('venta-buscar-producto');
  if (sug)  { sug.style.display = 'none'; sug.innerHTML = ''; }
  if (busc && p) busc.value = p.codigoCorto || p.codigoCompleto;

  // Precio sugerido
  const precioEl = document.getElementById('venta-precio');
  if (precioEl && p) precioEl.value = Number(p.precio) || 0;

  _renderInfoProducto();
  _recalcularResumen();
  document.getElementById('venta-cantidad')?.focus();
}

function _renderInfoProducto() {
  const card = document.getElementById('venta-info-producto');
  if (!card) return;
  if (!_productoSel) { card.style.display = 'none'; card.innerHTML = ''; return; }

  const p    = _productoSel;
  const disp = _stockDisp(p);
  const claseStock = disp <= 0 ? 'stock-cero' : (disp <= 5 ? 'stock-bajo' : 'stock-ok');

  card.style.display = 'block';
  card.innerHTML = `
    <div class="vinfo-grid">
      <div class="vinfo-stock ${claseStock}">
        <span class="vinfo-num">${disp}</span>
        <span class="vinfo-cap">Stock disponible</span>
      </div>
      <div class="vinfo-datos">
        <div class="vinfo-codigo">${_esc(p.codigoCompleto || p.codigoCorto)}</div>
        <div class="vinfo-linea">Precio: <strong>${_fmtMoneda(p.precio)}</strong></div>
        <div class="vinfo-linea">Costo: ${_fmtMoneda(p.costo)}</div>
      </div>
    </div>`;
}

// ══ NUEVA VENTA: cálculo en tiempo real ═══════════════════════════

function _leerFormulario() {
  const precio    = parseFloat(document.getElementById('venta-precio')?.value) || (_productoSel?.precio || 0);
  const cantidad  = parseInt(document.getElementById('venta-cantidad')?.value) || 0;
  const descIn    = parseFloat(document.getElementById('venta-descuento')?.value) || 0;
  const descTipo  = document.getElementById('venta-descuento-tipo')?.value || 'monto';
  const descuento = descTipo === 'porcentaje'
    ? Math.round(precio * cantidad * (descIn / 100))
    : descIn;
  const costo     = _productoSel?.costo || 0;
  const montoVenta = Math.max(0, precio * cantidad - descuento);

  const cobradoTog = document.getElementById('venta-cobrado')?.checked;
  const cobrado    = cobradoTog ? montoVenta : 0;

  return {
    precio, cantidad, descuento, costo, montoVenta, cobrado,
    ganancia: montoVenta - costo * cantidad,
    tipoCobro:   document.getElementById('venta-tipo-cobro')?.value || 'efectivo',
    fechaCobro:  cobradoTog ? (document.getElementById('venta-fecha-cobro')?.value || new Date().toISOString().split('T')[0]) : '',
    entregado:   document.getElementById('venta-entregado')?.checked === true,
    confirmada:  document.getElementById('venta-confirmada') ? document.getElementById('venta-confirmada').checked : true,
    nombreCliente: document.getElementById('venta-cliente')?.value.trim() || 'Sin cliente',
    observaciones: document.getElementById('venta-observaciones')?.value.trim() || '',
  };
}

function _recalcularResumen() {
  const f = _leerFormulario();

  const setT = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  setT('venta-resumen-monto',     _fmtMoneda(f.montoVenta));
  setT('venta-resumen-descuento', f.descuento > 0 ? '− ' + _fmtMoneda(f.descuento) : '$0');
  setT('venta-resumen-ganancia',  _fmtMoneda(f.ganancia));

  const gananciaEl = document.getElementById('venta-resumen-ganancia');
  if (gananciaEl) gananciaEl.classList.toggle('negativa', f.ganancia < 0);

  // Alerta de stock
  const alerta = document.getElementById('venta-alerta-stock');
  if (alerta) {
    const disp = _stockDisp(_productoSel);
    if (!_productoSel) {
      alerta.style.display = 'none';
    } else if (disp <= 0) {
      alerta.style.display = 'block';
      alerta.className = 'alerta-stock critica';
      alerta.textContent = '⛔ Sin stock disponible de este producto.';
    } else if (f.cantidad > disp) {
      alerta.style.display = 'block';
      alerta.className = 'alerta-stock critica';
      alerta.textContent = `⚠ Stock insuficiente: pedís ${f.cantidad} y hay ${disp}.`;
    } else {
      alerta.style.display = 'none';
    }
  }

  // Mostrar/ocultar fecha de cobro
  const cobrado = document.getElementById('venta-cobrado')?.checked;
  const campoFecha = document.getElementById('campo-fecha-cobro');
  if (campoFecha) campoFecha.style.display = cobrado ? 'block' : 'none';
}

function _confirmarVenta() {
  if (!_productoSel) { window.App?.mostrarToast('⚠ Elegí un producto del stock'); return; }
  const f = _leerFormulario();
  if (f.cantidad <= 0) { window.App?.mostrarToast('⚠ La cantidad debe ser mayor a 0'); return; }
  if (f.precio <= 0)   { window.App?.mostrarToast('⚠ Ingresá un precio válido'); return; }

  const disp = _stockDisp(_productoSel);
  if (f.cantidad > disp) {
    const ok = confirm(`Stock insuficiente (disponible: ${disp}). ¿Registrar la venta igual?`);
    if (!ok) return;
  }

  registrarVenta({
    nombreCliente:  f.nombreCliente,
    productoId:     _productoSel.id,
    codigoCompleto: _productoSel.codigoCompleto,
    codigoCorto:    _productoSel.codigoCorto,
    familia:        _productoSel.familia,
    talle:          _productoSel.talle,
    color:          _productoSel.color,
    precio:         f.precio,
    cantidad:       f.cantidad,
    descuento:      f.descuento,
    cobrado:        f.cobrado,
    tipoCobro:      f.tipoCobro,
    fechaCobro:     f.fechaCobro,
    entregado:      f.entregado,
    fechaEntrega:   f.entregado ? new Date().toISOString() : '',
    costo:          f.costo,
    confirmada:     f.confirmada,
    observaciones:  f.observaciones,
  });

  _resetFormulario();
  _refrescarTodo();
  window.App?.mostrarToast(f.confirmada
    ? '✔ Venta registrada · stock actualizado'
    : '✔ Venta registrada (sin confirmar · no descuenta stock)');
}

function _resetFormulario() {
  _productoSel = null;
  ['venta-buscar-producto', 'venta-precio', 'venta-descuento', 'venta-cliente', 'venta-observaciones']
    .forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  const cant = document.getElementById('venta-cantidad'); if (cant) cant.value = '1';
  const cob  = document.getElementById('venta-cobrado');  if (cob)  cob.checked = false;
  const ent  = document.getElementById('venta-entregado'); if (ent) ent.checked = false;
  const conf = document.getElementById('venta-confirmada'); if (conf) conf.checked = true;
  _renderInfoProducto();
  _recalcularResumen();
}

// ══ LISTA DE VENTAS ═══════════════════════════════════════════════

let _filtroLista = 'todas';   // 'todas' | 'cobrar' | 'entregar'

function _setFiltroVentas(f) {
  _filtroLista = f;
  ['todas', 'cobrar', 'entregar'].forEach(k =>
    document.getElementById(`vf-${k}`)?.classList.toggle('activo', k === f));
  renderizarListaVentas();
}

function _ventasFiltradas() {
  const ventas = obtenerVentas()
    .slice()
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  if (_filtroLista === 'cobrar')   return ventas.filter(v => (Number(v.saldoACobrar) || 0) > 0.001);
  if (_filtroLista === 'entregar') return ventas.filter(v => !v.entregado);
  return ventas;
}

function renderizarListaVentas() {
  const lista = document.getElementById('lista-ventas');
  if (!lista) return;
  const ventas = _ventasFiltradas();

  if (ventas.length === 0) {
    lista.innerHTML = `<li><div class="estado-vacio">
      <span class="icono-grande">🛒</span><p>No hay ventas para este filtro.</p></div></li>`;
    return;
  }

  lista.innerHTML = ventas.map(v => {
    const cobrado = (Number(v.saldoACobrar) || 0) <= 0.001;
    const badgeCobro = cobrado
      ? `<span class="badge badge-ok">Cobrado</span>`
      : `<span class="badge badge-deuda">Debe ${_fmtMoneda(v.saldoACobrar)}</span>`;
    const badgeEnt = v.entregado
      ? `<span class="badge badge-ok">Entregado</span>`
      : `<span class="badge badge-pend">Por entregar</span>`;
    const badgeConf = (v.confirmada === false)
      ? `<span class="badge badge-deuda">Sin confirmar</span>`
      : '';
    return `<li class="item-venta" data-id="${_esc(v.id)}">
      <div class="item-venta-main">
        <div class="item-nombre">${_esc(v.nombreCliente || 'Sin cliente')}</div>
        <div class="item-detalle">${_esc(v.codigoCorto || v.codigoCompleto)} · ${v.cantidad} u · ${_fmtFecha(v.fecha)}</div>
        <div class="item-badges">${badgeCobro} ${badgeEnt} ${badgeConf}</div>
      </div>
      <span class="negrita">${_fmtMoneda(v.montoVenta)}</span>
    </li>`;
  }).join('');

  lista.querySelectorAll('.item-venta').forEach(el =>
    el.addEventListener('click', () => _mostrarDetalle(el.dataset.id)));
}

// ══ DETALLE / EDICIÓN ═════════════════════════════════════════════

let _ventaDetId = null;

function _mostrarDetalle(id) {
  const v = obtenerVenta(id);
  if (!v) return;
  _ventaDetId = id;

  const cont = document.getElementById('venta-detalle-cuerpo');
  if (cont) {
    cont.innerHTML = `
      <div class="detalle-fila"><span>Cliente</span><strong>${_esc(v.nombreCliente)}</strong></div>
      <div class="detalle-fila"><span>Producto</span><strong>${_esc(v.codigoCorto || v.codigoCompleto)}</strong></div>
      <div class="detalle-fila"><span>${_esc(v.codigoCompleto)}</span><span>${_esc([v.familia, v.talle, v.color].filter(Boolean).join(' · '))}</span></div>
      <div class="detalle-fila"><span>Fecha</span><span>${_fmtFecha(v.fecha)}</span></div>
      <div class="detalle-fila"><span>Cantidad × Precio</span><span>${v.cantidad} × ${_fmtMoneda(v.precio)}</span></div>
      <div class="detalle-fila"><span>Descuento</span><span>${_fmtMoneda(v.descuento)}</span></div>
      <div class="detalle-fila total"><span>Monto venta</span><strong>${_fmtMoneda(v.montoVenta)}</strong></div>
      <div class="detalle-fila"><span>Ganancia</span><span class="${v.ganancia < 0 ? 'negativa' : ''}">${_fmtMoneda(v.ganancia)}</span></div>
      ${v.observaciones ? `<div class="detalle-fila"><span>Obs.</span><span>${_esc(v.observaciones)}</span></div>` : ''}
    `;
  }

  // Estado cobro
  const saldo = Number(v.saldoACobrar) || 0;
  const cobChk = document.getElementById('vdet-cobrado');
  if (cobChk) cobChk.checked = saldo <= 0.001;
  const tipoSel = document.getElementById('vdet-tipo-cobro');
  if (tipoSel) tipoSel.value = v.tipoCobro || 'efectivo';
  const saldoEl = document.getElementById('vdet-saldo');
  if (saldoEl) saldoEl.textContent = saldo > 0.001 ? `Saldo: ${_fmtMoneda(saldo)}` : 'Cobrada por completo';

  // Estado entrega
  const entChk = document.getElementById('vdet-entregado');
  if (entChk) entChk.checked = v.entregado === true;

  // Estado confirmación (afecta el stock)
  const confChk = document.getElementById('vdet-confirmada');
  if (confChk) confChk.checked = v.confirmada !== false;

  _irVentas('detalle');
}

function _guardarDetalle() {
  if (!_ventaDetId) return;
  const v = obtenerVenta(_ventaDetId);
  if (!v) return;

  const cobrarTodo = document.getElementById('vdet-cobrado')?.checked;
  const tipoCobro  = document.getElementById('vdet-tipo-cobro')?.value || v.tipoCobro;
  const entregado  = document.getElementById('vdet-entregado')?.checked === true;
  const confChk    = document.getElementById('vdet-confirmada');
  const confirmada = confChk ? confChk.checked : (v.confirmada !== false);

  const cambios = {
    tipoCobro,
    cobrado:      cobrarTodo ? v.montoVenta : (Number(v.cobrado) || 0),
    fechaCobro:   cobrarTodo ? (v.fechaCobro || new Date().toISOString().split('T')[0]) : v.fechaCobro,
    entregado,
    fechaEntrega: entregado ? (v.fechaEntrega || new Date().toISOString()) : '',
    confirmada,
  };

  actualizarVenta(_ventaDetId, cambios);
  _refrescarTodo();
  renderizarListaVentas();
  _irVentas('lista');
  window.App?.mostrarToast('✔ Venta actualizada');
}

// ══ RENDERIZADO: dashboard + inicio ═══════════════════════════════

function renderizarDashboard() {
  const r = resumen();
  const setT = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  setT('vd-vendido',     _fmtMoneda(r.vendido));
  setT('vd-cobrado',     _fmtMoneda(r.cobrado));
  setT('vd-por-cobrar',  _fmtMoneda(r.porCobrar));
  setT('vd-ganancia',    _fmtMoneda(r.ganancia));
  setT('vd-pend-entrega', r.pendientesEntrega);
}

// Compat con app.js (navegación a Ventas)
function renderizarVentasDia() {
  renderizarListaVentas();
  renderizarDashboard();
}

function renderizarUltimasVentas() {
  const lista = document.getElementById('lista-ultimas-ventas');
  if (!lista) return;
  const ventas = obtenerVentas().slice(0, 5);

  if (ventas.length === 0) {
    lista.innerHTML = `<li><div class="estado-vacio">
      <div class="icono-grande">🛒</div><p>Todavía no hay ventas registradas.</p></div></li>`;
    return;
  }

  lista.innerHTML = ventas.map(v =>
    `<li>
      <div>
        <div class="item-nombre">${_esc(v.nombreCliente || 'Sin cliente')}</div>
        <div class="item-detalle">${_esc(v.codigoCorto || v.codigoCompleto)} · ${_fmtFecha(v.fecha)}</div>
      </div>
      <span class="negrita">${_fmtMoneda(v.montoVenta)}</span>
    </li>`).join('');
}

function actualizarMetricasVentas() {
  const elCant  = document.getElementById('metro-ventas-hoy');
  const elTotal = document.getElementById('metro-total-hoy');
  if (elCant) elCant.textContent = ventasDeHoy().length;
  if (elTotal) {
    const total = totalDeHoy();
    elTotal.textContent = total >= 1000 ? `$${(total / 1000).toFixed(1)}k` : `$${total.toFixed(0)}`;
  }
  renderizarDashboard();
}

function _refrescarTodo() {
  renderizarListaVentas();
  renderizarDashboard();
  renderizarUltimasVentas();
  actualizarMetricasVentas();
  typeof Stock     !== 'undefined' && Stock.renderizarListaProductos?.();
  typeof Stock     !== 'undefined' && Stock.renderizarMetricasInicio?.();
  typeof Cobranzas !== 'undefined' && Cobranzas.refrescar?.();
  typeof Entregas  !== 'undefined' && Entregas.refrescar?.();
}

// ══ INICIALIZACIÓN ════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  renderizarListaVentas();
  renderizarDashboard();
  renderizarUltimasVentas();
  actualizarMetricasVentas();
  _recalcularResumen();

  // Toggle sub-vistas
  document.getElementById('ventas-tab-nueva')?.addEventListener('click', () => _irVentas('nueva'));
  document.getElementById('ventas-tab-lista')?.addEventListener('click', () => { renderizarListaVentas(); _irVentas('lista'); });
  document.getElementById('btn-volver-ventas')?.addEventListener('click', () => { renderizarListaVentas(); _irVentas('lista'); });

  // Buscador de producto
  document.getElementById('venta-buscar-producto')?.addEventListener('input', e => _renderSugerenciasProducto(e.target.value));

  // Recalcular al cambiar cualquier campo
  ['venta-cantidad', 'venta-precio', 'venta-descuento', 'venta-descuento-tipo', 'venta-cobrado', 'venta-entregado']
    .forEach(id => {
      const el = document.getElementById(id);
      el?.addEventListener('input', _recalcularResumen);
      el?.addEventListener('change', _recalcularResumen);
    });

  // Confirmar venta
  document.getElementById('btn-registrar-venta')?.addEventListener('click', _confirmarVenta);

  // Filtros de la lista
  document.getElementById('vf-todas')?.addEventListener('click', () => _setFiltroVentas('todas'));
  document.getElementById('vf-cobrar')?.addEventListener('click', () => _setFiltroVentas('cobrar'));
  document.getElementById('vf-entregar')?.addEventListener('click', () => _setFiltroVentas('entregar'));

  // Detalle
  document.getElementById('btn-guardar-detalle')?.addEventListener('click', _guardarDetalle);
});

// ══ EXPORTAR ══════════════════════════════════════════════════════

window.Ventas = {
  obtenerVentas,
  obtenerVenta,
  registrarVenta,
  actualizarVenta,
  eliminarVenta,
  recalcularCobranza,
  ventasDeHoy,
  totalDeHoy,
  resumen,
  renderizarVentasDia,
  renderizarListaVentas,
  renderizarDashboard,
  renderizarUltimasVentas,
  actualizarMetricasVentas,
  mostrarDetalle: _mostrarDetalle,
  sincronizarTodo: _sincronizarVentas,
  _fmtMoneda,
  _esc,
};
