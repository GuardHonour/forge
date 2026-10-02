import base64, os

DST = r"C:/Users/Admin/deepseek-harness/apps/web/dist/forge/design"

def b64(name):
    return base64.b64encode(open(os.path.join(DST, name), "rb").read()).decode("ascii")

CARDS = [
    ("A · Voltline", "dir_a.png", "Continuity — keeps the installed volt identity, upgrades craft: layered surfaces, hairline edges, tabular set data, volt rationed to live moments (Today pill, completed sets, rest ring, ring on today)."),
    ("B · Crucible", "dir_b.png", "Limit Break, tamed — obsidian surfaces, forge crimson as the accent, premium gold PRs, violet benched except the rest-timer ring. Anton poster caps + Barlow tabular body. The boldest restyle."),
    ("C · Caliper", "dir_c.png", "Precision instrument — graphite surfaces, ice-signal accent that stays quiet so the numbers lead, champagne PR chips, Space Grotesk + Manrope, sentence case. The calmest read between sets."),
]

cards = ""
for name, png, blurb in CARDS:
    cards += f'''
  <section style="margin:0 0 34px">
    <h2 style="font:700 22px Oswald,'Arial Black',sans-serif;letter-spacing:.5px;margin:0 0 6px">{name}</h2>
    <p style="color:#98a1ac;font-size:14px;max-width:78ch;margin:0 0 12px">{blurb}</p>
    <img src="data:image/png;base64,{b64(png)}" alt="{name} design direction"
         style="width:100%;max-width:980px;border:1px solid #1b1f24;border-radius:14px;display:block">
  </section>'''

page = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FORGE · UI upgrade directions</title>
<meta name="theme-color" content="#0a0b0d">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600&family=Oswald:wght@600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;background:#08090b;color:#f2f4f7;font-family:Archivo,system-ui,sans-serif;line-height:1.5">
<div style="max-width:1020px;margin:0 auto;padding:28px 20px 80px">
  <div style="font:700 26px Oswald,sans-serif;letter-spacing:1px;margin-bottom:2px">FORGE<span style="color:#cbf33a">.</span></div>
  <div style="font-size:12px;color:#98a1ac;letter-spacing:2px;text-transform:uppercase;margin-bottom:18px">UI upgrade directions · pick one to implement</div>
  <p style="color:#98a1ac;font-size:15px;max-width:80ch;margin:0 0 26px">
    Three design directions generated in OpenDesign, each with verified WCAG AA contrast ratios and the app's real
    anatomy (prescription bar, LAST record, set steppers, RIR strip, rest timer, six-tab bar, consistency calendar,
    volume chart). The full board — token tables, rationale and recommendation — is in
    <a href="forge-ui-upgrade.html" style="color:#cbf33a">forge-ui-upgrade.html</a>.</p>
  {cards}
  <p style="color:#5f6873;font-size:13px;border-top:1px solid #1b1f24;padding-top:14px">
    Reply with A, B or C — or "A now + B/C as themes" to ship all three. Whichever you pick gets implemented by hand
    in the app and gated through the full regression suite before it reaches anyone's phone.</p>
</div>
</body>
</html>'''

open(os.path.join(DST, "gallery.html"), "w", encoding="utf-8").write(page)
print("wrote gallery.html", os.path.getsize(os.path.join(DST, "gallery.html")), "bytes")
