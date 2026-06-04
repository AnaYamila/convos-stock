// ── Módulo Importar ─────────────────────────────────────────────
// Gestiona la importación de datos desde Google Sheets y el estado
// de conexión. Delega la config y el transporte a modules/sync.js.

// ── Estado de conexión ──────────────────────────────────────────

function renderizarEstadoImportar() {
  const config = typeof Sync !== 'undefined' ? Sync.obtenerConfig() : {};

  // Badge de estado
  const elEstado = document.getElementById('estado-planilla');
  if (elEstado) {
    if (config.appsScriptUrl) {
      elEstado.textContent = 'Conectado';
      elEstado.className   = 'badge badge-stock-ok';
    } else {
      elEstado.textContent = 'No configurado';
      elEstado.className   = 'badge badge-stock-cero';
    }
  }

  // Última sync
  const ts = localStorage.getItem('convos_ultima_sync');
  const elUltima = document.getElementById('ultima-sync');
  if (elUltima) {
    elUltima.textContent = ts
      ? new Date(ts).toLocaleString('es-AR')
      : 'Nunca';
  }

  // Cola pendiente
  const cola = typeof Sync !== 'undefined' ? Sync.obtenerCola().length : 0;
  const elCola = document.getElementById('cola-pendientes');
  if (elCola) elCola.textContent = cola;
}

// ── Importar stock desde Sheets ─────────────────────────────────

async function importarStockDesdeSheets() {
  if (typeof Sync === 'undefined' || !Sync.estaConfigurado()) {
    Sync?.mostrarPantallaConfig();
    return;
  }
  if (!navigator.onLine) {
    window.App?.mostrarToast('📶 Sin conexión para importar');
    return;
  }

  window.App?.mostrarToast('⬇ Importando STOCK...');

  try {
    const filas = await Sync.fetchFromSheets('STOCK');

    if (filas.length === 0) {
      window.App?.mostrarToast('ℹ La hoja STOCK está vacía');
      return;
    }

    // Helpers para leer una columna sin importar mayúsculas/minúsculas
    const txt = (f, k) => String(f[k] ?? f[k.toUpperCase()] ?? f[k.toLowerCase()] ?? '').trim();
    const num = (f, k) => Number(f[k] ?? f[k.toUpperCase()] ?? f[k.toLowerCase()] ?? 0) || 0;

    // Convertir objetos de Sheets al formato interno del Maestro de Stock
    const productos = filas
      .filter(f => txt(f, 'codigoCorto') || txt(f, 'codigoCompleto') || txt(f, 'nombre'))
      .map(f => ({
        id:                      txt(f, 'id') || ('sheets_' + Date.now() + Math.random().toString(36).slice(2)),
        codigoCorto:             txt(f, 'codigoCorto') || txt(f, 'nombre'),
        codigoCompleto:          txt(f, 'codigoCompleto'),
        familia:                 txt(f, 'familia') || txt(f, 'categoria'),
        caracteristica:          txt(f, 'caracteristica'),
        material:                txt(f, 'material'),
        marca:                   txt(f, 'marca'),
        articulo:                txt(f, 'articulo'),
        talle:                   txt(f, 'talle'),
        color:                   txt(f, 'color'),
        proveedor:               txt(f, 'proveedor'),
        costo:                   num(f, 'costo'),
        costoConIva:             num(f, 'costoConIva'),
        precio:                  num(f, 'precio'),
        fechaActualizacionCosto: txt(f, 'fechaActualizacionCosto'),
        stockInicial:            num(f, 'stockInicial') || num(f, 'stock'),
        pedidos:                 num(f, 'pedidos'),
        ajustes:                 num(f, 'ajustes'),
        devoluciones:            num(f, 'devoluciones'),
        ventas:                  num(f, 'ventas'),
        stockConteo:             txt(f, 'stockConteo') === '' ? null : num(f, 'stockConteo'),
        fechaConteo:             txt(f, 'fechaConteo'),
        explicacionDiferencia:   txt(f, 'explicacionDiferencia'),
      }));

    localStorage.setItem('convos_productos', JSON.stringify(productos));

    // Actualizar vistas
    typeof Stock !== 'undefined' && Stock.renderizarListaProductos();
    typeof Stock !== 'undefined' && Stock.renderizarMetricasInicio();

    renderizarEstadoImportar();
    window.App?.mostrarToast(`✔ ${productos.length} productos importados`);
  } catch (err) {
    window.App?.mostrarToast('❌ ' + (err.message || 'Error al importar'));
    console.error('[Importar]', err);
  }
}

