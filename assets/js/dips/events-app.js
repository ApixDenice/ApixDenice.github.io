// DIPS web event manager — /dips/events/
//
// Made for trainers, studios and clubs (open to every DIPS account): sign in,
// create single events or whole series (weekly / daily / monthly), show a price
// or sell spots through DIPS, edit and cancel upcoming events.
//
// Events are written straight to Firestore, exactly like the iOS app writes
// them (see ./event-model.js), so the security rules and the server triggers —
// plan limit, daily rate limit, follower / area notifications, statistics,
// change / cancel notifications — apply unchanged. The plan is checked here
// BEFORE writing with a port of the server's logic, like the app's paywall.
//
// Privacy: nothing from Google is loaded for a mere visit. The Firebase SDK is
// loaded only when the visitor starts signing in or already has a session in
// this browser. The map (self-hosted Leaflet + OpenStreetMap tiles) loads only
// after sign-in; the place search contacts OpenStreetMap's Nominatim only when
// the organiser presses Search.

import {
  LIMITS, AUDIENCES, SKILL_LEVELS, ACCOUNT_LABELS, PLAN_LABELS,
  validateForm, buildEventDocuments, buildEditPayload, localDateTime, repeatOccurrences,
  effectivePlan, datesThatFit, fittingDates, usedThisPeriod, plannedDates,
  moneyCapabilities, organiserShareCents, clampSlotCents
} from "./event-model.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
// The WEB app's config (Firebase console → Project settings → Your apps → Web app).
// Do NOT use the key from the iOS app's GoogleService-Info.plist: it is
// restricted to the iOS app, and Google answers every browser request with
// API_KEY_IOS_APP_BLOCKED. The web key is a public client identifier, safe to
// commit; restrict it to the referrer apixdenice.github.io in Google Cloud.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDSoRMvSwrtAZ50QziNGFU2fAxYUfEqOpk",   // web app "DIPS Web"
  authDomain: "hilsports.firebaseapp.com",
  projectId: "hilsports",
  storageBucket: "hilsports.appspot.com",
  messagingSenderId: "552572655098",
  appId: "1:552572655098:web:370762988e39cc93084043"
  // measurementId deliberately left out: no Analytics on the website.
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
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function showMsg(el, text, kind = "info") {
  el.textContent = text;
  el.className = "auth-msg " + kind;
}
function clearMsg(el) { el.textContent = ""; el.className = "auth-msg"; }

const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDate = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const fmtEuro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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
  "auth/account-exists-with-different-credential": "This email already uses another sign-in method. Use the one you chose in the app.",
  "auth/operation-not-allowed": "This sign-in method isn't switched on for the website yet."
};

/** A setup problem on the website's side (API key / project config), not the user's login. */
function isConfigError(err) {
  const text = `${err && err.code} ${err && err.message}`;
  return /API_KEY|api-key|requests-from-referer|iOS client application|are blocked|invalid-api-key|app-not-authorized/i.test(text);
}

