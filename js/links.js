(function () {
  "use strict";

  var ns = window.MDViewer = window.MDViewer || {};

  function noop() {}

  function notify(ctx, kind, message) {
    if (ctx && typeof ctx.notify === "function") {
      ctx.notify(kind, message);
    }
  }

  function isSkippableLocalSource(value) {
    if (!value) {
      return true;
    }
    var lower = value.trim().toLowerCase();
    return !lower ||
      lower.startsWith("#") ||
      lower.startsWith("data:") ||
      lower.startsWith("blob:") ||
      lower.startsWith("http:") ||
      lower.startsWith("https:") ||
      lower.startsWith("//");
  }

  async function setLocalImageSource(img, ctx, revokeList, activeRef) {
    var rawSrc = img.getAttribute("src") || "";
    if (isSkippableLocalSource(rawSrc)) {
      return;
    }

    var fs = ns.fs;
    var parsed = fs.splitHref(rawSrc);
    var resolved = fs.resolveRelativePath(ctx.currentDocPath, parsed.pathPart || "");
    if (!resolved) {
      img.classList.add("image-broken");
      img.setAttribute("title", "Ruta fuera de la carpeta raíz");
      return;
    }

    if (!fs.exists(ctx.rootContext, resolved)) {
      img.classList.add("image-broken");
      img.setAttribute("title", "Imagen no encontrada: " + resolved);
      return;
    }

    try {
      var file = await fs.getFile(ctx.rootContext, resolved);
      if (!activeRef.active) {
        return;
      }
      var objectUrl = URL.createObjectURL(file);
      revokeList.push(objectUrl);
      img.src = objectUrl;
      img.classList.remove("image-broken");
      img.removeAttribute("title");
    } catch (error) {
      img.classList.add("image-broken");
      img.setAttribute("title", "No se pudo cargar la imagen");
    }
  }

  function decorateAnchors(container) {
    var anchors = container.querySelectorAll("a[href]");
    for (var i = 0; i < anchors.length; i += 1) {
      var anchor = anchors[i];
      var href = (anchor.getAttribute("href") || "").trim();
      if (!href) {
        continue;
      }
      if (ns.fs.isExternalHref(href) || href.startsWith("//")) {
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
      }
    }
  }

  async function openBlobInNewTab(file, ctx) {
    var url = URL.createObjectURL(file);
    var opened = window.open(url, "_blank", "noopener");
    if (!opened) {
      notify(ctx, "warn", "El navegador bloqueó la apertura de la pestaña.");
    }
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 5 * 60 * 1000);
  }

  async function handleLocalLinkClick(href, ctx) {
    var fs = ns.fs;
    var parsed = fs.splitHref(href);
    var targetPath = fs.resolveRelativePath(ctx.currentDocPath, parsed.pathPart || "");

    if (!targetPath) {
      notify(ctx, "warn", "Ruta fuera de la carpeta raíz.");
      return;
    }
    if (!fs.exists(ctx.rootContext, targetPath)) {
      notify(ctx, "warn", "Archivo no encontrado: " + targetPath);
      return;
    }

    if (fs.isMarkdownPath(targetPath)) {
      await ctx.openMarkdown(targetPath, { anchor: parsed.hash || null });
      return;
    }

    var file = await fs.getFile(ctx.rootContext, targetPath);
    await openBlobInNewTab(file, ctx);
  }

  async function bind(container, ctx) {
    if (!container || !ctx || !ctx.rootContext) {
      return noop;
    }

    var revokeList = [];
    var activeRef = { active: true };

    decorateAnchors(container);

    var onClick = function (event) {
      var anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
      if (!anchor || !container.contains(anchor)) {
        return;
      }

      var href = (anchor.getAttribute("href") || "").trim();
      if (!href) {
        return;
      }

      if (href.startsWith("#")) {
        return;
      }
      if (/^(mailto:|tel:)/i.test(href)) {
        return;
      }
      if (/^javascript:/i.test(href)) {
        event.preventDefault();
        notify(ctx, "warn", "Enlace bloqueado por seguridad.");
        return;
      }
      if (ns.fs.isExternalHref(href) || href.startsWith("//")) {
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        return;
      }

      event.preventDefault();
      handleLocalLinkClick(href, ctx).catch(function () {
        notify(ctx, "error", "No se pudo abrir el enlace local.");
      });
    };

    container.addEventListener("click", onClick);

    var images = Array.from(container.querySelectorAll("img[src]"));
    for (var i = 0; i < images.length; i += 1) {
      await setLocalImageSource(images[i], ctx, revokeList, activeRef);
    }

    return function cleanup() {
      activeRef.active = false;
      container.removeEventListener("click", onClick);
      for (var i = 0; i < revokeList.length; i += 1) {
        try {
          URL.revokeObjectURL(revokeList[i]);
        } catch (error) {
          // Ignore revoke failures.
        }
      }
      revokeList.length = 0;
    };
  }

  ns.links = {
    bind: bind
  };
})();
