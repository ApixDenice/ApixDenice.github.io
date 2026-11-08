// DIPS web event manager — /dips/events/
//
// Sign in with a DIPS account, create events (single or weekly series) and
// cancel your own upcoming ones. Events are written straight to Firestore,
// exactly like the iOS app writes them (see ./event-model.js), so the security
// rules and server triggers — plan limit, daily rate limit, follower / area
// notifications, statistics — apply unchanged.
//
// Privacy: nothing from Google is loaded for a mere visit. The Firebase SDK is
// loaded only when the visitor starts signing in or already has a session in
// this browser. The map (self-hosted Leaflet + OpenStreetMap tiles) loads only
// after sign-in; the place search contacts OpenStreetMap's Nominatim only when
// the organiser presses Search.

import {
  LIMITS, AUDIENCES, SKILL_LEVELS,
  validateForm, buildEventDocuments, localDateTime, weeklyOccurrences
} from "./event-model.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCMmyksVRzJ6yUOLAwJsTe77rBkZL7po30",   // public client identifier, safe to commit
  authDomain: "hilsports.firebaseapp.com",
  projectId: "hilsports",
  storageBucket: "hilsports.appspot.com",
  messagingSenderId: "552572655098"
  // appId: "1:552572655098:web:…"   ← only needed for App Check (see below)
};
// Fill in ONLY if App Check is enforced for Cloud Firestore in the Firebase
// console (then also set appId above). Empty = App Check not used on the web.
const APP_CHECK_SITE_KEY = "";

const LEAFLET_BASE = new URL("../../lib/leaflet/", import.meta.url).href;
const INVITE_BASE = new URL("../../../dips/e/", import.meta.url).href;
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const DEFAULT_VIEW = { lat: 51.1657, lng: 10.4515, zoom: 6 };   // Germany

// ---------------------------------------------------------------------------
// Small DOM helpers (user content is only ever set via textContent)
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

function showMsg(el, text, kind = "info") {
  el.textContent = text;
  el.className = "auth-msg " + kind;
}
function clearMsg(el) { el.textContent = ""; el.className = "auth-msg"; }

const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDate = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

// ---------------------------------------------------------------------------
// Firebase (lazy)
// ---------------------------------------------------------------------------

let fbPromise = null;
function loadFirebase() {
  if (!fbPromise) {
    fbPromise = (async () => {
      const [appMod, authMod] = await Promise.all([
        import(SDK + "firebase-app.js"),
        import(SDK + "firebase-auth.js")
      ]);
      const app = appMod.initializeApp(FIREBASE_CONFIG);
      if (APP_CHECK_SITE_KEY && FIREBASE_CONFIG.appId) {
        const ac = await import(SDK + "firebase-app-check.js");
        ac.initializeAppCheck(app, {
          provider: new ac.ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
          isTokenAutoRefreshEnabled: true
        });
      }
      const auth = authMod.getAuth(app);
      authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
      authMod.onAuthStateChanged(auth, (user) => { user ? enterManager(user) : leaveManager(); });
      return { app, auth, authMod };
    })().catch((err) => { fbPromise = null; throw err; });
  }
  return fbPromise;
}

