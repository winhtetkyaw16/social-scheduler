import React, { useEffect, useMemo, useState } from "react";
import { Ch, meta, chColor, Seg, Tabs, PageHead, Avatar, Empty, StatusBadge, fmtTime, fmtTime24, fmtDay, postTitle, AccountAvatar as ScAccountAvatar } from "./sc/ui.jsx";
import { createPortal } from "react-dom";
import RenderErrorBoundary from "./RenderErrorBoundary.jsx";
import { PostRowMenu, DeletePostModal, deleteCopy } from "./sc/PostActions.jsx";
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
const hideBrokenImg = (event) => { event.currentTarget.style.display = "none"; };
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

function PostsListView({ posts, accounts = [], request, onSelectPost, onEditPost, onDeletePost, onRefresh, status, setStatus, platform, setPlatform, accountId, setAccountId, headerExtra = null }) {
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
          {post.media_urls?.[0] && <img className="thumb" src={post.media_urls[0]} alt="" style={{ objectFit: "cover" }} onError={hideBrokenImg} />}
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onSelectPost?.(post)}>Open</button>
            {failed && <button type="button" className="btn btn-sm btn-secondary" disabled={!!busyId} onClick={() => void retryPost(post.id)}>{busyId === post.id ? <LoaderCircle size={13} className="animate-spin" /> : <RotateCcw size={13} />}Retry</button>}
            <PostRowMenu post={post} onEdit={(p) => (onEditPost || onSelectPost)?.(p)} onDelete={onDeletePost} />
          </div>
        </div>;
      })}
    </div>
  </div>;
}

