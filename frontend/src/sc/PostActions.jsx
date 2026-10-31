import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ch, AccountAvatar } from "./ui.jsx";

const svg = (p) => <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">{p}</svg>;
const ICO = {
  more: svg(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>),
  edit: svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>),
  trash: svg(<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />),
};
const MENU_W = 168;

export const NETWORK_NAMES = { facebook: "Facebook", instagram: "Instagram", x: "X", twitter: "X", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", pinterest: "Pinterest", threads: "Threads", bluesky: "Bluesky" };
export function networkName(post, account) {
  const p = String(account?.platform || post?.preview_platform || "").toLowerCase();
  return NETWORK_NAMES[p] || account?.platform || "the network";
}
/** True when DELETE /posts/:id will also delete the post on the provider (published with a real provider id). */
export function willRemoteDelete(post) { return Boolean(post?.provider_post_id) && !String(post.provider_post_id).startsWith("inbox:"); }
export function deleteCopy(post, network) {
  return willRemoteDelete(post)
    ? `It's removed from SocialCastly and also deleted from ${network}. If ${network} rejects the delete, the post stays here.`
    : `It's removed from SocialCastly only. Nothing was published, so nothing changes on ${network}.`;
}
export const canDeletePost = (post) => post?.status !== "publishing";

/** Ghost "⋯" button + small Edit / Delete dropdown (reuses .pp-menu). Portaled so card overflow never clips it. */
export function PostRowMenu({ post, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const close = (focus) => { setOpen(false); if (focus) btnRef.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return undefined;
    function place() {
      const b = btnRef.current; if (!b) return;
      const r = b.getBoundingClientRect(); const h = menuRef.current?.offsetHeight || 84;
      const left = Math.min(Math.max(8, r.right - MENU_W), window.innerWidth - MENU_W - 8);
      let top = r.bottom + 4; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - 4 - h);
      setPos({ left, top });
    }
    place();
    const onScroll = (e) => { if (menuRef.current && menuRef.current.contains(e.target)) return; setOpen(false); };
    window.addEventListener("resize", place); window.addEventListener("scroll", onScroll, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", onScroll, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return; setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(true); } };
    document.addEventListener("mousedown", onDown, true); window.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => menuRef.current?.querySelector("a")?.focus(), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown, true); window.removeEventListener("keydown", onKey, true); };
  }, [open]);
  const pick = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); fn?.(post); };
  const deletable = canDeletePost(post) && onDelete;
  return <>
    <button ref={btnRef} type="button" className="btn btn-sm btn-ghost btn-icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={open}
      onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>{ICO.more}</button>
    {open && createPortal(<div className="scd sc-row-menu-layer">
      <div ref={menuRef} className="pp-menu sc-row-menu" role="menu" aria-label="Post actions"
        style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault(); const items = [...menuRef.current.querySelectorAll("a")]; const i = items.indexOf(document.activeElement);
          items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
        }}>
        <a role="menuitem" href="#" onClick={pick(onEdit)}>{ICO.edit}Edit</a>
        {deletable && <><hr className="sc-menu-div" /><a role="menuitem" href="#" className="danger" onClick={pick(onDelete)}>{ICO.trash}Delete</a></>}
      </div>
    </div>, document.body)}
  </>;
}

function previewTime(v) {
  if (!v) return "No time set";
  try { const d = new Date(v); return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`; }
  catch { return String(v); }
}

/**
 * Confirm modal for deleting a post. Calls DELETE /posts/:id (backend deletes on the
 * network first when the post was published, and keeps the row if that fails).
 */
export function DeletePostModal({ post, account, request, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancelRef = useRef(null);
  const network = networkName(post, account);
  const remote = willRemoteDelete(post);
  useEffect(() => {
    const prev = document.activeElement;
    const t = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => { clearTimeout(t); try { prev?.focus?.({ preventScroll: true }); } catch { /* detached */ } };
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);
  async function confirm() {
    setBusy(true); setError("");
    try { await request(`/posts/${post.id}`, { method: "DELETE" }); await onDeleted?.(post, { remote, network }); onClose(); }
    catch (e) { setError(e?.message || "Could not delete this post."); setBusy(false); }
  }
  const when = post.published_at || post.scheduled_at || post.created_at;
  const platform = account?.platform || post.preview_platform;
  return createPortal(<div className="scd">
    <div className="modal-wrap sc-del-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal sc-del-modal" role="dialog" aria-modal="true" aria-labelledby="sc-del-title" aria-describedby="sc-del-text">
        <div className="col" style={{ padding: "24px 24px 20px", gap: 8 }}>
          <h2 id="sc-del-title">Delete this post?</h2>
          <p id="sc-del-text" className="sm muted">{remote
            ? `This will remove the post from SocialCastly and also delete it from ${network}. If ${network} rejects the delete, the post stays here. This can't be undone.`
            : "This will remove the post from your queue. This can't be undone."}</p>
          <div className="row sc-del-preview">
            <span className="with-ch"><AccountAvatar account={account} size={32} />{!account && platform && <Ch platform={platform} size="sm" />}</span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="xs subtle" style={{ marginBottom: 2 }}><b style={{ color: "var(--text)" }}>{account?.account_name || post.preview_account_name || network}</b> · {previewTime(when)}</div>
              <div className="sm sc-clamp2">{post.content || "Untitled post"}</div>
            </div>
          </div>
          {error && <div role="alert" className="alert error sm" style={{ marginTop: 6 }}><span className="grow">{error}</span></div>}
        </div>
        <div className="row sc-del-foot">
          <button ref={cancelRef} type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void confirm()}>{busy ? <span className="sc-spin" aria-hidden="true" /> : ICO.trash}{busy ? "Deleting…" : "Delete"}</button>
        </div>
      </div>
    </div>
  </div>, document.body);
}
