// DIPS invite page (/dips/e/?id=<uuid>). Moved out of the page so the CSP can forbid inline JS.
(function () {
  "use strict";
  var PREVIEW = "https://us-central1-hilsports.cloudfunctions.net/eventPreview";
  // Set once the App Store record exists; until then the second button goes to /dips/.
  var APP_STORE_URL = "";

  // Language: same choice as the rest of the site (localStorage "dips-lang"), else the browser's.
  var T = {
    de: {
      invited: "Du bist eingeladen", open: "In DIPS öffnen", get: "DIPS holen", more: "Mehr über DIPS",
      note: "Mit DIPS siehst du, wer dabei ist, kannst beitreten und im Gruppenchat absprechen, wer den Ball mitbringt.",
      activity: "Sport-Aktivität", map: "Ungefähre Lage in Karten", free: "Kostenlos", perPerson: "{v} pro Person",
      beginner: "Anfänger", intermediate: "Fortgeschritten", advanced: "Profi",
      womenOnly: "Nur für Frauen", beginnersOnly: "Für Einsteiger",
      full: "Ausgebucht – Warteliste in der App", one: "Noch 1 Platz frei", many: "Noch {n} Plätze frei",
      pastT: "Diese Aktivität ist schon vorbei", pastX: "Auf der Karte in DIPS findest du, was als Nächstes in deiner Nähe los ist.",
      badT: "Link unvollständig", badX: "Dieser Einladungslink ist nicht vollständig. Frag die Person, die ihn geschickt hat, nach einem neuen.",
      goneT: "Diese Aktivität gibt es nicht mehr", goneX: "Sie wurde abgesagt oder gelöscht. In DIPS findest du andere Aktivitäten in deiner Nähe.",
      errX: "Die Details konnten gerade nicht geladen werden. Öffne die Einladung in DIPS.",
      title: "Einladung · DIPS", locale: "de-DE"
    },
    en: {
      invited: "You're invited", open: "Open in DIPS", get: "Get DIPS", more: "More about DIPS",
      note: "With DIPS you can see who's going, join in and agree in the group chat who brings the ball.",
      activity: "Sport activity", map: "Approximate location in Maps", free: "Free", perPerson: "{v} per person",
      beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced",
      womenOnly: "Women only", beginnersOnly: "For beginners",
      full: "Fully booked – waiting list in the app", one: "1 spot left", many: "{n} spots left",
      pastT: "This activity is already over", pastX: "The map in DIPS shows what's on next near you.",
      badT: "Incomplete link", badX: "This invite link isn't complete. Ask the person who sent it for a new one.",
      goneT: "This activity no longer exists", goneX: "It was cancelled or deleted. DIPS shows other activities near you.",
      errX: "The details couldn't be loaded right now. Open the invite in DIPS.",
      title: "Invite · DIPS", locale: "en-GB"
    }
  };
  var lang;
  try { lang = localStorage.getItem("dips-lang"); } catch (e) {}
  if (lang !== "de" && lang !== "en") lang = (navigator.language || "").toLowerCase().indexOf("de") === 0 ? "de" : "en";
  function t(k, p) {
    var v = T[lang][k] || k;
    return p ? v.replace(/\{(\w+)\}/g, function (_, n) { return p[n]; }) : v;
  }

  var card = document.getElementById("card");
  var openBtn = document.getElementById("open");
  var getBtn = document.getElementById("get");
  var view = null;   // what the card shows, so a language switch can redraw it

  if (APP_STORE_URL) { getBtn.href = APP_STORE_URL; }

  var params = new URLSearchParams(location.search);
  var id = params.get("id") || "";
  var isUUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(id);

  // Custom scheme for people who have the app but reached this page anyway
  // (links tapped inside the same domain, some in-app browsers). It fails
  // silently without the app, so fall through to the store after a moment.
  openBtn.href = isUUID ? "dips://event/" + id : "dips://";
  openBtn.addEventListener("click", function () {
    window.setTimeout(function () {
      if (document.visibilityState === "visible") { window.location = getBtn.href; }
    }, 1400);
  });

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fact(icon, text) {
    var li = el("li"); li.appendChild(el("span", "i", icon)); li.appendChild(el("span", null, text)); return li;
  }
  function state(titleKey, textKey) {
    view = { state: [titleKey, textKey] };
    card.className = "card muted-state";
    card.innerHTML = "";
    card.appendChild(el("p", "eyebrow", "DIPS"));
    card.appendChild(el("h1", null, t(titleKey)));
    card.appendChild(el("p", "details", t(textKey)));
  }

  function render(ev) {
    if (ev.state === "past") { state("pastT", "pastX"); return; }
    view = { ev: ev };
    card.className = "card";
    card.innerHTML = "";
    card.appendChild(el("p", "eyebrow", ev.sport ? t("invited") + " · " + ev.sport : t("invited")));
    card.appendChild(el("h1", null, ev.title || ev.sport || t("activity")));

    var facts = el("ul", "facts");
    if (ev.date) {
      var d = new Date(ev.date);
      var when = new Intl.DateTimeFormat(t("locale"), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(d);
      if (ev.durationMinutes) {
        var end = new Date(d.getTime() + ev.durationMinutes * 60000);
        when += " – " + new Intl.DateTimeFormat(t("locale"), { hour: "2-digit", minute: "2-digit" }).format(end);
      }
      facts.appendChild(fact("📅", when));
    }
    if (ev.venueName) facts.appendChild(fact("📍", ev.venueName));
    // Only real coordinates go into the link (never raw strings from the API).
    var lat = Number(ev.latitude), lng = Number(ev.longitude);
    if (ev.latitude != null && ev.longitude != null && isFinite(lat) && isFinite(lng) &&
        Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      var li = fact("🗺️", "");
      var a = el("a", "inline", t("map"));
      a.rel = "noopener noreferrer";
      a.href = "https://maps.apple.com/?ll=" + lat.toFixed(3) + "," + lng.toFixed(3) + "&z=13";
      li.lastChild.appendChild(a);
      facts.appendChild(li);
    }
    if (typeof ev.costPerPerson === "number") {
      facts.appendChild(fact("💶", ev.costPerPerson === 0 ? t("free")
        : t("perPerson", { v: ev.costPerPerson.toLocaleString(t("locale"), { style: "currency", currency: "EUR" }) })));
    }
    if (/^(beginner|intermediate|advanced)$/.test(ev.skillLevel)) facts.appendChild(fact("💪", t(ev.skillLevel)));
    if (/^(womenOnly|beginnersOnly)$/.test(ev.audience || "")) facts.appendChild(fact("👥", t(ev.audience)));
    card.appendChild(facts);

    if (ev.details) card.appendChild(el("p", "details", ev.details));

    if (ev.capacity != null) {
      var full = ev.spotsLeft === 0;
      var left = Math.max(0, Math.floor(Number(ev.spotsLeft) || 0));
      var text = full ? t("full") : (left === 1 ? t("one") : t("many", { n: left }));
      card.appendChild(el("span", "spots" + (full ? " full" : ""), text));
    }
  }

  function applyLang() {
    document.documentElement.lang = lang;
    document.title = view && view.ev && view.ev.title ? view.ev.title + " · DIPS" : t("title");
    document.querySelectorAll("[data-t]").forEach(function (e) { e.textContent = t(e.getAttribute("data-t")); });
    getBtn.textContent = APP_STORE_URL ? t("get") : t("more");
    document.querySelectorAll(".lang button").forEach(function (b) {
      var on = b.getAttribute("data-l") === lang;
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
    });
    if (view && view.ev) render(view.ev);
    else if (view && view.state) state(view.state[0], view.state[1]);
  }
  document.querySelectorAll(".lang button").forEach(function (b) {
    b.addEventListener("click", function () {
      lang = b.getAttribute("data-l");
      try { localStorage.setItem("dips-lang", lang); } catch (e) {}
      applyLang();
    });
  });
  applyLang();

  if (!isUUID) { state("badT", "badX"); return; }

  fetch(PREVIEW + "?id=" + encodeURIComponent(id), { headers: { "Accept": "application/json" } })
    .then(function (r) {
      if (r.status === 404) { state("goneT", "goneX"); return null; }
      if (!r.ok) throw new Error("status " + r.status);
      return r.json();
    })
    .then(function (ev) { if (ev) { render(ev); applyLang(); } })
    .catch(function () { state("invited", "errX"); });
})();
