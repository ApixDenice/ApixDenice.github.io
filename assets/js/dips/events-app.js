// DIPS organiser dashboard — /dips/events/
//
// Overview · Events · Paid courses · Revenue · Account, plus an editor for new
// events, new paid courses and edits. German / English (./i18n.js).
//
// Events are written straight to Firestore, exactly like the iOS app writes
// them (./event-model.js), so the security rules and the server triggers —
// plan limit, daily rate limit, follower / area notifications, statistics,
// change / cancel notifications, refunds — apply unchanged. The plan is checked
// here BEFORE writing with a port of the server's logic, like the app's paywall.
// Revenue comes from payments/{id}, which the organiser may read (./revenue-model.js).
// Account type, plan and payouts are server-owned: shown here, changed in the app.
//
// Group size: a private host is one of the group ("group size incl. you"). A
// trainer / club posts the maximum number of PARTICIPANTS and is not one of
// them. The roster always carries the host (like the app writes it, and the
// server's capacity check counts it), so for trainer / club accounts the stored
// `participant` is the entered maximum + 1.
//
// Privacy: nothing from Google is loaded for a mere visit. The Firebase SDK is
// loaded only when the visitor starts signing in or already has a session in
// this browser. The map (self-hosted Leaflet + OpenStreetMap tiles) loads only
// when the editor opens; the place search contacts Nominatim only on Search.

import {
  LIMITS, AUDIENCES, SKILL_LEVELS,
  validateForm, buildEventDocuments, buildEditPayload, localDateTime, repeatOccurrences,
  effectivePlan, datesThatFit, fittingDates, usedThisPeriod, plannedDates,
  moneyCapabilities, clampSlotCents, isBusinessType
} from "./event-model.js";
import { organiserShare, normalise, summarise, rangeOf, byMonth, byCourse, netByEvent } from "./revenue-model.js";
import { t, getLang, setLang, locale, applyStatic } from "./i18n.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
// The WEB app's config (Firebase console → Project settings → Your apps → "DIPS Web").
// Do NOT use the key from the iOS app's GoogleService-Info.plist: it is
// restricted to the iOS app (API_KEY_IOS_APP_BLOCKED in a browser).
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDSoRMvSwrtAZ50QziNGFU2fAxYUfEqOpk",   // web app "DIPS Web"
  authDomain: "hilsports.firebaseapp.com",
  projectId: "hilsports",
  storageBucket: "hilsports.appspot.com",
  messagingSenderId: "552572655098",
  appId: "1:552572655098:web:370762988e39cc93084043"
  // measurementId deliberately left out: no Analytics on the website.
};
// Fill in ONLY if App Check gets enforced for Cloud Firestore (reCAPTCHA Enterprise key).
const APP_CHECK_SITE_KEY = "";

const LEAFLET_BASE = new URL("../../lib/leaflet/", import.meta.url).href;
const INVITE_BASE = new URL("../../../dips/e/", import.meta.url).href;
const PLANS_URL = new URL("../../../dips/#plans", import.meta.url).href;
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const DEFAULT_VIEW = { lat: 51.1657, lng: 10.4515, zoom: 6 };   // Germany
const VIEWS = ["overview", "events", "courses", "revenue", "account"];
const CATEGORIES = ["trainer", "studio", "club", "school", "other"];

// ---------------------------------------------------------------------------
// Small helpers (user content is only ever set via textContent)
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

function showMsg(el, text, kind = "info") { el.textContent = text; el.className = "auth-msg " + kind; }
function clearMsg(el) { el.textContent = ""; el.className = "auth-msg"; }

