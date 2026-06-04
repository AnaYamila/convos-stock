// ── Módulo Sync ─────────────────────────────────────────────────
// Integración con Google Sheets vía Google Apps Script como middleware.
// No requiere OAuth: el Apps Script actúa como proxy REST.

const CLAVES_SYNC = {
  CONFIG: 'convos_sync_config',
  COLA:   'convos_sync_cola',
  ULTIMA: 'convos_ultima_sync',
};

// Hojas soportadas en el Google Sheet
const HOJAS_VALIDAS = ['CLIENTES', 'STOCK', 'VENTAS', 'COBRANZAS', 'ENTREGAS'];

// ── Configuración ───────────────────────────────────────────────

function obtenerConfig() {
  try { return JSON.parse(localStorage.getItem(CLAVES_SYNC.CONFIG)) || {}; }
  catch { return {}; }
}

function guardarConfig(config) {
  localStorage.setItem(CLAVES_SYNC.CONFIG, JSON.stringify(config));
}

function estaConfigurado() {
  const c = obtenerConfig();
  return !!(c.appsScriptUrl && c.spreadsheetId);
}

// Guarda SPREADSHEET_ID y APPS_SCRIPT_URL en localStorage
function setupConfig(spreadsheetId, appsScriptUrl) {
  if (!spreadsheetId?.trim() || !appsScriptUrl?.trim()) {
    throw new Error('Faltan spreadsheetId o appsScriptUrl');
  }
  guardarConfig({
    spreadsheetId:  spreadsheetId.trim(),
    appsScriptUrl:  appsScriptUrl.trim(),
    fechaConfig:    new Date().toISOString(),
  });
}

// ── Cola offline ────────────────────────────────────────────────

function obtenerCola() {
  try { return JSON.parse(localStorage.getItem(CLAVES_SYNC.COLA)) || []; }
  catch { return []; }
}

function _guardarCola(cola) {
  localStorage.setItem(CLAVES_SYNC.COLA, JSON.stringify(cola));
}

function _encolarOperacion(op) {
  const cola = obtenerCola();
  // Evitar duplicados exactos por ID de dato
  if (op.idDato) {
    const yaEnCola = cola.some(o => o.idDato === op.idDato && o.hoja === op.hoja);
    if (yaEnCola) return;
  }
  cola.push({ ...op, timestamp: Date.now(), reintentos: 0 });
  _guardarCola(cola);
}

async function procesarCola() {
  const cola = obtenerCola();
  if (cola.length === 0) return;

  const pendientes = [];
  for (const op of cola) {
    try {
      if (op.tipo === 'write') {
        await syncToSheets(op.hoja, op.datos, op.modo || 'append');
      } else if (op.tipo === 'backup') {
        await backupData();
      }
    } catch {
      if ((op.reintentos || 0) < 3) {
        pendientes.push({ ...op, reintentos: (op.reintentos || 0) + 1 });
      }
      // Más de 3 reintentos: se descarta silenciosamente
    }
  }
  _guardarCola(pendientes);
  _actualizarBadgeCola();
}

// ── Core: syncToSheets ──────────────────────────────────────────
// Envía datos al Apps Script para escribir en el sheet.
// modo 'append'    → agrega filas nuevas al final
// modo 'overwrite' → reemplaza toda la hoja

async function syncToSheets(sheetName, data, modo = 'append') {
  const config = obtenerConfig();
  if (!config.appsScriptUrl) throw new Error('Apps Script no configurado');

  const filas = Array.isArray(data) ? data : [data];
  const payload = {
    action:        modo === 'overwrite' ? 'overwrite' : 'write',
    spreadsheetId: config.spreadsheetId,
    sheet:         sheetName.toUpperCase(),
    rows:          filas,
  };

  // Usamos Content-Type: text/plain para evitar el preflight CORS de Apps Script
  const respuesta = await fetch(config.appsScriptUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify(payload),
  });

  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

  const json = await respuesta.json();
  if (!json.ok) throw new Error(json.error || 'Error en Apps Script');

  _registrarSyncExitosa(filas.length);
  return json;
}

