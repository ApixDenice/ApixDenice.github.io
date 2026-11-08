// DIPS web event manager — the event model.
//
// Pure functions only (no DOM, no Firebase), so they can be unit-tested in Node
// and so the web writes exactly the documents the iOS app writes. Every rule
// here mirrors a Swift source of truth; keep them in step:
//
//   payload ............ DIPS/Core/Repositories/EventRepository.swift  createEvent(_:)
//   limits ............. DIPS/Map/CreateEvents/CreateEventsView.swift  isTitleValid / isDetailsValid / …
//                        DIPS/Model/Event.swift  EventCapacity, EventQuorum, EventDuration, EventVenue, EventSeries
//   geohash ............ DIPS/Core/App/Geohash.swift
//   server checks ...... firestore.rules  match /databaseMapEvents  (create)
//
// Paid events (costPerPerson / paidSlots) are deliberately not offered on the
// web yet: they need the trainer/business + payouts checks the app walks through.

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
  seriesMax: 26,         // EventSeries.maximumOccurrences
  seriesHorizonDays: 180 // EventSeries.maximumHorizonDays
});

export const AUDIENCES = [
  { value: "all", label: "Open to everyone" },
  { value: "womenOnly", label: "Women only" },
  { value: "beginnersOnly", label: "Beginners only" }
];

export const SKILL_LEVELS = [
  { value: "any", label: "Any level" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" }
];

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
// Dates
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

/**
 * Weekly repeat, as the app builds it: walk day by day from the first date up
 * to and including the end day, take every day whose weekday is selected, keep
 * the start time, stop at 26 occurrences and never look past 180 days.
 *
 * @param {Date} start         first date + time
 * @param {number[]} weekdays  JS weekdays (0 = Sunday … 6 = Saturday)
 * @param {Date} until         last day (time ignored)
 * @returns {{ dates: Date[], requested: number, capped: boolean }}
 */
export function weeklyOccurrences(start, weekdays, until) {
  const wanted = new Set(weekdays);
  const horizon = addDays(start, LIMITS.seriesHorizonDays);
  const lastDay = new Date(until.getFullYear(), until.getMonth(), until.getDate(), 23, 59, 59, 999);
  const end = lastDay < horizon ? lastDay : horizon;
  const all = [];
  for (let i = 0; ; i++) {
    const day = addDays(start, i);
    if (day > end) break;
    if (wanted.has(day.getDay())) all.push(day);
  }
  return { dates: all.slice(0, LIMITS.seriesMax), requested: all.length, capped: all.length > LIMITS.seriesMax };
}

// ---------------------------------------------------------------------------
// Validation (same limits as the app; the rules check again on the server)
// ---------------------------------------------------------------------------

const isInt = (v) => Number.isInteger(v);

/**
 * @param {object} f form values (see buildEventDocuments)
 * @param {Date} now
 * @returns {string[]} human-readable problems; empty when the form can be saved
 */
export function validateForm(f, now = new Date()) {
  const problems = [];
  const title = (f.title || "").trim();
  const details = (f.details || "").trim();
  if (!f.sport) problems.push("Choose a sport.");
  if (!title) problems.push("Add a title.");
  else if ([...title].length > LIMITS.titleMax) problems.push(`The title can have at most ${LIMITS.titleMax} characters.`);
  if (!details) problems.push("Add a short description.");
  else if ([...details].length > LIMITS.detailsMax) problems.push(`The description can have at most ${LIMITS.detailsMax} characters.`);
  if (!f.start) problems.push("Pick a date and start time.");
  else if (f.start <= now) problems.push("The start time is in the past.");
  if (!isInt(f.capacity) || f.capacity < LIMITS.capacityMin || f.capacity > LIMITS.capacityMax) {
    problems.push(`Group size must be between ${LIMITS.capacityMin} and ${LIMITS.capacityMax}.`);
  }
  if (f.minParticipants != null) {
    if (!isInt(f.minParticipants) || f.minParticipants < LIMITS.quorumMin || f.minParticipants > Math.min(30, f.capacity || 0)) {
      problems.push("The minimum number of people must be at least 2 and not more than the group size.");
    }
  }
  if (f.durationMinutes != null) {
    if (!isInt(f.durationMinutes) || f.durationMinutes < LIMITS.durationMin || f.durationMinutes > LIMITS.durationMax) {
      problems.push("Duration must be between 15 minutes and 8 hours.");
    }
  }
  if (typeof f.latitude !== "number" || typeof f.longitude !== "number"
      || Math.abs(f.latitude) > 90 || Math.abs(f.longitude) > 180) {
    problems.push("Set the meeting point on the map.");
  }
  if (!AUDIENCES.some((a) => a.value === f.audience)) problems.push("Choose who the event is for.");
  if (!SKILL_LEVELS.some((s) => s.value === f.skillLevel)) problems.push("Choose a level.");
  if (f.repeat) {
    if (!f.repeat.weekdays || f.repeat.weekdays.length === 0) problems.push("Pick at least one weekday to repeat on.");
    if (!f.repeat.until) problems.push("Pick the last day of the series.");
    else if (f.start && f.repeat.until < new Date(f.start.getFullYear(), f.start.getMonth(), f.start.getDate())) {
      problems.push("The series ends before it starts.");
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
 *     durationMinutes|null, venueName, latitude, longitude, audience,
 *     skillLevel, repeat: { weekdays: number[], until: Date } | null }
 * @param {{ uid: string, username: string }} owner
 * @param {{ randomUUID?: () => string }} [deps]
 * @returns {{ id: string, data: object }[]}
 */
export function buildEventDocuments(f, owner, deps = {}) {
  const uuid = deps.randomUUID ? () => newId(deps.randomUUID) : () => newId();
  const dates = f.repeat ? weeklyOccurrences(f.start, f.repeat.weekdays, f.repeat.until).dates : [f.start];
  const seriesId = f.repeat && dates.length > 1 ? uuid() : null;
  const venueName = sanitizeVenue(f.venueName);
  const hash = geohash(f.latitude, f.longitude, 7);

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
    if (seriesId) data.seriesId = seriesId;
    return { id, data };
  });
}
