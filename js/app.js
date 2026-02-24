(function () {
  "use strict";

  var ns = window.MDViewer = window.MDViewer || {};
  var FILE_POLL_MS = 2000;
  var INDEX_POLL_MS = 10000;

  var ui = {};
  var runtime = {
    root: null,
    currentDoc: null,
    linksCleanup: null,
    openRequestId: 0,
    currentRenderId: 0,
    filePollTimer: null,
    indexPollTimer: null,
    filePollBusy: false,
    indexPollBusy: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function initUiRefs() {
    ui.appShell = document.querySelector(".app-shell");
    ui.pickFolderBtn = $("pick-folder-btn");
    ui.refreshBtn = $("refresh-btn");
    ui.toggleSidebarBtn = $("toggle-sidebar-btn");
    ui.autoRefreshToggle = $("auto-refresh-toggle");
    ui.modeBadge = $("mode-badge");
    ui.recentFoldersSelect = $("recent-folders-select");
    ui.openRecentBtn = $("open-recent-btn");
    ui.themeSelect = $("theme-select");
    ui.themeLink = $("theme-link");
    ui.rootLabel = $("root-label");
    ui.bannerStack = $("banner-stack");
    ui.fileCount = $("file-count");
    ui.filterInput = $("tree-filter-input");
    ui.treeContainer = $("tree-container");
    ui.docTitle = $("doc-title");
    ui.docMeta = $("doc-meta");
    ui.viewerScroll = $("viewer-scroll");
    ui.mdContent = $("md-content");
    ui.compatFolderInput = $("compat-folder-input");
  }

  function setModeBadge(text, modeClass) {
    ui.modeBadge.textContent = text;
    ui.modeBadge.classList.remove("compat", "empty");
    if (modeClass) {
      ui.modeBadge.classList.add(modeClass);
    }
  }

  function setRootLabel(text) {
    ui.rootLabel.textContent = text || "No hay carpeta seleccionada";
  }

  function setFileCount(count) {
    ui.fileCount.textContent = String(count || 0) + " markdown" + ((count || 0) === 1 ? "" : "s");
  }

  function setOpenRecentEnabled(enabled) {
    if (ui.openRecentBtn) {
      ui.openRecentBtn.disabled = !enabled;
    }
  }

  function formatDateTime(ms) {
    if (!ms) {
      return "";
    }
    try {
      return new Date(ms).toLocaleString();
    } catch (error) {
      return String(ms);
    }
  }

  function formatRecentFolderLabel(item) {
    var name = item && item.name ? item.name : "Carpeta";
    if (!item || !item.lastUsedAt) {
      return name;
    }
    return name + " (" + formatDateTime(item.lastUsedAt) + ")";
  }

  function clearDocMeta() {
    ui.docMeta.textContent = "";
  }

  function setDocHeader(path, lastModified) {
    if (!path) {
      ui.docTitle.textContent = "Selecciona un Markdown";
      clearDocMeta();
      return;
    }
    ui.docTitle.textContent = path;
    var parts = [];
    if (runtime.root && runtime.root.rootName) {
      parts.push(runtime.root.rootName);
    }
    if (lastModified) {
      parts.push("Actualizado: " + formatDateTime(lastModified));
    }
    ui.docMeta.textContent = parts.join(" · ");
  }

  function createBanner(kind, text, key, sticky) {
    var banner = document.createElement("div");
    banner.className = "banner";
    banner.dataset.kind = kind || "info";
    if (key) {
      banner.dataset.key = key;
    }

    var body = document.createElement("div");
    body.textContent = text;
    banner.appendChild(body);

    var close = document.createElement("button");
    close.type = "button";
    close.className = "banner-close";
    close.setAttribute("aria-label", "Cerrar aviso");
    close.textContent = "×";
    close.addEventListener("click", function () {
      banner.remove();
    });
    banner.appendChild(close);

    if (!sticky) {
      window.setTimeout(function () {
        if (banner.isConnected) {
          banner.remove();
        }
      }, 6000);
    }
    return banner;
  }

  function showBanner(kind, text, options) {
    options = options || {};
    var key = options.key || "";
    if (key) {
      var existing = ui.bannerStack.querySelector('.banner[data-key="' + key + '"]');
      if (existing) {
        existing.dataset.kind = kind || "info";
        existing.firstChild.textContent = text;
        return existing;
      }
    }
    var banner = createBanner(kind, text, key, Boolean(options.sticky));
    ui.bannerStack.appendChild(banner);
    return banner;
  }

  function removeBanner(key) {
    if (!key) {
      return;
    }
    var existing = ui.bannerStack.querySelector('.banner[data-key="' + key + '"]');
    if (existing) {
      existing.remove();
    }
  }

  function clearViewerToEmpty(message) {
    ui.mdContent.innerHTML = "";
    var wrapper = document.createElement("div");
    wrapper.className = "empty-state";
    var title = document.createElement("h2");
    title.textContent = "Sin contenido";
    var p = document.createElement("p");
    p.textContent = message || "Selecciona un archivo markdown para visualizarlo.";
    wrapper.appendChild(title);
    wrapper.appendChild(p);
    ui.mdContent.appendChild(wrapper);
  }

  function showViewerLoading(path) {
    ui.mdContent.innerHTML = "";
    var box = document.createElement("div");
    box.className = "md-loading";
    box.textContent = "Cargando " + path + "…";
    ui.mdContent.appendChild(box);
  }

  function showViewerError(message, detail) {
    ui.mdContent.innerHTML = "";
    var box = document.createElement("div");
    box.className = "md-error";
    box.textContent = detail ? message + "\n\n" + detail : message;
    ui.mdContent.appendChild(box);
  }

  function getPersistedState() {
    return ns.state.get();
  }

  function saveStatePatch(patch) {
    return ns.state.set(patch);
  }

  function applySidebarCollapsed(collapsed, options) {
    options = options || {};
    var isCollapsed = Boolean(collapsed);
    if (ui.appShell) {
      ui.appShell.classList.toggle("sidebar-collapsed", isCollapsed);
    }
    if (ui.toggleSidebarBtn) {
      ui.toggleSidebarBtn.textContent = isCollapsed ? "Mostrar explorador" : "Ocultar explorador";
      ui.toggleSidebarBtn.setAttribute("aria-pressed", isCollapsed ? "true" : "false");
      ui.toggleSidebarBtn.setAttribute("title", isCollapsed ? "Mostrar panel explorador" : "Ocultar panel explorador");
    }
    if (!options.skipPersist) {
      saveStatePatch({ sidebarCollapsed: isCollapsed });
    }
    return isCollapsed;
  }

  function getExpandedDirsSet() {
    return new Set(getPersistedState().expandedDirs);
  }

  function saveExpandedDirs(setValue) {
    saveStatePatch({ expandedDirs: Array.from(setValue) });
  }

  function getAncestors(path) {
    var normalized = ns.fs.normalizePath(path);
    if (!normalized) {
      return [];
    }
    var parts = normalized.split("/");
    var ancestors = [];
    for (var i = 1; i < parts.length; i += 1) {
      ancestors.push(parts.slice(0, i).join("/"));
    }
    return ancestors;
  }

  function ensureAncestorsExpanded(path) {
    var setValue = getExpandedDirsSet();
    var ancestors = getAncestors(path);
    var changed = false;
    for (var i = 0; i < ancestors.length; i += 1) {
      if (!setValue.has(ancestors[i])) {
        setValue.add(ancestors[i]);
        changed = true;
      }
    }
    if (changed) {
      saveExpandedDirs(setValue);
    }
  }

  function renderTree() {
    var index = runtime.root && runtime.root.index ? runtime.root.index : null;
    var persisted = getPersistedState();
    ns.tree.render(ui.treeContainer, {
      index: index,
      selectedPath: runtime.currentDoc ? runtime.currentDoc.path : persisted.selectedPath,
      expandedDirs: new Set(persisted.expandedDirs),
      filterText: ui.filterInput.value || ""
    });
  }

  function updateRecentFolderControlsState() {
    if (!ui.recentFoldersSelect || !ui.openRecentBtn) {
      return;
    }
    var hasOptions = ui.recentFoldersSelect.options.length > 0;
    var hasRealSelection = hasOptions && Boolean(ui.recentFoldersSelect.value);
    ui.recentFoldersSelect.disabled = !hasOptions;
    setOpenRecentEnabled(hasRealSelection);
  }

  function renderRecentFoldersList(items, preferredId) {
    if (!ui.recentFoldersSelect) {
      return;
    }

    var list = Array.isArray(items) ? items : [];
    ui.recentFoldersSelect.innerHTML = "";

    if (!list.length) {
      var emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Sin recientes";
      ui.recentFoldersSelect.appendChild(emptyOption);
      ui.recentFoldersSelect.value = "";
      ui.recentFoldersSelect.disabled = true;
      setOpenRecentEnabled(false);
      return;
    }

    var placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Selecciona una carpeta";
    ui.recentFoldersSelect.appendChild(placeholder);

    for (var i = 0; i < list.length; i += 1) {
      var item = list[i];
      var option = document.createElement("option");
      option.value = item.id;
      option.textContent = formatRecentFolderLabel(item);
      ui.recentFoldersSelect.appendChild(option);
    }

    var selectedId = preferredId || list[0].id || "";
    ui.recentFoldersSelect.value = selectedId;
    if (!ui.recentFoldersSelect.value && list[0]) {
      ui.recentFoldersSelect.value = list[0].id;
    }
    ui.recentFoldersSelect.disabled = false;
    updateRecentFolderControlsState();
  }

  async function refreshRecentFoldersUi(options) {
    options = options || {};
    if (!ns.fs || typeof ns.fs.listRecentDirectoryRoots !== "function") {
      renderRecentFoldersList([]);
      return;
    }
    try {
      var items = await ns.fs.listRecentDirectoryRoots();
      renderRecentFoldersList(items, options.preferredId || "");
    } catch (error) {
      renderRecentFoldersList([]);
    }
  }

  function updateModeUi() {
    if (!runtime.root) {
      setModeBadge("Sin carpeta", "empty");
      setRootLabel("No hay carpeta seleccionada");
      ui.refreshBtn.disabled = true;
      setFileCount(0);
      return;
    }

    ui.refreshBtn.disabled = false;
    if (runtime.root.mode === "fsapi") {
      setModeBadge("FS API", "");
      setRootLabel("Carpeta: " + runtime.root.rootName);
      removeBanner("compat-limitations");
    } else {
      setModeBadge("Compat", "compat");
      setRootLabel("Carpeta (compat): " + runtime.root.rootName + " · Refresco manual con re-selección");
      showBanner("warn", "Modo compatibilidad: para refrescar cambios en disco, vuelve a elegir la carpeta.", {
        key: "compat-limitations",
        sticky: true
      });
    }
  }

  function applyTheme(themeId) {
    var applied = ns.themes.apply(themeId);
    saveStatePatch({ themeId: applied.id });
    return applied;
  }

  function getCurrentFeatureStatus() {
    try {
      return ns.markdown.getFeatureStatus();
    } catch (error) {
      return {};
    }
  }

  function reportDependencyStatus() {
    var missingCritical = [];
    if (typeof window.markdownit !== "function") {
      missingCritical.push("markdown-it");
    }
    if (!window.DOMPurify) {
      missingCritical.push("DOMPurify");
    }
    if (window.MDViewer.cdnErrors && window.MDViewer.cdnErrors.length) {
      var names = window.MDViewer.cdnErrors.map(function (item) { return item.name; }).join(", ");
      showBanner("error", "Fallo al cargar dependencias CDN: " + names, { key: "cdn-errors", sticky: true });
    }
    if (missingCritical.length) {
      showBanner("error", "Faltan dependencias críticas: " + missingCritical.join(", "), {
        key: "critical-deps",
        sticky: true
      });
    }

    var status = getCurrentFeatureStatus();
    var optionalMissing = [];
    if (!status.highlight) {
      optionalMissing.push("highlight.js");
    }
    if (!status.mermaid) {
      optionalMissing.push("Mermaid");
    }
    if (!status.footnote) {
      optionalMissing.push("markdown-it-footnote");
    }
    if (!status.taskLists) {
      optionalMissing.push("markdown-it-task-lists");
    }
    if (!status.deflist) {
      optionalMissing.push("markdown-it-deflist");
    }
    if (optionalMissing.length) {
      showBanner("info", "Dependencias opcionales no disponibles: " + optionalMissing.join(", "), {
        key: "optional-deps"
      });
    }
  }

  function pickCompatFilesFromInput() {
    return new Promise(function (resolve, reject) {
      var input = ui.compatFolderInput;
      var settled = false;

      function cleanup() {
        input.removeEventListener("change", onChange);
        window.removeEventListener("focus", onFocus);
      }

      function settle(fn) {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        fn();
      }

      function onChange() {
        var files = Array.from(input.files || []);
        settle(function () {
          if (!files.length) {
            var err = new Error("Selección cancelada.");
            err.name = "AbortError";
            reject(err);
            return;
          }
          resolve(files);
        });
      }

      function onFocus() {
        window.setTimeout(function () {
          if (settled) {
            return;
          }
          var files = Array.from(input.files || []);
          if (!files.length) {
            settle(function () {
              var err = new Error("Selección cancelada.");
              err.name = "AbortError";
              reject(err);
            });
          }
        }, 250);
      }

      input.value = "";
      input.addEventListener("change", onChange, { once: false });
      window.addEventListener("focus", onFocus, { once: false });
      input.click();
    });
  }

  async function pickRoot() {
    if (ns.fs.supportsDirectoryPicker()) {
      try {
        return await ns.fs.pickDirectoryRoot();
      } catch (error) {
        if (error && error.name === "AbortError") {
          throw error;
        }
        showBanner("warn", "No se pudo usar el selector de carpetas del navegador. Se intentará el modo compatibilidad.");
      }
    }

    var files = await pickCompatFilesFromInput();
    return ns.fs.buildCompatRootFromFileList(files);
  }

  async function activateRoot(root, options) {
    options = options || {};
    runtime.root = root;
    runtime.currentDoc = null;
    runtime.openRequestId += 1;
    if (typeof runtime.linksCleanup === "function") {
      runtime.linksCleanup();
      runtime.linksCleanup = null;
    }

    await rebuildIndex({ preserveScroll: false });
    configureAutoRefresh();

    if (options.rememberRecent && root && root.mode === "fsapi" && root.rootHandle && typeof ns.fs.rememberRecentDirectoryRoot === "function") {
      var recentMeta = await ns.fs.rememberRecentDirectoryRoot(root.rootHandle);
      await refreshRecentFoldersUi({ preferredId: recentMeta && recentMeta.id ? recentMeta.id : "" });
    }
  }

  async function rebuildIndex(options) {
    options = options || {};
    if (!runtime.root) {
      return;
    }

    var previousSignature = runtime.root.index ? runtime.root.index.signature : "";
    var previousPath = runtime.currentDoc ? runtime.currentDoc.path : getPersistedState().selectedPath;

    var index = await ns.fs.buildIndex(runtime.root);
    updateModeUi();
    setFileCount(index.markdownPaths.length);

    var signatureChanged = index.signature !== previousSignature;
    if (signatureChanged && options.notifyChanges) {
      showBanner("ok", "Se actualizó el explorador de markdowns.");
    }

    renderTree();

    if (!index.markdownPaths.length) {
      runtime.currentDoc = null;
      if (typeof runtime.linksCleanup === "function") {
        runtime.linksCleanup();
        runtime.linksCleanup = null;
      }
      saveStatePatch({ selectedPath: null });
      setDocHeader(null);
      clearViewerToEmpty("No se encontraron markdowns en la carpeta seleccionada.");
      return;
    }

    var targetPath = null;
    var persistedState = getPersistedState();
    if (previousPath && index.markdownPathSet.has(previousPath)) {
      targetPath = previousPath;
    } else if (persistedState.selectedPath && index.markdownPathSet.has(persistedState.selectedPath)) {
      targetPath = persistedState.selectedPath;
    } else {
      targetPath = index.markdownPaths[0];
    }

    if (!targetPath) {
      return;
    }

    if (!runtime.currentDoc || runtime.currentDoc.path !== targetPath || options.forceReloadCurrent) {
      await openMarkdown(targetPath, { preserveScroll: Boolean(options.preserveScroll) });
      return;
    }

    renderTree();
  }

  async function renderDocument(doc, options) {
    options = options || {};
    var renderId = ++runtime.currentRenderId;
    var preserveScroll = Boolean(options.preserveScroll);
    var previousScrollTop = preserveScroll ? ui.viewerScroll.scrollTop : 0;

    if (!options.keepContent) {
      showViewerLoading(doc.path);
    }

    var html = await ns.markdown.render(doc.text, { path: doc.path });
    if (renderId !== runtime.currentRenderId) {
      return;
    }

    if (typeof runtime.linksCleanup === "function") {
      runtime.linksCleanup();
      runtime.linksCleanup = null;
    }

    ui.mdContent.innerHTML = html;

    try {
      await ns.markdown.postProcess(ui.mdContent);
    } catch (error) {
      showBanner("warn", "Se produjo un error renderizando Mermaid en alguno de los bloques.");
    }

    if (renderId !== runtime.currentRenderId) {
      return;
    }

    runtime.linksCleanup = await ns.links.bind(ui.mdContent, {
      rootContext: runtime.root,
      currentDocPath: doc.path,
      openMarkdown: openMarkdown,
      notify: function (kind, message) {
        showBanner(kind, message);
      }
    });

    if (renderId !== runtime.currentRenderId) {
      if (typeof runtime.linksCleanup === "function") {
        runtime.linksCleanup();
        runtime.linksCleanup = null;
      }
      return;
    }

    setDocHeader(doc.path, doc.lastModified);
    if (options.anchor) {
      scrollToAnchor(options.anchor);
    } else if (preserveScroll) {
      ui.viewerScroll.scrollTop = previousScrollTop;
    } else {
      ui.viewerScroll.scrollTop = 0;
    }
  }

  async function openMarkdown(path, options) {
    options = options || {};
    if (!runtime.root) {
      return;
    }

    var normalized = ns.fs.normalizePath(path);
    if (!normalized) {
      showBanner("warn", "Ruta de markdown no válida.");
      return;
    }
    if (!ns.fs.exists(runtime.root, normalized)) {
      showBanner("warn", "El archivo ya no existe: " + normalized);
      return;
    }

    var requestId = ++runtime.openRequestId;
    ensureAncestorsExpanded(normalized);
    renderTree();

    try {
      if (!options.preserveScroll || !runtime.currentDoc || runtime.currentDoc.path !== normalized) {
        showViewerLoading(normalized);
      }
      var doc = await ns.fs.readMarkdown(runtime.root, normalized);
      if (requestId !== runtime.openRequestId) {
        return;
      }
      runtime.currentDoc = doc;
      saveStatePatch({ selectedPath: normalized });
      renderTree();
      await renderDocument(doc, options);
    } catch (error) {
      if (requestId !== runtime.openRequestId) {
        return;
      }
      showViewerError("No se pudo abrir el markdown.", error && error.message ? error.message : String(error));
      showBanner("error", "Error al abrir " + normalized);
    }
  }

  async function rerenderCurrentFromCache(options) {
    if (!runtime.currentDoc) {
      return;
    }
    try {
      await renderDocument(runtime.currentDoc, Object.assign({ keepContent: false }, options || {}));
    } catch (error) {
      showBanner("error", "No se pudo volver a renderizar el documento actual.");
    }
  }

  function scrollToAnchor(anchor) {
    if (!anchor) {
      return;
    }
    var targetId = anchor.replace(/^#/, "");
    if (!targetId) {
      return;
    }
    try {
      targetId = decodeURIComponent(targetId);
    } catch (error) {
      // Keep original if malformed.
    }
    var target = document.getElementById(targetId);
    if (!target && window.CSS && typeof window.CSS.escape === "function") {
      target = ui.mdContent.querySelector("#" + window.CSS.escape(targetId));
    }
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  function clearRefreshTimers() {
    if (runtime.filePollTimer) {
      clearInterval(runtime.filePollTimer);
      runtime.filePollTimer = null;
    }
    if (runtime.indexPollTimer) {
      clearInterval(runtime.indexPollTimer);
      runtime.indexPollTimer = null;
    }
  }

  async function pollCurrentFileChange() {
    if (!runtime.root || runtime.root.mode !== "fsapi" || !runtime.currentDoc || runtime.filePollBusy) {
      return;
    }
    runtime.filePollBusy = true;
    try {
      var latest = await ns.fs.getFileLastModified(runtime.root, runtime.currentDoc.path);
      if (runtime.currentDoc && latest && latest !== runtime.currentDoc.lastModified) {
        await openMarkdown(runtime.currentDoc.path, { preserveScroll: true });
      }
    } catch (error) {
      showBanner("warn", "No se pudo comprobar cambios del archivo actual.");
    } finally {
      runtime.filePollBusy = false;
    }
  }

  async function refreshIndex(options) {
    options = options || {};
    if (!runtime.root) {
      return;
    }

    if (runtime.root.mode === "compat") {
      if (options.manual) {
        showBanner("info", "Modo compatibilidad: vuelve a elegir la carpeta para capturar cambios.");
        try {
          var compatRoot = await pickRoot();
          runtime.root = compatRoot;
          runtime.currentDoc = null;
          await rebuildIndex({ preserveScroll: false });
          configureAutoRefresh();
        } catch (error) {
          if (!(error && error.name === "AbortError")) {
            showBanner("error", "No se pudo refrescar en modo compatibilidad.");
          }
        }
      }
      return;
    }

    if (runtime.indexPollBusy) {
      return;
    }
    runtime.indexPollBusy = true;

    try {
      var beforeSignature = runtime.root.index ? runtime.root.index.signature : "";
      var currentPath = runtime.currentDoc ? runtime.currentDoc.path : null;
      await ns.fs.buildIndex(runtime.root);
      updateModeUi();
      setFileCount(runtime.root.index.markdownPaths.length);

      var afterSignature = runtime.root.index ? runtime.root.index.signature : "";
      var changed = beforeSignature !== afterSignature;

      if (changed) {
        renderTree();
        if (options.notifyChanges) {
          showBanner("ok", "Cambios detectados en el árbol de markdowns.");
        }
      }

      if (currentPath && runtime.root.index && !runtime.root.index.markdownPathSet.has(currentPath)) {
        showBanner("warn", "El markdown abierto ya no existe. Se abrirá otro disponible.");
        runtime.currentDoc = null;
        if (typeof runtime.linksCleanup === "function") {
          runtime.linksCleanup();
          runtime.linksCleanup = null;
        }
        if (runtime.root.index.markdownPaths.length) {
          await openMarkdown(runtime.root.index.markdownPaths[0], { preserveScroll: false });
        } else {
          setDocHeader(null);
          clearViewerToEmpty("Ya no hay markdowns disponibles en la carpeta.");
        }
      } else if (changed) {
        renderTree();
      }
    } catch (error) {
      if (options.manual) {
        showBanner("error", "Error al refrescar el árbol de archivos.");
      }
    } finally {
      runtime.indexPollBusy = false;
    }
  }

  function configureAutoRefresh() {
    clearRefreshTimers();

    var enabled = Boolean(ui.autoRefreshToggle.checked);
    saveStatePatch({ autoRefresh: enabled });
    if (!enabled || !runtime.root) {
      return;
    }

    if (runtime.root.mode !== "fsapi") {
      return;
    }

    runtime.filePollTimer = window.setInterval(function () {
      void pollCurrentFileChange();
    }, FILE_POLL_MS);

    runtime.indexPollTimer = window.setInterval(function () {
      void refreshIndex({ notifyChanges: true });
    }, INDEX_POLL_MS);
  }

  async function handlePickFolder() {
    try {
      var root = await pickRoot();
      await activateRoot(root, { rememberRecent: true });
    } catch (error) {
      if (error && error.name === "AbortError") {
        return;
      }
      showBanner("error", "No se pudo abrir la carpeta seleccionada.");
    }
  }

  async function handleOpenRecent() {
    if (!ui.recentFoldersSelect || !ui.recentFoldersSelect.value) {
      return;
    }
    var recentId = ui.recentFoldersSelect.value;
    try {
      var handle = await ns.fs.getRecentDirectoryRootHandle(recentId);
      if (!handle) {
        showBanner("warn", "La carpeta reciente ya no esta disponible. Se eliminara de la lista.");
        await ns.fs.removeRecentDirectoryRoot(recentId);
        await refreshRecentFoldersUi();
        return;
      }

      var hasPermission = await ns.fs.ensureDirectoryReadPermission(handle);
      if (!hasPermission) {
        showBanner("warn", "No se concedieron permisos para la carpeta reciente.");
        return;
      }

      var root = ns.fs.createFsApiRootFromHandle(handle);
      await activateRoot(root, { rememberRecent: true });
    } catch (error) {
      showBanner("error", "No se pudo abrir la carpeta reciente.");
    }
  }

  async function handleRefresh() {
    if (!runtime.root) {
      return;
    }
    if (runtime.root.mode === "compat") {
      await refreshIndex({ manual: true });
      return;
    }
    await refreshIndex({ manual: true, notifyChanges: true });
    await pollCurrentFileChange();
  }

  function handleTreeClick(event) {
    var button = event.target && event.target.closest ? event.target.closest("button[data-action]") : null;
    if (!button || !ui.treeContainer.contains(button)) {
      return;
    }
    var action = button.dataset.action;
    var path = button.dataset.path || "";
    if (action === "toggle-dir") {
      var expanded = getExpandedDirsSet();
      if (expanded.has(path)) {
        expanded.delete(path);
      } else {
        expanded.add(path);
      }
      saveExpandedDirs(expanded);
      renderTree();
      return;
    }
    if (action === "open-file") {
      void openMarkdown(path, { preserveScroll: false });
    }
  }

  function handleFilterInput() {
    saveStatePatch({ filterText: ui.filterInput.value || "" });
    renderTree();
  }

  function handleToggleSidebar() {
    var next = !(ui.appShell && ui.appShell.classList.contains("sidebar-collapsed"));
    applySidebarCollapsed(next);
  }

  function bindEvents() {
    ui.pickFolderBtn.addEventListener("click", function () {
      void handlePickFolder();
    });
    ui.refreshBtn.addEventListener("click", function () {
      void handleRefresh();
    });
    ui.toggleSidebarBtn.addEventListener("click", function () {
      handleToggleSidebar();
    });
    ui.autoRefreshToggle.addEventListener("change", function () {
      configureAutoRefresh();
    });
    ui.recentFoldersSelect.addEventListener("change", function () {
      updateRecentFolderControlsState();
    });
    ui.openRecentBtn.addEventListener("click", function () {
      void handleOpenRecent();
    });
    ui.filterInput.addEventListener("input", handleFilterInput);
    ui.treeContainer.addEventListener("click", handleTreeClick);
    ui.themeSelect.addEventListener("change", function () {
      applyTheme(ui.themeSelect.value);
      void rerenderCurrentFromCache({ preserveScroll: true });
    });
    window.addEventListener("focus", function () {
      if (!runtime.root || !ui.autoRefreshToggle.checked) {
        return;
      }
      if (runtime.root.mode === "fsapi") {
        void refreshIndex({ notifyChanges: false });
        void pollCurrentFileChange();
      }
    });
  }

  function initThemeSystem() {
    var persisted = getPersistedState();
    ns.themes.init({
      selectEl: ui.themeSelect,
      linkEl: ui.themeLink,
      initialThemeId: persisted.themeId
    });
    applyTheme(persisted.themeId);
  }

  function initPersistedUi() {
    var persisted = getPersistedState();
    ui.autoRefreshToggle.checked = Boolean(persisted.autoRefresh);
    ui.filterInput.value = persisted.filterText || "";
    applySidebarCollapsed(Boolean(persisted.sidebarCollapsed), { skipPersist: true });
    renderRecentFoldersList([]);
  }

  function initDefaultUi() {
    updateModeUi();
    setDocHeader(null);
    clearViewerToEmpty("Elige una carpeta y abre un markdown desde el panel izquierdo.");
  }

  function init() {
    initUiRefs();
    initPersistedUi();
    initThemeSystem();
    bindEvents();
    reportDependencyStatus();
    initDefaultUi();
    renderTree();
    void refreshRecentFoldersUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
