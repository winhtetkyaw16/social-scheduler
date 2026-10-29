import React, { useEffect, useMemo, useState } from "react";
import { Ch, meta, chColor, Seg, Tabs, PageHead, Avatar, Empty, StatusBadge, fmtTime, fmtTime24, fmtDay, postTitle, AccountAvatar as ScAccountAvatar } from "./sc/ui.jsx";
import { createPortal } from "react-dom";
import RenderErrorBoundary from "./RenderErrorBoundary.jsx";
import { AccountAvatar } from "./ManageAccounts.jsx";
import {
  Archive, ArrowLeft, ArrowRight, Bookmark, CalendarDays, Check, Clock3, Copy, FileText, Filter, Heart, Image, LayoutGrid, List, RotateCcw,
  Instagram, Linkedin, LoaderCircle, MessageCircle, MessageSquareText, MoreHorizontal, Pencil, Play, Plus, Send, Share2,
  Search, ShieldCheck, Tag, ThumbsUp, Timer, Trash2, UploadCloud, Video, X,
  Youtube,
} from "lucide-react";

const PREVIEW_CHANNELS = {
  facebook: { label: "Facebook", brand: "#1877F2", mark: "f" },
  youtube: { label: "YouTube", brand: "#FF0033", mark: "▶" },
  tiktok: { label: "TikTok", brand: "#111827", mark: "♪" },
  instagram: { label: "Instagram", brand: "#D94687", mark: "◎" },
  x: { label: "X", brand: "#111827", mark: "𝕏" },
  twitter: { label: "X", brand: "#111827", mark: "𝕏" },
  linkedin: { label: "LinkedIn", brand: "#0A66C2", mark: "in" },
  pinterest: { label: "Pinterest", brand: "#BD081C", mark: "p" },
};

function ModalChannelIcon({ platform, mark, size = 17 }) {
  const Icon = { instagram: Instagram, linkedin: Linkedin, youtube: Youtube }[platform];
  return Icon ? <Icon size={size} /> : <span className="inline-grid min-w-[17px] place-items-center font-extrabold leading-none" style={{ fontSize: platform === "x" ? size : size - 2 }}>{mark}</span>;
}

const TABS = [
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "posts", label: "Posts", icon: List },
  { id: "queue", label: "Queue", icon: Timer },
  { id: "drafts", label: "Drafts", icon: FileText },
  { id: "library", label: "Content library", icon: Image },
  { id: "approvals", label: "Approvals", icon: Check },
];
const STATUS_FILTERS = [
  { id: "all", label: "All statuses" },
  { id: "scheduled", label: "Scheduled" },
  { id: "draft", label: "Draft" },
  { id: "failed", label: "Failed" },
  { id: "published", label: "Published" },
];

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEFAULT_QUEUE_SLOTS = [
  ...[0, 1, 2, 3, 4].flatMap((weekday) => ["09:00", "12:30", "17:00"].map((time_local) => ({ weekday, time_local }))),
  ...[5, 6].flatMap((weekday) => ["10:00", "16:00"].map((time_local) => ({ weekday, time_local }))),
];
const card = "rounded-3xl border border-slate-200/80 bg-white/85 shadow-[0_12px_36px_rgba(21,32,66,.045)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80";
const button = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800";
const primary = "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:shadow-indigo-500/30 disabled:opacity-50";

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}


function postPlacementAt(post) {
  return post?.scheduled_at || post?.published_at || post?.created_at || null;
}

function statusMatchesFilter(status, filter) {
  if (!filter || filter === "all") return true;
  if (filter === "scheduled") return ["scheduled", "queued", "publishing"].includes(status);
  return status === filter;
}

function filterPublishPosts(posts, accounts, { status = "all", platform = "all", accountId = "all" } = {}) {
  const accountMap = new Map((Array.isArray(accounts) ? accounts : []).map((account) => [account.id, account]));
  return (Array.isArray(posts) ? posts : []).filter((post) => {
    if (!post || post.status === "archived") return false;
    if (!statusMatchesFilter(post.status, status)) return false;
    if (accountId !== "all" && String(post.connected_account_id) !== String(accountId)) return false;
    if (platform !== "all") {
      const account = accountMap.get(post.connected_account_id);
      if (!account || account.platform !== platform) return false;
    }
    return true;
  });
}

function statusChipClass(status) {
  if (status === "failed") return "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200";
  if (status === "published") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200";
  if (status === "draft") return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  if (status === "queued" || status === "publishing") return "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200";
  return "bg-purple-100 text-purple-800 dark:bg-purple-900/70 dark:text-purple-200";
}

function PublishFilterBar({ accounts = [], status, setStatus, platform, setPlatform, accountId, setAccountId, counts = {} }) {
  const platforms = [...new Set((Array.isArray(accounts) ? accounts : []).map((account) => account.platform).filter(Boolean))].sort();
  const accountOptions = (Array.isArray(accounts) ? accounts : []).filter((account) => platform === "all" || account.platform === platform);
  return <div className="row wrap" style={{ gap: 8 }}>
    {typeof counts.total === "number" && <span className="xs subtle">{counts.total} shown{counts.failed ? ` · ${counts.failed} failed` : ""}</span>}
    <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)} className="select" style={{ height: 32, width: "auto", fontSize: 13 }}>
      {STATUS_FILTERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
    {setPlatform && <select aria-label="Channel" value={platform} onChange={(event) => { setPlatform(event.target.value); setAccountId("all"); }} className="select" style={{ height: 32, width: "auto", fontSize: 13, textTransform: "capitalize" }}>
      <option value="all">All channels</option>
      {platforms.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>}
    <select aria-label="Account" value={accountId} onChange={(event) => setAccountId(event.target.value)} className="select" style={{ height: 32, width: "auto", fontSize: 13 }}>
      <option value="all">All accounts</option>
      {accountOptions.map((account) => <option key={account.id} value={account.id}>{account.account_name || account.platform}</option>)}
    </select>
    {(status !== "all" || platform !== "all" || accountId !== "all") && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStatus("all"); setPlatform?.("all"); setAccountId("all"); }}>Clear</button>}
  </div>;
}

