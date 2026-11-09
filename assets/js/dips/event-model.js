// DIPS web event manager — the event model.
//
// Pure functions only (no DOM, no Firebase), so they can be unit-tested in Node
// and so the web writes exactly the documents the iOS app writes. Every rule
// here mirrors a source of truth in the DIPS repo; keep them in step:
//
//   payload ............ DIPS/Core/Repositories/EventRepository.swift  createEvent(_:)
//   edit payload ....... DIPS/Model/EventItems.swift  editablePayload(for:)
//   limits ............. DIPS/Map/CreateEvents/CreateEventsView(+Details).swift
//                        DIPS/Model/Event.swift  EventCapacity, EventQuorum, EventDuration,
//                        EventVenue, EventCost, EventSeries
//   prices / paid spots  DIPS/Menu/SideMenu/Account/AccountPlans.swift  SlotPrice
//   plans .............. functions/lib/plans.js  (effectivePlan, periodKey, datesThatFit)
//   geohash ............ DIPS/Core/App/Geohash.swift
//   server checks ...... firestore.rules  match /databaseMapEvents

export const LIMITS = Object.freeze({
  titleMax: 20,          // isTitleValid
  detailsMax: 120,       // isDetailsValid
  venueMax: 40,          // EventVenue.maximumLength
  capacityMin: 2,        // EventCapacity.minimum
  capacityMax: 30,       // EventCapacity.maximum
  capacityDefault: 10,   // EventCapacity.defaultValue
  quorumMin: 2,          // EventQuorum.minimum (and ≤ capacity)
  durationMin: 15,       // EventDuration.minimumMinutes
  durationMax: 480,      // EventDuration.maximumMinutes
  costMax: 200,          // EventCost.maximum
  costStep: 0.5,         // EventCost.step
  slotMinCents: 300,     // SlotPrice.minimumCents
  slotMaxCents: 50000,   // SlotPrice.maximumCents
  dipsFeePercent: 5,     // SlotPrice.feePercent
  seriesMax: 26,         // EventSeries.maximumOccurrences
  seriesHorizonDays: 180 // EventSeries.maximumHorizonDays
});

export const AUDIENCES = [
  { value: "all", label: "aud.all" },
  { value: "womenOnly", label: "aud.womenOnly" },
  { value: "beginnersOnly", label: "aud.beginnersOnly" }
];

export const SKILL_LEVELS = [
  { value: "any", label: "lvl.any" },
  { value: "beginner", label: "lvl.beginner" },
  { value: "intermediate", label: "lvl.intermediate" },
  { value: "advanced", label: "lvl.advanced" }
];

// ---------------------------------------------------------------------------
// Plans — a port of functions/lib/plans.js (the server stays the authority:
// it removes whatever is over the limit right after the write; this port lets
// the page say so BEFORE writing, like the app's paywall does).
// ---------------------------------------------------------------------------

const TIME_ZONE = "Europe/Berlin";
const EARLY_ACCESS_MONTHS = 3;
const ACCOUNT_TYPES = ["personal", "trainer", "business"];

export const PLANS = Object.freeze({
  personal: Object.freeze({
    free: { limit: 4, period: "month", seriesMax: 4, paidEvents: false },
    plus: { limit: 15, period: "month", seriesMax: 26, paidEvents: false }
  }),
  business: Object.freeze({
    free: { limit: 2, period: "week", seriesMax: 26, paidEvents: true },
    trainer: { limit: 7, period: "week", seriesMax: 26, paidEvents: true },
    business: { limit: 30, period: "week", seriesMax: 26, paidEvents: true }
  })
});


const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function accountTypeOf(profile) {
  return ACCOUNT_TYPES.includes(profile && profile.accountType) ? profile.accountType : "personal";
}
export const isBusinessType = (type) => type === "trainer" || type === "business";

