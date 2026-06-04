// ── Módulo Cobranzas ────────────────────────────────────────────
// Cuenta corriente: cada venta deja un saldo (total − pagado).
// Acá se registran los pagos parciales y se lleva el saldo por cliente.
// Sincroniza la hoja COBRANZAS (un renglón por pago).

const CLAVE_PAGOS = 'convos_pagos';

// ══ STORAGE ══════════════════════════════════════════════════════

function obtenerPagos() {
  try { return JSON.parse(localStorage.getItem(CLAVE_PAGOS)) || []; }
  catch { return []; }
}

function guardarPagos(pagos) {
  localStorage.setItem(CLAVE_PAGOS, JSON.stringify(pagos));
}

function pagosDeVenta(ventaId) {
  return obtenerPagos().filter(p => p.ventaId === ventaId);
}

// ══ CÁLCULOS ══════════════════════════════════════════════════════

// Nombre del cliente (modelo nuevo: nombreCliente / histórico: clienteNombre)
function _nombreDe(v) {
  return v.nombreCliente || v.clienteNombre || 'Sin cliente';
}

// Monto y cobrado soportando modelo nuevo (montoVenta/cobrado) e histórico (total/pagado)
function _monto(v)   { return Number(v.montoVenta != null ? v.montoVenta : v.total) || 0; }
function _cobrado(v) { return Number(v.cobrado   != null ? v.cobrado   : v.pagado) || 0; }

function saldoVenta(v) {
  if (v.saldoACobrar != null) return Number(v.saldoACobrar) || 0;
  return _monto(v) - _cobrado(v);
}

function ventasConSaldo() {
  if (typeof Ventas === 'undefined') return [];
  return Ventas.obtenerVentas().filter(v => saldoVenta(v) > 0.001);
}

// Agrupa el saldo pendiente por cliente (clave = nombre del cliente)
function clientesConSaldo() {
  const mapa = {};
  ventasConSaldo().forEach(v => {
    const nombre = _nombreDe(v);
    const key = nombre.toLowerCase();
    if (!mapa[key]) mapa[key] = { clienteId: key, clienteNombre: nombre, saldo: 0, ventas: 0 };
    mapa[key].saldo  += saldoVenta(v);
    mapa[key].ventas += 1;
  });
  return Object.values(mapa).sort((a, b) => b.saldo - a.saldo);
}

function totalACobrar() {
  return ventasConSaldo().reduce((acc, v) => acc + saldoVenta(v), 0);
}

// ══ REGISTRAR PAGO ════════════════════════════════════════════════

function registrarPago(ventaId, monto, medioPago) {
  const venta = typeof Ventas !== 'undefined' ? Ventas.obtenerVenta(ventaId) : null;
  if (!venta) throw new Error('Venta no encontrada');

  const m = Number(monto) || 0;
  if (m <= 0) throw new Error('El monto debe ser mayor a 0');

  const nuevoCobrado = _cobrado(venta) + m;

  // Registrar el pago
  const pagos = obtenerPagos();
  const pago = {
    id:            Date.now().toString(),
    fecha:         new Date().toISOString(),
    ventaId,
    clienteId:     _nombreDe(venta).toLowerCase(),
    clienteNombre: _nombreDe(venta),
    monto:         m,
    medioPago:     medioPago || 'Efectivo',
    saldoRestante: Math.max(0, _monto(venta) - nuevoCobrado),
  };
  pagos.unshift(pago);
  guardarPagos(pagos);

  // Actualizar la venta (cobrado + tipo) → dispara sync de VENTAS
  Ventas.actualizarVenta(ventaId, { cobrado: nuevoCobrado, tipoCobro: medioPago || venta.tipoCobro });
  Ventas.recalcularCobranza(ventaId);

  _sincronizarCobranzas();
  return pago;
}

// ══ SINCRONIZACIÓN ════════════════════════════════════════════════