const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDate = (d) => new Intl.DateTimeFormat(locale(), { weekday: "short", day: "numeric", month: "short" }).format(d);
const fmtTime = (d) => new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(d);
const fmtMonth = (key) => { const [y, m] = key.split("-").map(Number); return new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1)); };
const fmtShortDate = (d) => new Intl.DateTimeFormat(locale(), { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
const euro = (cents) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" }).format(cents / 100);
const toJsDate = (v) => (v && typeof v.toDate === "function" ? v.toDate() : v instanceof Date ? v : null);

// ---------------------------------------------------------------------------
// Firebase (lazy)
// ---------------------------------------------------------------------------

let fbPromise = null;
function loadFirebase() {
  if (!fbPromise) {
    fbPromise = (async () => {
      const [appMod, authMod] = await Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js")]);
      const app = appMod.initializeApp(FIREBASE_CONFIG);
      if (APP_CHECK_SITE_KEY && FIREBASE_CONFIG.appId) {
        const ac = await import(SDK + "firebase-app-check.js");
        ac.initializeAppCheck(app, { provider: new ac.ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
      }
      const auth = authMod.getAuth(app);
      authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
      authMod.onAuthStateChanged(auth, (user) => { user ? enterDashboard(user) : leaveDashboard(); });
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
// Errors
// ---------------------------------------------------------------------------

const AUTH_ERRORS = {
  "auth/invalid-email": "auth.err.invalidEmail",
  "auth/invalid-credential": "auth.err.wrong", "auth/wrong-password": "auth.err.wrong", "auth/user-not-found": "auth.err.wrong",
  "auth/user-disabled": "auth.err.disabled",
  "auth/too-many-requests": "auth.err.tooMany",
  "auth/network-request-failed": "auth.err.network",
  "auth/unauthorized-domain": "auth.err.domain",
  "auth/popup-blocked": "auth.err.popupBlocked",
  "auth/popup-closed-by-user": "auth.err.popupClosed", "auth/cancelled-popup-request": "auth.err.popupClosed",
  "auth/account-exists-with-different-credential": "auth.err.otherMethod",
  "auth/operation-not-allowed": "auth.err.notEnabled"
};

/** A setup problem on the website's side (API key / project config), not the user's login. */
function isConfigError(err) {
  const text = `${err && err.code} ${err && err.message}`;
  return /API_KEY|api-key|requests-from-referer|iOS client application|are blocked|invalid-api-key|app-not-authorized/i.test(text);
}

function authError(err) {
  if (isConfigError(err)) { console.error("[DIPS] sign-in configuration problem", err); return t("auth.err.config"); }
  if (err && err.code && !AUTH_ERRORS[err.code]) console.error("[DIPS] sign-in failed", err);
  return t(AUTH_ERRORS[err && err.code] || "auth.err.generic");
}

function firestoreError(err, prefixKey) {
  const prefix = t(prefixKey);
  if (isConfigError(err)) return `${prefix} ${t("fs.config")}`;
  const code = err && err.code ? String(err.code).replace("firestore/", "") : "";
  if (code === "permission-denied") return `${prefix} ${t("fs.denied")}`;
  if (code === "unavailable") return `${prefix} ${t("fs.offline")}`;
  return `${prefix} ${code ? "(" + code + ")" : t("fs.retry")}`;
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

function initSignIn() {
  const form = $("login-form"), btn = $("login-btn"), msg = $("auth-msg");

  // Restore an existing session without loading Google code for first-time visitors.
  (async () => {
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        if (dbs.some((d) => d.name === "firebaseLocalStorageDb")) loadFirebase();
      }
    } catch (e) { /* storage unavailable: nothing to restore */ }
  })();

  form.addEventListener("focusin", () => { loadFirebase().catch(() => {}); }, { once: true });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg(msg);
    const email = $("email").value.trim(), password = $("password").value;
    if (!email || !password) { showMsg(msg, t("auth.err.wrong"), "error"); return; }
    btn.disabled = true; btn.textContent = t("auth.submitting");
    try {
      const { auth, authMod } = await loadFirebase();
      await authMod.signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      showMsg(msg, authError(err), "error");
    } finally {
      btn.disabled = false; btn.textContent = t("auth.submit");
    }
  });

  $("reset-btn").addEventListener("click", async () => {
    clearMsg(msg);
    const email = $("email").value.trim();
    if (!email) { showMsg(msg, t("auth.needEmail"), "error"); $("email").focus(); return; }
    try {
      const { auth, authMod } = await loadFirebase();
      await authMod.sendPasswordResetEmail(auth, email);
    } catch (err) {
      if (err && err.code === "auth/invalid-email") { showMsg(msg, authError(err), "error"); return; }
      // Any other outcome gets the same answer, so the form can't be used to test which emails exist.
    }
    showMsg(msg, t("auth.resetSent"), "info");
  });

  $("google-btn").addEventListener("click", async () => {
    clearMsg(msg);
    try {
      const { auth, authMod } = await loadFirebase();
      await authMod.signInWithPopup(auth, new authMod.GoogleAuthProvider());
    } catch (err) { showMsg(msg, authError(err), "error"); }
  });

  // Same Firebase account as "Mit Apple anmelden" in the app (needs the Apple web setup in the console).
  $("apple-btn").addEventListener("click", async () => {
    clearMsg(msg);
    try {
      const { auth, authMod } = await loadFirebase();
      const provider = new authMod.OAuthProvider("apple.com");
      provider.addScope("email"); provider.addScope("name");
      await authMod.signInWithPopup(auth, provider);
    } catch (err) {
      showMsg(msg, err && err.code === "auth/operation-not-allowed" ? t("auth.err.appleOff") : authError(err), "error");
    }
  });

  $("logout-btn").addEventListener("click", async () => {
    try { const { auth, authMod } = await loadFirebase(); await authMod.signOut(auth); } catch (e) {}
  });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  user: null, username: "", profile: {}, planConfig: {}, payments: {},
  plan: null,
  money: { canShowPrice: false, canSellSpots: false, reason: null, sellReason: null },
  liveAll: [], doneEvents: [], events: [], payRows: [], payError: null,
  unsubs: [],
  view: "overview", evFilter: "upcoming", revRange: "month",
  editorMode: "new",  // new | course | edit
  editing: null,
  map: null, marker: null, pin: null,
  pendingCheck: null,
  expanded: new Set(),
  db: null, fs: null,
  sportsLoaded: false
};

const isBusiness = () => isBusinessType(state.profile.accountType);

// ---------------------------------------------------------------------------
// Enter / leave
// ---------------------------------------------------------------------------

async function enterDashboard(user) {
  if (state.user && state.user.uid === user.uid) return;
  state.user = user;
  clearMsg($("auth-msg"));
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
      // created an empty auth user for it. Remove it again instead of leaving an
      // orphan account without a profile, and send people to the app.
      const isSocial = user.providerData.some((p) => p.providerId === "google.com" || p.providerId === "apple.com");
      const created = Date.parse(user.metadata.creationTime || "");
      if (isSocial && Date.now() - created < 5 * 60 * 1000) await user.delete().catch(() => {});
      else { const { auth, authMod } = await loadFirebase(); await authMod.signOut(auth); }
      showMsg($("auth-msg"), t("auth.noProfile"), "error");
      return;
    }

    $("login-form").reset();
    state.profile = profile.data() || {};
    state.planConfig = (plansCfg && plansCfg.exists() && plansCfg.data()) || {};
    state.payments = (paymentsCfg && paymentsCfg.exists() && paymentsCfg.data()) || {};
    state.doneEvents = done ? done.docs.map((d) => ({ id: d.id, ...d.data() })).map((e) => ({ ...e, when: toJsDate(e.date), date: toJsDate(e.date) })) : [];
    state.plan = effectivePlan(state.profile, state.planConfig, new Date());
    state.money = moneyCapabilities(state.profile, state.payments);
    state.username = String(state.profile.username || "");

    $("auth-card").hidden = true;
    $("events-hero").hidden = true;
    $("dash").hidden = false;
    $("events-page").classList.add("is-manager");

    if (!state.username) showMsg($("manager-msg"), t("auth.noUsername"), "error");

    watchMyEvents();
    watchPayments();
    renderAll();
    route();
  } catch (err) {
    console.error("[DIPS] dashboard start failed", err);
    showMsg($("auth-msg"), firestoreError(err, "ed.err.load"), "error");
  }
}

function leaveDashboard() {
  state.unsubs.forEach((u) => u()); state.unsubs = [];
  Object.assign(state, { user: null, username: "", profile: {}, events: [], liveAll: [], doneEvents: [], payRows: [], plan: null, editing: null });
  $("dash").hidden = true;
  $("auth-card").hidden = false;
  $("events-hero").hidden = false;
  $("events-page").classList.remove("is-manager");
  delete $("biz-form").dataset.filled;
  clearMsg($("manager-msg"));
}

// ---------------------------------------------------------------------------
// Live data
// ---------------------------------------------------------------------------

function watchMyEvents() {
  const { db, fs } = state;
  const q = fs.query(fs.collection(db, "databaseMapEvents"), fs.where("ownerId", "==", state.user.uid));
  state.unsubs.push(fs.onSnapshot(q, (snap) => {
    const now = Date.now();
    state.liveAll = snap.docs.map((d) => ({ id: d.id, ...d.data() })).map((ev) => ({ ...ev, when: toJsDate(ev.date), date: toJsDate(ev.date) }));
    state.events = state.liveAll.filter((ev) => ev.when && ev.when.getTime() > now - 60 * 60 * 1000).sort((a, b) => a.when - b.when);
    if (state.editing && !state.liveAll.some((ev) => ev.id === state.editing.id)) {
      state.editing = null;
      showMsg($("manager-msg"), t("ev.gone"), "error");
      if (state.view === "editor") location.hash = "#/events";
    }
    renderAll();
  }, (err) => {
    console.error("[DIPS] events listener", err);
    showMsg($("manager-msg"), firestoreError(err, "ed.err.events"), "error");
  }));
}

function watchPayments() {
  const { db, fs } = state;
  const q = fs.query(fs.collection(db, "payments"), fs.where("organiserUid", "==", state.user.uid));
  state.unsubs.push(fs.onSnapshot(q, (snap) => {
    state.payRows = normalise(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    state.payError = null;
    renderAll();
  }, (err) => {
    console.error("[DIPS] payments listener", err);
    state.payError = err;
    renderAll();
  }));
}

/** Every own event the server counts for the plan (live + archived). */
function planEvents() {
  return [...state.liveAll, ...state.doneEvents].filter((e) => e.date).map((e) => ({ id: e.id, date: e.date }));
}

const goingOf = (ev) => Array.isArray(ev.participantUids) ? ev.participantUids.length
  : Array.isArray(ev.participantNames) ? ev.participantNames.length : 1;
/** For trainer / club events the host is not a participant. */
const participantsOf = (ev) => (isBusiness() ? Math.max(0, goingOf(ev) - 1) : goingOf(ev));
const maxOf = (ev) => (typeof ev.participant === "number" ? (isBusiness() ? Math.max(0, ev.participant - 1) : ev.participant) : null);
const inviteLink = (ev) => INVITE_BASE + "?id=" + encodeURIComponent(ev.id);
const titleOf = (eventId) => {
  const ev = state.liveAll.find((e) => e.id === eventId) || state.doneEvents.find((e) => e.id === eventId);
  return ev ? String(ev.title || "—") : t("rev.unknownCourse");
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function route() {
  if (!state.user || $("dash").hidden) return;
  const parts = (location.hash || "#/overview").replace(/^#\/?/, "").split("/");
  const name = parts[0] || "overview";
  if (name === "new" || name === "new-course") { openEditor(name === "new" ? "new" : "course"); return; }
  if (name === "edit") {
    const ev = state.liveAll.find((e) => e.id === decodeURIComponent(parts[1] || ""));
    if (ev) { openEditor("edit", ev); return; }
    location.hash = "#/events"; return;
  }
  showView(VIEWS.includes(name) ? name : "overview");
}

function showView(name) {
  state.view = name;
  for (const v of [...VIEWS, "editor"]) $("view-" + v).hidden = v !== name;
  const editorTab = state.editorMode === "course" || (state.editing && state.editing.paidSlots) ? "courses" : "events";
  document.querySelectorAll(".dash-nav a").forEach((a) => {
    const active = a.dataset.view === name || (name === "editor" && a.dataset.view === editorTab);
    a.classList.toggle("is-active", active);
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  if (name !== "editor") renderView(name);
}

// ---------------------------------------------------------------------------
// Header + views
// ---------------------------------------------------------------------------

function renderAll() {
  if (!state.user || $("dash").hidden) return;
  renderHeader();
  if (state.view !== "editor") renderView(state.view);
}

function renderView(name) {
  ({ overview: renderOverview, events: renderEvents, courses: renderCourses, revenue: renderRevenue, account: renderAccount })[name]?.();
}

function usageText() {
  const p = state.plan;
  const used = usedThisPeriod(planEvents(), p.limits, new Date());
  return { used, text: t(p.limits.period === "week" ? "plan.usageWeek" : "plan.usageMonth", { used, limit: p.limits.limit }) };
}

function planChipText() {
  const p = state.plan;
  return t("plan.chip", { type: t("acct." + p.accountType), plan: t("plan." + p.plan) }) + (p.source === "earlyAccess" ? ` (${t("plan.early")})` : "");
}

function renderHeader() {
  const business = state.profile.business && state.profile.business.name;
  $("who-name").textContent = business ? `${business} · ${state.username}` : (state.username || state.user.email || "");
  $("avatar").textContent = (business || state.username || state.user.email || "D").charAt(0).toUpperCase();
  $("plan-chip").textContent = planChipText();
  const u = usageText();
  $("plan-usage").textContent = u.text;
  $("plan-usage").classList.toggle("full", u.used >= state.plan.limits.limit);
}

function kpi(label, value, sub = null, accent = false) {
  return h("div", { class: "kpi" + (accent ? " kpi--accent" : "") },
    h("span", { class: "kpi-label" }, label), h("b", { class: "kpi-value" }, value), sub ? h("span", { class: "kpi-sub" }, sub) : null);
}

function renderOverview() {
  $("ov-hello").textContent = t("ov.hello", { name: state.username || "" });
  const upcoming = state.events;
  const signups = upcoming.reduce((n, ev) => n + Math.max(0, goingOf(ev) - 1), 0);
  const cap = upcoming.reduce((n, ev) => n + (maxOf(ev) || 0), 0);
  const filled = upcoming.reduce((n, ev) => n + participantsOf(ev), 0);
  const month = summarise(state.payRows, rangeOf("month"));
  $("ov-kpis").replaceChildren(
    kpi(t("ov.kpi.upcoming"), String(upcoming.length)),
    kpi(t("ov.kpi.signups"), String(signups)),
    kpi(t("ov.kpi.fill"), cap ? `${Math.round((filled / cap) * 100)} %` : "–"),
    kpi(t("ov.kpi.revenueMonth"), isBusiness() || state.payRows.length ? euro(month.netCents) : "–", null, true)
  );
  const next = upcoming.slice(0, 4);
  $("ov-next").replaceChildren(...(next.length ? next.map((ev) => compactRow(ev)) : [h("li", { class: "my-events-empty" }, t("ov.nextEmpty"))]));

  const todo = [];
  if (!isBusiness()) todo.push(h("li", {}, t("ov.todo.personal"), " ", h("a", { href: PLANS_URL }, t("ed.seePlans"))));
  else if (state.money.reason === "money.noImpressum") todo.push(h("li", {}, h("a", { href: "#/account" }, t("ov.todo.impressum"))));
  else if (!state.money.canSellSpots && state.money.sellReason === "money.noPayouts") todo.push(h("li", {}, t("ov.todo.payouts")));
  const full = upcoming.filter((ev) => typeof ev.participant === "number" && goingOf(ev) >= ev.participant).length;
  if (full) todo.push(h("li", {}, t("ov.todo.full", { n: full })));
  if (!todo.length) todo.push(h("li", { class: "todo-done" }, t("ov.todo.none")));
  $("ov-todo").replaceChildren(...todo);
}

function compactRow(ev) {
  return h("li", { class: "ev-row ev-row--compact" },
    dateTile(ev.when),
    h("div", { class: "ev-main" },
      h("p", { class: "ev-title" }, String(ev.title || "—"), ev.paidSlots ? h("span", { class: "ev-tag ev-tag--paid" }, t("ev.paid")) : null),
      h("p", { class: "ev-meta" }, `${String(ev.sportsArt || "")} · ${fmtDate(ev.when)}, ${fmtTime(ev.when)}`),
      goingLine(ev)));
}

// ---- Events -------------------------------------------------------------

function renderEvents() {
  document.querySelectorAll("#ev-filter button").forEach((b) => b.classList.toggle("is-active", b.dataset.filter === state.evFilter));
  const list = $("my-events");
  if (state.evFilter === "past") {
    const now = Date.now();
    const past = [...state.liveAll.filter((e) => e.when && e.when.getTime() <= now - 60 * 60 * 1000), ...state.doneEvents.filter((e) => e.when)]
      .sort((a, b) => b.when - a.when).slice(0, 60);
    list.replaceChildren(...(past.length ? past.map((ev) => h("li", { class: "ev-row ev-row--past" }, dateTile(ev.when),
      h("div", { class: "ev-main" },
        h("p", { class: "ev-title" }, String(ev.title || "—"), ev.paidSlots ? h("span", { class: "ev-tag ev-tag--paid" }, t("ev.paid")) : null),
        h("p", { class: "ev-meta" }, `${String(ev.sportsArt || "")} · ${fmtShortDate(ev.when)}, ${fmtTime(ev.when)}`),
        goingLine(ev)))) : [h("li", { class: "my-events-empty" }, t("ev.pastEmpty"))]));
    return;
  }
  if (!state.events.length) {
    list.replaceChildren(h("li", { class: "my-events-empty" }, t("ev.empty"), " ", h("a", { href: "#/new" }, t("ov.newEvent"))));
    return;
  }
  list.replaceChildren(...groupSeries(state.events).map((g) => g.items.length > 1 ? seriesRow(g) : eventRow(g.items[0])));
}

function groupSeries(events) {
  const groups = [], bySeries = new Map();
  for (const ev of events) {
    if (ev.seriesId) {
      if (!bySeries.has(ev.seriesId)) { const g = { series: ev.seriesId, items: [] }; bySeries.set(ev.seriesId, g); groups.push(g); }
      bySeries.get(ev.seriesId).items.push(ev);
    } else groups.push({ series: null, items: [ev] });
  }
  return groups;
}

async function deleteEvents(ids) {
  const { db, fs } = state;
  for (let i = 0; i < ids.length; i += 400) {
    const batch = fs.writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => batch.delete(fs.doc(db, "databaseMapEvents", id)));
    await batch.commit();
  }
}

/** "Edit · Open · Copy link · Cancel" with an inline confirmation (no browser dialogs). */
function actionBar(ev, { cancelIds, cancelLabel, confirmNote, compact = false, editable = true }) {
  const bar = h("div", { class: "ev-actions" });
  const link = inviteLink(ev);
  const copyBtn = h("button", {
    type: "button", class: "link-btn",
    onclick: async () => {
      try { await navigator.clipboard.writeText(link); copyBtn.textContent = t("common.copied"); }
      catch (e) { window.prompt(t("common.copyLink"), link); }
      setTimeout(() => { copyBtn.textContent = t("common.copyLink"); }, 1800);
    }
  }, t("common.copyLink"));
  const show = () => bar.replaceChildren(...[
    editable ? h("a", { class: "link-btn", href: "#/edit/" + encodeURIComponent(ev.id) }, t("common.edit")) : null,
    h("a", { class: "link-btn", href: link, target: "_blank", rel: "noopener" }, t("common.open")),
    compact ? null : copyBtn,
    h("button", { type: "button", class: "link-btn danger", onclick: confirm }, cancelLabel)
  ].filter(Boolean));
  function confirm() {
    bar.replaceChildren(
      h("p", { class: "ev-confirm" }, confirmNote),
      h("div", { class: "ev-confirm-buttons" },
        h("button", { type: "button", class: "btn btn-danger btn-sm", onclick: run }, cancelIds.length > 1 ? t("ev.cancelAll", { n: cancelIds.length }) : t("ev.cancelOne")),
        h("button", { type: "button", class: "link-btn", onclick: show }, t("common.keep"))));
  }
  async function run() {
    bar.replaceChildren(h("span", { class: "hint" }, t("ev.cancelling")));
    try { await deleteEvents(cancelIds); }
    catch (err) { console.error("[DIPS] cancel failed", err); showMsg($("manager-msg"), firestoreError(err, "ed.err.cancel"), "error"); show(); }
  }
  show();
  return bar;
}

function joinedNote(events) {
  const others = events.reduce((n, ev) => n + Math.max(0, goingOf(ev) - 1), 0);
  const paid = events.some((ev) => ev.paidSlots && goingOf(ev) > 1);
  if (!others) return t("ev.nobody");
  return (others === 1 ? t("ev.notifiedOne") : t("ev.notified", { n: others })) + (paid ? " " + t("ev.refunded") : "");
}

function dateTile(when) {
  return h("div", { class: "ev-date" }, h("b", {}, String(when.getDate())), h("span", {}, when.toLocaleString(locale(), { month: "short" })));
}

function goingLine(ev) {
  const going = participantsOf(ev), max = maxOf(ev);
  const full = typeof ev.participant === "number" && goingOf(ev) >= ev.participant;
  const price = ev.paidSlots && ev.priceCents ? " · " + t("ev.perSpot", { price: euro(ev.priceCents) })
    : ev.costPerPerson != null ? " · " + (ev.costPerPerson > 0 ? t("ev.onSite", { price: euro(Math.round(ev.costPerPerson * 100)) }) : t("common.free")) : "";
  return h("p", { class: "ev-going" + (full ? " full" : "") },
    (max != null ? t("ev.going", { going, cap: max }) : t("ev.goingNoCap", { going })) + price);
}

function eventRow(ev) {
  return h("li", { class: "ev-row" },
    dateTile(ev.when),
    h("div", { class: "ev-main" },
      h("p", { class: "ev-title" }, String(ev.title || "—"), ev.paidSlots ? h("span", { class: "ev-tag ev-tag--paid" }, t("ev.paid")) : null),
      h("p", { class: "ev-meta" }, `${String(ev.sportsArt || "")} · ${fmtDate(ev.when)}, ${fmtTime(ev.when)}` + (ev.venueName ? ` · ${String(ev.venueName)}` : "")),
      goingLine(ev),
      actionBar(ev, { cancelIds: [ev.id], cancelLabel: t("ev.cancel"), confirmNote: joinedNote([ev]) })));
}

function seriesRow(group) {
  const items = group.items, first = items[0];
  const open = state.expanded.has(group.series);
  const toggle = h("button", {
    type: "button", class: "link-btn", "aria-expanded": String(open),
    onclick: () => { open ? state.expanded.delete(group.series) : state.expanded.add(group.series); renderView(state.view); }
  }, open ? t("ev.hideDates") : t("ev.showDates", { n: items.length }));
  const dates = open ? h("ul", { class: "ev-series-dates" }, items.map((ev) => h("li", {},
    h("div", { class: "ev-series-when" }, h("b", {}, `${fmtDate(ev.when)}, ${fmtTime(ev.when)}`), goingLine(ev)),
    actionBar(ev, { cancelIds: [ev.id], cancelLabel: t("ev.cancel"), confirmNote: joinedNote([ev]), compact: true })))) : null;
  return h("li", { class: "ev-row ev-row--series" },
    dateTile(first.when),
    h("div", { class: "ev-main" },
      h("p", { class: "ev-title" }, String(first.title || "—"), h("span", { class: "ev-tag" }, t("ev.series", { n: items.length })),
        first.paidSlots ? h("span", { class: "ev-tag ev-tag--paid" }, t("ev.paid")) : null),
      h("p", { class: "ev-meta" }, `${String(first.sportsArt || "")} · ${t("ev.next", { date: `${fmtDate(first.when)}, ${fmtTime(first.when)}` })} · ${t("ev.until", { date: fmtDate(items[items.length - 1].when) })}`
        + (first.venueName ? ` · ${String(first.venueName)}` : "")),
      h("div", { class: "ev-actions" }, toggle),
      actionBar(first, { cancelIds: items.map((ev) => ev.id), cancelLabel: t("ev.cancelSeries"),
        confirmNote: `${t("ev.seriesConfirm", { n: items.length })} ${joinedNote(items)}`, compact: true, editable: false }),
      dates));
}

// ---- Paid courses ---------------------------------------------------------

function courseLockKey() {
  if (!isBusiness()) return "co.locked.personal";
  if (state.money.reason === "money.noImpressum") return "co.locked.impressum";
  if (state.money.sellReason === "money.paymentsOff") return "co.locked.paymentsOff";
  if (state.money.sellReason === "money.noPayouts") return "co.locked.payouts";
  return null;
}

function renderCourses() {
  const lock = courseLockKey();
  const lockEl = $("co-lock");
  lockEl.hidden = !lock;
  lockEl.replaceChildren();
  if (lock) {
    lockEl.append(t(lock), " ");
    if (lock === "co.locked.impressum") lockEl.append(h("a", { href: "#/account" }, t("ac.biz")));
    if (lock === "co.locked.personal") lockEl.append(h("a", { href: PLANS_URL }, t("ed.seePlans")));
  }
  $("co-new").classList.toggle("is-disabled", !!lock);
  const earned = netByEvent(state.payRows);
  const courses = state.events.filter((ev) => ev.paidSlots);
  $("co-list").replaceChildren(...(courses.length ? courses.map((ev) => courseCard(ev, earned.get(ev.id) || 0))
    : [h("p", { class: "my-events-empty" }, t("co.empty"))]));
}

const feePercent = () => (typeof state.payments.feePercent === "number" ? state.payments.feePercent : 5);

function courseCard(ev, earnedCents) {
  const spots = Math.max(0, (ev.participant || 1) - 1);   // the host is on the roster but is not a participant
  const booked = Math.max(0, goingOf(ev) - 1);
  const share = organiserShare(ev.priceCents || 0, feePercent());
  const pct = spots ? Math.min(100, Math.round((booked / spots) * 100)) : 0;
  return h("article", { class: "course-card" },
    h("div", { class: "course-top" },
      dateTile(ev.when),
      h("div", {},
        h("p", { class: "ev-title" }, String(ev.title || "—"), ev.seriesId ? h("span", { class: "ev-tag" }, t("ev.series", { n: state.events.filter((x) => x.seriesId === ev.seriesId).length })) : null),
        h("p", { class: "ev-meta" }, `${String(ev.sportsArt || "")} · ${fmtDate(ev.when)}, ${fmtTime(ev.when)}`))),
    h("p", { class: "course-price" }, h("b", {}, euro(ev.priceCents || 0)), " ", t("ev.perSpot", { price: "" }).trim()),
    h("div", { class: "course-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(spots), "aria-valuenow": String(booked) },
      h("span", { style: `width:${pct}%` })),
    h("p", { class: "course-stats" }, `${t("co.booked", { n: `${booked}/${spots}` })} · ${t("co.potential", { amount: euro(share * spots) })}`),
    earnedCents ? h("p", { class: "course-earned" }, t("co.earned", { amount: euro(earnedCents) })) : null,
    actionBar(ev, { cancelIds: [ev.id], cancelLabel: t("ev.cancel"), confirmNote: joinedNote([ev]) }));
}

// ---- Revenue --------------------------------------------------------------

function table(head, rows) {
  if (!rows.length) return h("p", { class: "my-events-empty" }, t("rev.empty"));
  return h("table", { class: "data-table" },
    h("thead", {}, h("tr", {}, head.map((c, i) => h("th", { class: i ? "num" : null }, c)))),
    h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c, i) => h("td", { class: i ? "num" : null }, c))))));
}

function renderRevenue() {
  document.querySelectorAll("#rev-range button").forEach((b) => b.classList.toggle("is-active", b.dataset.range === state.revRange));
  const payouts = $("rev-payouts");
  payouts.className = "notice" + (state.profile.payoutsReady ? " notice--ok" : "");
  payouts.textContent = !isBusiness() && !state.payRows.length ? t("rev.locked") : t(state.profile.payoutsReady ? "rev.payouts.ok" : "rev.payouts.missing");
  if (state.payError) { payouts.className = "notice notice--error"; payouts.textContent = firestoreError(state.payError, "ed.err.load"); }

  const range = rangeOf(state.revRange);
  const s = summarise(state.payRows, range);
  $("rev-kpis").replaceChildren(
    kpi(t("rev.gross"), euro(s.grossCents), s.bookings === 1 ? t("rev.bookingsOne") : t("rev.bookings", { n: s.bookings })),
    kpi(t("rev.dipsFee"), "− " + euro(s.feeCents)),
    kpi(t("rev.net"), euro(s.netCents), null, true),
    kpi(t("rev.refunds"), euro(s.refundedCents), s.refunds ? String(s.refunds) + "×" : null));
  $("rev-courses").replaceChildren(table(
    [t("rev.col.course"), t("rev.col.bookings"), t("rev.col.gross"), t("rev.col.net")],
    byCourse(state.payRows, range).map((c) => [titleOf(c.eventId), String(c.bookings), euro(c.grossCents), euro(c.netCents)])));
  $("rev-months").replaceChildren(table(
    [t("rev.col.date"), t("rev.col.bookings"), t("rev.col.net")],
    byMonth(state.payRows).slice(0, 12).map((m) => [fmtMonth(m.key), String(m.bookings), euro(m.netCents)])));
  $("rev-latest").replaceChildren(table(
    [t("rev.col.date"), t("rev.col.course"), t("rev.col.amount"), t("rev.col.status")],
    state.payRows.slice(0, 15).map((p) => [p.date ? fmtShortDate(p.date) : "–", titleOf(p.eventId), euro(p.amountCents), t("rev.status." + p.status)])));
}

// ---- Account ----------------------------------------------------------------

function renderAccount() {
  const p = state.plan, u = usageText();
  const facts = [
    [t("ac.username"), state.username || "–"],
    [t("ac.email"), state.user.email || "–"],
    [t("ac.type"), t("acct." + p.accountType)],
    [t("ac.plan"), t("plan." + p.plan) + (p.source === "earlyAccess" ? ` (${t("plan.early")})` : "")],
    [t("ac.usage"), u.text]
  ];
  if (isBusiness()) facts.push([t("ac.payouts"), t(state.profile.payoutsReady ? "ac.payouts.ok" : "ac.payouts.missing")]);
  $("ac-facts").replaceChildren(...facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
  const form = $("biz-form");
  if (!isBusiness()) { form.hidden = true; $("ac-biz-lead").textContent = t("ac.biz.personal"); return; }
  $("ac-biz-lead").textContent = t("ac.biz.lead");
  form.hidden = false;
  if (!form.dataset.filled) fillBusinessForm();
}

function fillBusinessForm() {
  const b = state.profile.business || {};
  $("biz-category").replaceChildren(...CATEGORIES.map((c) => h("option", { value: c }, t("ac.cat." + c))));
  $("biz-name").value = b.name || "";
  $("biz-category").value = CATEGORIES.includes(b.category) ? b.category : (state.profile.accountType === "trainer" ? "trainer" : "club");
  for (const k of ["description", "address", "website", "instagram", "phone", "impressum"]) $("biz-" + k).value = b[k] || "";
  $("biz-form").dataset.filled = "1";
}

function initBusinessForm() {
  $("biz-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("biz-msg"); clearMsg(msg);
    const limits = { description: 1000, address: 200, website: 200, instagram: 60, phone: 40, impressum: 2000 };
    const name = $("biz-name").value.trim();
    if (!name || name.length > 60) { showMsg(msg, t("ac.biz.nameRequired"), "error"); return; }
    // Same shape as the app writes (businessValid in the rules): empty fields are left
    // out, a stored location (lat/lng) is kept.
    const old = state.profile.business || {};
    const business = { name, category: $("biz-category").value };
    for (const k of Object.keys(limits)) {
      const v = $("biz-" + k).value.trim();
      if (v.length > limits[k]) { showMsg(msg, t("ac.biz.tooLong", { field: t("ac.biz." + k), max: limits[k] }), "error"); return; }
      if (v) business[k] = v;
    }
    if (typeof old.lat === "number" && typeof old.lng === "number") { business.lat = old.lat; business.lng = old.lng; }
    const btn = $("biz-save"); btn.disabled = true;
    try {
      const { db, fs } = state;
      await fs.updateDoc(fs.doc(db, "databaseUserData", state.user.uid), { business });
      state.profile = { ...state.profile, business };
      state.money = moneyCapabilities(state.profile, state.payments);
      showMsg(msg, t("ac.biz.saved"), "info");
      renderHeader();
    } catch (err) {
      console.error("[DIPS] business profile", err);
      showMsg(msg, firestoreError(err, "ac.biz.err"), "error");
    } finally { btn.disabled = false; }
  });
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

async function loadSports() {
  if (state.sportsLoaded) return;
  const { db, fs } = state;
  const snap = await fs.getDocs(fs.collection(db, "databaseSports"));
  const names = [...new Set(snap.docs.map((d) => d.get("name")).filter((n) => typeof n === "string" && n))].sort((a, b) => a.localeCompare(b, "de"));
  $("ev-sport").replaceChildren(h("option", { value: "" }, t("ed.chooseSport")), ...names.map((n) => h("option", { value: n }, n)));
  state.sportsLoaded = true;
}

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
  if (state.map) { setTimeout(() => state.map.invalidateSize(), 60); return; }
  const L = await loadLeaflet();
  L.Icon.Default.imagePath = LEAFLET_BASE + "images/";
  const map = L.map("ev-map", { scrollWheelZoom: false }).setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lng], DEFAULT_VIEW.zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map);
  map.on("click", (e) => { if (!state.editing) setPin(e.latlng.lat, e.latlng.lng); });
  map.on("focus", () => map.scrollWheelZoom.enable());
  map.on("blur", () => map.scrollWheelZoom.disable());
  state.map = map;
  setTimeout(() => map.invalidateSize(), 60);
}

function setPin(lat, lng, { zoom, locked = false } = {}) {
  const L = window.L;
  state.pin = { lat, lng };
  if (!state.marker) {
    state.marker = L.marker([lat, lng], { draggable: true, autoPan: true }).addTo(state.map);
    state.marker.on("dragend", () => { const p = state.marker.getLatLng(); state.pin = { lat: p.lat, lng: p.lng }; });
  } else state.marker.setLatLng([lat, lng]);
  if (state.marker.dragging) locked ? state.marker.dragging.disable() : state.marker.dragging.enable();
  if (zoom) state.map.setView([lat, lng], zoom);
  $("ev-place-hint").textContent = t(locked ? "ed.placeLocked" : "ed.placeSet");
  $("ev-place-hint").classList.toggle("ok", !locked);
}

function clearPin() {
  state.pin = null;
  if (state.marker) { state.marker.remove(); state.marker = null; }
  $("ev-place-hint").textContent = t("ed.placeHint");
  $("ev-place-hint").classList.remove("ok");
}

function initPlaceSearch() {
  const q = $("ev-place-q"), list = $("ev-place-results"), go = $("ev-place-go");
  async function search() {
    const text = q.value.trim();
    if (text.length < 3 || state.editing) return;
    go.disabled = true; go.textContent = t("ed.searching");
    try {
      const res = await fetch(`${NOMINATIM}?format=jsonv2&limit=5&q=${encodeURIComponent(text)}`, { headers: { "Accept-Language": getLang() } });
      const results = res.ok ? await res.json() : [];
      list.replaceChildren(...(results.length ? results.map((r) => h("li", {}, h("button", {
        type: "button",
        onclick: () => {
          setPin(Number(r.lat), Number(r.lon), { zoom: 16 });
          if (!$("ev-venue").value.trim() && r.name) $("ev-venue").value = String(r.name).slice(0, LIMITS.venueMax);
          list.hidden = true;
        }
      }, r.display_name))) : [h("li", { class: "none" }, t("ed.placeNone"))]));
      list.hidden = false;
    } catch (e) {
      list.replaceChildren(h("li", { class: "none" }, t("ed.placeDown"))); list.hidden = false;
    } finally { go.disabled = false; go.textContent = t("ed.search"); }
  }
  go.addEventListener("click", search);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  $("ev-locate").addEventListener("click", () => {
    if (!navigator.geolocation || !state.map) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => state.map.setView([pos.coords.latitude, pos.coords.longitude], 15),
      () => showMsg($("form-msg"), t("ed.locateFail"), "error"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
  });
}

/** Trainer / club: the field is the max. number of participants; the host is added to the stored size. */
const capacityFromField = () => Number($("ev-capacity").value) + (isBusiness() ? 1 : 0);

function updateCapacityLabel() {
  const biz = isBusiness();
  $("ev-capacity-label").textContent = t(biz ? "ed.maxParticipants" : "ed.capacity");
  $("ev-capacity").max = String(biz ? LIMITS.capacityMax - 1 : LIMITS.capacityMax);
  $("ev-capacity").min = String(biz ? 1 : LIMITS.capacityMin);
}

function applyMoneyUi() {
  const m = state.money, editing = state.editing;
  const costOn = $("ev-cost-on"), sellOn = $("ev-sell-on");
  costOn.disabled = !m.canShowPrice || !!(editing && editing.paidSlots);
  sellOn.disabled = !m.canSellSpots || !!editing;
  if (!m.canShowPrice && !editing) { costOn.checked = false; $("ev-cost-box").hidden = true; }
  if (!m.canSellSpots && !editing) { sellOn.checked = false; $("ev-sell-box").hidden = true; }
  const note = $("price-note");
  const key = !m.canShowPrice ? m.reason : !m.canSellSpots ? m.sellReason : null;
  note.hidden = !key || !!editing;
  note.replaceChildren();
  if (key && !editing) {
    note.append(t(key) + " ");
    if (key === "money.notBusiness") note.append(h("a", { href: PLANS_URL }, t("ed.seePlans")));
    if (key === "money.noImpressum") note.append(h("a", { href: "#/account" }, t("ac.biz")));
  }
  $("price-block").classList.toggle("is-locked", !m.canShowPrice);
  updateSlotInfo();
}

function updateSlotInfo() {
  const euros = Number($("ev-slot").value);
  if (!Number.isFinite(euros) || euros <= 0) { $("ev-slot-share").textContent = ""; $("ev-slot-potential").textContent = ""; return; }
  const cents = clampSlotCents(Math.round(euros * 100));
  const share = organiserShare(cents, feePercent());
  $("ev-slot-share").textContent = t("ed.share", { amount: euro(share) });
  const spots = Math.max(0, capacityFromField() - 1);
  $("ev-slot-potential").textContent = spots ? t("ed.potential", { n: spots, price: euro(cents), gross: euro(cents * spots), net: euro(share * spots) }) : "";
}

function renderWeekdays() {
  // Monday first; labels from Intl in the current language.
  const checked = new Set([...document.querySelectorAll("#ev-weekdays input:checked")].map((c) => c.value));
  $("ev-weekdays").replaceChildren(...[0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = new Date(2024, 0, 1 + i);   // 1 Jan 2024 was a Monday
    const value = String(d.getDay());
    const label = new Intl.DateTimeFormat(locale(), { weekday: "short" }).format(d).replace(".", "").slice(0, 2);
    return h("label", {}, h("input", { type: "checkbox", value, checked: checked.has(value) || null, onchange: updateRepeatPreview }), h("span", {}, label));
  }));
}

function initEditor() {
  $("ev-audience").replaceChildren(...AUDIENCES.map((a) => h("option", { value: a.value }, t(a.label))));
  $("ev-level").replaceChildren(...SKILL_LEVELS.map((s) => h("option", { value: s.value }, t(s.label))));
  renderWeekdays();
  $("ev-date").min = isoDay(new Date());

  for (const el of document.querySelectorAll(".counter")) {
    const input = $(el.dataset.for), max = Number(input.getAttribute("maxlength"));
    const update = () => { const n = [...input.value].length; el.textContent = `${n}/${max}`; el.classList.toggle("full", n >= max); };
    input.addEventListener("input", update); update();
  }
  $("ev-quorum-on").addEventListener("change", (e) => { $("ev-quorum-box").hidden = !e.target.checked; });
  $("ev-cost-on").addEventListener("change", (e) => {
    $("ev-cost-box").hidden = !e.target.checked;
    if (e.target.checked && $("ev-sell-on").checked) { $("ev-sell-on").checked = false; $("ev-sell-box").hidden = true; }
    updateRepeatPreview();
  });
  $("ev-sell-on").addEventListener("change", (e) => {
    $("ev-sell-box").hidden = !e.target.checked;
    if (e.target.checked && $("ev-cost-on").checked) { $("ev-cost-on").checked = false; $("ev-cost-box").hidden = true; }
    updateSlotInfo(); updateRepeatPreview();
  });
  $("ev-slot").addEventListener("input", updateSlotInfo);
  $("ev-capacity").addEventListener("input", updateSlotInfo);

  const repeatOn = $("ev-repeat-on");
  repeatOn.addEventListener("change", () => {
    $("ev-repeat-box").hidden = !repeatOn.checked;
    if (repeatOn.checked) {
      const start = localDateTime($("ev-date").value, $("ev-time").value);
      if (start && !selectedWeekdays().length) { const chip = document.querySelector(`#ev-weekdays input[value="${start.getDay()}"]`); if (chip) chip.checked = true; }
      if (start && !$("ev-until").value) $("ev-until").value = isoDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * 8));
    }
    updateRepeatPreview();
  });
  $("ev-repeat-mode").addEventListener("change", () => { $("ev-weekdays").hidden = $("ev-repeat-mode").value !== "weekly"; updateRepeatPreview(); });
  for (const el of document.querySelectorAll("#ev-until, #ev-date, #ev-time")) el.addEventListener("change", updateRepeatPreview);
  $("event-form").addEventListener("submit", (e) => { e.preventDefault(); state.editing ? saveEdit() : create(); });
}

