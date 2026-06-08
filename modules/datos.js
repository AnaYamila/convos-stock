// ── Módulo Datos ────────────────────────────────────────────────
// Única fuente de verdad: el Google Sheet. Este módulo lee las
// pestañas Stock y VENTAS (tal cual), las interpreta por posición de
// columna y las expone a las vistas. NO calcula stock ni montos: eso
// lo hace la planilla. Solo lee resultados y arma desplegables.

// ── Posiciones de columna (0-based) ─────────────────────────────

// Pestaña "Stock": encabezados en fila 5 (índice 4), datos desde fila 6.
const STOCK_INICIO = 5;
const COL_STOCK = {
  codigo: 2, familia: 3, caracteristica: 4, material: 5, marca: 6,
  articulo: 7, talle: 8, color: 9, proveedor: 10, costo: 11,
  precio: 13, disponible: 19,
};

// Pestaña "VENTAS": encabezados en fila 2 (índice 1), datos desde fila 3.
const VENTAS_INICIO = 2;
const COL_VENTAS = {
  fecha: 0, cliente: 1, familia: 2, marca: 3, caracteristica: 4, talle: 5,
  color: 6, codigo: 7, cantidad: 8, confirmado: 9, consumo: 10, precio: 11,
  descuentos: 12, monto: 13, cobrado: 14, tipoCobro: 15, fechaCobro: 16,
  saldo: 17, preparado: 18, entregado: 19, fechaEntrega: 20, lugarEntrega: 21,
  costoUnitario: 22, costoVenta: 23, rentabilidad: 24,
  cerrada: 25,        // Z (columna "Venta cerrada")
  detalleCobros: 26,  // AA (columna "Detalle cobros")
};

// Campos de la cascada, en su orden natural
const CAMPOS_CASCADA = ['familia', 'marca', 'caracteristica', 'talle', 'color'];

// ── Estado en memoria ───────────────────────────────────────────

let _stock = [];
let _ventas = [];
let _ultima = null;
const _suscriptores = [];

function onActualizar(cb) { if (typeof cb === 'function') _suscriptores.push(cb); }
function _notificar() { _suscriptores.forEach(cb => { try { cb(); } catch (e) { console.warn(e); } }); }

// ── Helpers ─────────────────────────────────────────────────────

