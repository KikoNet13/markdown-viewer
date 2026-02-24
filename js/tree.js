(function () {
  "use strict";

  var ns = window.MDViewer = window.MDViewer || {};

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (typeof text === "string") {
      node.textContent = text;
    }
    return node;
  }

  function matchText(value, filter) {
    if (!filter) {
      return true;
    }
    return value.toLowerCase().indexOf(filter) >= 0;
  }

  function renderFileNode(node, options, filter) {
    var isMatch = matchText(node.name + " " + node.path, filter);
    if (!isMatch) {
      return null;
    }

    var li = el("li", "tree-item");
    li.setAttribute("role", "none");

    var row = el("button", "tree-row file");
    row.type = "button";
    row.dataset.action = "open-file";
    row.dataset.path = node.path;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-selected", options.selectedPath === node.path ? "true" : "false");
    if (options.selectedPath === node.path) {
      row.setAttribute("aria-current", "true");
    }

    var caret = el("span", "tree-caret empty", "");
    caret.textContent = "▸";
    var label = el("span", "tree-label");
    var text = el("span", "tree-label-text", node.name);
    label.appendChild(text);
    if (node.name.toLowerCase().endsWith(".markdown") || node.name.toLowerCase().endsWith(".mdown")) {
      label.appendChild(el("span", "tree-tag", "md"));
    }

    row.appendChild(caret);
    row.appendChild(label);
    li.appendChild(row);
    return li;
  }

  function renderDirNode(node, options, filter) {
    var li = el("li", "tree-item");
    li.setAttribute("role", "none");

    var childList = el("ul", "tree-list");
    childList.setAttribute("role", "group");

    var visibleChildCount = 0;
    for (var i = 0; i < node.children.length; i += 1) {
      var child = node.children[i];
      var childElement = child.kind === "dir"
        ? renderDirNode(child, options, filter)
        : renderFileNode(child, options, filter);
      if (childElement) {
        childList.appendChild(childElement);
        visibleChildCount += 1;
      }
    }

    var dirMatches = matchText(node.name + " " + node.path, filter);
    if (!visibleChildCount && !dirMatches) {
      return null;
    }

    var row = el("button", "tree-row dir");
    row.type = "button";
    row.dataset.action = "toggle-dir";
    row.dataset.path = node.path;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-expanded", "false");

    var isOpen = filter ? true : options.expandedDirs.has(node.path);
    if (isOpen) {
      row.setAttribute("aria-expanded", "true");
    }

    var caret = el("span", "tree-caret" + (isOpen ? " open" : ""), "▸");
    var label = el("span", "tree-label");
    label.appendChild(el("span", "tree-label-text", node.name));

    row.appendChild(caret);
    row.appendChild(label);

    if (!isOpen) {
      childList.classList.add("hidden");
    }

    li.appendChild(row);
    li.appendChild(childList);
    return li;
  }

  function render(container, options) {
    options = options || {};
    var index = options.index || null;
    var filter = typeof options.filterText === "string" ? options.filterText.trim().toLowerCase() : "";
    var expandedDirs = options.expandedDirs instanceof Set
      ? options.expandedDirs
      : new Set(Array.isArray(options.expandedDirs) ? options.expandedDirs : []);
    options.expandedDirs = expandedDirs;

    container.innerHTML = "";

    if (!index || !index.treeRoot || !Array.isArray(index.markdownPaths) || !index.markdownPaths.length) {
      container.appendChild(el("div", "tree-empty", "No se encontraron markdowns en la carpeta seleccionada."));
      return;
    }

    var topList = el("ul", "tree-list");
    topList.setAttribute("role", "group");

    var visible = 0;
    for (var i = 0; i < index.treeRoot.children.length; i += 1) {
      var child = index.treeRoot.children[i];
      var childElement = child.kind === "dir"
        ? renderDirNode(child, options, filter)
        : renderFileNode(child, options, filter);
      if (childElement) {
        topList.appendChild(childElement);
        visible += 1;
      }
    }

    if (!visible) {
      container.appendChild(el("div", "tree-empty", "No hay resultados para el filtro actual."));
      return;
    }

    container.appendChild(topList);
  }

  ns.tree = {
    render: render
  };
})();