const selectedWeekdays = () => [...document.querySelectorAll("#ev-weekdays input:checked")].map((c) => Number(c.value));

async function openEditor(mode, ev = null) {
  state.editorMode = mode;
  state.editing = mode === "edit" ? ev : null;
  showView("editor");
  clearMsg($("form-msg"));
  $("fit-offer").hidden = true;
  $("ed-title").textContent = t(mode === "edit" ? "ed.edit" : mode === "course" ? "ed.newCourse" : "ed.new");
  $("ed-back").setAttribute("href", mode === "course" || (ev && ev.paidSlots) ? "#/courses" : "#/events");
  $("edit-banner").hidden = mode !== "edit";
  if (mode === "edit") $("edit-banner-text").textContent = t("ed.editing", { title: String(ev.title || "") });
  $("repeat-block").hidden = mode === "edit";
  ["ev-place-q", "ev-place-go", "ev-slot"].forEach((id) => { $(id).disabled = mode === "edit"; });

  try { await Promise.all([loadSports(), initMap()]); } catch (err) { showMsg($("form-msg"), firestoreError(err, "ed.err.load"), "error"); }

  if (mode === "edit") fillFromEvent(ev); else resetForm(mode);
  updateCapacityLabel();
  applyMoneyUi();
  updateRepeatPreview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm(mode) {
  const today = new Date();
  $("ev-title").value = ""; $("ev-details").value = ""; $("ev-venue").value = "";
  ["ev-title", "ev-details"].forEach((id) => $(id).dispatchEvent(new Event("input")));
  $("ev-date").value = isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  $("ev-time").value = "18:00";
  $("ev-duration").value = "90";
  $("ev-audience").value = "all"; $("ev-level").value = "any";
  $("ev-quorum-on").checked = false; $("ev-quorum-box").hidden = true;
  $("ev-repeat-on").checked = false; $("ev-repeat-box").hidden = true; $("ev-until").value = "";
  $("ev-cost-on").checked = false; $("ev-cost-box").hidden = true;
  const sell = mode === "course" && state.money.canSellSpots;
  $("ev-sell-on").checked = sell; $("ev-sell-box").hidden = !sell;
  $("ev-capacity").value = mode === "course" ? "5" : String(LIMITS.capacityDefault);
  $("ev-slot").value = "10";
  clearPin();
  const last = state.events.find((e) => typeof e.latitude === "number");   // start where the organiser usually meets
  if (last && state.map) state.map.setView([last.latitude, last.longitude], 13);
}

function fillFromEvent(ev) {
  if (![...$("ev-sport").options].some((o) => o.value === ev.sportsArt)) $("ev-sport").append(h("option", { value: ev.sportsArt }, ev.sportsArt));
  $("ev-sport").value = ev.sportsArt || "";
  $("ev-title").value = ev.title || ""; $("ev-details").value = ev.details || "";
  ["ev-title", "ev-details"].forEach((id) => $(id).dispatchEvent(new Event("input")));
  $("ev-date").value = isoDay(ev.when); $("ev-time").value = hhmm(ev.when);
  const dur = ev.durationMinutes != null ? String(ev.durationMinutes) : "";
  if (dur && ![...$("ev-duration").options].some((o) => o.value === dur)) $("ev-duration").append(h("option", { value: dur }, `${dur} min`));
  $("ev-duration").value = dur;
  $("ev-venue").value = ev.venueName || "";
  const stored = ev.participant || LIMITS.capacityDefault;
  $("ev-capacity").value = String(isBusiness() ? Math.max(1, stored - 1) : stored);
  $("ev-audience").value = ev.audience || "all"; $("ev-level").value = ev.skillLevel || "any";
  $("ev-quorum-on").checked = ev.minParticipants != null; $("ev-quorum-box").hidden = ev.minParticipants == null;
  if (ev.minParticipants != null) $("ev-quorum").value = String(ev.minParticipants);
  const paid = ev.paidSlots === true;
  $("ev-sell-on").checked = paid; $("ev-sell-box").hidden = !paid;
  if (paid) $("ev-slot").value = String((ev.priceCents || 0) / 100);
  $("ev-cost-on").checked = !paid && ev.costPerPerson != null; $("ev-cost-box").hidden = !$("ev-cost-on").checked;
  if (ev.costPerPerson != null) $("ev-cost").value = String(ev.costPerPerson);
  if (typeof ev.latitude === "number") setPin(ev.latitude, ev.longitude, { zoom: 15, locked: true }); else clearPin();
}

function readForm() {
  const start = localDateTime($("ev-date").value, $("ev-time").value);
  const until = $("ev-until").value ? localDateTime($("ev-until").value, "00:00") : null;
  const duration = $("ev-duration").value, editing = state.editing, sell = $("ev-sell-on").checked;
  return {
    sport: $("ev-sport").value, title: $("ev-title").value, details: $("ev-details").value, start,
    capacity: capacityFromField(),
    minParticipants: $("ev-quorum-on").checked ? Number($("ev-quorum").value) : null,
    durationMinutes: duration ? Number(duration) : null,
    venueName: $("ev-venue").value,
    latitude: state.pin ? state.pin.lat : undefined, longitude: state.pin ? state.pin.lng : undefined,
    audience: $("ev-audience").value, skillLevel: $("ev-level").value,
    costPerPerson: !sell && $("ev-cost-on").checked ? Number($("ev-cost").value) : null,
    // When editing, paid-spot terms stay as they are (not part of an edit, as in the app).
    priceCents: editing ? (editing.paidSlots ? editing.priceCents : null) : sell ? clampSlotCents(Math.round(Number($("ev-slot").value) * 100)) : null,
    repeat: !editing && $("ev-repeat-on").checked ? { mode: $("ev-repeat-mode").value, weekdays: selectedWeekdays(), until } : null
  };
}

const seriesMax = () => (state.plan ? state.plan.limits.seriesMax : LIMITS.seriesMax);
const periodWord = () => t(state.plan && state.plan.limits.period === "week" ? "period.week" : "period.month");

function submitLabel(n) {
  if (state.editing) return t("ed.saveChanges");
  if (n > 1) return t("ed.createN", { n });
  return t($("ev-sell-on").checked ? "ed.createCourse" : "ed.create");
}

function updateRepeatPreview() {
  const btn = $("create-btn"), out = $("ev-repeat-preview");
  $("fit-offer").hidden = true;
  if (state.editing || !$("ev-repeat-on").checked) { btn.textContent = submitLabel(1); out.textContent = ""; return; }
  const f = readForm();
  if (!f.start || !f.repeat.until || (f.repeat.mode === "weekly" && !f.repeat.weekdays.length)) {
    out.textContent = t(f.repeat.mode === "weekly" ? "ed.prev.pick" : "ed.prev.pickEnd"); btn.textContent = submitLabel(2); return;
  }
  const max = seriesMax();
  const { dates, capped } = repeatOccurrences(f.start, f.repeat, max);
  if (!dates.length) { out.textContent = t("ed.prev.none"); btn.textContent = submitLabel(2); return; }
  const first = dates[0], last = dates[dates.length - 1];
  let text = dates.length === 1 ? t("ed.prev.date", { first: fmtDate(first), time: fmtTime(first) })
    : t("ed.prev.dates", { n: dates.length, first: fmtDate(first), last: fmtDate(last), time: fmtTime(first) });
  if (capped) text += " · " + (max < LIMITS.seriesMax ? t("ed.prev.planCap", { n: max }) : t("ed.prev.cap", { n: max }));
  if (state.plan) {
    const fit = datesThatFit(dates, planEvents(), state.plan.limits);
    if (fit < dates.length) text += " · " + t("ed.prev.fit", { fit, limit: state.plan.limits.limit, period: periodWord() });
  }
  out.textContent = text;
  btn.textContent = submitLabel(dates.length);
}

async function create(onlyDates = null) {
  const msg = $("form-msg");
  clearMsg(msg); $("fit-offer").hidden = true;
  if (!state.user) return;
  if (!state.username) { showMsg(msg, t("ed.err.username"), "error"); return; }
  const f = readForm();
  const problems = validateForm(f, new Date(), { money: state.money });
  if (problems.length) { showMsg(msg, problems.map((k) => t(k)).join(" "), "error"); return; }

  // Plan check before anything is written — the app's paywall step.
  const dates = onlyDates || plannedDates(f, seriesMax());
  if (!dates.length) { showMsg(msg, t("ed.prev.none"), "error"); return; }
  if (!onlyDates && state.plan) {
    const limits = state.plan.limits;
    const fits = fittingDates(dates, planEvents(), limits);
    if (fits.length === 0) {
      showMsg(msg, t("ed.plan.full", { plan: t("plan." + state.plan.plan), limit: limits.limit, period: periodWord() }), "error");
      $("fit-offer").replaceChildren(h("a", { class: "link-btn", href: PLANS_URL }, t("common.comparePlans"))); $("fit-offer").hidden = false;
      return;
    }
    if (fits.length < dates.length) {
      showMsg(msg, t("ed.plan.partial", { fit: fits.length, n: dates.length, limit: limits.limit, period: periodWord() }), "error");
      $("fit-offer").replaceChildren(
        h("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => create(fits) }, t("ed.plan.createFit", { n: fits.length })),
        h("a", { class: "link-btn", href: PLANS_URL }, t("common.comparePlans")));
      $("fit-offer").hidden = false;
      return;
    }
  }

  const docs = buildEventDocuments(f, { uid: state.user.uid, username: state.username }, { dates });
  const btn = $("create-btn"); btn.disabled = true;
  btn.textContent = docs.length > 1 ? t("ed.creatingN", { n: docs.length }) : t("ed.creating");
  try {
    const { db, fs } = state;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = fs.writeBatch(db);
      for (const { id, data } of docs.slice(i, i + 400)) batch.set(fs.doc(db, "databaseMapEvents", id), { ...data, date: fs.Timestamp.fromDate(data.date) });
      await batch.commit();
    }
    showMsg($("manager-msg"), docs.length > 1 ? t("ed.createdN", { n: docs.length }) : t("ed.created"), "info");
    scheduleLimitCheck(docs.map((d) => d.id));
    location.hash = f.priceCents != null ? "#/courses" : "#/events";
  } catch (err) {
    console.error("[DIPS] create failed", err);
    showMsg(msg, firestoreError(err, "ed.err.save"), "error");
  } finally { btn.disabled = false; updateRepeatPreview(); }
}

function scheduleLimitCheck(ids) {
  clearTimeout(state.pendingCheck);
  state.pendingCheck = setTimeout(() => {
    const live = new Set(state.liveAll.map((ev) => ev.id));
    const removed = ids.filter((id) => !live.has(id));
    if (removed.length) {
      showMsg($("manager-msg"), removed.length === ids.length ? t("ed.plan.removedAll")
        : t("ed.plan.removedSome", { kept: ids.length - removed.length, n: ids.length }), "error");
    }
  }, 9000);
}

async function saveEdit() {
  const msg = $("form-msg"); clearMsg(msg);
  // Check against the live document: people may have joined since "Edit" was clicked.
  const ev = state.liveAll.find((e) => e.id === state.editing.id) || state.editing;
  const f = readForm();
  // An existing paid event keeps its terms even if payouts were switched off since.
  const money = ev.paidSlots ? { ...state.money, canSellSpots: true, canShowPrice: true } : state.money;
  const problems = validateForm(f, new Date(), { editing: true, money }).map((k) => t(k));
  const going = goingOf(ev);
  if (f.capacity < going) problems.push(t("ed.err.capacity", { n: isBusiness() ? going - 1 : going }));
  if (problems.length) { showMsg(msg, problems.join(" "), "error"); return; }

  const { set, cleared } = buildEditPayload(f);
  const btn = $("create-btn"); btn.disabled = true; btn.textContent = t("ed.saving");
  try {
    const { db, fs } = state;
    const update = { ...set, date: fs.Timestamp.fromDate(set.date) };
    for (const key of cleared) update[key] = fs.deleteField();
    await fs.updateDoc(fs.doc(db, "databaseMapEvents", ev.id), update);
    const others = Math.max(0, going - 1);
    // The server pushes a notice to the roster when the time changes (onEventChangedNotify).
    const timeChanged = ev.when && set.date.getTime() !== ev.when.getTime();
    showMsg($("manager-msg"), others && timeChanged ? t("ed.savedNotify", { n: others }) : t("ed.saved"), "info");
    const back = ev.paidSlots ? "#/courses" : "#/events";
    state.editing = null;
    location.hash = back;
  } catch (err) {
    console.error("[DIPS] edit failed", err);
    showMsg(msg, firestoreError(err, "ed.err.edit"), "error");
  } finally { btn.disabled = false; updateRepeatPreview(); }
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

function applyLanguage() {
  document.documentElement.lang = getLang();
  applyStatic(document.getElementById("events-page"));
  document.querySelectorAll("[data-lang]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.lang === getLang());
    b.setAttribute("aria-pressed", String(b.dataset.lang === getLang()));
  });
  const aud = $("ev-audience").value, lvl = $("ev-level").value;
  $("ev-audience").replaceChildren(...AUDIENCES.map((a) => h("option", { value: a.value }, t(a.label))));
  $("ev-level").replaceChildren(...SKILL_LEVELS.map((s) => h("option", { value: s.value }, t(s.label))));
  if (aud) $("ev-audience").value = aud;
  if (lvl) $("ev-level").value = lvl;
  renderWeekdays();
  if (state.sportsLoaded && $("ev-sport").options[0]) $("ev-sport").options[0].textContent = t("ed.chooseSport");
  if ($("biz-category").options.length) {
    const c = $("biz-category").value;
    $("biz-category").replaceChildren(...CATEGORIES.map((x) => h("option", { value: x }, t("ac.cat." + x))));
    $("biz-category").value = c;
  }
  if (!state.pin) $("ev-place-hint").textContent = t("ed.placeHint");
  if (!$("login-btn").disabled) $("login-btn").textContent = t("auth.submit");
  updateCapacityLabel();
  if (state.user && !$("dash").hidden) {
    renderAll();
    if (state.view === "editor") {
      $("ed-title").textContent = t(state.editorMode === "edit" ? "ed.edit" : state.editorMode === "course" ? "ed.newCourse" : "ed.new");
      if (state.editing) $("edit-banner-text").textContent = t("ed.editing", { title: String(state.editing.title || "") });
      applyMoneyUi(); updateRepeatPreview();
    }
  } else {
    $("create-btn").textContent = t("ed.create");
  }
}

function initChrome() {
  document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => { setLang(b.dataset.lang); applyLanguage(); }));
  document.querySelectorAll("#ev-filter button").forEach((b) => b.addEventListener("click", () => { state.evFilter = b.dataset.filter; renderEvents(); }));
  document.querySelectorAll("#rev-range button").forEach((b) => b.addEventListener("click", () => { state.revRange = b.dataset.range; renderRevenue(); }));
  window.addEventListener("hashchange", route);
}

// ---------------------------------------------------------------------------

initChrome();
initSignIn();
initEditor();
initPlaceSearch();
initBusinessForm();
applyLanguage();
