import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import RenderErrorBoundary from "./RenderErrorBoundary.jsx";
import {
  ArrowLeft, ArrowRight, Bookmark, CalendarDays, Check, Clock3, Copy, FileText, Heart, Image, LayoutGrid,
  Instagram, Linkedin, LoaderCircle, MessageCircle, MessageSquareText, MoreHorizontal, Pencil, Play, Plus, Send, Share2,
  Search, ShieldCheck, Tag, ThumbsUp, Trash2, UploadCloud, Video, X,
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
  { id: "drafts", label: "Drafts", icon: FileText },
  { id: "library", label: "Content library", icon: Image },
  { id: "approvals", label: "Approvals", icon: Check },
];
const card = "rounded-3xl border border-slate-200/80 bg-white/85 shadow-[0_12px_36px_rgba(21,32,66,.045)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80";
const button = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800";
const primary = "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:shadow-indigo-500/30 disabled:opacity-50";

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function MonthCalendar({ posts, onCreatePost, onSelectPost }) {
  const safePosts = Array.isArray(posts) ? posts.filter(Boolean) : [];
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(() => new Date());
  const dates = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    if (view === "month") start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    else {
      const now = new Date(cursor);
      start.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
    }
    const count = view === "month" ? 42 : 7;
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [cursor, view]);
  const grouped = useMemo(() => safePosts.reduce((map, post) => {
    if (!post.scheduled_at) return map;
    const key = dateKey(post.scheduled_at);
    map.set(key, [...(map.get(key) || []), post]);
    return map;
  }, new Map()), [safePosts]);
  const label = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(cursor);
  function step(amount) {
    setCursor((current) => {
      const next = new Date(current);
      if (view === "month") next.setMonth(next.getMonth() + amount, 1);
      else next.setDate(next.getDate() + amount * 7);
      return next;
    });
  }
  return <section className={`${card} overflow-hidden`}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800 sm:p-5">
      <div><span className="text-[10px] font-extrabold uppercase tracking-[.16em] text-indigo-500">Publishing plan</span><h2 className="mt-1 font-display text-lg font-extrabold">{label}</h2></div>
      <div className="flex items-center gap-2"><div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">{["week", "month"].map((item) => <button key={item} onClick={() => setView(item)} className={`rounded-lg px-3 py-1.5 text-[11px] font-bold capitalize ${view === item ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500"}`}>{item}</button>)}</div><button className={button} onClick={() => step(-1)} aria-label="Previous period"><ArrowLeft size={14} /></button><button className={button} onClick={() => step(1)} aria-label="Next period"><ArrowRight size={14} /></button><button className={primary} onClick={onCreatePost}><Plus size={14} />Create</button></div>
    </div>
    <div className="grid grid-cols-7 border-b border-slate-100 text-center text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:border-slate-800">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="py-3">{day}</div>)}</div>
    <div className="grid grid-cols-7">{dates.map((date) => {
      const key = dateKey(date); const dayPosts = grouped.get(key) || [];
      const today = key === dateKey(new Date()); const sameMonth = date.getMonth() === cursor.getMonth();
      return <div key={key} className={`min-h-28 border-b border-r border-slate-100 p-1.5 dark:border-slate-800 sm:min-h-36 sm:p-2 ${!sameMonth && view === "month" ? "bg-slate-50/60 dark:bg-slate-950/30" : ""}`}>
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${today ? "bg-gradient-to-br from-indigo-600 to-purple-600 text-white" : sameMonth ? "text-slate-700 dark:text-slate-200" : "text-slate-300 dark:text-slate-600"}`}>{date.getDate()}</span>
        <div className="mt-1 space-y-1">{dayPosts.slice(0, 2).map((post) => <button type="button" key={post.id} onClick={() => onSelectPost(post)} aria-label={`Open scheduled post: ${post.content || "Untitled post"}`} className="block w-full overflow-hidden rounded-lg border border-indigo-100 bg-indigo-50/80 text-left text-[10px] text-indigo-950 transition hover:border-indigo-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-indigo-900/70 dark:bg-indigo-950/50 dark:text-indigo-100">
          {post.media_urls?.[0] && <img src={post.media_urls[0]} alt="" className="h-11 w-full object-cover" loading="lazy" />}
          <div className="p-1.5"><p className="flex items-center gap-1 font-bold"><Clock3 size={10} />{new Date(post.scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p><p className="mt-1 line-clamp-2">{post.content || "Untitled post"}</p><span className="mt-1 inline-flex rounded-full bg-purple-100 px-1.5 py-0.5 font-bold text-purple-800 dark:bg-purple-900/70 dark:text-purple-200">{post.status}</span>{post.post_metadata?.recommended_time && <span className="ml-1 mt-1 inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">Recommended time</span>}</div>
        </button>)}{dayPosts.length > 2 && <p className="px-1 text-[10px] font-semibold text-slate-500">+{dayPosts.length - 2} more</p>}</div>
      </div>;
    })}</div>
  </section>;
}