let fsPromise = null;
function loadFirestore() {
  if (!fsPromise) {
    fsPromise = Promise.all([loadFirebase(), import(SDK + "firebase-firestore.js")])
      .then(([fb, fsMod]) => ({ db: fsMod.getFirestore(fb.app), fs: fsMod }))
      .catch((err) => { fsPromise = null; throw err; });
  }
  return fsPromise;
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

const AUTH_ERRORS = {
  "auth/invalid-email": "That email address looks invalid.",
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/wrong-password": "Email or password is incorrect.",
  "auth/user-not-found": "Email or password is incorrect.",   // don't reveal which accounts exist
  "auth/user-disabled": "This account has been disabled.",
  "auth/too-many-requests": "Too many attempts. Please try again in a moment.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/unauthorized-domain": "Google sign-in isn't enabled for this website yet.",
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/popup-closed-by-user": "The Google window was closed before signing in.",
  "auth/cancelled-popup-request": "The Google window was closed before signing in.",
  "auth/account-exists-with-different-credential": "This email already uses another sign-in method. Sign in with your password instead."
};
const authError = (err) => AUTH_ERRORS[err && err.code] || "Couldn't sign in. Please try again.";

function initSignIn() {
  const form = $("login-form");
  const btn = $("login-btn");
  const msg = $("auth-msg");

  // Restore an existing session without loading Google code for first-time visitors.
  (async () => {
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        if (dbs.some((d) => d.name === "firebaseLocalStorageDb")) loadFirebase();
      }
    } catch (e) { /* storage unavailable: nothing to restore */ }
  })();

  // Warm up the SDK as soon as the visitor starts filling in the form.
  form.addEventListener("focusin", () => { loadFirebase().catch(() => {}); }, { once: true });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg(msg);
    const email = $("email").value.trim();
    const password = $("password").value;
    if (!email || !password) { showMsg(msg, "Please enter your email and password.", "error"); return; }
    btn.disabled = true; btn.textContent = "Signing in…";
    try {
      const { auth, authMod } = await loadFirebase();
      await authMod.signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      showMsg(msg, authError(err), "error");
    } finally {
      btn.disabled = false; btn.textContent = "Sign in";
    }
  });

  $("reset-btn").addEventListener("click", async () => {
    clearMsg(msg);
    const email = $("email").value.trim();
    if (!email) { showMsg(msg, "Enter your email above, then tap “Forgot password?” again.", "error"); $("email").focus(); return; }
    try {
      const { auth, authMod } = await loadFirebase();
      await authMod.sendPasswordResetEmail(auth, email);
    } catch (err) {
      if (err && err.code === "auth/invalid-email") { showMsg(msg, authError(err), "error"); return; }
      // Any other outcome gets the same answer, so the form can't be used to test which emails exist.
    }
    showMsg(msg, "If a DIPS account uses this email, a link to reset the password is on its way.", "info");
  });

  $("google-btn").addEventListener("click", async () => {
    clearMsg(msg);
    try {
      const { auth, authMod } = await loadFirebase();
      await authMod.signInWithPopup(auth, new authMod.GoogleAuthProvider());
    } catch (err) {
      showMsg(msg, authError(err), "error");
    }
  });

  $("logout-btn").addEventListener("click", async () => {
    try { const { auth, authMod } = await loadFirebase(); await authMod.signOut(auth); } catch (e) {}
  });
}

// ---------------------------------------------------------------------------
// Manager state
// ---------------------------------------------------------------------------

const state = {
  user: null,
  username: "",
  unsubscribe: null,
  events: [],              // own upcoming events, sorted by date
  map: null,
  marker: null,
  pin: null,               // { lat, lng }
  pendingCheck: null,      // ids just created, checked against the live list
  expanded: new Set()      // series ids whose dates are shown
};

async function enterManager(user) {
  if (state.user && state.user.uid === user.uid) return;
  state.user = user;
  $("auth-card").style.display = "none";
  $("events-page").classList.add("is-manager");
  $("signed-in").classList.add("show");
  $("who-email").textContent = user.email || "Signed in to DIPS";
  $("who-name").textContent = user.displayName || user.email || "Your account";
  $("avatar").textContent = (user.displayName || user.email || "D").charAt(0).toUpperCase();
  clearMsg($("auth-msg"));

  const msg = $("manager-msg");
  // Signed out (or switched account) while this was still loading.
  const stale = () => state.user !== user;
  try {
    const { db, fs } = await loadFirestore();
    const profile = await fs.getDoc(fs.doc(db, "databaseUserData", user.uid));
    if (stale()) return;
    const username = profile.exists() ? String(profile.get("username") || "") : "";

    if (!profile.exists()) {
      // A Google account that has never been used with DIPS: Firebase just
      // created an empty auth user for it. Remove it again instead of leaving
      // an orphan account without a profile, and send people to the app.
      const isGoogle = user.providerData.some((p) => p.providerId === "google.com");
      const created = Date.parse(user.metadata.creationTime || "");
      if (isGoogle && Date.now() - created < 5 * 60 * 1000) {
        await user.delete().catch(() => {});
      } else {
        const { auth, authMod } = await loadFirebase();
        await authMod.signOut(auth);
      }
      showMsg($("auth-msg"), "There's no DIPS profile for this account yet. Create your account in the DIPS app first, then sign in here.", "error");
      return;
    }
    if (!username) {
      showMsg(msg, "Your profile has no username yet. Open the DIPS app and finish your profile, then reload this page.", "error");
      $("create-btn").disabled = true;
    }
    $("login-form").reset();
    state.username = username;
    $("who-name").textContent = username || user.email;
    $("avatar").textContent = (username || user.email || "D").charAt(0).toUpperCase();

    await Promise.all([loadSports(db, fs), initMap()]);
    if (stale()) return;
    watchMyEvents(db, fs);
  } catch (err) {
    console.error("[DIPS] manager start failed", err);
    showMsg(msg, firestoreError(err, "Couldn't load your DIPS data."), "error");
  }
}

