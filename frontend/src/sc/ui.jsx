import React from "react";

export const PLATFORM_META = {
  x: { cls: "ch-x", short: "X", chip: "c-x", ev: "x", label: "X" },
  linkedin: { cls: "ch-linkedin", short: "in", chip: "c-in", ev: "in", label: "LinkedIn" },
  instagram: { cls: "ch-instagram", short: "IG", chip: "c-ig", ev: "ig", label: "Instagram" },
  facebook: { cls: "ch-facebook", short: "f", chip: "", ev: "", label: "Facebook" },
  tiktok: { cls: "ch-tiktok", short: "♪", chip: "", ev: "", label: "TikTok" },
  youtube: { cls: "ch-youtube", short: "▶", chip: "", ev: "", label: "YouTube" },
  pinterest: { cls: "ch-pinterest", short: "P", chip: "", ev: "", label: "Pinterest" },
  threads: { cls: "ch-x", short: "@", chip: "", ev: "", label: "Threads" },
};
export function meta(platform) { return PLATFORM_META[platform] || { cls: "", short: (platform || "?").slice(0, 2), chip: "", ev: "", label: platform || "Channel" }; }
export function chColor(platform) { return `var(--ch-${platform === "threads" ? "x" : platform})`; }

export function Ch({ platform, size = "sm", style }) {
  const m = meta(platform);
  return <span className={`ch ${m.cls} ${size}`} title={platform} style={!m.cls ? { background: "var(--text-3)", ...style } : style}>{m.short}</span>;
}

const AV_COLORS = ["#4F46E5", "#0E7490", "#B45309", "#047857", "#7C3AED", "#BE185D"];
export function initials(name) { return (name || "?").replace(/^@/, "").split(/[\s._-]+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?"; }
export function Avatar({ name, size = 32, color, src }) {
  const c = color || AV_COLORS[Math.abs([...(name || "")].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % AV_COLORS.length];
  if (src) return <img className="avatar" src={src} alt="" style={{ width: size, height: size, objectFit: "cover" }} />;
  return <span className="avatar" style={{ background: c, width: size, height: size, fontSize: size >= 56 ? 20 : size <= 26 ? 10 : 12 }}>{initials(name)}</span>;
}
export function AccountAvatar({ account, size = 26 }) {
  return <span className="with-ch"><Avatar name={account?.account_name || account?.platform} size={size} src={account?.avatar_url || account?.profile_image_url || undefined} /><Ch platform={account?.platform} /></span>;
}

export function Ico({ d, children, style }) {
  return <svg className="ico" viewBox="0 0 24 24" style={style}>{d ? <path d={d} /> : children}</svg>;
}

export function StatusBadge({ status, post }) {
  const s = status === "published" && post && !post.provider_post_id ? "unconfirmed" : status;
  const cls = { published: "b-success", scheduled: "b-primary", queued: "b-info", publishing: "b-info", failed: "b-error", draft: "", unconfirmed: "b-warning", archived: "", pending: "b-warning", approved: "b-success", rejected: "b-error", changes_requested: "b-warning" }[s] || "";
  const label = { published: "Published", scheduled: "Scheduled", queued: "Queued", publishing: "Publishing", failed: "Failed", draft: "Draft", unconfirmed: "Unconfirmed", archived: "Archived", pending: "Pending review", approved: "Approved", rejected: "Rejected", changes_requested: "Changes requested" }[s] || s;
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function Empty({ title, text, action, onAction, art = "📭" }) {
  return <div className="empty"><div className="art"><span style={{ fontSize: 40 }}>{art}</span></div><h3>{title}</h3>{text && <p className="sm muted" style={{ maxWidth: 380 }}>{text}</p>}{action && <button type="button" className="btn btn-primary" onClick={onAction} style={{ marginTop: 6 }}>{action}</button>}</div>;
}

export function PageHead({ title, sub, children }) {
  return <div className="page-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="row">{children}</div></div>;
}

export function Seg({ value, onChange, options }) {
  return <div className="seg" role="tablist">{options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <a key={v} role="tab" aria-selected={value === v} className={value === v ? "active" : ""} onClick={() => onChange(v)} style={{ cursor: "pointer" }}>{l}</a>; })}</div>;
}

export function Tabs({ value, onChange, options }) {
  return <div className="tabs">{options.map(([v, l, count]) => <a key={v} className={value === v ? "active" : ""} onClick={() => onChange(v)} style={{ cursor: "pointer" }}>{l}{count != null && <span className="badge nodot" style={{ marginLeft: 6, padding: "0 7px" }}>{count}</span>}</a>)}</div>;
}

export function fmtTime(v) { return v ? new Date(v).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"; }
export function fmtTime24(v) { if (!v) return ""; const d = new Date(v); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; }
export function fmtDay(v) { return v ? new Date(v).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : ""; }
export function postTitle(post) { const t = (post?.title || post?.content || "Untitled post").split("\n")[0]; return t.length > 40 ? t.slice(0, 38) + "…" : t; }
