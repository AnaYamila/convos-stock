// ============================================================
// ConVos Stock — Google Apps Script (middleware)
//
// INSTRUCCIONES:
// 1. Abrí tu Google Sheet → Extensiones → Apps Script
// 2. Borrá el código existente y pegá TODO este archivo
// 3. Guardá el proyecto (Ctrl+S)
// 4. Clic en "Implementar" → "Nueva implementación"
//    - Tipo: Aplicación web
//    - Ejecutar como: Yo (tu cuenta)
//    - Quién tiene acceso: Cualquier persona
// 5. Copiá la URL generada → es tu APPS_SCRIPT_URL
//
// Las hojas CLIENTES, STOCK, VENTAS, COBRANZAS y ENTREGAS se crean
// automáticamente la primera vez que la app sincroniza datos.
// ============================================================

// ── Punto de entrada POST ────────────────────────────────────────
// Recibe: { action, spreadsheetId, sheet?, sheets?, rows? }

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const ss   = SpreadsheetApp.openById(body.spreadsheetId);

    switch (body.action) {
      case 'write':
        // Agrega filas al final de la hoja (sin sobreescribir)
        _appendRows(ss, body.sheet, body.rows);
        break;

      case 'overwrite':
        // Reemplaza toda la hoja con los datos enviados
        _overwriteSheet(ss, body.sheet, body.rows);
        break;

      case 'backup':
        // Recibe un objeto { STOCK: [[...]], VENTAS: [[...]], ... }
        for (var sheetName in body.sheets) {
          _overwriteSheet(ss, sheetName, body.sheets[sheetName]);
        }
        break;

      case 'agregarVenta':
        // Inserta UNA venta en la pestaña VENTAS, escribiendo solo las
        // columnas libre/desplegable y respetando las fórmulas existentes.
        var filaEscrita = _agregarVenta(ss, body.venta);
        return _jsonOk({ accion: body.action, fila: filaEscrita });

      case 'editarVenta':
        // Modifica una venta existente (fila indicada), escribiendo solo
        // las columnas libre/desplegable y respetando las fórmulas.
        var filaEditada = _editarVenta(ss, body.fila, body.venta);
        return _jsonOk({ accion: body.action, fila: filaEditada });

      default:
        throw new Error('Acción desconocida: ' + body.action);
    }

    return _jsonOk({ accion: body.action });

  } catch (err) {
    return _jsonError(err.message);
  }
}

// ── Punto de entrada GET ─────────────────────────────────────────
// Parámetros: ?action=read&spreadsheetId=XXX&sheet=STOCK

function doGet(e) {
  try {
    var action        = e.parameter.action || 'read';
    var spreadsheetId = e.parameter.spreadsheetId;
    var sheetName     = e.parameter.sheet;

    if (!spreadsheetId) throw new Error('Falta spreadsheetId');

    var ss = SpreadsheetApp.openById(spreadsheetId);

    if (action === 'read') {
      if (!sheetName) throw new Error('Falta el parámetro sheet');
      var rows = _readRows(ss, sheetName);
      return _jsonOk({ rows: rows });
    }

    if (action === 'readRaw') {
      // Devuelve los valores tal cual (array de arrays), sin interpretar encabezados.
      // Útil para hojas con encabezados que no están en la primera fila
      // (ej: "Maestro de stock 2026").
      if (!sheetName) throw new Error('Falta el parámetro sheet');
      var hojaRaw = _buscarHoja(ss, sheetName);
      if (!hojaRaw || hojaRaw.getLastRow() === 0) return _jsonOk({ valores: [] });
      var valores = hojaRaw.getDataRange().getValues();
      return _jsonOk({ valores: valores });
    }

    if (action === 'info') {
      // Devuelve nombres de todas las hojas disponibles
      var hojas = ss.getSheets().map(function(h) { return h.getName(); });
      return _jsonOk({ hojas: hojas });
    }

    throw new Error('Acción GET desconocida: ' + action);

  } catch (err) {
    return _jsonError(err.message);
  }
}

// ── Helpers: escritura ───────────────────────────────────────────