function leaveManager() {
  if (state.unsubscribe) state.unsubscribe();
  state.user = null; state.username = ""; state.unsubscribe = null; state.events = [];
  $("signed-in").classList.remove("show");
  $("events-page").classList.remove("is-manager");
  $("auth-card").style.display = "";
  clearMsg($("manager-msg"));
}

function firestoreError(err, prefix) {
  const code = err && err.code ? String(err.code).replace("firestore/", "") : "";
  if (code === "permission-denied") {
    return `${prefix} The server refused the request (permission denied). Please sign out and in again; if it keeps happening, let me know.`;
  }
  if (code === "unavailable") return `${prefix} You seem to be offline. Check your connection and try again.`;
  return `${prefix} ${code ? "(" + code + ")" : "Please try again."}`;
}

// ---------------------------------------------------------------------------
// Sports catalog
// ---------------------------------------------------------------------------

async function loadSports(db, fs) {
  const select = $("ev-sport");
  const snap = await fs.getDocs(fs.collection(db, "databaseSports"));
  const names = [...new Set(snap.docs.map((d) => d.get("name")).filter((n) => typeof n === "string" && n))]
    .sort((a, b) => a.localeCompare(b, "de"));
  select.replaceChildren(h("option", { value: "" }, "Choose a sport"), ...names.map((n) => h("option", { value: n }, n)));
}

// ---------------------------------------------------------------------------
// Map (self-hosted Leaflet, OpenStreetMap tiles)
// ---------------------------------------------------------------------------

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    document.head.append(h("link", { rel: "stylesheet", href: LEAFLET_BASE + "leaflet.css" }));
    const s = h("script", { src: LEAFLET_BASE + "leaflet.js" });
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error("Map library failed to load"));
    document.head.append(s);
  });
}

async function initMap() {
  if (state.map) { setTimeout(() => state.map.invalidateSize(), 50); return; }
  const L = await loadLeaflet();
  L.Icon.Default.imagePath = LEAFLET_BASE + "images/";
  const map = L.map("ev-map", { scrollWheelZoom: false }).setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lng], DEFAULT_VIEW.zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map);
  map.on("click", (e) => setPin(e.latlng.lat, e.latlng.lng));
  map.on("focus", () => map.scrollWheelZoom.enable());
  map.on("blur", () => map.scrollWheelZoom.disable());
  state.map = map;
  setTimeout(() => map.invalidateSize(), 50);
}

function setPin(lat, lng, { zoom } = {}) {
  const L = window.L;
  state.pin = { lat, lng };
  if (!state.marker) {
    state.marker = L.marker([lat, lng], { draggable: true, autoPan: true, title: "Meeting point" }).addTo(state.map);
    state.marker.on("dragend", () => {
      const p = state.marker.getLatLng();
      state.pin = { lat: p.lat, lng: p.lng };
    });
  } else {
    state.marker.setLatLng([lat, lng]);
  }
  if (zoom) state.map.setView([lat, lng], zoom);
  $("ev-place-hint").textContent = "Meeting point set. Drag the pin to fine-tune it. Meeting points are public, so never use a home address.";
  $("ev-place-hint").classList.add("ok");
}

