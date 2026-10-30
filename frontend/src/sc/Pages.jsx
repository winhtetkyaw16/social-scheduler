import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ch, meta, chColor, Avatar, AccountAvatar, StatusBadge, Empty, PageHead, Seg, Tabs, fmtTime, fmtDay, postTitle, PLATFORM_META } from "./ui.jsx";
import markPng from "../assets/brand/socialcastly-mark-256.png";
import lockupLight from "../assets/brand/socialcastly-lockup-light.png";
import lockupDark from "../assets/brand/socialcastly-lockup-dark.png";

const DAY = 864e5;
const when = (p) => p?.published_at || p?.scheduled_at || p?.created_at;
const isLive = (p) => ["scheduled", "queued", "publishing"].includes(p?.status);
const startOfWeek = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const svgIco = (path) => <svg className="ico" viewBox="0 0 24 24">{path}</svg>;
const I = {
  plus: svgIco(<path d="M12 5v14M5 12h14" />),
  alert: svgIco(<><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>),
  arrow: svgIco(<path d="M5 12h14M13 6l6 6-6 6" />),
  retry: svgIco(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>),
  upload: svgIco(<><path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 20h16" /></>),
  download: svgIco(<><path d="M12 4v12M6 10l6 6 6-6" /><path d="M4 20h16" /></>),
  lock: svgIco(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
  more: svgIco(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>),
};
function splitTime(v) { const t = fmtTime(v); return [t.replace(/\s?(AM|PM)/i, ""), (t.match(/AM|PM/i) || [""])[0]]; }

function PostRow({ post, account, onOpen, onRetry }) {
  const [t, ap] = splitTime(when(post));
  return <div className="post">
    <div className="time">{t}<span>{ap}</span></div>
    <AccountAvatar account={account} size={36} />
    <div className="body"><div className="row" style={{ gap: 8, marginBottom: 4 }}><b className="sm">{account?.account_name || account?.platform || "Account"}</b><StatusBadge status={post.status} post={post} /></div><div className="txt">{post.content || "Untitled post"}</div>
      {post.status === "failed" && post.last_error_message && <div className="xs" style={{ color: "var(--error)", marginTop: 6 }}>⚠ {post.last_error_code ? `${post.last_error_code}: ` : ""}{post.last_error_message}</div>}</div>
    {post.media_urls?.[0] && <img className="thumb" src={post.media_urls[0]} alt="" style={{ objectFit: "cover" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
    {post.status === "failed" && onRetry ? <button type="button" className="btn btn-sm btn-secondary" onClick={() => onRetry(post.id)}>{I.retry}Retry</button> : <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label="More" onClick={onOpen}>{I.more}</button>}
  </div>;
}

const failedSinceConnect = (account, posts) => { const c = Date.parse(account.extra_metadata?.connected_at || account.created_at || 0) || 0; return posts.some((post) => post.connected_account_id === account.id && post.status === "failed" && (Date.parse(post.updated_at || post.created_at) || 0) >= c); };
function healthOf(account, posts) {
  if (account.is_active === false) return ["Paused", ""];
  const exp = account.token_expires_at ? new Date(account.token_expires_at) : null;
  if (exp && exp < new Date() && !account.has_refresh_token) return ["Token expired", "b-error"];
  if (exp && !account.has_refresh_token && exp - Date.now() < 7 * DAY) return [`Token expires in ${Math.max(1, Math.ceil((exp - Date.now()) / DAY))}d`, "b-warning"];
  const recentFail = failedSinceConnect(account, posts);
  if (recentFail) return ["Has failed posts", "b-error"];
  return ["Healthy", "b-success"];
}

function WeekBars({ posts, accounts, start, days = 7 }) {
  const plats = [...new Set(accounts.map((a) => a.platform))].slice(0, 4);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const cols = Array.from({ length: days }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const counts = cols.map((d) => plats.map((pl) => posts.filter((p) => { const w = when(p); if (!w) return false; const x = new Date(w); return x.toDateString() === d.toDateString() && acc.get(p.connected_account_id)?.platform === pl; }).length));
  const max = Math.max(1, ...counts.map((c) => c.reduce((x, y) => x + y, 0)));
  return <div className="card chart-card"><div className="row between"><h2>Posts this week</h2><div className="legend">{plats.map((pl) => <span key={pl} style={{ "--c": chColor(pl) }}>{meta(pl).label}</span>)}</div></div>
    {counts.flat().every((n) => n === 0) ? <div className="xs subtle" style={{ padding: "40px 0", textAlign: "center" }}>No posts scheduled or published this week yet.</div> :
      <div className="bars wb-bars">{cols.map((d, i) => { const tot = counts[i].reduce((x, y) => x + y, 0); return <div key={i} className="wb-col" title={`${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}: ${tot} post${tot === 1 ? "" : "s"}`}><div className="wb-plot">{tot === 0 ? <i className="wb-empty" /> : plats.map((pl, j) => counts[i][j] ? <i key={pl} title={`${meta(pl).label}: ${counts[i][j]}`} style={{ height: `${(counts[i][j] / max) * 100}%`, background: chColor(pl) }} /> : null)}</div><span className="lbl">{d.toLocaleDateString([], { weekday: "short" })}</span></div>; })}</div>}
  </div>;
}

export function Dashboard({ user, accounts, posts, approvals = [], goToTab, openStudio, onRetryPost, onOpenPost }) {
  const [range, setRange] = useState("week");
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = (user?.full_name || "").split(/\s+/)[0];
  const wk = startOfWeek(); const wkEnd = new Date(wk.getTime() + 7 * DAY); const lastWk = new Date(wk.getTime() - 7 * DAY);
  const rangeStart = range === "today" ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : range === "week" ? wk : new Date(now.getFullYear(), now.getMonth(), 1);
  const rangeEnd = range === "today" ? new Date(rangeStart.getTime() + DAY) : range === "week" ? wkEnd : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const inR = (p, a, b) => { const w = p.scheduled_at && new Date(p.scheduled_at); return w && w >= a && w < b; };
  const scheduledR = posts.filter((p) => isLive(p) && inR(p, rangeStart, rangeEnd)).length;
  const scheduledLast = posts.filter((p) => inR(p, lastWk, wk) && p.status !== "draft").length;
  const pub30 = posts.filter((p) => p.status === "published" && p.published_at && Date.now() - new Date(p.published_at) < 30 * DAY);
  const pubConfirmed = pub30.filter((p) => p.provider_post_id).length;
  const failed = posts.filter((p) => p.status === "failed");
  const failedPlats = [...new Set(failed.map((p) => meta(acc.get(p.connected_account_id)?.platform).label))];
  const upcoming = posts.filter((p) => isLive(p) || p.status === "failed").filter((p) => new Date(p.scheduled_at) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) || p.status === "failed").sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)).slice(0, 6);
  const nextDay = upcoming[0] ? new Date(upcoming[0].scheduled_at) : now;
  return <>
    <PageHead title={`${greet}${first ? `, ${first}` : ""} 👋`} sub={`Here's what's going out across your channels ${range === "today" ? "today" : range === "week" ? "this week" : "this month"}.`}><Seg value={range} onChange={setRange} options={[["today", "Today"], ["week", "This week"], ["month", "Month"]]} /></PageHead>
    {failed.length > 0 && <div className="alert error">{I.alert}<div className="grow sm"><b>{failed.length} post{failed.length === 1 ? "" : "s"} failed to publish{failedPlats.length ? ` on ${failedPlats.join(", ")}` : ""}.</b> <span className="muted">{failed[0].last_error_message || "Retry now or review the error."}</span></div><button type="button" className="btn btn-sm btn-secondary" onClick={() => goToTab("queue", { tab: "failed" })}>Review</button></div>}
    <div className="grid g4">
      <div className="card stat"><div className="sm muted">Scheduled {range === "today" ? "today" : range === "week" ? "this week" : "this month"}</div><div className="v">{scheduledR}</div><div className="d">{range === "week" ? `${scheduledLast} last week` : "\u00a0"}</div></div>
      <div className="card stat"><div className="sm muted">Published (30d)</div><div className="v">{pub30.length}</div><div className="d">{pubConfirmed} confirmed by provider</div></div>
      <div className="card stat"><div className="sm muted">Engagement rate</div><div className="v">—</div><div className="d">Not tracked yet</div></div>
      <div className="card stat"><div className="sm muted">Failed posts</div><div className="v">{failed.length}</div><div className={`d ${failed.length ? "down" : ""}`}>{failed.length ? "Needs attention" : "All clear"}</div></div>
    </div>
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)", alignItems: "start" }}>
      <div className="card"><div className="card-head"><div><h2>Up next</h2><div className="xs subtle">{nextDay.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</div></div><button type="button" className="btn btn-sm btn-ghost" onClick={() => goToTab("queue")}>View queue{I.arrow}</button></div>
        {upcoming.length ? upcoming.map((p) => <PostRow key={p.id} post={p} account={acc.get(p.connected_account_id)} onOpen={() => onOpenPost ? onOpenPost(p) : goToTab("queue")} onRetry={onRetryPost} />) : <Empty art={<img src={markPng} alt="" style={{ width: 48 }} />} title="Nothing scheduled yet" text="Schedule your first post and it'll appear here, ready to cast." action="Create a post" onAction={() => openStudio()} />}
      </div>
      <div className="col" style={{ gap: 20 }}>
        <WeekBars posts={posts} accounts={accounts} start={wk} />
        <div className="card card-pad"><div className="row between"><h2>Waiting for approval</h2><span className="badge b-warning">{approvals.length}</span></div>
          <div className="col" style={{ marginTop: 14, gap: 12 }}>{approvals.length ? approvals.slice(0, 3).map((a) => <div key={a.id} className="row"><Avatar name={postTitle(a)} size={32} /><div className="grow"><div className="sm">{postTitle(a)}</div><div className="xs subtle">{fmtDay(a.updated_at)}</div></div><button type="button" className="btn btn-sm btn-secondary" onClick={() => goToTab("approvals")}>Review</button></div>) : <span className="sm muted">Nothing waiting for review.</span>}</div></div>
        <div className="card card-pad"><h2>Channel health</h2><div className="col" style={{ marginTop: 14 }}>{accounts.length ? accounts.slice(0, 6).map((a) => { const [l, c] = healthOf(a, posts); return <div key={a.id} className="row"><Ch platform={a.platform} size="" /><span className="grow sm">{a.account_name}</span><span className={`badge ${c}`}>{l}</span></div>; }) : <button type="button" className="btn btn-secondary btn-sm" onClick={() => goToTab("accounts")}>Connect a channel</button>}</div></div>
      </div>
    </div>
  </>;
}

export function Analytics({ posts, accounts }) {
  const [range, setRange] = useState(30);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const since = Date.now() - range * DAY;
  const inRange = posts.filter((p) => { const w = when(p); return w && new Date(w).getTime() >= since && new Date(w).getTime() <= Date.now() + DAY * 0; });
  const published = inRange.filter((p) => p.status === "published");
  const failed = inRange.filter((p) => p.status === "failed");
  const attempted = published.length + failed.length;
  const successRate = attempted ? Math.round((published.length / attempted) * 1000) / 10 : null;
  const prevStart = since - range * DAY;
  const prevPub = posts.filter((p) => p.status === "published" && p.published_at && new Date(p.published_at) >= prevStart && new Date(p.published_at) < since).length;
  const delta = prevPub ? Math.round(((published.length - prevPub) / prevPub) * 1000) / 10 : null;
  const byPlat = Object.entries(published.reduce((m, p) => { const pl = acc.get(p.connected_account_id)?.platform || "other"; m[pl] = (m[pl] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const maxPlat = Math.max(1, ...byPlat.map(([, n]) => n));
  const heat = useMemo(() => { const g = Array.from({ length: 5 }, () => Array(8).fill(0)); published.forEach((p) => { const d = new Date(p.published_at || p.scheduled_at); const wd = (d.getDay() + 6) % 7; const h = d.getHours(); if (wd < 5 && h >= 6 && h < 22) g[wd][Math.floor((h - 6) / 2)] += 1; }); return g; }, [published]);
  const heatMax = Math.max(1, ...heat.flat());
  const series = useMemo(() => { const n = Math.min(range, 90); const arr = Array.from({ length: n }, (_, i) => { const d = new Date(Date.now() - (n - 1 - i) * DAY); return { d, pub: 0, fail: 0 }; }); const idx = (w) => n - 1 - Math.floor((Date.now() - new Date(w)) / DAY); published.forEach((p) => { const i = idx(p.published_at || p.scheduled_at); if (arr[i]) arr[i].pub += 1; }); failed.forEach((p) => { const i = idx(p.scheduled_at); if (arr[i]) arr[i].fail += 1; }); return arr; }, [published, failed, range]);
  const sMax = Math.max(1, ...series.map((s) => s.pub + s.fail));
  const W = 800, H = 200;
  const pts = (k) => series.map((s, i) => `${(i / Math.max(1, series.length - 1)) * W},${H - (s[k] / sMax) * (H - 20)}`).join(" ");
  const recent = published.slice().sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0)).slice(0, 5);
  function exportCsv() {
    const rows = [["id", "channel", "account", "status", "scheduled_at", "published_at", "provider_post_id", "content"], ...inRange.map((p) => { const a = acc.get(p.connected_account_id); return [p.id, a?.platform || "", a?.account_name || "", p.status, p.scheduled_at || "", p.published_at || "", p.provider_post_id || "", (p.content || "").replace(/\s+/g, " ")]; })];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); const el = document.createElement("a"); el.href = url; el.download = `socialcastly-posts-${range}d.csv`; el.click(); URL.revokeObjectURL(url);
  }
  return <>
    <PageHead title="Analytics" sub="Publishing activity across your connected channels."><Seg value={range} onChange={setRange} options={[[7, "7d"], [30, "30d"], [90, "90d"]]} /><button type="button" className="btn btn-secondary" onClick={exportCsv} disabled={!inRange.length}>{I.download}Export CSV</button></PageHead>
    <div className="alert info sm">{I.alert}<div className="grow"><b>Reach and engagement aren't connected yet.</b> <span className="muted">These numbers come from your own publishing history. Impressions, engagements and clicks need provider insights APIs, which this workspace doesn't pull yet.</span></div></div>
    <div className="grid g4">
      <div className="card stat"><div className="sm muted">Posts published</div><div className="v">{published.length}</div><div className={`d ${delta == null ? "" : delta >= 0 ? "up" : "down"}`}>{delta == null ? `last ${range} days` : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs prior ${range}d`}</div></div>
      <div className="card stat"><div className="sm muted">Publish success rate</div><div className="v">{successRate == null ? "—" : `${successRate}%`}</div><div className="d">{attempted ? `${published.length} of ${attempted} attempts` : "No attempts yet"}</div></div>
      <div className="card stat"><div className="sm muted">Failed</div><div className="v">{failed.length}</div><div className={`d ${failed.length ? "down" : ""}`}>{failed.length ? "Check the queue" : "None"}</div></div>
      <div className="card stat"><div className="sm muted">Impressions</div><div className="v">—</div><div className="d">Not available</div></div>
    </div>
    <div className="card card-pad"><div className="row between"><h2>Publishing over time</h2><div className="legend"><span style={{ "--c": "var(--primary)" }}>Published</span><span style={{ "--c": "var(--error)" }}>Failed</span></div></div>
      {published.length + failed.length === 0 ? <div className="xs subtle" style={{ padding: "60px 0", textAlign: "center" }}>No published or failed posts in the last {range} days.</div> :
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 200, marginTop: 16 }}><polyline fill="none" stroke="var(--primary)" strokeWidth="2.5" points={pts("pub")} /><polyline fill="none" stroke="var(--error)" strokeWidth="2" strokeDasharray="4 4" points={pts("fail")} /></svg>}
    </div>
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr)", alignItems: "start" }}>
      <div className="card card-pad"><h2>By channel</h2><div className="col" style={{ marginTop: 14 }}>{byPlat.length ? byPlat.map(([pl, n]) => <div key={pl}><div className="row between sm"><span className="row"><Ch platform={pl} /><b>{meta(pl).label}</b></span><span className="muted">{n} post{n === 1 ? "" : "s"}</span></div><div className="progress" style={{ marginTop: 8 }}><i style={{ width: `${(n / maxPlat) * 100}%`, background: chColor(pl) }} /></div></div>) : <span className="sm muted">No published posts yet.</span>}</div>
        <h3 style={{ marginTop: 24 }}>When you publish</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 4, marginTop: 10 }}>{heat.flat().map((n, i) => <div key={i} title={`${["Mon", "Tue", "Wed", "Thu", "Fri"][Math.floor(i / 8)]} ${6 + (i % 8) * 2}:00 · ${n}`} style={{ height: 20, borderRadius: 4, background: `color-mix(in srgb,var(--primary) ${n ? 15 + (n / heatMax) * 70 : 0}%,var(--surface-2))` }} />)}</div>
        <div className="xs subtle" style={{ marginTop: 8 }}>Mon–Fri · 6 AM – 10 PM ({Intl.DateTimeFormat().resolvedOptions().timeZone}) · from your published posts</div>
      </div>
      <div className="card"><div className="card-head"><h2>Recently published</h2></div>
        {recent.length ? <table className="table"><thead><tr><th>Post</th><th>Published</th><th>Provider</th></tr></thead><tbody>{recent.map((p) => { const a = acc.get(p.connected_account_id); return <tr key={p.id}><td><div className="row">{p.media_urls?.[0] ? <img className="thumb" src={p.media_urls[0]} alt="" style={{ objectFit: "cover" }} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}<div><div className="sm">{postTitle(p)}</div><div className="row xs subtle" style={{ gap: 6 }}><Ch platform={a?.platform} />{a?.account_name}</div></div></div></td><td className="sm">{fmtDay(p.published_at)}</td><td>{p.provider_post_id ? <span className="badge b-success nodot">Confirmed</span> : <span className="badge b-warning nodot">Unconfirmed</span>}</td></tr>; })}</tbody></table> : <Empty art="📊" title="No published posts yet" text="Once posts go live, they'll show up here." />}
      </div>
    </div>
  </>;
}

const THEME_KEY = "social_studio_theme";
export function Settings({ tab = "profile", setTab, user, dark, setDark, accounts, posts, onLogout }) {
  const tabs = [["profile", "Profile"], ["billing", "Billing & plan"], ["notifications", "Notifications"]];
  return <>
    <PageHead title="Settings" sub="Manage your account and workspace preferences." />
    <Tabs value={tab} onChange={setTab} options={tabs} />
    {tab === "profile" && <Profile user={user} dark={dark} setDark={setDark} onLogout={onLogout} />}
    {tab === "billing" && <Billing accounts={accounts} posts={posts} />}
    {tab === "notifications" && <Notifications />}
  </>;
}

function Profile({ user, dark, setDark, onLogout }) {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem(THEME_KEY) || (dark ? "dark" : "light"); } catch { return dark ? "dark" : "light"; } });
  const pick = (m) => { setMode(m); const d = m === "system" ? window.matchMedia?.("(prefers-color-scheme: dark)").matches : m === "dark"; setDark(!!d); };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const opt = (m, label, bg) => <div key={m} role="button" className="card" onClick={() => pick(m)} style={{ padding: 10, cursor: "pointer", outline: mode === m ? "2px solid var(--primary)" : undefined }}><div style={{ height: 80, borderRadius: 8, background: bg, border: "1px solid var(--border)" }} /><div className="row sm" style={{ marginTop: 8 }}><span className={`check ${mode === m ? "on" : ""}`} style={{ borderRadius: "50%" }} />{label}</div></div>;
  return <div className="grid" style={{ gridTemplateColumns: "280px 1fr", gap: 32 }}>
    <div><h3>Personal info</h3><p className="sm muted">Shown to teammates on posts and approvals.</p></div>
    <div className="card card-pad col" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 14 }}><Avatar name={user?.full_name} size={64} /><div className="col" style={{ gap: 6 }}><b>{user?.full_name || "Workspace member"}</b><span className="xs subtle">Profile photos aren't supported yet</span></div></div>
      <div className="grid g2" style={{ gap: 16 }}>
        <div className="field"><label className="label">Full name</label><input className="input" value={user?.full_name || ""} readOnly /></div>
        <div className="field"><label className="label">Workspace</label><input className="input" value={user?.workspace_name || ""} readOnly /></div>
        <div className="field"><label className="label">Timezone</label><input className="input" value={tz} readOnly /><span className="hint">Detected from this browser. Used as the default for scheduling.</span></div>
        <div className="field"><label className="label">Language</label><input className="input" value="English" readOnly /></div>
      </div>
      <span className="xs subtle">Profile editing isn't available from the API yet, so these fields are read-only.</span>
    </div>
    <div><h3>Appearance</h3><p className="sm muted">Choose how SocialCastly looks to you.</p></div>
    <div className="grid g3" style={{ gap: 14 }}>{opt("light", "Light", "#F8FAFC")}{opt("dark", "Dark", "#0B1120")}{opt("system", "System", "linear-gradient(90deg,#F8FAFC 50%,#0B1120 50%)")}</div>
    <div><h3>Session</h3></div>
    <div className="card card-pad row between"><div><b>Sign out</b><div className="sm muted">End this session on this browser.</div></div><button type="button" className="btn btn-secondary" onClick={onLogout}>Sign out</button></div>
  </div>;
}

function Billing({ accounts, posts }) {
  const active = accounts.filter((a) => a.is_active !== false).length;
  const scheduled = posts.filter(isLive).length;
  const box = (label, val) => <div style={{ background: "rgba(255,255,255,.16)", borderRadius: 10, padding: 12 }}><div className="xs">{label}</div><b style={{ fontSize: 18 }}>{val}</b></div>;
  return <>
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", alignItems: "stretch" }}>
      <div className="card card-pad col" style={{ background: "linear-gradient(135deg,#4F46E5,#7C3AED)", color: "#fff", border: 0 }}>
        <div className="row between"><span className="badge nodot" style={{ background: "rgba(255,255,255,.2)", color: "#fff" }}>Current plan</span><span className="sm">No billing connected</span></div>
        <div><span style={{ fontSize: 36, fontWeight: 800 }}>Self-hosted</span><span> · no subscription</span></div>
        <div className="grid g3" style={{ gap: 12 }}>{box("Channels", active)}{box("Seats", 1)}{box("Scheduled", scheduled)}</div>
        <span className="xs" style={{ opacity: .85 }}>Usage is live from your workspace. Plans and upgrades aren't available in this build.</span>
      </div>
      <div className="card card-pad col"><h3>Payment method</h3><div className="row card" style={{ padding: 12, boxShadow: "none" }}><span className="badge nodot">—</span><div className="grow"><b className="sm">No card on file</b><div className="xs subtle">Billing isn't enabled</div></div></div><h3>Billing email</h3><span className="sm muted">Not set</span></div>
    </div>
    <div className="card"><div className="card-head"><h2>Invoices</h2></div><Empty art="🧾" title="No invoices" text="Invoices will appear here once billing is enabled." /></div>
  </>;
}

const NOTIF_KEY = "socialcastly_notification_prefs";
const NOTIF_ROWS = [["failed", "Post failed to publish", "When a network rejects a post or retries are exhausted"], ["published", "Post published", "Confirmation each time a post goes live"], ["approval_requested", "Approval requested", "A teammate submits a draft for your review"], ["approval_decision", "Approval decision", "Your draft is approved, rejected or needs changes"], ["reconnect", "Channel needs reconnecting", "Access token is expiring or revoked"], ["digest", "Weekly performance digest", "Every Monday at 9:00 AM"]];
function Notifications() {
  const [prefs, setPrefs] = useState(() => { try { return JSON.parse(localStorage.getItem(NOTIF_KEY)) || {}; } catch { return {}; } });
  const get = (k, c) => prefs[`${k}.${c}`] ?? (c !== "push" || k === "failed");
  const flip = (key) => setPrefs((p) => { const n = { ...p, [key]: !(p[key] ?? (key.endsWith(".push") ? key.startsWith("failed") : true)) }; try { localStorage.setItem(NOTIF_KEY, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const Tog = ({ k }) => { const on = k.includes(".") ? get(...k.split(".")) : (prefs[k] ?? false); return <span className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} tabIndex={0} onClick={() => flip(k)} style={{ cursor: "pointer" }} />; };
  return <>
    <div className="alert info sm">{I.alert}<div className="grow">Preferences are saved in this browser only — notification delivery isn't wired to the server yet.</div></div>
    <div className="card"><table className="table"><thead><tr><th>Event</th><th>Email</th><th>In-app</th><th>Push</th></tr></thead><tbody>{NOTIF_ROWS.map(([k, t, d]) => <tr key={k}><td><b className="sm">{t}</b><div className="xs subtle">{d}</div></td><td><Tog k={`${k}.email`} /></td><td><Tog k={`${k}.inapp`} /></td><td><Tog k={`${k}.push`} /></td></tr>)}</tbody></table></div>
    <div className="card card-pad row between"><div><b>Quiet hours</b><div className="sm muted">Pause push notifications 10:00 PM – 7:00 AM ({Intl.DateTimeFormat().resolvedOptions().timeZone})</div></div><Tog k="quiet" /></div>
  </>;
}

export function Team({ user, accounts }) {
  const plats = [...new Set(accounts.map((a) => a.platform))];
  return <>
    <PageHead title="Team" sub="Invite teammates and control what they can do."><button type="button" className="btn btn-primary" disabled title="Team invites aren't available yet">{I.plus}Invite member</button></PageHead>
    <div className="grid g3">
      <div className="card card-pad"><div className="row"><span className="badge b-primary nodot">Admin</span><span className="xs subtle grow">1 member</span></div><p className="sm muted" style={{ marginTop: 10 }}>Full access, billing, channels and team management.</p></div>
      <div className="card card-pad"><div className="row"><span className="badge b-info nodot">Editor</span><span className="xs subtle grow">0 members</span></div><p className="sm muted" style={{ marginTop: 10 }}>Create, schedule and approve posts on all channels.</p></div>
      <div className="card card-pad"><div className="row"><span className="badge nodot">Contributor</span><span className="xs subtle grow">0 members</span></div><p className="sm muted" style={{ marginTop: 10 }}>Draft posts and submit them for approval.</p></div>
    </div>
    <div className="card"><table className="table"><thead><tr><th>Member</th><th>Role</th><th>Channels</th><th>Last active</th></tr></thead><tbody>
      <tr><td><div className="row"><Avatar name={user?.full_name} size={32} /><div><b className="sm">{user?.full_name || "You"} (you)</b><div className="xs subtle">{user?.workspace_name}</div></div></div></td><td><span className="badge b-primary nodot">Admin</span></td><td><div className="row" style={{ gap: 4 }}>{plats.length ? plats.map((p) => <Ch key={p} platform={p} />) : <span className="xs subtle">—</span>}</div></td><td className="sm muted">Now</td></tr>
    </tbody></table><div className="card-pad xs subtle" style={{ borderTop: "1px solid var(--border)" }}>Multi-member workspaces aren't supported by the backend yet. Invites will appear here when they are.</div></div>
  </>;
}

export function MediaLibrary({ request, onUseAsset }) {
  const [assets, setAssets] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [kind, setKind] = useState("all"); const [sel, setSel] = useState(""); const [busy, setBusy] = useState(false); const [over, setOver] = useState(false);
  const input = useRef(null);
  async function load() { setLoading(true); try { const r = await request("/publish/library"); setAssets(Array.isArray(r) ? r : []); setError(""); } catch (e) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, [request]);
  async function upload(files) { const list = [...(files || [])]; if (!list.length) return; setBusy(true); setError(""); try { for (const f of list) { const body = new FormData(); body.append("file", f); await request("/upload", { method: "POST", body }); } await load(); } catch (e) { setError(e.message || "Upload failed."); } finally { setBusy(false); } }
  const isVid = (a) => String(a.media_type || "").startsWith("video");
  const shown = assets.filter((a) => kind === "all" || (kind === "video" ? isVid(a) : !isVid(a)));
  const total = assets.reduce((s, a) => s + (a.size_bytes || 0), 0);
  const size = (b) => b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
  const selected = assets.find((a) => a.id === sel);
  return <>
    <PageHead title="Media library" sub="Images and videos ready to use in posts.">
      <button type="button" className="btn btn-secondary" disabled={!selected} onClick={() => selected && onUseAsset?.(selected)}>{selected ? "1 selected · Use in post" : "Select to use in post"}</button>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>{I.upload}{busy ? "Uploading…" : "Upload"}</button>
      <input ref={input} type="file" multiple accept="image/*,video/*" hidden onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
    </PageHead>
    <div className="row between wrap"><Seg value={kind} onChange={setKind} options={[["all", `All · ${assets.length}`], ["image", "Images"], ["video", "Videos"]]} /><div className="row sm subtle" style={{ gap: 10 }}>{size(total)} used</div></div>
    <div className={`dropzone`} style={over ? { borderColor: "var(--primary)", background: "var(--primary-soft)" } : null} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files); }} role="button">{I.upload}<div><b>Drag files here to upload</b><div className="sm muted">PNG, JPG, GIF, MP4</div></div></div>
    {error && <div role="alert" className="alert error sm">{error}</div>}
    {loading ? <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 14 }}>{Array.from({ length: 6 }, (_, i) => <div key={i} className="skel" style={{ aspectRatio: "1" }} />)}</div> : shown.length ? <div className="grid media-grid" style={{ gridTemplateColumns: "repeat(6,1fr)", gap: 14 }}>
      {shown.map((a) => <div key={a.id} className="card" role="button" onClick={() => setSel(sel === a.id ? "" : a.id)} onDoubleClick={() => onUseAsset?.(a)} style={{ overflow: "hidden", cursor: "pointer", ...(sel === a.id ? { outline: "2px solid var(--primary)", outlineOffset: 2 } : null) }}>
        <div style={{ aspectRatio: "1", position: "relative", background: "var(--surface-2)" }}>{isVid(a) ? <video src={a.public_url} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <img src={a.public_url} alt={a.alt_text || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}{sel === a.id && <span className="check on" style={{ position: "absolute", top: 8, left: 8 }} />}{isVid(a) && <span className="badge nodot" style={{ position: "absolute", bottom: 8, left: 8 }}>▶ Video</span>}</div>
        <div style={{ padding: "8px 10px" }}><div className="xs" style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.filename}</div><div className="xs subtle">{size(a.size_bytes || 0)}</div></div>
      </div>)}
    </div> : <div className="card"><Empty art="🖼️" title="No media yet" text="Upload images or videos to reuse them across posts." action="Upload" onAction={() => input.current?.click()} /></div>}
  </>;
}

export function Onboarding({ accounts, connect, goToTab, connectable = [], dark }) {
  const rows = ["x", "linkedin", "instagram", "facebook", "tiktok", "youtube", "pinterest", "threads"];
  const live = rows.filter((p) => connectable.includes(p)); const soon = rows.filter((p) => !connectable.includes(p) && PLATFORM_META[p]);
  const step = (label, state) => <div style={{ flex: 1 }}><div style={{ height: 4, borderRadius: 4, background: state ? "var(--primary)" : "var(--surface-3)" }} /><div className="xs" style={{ marginTop: 8, color: state === "cur" ? "var(--primary)" : "var(--text-3)", fontWeight: 600 }}>{label}</div></div>;
  const desc = { x: "Text posts & threads", linkedin: "Personal profile or company page", instagram: "Business or creator account", facebook: "Pages", youtube: "Channel uploads", tiktok: "Creator account", pinterest: "Boards & pins", threads: "Text posts" };
  return <div style={{ maxWidth: 720, margin: "0 auto", width: "100%", padding: "8px 0 32px" }} className="col">
    <div className="row between"><img src={dark ? lockupDark : lockupLight} alt="SocialCastly" style={{ height: 30 }} /><a className="sm muted" role="button" style={{ cursor: "pointer" }} onClick={() => goToTab("home")}>Skip for now</a></div>
    <div className="row" style={{ gap: 8, margin: "24px 0 8px" }}>{step("Step 1 · Workspace", "done")}{step("Step 2 · Connect channels", "cur")}{step("Step 3 · Invite team", "")}{step("Step 4 · First post", "")}</div>
    <h1 style={{ marginTop: 24, fontSize: 32 }}>Connect your channels</h1><p className="muted" style={{ fontSize: 16 }}>Choose where you want to publish. You can add more anytime from Channels.</p>
    <div className="col" style={{ gap: 12, marginTop: 8 }}>{live.map((p) => { const conn = accounts.filter((a) => a.platform === p); return <div key={p} className="card row" style={{ padding: 16, gap: 14 }}><Ch platform={p} size="lg" /><div className="grow"><b>{meta(p).label}</b><div className="xs muted">{desc[p]}{conn[0] ? ` · ${conn[0].account_name}` : ""}</div></div>{conn.length ? <span className="badge b-success">Connected</span> : <button type="button" className="btn btn-primary btn-sm" onClick={() => connect(p)}>Connect</button>}</div>; })}</div>
    {soon.length > 0 && <><p className="sm subtle" style={{ marginTop: 12 }}>More networks on the way</p><div className="grid g2" style={{ gap: 12 }}>{soon.map((p) => <div key={p} className="card row" style={{ padding: 16, gap: 14, opacity: .7 }}><Ch platform={p} size="lg" /><div className="grow"><b>{meta(p).label}</b><div className="xs muted">Coming soon</div></div><span className="badge nodot">Coming soon</span></div>)}</div></>}
    <div className="alert info" style={{ marginTop: 12 }}>{I.lock}<div className="sm"><b>Your tokens are encrypted at rest.</b> <span className="muted">We never post outside your schedule or approvals, and you can disconnect at any time.</span></div></div>
    <div className="row between" style={{ marginTop: 12 }}><button type="button" className="btn btn-ghost" onClick={() => goToTab("home")}>Back</button><button type="button" className="btn btn-primary btn-lg" onClick={() => goToTab("studio")}>Continue{I.arrow}</button></div>
  </div>;
}

export function States({ goToTab }) {
  const toast = (c, t, d) => <div className="toast" style={{ position: "static", boxShadow: "none" }}><span className="bar" style={{ background: c }} /><div className="grow"><b className="sm">{t}</b><div className="xs muted">{d}</div></div><span className="muted">✕</span></div>;
  return <>
    <PageHead title="States" sub="Empty, loading, error and feedback patterns used across the app." />
    <div className="grid g3">
      <div className="card"><div className="card-head"><h3>Empty · Queue</h3></div><div className="empty"><div className="art"><img src={markPng} alt="" style={{ width: 56 }} /></div><h2>Your queue is empty</h2><p className="muted sm">Schedule your first post and it'll appear here, ready to cast.</p><button type="button" className="btn btn-primary" onClick={() => goToTab("studio")}>{I.plus}Create a post</button></div></div>
      <div className="card"><div className="card-head"><h3>Loading · Skeleton</h3></div>{[0, 1, 2].map((i) => <div key={i} className="post"><div className="skel" style={{ width: 44, height: 28 }} /><div className="skel" style={{ width: 36, height: 36, borderRadius: "50%" }} /><div className="body col" style={{ gap: 6 }}><div className="skel" style={{ height: 10, width: "40%" }} /><div className="skel" style={{ height: 10, width: "90%" }} /><div className="skel" style={{ height: 10, width: "70%" }} /></div></div>)}</div>
      <div className="card"><div className="card-head"><h3>Error · Failed load</h3></div><div className="empty"><div className="art" style={{ color: "var(--error)" }}>{I.alert}</div><h2>We couldn't load your calendar</h2><p className="muted sm">The server didn't respond (503). Your scheduled posts are safe.</p><div className="row"><button type="button" className="btn btn-secondary">Contact support</button><button type="button" className="btn btn-primary">{I.retry}Try again</button></div></div></div>
    </div>
    <div className="grid g2">
      <div className="card card-pad col"><h3>Toasts</h3>{toast("var(--success)", "3 posts scheduled", "Thu, Oct 29 at 9:00 AM · Undo")}{toast("var(--error)", "Couldn't publish to X", "Rate limit reached. Retrying in 12 min.")}{toast("var(--warning)", "Instagram needs reconnecting", "Access expires in 5 days.")}{toast("var(--info)", "Draft saved", "Autosaved just now")}</div>
      <div className="card"><div className="card-pad"><h3>Confirm modal</h3></div><div className="modal-wrap" style={{ position: "relative", inset: "auto", minHeight: 260, borderRadius: "0 0 12px 12px" }}><div className="modal" style={{ padding: 20 }}><div className="col"><div style={{ color: "var(--error)" }}>{I.alert}</div><h2>Disconnect @acmestudio?</h2><p className="sm muted">4 scheduled posts for this X account will move to drafts. You can reconnect anytime.</p></div><div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}><button type="button" className="btn btn-secondary">Cancel</button><button type="button" className="btn btn-danger">Disconnect</button></div></div></div></div>
    </div>
  </>;
}
