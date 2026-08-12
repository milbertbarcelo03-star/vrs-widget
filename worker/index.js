/* ============================================================================
   VRS Widget — Cloudflare Worker (worker/index.js)

   Holds the VAPID private key (as a Worker secret, never in this file) and
   sends payload-less Web Push notifications to subscribed interpreters when
   a deaf caller starts a call. Static GitHub Pages cannot sign push requests
   itself, which is why this exists as a separate free service.

   Routes:
     OPTIONS *          -> CORS preflight
     POST /subscribe     -> store a push subscription in KV
     POST /unsubscribe   -> remove a push subscription from KV
     POST /notify         -> push every subscribed interpreter (rate limited)

   Subscriptions are stored in the SUBS KV namespace, keyed by the SHA-256 hex
   digest of the subscription's endpoint URL (never the raw endpoint, to keep
   key names short and non-guessable-by-inspection).

   See PUSH-SETUP.md for click-by-click deployment steps.
   ============================================================================ */

const ALLOWED_ORIGIN = "https://milbertbarcelo03-star.github.io";
const VAPID_SUBJECT = "mailto:milbert.barcelo@marianas.edu";
const RATE_LIMIT_MAX_PER_MINUTE = 10;

export default {
  async fetch(request, env) {
    try {
      const origin = request.headers.get("Origin") || "";
      const cors = origin === ALLOWED_ORIGIN ? corsHeaders() : null;

      if (request.method === "OPTIONS") {
        if (!cors) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: cors });
      }

      if (!cors) {
        return new Response("Forbidden origin", { status: 403 });
      }

      const url = new URL(request.url);

      if (request.method === "POST" && url.pathname === "/subscribe") {
        return await handleSubscribe(request, env, cors);
      }
      if (request.method === "POST" && url.pathname === "/unsubscribe") {
        return await handleUnsubscribe(request, env, cors);
      }
      if (request.method === "POST" && url.pathname === "/notify") {
        return await handleNotify(request, env, cors);
      }

      return new Response("Not found", { status: 404, headers: cors });
    } catch (err) {
      console.error("VRS worker: unhandled error", err);
      return new Response("Internal error", { status: 500 });
    }
  }
};

// ---- CORS ------------------------------------------------------------------

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function jsonHeaders(cors) {
  return Object.assign({ "Content-Type": "application/json" }, cors);
}

// ---- /subscribe & /unsubscribe ---------------------------------------------

async function handleSubscribe(request, env, cors) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response("Invalid JSON body", { status: 400, headers: cors });
  }
  if (!body || typeof body.endpoint !== "string" || body.endpoint.indexOf("https://") !== 0) {
    return new Response("Subscription is missing a valid https endpoint", { status: 400, headers: cors });
  }
  try {
    const key = await sha256Hex(body.endpoint);
    await env.SUBS.put(key, JSON.stringify(body));
    return new Response(null, { status: 204, headers: cors });
  } catch (err) {
    console.error("VRS worker: /subscribe failed", err);
    return new Response("Could not store subscription", { status: 500, headers: cors });
  }
}

async function handleUnsubscribe(request, env, cors) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response("Invalid JSON body", { status: 400, headers: cors });
  }
  if (!body || typeof body.endpoint !== "string") {
    return new Response("Missing endpoint", { status: 400, headers: cors });
  }
  try {
    const key = await sha256Hex(body.endpoint);
    await env.SUBS.delete(key);
    return new Response(null, { status: 204, headers: cors });
  } catch (err) {
    console.error("VRS worker: /unsubscribe failed", err);
    return new Response("Could not remove subscription", { status: 500, headers: cors });
  }
}

// ---- /notify -----------------------------------------------------------------

