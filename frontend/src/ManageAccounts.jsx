// Connect, reconnect, and remove social accounts, and pick a destination after OAuth.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChannelTile, PLATFORM_GLYPHS, AccountIdentity } from "./sc/ui.jsx";
import { groupByNetwork, networkLabel } from "./accountCaptions.js";
import {
  FACEBOOK_CREATE_PAGE_URL,
  allSelected,
  cleanName,
  connectedLabel,
  footerStatus,
  isReauthRow,
  pickerMode,
  primaryAction,
  destinationSubtitle,
  initialSelection,
  pickerTitle,
  pickerSubtitle,
  selectableIds,
  selectionSummary,
  showSelectAll,
  toggleAll,
  toggleSelection,
} from "./pagePicker.js";
import { focusNoScroll, sharedScrollLock } from "./scrollLock.js";
import { modalLayerClass } from "./modalLayer.js";
import "./sc/fb-picker.css";
import {
  Check,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
  X as XIcon,
} from "lucide-react";

const TYPE_HINTS = {
  facebook:
    "Pages are primary. Personal profiles are not publishable. Groups appear only when Meta returns them.",
  instagram: "Business/Creator via Instagram Login (not personal).",
  x: "X user account.",
  linkedin: "Personal profile and Company/Organization Pages.",
  youtube: "YouTube Channel / Brand channel.",
  tiktok: "Creator or Business account.",
  pinterest: "User identity plus Boards as pin destinations.",
  threads: "Threads profile. Publishing available once connected.",
};