// ════════════════════════════════════════════════════════════════
// ── IMPORTACIÓN DESDE ARCHIVO EXCEL (.xlsx) con SheetJS ──────────
// ════════════════════════════════════════════════════════════════

let _workbook = null;   // libro Excel cargado en memoria

// ── Helpers de conversión ───────────────────────────────────────

function _S(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function _N(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim().replace(/\$/g, '').replace(/\s/g, '');
  if (s.indexOf(',') > -1 && s.indexOf('.') > -1) {
    // formato 1.234,56 → quitar puntos de miles, coma decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.indexOf(',') > -1) {
    s = s.replace(',', '.');         // 1234,56 → 1234.56
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function _D(v) {
  if (!v && v !== 0) return '';
  if (v instanceof Date && !isNaN(v)) return v.toISOString();
  if (typeof v === 'number') {
    // Serial de Excel (días desde 1899-12-30)
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d) ? '' : d.toISOString();
  }
  const s = _S(v);
  // dd/mm/aaaa
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let [, dd, mm, aa] = m;
    if (aa.length === 2) aa = '20' + aa;
    const d = new Date(`${aa}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T12:00:00`);
    return isNaN(d) ? '' : d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString();
}

function _esVerdadero(v) {
  if (v === true) return true;
  if (typeof v === 'number') return v > 0;
  const s = _S(v).toLowerCase();
  if (!s || s === 'no' || s === 'false' || s === '0' || s === '-') return false;
  return /^(s[ií]|x|ok|true|1|si|cobrado|entregado|pagado|conf)/.test(s);
}

function _hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

// ── Generar código corto: marca + artículo + talle + color ──────
// "Medias - Ciudadela - Art.4730 - T3 - Rojo" → "CIU-4730-T3-RJ"

function _abrevMarca(m) {
  return _S(m).replace(/[^a-zA-ZñÑáéíóúÁÉÍÓÚ]/g, '').slice(0, 3).toUpperCase();
}
function _abrevArticulo(a) {
  const d = _S(a).match(/\d+/);
  return d ? d[0] : _S(a).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}
function _abrevTalle(t) {
  return _S(t).replace(/\s+/g, '').toUpperCase();
}
function _abrevColor(c) {
  const s = _S(c).replace(/[^a-zA-ZñÑáéíóúÁÉÍÓÚ]/g, '');
  if (!s) return '';
  const primera = s[0];
  const resto   = s.slice(1);
  const cons    = resto.match(/[^aeiouAEIOUáéíóúÁÉÍÓÚ]/);
  return (primera + (cons ? cons[0] : (resto[0] || ''))).toUpperCase();
}
function _generarCodigoCorto(marca, articulo, talle, color) {
  return [_abrevMarca(marca), _abrevArticulo(articulo), _abrevTalle(talle), _abrevColor(color)]
    .filter(Boolean).join('-');
}

// ── Lectura del archivo ─────────────────────────────────────────

function _leerArchivoExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        resolve(wb);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsArrayBuffer(file);
  });
}

// Encuentra el nombre real de la hoja según el tipo elegido
function _nombreHoja(tipo) {
  if (!_workbook) return null;
  const nombres = _workbook.SheetNames;
  if (tipo === 'stock') {
    return nombres.find(n => /maestro|stock/i.test(n)) || nombres[0];
  }
  return nombres.find(n => /venta/i.test(n)) || nombres[0];
}

