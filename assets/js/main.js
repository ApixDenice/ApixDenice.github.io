// ApixDenice — site interactions (no dependencies, no storage, no tracking)
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.addEventListener('DOMContentLoaded', function () {
    initNav();
    initHeaderState();
    initCarousels();
    initReveal();
    initHeroTilt();
    initIntro();
  });

  /* ---------------- Navigation ---------------- */
  function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var menu = document.getElementById('nav-menu');

    function closeMenu() {
      if (!menu || !toggle) return;
      menu.classList.remove('open');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }

    if (toggle && menu) {
      toggle.addEventListener('click', function () {
        var open = menu.classList.toggle('open');
        toggle.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      // Close the mobile menu after following an in-page link (e.g. /#about)
      menu.addEventListener('click', function (e) {
        if (e.target.closest('a')) closeMenu();
      });
    }

    var dropdowns = document.querySelectorAll('.nav-dropdown');
    function closeDropdown(dd) {
      dd.classList.remove('open');
      var b = dd.querySelector('.nav-dropdown-toggle');
      if (b) b.setAttribute('aria-expanded', 'false');
    }

    dropdowns.forEach(function (dd) {
      var btn = dd.querySelector('.nav-dropdown-toggle');
      if (!btn) return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var open = dd.classList.toggle('open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });

    document.addEventListener('click', function (e) {
      dropdowns.forEach(function (dd) { if (!dd.contains(e.target)) closeDropdown(dd); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      dropdowns.forEach(function (dd) {
        if (dd.classList.contains('open')) {
          closeDropdown(dd);
          var b = dd.querySelector('.nav-dropdown-toggle');
          if (b) b.focus();
        }
      });
      closeMenu();
    });
  }

  /* Home header is dark over the hero, light once you scroll past it */
  function initHeaderState() {
    var header = document.querySelector('.site-header');
    if (!header || !document.body.classList.contains('is-home')) return;
    var hero = document.querySelector('.home-hero');
    var ticking = false;
    function update() {
      var limit = hero ? hero.offsetHeight - header.offsetHeight - 10 : 40;
      header.classList.toggle('is-scrolled', window.scrollY > limit);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  /* ---------------- Screenshot carousel ---------------- */
  function initCarousels() {
    document.querySelectorAll('[data-carousel]').forEach(function (carousel) {
      var slides = Array.prototype.slice.call(carousel.querySelectorAll('.carousel-slide'));
      if (!slides.length) return;

      var captionEl = carousel.querySelector('[data-carousel-caption]');
      var countEl = carousel.querySelector('[data-carousel-count]');
      var thumbsEl = carousel.querySelector('[data-carousel-thumbs]');
      var index = 0;
      var thumbs = [];

      if (thumbsEl) {
        slides.forEach(function (slide, i) {
          var src = slide.querySelector('img').getAttribute('src');
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'carousel-thumb' + (i === 0 ? ' is-active' : '');
          btn.setAttribute('aria-label', 'Show screenshot ' + (i + 1));
          var im = document.createElement('img');
          im.src = src;
          im.alt = '';
          im.loading = 'lazy';
          im.width = 58;
          im.height = 126;
          btn.appendChild(im);
          btn.addEventListener('click', function () { go(i); });
          thumbsEl.appendChild(btn);
          thumbs.push(btn);
        });
      }

      function go(next) {
        index = (next + slides.length) % slides.length;
        slides.forEach(function (s, i) { s.classList.toggle('is-active', i === index); });
        thumbs.forEach(function (t, i) { t.classList.toggle('is-active', i === index); });
        if (captionEl) captionEl.textContent = slides[index].getAttribute('data-caption') || '';
        if (countEl) countEl.textContent = (index + 1) + ' / ' + slides.length;
      }

      var prev = carousel.querySelector('.carousel-prev');
      var next = carousel.querySelector('.carousel-next');
      if (prev) prev.addEventListener('click', function () { go(index - 1); });
      if (next) next.addEventListener('click', function () { go(index + 1); });

      carousel.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
      });

      var startX = null;
      var stage = carousel.querySelector('.carousel-stage');
      if (stage) {
        stage.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
        stage.addEventListener('touchend', function (e) {
          if (startX === null) return;
          var dx = e.changedTouches[0].clientX - startX;
          if (Math.abs(dx) > 45) go(dx < 0 ? index + 1 : index - 1);
          startX = null;
        }, { passive: true });
      }

      carousel.addEventListener('click', function (e) {
        var img = e.target.closest('.carousel-slide img');
        if (img) openLightbox(img.getAttribute('src'), img.getAttribute('alt'));
      });
    });
  }

  function openLightbox(src, alt) {
    var opener = document.activeElement;
    var box = document.createElement('div');
    box.className = 'lightbox is-open';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Screenshot');
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'lightbox-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    var img = document.createElement('img');
    img.src = src;
    img.alt = alt || '';
    box.appendChild(close);
    box.appendChild(img);
    document.body.appendChild(box);
    document.body.style.overflow = 'hidden';
    close.focus();

    function dismiss() {
      box.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      if (opener && opener.focus) opener.focus();
    }
    function onKey(e) { if (e.key === 'Escape') dismiss(); }
    box.addEventListener('click', function (e) {
      if (e.target === box || e.target === close) dismiss();
    });
    document.addEventListener('keydown', onKey);
  }

  /* ---------------- Reveal on scroll ---------------- */
  function initReveal() {
    var els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    if (!('IntersectionObserver' in window) || reduceMotion) {
      els.forEach(function (el) { el.classList.add('visible'); });
      return;
    }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    els.forEach(function (el) { obs.observe(el); });
  }

  /* ---------------- Hero: pointer-driven 3D tilt ---------------- */
  function initHeroTilt() {
    var scene = document.getElementById('hero-scene');
    var hero = document.querySelector('.home-hero');
    if (!scene || !hero || reduceMotion) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    var target = { x: 0, y: 0 };
    var current = { x: 0, y: 0 };
    var raf = null;

    function loop() {
      current.x += (target.x - current.x) * 0.08;
      current.y += (target.y - current.y) * 0.08;
      scene.style.setProperty('--rx', current.x.toFixed(2) + 'deg');
      scene.style.setProperty('--ry', current.y.toFixed(2) + 'deg');
      if (Math.abs(target.x - current.x) > 0.05 || Math.abs(target.y - current.y) > 0.05) {
        raf = requestAnimationFrame(loop);
      } else {
        raf = null;
      }
    }
    function kick() { if (!raf) raf = requestAnimationFrame(loop); }

    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      var nx = (e.clientX - r.left) / r.width - 0.5;   // -0.5 … 0.5
      var ny = (e.clientY - r.top) / r.height - 0.5;
      target.y = nx * 36;    // rotateY follows horizontal movement
      target.x = -ny * 26;   // rotateX follows vertical movement
      kick();
    });
    hero.addEventListener('pointerleave', function () { target.x = 0; target.y = 0; kick(); });
  }

  /* ---------------- Intro ----------------
     The timeline itself is pure CSS (works even if this script fails).
     Here we add: the "genesis pixel" wordmark build, skip on click/key,
     fly the logo into its hero position, cleanup.

     Intro clock (ms from the start of the CSS timeline, see custom.css):
        0  logo spins in             550  the "A" draws
     1050  the pixel drops in       1450  the pixel emits the wordmark (canvas)
    ~2580  a resolve wave follows the build left → right: text fades in beneath
           the grid, pixels melt away (letters resolve while the last ones land)
    ~3630  wordmark fully resolved
     3700  logo flies to the hero   3850  overlay fades        4550  cleanup */
  var INTRO = { emit: 1450, fly: 3700, done: 4550 };

  function initIntro() {
    var intro = document.getElementById('intro');
    if (!intro) return;
    if (!root.classList.contains('intro')) { intro.remove(); return; }

    var fly = document.getElementById('intro-fly');
    var heroTarget = document.getElementById('hero-logo-target');
    var skipBtn = document.getElementById('intro-skip');
    var finished = false;
    var timers = [];
    var clock = introClock(intro);
    var genesis = null;
    try { genesis = initGenesis(intro, clock); } catch (e) { intro.classList.add('is-resolved'); }

    function cleanup() {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      if (genesis) genesis.stop();
      root.classList.add('intro-done');
      intro.remove();
      document.removeEventListener('keydown', onKey);
    }

    function skip() {
      if (finished) return;
      if (genesis) genesis.stop();
      root.classList.add('intro-skipped');
      intro.style.transition = 'opacity .35s ease';
      intro.style.opacity = '0';
      timers.push(setTimeout(cleanup, 380));
    }

    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); skip(); }
    }

    // Fly the intro logo onto the hero logo (FLIP), then let the overlay fade.
    function flyToHero() {
      if (finished || !fly || !heroTarget) return;
      var from = fly.getBoundingClientRect();
      var to = heroTarget.getBoundingClientRect();
      if (!to.width) return;
      root.classList.add('intro-leaving');
      var dx = (to.left + to.width / 2) - (from.left + from.width / 2);
      var dy = (to.top + to.height / 2) - (from.top + from.height / 2);
      var scale = to.width / from.width;
      fly.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ') rotateY(-14deg) rotateX(8deg)';
    }

    intro.addEventListener('click', skip);
    if (skipBtn) skipBtn.addEventListener('click', function (e) { e.stopPropagation(); skip(); });
    document.addEventListener('keydown', onKey);

    // Scheduled against the CSS clock, so a late-running script stays in sync.
    timers.push(setTimeout(flyToHero, Math.max(0, INTRO.fly - clock())));
    timers.push(setTimeout(cleanup, Math.max(0, INTRO.done - clock())));
  }

  // Milliseconds elapsed on the CSS intro timeline. Anchored to the pixel's own CSS
  // animation (currentTime includes its delay), falling back to time since navigation.
  function introClock(intro) {
    var elapsed = performance.now();
    try {
      var px = intro.querySelector('.logo-px');
      var anims = px && px.getAnimations ? px.getAnimations() : [];
      for (var i = 0; i < anims.length; i++) {
        if (anims[i].animationName === 'intro-pixel' && anims[i].currentTime != null) { elapsed = anims[i].currentTime; break; }
      }
    } catch (e) {}
    var t0 = performance.now() - elapsed;
    return function () { return performance.now() - t0; };
  }

  /* ---------------- Genesis pixel ----------------
     The wordmark is rasterised into a coarse grid (sampled from the real DOM text, so
     it matches font, kerning and letter-spacing exactly). Each filled cell becomes a
     pixel that leaves the logo's pixel and arcs into place, left to right, carrying
     the brand gradient in flight. A resolve wave then sweeps the same direction:
     the real text fades in under the grid (showing through its gutters first) and
     the pixels grow into each other and melt away.
     Returns { stop } or null when unsupported (the CSS wipe then plays instead). */
  var GENESIS = {
    window: 600,   // ms over which pixels are emitted, left → right
    jitter: 80,    // ms random emission jitter per pixel
    flight: 650,   // ms each pixel is in the air
    hold: 250,     // ms every pixel shows landed before the resolve wave reaches it
    sweep: 450,    // ms the resolve wave takes to cross the word, left → right
    resolve: 600   // ms each spot takes to go from pixel grid to crisp text
  };
  var BRAND_GRADIENT = [[255, 178, 36], [255, 79, 109], [124, 92, 255]]; // amber → pink → violet

  function initGenesis(intro, clock) {
    var word = intro.querySelector('.intro-word');
    var source = intro.querySelector('.logo-px');
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!word || !source || !ctx || !document.fonts || !document.fonts.load) return null;
    if (clock() > INTRO.emit + GENESIS.window) return null; // too late to build — let CSS handle it

    canvas.className = 'intro-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    intro.classList.add('is-genesis');
    intro.appendChild(canvas);

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var particles = null;   // built once the font is ready
    var emitted = false;
    var stopped = false;
    var raf = 0;
    var resolveAt = 0;      // clock time the resolve wave starts at the left edge
    var doneAt = 0;         // clock time the wordmark is fully resolved

    function resize() {
      canvas.width = Math.round(intro.clientWidth * dpr);
      canvas.height = Math.round(intro.clientHeight * dpr);
    }

    // Show the real word without the build (font failed, resize, late start…).
    function resolveNow() {
      stop();
      intro.classList.add('is-resolved');
    }

    function stop() {
      stopped = true;
      clearWordStyles();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resolveNow);
    }

    function clearWordStyles() {
      word.style.opacity = '';
      word.style.webkitMaskImage = '';
      word.style.maskImage = '';
    }

    // Reveal the real text behind the grid with a soft left → right gradient mask
    // that tracks the same wave the pixels use (see draw()).
    function maskWord(t) {
      var tau = t - resolveAt, fx0 = particles.fx0, fx1 = particles.fx1;
      var stops = [];
      for (var i = 4; i >= 0; i--) {
        var sv = i / 8;                                         // wave phase 0 … 0.5
        var f = (tau - sv * GENESIS.resolve) / GENESIS.sweep;   // word fraction at that phase
        var pct = (fx0 + f * (fx1 - fx0)) * 100;
        stops.push('rgba(0,0,0,' + smoothstep(0, 1, sv * 2).toFixed(3) + ') ' + pct.toFixed(2) + '%');
      }
      var m = 'linear-gradient(90deg,' + stops.join(',') + ')';
      word.style.opacity = '1';
      word.style.webkitMaskImage = m;
      word.style.maskImage = m;
    }

    resize();
    window.addEventListener('resize', resolveNow);

    document.fonts.load('700 32px Inter').then(function () {
      if (stopped) return;
      particles = buildParticles(intro, word);
      if (!particles.length) resolveNow();
    }, resolveNow);

    function frame() {
      if (stopped) return;
      var t = clock();

      if (t >= INTRO.emit && !emitted) {
        if (!particles) {
          // Font still loading: give it a short grace period, then fall back.
          if (t > INTRO.emit + 250) { resolveNow(); return; }
          raf = requestAnimationFrame(frame);
          return;
        }
        emitted = true;
        launch(particles, source, intro, t);
        // Start the wave as early as possible while guaranteeing each pixel is seen
        // landed for `hold` ms (the right edge, which lands last, is the constraint).
        resolveAt = t + particles.lastLanding + GENESIS.hold - GENESIS.sweep;
        doneAt = resolveAt + GENESIS.sweep + GENESIS.resolve;
      }

      if (emitted) {
        if (t >= doneAt) {
          // Fully resolved: hand the word back to CSS (same end values, no visible change).
          intro.classList.add('is-resolved');
          stop();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          return;
        }
        draw(ctx, particles, t, dpr, canvas, resolveAt);
        if (t >= resolveAt) maskWord(t);
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return { stop: stop };
  }

  // Rasterise the DOM word into grid cells → particle targets (coords relative to the overlay).
  function buildParticles(intro, word) {
    var box = intro.getBoundingClientRect();
    var wr = word.getBoundingClientRect();
    var fontSize = parseFloat(getComputedStyle(word).fontSize) || 32;
    var cell = Math.max(3, Math.round(fontSize / 10));  // ≈ 10 cells per em
    var pad = cell * 2;
    var w = Math.ceil(wr.width + pad * 2);
    var h = Math.ceil(wr.height + pad * 2);

    var off = document.createElement('canvas');
    off.width = w; off.height = h;
    var o = off.getContext('2d');
    o.textBaseline = 'alphabetic';

    // Each styled run (text node) is drawn into its own colour channel so we can tell
    // "Apix" from "Denice" per cell. Up to three runs are supported (R, G, B).
    var tones = [];
    var channels = ['#f00', '#0f0', '#00f'];
    var walker = document.createTreeWalker(word, NodeFilter.SHOW_TEXT, null);
    var range = document.createRange();
    var node;
    o.globalCompositeOperation = 'lighter';
    while ((node = walker.nextNode()) && tones.length < 3) {
      var st = getComputedStyle(node.parentNode);
      o.font = st.fontWeight + ' ' + st.fontSize + ' ' + st.fontFamily;
      o.fillStyle = channels[tones.length];
      var m = o.measureText('Hg');
      var ascent = m.fontBoundingBoxAscent != null ? m.fontBoundingBoxAscent : parseFloat(st.fontSize) * 0.97;
      for (var i = 0; i < node.length; i++) {
        if (!node.data.charAt(i).trim()) continue;
        range.setStart(node, i); range.setEnd(node, i + 1);
        var r = range.getBoundingClientRect();
        o.fillText(node.data.charAt(i), r.left - wr.left + pad, r.top - wr.top + pad + ascent);
      }
      tones.push(parseColor(st.color));
    }
    if (!tones.length) return [];

    var data = o.getImageData(0, 0, w, h).data;
    var out = [];
    var minX = Infinity, maxX = -Infinity;
    var area = cell * cell;
    for (var cy = 0; cy + cell <= h; cy += cell) {
      for (var cx = 0; cx + cell <= w; cx += cell) {
        var sum = [0, 0, 0];
        for (var y = cy; y < cy + cell; y++) {
          for (var x = cx; x < cx + cell; x++) {
            var idx = (y * w + x) * 4;
            sum[0] += data[idx]; sum[1] += data[idx + 1]; sum[2] += data[idx + 2];
          }
        }
        var ch = sum[0] >= sum[1] ? (sum[0] >= sum[2] ? 0 : 2) : (sum[1] >= sum[2] ? 1 : 2);
        if (sum[ch] / area < 255 * 0.3 || !tones[ch]) continue;   // coverage threshold
        var tx = wr.left - box.left - pad + cx + cell / 2;
        var ty = wr.top - box.top - pad + cy + cell / 2;
        minX = Math.min(minX, tx); maxX = Math.max(maxX, tx);
        out.push({ tx: tx, ty: ty, size: cell - 1, tone: tones[ch] });   // 1px gutter → LED grid
      }
    }

    var span = Math.max(1, maxX - minX);
    var maxDelay = 0;
    out.forEach(function (p) {
      p.f = (p.tx - minX) / span;                        // 0 = left edge, 1 = right edge
      p.hot = gradientAt(p.f);                           // in-flight colour
      p.delay = p.f * GENESIS.window + Math.random() * GENESIS.jitter;
      p.spin = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random()) * Math.PI;
      maxDelay = Math.max(maxDelay, p.delay);
    });
    // Pixel extent as fractions of the word box (maps the wave onto the text mask).
    var wordLeft = wr.left - box.left;
    out.fx0 = (minX - wordLeft) / wr.width;
    out.fx1 = (maxX - wordLeft) / wr.width;
    out.lastLanding = maxDelay + GENESIS.flight;         // ms after emission
    return out;
  }

  // Emission: every particle gets a start point inside the logo pixel and an arc apex.
  function launch(particles, source, intro, t) {
    var box = intro.getBoundingClientRect();
    var s = source.getBoundingClientRect();
    var sx = s.left - box.left, sy = s.top - box.top;
    particles.forEach(function (p) {
      p.t0 = t + p.delay;
      p.sx = sx + s.width * (0.2 + Math.random() * 0.6);
      p.sy = sy + s.height * (0.2 + Math.random() * 0.6);
      // Control point: leans toward the target and lifts above the source → fountain arc.
      p.cx = p.sx + (p.tx - p.sx) * (0.45 + Math.random() * 0.2);
      p.cy = Math.min(p.sy, p.ty) - (30 + Math.random() * 50);
    });
    // The source pixel "fires": a quick pulse as the stream leaves it.
    if (source.animate) {
      source.animate(
        [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(0) scale(1.18)' }, { transform: 'translateY(0) scale(1)' }],
        { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' }
      );
    }
  }

  function draw(ctx, particles, t, dpr, canvas, resolveAt) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var k = (t - p.t0) / GENESIS.flight;
      if (k <= 0) continue;                  // still inside the source pixel
      if (k > 1) k = 1;
      var e = 1 - Math.pow(1 - k, 3);        // easeOutCubic: fast out of the pixel, soft landing
      var u = 1 - e;
      var x = u * u * p.sx + 2 * u * e * p.cx + e * e * p.tx;   // quadratic Bézier
      var y = u * u * p.sy + 2 * u * e * p.cy + e * e * p.ty;
      var size = p.size * (1 + 0.7 * u);     // slightly larger in flight
      var rot = p.spin * u;                  // tumbles, squares up on landing
      var c = smoothstep(0.55, 1, k);        // gradient → final text colour
      var r = Math.round(p.hot[0] + (p.tone[0] - p.hot[0]) * c);
      var g = Math.round(p.hot[1] + (p.tone[1] - p.hot[1]) * c);
      var b = Math.round(p.hot[2] + (p.tone[2] - p.hot[2]) * c);
      var a = 1 + (p.tone[3] - 1) * c;
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
      if (k === 1) {
        // Resolve wave: phase 0 → 1 as it passes this pixel. The text has already faded
        // in underneath by phase 0.5; the pixel then grows into its gutter and melts away.
        var phase = (t - resolveAt - p.f * GENESIS.sweep) / GENESIS.resolve;
        var melt = smoothstep(0.35, 1, phase);
        if (melt >= 1) continue;
        if (melt > 0) {
          a *= 1 - melt;
          size *= 1 + 0.25 * melt;
          ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
          var hs = size / 2;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillRect(x - hs, y - hs, size, size);
          continue;
        }
        // Landed: snap to device pixels so the grid reads crisp.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        var d = Math.round(size * dpr);
        ctx.fillRect(Math.round((x - size / 2) * dpr), Math.round((y - size / 2) * dpr), d, d);
        continue;
      }
      var cos = Math.cos(rot) * dpr, sin = Math.sin(rot) * dpr;
      ctx.setTransform(cos, sin, -sin, cos, x * dpr, y * dpr);
      ctx.fillRect(-size / 2, -size / 2, size, size);
    }
  }

  function gradientAt(f) {
    var seg = f < 0.5 ? 0 : 1;
    var k = f < 0.5 ? f * 2 : (f - 0.5) * 2;
    var a = BRAND_GRADIENT[seg], b = BRAND_GRADIENT[seg + 1];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  // "rgb(r, g, b)" / "rgba(r, g, b, a)" → [r, g, b, a]
  function parseColor(str) {
    var n = (str.match(/[\d.]+/g) || []).map(Number);
    return [n[0] || 255, n[1] || 255, n[2] || 255, n.length > 3 ? n[3] : 1];
  }
})();
