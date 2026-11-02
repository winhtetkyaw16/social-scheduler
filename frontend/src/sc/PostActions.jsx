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

/**
 * Plain-language failure copy. Prefers the server's `friendly_error`; the local
 * mirror below is only a fallback for older API responses. Only the generic
 * fallback quotes the (sanitized) platform message.
 */
export function friendlyError(post, account) {
  if (!post) return null;
  const fe = post.friendly_error;
  if (fe && typeof fe === "object" && fe.banner) return fe;
  if (post.status !== "failed") return null;
  const net = networkName(post, account) === "the network" ? "this network" : networkName(post, account);
  const p = String(account?.platform || post.preview_platform || "").toLowerCase();
  const raw = `${post.last_error_code || ""} ${post.last_error_message || ""}`.toLowerCase();
  const http = Number((raw.match(/http\s+(\d{3})/) || [])[1] || 0);
  const mk = (category, banner, what_happened, what_to_do, actions) => ({ category, network: net, banner, what_happened, what_to_do, actions });
  const media = Array.isArray(post.media_urls) ? post.media_urls : null;
  const has = (...n) => n.some((x) => raw.includes(x));
  const EDIT = [{ id: "edit", label: "Edit post" }];
  const RETRY = [{ id: "retry", label: "Retry now" }, { id: "reschedule", label: "Save & reschedule" }];
  const RECON = [{ id: "reconnect", label: `Reconnect ${net}`, target: "accounts" }, { id: "retry", label: "Retry now" }];
  if (p === "youtube" && has("requires a video", "not an image", "no video", "exactly one video", "text-only posts are not supported")) return mk("youtube_video_required", "YouTube needs a video — this post has no video.", "YouTube only publishes videos. Text-only and photo posts can't be uploaded.", "Add one video file to this post, or remove YouTube from it.", EDIT);
  if (p === "tiktok" && has("exactly one video", "no video", "video file is empty", "photo posting", "text-only posts are not supported")) return mk("tiktok_one_video", "TikTok needs exactly one video.", "TikTok posts from SocialCastly must contain one video. Text-only, photo, or multi-video posts aren't accepted.", "Keep exactly one video in this post (remove other files), then try again.", EDIT);
  if (p === "instagram" && /aspect.ratio/.test(raw)) return mk("instagram_aspect_ratio", "Instagram rejected this photo's shape (aspect ratio).", "Instagram only accepts photos between portrait 4:5 and landscape 1.91:1. This image is taller or wider than that.", "Crop the photo to square (1:1), portrait (4:5) or landscape (1.91:1), then try again.", [{ id: "crop", label: "Crop" }, ...EDIT]);
  if (p === "instagram" && has("exactly one public image", "exactly one image")) return media && media.length === 0
    ? mk("instagram_no_media", "Instagram needs at least one image or video; caption-only posts aren't allowed.", "This post only had a caption. Instagram doesn't publish text-only posts.", "Add one photo to the post (or remove Instagram), then try again.", EDIT)
    : mk("instagram_one_image", "Instagram needs exactly one image for this post.", "This post had more than one media file or a file type SocialCastly can't send to Instagram yet.", "Keep a single photo (JPG or PNG) and remove the rest, then try again.", EDIT);
  if (has("publicly fetchable", "public_base_url", "not publicly reachable")) return mk("media_not_public", `${net} couldn't reach your image — its link isn't public.`, `${net} downloads the image from a web link, but this file is only stored privately, so ${net} can't open it.`, "Use an image from the Media library on the live site (or any public image link), then try again.", EDIT);
  if (has("could not download", "could not pull", "media container failed", "could not fetch")) return mk("media_fetch_failed", `${net} couldn't download your media file.`, `${net} tried to fetch the image or video from its link and the download failed.`, "Check the file still opens, re-upload it, then try again.", [...EDIT, RETRY[0]]);
  if (has("timeout", "timed out", "still processing")) return mk("timeout", `${net} took too long to fetch your media and gave up.`, `${net} timed out while downloading or processing the attached file.`, "Try again. If it keeps failing, use a smaller file (or a photo instead of a video) and make sure the link is public.", RETRY);
  if (http === 402 || has("credits depleted", "credits-depleted", "payment required")) return p === "x" || p === "twitter"
    ? mk("x_credits_depleted", "X's posting limit for this connected account is used up.", "X refused the post because the posting allowance (credits) for this account's connection to X has run out. Your post itself is fine.", "Wait until X's allowance resets, or upgrade/top up the X plan used for this connection, then retry. You can also reschedule for later.", RETRY)
    : mk("rate_limited", `${net} is limiting how often this account can post right now.`, `Too many posts or requests were sent to ${net} in a short time.`, "Wait a while (usually 15–60 minutes) and retry, or reschedule for later.", RETRY);
  if (http === 429 || has("too many requests", "rate limit", "rate_limit")) return mk("rate_limited", `${net} is limiting how often this account can post right now.`, `Too many posts or requests were sent to ${net} in a short time.`, "Wait a while (usually 15–60 minutes) and retry, or reschedule for later.", RETRY);
  if (has("cannot call api for app", "app has been deleted", "app removed")) return mk("app_not_authorized", `${net} blocked SocialCastly for this account.`, `${net} says SocialCastly isn't authorized for this Page/account.`, `Reconnect ${net} and grant SocialCastly access to this Page/account, then retry.`, RECON);
  if (http === 401 || has("account_inactive", "token", "unauthorized", "session has expired", "revoked", "inactive", "invalid_grant")) return mk("connection_expired", `Your ${net} connection has expired or was revoked.`, `${net} no longer accepts SocialCastly's sign-in for this account.`, `Reconnect your ${net} account in Accounts, then retry the post.`, RECON);
  if (http === 403 || has("permission", "(#200)", "(#10)", "not authorized", "scope", "forbidden")) return mk("permission_missing", `SocialCastly doesn't have permission to post to this ${net} account.`, `${net} said the connection is missing a required permission.`, `Reconnect ${net} and allow all requested permissions and select this Page/account, then retry.`, RECON);
  if (has("duplicate") || (http === 422 && p === "linkedin")) return mk("duplicate_content", `${net} rejected this as a duplicate post.`, `${net} blocks posting the same text twice in a row from one account.`, "Change the caption a little (or wait before reposting), then try again.", EDIT);
  if (has("limited to", "too long", "character limit")) return mk("text_too_long", `The caption is too long for ${net}.`, `${net} limits how many characters a post can have, and this caption is over it.`, "Shorten the caption, then try again.", EDIT);
  if ((http >= 500 && http < 600) || has("service unavailable", "could not connect", "did not return", "without returning")) return mk("platform_unavailable", `${net} had a problem on its side and didn't publish the post.`, `${net} returned a server error or didn't confirm the post. This isn't something you did.`, "Retry in a few minutes. Check your profile first so you don't post twice.", RETRY);
  const said = sanitizeRaw(post.last_error_message);
  return mk("unknown", said && said.length < 110 ? `${net} rejected this post: ${said}` : said ? `${net} rejected this post. See details for the reason.` : `We couldn't post this to ${net}.`, said ? `The platform said: "${said}"` : `${net} didn't give a reason.`, "Fix what the message mentions and retry. If it doesn't make sense, contact us and include this message.", [{ id: "retry", label: "Retry now" }, { id: "contact", label: "Contact us" }]);
}

/** Strip tokens/URLs and internal prefixes from a provider message; max ~200 chars. */
export function sanitizeRaw(message) {
  let t = String(message || "").trim().replace(/^provider returned http \d{3}:?\s*/i, "");
  t = t.replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[hidden]").replace(/\b(access_token|refresh_token|client_secret|token|code|key|signature|sig)=[^&\s"']+/gi, "[hidden]").replace(/https?:\/\/\S+/gi, "[hidden]").replace(/[A-Za-z0-9_-]{32,}/g, "[hidden]");
  t = t.replace(/\s+/g, " ").replace(/^[\s|]+|[\s|]+$/g, "");
  return t.length > 200 ? `${t.slice(0, 199).trimEnd()}…` : t;
}

/** One-line failure text for rows, calendar cells and popovers. */
export function failedBannerText(post, account) {
  return friendlyError(post, account)?.banner || "We couldn't post this right now.";
}