function _S(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function _N(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim().replace(/\$/g, '').replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function _esSi(v) { return _S(v).toLowerCase() === 'si' || _S(v).toLowerCase() === 'sí'; }

function _fmtFecha(v) {
  if (!v) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d)) return _S(v);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function _fmtMonto(n) {
  return '$' + (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
// Una entrada de cobro legible: "07/06/26 · $5.000 · MP"
function entradaCobro(monto, fechaISO, medio) {
  const f = fechaISO ? _fmtFecha(fechaISO) : _fmtFecha(new Date());
  return `${f} · ${_fmtMonto(monto)} · ${medio || '-'}`;
}

// Devuelve yyyy-mm-dd para inputs type=date
function _iso(v) {
  if (!v) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d)) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ── Parseo ──────────────────────────────────────────────────────

function _norm(s) {
  return _S(s).toLowerCase()
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n');
}

// Detecta las columnas del Stock por el NOMBRE del encabezado (no por
// posición fija). Si una columna no se encuentra, usa la posición conocida.
function _mapaStock(filas) {
  let hr = -1;
  for (let i = 0; i < Math.min(filas.length, 12); i++) {
    const row = (filas[i] || []).map(_norm);
    if (row.includes('codigo') && row.includes('familia')) { hr = i; break; }
  }
  const row = (hr >= 0 ? filas[hr] : []).map(_norm);
  const find = (fallback, ...keys) => {
    for (let c = 0; c < row.length; c++) {
      if (keys.some(k => row[c] === k)) return c;       // coincidencia exacta
    }
    for (let c = 0; c < row.length; c++) {
      if (keys.some(k => row[c].includes(k))) return c; // coincidencia parcial
    }
    return fallback;
  };
  return {
    inicio:         hr >= 0 ? hr + 1 : STOCK_INICIO,
    codigo:         find(COL_STOCK.codigo, 'codigo'),
    familia:        find(COL_STOCK.familia, 'familia'),
    caracteristica: find(COL_STOCK.caracteristica, 'caracteristica'),
    material:       find(COL_STOCK.material, 'material'),
    marca:          find(COL_STOCK.marca, 'marca'),
    articulo:       find(COL_STOCK.articulo, 'articulo'),
    talle:          find(COL_STOCK.talle, 'talle'),
    color:          find(COL_STOCK.color, 'color'),
    proveedor:      find(COL_STOCK.proveedor, 'proveedor'),
    costo:          find(COL_STOCK.costo, 'costo'),
    precio:         find(COL_STOCK.precio, 'precio'),
    disponible:     find(COL_STOCK.disponible, 'disponible'),
  };
}

function _parsearStock(filas) {
  const M = _mapaStock(filas);
  const out = [];
  for (let i = M.inicio; i < filas.length; i++) {
    const r = filas[i] || [];
    const codigo  = _S(r[M.codigo]);
    const familia = _S(r[M.familia]);
    if (!codigo && !familia) continue;
    out.push({
      codigo,
      familia,
      caracteristica: _S(r[M.caracteristica]),
      material:       _S(r[M.material]),
      marca:          _S(r[M.marca]),
      articulo:       _S(r[M.articulo]),
      talle:          _S(r[M.talle]),
      color:          _S(r[M.color]),
      proveedor:      _S(r[M.proveedor]),
      costo:          _N(r[M.costo]),
      precio:         _N(r[M.precio]),
      disponible:     _N(r[M.disponible]),
    });
  }
  return out;
}

function _parsearVentas(filas) {
  const out = [];
  for (let i = VENTAS_INICIO; i < filas.length; i++) {
    const r = filas[i] || [];
    const cliente = _S(r[COL_VENTAS.cliente]);
    const familia = _S(r[COL_VENTAS.familia]);
    const fecha   = r[COL_VENTAS.fecha];
    // Es una venta real si tiene cliente o familia (el código es fórmula y nunca está vacío)
    if (!cliente && !familia && !_S(fecha)) continue;
    out.push({
      fila: i + 1,
      fecha,
      fechaTxt:       _fmtFecha(fecha),
      cliente,
      familia,
      marca:          _S(r[COL_VENTAS.marca]),
      caracteristica: _S(r[COL_VENTAS.caracteristica]),
      talle:          _S(r[COL_VENTAS.talle]),
      color:          _S(r[COL_VENTAS.color]),
      codigo:         _S(r[COL_VENTAS.codigo]),
      cantidad:       _N(r[COL_VENTAS.cantidad]),
      confirmado:     _esSi(r[COL_VENTAS.confirmado]),
      precio:         _N(r[COL_VENTAS.precio]),
      descuentos:     _N(r[COL_VENTAS.descuentos]),
      monto:          _N(r[COL_VENTAS.monto]),
      cobrado:        _N(r[COL_VENTAS.cobrado]),
      tipoCobro:      _S(r[COL_VENTAS.tipoCobro]),
      fechaCobro:     _fmtFecha(r[COL_VENTAS.fechaCobro]),
      saldo:          _N(r[COL_VENTAS.saldo]),
      preparado:      _esSi(r[COL_VENTAS.preparado]),
      entregado:      _esSi(r[COL_VENTAS.entregado]),
      fechaEntrega:   _fmtFecha(r[COL_VENTAS.fechaEntrega]),
      fechaEntregaISO: _iso(r[COL_VENTAS.fechaEntrega]),
      lugarEntrega:   _S(r[COL_VENTAS.lugarEntrega]),
      rentabilidad:   _N(r[COL_VENTAS.rentabilidad]),
      cerrada:        _esSi(r[COL_VENTAS.cerrada]),
      detalleCobros:  _S(r[COL_VENTAS.detalleCobros]),
      // valores crudos para reabrir en el formulario de edición
      _fechaISO:      _iso(r[COL_VENTAS.fecha]),
      _fechaCobroISO: _iso(r[COL_VENTAS.fechaCobro]),
      _descuentos:    _N(r[COL_VENTAS.descuentos]),
      _cobrado:       _N(r[COL_VENTAS.cobrado]),
    });
  }
  return out;
}

// ── Carga desde Sheets ──────────────────────────────────────────

async function refrescar() {
  if (typeof Sync === 'undefined' || !Sync.estaConfigurado()) {
    Sync?.mostrarPantallaConfig?.();
    return;
  }
  window.App?.mostrarSpinner?.('Leyendo planilla...');
  try {
    const [fStock, fVentas] = await Promise.all([
      Sync.fetchRawFromSheets('Stock'),
      Sync.fetchRawFromSheets('VENTAS'),
    ]);
    _stock  = _parsearStock(fStock);
    _ventas = _parsearVentas(fVentas);
    _ultima = new Date();
    console.log(`[Datos] Stock: ${_stock.length} productos · Ventas: ${_ventas.length} filas`);
    _notificar();
    window.App?.mostrarToast?.(`✔ ${_stock.length} productos · ${_ventas.length} ventas`);
  } catch (err) {
    window.App?.mostrarToast?.('❌ ' + (err.message || 'Error al leer la planilla'));
    console.error('[Datos]', err);
  } finally {
    window.App?.ocultarSpinner?.();
  }
}

// ── Accesores ───────────────────────────────────────────────────

function getStock()  { return _stock; }
function getVentas() { return _ventas; }
function ultimaActualizacion() { return _ultima; }

// ── Cascada facetada ────────────────────────────────────────────
// Devuelve las opciones disponibles para `campo` dado el resto de la
// selección. Cada campo seleccionado (distinto de `campo`) filtra.

function opcionesCascada(campo, seleccion = {}) {
  const filtrados = _stock.filter(p =>
    CAMPOS_CASCADA.every(c => {
      if (c === campo) return true;
      const sel = _S(seleccion[c]);
      return !sel || p[c] === sel;
    })
  );
  const valores = [...new Set(filtrados.map(p => p[campo]).filter(Boolean))];
  return valores.sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
}

// Stock que cumple TODOS los campos seleccionados (los vacíos no filtran)
function stockFiltrado(seleccion = {}) {
  return _stock.filter(p =>
    CAMPOS_CASCADA.every(c => {
      const sel = _S(seleccion[c]);
      return !sel || p[c] === sel;
    })
  );
}

// Producto exacto que matchea los 5 campos (para la venta)
function productoExacto(seleccion = {}) {
  return _stock.find(p =>
    CAMPOS_CASCADA.every(c => p[c] === _S(seleccion[c]))
  ) || null;
}

// ── Consultas derivadas (sin cálculo: solo agrupan lo que ya trae el Sheet) ──

// ¿La venta tiene todos los datos del producto + cantidad?
function ventaCompleta(v) {
  return !!(v.familia && v.marca && v.caracteristica && v.talle && v.color && Number(v.cantidad) > 0);
}
// Una fila es VENTA real solo si está confirmada. Si no está confirmada,
// es una OPORTUNIDAD (todavía no es venta): no se cobra ni se entrega.
function esVenta(v) {
  return v.confirmado && !v.cerrada;
}
function esOportunidad(v) {
  return !v.confirmado && !v.cerrada;
}

// Clientes con saldo a cobrar > 0 (solo ventas confirmadas)
function cobranzas() {
  const porCliente = {};
  _ventas.forEach(v => {
    if (esVenta(v) && v.saldo > 0.001) {
      const k = v.cliente || 'Sin cliente';
      if (!porCliente[k]) porCliente[k] = { cliente: k, saldo: 0, ventas: [] };
      porCliente[k].saldo += v.saldo;
      porCliente[k].ventas.push(v);
    }
  });
  return Object.values(porCliente).sort((a, b) => b.saldo - a.saldo);
}

// Líneas pendientes de entrega: solo VENTAS confirmadas, no entregadas
function entregasPendientes() {
  return _ventas.filter(v => esVenta(v) && !v.entregado);
}
function entregasRealizadas() {
  return _ventas.filter(v => v.confirmado && v.entregado);
}

// Ventas confirmadas no cerradas, opcionalmente filtradas por cliente
function ventasAbiertas(filtroCliente = '') {
  const q = _S(filtroCliente).toLowerCase();
  return _ventas
    .filter(v => esVenta(v))
    .filter(v => !q || (v.cliente || '').toLowerCase().includes(q))
    .sort((a, b) => (b.fila || 0) - (a.fila || 0));
}

// Oportunidades: filas NO confirmadas (aún no son venta), no cerradas
function oportunidades(filtroCliente = '') {
  const q = _S(filtroCliente).toLowerCase();
  return _ventas
    .filter(v => esOportunidad(v))
    .filter(v => !q || (v.cliente || '').toLowerCase().includes(q))
    .sort((a, b) => (b.fila || 0) - (a.fila || 0));
}

function ventaPorFila(fila) {
  return _ventas.find(v => v.fila === fila) || null;
}

// ── Construir el objeto venta para escribir en la planilla ──────

function _construirVenta(datos) {
  return {
    fecha:          datos.fecha || '',
    cliente:        datos.cliente || '',
    familia:        datos.familia || '',
    marca:          datos.marca || '',
    caracteristica: datos.caracteristica || '',
    talle:          datos.talle || '',
    color:          datos.color || '',
    cantidad:       datos.cantidad || '',
    confirmado:     datos.confirmado || 'no',
    descuentos:     datos.descuentos || '',
    cobrado:        datos.cobrado || '',
    tipoCobro:      datos.tipoCobro || '',
    fechaCobro:     datos.fechaCobro || '',
    preparado:      datos.preparado || 'no',
    entregado:      datos.entregado || 'no',
    fechaEntrega:   datos.fechaEntrega || '',
    lugarEntrega:   datos.lugarEntrega || '',
    cerrada:        datos.cerrada || 'no',
    detalleCobros:  datos.detalleCobros || '',
  };
}

// ── Métricas del negocio (para el Dashboard) ────────────────────
// Solo agrega valores que YA calculó la planilla (monto, rentabilidad,
// saldo, disponible). La app no recalcula nada del negocio.

function metricas() {
  const ventas = _ventas.filter(v => v.confirmado);   // confirmadas = ventas reales
  const hoy = new Date();
  const hoyStr = hoy.toDateString();
  const mes = hoy.getMonth(), anio = hoy.getFullYear();

  let ingreso = 0, rent = 0, arts = 0, ingresoHoy = 0, ventasHoy = 0, ingresoMes = 0;
  const vendidoPorCodigo = {};

  ventas.forEach(v => {
    ingreso += v.monto; rent += v.rentabilidad; arts += v.cantidad;
    const f = v.fecha ? new Date(v.fecha) : null;
    if (f && !isNaN(f)) {
      if (f.toDateString() === hoyStr) { ingresoHoy += v.monto; ventasHoy++; }
      if (f.getMonth() === mes && f.getFullYear() === anio) ingresoMes += v.monto;
    }
    if (v.codigo) vendidoPorCodigo[v.codigo] = (vendidoPorCodigo[v.codigo] || 0) + v.cantidad;
  });

  const ventasCount = ventas.length;
  const ticket = ventasCount ? ingreso / ventasCount : 0;
  const margen = ingreso > 0 ? (rent / ingreso * 100) : 0;

  const grupos = cobranzas();
  const porCobrar = grupos.reduce((a, g) => a + g.saldo, 0);

  const negativos = _stock.filter(p => p.disponible < 0);

  const topVendidos = Object.entries(vendidoPorCodigo)
    .map(([codigo, unidades]) => ({ codigo, unidades }))
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, 6);

  // Menor rotación: con stock disponible pero poco/nada vendido
  const menorRotacion = _stock
    .filter(p => p.disponible > 0)
    .map(p => ({ codigo: p.codigo, disponible: p.disponible, vendido: vendidoPorCodigo[p.codigo] || 0 }))
    .sort((a, b) => (a.vendido - b.vendido) || (b.disponible - a.disponible))
    .slice(0, 6);

  return {
    ingreso, rent, arts, ventasCount, ticket, margen,
    ingresoHoy, ventasHoy, ingresoMes,
    porCobrar, clientesDeudores: grupos.length,
    negativos: negativos.length, negativosLista: negativos.slice(0, 6),
    entregasPend: entregasPendientes().length,
    oportunidades: oportunidades().length,
    topVendidos, menorRotacion,
  };
}

// ── Registrar una venta nueva ───────────────────────────────────

async function registrarVenta(datos) {
  const r = await Sync.registrarVentaRemota(_construirVenta(datos));
  // Releer para reflejar el stock/montos recalculados por la planilla
  if (!r?.encolada) await refrescar();
  return r;
}

// ── Editar una venta existente ──────────────────────────────────

async function editarVenta(fila, datos) {
  await Sync.editarVentaEnSheets(fila, _construirVenta(datos));
  await refrescar();
}

// Marca una línea como entregada (conserva el resto de los datos)
async function marcarEntregada(fila) {
  const v = ventaPorFila(fila);
  if (!v) throw new Error('Venta no encontrada');
  const datos = _ventaADatos(v);
  datos.entregado = 'si';
  if (!datos.fechaEntrega) datos.fechaEntrega = _iso(new Date());
  await Sync.editarVentaEnSheets(v.fila, _construirVenta(datos));
  await refrescar();
}

// Borra (vacía) una venta u oportunidad de la planilla
async function borrarVenta(fila) {
  await Sync.borrarVentaEnSheets(fila);
  await refrescar();
}

// Marca una línea como preparada (conserva el resto de los datos)
async function marcarPreparada(fila) {
  const v = ventaPorFila(fila);
  if (!v) throw new Error('Venta no encontrada');
  const datos = _ventaADatos(v);
  datos.preparado = 'si';
  await Sync.editarVentaEnSheets(v.fila, _construirVenta(datos));
  await refrescar();
}

// Clientes a los que ya se les vendió (para autocompletar)
function clientes() {
  const set = new Set();
  _ventas.forEach(v => { if (v.cliente) set.add(v.cliente); });
  return [...set].sort((a, b) => a.localeCompare(b, 'es'));
}

// ── Registrar varias ventas (carrito) ───────────────────────────

async function registrarVentas(lista) {
  let encoladas = 0;
  for (const d of lista) {
    const r = await Sync.registrarVentaRemota(_construirVenta(d));
    if (r?.encolada) encoladas++;
  }
  if (encoladas < lista.length) await refrescar();
  return { total: lista.length, encoladas };
}

// Reconstruye el objeto de datos a partir de una venta ya leída,
// para poder reescribir la fila preservando todos sus campos.
function _ventaADatos(v) {
  return {
    fecha:          v._fechaISO || '',
    cliente:        v.cliente || '',
    familia:        v.familia, marca: v.marca, caracteristica: v.caracteristica,
    talle:          v.talle, color: v.color,
    cantidad:       v.cantidad || '',
    confirmado:     v.confirmado ? 'si' : 'no',
    descuentos:     v._descuentos || '',
    cobrado:        v._cobrado || '',
    tipoCobro:      v.tipoCobro || '',
    fechaCobro:     v._fechaCobroISO || '',
    preparado:      v.preparado ? 'si' : 'no',
    entregado:      v.entregado ? 'si' : 'no',
    fechaEntrega:   v.fechaEntregaISO || '',
    lugarEntrega:   v.lugarEntrega || '',
    cerrada:        v.cerrada ? 'si' : 'no',
    detalleCobros:  v.detalleCobros || '',
  };
}

// ── Imputar un pago a un cliente ────────────────────────────────
// Reparte el monto entre las líneas con saldo del cliente, de la
// más antigua a la más nueva, usando los SALDOS reales del Sheet.

async function imputarPagoCliente(cliente, monto, tipoCobro, fechaCobro) {
  monto = Number(monto) || 0;
  if (monto <= 0) throw new Error('Ingresá un monto válido');

  const lineas = _ventas
    .filter(v => !v.cerrada && v.saldo > 0.001 && (v.cliente || '') === cliente)
    .sort((a, b) => {
      const da = a.fecha ? new Date(a.fecha).getTime() : 0;
      const db = b.fecha ? new Date(b.fecha).getTime() : 0;
      if (da !== db) return da - db;          // más antigua primero
      return (a.fila || 0) - (b.fila || 0);
    });

  if (lineas.length === 0) throw new Error('Ese cliente no tiene saldo pendiente');

  let restante = monto;
  let afectadas = 0;
  for (const v of lineas) {
    if (restante <= 0.001) break;
    const aplicar = Math.min(restante, v.saldo);
    const datos = _ventaADatos(v);
    datos.cobrado = (Number(v._cobrado) || 0) + aplicar;
    if (tipoCobro)  datos.tipoCobro  = tipoCobro;
    if (fechaCobro) datos.fechaCobro = fechaCobro;
    // Anexar este cobro al historial (Detalle cobros)
    const entrada = entradaCobro(aplicar, fechaCobro, tipoCobro);
    datos.detalleCobros = v.detalleCobros ? (v.detalleCobros + '\n' + entrada) : entrada;
    await Sync.editarVentaEnSheets(v.fila, _construirVenta(datos));
    restante -= aplicar;
    afectadas++;
  }
  await refrescar();
  return { aplicado: monto - restante, sobrante: restante, lineas: afectadas };
}

// ── Exportar ────────────────────────────────────────────────────

window.Datos = {
  refrescar,
  onActualizar,
  getStock,
  getVentas,
  ultimaActualizacion,
  opcionesCascada,
  stockFiltrado,
  productoExacto,
  cobranzas,
  entregasPendientes,
  entregasRealizadas,
  ventasAbiertas,
  oportunidades,
  ventaPorFila,
  ventaCompleta,
  esVenta,
  esOportunidad,
  clientes,
  registrarVenta,
  registrarVentas,
  editarVenta,
  borrarVenta,
  marcarEntregada,
  marcarPreparada,
  imputarPagoCliente,
  entradaCobro,
  metricas,
  CAMPOS_CASCADA,
  _fmtFecha,
};
