from b4 import *
def mtab(a):
    out='<nav class="m-tab">'
    for s,h,i,l in [("home","m-dashboard","home","Home"),("cal","m-calendar","cal","Calendar"),("new","m-composer","",""),("queue","m-queue","list","Queue"),("more","settings","menu","More")]:
        if s=="new": out+=f'<a href="{h}.html" aria-label="New post"><span class="fab">{I("plus")}</span></a>'
        else: out+=f'<a class="{"active" if s==a else ""}" href="{h}.html">{I(i)}{l}</a>'
    return out+'</nav>'
def mtop(): return f'<div class="m-top"><span>{logo("sidebar",26)}</span><div class="row" style="gap:6px"><button class="btn btn-ghost btn-icon btn-sm" aria-label="Notifications">{I("bell")}</button>{av("WK",0,30)}</div></div>'
page("m-dashboard","Mobile · Dashboard",f'''<div class="m">{mtop()}<div class="m-body"><div><h1 style="font-size:22px">Good afternoon, Win</h1><p class="sm muted">5 posts going out today</p></div>
<div class="alert error" style="padding:12px">{I("alert","ico","color:var(--error)")}<div class="sm grow"><b>1 post failed on X</b><div class="xs muted">Retrying in 12 min</div></div><a class="btn btn-sm btn-secondary">Review</a></div>
<div class="grid g2" style="gap:10px">{stat_cards(stats,"padding:14px").replace('class="v"','class="v" style="font-size:22px"')}</div>
<div class="card"><div class="card-head" style="padding:14px 16px"><h3>Up next</h3><a class="xs" style="color:var(--primary);font-weight:600" href="m-queue.html">See all</a></div>{"".join(post_row(p,False,True) for p in POSTS[:3])}</div></div>{mtab("home")}</div>''',mobile=True,group="Mobile")
mp="".join(f'<span class="row" style="gap:6px;padding:3px 10px 3px 3px;border-radius:99px;border:1.5px solid var(--primary);background:var(--primary-soft)">{ch(k,"sm")}<span class="xs" style="font-weight:600">{n}</span></span>' for k,n in [("x","X"),("in","LinkedIn"),("ig","Instagram")])
mt="".join(f'<button class="btn btn-ghost btn-icon btn-sm" aria-label="{i}">{I(i)}</button>' for i in ["img","emoji","hash","sparkle"])
page("m-composer","Mobile · Composer",f'''<div class="m"><div class="m-top"><a class="sm muted">Cancel</a><b>New post</b><a class="btn btn-primary btn-sm">Schedule</a></div><div class="m-body">
<div class="row wrap" style="gap:8px">{mp}</div><textarea class="input" rows="6" style="font-size:15px">Launch day 🚀 socialcastly 2.0 is here. Plan a week of posts in ten minutes. Try it free → socialcastly.app</textarea>
<div class="row" style="gap:8px"><div class="thumb th2" style="width:72px;height:72px"></div><div class="dropzone" style="width:72px;height:72px;padding:0;justify-content:center;color:var(--primary)">{I("plus")}</div></div>
<div class="row between xs muted"><div class="row" style="gap:2px">{mt}</div><span>112 / 280</span></div>
<div class="card" style="padding:14px"><div class="row between"><div class="row">{I("cal","ico","color:var(--primary)")}<div><b class="sm">Thu, Oct 29 · 9:00 AM</b><div class="xs subtle">Asia/Bangkok · ✦ Best time</div></div></div>{I("chev","ico","color:var(--text-3)")}</div></div>
<h3>Preview</h3><div class="seg" style="align-self:flex-start"><a>X</a><a class="active">LinkedIn</a><a>Instagram</a></div><div class="pv"><div class="row">{av("AC",0,36)}<div><b class="sm">Acme Studio</b><div class="xs subtle">Now · 🌐</div></div></div><p class="sm" style="margin-top:8px">Launch day 🚀 socialcastly 2.0 is here. Plan a week of posts in ten minutes…</p><div class="img th2" style="height:150px"></div></div></div></div>''',mobile=True,group="Mobile")
md=""
for d,n in zip("MTWTFSS",[26,27,28,29,30,31,1]):
    sel="background:var(--primary);color:var(--on-primary)" if n==29 else ""
    dots="".join(f'<i style="width:5px;height:5px;border-radius:50%;background:{"currentColor" if n==29 else "var(--ch-"+c+")"}"></i>' for c in ["x","linkedin","instagram"][:(n%3)+1])
    md+=f'<div style="text-align:center;padding:6px 0;border-radius:12px;{sel}"><div class="xs">{d}</div><b>{n}</b><div style="display:flex;gap:2px;justify-content:center;margin-top:3px;height:5px">{dots}</div></div>'
