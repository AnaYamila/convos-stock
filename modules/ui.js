// ── Módulo UI ───────────────────────────────────────────────────
// Construye las pantallas: Nueva venta (con cascada facetada),
// consulta de Stock, Cobranzas y Entregas. No calcula nada: muestra
// lo que trae Datos (que a su vez lee del Google Sheet).

function _esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _val(id) { return (document.getElementById(id)?.value || '').trim(); }
function _money(n) { return '$' + (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 }); }
function _toast(m) { window.App?.mostrarToast?.(m); }

// Mapa campo → sufijo de id usado en el HTML
const _IDS = { familia: 'familia', marca: 'marca', caracteristica: 'caract', talle: 'talle', color: 'color' };

// ── Combo facetado reutilizable ─────────────────────────────────
// Conecta los 5 inputs (prefijo-familia, prefijo-marca, ...) con sus
// listas de sugerencias y mantiene `seleccion` sincronizada.

function _montarComboGrupo(prefijo, seleccion, onCambio) {
  const campos = window.Datos.CAMPOS_CASCADA;
  const raiz = campos[0];   // 'familia' → es la raíz: no se filtra por las demás

  function refrescarInputs() {
    campos.forEach(c => {
      const inp = document.getElementById(`${prefijo}-${_IDS[c]}`);
      if (inp) inp.value = seleccion[c] || '';
    });
  }

  // Opciones de un campo: la familia muestra SIEMPRE todas; el resto se
  // filtra por la selección actual (faceteado, en cualquier orden).
  function opcionesDe(c) {
    return c === raiz
      ? window.Datos.opcionesCascada(c, {})
      : window.Datos.opcionesCascada(c, seleccion);
  }

  function revalidar() {
    for (let pass = 0; pass < 2; pass++) {
      campos.forEach(c => {
        if (!seleccion[c]) return;
        const ops = opcionesDe(c);
        if (!ops.includes(seleccion[c])) seleccion[c] = '';
      });
    }
    refrescarInputs();
  }

  // Al cambiar/borrar la familia se resetean los demás campos
  function _siRaizLimpiar(c) {
    if (c === raiz) campos.slice(1).forEach(o => { seleccion[o] = ''; });
  }

  campos.forEach(c => {
    const inp  = document.getElementById(`${prefijo}-${_IDS[c]}`);
    const list = document.getElementById(`${prefijo}-${_IDS[c]}-list`);
    if (!inp || !list) return;

    function render() {
      const q = inp.value.trim().toLowerCase();
      let ops = opcionesDe(c);
      if (q) ops = ops.filter(o => o.toLowerCase().includes(q));
      if (ops.length === 0) {
        const sinStock = window.Datos.getStock().length === 0;
        list.innerHTML = `<div class="combo-vacio">${sinStock
          ? '⚠ Stock no cargado. Tocá 🔄 arriba para leer la planilla.'
          : 'Sin opciones para esta combinación'}</div>`;
      } else {
        list.innerHTML = ops.slice(0, 60)
          .map(o => `<div class="combo-op" data-v="${_esc(o)}">${_esc(o)}</div>`).join('');
      }
      list.style.display = 'block';
      list.querySelectorAll('.combo-op').forEach(el => {
        el.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          seleccion[c] = el.dataset.v;
          inp.value = el.dataset.v;
          list.style.display = 'none';
          _siRaizLimpiar(c);
          revalidar();
          onCambio?.();
        });
      });
    }

    inp.addEventListener('focus', render);
    inp.addEventListener('input', () => {
      if (inp.value.trim() === '') {
        seleccion[c] = '';
        _siRaizLimpiar(c);
        revalidar();
        onCambio?.();
      }
      render();
    });
    inp.addEventListener('blur', () => setTimeout(() => { list.style.display = 'none'; }, 160));
  });

  return { revalidar, refrescarInputs };
}

// ════════════════════════════════════════════════════════════════
// NUEVA VENTA
// ════════════════════════════════════════════════════════════════

const _selVenta = { familia: '', marca: '', caracteristica: '', talle: '', color: '' };
let _grupoVenta = null;
let _carrito = [];   // productos acumulados para la venta actual

function _infoVenta() {
  const info = document.getElementById('nv-info');
  if (!info) return;
  const completos = window.Datos.CAMPOS_CASCADA.every(c => _selVenta[c]);
  if (!completos) { info.style.display = 'none'; return; }

  const p = window.Datos.productoExacto(_selVenta);
  info.style.display = 'block';
  if (!p) {
    info.className = 'nv-info alerta';
    info.innerHTML = '⚠ Esa combinación no existe en el Stock. Revisá la selección.';
    return;
  }
  info.className = 'nv-info';
  const cls = p.disponible <= 0 ? 'neg' : (p.disponible <= 5 ? 'bajo' : 'ok');
  const avisoPrecio = p.precio <= 0
    ? `<div style="color:#b91c1c;font-weight:600;margin-top:4px;">⚠ Sin precio en Stock (el monto dará $0)</div>` : '';
  info.innerHTML = `
    <div class="nv-info-grid">
      <div class="nv-disp ${cls}">
        <span class="nv-disp-num">${p.disponible}</span><span class="nv-disp-cap">disponible</span>
      </div>
      <div class="nv-info-datos">
        <div class="nv-cod">${_esc(p.codigo)}</div>
        <div>Precio: <strong>${_money(p.precio)}</strong></div>
        ${avisoPrecio}
      </div>
    </div>`;
}

// Total de la venta = suma de (precio × cantidad + descuentos) del carrito
// más el producto que esté cargado en el formulario.
function _actualizarTotalVenta() {
  const el = document.getElementById('nv-total');
  if (!el) return;
  let total = 0;
  _carrito.forEach(it => { total += _montoItem(it); });
  const r = _leerProductoDe('nv', _selVenta);
  if (!r.vacio && r.completo) total += _montoItem(r.item);
  el.textContent = 'Total de la venta: ' + _money(total);
}