async function handleNotify(request, env, cors) {
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const withinLimit = await checkRateLimit(env, clientIp);
  if (!withinLimit) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again in a minute." }), {
      status: 429,
      headers: jsonHeaders(cors)
    });
  }

  // roomId is accepted for future logging/diagnostics but the push itself is
  // payload-less by design, so a malformed/missing body is not fatal here.
  try {
    await request.json();
  } catch (err) {
    /* ignore — roomId is informational only */
  }

  let privateKey;
  try {
    privateKey = await importVapidPrivateKey(env);
  } catch (err) {
    console.error("VRS worker: VAPID key import failed — is VAPID_PRIVATE_KEY/VAPID_PUBLIC_KEY set?", err);
    return new Response(JSON.stringify({ error: "Push is not configured on the server yet." }), {
      status: 500,
      headers: jsonHeaders(cors)
    });
  }

  const subscriptions = await listAllSubscriptions(env);
  let sent = 0;
  let removed = 0;

  await Promise.all(
    subscriptions.map(async function (entry) {
      try {
        const subscription = JSON.parse(entry.value);
        const response = await sendWebPush(subscription, privateKey, env);
        if (response.status === 404 || response.status === 410) {
          await env.SUBS.delete(entry.key);
          removed++;
        } else if (response.status >= 200 && response.status < 300) {
          sent++;
        } else {
          console.error("VRS worker: push send returned", response.status, "for", entry.key);
        }
      } catch (err) {
        console.error("VRS worker: push send failed for", entry.key, err);
      }
    })
  );

  return new Response(JSON.stringify({ sent: sent, removed: removed }), {
    status: 200,
    headers: jsonHeaders(cors)
  });
}

async function listAllSubscriptions(env) {
  const results = [];
  let cursor;
  do {
    const page = await env.SUBS.list(cursor ? { cursor: cursor } : undefined);
    for (const keyInfo of page.keys) {
      // Rate-limit counters live in the same namespace under an "rl_" prefix
      // (subscription keys are 64-char SHA-256 hex, so there's no collision)
      // — skip them here so they're never treated as subscriptions.
      if (keyInfo.name.indexOf("rl_") === 0) continue;
      const value = await env.SUBS.get(keyInfo.name);
      if (value) results.push({ key: keyInfo.name, value: value });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return results;
}

async function checkRateLimit(env, clientIp) {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const key = "rl_" + clientIp + "_" + minuteBucket;
  const current = await env.SUBS.get(key);
  const count = current ? parseInt(current, 10) : 0;
  if (count >= RATE_LIMIT_MAX_PER_MINUTE) return false;
  // TTL a little over a minute so a bucket cleans itself up automatically.
  await env.SUBS.put(key, String(count + 1), { expirationTtl: 120 });
  return true;
}

// ---- Web Push (VAPID / ES256, payload-less) --------------------------------

async function importVapidPrivateKey(env) {
  const publicPoint = base64UrlToUint8Array(env.VAPID_PUBLIC_KEY);
  if (publicPoint.length !== 65 || publicPoint[0] !== 0x04) {
    throw new Error("VAPID_PUBLIC_KEY is not a valid uncompressed P-256 point");
  }
  const x = publicPoint.slice(1, 33);
  const y = publicPoint.slice(33, 65);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: env.VAPID_PRIVATE_KEY,
    x: uint8ArrayToBase64Url(x),
    y: uint8ArrayToBase64Url(y),
    ext: true
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function buildVapidJwt(audience, privateKey) {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: VAPID_SUBJECT
  };
  const encoder = new TextEncoder();
  const headerB64 = uint8ArrayToBase64Url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = uint8ArrayToBase64Url(encoder.encode(JSON.stringify(payload)));
  const unsigned = headerB64 + "." + payloadB64;
  // Raw r||s output — do NOT DER-encode, base64url it directly.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    encoder.encode(unsigned)
  );
  const sigB64 = uint8ArrayToBase64Url(new Uint8Array(signature));
  return unsigned + "." + sigB64;
}

async function sendWebPush(subscription, privateKey, env) {
  const endpointUrl = new URL(subscription.endpoint);
  const audience = endpointUrl.protocol + "//" + endpointUrl.host;
  const jwt = await buildVapidJwt(audience, privateKey);
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: "vapid t=" + jwt + ", k=" + env.VAPID_PUBLIC_KEY,
      TTL: "60",
      Urgency: "high",
      "Content-Length": "0"
    }
  });
}

// ---- base64url helpers ------------------------------------------------------

function base64UrlToUint8Array(base64url) {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---- misc --------------------------------------------------------------------

async function sha256Hex(text) {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.prototype.map
    .call(new Uint8Array(digest), function (b) {
      return ("00" + b.toString(16)).slice(-2);
    })
    .join("");
}