function PostsListView({ posts, accounts = [], request, onSelectPost, onRefresh, status, setStatus, platform, setPlatform, accountId, setAccountId, headerExtra = null }) {
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  const filtered = useMemo(
    () => filterPublishPosts(posts, safeAccounts, { status, platform, accountId })
      .slice()
      .sort((a, b) => new Date(postPlacementAt(b) || 0) - new Date(postPlacementAt(a) || 0)),
    [posts, safeAccounts, status, platform, accountId],
  );
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const failedCount = filtered.filter((post) => post.status === "failed").length;

  async function retryPost(postId) {
    setBusyId(postId);
    setError("");
    try {
      await request(`/posts/${postId}/retry`, { method: "POST" });
      await onRefresh?.();
    } catch (err) {
      setError(err.message || "Could not retry that post.");
    } finally {
      setBusyId("");
    }
  }

  return <div className="col" style={{ gap: 16 }}>
    <div className="row between wrap"><PublishFilterBar accounts={safeAccounts} status={status} setStatus={setStatus} platform={platform} setPlatform={setPlatform} accountId={accountId} setAccountId={setAccountId} counts={{ total: filtered.length, failed: failedCount }} />{headerExtra}</div>
    {error && <div role="alert" className="alert error sm">{error}</div>}
    <div className="card">
      <div className="card-head"><h3>All posts</h3><span className="xs subtle">Failed publishes show the provider error. Retry queues them again.</span></div>
      {filtered.length === 0 ? <Empty title="No matching posts" text="Try another status, channel, or account filter." /> : filtered.map((post) => {
        const account = safeAccounts.find((item) => item.id === post.connected_account_id);
        const when = postPlacementAt(post);
        const failed = post.status === "failed";
        return <div key={post.id} className="post">
          <div className="time">{when ? fmtTime(when).replace(/\s?(AM|PM)/i, "") : "—"}<span>{when ? `${(fmtTime(when).match(/AM|PM/i) || [""])[0]} · ${new Date(when).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}</span></div>
          <ScAccountAvatar account={account} size={36} />
          <div className="body">
            <div className="row" style={{ gap: 8, marginBottom: 4 }}><b className="sm">{account?.account_name || account?.platform || "Account"}</b><StatusBadge status={post.status} post={post} /></div>
            <div className="txt">{post.content || "Untitled post"}</div>
            {failed && (post.last_error_message || post.last_error_code) && <div className="xs" style={{ color: "var(--error)", marginTop: 6 }} title={post.last_error_message || post.last_error_code}>⚠ {post.last_error_code ? `${post.last_error_code}: ` : ""}{post.last_error_message || "Publish failed"}</div>}
          </div>
          {post.media_urls?.[0] && <img className="thumb" src={post.media_urls[0]} alt="" style={{ objectFit: "cover" }} />}
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onSelectPost?.(post)}>Open</button>
            {failed && <button type="button" className="btn btn-sm btn-secondary" disabled={!!busyId} onClick={() => void retryPost(post.id)}>{busyId === post.id ? <LoaderCircle size={13} className="animate-spin" /> : <RotateCcw size={13} />}Retry</button>}
          </div>
        </div>;
      })}
    </div>
  </div>;
}

function MonthCalendar({ posts, accounts = [], onCreatePost, onSelectPost, request, onRefresh, onList, platformFilter = "all", setPlatformFilter, filters = null, initialView = "month" }) {
  const safePosts = Array.isArray(posts) ? posts.filter(Boolean) : [];
  const [view, setView] = useState(initialView);
  const [cursor, setCursor] = useState(() => new Date());
  const [dragOverKey, setDragOverKey] = useState("");
  const [draggingId, setDraggingId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [dayDetail, setDayDetail] = useState(null);
  const dates = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    if (view === "month") start.setDate(first.getDate() - first.getDay());
    else start.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
    const count = view === "month" ? 42 : 7;
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [cursor, view]);
  const accountById = useMemo(() => new Map((Array.isArray(accounts) ? accounts : []).map((account) => [account.id, account])), [accounts]);
  const grouped = useMemo(() => safePosts.reduce((map, post) => {
    const when = postPlacementAt(post);
    if (!when) return map;
    const key = dateKey(when);
    map.set(key, [...(map.get(key) || []), post]);
    return map;
  }, new Map()), [safePosts]);
  const label = view === "week"
    ? (() => {
      const start = dates[0];
      const end = dates[dates.length - 1];
      const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
      return `${fmt.format(start)} – ${fmt.format(end)}, ${end.getFullYear()}`;
    })()
    : new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(cursor);
  const postLimit = view === "week" ? 12 : 2;

  function step(amount) {
    setCursor((current) => {
      const next = new Date(current);
      if (view === "month") next.setMonth(next.getMonth() + amount, 1);
      else next.setDate(next.getDate() + amount * 7);
      return next;
    });
  }

  function canDragPost(post) {
    return post && ["draft", "scheduled"].includes(post.status);
  }

  function siblingPosts(post) {
    if (!post || typeof post !== "object") return [];
    return safePosts.filter((candidate) => candidate
      && candidate.content === post.content
      && new Date(candidate.scheduled_at).getTime() === new Date(post.scheduled_at).getTime()
      && JSON.stringify(candidate.media_urls || []) === JSON.stringify(post.media_urls || [])
      && canDragPost(candidate));
  }

  function scheduledAtOnDay(sourceIso, targetDate) {
    const source = new Date(sourceIso);
    const next = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds());
    return next.toISOString();
  }

  async function reschedulePostGroup(post, targetDate) {
    if (!request || !post || !canDragPost(post)) return;
    const targetKey = dateKey(targetDate);
    if (dateKey(post.scheduled_at) === targetKey) return;
    const group = siblingPosts(post);
    const targets = group.length ? group : [post];
    setBusyId(String(post.id));
    setError("");
    try {
      for (const item of targets) {
        const scheduled_at = scheduledAtOnDay(item.scheduled_at, targetDate);
        await request(`/posts/${item.id}`, { method: "PATCH", body: JSON.stringify({ scheduled_at }) });
      }
      await onRefresh?.();
    } catch (e) {
      setError(e?.message || "Could not reschedule that post.");
    } finally {
      setBusyId("");
      setDraggingId("");
      setDragOverKey("");
    }
  }

  function openComposerForDay(date) {
    onCreatePost?.(date instanceof Date ? date : undefined);
  }

  useEffect(() => {
    if (!(dayDetail instanceof Date)) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event) { if (event.key === "Escape" && !busyId) setDayDetail(null); }
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [dayDetail, busyId]);

  function dropProps(date, key) {
    return {
      onDragOver: (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (dragOverKey !== key) setDragOverKey(key); },
      onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOverKey((current) => current === key ? "" : current); },
      onDrop: (event) => {
        event.preventDefault();
        const raw = event.dataTransfer.getData("application/x-socialstudio-post") || event.dataTransfer.getData("text/plain");
        let payload = null;
        try { payload = JSON.parse(raw); } catch { payload = null; }
        const post = safePosts.find((item) => String(item.id) === String(payload?.id || raw));
        setDragOverKey("");
        if (post) void reschedulePostGroup(post, date);
      },
    };
  }
  function dragProps(post) {
    const draggable = canDragPost(post);
    return {
      draggable: draggable && !busyId,
      onDragStart: (event) => {
        if (!draggable) { event.preventDefault(); return; }
        setDraggingId(String(post.id)); setError("");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-socialstudio-post", JSON.stringify({ id: post.id }));
        event.dataTransfer.setData("text/plain", String(post.id));
      },
      onDragEnd: () => { setDraggingId(""); setDragOverKey(""); },
      onClick: (event) => { event.stopPropagation(); onSelectPost?.(post); },
    };
  }
  const platformsInUse = [...new Set((Array.isArray(accounts) ? accounts : []).filter((a) => a?.is_active !== false).map((a) => a.platform).filter(Boolean))];
  const todayKey = dateKey(new Date());
  const sortedFor = (key) => (grouped.get(key) || []).slice().sort((a, b) => new Date(postPlacementAt(a) || 0) - new Date(postPlacementAt(b) || 0));
  const weekHours = (() => {
    if (view !== "week") return [];
    let lo = 8, hi = 18;
    dates.forEach((d) => sortedFor(dateKey(d)).forEach((p) => { const h = new Date(postPlacementAt(p)).getHours(); lo = Math.min(lo, h); hi = Math.max(hi, h); }));
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  })();
  const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;

  return <div className="col" style={{ gap: 16 }}>
    <div className="row between wrap" style={{ gap: 12 }}>
      <div className="row">
        <button type="button" className="btn btn-secondary btn-icon btn-sm" aria-label="Previous" onClick={() => step(-1)}><svg className="ico" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></button>
        <button type="button" className="btn btn-secondary btn-icon btn-sm" aria-label="Next" onClick={() => step(1)}><svg className="ico" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg></button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCursor(new Date())}>Today</button>
        <h2 style={{ marginLeft: 6 }}>{label}</h2>
      </div>
      <div className="row wrap">
        {filters}
        <div className="row sm muted" style={{ gap: 6 }}>Channels {platformsInUse.length ? platformsInUse.map((p) => <button type="button" key={p} onClick={() => setPlatformFilter?.(platformFilter === p ? "all" : p)} title={`Show only ${p}`} style={{ background: "none", border: 0, padding: 0, opacity: platformFilter === "all" || platformFilter === p ? 1 : .35 }}><Ch platform={p} /></button>) : <span className="xs subtle">none connected</span>}</div>
        <Seg value={view} onChange={(v) => v === "list" ? onList?.() : setView(v)} options={[["month", "Month"], ["week", "Week"], ["list", "List"]]} />
      </div>
    </div>
    {error && <div role="alert" className="alert error sm">{error}</div>}
    {view === "month" ? <div className="cal">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="dow">{d}</div>)}
      {dates.map((date) => {
        const key = dateKey(date);
        const dayPosts = sortedFor(key);
        const out = date.getMonth() !== cursor.getMonth();
        return <div key={key} data-day={key} {...dropProps(date, key)} onClick={() => openComposerForDay(date)} title={`Create post on ${key}`}
          className={`cell ${out ? "out" : ""} ${key === todayKey ? "today" : ""}`} style={{ cursor: "pointer", ...(dragOverKey === key ? { boxShadow: "inset 0 0 0 2px var(--primary)", background: "var(--primary-soft)" } : null) }}>
          <span className="n">{date.getDate()}</span>
          {dayPosts.slice(0, postLimit).map((post) => {
            const account = accountById.get(post.connected_account_id);
            const m = meta(account?.platform);
            return <div key={post.id} role="button" tabIndex={0} {...dragProps(post)} onKeyDown={(e) => { if (e.key === "Enter") onSelectPost?.(post); }}
              aria-label={`Open post: ${post.content || "Untitled post"}`}
              className={`chip ${m.chip} ${post.status === "failed" ? "failed" : ""}`}
              style={{ cursor: canDragPost(post) ? "grab" : "pointer", opacity: draggingId === String(post.id) || busyId === String(post.id) ? .5 : 1, ...(m.chip ? null : { borderColor: chColor(account?.platform) }) }}
              title={`${account?.account_name || ""} · ${post.status}`}><b>{fmtTime24(postPlacementAt(post))}</b>{postTitle(post)}</div>;
          })}
          {dayPosts.length > postLimit && <span role="button" className="xs subtle" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); setDayDetail(date); }}>+{dayPosts.length - postLimit} more</span>}
        </div>;
      })}
    </div> : <div className="week">
      <div className="h"></div>
      {dates.map((d) => <div key={dateKey(d)} className="h"><div className="xs subtle">{d.toLocaleDateString(undefined, { weekday: "short" })}</div><div style={{ fontWeight: 700, fontSize: 18, color: dateKey(d) === todayKey ? "var(--primary)" : undefined }}>{d.getDate()}</div></div>)}
      {weekHours.map((h) => <React.Fragment key={h}>
        <div className="t">{hourLabel(h)}</div>
        {dates.map((d) => {
          const key = dateKey(d);
          const slotKey = `${key}-${h}`;
          const inHour = sortedFor(key).filter((p) => new Date(postPlacementAt(p)).getHours() === h);
          const isToday = key === todayKey;
          const slotDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0);
          return <div key={slotKey} className="s" {...dropProps(d, slotKey)} onClick={() => openComposerForDay(slotDate)} style={{ cursor: "pointer", background: dragOverKey === slotKey ? "var(--primary-soft)" : isToday ? "color-mix(in srgb,var(--primary) 4%,transparent)" : undefined }}>
            {inHour.slice(0, 1).map((post) => {
              const account = accountById.get(post.connected_account_id);
              const m = meta(account?.platform);
              return <div key={post.id} role="button" tabIndex={0} {...dragProps(post)} className={`ev ${m.ev}`} style={{ cursor: canDragPost(post) ? "grab" : "pointer", ...(post.status === "failed" ? { background: "var(--error-soft)", borderColor: "var(--error)" } : null), ...(m.ev ? null : { borderColor: chColor(account?.platform) }) }}>
                <div className="row" style={{ gap: 6 }}><Ch platform={account?.platform} /><b>{fmtTime24(postPlacementAt(post))}</b>{inHour.length > 1 && <span className="xs subtle" role="button" onClick={(e) => { e.stopPropagation(); setDayDetail(d); }}>+{inHour.length - 1}</span>}</div>{postTitle(post)}</div>;
            })}
          </div>;
        })}
      </React.Fragment>)}
    </div>}
    <p className="xs subtle">Click a day to compose · drag a post to another day to reschedule · click a post to open it</p>
    {dayDetail instanceof Date && (() => {
      const detailKey = dateKey(dayDetail);
      const detailPosts = (grouped.get(detailKey) || []).slice().sort((a, b) => new Date(postPlacementAt(a) || 0) - new Date(postPlacementAt(b) || 0));
      const detailLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(dayDetail);
      function closeDayDetail() { setDayDetail(null); }
      return createPortal(<div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/25 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) closeDayDetail(); }} role="presentation">
        <section role="dialog" aria-modal="true" aria-labelledby="day-detail-title" className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] border border-white/70 bg-white text-slate-900 shadow-[0_32px_100px_rgba(15,23,42,.20)] dark:border-slate-700 dark:bg-slate-900 dark:text-white sm:rounded-[28px]">
          <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6">
            <div className="min-w-0">
              <span className="text-[10px] font-extrabold uppercase tracking-[.16em] text-indigo-500">Day schedule</span>
              <h2 id="day-detail-title" className="mt-1  text-lg font-extrabold">{detailLabel}</h2>
              <p className="mt-1 text-xs text-slate-500">{detailPosts.length} post{detailPosts.length === 1 ? "" : "s"} · click one to open</p>
            </div>
            <button type="button" onClick={closeDayDetail} aria-label="Close day schedule" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"><X size={18} /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {detailPosts.length ? <ul className="space-y-2">
              {detailPosts.map((post) => {
                const account = accountById.get(post.connected_account_id);
                const when = postPlacementAt(post);
                const failed = post.status === "failed";
                const draggable = canDragPost(post);
                const isBusy = busyId === String(post.id);
                return <li key={post.id}>
                  <button
                    type="button"
                    draggable={draggable && !busyId}
                    onDragStart={(event) => {
                      if (!draggable) { event.preventDefault(); return; }
                      setDraggingId(String(post.id));
                      setError("");
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("application/x-socialstudio-post", JSON.stringify({ id: post.id }));
                      event.dataTransfer.setData("text/plain", String(post.id));
                    }}
                    onDragEnd={() => { setDraggingId(""); setDragOverKey(""); }}
                    onClick={() => { closeDayDetail(); onSelectPost?.(post); }}
                    className={`flex w-full gap-3 rounded-2xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${failed ? "border-rose-300 bg-rose-50/90 dark:border-rose-800 dark:bg-rose-950/40" : "border-slate-200 bg-white hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-indigo-700"} ${isBusy ? "opacity-70" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                  >
                    {post.media_urls?.[0] ? <img src={post.media_urls[0]} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" loading="lazy" /> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800"><FileText size={18} /></span>}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold"><Clock3 size={11} />{when ? new Date(when).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}</span>
                        <span className="truncate text-[11px] font-semibold capitalize text-slate-500">{account?.account_name || account?.platform || "Account"}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${statusChipClass(post.status)}`}>{post.status === "published" && post.provider_post_id ? "published" : post.status === "published" ? "unconfirmed" : post.status}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-800 dark:text-slate-100">{post.content || "Untitled post"}</p>
                      {failed && post.last_error_message && <p className="mt-1 line-clamp-2 text-[10px] font-semibold text-rose-700 dark:text-rose-300">{post.last_error_message}</p>}
                    </div>
                  </button>
                </li>;
              })}
            </ul> : <p className="py-10 text-center text-xs text-slate-400">No posts on this day.</p>}
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800 sm:px-6">
            <button type="button" className={button} onClick={closeDayDetail}>Close</button>
            <button type="button" className={primary} onClick={() => { const date = dayDetail; closeDayDetail(); openComposerForDay(date); }}><Plus size={14} />Create on this day</button>
          </footer>
        </section>
      </div>, document.body);
    })()}
  </div>;
}

function DraftsView({ request, accounts = [], authorName, onCreatePost, onOpenDraft, onRefresh, localDrafts = [], onUpdateLocalDraft, onRemoveLocalDraft }) {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scheduleFor, setScheduleFor] = useState(null);
  const [scheduleValue, setScheduleValue] = useState("");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const result = await request("/publish/drafts");
      setDrafts(Array.isArray(result) ? result.filter(Boolean) : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [request]);

  const visibleDrafts = [...(Array.isArray(localDrafts) ? localDrafts : []), ...drafts];

  function accountSummary(draft) {
    const meta = draft?.metadata_json && typeof draft.metadata_json === "object" ? draft.metadata_json : (draft?.metadata || {});
    const ids = Array.isArray(meta.selectedIds) ? meta.selectedIds : [];
    const names = ids.map((id) => accounts.find((account) => account.id === id)?.account_name || accounts.find((account) => account.id === id)?.platform).filter(Boolean);
    if (!names.length) return "No channels selected yet";
    return names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
  }

  async function createDraft() {
    setBusyId("new");
    setError("");
    try {
      const draft = await request("/publish/drafts", { method: "POST", body: JSON.stringify({ content: "", post_format: "Post" }) });
      await refresh();
      onOpenDraft?.(draft);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId("");
    }
  }

  async function removeDraft(id) {
    if (!window.confirm("Delete this draft permanently?")) return;
    setBusyId(id);
    setError("");
    try {
      if (String(id).startsWith("local-")) onRemoveLocalDraft?.(id);
      else {
        await request(`/publish/drafts/${id}`, { method: "DELETE" });
        await refresh();
      }
      setNotice("Draft deleted.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId("");
    }
  }

  function openSchedule(draft) {
    const seed = draft.scheduled_at ? new Date(draft.scheduled_at) : new Date(Date.now() + 60 * 60 * 1000);
    const local = new Date(seed.getTime() - seed.getTimezoneOffset() * 60000);
    setScheduleValue(local.toISOString().slice(0, 16));
    setScheduleFor(draft);
    setError("");
    setNotice("");
  }

  async function confirmSchedule() {
    if (!scheduleFor) return;
    const when = new Date(scheduleValue);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      setError("Choose a future date and time to schedule this draft.");
      return;
    }
    setBusyId(scheduleFor.id);
    setError("");
    try {
      const result = await request(`/publish/drafts/${scheduleFor.id}/schedule`, {
        method: "POST",
        body: JSON.stringify({ scheduled_at: when.toISOString() }),
      });
      setScheduleFor(null);
      setNotice(`Scheduled to ${result?.scheduled_post_ids?.length || 0} channel(s).`);
      await refresh();
      onRefresh?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId("");
    }
  }

  async function addToQueue(draft) {
    if (String(draft.id).startsWith("local-")) {
      setError("Open this session draft in the composer and save it to your workspace first.");
      return;
    }
    setBusyId(draft.id);
    setError("");
    setNotice("");
    try {
      const result = await request(`/publish/drafts/${draft.id}/queue`, {
        method: "POST",
        body: JSON.stringify({ timezone: tz }),
      });
      setNotice(`Added to next queue slot on ${result?.scheduled_post_ids?.length || 0} channel(s).`);
      await refresh();
      onRefresh?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId("");
    }
  }

  const [query, setQuery] = useState("");
  const shownDrafts = visibleDrafts.filter((d) => !query.trim() || String(d.content || "").toLowerCase().includes(query.trim().toLowerCase()));
  function draftPlatforms(draft) {
    const m = draft?.metadata_json && typeof draft.metadata_json === "object" ? draft.metadata_json : (draft?.metadata || {});
    const ids = Array.isArray(m.selectedIds) ? m.selectedIds : [];
    return [...new Set(ids.map((id) => accounts.find((acc) => acc.id === id)?.platform).filter(Boolean))];
  }
  return <div className="col" style={{ gap: 24 }}>
    <PageHead title="Drafts" sub={`${visibleDrafts.length} draft${visibleDrafts.length === 1 ? "" : "s"} saved — edit, schedule, queue, or delete.`}>
      <div className="search" style={{ width: 220 }}><svg className="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search drafts" style={{ border: 0, background: "transparent", outline: "none", width: "100%", color: "inherit", font: "inherit" }} /></div>
      <button type="button" className="btn btn-secondary" onClick={() => void createDraft()} disabled={!!busyId}>{busyId === "new" ? <LoaderCircle className="animate-spin" size={14} /> : <Plus size={14} />}New draft</button>
      <button type="button" className="btn btn-primary" onClick={() => onCreatePost?.()}><Plus size={14} />Open composer</button>
    </PageHead>
    {error && <div role="alert" className="alert error sm">{error}</div>}
    {notice && <div className="alert info sm">{notice}</div>}
    {loading ? <div className="grid g3">{[0, 1, 2].map((i) => <div key={i} className="card card-pad col"><div className="skel" style={{ height: 120 }} /><div className="skel" style={{ height: 14, width: "70%" }} /><div className="skel" style={{ height: 12, width: "40%" }} /></div>)}</div> : shownDrafts.length ? (
      <div className="grid g3">
        {shownDrafts.map((draft) => {
          const localOnly = !!draft.local_only || String(draft.id).startsWith("local-");
          const busy = busyId === draft.id;
          const plats = draftPlatforms(draft);
          return <div key={draft.id} className="card" style={{ overflow: "hidden" }}>
            {draft.media_urls?.[0] ? <img src={draft.media_urls[0]} alt="" style={{ height: 120, width: "100%", objectFit: "cover", display: "block" }} /> : <div style={{ height: 120, display: "grid", placeItems: "center", background: "var(--surface-2)" }} className="xs subtle">Text only</div>}
            <div className="card-pad col" style={{ gap: 10 }}>
              <b className="sm" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{draft.content || "Untitled draft"}</b>
              <div className="row" style={{ gap: 4 }}>{plats.length ? plats.map((pl) => <Ch key={pl} platform={pl} />) : <span className="xs subtle">{accountSummary(draft)}</span>}<span className="badge nodot" style={{ marginLeft: "auto", textTransform: "capitalize" }}>{String(draft.status || "draft").replaceAll("_", " ")}</span></div>
              <div className="xs subtle">{localOnly ? "Saved in this session" : `Edited ${new Date(draft.updated_at || draft.created_at || Date.now()).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}{authorName ? ` · ${authorName}` : ""}</div>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn btn-secondary btn-sm grow" disabled={!!busyId} onClick={() => onOpenDraft?.(draft)}><Pencil size={13} />Edit</button>
                <button type="button" className="btn btn-primary btn-sm grow" disabled={!!busyId || localOnly} title={localOnly ? "Save to workspace first" : "Schedule at an exact time"} onClick={() => openSchedule(draft)}><CalendarDays size={13} />Schedule</button>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" disabled={!!busyId || localOnly} title={localOnly ? "Save to workspace first" : "Add to next queue slot"} aria-label="Add to queue" onClick={() => void addToQueue(draft)}>{busy ? <LoaderCircle size={13} className="animate-spin" /> : <Timer size={13} />}</button>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" style={{ color: "var(--error)" }} title="Delete draft" aria-label="Delete draft" disabled={!!busyId} onClick={() => void removeDraft(draft.id)}><Trash2 size={13} /></button>
              </div>
            </div>
          </div>;
        })}
      </div>
    ) : <div className="card"><Empty art="📝" title={query ? "No drafts match" : "No drafts yet"} text="Save unfinished ideas from the composer. They stay in your workspace until you schedule, queue, or delete them." action="Create a post" onAction={() => onCreatePost?.()} /></div>}

    {scheduleFor && createPortal(
      <div className="scd"><div className="modal-wrap" style={{ position: "fixed", zIndex: 80 }} onClick={() => setScheduleFor(null)}>
        <div className="modal" style={{ padding: 20 }} onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className=" text-lg font-extrabold">Schedule draft</h3>
              <p className="mt-1 text-xs text-slate-500">Pick an exact time. Each selected channel gets its own scheduled post.</p>
            </div>
            <button type="button" className={button} onClick={() => setScheduleFor(null)} aria-label="Close"><X size={14} /></button>
          </div>
          <label className="mt-4 block text-[11px] font-bold text-slate-500">Date and time
            <input type="datetime-local" value={scheduleValue} onChange={(event) => setScheduleValue(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" />
          </label>
          <p className="mt-2 text-[10px] text-slate-400">Timezone: your browser local time ({tz})</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={button} onClick={() => setScheduleFor(null)}>Cancel</button>
            <button type="button" className={primary} disabled={!!busyId} onClick={() => void confirmSchedule()}>{busyId === scheduleFor.id ? <LoaderCircle size={14} className="animate-spin" /> : <CalendarDays size={14} />}Confirm schedule</button>
          </div>
        </div>
      </div></div>,
      document.body,
    )}
  </div>;
}
function LibraryView({ request, onUseAsset }) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [tags, setTags] = useState(() => { try { return JSON.parse(localStorage.getItem("social_studio_library_tags") || "{}"); } catch { return {}; } });
  async function refresh() {
    setLoading(true); setError("");
    try { const result = await request("/publish/library"); setAssets(Array.isArray(result) ? result.filter(Boolean) : []); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [request]);
  function updateTag(id, value) {
    setTags((current) => {
      const next = { ...current, [id]: value };
      try { localStorage.setItem("social_studio_library_tags", JSON.stringify(next)); } catch { /* Tags remain usable for this session. */ }
      return next;
    });
  }
  async function uploadFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setUploading(true); setError("");
    try {
      for (const file of files) {
        const body = new FormData(); body.append("file", file);
        await request("/upload", { method: "POST", body });
      }
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setUploading(false); }
  }
  const filteredAssets = assets.filter((asset) => {
    const isVideo = asset.media_type?.startsWith("video/");
    const matchesKind = kind === "all" || (kind === "video" ? isVideo : !isVideo);
    const searchable = `${asset.filename} ${asset.alt_text || ""} ${tags[asset.id] || ""}`.toLowerCase();
    return matchesKind && searchable.includes(query.trim().toLowerCase());
  });
  return <section className={`${card} p-5 sm:p-6`}>
    <div className="flex flex-wrap items-end justify-between gap-3"><div><span className="text-[10px] font-extrabold uppercase tracking-[.16em] text-indigo-500">Workspace assets</span><h2 className="mt-1  text-xl font-extrabold">Content library</h2><p className="mt-1 text-xs text-slate-500">Upload, organize, and reuse your media across posts.</p></div><label className={`${primary} cursor-pointer`}><UploadCloud size={14} />{uploading ? "Uploading…" : "Upload media"}<input type="file" accept="image/*,video/*" multiple disabled={uploading} onChange={uploadFiles} className="sr-only" /></label></div>
    <div className="mt-5 flex flex-wrap gap-2"><label className="relative min-w-[200px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files or tags" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" /></label><div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">{["all", "image", "video"].map((item) => <button type="button" key={item} onClick={() => setKind(item)} className={`rounded-lg px-3 py-1.5 text-[10px] font-bold capitalize ${kind === item ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500"}`}>{item === "all" ? "All media" : item}</button>)}</div></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
    {loading ? <p className="py-12 text-center text-xs text-slate-400">Loading library…</p> : filteredAssets.length ? <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{filteredAssets.map((asset) => { const isVideo = asset.media_type?.startsWith("video/"); return <article key={asset.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"><a href={asset.public_url} target="_blank" rel="noreferrer" className="relative block aspect-square bg-slate-100 dark:bg-slate-900">{isVideo ? <video src={asset.public_url} muted playsInline className="h-full w-full object-cover" /> : <img src={asset.public_url} alt={asset.alt_text || asset.filename} className="h-full w-full object-cover" loading="lazy" />}{isVideo && <span className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 text-white"><Video size={13} /></span>}</a><div className="p-3"><p className="truncate text-xs font-bold" title={asset.filename}>{asset.filename}</p><p className="mt-1 text-[10px] text-slate-400">{(asset.size_bytes / (1024 * 1024)).toFixed(1)} MB · {new Date(asset.created_at).toLocaleDateString()}</p><input aria-label={`Tag ${asset.filename}`} value={tags[asset.id] || ""} onChange={(event) => updateTag(asset.id, event.target.value)} placeholder="Add a tag" className="mt-2 w-full rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-[10px] outline-none focus:border-indigo-400 dark:border-slate-700" /><div className="mt-2 flex gap-2"><button type="button" onClick={() => onUseAsset?.(asset)} className={`${primary} min-w-0 flex-1 !px-2 !py-2 !text-[10px]`}><Plus size={12} />Use in composer</button><button type="button" title="Copy media URL" onClick={() => navigator.clipboard?.writeText(new URL(asset.public_url, window.location.origin).href)} className={`${button} !px-2`}><Copy size={13} /></button></div></div></article>; })}</div> : <EmptyState icon={UploadCloud} title={assets.length ? "No matching media" : "Your library is ready"} text={assets.length ? "Try another search or filter, or upload a new asset." : "Upload photos and videos here, then reuse them in the composer."} />}
  </section>;
}

function ApprovalsView({ request, onRefresh, accounts = [] }) {
  const [items, setItems] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  const [selectedId, setSelectedId] = useState(""); const [comment, setComment] = useState("");
  async function refresh() { setLoading(true); try { const result = await request("/publish/approvals"); setItems(Array.isArray(result) ? result.filter(Boolean) : []); setError(""); } catch (e) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { void refresh(); }, [request]);
  async function decide(id, decision) { setBusy(id); try { await request(`/publish/approvals/${id}/decision`, { method: "POST", body: JSON.stringify({ decision, ...(comment.trim() ? { comment: comment.trim() } : {}) }) }); setComment(""); await refresh(); if (decision === "approved") await onRefresh?.(); } catch (e) { setError(e.message); } finally { setBusy(""); } }
  const selected = items.find((i) => i.id === selectedId) || items[0];
  const platsOf = (item) => { const ids = Array.isArray(item?.metadata_json?.selectedIds) ? item.metadata_json.selectedIds : []; return [...new Set(ids.map((id) => accounts.find((a) => a.id === id)?.platform).filter(Boolean))]; };
  const titleOf = (item) => postTitle(item);
  const ago = (v) => new Date(v).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return <div className="col" style={{ gap: 24 }}>
    <PageHead title="Approvals" sub="Review drafts from your team before they're scheduled."><Seg value="pending" onChange={() => {}} options={[["pending", `Pending (${items.length})`]]} /></PageHead>
    {error && <div role="alert" className="alert error sm">{error}</div>}
    {loading ? <div className="card card-pad col"><div className="skel" style={{ height: 56 }} /><div className="skel" style={{ height: 56 }} /></div> : !items.length ? <div className="card"><Empty art="✅" title="Nothing waiting for review" text="When someone submits a draft for approval it shows up here." /></div> :
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr)", alignItems: "start" }}>
        <div className="card">{items.map((item) => <div key={item.id} className="post" role="button" style={{ cursor: "pointer", background: selected?.id === item.id ? "var(--primary-soft)" : undefined }} onClick={() => setSelectedId(item.id)}>
          {item.media_urls?.[0] ? <img className="thumb" src={item.media_urls[0]} alt="" style={{ width: 36, height: 36, objectFit: "cover" }} /> : <Avatar name={titleOf(item)} size={36} />}
          <div className="body"><b className="sm">{titleOf(item)}</b><div className="xs subtle">Submitted {ago(item.updated_at)}</div><div className="row" style={{ gap: 4, marginTop: 6 }}>{platsOf(item).map((pl) => <Ch key={pl} platform={pl} />)}<span className="badge b-warning">Pending</span></div></div>
        </div>)}</div>
        {selected && <div className="card">
          <div className="card-head"><div><b>{titleOf(selected)}</b><div className="xs subtle">Submitted {ago(selected.updated_at)}{selected.scheduled_at ? ` · for ${ago(selected.scheduled_at)}` : ""}{platsOf(selected).length ? ` · ${platsOf(selected).map((p) => meta(p).label).join(", ")}` : ""}</div></div><span className="badge b-warning">Pending review</span></div>
          <div style={{ padding: 20 }} className="col">
            <div className="pv"><p style={{ whiteSpace: "pre-wrap" }}>{selected.content || "Untitled post"}</p>{selected.media_urls?.[0] && <img className="img" src={selected.media_urls[0]} alt="" style={{ objectFit: "cover", width: "100%" }} />}</div>
            <label className="label" htmlFor="approval-comment">Feedback</label>
            <textarea id="approval-comment" className="input" rows="2" placeholder="Leave feedback (sent with your decision)…" value={comment} onChange={(e) => setComment(e.target.value)} style={{ height: "auto", padding: 10 }} />
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void decide(selected.id, "changes_requested")}>Request changes</button>
              <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => void decide(selected.id, "rejected")}>Reject</button>
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void decide(selected.id, "approved")}>{busy === selected.id ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}Approve & schedule</button>
            </div>
          </div>
        </div>}
      </div>}
  </div>;
}

