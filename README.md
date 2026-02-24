# Markdown Viewer Local

Visor local de Markdown en `HTML + JS` (sin servidor) para explorar carpetas con `.md` en subcarpetas, renderizar con buen formato y soporte de Mermaid.

## Características

- Explorador recursivo de Markdown (`.md`, `.markdown`, `.mdown`)
- Selector de carpeta local
- Renderizado con `markdown-it` (tablas, tareas, footnotes, deflists si los plugins cargan)
- Resaltado de código (`highlight.js`)
- Soporte de diagramas `Mermaid`
- Temas CSS locales seleccionables desde un desplegable (8 temas)
- Enlaces e imágenes relativas resueltas dentro de la carpeta seleccionada
- Auto-refresco (mejor soporte con `showDirectoryPicker` en Chrome/Edge)
- Scroll independiente entre explorador y visor
- Tablas anchas con scroll horizontal visible
- Botón para ocultar/mostrar el explorador
- El visor usa todo el ancho disponible (sin columna central fija)
- Acceso rápido a las últimas carpetas abiertas (hasta 4, en navegadores compatibles)

## Uso

1. Abre `index.html` con doble clic (o desde un marcador del navegador).
2. Pulsa `Elegir carpeta`.
3. Selecciona la carpeta raíz donde tengas tus markdowns.
4. Navega por el árbol de la izquierda y abre archivos.
5. Usa `Ocultar explorador` para ganar ancho de lectura cuando lo necesites.
6. Usa `Recientes` para reabrir rápidamente una de las últimas carpetas (si fue abierta con el selector de carpeta del navegador).

## Navegador recomendado

- `Chrome` o `Edge` modernos (Chromium)

La app intenta usar `showDirectoryPicker()` para una mejor experiencia (auto-refresco y acceso más fiable).
Si no está disponible, usa un fallback con selector de archivos (`webkitdirectory`) con limitaciones.
La lista de carpetas recientes funciona cuando el navegador permite guardar handles (Chrome/Edge con File System Access API + IndexedDB).

## Temas

Los temas están en `themes/`.

- `themes/default.css`
- `themes/github-like.css`
- `themes/paper-sepia.css`
- `themes/notebook.css`
- `themes/solarized-light.css`
- `themes/nord-light.css`
- `themes/night-owl.css`
- `themes/dracula-soft.css`

Para añadir uno nuevo:

1. Crea un CSS nuevo en `themes/` que estilice `.md-content`.
2. Añádelo en `themes/manifest.js`.

## Dependencias (CDN)

La app carga librerías desde CDN (sin API keys):

- `markdown-it`
- `markdown-it-footnote`
- `markdown-it-task-lists`
- `markdown-it-deflist`
- `highlight.js`
- `DOMPurify`
- `Mermaid`

Si alguna no carga, la app muestra un aviso.

## Limitaciones conocidas

- No edita ni guarda markdowns (solo lectura)
- No soporta MDX/JSX
- El auto-refresco completo depende del soporte del navegador para File System Access API
