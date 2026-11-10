// Too Much Food duel page (/toomuchfood/duel/). Moved out of the page so the CSP can forbid inline JS.
// Everything shown here is read from the link itself; nothing is sent anywhere.
// Format mirrors GhostCodec in Duel.swift (container byte, then "TM", version 1).
//
// The replay is the point of this page. A link that is only a number is a dead
// end for anyone who does not already have the game; a ten-second replay of the
// run they are being challenged to beat is the whole pitch.
// Language: same choice as the rest of the site (localStorage "dips-lang"),
// otherwise the browser language. Only fixed strings from this file are used.
var DuelLang = (function () {
  var T = {
    en: { kicker: "DUEL!", whoGeneric: "A friend challenges you", who: "{n} challenges you", friend: "A FRIEND",
          tagGeneric: "THEIR RUN", tag: "{n}'S RUN", sub: "TO BEAT · SAME COURSE · RACE THEIR GHOST",
          open: "Open in Too Much Food", get: "Get the game — free",
          help: "Don't have it? Tap <b>Get the game</b> — the challenge is waiting when you open it.",
          title: "Duel · Too Much Food" },
    de: { kicker: "DUELL!", whoGeneric: "Jemand fordert dich heraus", who: "{n} fordert dich heraus", friend: "JEMAND",
          tagGeneric: "IHR LAUF", tag: "LAUF VON {n}", sub: "ZU SCHLAGEN · GLEICHE STRECKE · LAUF GEGEN DEN GEIST",
          open: "In Too Much Food öffnen", get: "Spiel holen – kostenlos",
          help: "Noch nicht installiert? Tippe auf <b>Spiel holen</b> – die Herausforderung wartet, wenn du es öffnest.",
          title: "Duell · Too Much Food" }
  };
  var lang, name = null;
  try { lang = localStorage.getItem("dips-lang"); } catch (e) {}
  if (lang !== "de" && lang !== "en") lang = (navigator.language || "").toLowerCase().indexOf("de") === 0 ? "de" : "en";
  function t(k) { return T[lang][k]; }
  function apply() {
    document.documentElement.lang = lang;
    document.title = t("title");
    document.querySelectorAll("[data-t]").forEach(function (e) { e.textContent = t(e.getAttribute("data-t")); });
    document.querySelectorAll("[data-t-html]").forEach(function (e) { e.innerHTML = t(e.getAttribute("data-t-html")); });
    if (name !== null) {
      var shown = name || t("friend");
      document.getElementById("who").textContent = t("who").replace("{n}", shown);
      document.getElementById("tag").textContent = t("tag").replace("{n}", shown);
    }
    document.querySelectorAll(".lang button").forEach(function (b) {
      var on = b.getAttribute("data-l") === lang;
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
    });
  }
  document.querySelectorAll(".lang button").forEach(function (b) {
    b.addEventListener("click", function () {
      lang = b.getAttribute("data-l");
      try { localStorage.setItem("dips-lang", lang); } catch (e) {}
      apply();
    });
  });
  apply();
  return { setName: function (n) { name = n; apply(); } };
})();

