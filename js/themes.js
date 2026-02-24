(function () {
  "use strict";

  var ns = window.MDViewer = window.MDViewer || {};
  var themeList = Array.isArray(window.MD_VIEWER_THEMES) ? window.MD_VIEWER_THEMES.slice() : [];
  var themeMap = new Map();
  var selectEl = null;
  var linkEl = null;
  var currentThemeId = null;

  function normalizeTheme(theme) {
    if (!theme || typeof theme !== "object") {
      return null;
    }
    var id = typeof theme.id === "string" ? theme.id.trim() : "";
    var label = typeof theme.label === "string" ? theme.label.trim() : "";
    var file = typeof theme.file === "string" ? theme.file.trim() : "";
    if (!id || !file) {
      return null;
    }
    return {
      id: id,
      label: label || id,
      file: file
    };
  }

  function ensureThemes() {
    if (!themeList.length) {
      themeList = [{ id: "default", label: "Default", file: "default.css" }];
    }
    themeMap.clear();
    var normalized = [];
    for (var i = 0; i < themeList.length; i += 1) {
      var theme = normalizeTheme(themeList[i]);
      if (!theme || themeMap.has(theme.id)) {
        continue;
      }
      themeMap.set(theme.id, theme);
      normalized.push(theme);
    }
    if (!normalized.length) {
      normalized.push({ id: "default", label: "Default", file: "default.css" });
      themeMap.set("default", normalized[0]);
    }
    themeList = normalized;
  }

  function listThemes() {
    ensureThemes();
    return themeList.slice();
  }

  function resolveTheme(themeId) {
    ensureThemes();
    if (themeId && themeMap.has(themeId)) {
      return themeMap.get(themeId);
    }
    return themeList[0];
  }

  function populateSelect() {
    if (!selectEl) {
      return;
    }
    ensureThemes();
    selectEl.innerHTML = "";
    for (var i = 0; i < themeList.length; i += 1) {
      var theme = themeList[i];
      var option = document.createElement("option");
      option.value = theme.id;
      option.textContent = theme.label;
      selectEl.appendChild(option);
    }
  }

  function applyTheme(themeId) {
    var theme = resolveTheme(themeId);
    currentThemeId = theme.id;
    if (linkEl) {
      linkEl.setAttribute("href", "themes/" + theme.file);
    }
    if (selectEl) {
      selectEl.value = theme.id;
    }
    return theme;
  }

  ns.themes = {
    init: function (options) {
      options = options || {};
      selectEl = options.selectEl || null;
      linkEl = options.linkEl || null;
      populateSelect();
      return applyTheme(options.initialThemeId || null);
    },
    list: listThemes,
    apply: applyTheme,
    getCurrentThemeId: function () {
      return currentThemeId;
    }
  };
})();
