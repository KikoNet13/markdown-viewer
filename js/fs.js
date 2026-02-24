(function () {
  "use strict";

  var ns = window.MDViewer = window.MDViewer || {};
  var MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown"]);
  var RECENTS_DB_NAME = "md-viewer-local.db";
  var RECENTS_DB_VERSION = 1;
  var RECENTS_STORE = "recentDirectoryRoots";
  var MAX_RECENT_ROOTS = 4;
  var recentsDbPromise = null;

  function splitPath(path) {
    if (!path) {
      return [];
    }
    return String(path).split("/").filter(function (segment) {
      return Boolean(segment);
    });
  }

  function supportsIndexedDb() {
    return typeof window.indexedDB !== "undefined";
  }

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "id-" + Date.now() + "-" + Math.floor(Math.random() * 1000000);
  }

  function normalizePath(path) {
    if (typeof path !== "string") {
      return null;
    }

    var segments = String(path).replace(/\\/g, "/").split("/");
    var out = [];

    for (var i = 0; i < segments.length; i += 1) {
      var seg = segments[i];
      if (!seg || seg === ".") {
        continue;
      }
      if (seg === "..") {
        if (!out.length) {
          return null;
        }
        out.pop();
        continue;
      }
      out.push(seg);
    }

    return out.join("/");
  }

  function dirnamePath(path) {
    var normalized = normalizePath(path);
    if (normalized === null || normalized === "") {
      return "";
    }
    var idx = normalized.lastIndexOf("/");
    return idx >= 0 ? normalized.slice(0, idx) : "";
  }

  function basenamePath(path) {
    var normalized = normalizePath(path);
    if (normalized === null || normalized === "") {
      return "";
    }
    var idx = normalized.lastIndexOf("/");
    return idx >= 0 ? normalized.slice(idx + 1) : normalized;
  }

  function joinPath(parts) {
    return normalizePath(parts.join("/"));
  }

  function resolveRelativePath(baseFilePath, hrefPath) {
    if (typeof hrefPath !== "string" || !hrefPath.trim()) {
      return null;
    }
    var raw = hrefPath.replace(/\\/g, "/").trim();
    if (raw.startsWith("/")) {
      return normalizePath(raw.slice(1));
    }
    var baseDir = dirnamePath(baseFilePath || "");
    if (!baseDir) {
      return normalizePath(raw);
    }
    return normalizePath(baseDir + "/" + raw);
  }

  function splitHref(href) {
    var hashIndex = href.indexOf("#");
    var queryIndex = href.indexOf("?");
    var pathEnd = href.length;

    if (queryIndex >= 0 && queryIndex < pathEnd) {
      pathEnd = queryIndex;
    }
    if (hashIndex >= 0 && hashIndex < pathEnd) {
      pathEnd = hashIndex;
    }

    var pathPart = href.slice(0, pathEnd);
    var query = "";
    var hash = "";

    if (queryIndex >= 0) {
      var queryEnd = hashIndex >= 0 && hashIndex > queryIndex ? hashIndex : href.length;
      query = href.slice(queryIndex + 1, queryEnd);
    }
    if (hashIndex >= 0) {
      hash = href.slice(hashIndex + 1);
    }

    return { pathPart: pathPart, query: query, hash: hash };
  }

  function isMarkdownPath(path) {
    var name = basenamePath(path).toLowerCase();
    for (var ext of MARKDOWN_EXTENSIONS) {
      if (name.endsWith(ext)) {
        return true;
      }
    }
    return false;
  }

  function isExternalHref(href) {
    return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href);
  }

  function compareNames(a, b) {
    if (a.kind !== b.kind) {
      return a.kind === "dir" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  }

  function markVisibleDirectories(markdownPaths) {
    var visible = new Set([""]);
    for (var i = 0; i < markdownPaths.length; i += 1) {
      var parts = splitPath(markdownPaths[i]);
      for (var j = 1; j < parts.length; j += 1) {
        var dirPath = joinPath(parts.slice(0, j));
        if (dirPath !== null) {
          visible.add(dirPath);
        }
      }
    }
    return visible;
  }

  function createNode(path, name, kind) {
    return {
      path: path,
      name: name,
      kind: kind,
      children: kind === "dir" ? [] : null
    };
  }

  function sortTree(node) {
    if (!node || node.kind !== "dir" || !Array.isArray(node.children)) {
      return;
    }
    node.children.sort(compareNames);
    for (var i = 0; i < node.children.length; i += 1) {
      sortTree(node.children[i]);
    }
  }

  function buildIndexFromPaths(root, allFilePaths) {
    var markdownPaths = allFilePaths.filter(isMarkdownPath);
    markdownPaths.sort(function (a, b) {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    });

    var visibleDirs = markVisibleDirectories(markdownPaths);
    var nodesByPath = new Map();
    var rootNode = createNode("", root.rootName || "Carpeta", "dir");
    nodesByPath.set("", rootNode);

    visibleDirs.forEach(function (dirPath) {
      if (dirPath === "") {
        return;
      }
      nodesByPath.set(dirPath, createNode(dirPath, basenamePath(dirPath), "dir"));
    });

    for (var i = 0; i < markdownPaths.length; i += 1) {
      var mdPath = markdownPaths[i];
      nodesByPath.set(mdPath, createNode(mdPath, basenamePath(mdPath), "file"));
    }

    nodesByPath.forEach(function (node, path) {
      if (path === "") {
        return;
      }
      var parentPath = dirnamePath(path);
      if (!visibleDirs.has(parentPath)) {
        parentPath = "";
      }
      var parent = nodesByPath.get(parentPath);
      if (parent && parent.children) {
        parent.children.push(node);
      }
    });

    sortTree(rootNode);

    return {
      builtAt: Date.now(),
      treeRoot: rootNode,
      markdownPaths: markdownPaths,
      markdownPathSet: new Set(markdownPaths),
      signature: markdownPaths.join("\n")
    };
  }

  async function walkDirectory(root, dirHandle, dirPath, collectedPaths) {
    for await (var pair of dirHandle.entries()) {
      var name = pair[0];
      var handle = pair[1];
      var nextPath = normalizePath(dirPath ? dirPath + "/" + name : name);
      if (nextPath === null) {
        continue;
      }

      if (handle.kind === "directory") {
        await walkDirectory(root, handle, nextPath, collectedPaths);
      } else if (handle.kind === "file") {
        root.fileEntriesByPath.set(nextPath, { kind: "fsapi", handle: handle });
        collectedPaths.push(nextPath);
      }
    }
  }

  async function buildIndex(root) {
    if (!root || !root.mode) {
      throw new Error("No hay carpeta raíz seleccionada.");
    }

    root.fileEntriesByPath = new Map();
    var allFilePaths = [];

    if (root.mode === "fsapi") {
      await walkDirectory(root, root.rootHandle, "", allFilePaths);
    } else if (root.mode === "compat") {
      root.compatFilesByPath.forEach(function (file, path) {
        root.fileEntriesByPath.set(path, { kind: "compat", file: file });
        allFilePaths.push(path);
      });
    } else {
      throw new Error("Modo de raíz no soportado: " + root.mode);
    }

    var index = buildIndexFromPaths(root, allFilePaths);
    root.index = index;
    return index;
  }

  function openRecentsDb() {
    if (!supportsIndexedDb()) {
      return Promise.resolve(null);
    }
    if (recentsDbPromise) {
      return recentsDbPromise;
    }

    recentsDbPromise = new Promise(function (resolve) {
      try {
        var request = window.indexedDB.open(RECENTS_DB_NAME, RECENTS_DB_VERSION);
        request.onupgradeneeded = function (event) {
          var db = event.target.result;
          if (!db.objectStoreNames.contains(RECENTS_STORE)) {
            db.createObjectStore(RECENTS_STORE, { keyPath: "id" });
          }
        };
        request.onsuccess = function () {
          resolve(request.result);
        };
        request.onerror = function () {
          resolve(null);
        };
      } catch (error) {
        resolve(null);
      }
    });

    return recentsDbPromise;
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error("Error en IndexedDB.")); };
      tx.onabort = function () { reject(tx.error || new Error("Transaccion abortada.")); };
    });
  }

  function idbRequest(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("Error en peticion IndexedDB.")); };
    });
  }

  function sortRecentRecords(records) {
    return records.sort(function (a, b) {
      var aTime = typeof a.lastUsedAt === "number" ? a.lastUsedAt : 0;
      var bTime = typeof b.lastUsedAt === "number" ? b.lastUsedAt : 0;
      return bTime - aTime;
    });
  }

  async function readAllRecentRecords() {
    var db = await openRecentsDb();
    if (!db) {
      return [];
    }
    try {
      var tx = db.transaction(RECENTS_STORE, "readonly");
      var store = tx.objectStore(RECENTS_STORE);
      var all = await idbRequest(store.getAll());
      await txDone(tx).catch(function () { return null; });
      if (!Array.isArray(all)) {
        return [];
      }
      return sortRecentRecords(all.filter(function (record) {
        return record && typeof record === "object" && record.id && record.handle;
      }));
    } catch (error) {
      return [];
    }
  }

  async function putRecentRecord(record) {
    var db = await openRecentsDb();
    if (!db) {
      return false;
    }
    try {
      var tx = db.transaction(RECENTS_STORE, "readwrite");
      tx.objectStore(RECENTS_STORE).put(record);
      await txDone(tx);
      return true;
    } catch (error) {
      return false;
    }
  }

  async function deleteRecentRecord(recordId) {
    var db = await openRecentsDb();
    if (!db) {
      return false;
    }
    try {
      var tx = db.transaction(RECENTS_STORE, "readwrite");
      tx.objectStore(RECENTS_STORE).delete(recordId);
      await txDone(tx);
      return true;
    } catch (error) {
      return false;
    }
  }

  async function getRecentRecordById(recordId) {
    var db = await openRecentsDb();
    if (!db) {
      return null;
    }
    try {
      var tx = db.transaction(RECENTS_STORE, "readonly");
      var record = await idbRequest(tx.objectStore(RECENTS_STORE).get(recordId));
      await txDone(tx).catch(function () { return null; });
      return record || null;
    } catch (error) {
      return null;
    }
  }

  async function sameDirectoryHandle(a, b) {
    if (!a || !b) {
      return false;
    }
    if (a === b) {
      return true;
    }
    if (typeof a.isSameEntry === "function") {
      try {
        return await a.isSameEntry(b);
      } catch (error) {
        return false;
      }
    }
    return false;
  }

  async function trimRecentRecords() {
    var records = await readAllRecentRecords();
    if (records.length <= MAX_RECENT_ROOTS) {
      return;
    }
    for (var i = MAX_RECENT_ROOTS; i < records.length; i += 1) {
      await deleteRecentRecord(records[i].id);
    }
  }

  async function listRecentDirectoryRoots() {
    var records = await readAllRecentRecords();
    var result = [];
    for (var i = 0; i < records.length; i += 1) {
      result.push({
        id: String(records[i].id),
        name: typeof records[i].name === "string" && records[i].name ? records[i].name : "Carpeta",
        lastUsedAt: typeof records[i].lastUsedAt === "number" ? records[i].lastUsedAt : 0
      });
    }
    return result.slice(0, MAX_RECENT_ROOTS);
  }

  async function rememberRecentDirectoryRoot(handle) {
    if (!handle || handle.kind !== "directory") {
      return null;
    }

    var records = await readAllRecentRecords();
    var existingId = null;

    for (var i = 0; i < records.length; i += 1) {
      if (!records[i].handle) {
        continue;
      }
      if (await sameDirectoryHandle(records[i].handle, handle)) {
        existingId = records[i].id;
        break;
      }
    }

    var record = {
      id: existingId || randomId(),
      name: typeof handle.name === "string" && handle.name ? handle.name : "Carpeta",
      lastUsedAt: Date.now(),
      handle: handle
    };

    var saved = await putRecentRecord(record);
    if (!saved) {
      return null;
    }
    await trimRecentRecords();
    return {
      id: record.id,
      name: record.name,
      lastUsedAt: record.lastUsedAt
    };
  }

  async function removeRecentDirectoryRoot(recordId) {
    if (!recordId) {
      return false;
    }
    return deleteRecentRecord(recordId);
  }

  async function getRecentDirectoryRootHandle(recordId) {
    if (!recordId) {
      return null;
    }
    var record = await getRecentRecordById(recordId);
    return record && record.handle ? record.handle : null;
  }

  async function ensureDirectoryReadPermission(handle) {
    if (!handle) {
      return false;
    }
    if (typeof handle.queryPermission !== "function") {
      return true;
    }
    try {
      var state = await handle.queryPermission({ mode: "read" });
      if (state === "granted") {
        return true;
      }
      if (typeof handle.requestPermission === "function") {
        state = await handle.requestPermission({ mode: "read" });
        return state === "granted";
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  function supportsDirectoryPicker() {
    return typeof window.showDirectoryPicker === "function";
  }

  function createFsApiRootFromHandle(handle) {
    return {
      mode: "fsapi",
      rootName: handle && handle.name ? handle.name : "Carpeta",
      rootHandle: handle,
      fileEntriesByPath: new Map(),
      compatFilesByPath: null,
      index: null
    };
  }

  async function pickDirectoryRoot() {
    var handle = await window.showDirectoryPicker();
    return createFsApiRootFromHandle(handle);
  }

  function buildCompatRootFromFileList(fileList) {
    var files = Array.isArray(fileList) ? fileList : Array.from(fileList || []);
    if (!files.length) {
      throw new Error("No se seleccionaron archivos.");
    }

    var compatFilesByPath = new Map();
    var rootName = "Carpeta (compat)";
    var rootSegment = null;

    for (var i = 0; i < files.length; i += 1) {
      var file = files[i];
      var relative = typeof file.webkitRelativePath === "string" ? file.webkitRelativePath : file.name;
      relative = relative.replace(/\\/g, "/");
      var segments = relative.split("/").filter(Boolean);
      if (!segments.length) {
        continue;
      }

      if (segments.length > 1) {
        if (rootSegment === null) {
          rootSegment = segments[0];
          rootName = rootSegment;
        } else if (rootSegment !== segments[0]) {
          rootSegment = "";
          rootName = "Carpeta (compat)";
        }
      }

      var relSegments = segments.slice(rootSegment === "" ? 0 : 1);
      if (!relSegments.length) {
        relSegments = [file.name];
      }
      var path = normalizePath(relSegments.join("/"));
      if (!path) {
        continue;
      }
      compatFilesByPath.set(path, file);
    }

    return {
      mode: "compat",
      rootName: rootName,
      rootHandle: null,
      fileEntriesByPath: new Map(),
      compatFilesByPath: compatFilesByPath,
      index: null
    };
  }

  async function getFile(root, path) {
    var normalized = normalizePath(path);
    if (!root || normalized === null) {
      throw new Error("Ruta no válida.");
    }
    var entry = root.fileEntriesByPath && root.fileEntriesByPath.get(normalized);
    if (!entry) {
      throw new Error("Archivo no encontrado: " + normalized);
    }

    if (entry.kind === "fsapi") {
      return entry.handle.getFile();
    }
    if (entry.kind === "compat") {
      return entry.file;
    }
    throw new Error("Tipo de archivo no soportado.");
  }

  async function readMarkdown(root, path) {
    var file = await getFile(root, path);
    return {
      path: normalizePath(path),
      text: await file.text(),
      lastModified: typeof file.lastModified === "number" ? file.lastModified : 0
    };
  }

  async function getFileLastModified(root, path) {
    var file = await getFile(root, path);
    return typeof file.lastModified === "number" ? file.lastModified : 0;
  }

  function fileExists(root, path) {
    var normalized = normalizePath(path);
    return Boolean(root && root.fileEntriesByPath && normalized && root.fileEntriesByPath.has(normalized));
  }

  ns.fs = {
    supportsDirectoryPicker: supportsDirectoryPicker,
    supportsIndexedDb: supportsIndexedDb,
    pickDirectoryRoot: pickDirectoryRoot,
    createFsApiRootFromHandle: createFsApiRootFromHandle,
    buildCompatRootFromFileList: buildCompatRootFromFileList,
    buildIndex: buildIndex,
    readMarkdown: readMarkdown,
    getFile: getFile,
    getFileLastModified: getFileLastModified,
    exists: fileExists,
    listRecentDirectoryRoots: listRecentDirectoryRoots,
    rememberRecentDirectoryRoot: rememberRecentDirectoryRoot,
    getRecentDirectoryRootHandle: getRecentDirectoryRootHandle,
    removeRecentDirectoryRoot: removeRecentDirectoryRoot,
    ensureDirectoryReadPermission: ensureDirectoryReadPermission,
    normalizePath: normalizePath,
    dirnamePath: dirnamePath,
    basenamePath: basenamePath,
    resolveRelativePath: resolveRelativePath,
    splitHref: splitHref,
    isMarkdownPath: isMarkdownPath,
    isExternalHref: isExternalHref
  };
})();