// Devuelve las filas como array de arrays
function _filasDeHoja(tipo) {
  const nombre = _nombreHoja(tipo);
  if (!nombre) return [];
  const hoja = _workbook.Sheets[nombre];
  return XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '' });
}

// ── Mapeo: MAESTRO DE STOCK (encabezado fila 5 = índice 4) ──────

function _mapearStock(filas) {
  const out = [];
  for (let i = 4; i < filas.length; i++) {   // datos desde índice 5
    if (i === 4) continue;                    // saltar fila de encabezado
    const r = filas[i] || [];
    const codigoCompleto = _S(r[2]);
    if (!codigoCompleto) continue;            // fila vacía

    const marca    = _S(r[6]);
    const articulo = _S(r[7]);
    const talle    = _S(r[8]);
    const color    = _S(r[9]);

    out.push({
      codigoCorto:             _generarCodigoCorto(marca, articulo, talle, color) || codigoCompleto.slice(0, 12),
      codigoCompleto,
      familia:                 _S(r[3]),
      caracteristica:          _S(r[4]),
      material:                _S(r[5]),
      marca, articulo, talle, color,
      proveedor:               _S(r[10]),
      costo:                   _N(r[12]),
      costoConIva:             0,
      precio:                  _N(r[15]),
      fechaActualizacionCosto: '',
      stockInicial:            _N(r[17]),
      pedidos:                 0,
      ajustes:                 0,
      devoluciones:            0,
      ventas:                  Math.abs(_N(r[22])),   // viene negativo
      stockConteo:             null,
      fechaConteo:             '',
      explicacionDiferencia:   '',
    });
  }
  return out;
}

// ── Mapeo: VENTAS DEF (encabezado fila 4 = índice 3) ────────────

function _mapearVentas(filas) {
  const out = [];
  for (let i = 3; i < filas.length; i++) {   // datos desde índice 4
    if (i === 3) continue;                    // saltar encabezado
    const r = filas[i] || [];
    const codigoCompleto = _S(r[2]);
    const nombreCliente  = _S(r[3]);
    if (!codigoCompleto && !nombreCliente) continue;

    const fecha    = _D(r[1]);
    const cantidad = _N(r[13]) || 1;
    const precio   = _N(r[11]);
    const monto    = _N(r[18]) || (precio * cantidad);
    const cobradoN = _N(r[19]);
    const pagado   = cobradoN > 0 ? cobradoN : (_esVerdadero(r[19]) ? monto : 0);
    const entregado = _esVerdadero(r[28]);

    out.push({
      fecha, codigoCompleto, nombreCliente,
      familia:  _S(r[6]),
      material: _S(r[8]),
      talle:    _S(r[9]),
      color:    _S(r[10]),
      cantidad, precio, monto, pagado, entregado,
      tipoCobro:        _S(r[20]),
      fechaTransferencia: _D(r[21]),
      descuento:        _N(r[17]),
      costo:            _N(r[31]),
      ganancia:        _N(r[32]),
    });
  }
  return out;
}

// ── Preview de los primeros 5 registros ─────────────────────────

