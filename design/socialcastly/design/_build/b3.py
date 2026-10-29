from b2 import *
random.seed(4)
cells=""
for i in range(35):
    d=i-3; out=d<1 or d>31; n=(d+30) if d<1 else (d-31 if d>31 else d)
    chips=""
    if not out:
        for j in range(random.choice([0,1,1,2,2,3])):
            k=random.choice(["x","in","ig"]); t=random.choice(["9:00","11:30","13:15","16:00","18:45"]); txt=random.choice(["Launch day 🚀","Hiring post","Studio BTS","Weekly tip","Customer story","Reading list","Webinar promo"])
            f=" failed" if (d==29 and j==1) else ""
            chips+=f'<div class="chip c-{k}{f}"><b>{t}</b>{txt}</div>'
        if d in (8,22): chips+='<span class="xs subtle">+2 more</span>'
    cells+=f'<div class="cell{" out" if out else ""}{" today" if d==29 else ""}"><span class="n">{n}</span>{chips}</div>'
def calhead(m):
    a1="active" if m else ""; a2="" if m else "active"
    return f'''<div class="row between"><div class="row"><button class="btn btn-secondary btn-icon btn-sm" aria-label="Previous">{I("chevl")}</button><button class="btn btn-secondary btn-icon btn-sm" aria-label="Next">{I("chev")}</button><button class="btn btn-secondary btn-sm">Today</button><h2 style="margin-left:6px">{"October 2026" if m else "Oct 26 – Nov 1, 2026"}</h2></div>
<div class="row"><div class="row sm muted" style="gap:6px">Channels {ch("x","sm")}{ch("in","sm")}{ch("ig","sm")}</div><div class="seg"><a class="{a1}" href="calendar.html">Month</a><a class="{a2}" href="calendar-week.html">Week</a><a>List</a></div></div></div>'''
dows="".join(f"<div class=dow>{d}</div>" for d in ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"])
NP=f'<a class="btn btn-primary" href="composer.html">{I("plus")}New post</a>'
page("calendar","Calendar · Month",shell("calendar",head("Calendar","Drag posts to reschedule. Click an empty day to create.",NP)+calhead(1)+f'<div class="cal">{dows}{cells}</div><div class="legend"><span style="--c:var(--ch-x)">X</span><span style="--c:var(--ch-linkedin)">LinkedIn</span><span style="--c:var(--ch-instagram)">Instagram</span><span style="--c:var(--error)">Failed</span></div>'))
hours=["8 AM","9 AM","10 AM","11 AM","12 PM","1 PM","2 PM","3 PM","4 PM","5 PM"]
EV={(0,1):("x","9:00","Weekly tip"),(1,3):("in","11:30","Rebuild story"),(3,1):("x","9:00","Launch day 🚀"),(3,3):("in","11:30","We rebuilt…"),(3,5):("ig","1:15","Studio BTS"),(3,8):("x","4:00","Quick tip ⚠"),(4,2):("ig","10:00","Reading list"),(2,6):("in","2:00","Hiring: designer"),(5,4):("ig","12:00","Weekend vibes"),(1,7):("x","3:00","Poll: features"),(4,8):("in","4:00","Webinar promo")}
wk='<div class="h"></div>'
for d,n in zip(["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],[26,27,28,29,30,31,1]):
    c="color:var(--primary)" if n==29 else ""
    wk+=f'<div class="h"><div class="xs subtle">{d}</div><div style="font-weight:700;font-size:18px;{c}">{n}</div></div>'
for h,hl in enumerate(hours):
    wk+=f'<div class="t">{hl}</div>'
    for d in range(7):
        e=EV.get((d,h)); inner=f'<div class="ev {e[0]}"><div class="row" style="gap:6px">{ch(e[0],"sm")}<b>{e[1]}</b></div>{e[2]}</div>' if e else ""
        bg=' style="background:color-mix(in srgb,var(--primary) 4%,transparent)"' if d==3 else ""
        wk+=f'<div class="s"{bg}>{inner}</div>'
page("calendar-week","Calendar · Week",shell("calendar",head("Calendar","Drag posts to reschedule. Click an empty slot to create.",NP)+calhead(0)+f'<div class="week">{wk}</div>'))

def qtabs(a):
    return '<div class="tabs">'+"".join(f'<a class="{"active" if t==a else ""}">{t} <span class="badge nodot" style="margin-left:4px">{n}</span></a>' for t,n in [("Scheduled",24),("Queued",3),("Published",142),("Failed",1)])+'</div>'
FILT=f'<div class="seg"><a class="active">All channels</a><a>X</a><a>LinkedIn</a><a>Instagram</a></div><a class="btn btn-secondary">Queue settings</a>'
page("queue","Queue",shell("queue",head("Queue","Everything scheduled to go out, grouped by day.",FILT)+qtabs("Scheduled")+
f'''<div class="card"><div class="card-head"><h3>Today · Thursday, Oct 29</h3><span class="xs subtle">5 posts</span></div>{"".join(post_row(p) for p in POSTS)}</div>
<div class="card"><div class="card-head"><h3>Tomorrow · Friday, Oct 30</h3><span class="xs subtle">1 post · 1 open slot</span></div>{post_row(("10:00","AM","in","Webinar next week: how agencies run approvals across 40 client accounts. Save your seat.","scheduled","th3"))}
<div class="post" style="background:var(--surface-2)"><div class="time subtle">2:00<span>PM</span></div><div class="body muted sm" style="padding-top:8px">Empty slot · <a style="color:var(--primary);font-weight:600" href="composer.html">+ Add a post</a></div></div></div>'''))

DR=[("Q4 product teaser — short video cut + caption","Maya S.","x in","2h ago","th4"),("Hiring: Senior product designer (remote, APAC)","Jon L.","in","Yesterday",""),("Customer story: how Lumen Co grew 3×","Priya T.","x in ig","Oct 26","th3"),("Black Friday early access 🎁","Win K.","ig","Oct 25","th5"),("Thread: 10 scheduling mistakes","Win K.","x","Oct 22",""),("Office dog of the month 🐶","Maya S.","ig","Oct 20","th1")]
dc=""
for t,a,c,w,th in DR:
    top=f'<div class="{th}" style="height:120px"></div>' if th else '<div style="height:120px;background:var(--surface-2);display:grid;place-items:center" class="sm muted">Text only</div>'
    chs="".join(ch(k,"sm") for k in c.split())
    dc+=f'<div class="card" style="overflow:hidden">{top}<div style="padding:16px" class="col"><b>{t}</b><div class="row between"><div class="row" style="gap:4px">{chs}</div><span class="xs subtle">{w} · {a}</span></div><div class="row"><a class="btn btn-sm btn-secondary grow" href="composer.html">Edit</a><a class="btn btn-sm btn-ghost">Schedule</a></div></div></div>'
page("drafts","Drafts",shell("drafts",head("Drafts","Ideas and work-in-progress. Nothing here will publish.",f'<div class="search" style="width:260px">{I("search")}Search drafts</div><a class="btn btn-primary" href="composer.html">{I("plus")}New draft</a>')+f'<div class="grid g3">{dc}</div>'))

al=""
for i,(a,t,n,w,c) in enumerate([("MS","Q4 product teaser","Maya S.","2h ago","x in"),("JL","Hiring: Senior designer","Jon L.","Yesterday","in"),("PT","Customer story: Lumen","Priya T.","Oct 26","x in ig")]):
    sel=' style="background:var(--primary-soft)"' if i==0 else ""
    chs="".join(ch(k,"sm") for k in c.split())
    al+=f'<div class="post"{sel}>{av(a,i+1,36)}<div class="body"><b class="sm">{t}</b><div class="xs subtle">{n} · {w}</div><div class="row" style="gap:4px;margin-top:6px">{chs}{badge("pending","Pending")}</div></div></div>'
page("approvals","Approvals",shell("approvals",head("Approvals","Review drafts from your team before they're scheduled.",'<div class="seg"><a class="active">Pending (3)</a><a>Approved</a><a>Rejected</a></div>')+
f'''<div class="grid" style="grid-template-columns:1fr 1.3fr;align-items:start"><div class="card">{al}</div>
<div class="card"><div class="card-head"><div class="row">{av("MS",1,36)}<div><b>Q4 product teaser</b><div class="xs subtle">Submitted by Maya S. · for Nov 2, 10:00 AM · X, LinkedIn</div></div></div>{badge("pending","Pending review")}</div>
<div style="padding:20px" class="col"><div class="pv"><p>Something big is landing on Nov 2. 👀 Smarter queues, real previews, and approvals that don't live in your DMs. #socialcastly</p><div class="img th4"></div></div>
<h3>Comments</h3><div class="row" style="align-items:flex-start">{av("WK",0,28)}<div class="card" style="padding:10px 12px;background:var(--surface-2);box-shadow:none"><b class="sm">Win K.</b> <span class="xs subtle">1h</span><div class="sm">Can we swap the hashtag for #buildinpublic on X?</div></div></div>
<textarea class="input" rows="2" placeholder="Leave feedback for Maya…"></textarea><div class="row" style="justify-content:flex-end"><a class="btn btn-secondary">Request changes</a><a class="btn btn-danger">Reject</a><a class="btn btn-primary">{I("check")}Approve & schedule</a></div></div></div></div>'''))

line=" ".join(f"{i*60},{170-v}" for i,v in enumerate([40,55,48,70,66,90,84,110,98,120,132,126,150]))
line2=" ".join(f"{i*60},{170-v}" for i,v in enumerate([20,30,26,35,42,40,52,48,60,58,70,66,74]))
grid="".join(f'<line x1="0" x2="720" y1="{y}" y2="{y}" stroke="var(--border)" stroke-width="1"/>' for y in [20,70,120,170])
bych="".join(f'<div><div class="row between sm"><span class="row">{ch(k,"sm")}<b>{n}</b></span><span class="muted">{v}</span></div><div class="progress" style="margin-top:8px"><i style="width:{p}%;background:var(--ch-{c})"></i></div></div>' for k,n,v,p,c in [("in","LinkedIn","112.4K",78,"linkedin"),("ig","Instagram","86.1K",60,"instagram"),("x","X","50.1K",35,"x")])
heat="".join(f'<div style="height:20px;border-radius:4px;background:color-mix(in srgb,var(--primary) {random.choice([8,15,25,40,60,85])}%,var(--surface-2))"></div>' for _ in range(40))
top="".join(f'<tr><td><div class="row"><div class="thumb {th}" style="width:40px;height:40px"></div><div><div class="sm" style="font-weight:600">{t}</div><div class="row xs subtle" style="gap:6px">{ch(k,"sm")}{d}</div></div></div></td><td>{a}</td><td><span class="badge b-success nodot">{b}</span></td><td>{c}</td></tr>' for th,t,k,d,a,b,c in [("th2","We rebuilt our scheduler…","in","Oct 21","38.2K","7.4%","1,204"),("th1","Studio BTS ✨","ig","Oct 18","29.7K","6.1%","—"),("th6","10 scheduling mistakes 🧵","x","Oct 14","21.3K","5.2%","688"),("th3","Customer story: Northwind","in","Oct 9","18.0K","4.9%","540")])
page("analytics","Analytics",shell("analytics",head("Analytics","Performance across your connected channels.",f'<div class="seg"><a>7d</a><a class="active">30d</a><a>90d</a><a>Custom</a></div><a class="btn btn-secondary">{I("upload")}Export CSV</a>')+
f'''<div class="grid g4">{stat_cards([("Impressions","248.6K","▲ 22.4%","up"),("Engagements","11.9K","▲ 9.1%","up"),("Link clicks","3,204","▲ 4.3%","up"),("Follower growth","+612","▼ 2.0%","down")])}</div>
<div class="card card-pad"><div class="row between"><h2>Impressions over time</h2><div class="legend"><span style="--c:var(--primary)">Impressions</span><span style="--c:var(--primary-2)">Engagements ×10</span></div></div>
<svg viewBox="0 0 720 180" style="width:100%;height:240px;margin-top:12px" preserveAspectRatio="none"><defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--primary)" stop-opacity=".28"/><stop offset="1" stop-color="var(--primary)" stop-opacity="0"/></linearGradient></defs>{grid}<polygon points="0,170 {line} 720,170" fill="url(#ga)"/><polyline points="{line}" fill="none" stroke="var(--primary)" stroke-width="2.5" vector-effect="non-scaling-stroke"/><polyline points="{line2}" fill="none" stroke="var(--primary-2)" stroke-width="2.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/></svg></div>
<div class="grid" style="grid-template-columns:1fr 1.6fr;align-items:start"><div class="card card-pad"><h2>By channel</h2><div class="col" style="margin-top:16px;gap:18px">{bych}</div>
<h3 style="margin-top:24px">Best time to post</h3><div style="display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin-top:10px">{heat}</div><div class="xs subtle" style="margin-top:6px">Mon–Fri · 6 AM – 9 PM (GMT+7)</div></div>
<div class="card"><div class="card-head"><h2>Top posts</h2><a class="btn btn-sm btn-ghost">See all</a></div><table class="table"><thead><tr><th>Post</th><th>Impr.</th><th>Eng. rate</th><th>Clicks</th></tr></thead><tbody>{top}</tbody></table></div></div>'''))

rows=""
for i,(k,n,h,net,s,l,p,by,a) in enumerate([("x","Acme Studio","@acmestudio","X · text","failed","Rate limited","48","Win","Retry posts"),("in","Acme Studio","Company page","LinkedIn · text","published","Healthy","61","Win","Settings"),("ig","acme.studio","Business account","Instagram · 1 image","pending","Reconnect in 5 days","33","Maya","Reconnect"),("in","Win Kyaw","Personal profile","LinkedIn · text","published","Healthy","12","Win","Settings")]):
    rows+=f'<tr><td><div class="row"><span class="with-ch">{av("AC",0,36)}{ch(k,"sm")}</span><div><b class="sm">{n}</b><div class="xs subtle">{h}</div></div></div></td><td class="sm">{net}</td><td>{badge(s,l)}</td><td class="sm">{p}</td><td><div class="row sm">{av(by[:2].upper(),i,24)}{by}</div></td><td style="text-align:right"><a class="btn btn-sm btn-secondary">{a}</a></td></tr>'
page("channels","Channels",shell("channels",head("Channels","Manage connected accounts and their publishing health.",f'<a class="btn btn-primary">{I("plus")}Connect channel</a>')+
f'''<div class="alert warning">{I("alert","ico","color:var(--warning)")}<div class="sm grow"><b>Instagram access expires Nov 3.</b> <span class="muted">Reconnect to keep scheduled posts publishing. Instagram needs images on a public URL.</span></div><a class="btn btn-sm btn-secondary">Reconnect</a></div>
<div class="card"><table class="table"><thead><tr><th>Account</th><th>Network</th><th>Status</th><th>Posts (30d)</th><th>Connected by</th><th></th></tr></thead><tbody>{rows}</tbody></table></div>
<h2>Add a channel</h2><div class="grid g3" style="gap:12px">{chcard("x","X","Threads & text","connect")}{chcard("in","LinkedIn","Profiles & pages","connect")}{chcard("ig","Instagram","Business accounts","connect")}{chcard("fb","Facebook","Coming soon","soon")}{chcard("tt","TikTok","Coming soon","soon")}{chcard("yt","YouTube","Coming soon","soon")}</div>'''))
