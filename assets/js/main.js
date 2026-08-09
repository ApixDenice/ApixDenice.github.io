// ApixDenice — site interactions
document.addEventListener('DOMContentLoaded', function () {
  // --- Mobile menu toggle ---
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.getElementById('nav-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      const open = menu.classList.toggle('open');
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // --- DIPS dropdown ---
  document.querySelectorAll('.nav-dropdown').forEach(function (dd) {
    const btn = dd.querySelector('.nav-dropdown-toggle');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      const open = dd.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  // Close dropdown / mobile menu when clicking outside
  document.addEventListener('click', function (e) {
    document.querySelectorAll('.nav-dropdown.open').forEach(function (dd) {
      if (!dd.contains(e.target)) {
        dd.classList.remove('open');
        const b = dd.querySelector('.nav-dropdown-toggle');
        if (b) b.setAttribute('aria-expanded', 'false');
      }
    });
  });

  // Close dropdown on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.nav-dropdown.open').forEach(function (dd) {
        dd.classList.remove('open');
      });
    }
  });

  // --- Screenshot carousel ---
  document.querySelectorAll('[data-carousel]').forEach(function (root) {
    const slides = Array.prototype.slice.call(root.querySelectorAll('.carousel-slide'));
    if (!slides.length) return;

    const captionEl = root.querySelector('[data-carousel-caption]');
    const countEl = root.querySelector('[data-carousel-count]');
    const thumbsEl = root.querySelector('[data-carousel-thumbs]');
    let index = 0;

    // Build thumbnails from the slide images
    const thumbs = [];
    if (thumbsEl) {
      slides.forEach(function (slide, i) {
        const src = slide.querySelector('img').getAttribute('src');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'carousel-thumb' + (i === 0 ? ' is-active' : '');
        btn.setAttribute('aria-label', 'Show screenshot ' + (i + 1));
        const im = document.createElement('img');
        im.src = src;
        im.alt = '';
        im.loading = 'lazy';
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

    const prev = root.querySelector('.carousel-prev');
    const next = root.querySelector('.carousel-next');
    if (prev) prev.addEventListener('click', function () { go(index - 1); });
    if (next) next.addEventListener('click', function () { go(index + 1); });

    // Keyboard support when the carousel has focus within
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
    });

    // Touch swipe
    let startX = null;
    const stage = root.querySelector('.carousel-stage');
    if (stage) {
      stage.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
      stage.addEventListener('touchend', function (e) {
        if (startX === null) return;
        const dx = e.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > 45) go(dx < 0 ? index + 1 : index - 1);
        startX = null;
      }, { passive: true });
    }

    // Lightbox on click of the active image
    root.addEventListener('click', function (e) {
      const img = e.target.closest('.carousel-slide img');
      if (!img) return;
      openLightbox(img.getAttribute('src'), img.getAttribute('alt'));
    });
  });

  function openLightbox(src, alt) {
    const box = document.createElement('div');
    box.className = 'lightbox is-open';
    box.innerHTML = '<button class="lightbox-close" type="button" aria-label="Close">&times;</button>';
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt || '';
    box.appendChild(img);
    document.body.appendChild(box);
    document.body.style.overflow = 'hidden';

    function close() {
      box.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    box.addEventListener('click', function (e) {
      if (e.target === box || e.target.classList.contains('lightbox-close')) close();
    });
    document.addEventListener('keydown', onKey);
  }

  // --- Reveal on scroll ---
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    revealEls.forEach(function (el) { obs.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('visible'); });
  }
});
