# Security Setup — do these two things in the Firebase console

The code is already hardened, but two settings must be switched on in the
Firebase console for the protection to take effect. **Do them in this order.**

---

## Step 1 — Enable Anonymous Authentication (do this FIRST)

The security rules reject anyone who isn't signed in. The app signs every
visitor in silently (no login screen, no user action), but the provider has to
be switched on first.

1. Open <https://console.firebase.google.com/> and select the **vrs-widget** project.
2. Left sidebar: **Build** → **Authentication**.
3. Click **Get started** if you haven't used Authentication before.
4. Open the **Sign-in method** tab.
5. In the provider list, click **Anonymous**.
6. Flip the **Enable** toggle on, then click **Save**.

> If you skip this step and apply the rules in Step 2 anyway, every call will
> fail with a permission error. The browser console will say exactly that.

## Step 2 — Replace the test-mode database rules

Test mode allows **anyone on the internet** to read and write the entire
database, and it expires ~30 days after creation. Replace it:

1. Left sidebar: **Build** → **Realtime Database**.
2. Open the **Rules** tab.
3. Select everything in the editor and delete it.
4. Open `firebase-rules.json` from this project, copy its **entire** contents,
   and paste them in.
5. Click **Publish**.

Then reload the app and place a test call to confirm everything still connects.

---

## What the rules actually enforce

- **No unauthenticated access at all.** Every read and write requires a signed-in
  identity, which blocks scripted access from outside the app.
- **The database cannot be dumped.** Reads are only permitted on individual
  rooms and on the call queue — never at the root — so nobody can pull the whole
  database in one request.
- **Every field is validated.** Unknown fields are rejected outright, strings are
  length-capped (chat messages max 2,000 characters), and numbers must be
  numbers. The database can't be used as free file storage.
- **Room history can't be rewritten.** `createdAt` is immutable once set.
- **Room IDs must be exactly 4 digits**, so no arbitrary paths can be created.

## What the interpreter gate protects

`interpreter.html` is behind an access phrase, because whoever opens that
dashboard receives live calls from deaf callers. Without it, anyone with the
link could intercept those calls.

- **Current access phrase: `ctech-vrs-2026`**
- Only the SHA-256 hash is stored in the code — the phrase itself never appears.
- Three wrong attempts triggers a 60-second lockout.
- Unlocking lasts for the browser session; closing the tab re-locks it.

**To change the phrase**, compute a new hash and replace `VRS_GATE_HASH` in
`interpreter.html`. The phrase is lowercased and trimmed before hashing, so the
hash must be computed the same way:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('YOUR-NEW-PHRASE'.trim().toLowerCase()).digest('hex'))"
```

## Other protections already in place

- **Subresource Integrity** on all Firebase CDN scripts — if those files were
  ever altered in transit, the browser refuses to run them.
- **`noindex` + `robots.txt`** on the demo page so it can never be indexed or
  mistaken for the school's official website.
- **The site files themselves cannot be tampered with** by outsiders: GitHub
  Pages serves only what's committed to the repository, and only your GitHub
  account can push to it.

## Recommended: protect the GitHub account

The site content is exactly as safe as the account that can push to it.

1. Turn on two-factor authentication: <https://github.com/settings/security>
2. Review who has write access under the repo's **Settings → Collaborators**.

## Known limitations (still true after hardening)

- **Anonymous auth means any visitor can obtain an identity.** It stops scripted
  and drive-by abuse of the database, not a determined person who loads the page.
  Real per-user accounts would be the next step for production.
- **4-digit room codes** are guessable by brute force. Rooms go stale after 30
  minutes, which limits the window, but a production build should use longer,
  random room identifiers.
- **The Firebase config is public** in `shared.js`. This is normal and expected
  for Firebase web apps — the config identifies the project, it isn't a password.
  The security rules are what protect the data, which is why Step 2 matters.
- **No TURN server**, so some strict firewalls and carriers can still block the
  video connection.
