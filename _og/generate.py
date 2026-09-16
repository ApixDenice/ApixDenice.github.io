"""
Generates the 1200x630 social preview images in /assets/images/og/.
Run from the repo root:  python3 _og/generate.py   (needs: pip install playwright && playwright install chromium)
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/images/og"
FONT = (ROOT / "assets/fonts/InterVariable-latin.woff2").as_uri()
MARK = (ROOT / "assets/brand/logo-mark.svg").read_text()

CSS = f"""
@font-face {{ font-family: Inter; src: url('{FONT}') format('woff2'); font-weight: 100 900; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; width: 1200px; height: 630px; font-family: Inter; color: #fff; background: #0B0C10; overflow: hidden; position: relative; }}
.glow {{ position: absolute; inset: 0; background:
  radial-gradient(520px 420px at 88% 18%, rgba(124,92,255,.45), transparent 70%),
  radial-gradient(460px 380px at 70% 95%, rgba(255,79,109,.32), transparent 70%),
  radial-gradient(360px 300px at 100% 70%, rgba(255,178,36,.22), transparent 70%); }}
.grid {{ position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
  background-size: 48px 48px; -webkit-mask-image: radial-gradient(ellipse 60% 80% at 80% 50%, #000 10%, transparent 70%); }}
.wrap {{ position: absolute; inset: 0; padding: 72px 80px; display: flex; flex-direction: column; justify-content: space-between; }}
.lockup {{ display: flex; align-items: center; gap: 16px; font-size: 34px; font-weight: 700; letter-spacing: -.035em; }}
.lockup svg {{ width: 56px; height: 56px; }}
  .lockup b {{ font-weight: 700; }}
.lockup span {{ font-weight: 450; color: rgba(255,255,255,.6); }}
h1 {{ font-size: 76px; line-height: 1.02; letter-spacing: -.045em; margin: 0 0 22px; max-width: 700px; font-weight: 750; }}
p {{ font-size: 30px; color: rgba(255,255,255,.72); margin: 0; max-width: 700px; line-height: 1.35; }}
.grad {{ background: linear-gradient(120deg,#FFB224,#FF4F6D 50%,#7C5CFF); -webkit-background-clip: text; color: transparent; }}
.big-mark {{ position: absolute; right: 90px; top: 50%; width: 300px; height: 300px; transform: translateY(-50%) rotate(-8deg); filter: drop-shadow(0 40px 60px rgba(0,0,0,.6)); }}
.big-mark svg {{ width: 100%; height: 100%; }}
.app-icon {{ position: absolute; right: 100px; top: 50%; width: 280px; height: 280px; border-radius: 62px; transform: translateY(-50%) rotate(-6deg); box-shadow: 0 40px 80px rgba(0,0,0,.55); }}
.pill {{ display: inline-block; font-size: 22px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; padding: 8px 18px; border-radius: 999px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.16); margin-bottom: 26px; }}
"""

def page(body, glow=""):
    return f"<html><head><style>{CSS}{glow}</style></head><body><div class='glow'></div><div class='grid'></div>{body}</body></html>"

LOCKUP = f"<div class='lockup'>{MARK}<b>Apix<span>Denice</span></b></div>"

def app_card(name, pill, tagline, icon, accent):
    glow = f".glow {{ background: radial-gradient(560px 460px at 85% 45%, {accent}, transparent 70%), radial-gradient(420px 320px at 10% 110%, rgba(124,92,255,.25), transparent 70%); }}"
    icon_uri = (ROOT / icon).as_uri()
    body = f"""<div class='wrap'>{LOCKUP}<div><div class='pill'>{pill}</div><h1>{name}</h1><p>{tagline}</p></div></div>
    <img class='app-icon' src='{icon_uri}'>"""
    return page(body, glow)

IMAGES = {
    "home": page(f"""<div class='wrap'>{LOCKUP}<div><h1>Native apps, crafted from <span class='grad'>idea to App Store.</span></h1>
      <p>Indie app studio for iPhone &amp; Mac by Dennis Hasselbusch</p></div></div><div class='big-mark'>{MARK}</div>"""),
    "default": page(f"""<div class='wrap'>{LOCKUP}<div><h1>ApixDenice</h1>
      <p>Native apps for iPhone &amp; Mac — Too Much Food, Office Mom and DIPS</p></div></div><div class='big-mark'>{MARK}</div>"""),
    "toomuchfood": app_card("Too Much Food", "Free on iPhone", "Grab the food. Dodge the poo. Endless one-thumb arcade fun.", "assets/images/apps/toomuchfood-384.webp", "rgba(232,137,12,.55)"),
    "office-mom": app_card("Office Mom", "iPhone &amp; Mac", "Drink water. Stand up. Keep moving. Zero data collected.", "assets/images/apps/office-mom-384.webp", "rgba(47,111,219,.55)"),
    "dips": app_card("DIPS", "Coming soon · iPhone", "Find your people. Start the workout. Sport events near you.", "assets/images/apps/dips-384.webp", "rgba(11,160,0,.45)"),
}

with sync_playwright() as p:
    browser = p.chromium.launch()
    pg = browser.new_page(viewport={"width": 1200, "height": 630})
    for name, html in IMAGES.items():
        tmp = OUT / f".{name}.html"
        tmp.write_text(html)
        pg.goto(tmp.as_uri())
        pg.wait_for_timeout(250)
        pg.screenshot(path=str(OUT / f"{name}.jpg"), type="jpeg", quality=88)
        tmp.unlink()
        print("wrote", name)
    browser.close()
