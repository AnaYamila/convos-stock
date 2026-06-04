// ── Navegación por tabs ─────────────────────────────────────────

const tabs = document.querySelectorAll('.tab');
const vistas = document.querySelectorAll('.vista');
const fabAgregar = document.getElementById('fab-agregar');

function navegarA(nombreVista) {
  vistas.forEach((v) => v.classList.remove('activa'));
  tabs.forEach((t) => t.classList.remove('activo'));

  const vistaObjetivo = document.getElementById(`vista-${nombreVista}`);
  const tabObjetivo = document.querySelector(`.tab[data-vista="${nombreVista}"]`);

  if (vistaObjetivo) vistaObjetivo.classList.add('activa');
  if (tabObjetivo) tabObjetivo.classList.add('activo');

  // FAB solo visible en la pestaña Stock
  if (fabAgregar) fabAgregar.style.display = nombreVista === 'stock' ? 'flex' : 'none';

  // Refrescar la vista que se abre (datos pueden haber cambiado en otra pestaña)
  if (nombreVista === 'cobranzas') window.Cobranzas?.refrescar?.();
  if (nombreVista === 'entregas')  window.Entregas?.refrescar?.();
  if (nombreVista === 'ventas') {
    window.Ventas?.renderizarVentasDia?.();
    window.Ventas?.actualizarMetricasVentas?.();
  }
  if (nombreVista === 'inicio') {
    window.Stock?.renderizarMetricasInicio?.();
    window.Ventas?.renderizarUltimasVentas?.();
    window.Ventas?.actualizarMetricasVentas?.();
    window.Cobranzas?.refrescar?.();
    window.Entregas?.refrescar?.();
  }
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => navegarA(tab.dataset.vista));
});

// ── Toast ───────────────────────────────────────────────────────

const toastEl = document.getElementById('toast');
let toastTimer = null;

function mostrarToast(mensaje, duracion = 2500) {
  toastEl.textContent = mensaje;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), duracion);
}

// ── Estado de conexión ──────────────────────────────────────────

const estadoSyncEl = document.getElementById('estado-sync');

function actualizarEstadoConexion() {
  if (navigator.onLine) {
    estadoSyncEl.textContent = 'Online';
    estadoSyncEl.classList.remove('offline');
  } else {
    estadoSyncEl.textContent = 'Offline';
    estadoSyncEl.classList.add('offline');
  }
}

window.addEventListener('online', actualizarEstadoConexion);
window.addEventListener('offline', actualizarEstadoConexion);
actualizarEstadoConexion();

// ── Service Worker (PWA) ────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./service-worker.js')
      .then((reg) => {
        // Buscar actualizaciones cada vez que se abre la app
        reg.update();

        // Cuando hay una versión nueva esperando, recargar para aplicarla
        reg.addEventListener('updatefound', () => {
          const nuevo = reg.installing;
          if (!nuevo) return;
          nuevo.addEventListener('statechange', () => {
            if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
              // Hay una versión nueva lista → recargar una sola vez
              window.location.reload();
            }
          });
        });
      })
      .catch((err) => console.warn('Service Worker no registrado:', err));
  });
}

// ── Botón sincronizar ───────────────────────────────────────────

document.getElementById('btn-sincronizar').addEventListener('click', () => {
  mostrarToast('🔄 Sincronizando...');
  // La lógica real está en modules/sync.js
  if (typeof sincronizarConSheets === 'function') {
    sincronizarConSheets();
  }
});

// ── Botón ajustes (⚙) → abre la vista de Google Sheets / datos ──
document.getElementById('btn-ajustes')?.addEventListener('click', () => {
  navegarA('importar');
});

// ── Exportar helpers globales ───────────────────────────────────

window.App = { navegarA, mostrarToast };