function _appendRows(ss, sheetName, rows) {
  if (!rows || rows.length === 0) return;

  var hoja      = _obtenerOCrearHoja(ss, sheetName);
  var ultimaFila = hoja.getLastRow();

  if (ultimaFila === 0) {
    // Hoja vacía: escribir todo incluyendo header
    hoja.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    _formatearHeader(hoja, rows[0].length);
  } else {
    // Ya tiene datos: saltar header si la primera fila del batch lo es
    var datos = rows;
    var primeraFila = rows[0];
    var esHeader = (typeof primeraFila[0] === 'string' && primeraFila[0] === 'id');
    if (esHeader && ultimaFila > 0) {
      datos = rows.slice(1);
    }
    if (datos.length > 0) {
      hoja.getRange(ultimaFila + 1, 1, datos.length, datos[0].length).setValues(datos);
    }
  }
}

function _overwriteSheet(ss, sheetName, rows) {
  var hoja = _obtenerOCrearHoja(ss, sheetName);
  hoja.clearContents();
  hoja.clearFormats();

  if (!rows || rows.length === 0) return;

  hoja.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  _formatearHeader(hoja, rows[0].length);

  // Congelar la primera fila (header)
  hoja.setFrozenRows(1);
}

// ── Agregar venta (respeta fórmulas) ─────────────────────────────

// Mapa campo → columna (1-based) en la pestaña VENTAS.
// Solo se listan las columnas LIBRE y DESPLEGABLE. Las columnas
// FÓRMULA (Código H, Consumo K, Precio L, Monto N, Saldo R,
// Costo unit. W, Costo venta X, Rentabilidad Y) NO se tocan.
var _COLS_VENTA = {
  fecha:         1,  // A
  cliente:       2,  // B
  familia:       3,  // C
  marca:         4,  // D
  caracteristica:5,  // E
  talle:         6,  // F
  color:         7,  // G
  cantidad:      9,  // I
  confirmado:    10, // J
  descuentos:    13, // M
  cobrado:       15, // O
  tipoCobro:     16, // P
  fechaCobro:    17, // Q
  preparado:     19, // S
  entregado:     20, // T
  fechaEntrega:  21, // U
  lugarEntrega:  22, // V
  cerrada:       26, // Z (columna "Venta cerrada")
  detalleCobros: 27  // AA (columna "Detalle cobros")
};

// Columnas que contienen fórmulas (1-based), para replicarlas si hiciera falta.
var _COLS_FORMULA = [8, 11, 12, 14, 18, 23, 24, 25]; // H,K,L,N,R,W,X,Y

// Columnas que SIEMPRE deben guardarse como TEXTO (no número ni fecha):
// Familia, Marca, Característica, Talle, Color (1-based). Así "1/2", "3/4",
// "T3", etc. no se interpretan como fecha o número.
var _COLS_TEXTO = [3, 4, 5, 6, 7, 27];

// Escribe una celda forzando formato texto cuando corresponde.
function _escribirCelda(hoja, fila, col, valor) {
  var rng = hoja.getRange(fila, col);
  if (_COLS_TEXTO.indexOf(col) > -1) {
    rng.setNumberFormat('@');   // formato texto
    valor = (valor === null || valor === undefined) ? '' : String(valor);
  }
  rng.setValue(valor);
}

var _FILA_DATOS_INICIO = 3;  // fila 1 = tipo de campo, fila 2 = encabezados

function _agregarVenta(ss, venta) {
  if (!venta) throw new Error('Falta el objeto venta');
  var hoja = _buscarHoja(ss, 'VENTAS');
  if (!hoja) throw new Error('No existe la pestaña VENTAS');

  // Buscar la primera fila de datos realmente vacía (A, B y C en blanco)
  var ultima = hoja.getLastRow();
  var fila = -1;
  if (ultima < _FILA_DATOS_INICIO) {
    fila = _FILA_DATOS_INICIO;
  } else {
    var cant = ultima - _FILA_DATOS_INICIO + 1;
    var clave = hoja.getRange(_FILA_DATOS_INICIO, 1, cant, 3).getValues(); // A,B,C
    for (var i = 0; i < clave.length; i++) {
      if (_vacio(clave[i][0]) && _vacio(clave[i][1]) && _vacio(clave[i][2])) {
        fila = _FILA_DATOS_INICIO + i;
        break;
      }
    }
    if (fila === -1) fila = ultima + 1;
  }

  // Escribir solo las columnas libre/desplegable
  for (var campo in _COLS_VENTA) {
    if (!venta.hasOwnProperty(campo)) continue;
    var valor = venta[campo];
    if (valor === '' || valor === null || valor === undefined) continue;

    // Convertir fechas ISO (yyyy-mm-dd) a Date real para que el Sheet las trate como fecha
    if ((campo === 'fecha' || campo === 'fechaCobro' || campo === 'fechaEntrega')
        && typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)) {
      var p = valor.substring(0, 10).split('-');
      valor = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }
    _escribirCelda(hoja, fila, _COLS_VENTA[campo], valor);
  }

  // Asegurar que la fila tenga las fórmulas (por si se pasó del rango precargado)
  _asegurarFormulas(hoja, fila);

  return fila;
}