(function () {
  var params = new URLSearchParams(location.search);
  var token = params.get("d");
  if (!token && location.hash.indexOf("#d=") === 0) token = location.hash.slice(3);
  if (!token || token.length > 1400000) return;

  var openLink = document.getElementById("open");
  openLink.href = "toomuchfood://duel?d=" + encodeURIComponent(token);

  // A custom scheme fails silently when the app is not installed, so the
  // primary button was a dead end for exactly the visitors worth converting —
  // the ones who have never seen the game. Fire the scheme as before, then, if
  // this page is still in front of them a moment later, the app did not take
  // over and the App Store is where they should be. Deliberately triggered by
  // the tap rather than on load: auto-firing a scheme raises a "Cannot Open
  // Page" alert in some browsers, which is worse than a dead button.
  openLink.addEventListener("click", function () {
    var store = "https://apps.apple.com/app/id6749512460";
    window.setTimeout(function () {
      if (document.visibilityState === "visible") { window.location = store; }
    }, 1400);
  });

  function fromBase64URL(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function body(bytes) {
    if (bytes[0] === 0) return bytes.subarray(1);
    if (bytes[0] !== 1 || typeof DecompressionStream === "undefined") return null;
    // Inflate with a hard size cap: a crafted link could otherwise expand to
    // gigabytes (decompression bomb) and crash the visitor's tab. A real run
    // (<= 10,000 samples) is far below 1 MB.
    var MAX = 1024 * 1024;
    var reader = new Blob([bytes.subarray(1)]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    var chunks = [], total = 0;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      total += r.value.length;
      if (total > MAX) { reader.cancel().catch(function () {}); throw new Error("too large"); }
      chunks.push(r.value);
    }
    var out = new Uint8Array(total), at = 0;
    chunks.forEach(function (c) { out.set(c, at); at += c.length; });
    return out;
  }

  function parse(b) {
    var o = 0;
    function need(n) { if (o + n > b.length) throw new Error("short"); }
    function u8() { need(1); return b[o++]; }
    function u16() { need(2); var v = b[o] | (b[o + 1] << 8); o += 2; return v; }
    function varint() {
      var result = 0, mul = 1;
      for (var i = 0; i < 10; i++) {
        var byte = u8();
        result += (byte & 0x7f) * mul;
        if (!(byte & 0x80)) return result;
        mul *= 128;
      }
      throw new Error("varint");
    }
    function zigzag() { var raw = varint(); return (raw % 2) ? -((raw + 1) / 2) : raw / 2; }

    if (u8() !== 0x54 || u8() !== 0x4d || u8() !== 1) throw new Error("format");
    need(8); o += 8;                       // seed
    var score = varint();
    var interval = u16() / 1000;           // seconds between samples
    var count = varint();
    if (count < 2 || count > 10000) throw new Error("count");
    need(count);
    var ys = b.subarray(o, o + count); o += count;
    var scores = new Int32Array(count), running = 0;
    for (var i = 0; i < count; i++) { running += zigzag(); scores[i] = running; }
    var len = u8(); need(len);
    var name = new TextDecoder().decode(b.subarray(o, o + len));
    return { score: score, name: name, interval: interval, ys: ys, scores: scores };
  }

  render();
  async function render() {
    var duel;
    try {
      var raw = await body(fromBase64URL(token));
      if (!raw) return;
      duel = parse(raw);
    } catch (e) { return; }               // keep the generic copy

    var name = (duel.name || "").replace(/[^A-Z0-9 _.\-]/gi, "").slice(0, 14).toUpperCase();
    DuelLang.setName(name);   // "" → "A FRIEND" / "JEMAND"
    document.getElementById("score").textContent = String(duel.score);
    document.getElementById("replay").className = "replay on";
    play(duel);
  }

  // ---------------------------------------------------------------- replay

  function play(duel) {
    var canvas = document.getElementById("canvas");
    var ctx = canvas.getContext("2d");
    var live = document.getElementById("live");
    var seek = document.getElementById("seek");
    if (!ctx) return;

    var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      var rect = canvas.getBoundingClientRect();
      W = Math.max(240, Math.round(rect.width));
      H = Math.round(rect.height) || 200;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    var duration = duel.ys.length * duel.interval;
    // Nobody watches a three-minute replay on a landing page. Long runs are
    // sped up rather than cut, so the ending is always the real ending.
    var rate = Math.max(1, duration / 12);
    var groundH = 26, pad = 18;
    var pxPerSecond = 190;                 // scroll speed of the trail
    var frankX = 0.26;

    function heightAt(t) {
      var pos = Math.max(0, Math.min(t / duel.interval, duel.ys.length - 1));
      var i = Math.floor(pos), f = pos - i;
      var a = duel.ys[i] / 255, b = duel.ys[Math.min(i + 1, duel.ys.length - 1)] / 255;
      return a + (b - a) * f;
    }
    function yFor(n) {
      var top = pad, bottom = H - groundH - pad;
      return bottom - n * (bottom - top);
    }
    function scoreAt(t) {
      var i = Math.max(0, Math.min(Math.round(t / duel.interval), duel.scores.length - 1));
      return duel.scores[i];
    }

    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var start = null, holdUntil = 0;

    function frame(now) {
      if (start === null) start = now;
      var elapsed = (now - start) / 1000 * rate;
      var t = Math.min(elapsed, duration);

      draw(t, elapsed);

      if (t < duration) { requestAnimationFrame(frame); return; }
      // Hold on the crash, then run it again — the loop is what makes the
      // page feel alive while someone decides whether to install.
      if (!holdUntil) holdUntil = now + 1600;
      if (now < holdUntil) { requestAnimationFrame(frame); return; }
      start = null; holdUntil = 0;
      requestAnimationFrame(frame);
    }

    function draw(t, elapsed) {
      // Sky
      var sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#8FD0F5");
      sky.addColorStop(1, "#CFEBFB");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Scrolling ground stripes, for a sense of speed.
      ctx.fillStyle = "#7FC24A";
      ctx.fillRect(0, H - groundH, W, groundH);
      ctx.fillStyle = "rgba(255,255,255,.18)";
      var offset = (elapsed * pxPerSecond) % 48;
      for (var x = -48; x < W + 48; x += 48) {
        ctx.fillRect(x - offset, H - groundH, 24, groundH);
      }

      // The run itself: the last couple of seconds of the flight path.
      var head = { x: W * frankX, y: yFor(heightAt(t)) };
      var window_ = 2.4;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,201,60,.85)";
      ctx.beginPath();
      var first = true;
      for (var dt = window_; dt >= 0; dt -= duel.interval) {
        var ti = t - dt;
        if (ti < 0) continue;
        var px = head.x - dt * pxPerSecond;
        var py = yFor(heightAt(ti));
        if (first) { ctx.moveTo(px, py); first = false; } else { ctx.lineTo(px, py); }
      }
      ctx.stroke();

      // The ghost.
      var crashed = t >= duration;
      drawGhost(ctx, head.x, head.y, crashed);

      live.textContent = String(scoreAt(t));
      seek.style.width = Math.round((t / duration) * 100) + "%";

      if (crashed) {
        ctx.fillStyle = "rgba(18,10,22,.55)";
        ctx.fillRect(0, H / 2 - 26, W, 52);
        ctx.fillStyle = "#FFC93C";
        ctx.font = "900 22px 'Avenir Next', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("FINISHED ON " + duel.score, W / 2, H / 2 + 8);
      }
    }

    function drawGhost(c, x, y, crashed) {
      var r = 17;
      c.save();
      c.globalAlpha = crashed ? 0.45 : 0.92;
      c.fillStyle = "#EAF7FF";
      c.strokeStyle = "rgba(60,120,160,.45)";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y - 2, r, Math.PI, 0);                 // domed head
      c.lineTo(x + r, y + r - 2);
      // Wavy hem, so it reads as a ghost at a glance rather than a ball.
      for (var i = 0; i < 3; i++) {
        var w = (r * 2) / 3;
        c.quadraticCurveTo(x + r - w * (i + 0.5), y + r + 6, x + r - w * (i + 1), y + r - 2);
      }
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = "#2A3F52";
      c.beginPath(); c.arc(x - 6, y - 4, 2.6, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(x + 5, y - 4, 2.6, 0, Math.PI * 2); c.fill();
      c.restore();
    }

    if (reduced) { draw(duration, duration); return; }
    requestAnimationFrame(frame);
  }
})();
