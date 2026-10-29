import React, { useEffect, useMemo, useState } from "react";
import { Check, Link2, LoaderCircle, Plus, RefreshCw, Unplug, X as XIcon } from "lucide-react";

const TYPE_HINTS = {
  facebook: "Pages are primary. Personal profiles are not publishable. Groups appear only when Meta returns them.",
  instagram: "Business/Creator via Instagram Login (not personal).",
  x: "X user account.",
  linkedin: "Personal profile and Company/Organization Pages.",
  youtube: "YouTube Channel / Brand channel.",
  tiktok: "Creator/Business for the Content Posting API.",
  pinterest: "User identity plus Boards as pin destinations.",
  threads: "Threads profile (Meta Threads API). Publishing available once connected.",
};

function BrandThumb({ channelId, ChannelBrandImage, size = 24 }) {
  if (typeof ChannelBrandImage === "function") {
    return <ChannelBrandImage channelId={channelId} size={size} />;
  }
  return <span className="inline-flex items-center justify-center rounded-lg bg-slate-100 text-[10px] font-extrabold uppercase dark:bg-slate-800" style={{ width: size, height: size }}>{(channelId || "?").slice(0, 2)}</span>;
}

function resolveAvatarUrl(account) {
  if (!account || typeof account !== "object") return "";
  if (typeof account.avatar_url === "string" && account.avatar_url.trim()) return account.avatar_url.trim();
  const meta = account.extra_metadata && typeof account.extra_metadata === "object" ? account.extra_metadata : {};
  for (const key of ["avatar_url", "profile_image_url", "profile_picture_url", "threads_profile_picture_url", "profile_image", "picture"]) {
    const value = meta[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) return value.trim();
    if (value && typeof value === "object") {
      const nested = value.data && typeof value.data === "object" ? value.data : value;
      if (typeof nested?.url === "string" && /^https?:\/\//i.test(nested.url.trim())) return nested.url.trim();
    }
  }
  return "";
}

/** Circular profile photo (or initials) with platform brand badge bottom-right. */
export function AccountAvatar({ account, ChannelBrandImage, size = 36, badgeScale = 0.42, showBadge = true }) {
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
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} title={name}>
      {showPhoto ? (
        <img
          src={url}
          alt=""
          onError={() => setBroken(true)}
          className="h-full w-full rounded-full object-cover bg-slate-100 ring-1 ring-slate-200/80 dark:bg-slate-800 dark:ring-slate-700"
        />
      ) : (
        <span
          className="grid h-full w-full place-items-center rounded-full bg-slate-200 font-extrabold text-slate-600 ring-1 ring-slate-200/80 dark:bg-slate-700 dark:text-slate-100 dark:ring-slate-600"
          style={{ fontSize: Math.max(11, Math.round(size * 0.36)) }}
        >
          {initial}
        </span>
      )}
      {showBadge ? (
        <span className="pointer-events-none absolute bottom-[-2px] right-[-2px] rounded-full bg-white p-[1px] shadow-sm ring-1 ring-white dark:bg-slate-950 dark:ring-slate-900">
          <BrandThumb channelId={platform} ChannelBrandImage={ChannelBrandImage} size={badge} />
        </span>
      ) : null}
    </span>
  );
}

