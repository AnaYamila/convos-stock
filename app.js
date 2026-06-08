// ── App: navegación, toast, spinner, conexión, service worker ───

// ── Navegación por tabs ─────────────────────────────────────────

const tabs = document.querySelectorAll('.tab');
const vistas = document.querySelectorAll('.vista');

function navegarA(nombreVista) {
  vistas.forEach((v) => v.classList.remove('activa'));
  tabs.forEach((t) => t.classList.remove('activo'));
  document.getElementById(`vista-${nombreVista}`)?.classList.add('activa');
  document.querySelector(`.tab[data-vista="${nombreVista}"]`)?.classList.add('activo');
  document.getElementById('contenido')?.scrollTo(0, 0);

  if (nombreVista === 'panel')     window.UI?.renderDashboard?.();
  if (nombreVista === 'stock')     window.UI?.renderStock?.();
  if (nombreVista === 'cobranzas') window.UI?.renderCobranzas?.();
  if (nombreVista === 'entregas')  window.UI?.renderEntregas?.();
  if (nombreVista === 'ventas')    window.UI?.renderVentas?.();
}

tabs.forEach((tab) => tab.addEventListener('click', () => navegarA(tab.dataset.vista)));

// ── Toast ───────────────────────────────────────────────────────

const toastEl = document.getElementById('toast');
let toastTimer = null;
function mostrarToast(mensaje, duracion = 2800) {
  if (!toastEl) return;
  toastEl.textContent = mensaje;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), duracion);
}

// ── Spinner global ──────────────────────────────────────────────

function mostrarSpinner(texto = 'Cargando...') {
  const ov = document.getElementById('spinner-overlay');
  const tx = document.getElementById('spinner-texto');
  if (tx) tx.textContent = texto;
  if (ov) ov.style.display = 'flex';
}
function ocultarSpinner() {
  const ov = document.getElementById('spinner-overlay');
  if (ov) ov.style.display = 'none';
}

// ── Estado de conexión ──────────────────────────────────────────

const estadoSyncEl = document.getElementById('estado-sync');
function actualizarEstadoConexion() {
  if (!estadoSyncEl) return;
  if (navigator.onLine) { estadoSyncEl.textContent = 'Online';  estadoSyncEl.classList.remove('offline'); }
  else                  { estadoSyncEl.textContent = 'Offline'; estadoSyncEl.classList.add('offline'); }
}
window.addEventListener('online', actualizarEstadoConexion);
window.addEventListener('offline', actualizarEstadoConexion);
actualizarEstadoConexion();

// ── Tirar hacia abajo para actualizar (pull-to-refresh) ─────────
// La app NO se actualiza sola al volver de otra app. Solo se actualiza
// con el botón 🔄 o tirando hacia abajo estando arriba de todo.
(function initPullToRefresh() {
  const cont = document.getElementById('contenido');
  const ind = document.getElementById('ptr-indicador');
  if (!cont) return;
  const UMBRAL = 70;
  let startY = 0, tirando = false, dy = 0;

  cont.addEventListener('touchstart', (e) => {
    if (cont.scrollTop <= 0) { startY = e.touches[0].clientY; tirando = true; dy = 0; }
    else tirando = false;
  }, { passive: true });

  cont.addEventListener('touchmove', (e) => {
    if (!tirando) return;
    dy = e.touches[0].clientY - startY;
    if (dy > 0 && cont.scrollTop <= 0 && ind) {
      ind.style.opacity = Math.min(dy / UMBRAL, 1);
      ind.textContent = dy > UMBRAL ? '↻ Soltá para actualizar' : '↓ Tirá para actualizar';
    }
  }, { passive: true });

  cont.addEventListener('touchend', () => {
    if (!tirando) return;
    if (ind) ind.style.opacity = 0;
    if (dy > UMBRAL && cont.scrollTop <= 0) {
      if (window.Sync?.estaConfigurado?.() && navigator.onLine) window.Datos?.refrescar?.();
    }
    tirando = false; dy = 0;
  });
})();

// ── Botones del header ──────────────────────────────────────────

document.getElementById('btn-sincronizar')?.addEventListener('click', () => {
  if (typeof sincronizarConSheets === 'function') sincronizarConSheets();
});
document.getElementById('btn-ajustes')?.addEventListener('click', () => {
  window.Sync?.mostrarPantallaConfig?.();
});

// ── Service Worker (PWA) ────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').then((reg) => {
      reg.update();
      reg.addEventListener('updatefound', () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        });
      });
    }).catch((err) => console.warn('Service Worker no registrado:', err));
  });
}

// ── Exportar helpers globales ───────────────────────────────────

window.App = { navegarA, mostrarToast, mostrarSpinner, ocultarSpinner };