async function _sincronizarCobranzas() {
  if (typeof Sync === 'undefined' || !Sync.estaConfigurado()) return;

  const pagos = obtenerPagos();
  const encabezados = ['id', 'fecha', 'ventaId', 'clienteId', 'clienteNombre', 'monto', 'medioPago', 'saldoRestante'];
  const filas = [
    encabezados,
    ...pagos.map(p => [
      p.id, p.fecha, p.ventaId, p.clienteId || '', p.clienteNombre || '',
      Number(p.monto) || 0, p.medioPago || '', Number(p.saldoRestante) || 0,
    ]),
  ];

  try {
    await Sync.syncToSheets('COBRANZAS', filas, 'overwrite');
  } catch (err) {
    console.warn('[Cobranzas sync]', err.message);
  }
}

// ══ HELPERS ═══════════════════════════════════════════════════════

const _f = n => '$' + (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });

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

// ══ NAVEGACIÓN INTERNA ════════════════════════════════════════════

let _clienteIdSel = null;   // cliente cuyo detalle se ve
let _ventaSelPago = null;   // venta seleccionada para cobrar

function _irA(subvista) {
  document.querySelectorAll('.cobranzas-sv').forEach(el => el.classList.remove('activa'));
  document.getElementById(`cobranzas-${subvista}`)?.classList.add('activa');
  document.getElementById('contenido')?.scrollTo(0, 0);
}

// ══ RENDERIZADO: lista de clientes con deuda ══════════════════════

function renderizarLista() {
  const totalEl = document.getElementById('cobranzas-total-cobrar');
  if (totalEl) totalEl.textContent = _f(totalACobrar());

  const lista = document.getElementById('cobranzas-clientes');
  if (!lista) return;

  const clientes = clientesConSaldo();
  if (clientes.length === 0) {
    lista.innerHTML = `<li><div class="estado-vacio">
      <span class="icono-grande">✅</span><p>No hay deudas pendientes. ¡Todo cobrado!</p></div></li>`;
    return;
  }

  lista.innerHTML = clientes.map(c =>
    `<li class="item-cobranza" data-id="${c.clienteId || ''}">
       <div>
         <div class="item-nombre">${_escapar(c.clienteNombre)}</div>
         <div class="item-detalle">${c.ventas} venta${c.ventas !== 1 ? 's' : ''} sin saldar</div>
       </div>
       <span class="saldo-deuda">${_f(c.saldo)}</span>
     </li>`).join('');

  lista.querySelectorAll('.item-cobranza').forEach(el =>
    el.addEventListener('click', () => mostrarDetalleCliente(el.dataset.id)));
}

// ══ RENDERIZADO: detalle de cuenta de un cliente ══════════════════

function mostrarDetalleCliente(clienteKey) {
  _clienteIdSel = clienteKey;   // clave = nombre en minúsculas
  _ventaSelPago = null;

  const nombre = ventasConSaldo().map(_nombreDe).find(n => n.toLowerCase() === clienteKey)
    || 'Cliente';

  const nomEl = document.getElementById('cobranzas-cliente-nombre');
  if (nomEl) nomEl.textContent = nombre;

  _renderDetalle();
  _irA('detalle');
}

