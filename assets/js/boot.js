/* ApixDenice — runs in <head> before first paint (loaded synchronously).
   Replaces the former inline scripts so the Content Security Policy can forbid
   inline JavaScript entirely (a stored/reflected XSS then can't execute).

   1. Anti-framing: GitHub Pages can't send X-Frame-Options or a CSP
      frame-ancestors header (frame-ancestors is ignored in <meta>), so a hostile
      site could load these pages in an invisible iframe and trick a signed-in
      organiser into clicking "Cancel" (clickjacking). If we are framed, the page
      is hidden and we try to break out to the top window.
   2. Flags JS for scroll reveals and decides whether the home intro plays (only
      for a fresh entry, never on reload / back / internal navigation / reduced
      motion). The page opts in via data-intro on <html>.
   3. Applies the language (DE/EN): the visitor's choice from the header switch
      (localStorage "dips-lang", shared with the DIPS manager), otherwise the
      browser language. No cookies are used. */
(function () {
  var d = document.documentElement;

  // 1. Anti-framing ---------------------------------------------------------
  if (window.top !== window.self) {
    d.style.display = "none";
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* sandboxed: stay hidden */ }
    return;
  }

  // 2./3. Language + intro ----------------------------------------------------
  d.className += " js";
  var stored = null;
  try { stored = localStorage.getItem("dips-lang"); } catch (e) {}
  if (stored !== "de" && stored !== "en") stored = null;
  var lang = stored || ((navigator.language || "").toLowerCase().indexOf("de") === 0 ? "de" : "en");
  var pageLang = d.getAttribute("data-page-lang");
  if (pageLang) {
    /* A page that exists once per language (e.g. a privacy policy).
       data-alt-url comes from the page's front matter; only same-origin
       relative paths are followed. */
    var alt = d.getAttribute("data-alt-url") || "";
    if (stored && stored !== pageLang && alt.charAt(0) === "/" && alt.charAt(1) !== "/") {
      location.replace(alt + location.hash);
    }
    lang = pageLang;
  }
  d.className += " lang-" + lang;
  d.lang = lang;

  if (d.hasAttribute("data-intro")) {
    try {
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var nav = performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : null;
      var fresh = !nav || nav.type === "navigate";
      var internal = false;
      if (document.referrer) { internal = new URL(document.referrer).host === location.host; }
      if (!reduce && fresh && !internal && location.hash === "") { d.className += " intro"; }
    } catch (e) {}
  }

  // German document title (the English one comes from jekyll-seo-tag)
  d.setAttribute("data-title-en", document.title);
  var de = d.getAttribute("data-title-de");
  if (lang === "de" && de) document.title = de;
})();
