# VRS Widget — Installation Guide for Your Website

This package adds a **"Call with a sign language interpreter"** button to your
website. Visitors who are deaf or hard of hearing can click it to start a
video call with a sign language interpreter, and a third party (school staff,
a doctor's office, emergency services) can be brought into the same call.

Prepared by: Milbert Barcelo — milbert.barcelo@marianas.edu

---

## What's in this package

| File | Required on your server? | Purpose |
|---|---|---|
| `widget.js` | Yes | The embed script — injects the floating call button |
| `call.html` | Yes | The video call screen the button opens |
| `interpreter.html` | Yes | Dashboard the interpreter keeps open to receive calls |
| `shared.js` | Yes | Shared connection code + configuration |
| `INSTALL.md` | No | This guide |

**The four files must sit in the same folder together** on your web server —
`widget.js` finds the others relative to its own location.

---

## Option A — Quickest: embed from our hosted copy (no files to upload)

Add this single line to any page, just before the closing `</body>` tag:

```html
<script src="https://milbertbarcelo03-star.github.io/vrs-widget/widget.js"></script>
```

The button appears in the bottom-right corner of that page. Done.

## Option B — Self-hosted: upload the files to your own server

1. Create a folder on your web server, e.g. `/vrs-widget/`.
2. Upload `widget.js`, `call.html`, `interpreter.html`, and `shared.js` into it.
3. Add this line to any page you want the button on, before `</body>`:

```html
<script src="/vrs-widget/widget.js"></script>
```

**Requirement: your site must be served over HTTPS.** Browsers only allow
camera/microphone access on secure pages (plain `http://` will not work,
except `localhost` for testing).

---

## Matching your site's colors

The button ships in Career Tech navy. To change it, add color attributes:

```html
<script src="/vrs-widget/widget.js"
        data-color="#14315f"
        data-color-dark="#0e2447"></script>
```

`data-color` is the main button color; `data-color-dark` is the gradient's
darker edge (use a darker shade of the same color).

---

## The interpreter side

Calls ring to whoever has the **interpreter dashboard** open:

- Hosted copy: `https://milbertbarcelo03-star.github.io/vrs-widget/interpreter.html`
- Self-hosted: `https://YOUR-SITE/vrs-widget/interpreter.html`

The interpreter opens that page, switches the toggle to **Online**, and keeps
the tab open. Incoming calls flash on screen with Accept/Decline. If no
interpreter is online, callers see a "waiting for an interpreter" screen until
one accepts or they cancel.

---

## Important notes for this pilot phase

- **Signaling service:** call setup messages route through a Firebase
  Realtime Database currently provisioned by Milbert for this pilot (video
  and audio never pass through it — media travels directly between the
  callers). For a production rollout, this should move to a database under
  your organization's own account; contact Milbert to coordinate.
- **Not a certified VRS service.** This is a technology pilot. Real VRS in
  the US is FCC-regulated and provided by certified providers with trained,
  certified interpreters. This widget does not verify interpreter
  credentials and **must not be relied on for emergencies — for emergencies,
  call 911 through an established relay method.** A visible notice to that
  effect is recommended wherever the widget is deployed.
- **Network reliability:** the pilot uses free STUN servers only. Most home,
  school, and office networks work fine, but some strict corporate firewalls,
  VPNs, and cellular carriers can block the direct video connection. A
  production version would add a TURN relay server for full reliability.
- **No accounts yet:** anyone with the interpreter dashboard link can go
  online as the interpreter, and anyone with a room link can join that call.
  Keep the dashboard link internal during the pilot.

---

## Quick test after installing

1. Open a page with the button on a laptop **(Chrome or Edge recommended)**,
   click the button, allow camera/microphone, click **Call Interpreter Now**.
2. On a second device (or second browser window), open `interpreter.html`,
   toggle **Online**, and **Accept** the flashing incoming call.
3. You should see live two-way video. Click **Add Party** in the call to get
   a link that brings a third participant in.

Questions or issues: milbert.barcelo@marianas.edu
