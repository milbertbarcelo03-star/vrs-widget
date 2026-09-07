# VRS Widget — Project Handoff

Everything needed to pick this project up cold, whether you are a new developer
or a new AI session. No secrets are in this file; see **Credentials** for where
they live.

---

## 1. What this is

A **Video Relay Service (VRS)** prototype. A deaf or hard-of-hearing caller
starts a video call, a sign-language interpreter joins, and a third party
(school staff, a doctor's office, emergency services) can be brought into the
same call. Inspired by Purple's P3 Mobile app.

**Customer:** Career Tech High Academy Charter School, Guam
(careertechguam.org). Built by Milbert Barcelo as a pilot to pitch to them.

**Important framing:** real VRS in the US is FCC-regulated, funded by the TRS
Fund, and only certified providers with credentialed interpreters may bill it.
This is a *technology* prototype. It must never be presented as a certified
relay service, and must never be relied on for emergencies.

---

## 2. Live URLs

| Purpose | URL |
|---|---|
| Deaf caller | https://milbertbarcelo03-star.github.io/vrs-widget/call/ |
| Interpreter dashboard | https://milbertbarcelo03-star.github.io/vrs-widget/interpreter/ |
| Customer demo page | https://milbertbarcelo03-star.github.io/vrs-widget/ |

Repo: https://github.com/milbertbarcelo03-star/vrs-widget (public, branch `master`)
Hosting: GitHub Pages, auto-deploys on push to `master`, roughly 1-2 minutes lag.

---

## 3. Architecture

Static site. **No build step, no framework, no npm.** Vanilla ES5-flavoured JS
(`var`, no arrow functions in app code), one inline `script` and one inline
`style` block per page.

```
Browser A (deaf caller)  --+
                           +-- Firebase Realtime DB   (signalling only: who is
Browser B (interpreter)  --+    calling, SDP offer/answer, ICE candidates, chat)
                           |
Browser C (third party)  --+
     |
     +---- WebRTC mesh: audio and video travel peer-to-peer and never pass
           through Firebase. STUN + TURN handle NAT traversal.
```

- **Mesh topology:** one `RTCPeerConnection` per remote peer, max 3 participants.
- **Glare avoidance:** the peer with the lexicographically smaller id creates the
  offer, so both sides never offer simultaneously.
- **Signalling path:** `rooms/{roomId}/signals/{fromId}_{toId}/{offer|answer|candidates}`

### File map

| File | Role |
|---|---|
| `index.html` | Customer demo page, styled to mimic careertechguam.org. Embeds the widget. |
| `widget.js` | The embeddable script. One script tag injects a floating call button plus a full-screen iframe modal. Themeable via `data-color` / `data-color-dark`. |
| `call.html` | Caller UI: precall and camera preview, ringing, 3-way video grid, chat, add-third-party. |
| `interpreter.html` | Interpreter dashboard: access gate, online toggle, waiting room, incoming-call overlay, in-call UI. |
| `shared.js` | Firebase config and init, anonymous auth, all signalling helpers, the WebRTC mesh manager, ICE server config. **The heart of the app.** |
| `sw.js` | Service worker for web push (payload-less push, generic notification). |
| `manifest.json` | PWA manifest for the **interpreter** app. Also required for iOS web push. |
| `manifest-call.json` | PWA manifest for the **caller** app. Separate file so the two installs get their own name, icon and start URL. |
| `worker/` | Cloudflare Worker that signs and sends web push via VAPID. **Not yet deployed.** |
| `firebase-rules.json` | Database security rules. **Source of truth, but must be pasted into the Firebase console by hand.** |
| `interpreter/`, `call/` | Redirect stubs providing clean URLs. The real files stay flat so there is no duplicated copy to drift out of sync. |
| `INSTALL.md` | Customer-facing embedding guide. |
| `SECURITY.md` | Security posture and Firebase console setup. |
| `PUSH-SETUP.md` | Cloudflare Worker deployment steps for push notifications. |

---

## 4. Current status

### Working and live
- 3-way WebRTC calling (deaf caller, interpreter, third party)
- Text chat alongside video
- Interpreter waiting room with live wait timers, oldest-first ordering, and a
  record of declined calls
- Non-blocking side toast when a new caller arrives while already on a call
- Foreground alerting: flashing tab title, repeating tone, desktop notification
- Anonymous Firebase auth plus strict database rules (both live and enforcing)
- SHA-256 access gate on the interpreter dashboard
- Design system: Outfit display font, 4px spacing scale, layered shadows

- **Installable as an app** on iPhone and Android home screens (PWA). Both
  pages register `sw.js`, which precaches the same-origin app shell so the
  installed app opens on a flaky connection. Cross-origin traffic (Firebase,
  the gstatic SDK, Google Fonts) is deliberately never intercepted.
- **Identity.** Callers give an optional first name, remembered on the device.
  Interpreters have real accounts (email/password or Google SSO) and set a
  display name and title, which the caller sees while the call connects.
- **Self-signup with admin approval.** Anyone can create an interpreter
  account, but it cannot read the call queue until an admin approves it via
  **Manage accounts**. See SECURITY.md for why open signup would otherwise be
  dangerous, and for the cascading-rules trap in `interpreters/$uid`.
- **Problem reports.** A rating and report form on both pages, built and
  injected from `shared.js` so there is one implementation and the desktop and
  home-screen apps inherit it. Readable in the dashboard under **View
  reports**, with "Copy all as JSON".
- **Windows desktop app** (`desktop/`). Electron wrapper around the deployed
  dashboard URL. See section 12.

### Built but NOT deployed
- **Web push** (`sw.js`, `manifest.json`, `worker/`). Completely inert until
  `VRS_PUSH_ENDPOINT` in `shared.js` points at a deployed Cloudflare Worker.
  Follow `PUSH-SETUP.md`. Until then the interpreter must keep the tab open.

### Identity — code complete, BLOCKED on a console step

The UI and auth logic in `call.html` and `interpreter.html` are finished:

1. The caller enters a first name (no account, remembered on the device) so the
   interpreter sees a person rather than "Room 4468".
2. Interpreters sign in with **real Firebase email/password accounts**,
   replacing the shared passphrase gate. Their name and title are shown to the
   caller. `VRS.init({ autoAnonymous: false })` on the dashboard keeps the
   anonymous sign-in from stealing the identity the queue rules check.
3. Student accounts deliberately skipped: a deaf student in distress must never
   hit a signup wall.

**It cannot work until the console steps in section 5 are done.** Verified
against the live database on 2026-09-07: Email/Password sign-in is **not
enabled** (signing in returns `auth/operation-not-allowed`), and the deployed
rules are still the old set — a queue write carrying `callerName` is rejected,
while the same write without it succeeds.

Because of that, every identity write has a fallback that retries without the
new field (`createRoom`, `pushToQueue`, and the interpreter's `updateRoom`).
A name is a nicety; placing a call is not, and an interpreter accepting a call
must never leave the caller ringing forever. **Do not remove those fallbacks
just because the rules look correct in the repo** — the repo is not what the
database enforces.

## 5. Manual steps still outstanding

**Ordering matters. Doing these out of order breaks the app.**

**All of these are DONE as of 2026-09-07** — kept here because they must be
repeated for any new Firebase project.

1. Firebase console, Build > Authentication > Sign-in method: enable
   **Email/Password**, and **Google** for SSO. (Anonymous is already enabled.)
   For Google, also add the deployed domain under Authentication > Settings >
   **Authorized domains**, or SSO fails with `auth/unauthorized-domain`.
2. Create at least one interpreter account under Authentication > Users.
3. *Only then* paste the current `firebase-rules.json` into
   Realtime Database > Rules > Publish. Publishing before steps 1 and 2 makes
   the queue unreadable and the dashboard silently stops receiving calls.
4. In Realtime Database > Data, create `admins/<your-uid>` = `true` (boolean,
   not the string "true"), and set `interpreters/<your-uid>/approved` = `true`.
   `admins` must be a **node containing uids**, not a bare boolean.
   Do this **before** publishing rules that gate on approval, or you lock
   yourself out of your own queue. The console bypasses rules, so it works
   either way round — but the app does not.
5. Optional: deploy the Cloudflare Worker per `PUSH-SETUP.md` to enable push.

Until step 3 is done, the app still works, but callers' names are silently
dropped and interpreters cannot sign in at all.

### Installing on an iPhone

iOS cannot be given a native build from Windows, and does not need one here.
Open the caller URL in **Safari** (not Chrome), then Share > **Add to Home
Screen**. `call.html` shows those steps on screen automatically on iOS, since
Safari offers no install prompt of its own and the users are deaf.

Notes that cost real debugging time if forgotten:

- It must be **Safari**. Other iOS browsers cannot install a PWA.
- The installed app has **its own storage and its own permissions**. Camera and
  microphone must be granted again inside it, and a name remembered in Safari
  does not carry over.
- Web push on iOS requires **iOS 16.4+ and the app installed to the home
  screen**. It will never work in a plain Safari tab.
- `apple-mobile-web-app-status-bar-style` is `black-translucent`, so the page
  runs under the status bar. The top safe-area inset is honoured in
  `.vrs-screen` (caller) and `.vrs-topbar` (interpreter) — removing those
  paddings puts the header under the notch.

---

## 6. Bugs already found and fixed — do not reintroduce

| Symptom | Root cause | Fix |
|---|---|---|
| Call connects and chat works, but **each side only sees themselves** | STUN-only ICE. Strict NAT on cellular carriers and school or corporate networks blocks the direct connection. | TURN relay servers added in `iceServerConfig()` in `shared.js`. |
| **No camera on the second call** | `endCall()` stopped every track but left `localStream` pointing at the dead stream, so the next call attached tracks already in the `ended` state. | Null the stream and re-acquire it via `onEnableCameraTap()`. |
| **Declining left the caller ringing forever** | The interpreter wrote `status:'declined'` to the *queue*, but the caller listens to the *room*. | Write the status to the room as well; the caller then runs `handleDeclined()`. |
| Live call **torn down mid-conversation** | The mesh pruned peers whenever the participants snapshot arrived empty, which happens transiently. | Only prune when the snapshot actually lists someone. |
| WebRTC offers silently never delivered | Signal keys have the form `{fromId}_{toId}`, but peer ids themselves contain underscores, so splitting on `_` produced garbage ids. | Read the explicit `from` and `to` fields stored on the payload instead of parsing the key. |

### Diagnosis technique that worked

When calls misbehave, **rule out the security rules first.** Mint an anonymous
`idToken` through the Identity Toolkit REST API, then replay the app's exact
write sequence against the live database with `curl`. If every write returns
200, the rules are innocent and the bug is client-side.

Then drive the caller in a real browser tab while simulating the interpreter's
side over REST. That isolates which half is broken without fighting two live
browser tabs and a camera that only one tab can hold.

---

## 7. House rules (learned the hard way on this project)

- **Before adding any `var`, `let`, or `const`, grep the file for that
  identifier.** A duplicate declaration is a SyntaxError that silently kills the
  *entire* inline script block. Nothing is defined, nothing works, and there is
  no obvious error message. This has broken this project before.
- **Never commit secrets.** The repo is public. A passphrase was once written
  into `SECURITY.md` and pushed, which defeated the gate entirely and forced a
  rotation. Anything sensitive is delivered out-of-band and gitignored.
- **Never split a composite key on a delimiter that its parts can contain.**
- iOS: pair `100dvh` with `min-height:-webkit-fill-available`, and use
  `overflow-x:hidden` on body rather than plain `overflow:hidden`.
- Passphrase and code inputs need `autocapitalize="none" autocorrect="off"
  spellcheck="false" autocomplete="off"` as a set. iOS silently transforms input
  without them, so hash comparisons never match.
- Keep top-level logic inside try/catch so an error never produces a blank screen.
- Accessibility is not optional here: the primary users are deaf. All alerts must
  be **visual**, and audio cues belong only on the interpreter side. The
  `prefers-reduced-motion` block deliberately keeps ringing animations running,
  just slower, because they carry safety-critical meaning.

---

## 8. Local development

```bash
git clone https://github.com/milbertbarcelo03-star/vrs-widget.git
cd vrs-widget
py -m http.server 8777
```

Note `py`, not `python`, on this Windows setup. Then open http://localhost:8777/.

`file://` will **not** work: browsers block camera access and service workers
outside a secure context. `localhost` counts as secure, and so does the deployed
HTTPS site.

**Testing calls requires two separate devices** (or at minimum two different
browsers). Two tabs on one machine cannot both hold the camera.

---

## 9. Known limitations

- **Room codes are 4 digits** (10,000 combinations) with a 30-minute staleness
  window. Fine for a pilot, too weak for production.
- **Anonymous auth means any visitor can obtain an identity.** It stops scripted
  abuse, not a determined person. Real accounts are the fix, and are in progress.
- **TURN servers are Open Relay's free public ones.** Acceptable for a pilot; a
  production deployment should use its own TURN (Twilio, or self-hosted coturn).
- **No PSTN dialling.** "Add third party" produces a room code and link; it
  cannot ring a real phone number. That would require Twilio or similar.
- **The interpreter tab must stay open** until web push is deployed.

---

## 10. Credentials — where they live

Nothing sensitive is stored in this repository. All of it is delivered
out-of-band:

- **Interpreter accounts:** real Firebase email/password users, created by
  hand in the Firebase console under Authentication > Users. There is no
  self-service signup and no shared phrase any more, so nothing about
  interpreter access lives in this repository. Passwords are delivered to
  interpreters out-of-band.
- **VAPID push keys:** `vapid-keys.local.txt` in the project folder, gitignored.
  The public key is embedded in `shared.js`; the private key belongs only in a
  Cloudflare Worker secret. While the Worker is undeployed, these can be
  regenerated freely because nothing depends on them.
- **Firebase config** in `shared.js` is public by design. A Firebase web config
  identifies a project; it is not a password. The database rules are what
  protect the data.

---

## 11. Roadmap

1. Deploy the Cloudflare Worker so interpreters can close the tab.
2. Confirm Google SSO works in the installed iOS home-screen app. iOS storage
   partitioning can break redirect-based sign-in there; email/password is
   unaffected, and `signInWithGoogle()` already falls back from popup to
   redirect.
3. Production hardening: dedicated TURN servers, longer room identifiers, and
   real interpreter credential verification.
4. Android build via Capacitor. Node and JDK 17 are present; the Android SDK
   is not. Buildable entirely on Windows.
5. Only if App Store presence is genuinely required, wrap with Capacitor for
   iOS. Needs a Mac and 99 USD/year. Note Apple rejects thin web wrappers
   under Guideline 4.2, so it would need real native push and camera
   integration. The PWA already covers the iPhone home-screen case for free.

---

## 12. Desktop app (`desktop/`)

Electron wrapper for the interpreter dashboard, so a shift is not run in a
browser tab that can be closed by accident.

```bash
cd desktop && npm install && npm start      # run
npx electron-builder --win --x64            # build installers into desktop/dist
```

**It loads the deployed HTTPS URL, not local files.** `getUserMedia` and
service workers both require a secure context and `file://` is not one, so
bundling the pages would kill the camera and the service worker. The useful
side effect is that a `git push` updates every installed copy — the desktop
app and the installed phone apps all track the live site, so web changes need
no rebuild. Only `main.js` changes require rebuilding the `.exe`.

Gotchas already hit:

- Electron denies camera, microphone and notifications **silently**. They are
  granted explicitly in `main.js`, for our origin only.
- The Google sign-in popup must be allowed through `setWindowOpenHandler`, and
  the auth origins excluded from the `will-navigate` guard, or sign-in escapes
  to the system browser and never returns.
- `npm install` may leave `node_modules/electron/dist` empty even though the
  zip downloaded. Extract the cached zip manually and write `path.txt`
  containing `electron.exe`.
- The build is unsigned, so SmartScreen warns on first run. A code-signing
  certificate is roughly 200-400 USD/year.
