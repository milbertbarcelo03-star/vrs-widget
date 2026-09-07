/* ============================================================================
   VRS Interpreter — preload

   Intentionally almost empty. The dashboard is a plain web page that needs
   nothing from Node, and contextIsolation plus sandbox are on, so there is no
   bridge to expose. Keeping this file present (rather than dropping the
   preload option) leaves an obvious place to add one later if the desktop
   build ever needs something the browser cannot do — a tray icon, or holding
   focus during a call.
   ============================================================================ */

window.addEventListener('DOMContentLoaded', () => {
  // Lets the page style itself differently when running as the desktop app.
  document.documentElement.setAttribute('data-vrs-shell', 'electron');
});