/** The plan an account has right now (same rules as plans.js effectivePlan). */
export function effectivePlan(profile = {}, config = {}, now = new Date()) {
  const accountType = accountTypeOf(profile);
  const fam = isBusinessType(accountType) ? "business" : "personal";
  const table = PLANS[fam];
  const max = fam === "personal" ? "plus" : "business";
  const release = toDate(config.releaseDate);
  const result = (plan, source, until = null) => ({ accountType, family: fam, plan, source, until, limits: table[plan] });

  if (!release || now < release) return result(max, "earlyAccess");
  const earlyUntil = new Date(release.getTime());
  earlyUntil.setUTCMonth(earlyUntil.getUTCMonth() + EARLY_ACCESS_MONTHS);
  if (profile.earlyAccess === true && now < earlyUntil) return result(max, "earlyAccess", earlyUntil);

  const stored = profile.plan;
  const expires = toDate(profile.planExpiresAt);
  if (stored && stored !== "free" && table[stored] && (!expires || now < expires)) {
    return result(stored, profile.planSource || "manual", expires);
  }
  return result("free", "free");
}

function berlinParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function monthKey(date) {
  const { year, month } = berlinParts(date);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function weekKey(date) {
  const { year, month, day } = berlinParts(date);
  const d = new Date(Date.UTC(year, month - 1, day));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export const periodKey = (period, date) => (period === "week" ? weekKey(date) : monthKey(date));

/** How many of `dates` (in order) still fit, given the owner's events (live + archived). */
export function datesThatFit(dates, events, limits) {
  const counts = new Map();
  for (const e of events) {
    if (!e.date) continue;
    const key = periodKey(limits.period, e.date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let fit = 0;
  for (const date of dates.slice(0, limits.seriesMax)) {
    const key = periodKey(limits.period, date);
    const used = counts.get(key) || 0;
    if (used >= limits.limit) continue;
    counts.set(key, used + 1);
    fit += 1;
  }
  return fit;
}

/**
 * The dates of `dates` that fit — what "create the ones that fit" writes. Same
 * walk as datesThatFit, but it keeps the actual dates, so a week that is
 * already full is skipped instead of being written and removed by the server.
 */
export function fittingDates(dates, events, limits) {
  const counts = new Map();
  for (const e of events) {
    if (!e.date) continue;
    const key = periodKey(limits.period, e.date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out = [];
  for (const date of dates.slice(0, limits.seriesMax)) {
    const key = periodKey(limits.period, date);
    const used = counts.get(key) || 0;
    if (used >= limits.limit) continue;
    counts.set(key, used + 1);
    out.push(date);
  }
  return out;
}

/** Events in the current period (for "3 of 7 this week"). */
export function usedThisPeriod(events, limits, now = new Date()) {
  const key = periodKey(limits.period, now);
  return events.filter((e) => e.date && periodKey(limits.period, e.date) === key).length;
}

// ---------------------------------------------------------------------------
// Money (who may show a price / sell spots — same conditions as the app and rules)
// ---------------------------------------------------------------------------

/**
 * @param {object} profile databaseUserData
 * @param {{ enabled?: boolean }} payments config/payments
 * @returns {{ canShowPrice: boolean, canSellSpots: boolean, reason: string|null, sellReason: string|null }}
 */
export function moneyCapabilities(profile = {}, payments = {}) {
  const type = accountTypeOf(profile);
  const business = isBusinessType(type);
  const impressum = String((profile.business && profile.business.impressum) || "").trim() !== "";
  const canShowPrice = business && impressum;
  const canSellSpots = canShowPrice && profile.payoutsReady === true && payments.enabled === true;
  let reason = null;
  if (!business) reason = "money.notBusiness";
  else if (!impressum) reason = "money.noImpressum";
  let sellReason = reason;
  if (!sellReason && payments.enabled !== true) sellReason = "money.paymentsOff";
  else if (!sellReason && profile.payoutsReady !== true) sellReason = "money.noPayouts";
  return { canShowPrice, canSellSpots, reason, sellReason };
}

/** EventCost.clamp: 0…200 in 0.50 steps. */
export function clampCost(value) {
  if (!Number.isFinite(value)) return 0;
  const bounded = Math.min(Math.max(value, 0), LIMITS.costMax);
  return Math.round(bounded / LIMITS.costStep) * LIMITS.costStep;
}

/** SlotPrice.clampCents. */
export const clampSlotCents = (cents) => Math.min(Math.max(cents, LIMITS.slotMinCents), LIMITS.slotMaxCents);

/** SlotPrice.organiserShareCents: minus Stripe (1.5 % + 0.25 €) and DIPS (5 %). */
export function organiserShareCents(cents) {
  const stripe = Math.round(cents * 0.015) + 25;
  const dips = Math.round(cents * LIMITS.dipsFeePercent / 100);
  return Math.max(0, cents - stripe - dips);
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * A new event / series id, formatted like Swift's `UUID().uuidString`:
 * UPPERCASE. The app addresses documents by `event.id.uuidString`, so a
 * lowercase id would create a document the app can read but never join,
 * edit or cancel.
 */
export function newId(randomUUID = () => globalThis.crypto.randomUUID()) {
  return randomUUID().toUpperCase();
}

// ---------------------------------------------------------------------------
// Geohash — a line-by-line port of Geohash.swift (note the strict `>`).
// ---------------------------------------------------------------------------

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function geohash(lat, lon, precision = 7) {
  let latLo = -90, latHi = 90, lonLo = -180, lonHi = 180;
  let hash = "";
  let isEven = true, bit = 0, ch = 0;
  while (hash.length < Math.max(1, precision)) {
    if (isEven) {
      const mid = (lonLo + lonHi) / 2;
      if (lon > mid) { ch |= 1 << (4 - bit); lonLo = mid; } else { lonHi = mid; }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat > mid) { ch |= 1 << (4 - bit); latLo = mid; } else { latHi = mid; }
    }
    isEven = !isEven;
    if (bit < 4) { bit += 1; } else { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

// ---------------------------------------------------------------------------
// Dates and repeats
// ---------------------------------------------------------------------------

/** Local Date from `<input type=date>` ("2026-11-20") and `<input type=time>` ("18:30"). */
export function localDateTime(dateStr, timeStr) {
  const [y, m, d] = String(dateStr || "").split("-").map(Number);
  const [hh, mm] = String(timeStr || "").split(":").map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const date = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Same calendar day as `start` plus `days`, keeping the wall-clock time (DST-safe). */
function addDays(start, days) {
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + days,
                  start.getHours(), start.getMinutes(), 0, 0);
}

/** Calendar.date(byAdding: .month, value: 1): same day next month, clamped to its last day. */
function addMonthClamped(date) {
  const y = date.getFullYear(), m = date.getMonth() + 1;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(date.getDate(), last), date.getHours(), date.getMinutes(), 0, 0);
}

export const REPEAT_MODES = [
  { value: "weekly", label: "rep.weekly" },
  { value: "daily", label: "rep.daily" },
  { value: "monthly", label: "rep.monthly" }
];

/**
 * The dates of a repeat, built like the app does it:
 *  - weekly: walk day by day, take every selected weekday (start day only if selected);
 *  - daily / monthly: start date, then +1 day / +1 month (Calendar semantics);
 * keeping the start time, up to and including the end day, never past 180 days
 * after the start, at most `max` (default 26) dates.
 *
 * @param {Date} start
 * @param {{ mode: "weekly"|"daily"|"monthly", weekdays?: number[], until: Date }} repeat
 * @returns {{ dates: Date[], requested: number, capped: boolean }}
 */
export function repeatOccurrences(start, repeat, max = LIMITS.seriesMax) {
  const horizon = addDays(start, LIMITS.seriesHorizonDays);
  const until = repeat.until;
  const lastDay = new Date(until.getFullYear(), until.getMonth(), until.getDate(), 23, 59, 59, 999);
  const end = lastDay < horizon ? lastDay : horizon;
  const all = [];
  const mode = repeat.mode || "weekly";
  if (mode === "weekly") {
    const wanted = new Set(repeat.weekdays || []);
    for (let i = 0; ; i++) {
      const day = addDays(start, i);
      if (day > end) break;
      if (wanted.has(day.getDay())) all.push(day);
    }
  } else {
    let current = new Date(start.getTime());
    let i = 0;
    while (current <= end && all.length <= 400) {
      all.push(current);
      i += 1;
      current = mode === "daily" ? addDays(start, i) : addMonthClamped(current);
    }
  }
  return { dates: all.slice(0, max), requested: all.length, capped: all.length > max };
}

/** Back-compat helper (weekly only). */
export function weeklyOccurrences(start, weekdays, until) {
  return repeatOccurrences(start, { mode: "weekly", weekdays, until });
}

// ---------------------------------------------------------------------------
// Validation (same limits as the app; the rules check again on the server)
// ---------------------------------------------------------------------------

const isInt = (v) => Number.isInteger(v);

/**
 * @param {object} f form values (see buildEventDocuments)
 * @param {Date} now
 * @param {{ editing?: boolean, money?: ReturnType<typeof moneyCapabilities> }} [opts]
 * @returns {string[]} i18n keys of the problems (see i18n.js "v.*" / "money.*"); empty when the form can be saved
 */
export function validateForm(f, now = new Date(), opts = {}) {
  const problems = [];
  const title = (f.title || "").trim();
  const details = (f.details || "").trim();
  if (!f.sport) problems.push("v.sport");
  if (!title) problems.push("v.title");
  else if ([...title].length > LIMITS.titleMax) problems.push("v.titleLong");
  if (!details) problems.push("v.details");
  else if ([...details].length > LIMITS.detailsMax) problems.push("v.detailsLong");
  if (!f.start) problems.push("v.start");
  else if (f.start <= now) problems.push("v.past");
  if (!isInt(f.capacity) || f.capacity < LIMITS.capacityMin || f.capacity > LIMITS.capacityMax) {
    problems.push("v.capacity");
  }
  if (f.minParticipants != null) {
    if (!isInt(f.minParticipants) || f.minParticipants < LIMITS.quorumMin || f.minParticipants > Math.min(30, f.capacity || 0)) {
      problems.push("v.quorum");
    }
  }
  if (f.durationMinutes != null) {
    if (!isInt(f.durationMinutes) || f.durationMinutes < LIMITS.durationMin || f.durationMinutes > LIMITS.durationMax) {
      problems.push("v.duration");
    }
  }
  if (!opts.editing && (typeof f.latitude !== "number" || typeof f.longitude !== "number"
      || Math.abs(f.latitude) > 90 || Math.abs(f.longitude) > 180)) {
    problems.push("v.place");
  }
  if (!AUDIENCES.some((a) => a.value === f.audience)) problems.push("v.audience");
  if (!SKILL_LEVELS.some((s) => s.value === f.skillLevel)) problems.push("v.level");

  const money = opts.money || { canShowPrice: false, canSellSpots: false };
  if (f.costPerPerson != null) {
    if (!money.canShowPrice) problems.push(money.reason || "money.notBusiness");
    else if (!Number.isFinite(f.costPerPerson) || f.costPerPerson < 0 || f.costPerPerson > LIMITS.costMax) {
      problems.push("v.cost");
    }
  }
  if (f.priceCents != null) {
    if (!money.canSellSpots) problems.push(money.sellReason || "money.notBusiness");
    else if (!isInt(f.priceCents) || f.priceCents < LIMITS.slotMinCents || f.priceCents > LIMITS.slotMaxCents) {
      problems.push("v.slot");
    }
  }

  if (f.repeat && !opts.editing) {
    if ((f.repeat.mode || "weekly") === "weekly" && (!f.repeat.weekdays || f.repeat.weekdays.length === 0)) {
      problems.push("v.weekdays");
    }
    if (!f.repeat.until) problems.push("v.until");
    else if (f.start && f.repeat.until < new Date(f.start.getFullYear(), f.start.getMonth(), f.start.getDate())) {
      problems.push("v.untilBefore");
    }
  }
  return problems;
}

/** EventVenue.sanitize: trim, cap at 40, empty → null. */
export function sanitizeVenue(name) {
  if (name == null) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;
  return [...trimmed].slice(0, LIMITS.venueMax).join("");
}

/** The shown price: a paid spot also shows its price to apps that only know `costPerPerson`. */
function shownCost(f) {
  if (f.priceCents != null) return clampCost(f.priceCents / 100);
  return f.costPerPerson != null ? clampCost(f.costPerPerson) : null;
}

/** The planned dates of the form (one for a single event). */
export function plannedDates(f, max = LIMITS.seriesMax) {
  return f.repeat ? repeatOccurrences(f.start, f.repeat, max).dates : [f.start];
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * The Firestore documents to write — one per occurrence — exactly as
 * EventRepository.createEvent builds them. Dates stay JS `Date`s here; the
 * caller converts them to Firestore Timestamps.
 *
 * @param {object} f validated form values:
 *   { sport, title, details, start: Date, capacity, minParticipants|null,
 *     durationMinutes|null, venueName, latitude, longitude, audience, skillLevel,
 *     costPerPerson|null, priceCents|null,
 *     repeat: { mode, weekdays?, until: Date } | null }
 * @param {{ uid: string, username: string }} owner
 * @param {{ randomUUID?: () => string, dates?: Date[] }} [deps]  `dates` overrides the planned dates
 *   (e.g. only the ones that fit the plan)
 * @returns {{ id: string, data: object }[]}
 */
export function buildEventDocuments(f, owner, deps = {}) {
  const uuid = deps.randomUUID ? () => newId(deps.randomUUID) : () => newId();
  const dates = deps.dates || plannedDates(f);
  // The app gives every repeat a series id (even a one-date one).
  const seriesId = f.repeat ? uuid() : null;
  const venueName = sanitizeVenue(f.venueName);
  const hash = geohash(f.latitude, f.longitude, 7);
  const cost = shownCost(f);

  return dates.map((date) => {
    const id = uuid();
    const data = {
      id,
      ownerId: owner.uid,
      title: f.title.trim(),
      details: f.details.trim(),
      creator: owner.username,
      participant: f.capacity,
      participantNames: [owner.username],
      participantUids: [owner.uid],
      sportsArt: f.sport,
      date,
      longitude: f.longitude,
      latitude: f.latitude,
      geohash: hash,
      audience: f.audience,
      skillLevel: f.skillLevel
    };
    // Absent when the organiser said nothing ("not stated" ≠ zero).
    if (f.minParticipants != null) data.minParticipants = f.minParticipants;
    if (f.durationMinutes != null) data.durationMinutes = f.durationMinutes;
    if (venueName) data.venueName = venueName;
    if (cost != null) data.costPerPerson = cost;
    if (seriesId) data.seriesId = seriesId;
    if (f.priceCents != null) { data.paidSlots = true; data.priceCents = f.priceCents; }
    return { id, data };
  });
}

/**
 * The update for an existing event — EventItems.editablePayload(for:). Optional
 * fields that were cleared come back in `cleared` so the caller can send
 * `deleteField()` for them (a missing key would keep the stale value).
 * Location, series and paid-spot terms are not part of an edit (as in the app).
 */
export function buildEditPayload(f) {
  const set = {
    title: f.title.trim(),
    details: f.details.trim(),
    date: f.start,
    sportsArt: f.sport,
    participant: f.capacity,
    audience: f.audience,
    skillLevel: f.skillLevel
  };
  const cleared = [];
  const opt = (key, value) => { if (value != null) set[key] = value; else cleared.push(key); };
  opt("minParticipants", f.minParticipants);
  opt("durationMinutes", f.durationMinutes);
  opt("venueName", sanitizeVenue(f.venueName));
  opt("costPerPerson", shownCost(f));
  return { set, cleared };
}