function authError(err) {
  if (isConfigError(err)) {
    console.error("[DIPS] sign-in configuration problem", err);
    return "Web sign-in isn't set up correctly yet. This is a problem on the website, not with your account or password. Please try again later.";
  }
  if (err && err.code && !AUTH_ERRORS[err.code]) console.error("[DIPS] sign-in failed", err);
  return AUTH_ERRORS[err && err.code] || "Couldn't sign in. Please try again.";
}

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

  // Sign in with Apple — the same Firebase account as "Mit Apple anmelden" in the
  // app. Needs the Apple provider's web setup (Services ID + key) in the console.
  $("apple-btn").addEventListener("click", async () => {
    clearMsg(msg);
    try {
      const { auth, authMod } = await loadFirebase();
      const provider = new authMod.OAuthProvider("apple.com");
      provider.addScope("email");
      provider.addScope("name");
      await authMod.signInWithPopup(auth, provider);
    } catch (err) {
      showMsg(msg, err && err.code === "auth/operation-not-allowed"
        ? "Sign in with Apple isn't switched on for the website yet."
        : authError(err), "error");
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
  profile: {},
  planConfig: {},
  payments: {},
  plan: null,              // effectivePlan(...)
  money: { canShowPrice: false, canSellSpots: false, reason: null, sellReason: null },
  unsubscribe: null,
  liveAll: [],             // all own events in databaseMapEvents ({id, date, ...})
  doneEvents: [],          // own archived events ({id, date}) — count towards the plan period
  events: [],              // own upcoming events, sorted by date
  map: null,
  marker: null,
  pin: null,               // { lat, lng }
  editing: null,           // the event being edited, or null
  pendingCheck: null,      // ids just created, checked against the live list
  expanded: new Set(),     // series ids whose dates are shown
  db: null,
  fs: null
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
    state.db = db; state.fs = fs;
    const [profile, plansCfg, paymentsCfg, done] = await Promise.all([
      fs.getDoc(fs.doc(db, "databaseUserData", user.uid)),
      fs.getDoc(fs.doc(db, "config", "plans")).catch(() => null),
      fs.getDoc(fs.doc(db, "config", "payments")).catch(() => null),
      fs.getDocs(fs.query(fs.collection(db, "databaseDoneEvents"), fs.where("ownerId", "==", user.uid))).catch(() => null)
    ]);
    if (stale()) return;

    if (!profile.exists()) {
      // A Google / Apple account that has never been used with DIPS: Firebase just
      // created an empty auth user for it. Remove it again instead of leaving
      // an orphan account without a profile, and send people to the app.
      const isSocial = user.providerData.some((p) => p.providerId === "google.com" || p.providerId === "apple.com");
      const created = Date.parse(user.metadata.creationTime || "");
      if (isSocial && Date.now() - created < 5 * 60 * 1000) {
        await user.delete().catch(() => {});
      } else {
        const { auth, authMod } = await loadFirebase();
        await authMod.signOut(auth);
      }
      showMsg($("auth-msg"), "There's no DIPS profile for this account yet. Create your account in the DIPS app first, then sign in here.", "error");
      return;
    }

    $("login-form").reset();
    state.profile = profile.data() || {};
    state.planConfig = (plansCfg && plansCfg.exists() && plansCfg.data()) || {};
    state.payments = (paymentsCfg && paymentsCfg.exists() && paymentsCfg.data()) || {};
    state.doneEvents = done ? done.docs.map((d) => ({ id: d.id, date: toJsDate(d.get("date")) })) : [];
    state.plan = effectivePlan(state.profile, state.planConfig, new Date());
    state.money = moneyCapabilities(state.profile, state.payments);

    const username = String(state.profile.username || "");
    if (!username) {
      showMsg(msg, "Your profile has no username yet. Open the DIPS app and finish your profile, then reload this page.", "error");
      $("create-btn").disabled = true;
    }
    state.username = username;
    const business = state.profile.business && state.profile.business.name;
    $("who-name").textContent = business ? `${business} · ${username}` : (username || user.email);
    $("avatar").textContent = (business || username || user.email || "D").charAt(0).toUpperCase();

    applyMoneyUi();
    renderPlanBar();
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
  stopEditing();
  Object.assign(state, { user: null, username: "", profile: {}, unsubscribe: null, events: [], liveAll: [], doneEvents: [], plan: null });
  $("signed-in").classList.remove("show");
  $("events-page").classList.remove("is-manager");
  $("auth-card").style.display = "";
  $("plan-bar").hidden = true;
  clearMsg($("manager-msg"));
}

const toJsDate = (v) => (v && typeof v.toDate === "function" ? v.toDate() : v instanceof Date ? v : null);

function firestoreError(err, prefix) {
  if (isConfigError(err)) return `${prefix} The website's connection to DIPS isn't set up correctly yet. This is a problem on the website, not with your account.`;
  const code = err && err.code ? String(err.code).replace("firestore/", "") : "";
  if (code === "permission-denied") {
    return `${prefix} The server refused the request (permission denied). Please sign out and in again; if it keeps happening, let me know.`;
  }
  if (code === "unavailable") return `${prefix} You seem to be offline. Check your connection and try again.`;
  return `${prefix} ${code ? "(" + code + ")" : "Please try again."}`;
}

// ---------------------------------------------------------------------------
// Plan bar ("Trainer · Business plan · 3 of 30 this week")
// ---------------------------------------------------------------------------

/** Every own event the server counts for the plan (live + archived), optionally without one. */
function planEvents(exceptId = null) {
  return [...state.liveAll, ...state.doneEvents].filter((e) => e.date && e.id !== exceptId).map((e) => ({ id: e.id, date: e.date }));
}

function renderPlanBar() {
  const p = state.plan;
  if (!p) return;
  const bar = $("plan-bar");
  const per = p.limits.period === "week" ? "this week" : "this month";
  const used = usedThisPeriod(planEvents(), p.limits, new Date());
  const early = p.source === "earlyAccess";
  $("plan-chip").textContent = `${ACCOUNT_LABELS[p.accountType]} account · ${PLAN_LABELS[p.plan]} plan${early ? " (early access)" : ""}`;
  $("plan-usage").textContent = `${used} of ${p.limits.limit} events ${per}`;
  $("plan-usage").classList.toggle("full", used >= p.limits.limit);
  bar.hidden = false;
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
  map.on("click", (e) => { if (!state.editing) setPin(e.latlng.lat, e.latlng.lng); });
  map.on("focus", () => map.scrollWheelZoom.enable());
  map.on("blur", () => map.scrollWheelZoom.disable());
  state.map = map;
  setTimeout(() => map.invalidateSize(), 50);
}

function setPin(lat, lng, { zoom, locked = false } = {}) {
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
  if (state.marker.dragging) locked ? state.marker.dragging.disable() : state.marker.dragging.enable();
  if (zoom) state.map.setView([lat, lng], zoom);
  const hint = $("ev-place-hint");
  hint.textContent = locked
    ? "The meeting point can't be moved once an event exists (as in the app). If it changes, cancel and create the event again."
    : "Meeting point set. Drag the pin to fine-tune it. Meeting points are public, so never use a home address.";
  hint.classList.toggle("ok", !locked);
}

function clearPin() {
  state.pin = null;
  if (state.marker) { state.marker.remove(); state.marker = null; }
  $("ev-place-hint").textContent = "Click the map to set the meeting point, then drag the pin to fine-tune it. Meeting points are public, so never use a home address.";
  $("ev-place-hint").classList.remove("ok");
}

function initPlaceSearch() {
  const q = $("ev-place-q");
  const list = $("ev-place-results");
  const go = $("ev-place-go");

  async function search() {
    const text = q.value.trim();
    if (text.length < 3 || state.editing) return;
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
// Prices (trainer & club accounts)
// ---------------------------------------------------------------------------

function applyMoneyUi() {
  const m = state.money;
  const costOn = $("ev-cost-on"), sellOn = $("ev-sell-on");
  costOn.disabled = !m.canShowPrice;
  sellOn.disabled = !m.canSellSpots;
  if (!m.canShowPrice) { costOn.checked = false; $("ev-cost-box").hidden = true; }
  if (!m.canSellSpots) { sellOn.checked = false; $("ev-sell-box").hidden = true; }
  const note = $("price-note");
  const text = !m.canShowPrice ? m.reason : !m.canSellSpots ? m.sellReason : null;
  note.hidden = !text;
  note.replaceChildren();
  if (text) {
    note.append(text + " ");
    if (!m.canShowPrice && m.reason && m.reason.startsWith("Prices are for")) {
      note.append(h("a", { href: new URL("../../../dips/#plans", import.meta.url).href }, "See the plans"));
    }
  }
  $("price-block").classList.toggle("is-locked", !m.canShowPrice);
  updateSlotShare();
}

function updateSlotShare() {
  const euros = Number($("ev-slot").value);
  const out = $("ev-slot-share");
  if (!Number.isFinite(euros) || euros <= 0) { out.textContent = ""; return; }
  const cents = clampSlotCents(Math.round(euros * 100));
  out.textContent = `You receive about ${fmtEuro.format(organiserShareCents(cents) / 100)} per spot (after card fees and the 5 % DIPS fee). Payouts go to the account you set up in the app.`;
}

function initPrices() {
  $("ev-cost-on").addEventListener("change", (e) => {
    $("ev-cost-box").hidden = !e.target.checked;
    if (e.target.checked && $("ev-sell-on").checked) { $("ev-sell-on").checked = false; $("ev-sell-box").hidden = true; }
  });
  $("ev-sell-on").addEventListener("change", (e) => {
    $("ev-sell-box").hidden = !e.target.checked;
    // A paid spot shows its own price; the two are exclusive, as in the app.
    if (e.target.checked && $("ev-cost-on").checked) { $("ev-cost-on").checked = false; $("ev-cost-box").hidden = true; }
  });
  $("ev-slot").addEventListener("input", updateSlotShare);
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
        const chip = document.querySelector(`#ev-weekdays input[value="${start.getDay()}"]`);
        if (chip) chip.checked = true;
      }
      if (start && !$("ev-until").value) {
        $("ev-until").value = isoDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * 8));
      }
    }
    updateRepeatPreview();
  });
  $("ev-repeat-mode").addEventListener("change", () => {
    $("ev-weekdays").hidden = $("ev-repeat-mode").value !== "weekly";
    updateRepeatPreview();
  });
  for (const el of document.querySelectorAll("#ev-weekdays input, #ev-until, #ev-date, #ev-time")) {
    el.addEventListener("change", updateRepeatPreview);
  }

  $("event-form").addEventListener("submit", onSubmit);
  $("edit-stop").addEventListener("click", () => stopEditing());
}

