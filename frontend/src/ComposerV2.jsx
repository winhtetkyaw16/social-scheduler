// Composer shell: channel tabs, shared caption, schedule, and the per-account media picker.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useObjectUrl } from "./objectUrl.js";
import {
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Hash,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  LoaderCircle,
  Plus,
  Scissors,
  Settings2,
  Info,
  Smile,
  Sparkles,
  SpellCheck,
  WandSparkles,
  X as XIcon,
  AlertCircle,
} from "lucide-react";
import {
  Avatar,
  ChannelTile,
  IdAvatar,
  AccountIdentity,
  accountDisplayName,
  accountHandle,
  resolveAvatarUrl,
} from "./sc/ui.jsx";
import {
  groupByNetwork,
  needsHandle,
  usedForLine,
  captionSource,
  groupWarnings,
  networkLabel,
  networkNoun,
} from "./accountCaptions.js";
import EmojiPicker from "./EmojiPicker.jsx";
import PublishBar from "./sc/PublishBar.jsx";
import PostPreview from "./PostPreviews.jsx";
import { ChannelFormatSelector, PlatformSettingsPopover } from "./ComposerChannelEditor.jsx";
import { mediaKeyOf, summarize } from "./mediaRules.js";
import useBodyScrollLock from "./useBodyScrollLock.js";
import FixSheet from "./FixSheet.jsx";
import { blockingGroups, buildFixPlan, publishBlock, shortMediaProblem } from "./fixPlan.js";

const LABELS = {
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  threads: "Threads",
};
const isVideo = (item) =>
  typeof item === "string"
    ? /\.(mp4|mov|webm|m4v)(\?|$)/i.test(item)
    : String(item?.type || "").startsWith("video/");

function Thumb({ item, onRemove, onEdit }) {
  const url = useObjectUrl(item);
  const video = isVideo(item);
  return (
    <div
      className="thumb"
      onClick={onEdit}
      role={onEdit ? "button" : undefined}
      title={onEdit ? "Edit media" : undefined}
    >
      {url ? video ? <video src={url} muted preload="metadata" /> : <img src={url} alt="" /> : null}
      {video && <span className="vid">▶ Video</span>}
      <button
        type="button"
        className="x"
        aria-label="Remove media"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <XIcon size={11} />
      </button>
    </div>
  );
}

/** Per-channel media strip: tap a thumb to include/leave it out of this channel. */
function TickThumb({ item, on, onToggle, n }) {
  const url = useObjectUrl(item);
  const video = isVideo(item);
  return (
    <button
      type="button"
      className={`mt ${on ? "" : "off"}`}
      aria-pressed={on}
      aria-label={`${on ? "Leave out" : "Include"} ${video ? "video" : "photo"} ${n}`}
      onClick={onToggle}
    >
      {url ? video ? <video src={url} muted preload="metadata" /> : <img src={url} alt="" /> : null}
      {video && <span className="v">▶</span>}
      <span className="n">{n}</span>
      <span className={`tk ${on ? "on" : ""}`}>{on && <Check size={10} strokeWidth={3.5} />}</span>
    </button>
  );
}
function MiniStrip({ items, indices }) {
  return (
    <span className="mini">
      {indices.slice(0, 6).map((i) => (
        <i key={i} className={isVideo(items[i]) ? "vd" : ""} />
      ))}
      {indices.length > 6 && <em>+{indices.length - 6}</em>}
    </span>
  );
}

function zoneLabel(timeZone) {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value || timeZone
    );
  } catch {
    return timeZone;
  }
}