// Se dispara al cambiar producto, cantidad o descuento
function _onVentaCambio() {
  _infoVenta();
  _actualizarTotalVenta();
}

// Limpia solo los campos de PRODUCTO (deja cliente, fecha y cobro)
function _limpiarProductoVenta() {
  window.Datos.CAMPOS_CASCADA.forEach(c => { _selVenta[c] = ''; });
  _grupoVenta?.refrescarInputs();
  const cant = document.getElementById('nv-cantidad'); if (cant) cant.value = '';
  const desc = document.getElementById('nv-descuentos'); if (desc) desc.value = '';
  const conf = document.getElementById('nv-confirmado'); if (conf) conf.value = 'si';
  _infoVenta();
}

function _resetVenta() {
  _carrito = [];
  _limpiarProductoVenta();
  ['nv-cliente', 'nv-fechacobro', 'nv-fechaentrega', 'nv-lugarentrega']
    .forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
  const hoy = new Date().toISOString().slice(0, 10);
  const f = document.getElementById('nv-fecha'); if (f) f.value = hoy;
  const prep = document.getElementById('nv-preparado'); if (prep) prep.value = 'no';
  const ent  = document.getElementById('nv-entregado'); if (ent) ent.value = 'no';
  const cob  = document.getElementById('nv-cobrado'); if (cob) cob.value = 'no';
  _renderCarrito();
}

// ¿El item está completo (5 campos + cantidad + existe en stock)?
function _itemCompleto(it) {
  return window.Datos.CAMPOS_CASCADA.every(c => it[c]) && Number(it.cantidad) > 0 && !!window.Datos.productoExacto(it);
}

// Monto de una línea (igual que la planilla: cantidad*precio + descuentos)
function _montoItem(it) {
  const p = window.Datos.productoExacto(it);
  if (!p) return 0;
  return (Number(it.cantidad) || 0) * p.precio + (Number(it.descuentos) || 0);
}

// Lee el producto de un formulario (prefijo 'nv' o 'ed') con su selección.
// No bloquea si está incompleto: devuelve {vacio, completo, item}.
function _leerProductoDe(prefijo, sel) {
  const algun = window.Datos.CAMPOS_CASCADA.some(c => sel[c]);
  const cant = parseFloat(document.getElementById(`${prefijo}-cantidad`)?.value) || 0;
  if (!algun && !cant) return { vacio: true };
  const completo = window.Datos.CAMPOS_CASCADA.every(c => sel[c]) && cant > 0 && !!window.Datos.productoExacto(sel);
  const p = completo ? window.Datos.productoExacto(sel) : null;
  return {
    vacio: false,
    completo,
    item: {
      familia: sel.familia, marca: sel.marca, caracteristica: sel.caracteristica,
      talle: sel.talle, color: sel.color,
      cantidad: cant || '',
      confirmado: document.getElementById(`${prefijo}-confirmado`)?.value || 'no',
      descuentos: parseFloat(document.getElementById(`${prefijo}-descuentos`)?.value) || '',
      codigo: p ? p.codigo : [sel.familia, sel.marca, sel.caracteristica, sel.talle, sel.color].filter(Boolean).join(' - '),
      precio: p ? p.precio : 0,
    },
  };
}

function _renderCarrito() {
  const cont = document.getElementById('nv-carrito');
  const btn  = document.getElementById('btn-registrar-venta');
  if (btn) btn.textContent = _carrito.length > 0 ? `✔ Cargar venta (${_carrito.length})` : '✔ Cargar venta';
  if (!cont) return;
  if (_carrito.length === 0) { cont.innerHTML = ''; cont.style.display = 'none'; return; }
  cont.style.display = 'block';
  cont.innerHTML = `<div class="carrito-titulo">🛒 Productos en esta venta (${_carrito.length})</div>` +
    _carrito.map((it, i) => `<div class="carrito-item">
      <div class="carrito-data">
        <div class="carrito-cod">${_esc(it.codigo)}</div>
        <div class="carrito-meta">${it.cantidad}u · ${_money(it.precio)}${it.confirmado === 'si' ? '' : ' · sin confirmar'}</div>
      </div>
      <button class="carrito-quitar" data-i="${i}" type="button" aria-label="Quitar">✕</button>
    </div>`).join('');
  cont.querySelectorAll('.carrito-quitar').forEach(b =>
    b.addEventListener('click', () => { _carrito.splice(Number(b.dataset.i), 1); _renderCarrito(); }));
  _actualizarTotalVenta();
}

function _agregarAlCarrito() {
  const r = _leerProductoDe('nv', _selVenta);
  if (r.vacio) { _toast('⚠ Cargá un producto primero'); return; }
  if (r.item.confirmado === 'si' && !r.completo) {
    _toast('⚠ Para confirmar la venta completá producto y cantidad'); return;
  }
  _carrito.push(r.item);
  _limpiarProductoVenta();
  _renderCarrito();
  _toast(r.completo ? '🛒 Producto agregado' : '🛒 Agregado (incompleto · oportunidad)');
  document.getElementById('nv-familia')?.focus();
}