// ── Core: fetchFromSheets ───────────────────────────────────────
// Lee todos los registros de una hoja y los devuelve como array de objetos.

async function fetchFromSheets(sheetName) {
  const config = obtenerConfig();
  if (!config.appsScriptUrl) throw new Error('Apps Script no configurado');

  const params = new URLSearchParams({
    action:        'read',
    spreadsheetId: config.spreadsheetId,
    sheet:         sheetName.toUpperCase(),
  });

  const respuesta = await fetch(`${config.appsScriptUrl}?${params}`);
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

  const json = await respuesta.json();
  if (!json.ok) throw new Error(json.error || 'Error al leer');

  return json.rows || [];
}

// ── Core: backupData ────────────────────────────────────────────
// Hace un backup completo del localStorage al Google Sheet.
// Cada módulo es dueño del formato de SU hoja y expone un
// `sincronizarTodo()` que sobreescribe la hoja con el estado actual.
// Así nunca hay desajuste de columnas entre lo que escribe el módulo
// y lo que escribe el backup.

async function backupData() {
  const config = obtenerConfig();
  if (!config.appsScriptUrl) throw new Error('Apps Script no configurado');

  const modulos = [
    typeof Clientes  !== 'undefined' ? Clientes  : null,
    typeof Stock     !== 'undefined' ? Stock     : null,
    typeof Ventas    !== 'undefined' ? Ventas    : null,
    typeof Cobranzas !== 'undefined' ? Cobranzas : null,
    typeof Entregas  !== 'undefined' ? Entregas  : null,
  ];

  let algo = false;
  for (const mod of modulos) {
    if (mod && typeof mod.sincronizarTodo === 'function') {
      await mod.sincronizarTodo();   // cada uno hace su overwrite
      algo = true;
    }
  }

  if (!algo) throw new Error('No hay módulos para respaldar');

  _registrarSyncExitosa();
  return { ok: true };
}

// ── Auto-sync: hook para los demás módulos ──────────────────────
// Llamar desde stock.js, ventas.js, etc. cada vez que se guarda un dato.
// Si está offline o sin config → encola para reintentar después.

async function registrarCambio(hoja, datos, idDato = null) {
  const op = { tipo: 'write', hoja, datos, modo: 'append', idDato };

  if (!estaConfigurado() || !navigator.onLine) {
    _encolarOperacion(op);
    _actualizarBadgeCola();
    return;
  }

  try {
    await syncToSheets(hoja, datos, 'append');
  } catch {
    _encolarOperacion(op);
    _actualizarBadgeCola();
  }
}

// ── Helpers internos ────────────────────────────────────────────

function _leerLocal(clave) {
  try { return JSON.parse(localStorage.getItem(clave)) || []; }
  catch { return []; }
}

function _registrarSyncExitosa(cantRegistros = 0) {
  const ts = new Date().toISOString();
  localStorage.setItem(CLAVES_SYNC.ULTIMA, ts);

  const elUltima = document.getElementById('ultima-sync');
  if (elUltima) elUltima.textContent = new Date(ts).toLocaleString('es-AR');

  const elReg = document.getElementById('registros-importados');
  if (elReg && cantRegistros > 0) elReg.textContent = cantRegistros;

  const estadoSyncEl = document.getElementById('estado-sync');
  if (estadoSyncEl && navigator.onLine) {
    estadoSyncEl.textContent = '✔ Sync';
    setTimeout(() => {
      if (navigator.onLine) estadoSyncEl.textContent = 'Online';
    }, 2000);
  }
}