function MonthCalendar({ posts, accounts = [], onCreatePost, onSelectPost, request, onRefresh, onList, platformFilter = "all", setPlatformFilter, filters = null, initialView = "month", onEditPost, onDuplicatePost }) {
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

  function openDay(date, anchorEl) { setDayDetail({ date, key: dateKey(date), anchor: anchorEl || null }); }
  const closeDay = React.useCallback(() => setDayDetail(null), []);

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
      onClick: (event) => { event.stopPropagation(); onSelectPost?.(post, event.currentTarget); },
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
            return <div key={post.id} role="button" tabIndex={0} {...dragProps(post)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onSelectPost?.(post, e.currentTarget); } }}
              aria-label={`Open post: ${post.content || "Untitled post"}`}
              className={`chip ${m.chip} ${post.status === "failed" ? "failed" : ""}`}
              style={{ cursor: canDragPost(post) ? "grab" : "pointer", opacity: draggingId === String(post.id) || busyId === String(post.id) ? .5 : 1, ...(m.chip ? null : { borderColor: chColor(account?.platform) }) }}
              title={`${account?.account_name || ""} · ${post.status}`}><b>{fmtTime24(postPlacementAt(post))}</b>{postTitle(post)}</div>;
          })}
          {dayPosts.length > postLimit && <span role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={dayDetail?.key === dateKey(date)} className="xs dp-more" onClick={(e) => { e.stopPropagation(); openDay(date, e.currentTarget); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); openDay(date, e.currentTarget); } }}>+{dayPosts.length - postLimit} more</span>}
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
              return <div key={post.id} role="button" tabIndex={0} {...dragProps(post)} className={`ev ${m.ev} ${post.status === "failed" ? "failed" : ""}`} style={{ cursor: canDragPost(post) ? "grab" : "pointer", ...(m.ev ? null : { borderColor: chColor(account?.platform) }) }}>
                <div className="row" style={{ gap: 6 }}><Ch platform={account?.platform} /><b>{fmtTime24(postPlacementAt(post))}</b>{inHour.length > 1 && <span className="xs subtle" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); openDay(d, e.currentTarget); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); openDay(d, e.currentTarget); } }}>+{inHour.length - 1}</span>}</div>{postTitle(post)}</div>;
            })}
          </div>;
        })}
      </React.Fragment>)}
    </div>}
    <p className="xs subtle">Click a day to compose · drag a post to another day to reschedule · click a post to open it</p>
    {dayDetail?.date instanceof Date && <RenderErrorBoundary scope="Day schedule" compact><DayPopover date={dayDetail.date} anchor={dayDetail.anchor}
      posts={(grouped.get(dayDetail.key) || []).slice().sort((a, b) => new Date(postPlacementAt(a) || 0) - new Date(postPlacementAt(b) || 0))}
      accounts={accounts} request={request} onRefresh={onRefresh} onClose={closeDay} onNewPost={openComposerForDay}
      onEdit={onEditPost} onDuplicate={onDuplicatePost} /></RenderErrorBoundary>}
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
            {draft.media_urls?.[0] ? <img src={draft.media_urls[0]} alt="" style={{ height: 120, width: "100%", objectFit: "cover", display: "block" }} onError={hideBrokenImg} /> : <div style={{ height: 120, display: "grid", placeItems: "center", background: "var(--surface-2)" }} className="xs subtle">Text only</div>}
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
          {item.media_urls?.[0] ? <img className="thumb" src={item.media_urls[0]} alt="" style={{ width: 36, height: 36, objectFit: "cover" }} onError={hideBrokenImg} /> : <Avatar name={titleOf(item)} size={36} />}
          <div className="body"><b className="sm">{titleOf(item)}</b><div className="xs subtle">Submitted {ago(item.updated_at)}</div><div className="row" style={{ gap: 4, marginTop: 6 }}>{platsOf(item).map((pl) => <Ch key={pl} platform={pl} />)}<span className="badge b-warning">Pending</span></div></div>
        </div>)}</div>
        {selected && <div className="card">
          <div className="card-head"><div><b>{titleOf(selected)}</b><div className="xs subtle">Submitted {ago(selected.updated_at)}{selected.scheduled_at ? ` · for ${ago(selected.scheduled_at)}` : ""}{platsOf(selected).length ? ` · ${platsOf(selected).map((p) => meta(p).label).join(", ")}` : ""}</div></div><span className="badge b-warning">Pending review</span></div>
          <div style={{ padding: 20 }} className="col">
            <div className="pv"><p style={{ whiteSpace: "pre-wrap" }}>{selected.content || "Untitled post"}</p>{selected.media_urls?.[0] && <img className="img" src={selected.media_urls[0]} alt="" style={{ objectFit: "cover", width: "100%" }} onError={hideBrokenImg} />}</div>
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


function QueueView({ request, accounts = [], posts = [], onCreatePost, onSelectPost, onEditPost, onDeletePost, onRefresh, initialTab }) {
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
        {p.media_urls?.[0] && <img className="thumb" src={p.media_urls[0]} alt="" style={{ objectFit: "cover" }} onError={hideBrokenImg} />}
        <div className="row" style={{ gap: 6 }}>{p.status === "failed" ? <button type="button" className="btn btn-sm btn-secondary" disabled={!!retrying} onClick={() => void retry(p.id)}>{retrying === p.id ? <LoaderCircle size={13} className="animate-spin" /> : <RotateCcw size={13} />}Retry</button> : null}
        <PostRowMenu post={p} onEdit={(x) => (onEditPost || onSelectPost)?.(x)} onDelete={onDeletePost} /></div>
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

export default function PublishSection({ request, posts = [], accounts = [], authorName, localDrafts = [], onUpdateLocalDraft, onRemoveLocalDraft, onCreatePost, onOpenDraft, onUseAsset, onRefresh, view = "calendar", onNavigate, initialQueueTab, initialOpenPostId, onPostDeleted }) {
  const safePosts = Array.isArray(posts) ? posts.filter(Boolean) : [];
  const safeAccounts = Array.isArray(accounts) ? accounts.filter(Boolean) : [];
  const active = view;
  const [selectedPost, setSelectedPost] = useState(null);
  const [popoverAnchor, setPopoverAnchor] = useState(null);
  const [editingPost, setEditingPost] = useState(null);
  const closePopover = React.useCallback(() => { setSelectedPost(null); setPopoverAnchor(null); }, []);
  function duplicatePost(post, account) {
    closePopover();
    onOpenDraft?.({ content: post.content || "", media_urls: Array.isArray(post.media_urls) ? post.media_urls : [], metadata: { caption: post.content || "", selectedIds: account?.id ? [account.id] : [], sharedMediaUrls: Array.isArray(post.media_urls) ? post.media_urls : [] } });
  }
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
  function openPost(post, anchor) {
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
    setPopoverAnchor(anchor && anchor.nodeType === 1 ? anchor : null);
  }
  // Row "⋯" menu: Edit opens the edit modal when the post is editable (PATCH accepts draft/scheduled), otherwise the details popover.
  function editPost(post) {
    if (!post) return;
    if (["draft", "scheduled"].includes(post.status)) { closePopover(); setEditingPost(post); } else openPost(post);
  }
  const [deletingPost, setDeletingPost] = useState(null);
  async function afterDelete(post, info) {
    if (selectedPost?.id === post.id) closePopover();
    if (onPostDeleted) await onPostDeleted(post, info); else await onRefresh?.();
  }
  const openedFromNav = React.useRef(null);
  useEffect(() => {
    if (!initialOpenPostId || openedFromNav.current === initialOpenPostId) return;
    const match = safePosts.find((p) => p.id === initialOpenPostId);
    if (!match) return;
    openedFromNav.current = initialOpenPostId;
    editPost(match);
  }, [initialOpenPostId, safePosts]); // eslint-disable-line react-hooks/exhaustive-deps
  const calendarHead = <PageHead title="Calendar" sub="Drag posts to reschedule. Click an empty day to create.">
    <button type="button" onClick={() => onCreatePost?.()} className="btn btn-primary"><Plus size={15} />New post</button>
  </PageHead>;
  const statusOnly = <PublishFilterBar accounts={safeAccounts} status={filterStatus} setStatus={setFilterStatus} platform={filterPlatform} accountId={filterAccountId} setAccountId={setFilterAccountId} />;
  return <>
    {(active === "calendar" || active === "week") && <>{calendarHead}<MonthCalendar onEditPost={(p) => setEditingPost(p)} onDuplicatePost={duplicatePost} key={active} initialView={active === "week" ? "week" : "month"} posts={calendarPosts} accounts={safeAccounts} onCreatePost={onCreatePost} onSelectPost={openPost} request={request} onRefresh={onRefresh} onList={() => onNavigate?.("posts")} platformFilter={filterPlatform} setPlatformFilter={setFilterPlatform} filters={statusOnly} /></>}
    {active === "posts" && <>{calendarHead}<PostsListView posts={safePosts} accounts={safeAccounts} request={request} onSelectPost={openPost} onEditPost={editPost} onDeletePost={setDeletingPost} onRefresh={onRefresh} status={filterStatus} setStatus={setFilterStatus} platform={filterPlatform} setPlatform={setFilterPlatform} accountId={filterAccountId} setAccountId={setFilterAccountId} headerExtra={<Seg value="list" onChange={(v) => v !== "list" && onNavigate?.(v === "week" ? "week" : "calendar")} options={[["month", "Month"], ["week", "Week"], ["list", "List"]]} />} /></>}
    {active === "queue" && <QueueView request={request} accounts={safeAccounts} posts={safePosts} onCreatePost={onCreatePost} onSelectPost={openPost} onEditPost={editPost} onDeletePost={setDeletingPost} onRefresh={onRefresh} initialTab={initialQueueTab} />}
    {active === "drafts" && <DraftsView request={request} accounts={safeAccounts} authorName={authorName} localDrafts={localDrafts} onUpdateLocalDraft={onUpdateLocalDraft} onRemoveLocalDraft={onRemoveLocalDraft} onCreatePost={onCreatePost} onOpenDraft={onOpenDraft} onRefresh={onRefresh} />}
    {active === "library" && <LibraryView request={request} onUseAsset={onUseAsset} />}
    {active === "approvals" && <ApprovalsView request={request} onRefresh={onRefresh} accounts={safeAccounts} />}
    {selectedPost && <RenderErrorBoundary scope="Post popover" compact><PostPopover post={selectedPost} anchor={popoverAnchor} accounts={safeAccounts} request={request} onRefresh={onRefresh} onClose={closePopover} onEdit={(p) => { closePopover(); setEditingPost(p); }} onDuplicate={duplicatePost} /></RenderErrorBoundary>}
    {deletingPost && <DeletePostModal post={deletingPost} account={safeAccounts.find((a) => a.id === deletingPost.connected_account_id)} request={request} onClose={() => setDeletingPost(null)} onDeleted={afterDelete} />}
    {editingPost && <RenderErrorBoundary scope="Edit post" compact><PostEditModal post={editingPost} accounts={safeAccounts} request={request} onRefresh={onRefresh} onClose={() => setEditingPost(null)} /></RenderErrorBoundary>}
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

const NETWORK_LABELS = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", x: "X", twitter: "X", threads: "Threads", youtube: "YouTube", pinterest: "Pinterest", tiktok: "TikTok" };
const POPOVER_W = 320;
function postNetwork(post, accounts) {
  const account = (accounts || []).find((a) => a.id === post?.connected_account_id);
  const platform = String(account?.platform || post?.preview_platform || "").toLowerCase();
  return NETWORK_LABELS[platform] || account?.platform || "the network";
}
/** Inline delete confirmation (title, one line, Cancel, red Delete). Uses DELETE /posts/:id (remote-first when published). */
function DeleteConfirm({ post, network, busy, onCancel, onConfirm }) {
  return <div className="pp-confirm" role="group" aria-labelledby={`pp-del-${post.id}`}>
    <b className="sm" id={`pp-del-${post.id}`}>Delete this post?</b>
    <p className="sm muted">{deleteCopy(post, network)}</p>
    <div className="row" style={{ gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
      <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={onCancel} autoFocus>Cancel</button>
      <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={onConfirm}>{busy && <LoaderCircle size={13} className="animate-spin" />}Delete</button>
    </div>
  </div>;
}

const POPOVER_GAP = 12;

function popTime(value) {
  if (!value) return "";
  try { return new Date(value).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " · " + new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
  catch { return String(value); }
}

function postPermalink(post) {
  const m = post?.post_metadata && typeof post.post_metadata === "object" ? post.post_metadata : {};
  const url = m.permalink || m.permalink_url || m.post_url || m.url;
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : "";
}

function useIsMobile() {
  const query = "(max-width: 767px)";
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setMobile(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return mobile;
}

/** Compact post summary anchored to the clicked calendar post (bottom sheet on mobile). */
function PostPopover({ post, anchor, accounts, request, onRefresh, onClose, onEdit, onDuplicate, inline = false }) {
  const mobile = useIsMobile();
  const [current, setCurrent] = useState(post);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [pos, setPos] = useState(null);
  const [dragY, setDragY] = useState(0);
  const popRef = React.useRef(null);
  const dragStart = React.useRef(null);
  useEffect(() => { setCurrent(post); setConfirmDelete(false); setMenuOpen(false); setError(""); }, [post?.id]);

  const account = (accounts || []).find((a) => a.id === current.connected_account_id);
  const platform = String(account?.platform || current.preview_platform || "").toLowerCase();
  const network = NETWORK_LABELS[platform] || account?.platform || "the network";
  const channelName = account?.account_name ? `${network} · ${account.account_name}` : network;
  const mediaUrl = Array.isArray(current.media_urls) ? current.media_urls[0] : "";
  const isVideo = /\.(mp4|mov|webm|m4v|ogv)(\?|$)/i.test(mediaUrl || "");
  const published = current.status === "published";
    const permalink = published ? postPermalink(current) : "";
  const canArchive = ["published", "failed", "cancelled"].includes(current.status);
  const canDelete = current.status !== "publishing";
  const canEdit = ["draft", "scheduled"].includes(current.status); // PATCH only accepts draft/scheduled
  const timeText = current.status === "draft" ? "No time set" : popTime(published ? (current.published_at || current.scheduled_at) : current.scheduled_at);

  // Highlight the clicked post and return focus to it on close.
  useEffect(() => {
    if (!anchor) return undefined;
    const prevOutline = anchor.style.outline; const prevOffset = anchor.style.outlineOffset;
    anchor.style.outline = "2px solid var(--primary)"; anchor.style.outlineOffset = "1px";
    return () => { anchor.style.outline = prevOutline; anchor.style.outlineOffset = prevOffset; try { anchor.focus({ preventScroll: true }); } catch { /* detached */ } };
  }, [anchor]);

  // Position beside the anchor; flip sides / open upward near edges.
  React.useLayoutEffect(() => {
    if (mobile || inline) { setPos(null); return undefined; }
    function place() {
      const el = popRef.current; if (!el) return;
      const h = el.offsetHeight; const vw = window.innerWidth; const vh = window.innerHeight;
      if (!anchor || !anchor.isConnected) { setPos({ left: Math.max(8, (vw - POPOVER_W) / 2), top: Math.max(8, (vh - h) / 2), side: "none" }); return; }
      const r = anchor.getBoundingClientRect();
      let side = r.right + POPOVER_GAP + POPOVER_W <= vw - 8 ? "right" : r.left - POPOVER_GAP - POPOVER_W >= 8 ? "left" : "below";
      let left; let top; let arrow;
      if (side === "below") {
        left = Math.min(Math.max(8, r.left + r.width / 2 - POPOVER_W / 2), vw - POPOVER_W - 8);
        top = r.bottom + POPOVER_GAP;
        if (top + h > vh - 8) { side = "above"; top = Math.max(8, r.top - POPOVER_GAP - h); }
        arrow = Math.min(Math.max(16, r.left + r.width / 2 - left), POPOVER_W - 16);
      } else {
        left = side === "right" ? r.right + POPOVER_GAP : r.left - POPOVER_GAP - POPOVER_W;
        top = r.top + r.height / 2 - 28;
        if (top + h > vh - 8) top = Math.max(8, vh - 8 - h);
        if (top < 8) top = 8;
        arrow = Math.min(Math.max(14, r.top + r.height / 2 - top), h - 14);
      }
      setPos({ left, top, side, arrow });
    }
    place();
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, mobile, inline, confirmDelete, menuOpen, current.status, error]);

  // Focus in, Esc and outside click close.
  useEffect(() => { const t = setTimeout(() => popRef.current?.querySelector("[data-autofocus]")?.focus?.() || popRef.current?.focus(), 0); return () => clearTimeout(t); }, [post?.id]);
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape" || busy) return;
      e.stopPropagation();
      if (menuOpen) { setMenuOpen(false); return; }
      if (confirmDelete) { setConfirmDelete(false); return; }
      if (inline) return; // day popover owns Esc
      onClose();
    }
    function onDown(e) {
      if (inline || busy || !popRef.current || popRef.current.contains(e.target)) return;
      if (anchor && anchor.contains(e.target)) return;
      if (mobile) return; // backdrop handles it
      onClose();
    }
    window.addEventListener("keydown", onKey, true); document.addEventListener("mousedown", onDown, true);
    return () => { window.removeEventListener("keydown", onKey, true); document.removeEventListener("mousedown", onDown, true); };
  }, [busy, menuOpen, confirmDelete, onClose, anchor, mobile, inline]);

  async function retry() {
    setBusy("retry"); setError("");
    try { const updated = await request(`/posts/${current.id}/retry`, { method: "POST" }); if (updated && typeof updated === "object") setCurrent((c) => ({ ...c, ...updated })); await onRefresh?.(); }
    catch (e) { setError(e.message || "Retry failed."); } finally { setBusy(""); }
  }
  async function archive() {
    setMenuOpen(false); setBusy("archive"); setError("");
    try { await request(`/posts/${current.id}/archive`, { method: "POST" }); await onRefresh?.(); onClose(); }
    catch (e) { setError(e.message || "Could not archive."); setBusy(""); }
  }
  async function remove() {
    setBusy("delete"); setError("");
    try { await request(`/posts/${current.id}`, { method: "DELETE" }); await onRefresh?.(); onClose(); }
    catch (e) { setError(e.message || "Could not delete."); setBusy(""); }
  }

  const icoClock = <svg className="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  const body = <>
    <div className="pp-head">
      <Ch platform={platform} />
      <span className="pp-ch" id="pp-title">{channelName}</span>
      <StatusBadge status={current.status} post={current} />
      <button type="button" className="pp-x" aria-label="Close" onClick={onClose} data-autofocus>×</button>
    </div>
    <div className="pp-time">{icoClock}{timeText || "No time set"}</div>
    <div className="pp-body">
      <p className="pp-cap">{current.content || postTitle(current)}</p>
      {mediaUrl && (isVideo ? <video className="pp-thumb" src={mediaUrl} muted style={{ objectFit: "cover" }} /> : <img className="pp-thumb" src={mediaUrl} alt="" style={{ objectFit: "cover" }} onError={hideBrokenImg} />)}
    </div>
    {current.status === "failed" && <div className="pp-err" role="status">
      <svg className="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
      <span className="grow pp-err-msg" title={current.last_error_message || ""}>{current.last_error_message || `${network} rejected this post.`}</span>
      <button type="button" className="pp-link" style={{ background: "none", border: 0, padding: 0 }} disabled={!!busy} onClick={() => void retry()}>{busy === "retry" ? <LoaderCircle size={14} className="animate-spin" /> : <svg className="ico" viewBox="0 0 24 24"><path d="M1 4v6h6M23 20v-6h-6" /><path d="M20.5 9A9 9 0 0 0 5.6 5.6L1 10m22 4l-4.6 4.4A9 9 0 0 1 3.5 15" /></svg>}Retry</button>
      {canDelete && <button type="button" className="pp-link" style={{ background: "none", border: 0, padding: 0 }} disabled={!!busy} onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}><Trash2 size={14} />Delete</button>}
    </div>}
    {permalink && <div className="pp-meta"><span /><a className="pp-link" href={permalink} target="_blank" rel="noreferrer">View on {network}<svg className="ico" viewBox="0 0 24 24"><path d="M7 17L17 7M8 7h9v9" /></svg></a></div>}
    {error && <div className="pp-err" role="alert"><span className="grow">{error}</span></div>}
    {confirmDelete ? <DeleteConfirm post={current} network={network} busy={busy === "delete"} onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()} /> : <div className="pp-foot">
      <span className="xs subtle">ID {String(current.id || "").slice(0, 8)}</span>
      <div className="row" style={{ gap: 6, position: "relative" }}>
        {(canArchive || canDelete) && <button type="button" className="btn btn-sm btn-secondary btn-icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><svg className="ico" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg></button>}
        {menuOpen && <div className="pp-menu" role="menu" style={mobile ? { top: "auto", bottom: 40 } : undefined}>
          {canArchive && <a role="menuitem" tabIndex={0} href="#" onClick={(e) => { e.preventDefault(); void archive(); }}><Archive size={15} />Archive</a>}
          {canDelete && <a role="menuitem" tabIndex={0} href="#" className="danger" onClick={(e) => { e.preventDefault(); setMenuOpen(false); setConfirmDelete(true); }}><Trash2 size={15} />Delete…</a>}
        </div>}
        {published
          ? <button type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => onDuplicate(current, account)}><Copy size={14} />Duplicate</button>
          : canEdit && <button type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => onEdit(current)}><Pencil size={14} />Edit</button>}
      </div>
    </div>}
  </>;

  if (inline) return <div ref={popRef} className="dp-detail" role="group" aria-labelledby="pp-title">{body}</div>;
  if (mobile) {
    const start = (e) => { dragStart.current = e.touches?.[0]?.clientY ?? null; };
    const move = (e) => { if (dragStart.current == null) return; setDragY(Math.max(0, (e.touches?.[0]?.clientY ?? 0) - dragStart.current)); };
    const end = () => { if (dragY > 80 && !busy) onClose(); else setDragY(0); dragStart.current = null; };
    return createPortal(<div className="scd sc-pop-layer" style={{ position: "fixed", inset: 0, zIndex: 70 }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,.45)" }} onClick={() => !busy && onClose()} />
      <div ref={popRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="pp-title" className="pop sheet pp-sheet"
        style={{ position: "fixed", transform: `translateY(${dragY}px)`, transition: dragStart.current == null ? "transform .2s" : "none" }}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}>{body}</div>
    </div>, document.body);
  }
  const arrowStyle = pos && pos.side !== "none" ? (pos.side === "right" ? { left: -6, top: pos.arrow - 5, borderLeft: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }
    : pos.side === "left" ? { right: -6, top: pos.arrow - 5, borderRight: "1px solid var(--border)", borderTop: "1px solid var(--border)" }
    : pos.side === "below" ? { top: -6, left: pos.arrow - 5, borderLeft: "1px solid var(--border)", borderTop: "1px solid var(--border)" }
    : { bottom: -6, left: pos.arrow - 5, borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }) : null;
  return createPortal(<div className="scd sc-pop-layer" style={{ position: "fixed", inset: 0, zIndex: 70, pointerEvents: "none" }}>
    <div ref={popRef} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby="pp-title" className="pop"
      style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? 0, pointerEvents: "auto", visibility: pos ? "visible" : "hidden" }}>
      {arrowStyle && <span aria-hidden="true" style={{ position: "absolute", width: 10, height: 10, background: "var(--surface)", transform: "rotate(45deg)", ...arrowStyle }} />}
      {body}
    </div>
  </div>, document.body);
}