// "⋯" menu for a connected account row. items: [{ label, icon, danger?, onSelect }]
function AccountRowMenu({ items, disabled }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="pp-menu" role="menu" style={{ top: 36, right: 0 }}>
          {items.map(({ label, icon: Icon, danger, onSelect }) => (
            <a
              key={label}
              role="menuitem"
              href="#"
              className={danger ? "danger" : undefined}
              onClick={(event) => {
                event.preventDefault();
                setOpen(false);
                onSelect();
              }}
            >
              <Icon size={15} />
              {label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function BrandThumb({ channelId, ChannelBrandImage, size = 24 }) {
  if (typeof ChannelBrandImage === "function") {
    return <ChannelBrandImage channelId={channelId} size={size} />;
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold uppercase dark:bg-slate-800"
      style={{ width: size, height: size }}
    >
      {(channelId || "?").slice(0, 2)}
    </span>
  );
}

function resolveAvatarUrl(account) {
  if (!account || typeof account !== "object") return "";
  if (typeof account.avatar_url === "string" && account.avatar_url.trim())
    return account.avatar_url.trim();
  const meta =
    account.extra_metadata && typeof account.extra_metadata === "object"
      ? account.extra_metadata
      : {};
  for (const key of [
    "avatar_url",
    "profile_image_url",
    "profile_picture_url",
    "threads_profile_picture_url",
    "profile_image",
    "picture",
  ]) {
    const value = meta[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) return value.trim();
    if (value && typeof value === "object") {
      const nested = value.data && typeof value.data === "object" ? value.data : value;
      if (typeof nested?.url === "string" && /^https?:\/\//i.test(nested.url.trim()))
        return nested.url.trim();
    }
  }
  return "";
}

/** Circular profile photo (or initials) with platform brand badge bottom-right. */
const failedSinceConnect = (account, posts) => {
  const c = Date.parse(account.extra_metadata?.connected_at || account.created_at || 0) || 0;
  return posts.some(
    (post) =>
      post.connected_account_id === account.id &&
      post.status === "failed" &&
      (Date.parse(post.updated_at || post.created_at) || 0) >= c,
  );
};
export function AccountAvatar({
  account,
  ChannelBrandImage,
  size = 36,
  badgeScale = 0.42,
  showBadge = true,
}) {
  const [broken, setBroken] = useState(false);
  const url = resolveAvatarUrl(account);
  const name = String(account?.account_name || account?.display_name || "?").trim();
  const initial = (name.charAt(0) || "?").toUpperCase();
  const platform = account?.platform || "";
  const showPhoto = Boolean(url) && !broken;
  const badge = Math.max(12, Math.round(size * badgeScale));

  useEffect(() => {
    setBroken(false);
  }, [url]);

  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
      title={name}
    >
      {showPhoto ? (
        <img
          src={url}
          alt=""
          onError={() => setBroken(true)}
          className="h-full w-full rounded-full object-cover bg-slate-100 ring-1 ring-slate-200/80 dark:bg-slate-800 dark:ring-slate-700"
        />
      ) : (
        <span
          className="grid h-full w-full place-items-center rounded-full bg-slate-200 font-semibold text-slate-600 ring-1 ring-slate-200/80 dark:bg-slate-700 dark:text-slate-100 dark:ring-slate-600"
          style={{ fontSize: Math.max(11, Math.round(size * 0.36)) }}
        >
          {initial}
        </span>
      )}
      {showBadge ? (
        PLATFORM_GLYPHS[platform === "twitter" ? "x" : platform] ? (
          <ChannelTile platform={platform} size={badge} className="av-badge" />
        ) : (
          <span className="pointer-events-none absolute bottom-[-2px] right-[-2px] rounded-full bg-white p-[1px] shadow-sm ring-1 ring-white dark:bg-slate-950 dark:ring-slate-900">
            <BrandThumb channelId={platform} ChannelBrandImage={ChannelBrandImage} size={badge} />
          </span>
        )
      ) : null}
    </span>
  );
}

function usePickerMobile() {
  const query = "(max-width: 767px)";
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches),
  );
  useEffect(() => {
    const mq = typeof window !== "undefined" ? window.matchMedia?.(query) : null;
    if (!mq) return undefined;
    const on = () => setMobile(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return mobile;
}

function PickerMark({ platform, ChannelBrandImage, size }) {
  if (PLATFORM_GLYPHS[platform])
    return <ChannelTile platform={platform} size={size} className="fbp-mark" />;
  return <BrandThumb channelId={platform} ChannelBrandImage={ChannelBrandImage} size={size} />;
}

/** Post-OAuth destination picker ("Choose Facebook Pages"): modal on desktop, bottom sheet on mobile. */
export function DestinationPicker({
  platform,
  sessionId,
  request,
  onClose,
  onSaved,
  channelMeta,
  ChannelBrandImage,
  reauthId = "",
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [destinations, setDestinations] = useState([]);
  const [selected, setSelected] = useState([]);
  const [attempt, setAttempt] = useState(0);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const mobile = usePickerMobile();
  const label = channelMeta?.label || platform;
  const mode = pickerMode({ reauthId, destinations });
  const action = primaryAction(mode, selected, destinations);
  const status = footerStatus(selected, destinations);
  const cancel = () => {
    if (!saving) onClose?.();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await request(`/accounts/oauth/pick/${sessionId}`);
        if (cancelled) return;
        const list = Array.isArray(data?.destinations) ? data.destinations : [];
        setDestinations(list);
        // Re-auth: nothing new is pre-ticked, so the primary action reads "Reconnect".
        setSelected(reauthId ? [] : initialSelection(list));
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load destinations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, sessionId, request, attempt, reauthId]);

  // Body scroll lock, initial focus on Close, Esc = Cancel, focus trap.
  useEffect(() => {
    const lock = sharedScrollLock();
    lock.lock();
    focusNoScroll(closeRef.current);
    return () => lock.unlock();
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [
        ...dialogRef.current.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]'),
      ];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        focusNoScroll(last);
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        focusNoScroll(first);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const toggle = (id) => setSelected((current) => toggleSelection(current, id, destinations));

  const save = async () => {
    if (!action.enabled) return;
    setSaving(true);
    setError("");
    try {
      // refresh_existing: the server refreshes stored tokens/scopes of already-connected destinations now.
      await request("/accounts/oauth/pick", {
        method: "POST",
        body: JSON.stringify({
          pick_session_id: sessionId,
          destination_ids: action.ids,
          refresh_existing: action.refreshExisting,
        }),
      });
      onSaved?.(platform, { mode, added: action.ids.length });
      onClose?.();
    } catch (err) {
      setError(err.message || "Could not save destinations.");
    } finally {
      setSaving(false);
    }
  };

  // Mobile: drag the sheet down by its handle/header to dismiss without saving.
  const onDragStart = (event) => {
    if (mobile) dragStart.current = event.clientY;
  };
  const onDragMove = (event) => {
    if (dragStart.current != null) setDrag(Math.max(0, event.clientY - dragStart.current));
  };
  const onDragEnd = () => {
    if (dragStart.current == null) return;
    dragStart.current = null;
    if (drag > 90) cancel();
    setDrag(0);
  };

  const empty = !loading && !error && destinations.length === 0;
  const isFb = platform === "facebook";
  const markSize = mobile ? 24 : 28;

  const body = loading ? (
    <div className="fbp-state">
      <LoaderCircle size={18} className="animate-spin" />{" "}
      <span className="sm subtle">Loading Pages…</span>
    </div>
  ) : error && !destinations.length ? (
    <div className="fbp-empty">
      <p role="alert" className="sm fbp-err">
        {error}
      </p>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setAttempt((n) => n + 1)}
      >
        <RefreshCw size={14} />
        Try again
      </button>
    </div>
  ) : empty ? (
    <div className="fbp-empty">
      <PickerMark platform={platform} ChannelBrandImage={ChannelBrandImage} size={48} />
      <h3>{isFb ? "No Facebook Pages found" : `No ${label} destinations found`}</h3>
      <p className="sm subtle">
        {isFb
          ? "You need a Facebook Page to post from SocialCastly. Personal profiles can't be used."
          : "Nothing to post to was returned for this login."}
      </p>
      {isFb && (
        <a
          className="fbp-link sm"
          href={FACEBOOK_CREATE_PAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Create a Page on Facebook
        </a>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setAttempt((n) => n + 1)}
      >
        <RefreshCw size={14} />
        Try again
      </button>
    </div>
  ) : (
    <>
      {showSelectAll(destinations) && (
        <button
          type="button"
          className="fbp-selall"
          onClick={() => setSelected((current) => toggleAll(current, destinations))}
        >
          {allSelected(selected, destinations) ? "Clear selection" : "Select all"}
        </button>
      )}
      <ul
        className="fbp-list"
        role="listbox"
        aria-multiselectable="true"
        aria-label={pickerTitle(platform, label)}
      >
        {destinations.map((item) => {
          const id = String(item.id);
          const added = Boolean(item.already_connected);
          const on = !added && selected.includes(id);
          const hl = isReauthRow(item, reauthId);
          const showConnected = added && mode === "reconnect";
          const account = {
            ...item,
            account_name: cleanName(item.name),
            platform: item.platform || platform,
          };
          return (
            <li
              key={id}
              role="option"
              aria-selected={on}
              aria-disabled={added || undefined}
              tabIndex={added ? -1 : 0}
              className={`fbp-row${on ? " on" : ""}${added ? " dis" : ""}${showConnected ? " conn" : ""}${hl ? " hl" : ""}`}
              onClick={() => {
                if (!added) toggle(id);
              }}
              onKeyDown={(event) => {
                if (!added && (event.key === " " || event.key === "Enter")) {
                  event.preventDefault();
                  toggle(id);
                }
              }}
            >
              <AccountAvatar
                account={account}
                ChannelBrandImage={ChannelBrandImage}
                size={40}
                badgeScale={0.5}
              />
              <span className="fbp-t">
                <span className="fbp-n">{cleanName(item.name)}</span>
                <span className="fbp-s">{destinationSubtitle(item, platform)}</span>
              </span>
              {showConnected ? (
                <>
                  <span className="fbp-tag">{connectedLabel(mode)}</span>
                  <span className="fbp-ck fbp-ck-on" aria-hidden="true">
                    <Check size={13} strokeWidth={3} />
                  </span>
                </>
              ) : added ? (
                <span className="fbp-tag">{connectedLabel(mode)}</span>
              ) : (
                <span className="fbp-ck" aria-hidden="true">
                  {on && <Check size={13} strokeWidth={3} />}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );

  const busyLabel = mode === "connect" ? "Adding…" : "Saving…";
  const addBtn = (
    <button
      type="button"
      className="btn btn-grad fbp-add"
      disabled={saving || loading || !action.enabled}
      onClick={() => void save()}
    >
      {saving ? busyLabel : action.label}
    </button>
  );
  const allAddedNote =
    mode === "all-added" ? (
      <p className="sm subtle fbp-note">All your Pages are already added.</p>
    ) : null;
  const cancelBtn = (
    <button type="button" className="btn btn-secondary" onClick={cancel} disabled={saving}>
      Cancel
    </button>
  );

  const dialog = (
    <div
      className={`fbp-wrap${mobile ? " m" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div
        ref={dialogRef}
        className="fbp"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fbp-title"
        style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}
      >
        {mobile && (
          <div
            className="fbp-grab"
            aria-hidden="true"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <i />
          </div>
        )}
        <header
          className="fbp-h"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <PickerMark platform={platform} ChannelBrandImage={ChannelBrandImage} size={markSize} />
          <div className="fbp-ht">
            <h2 id="fbp-title">{pickerTitle(platform, label)}</h2>
            <p className="sm subtle">{pickerSubtitle(platform)}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={cancel}
            className="btn btn-ghost btn-icon btn-sm fbp-x"
            aria-label="Close"
          >
            <XIcon size={17} />
          </button>
        </header>
        <div className="fbp-b">
          {body}
          {!loading && allAddedNote}
        </div>
        {error && destinations.length > 0 && (
          <p role="alert" className="sm fbp-err fbp-err-inline">
            {error}
          </p>
        )}
        <footer className="fbp-f">
          {mode === "all-added" && !loading ? (
            mobile ? (
              <>{addBtn}</>
            ) : (
              <>
                <span className="fbp-count" />
                {addBtn}
              </>
            )
          ) : mobile ? (
            <>
              {addBtn}
              {cancelBtn}
              {status && !loading && <span className="xs subtle fbp-count">{status}</span>}
            </>
          ) : (
            <>
              <span className="xs subtle fbp-count">{loading || empty ? "" : status}</span>
              {cancelBtn}
              {addBtn}
            </>
          )}
        </footer>
      </div>
    </div>
  );
  if (typeof document === "undefined") return dialog;
  return createPortal(
    <div className={modalLayerClass(document, "fbp-layer")}>{dialog}</div>,
    document.body,
  );
}

export default function ManageAccounts({
  accounts = [],
  channels = [],
  request,
  onConnect,
  onChanged,
  ChannelBrandImage,
  posts = [],
  ownerName = "",
  publishablePlatforms = new Set([
    "x",
    "linkedin",
    "instagram",
    "facebook",
    "youtube",
    "tiktok",
    "pinterest",
    "threads",
  ]),
}) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const channelById = useMemo(
    () => Object.fromEntries(channels.map((channel) => [channel.id, channel])),
    [channels],
  );
  const sorted = useMemo(
    () =>
      [...accounts].sort(
        (a, b) =>
          String(a.platform).localeCompare(String(b.platform)) ||
          String(a.account_name).localeCompare(String(b.account_name)),
      ),
    [accounts],
  );

  const run = async (accountId, action) => {
    setBusyId(accountId);
    setError("");
    try {
      if (action === "disconnect") {
        await request(`/accounts/${accountId}/deactivate`, { method: "PATCH" });
      } else if (action === "reconnect") {
        await request(`/accounts/${accountId}/activate`, { method: "PATCH" });
      } else if (action === "remove") {
        await request(`/accounts/${accountId}`, { method: "DELETE" });
      }
      await onChanged?.();
    } catch (err) {
      setError(err.message || "Account update failed.");
    } finally {
      setBusyId("");
    }
  };

  const DAY = 864e5;
  const noticeFor = (account) => {
    if (!account?.is_active) return "";
    if (account.needs_reconnect) {
      return (
        account.reconnect_reason ||
        account.connection_warning ||
        "This account needs to be reconnected before scheduled posts can publish."
      );
    }
    if (account.connection_warning) return account.connection_warning;
    if ("connection_warning" in account) return "";
    const exp = account.token_expires_at ? new Date(account.token_expires_at) : null;
    if (exp && !account.has_refresh_token && exp - Date.now() < 7 * DAY) {
      const when = exp.toLocaleDateString([], { month: "short", day: "numeric" });
      const state = exp < new Date() ? "has expired" : `expires ${when}`;
      const label = channelById[account.platform]?.label || account.platform;
      return `${label} access ${state}. Reconnect to keep scheduled posts publishing.`;
    }
    return "";
  };
  const health = (account) => {
    if (!account.is_active) return ["Disconnected", ""];
    if (account.needs_reconnect) return ["Needs reconnect", "b-error"];
    if (account.connection_warning) return ["Reconnect soon", "b-warning"];
    const exp = account.token_expires_at ? new Date(account.token_expires_at) : null;
    if (exp && exp < new Date() && !account.has_refresh_token && !("connection_warning" in account))
      return ["Reconnect needed", "b-error"];
    if (
      exp &&
      !account.has_refresh_token &&
      exp - Date.now() < 7 * DAY &&
      !("connection_warning" in account)
    )
      return [
        `Reconnect within ${Math.max(1, Math.ceil((exp - Date.now()) / DAY))} days`,
        "b-warning",
      ];
    if (failedSinceConnect(account, posts)) return ["Publish errors", "b-error"];
    return ["Healthy", "b-success"];
  };
  const expiring = sorted.filter((account) => noticeFor(account));
  const posts30 = (account) =>
    posts.filter(
      (post) =>
        post.connected_account_id === account.id &&
        post.status !== "draft" &&
        Date.now() - new Date(post.published_at || post.scheduled_at || post.created_at) < 30 * DAY,
    ).length;
  const ownerInitials = (ownerName || "You")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const desc = {
    x: "Threads & text",
    linkedin: "Profiles & pages",
    instagram: "Business accounts",
    facebook: "Pages",
    youtube: "Channel uploads",
    tiktok: "Creator accounts",
    pinterest: "Boards & pins",
    threads: "Text posts",
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Channels</h1>
          <p className="muted">Connect as many accounts per network as you like.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => onConnect?.()}>
          <Plus size={16} />
          Connect channel
        </button>
      </div>
      {expiring.map((account) => (
        <div key={account.id} className="alert warning" role="status">
          <svg className="ico" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <div className="grow sm">
            <b>{noticeFor(account)}</b>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => onConnect?.(channelById[account.platform])}
          >
            Reconnect
          </button>
        </div>
      ))}
      {error && (
        <div role="alert" className="alert error sm">
          {error}
        </div>
      )}
      {sorted.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="art">
              <Link2 size={26} />
            </div>
            <h2>No channels yet</h2>
            <p className="muted sm">Connect a network below to start scheduling.</p>
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {groupByNetwork(sorted).map((group) => {
            const channel = channelById[group.platform] || {
              label: networkLabel(group.platform),
              id: group.platform,
            };
            const n = group.accounts.length;
            return (
              <div key={group.platform} className="card netg">
                <div className="netg-h">
                  <BrandThumb
                    channelId={group.platform}
                    ChannelBrandImage={ChannelBrandImage}
                    size={28}
                  />
                  <b className="grow">{channel.label}</b>
                  <span className="n">
                    {n} account{n === 1 ? "" : "s"}
                  </span>
                </div>
                {group.accounts.map((account) => {
                  const busy = busyId === account.id;
                  const typeLabel =
                    group.platform === "facebook"
                      ? "Facebook Page"
                      : account.account_type_label ||
                        account.account_type ||
                        `${channel.label} account`;
                  const [label, cls] = health(account);
                  const count = posts30(account);
                  const needsReauth =
                    account.is_active && (cls === "b-error" || cls === "b-warning");
                  const reauth = () =>
                    onConnect?.(channel, { reauthId: account.platform_account_id });
                  const menuItems = account.is_active
                    ? [
                        { label: "Reconnect", icon: RefreshCw, onSelect: reauth },
                        {
                          label: "Disconnect",
                          icon: Unplug,
                          onSelect: () => void run(account.id, "disconnect"),
                        },
                        {
                          label: "Remove",
                          icon: Trash2,
                          danger: true,
                          onSelect: () => void run(account.id, "remove"),
                        },
                      ]
                    : [
                        {
                          label: "Reconnect",
                          icon: RefreshCw,
                          onSelect: () => void run(account.id, "reconnect"),
                        },
                        {
                          label: "Remove",
                          icon: Trash2,
                          danger: true,
                          onSelect: () => void run(account.id, "remove"),
                        },
                      ];
                  return (
                    <div key={account.id} className="netg-r">
                      <AccountIdentity
                        account={account}
                        all={sorted}
                        size={36}
                        sub={`${typeLabel} \u00b7 ${account.can_publish ? "" : "Can't post here yet \u00b7 "}${count} post${count === 1 ? "" : "s"} in the last 30 days`}
                      />
                      {!account.is_active ? (
                        <span className="badge">Disconnected</span>
                      ) : cls === "b-error" ? (
                        <span className="badge b-error" title={label}>
                          Needs reconnecting
                        </span>
                      ) : (
                        <span className={`badge ${cls}`}>
                          {label === "Healthy" ? "Connected" : label}
                        </span>
                      )}
                      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                        {busy && <LoaderCircle size={14} className="animate-spin" />}
                        {(needsReauth || !account.is_active) && (
                          <button
                            type="button"
                            disabled={busy}
                            className="btn btn-sm btn-secondary"
                            onClick={
                              account.is_active ? reauth : () => void run(account.id, "reconnect")
                            }
                          >
                            <RefreshCw size={14} />
                            Reconnect
                          </button>
                        )}
                        <AccountRowMenu items={menuItems} disabled={busy} />
                      </div>
                    </div>
                  );
                })}
                {publishablePlatforms.has(group.platform) && (
                  <button type="button" className="netg-add" onClick={() => onConnect?.(channel)}>
                    <Plus size={14} />
                    Add another {channel.label} account
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <h2>Add a channel</h2>
      <div className="grid g3">
        {channels.map((channel) => {
          const publishable = publishablePlatforms.has(channel.id);
          const count = accounts.filter(
            (account) => account.platform === channel.id && account.is_active,
          ).length;
          return (
            <div
              key={channel.id}
              className="card row"
              style={{ padding: 16, gap: 12, opacity: publishable ? 1 : 0.7 }}
            >
              <BrandThumb channelId={channel.id} ChannelBrandImage={ChannelBrandImage} size={36} />
              <div className="grow">
                <b>{channel.label}</b>
                <div className="xs muted">
                  {publishable
                    ? count
                      ? `${count} connected`
                      : desc[channel.id] || "Ready to connect"
                    : "Can't post here yet"}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => onConnect?.(channel)}
              >
                Connect
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
