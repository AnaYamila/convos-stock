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