// Modifica una venta existente en la fila indicada. A diferencia de
// agregar, acá SÍ se escriben los valores vacíos (para poder limpiar campos).
function _editarVenta(ss, fila, venta) {
  if (!fila || fila < _FILA_DATOS_INICIO) throw new Error('Fila inválida');
  if (!venta) throw new Error('Falta el objeto venta');
  var hoja = _buscarHoja(ss, 'VENTAS');
  if (!hoja) throw new Error('No existe la pestaña VENTAS');

  for (var campo in _COLS_VENTA) {
    if (!venta.hasOwnProperty(campo)) continue;
    var valor = venta[campo];
    if (valor === null || valor === undefined) valor = '';

    if ((campo === 'fecha' || campo === 'fechaCobro' || campo === 'fechaEntrega')
        && typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)) {
      var p = valor.substring(0, 10).split('-');
      valor = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }
    _escribirCelda(hoja, fila, _COLS_VENTA[campo], valor);
  }
  _asegurarFormulas(hoja, fila);
  return fila;
}

// Si la fila no tiene la fórmula del Código (col H), copia todas las
// columnas-fórmula desde la primera fila de datos (plantilla).
function _asegurarFormulas(hoja, fila) {
  if (hoja.getRange(fila, 8).getFormula()) return; // ya tiene fórmulas
  for (var i = 0; i < _COLS_FORMULA.length; i++) {
    var c = _COLS_FORMULA[i];
    if (hoja.getRange(_FILA_DATOS_INICIO, c).getFormula()) {
      hoja.getRange(_FILA_DATOS_INICIO, c).copyTo(hoja.getRange(fila, c));
    }
  }
}

function _vacio(v) {
  return v === '' || v === null || v === undefined;
}

// ── Helpers: lectura ─────────────────────────────────────────────

function _readRows(ss, sheetName) {
  var hoja = ss.getSheetByName(sheetName);
  if (!hoja || hoja.getLastRow() === 0) return [];

  var values = hoja.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0].map(function(h) { return String(h).trim(); });
  return values.slice(1).map(function(fila) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = fila[i]; });
    return obj;
  });
}

// ── Helpers: utilidades ──────────────────────────────────────────

function _obtenerOCrearHoja(ss, nombre) {
  return ss.getSheetByName(nombre) || ss.insertSheet(nombre);
}

// Busca una hoja de forma tolerante: exacta → sin distinguir mayúsculas →
// la primera que contenga "maestro" (para "Maestro de stock 2026").
function _buscarHoja(ss, nombre) {
  var exacta = ss.getSheetByName(nombre);
  if (exacta) return exacta;

  var objetivo = String(nombre).trim().toLowerCase();
  var hojas = ss.getSheets();
  for (var i = 0; i < hojas.length; i++) {
    if (hojas[i].getName().trim().toLowerCase() === objetivo) return hojas[i];
  }
  for (var j = 0; j < hojas.length; j++) {
    if (hojas[j].getName().toLowerCase().indexOf('maestro') > -1) return hojas[j];
  }
  return null;
}

function _formatearHeader(hoja, cantColumnas) {
  var headerRange = hoja.getRange(1, 1, 1, cantColumnas);
  headerRange
    .setBackground('#1d4ed8')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(11);
  hoja.setColumnWidths(1, cantColumnas, 140);
}

function _jsonOk(data) {
  var payload = Object.assign({ ok: true }, data);
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function _jsonError(mensaje) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: mensaje }))
    .setMimeType(ContentService.MimeType.JSON);
}
