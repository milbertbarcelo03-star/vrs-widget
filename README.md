# VRS Widget (Prototype)

An embeddable **"Call with a sign language interpreter"** button for any website.
One `<script>` tag adds a floating call button that opens a full-screen video
call with real 3-way WebRTC: **Deaf caller ↔ Interpreter ↔ Third party**
(e.g. police, fire department, a doctor's office).

This is a **working technology prototype**, not a certified VRS service. Real
VRS in the US is an FCC-regulated program funded by the Telecommunications
Relay Services (TRS) Fund, and only FCC-certified providers with live,
trained interpreters can offer it. This project demonstrates the *calling
technology* — anyone who opens `interpreter.html` in testing is just acting
as the interpreter role, not a certified provider.

## What's in this folder

| File | Purpose |
|---|---|
| `index.html` | Demo page styled after Career Tech High Academy (careertechguam.org) with the widget embedded — clearly labeled as a demo mock-up |
| `INSTALL.md` | Step-by-step embedding instructions for a customer's web team |
| `widget.js` | The embeddable script — floating button + full-screen iframe modal |
| `call.html` | The call app: role/pre-call screen, camera preview, ringing, 3-way video grid, chat, add-third-party (dial-pad-styled) screen |
| `interpreter.html` | Interpreter dashboard: online/offline toggle, flashing incoming-call alert, Accept/Decline, joins the call in the same page |
| `shared.js` | Firebase config + init, and all shared signaling/room/WebRTC-mesh helper functions used by `call.html` and `interpreter.html` |
| `README.md` | This file |

## How to embed it on a website

Add this one line near the end of the page's HTML (before `</body>` is fine):

```html
<script src="https://YOUR-DOMAIN-OR-PATH/vrs-widget/widget.js"></script>
```

That's it. `widget.js` figures out its own location automatically (it does
**not** depend on the host page's URL), finds `call.html` sitting next to it,
injects a floating call button, and opens the call UI in a full-screen
iframe (with camera/microphone permission delegated via `allow="camera;
microphone"`) when clicked. `index.html` in this folder shows a full working
example.

The button colors can be themed per site with optional attributes (defaults
are Career Tech navy):

```html
<script src=".../widget.js" data-color="#14315f" data-color-dark="#0e2447"></script>
```

**Requirement:** `widget.js`, `call.html`, and `shared.js` must all stay in
the same folder together (wherever you host them), because `widget.js`
loads `call.html` relative to its own script URL.

## Firebase setup (Milbert — do this once)

The widget uses a free Firebase Realtime Database purely to pass along
"who's calling / offer / answer / network candidates / chat text" between
browsers. No video or audio ever passes through Firebase — that travels
directly device-to-device over WebRTC.

1. Go to **https://console.firebase.google.com/** and sign in with your
   Google account.
2. Click **"Add project"** (or **"Create a project"**).
   - Enter a project name, e.g. `vrs-widget-prototype`.
   - Click **Continue**.
   - Google Analytics toggle: you can turn it **off** — not needed here.
   - Click **Create project**, then **Continue** once it finishes.
3. In the left sidebar, click **Build** to expand it, then click
   **Realtime Database**.
4. Click **Create Database**.
   - Pick a location closest to you (e.g. `us-central1` or the default
     shown).
   - Choose **Start in test mode** (this allows read/write for 30 days —
     fine for a prototype; see "Known limitations" below about locking it
     down later).
   - Click **Enable**.
5. Click the **gear icon** next to "Project Overview" in the top-left,
   then click **Project settings**.
6. Scroll down to the **"Your apps"** section. Click the **`</>`** (web)
   icon to register a new web app.
   - Give it a nickname, e.g. `vrs-widget`.
   - Leave "Also set up Firebase Hosting" **unchecked** — this project
     doesn't use it.
   - Click **Register app**.
7. Firebase now shows a code block containing a `firebaseConfig` object
   that looks like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "vrs-widget-prototype.firebaseapp.com",
     databaseURL: "https://vrs-widget-prototype-default-rtdb.firebaseio.com",
     projectId: "vrs-widget-prototype",
     storageBucket: "vrs-widget-prototype.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef123456"
   };
   ```
   Copy this whole object.
8. Open `shared.js` in this folder. Near the top you'll see:
   ```js
   var VRS_FIREBASE_CONFIG = {
     apiKey: "PASTE_YOUR_API_KEY_HERE",
     ...
   };
   ```
   Replace the whole `VRS_FIREBASE_CONFIG` object's values with the ones
   Firebase gave you in step 7. Save the file.
9. Click **Continue to console** in the Firebase setup wizard (you don't
   need the SDK install/npm steps it shows — this project loads Firebase
   directly via `<script>` tags from Google's CDN).
10. Reload `index.html` (or `call.html` / `interpreter.html`). The yellow
    "Firebase isn't configured yet" banner should be gone. If it's still
    showing, double check you saved `shared.js` and that none of the
    values still say `PASTE_YOUR_...`.

That's the whole setup — no billing account is required for the Realtime
Database's free (Spark) tier at prototype scale.

## Testing locally with two tabs

You don't need to deploy anywhere to test the signaling and 3-way call
logic:

1. Serve this folder over a local web server (opening the files directly
   with `file://` will NOT work — browsers block `getUserMedia` and
   sometimes ES features on `file://`). Any simple static server works,
   for example from this folder:
   ```
   npx serve .
   ```
   or
   ```
   python -m http.server 8080
   ```
