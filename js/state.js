(function () {
  "use strict";

  var ns = window.MDViewer = window.MDViewer || {};
  var STORAGE_KEY = "md-viewer-local.state.v1";

  var defaults = {
    themeId: "default",
    autoRefresh: true,
    expandedDirs: [],
    selectedPath: null,
    filterText: "",
    sidebarCollapsed: false
  };

  function uniqueStrings(list) {
    if (!Array.isArray(list)) {
      return [];
    }
    var seen = new Set();
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var value = typeof list[i] === "string" ? list[i] : "";
      if (!value || seen.has(value)) {
        continue;
      }
      seen.add(value);
      out.push(value);
    }
    return out;
  }

  function sanitize(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    return {
      themeId: typeof raw.themeId === "string" && raw.themeId ? raw.themeId : defaults.themeId,
      autoRefresh: typeof raw.autoRefresh === "boolean" ? raw.autoRefresh : defaults.autoRefresh,
      expandedDirs: uniqueStrings(raw.expandedDirs),
      selectedPath: typeof raw.selectedPath === "string" && raw.selectedPath ? raw.selectedPath : null,
      filterText: typeof raw.filterText === "string" ? raw.filterText.slice(0, 300) : defaults.filterText,
      sidebarCollapsed: typeof raw.sidebarCollapsed === "boolean" ? raw.sidebarCollapsed : defaults.sidebarCollapsed
    };
  }

  function cloneState(state) {
    return {
      themeId: state.themeId,
      autoRefresh: state.autoRefresh,
      expandedDirs: state.expandedDirs.slice(),
      selectedPath: state.selectedPath,
      filterText: state.filterText,
      sidebarCollapsed: state.sidebarCollapsed
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return cloneState(defaults);
      }
      return sanitize(JSON.parse(raw));
    } catch (error) {
      return cloneState(defaults);
    }
  }

  var current = load();

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (error) {
      // Ignore quota or privacy-mode storage failures.
    }
  }

  ns.state = {
    defaults: cloneState(defaults),
    get: function () {
      return cloneState(current);
    },
    set: function (patch) {
      current = sanitize(Object.assign({}, current, patch || {}));
      persist();
      return cloneState(current);
    },
    resetSelection: function () {
      current = sanitize(Object.assign({}, current, { selectedPath: null }));
      persist();
      return cloneState(current);
    },
    setExpandedDirs: function (dirs) {
      current = sanitize(Object.assign({}, current, { expandedDirs: dirs }));
      persist();
      return cloneState(current);
    }
  };
})();