function initPlaceSearch() {
  const q = $("ev-place-q");
  const list = $("ev-place-results");
  const go = $("ev-place-go");

  async function search() {
    const text = q.value.trim();
    if (text.length < 3) return;
    go.disabled = true; go.textContent = "Searching…";
    try {
      const url = `${NOMINATIM}?format=jsonv2&limit=5&q=${encodeURIComponent(text)}`;
      const res = await fetch(url, { headers: { "Accept-Language": navigator.language || "de" } });
      const results = res.ok ? await res.json() : [];
      list.replaceChildren(...(results.length ? results.map((r) => h("li", {},
        h("button", {
          type: "button",
          onclick: () => {
            setPin(Number(r.lat), Number(r.lon), { zoom: 16 });
            if (!$("ev-venue").value.trim() && r.name) $("ev-venue").value = String(r.name).slice(0, LIMITS.venueMax);
            list.hidden = true;
          }
        }, r.display_name)
      )) : [h("li", { class: "none" }, "Nothing found. Try another name, or click the map.")]));
      list.hidden = false;
    } catch (e) {
      list.replaceChildren(h("li", { class: "none" }, "The search isn't available right now. Click the map instead."));
      list.hidden = false;
    } finally {
      go.disabled = false; go.textContent = "Search";
    }
  }
  go.addEventListener("click", search);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });

  $("ev-locate").addEventListener("click", () => {
    if (!navigator.geolocation || !state.map) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => state.map.setView([pos.coords.latitude, pos.coords.longitude], 15),
      () => showMsg($("form-msg"), "Your location isn't available. Search for the place instead.", "error"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  });
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

function initForm() {
  $("ev-audience").replaceChildren(...AUDIENCES.map((a) => h("option", { value: a.value }, a.label)));
  $("ev-level").replaceChildren(...SKILL_LEVELS.map((s) => h("option", { value: s.value }, s.label)));

  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  $("ev-date").min = isoDay(today);
  $("ev-date").value = isoDay(tomorrow);

  // Character counters
  for (const el of document.querySelectorAll(".counter")) {
    const input = $(el.dataset.for);
    const max = Number(input.getAttribute("maxlength"));
    const update = () => {
      const n = [...input.value].length;
      el.textContent = `${n}/${max}`;
      el.classList.toggle("full", n >= max);
    };
    input.addEventListener("input", update);
    update();
  }

  $("ev-quorum-on").addEventListener("change", (e) => { $("ev-quorum-box").hidden = !e.target.checked; });

  const repeatOn = $("ev-repeat-on");
  repeatOn.addEventListener("change", () => {
    $("ev-repeat-box").hidden = !repeatOn.checked;
    if (repeatOn.checked) {
      const start = localDateTime($("ev-date").value, $("ev-time").value);
      if (start && !selectedWeekdays().length) {
        const chip = document.querySelector(`.weekday-chips input[value="${start.getDay()}"]`);
        if (chip) chip.checked = true;
      }
      if (start && !$("ev-until").value) {
        $("ev-until").value = isoDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * 8));
      }
    }
    updateRepeatPreview();
  });
  for (const el of document.querySelectorAll(".weekday-chips input, #ev-until, #ev-date, #ev-time")) {
    el.addEventListener("change", updateRepeatPreview);
  }

  $("event-form").addEventListener("submit", onCreate);
}

function selectedWeekdays() {
  return [...document.querySelectorAll(".weekday-chips input:checked")].map((c) => Number(c.value));
}

