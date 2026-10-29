from b1 import *
def features():
    F=[("edit","One composer, every channel","Tailor captions per network with live previews, character counts and media checks."),("cal","Drag-and-drop calendar","See the whole month, move posts in a click, and spot gaps before they happen."),("check","Approvals built in","Route drafts to reviewers. Nothing ships until it's approved."),("retry","Reliable publishing","A smart queue with automatic retries and clear errors when a network says no."),("chart","Analytics that matter","Reach, engagement and best times to post — per channel and per post."),("shield","Secure by default","Encrypted tokens, role-based access and full execution logs.")]
    return "".join(f'<div class="card feature"><div class="fi">{I(i)}</div><h3>{t}</h3><p class="muted" style="margin-top:6px">{d}</p></div>' for i,t,d in F)
def pricing():
    out=""
    for n,p,d,c,f,pop in [("Free","$0","For solo creators getting started","Get started",["3 channels","10 scheduled posts","Basic analytics"],0),("Pro","$15","For creators & small teams","Start free trial",["10 channels","Unlimited scheduling","Approvals & 3 seats","Advanced analytics"],1),("Business","$49","For agencies and brands","Contact sales",["Unlimited channels","Unlimited seats","SSO & audit logs","Priority support"],0)]:
        tag='<span class="badge b-primary nodot">Most popular</span>' if pop else ""
        li="".join(f"<li>{x}</li>" for x in f)
        out+=f'<div class="card price {"pop" if pop else ""}"><div class="row between"><h3>{n}</h3>{tag}</div><div><span style="font-size:40px;font-weight:800;letter-spacing:-.03em">{p}</span><span class="muted">/mo</span></div><p class="muted sm">{d}</p><a class="btn {"btn-primary" if pop else "btn-secondary"}">{c}</a><ul>{li}</ul></div>'
    return out
page("landing","Landing page",f'''<header class="mk-nav">{logo("lockup",34)}<nav><a>Features</a><a>Channels</a><a>Pricing</a><a>Customers</a><a>Docs</a></nav><div class="row"><a class="btn btn-ghost" href="signin.html">Sign in</a><a class="btn btn-primary" href="signup.html">Start free</a></div></header>
<section class="hero"><div class="glow"></div><span class="badge b-primary nodot">✦ New: approval workflows & smart retries</span>
<h1>Plan once. <span class="grad-text">Cast everywhere.</span></h1><p class="muted" style="font-size:19px;max-width:640px;margin:20px auto 0">socialcastly helps teams write, approve and schedule posts for X, LinkedIn and Instagram — with true-to-life previews and a calendar your whole team can trust.</p>
<div class="row" style="justify-content:center;margin-top:30px"><a class="btn btn-grad btn-lg" href="signup.html">Start 14-day free trial</a><a class="btn btn-secondary btn-lg">{I("zap")}Watch 2-min demo</a></div><p class="xs subtle" style="margin-top:14px">No credit card required · Cancel anytime</p>
<div class="shot"><img src="../screenshots/light/dashboard.png" class="logo-light" style="width:100%" alt="Dashboard preview"><img src="../screenshots/dark/dashboard.png" class="logo-dark" style="width:100%" alt="Dashboard preview"></div></section>
<section style="padding:24px 80px 40px;text-align:center"><p class="sm subtle">Trusted by 2,000+ teams</p><div class="row" style="justify-content:center;gap:56px;margin-top:16px;font-weight:700;font-size:20px;color:var(--text-3)"><span>Northwind</span><span>Lumen&nbsp;Co</span><span>Pixelhaus</span><span>Brightside</span><span>Oakley&nbsp;Labs</span></div></section>
<section style="padding:40px 80px"><div class="grid g3">{features()}</div></section>
<section style="padding:40px 80px 80px"><div style="text-align:center;margin-bottom:28px"><h1>Simple pricing</h1><p class="muted">Start free. Upgrade when your team grows.</p></div><div class="grid g3" style="max-width:1080px;margin:0 auto">{pricing()}</div></section>
<footer style="border-top:1px solid var(--border);padding:28px 80px" class="row between">{logo("lockup",24)}<span class="sm subtle">© 2026 socialcastly · Privacy · Terms · Status</span></footer>''',group="Marketing & auth")