function _registrarVenta() {
  const fecha = _val('nv-fecha');
  if (!fecha) { _toast('⚠ Elegí la fecha de la venta'); return; }
  const cliente = _val('nv-cliente');

  // Carrito + el producto que haya quedado cargado en el form (req 2)
  const items = _carrito.slice();
  const r = _leerProductoDe('nv', _selVenta);
  if (!r.vacio) items.push(r.item);
  if (items.length === 0) { _toast('⚠ Cargá al menos un producto'); return; }

  // req 5: si está confirmada, exigir producto + cantidad completos
  for (const it of items) {
    if (it.confirmado === 'si' && !_itemCompleto(it)) {
      _toast('⚠ Una venta confirmada necesita producto y cantidad completos'); return;
    }
  }
  if (items.some(it => it.confirmado === 'si') && !cliente) {
    _toast('⚠ Falta el cliente (la venta está confirmada)'); return;
  }

  // req 4: si hay algún producto incompleto → advertir oportunidad
  if (items.some(it => !_itemCompleto(it))) {
    const ok = confirm('Faltan datos en algún producto.\nSe va a guardar como OPORTUNIDAD DE VENTA (incompleta).\n\n¿Querés continuar?');
    if (!ok) return;
  }
  items.forEach(it => { if (!_itemCompleto(it)) it.confirmado = 'no'; });

  const cobroSel = _val('nv-cobrado');           // no | efectivo | MP
  const fechaCobro = _val('nv-fechacobro') || fecha;

  const comunes = {
    fecha, cliente,
    preparado:    _val('nv-preparado') || 'no',
    entregado:    _val('nv-entregado') || 'no',
    fechaEntrega: _val('nv-fechaentrega'),
    lugarEntrega: _val('nv-lugarentrega'),
  };

  // Solo se marca cobrado en líneas confirmadas y completas
  const lista = items.map(it => {
    const pagado = cobroSel !== 'no' && it.confirmado === 'si' && _itemCompleto(it);
    const monto = pagado ? _montoItem(it) : 0;
    return {
      ...comunes,
      familia: it.familia, marca: it.marca, caracteristica: it.caracteristica,
      talle: it.talle, color: it.color,
      cantidad: it.cantidad, confirmado: it.confirmado, descuentos: it.descuentos,
      cobrado:       pagado ? monto : '',
      tipoCobro:     pagado ? cobroSel : '',
      fechaCobro:    pagado ? fechaCobro : '',
      detalleCobros: pagado ? window.Datos.entradaCobro(monto, fechaCobro, cobroSel) : '',
    };
  });

  const btn = document.getElementById('btn-registrar-venta');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  window.Datos.registrarVentas(lista)
    .then((r) => {
      if (r.encoladas === r.total) _toast('📶 Sin conexión: la venta se enviará al reconectar');
      else _toast(lista.length > 1 ? `✔ ${lista.length} productos cargados` : '✔ Venta cargada en la planilla');
      _resetVenta();
    })
    .catch(e => _toast('❌ ' + (e.message || 'No se pudo cargar la venta')))
    .finally(() => { if (btn) { btn.disabled = false; _renderCarrito(); } });
}

// Autocompletar de cliente (se alimenta de los clientes con ventas).
// Si el nombre no existe, ofrece crearlo (queda el texto tipeado).
function _montarComboCliente() {
  const inp = document.getElementById('nv-cliente');
  const list = document.getElementById('nv-cliente-list');
  if (!inp || !list) return;

  function render() {
    const q = inp.value.trim().toLowerCase();
    const todos = window.Datos.clientes();
    let ops = q ? todos.filter(o => o.toLowerCase().includes(q)) : todos;
    let html = ops.slice(0, 40).map(o => `<div class="combo-op" data-v="${_esc(o)}">${_esc(o)}</div>`).join('');
    const exacto = todos.some(o => o.toLowerCase() === q);
    if (q && !exacto) {
      html += `<div class="combo-op combo-crear" data-v="${_esc(inp.value.trim())}">➕ Crear cliente «${_esc(inp.value.trim())}»</div>`;
    }
    if (!html) html = `<div class="combo-vacio">Escribí el nombre del cliente</div>`;
    list.innerHTML = html;
    list.style.display = 'block';
    list.querySelectorAll('.combo-op').forEach(el => {
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        inp.value = el.dataset.v;
        list.style.display = 'none';
      });
    });
  }

  inp.addEventListener('focus', render);
  inp.addEventListener('input', render);
  inp.addEventListener('blur', () => setTimeout(() => { list.style.display = 'none'; }, 160));
}

function _initVenta() {
  _grupoVenta = _montarComboGrupo('nv', _selVenta, _onVentaCambio);
  _montarComboCliente();
  _resetVenta();
  ['nv-cantidad', 'nv-descuentos'].forEach(id =>
    document.getElementById(id)?.addEventListener('input', _onVentaCambio));
  document.getElementById('btn-agregar-producto')?.addEventListener('click', _agregarAlCarrito);
  document.getElementById('btn-registrar-venta')?.addEventListener('click', _registrarVenta);
  document.getElementById('nv-limpiar')?.addEventListener('click', _resetVenta);
}

// ════════════════════════════════════════════════════════════════
// STOCK (consulta)
// ════════════════════════════════════════════════════════════════

const _selStock = { familia: '', marca: '', caracteristica: '', talle: '', color: '' };
let _grupoStock = null;

function renderStock() {
  const lista = document.getElementById('st-resultados');
  if (!lista) return;

  const soloNeg = document.getElementById('st-solo-negativos')?.checked;
  let prods = window.Datos.stockFiltrado(_selStock);
  if (soloNeg) prods = prods.filter(p => p.disponible < 0);

  prods.sort((a, b) => a.disponible - b.disponible);

  const cont = document.getElementById('st-contador');
  if (cont) cont.textContent = prods.length;

  if (prods.length === 0) {
    lista.innerHTML = `<li><div class="estado-vacio"><span class="icono-grande">📦</span>
      <p>${window.Datos.getStock().length === 0 ? 'Tocá 🔄 para leer el stock de la planilla.' : 'Sin resultados para el filtro.'}</p></div></li>`;
    return;
  }

  lista.innerHTML = prods.slice(0, 300).map(p => {
    const cls = p.disponible < 0 ? 'neg' : (p.disponible <= 0 ? 'cero' : (p.disponible <= 5 ? 'bajo' : 'ok'));
    const meta = [p.marca, p.caracteristica, p.talle, p.color].filter(Boolean).join(' · ');
    return `<li class="item-stock">
      <div class="item-stock-data">
        <div class="item-stock-fam">${_esc(p.familia)}</div>
        <div class="item-stock-meta">${_esc(meta)}</div>
      </div>
      <div class="item-stock-disp ${cls}">
        <span class="num">${p.disponible}</span><span class="cap">uds.</span>
      </div>
    </li>`;
  }).join('');
}

