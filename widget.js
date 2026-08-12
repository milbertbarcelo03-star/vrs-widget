/* ============================================================================
   VRS Widget — widget.js
   Embeddable "Call with a sign language interpreter" button.

   Usage (on ANY host page):
     <script src="https://YOUR-HOST/vrs-widget/widget.js"></script>

   This script:
     1. Figures out its own URL (via document.currentScript) so it can find
        call.html sitting next to it, regardless of what page it's embedded on.
     2. Injects a floating call button (bottom-right); colors themeable via
        data-color / data-color-dark attributes on the script tag.
     3. On click, opens a full-screen iframe modal loading call.html with
        camera/microphone permission delegated.
   ============================================================================ */

(function () {
  "use strict";

  try {
    // Capture document.currentScript IMMEDIATELY — it's only valid
    // synchronously while this script is first executing, not later inside
    // callbacks/timeouts. This is how we resolve call.html relative to
    // widget.js's own location instead of the host page's location.
    var VRS_WIDGET_SCRIPT_EL = document.currentScript;

    var VRS_WIDGET_BASE_URL = (function () {
      try {
        if (VRS_WIDGET_SCRIPT_EL && VRS_WIDGET_SCRIPT_EL.src) {
          return new URL(".", VRS_WIDGET_SCRIPT_EL.src).href;
        }
      } catch (err) {
        console.error("VRS widget: could not resolve script src", err);
      }
      // Fallback: try to find a <script> tag that looks like this file.
      var scripts = document.getElementsByTagName("script");
      for (var i = 0; i < scripts.length; i++) {
        var s = scripts[i];
        if (s.src && s.src.indexOf("widget.js") !== -1) {
          return new URL(".", s.src).href;
        }
      }
      // Last resort: same directory as the host page (may be wrong).
      return new URL(".", window.location.href).href;
    })();

    var VRS_CALL_URL = VRS_WIDGET_BASE_URL + "call.html";

    // Button colors — themeable per host site via attributes on the script tag:
    //   <script src=".../widget.js" data-color="#14315f" data-color-dark="#0e2447"></script>
    // Defaults match the Career Tech navy.
    var VRS_BTN_COLOR =
      (VRS_WIDGET_SCRIPT_EL && VRS_WIDGET_SCRIPT_EL.getAttribute("data-color")) || "#14315f";
    var VRS_BTN_COLOR_DARK =
      (VRS_WIDGET_SCRIPT_EL && VRS_WIDGET_SCRIPT_EL.getAttribute("data-color-dark")) || "#0e2447";

    function injectStyles() {
      if (document.getElementById("vrs-widget-styles")) return;
      var style = document.createElement("style");
      style.id = "vrs-widget-styles";
      style.textContent =
        "#vrs-widget-btn{" +
        "position:fixed;bottom:24px;right:24px;z-index:2147483000;" +
        "display:flex;align-items:center;gap:10px;" +
        "background:linear-gradient(135deg," + VRS_BTN_COLOR + "," + VRS_BTN_COLOR_DARK + ");color:#fff;" +
        "border:none;border-radius:999px;padding:16px 22px;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;" +
        "font-size:16px;font-weight:600;cursor:pointer;" +
        "box-shadow:0 6px 24px rgba(0,0,0,0.35);" +
        "transition:transform .15s ease, box-shadow .15s ease;" +
        "-webkit-tap-highlight-color:transparent;" +
        "}" +
        "#vrs-widget-btn:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(0,0,0,0.45);}" +
        "#vrs-widget-btn:active{transform:translateY(0);}" +
        "#vrs-widget-btn .vrs-icon{font-size:20px;line-height:1;}" +
        "@media (max-width:480px){" +
        "#vrs-widget-btn{right:16px;bottom:16px;padding:14px 18px;font-size:15px;}" +
        "#vrs-widget-btn .vrs-label{display:none;}" +
        "}" +
        "#vrs-widget-overlay{" +
        "position:fixed;inset:0;z-index:2147483647;background:#0a1220;" +
        "display:none;" +
        "}" +
        "#vrs-widget-overlay.vrs-open{display:block;}" +
        "#vrs-widget-overlay iframe{" +
        "width:100%;height:100%;border:0;display:block;" +
        "}" +
        "#vrs-widget-close{" +
        "position:fixed;top:max(12px, env(safe-area-inset-top));right:max(12px, env(safe-area-inset-right));" +
        "z-index:2147483647;" +
        "width:44px;height:44px;border-radius:50%;border:none;" +
        "background:rgba(0,0,0,0.55);color:#fff;font-size:22px;line-height:1;" +
        "cursor:pointer;display:flex;align-items:center;justify-content:center;" +
        "}" +
        "#vrs-widget-close:hover{background:rgba(0,0,0,0.75);}";
      document.head.appendChild(style);
    }

    function buildButton() {
      var btn = document.createElement("button");
      btn.id = "vrs-widget-btn";
      btn.type = "button";
      btn.setAttribute("aria-label", "Call with a sign language interpreter");
      btn.innerHTML =
        '<span class="vrs-icon" aria-hidden="true">🤟</span>' +
        '<span class="vrs-label">Call with a sign language interpreter</span>';
      return btn;
    }

    function buildOverlay() {
      var overlay = document.createElement("div");
      overlay.id = "vrs-widget-overlay";

      var closeBtn = document.createElement("button");
      closeBtn.id = "vrs-widget-close";
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", "Close call window");
      closeBtn.innerHTML = "&times;";
      closeBtn.style.display = "none";

      overlay.appendChild(closeBtn);

      return { overlay: overlay, closeBtn: closeBtn };
    }

    function openModal(overlay, closeBtn) {
      // Build the iframe fresh each time so a fully-ended call always starts
      // from a clean slate on the next open (no stale camera streams, etc).
      var existingIframe = overlay.querySelector("iframe");
      if (existingIframe) existingIframe.remove();

      var iframe = document.createElement("iframe");
      iframe.src = VRS_CALL_URL + "?role=deaf";
      iframe.setAttribute("allow", "camera; microphone; autoplay; clipboard-write");
      iframe.setAttribute("allowfullscreen", "true");
      iframe.title = "Sign language interpreter video call";
      overlay.appendChild(iframe);

      overlay.classList.add("vrs-open");
      closeBtn.style.display = "flex";
      document.body.style.overflowX = "hidden";
      document.documentElement.style.overflow = "hidden";
    }

    function closeModal(overlay, closeBtn) {
      overlay.classList.remove("vrs-open");
      closeBtn.style.display = "none";
      document.documentElement.style.overflow = "";
      // Tear down the iframe so camera/mic are released immediately.
      var existingIframe = overlay.querySelector("iframe");
      if (existingIframe) existingIframe.remove();
    }

    function init() {
      injectStyles();

      var btn = buildButton();
      var built = buildOverlay();
      var overlay = built.overlay;
      var closeBtn = built.closeBtn;

      document.body.appendChild(overlay);
      document.body.appendChild(btn);

      btn.addEventListener("click", function () {
        openModal(overlay, closeBtn);
      });

      closeBtn.addEventListener("click", function () {
        closeModal(overlay, closeBtn);
      });

      // Allow call.html (inside the iframe) to ask the parent to close the
      // modal, e.g. when the user taps "End call" / "Leave".
      window.addEventListener("message", function (evt) {
        try {
          if (evt && evt.data && evt.data.vrsWidgetAction === "close") {
            closeModal(overlay, closeBtn);
          }
        } catch (err) {
          console.error("VRS widget: message handler error", err);
        }
      });

      // Escape key closes the modal too (desktop convenience).
      document.addEventListener("keydown", function (evt) {
        if (evt.key === "Escape" && overlay.classList.contains("vrs-open")) {
          closeModal(overlay, closeBtn);
        }
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  } catch (err) {
    // Never let a widget failure break the host page.
    console.error("VRS widget failed to initialize:", err);
  }
})();
