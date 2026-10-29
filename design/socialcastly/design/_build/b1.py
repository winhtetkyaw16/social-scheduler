import os,sys,json,random
sys.path.insert(0,os.path.dirname(__file__))
from tokens import css,js
D=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
open(f"{D}/tokens.css","w").write(css()); open(f"{D}/tokens.json","w").write(js())
open(f"{D}/assets/app.css","w").write(css()+open(os.path.dirname(__file__)+"/app.css").read())
P={"home":'<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',"edit":'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
"cal":'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',"list":'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
"file":'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',"check":'<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
"chart":'<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/>',"link":'<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
"img":'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',"users":'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
"gear":'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
"bell":'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',"search":'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',"plus":'<path d="M12 5v14M5 12h14"/>',
"clock":'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',"upload":'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',"chev":'<path d="M9 18l6-6-6-6"/>',"chevl":'<path d="M15 18l-6-6 6-6"/>',
"more":'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',"retry":'<path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.5 9A9 9 0 0 0 5.6 5.6L1 10m22 4l-4.6 4.4A9 9 0 0 1 3.5 15"/>',
"alert":'<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',"sparkle":'<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/>',"emoji":'<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
"hash":'<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',"menu":'<path d="M3 6h18M3 12h18M3 18h18"/>',
"shield":'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',"zap":'<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',"grid":'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'}
def I(n,c="ico",s=""): return f'<svg class="{c}" viewBox="0 0 24 24" style="{s}">{P[n]}</svg>'
CH={"x":("x","X"),"in":("linkedin","in"),"ig":("instagram","IG"),"fb":("facebook","f"),"tt":("tiktok","♪"),"yt":("youtube","▶"),"pin":("pinterest","P")}
def ch(k,c=""): n,l=CH[k]; return f'<span class="ch ch-{n} {c}" title="{n}">{l}</span>'
AV=["#4F46E5","#0369A1","#B45309","#047857","#BE185D","#6D28D9"]
def av(t,i=0,s=32): return f'<span class="avatar" style="background:{AV[i%6]};width:{s}px;height:{s}px">{t}</span>'
def logo(kind="sidebar",h=30):
    a,b=("socialcastly-lockup-light.png","socialcastly-lockup-dark.png") if kind=="sidebar" else ("socialcastly-lockup-light.png","socialcastly-lockup-dark.png")
    return f'<img class="logo-light" src="../assets/logo/{a}" alt="socialcastly" style="height:{h}px"><img class="logo-dark" src="../assets/logo/{b}" alt="socialcastly" style="height:{h}px">'
MARK='<img src="../assets/logo/socialcastly-mark-256.png" alt="" style="width:{w}px;height:{w}px">'
SCREENS=[]
def page(slug,title,body,mobile=False,group="App"):
    SCREENS.append((slug,title,mobile,group))
    html=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · socialcastly</title><link rel="icon" href="../assets/logo/favicon.ico"><link rel="stylesheet" href="../assets/app.css">
<script>(function(){{var p=new URLSearchParams(location.search);var t=p.get('theme')||localStorage.getItem('sc-theme')||'light';document.documentElement.dataset.theme=t;if(p.has('shot'))document.documentElement.classList.add('shooting')}})();
function tt(){{var t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;localStorage.setItem('sc-theme',t)}}</script></head>
<body>{body}<div class="theme-fab"><a href="../index.html">← All screens</a><button class="btn btn-sm btn-secondary" onclick="tt()">◐ Theme</button></div></body></html>'''
    open(f"{D}/screens/{slug}.html","w").write(html)
NAV=[("dashboard","home","Dashboard",None),("composer","edit","Create post",None),("calendar","cal","Calendar",None),("queue","list","Queue","24"),("drafts","file","Drafts","7"),("approvals","check","Approvals","3"),("analytics","chart","Analytics",None),
 ("channels","link","Channels",None),("media","img","Media library",None),("team","users","Team",None),("settings","gear","Settings",None)]
def shell(active,content):
    nav=""
    for i,(s,ic,l,c) in enumerate(NAV):
        if i==0: nav+='<div class="nav-label">Workspace</div>'
        if i==6: nav+='<div class="nav-label">Insights</div>'
        if i==7: nav+='<div class="nav-label">Manage</div>'
        a="active" if s==active else ""
        cnt=f"<span class=count>{c}</span>" if c else ""
        nav+=f'<a class="{a}" href="{s}.html">{I(ic)}{l}{cnt}</a>'
    chs="".join(f'<div class="row" style="padding:6px 10px;gap:10px"><span class="with-ch">{av("AC",0,26)}{ch(k,"sm")}</span><span class="sm muted grow">{n}</span></div>' for k,n in [("x","@acmestudio"),("in","Acme Studio"),("ig","acme.studio")])
    return f'''<div class="app"><aside class="sidebar"><div class="brand">{logo()}</div><nav class="nav">{nav}</nav>
