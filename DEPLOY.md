# 🚀 Guía de despliegue — ConVos Stock

Esta guía te lleva paso a paso para: **(A)** publicar la app online gratis con GitHub Pages,
**(B)** conectar Google Sheets como base de datos con Apps Script, y **(C)** instalar la app en el
celular como PWA (Android y iPhone).

> No hace falta saber programar. Seguí los pasos en orden.

---

## A · Publicar la app en GitHub Pages (URL pública gratis)

GitHub Pages sirve la app por HTTPS, requisito para que funcione como PWA y para que el
Service Worker (modo offline) ande.

### 1. Crear una cuenta y un repositorio
1. Entrá a <https://github.com> y creá una cuenta (gratis).
2. Arriba a la derecha tocá **+ → New repository**.
3. Nombre del repo: por ejemplo `convos-stock`.
4. Marcá **Public** (Pages gratis requiere repo público).
5. Tocá **Create repository**.

### 2. Subir los archivos
**Opción fácil (sin instalar nada):**
1. En el repo recién creado tocá **uploading an existing file**.
2. Arrastrá **todo el contenido** de la carpeta `convos-stock` (no la carpeta en sí, sino lo de
   adentro): `index.html`, `style.css`, `app.js`, `manifest.json`, `service-worker.js`,
   `apps-script.gs`, y la carpeta `modules/` completa con todos sus `.js`.
3. Abajo tocá **Commit changes**.

> ⚠️ Importante: `index.html` tiene que quedar en la **raíz** del repo (no dentro de una subcarpeta),
> si no la URL no va a encontrar la app.

### 3. Activar GitHub Pages
1. En el repo: **Settings → Pages** (menú lateral izquierdo).
2. En **Source** elegí **Deploy from a branch**.
3. En **Branch** elegí `main` y carpeta `/ (root)`. Tocá **Save**.
4. Esperá 1–2 minutos y recargá la página. Aparece:
   **"Your site is live at `https://TU-USUARIO.github.io/convos-stock/`"**.

Esa es la **URL pública** de tu app. Abrila en la compu y en el celular.

### 4. Actualizaciones futuras
Cada vez que cambies un archivo y hagas **Commit**, GitHub Pages se actualiza solo en 1–2 minutos.
La app detecta la versión nueva del Service Worker y se recarga sola.

---

## B · Configurar Google Sheets + Apps Script (la base de datos)

La app guarda todo localmente en el celular y, si lo configurás, sincroniza con una planilla de
Google Sheets. Así tenés respaldo en la nube y podés ver los datos desde la compu.

### 1. Crear la planilla
1. Entrá a <https://sheets.google.com> y creá una **planilla en blanco**.
2. Ponele un nombre, por ejemplo `ConVos Stock - Datos`.
3. Mirá la URL de la planilla:
   ```
   https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit
   ```
   Copiá el texto que está entre `/d/` y `/edit` → ese es el **Spreadsheet ID**. Guardalo.

> No hace falta crear las hojas a mano (CLIENTES, STOCK, VENTAS, etc.). El script las crea solo
> la primera vez que sincronizás.

### 2. Pegar el código de Apps Script
1. Dentro de la planilla: **Extensiones → Apps Script**.
2. Se abre el editor. Borrá todo lo que haya en `Código.gs`.
3. Abrí el archivo `apps-script.gs` del proyecto, copiá **todo** su contenido y pegalo ahí.
4. Tocá el icono de **guardar** (💾) y ponele un nombre al proyecto.

### 3. Publicar como aplicación web
1. Arriba a la derecha: **Implementar → Nueva implementación**.
2. Tocá el engranaje ⚙ junto a "Seleccionar tipo" y elegí **Aplicación web**.
3. Configurá:
   - **Descripción:** `ConVos API` (lo que quieras).
   - **Ejecutar como:** **Yo** (tu cuenta).
   - **Quién tiene acceso:** **Cualquier persona**.
4. Tocá **Implementar**.
5. Google te pide **autorizar permisos** → elegí tu cuenta → "Configuración avanzada" →
   "Ir a (proyecto) (no seguro)" → **Permitir**. (Es seguro: es tu propio script.)
6. Copiá la **URL de la aplicación web** (termina en `/exec`). Guardala.

> Cada vez que cambies el código de Apps Script tenés que volver a
> **Implementar → Gestionar implementaciones → editar → Nueva versión**, si no se sigue usando la vieja.

### 4. Conectar la app con la planilla
1. Abrí la app (la URL de GitHub Pages) en el celular o la compu.
2. Tocá el engranaje **⚙** del header → **Configurar conexión**
   (o aparece sola la primera vez).
3. Pegá el **Spreadsheet ID** (paso B.1) y la **URL del Apps Script** (paso B.3).
4. Tocá **Guardar y conectar**. La app prueba la conexión y queda sincronizando.

Listo: desde ahora el botón 🔄 del header y el "tirar para refrescar" hacen backup a Sheets.

---

## C · Instalar la app en el celular (PWA)

Una PWA se instala desde el navegador, sin pasar por Play Store ni App Store. Queda como un ícono
en la pantalla de inicio y se abre a pantalla completa.

### Android (Chrome)
1. Abrí la **URL de GitHub Pages** en **Chrome**.
2. Tocá el menú **⋮** (arriba a la derecha).
3. Elegí **Instalar aplicación** (o **Agregar a la pantalla principal**).
4. Confirmá. Aparece el ícono 📦 ConVos en tu pantalla de inicio.
5. Abrila desde ese ícono: se ve sin barra del navegador, como una app nativa.

### iPhone / iPad (Safari)
1. Abrí la **URL de GitHub Pages** en **Safari** (tiene que ser Safari, no Chrome).
2. Tocá el botón **Compartir** (el cuadrado con la flecha hacia arriba, abajo en el centro).
3. Bajá y elegí **Agregar a inicio**.
4. Tocá **Agregar** arriba a la derecha.
5. El ícono queda en la pantalla de inicio y se abre a pantalla completa.

### Notas
- La primera vez conviene abrir la app **con internet** para que se cachee y luego funcione offline.
- Si publicás una versión nueva, la app se actualiza sola al abrirla con conexión.
- Los datos se guardan en el celular (localStorage). Si configurás Google Sheets (parte B), además
  tenés respaldo en la nube y podés trabajar desde varios dispositivos.

---

## Resumen de URLs que vas a necesitar

| Dato | Dónde se obtiene | Dónde se usa |
|------|------------------|--------------|
| URL pública de la app | GitHub Pages (parte A.3) | Abrir/instalar la app |
| Spreadsheet ID | URL de la planilla (parte B.1) | Pantalla de conexión de la app |
| URL del Apps Script | Implementar app web (parte B.3) | Pantalla de conexión de la app |

¡Listo! Con eso la app queda online, con base de datos en Google Sheets e instalable en el celular. 🎉