/** Existing edit flow (caption, schedule, hashtags, tags, privacy, Save, Post now). */
function PostEditModal({ post, accounts, request, onRefresh, onClose }) {
  const safePost = post && typeof post === "object" ? post : {};
  const account = (accounts || []).find((a) => a.id === safePost.connected_account_id);
  const platform = String(account?.platform || "facebook").toLowerCase();
  const network = NETWORK_LABELS[platform] || platform;
  const md = safePost.post_metadata && typeof safePost.post_metadata === "object" && !Array.isArray(safePost.post_metadata) ? safePost.post_metadata : {};
  const [content, setContent] = useState(typeof safePost.content === "string" ? safePost.content : "");
  const [scheduledAt, setScheduledAt] = useState(toLocalInputValue(safePost.scheduled_at));
  const [tag, setTag] = useState(Array.isArray(md.tags) && typeof md.tags[0] === "string" ? md.tags[0] : "");
  const [hashtags, setHashtags] = useState(Array.isArray(md.hashtags) ? md.hashtags.filter((x) => typeof x === "string").join(" ") : "");
  const [privacy, setPrivacy] = useState(typeof md.privacy === "string" ? md.privacy : "Public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const characterLimit = Math.min(({ x: 280, instagram: 2200, linkedin: 3000, pinterest: 500, youtube: 5000 })[platform] || 63206, 10000);
  const canPostNow = ["draft", "scheduled"].includes(safePost.status);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  async function save() {
    setBusy(true); setError("");
    try {
      const post_metadata = { ...md, tags: tag ? [tag] : [], hashtags: hashtags.split(/\s+/).map((x) => x.trim()).filter(Boolean), privacy };
      await request(`/posts/${safePost.id}`, { method: "PATCH", body: JSON.stringify({ content, scheduled_at: new Date(scheduledAt).toISOString(), post_metadata }) });
      await onRefresh?.(); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  }
  async function publishNow() {
    setBusy(true); setError("");
    try { await request(`/posts/${safePost.id}/publish-now`, { method: "POST" }); await onRefresh?.(); onClose(); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return createPortal(<div className="scd"><div className="modal-wrap" style={{ position: "fixed", zIndex: 80 }} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-post-title" style={{ padding: 20, maxWidth: 520, width: "100%" }}>
      <div className="row between" style={{ marginBottom: 14 }}><div className="row" style={{ gap: 8, minWidth: 0 }}><Ch platform={platform} size="md" /><h3 id="edit-post-title" style={{ margin: 0 }}>Edit post · {network}{account?.account_name ? ` · ${account.account_name}` : ""}</h3></div><button type="button" className="pp-x" aria-label="Close" onClick={onClose}>×</button></div>
      {error && <div role="alert" className="alert error sm" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="col" style={{ gap: 12 }}>
        <label className="col" style={{ gap: 6 }}><span className="sm" style={{ fontWeight: 600 }}>Scheduled time</span><input className="input" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></label>
        <label className="col" style={{ gap: 6 }}><span className="row between sm" style={{ fontWeight: 600 }}>Caption<span className="xs subtle" style={{ color: content.length > characterLimit ? "var(--error)" : undefined }}>{content.length.toLocaleString()} / {characterLimit.toLocaleString()}</span></span><textarea className="input" rows={5} value={content} onChange={(e) => setContent(e.target.value)} style={{ resize: "vertical", minHeight: 110, height: "auto", padding: "10px 12px" }} /></label>
        <label className="col" style={{ gap: 6 }}><span className="sm" style={{ fontWeight: 600 }}>Hashtags</span><input className="input" value={hashtags} placeholder="#brand #campaign" onChange={(e) => setHashtags(e.target.value)} /></label>
        <div className="row" style={{ gap: 12 }}>
          <label className="col grow" style={{ gap: 6 }}><span className="sm" style={{ fontWeight: 600 }}>Tag</span><select className="input" value={tag} onChange={(e) => setTag(e.target.value)}><option value="">No tag</option>{[...new Set([...(Array.isArray(md.tags) ? md.tags : []), "Campaign", "Evergreen", "Product launch", "Behind the scenes"])].filter(Boolean).map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
          <label className="col grow" style={{ gap: 6 }}><span className="sm" style={{ fontWeight: 600 }}>Privacy</span><select className="input" value={privacy} onChange={(e) => setPrivacy(e.target.value)}><option>Public</option><option>Followers</option><option>Only me</option></select></label>
        </div>
      </div>
      <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
        {canPostNow && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void publishNow()}><Send size={14} />Post now</button>}
        <button type="button" className="btn btn-primary" disabled={busy || !scheduledAt || content.length > characterLimit} onClick={() => void save()}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}Save changes</button>
      </div>
    </div>
  </div></div>, document.body);
}

const DAY_W = 340;
const DOT = { scheduled: "#64748B", published: "#5B8A72", failed: "#B4646A", pending: "#A88A55", draft: "#94A3B8" };
function dayDotKey(post) {
  const s = post?.status;
  if (s === "published") return post.provider_post_id ? "published" : "pending";
  if (s === "failed" || s === "scheduled" || s === "draft") return s;
  if (["queued", "publishing", "pending", "changes_requested"].includes(s)) return "pending";
  return "draft";
}
function dayTime(post) {
  const v = postPlacementAt(post);
  if (!v) return "";
  try { return new Date(v).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); } catch { return ""; }
}

/** "+N more" day popover: list of the day's posts; a row swaps to that post's details in place (bottom sheet on mobile). */
function DayPopover({ date, posts, anchor, accounts, request, onRefresh, onClose, onNewPost, onEdit, onDuplicate }) {
  const mobile = useIsMobile();
  const [overrides, setOverrides] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const [pos, setPos] = useState(null);
  const [dragY, setDragY] = useState(0);
  const popRef = React.useRef(null);
  const listRef = React.useRef(null);
  const scrollRef = React.useRef(0);
  const lastRowRef = React.useRef(null);
  const dragStart = React.useRef(null);
  const items = posts.map((p) => (overrides[p.id] ? { ...p, ...overrides[p.id] } : p));
  const selected = selectedId != null ? items.find((p) => String(p.id) === String(selectedId)) : null;
  const dateLabel = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const countLabel = `${items.length} post${items.length === 1 ? "" : "s"}`;
  const failedPosts = items.filter((p) => p.status === "failed");
  const counts = {};
  items.forEach((p) => { const k = dayDotKey(p); counts[k] = (counts[k] || 0) + 1; });
  const summary = ["published", "scheduled", "pending", "draft", "failed"].filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(" · ");

  // Outline the "+N more" trigger while open; return focus on close.
  useEffect(() => {
    if (!anchor) return undefined;
    const o = anchor.style.outline; const off = anchor.style.outlineOffset;
    anchor.style.outline = "2px solid var(--text)"; anchor.style.outlineOffset = "1px";
    return () => { anchor.style.outline = o; anchor.style.outlineOffset = off; try { anchor.focus({ preventScroll: true }); } catch { /* detached */ } };
  }, [anchor]);

  React.useLayoutEffect(() => {
    if (mobile) { setPos(null); return undefined; }
    function place() {
      const el = popRef.current; if (!el) return;
      const h = el.offsetHeight; const vw = window.innerWidth; const vh = window.innerHeight;
      if (!anchor || !anchor.isConnected) { setPos({ left: Math.max(8, (vw - DAY_W) / 2), top: Math.max(8, (vh - h) / 2), side: "none" }); return; }
      const cell = anchor.closest?.(".cell") || anchor;
      const r = cell.getBoundingClientRect(); const a = anchor.getBoundingClientRect();
      let side = r.left - POPOVER_GAP - DAY_W >= 8 ? "left" : r.right + POPOVER_GAP + DAY_W <= vw - 8 ? "right" : "below";
      let left; let top; let arrow;
      if (side === "below") {
        left = Math.min(Math.max(8, a.left + a.width / 2 - DAY_W / 2), vw - DAY_W - 8);
        top = a.bottom + POPOVER_GAP;
        if (top + h > vh - 8) { side = "above"; top = Math.max(8, a.top - POPOVER_GAP - h); }
        arrow = Math.min(Math.max(16, a.left + a.width / 2 - left), DAY_W - 16);
      } else {
        left = side === "right" ? r.right + POPOVER_GAP : r.left - POPOVER_GAP - DAY_W;
        top = a.top + a.height / 2 - h + 40;
        if (top + h > vh - 8) top = Math.max(8, vh - 8 - h);
        if (top < 8) top = 8;
        arrow = Math.min(Math.max(14, a.top + a.height / 2 - top), h - 14);
      }
      setPos({ left, top, side, arrow });
    }
    place();
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, mobile, selectedId, items.length, error]);

  // Restore list scroll + row focus when coming back from details; focus first row on open.
  React.useLayoutEffect(() => {
    if (selectedId != null) return;
    if (listRef.current) listRef.current.scrollTop = scrollRef.current;
    const t = setTimeout(() => {
      const row = lastRowRef.current != null ? listRef.current?.querySelector(`[data-row-id="${lastRowRef.current}"]`) : null;
      (row || popRef.current?.querySelector(".pp-x") || popRef.current)?.focus?.({ preventScroll: true });
    }, 0);
    return () => clearTimeout(t);
  }, [selectedId]);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape" || retrying) return;
      // Inner post details handle Esc for their own "…" menu / delete confirm.
      if (popRef.current?.querySelector(".pp-menu, .pp-confirm")) return;
      e.stopPropagation(); onClose();
    }
    function onDown(e) {
      if (mobile || retrying || !popRef.current || popRef.current.contains(e.target)) return;
      if (anchor && anchor.contains(e.target)) return;
      onClose();
    }
    window.addEventListener("keydown", onKey, true); document.addEventListener("mousedown", onDown, true);
    return () => { window.removeEventListener("keydown", onKey, true); document.removeEventListener("mousedown", onDown, true); };
  }, [onClose, anchor, mobile, retrying]);

  function openRow(post) { scrollRef.current = listRef.current?.scrollTop || 0; lastRowRef.current = String(post.id); setSelectedId(post.id); }
  function rowKey(e, post) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRow(post); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const rows = [...(listRef.current?.querySelectorAll(".dp-row") || [])];
    const i = rows.indexOf(e.currentTarget);
    rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  }
  async function retryAll() {
    setRetrying(true); setError("");
    let failures = 0;
    for (const p of failedPosts) {
      try {
        const updated = await request(`/posts/${p.id}/retry`, { method: "POST" });
        setOverrides((o) => ({ ...o, [p.id]: updated && typeof updated === "object" ? updated : { status: "queued" } }));
      } catch { failures += 1; }
    }
    if (failures) setError(`${failures} post${failures === 1 ? "" : "s"} could not be retried.`);
    setRetrying(false);
    await onRefresh?.();
  }

  const head = <div className="dp-head">
    <b id="dp-title">{dateLabel}</b><span className="dp-count">{countLabel}</span>
    <button type="button" className="pp-x" aria-label="Close" onClick={onClose}>×</button>
  </div>;
  let prevTime = null;
  const list = <>
    {head}
    <div className="dp-sum"><span>{summary || "No posts"}</span>{failedPosts.length > 0 && <button type="button" className="pp-link dp-retry" disabled={retrying} onClick={() => void retryAll()}>{retrying ? "Retrying…" : "Retry all failed"}</button>}</div>
    {error && <div className="dp-err" role="alert" title={error}>{error}</div>}
    <div className="dp-list" ref={listRef} role="list" aria-labelledby="dp-title">
      {items.map((post) => {
        const account = (accounts || []).find((a) => a.id === post.connected_account_id);
        const t = dayTime(post); const showT = t !== prevTime; prevTime = t;
        const key = dayDotKey(post);
        return <div key={post.id} data-row-id={String(post.id)} role="listitem" tabIndex={0} className="dp-row" onClick={() => openRow(post)} onKeyDown={(e) => rowKey(e, post)} aria-label={`${t} ${account?.account_name || ""} ${post.status}`}>
          <span className="dp-t">{showT ? t : ""}</span>
          <Ch platform={account?.platform || post.preview_platform} />
          <div className="dp-main">
            <div className="dp-l1"><b title={account?.account_name || ""}>{account?.account_name || account?.platform || "Account"}</b><span className="dp-cap">{post.content || postTitle(post)}</span></div>
            {post.status === "failed" && <div className="dp-err" title={post.last_error_message || ""}>{post.last_error_message || "Publishing failed"}</div>}
          </div>
          <span className="dp-dot" style={{ background: DOT[key] }} title={key} aria-hidden="true" />
        </div>;
      })}
    </div>
    <div className="dp-foot"><button type="button" className="btn btn-primary dp-new" onClick={() => { onClose(); onNewPost?.(date); }}><Plus size={15} />New post on this day</button></div>
  </>;
  const detail = selected && <>
    <button type="button" className="dp-back" onClick={() => setSelectedId(null)} aria-label="Back to day list"><ArrowLeft size={14} />{dateLabel} · {countLabel}</button>
    <RenderErrorBoundary scope="Post details" compact><PostPopover inline post={selected} anchor={null} accounts={accounts} request={request}
      onRefresh={async () => { await onRefresh?.(); }} onClose={() => setSelectedId(null)}
      onEdit={(p) => { onClose(); onEdit?.(p); }} onDuplicate={(p, acc) => { onClose(); onDuplicate?.(p, acc); }} /></RenderErrorBoundary>
  </>;
  const content = selected ? detail : list;

  if (mobile) {
    const start = (e) => { dragStart.current = e.touches?.[0]?.clientY ?? null; };
    const move = (e) => { if (dragStart.current == null) return; setDragY(Math.max(0, (e.touches?.[0]?.clientY ?? 0) - dragStart.current)); };
    const end = () => { if (dragY > 80 && !retrying) onClose(); else setDragY(0); dragStart.current = null; };
    return createPortal(<div className="scd sc-pop-layer" style={{ position: "fixed", inset: 0, zIndex: 70 }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,.45)" }} onClick={() => !retrying && onClose()} />
      <div ref={popRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dp-title" className="pop sheet dpop"
        style={{ position: "fixed", transform: `translateY(${dragY}px)`, transition: dragStart.current == null ? "transform .2s" : "none" }}>
        <div className="dp-grab" onTouchStart={start} onTouchMove={move} onTouchEnd={end} aria-hidden="true" />
        {content}
      </div>
    </div>, document.body);
  }
  const arrowStyle = pos && pos.side !== "none" ? (pos.side === "right" ? { left: -6, top: pos.arrow - 5, borderLeft: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }
    : pos.side === "left" ? { right: -6, top: pos.arrow - 5, borderRight: "1px solid var(--border)", borderTop: "1px solid var(--border)" }
    : pos.side === "below" ? { top: -6, left: pos.arrow - 5, borderLeft: "1px solid var(--border)", borderTop: "1px solid var(--border)" }
    : { bottom: -6, left: pos.arrow - 5, borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }) : null;
  return createPortal(<div className="scd sc-pop-layer" style={{ position: "fixed", inset: 0, zIndex: 70, pointerEvents: "none" }}>
    <div ref={popRef} tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby="dp-title" className="pop dpop"
      style={{ position: "fixed", width: DAY_W, left: pos?.left ?? -9999, top: pos?.top ?? 0, pointerEvents: "auto", visibility: pos ? "visible" : "hidden" }}>
      {arrowStyle && <span aria-hidden="true" style={{ position: "absolute", width: 10, height: 10, background: "var(--surface)", transform: "rotate(45deg)", ...arrowStyle }} />}
      {content}
    </div>
  </div>, document.body);
}