function _renderDetalle() {
  const ventas = ventasConSaldo()
    .filter(v => _nombreDe(v).toLowerCase() === (_clienteIdSel || ''))
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  const saldoTotal = ventas.reduce((acc, v) => acc + saldoVenta(v), 0);
  const saldoEl = document.getElementById('cobranzas-cliente-saldo');
  if (saldoEl) saldoEl.textContent = _f(saldoTotal);

  // Lista de ventas con saldo
  const lista = document.getElementById('cobranzas-ventas-cliente');
  if (lista) {
    if (ventas.length === 0) {
      lista.innerHTML = `<li><div class="estado-vacio"><span class="icono-grande">✅</span>
        <p>Sin saldo pendiente.</p></div></li>`;
    } else {
      lista.innerHTML = ventas.map(v => {
        const sel = _ventaSelPago === v.id ? ' seleccionada' : '';
        return `<li class="item-venta-saldo${sel}" data-id="${v.id}">
          <div>
            <div class="item-nombre">Venta ${_fmtFecha(v.fecha)}</div>
            <div class="item-detalle">Total ${_f(_monto(v))} · Cobrado ${_f(_cobrado(v))}</div>
          </div>
          <span class="saldo-deuda">${_f(saldoVenta(v))}</span>
        </li>`;
      }).join('');
      lista.querySelectorAll('.item-venta-saldo').forEach(el =>
        el.addEventListener('click', () => {
          _ventaSelPago = el.dataset.id;
          const v = Ventas.obtenerVenta(_ventaSelPago);
          const montoEl = document.getElementById('pago-monto');
          if (montoEl) montoEl.value = saldoVenta(v).toFixed(0);
          _renderDetalle();
        }));
    }
  }

  // Historial de pagos del cliente
  const hist = document.getElementById('cobranzas-historial');
  if (hist) {
    const pagos = obtenerPagos().filter(p => (p.clienteId || '') === (_clienteIdSel || ''));
    if (pagos.length === 0) {
      hist.innerHTML = `<li class="text-suave" style="padding:10px;">Sin pagos registrados aún.</li>`;
    } else {
      hist.innerHTML = pagos.map(p =>
        `<li>
           <div>
             <div class="item-nombre">${_f(p.monto)}</div>
             <div class="item-detalle">${_escapar(p.medioPago)} · ${_fmtFecha(p.fecha)}</div>
           </div>
           <span class="item-detalle">Saldo ${_f(p.saldoRestante)}</span>
         </li>`).join('');
    }
  }
}

function _registrarPagoUI() {
  if (!_ventaSelPago) { window.App?.mostrarToast('⚠ Tocá una venta para cobrarla'); return; }
  const monto = parseFloat(document.getElementById('pago-monto')?.value);
  const medio = document.getElementById('pago-medio')?.value || 'Efectivo';

  if (isNaN(monto) || monto <= 0) { window.App?.mostrarToast('⚠ Ingresá un monto válido'); return; }

  try {
    registrarPago(_ventaSelPago, monto, medio);
    window.App?.mostrarToast('✔ Pago registrado');
    _ventaSelPago = null;
    const montoEl = document.getElementById('pago-monto'); if (montoEl) montoEl.value = '';

    // Si el cliente quedó sin saldo, volver a la lista
    const quedan = ventasConSaldo().filter(v => (v.clienteId || '') === (_clienteIdSel || ''));
    if (quedan.length === 0) {
      renderizarLista();
      _irA('lista');
    } else {
      _renderDetalle();
    }
    refrescarCobranzas();
  } catch (err) {
    window.App?.mostrarToast('❌ ' + err.message);
  }
}

function refrescarCobranzas() {
  renderizarLista();
  // métrica de inicio
  const elInicio = document.getElementById('metro-por-cobrar');
  if (elInicio) elInicio.textContent = _f(totalACobrar());
}

// ══ INICIALIZACIÓN ════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  renderizarLista();
  refrescarCobranzas();

  document.getElementById('btn-volver-cobranzas')?.addEventListener('click', () => {
    renderizarLista();
    _irA('lista');
  });
  document.getElementById('btn-registrar-pago')?.addEventListener('click', _registrarPagoUI);
});

// ══ EXPORTAR ══════════════════════════════════════════════════════

window.Cobranzas = {
  obtenerPagos,
  pagosDeVenta,
  saldoVenta,
  ventasConSaldo,
  clientesConSaldo,
  totalACobrar,
  registrarPago,
  renderizarLista,
  refrescar: refrescarCobranzas,
  sincronizarTodo: _sincronizarCobranzas,
};