function _renderPreviewExcel(tipo) {
  const cont = document.getElementById('preview-excel');
  const btn  = document.getElementById('btn-importar-excel');
  if (!cont) return;

  if (!_workbook) { cont.innerHTML = ''; if (btn) btn.disabled = true; return; }

  let filas, registros;
  try {
    filas = _filasDeHoja(tipo);
    registros = tipo === 'stock' ? _mapearStock(filas) : _mapearVentas(filas);
  } catch (err) {
    cont.innerHTML = `<p class="text-suave">⚠ No se pudo leer la hoja: ${_S(err.message)}</p>`;
    if (btn) btn.disabled = true;
    return;
  }

  if (registros.length === 0) {
    cont.innerHTML = `<p class="text-suave">No se encontraron registros en la hoja "${_S(_nombreHoja(tipo))}".</p>`;
    if (btn) btn.disabled = true;
    return;
  }

  const muestra = registros.slice(0, 5);
  let tabla;
  if (tipo === 'stock') {
    tabla = `<table class="tabla-preview">
      <thead><tr><th>Cód. corto</th><th>Descripción</th><th>Precio</th><th>Stock ini.</th><th>Vend.</th></tr></thead>
      <tbody>${muestra.map(p => `<tr>
        <td><strong>${_esc(p.codigoCorto)}</strong></td>
        <td>${_esc(p.codigoCompleto)}</td>
        <td>$${p.precio}</td><td>${p.stockInicial}</td><td>${p.ventas}</td>
      </tr>`).join('')}</tbody></table>`;
  } else {
    tabla = `<table class="tabla-preview">
      <thead><tr><th>Fecha</th><th>Cliente</th><th>Producto</th><th>Cant.</th><th>Monto</th></tr></thead>
      <tbody>${muestra.map(v => `<tr>
        <td>${_fechaCorta(v.fecha)}</td>
        <td>${_esc(v.nombreCliente)}</td>
        <td>${_esc(v.codigoCompleto)}</td>
        <td>${v.cantidad}</td><td>$${v.monto}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  cont.innerHTML = `
    <p class="text-suave" style="margin:10px 0 6px;">
      Hoja detectada: <strong>${_esc(_nombreHoja(tipo))}</strong> · ${registros.length} registros.
      Mostrando los primeros ${muestra.length}:
    </p>
    <div class="tabla-preview-scroll">${tabla}</div>`;
  if (btn) btn.disabled = false;
}

// ── Importar STOCK desde Excel ──────────────────────────────────

function _importarStockExcel() {
  const filas     = _filasDeHoja('stock');
  const mapeados  = _mapearStock(filas);
  if (mapeados.length === 0) { window.App?.mostrarToast('ℹ No hay productos para importar'); return; }

  const existentes = JSON.parse(localStorage.getItem('convos_productos') || '[]');
  const porCodigo  = {};
  existentes.forEach(p => { porCodigo[(p.codigoCorto || '').toLowerCase()] = p; });

  let nuevos = 0, actualizados = 0, errores = 0;

  mapeados.forEach(prod => {
    try {
      const clave = (prod.codigoCorto || '').toLowerCase();
      if (porCodigo[clave]) {
        // actualizar conservando id y movimientos manuales
        const ex = porCodigo[clave];
        Object.assign(ex, prod, { id: ex.id, pedidos: ex.pedidos, ajustes: ex.ajustes, devoluciones: ex.devoluciones });
        actualizados++;
      } else {
        prod.id = 'xls_' + _hash(clave + prod.codigoCompleto) + '_' + (nuevos);
        existentes.push(prod);
        porCodigo[clave] = prod;
        nuevos++;
      }
    } catch { errores++; }
  });

  localStorage.setItem('convos_productos', JSON.stringify(existentes));

  typeof Stock !== 'undefined' && Stock.renderizarListaProductos();
  typeof Stock !== 'undefined' && Stock.renderizarMetricasInicio();
  typeof Stock !== 'undefined' && Stock.sincronizarTodo?.();

  _mostrarResumen(`✔ Stock importado: ${nuevos} nuevos, ${actualizados} actualizados, ${errores} errores.`);
}

// ── Importar VENTAS desde Excel ─────────────────────────────────

function _importarVentasExcel() {
  const filas    = _filasDeHoja('ventas');
  const mapeados = _mapearVentas(filas);
  if (mapeados.length === 0) { window.App?.mostrarToast('ℹ No hay ventas para importar'); return; }

  const productos = typeof Stock !== 'undefined' ? Stock.obtenerProductos() : [];
  const buscarProd = (codComp) => productos.find(p => (p.codigoCompleto || '').toLowerCase() === codComp.toLowerCase());

  const clientes   = JSON.parse(localStorage.getItem('convos_clientes') || '[]');
  const porNombre  = {};
  clientes.forEach(c => { porNombre[(c.nombre || '').toLowerCase()] = c; });

  const ventas    = JSON.parse(localStorage.getItem('convos_ventas') || '[]');
  const porId     = {};
  ventas.forEach(v => { porId[v.id] = v; });

  let nuevas = 0, actualizadas = 0, errores = 0, clientesNuevos = 0;

  mapeados.forEach(m => {
    try {
      // Cliente (crear si no existe)
      let cliente = null;
      if (m.nombreCliente) {
        const clave = m.nombreCliente.toLowerCase();
        cliente = porNombre[clave];
        if (!cliente) {
          cliente = { id: 'cli_' + _hash(clave), nombre: m.nombreCliente, telefono: '', direccion: '', email: '', notas: '', fechaAlta: m.fecha || new Date().toISOString() };
          clientes.push(cliente);
          porNombre[clave] = cliente;
          clientesNuevos++;
        }
      }

      const prod = buscarProd(m.codigoCompleto);
      const id   = 'imp_' + _hash([m.fecha, m.codigoCompleto, m.nombreCliente, m.monto].join('|'));

      const montoVenta = Number(m.monto) || 0;
      const cobrado    = Number(m.pagado) || 0;
      const costo      = Number(m.costo) || 0;
      const cantidad   = Number(m.cantidad) || 1;

      const venta = {
        id,
        fecha:          m.fecha || new Date().toISOString(),
        nombreCliente:  m.nombreCliente || 'Sin cliente',
        productoId:     prod?.id || null,
        codigoCompleto: m.codigoCompleto,
        codigoCorto:    prod?.codigoCorto || (m.codigoCompleto || '').slice(0, 12),
        familia:        m.familia || '',
        talle:          m.talle || '',
        color:          m.color || '',
        precio:         Number(m.precio) || 0,
        cantidad,
        descuento:      Number(m.descuento) || 0,
        montoVenta,
        cobrado,
        tipoCobro:      m.tipoCobro || 'efectivo',
        fechaCobro:     m.fechaTransferencia || '',
        saldoACobrar:   Math.max(0, montoVenta - cobrado),
        preparado:      m.entregado === true,
        entregado:      m.entregado === true,
        fechaEntrega:   m.entregado ? (m.fecha || '') : '',
        costo,
        ganancia:       Number(m.ganancia) || (montoVenta - costo * cantidad),
        observaciones:  '',
        importadoExcel: true,
      };

      if (porId[id]) { Object.assign(porId[id], venta); actualizadas++; }
      else { ventas.unshift(venta); porId[id] = venta; nuevas++; }
    } catch { errores++; }
  });

  localStorage.setItem('convos_clientes', JSON.stringify(clientes));
  localStorage.setItem('convos_ventas', JSON.stringify(ventas));

  // Re-render + sync
  typeof Clientes  !== 'undefined' && Clientes.sincronizarTodo?.();
  typeof Ventas    !== 'undefined' && Ventas.renderizarVentasDia();
  typeof Ventas    !== 'undefined' && Ventas.renderizarUltimasVentas();
  typeof Ventas    !== 'undefined' && Ventas.actualizarMetricasVentas();
  typeof Ventas    !== 'undefined' && Ventas.sincronizarTodo?.();
  typeof Cobranzas !== 'undefined' && Cobranzas.refrescar();
  typeof Entregas  !== 'undefined' && Entregas.refrescar();

  _mostrarResumen(`✔ Ventas importadas: ${nuevas} nuevas, ${actualizadas} actualizadas, ${clientesNuevos} clientes creados, ${errores} errores.`);
}

function _mostrarResumen(texto) {
  const el = document.getElementById('resumen-import');
  if (el) { el.textContent = texto; el.style.display = 'block'; }
  window.App?.mostrarToast(texto);
}

// ── Helpers de escape / fecha para preview ──────────────────────

function _esc(str) {
  if (!str && str !== 0) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _fechaCorta(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
  catch { return '—'; }
}

// ── Eventos ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  renderizarEstadoImportar();

  // ── Importación Excel ──
  const inputArchivo = document.getElementById('archivo-excel');
  const selectHoja   = document.getElementById('select-hoja-excel');
  const btnImportXls = document.getElementById('btn-importar-excel');

  inputArchivo?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (typeof XLSX === 'undefined') {
      window.App?.mostrarToast('❌ No se cargó la librería de Excel (revisá la conexión)');
      return;
    }
    try {
      window.App?.mostrarToast('📖 Leyendo archivo...');
      _workbook = await _leerArchivoExcel(file);
      _renderPreviewExcel(selectHoja?.value || 'stock');
    } catch (err) {
      window.App?.mostrarToast('❌ ' + (err.message || 'Error al leer el Excel'));
      console.error('[Excel]', err);
    }
  });

  selectHoja?.addEventListener('change', () => {
    document.getElementById('resumen-import')?.style && (document.getElementById('resumen-import').style.display = 'none');
    _renderPreviewExcel(selectHoja.value);
  });

  btnImportXls?.addEventListener('click', () => {
    if (!_workbook) { window.App?.mostrarToast('⚠ Primero elegí un archivo'); return; }
    const tipo = selectHoja?.value || 'stock';
    btnImportXls.disabled = true;
    btnImportXls.textContent = 'Importando...';
    try {
      if (tipo === 'stock') _importarStockExcel();
      else                  _importarVentasExcel();
    } catch (err) {
      window.App?.mostrarToast('❌ ' + (err.message || 'Error al importar'));
      console.error('[Excel import]', err);
    } finally {
      btnImportXls.disabled = false;
      btnImportXls.textContent = '⬆ Importar';
    }
  });

  // Importar stock
  document.getElementById('btn-importar-ahora')
    ?.addEventListener('click', importarStockDesdeSheets);

  // Backup completo
  document.getElementById('btn-backup-ahora')
    ?.addEventListener('click', async () => {
      if (typeof Sync === 'undefined' || !Sync.estaConfigurado()) {
        Sync?.mostrarPantallaConfig();
        return;
      }
      if (!navigator.onLine) {
        window.App?.mostrarToast('📶 Sin conexión para hacer backup');
        return;
      }
      try {
        window.App?.mostrarToast('☁ Haciendo backup...');
        await Sync.backupData();
        renderizarEstadoImportar();
        window.App?.mostrarToast('✔ Backup completo a Google Sheets');
      } catch (err) {
        window.App?.mostrarToast('❌ ' + (err.message || 'Error en backup'));
        console.error('[Backup]', err);
      }
    });

  // Limpiar datos locales
  document.getElementById('btn-limpiar-datos')
    ?.addEventListener('click', () => {
      const ok = confirm('¿Seguro que querés borrar todos los datos locales?\nEsta acción no se puede deshacer.');
      if (!ok) return;

      localStorage.removeItem('convos_productos');
      localStorage.removeItem('convos_ventas');
      localStorage.removeItem('convos_clientes');
      localStorage.removeItem('convos_pagos');
      localStorage.removeItem('convos_sync_cola');

      typeof Stock     !== 'undefined' && Stock.renderizarListaProductos();
      typeof Stock     !== 'undefined' && Stock.renderizarMetricasInicio();
      typeof Ventas    !== 'undefined' && Ventas.renderizarVentasDia();
      typeof Ventas    !== 'undefined' && Ventas.renderizarUltimasVentas();
      typeof Ventas    !== 'undefined' && Ventas.actualizarMetricasVentas();
      typeof Cobranzas !== 'undefined' && Cobranzas.refrescar();
      typeof Entregas  !== 'undefined' && Entregas.refrescar();
      renderizarEstadoImportar();

      window.App?.mostrarToast('🗑 Datos locales eliminados');
    });
});

// ── Exportar ────────────────────────────────────────────────────

window.Importar = {
  renderizarEstadoImportar,
  importarStockDesdeSheets,
};