function _initStock() {
  _grupoStock = _montarComboGrupo('st', _selStock, renderStock);
  document.getElementById('st-solo-negativos')?.addEventListener('change', renderStock);
  document.getElementById('st-limpiar')?.addEventListener('click', () => {
    window.Datos.CAMPOS_CASCADA.forEach(c => { _selStock[c] = ''; });
    _grupoStock.refrescarInputs();
    const neg = document.getElementById('st-solo-negativos'); if (neg) neg.checked = false;
    renderStock();
  });
}

// ════════════════════════════════════════════════════════════════
// COBRANZAS
// ════════════════════════════════════════════════════════════════

let _cobSel = null;   // cliente seleccionado para cobrar

function renderCobranzas() {
  const lista = document.getElementById('cob-lista');
  const totalEl = document.getElementById('cob-total');
  if (!lista) return;

  const grupos = window.Datos.cobranzas();
  const total = grupos.reduce((a, g) => a + g.saldo, 0);
  if (totalEl) totalEl.textContent = _money(total);

  // Si el cliente seleccionado ya no tiene saldo, cerrar el panel
  if (_cobSel && !grupos.some(g => g.cliente === _cobSel)) _ocultarPagoPanel();

  if (grupos.length === 0) {
    lista.innerHTML = `<li><div class="estado-vacio"><span class="icono-grande">✅</span>
      <p>No hay saldos pendientes de cobro.</p></div></li>`;
    return;
  }

  lista.innerHTML = grupos.map(g => `
    <li class="item-cobranza" data-cli="${_esc(g.cliente)}">
      <div>
        <div class="item-nombre">${_esc(g.cliente)}</div>
        <div class="item-detalle">${g.ventas.length} venta${g.ventas.length > 1 ? 's' : ''} con saldo</div>
      </div>
      <span class="badge badge-deuda">${_money(g.saldo)}</span>
    </li>
    <li class="item-cobranza-det" data-det="${_esc(g.cliente)}" style="display:none;">
      <ul class="sublista">
        ${g.ventas.map(v => `<li>
          <span>${v.fechaTxt} · ${_esc(v.codigo)} · ${v.cantidad}u</span>
          <span class="negrita">${_money(v.saldo)}</span>
        </li>`).join('')}
      </ul>
      <button class="btn btn-acento btn-cobrar" data-cli="${_esc(g.cliente)}" data-saldo="${g.saldo}" type="button">💰 Registrar pago</button>
    </li>`).join('');

  lista.querySelectorAll('.item-cobranza').forEach(el => {
    el.addEventListener('click', () => {
      const det = lista.querySelector(`.item-cobranza-det[data-det="${CSS.escape(el.dataset.cli)}"]`);
      if (det) det.style.display = det.style.display === 'none' ? 'block' : 'none';
    });
  });
  lista.querySelectorAll('.btn-cobrar').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      _abrirPagoPanel(b.dataset.cli, Number(b.dataset.saldo));
    });
  });
}

