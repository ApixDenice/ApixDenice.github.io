// DIPS organiser dashboard — revenue from paid spots.
//
// Source: `payments/{paymentIntentId}` documents written by the Stripe webhook
// (functions/lib/payments.js). The organiser may read the ones with their
// `organiserUid` (firestore.rules). Fields used:
//   amountCents  what the participant paid
//   feeCents     the DIPS application fee (5 % by default)
//   status       paid | kept (left after the refund window: organiser keeps it)
//                refunded | refundPending
//   createdAt    booking time (server timestamp)
//   eventId      the course
//
// Payments are Stripe destination charges: the card processing fee is paid by
// the platform (DIPS), so the organiser's share is exactly amount − DIPS fee.
// Pure functions, unit-tested in Node.

const EARNED = new Set(["paid", "kept"]);
const REFUNDED = new Set(["refunded", "refundPending"]);

export const DEFAULT_FEE_PERCENT = 5;

/** The organiser's share of a spot price — what the backend's application fee leaves. */
export function organiserShare(priceCents, feePercent = DEFAULT_FEE_PERCENT) {
  return priceCents - Math.round((priceCents * feePercent) / 100);
}

const toDate = (v) => (v && typeof v.toDate === "function" ? v.toDate() : v instanceof Date ? v : v ? new Date(v) : null);

/** Normalised payment rows. */
export function normalise(payments) {
  return payments.map((p) => ({
    id: p.id,
    eventId: p.eventId || null,
    amountCents: Number.isFinite(p.amountCents) ? p.amountCents : 0,
    feeCents: Number.isFinite(p.feeCents) ? p.feeCents : 0,
    status: String(p.status || "paid"),
    date: toDate(p.createdAt)
  })).sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
}

/** Calendar-month key in local time ("2026-11"). */
export const monthKeyLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** The date range of a filter: "month" (this month), "last" (last month) or "all". */
export function rangeOf(kind, now = new Date()) {
  if (kind === "month") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
  if (kind === "last") return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1) };
  return { from: null, to: null };
}

const inRange = (row, r) => (!r.from || (row.date && row.date >= r.from)) && (!r.to || (row.date && row.date < r.to));

/**
 * Totals for a range. Earned = paid + kept; refunds are listed separately and
 * are not part of gross/net (the DIPS fee is refunded with them).
 */
export function summarise(rows, range = { from: null, to: null }) {
  const out = { grossCents: 0, feeCents: 0, netCents: 0, bookings: 0, refundedCents: 0, refunds: 0 };
  for (const r of rows) {
    if (!inRange(r, range)) continue;
    if (EARNED.has(r.status)) {
      out.grossCents += r.amountCents;
      out.feeCents += r.feeCents;
      out.netCents += r.amountCents - r.feeCents;
      out.bookings += 1;
    } else if (REFUNDED.has(r.status)) {
      out.refundedCents += r.amountCents;
      out.refunds += 1;
    }
  }
  return out;
}

/** Earned net and bookings per month, newest first. */
export function byMonth(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.date || !EARNED.has(r.status)) continue;
    const key = monthKeyLocal(r.date);
    const m = map.get(key) || { key, grossCents: 0, netCents: 0, bookings: 0 };
    m.grossCents += r.amountCents; m.netCents += r.amountCents - r.feeCents; m.bookings += 1;
    map.set(key, m);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

/** Earned per course (eventId), biggest first; `range` optional. */
export function byCourse(rows, range = { from: null, to: null }) {
  const map = new Map();
  for (const r of rows) {
    if (!EARNED.has(r.status) || !inRange(r, range)) continue;
    const key = r.eventId || "?";
    const c = map.get(key) || { eventId: r.eventId, grossCents: 0, netCents: 0, bookings: 0 };
    c.grossCents += r.amountCents; c.netCents += r.amountCents - r.feeCents; c.bookings += 1;
    map.set(key, c);
  }
  return [...map.values()].sort((a, b) => b.netCents - a.netCents);
}

/** Net earned per eventId (for the course cards). */
export function netByEvent(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!EARNED.has(r.status) || !r.eventId) continue;
    map.set(r.eventId, (map.get(r.eventId) || 0) + r.amountCents - r.feeCents);
  }
  return map;
}
