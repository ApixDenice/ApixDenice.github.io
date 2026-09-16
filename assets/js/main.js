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
     Here we add: skip on click/key, fly the logo into its hero position, cleanup. */
  function initIntro() {
    var intro = document.getElementById('intro');
    if (!intro) return;
    if (!root.classList.contains('intro')) { intro.remove(); return; }

    var fly = document.getElementById('intro-fly');
    var heroTarget = document.getElementById('hero-logo-target');
    var skipBtn = document.getElementById('intro-skip');
    var finished = false;
    var timers = [];

    function cleanup() {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      root.classList.add('intro-done');
      intro.remove();
      document.removeEventListener('keydown', onKey);
    }

    function skip() {
      if (finished) return;
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

    timers.push(setTimeout(flyToHero, 1900));
    timers.push(setTimeout(cleanup, 2750));
  }
})();