function readForm() {
  const start = localDateTime($("ev-date").value, $("ev-time").value);
  const until = $("ev-until").value ? localDateTime($("ev-until").value, "00:00") : null;
  const duration = $("ev-duration").value;
  return {
    sport: $("ev-sport").value,
    title: $("ev-title").value,
    details: $("ev-details").value,
    start,
    capacity: Number($("ev-capacity").value),
    minParticipants: $("ev-quorum-on").checked ? Number($("ev-quorum").value) : null,
    durationMinutes: duration ? Number(duration) : null,
    venueName: $("ev-venue").value,
    latitude: state.pin ? state.pin.lat : undefined,
    longitude: state.pin ? state.pin.lng : undefined,
    audience: $("ev-audience").value,
    skillLevel: $("ev-level").value,
    repeat: $("ev-repeat-on").checked ? { weekdays: selectedWeekdays(), until } : null
  };
}

function updateRepeatPreview() {
  const btn = $("create-btn");
  const out = $("ev-repeat-preview");
  if (!$("ev-repeat-on").checked) { btn.textContent = "Create event"; out.textContent = ""; return; }
  const f = readForm();
  if (!f.start || !f.repeat.until || !f.repeat.weekdays.length) {
    out.textContent = "Pick the weekdays and the last day."; btn.textContent = "Create events"; return;
  }
  const { dates, capped } = weeklyOccurrences(f.start, f.repeat.weekdays, f.repeat.until);
  if (!dates.length) { out.textContent = "No dates fall in this range."; btn.textContent = "Create events"; return; }
  const first = dates[0], last = dates[dates.length - 1];
  out.textContent = `${dates.length} event${dates.length === 1 ? "" : "s"}: ${fmtDate.format(first)} – ${fmtDate.format(last)}, ${fmtTime.format(first)}`
    + (capped ? ` · A series can have at most ${LIMITS.seriesMax} dates, so it stops there.` : "");
  btn.textContent = dates.length === 1 ? "Create event" : `Create ${dates.length} events`;
}

async function onCreate(e) {
  e.preventDefault();
  const msg = $("form-msg");
  clearMsg(msg);
  if (!state.user) return;
  if (!state.username) { showMsg(msg, "Finish your profile (username) in the DIPS app first.", "error"); return; }

  const f = readForm();
  const problems = validateForm(f);
  if (problems.length) { showMsg(msg, problems.join(" "), "error"); return; }

  const docs = buildEventDocuments(f, { uid: state.user.uid, username: state.username });
  if (!docs.length) { showMsg(msg, "No dates fall in this range.", "error"); return; }

  const btn = $("create-btn");
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = docs.length > 1 ? `Creating ${docs.length} events…` : "Creating…";
  try {
    const { db, fs } = await loadFirestore();
    // One batch per ≤ 400 documents (a series is at most 26). All-or-nothing:
    // the rules check every document, so a bad one fails the whole series.
    for (let i = 0; i < docs.length; i += 400) {
      const batch = fs.writeBatch(db);
      for (const { id, data } of docs.slice(i, i + 400)) {
        batch.set(fs.doc(db, "databaseMapEvents", id), { ...data, date: fs.Timestamp.fromDate(data.date) });
      }
      await batch.commit();
    }
    showMsg(msg, docs.length > 1
      ? `${docs.length} events created. They're live in the DIPS app.`
      : "Event created. It's live in the DIPS app.", "info");
    // Plan limit and daily rate limit are enforced by the server right after
    // the write and remove whatever is over — check back and say so.
    scheduleLimitCheck(docs.map((d) => d.id));
    $("ev-title").value = ""; $("ev-details").value = "";
    $("ev-title").dispatchEvent(new Event("input")); $("ev-details").dispatchEvent(new Event("input"));
  } catch (err) {
    console.error("[DIPS] create failed", err);
    showMsg(msg, firestoreError(err, "The event couldn't be saved."), "error");
  } finally {
    btn.disabled = false; btn.textContent = label;
    updateRepeatPreview();
  }
}

function scheduleLimitCheck(ids) {
  const check = () => {
    const live = new Set(state.events.map((ev) => ev.id));
    const removed = ids.filter((id) => !live.has(id));
    if (removed.length) {
      showMsg($("form-msg"), removed.length === ids.length
        ? "The server removed this right away: you've reached the number of events your plan allows for this period. The DIPS app shows your plan under “Konto & Abo”."
        : `${ids.length - removed.length} of ${ids.length} events were kept. The rest went over the number of events your plan allows per period and were removed. The DIPS app shows your plan under “Konto & Abo”.`, "error");
    }
  };
  clearTimeout(state.pendingCheck);
  state.pendingCheck = setTimeout(check, 9000);
}

