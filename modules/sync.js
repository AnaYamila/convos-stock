// ── Módulo Sync ─────────────────────────────────────────────────
// Capa fina de comunicación con Google Sheets a través de Apps Script.
// La app NO calcula ni guarda datos propios: solo lee (readRaw) y
// agrega ventas (agregarVenta). Toda la lógica vive en la planilla.

const CLAVES_SYNC = {
  CONFIG: 'convos_sync_config',
  COLA:   'convos_sync_cola',   // ventas pendientes de enviar (offline)
};

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

function setupConfig(spreadsheetId, appsScriptUrl) {
  if (!spreadsheetId?.trim() || !appsScriptUrl?.trim()) {
    throw new Error('Faltan spreadsheetId o appsScriptUrl');
  }
  guardarConfig({
    spreadsheetId: spreadsheetId.trim(),
    appsScriptUrl: appsScriptUrl.trim(),
    fechaConfig:   new Date().toISOString(),
  });
}

// ── Lectura cruda (array de arrays) ─────────────────────────────
// Se usa para Stock y VENTAS porque sus encabezados no están en la fila 1.

async function fetchRawFromSheets(sheetName) {
  const config = obtenerConfig();
  if (!config.appsScriptUrl) throw new Error('Apps Script no configurado');

  const params = new URLSearchParams({
    action:        'readRaw',
    spreadsheetId: config.spreadsheetId,
    sheet:         sheetName,
  });

  const resp = await fetch(`${config.appsScriptUrl}?${params}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || 'Error al leer');
  return json.valores || [];
}

// ── Escritura: agregar una venta ────────────────────────────────

async function agregarVentaEnSheets(venta) {
  const config = obtenerConfig();
  if (!config.appsScriptUrl) throw new Error('Apps Script no configurado');

  const payload = {
    action:        'agregarVenta',
    spreadsheetId: config.spreadsheetId,
    venta,
  };

  // text/plain evita el preflight CORS de Apps Script
  const resp = await fetch(config.appsScriptUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || 'Error al agregar la venta');
  return json;
}

// ── Escritura: editar una venta existente ───────────────────────

async function editarVentaEnSheets(fila, venta) {
  const config = obtenerConfig();
  if (!config.appsScriptUrl) throw new Error('Apps Script no configurado');
  if (!navigator.onLine) throw new Error('Necesitás conexión para editar una venta');

  const payload = {
    action:        'editarVenta',
    spreadsheetId: config.spreadsheetId,
    fila,
    venta,
  };
  const resp = await fetch(config.appsScriptUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || 'Error al editar la venta');
  return json;
}

// ── Borrar una venta ────────────────────────────────────────────

async function borrarVentaEnSheets(fila) {
  const config = obtenerConfig();
  if (!config.appsScriptUrl) throw new Error('Apps Script no configurado');
  if (!navigator.onLine) throw new Error('Necesitás conexión para borrar una venta');

  const payload = { action: 'borrarVenta', spreadsheetId: config.spreadsheetId, fila };
  const resp = await fetch(config.appsScriptUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || 'Error al borrar la venta');
  return json;
}

// ── Cola offline de ventas ──────────────────────────────────────

function obtenerCola() {
  try { return JSON.parse(localStorage.getItem(CLAVES_SYNC.COLA)) || []; }
  catch { return []; }
}
function _guardarCola(cola) {
  localStorage.setItem(CLAVES_SYNC.COLA, JSON.stringify(cola));
  _actualizarBadgeCola();
}

function encolarVenta(venta) {
  const cola = obtenerCola();
  cola.push({ venta, timestamp: Date.now() });
  _guardarCola(cola);
}

async function procesarCola() {
  let cola = obtenerCola();
  if (cola.length === 0) return;
  const pendientes = [];
  for (const op of cola) {
    try { await agregarVentaEnSheets(op.venta); }
    catch { pendientes.push(op); }
  }
  _guardarCola(pendientes);
}

// Registra una venta: si hay conexión la manda; si no, la encola.
async function registrarVentaRemota(venta) {
  if (!estaConfigurado()) throw new Error('Configurá la conexión con Google Sheets primero');
  if (!navigator.onLine) { encolarVenta(venta); return { encolada: true }; }
  try {
    const r = await agregarVentaEnSheets(venta);
    return r;
  } catch (err) {
    encolarVenta(venta);
    throw err;
  }
}

function _actualizarBadgeCola() {
  const n = obtenerCola().length;
  const badge = document.getElementById('badge-cola');
  if (!badge) return;
  badge.textContent = n;
  badge.style.display = n > 0 ? 'inline-flex' : 'none';
}

// Al reconectar, intenta vaciar la cola
window.addEventListener('online', async () => {
  if (obtenerCola().length === 0 || !estaConfigurado()) return;
  window.App?.mostrarToast('🔄 Enviando ventas pendientes...');
  await procesarCola();
  if (obtenerCola().length === 0) {
    window.App?.mostrarToast('✔ Ventas pendientes enviadas');
    window.Datos?.refrescar?.();
  }
});

// ── Pantalla de configuración ───────────────────────────────────

function mostrarPantallaConfig() {
  document.getElementById('overlay-config')?.classList.add('visible');
}
function ocultarPantallaConfig() {
  document.getElementById('overlay-config')?.classList.remove('visible');
}

function _iniciarOverlayConfig() {
  const config = obtenerConfig();
  const inputId  = document.getElementById('config-spreadsheet-id');
  const inputUrl = document.getElementById('config-apps-script-url');
  if (inputId  && config.spreadsheetId) inputId.value  = config.spreadsheetId;
  if (inputUrl && config.appsScriptUrl) inputUrl.value = config.appsScriptUrl;

  if (!estaConfigurado()) setTimeout(mostrarPantallaConfig, 500);

  document.getElementById('btn-guardar-config')?.addEventListener('click', async () => {
    const id  = document.getElementById('config-spreadsheet-id')?.value.trim();
    const url = document.getElementById('config-apps-script-url')?.value.trim();
    if (!id || !url) { window.App?.mostrarToast('⚠ Completá los dos campos'); return; }
    if (!url.startsWith('https://script.google.com')) {
      window.App?.mostrarToast('⚠ La URL debe ser de script.google.com'); return;
    }

    const btn = document.getElementById('btn-guardar-config');
    const txt = btn.textContent;
    btn.textContent = 'Probando conexión...'; btn.disabled = true;
    try {
      setupConfig(id, url);
      await fetchRawFromSheets('Stock');   // test real de lectura
      ocultarPantallaConfig();
      window.App?.mostrarToast('✔ Conectado a Google Sheets');
      await window.Datos?.refrescar?.();
    } catch (err) {
      window.App?.mostrarToast('❌ No se pudo conectar — revisá los datos');
      console.error('[Config]', err);
    } finally {
      btn.textContent = txt; btn.disabled = false;
    }
  });

  document.getElementById('btn-saltar-config')?.addEventListener('click', ocultarPantallaConfig);
  document.getElementById('btn-abrir-config')?.addEventListener('click', mostrarPantallaConfig);

  _actualizarBadgeCola();
}

document.addEventListener('DOMContentLoaded', _iniciarOverlayConfig);

// ── Botón 🔄 del header: refresca datos desde la planilla ───────

async function sincronizarConSheets() {
  if (!estaConfigurado()) { mostrarPantallaConfig(); return; }
  if (!navigator.onLine) { window.App?.mostrarToast('📶 Sin conexión'); return; }
  try {
    window.App?.mostrarToast('🔄 Actualizando desde la planilla...');
    await procesarCola();
    await window.Datos?.refrescar?.();
    window.App?.mostrarToast('✔ Datos actualizados');
  } catch (err) {
    window.App?.mostrarToast('❌ ' + (err.message || 'Error al actualizar'));
    console.error('[Sync]', err);
  }
}

// ── Exportar ────────────────────────────────────────────────────

window.sincronizarConSheets = sincronizarConSheets;
window.Sync = {
  setupConfig,
  estaConfigurado,
  obtenerConfig,
  fetchRawFromSheets,
  agregarVentaEnSheets,
  editarVentaEnSheets,
  borrarVentaEnSheets,
  registrarVentaRemota,
  obtenerCola,
  procesarCola,
  mostrarPantallaConfig,
  ocultarPantallaConfig,
};
