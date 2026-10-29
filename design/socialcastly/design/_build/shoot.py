import json,os
from playwright.sync_api import sync_playwright
D="/workspace/socialcastly/design"; S=json.load(open(D+"/_build/screens.json"))
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome")
    for th in ["light","dark"]:
        for s,t,m,g in S:
            pg=b.new_page(viewport={"width":390 if m else 1440,"height":844 if m else 900},device_scale_factor=2 if m else 1)
            pg.goto(f"file://{D}/screens/{s}.html?theme={th}&shot=1"); pg.wait_for_timeout(250)
            pg.screenshot(path=f"{D}/screenshots/{th}/{s}.png",full_page=True,animations="disabled"); pg.close()
    pg=b.new_page(viewport={"width":1440,"height":900})
    for th in ["light","dark"]:
        pg.goto(f"file://{D}/index.html?theme={th}"); pg.wait_for_timeout(400); pg.screenshot(path=f"{D}/screenshots/{th}/_index.png",full_page=True)
    b.close()