// ---------------------------------------------------------------------------
// Your upcoming events (live)
// ---------------------------------------------------------------------------

function watchMyEvents(db, fs) {
  if (state.unsubscribe) state.unsubscribe();
  const q = fs.query(fs.collection(db, "databaseMapEvents"), fs.where("ownerId", "==", state.user.uid));
  state.unsubscribe = fs.onSnapshot(q, (snap) => {
    const now = Date.now();
    state.events = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .map((ev) => ({ ...ev, when: ev.date && ev.date.toDate ? ev.date.toDate() : null }))
      .filter((ev) => ev.when && ev.when.getTime() > now - 60 * 60 * 1000)
      .sort((a, b) => a.when - b.when);
    renderMyEvents(db, fs);
    // Start the map where the organiser usually meets.
    const last = state.events.find((ev) => typeof ev.latitude === "number");
    if (last && state.map && !state.pin && !state.centeredOnce) {
      state.centeredOnce = true;
      state.map.setView([last.latitude, last.longitude], 13);
    }
  }, (err) => {
    console.error("[DIPS] events listener", err);
    $("my-events").replaceChildren(h("li", { class: "my-events-empty" }, firestoreError(err, "Couldn't load your events.")));
  });
}

function renderMyEvents(db, fs) {
  const list = $("my-events");
  $("my-events-count").textContent = state.events.length ? String(state.events.length) : "";
  if (!state.events.length) {
    list.replaceChildren(h("li", { class: "my-events-empty" }, "No upcoming events yet. Create your first one on the left."));
    return;
  }
  // A weekly series shows as one row (first upcoming date + "n dates"), expandable.
  const groups = [];
  const bySeries = new Map();
  for (const ev of state.events) {
    if (ev.seriesId) {
      if (!bySeries.has(ev.seriesId)) { const g = { series: ev.seriesId, items: [] }; bySeries.set(ev.seriesId, g); groups.push(g); }
      bySeries.get(ev.seriesId).items.push(ev);
    } else {
      groups.push({ series: null, items: [ev] });
    }
  }
  list.replaceChildren(...groups.map((g) => g.items.length > 1 ? seriesRow(g, db, fs) : eventRow(g.items[0], db, fs)));
}

const goingOf = (ev) => Array.isArray(ev.participantUids) ? ev.participantUids.length
  : Array.isArray(ev.participantNames) ? ev.participantNames.length : 1;
const inviteLink = (ev) => INVITE_BASE + "?id=" + encodeURIComponent(ev.id);

async function deleteEvents(ids, db, fs) {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = fs.writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => batch.delete(fs.doc(db, "databaseMapEvents", id)));
    await batch.commit();
  }
}

/** "Open · Copy link · Cancel" with an inline confirmation (no browser dialogs). */
function actionBar(ev, { cancelIds, cancelLabel, confirmNote, compact = false }, db, fs) {
  const bar = h("div", { class: "ev-actions" });
  const link = inviteLink(ev);
  const copyBtn = h("button", {
    type: "button", class: "link-btn",
    onclick: async () => {
      try { await navigator.clipboard.writeText(link); copyBtn.textContent = "Copied"; }
      catch (e) { window.prompt("Invite link", link); }
      setTimeout(() => { copyBtn.textContent = "Copy link"; }, 1800);
    }
  }, "Copy link");

  const show = () => bar.replaceChildren(...[
    h("a", { class: "link-btn", href: link, target: "_blank", rel: "noopener" }, "Open"),
    compact ? null : copyBtn,
    h("button", { type: "button", class: "link-btn danger", onclick: confirm }, cancelLabel)
  ].filter(Boolean));
  function confirm() {
    bar.replaceChildren(
      h("p", { class: "ev-confirm" }, confirmNote),
      h("div", { class: "ev-confirm-buttons" },
        h("button", { type: "button", class: "btn btn-danger btn-sm", onclick: run },
          cancelIds.length > 1 ? `Cancel all ${cancelIds.length}` : "Cancel event"),
        h("button", { type: "button", class: "link-btn", onclick: show }, "Keep"))
    );
  }
  async function run() {
    bar.replaceChildren(h("span", { class: "hint" }, "Cancelling…"));
    try { await deleteEvents(cancelIds, db, fs); }
    catch (err) {
      console.error("[DIPS] cancel failed", err);
      showMsg($("manager-msg"), firestoreError(err, "Couldn't cancel."), "error");
      show();
    }
  }
  show();
  return bar;
}