export default function ComposerV2(props) {
  const {
    accounts,
    selectedIds,
    toggleAccount,
    connect,
    selectedAccounts,
    channels,
    maxChars,
    captionMode,
    changeCaptionMode,
    caption,
    setCaption,
    captionsByAccount,
    setCaptionsByAccount,
    useUniversalCaptionByAccount,
    setUseUniversalCaptionByAccount,
    captionsByNetwork = {},
    setCaptionsByNetwork = () => {},
    captionForAccount,
    mediaForAccount,
    channelWarnings,
    channelNotices = [],
    igCropByAccount = {},
    onIgCrop,
    templates,
    files,
    setFiles,
    libraryMediaUrls,
    setLibraryMediaUrls,
    onFilesAdded,
    onEditFile,
    title,
    setTitle,
    formatForAccount,
    formatsByAccount,
    formatOverridesByAccount,
    setAccountFormat,
    platformSettingsByAccount,
    setPlatformSetting,
    date,
    setDate,
    time,
    setTime,
    timeZone,
    setTimeZone,
    timezones,
    minDate,
    saving,
    uploadBusy,
    loadingAccounts,
    saveAsDraft,
    submit,
    onDiscard,
    previewId,
    setPreviewId,
    publishMode = "schedule",
    setPublishMode = () => {},
    request,
    onSetupQueue,
    mediaReport = [],
    sharedMedia = [],
    mediaSelectionByAccount = {},
    setAccountMediaKeys = () => {},
    applyMediaFix = () => ({ count: 0, undo() {} }),
    applyMediaAction = () => {},
  } = props;
  const [tab, setTab] = useState("all"); // "all" or a network key (one caption tab per network)
  const [sub, setSub] = useState({}); // network -> "net" | account id being edited inside that tab
  const [custOpen, setCustOpen] = useState({});
  const [aiOpen, setAiOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [optsOpen, setOptsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  useBodyScrollLock(sheetOpen);
  const [mtoast, setMtoast] = useState(null);
  const toastTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const textarea = useRef(null);
  const emojiBtn = useRef(null);
  const fileInput = useRef(null);
  const canAttachMedia = selectedAccounts.length > 0;
  const busy = saving || uploadBusy || loadingAccounts;
  const active = accounts.filter((a) => a.is_active);
  const groups = useMemo(() => groupByNetwork(selectedAccounts), [selectedAccounts]);
  const group =
    captionMode === "custom" && tab !== "all"
      ? groups.find((g) => g.platform === tab) || null
      : null;
  useEffect(() => {
    if (tab !== "all" && !groups.some((g) => g.platform === tab)) setTab("all");
  }, [groups, tab]);
  useEffect(() => {
    if (captionMode !== "custom") setTab("all");
  }, [captionMode]);
  const cs = {
    captionMode,
    caption,
    captionsByNetwork,
    captionsByAccount,
    useUniversalCaptionByAccount,
  };
  const isOwn = (a) => captionSource(cs, a) === "account";
  const netCustom = (p) => captionMode === "custom" && typeof captionsByNetwork[p] === "string";
  const isCustomized = (a) => captionSource(cs, a) !== "default";
  // Which caption the editor writes inside a network tab: the network default ("net") or one account.
  const subKey = (() => {
    if (!group) return "";
    if (group.accounts.length === 1) return isOwn(group.accounts[0]) ? group.accounts[0].id : "net";
    const k = sub[group.platform];
    return k && k !== "net" && group.accounts.some((a) => a.id === k) ? k : "net";
  })();
  const pillsOpen = Boolean(group) && (Boolean(custOpen[group.platform]) || subKey !== "net");
  const tabAccount =
    group && subKey !== "net" ? group.accounts.find((a) => a.id === subKey) || null : null;
  const groupLabel = group ? networkLabel(group.platform) : "";
  const tabUsesDefault =
    Boolean(group) && (tabAccount ? !isOwn(tabAccount) : !netCustom(group.platform));
  const value = tabAccount
    ? captionForAccount(tabAccount)
    : group
      ? netCustom(group.platform)
        ? captionsByNetwork[group.platform]
        : caption
      : caption;
  const setValue = (next) => {
    const resolved = typeof next === "function" ? next(value) : next;
    if (!group) {
      setCaption(resolved);
      return;
    }
    if (tabUsesDefault && resolved === value) return;
    if (tabAccount) {
      setUseUniversalCaptionByAccount((c) => ({ ...c, [tabAccount.id]: false }));
      setCaptionsByAccount((c) => ({ ...c, [tabAccount.id]: resolved }));
    } else setCaptionsByNetwork((c) => ({ ...c, [group.platform]: resolved }));
  };
  const limitOf = (account) =>
    Math.min(channels.find((c) => c.id === account.platform)?.limit || maxChars, maxChars);
  const pool = tabAccount ? [tabAccount] : group ? group.accounts : selectedAccounts;
  const strictest = pool.reduce(
    (best, a) => (!best || limitOf(a) < limitOf(best) ? a : best),
    null,
  );
  const limit = strictest ? limitOf(strictest) : maxChars;
  const len = value.length;
  const cntCls = len > limit ? "over" : len >= limit * 0.9 ? "warn" : "";
  const netName = (a) => LABELS[a?.platform] || a?.platform || "";
  // Red dot only for real problems: caption over this network's limit, or the channel needs a video.
  const problemFor = (a) => {
    const over = captionForAccount(a).length - limitOf(a);
    if (over > 0)
      return `${accountDisplayName(a)} (${netName(a)}) is ${over.toLocaleString()} characters over its ${limitOf(a).toLocaleString()} limit — shorten it${captionMode === "custom" ? "" : " or customize it per channel"}.`;
    if (
      channelWarnings.some(
        (w) =>
          w.account.id === a.id && /video/i.test(w.message) && /(needs|include)/i.test(w.message),
      ) &&
      !mediaForAccount(a).some(isVideo)
    )
      return `${accountDisplayName(a)} (${netName(a)}) needs a video — add one or turn it off.`;
    return "";
  };
  function resetAccount(a) {
    setUseUniversalCaptionByAccount((c) => ({ ...c, [a.id]: true }));
    setCaptionsByAccount((c) => {
      const next = { ...c };
      delete next[a.id];
      return next;
    });
  }
  function resetNetwork(p) {
    setCaptionsByNetwork((c) => {
      const next = { ...c };
      delete next[p];
      return next;
    });
  }
  function openTab(p) {
    setTab(p);
    if (p === "all") return;
    const g = groups.find((x) => x.platform === p);
    const acc = g?.accounts.find((a) => a.id === sub[p]) || g?.accounts[0];
    if (acc) setPreviewId(acc.id);
  }
  function pickSub(p, k) {
    setSub((c) => ({ ...c, [p]: k }));
    if (k !== "net") setPreviewId(k);
  }
  const sameCount = selectedAccounts.length;
  const tabProblem = tabAccount
    ? problemFor(tabAccount)
    : group
      ? group.accounts.map(problemFor).find(Boolean) || ""
      : "";
  const warnGroups = groupWarnings(channelWarnings, selectedAccounts.length);
  const mediaRow = (id) => mediaReport.find((r) => r.account.id === id);
  const mediaTargets = tabAccount ? [tabAccount] : group ? group.accounts : [];
  const summary = useMemo(
    () =>
      summarize(
        mediaReport.map((r) => ({
          account: r.account,
          platform: r.account.platform,
          infos: r.sharedInfos,
          indices: r.indices,
          check: r.check,
        })),
      ),
    [mediaReport],
  );
  const mediaNotes = mediaReport.flatMap((r) =>
    [...r.check.notes, ...r.check.hints].map((t) => ({ account: r.account, text: t })),
  );
  const nameOf = (a) => LABELS[a.platform] || a.platform;
  // One count source for the panel and the sheet (accounts, not networks).
  const fixPlan = useMemo(
    () =>
      buildFixPlan(
        mediaReport.map((r) => ({
          account: r.account,
          format: r.format,
          infos: r.sharedInfos,
          problems: r.check.problems.length,
        })),
      ),
    [mediaReport],
  );
  const fixCount = fixPlan.counts.changing;
  const fixTrigger = useRef(null);
  const startToast = () => {
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setMtoast(null), 10000);
  };
  function applyFix(result) {
    const { count, undo } = applyMediaFix(result);
    setSheetOpen(false);
    setReviewOpen(false);
    setMtoast({ count, undo });
    startToast();
  }
  // Every publish action is disabled while a blocking error remains (Save draft stays enabled).
  const block = publishBlock({ channelWarnings, mediaReport });
  // Specific media errors, always visible (not only under Review), grouped across accounts.
  const mediaErrors = useMemo(() => blockingGroups(mediaReport), [mediaReport]);
  const guardedSubmit = (m) => {
    if (block.blocked) return;
    submit(m);
  };

  function insert(text) {
    const el = textarea.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    setValue(`${value.slice(0, start)}${text}${value.slice(end)}`);
    requestAnimationFrame(() => {
      if (el) {
        el.focus({ preventScroll: true });
        el.setSelectionRange(start + text.length, start + text.length);
      }
    });
  }
  function ai(kind) {
    setAiOpen(false);
    setTplOpen(false);
    setValue((v) => {
      const trimmed = v.trim();
      if (kind === "grammar")
        return trimmed
          ? trimmed
              .replace(/\s+([,.!?])/g, "$1")
              .replace(/[ \t]{2,}/g, " ")
              .replace(/\bi\b/g, "I")
              .replace(/(^|[.!?]\s+)([a-z])/g, (_, s, c) => s + c.toUpperCase())
          : trimmed;
      if (kind === "hashtags") {
        const words = [
          ...new Set(
            (trimmed.toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) || []).filter(
              (w) => !["about", "their", "there", "which", "would", "these"].includes(w),
            ),
          ),
        ]
          .slice(0, 3)
          .map((w) => `#${w}`);
        return `${trimmed}${trimmed ? "\n\n" : ""}${(words.length ? words : ["#socialmedia", "#marketing"]).join(" ")}`;
      }
      if (kind === "shorten")
        return trimmed.length <= 280 ? trimmed : `${trimmed.slice(0, 279).replace(/\s+\S*$/, "")}…`;
      return trimmed && !/^here[’']s the idea/i.test(trimmed)
        ? `Here’s the idea: ${trimmed}`
        : trimmed;
    });
  }
  function addFiles(list) {
    if (!canAttachMedia) return;
    const incoming = Array.from(list || []).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
    );
    if (incoming.length) onFilesAdded?.(incoming);
  }

  const whenText = (() => {
    try {
      const d = new Date(`${date}T${time || "00:00"}`);
      return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
    } catch {
      return `${date} ${time}`;
    }
  })();
  const needsTitle = selectedAccounts.some(
    (a) => a.platform === "youtube" || ["Short", "Reel / Video"].includes(formatForAccount(a)),
  );
  const previewAccount =
    selectedAccounts.find((a) => a.id === previewId) || selectedAccounts[0] || null;
  const xAcc = selectedAccounts.find((a) => a.platform === "x");

  return (
    <section className="c2 animate-fade-up">
      <div className="page-head c2-head">
        <h1>Create post</h1>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost c2-m-draft"
            onClick={() => void saveAsDraft()}
            disabled={busy}
          >
            Save draft
          </button>
        </div>
      </div>
      <div className="c2-grid">
        <form
          className="card c2-form"
          onSubmit={(e) => {
            e.preventDefault();
            guardedSubmit(publishMode);
          }}
        >
          <div className="c2-body">
            <div className="c2-chips" aria-label="Publish to">
              {active.map((a) => {
                const on = selectedIds.includes(a.id);
                const hd = needsHandle(a, active);
                return (
                  <button
                    type="button"
                    key={a.id}
                    className={`chip2 ${on ? "on" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggleAccount(a.id)}
                    title={`${accountDisplayName(a)} · ${accountHandle(a)} · ${netName(a)}`}
                  >
                    <IdAvatar account={a} size={24} />
                    <span className="nm">
                      {accountDisplayName(a)}
                      {hd && <span className="hd">{accountHandle(a)}</span>}
                    </span>
                    {on && (
                      <span className="ck">
                        <Check size={9} strokeWidth={3.5} />
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                aria-label="Connect a channel"
                onClick={() => connect()}
              >
                <Plus size={16} />
              </button>
              {!active.length && (
                <span className="sm muted">Connect a channel to start publishing.</span>
              )}
            </div>
            <div className="seg2" role="group" aria-label="Caption mode">
              <a
                role="button"
                tabIndex={0}
                className={captionMode !== "custom" ? "active" : ""}
                onClick={() => changeCaptionMode("universal")}
              >
                <span className="c2-d">Same caption everywhere</span>
                <span className="c2-m">Same caption</span>
              </a>
              <a
                role="button"
                tabIndex={0}
                className={captionMode === "custom" ? "active" : ""}
                onClick={() => changeCaptionMode("custom")}
              >
                <span className="c2-d">Customize per channel</span>
                <span className="c2-m">Per channel</span>
              </a>
            </div>
            {needsTitle && (
              <input
                className="c2-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                placeholder="Video title (YouTube / Shorts / Reels) — optional"
              />
            )}
            <div className="ed">
              {captionMode === "custom" && groups.length > 0 && (
                <div className="ctabs" role="tablist" aria-label="Caption per network">
                  <a
                    role="tab"
                    aria-selected={tab === "all"}
                    tabIndex={0}
                    className={tab === "all" ? "active" : ""}
                    onClick={() => openTab("all")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openTab("all");
                      }
                    }}
                  >
                    <LayoutGrid size={15} />
                    Default
                  </a>
                  {groups.map((g) => {
                    const p = g.platform;
                    const n = g.accounts.length;
                    const lbl = networkLabel(p);
                    const prob =
                      g.accounts.map(problemFor).find(Boolean) ||
                      (g.accounts.some((a) => mediaRow(a.id)?.check.problems.length)
                        ? "media"
                        : "");
                    const custom = netCustom(p) || g.accounts.some(isOwn);
                    return (
                      <a
                        role="tab"
                        aria-selected={tab === p}
                        tabIndex={0}
                        key={p}
                        className={tab === p ? "active" : ""}
                        onClick={() => openTab(p)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openTab(p);
                          }
                        }}
                        title={
                          prob ||
                          (custom
                            ? `Custom caption for ${lbl}`
                            : n > 1
                              ? `${usedForLine(p, n)}. Uses the default caption.`
                              : `${lbl} uses the default caption`)
                        }
                      >
                        <ChannelTile platform={p} size={18} />
                        {lbl}
                        {n > 1 && (
                          <>
                            <span className="cn">· {n}</span>
                            <span className="stk" aria-hidden="true">
                              {g.accounts.slice(0, 3).map((a) => (
                                <Avatar
                                  key={a.id}
                                  name={accountDisplayName(a)}
                                  size={16}
                                  src={resolveAvatarUrl(a) || undefined}
                                />
                              ))}
                            </span>
                          </>
                        )}
                        {prob ? (
                          <span className="dt e" aria-label="Needs attention" />
                        ) : custom ? (
                          <span className="dt f" aria-label="Customized" />
                        ) : (
                          <>
                            <span className="dt h" aria-hidden="true" />
                            <span className="st">Default</span>
                          </>
                        )}
                      </a>
                    );
                  })}
                </div>
              )}
              {group && group.accounts.length > 1 && (
                <div className="netl">
                  <span className="stk" aria-hidden="true">
                    {group.accounts.slice(0, 3).map((a) => (
                      <Avatar
                        key={a.id}
                        name={accountDisplayName(a)}
                        size={16}
                        src={resolveAvatarUrl(a) || undefined}
                      />
                    ))}
                  </span>
                  <span className="grow">{usedForLine(group.platform, group.accounts.length)}</span>
                  <button
                    type="button"
                    className="cust"
                    aria-expanded={pillsOpen}
                    onClick={() => {
                      setCustOpen((c) => ({ ...c, [group.platform]: !pillsOpen }));
                      if (pillsOpen) pickSub(group.platform, "net");
                    }}
                  >
                    {pillsOpen ? "Use one caption for all" : "Customize for this account"}
                  </button>
                </div>
              )}
              {group && group.accounts.length > 1 && pillsOpen && (
                <div
                  className="subp"
                  role="tablist"
                  aria-label={`Caption for each ${groupLabel} ${networkNoun(group.platform, 1)}`}
                >
                  <a
                    role="tab"
                    tabIndex={0}
                    aria-selected={subKey === "net"}
                    className={subKey === "net" ? "on" : ""}
                    onClick={() => pickSub(group.platform, "net")}
                  >
                    {groupLabel} default
                  </a>
                  {group.accounts.map((a) => (
                    <a
                      role="tab"
                      tabIndex={0}
                      key={a.id}
                      aria-selected={subKey === a.id}
                      className={subKey === a.id ? "on" : ""}
                      onClick={() => pickSub(group.platform, a.id)}
                      title={
                        isOwn(a)
                          ? `Custom caption for ${accountDisplayName(a)}`
                          : `Uses your ${groupLabel} default`
                      }
                    >
                      <span
                        className={`dt ${isOwn(a) ? "f" : "h"}`}
                        aria-label={isOwn(a) ? "Has its own caption" : "Uses the network default"}
                      />
                      {accountDisplayName(a)}
                      {needsHandle(a, group.accounts) && (
                        <span className="hd">{accountHandle(a)}</span>
                      )}
                    </a>
                  ))}
                </div>
              )}
              {group &&
                (tabAccount ? (
                  tabUsesDefault ? (
                    <div className="uban">
                      <Info size={14} />
                      Using your {groupLabel} default. Start typing to customize for{" "}
                      {accountDisplayName(tabAccount)}.
                    </div>
                  ) : (
                    <div className="edh">
                      <span>Custom caption for {accountDisplayName(tabAccount)}</span>
                      <button type="button" className="rs" onClick={() => resetAccount(tabAccount)}>
                        Reset to {groupLabel} default
                      </button>
                    </div>
                  )
                ) : tabUsesDefault ? (
                  <div className="uban">
                    <Info size={14} />
                    Using your default caption. Start typing to customize for {groupLabel}.
                  </div>
                ) : (
                  <div className="edh">
                    <span>Custom caption for {groupLabel}</span>
                    <button
                      type="button"
                      className="rs"
                      onClick={() => resetNetwork(group.platform)}
                    >
                      Reset to default
                    </button>
                  </div>
                ))}
              {captionMode === "custom" && groups.length > 0 && !group && (
                <div className="edh">
                  <span>Used for any channel you don't customize</span>
                </div>
              )}
              <textarea
                ref={textarea}
                className={tabUsesDefault ? "is-default" : ""}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={7}
                placeholder={
                  tabAccount
                    ? `Write a caption for ${accountDisplayName(tabAccount)}…`
                    : group
                      ? `Write a caption for ${groupLabel}…`
                      : "What do you want to share?"
                }
                aria-label={
                  tabAccount
                    ? `Caption for ${accountDisplayName(tabAccount)} (${groupLabel})`
                    : group
                      ? `Caption for ${groupLabel}`
                      : "Caption"
                }
              />
              {mediaTargets.length > 0 && sharedMedia.length > 0 ? (
                (() => {
                  const lead = mediaTargets[0];
                  const row = mediaRow(lead.id);
                  const on = new Set((row?.indices || []).map((i) => mediaKeyOf(sharedMedia[i])));
                  const picked = mediaTargets.some((a) =>
                    Array.isArray(mediaSelectionByAccount[a.id]),
                  );
                  const toggle = (item) => {
                    const mediaKey = mediaKeyOf(item);
                    const next = sharedMedia
                      .map(mediaKeyOf)
                      .filter((x) => (x === mediaKey ? !on.has(x) : on.has(x)));
                    mediaTargets.forEach((a) => setAccountMediaKeys(a.id, next));
                  };
                  return (
                    <div className="mst">
                      <div className="mh">
                        <span className="sm muted">
                          Media for {tabAccount ? accountDisplayName(tabAccount) : nameOf(lead)}
                          {!tabAccount && mediaTargets.length > 1
                            ? ` (all ${mediaTargets.length})`
                            : ""}{" "}
                          · tap to include or leave out
                        </span>
                        {picked && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              mediaTargets.forEach((a) => setAccountMediaKeys(a.id, null))
                            }
                          >
                            Reset to default
                          </button>
                        )}
                      </div>
                      <div className="mts">
                        {sharedMedia.map((item, i) => (
                          <TickThumb
                            key={mediaKeyOf(item)}
                            item={item}
                            n={i + 1}
                            on={on.has(mediaKeyOf(item))}
                            onToggle={() => toggle(item)}
                          />
                        ))}
                        <button
                          type="button"
                          className="add"
                          aria-label="Add photos or videos"
                          disabled={!canAttachMedia}
                          onClick={() => fileInput.current?.click()}
                        >
                          {uploadBusy ? (
                            <LoaderCircle size={18} className="animate-spin" />
                          ) : (
                            <Plus size={18} />
                          )}
                        </button>
                      </div>
                      <input
                        ref={fileInput}
                        className="sr-only"
                        type="file"
                        disabled={!canAttachMedia}
                        accept="image/*,video/*"
                        multiple
                        onChange={(e) => {
                          addFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </div>
                  );
                })()
              ) : (
                <>
                  <div className="med"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = canAttachMedia ? "copy" : "none";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      addFiles(e.dataTransfer.files);
                    }}
                  >
                    {files.map((f, i) => (
                      <Thumb
                        key={`${f.name}-${f.lastModified}-${i}`}
                        item={f}
                        onEdit={() => onEditFile(f)}
                        onRemove={() => setFiles((c) => c.filter((_, j) => j !== i))}
                      />
                    ))}
                    {libraryMediaUrls.map((u) => (
                      <Thumb
                        key={u}
                        item={u}
                        onRemove={() => setLibraryMediaUrls((c) => c.filter((x) => x !== u))}
                      />
                    ))}
                    <button
                      type="button"
                      className="add"
                      aria-label="Add photos or videos"
                      disabled={!canAttachMedia}
                      onClick={() => fileInput.current?.click()}
                    >
                      {uploadBusy ? (
                        <LoaderCircle size={18} className="animate-spin" />
                      ) : (
                        <Plus size={18} />
                      )}
                    </button>
                    <input
                      ref={fileInput}
                      className="sr-only"
                      type="file"
                      disabled={!canAttachMedia}
                      accept="image/*,video/*"
                      multiple
                      onChange={(e) => {
                        addFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </div>
                </>
              )}
              <div className="tb">
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label="Add image or video"
                  disabled={!canAttachMedia}
                  title="Image / video"
                  onClick={() => fileInput.current?.click()}
                >
                  <ImageIcon size={17} />
                </button>
                <button
                  ref={emojiBtn}
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label="Emoji"
                  title="Emoji"
                  aria-expanded={emojiOpen}
                  onClick={() => setEmojiOpen((o) => !o)}
                >
                  <Smile size={17} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label="Insert hashtag"
                  title="Hashtag"
                  onClick={() => insert("#")}
                >
                  <Hash size={17} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label="Insert link"
                  title="Link"
                  onClick={() => insert("https://")}
                >
                  <Link2 size={17} />
                </button>
                <span style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm c2-ai"
                    aria-haspopup="menu"
                    aria-expanded={aiOpen}
                    onClick={() => {
                      setAiOpen((o) => !o);
                      setTplOpen(false);
                    }}
                  >
                    <Sparkles size={16} />
                    <span className="c2-d">AI</span>
                  </button>
                  {aiOpen && (
                    <div className="menu" role="menu">
                      {!tplOpen ? (
                        <>
                          <a role="menuitem" onClick={() => ai("rewrite")}>
                            <WandSparkles className="ico" />
                            Rewrite
                          </a>
                          <a role="menuitem" onClick={() => ai("grammar")}>
                            <SpellCheck className="ico" />
                            Fix grammar
                          </a>
                          <a role="menuitem" onClick={() => ai("hashtags")}>
                            <Hash className="ico" />
                            Suggest hashtags
                          </a>
                          <a role="menuitem" onClick={() => ai("shorten")}>
                            <Scissors className="ico" />
                            Shorten for X
                          </a>
                          <hr />
                          <a role="menuitem" onClick={() => setTplOpen(true)}>
                            <FileText className="ico" />
                            Insert template…
                          </a>
                        </>
                      ) : (
                        <>
                          {templates.map((t) => (
                            <a
                              role="menuitem"
                              key={t.name}
                              onClick={() => {
                                setValue(t.text);
                                setAiOpen(false);
                                setTplOpen(false);
                              }}
                            >
                              <FileText className="ico" />
                              {t.name}
                            </a>
                          ))}
                          <hr />
                          <a onClick={() => setTplOpen(false)}>← Back</a>
                        </>
                      )}
                    </div>
                  )}
                </span>
                <span className="grow" />
                <span
                  className={`cnt ${cntCls}`}
                  title={
                    strictest
                      ? tabAccount || group
                        ? `${netName(strictest)} limit`
                        : `${netName(strictest)} limit (strictest selected)`
                      : "Character count"
                  }
                >
                  {strictest && <ChannelTile platform={strictest.platform} size={16} />}
                  {len.toLocaleString()} / {limit.toLocaleString()}
                </span>
              </div>
            </div>
            {!group && strictest && selectedAccounts.length > 1 && (
              <p className="c2-lim">{netName(strictest)} has the shortest limit</p>
            )}
            {tabProblem && (
              <p className="c2-hint over" role="status">
                <AlertCircle size={14} />
                {tabProblem}
              </p>
            )}
            {captionMode !== "custom" && sameCount > 0 && (
              <div className="c2-sline">
                <span className="ics">
                  {selectedAccounts.map((a) => (
                    <ChannelTile key={a.id} platform={a.platform} size={14} />
                  ))}
                </span>
                Posting the same caption to {sameCount} channel{sameCount === 1 ? "" : "s"}
              </div>
            )}
            {strictest && cntCls && !group && (
              <p className={`c2-hint ${cntCls}`}>
                <AlertCircle size={14} />
                {len > limit
                  ? `${(len - limit).toLocaleString()} characters over on ${LABELS[strictest.platform]} (strictest limit).`
                  : `${(limit - len).toLocaleString()} characters left on ${LABELS[strictest.platform]} (strictest limit).`}
                {xAcc && strictest.platform === "x" && (
                  <>
                    {" "}
                    <a
                      onClick={() => {
                        changeCaptionMode("custom");
                        setTab("x");
                        setPreviewId(xAcc.id);
                      }}
                    >
                      Edit for X
                    </a>
                  </>
                )}
              </p>
            )}
            {selectedAccounts.length > 0 && (
              <div className="c2-opts">
                <button
                  type="button"
                  className="c2-opts-t"
                  aria-expanded={optsOpen}
                  onClick={() => setOptsOpen((o) => !o)}
                >
                  <Settings2 size={14} />
                  Channel options
                  <ChevronDown
                    size={14}
                    style={{ transform: optsOpen ? "rotate(180deg)" : "none" }}
                  />
                </button>
                {optsOpen && (
                  <div className="co">
                    <p className="co-note">
                      Format is picked for you from your media. Change it any time.
                    </p>
                    <div className="co-r co-hd" aria-hidden="true">
                      <span>Account</span>
                      <span>Format</span>
                      <span />
                    </div>
                    {groups.map((g) => (
                      <div
                        key={g.platform}
                        className="co-g"
                        role="group"
                        aria-label={networkLabel(g.platform)}
                      >
                        {g.accounts.length > 1 && (
                          <div className="gh">
                            <ChannelTile platform={g.platform} size={14} />
                            {networkLabel(g.platform)}
                            <span className="cn">· {g.accounts.length}</span>
                          </div>
                        )}
                        {g.accounts.map((a) => (
                          <div key={a.id} className="co-r">
                            <span className="co-a">
                              <AccountIdentity account={a} size={28} handle={true} />
                              {isCustomized(a) && <span className="tag">Custom caption</span>}
                            </span>
                            <ChannelFormatSelector
                              variant="plain"
                              account={a}
                              format={formatForAccount(a)}
                              onSelect={(f) => setAccountFormat(a.id, f)}
                            />
                            <PlatformSettingsPopover
                              compact
                              account={a}
                              settings={platformSettingsByAccount[a.id] || {}}
                              onChange={setPlatformSetting}
                              open={settingsOpen === a.id}
                              onToggle={() => setSettingsOpen((c) => (c === a.id ? "" : a.id))}
                            />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {fixCount > 0 && mediaReport.some((row) =>
            row.check.problems.some((problem) => problem.code !== "no_video") ||
            (row.check.problems.length > 0 && row.sharedInfos.some((item) => item.kind === "video"))
          ) && (
            <div className="mp" role="region" aria-label="Media check">
              <div className="hd">
                <span className="mk">
                  <AlertCircle size={16} />
                </span>
                <div className="grow">
                  <b>
                    Check media for {fixCount} account{fixCount === 1 ? "" : "s"}
                  </b>
                  <p className="sm muted">
                    Some accounts need different media before you can post.
                  </p>
                </div>
                <div className="acts">
                  <button
                    type="button"
                    className="btn btn-grad btn-sm"
                    onClick={(e) => {
                      fixTrigger.current = e.currentTarget;
                      setSheetOpen(true);
                    }}
                  >
                    Choose media
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    aria-expanded={reviewOpen}
                    onClick={() => setReviewOpen((o) => !o)}
                  >
                    {reviewOpen ? "Hide details" : "View details"}
                  </button>
                </div>
              </div>
              {reviewOpen &&
                summary.needs.map((r) => {
                  const pr = r.check.problems[0];
                  return (
                    <div className="ln" key={r.account.id}>
                      <ChannelTile platform={r.account.platform} size={18} />
                      <span className="grow">
                        <b>{nameOf(r.account)}</b>{" "}
                        <span className="d">
                          {shortMediaProblem(pr)}
                        </span>
                      </span>
                      {pr.action && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            if (["add_media", "add_video"].includes(pr.action.id))
                              fileInput.current?.click();
                            else if (["shorten", "replace"].includes(pr.action.id)) {
                              changeCaptionMode("custom");
                              setTab(r.account.id);
                            } else applyMediaAction(r.account, pr.action);
                          }}
                        >
                          {pr.action.label}
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
          {mediaErrors.length > 0 && (
            <div className="c2-blockers c2-merrs" role="alert">
              {mediaErrors.map((g) => (
                <p key={g.key} className="c2-hint over">
                  <span className="c2-avs" aria-hidden="true">
                    {g.accounts.slice(0, 5).map((a) => (
                      <ChannelTile key={a.id} platform={a.platform} size={16} />
                    ))}
                  </span>
                  <span>{g.message}</span>
                </p>
              ))}
            </div>
          )}
          {mediaNotes.length > 0 && (
            <div className="c2-notes">
              {mediaNotes.map((n, i) => (
                <p key={`mn-${n.account.id}-${i}`} className="sm muted">
                  {nameOf(n.account)}: {n.text}
                </p>
              ))}
            </div>
          )}
          {sheetOpen && (
            <FixSheet
              rows={mediaReport}
              items={sharedMedia}
              returnFocus={fixTrigger}
              onCancel={() => setSheetOpen(false)}
              onApply={applyFix}
              onAddMedia={() => fileInput.current?.click()}
              nameOf={(a) => accountDisplayName(a)}
              renderAvatar={(a) => <IdAvatar account={a} size={36} />}
            />
          )}
          {mtoast && (
            <div
              className="mtoast"
              role="status"
              aria-live="polite"
              onMouseEnter={() => window.clearTimeout(toastTimer.current)}
              onMouseLeave={startToast}
              onFocus={() => window.clearTimeout(toastTimer.current)}
              onBlur={startToast}
            >
              Media updated for {mtoast.count} account{mtoast.count === 1 ? "" : "s"}.{" "}
              <button
                type="button"
                className="lnk"
                onClick={() => {
                  window.clearTimeout(toastTimer.current);
                  mtoast.undo();
                  setMtoast(null);
                }}
              >
                Undo
              </button>
            </div>
          )}
          {warnGroups.length > 0 && (
            <div className="c2-blockers gerr-l" role="alert">
              {warnGroups.map((g) => (
                <div key={g.key} className="gerr">
                  <span className="bang" aria-hidden="true">
                    !
                  </span>
                  <span className="gerr-t">
                    <b>{g.title}</b>
                    {g.detail && <span className="xs subtle">{g.detail}</span>}
                  </span>
                  <span className="stk">
                    {g.accounts.slice(0, 4).map((a) => (
                      <IdAvatar key={a.id} account={a} size={22} />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
          {channelNotices.length > 0 && (
            <div className="c2-blockers c2-channel-notices">
              {channelNotices.map((w, i) => (
                <p key={`n-${w.account.id}-${i}`} className="c2-hint warn">
                  <AlertCircle size={14} />
                  <span>
                    <b>
                      {accountDisplayName(w.account)} ({netName(w.account)}):
                    </b>{" "}
                    {w.message}
                  </span>
                </p>
              ))}
            </div>
          )}
          <PublishBar
            blocked={block.blocked}
            blockHint={block.hint}
            mode={publishMode}
            setMode={setPublishMode}
            busy={busy}
            submit={guardedSubmit}
            saveAsDraft={saveAsDraft}
            whenText={whenText}
            zoneText={zoneLabel(timeZone)}
            date={date}
            setDate={setDate}
            time={time}
            setTime={setTime}
            timeZone={timeZone}
            setTimeZone={setTimeZone}
            timezones={timezones}
            minDate={minDate}
            request={request}
            selectedAccounts={selectedAccounts}
            onSetupQueue={onSetupQueue}
            onDiscard={onDiscard}
          />
        </form>
        <aside className="c2-pv">
          {selectedAccounts.length ? (
            <>
              <div className="apv" role="tablist" aria-label="Preview account">
                {selectedAccounts.map((a) => {
                  const on = previewAccount?.id === a.id;
                  return (
                    <a
                      role="tab"
                      aria-selected={on}
                      tabIndex={0}
                      key={a.id}
                      className={on ? "on" : ""}
                      onClick={() => setPreviewId(a.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPreviewId(a.id);
                        }
                      }}
                      aria-label={`${accountDisplayName(a)} ${accountHandle(a)} on ${netName(a)}`}
                    >
                      <IdAvatar account={a} size={28} />
                      <span className="tip" role="tooltip">
                        <b>{accountDisplayName(a)}</b>
                        <span>
                          {accountHandle(a)} · {netName(a)}
                        </span>
                      </span>
                    </a>
                  );
                })}
              </div>
              {previewAccount && (
                <PostPreview
                  account={previewAccount}
                  caption={captionForAccount(previewAccount)}
                  media={mediaForAccount(previewAccount)}
                  title={title}
                  format={formatForAccount(previewAccount)}
                  settings={platformSettingsByAccount[previewAccount.id] || {}}
                  igCrop={igCropByAccount[previewAccount.id] || null}
                  onIgCrop={onIgCrop ? (next) => onIgCrop(previewAccount, next) : undefined}
                />
              )}
            </>
          ) : (
            <div className="c2-pv-empty sm muted">Select a channel to see a preview.</div>
          )}
        </aside>
      </div>
      <EmojiPicker
        open={emojiOpen}
        anchorRef={emojiBtn}
        recent={recentEmojis}
        onSelect={(em) => {
          insert(em);
          setRecentEmojis((r) => [em, ...r.filter((x) => x !== em)].slice(0, 16));
        }}
        onClose={() => setEmojiOpen(false)}
      />
    </section>
  );
}