export function DestinationPicker({
  platform,
  sessionId,
  request,
  onClose,
  onSaved,
  channelMeta,
  ChannelBrandImage,
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState("");
  const [destinations, setDestinations] = useState([]);
  const [selected, setSelected] = useState([]);
  const label = channelMeta?.label || platform;

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
        setNotes(data?.notes || TYPE_HINTS[platform] || "");
        setSelected(list.map((item) => item.id));
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load destinations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, sessionId, request]);

  const toggle = (id) => {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const save = async () => {
    if (!selected.length) {
      setError("Select at least one destination.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await request("/accounts/oauth/pick", {
        method: "POST",
        body: JSON.stringify({ pick_session_id: sessionId, destination_ids: selected }),
      });
      onSaved?.(platform);
      onClose?.();
    } catch (err) {
      setError(err.message || "Could not save destinations.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-wrap sc-modal-wrap" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose?.(); }}>
      <div className="modal sc-modal max-w-lg" role="dialog" aria-modal="true" aria-labelledby="pick-title">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <BrandThumb channelId={platform} ChannelBrandImage={ChannelBrandImage} />
            <div>
              <span className="xs muted sc-eyebrow">CHOOSE DESTINATIONS</span>
              <h2 id="pick-title" className="mt-1  text-xl font-extrabold">Connect {label}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{notes}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-icon" aria-label="Close destination picker"><XIcon size={17} /></button>
        </div>
        {loading ? (
          <div className="mt-6 flex items-center justify-center gap-2 py-10 text-xs font-semibold text-slate-500">
            <LoaderCircle size={16} className="animate-spin" /> Loading destinations…
          </div>
        ) : error && !destinations.length ? (
          <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>
        ) : (
          <ul className="mt-4 max-h-72 space-y-1 overflow-y-auto rounded-2xl border border-slate-200/80 p-2 dark:border-slate-700">
            {destinations.map((item) => {
              const checked = selected.includes(item.id);
              return (
                <li key={item.id}>
                  <label className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition ${checked ? "bg-indigo-50 dark:bg-indigo-950/40" : "hover:bg-slate-50 dark:hover:bg-slate-900"}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(item.id)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-extrabold text-slate-900 dark:text-slate-100">{item.name}</span>
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.platform && item.platform !== platform ? `${item.platform} · ` : ""}{item.account_type}{item.category ? ` · ${item.category}` : ""}</span>
                    </span>
                    {checked && <Check size={14} className="text-indigo-600" />}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {error && destinations.length > 0 && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary !px-5 !py-2.5" disabled={saving || loading || !destinations.length} onClick={() => void save()}>
            {saving ? "Saving…" : `Save ${selected.length || 0} destination${selected.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
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
  publishablePlatforms = new Set(["x", "linkedin", "instagram", "facebook", "youtube", "tiktok", "pinterest", "threads"]),
}) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const channelById = useMemo(() => Object.fromEntries(channels.map((channel) => [channel.id, channel])), [channels]);
  const sorted = useMemo(
    () => [...accounts].sort((a, b) => String(a.platform).localeCompare(String(b.platform)) || String(a.account_name).localeCompare(String(b.account_name))),
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
  const health = (account) => {
    if (!account.is_active) return ["Disconnected", ""];
    const exp = account.token_expires_at ? new Date(account.token_expires_at) : null;
    if (exp && exp < new Date()) return ["Token expired", "b-error"];
    if (exp && exp - Date.now() < 7 * DAY) return [`Reconnect in ${Math.max(1, Math.ceil((exp - Date.now()) / DAY))} days`, "b-warning"];
    if (posts.some((post) => post.connected_account_id === account.id && post.status === "failed")) return ["Publish errors", "b-error"];
    return ["Healthy", "b-success"];
  };
  const expiring = sorted.filter((account) => account.is_active && account.token_expires_at && new Date(account.token_expires_at) - Date.now() < 7 * DAY);
  const posts30 = (account) => posts.filter((post) => post.connected_account_id === account.id && post.status !== "draft" && Date.now() - new Date(post.published_at || post.scheduled_at || post.created_at) < 30 * DAY).length;
  const ownerInitials = (ownerName || "You").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const desc = { x: "Threads & text", linkedin: "Profiles & pages", instagram: "Business accounts", facebook: "Pages", youtube: "Channel uploads", tiktok: "Creator accounts", pinterest: "Boards & pins", threads: "Text posts" };

  return (
    <>
      <div className="page-head"><div><h1>Channels</h1><p className="muted">Manage connected accounts and their publishing health.</p></div><button type="button" className="btn btn-primary" onClick={() => onConnect?.()}><Plus size={16} />Connect channel</button></div>
      {expiring.map((account) => <div key={account.id} className="alert warning"><svg className="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg><div className="grow sm"><b>{channelById[account.platform]?.label || account.platform} access {new Date(account.token_expires_at) < new Date() ? "expired" : "expires"} {new Date(account.token_expires_at).toLocaleDateString([], { month: "short", day: "numeric" })}.</b> <span className="muted">Reconnect to keep scheduled posts publishing.</span></div><button type="button" className="btn btn-sm btn-secondary" onClick={() => onConnect?.(channelById[account.platform])}>Reconnect</button></div>)}
      {error && <div role="alert" className="alert error sm">{error}</div>}
      <div className="card" style={{ overflow: "hidden" }}>
        {sorted.length === 0 ? <div className="empty"><div className="art"><Link2 size={26} /></div><h2>No channels yet</h2><p className="muted sm">Connect a network below to start scheduling.</p></div> : <table className="table"><thead><tr><th>Account</th><th>Network</th><th>Status</th><th>Posts (30d)</th><th>Connected by</th><th /></tr></thead><tbody>
          {sorted.map((account) => {
            const channel = channelById[account.platform] || { label: account.platform, id: account.platform };
            const busy = busyId === account.id;
            const typeLabel = account.account_type_label || account.account_type || "Account";
            const [label, cls] = health(account);
            return <tr key={account.id}>
              <td><div className="row"><AccountAvatar account={account} ChannelBrandImage={ChannelBrandImage} size={32} /><div><b className="sm">{account.account_name}</b><div className="xs subtle">{typeLabel}</div></div></div></td>
              <td className="sm">{channel.label} · {account.can_publish ? "publish" : "connect only"}</td>
              <td><span className={`badge ${cls}`}>{label}</span></td>
              <td className="sm">{posts30(account)}</td>
              <td><div className="row sm"><span className="avatar" style={{ width: 22, height: 22, fontSize: 9, background: "#4F46E5" }}>{ownerInitials}</span>{(ownerName || "You").split(/\s+/)[0]}</div></td>
              <td><div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                {busy && <LoaderCircle size={14} className="animate-spin" />}
                {account.is_active ? <button type="button" disabled={busy} className="btn btn-sm btn-secondary" onClick={() => void run(account.id, "disconnect")}><Unplug size={13} />Disconnect</button> : <button type="button" disabled={busy} className="btn btn-sm btn-secondary" onClick={() => void run(account.id, "reconnect")}><RefreshCw size={13} />Reconnect</button>}
                <button type="button" disabled={busy} className="btn btn-sm btn-ghost" onClick={() => onConnect?.(channel)} title="Re-authorize this network">Re-auth</button>
                <button type="button" disabled={busy} className="btn btn-sm btn-ghost" style={{ color: "var(--error)" }} onClick={() => void run(account.id, "remove")}>Remove</button>
              </div></td>
            </tr>;
          })}
        </tbody></table>}
      </div>
      <h2>Add a channel</h2>
      <div className="grid g3">
        {channels.map((channel) => {
          const publishable = publishablePlatforms.has(channel.id);
          const count = accounts.filter((account) => account.platform === channel.id && account.is_active).length;
          return <div key={channel.id} className="card row" style={{ padding: 16, gap: 12, opacity: publishable ? 1 : .7 }}>
            <BrandThumb channelId={channel.id} ChannelBrandImage={ChannelBrandImage} size={36} />
            <div className="grow"><b>{channel.label}</b><div className="xs muted">{publishable ? (count ? `${count} connected` : desc[channel.id] || "Ready to connect") : "Connect only"}</div></div>
            <button type="button" className={`btn btn-sm ${publishable ? "btn-primary" : "btn-secondary"}`} onClick={() => onConnect?.(channel)}>Connect</button>
          </div>;
        })}
      </div>
    </>
  );
}