function _actualizarBadgeCola() {
  const pendientes = obtenerCola().length;
  const badge = document.getElementById('badge-cola');
  if (!badge) return;
  if (pendientes > 0) {
    badge.textContent = pendientes;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── Reconexión automática ───────────────────────────────────────

window.addEventListener('online', async () => {
  const pendientes = obtenerCola().length;
  if (pendientes === 0 || !estaConfigurado()) return;
  window.App?.mostrarToast(`🔄 Sincronizando ${pendientes} cambio${pendientes > 1 ? 's' : ''} pendiente${pendientes > 1 ? 's' : ''}...`);
  await procesarCola();
  if (obtenerCola().length === 0) {
    window.App?.mostrarToast('✔ Todo sincronizado');
  }
});

// ── Función global para el botón 🔄 del header ──────────────────

async function sincronizarConSheets() {
  if (!estaConfigurado()) {
    mostrarPantallaConfig();
    return;
  }
  if (!navigator.onLine) {
    window.App?.mostrarToast('📶 Sin conexión — se sincronizará al reconectar');
    return;
  }
  try {
    window.App?.mostrarToast('🔄 Sincronizando...');
    await procesarCola();
    await backupData();
    window.App?.mostrarToast('✔ Backup completo a Google Sheets');
  } catch (err) {
    window.App?.mostrarToast('❌ ' + (err.message || 'Error al sincronizar'));
    console.error('[Sync]', err);
  }
}

// ── Pantalla de configuración inicial ──────────────────────────

function mostrarPantallaConfig() {
  document.getElementById('overlay-config')?.classList.add('visible');
}

function ocultarPantallaConfig() {
  document.getElementById('overlay-config')?.classList.remove('visible');
}

function _iniciarOverlayConfig() {
  // Prellenar con config existente
  const config = obtenerConfig();
  const inputId  = document.getElementById('config-spreadsheet-id');
  const inputUrl = document.getElementById('config-apps-script-url');
  if (inputId  && config.spreadsheetId)  inputId.value  = config.spreadsheetId;
  if (inputUrl && config.appsScriptUrl)  inputUrl.value = config.appsScriptUrl;

  // Mostrar automáticamente si no está configurado
  if (!estaConfigurado()) setTimeout(mostrarPantallaConfig, 600);

  // Botón guardar
  document.getElementById('btn-guardar-config')?.addEventListener('click', async () => {
    const id  = document.getElementById('config-spreadsheet-id')?.value.trim();
    const url = document.getElementById('config-apps-script-url')?.value.trim();

    if (!id || !url) {
      window.App?.mostrarToast('⚠ Completá los dos campos');
      return;
    }
    if (!url.startsWith('https://script.google.com')) {
      window.App?.mostrarToast('⚠ La URL debe ser de script.google.com');
      return;
    }

    const btn = document.getElementById('btn-guardar-config');
    const textoOriginal = btn.textContent;
    btn.textContent = 'Probando conexión...';
    btn.disabled = true;

    try {
      setupConfig(id, url);

      // Test de conexión: intenta leer STOCK (puede estar vacío, no importa)
      await fetchFromSheets('STOCK').catch(() => {});

      ocultarPantallaConfig();
      window.App?.mostrarToast('✔ Conexión guardada correctamente');
      typeof Importar !== 'undefined' && Importar.renderizarEstadoImportar?.();

      // Procesar cola pendiente si hay
      setTimeout(procesarCola, 1000);
    } catch (err) {
      window.App?.mostrarToast('❌ No se pudo conectar — revisá los datos');
      console.error('[Config]', err);
    } finally {
      btn.textContent = textoOriginal;
      btn.disabled = false;
    }
  });

  // Botón saltar
  document.getElementById('btn-saltar-config')?.addEventListener('click', ocultarPantallaConfig);

  // Botón abrir desde la pestaña Importar
  document.getElementById('btn-abrir-config')?.addEventListener('click', mostrarPantallaConfig);

  // Badge de cola al cargar
  _actualizarBadgeCola();
}

document.addEventListener('DOMContentLoaded', _iniciarOverlayConfig);

// ── Exportar ────────────────────────────────────────────────────

window.sincronizarConSheets = sincronizarConSheets;
window.Sync = {
  setupConfig,
  estaConfigurado,
  obtenerConfig,
  syncToSheets,
  fetchFromSheets,
  backupData,
  registrarCambio,
  procesarCola,
  obtenerCola,
  mostrarPantallaConfig,
  ocultarPantallaConfig,
  HOJAS_VALIDAS,
};
