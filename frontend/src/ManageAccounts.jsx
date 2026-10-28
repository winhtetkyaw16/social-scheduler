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
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose?.(); }}>
      <div className="modal-card max-w-lg" role="dialog" aria-modal="true" aria-labelledby="pick-title">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <BrandThumb channelId={platform} ChannelBrandImage={ChannelBrandImage} />
            <div>
              <span className="eyebrow">CHOOSE DESTINATIONS</span>
              <h2 id="pick-title" className="mt-1 font-display text-xl font-extrabold">Connect {label}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{notes}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="Close destination picker"><XIcon size={17} /></button>
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
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.account_type}{item.category ? ` · ${item.category}` : ""}</span>
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
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="primary-button !px-5 !py-2.5" disabled={saving || loading || !destinations.length} onClick={() => void save()}>
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
  publishablePlatforms = new Set(["x", "linkedin", "instagram"]),
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

  return (
    <section className="surface-card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="eyebrow">MANAGE ACCOUNTS</span>
          <h2 className="mt-1 font-display text-lg font-extrabold tracking-tight">Connected social destinations</h2>
          <p className="mt-1 text-xs text-slate-500">Connect, disconnect, or reconnect accounts. Create Post chips select which destinations receive a draft — this panel manages the connections themselves.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {accounts.filter((account) => account.is_active).length} active
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {channels.map((channel) => {
          const connected = accounts.filter((account) => account.platform === channel.id && account.is_active);
          const count = connected.length;
          const publishable = publishablePlatforms.has(channel.id);
          return (
            <button
              key={channel.id}
              type="button"
              onClick={() => onConnect?.(channel)}
              className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-3 text-left transition hover:border-indigo-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-950/60"
            >
              <BrandThumb channelId={channel.id} ChannelBrandImage={ChannelBrandImage} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-extrabold text-slate-900 dark:text-slate-100">{channel.label}</span>
                <span className="block text-[10px] text-slate-500">{count ? `${count} connected` : "Not connected"} · {publishable ? "publish ready" : "connect only"}</span>
              </span>
              <Plus size={14} className="text-indigo-500" />
            </button>
          );
        })}
      </div>

      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center dark:border-slate-700">
          <Link2 className="mx-auto text-slate-300" size={22} />
          <p className="mt-2 text-xs font-semibold text-slate-500">No accounts yet. Connect a network above.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 dark:divide-slate-800 dark:border-slate-700">
          {sorted.map((account) => {
            const channel = channelById[account.platform] || { label: account.platform, id: account.platform };
            const busy = busyId === account.id;
            const typeLabel = account.account_type_label || account.account_type || "Account";
            return (
              <li key={account.id} className="flex flex-wrap items-center gap-3 bg-white/70 px-3 py-3 dark:bg-slate-950/50 sm:px-4">
                <AccountAvatar account={account} ChannelBrandImage={ChannelBrandImage} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-extrabold text-slate-900 dark:text-slate-100">{account.account_name}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    {channel.label} · {typeLabel}
                    {account.is_active ? "" : " · disconnected"}
                    {account.can_publish ? " · can publish" : " · connect only"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{TYPE_HINTS[account.platform] || ""}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {account.is_active ? (
                    <button type="button" disabled={busy} onClick={() => void run(account.id, "disconnect")} className="secondary-button !px-2.5 !py-1.5 text-[10px]">
                      {busy ? <LoaderCircle size={12} className="animate-spin" /> : <Unplug size={12} />} Disconnect
                    </button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => void run(account.id, "reconnect")} className="secondary-button !px-2.5 !py-1.5 text-[10px]">
                      {busy ? <LoaderCircle size={12} className="animate-spin" /> : <RefreshCw size={12} />} Reconnect
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => onConnect?.(channel)} className="secondary-button !px-2.5 !py-1.5 text-[10px]">
                    <RefreshCw size={12} /> Re-auth
                  </button>
                  <button type="button" disabled={busy} onClick={() => void run(account.id, "remove")} className="secondary-button !px-2.5 !py-1.5 text-[10px] text-rose-600">
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