function _abrirPagoPanel(cliente, saldo) {
  _cobSel = cliente;
  const panel = document.getElementById('cob-pago-panel');
  if (!panel) return;
  document.getElementById('cob-pago-cliente').textContent = cliente;
  document.getElementById('cob-pago-saldo').textContent = 'Saldo total: ' + _money(saldo);
  const m = document.getElementById('cob-pago-monto'); if (m) { m.value = saldo; m.focus(); }
  const f = document.getElementById('cob-pago-fecha'); if (f && !f.value) f.value = new Date().toISOString().slice(0, 10);
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function _ocultarPagoPanel() {
  _cobSel = null;
  const panel = document.getElementById('cob-pago-panel');
  if (panel) panel.style.display = 'none';
}

function _registrarPago() {
  if (!_cobSel) return;
  const monto = parseFloat(_val('cob-pago-monto'));
  if (!monto || monto <= 0) { _toast('⚠ Ingresá un monto válido'); return; }
  const tipo  = _val('cob-pago-tipo');
  const fecha = _val('cob-pago-fecha');

  const btn = document.getElementById('btn-registrar-pago');
  if (btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }
  window.Datos.imputarPagoCliente(_cobSel, monto, tipo, fecha)
    .then(r => {
      let msg = `✔ Pago imputado: ${_money(r.aplicado)} en ${r.lineas} venta${r.lineas > 1 ? 's' : ''}`;
      if (r.sobrante > 0.001) msg += ` · sobró ${_money(r.sobrante)}`;
      _toast(msg);
      _ocultarPagoPanel();
    })
    .catch(e => _toast('❌ ' + (e.message || 'No se pudo registrar el pago')))
    .finally(() => { if (btn) { btn.disabled = false; btn.textContent = '💰 Confirmar pago'; } });
}

function _initCobranzas() {
  document.getElementById('btn-registrar-pago')?.addEventListener('click', _registrarPago);
  document.getElementById('cob-pago-cancelar')?.addEventListener('click', _ocultarPagoPanel);
}

// ════════════════════════════════════════════════════════════════
// ENTREGAS
// ════════════════════════════════════════════════════════════════

let _entregasTab = 'pendientes';

function renderEntregas() {
  const lista = document.getElementById('ent-lista');
  if (!lista) return;

  const pend = window.Datos.entregasPendientes();
  const badge = document.getElementById('ent-badge-pend');
  if (badge) badge.textContent = pend.length;

  const items = _entregasTab === 'pendientes' ? pend : window.Datos.entregasRealizadas();

  if (items.length === 0) {
    lista.innerHTML = `<li><div class="estado-vacio"><span class="icono-grande">🚚</span>
      <p>${_entregasTab === 'pendientes' ? 'No hay entregas pendientes.' : 'No hay entregas realizadas.'}</p></div></li>`;
    return;
  }

  lista.innerHTML = items.map(v => {
    const meta = [v.marca, v.talle, v.color].filter(Boolean).join(' · ');
    const badge = v.entregado
      ? `<span class="badge badge-ok">Entregado</span>`
      : (v.preparado ? `<span class="badge badge-prep">Preparado</span>` : `<span class="badge badge-pend">Pendiente</span>`);
    let acciones = '';
    if (!v.entregado) {
      if (!v.preparado) acciones += `<button class="btn-preparar" data-fila="${v.fila}" type="button">📋 Preparar</button>`;
      acciones += `<button class="btn-entregar" data-fila="${v.fila}" type="button">✓ Entregar</button>`;
    }
    return `<li class="item-entrega">
      <div class="item-entrega-info">
        <div class="item-nombre">${_esc(v.cliente || 'Sin cliente')}</div>
        <div class="item-detalle">${_esc(v.familia)} · ${_esc(meta)} · ${v.cantidad}u</div>
        <div class="item-detalle">${v.fechaEntrega ? '📅 ' + v.fechaEntrega : 'Sin fecha de entrega'}${v.lugarEntrega ? ' · 📍 ' + _esc(v.lugarEntrega) : ''}</div>
      </div>
      <div class="item-entrega-accion">${badge}${acciones}</div>
    </li>`;
  }).join('');

  lista.querySelectorAll('.btn-entregar').forEach(b => {
    b.addEventListener('click', () => {
      const fila = Number(b.dataset.fila);
      if (!confirm('¿Confirmás que esta venta fue ENTREGADA?')) return;
      b.disabled = true; b.textContent = '...';
      window.Datos.marcarEntregada(fila)
        .then(() => _toast('✔ Marcada como entregada'))
        .catch(e => { _toast('❌ ' + (e.message || 'No se pudo marcar')); b.disabled = false; b.textContent = '✓ Entregar'; });
    });
  });
  lista.querySelectorAll('.btn-preparar').forEach(b => {
    b.addEventListener('click', () => {
      const fila = Number(b.dataset.fila);
      if (!confirm('¿Marcar esta venta como PREPARADA?')) return;
      b.disabled = true; b.textContent = '...';
      window.Datos.marcarPreparada(fila)
        .then(() => _toast('✔ Marcada como preparada'))
        .catch(e => { _toast('❌ ' + (e.message || 'No se pudo marcar')); b.disabled = false; b.textContent = '📋 Preparar'; });
    });
  });
}

function _initEntregas() {
  document.getElementById('ent-tab-pend')?.addEventListener('click', () => {
    _entregasTab = 'pendientes';
    document.getElementById('ent-tab-pend')?.classList.add('activo');
    document.getElementById('ent-tab-entregadas')?.classList.remove('activo');
    renderEntregas();
  });
  document.getElementById('ent-tab-entregadas')?.addEventListener('click', () => {
    _entregasTab = 'entregadas';
    document.getElementById('ent-tab-entregadas')?.classList.add('activo');
    document.getElementById('ent-tab-pend')?.classList.remove('activo');
    renderEntregas();
  });
}

// ════════════════════════════════════════════════════════════════
// VENTAS · buscar por cliente y editar
// ════════════════════════════════════════════════════════════════

const _selEdit = { familia: '', marca: '', caracteristica: '', talle: '', color: '' };
let _grupoEdit = null;
let _filaEdit = null;
let _carritoEdit = [];   // productos NUEVOS a agregar a esta venta
let _edTab = 'ventas';   // 'ventas' | 'oportunidades'
let _edOrig = { sel: 'no', cobrado: 0, tipo: '', fecha: '' };  // estado de cobro cargado

function _verPanelEdit(cual) {
  document.getElementById('ventas-lista-panel').style.display = cual === 'lista' ? 'block' : 'none';
  document.getElementById('ventas-edit-panel').style.display = cual === 'edit' ? 'block' : 'none';
}

function _setEdTab(t) {
  _edTab = t;
  document.getElementById('ed-tab-ventas')?.classList.toggle('activo', t === 'ventas');
  document.getElementById('ed-tab-oport')?.classList.toggle('activo', t === 'oportunidades');
  renderVentas();
}

function renderVentas() {
  const lista = document.getElementById('ed-lista');
  if (!lista) return;
  const q = document.getElementById('ed-buscar')?.value || '';

  const badge = document.getElementById('ed-badge-oport');
  if (badge) badge.textContent = window.Datos.oportunidades().length;

  const items = _edTab === 'oportunidades' ? window.Datos.oportunidades(q) : window.Datos.ventasAbiertas(q);

  if (items.length === 0) {
    const vacio = window.Datos.getVentas().length === 0
      ? 'Tocá 🔄 para leer las ventas.'
      : (_edTab === 'oportunidades' ? 'No hay oportunidades abiertas.' : 'No hay ventas abiertas para esa búsqueda.');
    lista.innerHTML = `<li><div class="estado-vacio"><span class="icono-grande">🧾</span><p>${vacio}</p></div></li>`;
    return;
  }

  lista.innerHTML = items.map(v => {
    if (_edTab === 'oportunidades') {
      const meta = [v.familia, v.marca, v.caracteristica, v.talle, v.color].filter(Boolean).join(' · ') || '(sin datos)';
      return `<li class="item-venta" data-fila="${v.fila}">
        <div class="item-venta-main">
          <div class="item-nombre">${_esc(v.cliente || 'Sin cliente')}</div>
          <div class="item-detalle">${_esc(meta)} · ${v.fechaTxt}</div>
          <div class="item-badges"><span class="badge badge-prep">Incompleta · completar</span></div>
        </div>
        <span>›</span>
      </li>`;
    }
    let bCobro;
    if (v._cobrado <= 0)        bCobro = `<span class="badge badge-pend">Sin cobrar</span>`;
    else if (v.saldo > 0.001)   bCobro = `<span class="badge badge-deuda">Pagó ${_money(v._cobrado)} · debe ${_money(v.saldo)}</span>`;
    else                        bCobro = `<span class="badge badge-ok">Cobrado ${_money(v._cobrado)}</span>`;
    const bEnt = v.entregado ? `<span class="badge badge-ok">Entregado</span>` : `<span class="badge badge-pend">Por entregar</span>`;
    return `<li class="item-venta" data-fila="${v.fila}">
      <div class="item-venta-main">
        <div class="item-nombre">${_esc(v.cliente || 'Sin cliente')}</div>
        <div class="item-detalle">${_esc(v.familia)} · ${_esc([v.marca, v.talle, v.color].filter(Boolean).join(' · '))} · ${v.cantidad}u · ${v.fechaTxt}</div>
        <div class="item-badges">${bCobro} ${bEnt}</div>
      </div>
      <span class="negrita">${_money(v.monto)}</span>
    </li>`;
  }).join('');

  lista.querySelectorAll('.item-venta').forEach(el =>
    el.addEventListener('click', () => _abrirEdit(Number(el.dataset.fila))));
}

function _infoEdit() {
  const info = document.getElementById('ed-info');
  if (!info) return;
  const completos = window.Datos.CAMPOS_CASCADA.every(c => _selEdit[c]);
  if (!completos) { info.style.display = 'none'; return; }
  const p = window.Datos.productoExacto(_selEdit);
  info.style.display = 'block';
  if (!p) {
    info.className = 'nv-info alerta';
    info.innerHTML = '⚠ Esa combinación no existe en el Stock.';
    return;
  }
  info.className = 'nv-info';
  const cls = p.disponible <= 0 ? 'neg' : (p.disponible <= 5 ? 'bajo' : 'ok');
  const avisoPrecio = p.precio <= 0
    ? `<div style="color:#b91c1c;font-weight:600;margin-top:4px;">⚠ Sin precio en Stock (el monto dará $0)</div>` : '';
  info.innerHTML = `<div class="nv-info-grid">
      <div class="nv-disp ${cls}"><span class="nv-disp-num">${p.disponible}</span><span class="nv-disp-cap">disponible</span></div>
      <div class="nv-info-datos"><div class="nv-cod">${_esc(p.codigo)}</div><div>Precio: <strong>${_money(p.precio)}</strong></div>${avisoPrecio}</div>
    </div>`;
}

function _abrirEdit(fila) {
  const v = window.Datos.ventaPorFila(fila);
  if (!v) return;
  _filaEdit = fila;

  _selEdit.familia = v.familia; _selEdit.marca = v.marca;
  _selEdit.caracteristica = v.caracteristica; _selEdit.talle = v.talle; _selEdit.color = v.color;
  _grupoEdit?.refrescarInputs();

  const set = (id, val) => { const e = document.getElementById(id); if (e) e.value = val; };
  set('ed-fecha', v._fechaISO || '');
  set('ed-cliente', v.cliente || '');
  set('ed-cantidad', v.cantidad || '');
  set('ed-confirmado', v.confirmado ? 'si' : 'no');
  set('ed-descuentos', v._descuentos || '');
  const cobroSel = (Number(v._cobrado) > 0)
    ? ((v.tipoCobro || '').toLowerCase().includes('mp') ? 'MP' : 'efectivo')
    : 'no';
  set('ed-cobrado', cobroSel);
  set('ed-fechacobro', v._fechaCobroISO || '');
  _edOrig = { sel: cobroSel, cobrado: Number(v._cobrado) || 0, tipo: v.tipoCobro || '', fecha: v._fechaCobroISO || '', detalle: v.detalleCobros || '' };

  const infoCobro = document.getElementById('ed-cobro-info');
  if (infoCobro) {
    infoCobro.textContent = (Number(v._cobrado) > 0)
      ? `Cobrado hasta ahora: ${_money(v._cobrado)}${v.saldo > 0.001 ? ' · Falta: ' + _money(v.saldo) : ' (saldado)'}`
      : 'Sin cobros registrados';
  }

  const det = document.getElementById('ed-cobro-detalle');
  if (det) {
    const entradas = (v.detalleCobros || '').split('\n').map(s => s.trim()).filter(Boolean);
    det.innerHTML = entradas.length
      ? `<div class="cobro-det-tit">Cobros registrados:</div>` +
        entradas.map(e => `<div class="cobro-det-item">• ${_esc(e)}</div>`).join('')
      : '';
  }
  set('ed-preparado', v.preparado ? 'si' : 'no');
  set('ed-entregado', v.entregado ? 'si' : 'no');
  set('ed-fechaentrega', v.fechaEntregaISO || '');
  set('ed-lugarentrega', v.lugarEntrega || '');
  set('ed-cerrada', v.cerrada ? 'si' : 'no');

  const tit = document.getElementById('ed-titulo');
  if (tit) tit.textContent = (v.cliente || 'Venta') + ' · ' + v.fechaTxt;

  _carritoEdit = [];
  _renderCarritoEdit();
  _infoEdit();
  _verPanelEdit('edit');
  document.getElementById('contenido')?.scrollTo(0, 0);
}

// ── Carrito en edición (productos nuevos para la misma venta) ───

function _limpiarProductoEdit() {
  window.Datos.CAMPOS_CASCADA.forEach(c => { _selEdit[c] = ''; });
  _grupoEdit?.refrescarInputs();
  const cant = document.getElementById('ed-cantidad'); if (cant) cant.value = '';
  const desc = document.getElementById('ed-descuentos'); if (desc) desc.value = '';
  const conf = document.getElementById('ed-confirmado'); if (conf) conf.value = 'si';
  _infoEdit();
}

function _renderCarritoEdit() {
  const cont = document.getElementById('ed-carrito');
  if (!cont) return;
  if (_carritoEdit.length === 0) { cont.innerHTML = ''; cont.style.display = 'none'; return; }
  cont.style.display = 'block';
  cont.innerHTML = `<div class="carrito-titulo">🛒 Productos nuevos a agregar (${_carritoEdit.length})</div>` +
    _carritoEdit.map((it, i) => `<div class="carrito-item">
      <div class="carrito-data"><div class="carrito-cod">${_esc(it.codigo)}</div>
      <div class="carrito-meta">${it.cantidad}u${it.confirmado === 'si' ? '' : ' · sin confirmar'}</div></div>
      <button class="carrito-quitar" data-i="${i}" type="button">✕</button>
    </div>`).join('');
  cont.querySelectorAll('.carrito-quitar').forEach(b =>
    b.addEventListener('click', () => { _carritoEdit.splice(Number(b.dataset.i), 1); _renderCarritoEdit(); }));
}

function _agregarAlCarritoEdit() {
  const r = _leerProductoDe('ed', _selEdit);
  if (r.vacio) { _toast('⚠ Cargá un producto'); return; }
  if (r.item.confirmado === 'si' && !r.completo) {
    _toast('⚠ Para confirmar completá producto y cantidad'); return;
  }
  _carritoEdit.push(r.item);
  _limpiarProductoEdit();
  _renderCarritoEdit();
  _toast('🛒 Producto agregado a la venta');
}

function _guardarEdit() {
  if (_filaEdit == null) return;
  const fecha = _val('ed-fecha');
  const cliente = _val('ed-cliente');

  // Productos: el del formulario + los del carrito de edición
  const items = _carritoEdit.slice();
  const r = _leerProductoDe('ed', _selEdit);
  if (!r.vacio) items.push(r.item);
  if (items.length === 0) { _toast('⚠ Tiene que haber al menos un producto'); return; }

  for (const it of items) {
    if (it.confirmado === 'si' && !_itemCompleto(it)) {
      _toast('⚠ Una venta confirmada necesita producto y cantidad completos'); return;
    }
  }
  if (items.some(it => it.confirmado === 'si') && !cliente) {
    _toast('⚠ Falta el cliente (la venta está confirmada)'); return;
  }
  if (items.some(it => !_itemCompleto(it))) {
    const ok = confirm('Faltan datos en algún producto.\nSe va a guardar como OPORTUNIDAD DE VENTA.\n\n¿Continuar?');
    if (!ok) return;
  }
  items.forEach(it => { if (!_itemCompleto(it)) it.confirmado = 'no'; });

  const comunes = {
    fecha, cliente,
    preparado:    _val('ed-preparado') || 'no',
    entregado:    _val('ed-entregado') || 'no',
    fechaEntrega: _val('ed-fechaentrega'),
    lugarEntrega: _val('ed-lugarentrega'),
  };

  // El primer producto actualiza la fila editada; el resto son nuevas filas
  const principal = items[0];
  const nuevos = items.slice(1);

  // Cobro de la línea principal según el desplegable No / Efectivo / MP
  const cobroSel = _val('ed-cobrado');
  let cobradoFinal, tipoFinal, fechaCobroFinal, detalleFinal;
  if (cobroSel === _edOrig.sel) {
    // sin cambio respecto a lo cargado → preservar (puede ser un pago parcial)
    cobradoFinal = _edOrig.cobrado; tipoFinal = _edOrig.tipo;
    fechaCobroFinal = _val('ed-fechacobro') || _edOrig.fecha;
    detalleFinal = _edOrig.detalle;
  } else if (cobroSel === 'no') {
    cobradoFinal = 0; tipoFinal = ''; fechaCobroFinal = ''; detalleFinal = '';
  } else {
    cobradoFinal = _montoItem(principal); tipoFinal = cobroSel;
    fechaCobroFinal = _val('ed-fechacobro') || new Date().toISOString().slice(0, 10);
    detalleFinal = window.Datos.entradaCobro(cobradoFinal, fechaCobroFinal, cobroSel);
  }

  // req 1: para CERRAR la venta debe estar confirmada, entregada y cobrada 100%
  if (_val('ed-cerrada') === 'si') {
    if (principal.confirmado !== 'si' || !_itemCompleto(principal)) {
      _toast('⚠ Para cerrar, la venta debe estar confirmada y completa'); return;
    }
    if (comunes.entregado !== 'si') {
      _toast('⚠ Para cerrar, la venta debe estar entregada'); return;
    }
    if (cobradoFinal < _montoItem(principal) - 0.01) {
      _toast('⚠ Para cerrar, la venta debe estar cobrada al 100% (poné Cobrado: Efectivo o MP)'); return;
    }
  }

  const datosPrincipal = {
    ...comunes,
    familia: principal.familia, marca: principal.marca, caracteristica: principal.caracteristica,
    talle: principal.talle, color: principal.color,
    cantidad: principal.cantidad, confirmado: principal.confirmado, descuentos: principal.descuentos,
    cobrado:       cobradoFinal || '',
    tipoCobro:     tipoFinal,
    fechaCobro:    fechaCobroFinal,
    detalleCobros: detalleFinal,
    cerrada:       _val('ed-cerrada') || 'no',
  };

  const btn = document.getElementById('btn-guardar-edit');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  (async () => {
    try {
      await window.Datos.editarVenta(_filaEdit, datosPrincipal);
      if (nuevos.length) {
        const lista = nuevos.map(it => ({
          ...comunes,
          familia: it.familia, marca: it.marca, caracteristica: it.caracteristica,
          talle: it.talle, color: it.color,
          cantidad: it.cantidad, confirmado: it.confirmado, descuentos: it.descuentos,
        }));
        await window.Datos.registrarVentas(lista);
      }
      _toast(nuevos.length ? `✔ Venta actualizada + ${nuevos.length} producto(s) agregado(s)` : '✔ Venta actualizada');
      _carritoEdit = [];
      _verPanelEdit('lista'); renderVentas();
    } catch (e) {
      _toast('❌ ' + (e.message || 'No se pudo guardar'));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar cambios'; }
    }
  })();
}

function _initEdit() {
  _grupoEdit = _montarComboGrupo('ed', _selEdit, _infoEdit);
  document.getElementById('ed-buscar')?.addEventListener('input', renderVentas);
  document.getElementById('btn-guardar-edit')?.addEventListener('click', _guardarEdit);
  document.getElementById('btn-volver-edit')?.addEventListener('click', () => { _verPanelEdit('lista'); renderVentas(); });
  document.getElementById('btn-agregar-producto-edit')?.addEventListener('click', _agregarAlCarritoEdit);
  document.getElementById('ed-tab-ventas')?.addEventListener('click', () => _setEdTab('ventas'));
  document.getElementById('ed-tab-oport')?.addEventListener('click', () => _setEdTab('oportunidades'));
  _verPanelEdit('lista');
}

// ════════════════════════════════════════════════════════════════
// DASHBOARD (panel de métricas)
// ════════════════════════════════════════════════════════════════

function _tile(icon, valor, label, clase, nav) {
  const attr = nav ? ` data-nav="${nav}"` : '';
  const cl = `dash-tile ${clase || ''}${nav ? ' dash-link' : ''}`;
  return `<div class="${cl}"${attr}>
    <div class="dash-ico">${icon}</div>
    <div class="dash-val">${valor}</div>
    <div class="dash-lbl">${label}${nav ? ' ›' : ''}</div>
  </div>`;
}

// Navegación desde una tarjeta del panel (con filtros si corresponde)
function _navDesdePanel(nav) {
  if (nav === 'stock-neg') {
    window.App?.navegarA('stock');
    const neg = document.getElementById('st-solo-negativos'); if (neg) neg.checked = true;
    renderStock();
    return;
  }
  if (nav === 'oportunidades') {
    window.App?.navegarA('ventas');
    _setEdTab('oportunidades');
    return;
  }
  window.App?.navegarA(nav);
}

function renderDashboard() {
  const cont = document.getElementById('panel-contenido');
  if (!cont) return;

  if (window.Datos.getVentas().length === 0 && window.Datos.getStock().length === 0) {
    cont.innerHTML = `<div class="card"><div class="estado-vacio">
      <span class="icono-grande">📊</span><p>Tocá 🔄 arriba para cargar los datos y ver tus métricas.</p>
    </div></div>`;
    return;
  }

  const m = window.Datos.metricas();

  const grid = `<div class="dash-grid">
    ${_tile('💵', _money(m.ingreso), 'Ingreso total', 'verde', 'ventas')}
    ${_tile('📈', `${_money(m.rent)} · ${m.margen.toFixed(0)}%`, 'Rentabilidad', 'verde', 'ventas')}
    ${_tile('🗓️', _money(m.ingresoMes), 'Ingreso del mes', '', 'ventas')}
    ${_tile('☀️', _money(m.ingresoHoy), `Hoy · ${m.ventasHoy} venta${m.ventasHoy === 1 ? '' : 's'}`, '', 'ventas')}
    ${_tile('📦', m.arts, 'Artículos vendidos', '', 'ventas')}
    ${_tile('🧾', m.ventasCount, 'Ventas confirmadas', '', 'ventas')}
    ${_tile('🎯', _money(m.ticket), 'Ticket promedio', '', 'ventas')}
    ${_tile('💰', _money(m.porCobrar), `Por cobrar · ${m.clientesDeudores} cli.`, m.porCobrar > 0 ? 'rojo' : '', 'cobranzas')}
    ${_tile('🚚', m.entregasPend, 'Entregas pendientes', m.entregasPend > 0 ? 'naranja' : '', 'entregas')}
    ${_tile('⛔', m.negativos, 'Stock negativo', m.negativos > 0 ? 'rojo' : '', 'stock-neg')}
    ${_tile('✨', m.oportunidades, 'Oportunidades abiertas', m.oportunidades > 0 ? 'azul' : '', 'oportunidades')}
  </div>`;

  const medalla = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
  const top = m.topVendidos.length
    ? m.topVendidos.map((t, i) => `<li>
        <div class="item-venta-main">
          <div class="item-nombre">${medalla(i)} ${_esc(t.codigo)}</div>
        </div>
        <span class="negrita">${t.unidades} u</span>
      </li>`).join('')
    : `<li><div class="estado-vacio"><p>Todavía no hay ventas.</p></div></li>`;

  const rot = m.menorRotacion.length
    ? m.menorRotacion.map(t => `<li>
        <div class="item-venta-main">
          <div class="item-nombre">${_esc(t.codigo)}</div>
          <div class="item-detalle">${t.vendido} vendida${t.vendido === 1 ? '' : 's'}</div>
        </div>
        <span class="badge badge-azul">${t.disponible} en stock</span>
      </li>`).join('')
    : `<li><div class="estado-vacio"><p>Sin datos de stock.</p></div></li>`;

  cont.innerHTML = `
    ${grid}
    <div class="card">
      <div class="card-titulo">🏆 Productos más vendidos</div>
      <ul class="lista-items">${top}</ul>
    </div>
    <div class="card">
      <div class="card-titulo">🐌 Menor rotación (mucho stock, pocas ventas)</div>
      <ul class="lista-items">${rot}</ul>
    </div>
    <div style="height:24px;"></div>`;

  cont.querySelectorAll('[data-nav]').forEach(el =>
    el.addEventListener('click', () => _navDesdePanel(el.dataset.nav)));
}

// ── Indicador de última actualización ───────────────────────────

function _renderUltima() {
  const el = document.getElementById('est-ultima');
  if (!el) return;
  const u = window.Datos.ultimaActualizacion();
  el.textContent = u ? u.toLocaleString('es-AR') : 'Nunca';
}

// ── Init global ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  _initVenta();
  _initStock();
  _initEntregas();
  _initEdit();
  _initCobranzas();

  // Re-render de todas las vistas cuando llegan datos nuevos
  window.Datos.onActualizar(() => {
    _grupoVenta?.revalidar();
    _grupoStock?.revalidar();
    _grupoEdit?.revalidar();
    _infoVenta();
    renderStock();
    renderCobranzas();
    renderEntregas();
    renderVentas();
    renderDashboard();
    _renderUltima();
  });

  // Primera carga si ya está configurado
  if (window.Sync?.estaConfigurado?.()) {
    window.Datos.refrescar();
  }
});

window.UI = { renderStock, renderCobranzas, renderEntregas, renderVentas, renderDashboard };