function selectedWeekdays() {
  return [...document.querySelectorAll("#ev-weekdays input:checked")].map((c) => Number(c.value));
}

function readForm() {
  const start = localDateTime($("ev-date").value, $("ev-time").value);
  const until = $("ev-until").value ? localDateTime($("ev-until").value, "00:00") : null;
  const duration = $("ev-duration").value;
  const editing = state.editing;
  const sell = $("ev-sell-on").checked;
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
    costPerPerson: !sell && $("ev-cost-on").checked ? Number($("ev-cost").value) : null,
    // When editing, paid-spot terms stay as they are (not part of an edit, as in the app).
    priceCents: editing ? (editing.paidSlots ? editing.priceCents : null)
      : sell ? clampSlotCents(Math.round(Number($("ev-slot").value) * 100)) : null,
    repeat: !editing && $("ev-repeat-on").checked
      ? { mode: $("ev-repeat-mode").value, weekdays: selectedWeekdays(), until }
      : null
  };
}

function seriesMax() { return state.plan ? state.plan.limits.seriesMax : LIMITS.seriesMax; }

function updateRepeatPreview() {
  const btn = $("create-btn");
  const out = $("ev-repeat-preview");
  $("fit-offer").hidden = true;
  if (state.editing) { btn.textContent = "Save changes"; return; }
  if (!$("ev-repeat-on").checked) { btn.textContent = "Create event"; out.textContent = ""; return; }
  const f = readForm();
  if (!f.start || !f.repeat.until || (f.repeat.mode === "weekly" && !f.repeat.weekdays.length)) {
    out.textContent = f.repeat.mode === "weekly" ? "Pick the weekdays and the last day." : "Pick the last day.";
    btn.textContent = "Create events"; return;
  }
  const max = seriesMax();
  const { dates, capped } = repeatOccurrences(f.start, f.repeat, max);
  if (!dates.length) { out.textContent = "No dates fall in this range."; btn.textContent = "Create events"; return; }
  const first = dates[0], last = dates[dates.length - 1];
  let text = `${plural(dates.length, "date", "dates")}: ${fmtDate.format(first)} – ${fmtDate.format(last)}, ${fmtTime.format(first)}`;
  if (capped) {
    text += max < LIMITS.seriesMax
      ? ` · Your plan allows series of up to ${max} dates.`
      : ` · A series can have at most ${max} dates, so it stops there.`;
  }
  if (state.plan) {
    const fit = datesThatFit(dates, planEvents(), state.plan.limits);
    if (fit < dates.length) {
      text += ` · Only ${fit} fit your plan's limit of ${state.plan.limits.limit} per ${state.plan.limits.period}.`;
    }
  }
  out.textContent = text;
  btn.textContent = dates.length === 1 ? "Create event" : `Create ${dates.length} events`;
}

