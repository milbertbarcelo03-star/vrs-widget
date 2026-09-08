/* ============================================================================
   VRS Widget — shared.js
   Firebase config + init, and shared signaling/room helpers used by
   call.html and interpreter.html.
   ============================================================================

   ---------------------------------------------------------------------------
   >>> PASTE YOUR FIREBASE CONFIG HERE <<<
   ---------------------------------------------------------------------------
   1. Go to https://console.firebase.google.com/
   2. Create a project (or open an existing one).
   3. In the left sidebar, open "Build" -> "Realtime Database" -> Create
      Database -> pick a location -> start in TEST MODE.
   4. Click the gear icon (Project settings) near "Project Overview".
   5. Scroll to "Your apps" -> click the "</>" (Web) icon -> register an app
      (nickname can be anything, e.g. "vrs-widget") -> you do NOT need
      Firebase Hosting.
   6. Firebase will show a `firebaseConfig` object. Copy the whole object
      and paste its values into VRS_FIREBASE_CONFIG below, replacing the
      placeholder strings.
   7. Make sure `databaseURL` is present (it looks like
      "https://YOUR-PROJECT-default-rtdb.firebaseio.com" or
      ".../-default-rtdb.REGION.firebasedatabase.app"). If your project was
      created without a Realtime Database yet, go back to step 3 first.
   8. Save this file. Reload index.html / call.html / interpreter.html.
      The yellow "Firebase not configured" banner should disappear.

   See README.md for the full click-by-click walkthrough with screenshots
   described in words.
   ---------------------------------------------------------------------------
*/
var VRS_FIREBASE_CONFIG = {
  apiKey: "AIzaSyA6gIlG7Ub1n1T67TQQYGuOc0Ddif-Ji6E",
  authDomain: "vrs-widget.firebaseapp.com",
  databaseURL: "https://vrs-widget-default-rtdb.firebaseio.com",
  projectId: "vrs-widget",
  storageBucket: "vrs-widget.firebasestorage.app",
  messagingSenderId: "476403906740",
  appId: "1:476403906740:web:3819a81a3194ae443a3fe1"
};

// Paste the Cloudflare Worker URL from PUSH-SETUP.md here, e.g.
// "https://vrs-push.YOUR-SUBDOMAIN.workers.dev"
var VRS_PUSH_ENDPOINT = "";
var VRS_VAPID_PUBLIC_KEY = "BFzZPcIXshnsZqC8ner-25wpy9KYEcUKPg6Uenc8PUVi1_dvzOygT8FEuIg6sE-QQoqXnwjl6E3bALG77-7HsFQ";

/* ============================================================================
   Everything below this line is app plumbing — no need to edit it.
   ============================================================================ */

// Obscure nested root path so this prototype's data doesn't collide with
// anything else that might live in the same Firebase project.
var VRS_ROOT_PATH = "_vrsProto_mariana47/signalingRoot9x";

// How stale a room can be (ms) before it's treated as dead on load.
var VRS_ROOM_STALE_MS = 1000 * 60 * 30; // 30 minutes