function DraftsView({ request, onCreatePost, onOpenDraft, localDrafts = [], onUpdateLocalDraft, onRemoveLocalDraft }) {
  const [drafts, setDrafts] = useState([]); const [loading, setLoading] = useState(true); const [busyId, setBusyId] = useState(""); const [error, setError] = useState(""); const [editing, setEditing] = useState(""); const [editContent, setEditContent] = useState("");
  async function refresh() { setLoading(true); setError(""); try { const result = await request("/publish/drafts"); setDrafts(Array.isArray(result) ? result.filter(Boolean) : []); } catch (e) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { void refresh(); }, [request]);
  const visibleDrafts = [...(Array.isArray(localDrafts) ? localDrafts : []), ...drafts];
  async function createDraft() { setBusyId("new"); setError(""); try { const draft = await request("/publish/drafts", { method: "POST", body: JSON.stringify({ content: "", post_format: "Post" }) }); setEditing(draft.id); setEditContent(""); await refresh(); } catch (e) { setError(e.message); } finally { setBusyId(""); } }
  async function saveDraft(id) { setBusyId(id); try { if (id.startsWith("local-")) onUpdateLocalDraft?.(id, { content: editContent }); else { await request(`/publish/drafts/${id}`, { method: "PATCH", body: JSON.stringify({ content: editContent }) }); await refresh(); } setEditing(""); } catch (e) { setError(e.message); } finally { setBusyId(""); } }
  async function submitDraft(id) { if (id.startsWith("local-")) { setError("Open this session draft in the composer and save it to your workspace before submitting for review."); return; } setBusyId(id); try { await request(`/publish/drafts/${id}/submit`, { method: "POST" }); await refresh(); } catch (e) { setError(e.message); } finally { setBusyId(""); } }
  async function removeDraft(id) { setBusyId(id); try { if (id.startsWith("local-")) onRemoveLocalDraft?.(id); else { await request(`/publish/drafts/${id}`, { method: "DELETE" }); await refresh(); } } catch (e) { setError(e.message); } finally { setBusyId(""); } }
  return <section className={`${card} p-5 sm:p-6`}><div className="flex flex-wrap items-end justify-between gap-3"><div><span className="text-[10px] font-extrabold uppercase tracking-[.16em] text-indigo-500">Saved for later</span><h2 className="mt-1 font-display text-xl font-extrabold">Drafts</h2><p className="mt-1 text-xs text-slate-500">Pick up where your next idea left off.</p></div><div className="flex gap-2"><button className={button} onClick={() => void createDraft()} disabled={!!busyId}>{busyId === "new" ? <LoaderCircle className="animate-spin" size={14} /> : <Plus size={14} />}New draft</button><button className={primary} onClick={onCreatePost}><Plus size={14} />Open composer</button></div></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
    {loading ? <p className="py-12 text-center text-xs text-slate-400">Loading drafts…</p> : visibleDrafts.length ? <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visibleDrafts.map((draft) => <article key={draft.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"><div className="flex gap-3">{draft.media_urls?.[0] ? <img src={draft.media_urls[0]} alt="" className="h-16 w-16 rounded-xl object-cover" /> : <span className="grid h-16 w-16 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300"><FileText size={20} /></span>}<div className="min-w-0 flex-1">{editing === draft.id ? <textarea rows={4} autoFocus value={editContent} onChange={(event) => setEditContent(event.target.value)} placeholder="Write your draft…" className="w-full resize-y rounded-xl border border-slate-200 bg-white p-2 text-xs leading-5 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" /> : <p className="line-clamp-3 text-xs leading-5">{draft.content || "Untitled draft"}</p>}<p className="mt-2 text-[10px] text-slate-400">{draft.local_only ? "Saved in this session" : `Updated ${new Date(draft.updated_at).toLocaleDateString()}`}</p></div></div><div className="mt-4 flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">{draft.status.replaceAll("_", " ")}</span><div className="flex flex-wrap gap-2">{editing === draft.id ? <button className={primary} disabled={!!busyId} onClick={() => void saveDraft(draft.id)}>{busyId === draft.id ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}Save</button> : <><button className={button} disabled={!!busyId} onClick={() => { setEditing(draft.id); setEditContent(draft.content || ""); }}>Edit text</button><button className={primary} disabled={!!busyId} onClick={() => onOpenDraft?.(draft)}><FileText size={13} />Open in composer</button></>}<button className={button} title="Submit for approval" disabled={!!busyId || editing === draft.id || draft.local_only} onClick={() => void submitDraft(draft.id)}><Send size={13} />Review</button><button className={`${button} !px-2 text-rose-500`} title="Delete draft" disabled={!!busyId} onClick={() => void removeDraft(draft.id)}><Trash2 size={13} /></button></div></div></article>)}</div> : <EmptyState icon={FileText} title="No drafts yet" text="Save unfinished ideas here, then continue editing them in the composer." action="Create a post" onClick={onCreatePost} />}
  </section>;
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
    <div className="flex flex-wrap items-end justify-between gap-3"><div><span className="text-[10px] font-extrabold uppercase tracking-[.16em] text-indigo-500">Workspace assets</span><h2 className="mt-1 font-display text-xl font-extrabold">Content library</h2><p className="mt-1 text-xs text-slate-500">Upload, organize, and reuse your media across posts.</p></div><label className={`${primary} cursor-pointer`}><UploadCloud size={14} />{uploading ? "Uploading…" : "Upload media"}<input type="file" accept="image/*,video/*" multiple disabled={uploading} onChange={uploadFiles} className="sr-only" /></label></div>
    <div className="mt-5 flex flex-wrap gap-2"><label className="relative min-w-[200px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files or tags" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" /></label><div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">{["all", "image", "video"].map((item) => <button type="button" key={item} onClick={() => setKind(item)} className={`rounded-lg px-3 py-1.5 text-[10px] font-bold capitalize ${kind === item ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500"}`}>{item === "all" ? "All media" : item}</button>)}</div></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
    {loading ? <p className="py-12 text-center text-xs text-slate-400">Loading library…</p> : filteredAssets.length ? <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{filteredAssets.map((asset) => { const isVideo = asset.media_type?.startsWith("video/"); return <article key={asset.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"><a href={asset.public_url} target="_blank" rel="noreferrer" className="relative block aspect-square bg-slate-100 dark:bg-slate-900">{isVideo ? <video src={asset.public_url} muted playsInline className="h-full w-full object-cover" /> : <img src={asset.public_url} alt={asset.alt_text || asset.filename} className="h-full w-full object-cover" loading="lazy" />}{isVideo && <span className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 text-white"><Video size={13} /></span>}</a><div className="p-3"><p className="truncate text-xs font-bold" title={asset.filename}>{asset.filename}</p><p className="mt-1 text-[10px] text-slate-400">{(asset.size_bytes / (1024 * 1024)).toFixed(1)} MB · {new Date(asset.created_at).toLocaleDateString()}</p><input aria-label={`Tag ${asset.filename}`} value={tags[asset.id] || ""} onChange={(event) => updateTag(asset.id, event.target.value)} placeholder="Add a tag" className="mt-2 w-full rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-[10px] outline-none focus:border-indigo-400 dark:border-slate-700" /><div className="mt-2 flex gap-2"><button type="button" onClick={() => onUseAsset?.(asset)} className={`${primary} min-w-0 flex-1 !px-2 !py-2 !text-[10px]`}><Plus size={12} />Use in composer</button><button type="button" title="Copy media URL" onClick={() => navigator.clipboard?.writeText(new URL(asset.public_url, window.location.origin).href)} className={`${button} !px-2`}><Copy size={13} /></button></div></div></article>; })}</div> : <EmptyState icon={UploadCloud} title={assets.length ? "No matching media" : "Your library is ready"} text={assets.length ? "Try another search or filter, or upload a new asset." : "Upload photos and videos here, then reuse them in the composer."} />}
  </section>;
}

function ApprovalsView({ request }) {
  const [items, setItems] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  async function refresh() { setLoading(true); try { const result = await request("/publish/approvals"); setItems(Array.isArray(result) ? result.filter(Boolean) : []); setError(""); } catch (e) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { void refresh(); }, [request]);
  async function decide(id, decision) { setBusy(id); try { await request(`/publish/approvals/${id}/decision`, { method: "POST", body: JSON.stringify({ decision }) }); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(""); } }
  return <section className={`${card} p-5 sm:p-6`}><div><span className="text-[10px] font-extrabold uppercase tracking-[.16em] text-indigo-500">Team review</span><h2 className="mt-1 font-display text-xl font-extrabold">Approvals</h2><p className="mt-1 text-xs text-slate-500">Review submitted posts before they move into the publishing queue.</p></div>{error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}{loading ? <p className="py-12 text-center text-xs text-slate-400">Loading approvals…</p> : items.length ? <div className="mt-5 space-y-3">{items.map((item) => <article key={item.id} className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800"><div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300">{item.media_urls?.[0] ? <img src={item.media_urls[0]} alt="" className="h-full w-full object-cover" /> : <MessageSquareText size={18} />}</div><div className="min-w-0 flex-1"><p className="line-clamp-2 text-xs leading-5">{item.content || "Untitled post"}</p><p className="mt-1 text-[10px] text-slate-400">Submitted {new Date(item.updated_at).toLocaleString()}</p></div><div className="flex gap-2"><button className={button} disabled={!!busy} onClick={() => void decide(item.id, "changes_requested")}>Request changes</button><button className={primary} disabled={!!busy} onClick={() => void decide(item.id, "approved")}>{busy === item.id ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}Approve</button></div></article>)}</div> : <EmptyState icon={Check} title="Nothing waiting for review" text="Posts submitted for approval will appear here." />}</section>;
}

function EmptyState({ icon: Icon, title, text, action, onClick }) {
  return <div className="grid justify-items-center py-14 text-center"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300"><Icon size={20} /></span><h3 className="mt-4 text-sm font-extrabold">{title}</h3><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{text}</p>{action && <button className={`${primary} mt-4`} onClick={onClick}><Plus size={14} />{action}</button>}</div>;
}

export default function PublishSection({ request, posts = [], accounts = [], authorName, localDrafts = [], onUpdateLocalDraft, onRemoveLocalDraft, onCreatePost, onOpenDraft, onUseAsset, onRefresh }) {
  const safePosts = Array.isArray(posts) ? posts.filter(Boolean) : [];
  const safeAccounts = Array.isArray(accounts) ? accounts.filter(Boolean) : [];
  const [active, setActive] = useState("calendar");
  const [selectedPost, setSelectedPost] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
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
  return <section className="animate-fade-up space-y-4 pb-10">
    <header className="relative overflow-hidden rounded-[30px] bg-gradient-to-br from-slate-950 via-indigo-950 to-blue-900 px-6 py-7 text-white shadow-[0_22px_70px_rgba(41,39,112,.16)] sm:px-8"><div className="absolute -right-12 -top-28 h-72 w-72 rounded-full bg-purple-500/20 blur-3xl" /><div className="relative flex flex-wrap items-end justify-between gap-4"><div><span className="text-[10px] font-extrabold uppercase tracking-[.18em] text-indigo-200">Plan and publish</span><h1 className="mt-2 font-display text-3xl font-extrabold tracking-[-.05em]">Your content, in motion.</h1><p className="mt-2 text-sm text-indigo-100/75">Shape your publishing rhythm across every connected channel.</p></div><div className="flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-indigo-100 backdrop-blur-xl"><LayoutGrid size={14} />Publishing workspace</div></div></header>
    <nav aria-label="Publish sections" className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/75 p-1.5 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/70">{TABS.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setActive(id)} aria-current={active === id ? "page" : undefined} className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-bold transition ${active === id ? "bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 text-white shadow-md shadow-indigo-500/20" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"}`}><Icon size={14} />{label}{id === "calendar" && safePosts.length > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${active === id ? "bg-white/20" : "bg-slate-100 dark:bg-slate-800"}`}>{safePosts.filter((post) => ["scheduled", "queued", "publishing"].includes(post.status)).length}</span>}</button>)}</nav>
    {active === "calendar" && <MonthCalendar posts={safePosts.filter((post) => post.scheduled_at && post.status !== "draft")} onCreatePost={onCreatePost} onSelectPost={openPost} />}
    {active === "drafts" && <DraftsView request={request} localDrafts={localDrafts} onUpdateLocalDraft={onUpdateLocalDraft} onRemoveLocalDraft={onRemoveLocalDraft} onCreatePost={onCreatePost} onOpenDraft={onOpenDraft} />}
    {active === "library" && <LibraryView request={request} onUseAsset={onUseAsset} />}
    {active === "approvals" && <ApprovalsView request={request} />}
    {isModalOpen && selectedPost && <RenderErrorBoundary scope="Post details modal" compact><ScheduledPostModal post={selectedPost} accounts={safeAccounts} authorName={authorName} request={request} onRefresh={onRefresh} onClose={() => { setIsModalOpen(false); setSelectedPost(null); }} /></RenderErrorBoundary>}
  </section>;
}

function toLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function NativePostPreview({ platform, accountName, authorName, content, mediaUrl, title, timestamp, format }) {
  const key = String(platform || "facebook").toLowerCase();
  const normalized = key === "twitter" ? "x" : key;
  const config = PREVIEW_CHANNELS[normalized] || PREVIEW_CHANNELS.facebook;
  const isVideo = /\.(mp4|mov|webm|m4v|ogv)(\?|$)/i.test(mediaUrl || "");
  const caption = content || "Your post caption will appear here.";
  const stamp = timestamp ? new Date(timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Just now";
  const name = accountName || authorName || "Your page";
  const avatar = name.trim().charAt(0).toUpperCase() || "S";
  const fallbackMedia = <div className="grid h-full min-h-40 place-items-center bg-gradient-to-br from-indigo-100 via-purple-100 to-blue-100 text-indigo-500 dark:from-indigo-950 dark:via-purple-950/70 dark:to-blue-950"><Image size={28} /></div>;
  const media = mediaUrl ? (isVideo ? <video src={mediaUrl} controls className="h-full w-full bg-black object-contain" /> : <img src={mediaUrl} alt={title || "Post media"} className="h-full w-full object-cover" />) : fallbackMedia;
  const avatarNode = <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 text-xs font-extrabold text-white">{avatar}</span>;
  const actions = (labels) => <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:text-slate-400">{labels.map(([Icon, label]) => <span key={label} className="inline-flex items-center gap-1.5"><Icon size={15} />{label}</span>)}</div>;

  if (normalized === "youtube") return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950">
    <div className={`relative aspect-video overflow-hidden bg-slate-950 ${/short/i.test(format || "") ? "mx-auto max-w-[230px] rounded-xl" : ""}`}>{media}<span className="pointer-events-none absolute inset-0 grid place-items-center"><span className="grid h-12 w-12 place-items-center rounded-full bg-black/60 text-white"><Play size={22} fill="currentColor" /></span></span><span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-1 text-[9px] font-bold text-white">{/short/i.test(format || "") ? "SHORT" : "PREVIEW"}</span></div>
    <div className="flex gap-3 p-4">{avatarNode}<div className="min-w-0 flex-1"><h3 className="line-clamp-2 text-sm font-extrabold">{title || caption.slice(0, 80) || "Untitled video"}</h3><p className="mt-1 text-[10px] text-slate-500">{name} · 0 views · {stamp}</p><p className="mt-3 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-slate-600 dark:text-slate-300">{caption}</p></div></div>
  </article>;

  if (normalized === "tiktok") return <article className="relative mx-auto aspect-[9/16] max-h-[620px] w-full max-w-[330px] overflow-hidden rounded-[28px] bg-black text-white shadow-xl ring-1 ring-white/10">{mediaUrl ? (isVideo ? <video src={mediaUrl} controls className="absolute inset-0 h-full w-full object-cover" /> : <img src={mediaUrl} alt={title || "TikTok post"} className="absolute inset-0 h-full w-full object-cover" />) : <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-slate-950 to-purple-950" />}<div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/25" /><div className="absolute left-4 right-14 top-5 flex justify-between text-xs font-bold"><span>Following</span><span className="text-white/60">|</span><span>For You</span></div><div className="absolute bottom-5 left-4 right-14"><p className="text-xs font-extrabold">@{name.replaceAll(" ", "").toLowerCase()}</p><p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5">{caption}</p><p className="mt-2 text-[10px] text-white/70">♪ Original sound · {stamp}</p></div><div className="absolute bottom-24 right-3 flex flex-col items-center gap-4 text-[9px]"><span className="grid h-10 w-10 place-items-center rounded-full bg-white/20 ring-2 ring-white">{avatar}</span><Heart size={23} /><MessageCircle size={22} /><Bookmark size={20} /><Share2 size={20} /></div></article>;

  if (normalized === "instagram") return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950">
    <header className="flex items-center gap-3 p-3">{avatarNode}<div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold">{name.replaceAll(" ", "").toLowerCase()}</p><p className="text-[10px] text-slate-500">{/reel|video/i.test(format || "") ? "Original audio" : stamp}</p></div><MoreHorizontal size={18} /></header>
    <div className={`overflow-hidden bg-slate-100 dark:bg-slate-900 ${/story/i.test(format || "") ? "aspect-[9/16] max-h-[480px]" : "aspect-square"}`}>{media}</div>
    <div className="p-3"><div className="flex items-center gap-4"><Heart size={20} /><MessageCircle size={20} /><Send size={19} className="-rotate-12" /><Bookmark size={19} className="ml-auto" /></div><p className="mt-3 text-[11px] font-extrabold">0 likes</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5"><b className="mr-1">{name.replaceAll(" ", "").toLowerCase()}</b>{caption}</p><p className="mt-2 text-[9px] uppercase text-slate-400">{stamp}</p></div>
  </article>;

  if (normalized === "x") return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950"><div className="flex gap-3">{avatarNode}<div className="min-w-0 flex-1"><p className="text-xs font-extrabold">{name} <span className="font-normal text-slate-500">@{name.replaceAll(" ", "").toLowerCase()} · {stamp}</span></p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{caption}</p>{mediaUrl && <div className="mt-3 max-h-80 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">{media}</div>}<div className="mt-4 flex max-w-sm justify-between text-slate-500"><MessageCircle size={16} /><Share2 size={16} /><Heart size={16} /><Bookmark size={16} /></div></div></div></article>;

  if (normalized === "linkedin") return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950"><header className="flex items-center gap-3 p-4">{avatarNode}<div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold">{name}</p><p className="text-[10px] text-slate-500">SocialStudio workspace · {stamp}</p></div><MoreHorizontal size={18} /></header><p className="whitespace-pre-wrap px-4 pb-4 text-xs leading-5">{caption}</p>{mediaUrl && <div className="max-h-80 overflow-hidden border-y border-slate-100 dark:border-slate-800">{media}</div>}<div className="px-4 py-2 text-[10px] text-slate-500">♡ 0 reactions · Be the first to react</div>{actions([[ThumbsUp, "Like"], [MessageCircle, "Comment"], [Share2, "Repost"], [Send, "Send"]])}</article>;

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
      return { key: String(account?.id || variant.id), post: variant, platform: normalized, label: brand.label, mark: brand.mark, brand: brand.brand, accountName: variant.preview_account_name || account?.account_name || brand.label };
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
    function onKeyDown(event) { if (event.key === "Escape" && !busy) onClose(); }
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [busy, onClose]);

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

  return createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !commentBusy) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="scheduled-post-title" className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white text-slate-900 shadow-[0_32px_100px_rgba(15,23,42,.20)] dark:border-slate-700 dark:bg-slate-900 dark:text-white">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-6"><div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-blue-600 text-sm font-extrabold text-white">{activeChannelOption.accountName.slice(0, 1).toUpperCase()}</span><div className="min-w-0"><div className="flex items-center gap-2"><h2 id="scheduled-post-title" className="font-display text-base font-extrabold">Post details</h2><span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[9px] font-bold capitalize text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-200">{activePost.status}</span></div><p className="truncate text-xs text-slate-500 dark:text-slate-400">{activeChannelOption.accountName} · {displayAuthor}</p></div></div><button type="button" onClick={onClose} aria-label="Close post preview" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"><X size={18} /></button></header>

      <div className="flex justify-end gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800 sm:px-6"><button type="button" disabled={!canEdit} title={canEdit ? "Edit this account’s post" : "Only draft and scheduled posts can be edited"} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 px-3 py-2 text-[11px] font-bold text-white shadow-md shadow-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => { if (editing) { setContent(activePost.content || ""); setScheduledAt(toLocalInputValue(activePost.scheduled_at)); } setEditing((value) => !value); setTab("details"); }}><Pencil size={13} />{editing ? "Cancel edit" : "Edit"}</button><button type="button" disabled={busy || !canDelete} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${confirmDelete ? "bg-rose-600 text-white" : "border border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40"}`} onClick={() => confirmDelete ? void deletePost() : setConfirmDelete(true)}>{busy && confirmDelete ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}{confirmDelete ? "Confirm delete" : "Delete"}</button></div>

      <div role="tablist" aria-label="Select post account" className="w-full max-w-full min-h-[54px] touch-pan-x overflow-x-auto overflow-y-hidden border-b border-slate-100 py-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:border-slate-800 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600">
        <div className="flex min-w-max flex-row items-center gap-2 whitespace-nowrap px-5 sm:px-6">{channelOptions.map((channel) => {
        const selected = activeChannelOption.key === channel.key;
        return <button key={channel.key} type="button" role="tab" aria-selected={selected} onClick={() => setActiveChannel(channel.key)} className={`channel-pill shrink-0 ${selected ? "channel-pill-active" : ""}`} style={{ "--channel-color": channel.brand }} title={`${channel.label} · ${channel.accountName}`}>
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
        {tab === "preview" ? <div className="mx-auto max-w-md"><NativePostPreview platform={activeChannelOption.platform} accountName={activeChannelOption.accountName} authorName={displayAuthor} content={activePost.content || ""} mediaUrl={mediaUrl} title={previewTitle} timestamp={previewTimestamp} format={activePost.post_format || activeMetadata.format || "Post"} /></div> : tab === "details" ? <div className="mx-auto max-w-lg space-y-5">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-bold text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200">{activeChannelOption.accountName} · {activeChannelOption.label}</span><span className="rounded-full bg-slate-100 px-3 py-1.5 text-[10px] font-bold capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">{activePost.status}</span></div>
          <label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold"><Clock3 size={14} className="text-indigo-500" />Scheduled time</span>{editing ? <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" /> : <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm dark:bg-slate-800/70">{new Date(activePost.scheduled_at).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}</div>}</label>
          <label className="block"><span className="mb-2 flex items-center justify-between gap-2 text-xs font-bold"><span className="flex items-center gap-2"><MessageSquareText size={14} className="text-indigo-500" />Caption for {activeChannelOption.label}</span><span className={`font-medium ${content.length > characterLimit ? "text-rose-500" : "text-slate-400"}`}>{content.length.toLocaleString()} / {characterLimit.toLocaleString()}</span></span>{editing ? <textarea rows={5} maxLength={characterLimit} value={content} onChange={(event) => setContent(event.target.value)} className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" /> : <div className="whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-3 text-sm leading-6 dark:bg-slate-800/70">{activePost.content || "No caption added."}</div>}</label>
          <label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold"><Tag size={14} className="text-indigo-500" />Targeted hashtags</span>{editing ? <input value={hashtags} onChange={(event) => setHashtags(event.target.value)} placeholder="#brand #campaign" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" /> : <div className="rounded-xl bg-slate-50 px-3 py-3 text-xs dark:bg-slate-800/70">{hashtags || "No platform-specific hashtags"}</div>}</label>
          <div className="grid gap-4 sm:grid-cols-2"><label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold"><Tag size={14} className="text-indigo-500" />Tags</span><select disabled={!editing} value={tag} onChange={(event) => setTag(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-indigo-400 disabled:opacity-75 dark:border-slate-700 dark:bg-slate-950"><option value="">No tag</option>{[...new Set([...(Array.isArray(activeMetadata.tags) ? activeMetadata.tags : []), "Campaign", "Evergreen", "Product launch", "Behind the scenes"])].filter(Boolean).map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold"><ShieldCheck size={14} className="text-indigo-500" />Privacy</span><select disabled={!editing} value={privacy} onChange={(event) => setPrivacy(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none focus:border-indigo-400 disabled:opacity-75 dark:border-slate-700 dark:bg-slate-950"><option>Public</option><option>Followers</option><option>Only me</option></select></label></div>
          <p className="text-[10px] text-slate-400">Caption, hashtags, tags, and settings save to this account’s post only. Publishing status is managed by the publishing service.</p>
          {editing && <div className="flex justify-end gap-2"><button type="button" className={button} onClick={() => { setEditing(false); setContent(activePost.content || ""); setScheduledAt(toLocalInputValue(activePost.scheduled_at)); setHashtags(Array.isArray(activeMetadata.hashtags) ? activeMetadata.hashtags.join(" ") : ""); setTag(activeMetadata.tags?.[0] || ""); setPrivacy(activeMetadata.privacy || "Public"); }}>Cancel</button><button type="button" disabled={busy || !scheduledAt || content.length > characterLimit} className={primary} onClick={() => void saveChanges()}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}Save changes</button></div>}
        </div> : <section className="mx-auto max-w-lg"><div className="mb-4"><h3 className="font-display text-sm font-extrabold">Team notes · {activeChannelOption.accountName}</h3><p className="mt-1 text-xs text-slate-500">These internal notes are attached only to this account’s scheduled post.</p></div>{commentsLoading ? <div className="grid min-h-32 place-items-center text-xs text-slate-400"><LoaderCircle className="animate-spin" size={18} /></div> : comments.length ? <div className="mb-5 space-y-4">{comments.map((comment) => { const name = comment.author_name || "Workspace member"; return <article key={comment.id} className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 text-[11px] font-extrabold text-white">{name.slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1 rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800/70"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="text-xs font-extrabold">{name}</p><time className="text-[10px] text-slate-400">{new Date(comment.created_at).toLocaleString()}</time></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-700 dark:text-slate-200">{comment.body}</p></div></article>; })}</div> : <div className="mb-5 rounded-2xl border border-dashed border-slate-200 py-10 text-center dark:border-slate-700"><span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300"><MessageSquareText size={17} /></span><p className="mt-3 text-xs font-bold">No notes for this account yet</p><p className="mt-1 text-[11px] text-slate-400">Leave feedback specific to {activeChannelOption.label}.</p></div>}<form onSubmit={addComment} className="rounded-2xl border border-slate-200 p-3 focus-within:border-indigo-300 dark:border-slate-700 dark:focus-within:border-indigo-700"><textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} rows={3} maxLength={5000} placeholder={`Internal note for ${activeChannelOption.label}…`} className="w-full resize-y bg-transparent px-1 py-1 text-xs leading-5 outline-none placeholder:text-slate-400" /><div className="mt-2 flex items-center justify-between"><span className="text-[10px] text-slate-400">Private workspace note</span><button type="submit" disabled={commentBusy || !commentText.trim()} className={primary}>{commentBusy ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}Add note</button></div></form></section>}
      </div>
      <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-[10px] text-slate-400 dark:border-slate-800 sm:px-6"><span>Post ID · {String(activePost.id).slice(0, 8)}</span><span>Workspace content · private</span></footer>
    </section>
  </div>, document.body);
}
