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

  function init() {
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
      authPromise = signInAnonymously();
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
        if (auth.currentUser) {
          resolve(auth.currentUser.uid);
          return;
        }
        auth.onAuthStateChanged(function (user) {
          if (user) resolve(user.uid);
        });
        auth.signInAnonymously().catch(reject);
      } catch (err) {
        reject(err);
      }
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
        { urls: "stun:stun1.l.google.com:19302" }
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

        Object.keys(peers).forEach(function (pid) {
          if (ids.indexOf(pid) === -1) removePeer(pid);
        });
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

  return {
    init: init,
    ready: ready,
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
    ROOT_PATH: VRS_ROOT_PATH
  };
})();
