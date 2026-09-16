# ApixDenice.github.io

Studio website for **ApixDenice**, the indie app studio of Dennis Hasselbusch: <https://apixdenice.github.io>.
It's a Jekyll site with its own layout and stylesheet (no theme), deployed with GitHub Pages.

## Pages

| URL | Source | Notes |
|-----|--------|-------|
| `/` | `index.html` | Studio landing page with the 3D logo intro |
| `/toomuchfood/` | `toomuchfood.md` | Amber accent (`.tmf`), Smart App Banner |
| `/toomuchfood/privacy/`, `/toomuchfood/datenschutz/` | `toomuchfood-*.md` | App privacy policy (EN/DE) |
| `/toomuchfood/duel/` | `toomuchfood/duel/index.html` | Standalone challenge-link landing page (universal links) |
| `/office-mom/` | `office-mom.md` | Blue accent (`.om`), Smart App Banner |
| `/office-mom/privacy/` | `office-mom-privacy.md` | Redirects from the old `/office-mom-privacy` URL |
| `/dips/`, `/dips/events/` | `dips.md`, `dips-events.html` | Green accent (`.dips`); events page is `noindex` |
| `/contact/` | `contact.html` | |
| `/impressum/` | `impressum.md` | One Impressum for the site and all apps |
| `/datenschutz/` | `datenschutz.html` | Website privacy policy (DE + EN), `/privacy/` redirects here |

The `.well-known/apple-app-site-association` file and `app-ads.txt` must stay at the root of this domain.
If the domain ever changes, the Too Much Food duel links and AdMob verification change with it.

## Brand

- **Logo "Apex + Pixel":** an apex-shaped A whose crossbar is a single glowing pixel. Source files are in `assets/brand/`:
  `logo-mark.svg` (master), `favicon.svg`, `apple-touch-icon.png`, `icon-512.png`, plus `/favicon.ico`.
- Inline versions: `_includes/logo-mark.html` (flat) and `_includes/logo-3d.html` (extruded CSS 3D).
- **Colours:** ink `#0B0C10`, pixel gradient `#FFB224 → #FF4F6D → #7C5CFF`, link/focus violet `#6246EA`.
  Each app keeps its own accent through a scoped class that overrides the `--brand-*` tokens in `assets/css/custom.css`.
- **Font:** Inter (variable, Latin subset), self-hosted in `assets/fonts/` under the SIL Open Font License.

## Home intro animation

- The timeline is pure CSS (`.intro-overlay` in `custom.css`). `assets/js/main.js` adds skip (click, Esc, Enter, Space), the fly-into-hero hand-off and cleanup.
- An inline script in `_layouts/default.html` decides whether it plays. It runs only for a fresh entry into the site: not on reload, back/forward, internal navigation or with *reduced motion* enabled.
- No cookies or storage are used, so no consent banner is needed.

## Social preview images and App Store badges

- The 1200×630 Open Graph images are in `assets/images/og/`. Regenerate them with `python3 _og/generate.py` (needs Playwright).
  Pages choose theirs with `image:` in the front matter; everything else falls back to `default.jpg`.
- Official Apple badges: see `assets/badges/README.md`. Use `{% include app-store-badge.html url=... platform="ios|mac" size="sm|md|lg" %}`.
- Smart App Banner: set `app_store_id: "<numeric id>"` in a page's front matter.

## Privacy by design

- No third-party requests on page load: fonts and scripts are self-hosted.
- The Firebase SDK on `/dips/events/` loads only once someone uses the sign-in form or already has a session.
- If you add anything that loads from another domain (embeds, analytics, CDNs), update `datenschutz.html` first.

## Local development

```bash
bundle install            # installs the github-pages gem (same versions as production)
bundle exec jekyll serve  # http://localhost:4000
```

Images: app icons and screenshots are WebP (`assets/images/apps/`, `assets/images/officemom/`, `assets/images/toomuchfood/`).
Always set `width`/`height` on `<img>` to avoid layout shift.