evs="".join(f'<div class="row" style="align-items:stretch;gap:10px"><div class="xs subtle" style="width:48px;padding-top:10px;text-align:right">{t}</div><div class="ev {k}" style="flex:1;height:auto;padding:10px 12px"><div class="row" style="gap:6px">{ch(k,"sm")}<b class="sm grow">{tl}</b>{badge(s) if s=="failed" else ""}</div><div class="xs muted" style="margin-top:4px">{d}</div></div></div>' for t,k,tl,d,s in [("9:00","x","Launch day 🚀","Thread · 4 posts","scheduled"),("11:30","in","We rebuilt our scheduler","Text post","scheduled"),("1:15 PM","ig","Studio BTS ✨","1 image","queued"),("4:00 PM","x","Quick tip","Rate limited · retry 12 min","failed"),("6:45 PM","ig","Weekend reading list","1 image","scheduled")])
page("m-calendar","Mobile · Calendar",f'''<div class="m">{mtop()}<div class="m-body"><div class="row between"><h1 style="font-size:22px">October 2026</h1><div class="seg"><a class="active">Week</a><a>Month</a></div></div>
<div class="card" style="padding:8px;display:grid;grid-template-columns:repeat(7,1fr);gap:2px">{md}</div><h3>Thursday, Oct 29</h3>{evs}</div>{mtab("cal")}</div>''',mobile=True,group="Mobile")
page("m-queue","Mobile · Queue",f'''<div class="m">{mtop()}<div class="m-body"><h1 style="font-size:22px">Queue</h1><div class="seg" style="display:flex"><a class="active" style="flex:1;text-align:center">Scheduled 24</a><a style="flex:1;text-align:center">Published</a><a style="flex:1;text-align:center">Failed 1</a></div>
<div class="card">{"".join(post_row(p,False,True) for p in POSTS)}</div></div>{mtab("queue")}</div>''',mobile=True,group="Mobile")
page("m-signin","Mobile · Sign in",f'''<div class="m"><div class="m-body" style="padding:48px 24px;gap:16px"><div style="text-align:center">{MARK.format(w=64)}</div><h1 style="text-align:center;font-size:24px">Welcome back</h1><p class="muted sm" style="text-align:center;margin-top:-8px">Sign in to socialcastly</p>
<a class="oauth"><span style="font-weight:800;color:#4285F4">G</span>Continue with Google</a><div class="divider">or</div><div class="field"><label class="label">Email</label><input class="input" value="win@acmestudio.co"></div><div class="field"><label class="label">Password</label><input class="input" type="password" value="password"></div><a class="btn btn-primary btn-lg">Sign in</a><p class="sm muted" style="text-align:center">New here? <a style="color:var(--primary);font-weight:600">Create an account</a></p></div></div>''',mobile=True,group="Mobile")

groups={}
for s,t,m,g in SCREENS: groups.setdefault(g,[]).append((s,t,m))
cards=""
for g in ["Marketing & auth","App","System","Mobile"]:
    cols=5 if g=="Mobile" else 4
    cards+=f'<h2 style="margin:32px 0 14px">{g}</h2><div class="grid" style="grid-template-columns:repeat({cols},1fr);gap:18px">'
    for s,t,m in groups[g]:
        ar="390/720" if m else "1440/900"
        cards+=f'<a class="card" href="screens/{s}.html" style="overflow:hidden;display:block"><div style="aspect-ratio:{ar};overflow:hidden;background:var(--surface-2);border-bottom:1px solid var(--border)"><img class="logo-light" src="screenshots/light/{s}.png" style="width:100%" alt="{t} light"><img class="logo-dark" src="screenshots/dark/{s}.png" style="width:100%" alt="{t} dark"></div><div style="padding:12px 14px"><b class="sm">{t}</b><div class="xs subtle">{s}.html{" · 390px" if m else " · 1440px"}</div></div></a>'
    cards+="</div>"
open(f"{D}/index.html","w").write(f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>socialcastly · UI/UX redesign</title><link rel="icon" href="assets/logo/favicon.ico"><link rel="stylesheet" href="assets/app.css">
<script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||localStorage.getItem('sc-theme')||'light';function tt(){{var t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;localStorage.setItem('sc-theme',t)}}</script></head><body>
<header class="mk-nav"><div class="row" style="gap:16px"><img class="logo-light" src="assets/logo/socialcastly-lockup-light.png" style="height:34px" alt="socialcastly"><img class="logo-dark" src="assets/logo/socialcastly-lockup-dark.png" style="height:34px" alt="socialcastly"><span class="badge b-primary nodot">UI/UX redesign · v1.0</span></div><div class="row"><a class="btn btn-ghost" href="README.md">README</a><a class="btn btn-ghost" href="tokens.css">tokens.css</a><a class="btn btn-ghost" href="tokens.json">tokens.json</a><button class="btn btn-primary" onclick="tt()">◐ Toggle light / dark</button></div></header>
<main style="padding:24px 80px 80px"><h1 style="font-size:36px">High-fidelity mockups</h1><p class="muted" style="font-size:16px;max-width:780px">{len(SCREENS)} screens for socialcastly (formerly SocialStudio), each in light and dark. Click a screen to open it; the theme toggle persists across pages. Every screen uses the real logo assets and the shared design tokens.</p>{cards}</main></body></html>''')
json.dump(SCREENS,open(f"{D}/_build/screens.json","w"))
print(len(SCREENS))