<div class="nav-label">Channels</div>{chs}
<div class="foot"><div class="card" style="padding:14px;background:var(--surface-2);box-shadow:none"><div class="row between"><b class="sm">Pro trial</b><span class="xs subtle">9 days left</span></div><div class="progress" style="margin:10px 0"><i style="width:64%"></i></div><a class="sm" style="color:var(--primary);font-weight:600" href="settings-billing.html">Upgrade plan →</a></div></div></aside>
<div class="main"><header class="topbar"><div class="search">{I("search")}<span>Search posts, channels, media…</span><kbd>⌘K</kbd></div><div class="grow"></div>
<button class="btn btn-ghost btn-icon" aria-label="Notifications" style="position:relative">{I("bell")}<span style="position:absolute;top:8px;right:9px;width:8px;height:8px;border-radius:50%;background:var(--error);border:2px solid var(--surface)"></span></button>
<a class="btn btn-primary" href="composer.html">{I("plus")}New post</a><div class="row" style="gap:10px;padding-left:12px;border-left:1px solid var(--border)">{av("WK",0)}<div style="line-height:1.2"><div class="sm" style="font-weight:600">Win Kyaw</div><div class="xs subtle">Acme Studio</div></div></div></header>
<div class="content">{content}</div></div></div>'''
def head(t,sub,actions=""): return f'<div class="page-head"><div><h1>{t}</h1><p>{sub}</p></div><div class="row">{actions}</div></div>'
ST={"scheduled":"b-primary","published":"b-success","failed":"b-error","queued":"b-info","draft":"","pending":"b-warning"}
def badge(s,label=None): return f'<span class="badge {ST.get(s,"")}">{label or s.capitalize()}</span>'
POSTS=[("9:00","AM","x","Launch day 🚀 socialcastly 2.0 is here — plan a week of posts in ten minutes. Thread below 👇","scheduled",""),
("11:30","AM","in","We rebuilt our scheduler from the ground up. Here's what we learned shipping retries, approvals and per-channel previews to 2,000 teams.","scheduled","th2"),
("1:15","PM","ig","Behind the scenes at the studio this week ✨ #designprocess #buildinpublic","queued","th1"),
("4:00","PM","x","Quick tip: batch your captions on Monday, review on Tuesday, and let the queue do the rest.","failed",""),
("6:45","PM","ig","Weekend reading list for creators — swipe for all 6 picks 📚","scheduled","th4")]
def post_row(p,actions=True,compact=False):
    t,ap,k,txt,st,th=p
    err='<div class="xs" style="color:var(--error);margin-top:6px">⚠ X API: rate limit exceeded (429). Retrying automatically in 12 min.</div>' if st=="failed" else ""
    act=f'<button class="btn btn-sm btn-secondary">{I("retry")}Retry</button>' if st=="failed" else f'<button class="btn btn-sm btn-ghost btn-icon" aria-label="More">{I("more")}</button>'
    sty=' style="padding:12px 14px;gap:10px"' if compact else ""
    tsz=' style="width:48px;height:48px"' if compact else ""
    thumb=f'<div class="thumb {th}"{tsz}></div>' if th else ""
    return f'''<div class="post"{sty}><div class="time">{t}<span>{ap}</span></div><span class="with-ch">{av("AC",0,36)}{ch(k,"sm")}</span><div class="body"><div class="row" style="gap:8px;margin-bottom:4px"><b class="sm">Acme Studio</b>{badge(st)}</div><div class="txt">{txt}</div>{err}</div>{thumb}{act if actions else ""}</div>'''
def chcard(k,name,desc,state):
    btn={"connected":'<span class="badge b-success">Connected</span>',"connect":'<button class="btn btn-primary btn-sm">Connect</button>',"soon":'<span class="badge nodot">Coming soon</span>'}[state]
    op="opacity:.65" if state=="soon" else ""
    return f'<div class="card" style="padding:18px;display:flex;gap:14px;align-items:center;{op}">{ch(k,"lg")}<div class="grow"><b>{name}</b><div class="xs muted">{desc}</div></div>{btn}</div>'