async function onSubmit(e) {
  e.preventDefault();
  if (state.editing) return saveEdit();
  return create();
}

async function create(onlyDates = null) {
  const msg = $("form-msg");
  clearMsg(msg);
  $("fit-offer").hidden = true;
  if (!state.user) return;
  if (!state.username) { showMsg(msg, "Finish your profile (username) in the DIPS app first.", "error"); return; }

  const f = readForm();
  const problems = validateForm(f, new Date(), { money: state.money });
  if (problems.length) { showMsg(msg, problems.join(" "), "error"); return; }

  // Plan check before anything is written — the app's paywall step. The server
  // checks again and removes whatever is over the limit.
  let dates = onlyDates || plannedDates(f, seriesMax());
  if (!dates.length) { showMsg(msg, "No dates fall in this range.", "error"); return; }
  if (!onlyDates && state.plan) {
    const limits = state.plan.limits;
    const fits = fittingDates(dates, planEvents(), limits);
    const per = limits.period === "week" ? "week" : "month";
    if (fits.length === 0) {
      showMsg(msg, `That would go over your plan: ${PLAN_LABELS[state.plan.plan]} allows ${limits.limit} events per ${per}, and ${dates.length === 1 ? "that " + per + " is" : "those " + per + "s are"} already full.`, "error");
      offerPlans();
      return;
    }
    if (fits.length < dates.length) {
      showMsg(msg, `Only ${fits.length} of ${dates.length} dates fit your plan (${limits.limit} events per ${per}). The rest fall into ${per}s that are already full.`, "error");
      const offer = $("fit-offer");
      offer.replaceChildren(
        h("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => create(fits) }, `Create the ${fits.length} that fit`),
        h("a", { class: "link-btn", href: new URL("../../../dips/#plans", import.meta.url).href }, "Compare plans")
      );
      offer.hidden = false;
      return;
    }
  }

  const docs = buildEventDocuments(f, { uid: state.user.uid, username: state.username }, { dates });
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

function offerPlans() {
  const offer = $("fit-offer");
  offer.replaceChildren(h("a", { class: "link-btn", href: new URL("../../../dips/#plans", import.meta.url).href }, "Compare plans"));
  offer.hidden = false;
}

function scheduleLimitCheck(ids) {
  const check = () => {
    const live = new Set(state.liveAll.map((ev) => ev.id));
    const removed = ids.filter((id) => !live.has(id));
    if (removed.length) {
      showMsg($("form-msg"), removed.length === ids.length
        ? "The server removed this right away because it goes over your plan's limit for that period. Your plan is shown above."
        : `${ids.length - removed.length} of ${ids.length} events were kept. The rest went over your plan's limit for their period and were removed.`, "error");
    }
  };
  clearTimeout(state.pendingCheck);
  state.pendingCheck = setTimeout(check, 9000);
}

// ---------------------------------------------------------------------------
// Edit (same fields as the app's edit screen)
// ---------------------------------------------------------------------------

function startEditing(ev) {
  state.editing = ev;
  const form = $("event-form");
  $("new-event-title").textContent = "Edit event";
  $("edit-banner-title").textContent = String(ev.title || "this event");
  $("edit-banner").hidden = false;
  $("repeat-block").hidden = true;
  clearMsg($("form-msg"));

  if (![...$("ev-sport").options].some((o) => o.value === ev.sportsArt)) {
    $("ev-sport").append(h("option", { value: ev.sportsArt }, ev.sportsArt));
  }
  $("ev-sport").value = ev.sportsArt || "";
  $("ev-title").value = ev.title || "";
  $("ev-details").value = ev.details || "";
  $("ev-date").value = isoDay(ev.when);
  $("ev-time").value = hhmm(ev.when);
  const dur = ev.durationMinutes != null ? String(ev.durationMinutes) : "";
  if (dur && ![...$("ev-duration").options].some((o) => o.value === dur)) {
    $("ev-duration").append(h("option", { value: dur }, `${dur} min`));
  }
  $("ev-duration").value = dur;
  $("ev-venue").value = ev.venueName || "";
  $("ev-capacity").value = String(ev.participant || LIMITS.capacityDefault);
  $("ev-audience").value = ev.audience || "all";
  $("ev-level").value = ev.skillLevel || "any";
  $("ev-quorum-on").checked = ev.minParticipants != null;
  $("ev-quorum-box").hidden = ev.minParticipants == null;
  if (ev.minParticipants != null) $("ev-quorum").value = String(ev.minParticipants);

  // Prices: a shown price can be changed; paid-spot terms can't (as in the app).
  const paid = ev.paidSlots === true;
  $("ev-sell-on").checked = paid;
  $("ev-sell-on").disabled = true;
  $("ev-sell-box").hidden = !paid;
  $("ev-slot").disabled = true;
  if (paid) { $("ev-slot").value = String((ev.priceCents || 0) / 100); updateSlotShare(); }
  $("ev-cost-on").checked = !paid && ev.costPerPerson != null;
  $("ev-cost-on").disabled = paid || !state.money.canShowPrice;
  $("ev-cost-box").hidden = !$("ev-cost-on").checked;
  if (ev.costPerPerson != null) $("ev-cost").value = String(ev.costPerPerson);

  if (typeof ev.latitude === "number") setPin(ev.latitude, ev.longitude, { zoom: 15, locked: true });
  ["ev-place-q", "ev-place-go"].forEach((id) => { $(id).disabled = true; });
  ["ev-title", "ev-details"].forEach((id) => $(id).dispatchEvent(new Event("input")));
  updateRepeatPreview();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function stopEditing() {
  if (!state.editing) return;
  state.editing = null;
  $("new-event-title").textContent = "New event";
  $("edit-banner").hidden = true;
  $("repeat-block").hidden = false;
  ["ev-place-q", "ev-place-go", "ev-slot"].forEach((id) => { $(id).disabled = false; });
  $("ev-title").value = ""; $("ev-details").value = ""; $("ev-venue").value = "";
  ["ev-title", "ev-details"].forEach((id) => $(id).dispatchEvent(new Event("input")));
  $("ev-sell-on").checked = false; $("ev-sell-box").hidden = true;
  $("ev-cost-on").checked = false; $("ev-cost-box").hidden = true;
  applyMoneyUi();
  clearPin();
  updateRepeatPreview();
  if (state.db) renderMyEvents(state.db, state.fs);   // drop the "editing" outline
}

async function saveEdit() {
  const msg = $("form-msg");
  clearMsg(msg);
  // Check against the live document: people may have joined since "Edit" was clicked.
  const ev = state.liveAll.find((e) => e.id === state.editing.id) || state.editing;
  const f = readForm();
  const problems = validateForm(f, new Date(), { editing: true, money: state.money });
  // An existing paid event keeps its terms even if payouts were switched off since.
  const relevant = ev.paidSlots ? problems.filter((p) => !/spot|payout|Selling/i.test(p)) : problems;
  const going = goingOf(ev);
  if (f.capacity < going) relevant.push(`${going} people have already joined, so the group can't be smaller than ${going}.`);
  if (relevant.length) { showMsg(msg, relevant.join(" "), "error"); return; }

  const { set, cleared } = buildEditPayload(f);
  const btn = $("create-btn");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const { db, fs } = await loadFirestore();
    const update = { ...set, date: fs.Timestamp.fromDate(set.date) };
    for (const key of cleared) update[key] = fs.deleteField();
    await fs.updateDoc(fs.doc(db, "databaseMapEvents", ev.id), update);
    const others = Math.max(0, going - 1);
    // The server pushes a notice to the roster when the time changes (onEventChangedNotify).
    const timeChanged = ev.when && set.date.getTime() !== ev.when.getTime();
    stopEditing();
    showMsg(msg, others && timeChanged
      ? `Changes saved. ${plural(others, "person who joined gets", "people who joined get")} a notice about the new time.`
      : "Changes saved.", "info");
  } catch (err) {
    console.error("[DIPS] edit failed", err);
    showMsg(msg, firestoreError(err, "The changes couldn't be saved."), "error");
  } finally {
    btn.disabled = false;
    updateRepeatPreview();
  }
}

// ---------------------------------------------------------------------------
// Your upcoming events (live)
// ---------------------------------------------------------------------------

function watchMyEvents(db, fs) {
  if (state.unsubscribe) state.unsubscribe();
  const q = fs.query(fs.collection(db, "databaseMapEvents"), fs.where("ownerId", "==", state.user.uid));
  state.unsubscribe = fs.onSnapshot(q, (snap) => {
    const now = Date.now();
    state.liveAll = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .map((ev) => ({ ...ev, when: toJsDate(ev.date) }))
      .map((ev) => ({ ...ev, date: ev.when }));
    state.events = state.liveAll
      .filter((ev) => ev.when && ev.when.getTime() > now - 60 * 60 * 1000)
      .sort((a, b) => a.when - b.when);
    if (state.editing && !state.events.some((ev) => ev.id === state.editing.id)) {
      stopEditing();
      showMsg($("form-msg"), "That event no longer exists (cancelled or archived).", "error");
    }
    renderMyEvents(db, fs);
    renderPlanBar();
    if (!state.editing) updateRepeatPreview();
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
  // A series shows as one row (first upcoming date + "n dates"), expandable.
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

/** "Edit · Open · Copy link · Cancel" with an inline confirmation (no browser dialogs). */
function actionBar(ev, { cancelIds, cancelLabel, confirmNote, compact = false, editable = true }, db, fs) {
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
    editable ? h("button", { type: "button", class: "link-btn", onclick: () => startEditing(ev) }, "Edit") : null,
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
    try {
      if (state.editing && cancelIds.includes(state.editing.id)) stopEditing();
      await deleteEvents(cancelIds, db, fs);
    } catch (err) {
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
  const paid = events.some((ev) => ev.paidSlots && goingOf(ev) > 1);
  if (!others) return "Nobody has joined yet.";
  return `${plural(others, "sign-up", "sign-ups")} will be notified.` + (paid ? " Paid spots are refunded in full automatically." : "");
}

function dateTile(when) {
  return h("div", { class: "ev-date" },
    h("b", {}, String(when.getDate())),
    h("span", {}, when.toLocaleString(undefined, { month: "short" })));
}

function goingLine(ev) {
  const going = goingOf(ev);
  const full = typeof ev.participant === "number" && going >= ev.participant;
  const price = ev.paidSlots && ev.priceCents ? ` · ${fmtEuro.format(ev.priceCents / 100)} per spot`
    : ev.costPerPerson != null ? (ev.costPerPerson > 0 ? ` · ${fmtEuro.format(ev.costPerPerson)} on site` : " · free") : "";
  return h("p", { class: "ev-going" + (full ? " full" : "") },
    (typeof ev.participant === "number" ? `${going}/${ev.participant} going` : `${going} going`) + price);
}

function eventRow(ev, db, fs) {
  return h("li", { class: "ev-row" + (state.editing && state.editing.id === ev.id ? " is-editing" : "") },
    dateTile(ev.when),
    h("div", { class: "ev-main" },
      h("p", { class: "ev-title" }, String(ev.title || "Untitled"),
        ev.paidSlots ? h("span", { class: "ev-tag ev-tag--paid" }, "Paid") : null),
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

  const dates = open ? h("ul", { class: "ev-series-dates" }, items.map((ev) => h("li", { class: state.editing && state.editing.id === ev.id ? "is-editing" : null },
    h("div", { class: "ev-series-when" },
      h("b", {}, `${fmtDate.format(ev.when)}, ${fmtTime.format(ev.when)}`),
      goingLine(ev)),
    actionBar(ev, { cancelIds: [ev.id], cancelLabel: "Cancel", confirmNote: joinedNote([ev]), compact: true }, db, fs)
  ))) : null;

  return h("li", { class: "ev-row ev-row--series" },
    dateTile(first.when),
    h("div", { class: "ev-main" },
      h("p", { class: "ev-title" }, String(first.title || "Untitled"),
        h("span", { class: "ev-tag" }, `Series · ${items.length}`),
        first.paidSlots ? h("span", { class: "ev-tag ev-tag--paid" }, "Paid") : null),
      h("p", { class: "ev-meta" },
        `${String(first.sportsArt || "")} · next ${fmtDate.format(first.when)}, ${fmtTime.format(first.when)}`
        + ` · until ${fmtDate.format(items[items.length - 1].when)}`
        + (first.venueName ? ` · ${String(first.venueName)}` : "")),
      h("div", { class: "ev-actions" }, toggle),
      actionBar(first, {
        cancelIds: items.map((ev) => ev.id), cancelLabel: "Cancel whole series",
        confirmNote: `All ${items.length} upcoming dates will be cancelled. ${joinedNote(items)}`, compact: true, editable: false
      }, db, fs),
      dates
    )
  );
}

// ---------------------------------------------------------------------------

initSignIn();
initForm();
initPrices();
initPlaceSearch();