def auth(slug,title,heading,sub,form):
    page(slug,title,f'''<div class="auth"><div class="art"><img src="../assets/logo/socialcastly-lockup-dark.png" style="height:36px;align-self:flex-start" alt="socialcastly">
<div><h1 style="font-size:40px;line-height:1.1;max-width:440px">Your whole social calendar, in one calm place.</h1><p style="opacity:.92;margin-top:14px;max-width:420px;font-size:16px">Write once, tailor per channel, and publish on time — every time.</p>
<div class="card" style="margin-top:36px;max-width:440px;color:var(--text);overflow:hidden">{post_row(POSTS[1],False)}</div></div>
<p style="opacity:.9" class="sm">“We cut weekly planning from 4 hours to 40 minutes.” — Maya R., Pixelhaus</p>
<img src="../assets/logo/socialcastly-mark-1024.png" style="position:absolute;right:-140px;bottom:-140px;width:520px;opacity:.14;filter:brightness(0) invert(1)" alt=""></div>
<div class="form"><div style="width:400px" class="col"><h1>{heading}</h1><p class="muted" style="margin-top:-6px">{sub}</p>
<div class="col" style="margin-top:12px"><a class="oauth"><span style="font-weight:800;color:#4285F4">G</span>Continue with Google</a></div><div class="divider">or with email</div>{form}</div></div></div>''',group="Marketing & auth")
auth("signin","Sign in","Welcome back","Sign in to your socialcastly workspace.",'''<div class="field"><label class="label">Email</label><input class="input" value="win@acmestudio.co"></div>
<div class="field"><div class="row between"><label class="label">Password</label><a class="xs" style="color:var(--primary);font-weight:600">Forgot password?</a></div><input class="input" type="password" value="password123"></div>
<label class="row sm"><span class="check on"></span>Keep me signed in for 14 days</label><a class="btn btn-primary btn-lg" href="dashboard.html">Sign in</a><p class="sm muted" style="text-align:center">New to socialcastly? <a href="signup.html" style="color:var(--primary);font-weight:600">Create an account</a></p>''')
bars4="".join(f'<i style="flex:1;height:4px;border-radius:4px;background:{c}"></i>' for c in ["var(--success)"]*3+["var(--surface-3)"])
auth("signup","Sign up","Create your account","Free for 14 days. No credit card needed.",f'''<div class="grid g2" style="gap:12px"><div class="field"><label class="label">Full name</label><input class="input" value="Win Kyaw"></div><div class="field"><label class="label">Workspace</label><input class="input" value="Acme Studio"></div></div>
<div class="field"><label class="label">Work email</label><input class="input err" value="win@acmestudio"><span class="err-text">Enter a valid email address, like name@company.com</span></div>
<div class="field"><label class="label">Password</label><input class="input" type="password" value="supersecret12"><div class="row" style="gap:4px;margin-top:8px">{bars4}</div><span class="hint">Strong password · 12+ characters</span></div>
<a class="btn btn-primary btn-lg" href="onboarding.html">Create account</a><p class="xs subtle" style="text-align:center">By signing up you agree to our Terms and Privacy Policy.</p>''')

steps=""
for i,t in enumerate(["Workspace","Connect channels","Invite team","First post"]):
    bg="var(--primary)" if i<2 else "var(--surface-3)"; fc="var(--primary)" if i==1 else "var(--text-3)"
    steps+=f'<div style="flex:1"><div style="height:4px;border-radius:4px;background:{bg}"></div><div class="xs" style="margin-top:8px;color:{fc};font-weight:600">Step {i+1} · {t}</div></div>'
page("onboarding","Onboarding · Connect channels",f'''<header class="mk-nav" style="border:0">{logo("lockup",30)}<a class="sm muted">Skip for now</a></header>
<div style="max-width:760px;margin:0 auto;padding:24px 24px 64px" class="col"><div class="row" style="gap:8px;margin-bottom:8px">{steps}</div>
<h1 style="margin-top:24px;font-size:32px">Connect your channels</h1><p class="muted" style="font-size:16px">Choose where you want to publish. You can add more anytime from Channels.</p>
<div class="col" style="margin-top:12px">{chcard("x","X (Twitter)","Text posts & threads · @acmestudio","connected")}{chcard("in","LinkedIn","Personal profile or company page · text posts","connect")}{chcard("ig","Instagram","Business or creator account · single-image posts","connect")}</div>
<p class="sm subtle" style="margin-top:12px">More networks on the way</p><div class="grid g2" style="gap:12px">{chcard("fb","Facebook Pages","Coming soon","soon")}{chcard("tt","TikTok","Coming soon","soon")}{chcard("yt","YouTube","Coming soon","soon")}{chcard("pin","Pinterest","Coming soon","soon")}</div>
<div class="alert info" style="margin-top:8px">{I("shield","ico","color:var(--primary)")}<div class="sm"><b>Your tokens are encrypted at rest.</b> <span class="muted">We never post outside your schedule or approvals, and you can disconnect at any time.</span></div></div>
<div class="row between" style="margin-top:12px"><a class="btn btn-ghost">{I("chevl")}Back</a><a class="btn btn-primary btn-lg" href="dashboard.html">Continue{I("chev")}</a></div></div>''',group="Marketing & auth")

