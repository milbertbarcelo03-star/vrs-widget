# PUSH-SETUP.md — Turning On Background Call Alerts

Right now, the interpreter dashboard only rings while its browser tab is open.
This guide turns on **background push alerts**, so the interpreter's device
can notify them even if the browser tab (or the whole browser) is closed.

You don't need to know how to code to follow this. Just do each step in order.
It takes about 15-20 minutes the first time. **You only have to do this once.**

Prepared by: Milbert Barcelo — milbert.barcelo@marianas.edu

---

## What you're setting up, in plain terms

- A free Cloudflare account will run a tiny bit of code (called a "Worker")
  that's allowed to send push notifications on your behalf.
- That Worker needs a secret key so only it can send the notifications. That
  key is already sitting in a file on your computer called
  `vapid-keys.local.txt` — you'll copy it into Cloudflare in Step 6.
- **Never share `vapid-keys.local.txt` or paste its "PRIVATE" key anywhere
  except the one Cloudflare step below.** Don't email it, don't put it in a
  document, don't commit it to GitHub. If it ever leaks, someone else could
  send fake push notifications pretending to be this app — email
  milbert.barcelo@marianas.edu if you're ever unsure.

---

## Step 1 — Create a free Cloudflare account

1. Go to https://dash.cloudflare.com/sign-up
2. Enter your email and a password, and verify your email when prompted.
3. You do **not** need to add a domain name or a credit card for this. Skip
   any "Add a site" prompts — just get to the main Cloudflare dashboard.

## Step 2 — Install the Cloudflare command-line tool (Wrangler)

This is the tool that uploads the Worker code to Cloudflare.

1. Open a terminal:
   - **Windows:** press the Windows key, type `PowerShell`, press Enter.
   - **Mac:** press Cmd+Space, type `Terminal`, press Enter.
2. You need Node.js installed first. If you're not sure, type `node --version`
   and press Enter — if you see a version number (like `v20.11.0`), you're
   set. If you see an error, install Node.js from https://nodejs.org (choose
   the "LTS" version) and then re-open your terminal.
3. Type this and press Enter:

   ```
   npm install -g wrangler
   ```

4. When it finishes, confirm it worked:

   ```
   wrangler --version
   ```

   You should see a version number printed.

## Step 3 — Log in to Cloudflare from your terminal

1. Type:

   ```
   wrangler login
   ```

2. A browser tab opens asking you to approve access. Click **Allow**.
3. Go back to the terminal — it should say you're logged in.

## Step 4 — Open the project's `worker` folder in your terminal

Type this, adjusting the path if your project lives somewhere else:

```
cd "C:\Users\Milbert Barcelo\Projects\vrs-widget\worker"
```

(Mac/Linux would use forward slashes instead, e.g.
`cd ~/Projects/vrs-widget/worker`.)

## Step 5 — Create the KV namespace (where subscriptions are stored)

This is just a small free key-value database Cloudflare provides.

1. Type:

   ```
   wrangler kv namespace create SUBS
   ```

2. It prints something like:

   ```
   [[kv_namespaces]]
   binding = "SUBS"
   id = "a1b2c3d4e5f6..."
   ```

3. Open `worker/wrangler.toml` in a text editor (Notepad is fine). Find these
   commented-out lines near the bottom:

   ```
   # [[kv_namespaces]]
   # binding = "SUBS"
   # id = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID"
   ```

4. Replace those three lines with the real ones Wrangler printed (remove the
   `#` at the start of each line, and use the real `id` value). Save the file.

## Step 6 — Add the secret keys

These commands ask you to paste a value, then press Enter. They do **not**
save the value anywhere in your project files — Cloudflare stores it securely
on its own servers.

1. Open `vapid-keys.local.txt` (in the main `vrs-widget` folder) in Notepad so
   you can copy from it.
2. In the terminal, type:

   ```
   wrangler secret put VAPID_PRIVATE_KEY
   ```

   When it asks for the value, paste the line after **"PRIVATE (SECRET...)"**
   from `vapid-keys.local.txt` — just the key itself, no extra text — and
   press Enter.

3. Then type:

   ```
   wrangler secret put VAPID_PUBLIC_KEY
   ```

   Paste the line after **"PUBLIC (safe to embed...)"** from the same file,
   and press Enter.

**Reminder: `vapid-keys.local.txt` must never be committed to GitHub.** It's
already listed in this project's `.gitignore` file so a normal `git add`
won't pick it up, but don't go out of your way to share it either.

## Step 7 — Deploy the Worker

1. Type:

   ```
   wrangler deploy
   ```

2. When it finishes, it prints a URL that looks like:

   ```
   https://vrs-push.YOUR-SUBDOMAIN.workers.dev
   ```

   Copy that whole URL.

## Step 8 — Tell the website about the Worker

1. Open `shared.js` (in the main `vrs-widget` folder, not the `worker`
   subfolder) in a text editor.
2. Find this line near the top:

   ```js
   var VRS_PUSH_ENDPOINT = "";
   ```

3. Paste your Worker URL between the quotes, with **no trailing slash**, e.g.:

   ```js
   var VRS_PUSH_ENDPOINT = "https://vrs-push.YOUR-SUBDOMAIN.workers.dev";
   ```

4. Save the file.

## Step 9 — Commit and push

From the main `vrs-widget` folder (not `worker`):

```
git add shared.js worker/wrangler.toml
git commit -m "Enable background push alerts"
git push
```

GitHub Pages will rebuild the site automatically — give it a minute or two.

## Step 10 — Turn it on as the interpreter

1. Open the interpreter dashboard and unlock it with the access phrase, as
   usual.
2. You'll now see a new button in the top bar: **"🔔 Enable background
   alerts."** Click it.
3. Your browser will ask permission to show notifications — click **Allow**.
4. The button changes to **"🔔 Background alerts on."** You're done — you'll
   now get a notification for incoming calls even if you close this tab.

---

## iPhone / iPad users: one extra step

iOS only delivers push notifications to websites that have been **added to
the Home Screen** — a regular Safari tab, even left open, won't receive them.

1. Open the interpreter dashboard link in **Safari** (not Chrome — iOS
   requires Safari for this step).
2. Tap the **Share** icon (the square with an arrow pointing up).
3. Tap **Add to Home Screen**, then **Add**.
4. Open the dashboard from the new icon on your Home Screen (not from
   Safari) from now on.
5. Unlock it and tap **Enable background alerts** as in Step 10 above.

This requires iOS/iPadOS 16.4 or later.

---

## Good to know

- **Free tier limits:** Cloudflare's free plan covers 100,000 Worker requests
  and generous KV reads/writes per day — far more than this pilot needs.
  There's nothing to pay for at this scale.
- **Desktop (Chrome, Edge, Firefox):** background alerts keep working even if
  you close the browser entirely, as long as the computer itself isn't in a
  deep sleep state. If the computer is fully asleep or shut down, no
  notification can arrive until it wakes up.
- **This endpoint is public** — anyone who knows the Worker URL could in
  theory trigger a notification burst. To limit abuse, `/notify` is
  rate-limited to 10 requests per minute per visitor; that's more than plenty
  for normal use and stops accidental or malicious spam.
- **If something isn't working:** double check `VRS_PUSH_ENDPOINT` in
  `shared.js` has no typo and no trailing slash, that you clicked **Allow**
  (not **Block**) on the browser's notification prompt, and that
  `wrangler deploy` finished without errors. You can re-run any step above
  safely — nothing here is destructive.

Questions or issues: milbert.barcelo@marianas.edu