var VRS = (function () {
  "use strict";

  var app = null;
  var db = null;
  var configured = false;
  var authPromise = null;

  function isPlaceholder(v) {
    return typeof v !== "string" || v.indexOf("PASTE_YOUR") !== -1 || v.trim() === "";
  }

  function isFirebaseConfigured() {
    if (typeof VRS_FIREBASE_CONFIG !== "object" || !VRS_FIREBASE_CONFIG) return false;
    if (isPlaceholder(VRS_FIREBASE_CONFIG.apiKey)) return false;
    if (isPlaceholder(VRS_FIREBASE_CONFIG.databaseURL)) return false;
    if (isPlaceholder(VRS_FIREBASE_CONFIG.projectId)) return false;
    return true;
  }

  // opts.autoAnonymous — set false on the interpreter dashboard, which signs in
  // with a real email/password account instead. Signing in anonymously there
  // would burn the identity the database rules use to gate the call queue:
  // rules require sign_in_provider == 'password' to read it.
  function init(opts) {
    if (app) return true;
    if (!isFirebaseConfigured()) {
      configured = false;
      return false;
    }
    try {
      if (typeof firebase === "undefined") {
        configured = false;
        return false;
      }
      app = firebase.initializeApp(VRS_FIREBASE_CONFIG);
      db = firebase.database();
      configured = true;
      // Sign in anonymously so the database security rules have an identity to
      // check. This needs no user interaction — the browser silently receives a
      // uid. Rules reject every read/write from unauthenticated clients, which
      // blocks scripted access to the database from outside the app.
      var autoAnonymous = !opts || opts.autoAnonymous !== false;
      authPromise = autoAnonymous ? signInAnonymously() : waitForExistingUser();
      // Mark the rejection as handled here so a sign-in failure doesn't surface
      // as an "uncaught (in promise)" error. ready() still sees and reports it.
      authPromise.catch(function () {});
      return true;
    } catch (err) {
      console.error("VRS: Firebase init failed", err);
      configured = false;
      return false;
    }
  }

  function signInAnonymously() {
    return new Promise(function (resolve, reject) {
      try {
        if (typeof firebase.auth !== "function") {
          reject(new Error("Firebase Auth SDK not loaded"));
          return;
        }
        var auth = firebase.auth();
        var settled = false;
        // auth.currentUser is null on a cold load until Firebase has restored
        // the persisted session, so it cannot be checked synchronously. Wait
        // for the first state callback instead.
        var unsub = auth.onAuthStateChanged(function (user) {
          if (settled) return;
          settled = true;
          unsub();
          if (user) {
            // An interpreter signed in on this device already. Keep that
            // session — replacing it with an anonymous one would silently log
            // them out of the dashboard.
            resolve(user.uid);
            return;
          }
          auth
            .signInAnonymously()
            .then(function (cred) {
              resolve(cred.user.uid);
            })
            .catch(reject);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Resolves with the uid of an already-signed-in user, or null if nobody is
  // signed in on this device. Never signs anyone in, so the interpreter
  // dashboard can decide whether to show its login form.
  function waitForExistingUser() {
    return new Promise(function (resolve) {
      try {
        if (typeof firebase.auth !== "function") {
          resolve(null);
          return;
        }
        var auth = firebase.auth();
        var settled = false;
        var unsub = auth.onAuthStateChanged(function (user) {
          if (settled) return;
          settled = true;
          unsub();
          resolve(user ? user.uid : null);
        });
      } catch (err) {
        console.error("VRS: waitForExistingUser failed", err);
        resolve(null);
      }
    });
  }

  // Signs an interpreter in with a real account. Rejects with the Firebase
  // error so the caller can show a specific message.
  function signInWithEmail(email, password) {
    try {
      return firebase
        .auth()
        .signInWithEmailAndPassword(String(email).trim(), password)
        .then(function (cred) {
          // Later calls to ready() must resolve against the new identity, not
          // the null that waitForExistingUser() settled on at page load.
          authPromise = Promise.resolve(cred.user.uid);
          return cred.user;
        });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Guest access, offered on the student side only.
  //
  // An anonymous session: no account, no password, nothing to forget. This is
  // the escape hatch for the case student accounts would otherwise create -
  // someone who needs an interpreter now and cannot get past a login. A guest
  // can place a call and nothing else; they cannot read the queue or reports,
  // because those require an approved interpreter account.
  function signInAsGuest() {
    try {
      return firebase
        .auth()
        .signInAnonymously()
        .then(function (cred) {
          authPromise = Promise.resolve(cred.user.uid);
          return cred.user;
        });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Guest access, offered on the student side only.
  //
  // An anonymous session: no account, no password, nothing to forget. This is
  // the escape hatch for the case student accounts would otherwise create -
  // someone who needs an interpreter now and cannot get past a login. A guest
  // can place a call and nothing else; they cannot read the queue or reports,
  // because those require an approved interpreter account.
  function signInAsGuest() {
    try {
      return firebase
        .auth()
        .signInAnonymously()
        .then(function (cred) {
          authPromise = Promise.resolve(cred.user.uid);
          return cred.user;
        });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function signOutUser() {
    try {
      return firebase.auth().signOut();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function currentAuthUser() {
    try {
      return firebase.auth().currentUser || null;
    } catch (err) {
      return null;
    }
  }

  function currentUid() {
    var u = currentAuthUser();
    return u ? u.uid : null;
  }

  // True when the signed-in identity is a real email/password account rather
  // than an anonymous one. The database rules enforce the same distinction.
  function isInterpreterAccount() {
    var u = currentAuthUser();
    if (!u) return false;
    return u.isAnonymous === false;
  }

  // Creates a new interpreter account. The account is inert until an admin
  // approves it: "approved" is admin-only in the database rules, so nothing
  // here can grant it. A brand new account can sign in and set its name, and
  // nothing else.
  function signUpWithEmail(email, password) {
    try {
      return firebase
        .auth()
        .createUserWithEmailAndPassword(String(email).trim(), password)
        .then(function (cred) {
          authPromise = Promise.resolve(cred.user.uid);
          return cred.user;
        });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Single sign-on with a Google account.
  //
  // Tries a popup first because it keeps the page state, and falls back to a
  // full redirect where popups cannot work — an installed iOS home-screen app
  // is the usual case, and some embedded webviews block them outright.
  function signInWithGoogle() {
    try {
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      return firebase
        .auth()
        .signInWithPopup(provider)
        .then(function (res) {
          authPromise = Promise.resolve(res.user.uid);
          return res.user;
        })
        .catch(function (err) {
          var code = (err && err.code) || "";
          var popupUnavailable =
            code === "auth/popup-blocked" ||
            code === "auth/operation-not-supported-in-this-environment" ||
            code === "auth/cancelled-popup-request";
          if (popupUnavailable) {
            // Navigates away; the result is picked up by
            // consumeRedirectResult() on the way back in.
            return firebase.auth().signInWithRedirect(provider);
          }
          throw err;
        });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // Called once at start-up to collect the result of a redirect sign-in.
  // Resolves with null on a normal load, so it is always safe to call.
  function consumeRedirectResult() {
    try {
      return firebase
        .auth()
        .getRedirectResult()
        .then(function (res) {
          if (res && res.user) {
            authPromise = Promise.resolve(res.user.uid);
            return res.user;
          }
          return null;
        })
        .catch(function (err) {
          console.error("VRS: redirect sign-in failed", err);
          return null;
        });
    } catch (err) {
      return Promise.resolve(null);
    }
  }

  function isAdminUser(uid) {
    if (!uid) return Promise.resolve(false);
    return ref("admins/" + uid)
      .once("value")
      .then(function (snap) {
        return snap.val() === true;
      })
      .catch(function () {
        return false;
      });
  }

  function listInterpreters() {
    return ref("interpreters")
      .once("value")
      .then(function (snap) {
        var val = snap.val() || {};
        return Object.keys(val).map(function (k) {
          var item = val[k] || {};
          item.uid = k;
          return item;
        });
      });
  }

  // Admin-only in the rules; rejects for everyone else.
  function setInterpreterApproved(uid, approved) {
    return ref("interpreters/" + uid + "/approved").set(!!approved);
  }

  // ---- Interpreter profiles -------------------------------------------------
  // rules: interpreters/$uid is readable by any signed-in user (so a caller can
  // be shown who they are connected to) but writable only by that interpreter.

  function getInterpreterProfile(uid) {
    return ref("interpreters/" + uid)
      .once("value")
      .then(function (snap) {
        return snap.val();
      });
  }

  function saveInterpreterProfile(uid, profile) {
    var payload = {
      displayName: String((profile && profile.displayName) || "").slice(0, 60),
      title: String((profile && profile.title) || "").slice(0, 60),
      lastSeenAt: nowTs()
    };
    if (profile && profile.createdAt) payload.createdAt = profile.createdAt;
    else payload.createdAt = nowTs();
    // Without this an admin sees a bare uid on the approval list and has no
    // way to tell which person it belongs to.
    var authUser = currentAuthUser();
    if (authUser && authUser.email) payload.email = String(authUser.email).slice(0, 120);
    return ref("interpreters/" + uid).update(payload);
  }

  function touchInterpreter(uid) {
    return ref("interpreters/" + uid)
      .update({ lastSeenAt: nowTs() })
      .catch(function (err) {
        console.error("VRS: touchInterpreter failed", err);
      });
  }

  // Resolves once anonymous sign-in has completed. Every code path that touches
  // the database waits on this first.
  //
  // A failed sign-in resolves rather than rejects on purpose: the database
  // security rules are the real enforcement point, so the right behaviour is to
  // let the request proceed and be rejected server-side. Hard-failing here would
  // only take the app down without adding any protection.
  function ready() {
    if (!authPromise) {
      return Promise.reject(new Error("VRS: init() has not run or Firebase is unconfigured"));
    }
    return authPromise.catch(function (err) {
      console.error(
        "VRS: anonymous sign-in failed. If the database rules require auth, " +
        "requests will be denied until Anonymous Authentication is enabled in " +
        "the Firebase console (Build > Authentication > Sign-in method).",
        err
      );
      return null;
    });
  }

  // Injects a friendly banner explaining Firebase isn't configured yet.
  // Safe to call even if styles.css-equivalent inline styles aren't loaded.
  function showSetupBanner(targetEl) {
    try {
      var host = targetEl || document.body;
      if (!host) return;
      if (document.getElementById("vrs-setup-banner")) return;

      var banner = document.createElement("div");
      banner.id = "vrs-setup-banner";
      banner.setAttribute("role", "alert");
      banner.style.cssText = [
        "position:relative",
        "z-index:999999",
        "background:#fff3cd",
        "color:#664d03",
        "border:2px solid #f0c14b",
        "border-radius:10px",
        "padding:16px 18px",
        "margin:14px",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif",
        "font-size:15px",
        "line-height:1.5",
        "box-shadow:0 2px 10px rgba(0,0,0,0.08)"
      ].join(";");

      banner.innerHTML =
        '<strong style="display:block;font-size:16px;margin-bottom:6px;">' +
        "⚠️ Firebase isn't configured yet</strong>" +
        "<div>This VRS prototype needs a free Firebase Realtime Database to " +
        "handle call signaling. Open <code style=\"background:#00000010;padding:1px 5px;border-radius:4px;\">shared.js</code> " +
        "and paste your Firebase config where it says " +
        '<code style="background:#00000010;padding:1px 5px;border-radius:4px;">PASTE YOUR FIREBASE CONFIG HERE</code>. ' +
        "Full click-by-click steps are in README.md.</div>";

      host.insertBefore(banner, host.firstChild);
    } catch (err) {
      console.error("VRS: showSetupBanner failed", err);
    }
  }

  function ref(path) {
    if (!db) throw new Error("VRS: database not initialized");
    return db.ref(VRS_ROOT_PATH + "/" + path);
  }

  function nowTs() {
    return Date.now();
  }

  function generateId(prefix) {
    var rand = Math.random().toString(36).slice(2, 10);
    return (prefix ? prefix + "_" : "") + rand + "_" + Date.now().toString(36);
  }

  function generateRoomCode() {
    // 4-digit numeric room code, e.g. "4821"
    var n = Math.floor(1000 + Math.random() * 9000);
    return String(n);
  }

  // ---- Room lifecycle -------------------------------------------------

  function createRoom(roomId, data) {
    var payload = Object.assign(
      {
        status: "ringing",
        createdAt: nowTs(),
        updatedAt: nowTs()
      },
      data || {}
    );
    return ref("rooms/" + roomId).set(payload);
  }

  function getRoom(roomId) {
    return ref("rooms/" + roomId)
      .once("value")
      .then(function (snap) {
        return snap.val();
      });
  }

  function updateRoom(roomId, patch) {
    patch = Object.assign({ updatedAt: nowTs() }, patch || {});
    return ref("rooms/" + roomId).update(patch);
  }

  function listenRoom(roomId, cb) {
    var r = ref("rooms/" + roomId);
    r.on("value", function (snap) {
      cb(snap.val());
    });
    return function unsubscribe() {
      r.off("value");
    };
  }

  function endRoom(roomId) {
    return updateRoom(roomId, { status: "ended", endedAt: nowTs() });
  }

  // ---- Queue (for interpreter dashboard) -------------------------------

  function pushToQueue(roomId, info) {
    var payload = Object.assign(
      {
        roomId: roomId,
        createdAt: nowTs(),
        status: "waiting"
      },
      info || {}
    );
    return ref("queue/" + roomId).set(payload);
  }

  function updateQueueEntry(roomId, patch) {
    return ref("queue/" + roomId).update(patch || {});
  }

  function removeFromQueue(roomId) {
    return ref("queue/" + roomId).remove();
  }

  function listenQueue(cb) {
    var q = ref("queue");
    q.on("value", function (snap) {
      var val = snap.val() || {};
      var list = Object.keys(val).map(function (k) {
        return val[k];
      });
      cb(list);
    });
    return function unsubscribe() {
      q.off("value");
    };
  }

  // ---- Participants ------------------------------------------------------

  function addParticipant(roomId, peerId, info) {
    var payload = Object.assign(
      {
        peerId: peerId,
        joinedAt: nowTs()
      },
      info || {}
    );
    var pRef = ref("rooms/" + roomId + "/participants/" + peerId);
    pRef.set(payload);
    // Presence: remove self automatically on disconnect (tab close, network drop)
    try {
      pRef.onDisconnect().remove();
    } catch (err) {
      console.error("VRS: onDisconnect setup failed", err);
    }
    return pRef;
  }

  function listenParticipants(roomId, cb) {
    var p = ref("rooms/" + roomId + "/participants");
    p.on("value", function (snap) {
      cb(snap.val() || {});
    });
    return function unsubscribe() {
      p.off("value");
    };
  }

  function removeParticipant(roomId, peerId) {
    return ref("rooms/" + roomId + "/participants/" + peerId).remove();
  }

  // ---- WebRTC signaling (offer/answer/ICE) --------------------------------
  // Path: rooms/{roomId}/signals/{fromId}_{toId}

  function signalPath(fromId, toId) {
    return "signals/" + fromId + "_" + toId;
  }

  function sendSignal(roomId, fromId, toId, type, payload) {
    var entry = {
      type: type, // 'offer' | 'answer' | 'candidate'
      from: fromId,
      to: toId,
      payload: payload,
      ts: nowTs()
    };
    if (type === "candidate") {
      return ref("rooms/" + roomId + "/" + signalPath(fromId, toId) + "/candidates").push(entry);
    }
    return ref("rooms/" + roomId + "/" + signalPath(fromId, toId) + "/" + type).set(entry);
  }

  // Listens for offers/answers/candidates addressed TO myId, from ANY peer,
  // within a room. Fires cb(entry) once per new item.
  function listenIncomingSignals(roomId, myId, cb) {
    var base = ref("rooms/" + roomId + "/signals");
    var seenOffers = {};
    var seenAnswers = {};
    var seenCandidates = {};

    function handle(snap) {
      var all = snap.val() || {};
      Object.keys(all).forEach(function (key) {
        // Peer ids themselves contain underscores, so the {fromId}_{toId} key
        // cannot be split reliably — use the from/to fields stored on each
        // entry instead.
        var entry = all[key];
        if (entry.offer && entry.offer.to === myId && !seenOffers[key]) {
          seenOffers[key] = true;
          cb({ type: "offer", from: entry.offer.from, to: myId, payload: entry.offer.payload });
        }
        if (entry.answer && entry.answer.to === myId && !seenAnswers[key]) {
          seenAnswers[key] = true;
          cb({ type: "answer", from: entry.answer.from, to: myId, payload: entry.answer.payload });
        }
        if (entry.candidates) {
          Object.keys(entry.candidates).forEach(function (cKey) {
            var c = entry.candidates[cKey];
            var fullKey = key + "/" + cKey;
            if (!c || c.to !== myId || seenCandidates[fullKey]) return;
            seenCandidates[fullKey] = true;
            cb({
              type: "candidate",
              from: c.from,
              to: myId,
              payload: c.payload
            });
          });
        }
      });
    }

    base.on("value", handle);
    return function unsubscribe() {
      base.off("value", handle);
    };
  }

  // ---- Chat ----------------------------------------------------------------

  function sendChatMessage(roomId, senderId, role, text) {
    return ref("rooms/" + roomId + "/chat").push({
      senderId: senderId,
      role: role,
      text: text,
      ts: nowTs()
    });
  }

  function listenChat(roomId, cb) {
    var c = ref("rooms/" + roomId + "/chat");
    c.on("child_added", function (snap) {
      cb(snap.val());
    });
    return function unsubscribe() {
      c.off("child_added");
    };
  }

  // ---- Stale room cleanup ----------------------------------------------------

  function isStale(room) {
    if (!room) return true;
    var ts = room.updatedAt || room.createdAt || 0;
    return Date.now() - ts > VRS_ROOM_STALE_MS;
  }

  // ---- WebRTC mesh manager --------------------------------------------------
  // One RTCPeerConnection per remote peer. Max 3 participants (deaf,
  // interpreter, third party). Deterministic offer initiator: the peer with
  // the lexicographically smaller id creates the offer, to avoid glare.

  function iceServerConfig() {
    return {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        // TURN relay. STUN alone fails whenever both peers sit behind strict
        // NAT — most cellular carriers, many school and corporate networks —
        // which shows up as a call that connects and exchanges chat but never
        // displays remote video. These are Open Relay's free public servers.
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject"
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject"
        }
      ]
    };
  }

  function createMesh(opts) {
    opts = opts || {};
    var roomId = opts.roomId;
    var myId = opts.myId;
    var localStream = opts.localStream || null;
    var onRemoteStream = opts.onRemoteStream || function () {};
    var onRemoteRemoved = opts.onRemoteRemoved || function () {};
    var onParticipantsChange = opts.onParticipantsChange || function () {};
    var onPeerState = opts.onPeerState || function () {};

    var peers = {}; // peerId -> { pc, role }
    var pendingCandidates = {}; // peerId -> [candidate,...] queued pre-remoteDescription
    var unsubParticipants = null;
    var unsubSignals = null;
    var closed = false;

    function sdpToPlain(desc) {
      return { type: desc.type, sdp: desc.sdp };
    }

    function flushCandidates(peerId) {
      var pc = peers[peerId] && peers[peerId].pc;
      var list = pendingCandidates[peerId] || [];
      if (!pc) return;
      list.forEach(function (c) {
        pc.addIceCandidate(new RTCIceCandidate(c)).catch(function (err) {
          console.error("VRS mesh: addIceCandidate (flush) failed", err);
        });
      });
      pendingCandidates[peerId] = [];
    }

    function ensurePeer(peerId, role) {
      if (peerId === myId) return null;
      if (peers[peerId]) return peers[peerId];

      var pc = new RTCPeerConnection(iceServerConfig());
      peers[peerId] = { pc: pc, role: role || null };
      pendingCandidates[peerId] = [];

      if (localStream) {
        localStream.getTracks().forEach(function (track) {
          try {
            pc.addTrack(track, localStream);
          } catch (err) {
            console.error("VRS mesh: addTrack failed", err);
          }
        });
      } else {
        // No local camera/mic — still receive the remote peer's media.
        try {
          pc.addTransceiver("audio", { direction: "recvonly" });
          pc.addTransceiver("video", { direction: "recvonly" });
        } catch (err) {
          console.error("VRS mesh: addTransceiver failed", err);
        }
      }

      pc.onicecandidate = function (evt) {
        if (evt.candidate) {
          sendSignal(roomId, myId, peerId, "candidate", evt.candidate.toJSON());
        }
      };

      pc.ontrack = function (evt) {
        onRemoteStream(peerId, evt.streams[0], peers[peerId] && peers[peerId].role);
      };

      pc.onconnectionstatechange = function () {
        onPeerState(peerId, pc.connectionState);
      };

      // Deterministic glare avoidance.
      if (String(myId) < String(peerId)) {
        pc.createOffer()
          .then(function (offer) {
            return pc.setLocalDescription(offer).then(function () {
              sendSignal(roomId, myId, peerId, "offer", sdpToPlain(pc.localDescription));
            });
          })
          .catch(function (err) {
            console.error("VRS mesh: createOffer failed", err);
          });
      }

      return peers[peerId];
    }

    function removePeer(peerId) {
      var p = peers[peerId];
      if (!p) return;
      try {
        p.pc.close();
      } catch (err) {
        console.error("VRS mesh: pc.close failed", err);
      }
      delete peers[peerId];
      delete pendingCandidates[peerId];
      onRemoteRemoved(peerId);
    }

    function handleSignal(sig) {
      if (!sig || sig.to !== myId) return;
      var peerId = sig.from;
      var entry = ensurePeer(peerId, null);
      if (!entry) return;
      var pc = entry.pc;

      if (sig.type === "offer") {
        pc.setRemoteDescription(new RTCSessionDescription(sig.payload))
          .then(function () {
            return pc.createAnswer();
          })
          .then(function (answer) {
            return pc.setLocalDescription(answer);
          })
          .then(function () {
            sendSignal(roomId, myId, peerId, "answer", sdpToPlain(pc.localDescription));
            flushCandidates(peerId);
          })
          .catch(function (err) {
            console.error("VRS mesh: handling offer failed", err);
          });
      } else if (sig.type === "answer") {
        pc.setRemoteDescription(new RTCSessionDescription(sig.payload))
          .then(function () {
            flushCandidates(peerId);
          })
          .catch(function (err) {
            console.error("VRS mesh: handling answer failed", err);
          });
      } else if (sig.type === "candidate") {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          pc.addIceCandidate(new RTCIceCandidate(sig.payload)).catch(function (err) {
            console.error("VRS mesh: addIceCandidate failed", err);
          });
        } else {
          pendingCandidates[peerId] = pendingCandidates[peerId] || [];
          pendingCandidates[peerId].push(sig.payload);
        }
      }
    }

    function start() {
      unsubSignals = listenIncomingSignals(roomId, myId, handleSignal);
      unsubParticipants = listenParticipants(roomId, function (participants) {
        participants = participants || {};
        var ids = Object.keys(participants);
        onParticipantsChange(participants);

        ids.forEach(function (pid) {
          if (pid === myId) return;
          if (!peers[pid]) {
            ensurePeer(pid, participants[pid] && participants[pid].role);
          } else if (!peers[pid].role && participants[pid]) {
            peers[pid].role = participants[pid].role;
          }
        });

        // Only prune peers when the snapshot actually lists somebody. An empty
        // participants node arrives transiently (and when the node is removed
        // on disconnect), and pruning on it would tear down a live, working
        // connection mid-call.
        if (ids.length) {
          Object.keys(peers).forEach(function (pid) {
            if (ids.indexOf(pid) === -1) removePeer(pid);
          });
        }
      });
    }

    function stop() {
      if (closed) return;
      closed = true;
      if (unsubParticipants) unsubParticipants();
      if (unsubSignals) unsubSignals();
      Object.keys(peers).forEach(removePeer);
    }

    return { start: start, stop: stop, peers: peers };
  }

  // ---- Student profiles ----------------------------------------------------
  // Students hold real accounts. Unlike interpreters there is no approval
  // step: approval protects deaf callers from strangers ANSWERING calls, and
  // gating the callers themselves would put a wall in front of the people the
  // service exists for.

  function getStudentProfile(uid) {
    return ref("students/" + uid)
      .once("value")
      .then(function (snap) {
        return snap.val();
      });
  }

  function saveStudentProfile(uid, profile) {
    var payload = {
      displayName: String((profile && profile.displayName) || "").slice(0, 60),
      lastSeenAt: nowTs()
    };
    payload.createdAt = (profile && profile.createdAt) || nowTs();
    var authUser = currentAuthUser();
    if (authUser && authUser.email) payload.email = String(authUser.email).slice(0, 120);
    return ref("students/" + uid).update(payload);
  }

  function touchStudent(uid) {
    return ref("students/" + uid)
      .update({ lastSeenAt: nowTs() })
      .catch(function (err) {
        console.error("VRS: touchStudent failed", err);
      });
  }

  // Works out what an already-signed-in account is, so a returning user lands
  // straight in their own side of the app instead of picking a role again.
  //
  // Resolves to "student", "interpreter", or null when the account has neither
  // profile yet (a fresh sign-up that has not chosen). An anonymous session is
  // always null: those are third parties who joined by room link.
  function detectUserRole(uid) {
    if (!uid) return Promise.resolve(null);
    var user = currentAuthUser();
    if (user && user.isAnonymous) return Promise.resolve(null);
    return Promise.all([
      getInterpreterProfile(uid).catch(function () { return null; }),
      getStudentProfile(uid).catch(function () { return null; })
    ]).then(function (results) {
      if (results[0]) return "interpreter";
      if (results[1]) return "student";
      return null;
    });
  }

  // ---- Camera mirroring ----------------------------------------------------
  // Flipping a video horizontally is a CSS transform on the element, so it
  // changes only what THIS viewer sees. The transmitted stream is untouched and
  // nobody else's picture changes. That distinction is worth keeping straight:
  // actually mirroring the outgoing video would need canvas re-encoding, and
  // for sign language it would be the wrong thing to do anyway.
  //
  // Defaults: your own camera is mirrored, everyone else's is not.
  //
  // Mirroring matters more here than in an ordinary video app. Reversing a
  // signer flips their dominant hand, so a right-handed signer reads as
  // left-handed. Self-view is mirrored because that is what every video app
  // does and an unmirrored self-view feels wrong to move against. Remote video
  // is left alone so signs are seen as they were actually produced — but each
  // tile can still be flipped, because a participant whose own device mirrors
  // its outgoing video would otherwise appear reversed to everybody.

  var MIRROR_STORAGE_KEY = "vrsMirrorSelf";
  var mirrorStylesInjected = false;

  function ensureMirrorStyles() {
    if (mirrorStylesInjected) return;
    try {
      var style = document.createElement("style");
      style.id = "vrs-mirror-style";
      style.textContent = [
        ".vrs-mirrored video{transform:scaleX(-1);}",
        "video.vrs-mirrored{transform:scaleX(-1);}",
        ".vrs-mirror-btn{position:absolute;top:8px;right:8px;z-index:5;",
        "width:34px;height:34px;border-radius:8px;cursor:pointer;",
        "display:flex;align-items:center;justify-content:center;font-size:15px;",
        "background:rgba(10,18,32,.66);color:#dbe6fa;",
        "border:1px solid rgba(255,255,255,.18);",
        "transition:background .15s ease,color .15s ease;}",
        ".vrs-mirror-btn:hover{background:rgba(10,18,32,.88);color:#fff;}",
        ".vrs-mirror-btn:focus-visible{outline:2px solid var(--vrs-purple,#b25d22);outline-offset:2px;}",
        ".vrs-mirror-btn.vrs-on{background:var(--vrs-purple,#b25d22);color:#fff;border-color:var(--vrs-purple-light,#e08a4f);}"
      ].join("");
      document.head.appendChild(style);
      mirrorStylesInjected = true;
    } catch (err) {
      console.error("VRS: ensureMirrorStyles failed", err);
    }
  }

  // Defaults to true on a device that has never chosen, matching the
  // convention every other video app uses for a self-view.
  function isSelfMirrored() {
    try {
      var v = localStorage.getItem(MIRROR_STORAGE_KEY);
      if (v === null) return true;
      return v === "1";
    } catch (err) {
      return true;
    }
  }

  function setSelfMirrored(on) {
    try {
      localStorage.setItem(MIRROR_STORAGE_KEY, on ? "1" : "0");
    } catch (err) {
      console.error("VRS: could not remember mirror preference", err);
    }
  }

  // Works on a tile wrapper or directly on a <video>, so the pre-call preview
  // and the in-call tiles can share one code path.
  function setTileMirrored(el, on) {
    if (!el) return;
    ensureMirrorStyles();
    if (on) el.classList.add("vrs-mirrored");
    else el.classList.remove("vrs-mirrored");
    var btn = el.querySelector ? el.querySelector(".vrs-mirror-btn") : null;
    if (btn) {
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      if (on) btn.classList.add("vrs-on");
      else btn.classList.remove("vrs-on");
    }
  }

  function isTileMirrored(el) {
    return !!(el && el.classList && el.classList.contains("vrs-mirrored"));
  }

  // Adds the small flip control to a video tile. onToggle receives the new
  // state so the caller can persist it for the local tile.
  function attachMirrorButton(tile, label, onToggle) {
    try {
      if (!tile || tile.querySelector(".vrs-mirror-btn")) return;
      ensureMirrorStyles();
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vrs-mirror-btn";
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", label || "Mirror this video");
      btn.title = label || "Mirror this video";
      btn.textContent = "\u21c4";
      btn.addEventListener("click", function (evt) {
        evt.stopPropagation();
        var next = !isTileMirrored(tile);
        setTileMirrored(tile, next);
        if (typeof onToggle === "function") onToggle(next);
      });
      tile.appendChild(btn);
    } catch (err) {
      console.error("VRS: attachMirrorButton failed", err);
    }
  }

  // ---- Feedback / problem reports ------------------------------------------
  // Users report issues from inside the app rather than having to email
  // someone. Reports land in the database, where they can be read back and
  // acted on.
  //
  // The whole UI is injected from here instead of being written into
  // call.html and interpreter.html. Both pages get an identical widget from
  // one implementation, and the desktop app and the installed home-screen
  // apps pick it up automatically, since they all load these same pages.

  var feedbackOpts = { role: "unknown", getRoomId: null };
  var feedbackRating = 0;
  var feedbackMounted = false;

  // Which wrapper the page is running inside. Worth capturing on every
  // report: "video is black" often turns out to be specific to one of these.
  function appShell() {
    try {
      if (document.documentElement.getAttribute("data-vrs-shell") === "electron") {
        return "desktop";
      }
      if (navigator.standalone === true) return "ios-installed";
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) {
        return "installed";
      }
      return "browser";
    } catch (err) {
      return "unknown";
    }
  }

  function submitFeedback(entry) {
    entry = entry || {};
    var payload = {
      message: String(entry.message || "").slice(0, 2000),
      category: String(entry.category || "other").slice(0, 32),
      role: String(entry.role || feedbackOpts.role || "unknown").slice(0, 24),
      shell: appShell(),
      userAgent: String(navigator.userAgent || "").slice(0, 300),
      ts: nowTs()
    };
    if (entry.rating) payload.rating = Number(entry.rating);
    if (entry.roomId) payload.roomId = String(entry.roomId).slice(0, 8);
    if (entry.reporter) payload.reporter = String(entry.reporter).slice(0, 60);
    var uid = currentUid();
    if (uid) payload.uid = uid;
    return ref("feedback").push(payload);
  }

  // Reads reports newest-last. Rules restrict this to interpreter accounts,
  // so it rejects for an anonymous caller by design.
  function getFeedback(limit) {
    return ref("feedback")
      .orderByChild("ts")
      .limitToLast(limit || 200)
      .once("value")
      .then(function (snap) {
        var val = snap.val() || {};
        return Object.keys(val).map(function (k) {
          var item = val[k];
          item.id = k;
          return item;
        }).sort(function (a, b) {
          return (b.ts || 0) - (a.ts || 0);
        });
      });
  }

  function markFeedbackHandled(id, handled) {
    return ref("feedback/" + id).update({ handled: !!handled });
  }

  var FEEDBACK_CSS = [
    ".vrs-fb-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(4,8,16,.72);",
    "display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto;}",
    ".vrs-fb-overlay[hidden]{display:none!important;}",
    ".vrs-fb-card{background:var(--vrs-panel,#12203a);color:var(--vrs-text,#f2f5fa);",
    "border:1px solid var(--vrs-border,#24365a);border-radius:16px;padding:24px;",
    "max-width:460px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.5);",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;",
    "max-height:calc(100vh - 32px);overflow-y:auto;}",
    ".vrs-fb-card h2{margin:0 0 6px;font-size:20px;font-family:var(--vrs-font-display,inherit);}",
    ".vrs-fb-sub{margin:0 0 18px;font-size:13px;line-height:1.6;color:var(--vrs-muted,#9fb2d4);}",
    ".vrs-fb-field{margin-bottom:16px;}",
    ".vrs-fb-label{display:block;font-size:13px;font-weight:600;margin-bottom:8px;}",
    ".vrs-fb-stars{display:flex;gap:6px;}",
    ".vrs-fb-star{width:44px;height:44px;font-size:22px;line-height:1;cursor:pointer;",
    "background:var(--vrs-panel-2,#1a2c4d);border:1px solid var(--vrs-border,#24365a);",
    "border-radius:8px;color:#5c6f92;transition:transform .12s ease,color .12s ease;}",
    ".vrs-fb-star:hover{transform:translateY(-2px);}",
    ".vrs-fb-star.vrs-fb-on{color:#f4b740;border-color:#f4b740;}",
    ".vrs-fb-star:focus-visible{outline:2px solid var(--vrs-purple,#b25d22);outline-offset:2px;}",
    ".vrs-fb-ratinglabel{margin-top:6px;font-size:12px;color:var(--vrs-muted,#9fb2d4);}",
    ".vrs-fb-input{width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px;",
    "font-size:15px;font-family:inherit;border-radius:8px;",
    "border:1px solid var(--vrs-border,#24365a);background:var(--vrs-panel-2,#1a2c4d);",
    "color:var(--vrs-text,#f2f5fa);}",
    ".vrs-fb-input:focus{outline:2px solid var(--vrs-purple,#b25d22);outline-offset:1px;}",
    "textarea.vrs-fb-input{resize:vertical;line-height:1.5;}",
    ".vrs-fb-count{margin-top:4px;font-size:11px;color:var(--vrs-muted,#9fb2d4);text-align:right;}",
    ".vrs-fb-context{font-size:11px;color:var(--vrs-muted,#9fb2d4);line-height:1.6;",
    "background:var(--vrs-panel-2,#1a2c4d);border-radius:8px;padding:10px 12px;margin-bottom:16px;}",
    ".vrs-fb-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;}",
    ".vrs-fb-btn{min-height:44px;padding:10px 18px;font-size:15px;font-weight:700;",
    "font-family:var(--vrs-font-display,inherit);border-radius:8px;cursor:pointer;border:none;}",
    ".vrs-fb-btn-primary{color:#fff;background:linear-gradient(135deg,var(--vrs-purple,#b25d22),var(--vrs-purple-dark,#96491a));}",
    ".vrs-fb-btn-secondary{background:var(--vrs-panel-2,#1a2c4d);color:var(--vrs-text,#f2f5fa);",
    "border:1px solid var(--vrs-border,#24365a);}",
    ".vrs-fb-btn:disabled{opacity:.5;cursor:not-allowed;}",
    ".vrs-fb-status{margin-top:12px;font-size:13px;font-weight:600;min-height:18px;}",
    ".vrs-fb-status.vrs-fb-err{color:var(--vrs-danger,#e0405a);}",
    ".vrs-fb-status.vrs-fb-ok{color:var(--vrs-success,#22c55e);}",
    ".vrs-fb-trigger{background:none;border:none;color:var(--vrs-muted,#9fb2d4);",
    "font-size:13px;text-decoration:underline;cursor:pointer;padding:8px 0;min-height:36px;}",
    ".vrs-fb-trigger:hover{color:var(--vrs-text,#f2f5fa);}"
  ].join("");

  var RATING_WORDS = ["Not rated", "Unusable", "Poor", "Okay", "Good", "Worked well"];

  function setFeedbackRating(n) {
    feedbackRating = n;
    var i;
    var stars = document.querySelectorAll(".vrs-fb-star");
    for (i = 0; i < stars.length; i++) {
      var on = i < n;
      if (on) stars[i].classList.add("vrs-fb-on");
      else stars[i].classList.remove("vrs-fb-on");
      stars[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    var label = document.getElementById("vrsFbRatingLabel");
    // The primary users are deaf, so the rating must read as words on screen,
    // never as a colour or an icon alone.
    if (label) label.textContent = RATING_WORDS[n] || RATING_WORDS[0];
  }

  function buildFeedbackUi() {
    var style = document.createElement("style");
    style.id = "vrs-feedback-style";
    style.textContent = FEEDBACK_CSS;
    document.head.appendChild(style);

    var overlay = document.createElement("div");
    overlay.className = "vrs-fb-overlay";
    overlay.id = "vrsFeedbackOverlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "vrsFbTitle");

    var stars = "";
    for (var i = 1; i <= 5; i++) {
      stars += '<button type="button" class="vrs-fb-star" data-star="' + i +
        '" aria-pressed="false" aria-label="' + i + ' out of 5">\u2605</button>';
    }

    overlay.innerHTML =
      '<div class="vrs-fb-card">' +
        '<h2 id="vrsFbTitle">Report a problem</h2>' +
        '<p class="vrs-fb-sub">Tell us what went wrong and it goes straight to the people who build this app.</p>' +
        '<div class="vrs-fb-field">' +
          '<span class="vrs-fb-label">How well did it work?</span>' +
          '<div class="vrs-fb-stars" id="vrsFbStars" role="group" aria-label="Rating out of 5">' + stars + '</div>' +
          '<div class="vrs-fb-ratinglabel" id="vrsFbRatingLabel">Not rated</div>' +
        '</div>' +
        '<div class="vrs-fb-field">' +
          '<label class="vrs-fb-label" for="vrsFbCategory">What kind of problem?</label>' +
          '<select id="vrsFbCategory" class="vrs-fb-input">' +
            '<option value="video">Video \u2014 could not see the other person</option>' +
            '<option value="audio">Audio or microphone</option>' +
            '<option value="connection">Call dropped or would not connect</option>' +
            '<option value="waiting">No interpreter answered</option>' +
            '<option value="signin">Could not sign in</option>' +
            '<option value="confusing">Something was confusing to use</option>' +
            '<option value="other" selected>Something else</option>' +
          '</select>' +
        '</div>' +
        '<div class="vrs-fb-field">' +
          '<label class="vrs-fb-label" for="vrsFbMessage">What happened?</label>' +
          '<textarea id="vrsFbMessage" class="vrs-fb-input" rows="4" maxlength="2000" ' +
            'placeholder="For example: the interpreter answered but I only saw a black screen."></textarea>' +
          '<div class="vrs-fb-count" id="vrsFbCount">0 / 2000</div>' +
        '</div>' +
        '<div class="vrs-fb-field">' +
          '<label class="vrs-fb-label" for="vrsFbReporter">Your name (optional)</label>' +
          '<input id="vrsFbReporter" class="vrs-fb-input" type="text" maxlength="60" ' +
            'autocapitalize="words" autocorrect="off" spellcheck="false" placeholder="So we can follow up">' +
        '</div>' +
        '<div class="vrs-fb-context" id="vrsFbContext"></div>' +
        '<div class="vrs-fb-actions">' +
          '<button type="button" class="vrs-fb-btn vrs-fb-btn-secondary" id="vrsFbCancel">Cancel</button>' +
          '<button type="button" class="vrs-fb-btn vrs-fb-btn-primary" id="vrsFbSubmit">Send report</button>' +
        '</div>' +
        '<div class="vrs-fb-status" id="vrsFbStatus" role="status"></div>' +
      '</div>';

    document.body.appendChild(overlay);

    var starEls = overlay.querySelectorAll(".vrs-fb-star");
    for (var j = 0; j < starEls.length; j++) {
      starEls[j].addEventListener("click", function (evt) {
        setFeedbackRating(Number(evt.currentTarget.getAttribute("data-star")));
      });
    }

    var msg = document.getElementById("vrsFbMessage");
    msg.addEventListener("input", function () {
      document.getElementById("vrsFbCount").textContent = msg.value.length + " / 2000";
    });

    document.getElementById("vrsFbCancel").addEventListener("click", closeFeedback);
    document.getElementById("vrsFbSubmit").addEventListener("click", onFeedbackSubmit);

    overlay.addEventListener("click", function (evt) {
      if (evt.target === overlay) closeFeedback();
    });
    document.addEventListener("keydown", function (evt) {
      if (evt.key === "Escape" && !overlay.hidden) closeFeedback();
    });
  }

  function onFeedbackSubmit() {
    var msgEl = document.getElementById("vrsFbMessage");
    var statusEl = document.getElementById("vrsFbStatus");
    var btn = document.getElementById("vrsFbSubmit");
    var text = (msgEl.value || "").trim();

    if (!text) {
      statusEl.className = "vrs-fb-status vrs-fb-err";
      statusEl.textContent = "Please describe what happened before sending.";
      msgEl.focus();
      return;
    }

    btn.disabled = true;
    statusEl.className = "vrs-fb-status";
    statusEl.textContent = "Sending\u2026";

    var roomId = null;
    try {
      if (typeof feedbackOpts.getRoomId === "function") roomId = feedbackOpts.getRoomId();
    } catch (err) {
      console.error("VRS: feedback getRoomId failed", err);
    }

    submitFeedback({
      message: text,
      category: document.getElementById("vrsFbCategory").value,
      rating: feedbackRating,
      role: feedbackOpts.role,
      roomId: roomId,
      reporter: (document.getElementById("vrsFbReporter").value || "").trim()
    })
      .then(function () {
        statusEl.className = "vrs-fb-status vrs-fb-ok";
        statusEl.textContent = "Thank you \u2014 your report was sent.";
        msgEl.value = "";
        document.getElementById("vrsFbCount").textContent = "0 / 2000";
        setFeedbackRating(0);
        btn.disabled = false;
        setTimeout(closeFeedback, 1600);
      })
      .catch(function (err) {
        console.error("VRS: feedback submit failed", err);
        btn.disabled = false;
        statusEl.className = "vrs-fb-status vrs-fb-err";
        // Never lose what they typed on a failure - they may have spent real
        // effort describing the problem.
        statusEl.textContent = "Could not send. Check your connection and try again.";
      });
  }

  function openFeedback() {
    try {
      if (!feedbackMounted) return;
      var overlay = document.getElementById("vrsFeedbackOverlay");
      if (!overlay) return;

      var roomId = null;
      try {
        if (typeof feedbackOpts.getRoomId === "function") roomId = feedbackOpts.getRoomId();
      } catch (err) { /* context is a nicety, never block the form */ }

      // State plainly what gets attached. People are more willing to report a
      // problem when nothing is collected behind their back.
      var bits = ["Also sent: your device type, the app version, and how you opened the app."];
      if (roomId) bits.push("Room " + roomId + ".");
      document.getElementById("vrsFbContext").textContent = bits.join(" ");

      document.getElementById("vrsFbStatus").textContent = "";
      overlay.hidden = false;
      try { document.getElementById("vrsFbMessage").focus(); } catch (err) { /* ignore */ }
    } catch (err) {
      console.error("VRS: openFeedback failed", err);
    }
  }

  function closeFeedback() {
    var overlay = document.getElementById("vrsFeedbackOverlay");
    if (overlay) overlay.hidden = true;
  }

  // opts.role      - "deaf" | "interpreter" | "third", stamped on each report
  // opts.getRoomId - optional function returning the current room code
  function mountFeedbackUi(opts) {
    try {
      if (feedbackMounted) return;
      if (!document.body) return;
      feedbackOpts = {
        role: (opts && opts.role) || "unknown",
        getRoomId: (opts && opts.getRoomId) || null
      };
      buildFeedbackUi();
      feedbackMounted = true;
    } catch (err) {
      console.error("VRS: mountFeedbackUi failed", err);
    }
  }

  // ---- Service worker / PWA install ----------------------------------------

  // Registers the service worker so the app can be installed to an iPhone or
  // Android home screen and open offline. Separate from push on purpose:
  // subscribeToPush() also registers sw.js, but only once a push endpoint has
  // been configured, so relying on that alone left the app uninstallable.
  // Calling register() twice with the same URL is a no-op, so both paths can
  // run safely.
  //
  // Never rejects: a failed registration must not stop a call from starting.
  function registerServiceWorker() {
    try {
      if (!("serviceWorker" in navigator)) return Promise.resolve(null);
      // file:// has no secure context, so registration always throws there.
      if (location.protocol !== "https:" && location.hostname !== "localhost") {
        return Promise.resolve(null);
      }
      return navigator.serviceWorker.register("sw.js").catch(function (err) {
        console.error("VRS: service worker registration failed", err);
        return null;
      });
    } catch (err) {
      console.error("VRS: registerServiceWorker failed", err);
      return Promise.resolve(null);
    }
  }

  // True when running as an installed home-screen app rather than in a browser
  // tab. iOS exposes navigator.standalone; everyone else uses the media query.
  function isInstalledApp() {
    try {
      if (navigator.standalone === true) return true;
      return !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    } catch (err) {
      return false;
    }
  }

  // True for iPhone/iPad, including iPadOS 13+ which reports itself as a Mac
  // with a touch screen.
  function isIOS() {
    try {
      var ua = navigator.userAgent || "";
      if (/iPad|iPhone|iPod/.test(ua)) return true;
      return ua.indexOf("Macintosh") !== -1 && navigator.maxTouchPoints > 1;
    } catch (err) {
      return false;
    }
  }

  // ---- Web Push (background alerts for interpreters) ------------------------
  // Entirely separate from Firebase: subscriptions live in Cloudflare KV via
  // the Worker at VRS_PUSH_ENDPOINT, and the Worker holds the VAPID private
  // key. Every function here must no-op harmlessly when the endpoint hasn't
  // been configured yet, so the rest of the app keeps working untouched.

  function pushConfigured() {
    return typeof VRS_PUSH_ENDPOINT === "string" && VRS_PUSH_ENDPOINT.trim() !== "";
  }

  // Converts a base64url-encoded string (the VAPID public key format) into
  // the Uint8Array that pushManager.subscribe() requires as
  // applicationServerKey. Getting the padding/charset wrong here is a classic
  // source of "invalid raw ECDSA P-256 public key" subscribe failures.
  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var rawData = atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function subscribeToPush() {
    if (!pushConfigured()) return Promise.resolve(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        return Promise.resolve(null);
      }
      return navigator.serviceWorker
        .register("sw.js")
        .then(function (registration) {
          return Notification.requestPermission().then(function (permission) {
            if (permission !== "granted") return null;
            return registration.pushManager
              .subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VRS_VAPID_PUBLIC_KEY)
              })
              .then(function (subscription) {
                return fetch(VRS_PUSH_ENDPOINT + "/subscribe", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(subscription)
                }).then(function () {
                  return subscription;
                });
              });
          });
        })
        .catch(function (err) {
          console.error("VRS: subscribeToPush failed", err);
          return null;
        });
    } catch (err) {
      console.error("VRS: subscribeToPush failed", err);
      return Promise.resolve(null);
    }
  }

  function unsubscribeFromPush() {
    if (!pushConfigured()) return Promise.resolve(false);
    try {
      if (!("serviceWorker" in navigator)) return Promise.resolve(false);
      return navigator.serviceWorker
        .getRegistration()
        .then(function (registration) {
          if (!registration) return false;
          return registration.pushManager.getSubscription().then(function (subscription) {
            if (!subscription) return false;
            return fetch(VRS_PUSH_ENDPOINT + "/unsubscribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ endpoint: subscription.endpoint })
            })
              .catch(function (err) {
                console.error("VRS: unsubscribeFromPush server call failed", err);
              })
              .then(function () {
                return subscription.unsubscribe();
              });
          });
        })
        .catch(function (err) {
          console.error("VRS: unsubscribeFromPush failed", err);
          return false;
        });
    } catch (err) {
      console.error("VRS: unsubscribeFromPush failed", err);
      return Promise.resolve(false);
    }
  }

  // Fire-and-forget: tells the Worker to push every subscribed interpreter.
  // A push failure must never block or break a call, so every error path here
  // is swallowed rather than surfaced.
  function notifyInterpreters(roomId) {
    if (!pushConfigured()) return Promise.resolve();
    try {
      return fetch(VRS_PUSH_ENDPOINT + "/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: roomId }),
        keepalive: true
      })
        .catch(function (err) {
          console.error("VRS: notifyInterpreters failed", err);
        })
        .then(function () {});
    } catch (err) {
      console.error("VRS: notifyInterpreters failed", err);
      return Promise.resolve();
    }
  }

  return {
    init: init,
    ready: ready,
    signInWithEmail: signInWithEmail,
    signInAsGuest: signInAsGuest,
    signInAsGuest: signInAsGuest,
    signUpWithEmail: signUpWithEmail,
    signInWithGoogle: signInWithGoogle,
    consumeRedirectResult: consumeRedirectResult,
    isAdminUser: isAdminUser,
    listInterpreters: listInterpreters,
    setInterpreterApproved: setInterpreterApproved,
    signOutUser: signOutUser,
    currentAuthUser: currentAuthUser,
    currentUid: currentUid,
    isInterpreterAccount: isInterpreterAccount,
    getInterpreterProfile: getInterpreterProfile,
    getStudentProfile: getStudentProfile,
    saveStudentProfile: saveStudentProfile,
    touchStudent: touchStudent,
    detectUserRole: detectUserRole,
    saveInterpreterProfile: saveInterpreterProfile,
    touchInterpreter: touchInterpreter,
    isFirebaseConfigured: isFirebaseConfigured,
    showSetupBanner: showSetupBanner,
    nowTs: nowTs,
    generateId: generateId,
    generateRoomCode: generateRoomCode,
    createRoom: createRoom,
    getRoom: getRoom,
    updateRoom: updateRoom,
    listenRoom: listenRoom,
    endRoom: endRoom,
    pushToQueue: pushToQueue,
    updateQueueEntry: updateQueueEntry,
    removeFromQueue: removeFromQueue,
    listenQueue: listenQueue,
    addParticipant: addParticipant,
    listenParticipants: listenParticipants,
    removeParticipant: removeParticipant,
    sendSignal: sendSignal,
    listenIncomingSignals: listenIncomingSignals,
    sendChatMessage: sendChatMessage,
    listenChat: listenChat,
    isStale: isStale,
    createMesh: createMesh,
    iceServerConfig: iceServerConfig,
    isSelfMirrored: isSelfMirrored,
    setSelfMirrored: setSelfMirrored,
    setTileMirrored: setTileMirrored,
    isTileMirrored: isTileMirrored,
    attachMirrorButton: attachMirrorButton,
    ensureMirrorStyles: ensureMirrorStyles,
    submitFeedback: submitFeedback,
    getFeedback: getFeedback,
    markFeedbackHandled: markFeedbackHandled,
    mountFeedbackUi: mountFeedbackUi,
    openFeedback: openFeedback,
    closeFeedback: closeFeedback,
    appShell: appShell,
    registerServiceWorker: registerServiceWorker,
    isInstalledApp: isInstalledApp,
    isIOS: isIOS,
    pushConfigured: pushConfigured,
    subscribeToPush: subscribeToPush,
    unsubscribeFromPush: unsubscribeFromPush,
    notifyInterpreters: notifyInterpreters,
    ROOT_PATH: VRS_ROOT_PATH
  };
})();