function EmptyState({ icon: Icon, title, text, action, onClick }) {
  return <div className="grid justify-items-center py-14 text-center"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300"><Icon size={20} /></span><h3 className="mt-4 text-sm font-extrabold">{title}</h3><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{text}</p>{action && <button className={`${primary} mt-4`} onClick={onClick}><Plus size={14} />{action}</button>}</div>;
}


function QueueView({ request, accounts = [], posts = [], onCreatePost, onSelectPost, onRefresh, initialTab }) {
  const [qTab, setQTab] = useState(initialTab || "scheduled");
  const [chanFilter, setChanFilter] = useState("all");
  const [showSettings, setShowSettings] = useState(false);
  const [retrying, setRetrying] = useState("");
  const safeAccounts = Array.isArray(accounts) ? accounts.filter((item) => item?.is_active !== false) : [];
  const platforms = [...new Set(safeAccounts.map((account) => account.platform).filter(Boolean))].sort();
  const [platform, setPlatform] = useState(platforms[0] || "instagram");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [slots, setSlots] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draftWeekday, setDraftWeekday] = useState(0);
  const [draftTime, setDraftTime] = useState("09:00");
  const [usingDefaults, setUsingDefaults] = useState(false);

  async function loadAll(activePlatform = platform) {
    setLoading(true);
    setError("");
    try {
      const [slotRows, upcomingRows] = await Promise.all([
        request(`/publish/queue-slots${activePlatform ? `?platform=${encodeURIComponent(activePlatform)}` : ""}`),
        request(`/publish/queue/upcoming?days=14&timezone=${encodeURIComponent(timezone || "UTC")}`),
      ]);
      const saved = Array.isArray(slotRows) ? slotRows : [];
      setUsingDefaults(saved.length === 0);
      setSlots(saved.length ? saved.map((row) => ({ weekday: row.weekday, time_local: row.time_local })) : DEFAULT_QUEUE_SLOTS.map((row) => ({ ...row })));
      if (saved[0]?.timezone) setTimezone(saved[0].timezone);
      setUpcoming(Array.isArray(upcomingRows) ? upcomingRows : []);
    } catch (err) {
      setError(err.message || "Could not load queue slots.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(platform); }, [platform]);

  function addSlot() {
    const key = `${draftWeekday}-${draftTime}`;
    if (slots.some((slot) => `${slot.weekday}-${slot.time_local}` === key)) return;
    setSlots((current) => [...current, { weekday: draftWeekday, time_local: draftTime }].sort((a, b) => a.weekday - b.weekday || a.time_local.localeCompare(b.time_local)));
  }

  function removeSlot(weekday, time_local) {
    setSlots((current) => current.filter((slot) => !(slot.weekday === weekday && slot.time_local === time_local)));
  }

  async function saveSlots() {
    if (!platform) return;
    setSaving(true);
    setError("");
    try {
      const saved = await request("/publish/queue-slots", {
        method: "PUT",
        body: JSON.stringify({ platform, timezone, slots }),
      });
      setSlots((Array.isArray(saved) ? saved : []).map((row) => ({ weekday: row.weekday, time_local: row.time_local })));
      setUsingDefaults(false);
      await loadAll(platform);
    } catch (err) {
      setError(err.message || "Could not save queue slots.");
    } finally {
      setSaving(false);
    }
  }

  const filteredUpcoming = upcoming.filter((item) => !platform || item.platform === platform);
  const byDay = filteredUpcoming.reduce((acc, item) => {
    const key = new Date(item.scheduled_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    (acc[key] ||= []).push(item);
    return acc;
  }, {});

  const safePostsQ = (Array.isArray(posts) ? posts : []).filter(Boolean);
  const accById = new Map(accounts.map((acc) => [acc.id, acc]));
  const tabStatus = { scheduled: ["scheduled"], queued: ["queued", "publishing"], published: ["published"], failed: ["failed"] };
  const chanPosts = safePostsQ.filter((p) => chanFilter === "all" || accById.get(p.connected_account_id)?.platform === chanFilter);
  const countFor = (t) => chanPosts.filter((p) => tabStatus[t].includes(p.status)).length;
  const tabPosts = chanPosts.filter((p) => tabStatus[qTab].includes(p.status)).sort((x, y) => (qTab === "published" ? -1 : 1) * (new Date(postPlacementAt(x) || 0) - new Date(postPlacementAt(y) || 0)));
  const groups = tabPosts.reduce((acc, p) => { const d = new Date(postPlacementAt(p) || p.created_at); const k = dateKey(d); (acc[k] ||= { d, items: [] }).items.push(p); return acc; }, {});
  const todayK = dateKey(new Date()); const tom = new Date(); tom.setDate(tom.getDate() + 1); const tomK = dateKey(tom);
  const dayTitle = (k, d) => `${k === todayK ? "Today · " : k === tomK ? "Tomorrow · " : ""}${d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}`;
  const openSlotsByDay = upcoming.reduce((acc, it) => { if (!it.filled) { const k = dateKey(it.scheduled_at); acc[k] = (acc[k] || 0) + 1; } return acc; }, {});
  const allPlatforms = [...new Set(accounts.filter((a2) => a2?.is_active !== false).map((a2) => a2.platform).filter(Boolean))];
  async function retry(id) { setRetrying(id); try { await request(`/posts/${id}/retry`, { method: "POST" }); await onRefresh?.(); } catch (e) { setError(e.message || "Retry failed."); } finally { setRetrying(""); } }

  return <div className="col" style={{ gap: 24 }}>
    <PageHead title="Queue" sub="Everything scheduled to go out, grouped by day.">
      <Seg value={chanFilter} onChange={setChanFilter} options={[["all", "All channels"], ...allPlatforms.map((p) => [p, meta(p).label])]} />
      <button type="button" className={`btn ${showSettings ? "btn-primary" : "btn-secondary"}`} onClick={() => setShowSettings((v) => !v)}>Queue settings</button>
    </PageHead>
    <Tabs value={qTab} onChange={setQTab} options={[["scheduled", "Scheduled", countFor("scheduled")], ["queued", "Queued", countFor("queued")], ["published", "Published", countFor("published")], ["failed", "Failed", countFor("failed")]]} />
    {error && !showSettings && <div role="alert" className="alert error sm">{error}</div>}
    {!showSettings && (Object.keys(groups).length === 0 ? <div className="card"><Empty art="🗓️" title={`No ${qTab} posts`} text={qTab === "scheduled" ? "Schedule a post or add one to the queue and it will appear here." : "Nothing here yet."} action="Create post" onAction={() => onCreatePost?.()} /></div> : Object.entries(groups).map(([k, { d, items }]) => <div key={k} className="card">
      <div className="card-head"><h3>{dayTitle(k, d)}</h3><span className="xs subtle">{items.length} post{items.length === 1 ? "" : "s"}{qTab === "scheduled" && openSlotsByDay[k] ? ` · ${openSlotsByDay[k]} open slot${openSlotsByDay[k] === 1 ? "" : "s"}` : ""}</span></div>
      {items.map((p) => { const acc = accById.get(p.connected_account_id); const when = postPlacementAt(p); const t = when ? fmtTime(when) : ""; return <div key={p.id} className="post">
        <div className="time">{t.replace(/\s?(AM|PM)/i, "")}<span>{(t.match(/AM|PM/i) || [""])[0]}</span></div>
        <ScAccountAvatar account={acc} size={36} />
        <div className="body"><div className="row" style={{ gap: 8, marginBottom: 4 }}><b className="sm">{acc?.account_name || acc?.platform || "Account"}</b><StatusBadge status={p.status} post={p} /></div><div className="txt">{p.content || "Untitled post"}</div>{p.status === "failed" && (p.last_error_message || p.last_error_code) && <div className="xs" style={{ color: "var(--error)", marginTop: 6 }}>⚠ {p.last_error_code ? `${p.last_error_code}: ` : ""}{p.last_error_message}</div>}</div>
        {p.media_urls?.[0] && <img className="thumb" src={p.media_urls[0]} alt="" style={{ objectFit: "cover" }} />}
        {p.status === "failed" ? <button type="button" className="btn btn-sm btn-secondary" disabled={!!retrying} onClick={() => void retry(p.id)}>{retrying === p.id ? <LoaderCircle size={13} className="animate-spin" /> : <RotateCcw size={13} />}Retry</button> : <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label="Open post" onClick={() => onSelectPost?.(p)}><svg className="ico" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg></button>}
      </div>; })}
    </div>))}
    {showSettings && <section className="space-y-4">
    <div className={`${card} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-[.16em] text-indigo-500">Queue settings</span>
          <h2 className="mt-1  text-xl font-extrabold">Weekly posting slots</h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">Define when each channel can publish. Composer → Next queue places posts into the next free slot.</p>
        </div>
        <button type="button" className={primary} onClick={() => onCreatePost?.()}><Plus size={14} />Create post</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {platforms.length ? platforms.map((item) => <button key={item} type="button" onClick={() => setPlatform(item)} className={`rounded-xl px-3 py-2 text-[11px] font-bold capitalize transition ${platform === item ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"}`}>{item}</button>) : <p className="text-xs text-slate-500">Connect an account to configure queue slots.</p>}
      </div>
      {usingDefaults && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Showing Buffer-like defaults (Mon–Fri 9:00 / 12:30 / 17:00). Save to keep them for {platform || "this channel"}.</p>}
      {error && <p className="mt-3 text-xs font-semibold text-rose-600">{error}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="text-[11px] font-bold text-slate-500">Timezone
          <input value={timezone} onChange={(event) => setTimezone(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" />
        </label>
        <label className="text-[11px] font-bold text-slate-500">Weekday
          <select value={draftWeekday} onChange={(event) => setDraftWeekday(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">{WEEKDAY_LABELS.map((label, index) => <option key={label} value={index}>{label}</option>)}</select>
        </label>
        <label className="text-[11px] font-bold text-slate-500">Time
          <input type="time" value={draftTime} onChange={(event) => setDraftTime(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={button} onClick={addSlot}><Plus size={13} />Add slot</button>
        <button type="button" className={button} onClick={() => setSlots(DEFAULT_QUEUE_SLOTS.map((row) => ({ ...row })))}>Reset defaults</button>
        <button type="button" disabled={saving || !platform} className={primary} onClick={() => void saveSlots()}>{saving ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}Save {platform || "slots"}</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {loading ? <p className="text-xs text-slate-400">Loading slots…</p> : slots.length ? slots.map((slot) => <button key={`${slot.weekday}-${slot.time_local}`} type="button" onClick={() => removeSlot(slot.weekday, slot.time_local)} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" title="Remove slot">{WEEKDAY_LABELS[slot.weekday]} {slot.time_local}<X size={12} className="opacity-60" /></button>) : <p className="text-xs text-slate-400">No slots yet. Add times above.</p>}
      </div>
    </div>

    <div className={`${card} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className=" text-lg font-extrabold">Upcoming queue</h3>
          <p className="text-xs text-slate-500">Next 14 days of slot assignments for {platform || "all channels"}.</p>
        </div>
        <button type="button" className={button} onClick={() => void loadAll(platform)}><RotateCcw size={13} />Refresh</button>
      </div>
      <div className="mt-4 space-y-4">
        {loading ? <p className="py-8 text-center text-xs text-slate-400">Loading upcoming slots…</p> : Object.keys(byDay).length === 0 ? <p className="py-8 text-center text-xs text-slate-400">No upcoming slots. Save a weekly schedule above.</p> : Object.entries(byDay).map(([day, items]) => (
          <div key={day}>
            <h4 className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">{day}</h4>
            <div className="space-y-2">
              {items.map((item) => (
                <article key={`${item.connected_account_id}-${item.scheduled_at}`} className={`flex flex-wrap items-center gap-3 rounded-2xl border px-3.5 py-3 ${item.filled ? "border-indigo-200 bg-indigo-50/60 dark:border-indigo-900 dark:bg-indigo-950/30" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40"}`}>
                  <span className="min-w-16 text-sm font-extrabold tabular-nums">{item.time_local}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold capitalize">{item.account_name || item.platform}</p>
                    <p className="truncate text-[11px] text-slate-500">{item.filled ? (item.post_excerpt || item.post_status || "Filled") : "Open slot"}</p>
                  </div>
                  {item.filled && item.post_id ? <button type="button" className="text-[11px] font-bold text-indigo-600" onClick={() => { const match = (Array.isArray(posts) ? posts : []).find((post) => post.id === item.post_id); onSelectPost?.(match || { id: item.post_id, content: item.post_excerpt || "", scheduled_at: item.scheduled_at, status: item.post_status, connected_account_id: item.connected_account_id, media_urls: [] }); }}>Open</button> : <button type="button" className="text-[11px] font-bold text-slate-500" onClick={() => onCreatePost?.(new Date(item.scheduled_at))}>Fill</button>}
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>}
  </div>;
}

export default function PublishSection({ request, posts = [], accounts = [], authorName, localDrafts = [], onUpdateLocalDraft, onRemoveLocalDraft, onCreatePost, onOpenDraft, onUseAsset, onRefresh, view = "calendar", onNavigate, initialQueueTab }) {
  const safePosts = Array.isArray(posts) ? posts.filter(Boolean) : [];
  const safeAccounts = Array.isArray(accounts) ? accounts.filter(Boolean) : [];
  const active = view;
  const [selectedPost, setSelectedPost] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [filterAccountId, setFilterAccountId] = useState("all");
  const filteredPosts = useMemo(
    () => filterPublishPosts(safePosts, safeAccounts, { status: filterStatus, platform: filterPlatform, accountId: filterAccountId }),
    [safePosts, safeAccounts, filterStatus, filterPlatform, filterAccountId],
  );
  const calendarPosts = useMemo(
    () => filteredPosts.filter((post) => postPlacementAt(post) && (filterStatus !== "all" || post.status !== "draft")),
    [filteredPosts, filterStatus],
  );
  const failedCount = useMemo(() => safePosts.filter((post) => post.status === "failed").length, [safePosts]);
  const scheduledCount = useMemo(() => safePosts.filter((post) => ["scheduled", "queued", "publishing"].includes(post.status)).length, [safePosts]);
  function openPost(post) {
    // Publishing currently stores one scheduled row per connected account. Group
    // matching rows so the modal can preview each target channel together.
    if (!post || typeof post !== "object") return;
    const variants = safePosts.filter((candidate) => candidate.content === post.content
      && new Date(candidate.scheduled_at).getTime() === new Date(post.scheduled_at).getTime()
      && JSON.stringify(candidate.media_urls || []) === JSON.stringify(post.media_urls || []));
    const channelPosts = variants.map((variant) => {
      const account = safeAccounts.find((item) => item.id === variant.connected_account_id);
      return account ? { ...variant, preview_platform: account.platform, preview_account_name: account.account_name } : null;
    }).filter(Boolean);
    setSelectedPost({ ...post, channel_posts: channelPosts });
    setIsModalOpen(true);
  }
  const calendarHead = <PageHead title="Calendar" sub="Drag posts to reschedule. Click an empty day to create.">
    <button type="button" onClick={() => onCreatePost?.()} className="btn btn-primary"><Plus size={15} />New post</button>
  </PageHead>;
  const statusOnly = <PublishFilterBar accounts={safeAccounts} status={filterStatus} setStatus={setFilterStatus} platform={filterPlatform} accountId={filterAccountId} setAccountId={setFilterAccountId} />;
  return <>
    {(active === "calendar" || active === "week") && <>{calendarHead}<MonthCalendar key={active} initialView={active === "week" ? "week" : "month"} posts={calendarPosts} accounts={safeAccounts} onCreatePost={onCreatePost} onSelectPost={openPost} request={request} onRefresh={onRefresh} onList={() => onNavigate?.("posts")} platformFilter={filterPlatform} setPlatformFilter={setFilterPlatform} filters={statusOnly} /></>}
    {active === "posts" && <>{calendarHead}<PostsListView posts={safePosts} accounts={safeAccounts} request={request} onSelectPost={openPost} onRefresh={onRefresh} status={filterStatus} setStatus={setFilterStatus} platform={filterPlatform} setPlatform={setFilterPlatform} accountId={filterAccountId} setAccountId={setFilterAccountId} headerExtra={<Seg value="list" onChange={(v) => v !== "list" && onNavigate?.(v === "week" ? "week" : "calendar")} options={[["month", "Month"], ["week", "Week"], ["list", "List"]]} />} /></>}
    {active === "queue" && <QueueView request={request} accounts={safeAccounts} posts={safePosts} onCreatePost={onCreatePost} onSelectPost={openPost} onRefresh={onRefresh} initialTab={initialQueueTab} />}
    {active === "drafts" && <DraftsView request={request} accounts={safeAccounts} authorName={authorName} localDrafts={localDrafts} onUpdateLocalDraft={onUpdateLocalDraft} onRemoveLocalDraft={onRemoveLocalDraft} onCreatePost={onCreatePost} onOpenDraft={onOpenDraft} onRefresh={onRefresh} />}
    {active === "library" && <LibraryView request={request} onUseAsset={onUseAsset} />}
    {active === "approvals" && <ApprovalsView request={request} onRefresh={onRefresh} accounts={safeAccounts} />}
    {isModalOpen && selectedPost && <RenderErrorBoundary scope="Post details modal" compact><ScheduledPostModal post={selectedPost} accounts={safeAccounts} authorName={authorName} request={request} onRefresh={onRefresh} onClose={() => { setIsModalOpen(false); setSelectedPost(null); }} /></RenderErrorBoundary>}
  </>;
}

export function toLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/** Display scheduled times in the browser/local (Asia/Bangkok) zone with an explicit label. */
export function formatScheduledLocal(value) {
  if (!value) return "—";
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Bangkok";
  try {
    return `${new Date(value).toLocaleString(undefined, {
      timeZone: zone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    })}`;
  } catch {
    return new Date(value).toLocaleString();
  }
}

function NativePostPreview({ platform, accountName, authorName, content, mediaUrl, title, timestamp, format, account }) {
  const key = String(platform || "facebook").toLowerCase();
  const normalized = key === "twitter" ? "x" : key;
  const config = PREVIEW_CHANNELS[normalized] || PREVIEW_CHANNELS.facebook;
  const isVideo = /\.(mp4|mov|webm|m4v|ogv)(\?|$)/i.test(mediaUrl || "");
  const caption = content || "Your post caption will appear here.";
  const stamp = timestamp ? new Date(timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Just now";
  const name = accountName || authorName || "Your page";
  const profileAccount = account && typeof account === "object"
    ? account
    : { account_name: name, platform: normalized };
  const fallbackMedia = <div className="grid h-full min-h-40 place-items-center bg-gradient-to-br from-indigo-100 via-purple-100 to-blue-100 text-indigo-500 dark:from-indigo-950 dark:via-purple-950/70 dark:to-blue-950"><Image size={28} /></div>;
  const media = mediaUrl ? (isVideo ? <video src={mediaUrl} controls className="h-full w-full bg-black object-contain" /> : <img src={mediaUrl} alt={title || "Post media"} className="h-full w-full object-cover" />) : fallbackMedia;
  const avatarNode = <AccountAvatar account={profileAccount} size={40} showBadge={false} />;
  const actions = (labels) => <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:text-slate-400">{labels.map(([Icon, label]) => <span key={label} className="inline-flex items-center gap-1.5"><Icon size={15} />{label}</span>)}</div>;

  if (normalized === "youtube") return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950">
    <div className={`relative aspect-video overflow-hidden bg-slate-950 ${/short/i.test(format || "") ? "mx-auto max-w-[230px] rounded-xl" : ""}`}>{media}<span className="pointer-events-none absolute inset-0 grid place-items-center"><span className="grid h-12 w-12 place-items-center rounded-full bg-black/60 text-white"><Play size={22} fill="currentColor" /></span></span><span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-1 text-[9px] font-bold text-white">{/short/i.test(format || "") ? "SHORT" : "PREVIEW"}</span></div>
    <div className="flex gap-3 p-4">{avatarNode}<div className="min-w-0 flex-1"><h3 className="line-clamp-2 text-sm font-extrabold">{title || caption.slice(0, 80) || "Untitled video"}</h3><p className="mt-1 text-[10px] text-slate-500">{name} · 0 views · {stamp}</p><p className="mt-3 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-slate-600 dark:text-slate-300">{caption}</p></div></div>
  </article>;

  if (normalized === "tiktok") return <article className="relative mx-auto aspect-[9/16] max-h-[620px] w-full max-w-[330px] overflow-hidden rounded-[28px] bg-black text-white shadow-xl ring-1 ring-white/10">{mediaUrl ? (isVideo ? <video src={mediaUrl} controls className="absolute inset-0 h-full w-full object-cover" /> : <img src={mediaUrl} alt={title || "TikTok post"} className="absolute inset-0 h-full w-full object-cover" />) : <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-slate-950 to-purple-950" />}<div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/25" /><div className="absolute left-4 right-14 top-5 flex justify-between text-xs font-bold"><span>Following</span><span className="text-white/60">|</span><span>For You</span></div><div className="absolute bottom-5 left-4 right-14"><p className="text-xs font-extrabold">@{name.replaceAll(" ", "").toLowerCase()}</p><p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5">{caption}</p><p className="mt-2 text-[10px] text-white/70">♪ Original sound · {stamp}</p></div><div className="absolute bottom-24 right-3 flex flex-col items-center gap-4 text-[9px]"><span className="inline-flex rounded-full ring-2 ring-white">{avatarNode}</span><Heart size={23} /><MessageCircle size={22} /><Bookmark size={20} /><Share2 size={20} /></div></article>;

  if (normalized === "instagram") return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950">
    <header className="flex items-center gap-3 p-3">{avatarNode}<div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold">{name.replaceAll(" ", "").toLowerCase()}</p><p className="text-[10px] text-slate-500">{/reel|video/i.test(format || "") ? "Original audio" : stamp}</p></div><MoreHorizontal size={18} /></header>
    <div className={`overflow-hidden bg-slate-100 dark:bg-slate-900 ${/story/i.test(format || "") ? "aspect-[9/16] max-h-[480px]" : "aspect-square"}`}>{media}</div>
    <div className="p-3"><div className="flex items-center gap-4"><Heart size={20} /><MessageCircle size={20} /><Send size={19} className="-rotate-12" /><Bookmark size={19} className="ml-auto" /></div><p className="mt-3 text-[11px] font-extrabold">0 likes</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5"><b className="mr-1">{name.replaceAll(" ", "").toLowerCase()}</b>{caption}</p><p className="mt-2 text-[9px] uppercase text-slate-400">{stamp}</p></div>
  </article>;

  if (normalized === "x") return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950"><div className="flex gap-3">{avatarNode}<div className="min-w-0 flex-1"><p className="text-xs font-extrabold">{name} <span className="font-normal text-slate-500">@{name.replaceAll(" ", "").toLowerCase()} · {stamp}</span></p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{caption}</p>{mediaUrl && <div className="mt-3 max-h-80 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">{media}</div>}<div className="mt-4 flex max-w-sm justify-between text-slate-500"><MessageCircle size={16} /><Share2 size={16} /><Heart size={16} /><Bookmark size={16} /></div></div></div></article>;

  if (normalized === "linkedin") return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950"><header className="flex items-center gap-3 p-4">{avatarNode}<div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold">{name}</p><p className="text-[10px] text-slate-500">SocialCastly workspace · {stamp}</p></div><MoreHorizontal size={18} /></header><p className="whitespace-pre-wrap px-4 pb-4 text-xs leading-5">{caption}</p>{mediaUrl && <div className="max-h-80 overflow-hidden border-y border-slate-100 dark:border-slate-800">{media}</div>}<div className="px-4 py-2 text-[10px] text-slate-500">♡ 0 reactions · Be the first to react</div>{actions([[ThumbsUp, "Like"], [MessageCircle, "Comment"], [Share2, "Repost"], [Send, "Send"]])}</article>;

  if (normalized === "pinterest") return <article className="mx-auto max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950"><div className="relative max-h-[520px] overflow-hidden rounded-t-2xl">{mediaUrl ? media : fallbackMedia}<button type="button" className="absolute right-3 top-3 rounded-full bg-rose-600 px-4 py-2 text-xs font-extrabold text-white">Save</button></div><div className="p-4"><h3 className="text-sm font-extrabold">{title || caption.slice(0, 80) || "Untitled pin"}</h3><p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5">{caption}</p><div className="mt-4 flex items-center gap-2">{avatarNode}<div><p className="text-xs font-bold">{name}</p><p className="text-[10px] text-slate-500">{stamp}</p></div></div></div></article>;

  return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950"><header className="flex items-center gap-3 p-4">{avatarNode}<div className="min-w-0 flex-1"><p className="text-xs font-extrabold">{name}</p><p className="text-[10px] text-slate-500">{stamp} · Public</p></div><MoreHorizontal size={18} /></header><p className="whitespace-pre-wrap px-4 pb-4 text-xs leading-5">{caption}</p>{mediaUrl ? <div className="max-h-[380px] overflow-hidden">{media}</div> : <div className="grid h-44 place-items-center bg-gradient-to-br from-indigo-50 via-purple-50 to-blue-50 text-indigo-500 dark:from-indigo-950 dark:via-purple-950/60 dark:to-blue-950"><Image size={28} /></div>}{actions([[ThumbsUp, "Like"], [MessageCircle, "Comment"], [Share2, "Share"]])}</article>;
}

function ScheduledPostModal({ post, accounts, authorName, request, onRefresh, onClose }) {
  const safePost = post && typeof post === "object" ? post : {};
  const safeAccounts = Array.isArray(accounts) ? accounts.filter((item) => item && typeof item === "object") : [];
  const [tab, setTab] = useState("preview");
  const [editing, setEditing] = useState(false);
  const [channelPosts, setChannelPosts] = useState(() => Array.isArray(safePost.channel_posts) && safePost.channel_posts.some((item) => item && typeof item === "object") ? safePost.channel_posts.filter((item) => item && typeof item === "object") : [safePost]);
  const [content, setContent] = useState(typeof safePost.content === "string" ? safePost.content : "");
  const [scheduledAt, setScheduledAt] = useState(toLocalInputValue(safePost.scheduled_at));
  const [tag, setTag] = useState(Array.isArray(safePost.post_metadata?.tags) && typeof safePost.post_metadata.tags[0] === "string" ? safePost.post_metadata.tags[0] : "");
  const [hashtags, setHashtags] = useState(Array.isArray(safePost.post_metadata?.hashtags) ? safePost.post_metadata.hashtags.filter((item) => typeof item === "string").join(" ") : "");
  const [privacy, setPrivacy] = useState(typeof safePost.post_metadata?.privacy === "string" ? safePost.post_metadata.privacy : "Public");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const metadata = safePost.post_metadata && typeof safePost.post_metadata === "object" && !Array.isArray(safePost.post_metadata) ? safePost.post_metadata : {};
  const channelOptions = useMemo(() => {
    return (Array.isArray(channelPosts) ? channelPosts : []).filter((variant) => variant && typeof variant === "object").map((variant) => {
      const account = safeAccounts.find((item) => item.id === variant.connected_account_id);
      const platform = String(variant.preview_platform || account?.platform || "facebook").toLowerCase();
      const normalized = platform === "twitter" ? "x" : platform;
      const brand = PREVIEW_CHANNELS[normalized] || PREVIEW_CHANNELS.facebook;
      return { key: String(account?.id || variant.id), post: variant, platform: normalized, label: brand.label, mark: brand.mark, brand: brand.brand, accountName: variant.preview_account_name || account?.account_name || brand.label, account: account || { account_name: variant.preview_account_name || brand.label, platform: normalized } };
    });
  }, [safeAccounts, channelPosts]);
  const [activeChannel, setActiveChannel] = useState(() => channelOptions[0]?.key || String(safePost.id || "unknown"));
  const activeChannelOption = channelOptions.find((channel) => channel.key === activeChannel) || channelOptions[0];
  const activePost = activeChannelOption?.post || safePost;
  const activeMetadata = activePost.post_metadata && typeof activePost.post_metadata === "object" && !Array.isArray(activePost.post_metadata) ? activePost.post_metadata : {};
  const mediaUrl = activePost.media_urls?.[0] || "";
  const previewTitle = activePost.title || activeMetadata.title || "";
  const previewTimestamp = activePost.published_at || activePost.scheduled_at || activePost.created_at;
  const displayAuthor = activePost.author_name || authorName || "Workspace member";
  const canEdit = ["draft", "scheduled"].includes(activePost.status);
  const canDelete = activePost.status !== "publishing";
  const PLATFORM_DELETE_LABELS = {
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    x: "X",
    twitter: "X",
    threads: "Threads",
    youtube: "YouTube",
    pinterest: "Pinterest",
    tiktok: "TikTok",
  };
  const willRemoteDelete = Boolean(activePost.provider_post_id) && !String(activePost.provider_post_id).startsWith("inbox:");
  const remoteDeletePlatformLabel = PLATFORM_DELETE_LABELS[activeChannelOption?.platform] || (activeChannelOption?.label || "the social network");
  const siblingChannels = channelOptions.filter((channel) => channel.key !== (activeChannelOption?.key) && channel.post?.id !== activePost.id);
  const characterLimit = Math.min(({ x: 280, instagram: 2200, linkedin: 3000, pinterest: 500, youtube: 5000 })[activeChannelOption?.platform] || 63206, 10000);

  useEffect(() => {
    if (channelOptions.some((channel) => channel.key === activeChannel)) return;
    setActiveChannel(channelOptions[0]?.key || String(safePost.id || "unknown"));
  }, [activeChannel, channelOptions, safePost.id]);

  useEffect(() => {
    setContent(typeof activePost.content === "string" ? activePost.content : "");
    setScheduledAt(toLocalInputValue(activePost.scheduled_at));
    setTag(Array.isArray(activeMetadata.tags) && typeof activeMetadata.tags[0] === "string" ? activeMetadata.tags[0] : "");
    setHashtags(Array.isArray(activeMetadata.hashtags) ? activeMetadata.hashtags.join(" ") : "");
    setPrivacy(activeMetadata.privacy || "Public");
    setEditing(false);
    setConfirmDelete(false);
    setCommentText("");
    setComments([]);
    setError("");
  }, [activePost.id]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event) {
      if (event.key !== "Escape" || busy) return;
      if (confirmDelete) { setConfirmDelete(false); return; }
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [busy, confirmDelete, onClose]);

  useEffect(() => {
    if (tab !== "comments") return undefined;
    let active = true;
    setCommentsLoading(true);
    setComments([]);
    request(`/publish/posts/${activePost.id}/comments`)
      .then((items) => { if (active) setComments(Array.isArray(items) ? items : []); })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setCommentsLoading(false); });
    return () => { active = false; };
  }, [tab, activePost.id, request]);

  async function saveChanges() {
    setBusy(true); setError("");
    try {
      const metadataUpdate = { ...activeMetadata, tags: tag ? [tag] : [], hashtags: hashtags.split(/\s+/).map((item) => item.trim()).filter(Boolean), privacy };
      const updated = await request(`/posts/${activePost.id}`, { method: "PATCH", body: JSON.stringify({ content, scheduled_at: new Date(scheduledAt).toISOString(), post_metadata: metadataUpdate }) });
      setChannelPosts((current) => current.map((item) => item.id === activePost.id ? { ...item, ...updated } : item));
      setEditing(false);
      await onRefresh?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function deletePost() {
    setBusy(true); setError("");
    try { await request(`/posts/${activePost.id}`, { method: "DELETE" }); await onRefresh?.(); onClose(); }
    catch (e) { setError(e.message); setBusy(false); }
  }

  async function retryPost() {
    setBusy(true); setError("");
    try {
      const updated = await request(`/posts/${activePost.id}/retry`, { method: "POST" });
      setChannelPosts((current) => current.map((item) => item.id === activePost.id ? { ...item, ...updated } : item));
      await onRefresh?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function archivePost() {
    setBusy(true); setError("");
    try {
      const updated = await request(`/posts/${activePost.id}/archive`, { method: "POST" });
      setChannelPosts((current) => current.map((item) => item.id === activePost.id ? { ...item, ...updated } : item));
      await onRefresh?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function discardEdits() {
    setContent(activePost.content || "");
    setScheduledAt(toLocalInputValue(activePost.scheduled_at));
    setHashtags(Array.isArray(activeMetadata.hashtags) ? activeMetadata.hashtags.join(" ") : "");
    setTag(activeMetadata.tags?.[0] || "");
    setPrivacy(activeMetadata.privacy || "Public");
    setEditing(false);
  }

  async function publishNow() {
    setBusy(true); setError("");
    try {
      const updated = await request(`/posts/${activePost.id}/publish-now`, { method: "POST" });
      setChannelPosts((current) => current.map((item) => item.id === activePost.id ? { ...item, ...updated } : item));
      setEditing(false);
      await onRefresh?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function addComment(event) {
    event.preventDefault();
    const body = commentText.trim();
    if (!body) return;
    setCommentBusy(true); setError("");
    try {
      await request(`/publish/posts/${activePost.id}/comments`, { method: "POST", body: JSON.stringify({ body }) });
      setCommentText("");
      const items = await request(`/publish/posts/${activePost.id}/comments`);
      setComments(Array.isArray(items) ? items : []);
    } catch (e) { setError(e.message); }
    finally { setCommentBusy(false); }
  }

  return createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !commentBusy && !confirmDelete) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="scheduled-post-title" className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white text-slate-900 shadow-[0_32px_100px_rgba(15,23,42,.20)] dark:border-slate-700 dark:bg-slate-900 dark:text-white">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6"><div className="flex min-w-0 items-center gap-3"><AccountAvatar account={activeChannelOption.account || { account_name: activeChannelOption.accountName, platform: activeChannelOption.platform }} size={40} showBadge={false} /><div className="min-w-0"><div className="flex items-center gap-2"><h2 id="scheduled-post-title" className=" text-base font-extrabold">Post details</h2><span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[9px] font-bold capitalize text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-200">{activePost.status}</span></div><p className="truncate text-xs text-slate-500 dark:text-slate-400">{activeChannelOption.accountName} · {displayAuthor}</p></div></div><button type="button" onClick={onClose} aria-label="Close post preview" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"><X size={18} /></button></header>

      <div className="flex flex-wrap justify-end gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800 sm:px-6">{activePost.status === "failed" && <button type="button" disabled={busy} className={button} onClick={() => void retryPost()}><RotateCcw size={13} />Retry</button>}{["published", "failed", "cancelled"].includes(activePost.status) && <button type="button" disabled={busy} className={button} onClick={() => void archivePost()}><Archive size={13} />Archive</button>}{canEdit && !editing && <button type="button" disabled={busy} title="Publish this post immediately" className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] font-bold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200" onClick={() => void publishNow()}>{busy ? <LoaderCircle size={13} className="animate-spin" /> : <Send size={13} />}Post now</button>}{editing ? <><button type="button" disabled={busy} className={button} onClick={() => discardEdits()}><X size={13} />Cancel edit</button><button type="button" disabled={busy || !scheduledAt || content.length > characterLimit} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 px-3 py-2 text-[11px] font-bold text-white shadow-md shadow-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void saveChanges()}>{busy ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}Save changes</button></> : <button type="button" disabled={!canEdit} title={canEdit ? "Edit this account’s post" : "Only draft and scheduled posts can be edited"} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 px-3 py-2 text-[11px] font-bold text-white shadow-md shadow-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => { setEditing(true); setTab("details"); }}><Pencil size={13} />Edit</button>}<button type="button" disabled={busy || !canDelete} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-[11px] font-bold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40" onClick={() => setConfirmDelete(true)}><Trash2 size={13} />Delete</button></div>

      <div role="tablist" aria-label="Select post account" className="w-full max-w-full min-h-[54px] touch-pan-x overflow-x-auto overflow-y-hidden border-b border-slate-100 py-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:border-slate-800 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600">
        <div className="flex min-w-max flex-row items-center gap-2 whitespace-nowrap px-5 sm:px-6">{channelOptions.map((channel) => {
        const selected = activeChannelOption.key === channel.key;
        return <button key={channel.key} type="button" role="tab" aria-selected={selected} onClick={() => setActiveChannel(channel.key)} className={`sc-pill shrink-0 ${selected ? "sc-pill-on" : ""}`} style={{ "--channel-color": channel.brand }} title={`${channel.label} · ${channel.accountName}`}>
          <span className="channel-icon" style={{ color: channel.brand }}><ModalChannelIcon platform={channel.platform} mark={channel.mark} /></span>
          <span>{channel.label}</span>
          <span className={`max-w-36 truncate text-[10px] font-medium ${selected ? "text-slate-600 dark:text-slate-200" : "text-slate-400"}`}>{channel.accountName}</span>
          <span className="channel-state-dot" />
        </button>;
      })}</div>
      </div>

      <div role="tablist" aria-label="Scheduled post information" className="flex gap-5 border-b border-slate-100 px-5 dark:border-slate-800 sm:px-6">{[{ id: "preview", label: "Preview" }, { id: "details", label: "Details" }, { id: "comments", label: "Internal comments" }].map(({ id, label }) => <button type="button" role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)} className={`border-b-2 px-1 py-3 text-xs font-bold transition ${tab === id ? "border-indigo-600 text-indigo-700 dark:border-purple-400 dark:text-purple-200" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"}`}>{label}</button>)}</div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth p-5 sm:p-6">
        {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
        {tab === "preview" ? <div className="mx-auto max-w-md"><NativePostPreview platform={activeChannelOption.platform} accountName={activeChannelOption.accountName} authorName={displayAuthor} content={activePost.content || ""} mediaUrl={mediaUrl} title={previewTitle} timestamp={previewTimestamp} format={activePost.post_format || activeMetadata.format || "Post"} account={activeChannelOption.account} /></div> : tab === "details" ? <div className="mx-auto max-w-lg space-y-5">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-bold text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200">{activeChannelOption.accountName} · {activeChannelOption.label}</span><span className="rounded-full bg-slate-100 px-3 py-1.5 text-[10px] font-bold capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">{activePost.status === "published" && activePost.provider_post_id ? "published" : activePost.status === "published" ? "unconfirmed" : activePost.status}</span></div>
          <div className="rounded-xl bg-slate-50 px-3 py-3 text-xs leading-5 dark:bg-slate-800/70"><p>Provider post: {activePost.provider_post_id || "Not confirmed"}</p><p>Attempts: {activePost.attempt_count ?? 0}{activePost.latest_execution_outcome ? ` · last log ${activePost.latest_execution_outcome}` : ""}</p>{activePost.last_error_message && <p className="text-rose-600 dark:text-rose-300">{activePost.last_error_code ? `${activePost.last_error_code}: ` : ""}{activePost.last_error_message}</p>}</div>
          <label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold"><Clock3 size={14} className="text-indigo-500" />Scheduled time</span>{editing ? <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" /> : <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm dark:bg-slate-800/70">{formatScheduledLocal(activePost.scheduled_at)}</div>}</label>
          <label className="block"><span className="mb-2 flex items-center justify-between gap-2 text-xs font-bold"><span className="flex items-center gap-2"><MessageSquareText size={14} className="text-indigo-500" />Caption for {activeChannelOption.label}</span><span className={`font-medium ${content.length > characterLimit ? "text-rose-500" : "text-slate-400"}`}>{content.length.toLocaleString()} / {characterLimit.toLocaleString()}</span></span>{editing ? <textarea rows={5} maxLength={characterLimit} value={content} onChange={(event) => setContent(event.target.value)} className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" /> : <div className="whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-3 text-sm leading-6 dark:bg-slate-800/70">{activePost.content || "No caption added."}</div>}</label>
          <label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold"><Tag size={14} className="text-indigo-500" />Targeted hashtags</span>{editing ? <input value={hashtags} onChange={(event) => setHashtags(event.target.value)} placeholder="#brand #campaign" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" /> : <div className="rounded-xl bg-slate-50 px-3 py-3 text-xs dark:bg-slate-800/70">{hashtags || "No platform-specific hashtags"}</div>}</label>
          <div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold"><Tag size={14} className="text-indigo-500" />Tags</span><select disabled={!editing} value={tag} onChange={(event) => setTag(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-indigo-400 disabled:opacity-75 dark:border-slate-700 dark:bg-slate-950"><option value="">No tag</option>{[...new Set([...(Array.isArray(activeMetadata.tags) ? activeMetadata.tags : []), "Campaign", "Evergreen", "Product launch", "Behind the scenes"])].filter(Boolean).map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold"><ShieldCheck size={14} className="text-indigo-500" />Privacy</span><select disabled={!editing} value={privacy} onChange={(event) => setPrivacy(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-indigo-400 disabled:opacity-75 dark:border-slate-700 dark:bg-slate-950"><option>Public</option><option>Followers</option><option>Only me</option></select></label></div>
          <p className="text-[10px] text-slate-400">Caption, hashtags, tags, and settings save to this account’s post only. Publishing status is managed by the publishing service.</p>
          {editing && <div className="sticky bottom-0 z-10 -mx-1 flex justify-end gap-2 border-t border-slate-100 bg-white/95 px-1 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95"><button type="button" className={button} onClick={() => discardEdits()}>Cancel</button><button type="button" disabled={busy || !scheduledAt || content.length > characterLimit} className={primary} onClick={() => void saveChanges()}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}Save changes</button></div>}
        </div> : <section className="mx-auto max-w-lg"><div className="mb-4"><h3 className=" text-sm font-extrabold">Team notes · {activeChannelOption.accountName}</h3><p className="mt-1 text-xs text-slate-500">These internal notes are attached only to this account’s scheduled post.</p></div>{commentsLoading ? <div className="grid min-h-32 place-items-center text-xs text-slate-400"><LoaderCircle className="animate-spin" size={18} /></div> : comments.length ? <div className="mb-5 space-y-4">{comments.map((comment) => { const name = comment.author_name || "Workspace member"; return <article key={comment.id} className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 text-[11px] font-extrabold text-white">{name.slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1 rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800/70"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="text-xs font-extrabold">{name}</p><time className="text-[10px] text-slate-400">{new Date(comment.created_at).toLocaleString()}</time></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-700 dark:text-slate-200">{comment.body}</p></div></article>; })}</div> : <div className="mb-5 rounded-2xl border border-dashed border-slate-200 py-10 text-center dark:border-slate-700"><span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300"><MessageSquareText size={17} /></span><p className="mt-3 text-xs font-bold">No notes for this account yet</p><p className="mt-1 text-[11px] text-slate-400">Leave feedback specific to {activeChannelOption.label}.</p></div>}<form onSubmit={addComment} className="rounded-2xl border border-slate-200 p-3 focus-within:border-indigo-300 dark:border-slate-700 dark:focus-within:border-indigo-700"><textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} rows={3} maxLength={5000} placeholder={`Internal note for ${activeChannelOption.label}…`} className="w-full resize-y bg-transparent px-1 py-1 text-xs leading-5 outline-none placeholder:text-slate-400" /><div className="mt-2 flex items-center justify-between"><span className="text-[10px] text-slate-400">Private workspace note</span><button type="submit" disabled={commentBusy || !commentText.trim()} className={primary}>{commentBusy ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}Add note</button></div></form></section>}
      </div>
      <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-[10px] text-slate-400 dark:border-slate-800 sm:px-6"><span>Post ID · {String(activePost.id).slice(0, 8)}</span><span>Workspace content · private</span></footer>
    </section>

    {confirmDelete && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[1px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmDelete(false); }} role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="delete-post-title" aria-describedby="delete-post-desc" className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,.28)] dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-rose-100 bg-rose-50/80 px-5 py-4 dark:border-rose-900/50 dark:bg-rose-950/40">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-600 text-white shadow-md shadow-rose-500/25"><Trash2 size={18} /></span>
            <div className="min-w-0">
              <h3 id="delete-post-title" className=" text-base font-extrabold text-slate-900 dark:text-white">Delete this post?</h3>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{activeChannelOption?.accountName || "This channel"} · {activeChannelOption?.label || "channel"}</p>
            </div>
          </div>
        </div>
        <div id="delete-post-desc" className="space-y-3 px-5 py-4 text-sm leading-6 text-slate-700 dark:text-slate-200">
          {willRemoteDelete ? (
            <>
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-100">
                Deleting will also remove this post from <span className="font-extrabold">{remoteDeletePlatformLabel}</span>
                {remoteDeletePlatformLabel === "Facebook" ? " (your Facebook Page/feed)" : ""}.
                It will disappear from Social Studio and from {remoteDeletePlatformLabel}.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">If {remoteDeletePlatformLabel} rejects the delete, the post stays here so nothing is lost silently.</p>
            </>
          ) : (
            <p className="text-xs text-slate-600 dark:text-slate-300">This permanently removes the post from Social Studio. It was not confirmed on a social network, so nothing is removed elsewhere.</p>
          )}
          {siblingChannels.length > 0 && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
              Other channels in this group stay untouched: {siblingChannels.map((c) => c.accountName || c.label).join(", ")}. Delete each channel separately if you also want those network posts removed.
            </p>
          )}
          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
          <button type="button" disabled={busy} className={button} onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button type="button" disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-[11px] font-bold text-white shadow-md shadow-rose-500/20 transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void deletePost()}>
            {busy ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {willRemoteDelete ? `Delete from app & ${remoteDeletePlatformLabel}` : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>}
  </div>, document.body);
}