2. **Tab A (deaf caller):** open `http://localhost:PORT/index.html`, click
   the floating call button, tap **Enable Camera & Microphone**, then
   **Call Interpreter Now**. You'll see the flashing "Calling
   interpreter…" screen.
3. **Tab B (interpreter):** open `http://localhost:PORT/interpreter.html`,
   flip the **Offline/Online** switch to Online. Within a second or two
   the incoming-call screen should flash and show **Accept / Decline**.
   Click **Accept**.
4. Both tabs should now show a 2-way video grid (if this computer has a
   camera, you'll see real video in both directions — including the odd
   effect of seeing yourself in tab A's other-tile if you only have one
   camera and both tabs use it; that's expected on a single machine with
   one camera, since only one tab can hold the camera at a time — the
   other tab will show the graceful "camera off" state instead, and chat
   still works both ways).
5. Try the **Chat** panel — type a message in one tab, confirm it appears
   in the other.
6. In either tab's call screen, click **Add Party**. Copy the generated
   link (or note the 4-digit code) and open it in a **third tab** — the
   link looks like `call.html?room=1234&role=third`. Confirm the third
   tab joins and all three tiles appear in the grid.
7. Click **End** (deaf tab) or **Leave** (interpreter/third tabs) to hang
   up and confirm the call cleans up.

If this computer has no camera (or you deny the permission prompt), you
should see a clear "camera/microphone unavailable" message with a retry
button rather than a blank screen — text chat and the rest of the
signaling flow should still work.

## Known limitations (read before demoing)

- **No TURN server.** Only Google's free STUN servers are configured. STUN
  is enough for most home/office networks, but some strict corporate
  firewalls, some cellular carriers, and some VPNs will block the direct
  peer connection entirely, and the call will fail to connect video (chat
  signaling will still work). A production version would add a TURN relay
  (e.g. Twilio's, or a self-hosted coturn) for reliability.
- **No real PSTN dialing.** The "Add third party" screen is styled like a
  dial pad but only produces a room code + shareable link — it cannot
  actually ring a real phone number. Real telephone dial-out (like
  Purple's P3 product) would require a paid service such as Twilio.
- **This is a prototype, not FCC-certified VRS.** It cannot be billed to
  the TRS Fund, and nothing here verifies that a person using
  `interpreter.html` is a qualified, certified interpreter. Do not use
  this for real emergencies — for real emergencies always call 911
  directly (or your local equivalent) through an already-certified
  relay method.
- **Test-mode Firebase rules expire after 30 days** and allow open
  read/write to the whole database in the meantime. That's fine for
  prototyping but should be replaced with real Realtime Database security
  rules before any wider or longer-lived use.
- **Room codes are only 4 digits** (10,000 combinations) with a best-effort
  collision check and a 30-minute staleness expiry — fine for a live demo,
  not meant for high call volume.
- **No accounts/authentication.** Anyone with the interpreter.html link can
  go "online" as an interpreter; anyone with a room link/code can join a
  call. Fine for a controlled demo, not for production.
