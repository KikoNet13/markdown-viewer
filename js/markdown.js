(function () {
  "use strict";

  var ns = window.MDViewer = window.MDViewer || {};

  var engine = null;
  var featureStatus = {
    markdownIt: false,
    domPurify: false,
    highlight: false,
    mermaid: false,
    footnote: false,
    taskLists: false,
    deflist: false
  };
  var mermaidInitialized = false;

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function slugify(text) {
    var base = String(text || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return base || "section";
  }

  function installHeadingIds(md) {
    var defaultRender = md.renderer.rules.heading_open || function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };

    md.renderer.rules.heading_open = function (tokens, idx, options, env, self) {
      env._mdvHeadingIds = env._mdvHeadingIds || Object.create(null);
      var inlineToken = tokens[idx + 1];
      var content = inlineToken && inlineToken.type === "inline" ? inlineToken.content : "";
      var base = slugify(content);
      var count = env._mdvHeadingIds[base] || 0;
      env._mdvHeadingIds[base] = count + 1;
      var id = count ? base + "-" + count : base;
      tokens[idx].attrSet("id", id);
      return defaultRender(tokens, idx, options, env, self);
    };
  }

  function createEngine() {
    if (typeof window.markdownit !== "function") {
      return null;
    }

    featureStatus.markdownIt = true;
    featureStatus.highlight = Boolean(window.hljs);
    featureStatus.domPurify = Boolean(window.DOMPurify);
    featureStatus.mermaid = Boolean(window.mermaid);

    var md = window.markdownit({
      html: true,
      linkify: true,
      typographer: true,
      breaks: false,
      highlight: function (str, lang) {
        if (/^\s*mermaid(\s|$)/i.test(lang || "")) {
          return "";
        }
        if (!window.hljs) {
          return "";
        }
        var language = (lang || "").trim().toLowerCase();
        if (language && window.hljs.getLanguage && window.hljs.getLanguage(language)) {
          try {
            return window.hljs.highlight(str, { language: language }).value;
          } catch (error) {
            return "";
          }
        }
        try {
          return window.hljs.highlightAuto(str).value;
        } catch (error) {
          return "";
        }
      }
    });

    installHeadingIds(md);

    if (typeof window.markdownitFootnote === "function") {
      md.use(window.markdownitFootnote);
      featureStatus.footnote = true;
    }
    if (typeof window.markdownitTaskLists === "function") {
      md.use(window.markdownitTaskLists, {
        enabled: true,
        label: true,
        labelAfter: true
      });
      featureStatus.taskLists = true;
    }
    if (typeof window.markdownitDeflist === "function") {
      md.use(window.markdownitDeflist);
      featureStatus.deflist = true;
    }

    return md;
  }

  function ensureEngine() {
    if (!engine) {
      engine = createEngine();
    }
    return engine;
  }

  function sanitizeHtml(html) {
    if (!window.DOMPurify) {
      return html;
    }
    featureStatus.domPurify = true;
    return window.DOMPurify.sanitize(html, {
      ADD_TAGS: ["input"],
      ADD_ATTR: [
        "class",
        "id",
        "checked",
        "disabled",
        "type",
        "start",
        "rel",
        "target",
        "data-mdv-source"
      ]
    });
  }

  function renderFallback(text) {
    return "<pre>" + escapeHtml(text) + "</pre>";
  }

  async function render(text, ctx) {
    ctx = ctx || {};
    var md = ensureEngine();
    if (!md) {
      return renderFallback(text);
    }

    var env = {
      sourcePath: ctx.path || ""
    };
    var rawHtml = md.render(String(text || ""), env);
    return sanitizeHtml(rawHtml);
  }

  function ensureMermaid() {
    if (!window.mermaid) {
      return false;
    }
    featureStatus.mermaid = true;
    if (!mermaidInitialized) {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
        suppressErrorRendering: true
      });
      mermaidInitialized = true;
    }
    return true;
  }

  function extractMermaidBlocks(container) {
    var blocks = container.querySelectorAll("pre > code");
    var replacements = [];
    for (var i = 0; i < blocks.length; i += 1) {
      var code = blocks[i];
      var className = code.className || "";
      if (!/\blanguage-mermaid\b/i.test(className) && !/\bmermaid\b/i.test(className)) {
        continue;
      }
      var pre = code.closest("pre");
      if (!pre) {
        continue;
      }
      replacements.push({ pre: pre, source: code.textContent || "" });
    }
    for (var j = 0; j < replacements.length; j += 1) {
      var item = replacements[j];
      var wrapper = document.createElement("div");
      wrapper.className = "mermaid";
      wrapper.setAttribute("data-mdv-source", "1");
      wrapper.textContent = item.source;
      item.pre.replaceWith(wrapper);
    }
    return replacements.length;
  }

  function renderMermaidError(block, source, error) {
    var details = document.createElement("details");
    details.className = "mermaid-error";
    var summary = document.createElement("summary");
    summary.textContent = "No se pudo renderizar Mermaid";
    var pre = document.createElement("pre");
    pre.textContent = source;
    var message = document.createElement("div");
    message.className = "md-note";
    message.textContent = (error && error.message) ? error.message : "Error desconocido";
    details.appendChild(summary);
    details.appendChild(message);
    details.appendChild(pre);
    block.replaceWith(details);
  }

  function markTableWrapperOverflow(wrapper, table) {
    if (!wrapper || !table) {
      return;
    }
    // Force a measurable layout after the wrapper is attached.
    var hasOverflow = (table.scrollWidth - wrapper.clientWidth) > 1;
    wrapper.classList.toggle("is-overflowing", hasOverflow);
    if (hasOverflow) {
      wrapper.setAttribute("title", "Tabla ancha: desplazamiento horizontal disponible");
    } else {
      wrapper.removeAttribute("title");
    }
  }

  function wrapTables(container) {
    var tables = Array.from(container.querySelectorAll("table"));
    var wrappedCount = 0;

    for (var i = 0; i < tables.length; i += 1) {
      var table = tables[i];
      if (table.closest(".md-table-wrap")) {
        continue;
      }
      var wrapper = document.createElement("div");
      wrapper.className = "md-table-wrap";
      wrapper.setAttribute("tabindex", "0");
      wrapper.setAttribute("role", "region");
      wrapper.setAttribute("aria-label", "Tabla con desplazamiento horizontal");

      var parent = table.parentNode;
      if (!parent) {
        continue;
      }
      parent.insertBefore(wrapper, table);
      wrapper.appendChild(table);
      markTableWrapperOverflow(wrapper, table);
      wrappedCount += 1;
    }

    return wrappedCount;
  }

  async function postProcess(container) {
    if (!container) {
      return { mermaidBlocks: 0, mermaidErrors: 0 };
    }

    wrapTables(container);

    var replacedCount = extractMermaidBlocks(container);
    if (!replacedCount) {
      return { mermaidBlocks: 0, mermaidErrors: 0 };
    }

    var blocks = Array.from(container.querySelectorAll(".mermaid[data-mdv-source]"));
    if (!blocks.length) {
      return { mermaidBlocks: 0, mermaidErrors: 0 };
    }

    if (!ensureMermaid()) {
      for (var i = 0; i < blocks.length; i += 1) {
        renderMermaidError(blocks[i], blocks[i].textContent || "", new Error("Mermaid no está disponible."));
      }
      return { mermaidBlocks: blocks.length, mermaidErrors: blocks.length };
    }

    var errors = 0;
    for (var j = 0; j < blocks.length; j += 1) {
      var block = blocks[j];
      var source = block.textContent || "";
      var id = "mdv-mermaid-" + Date.now() + "-" + j + "-" + Math.floor(Math.random() * 10000);
      try {
        var result = await window.mermaid.render(id, source);
        block.removeAttribute("data-mdv-source");
        block.innerHTML = result.svg;
      } catch (error) {
        errors += 1;
        renderMermaidError(block, source, error);
      }
    }

    return { mermaidBlocks: blocks.length, mermaidErrors: errors };
  }

  ns.markdown = {
    render: render,
    postProcess: postProcess,
    getFeatureStatus: function () {
      ensureEngine();
      return Object.assign({}, featureStatus);
    }
  };
})();