function joinedNote(events) {
  const others = events.reduce((n, ev) => n + Math.max(0, goingOf(ev) - 1), 0);
  return others ? `${others} sign-up${others === 1 ? "" : "s"} will be notified.` : "Nobody has joined yet.";
}

function dateTile(when) {
  return h("div", { class: "ev-date" },
    h("b", {}, String(when.getDate())),
    h("span", {}, when.toLocaleString(undefined, { month: "short" })));
}

function goingLine(ev) {
  const going = goingOf(ev);
  const full = typeof ev.participant === "number" && going >= ev.participant;
  return h("p", { class: "ev-going" + (full ? " full" : "") },
    typeof ev.participant === "number" ? `${going}/${ev.participant} going` : `${going} going`);
}

function eventRow(ev, db, fs) {
  return h("li", { class: "ev-row" },
    dateTile(ev.when),
    h("div", { class: "ev-main" },
      h("p", { class: "ev-title" }, String(ev.title || "Untitled")),
      h("p", { class: "ev-meta" },
        `${String(ev.sportsArt || "")} · ${fmtDate.format(ev.when)}, ${fmtTime.format(ev.when)}`
        + (ev.venueName ? ` · ${String(ev.venueName)}` : "")),
      goingLine(ev),
      actionBar(ev, { cancelIds: [ev.id], cancelLabel: "Cancel", confirmNote: joinedNote([ev]) }, db, fs)
    )
  );
}

function seriesRow(group, db, fs) {
  const items = group.items;
  const first = items[0];
  const open = state.expanded.has(group.series);
  const toggle = h("button", {
    type: "button", class: "link-btn", "aria-expanded": String(open),
    onclick: () => {
      if (state.expanded.has(group.series)) state.expanded.delete(group.series); else state.expanded.add(group.series);
      renderMyEvents(db, fs);
    }
  }, open ? "Hide dates" : `Show all ${items.length} dates`);

  const dates = open ? h("ul", { class: "ev-series-dates" }, items.map((ev) => h("li", {},
    h("div", { class: "ev-series-when" },
      h("b", {}, `${fmtDate.format(ev.when)}, ${fmtTime.format(ev.when)}`),
      goingLine(ev)),
    actionBar(ev, { cancelIds: [ev.id], cancelLabel: "Cancel", confirmNote: joinedNote([ev]), compact: true }, db, fs)
  ))) : null;

  return h("li", { class: "ev-row ev-row--series" },
    dateTile(first.when),
    h("div", { class: "ev-main" },
      h("p", { class: "ev-title" }, String(first.title || "Untitled"), h("span", { class: "ev-tag" }, `Series · ${items.length}`)),
      h("p", { class: "ev-meta" },
        `${String(first.sportsArt || "")} · next ${fmtDate.format(first.when)}, ${fmtTime.format(first.when)}`
        + ` · until ${fmtDate.format(items[items.length - 1].when)}`
        + (first.venueName ? ` · ${String(first.venueName)}` : "")),
      h("div", { class: "ev-actions" }, toggle),
      actionBar(first, {
        cancelIds: items.map((ev) => ev.id), cancelLabel: "Cancel whole series",
        confirmNote: `All ${items.length} upcoming dates will be cancelled. ${joinedNote(items)}`, compact: true
      }, db, fs),
      dates
    )
  );
}

// ---------------------------------------------------------------------------

initSignIn();
initForm();
initPlaceSearch();