stats=[("Scheduled this week","24","+6 vs last week","up"),("Published (30d)","142","+18%","up"),("Engagement rate","4.8%","+0.6 pts","up"),("Failed posts","1","Needs attention","down")]
def stat_cards(S,pad=""):
    return "".join(f'<div class="card stat" style="{pad}"><div class="sm muted">{a}</div><div class="v">{b}</div><div class="d {d}">{c}</div></div>' for a,b,c,d in S)
bars=""
for d,v in zip(["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],[(30,40,50),(45,30,60),(40,55,40),(60,45,70),(50,40,62),(25,15,45),(20,12,38)]):
    seg="".join(f'<i style="height:{round(h*.75)}px;background:var(--{c})"></i>' for h,c in zip(v,["ch-x","ch-linkedin","ch-instagram"]))
    bars+=f'<div>{seg}<span class="lbl">{d}</span></div>'
appr="".join(f'<div class="row">{av(i,n)}<div class="grow"><div class="sm" style="font-weight:600">{t}</div><div class="xs subtle">{w}</div></div><a class="btn btn-sm btn-secondary" href="approvals.html">Review</a></div>' for i,n,t,w in [("MS",1,"Q4 product teaser","Maya · 2 channels"),("JL",2,"Hiring: Senior designer","Jon · LinkedIn"),("PT",3,"Customer story: Lumen","Priya · 3 channels")])
health="".join(f'<div class="row">{ch(k)}<span class="grow sm">{n}</span>{badge(s,l)}</div>' for k,n,s,l in [("x","@acmestudio","failed","Rate limited"),("in","Acme Studio","published","Healthy"),("ig","acme.studio","pending","Token expires in 5d")])
LEG='<div class="legend"><span style="--c:var(--ch-x)">X</span><span style="--c:var(--ch-linkedin)">LinkedIn</span><span style="--c:var(--ch-instagram)">Instagram</span></div>'
page("dashboard","Dashboard",shell("dashboard",head("Good afternoon, Win 👋","Here's what's going out across your channels this week.",'<div class="seg"><a>Today</a><a class="active">This week</a><a>Month</a></div>')+
f'''<div class="alert error">{I("alert","ico","color:var(--error)")}<div class="grow sm"><b>1 post failed to publish on X.</b> <span class="muted">Rate limit reached — we'll retry automatically, or you can retry now.</span></div><a class="btn btn-sm btn-secondary" href="queue.html">Review</a></div>
<div class="grid g4">{stat_cards(stats)}</div>
<div class="grid" style="grid-template-columns:1.6fr 1fr;align-items:start"><div class="card"><div class="card-head"><div><h2>Up next</h2><div class="xs subtle">Thursday, Oct 29</div></div><a class="btn btn-sm btn-ghost" href="queue.html">View queue{I("chev")}</a></div>{"".join(post_row(p) for p in POSTS)}</div>
<div class="col" style="gap:20px"><div class="card chart-card"><div class="row between"><h2>Posts this week</h2>{LEG}</div><div class="bars">{bars}</div></div>
<div class="card card-pad"><div class="row between"><h2>Waiting for approval</h2><span class="badge b-warning">3</span></div><div class="col" style="margin-top:14px">{appr}</div></div>
<div class="card card-pad"><h2>Channel health</h2><div class="col" style="margin-top:14px">{health}</div></div></div></div>'''))

pills="".join(f'<span class="row" style="gap:6px;padding:4px 10px 4px 4px;border-radius:99px;border:1.5px solid var(--primary);background:var(--primary-soft)"><span class="with-ch">{av("AC",0,24)}{ch(k,"sm")}</span><span class="sm" style="font-weight:600">{n}</span></span>' for k,n in [("x","@acmestudio"),("in","Acme Studio"),("ig","acme.studio")])
tools="".join(f'<button class="btn btn-ghost btn-icon btn-sm" aria-label="{i}">{I(i)}</button>' for i in ["img","emoji","hash","link","sparkle"])
counts="".join(f'<span class="row" style="gap:6px">{ch(k,"sm")}<span class="muted">{n}</span></span>' for k,n in [("x","212 / 280"),("in","212 / 3000"),("ig","212 / 2200")])
page("composer","Composer",shell("composer",head("Create post","Write once, tailor for each channel, and preview before it goes out.",'<a class="btn btn-ghost">Discard</a><a class="btn btn-secondary">Save draft</a>')+
f'''<div class="grid" style="grid-template-columns:1.25fr 1fr;align-items:start"><div class="card"><div class="card-head" style="justify-content:flex-start;gap:10px"><span class="sm muted">Publish to</span>{pills}<button class="btn btn-sm btn-ghost btn-icon" aria-label="Add channel">{I("plus")}</button></div>
<div class="tabs" style="padding:0 20px"><a class="active">Original</a><a>X</a><a>LinkedIn</a><a>Instagram <span class="badge b-warning nodot" style="margin-left:4px">1</span></a></div>
<div style="padding:20px" class="col"><textarea class="input" rows="7" style="font-size:15px;border:0;padding:0">Launch day 🚀 socialcastly 2.0 is here.

Plan a week of posts in ten minutes, get approvals without the Slack ping-pong, and see exactly how each post will look before it ships.

Try it free → socialcastly.app</textarea>
<div class="row" style="gap:10px"><div class="thumb th2" style="width:96px;height:96px;position:relative"><span style="position:absolute;top:4px;right:4px;background:rgba(15,23,42,.75);color:#fff;border-radius:50%;width:20px;height:20px;display:grid;place-items:center;font-size:11px">✕</span></div><div class="dropzone" style="flex:1;height:96px">{I("upload","ico","color:var(--primary)")}<div><b class="sm">Drop images or click to upload</b><div class="xs subtle">PNG, JPG up to 8MB · or pick from Media library</div></div></div></div>
<div class="row between" style="border-top:1px solid var(--border);padding-top:12px"><div class="row" style="gap:2px">{tools}</div><div class="row sm">{counts}</div></div>
<div class="alert warning">{I("alert","ico","color:var(--warning)")}<div class="sm"><b>Instagram:</b> <span class="muted">links in captions aren't clickable — consider “link in bio” for the IG version.</span></div></div></div>
<div style="border-top:1px solid var(--border);padding:20px" class="col"><h3>When to publish</h3><div class="seg" style="align-self:flex-start"><a>Post now</a><a class="active">Schedule</a><a>Add to queue</a><a>Request approval</a></div>
<div class="grid g3" style="gap:12px"><div class="field"><label class="label">Date</label><div class="input row">{I("cal","ico","color:var(--text-3)")}Thu, Oct 29, 2026</div></div><div class="field"><label class="label">Time</label><div class="input row">{I("clock","ico","color:var(--text-3)")}9:00 AM</div></div><div class="field"><label class="label">Timezone</label><div class="input row">Asia/Bangkok (GMT+7)</div></div></div>
<div class="row sm" style="color:var(--primary)">{I("sparkle")}<span>Best time for your audience: <b>Thu 9:00 AM</b> — 32% higher engagement</span></div></div>
<div style="border-top:1px solid var(--border);padding:16px 20px" class="row between"><span class="xs subtle">Autosaved 12s ago</span><div class="row"><a class="btn btn-secondary">Preview all</a><a class="btn btn-primary">Schedule 3 posts</a></div></div></div>
<div class="col" style="gap:16px"><div class="row between"><h2>Preview</h2><div class="seg"><a>X</a><a class="active">LinkedIn</a><a>Instagram</a></div></div>
<div class="pv"><div class="row">{av("AC",0,44)}<div style="line-height:1.3"><b>Acme Studio</b><div class="xs subtle">4,812 followers · Now · 🌐</div></div></div><p style="margin-top:12px;white-space:pre-line">Launch day 🚀 socialcastly 2.0 is here.

Plan a week of posts in ten minutes, get approvals without the Slack ping-pong, and see exactly how each post will look before it ships.

Try it free → <span style="color:var(--primary);font-weight:600">socialcastly.app</span></p><div class="img th2" style="display:grid;place-items:center">{MARK.format(w=72)}</div>
<div class="row xs muted" style="justify-content:space-around;margin-top:12px;border-top:1px solid var(--border);padding-top:10px"><span>👍 Like</span><span>💬 Comment</span><span>↻ Repost</span><span>➤ Send</span></div></div>
<div class="pv"><div class="row">{av("AC",0,36)}<div class="sm"><b>Acme Studio</b> <span class="subtle">@acmestudio · 9:00 AM</span></div></div><p class="sm" style="margin-top:8px">Launch day 🚀 socialcastly 2.0 is here. Plan a week of posts in ten minutes…</p></div></div></div>'''))
