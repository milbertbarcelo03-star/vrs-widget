/* ============================================================================
   VRS Interpreter — Electron main process

   Wraps the interpreter dashboard in a desktop window so it stops being a
   browser tab that someone can close by accident mid-shift.

   Why this loads the DEPLOYED URL instead of the local HTML files:

     getUserMedia() and service workers both require a secure context. The
     file:// protocol is not one, so bundling the pages and loading them off
     disk would kill the camera and the service worker — the two things this
     app exists for. Pointing at the HTTPS site keeps the secure context and
     has the useful side effect that a `git push` updates every installed
     desktop app, with no reinstall.

   The trade-off is that this app needs a network connection, which is fine:
   a video relay call is useless offline anyway.
   ============================================================================ */

const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');

const APP_URL = 'https://milbertbarcelo03-star.github.io/vrs-widget/app.html';
const APP_ORIGIN = 'https://milbertbarcelo03-star.github.io';

// Google SSO opens a popup on Firebase's auth domain, which then hands off to
// Google's own sign-in pages. Without these the popup handler below would send
// sign-in out to the system browser, where it completes in a session this app
// never sees - the user would click through and land back on the login form.
const AUTH_ORIGINS = [
  'https://vrs-widget.firebaseapp.com',
  'https://accounts.google.com'
];

let mainWindow = null;

function isTrustedUrl(targetUrl) {
  try {
    return new URL(targetUrl).origin === APP_ORIGIN;
  } catch (err) {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0a1220', // matches --vrs-bg so there is no white flash
    title: 'VRS Interpreter',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadURL(APP_URL);

  // External links (help pages, a third party's room link) belong in the real
  // browser, not in a chrome-less window the user cannot navigate back out of.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    let origin = '';
    try { origin = new URL(url).origin; } catch (err) { /* treat as external */ }

    // Let the sign-in popup open as a real child window.
    if (AUTH_ORIGINS.includes(origin)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
        }
      };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Keep this window pinned to the dashboard. Without this, one stray link
  // could strand an interpreter on an unrelated page with no address bar and
  // no way back.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let origin = '';
    try { origin = new URL(url).origin; } catch (err) { /* not navigable */ }
    // A redirect-mode sign-in navigates the main window through these origins
    // and back, so they must not be treated as "leaving the app".
    if (AUTH_ORIGINS.includes(origin)) return;
    if (!isTrustedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Electron denies camera, microphone and notifications by default, and does
  // it silently — the dashboard would just never see a camera. Grant them for
  // our own origin only, so a hijacked page could not inherit them.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'notifications', 'clipboard-sanitized-write'];
    callback(isTrustedUrl(webContents.getURL()) && allowed.includes(permission));
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const allowed = ['media', 'notifications'];
    return requestingOrigin === APP_ORIGIN && allowed.includes(permission);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Windows and Linux expect the app to exit with its last window.
  if (process.platform !== 'darwin') app.quit();
});
