# Official App Store badges

The site renders Apple's official badges from this folder. Download them unmodified from
Apple Marketing Tools and save them here with exactly these names:

| File | Source |
|------|--------|
| `download-on-the-app-store.svg` | https://tools.applemarketingtools.com/ → App Store badge, Black, English (US), SVG |
| `download-on-the-mac-app-store.svg` | https://tools.applemarketingtools.com/ → Mac App Store badge, Black, English (US), SVG |

Until a file exists, `_includes/app-store-badge.html` falls back to a plain text button, so nothing breaks.

Apple's rules: don't modify, recolor or animate the badge; keep clear space around it (at least one-tenth
of the badge height); minimum on-screen height 40 px.
