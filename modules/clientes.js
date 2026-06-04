// ── Módulo Clientes ─────────────────────────────────────────────
// Maestro de clientes con ficha (nombre, teléfono, dirección...).
// Sincroniza la hoja CLIENTES de Google Sheets.

const CLAVE_CLIENTES = 'convos_clientes';

// ══ STORAGE ══════════════════════════════════════════════════════

function obtenerClientes() {
  try { return JSON.parse(localStorage.getItem(CLAVE_CLIENTES)) || []; }
  catch { return []; }
}

function guardarClientes(clientes) {
  localStorage.setItem(CLAVE_CLIENTES, JSON.stringify(clientes));
}

function obtenerCliente(id) {
  return obtenerClientes().find(c => c.id === id) || null;
}

const _clienteBase = () => ({
  id:        '',
  nombre:    '',
  telefono:  '',
  direccion: '',
  email:     '',
  notas:     '',
  fechaAlta: '',
});

// ══ CRUD ══════════════════════════════════════════════════════════

function crearCliente(datos) {
  const clientes = obtenerClientes();
  const c = {
    ..._clienteBase(),
    ...datos,
    id:        Date.now().toString(),
    fechaAlta: new Date().toISOString(),
  };
  clientes.push(c);
  guardarClientes(clientes);
  _sincronizarClientes();
  return c;
}

function actualizarCliente(id, cambios) {
  const clientes = obtenerClientes();
  const idx = clientes.findIndex(c => c.id === id);
  if (idx === -1) return null;
  clientes[idx] = { ...clientes[idx], ...cambios };
  guardarClientes(clientes);
  _sincronizarClientes();
  return clientes[idx];
}

function eliminarCliente(id) {
  guardarClientes(obtenerClientes().filter(c => c.id !== id));
  _sincronizarClientes();
}

function buscarClientes(q) {
  const t = (q || '').toLowerCase().trim();
  const todos = obtenerClientes();
  if (!t) return todos;
  return todos.filter(c =>
    (c.nombre   || '').toLowerCase().includes(t) ||
    (c.telefono || '').toLowerCase().includes(t) ||
    (c.direccion|| '').toLowerCase().includes(t)
  );
}

// ══ SALDO (cuenta corriente) ══════════════════════════════════════
// El saldo se calcula sobre las ventas del cliente: total − pagado.

function saldoCliente(id) {
  if (typeof Ventas === 'undefined') return 0;
  const cli = obtenerCliente(id);
  const nombre = (cli?.nombre || '').toLowerCase();
  const saldoDe = (v) => {
    if (v.saldoACobrar != null) return Number(v.saldoACobrar) || 0;
    return (Number(v.montoVenta != null ? v.montoVenta : v.total) || 0)
         - (Number(v.cobrado   != null ? v.cobrado   : v.pagado) || 0);
  };
  return Ventas.obtenerVentas()
    .filter(v => v.clienteId === id || (v.nombreCliente || v.clienteNombre || '').toLowerCase() === nombre)
    .reduce((acc, v) => acc + saldoDe(v), 0);
}

// ══ SINCRONIZACIÓN ════════════════════════════════════════════════

async function _sincronizarClientes() {
  if (typeof Sync === 'undefined' || !Sync.estaConfigurado()) return;

  const clientes = obtenerClientes();
  const encabezados = ['id', 'nombre', 'telefono', 'direccion', 'email', 'notas', 'fechaAlta'];

  const filas = [
    encabezados,
    ...clientes.map(c => [
      c.id, c.nombre || '', c.telefono || '', c.direccion || '',
      c.email || '', c.notas || '', c.fechaAlta || '',
    ]),
  ];

  try {
    await Sync.syncToSheets('CLIENTES', filas, 'overwrite');
  } catch (err) {
    console.warn('[Clientes sync]', err.message);
  }
}

// ══ HELPERS ═══════════════════════════════════════════════════════

function _esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtMoneda(n) {
  return '$' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ══ EXPORTAR ══════════════════════════════════════════════════════

window.Clientes = {
  obtenerClientes,
  obtenerCliente,
  crearCliente,
  actualizarCliente,
  eliminarCliente,
  buscarClientes,
  saldoCliente,
  sincronizarTodo: _sincronizarClientes,
  _esc,
  _fmtMoneda,
};
