import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChannelTile } from "./sc/ui.jsx";
import { createPortal } from "react-dom";
import { ChevronDown, Expand, Facebook, Globe2, GripVertical, Hash, Instagram, Link2, Linkedin, MapPin, MessageCircle, Pencil, Settings2, Shrink, Smile, Sparkles, Video, X, Youtube } from "lucide-react";
import EmojiPicker from "./EmojiPicker.jsx";
import { AccountAvatar } from "./ManageAccounts.jsx";
import facebookPng from "./assets/logos/facebook.svg";
import instagramPng from "./assets/logos/instagram.svg";
import linkedinPng from "./assets/logos/linkedin.svg";
import pinterestPng from "./assets/logos/pinterest.svg";
import tiktokPng from "./assets/logos/tiktok.svg";
import xPng from "./assets/logos/x.svg";
import youtubePng from "./assets/logos/youtube.svg";
import threadsPng from "./assets/logos/threads.svg";

const CHANNEL_UI = {
  facebook: { label: "Facebook", brand: "#1877F2", mark: "f" },
  instagram: { label: "Instagram", brand: "#D94687", mark: "◎", Icon: Instagram },
  youtube: { label: "YouTube", brand: "#FF0033", mark: "▶", Icon: Youtube },
  x: { label: "X", brand: "#111827", mark: "𝕏" },
  linkedin: { label: "LinkedIn", brand: "#0A66C2", mark: "in", Icon: Linkedin },
  tiktok: { label: "TikTok", brand: "#111827", mark: "♪" },
  pinterest: { label: "Pinterest", brand: "#BD081C", mark: "p" },
};
const FORMAT_SUPPORT = {
  x: [{ value: "Post", label: "Post" }, { value: "Reel / Video", label: "Video" }],
  facebook: [{ value: "Post", label: "Post" }, { value: "Reel / Video", label: "Reel / video" }, { value: "Story", label: "Story" }],
  instagram: [{ value: "Post", label: "Post" }, { value: "Reel / Video", label: "Reel" }, { value: "Story", label: "Story" }],
  youtube: [{ value: "Post", label: "Community post" }, { value: "Reel / Video", label: "Video" }, { value: "Short", label: "Short" }],
  tiktok: [{ value: "Post", label: "Photo post" }, { value: "Reel / Video", label: "Video" }, { value: "Story", label: "Story" }],
  linkedin: [{ value: "Post", label: "Post" }, { value: "Reel / Video", label: "Video" }],
  pinterest: [{ value: "Post", label: "Pin" }, { value: "Reel / Video", label: "Video Pin" }],
};

const BRAND_PNGS = { facebook: facebookPng, instagram: instagramPng, linkedin: linkedinPng, pinterest: pinterestPng, tiktok: tiktokPng, x: xPng, youtube: youtubePng, threads: threadsPng };

function BrandIcon({ platform }) {
  return <ChannelTile platform={platform} size={28} />;
}

/** Brand logo thumb for AccountAvatar badge (Buffer: profile + platform mark). */
function LocalChannelBrandImage({ channelId, size = 24 }) {
  return <ChannelTile platform={channelId} size={size} />;
}

function ChannelFileThumb({ file, onRemove, onEdit, onDragStart, onDragOver, onDrop }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") return undefined;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  const video = Boolean(file?.type?.startsWith("video/"));
  return <div draggable onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} title="Drag to reorder" className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
    {url && !video ? <img src={url} alt={file?.name || "Attached image"} className="h-full w-full object-cover" /> : url && video ? <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-indigo-500">{video ? <Video size={20} /> : <span className="text-[9px]">Preview</span>}</div>}
    {video && <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1 py-0.5 text-[8px] font-bold text-white">VIDEO</span>}
    <span className="absolute left-1 top-1 grid h-6 w-6 cursor-grab place-items-center rounded-full bg-slate-950/75 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100"><GripVertical size={13} /></span>
    <button type="button" onClick={onEdit} aria-label={`Edit ${file?.name || "attachment"}`} title="Open media editor" className="absolute right-8 top-1 grid h-6 w-6 place-items-center rounded-full bg-indigo-600 text-white opacity-100 shadow sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"><Pencil size={11} /></button>
    <button type="button" onClick={onRemove} aria-label={`Remove ${file?.name || "attachment"}`} title="Remove attachment" className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-slate-950/75 text-white opacity-100 shadow transition hover:bg-rose-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"><X size={12} /></button>
    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-1 pt-4 text-[8px] text-white">{file?.name || "Attachment"}</span>
  </div>;
}

export function ChannelFormatSelector({ account, format, automatic, onSelect }) {
  const options = FORMAT_SUPPORT[account?.platform] || [{ value: "Post", label: "Post" }];
  return (
    <label className="inline-flex shrink-0 items-center gap-1.5 text-[9px] font-bold text-slate-500">
      <span className="sr-only">Publish format for {CHANNEL_UI[account?.platform]?.label || "channel"}</span>
      <span className="relative block">
        <select
          value={format}
          onChange={(event) => onSelect?.(event.target.value)}
          className="max-w-[132px] appearance-none rounded-xl border border-slate-200/80 bg-white/90 py-2 pl-3 pr-8 text-[10px] font-bold text-slate-700 shadow-sm outline-none backdrop-blur-md transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200"
        >
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <ChevronDown aria-hidden="true" size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      </span>
      <span className={`hidden rounded-full px-1.5 py-0.5 text-[8px] font-extrabold sm:inline ${automatic ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
        {automatic ? "AUTO" : "CUSTOM"}
      </span>
    </label>
  );
}

function ChannelWarningNotice({ messages = [] }) {
  if (!messages.length) return null;
  return <div role="status" aria-live="polite" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2.5 text-[10px] leading-4 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
    <span aria-hidden="true">⚠</span>
    <div><p className="font-extrabold">Needs attention</p>{messages.map((message, index) => <p key={`${index}-${message}`}>{message}</p>)}</div>
  </div>;
}

const SETTINGS_DEFAULTS = {
  tiktok: { audience: "Public", allow_comments: true, allow_duet: true, allow_stitch: true },
  youtube: { privacy_status: "Public", made_for_kids: false, category: "People & Blogs" },
  facebook: { audience: "Public", location: "", first_comment: "", media_layout: "Grid" },
  instagram: { hide_counts: false, disable_comments: false, alt_text: "", location: "", media_layout: "Carousel / Swipe" },
  linkedin: { visibility: "Anyone", commenting: "Anyone", media_layout: "Grid" },
  x: { reply_permission: "Everyone", media_layout: "Grid" },
  pinterest: { board: "Brand inspiration", destination_url: "", alt_text: "" },
};
const MEDIA_LAYOUT_OPTIONS = {
  facebook: ["Grid", "Carousel / Swipe", "Stacked"],
  instagram: ["Carousel / Swipe", "Grid"],
  linkedin: [{ value: "Grid", label: "Grid / Mosaic" }, { value: "Side-by-side", label: "Side-by-side" }],
  x: [{ value: "Grid", label: "Grid / Mosaic" }, { value: "Side-by-side", label: "Side-by-side" }],
};

export function PlatformSettingsPopover({ account, settings = {}, onChange, open, onToggle }) {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [position, setPosition] = useState({ top: 12, left: 12, ready: false });
  const platform = account?.platform;
  const defaults = SETTINGS_DEFAULTS[platform] || {};
  const value = (key) => settings[key] ?? (key === "made_for_kids" && typeof settings.audience_classification === "string" ? settings.audience_classification === "Made for kids" : undefined) ?? defaults[key] ?? "";
  const update = (key, next) => onChange?.(account.id, key, next);
  const labelClass = "block text-[9px] font-bold text-slate-500 dark:text-slate-400";
  const inputClass = "mt-1 block w-full rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5 text-[10px] font-medium text-slate-700 shadow-sm outline-none backdrop-blur-md transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200";
  const selectClass = "block w-full appearance-none rounded-xl border border-slate-200/80 bg-white/90 py-2.5 pl-3 pr-9 text-[10px] font-medium text-slate-700 shadow-sm outline-none backdrop-blur-md transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200";
  const selectField = (title, key, options) => (
    <label key={key} className={labelClass}>
      {title}
      <span className="relative mt-1 block">
        <select value={value(key)} onChange={(event) => update(key, event.target.value)} className={selectClass}>
          {options.map((option) => typeof option === "string"
            ? <option key={option} value={option}>{option}</option>
            : <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <ChevronDown aria-hidden="true" size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
      </span>
    </label>
  );
  const textField = (title, key, placeholder = "") => <label key={key} className={labelClass}>{title}<input value={value(key)} onChange={(event) => update(key, event.target.value)} placeholder={placeholder} className={inputClass} /></label>;
  const toggleField = (title, key) => <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/70">{title}<span className="relative inline-flex h-5 w-9 shrink-0 items-center"><input type="checkbox" checked={Boolean(value(key))} onChange={(event) => update(key, event.target.checked)} className="peer sr-only" /><span className="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400 peer-focus-visible:ring-offset-2 dark:bg-slate-600 dark:peer-focus-visible:ring-offset-slate-900" /><span className="pointer-events-none absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" /></span></label>;
  let sections = [];
  if (platform === "tiktok") sections = [{ title: "Audience", Icon: Globe2, fields: [selectField("Visibility", "audience", ["Public", "Friends", "Only me"])] }, { title: "Interactions", Icon: MessageCircle, fields: [toggleField("Allow comments", "allow_comments"), toggleField("Allow Duet", "allow_duet"), toggleField("Allow Stitch", "allow_stitch")] }];
  else if (platform === "youtube") sections = [{ title: "Privacy & audience", Icon: Globe2, fields: [selectField("Privacy status", "privacy_status", ["Public", "Unlisted", "Private"]), toggleField("Made for kids", "made_for_kids")] }, { title: "Video details", Icon: Settings2, fields: [selectField("Category", "category", ["People & Blogs", "Education", "Entertainment", "Howto & Style", "News & Politics", "Science & Technology", "Travel & Events", "Comedy", "Gaming", "Music", "Sports"])] }];
  else if (platform === "facebook") sections = [{ title: "Audience", Icon: Globe2, fields: [selectField("Privacy", "audience", ["Public", "Friends", "Only me"])] }, { title: "Post details", Icon: MapPin, fields: [textField("Location tag", "location", "Add a place"), textField("First comment", "first_comment", "Add an optional first comment")] }];
  else if (platform === "instagram") sections = [{ title: "Interactions", Icon: MessageCircle, fields: [toggleField("Hide like and view counts", "hide_counts"), toggleField("Turn off commenting", "disable_comments")] }, { title: "Accessibility & location", Icon: MapPin, fields: [textField("Alt text", "alt_text", "Describe the image for accessibility"), textField("Location tag", "location", "Add a place")] }];
  else if (platform === "linkedin") sections = [{ title: "Visibility", Icon: Globe2, fields: [selectField("Post visibility", "visibility", ["Anyone", "Connections only"]), selectField("Who can comment", "commenting", ["Anyone", "Connections only"])] }];
  else if (platform === "x") sections = [{ title: "Replies", Icon: MessageCircle, fields: [selectField("Who can reply", "reply_permission", ["Everyone", "Accounts you follow", "Only accounts you mention"])] }];
  else if (platform === "pinterest") sections = [{ title: "Pin details", Icon: Link2, fields: [selectField("Board", "board", ["Brand inspiration", "Product ideas", "Social campaigns"]), textField("Destination link", "destination_url", "https://your-site.com/page"), textField("Alt text", "alt_text", "Describe the image")] }];
  if (MEDIA_LAYOUT_OPTIONS[platform]) {
    sections = [...sections, { title: "Media display", Icon: Settings2, fields: [selectField("Multiple media layout", "media_layout", MEDIA_LAYOUT_OPTIONS[platform])] }];
  }

  useLayoutEffect(() => {
    if (!open) { setPosition((current) => ({ ...current, ready: false })); return undefined; }
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const margin = 12;
      const width = Math.min(320, window.innerWidth - margin * 2);
      const height = Math.min(panel.getBoundingClientRect().height, window.innerHeight - margin * 2);
      const left = Math.max(margin, Math.min(trigger.right - width, window.innerWidth - width - margin));
      let top = trigger.top - height - 8;
      if (top < margin) top = trigger.bottom + 8;
      top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
      setPosition({ top, left, ready: true });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, platform]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => { if (!triggerRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) onToggle?.(); };
    const closeOnEscape = (event) => { if (event.key === "Escape") onToggle?.(); };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [open, onToggle]);

  return <>
    <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={onToggle} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[9px] font-bold shadow-sm backdrop-blur-md transition focus:outline-none focus:ring-4 focus:ring-indigo-500/10 ${open ? "border-indigo-300 bg-indigo-50/90 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-200" : "border-slate-200/80 bg-white/90 text-slate-600 hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300"}`}><Settings2 size={12} />Platform settings</button>
    {open && typeof document !== "undefined" && createPortal(<div ref={panelRef} role="dialog" aria-label={`${CHANNEL_UI[platform]?.label || "Channel"} settings`} className="fixed z-[100] max-h-[min(70vh,480px)] w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-white/70 bg-white/90 p-4 shadow-xl shadow-slate-900/15 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/95" style={{ top: position.top, left: position.left, visibility: position.ready ? "visible" : "hidden" }}>
      <header className="sticky top-0 z-10 -mx-1 -mt-1 mb-3 flex items-center gap-2 rounded-xl bg-white/90 px-1 py-2 backdrop-blur-md dark:bg-slate-900/95"><span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-50 dark:bg-indigo-950"><BrandIcon platform={platform} /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-extrabold text-slate-800 dark:text-white">{CHANNEL_UI[platform]?.label || "Channel"} settings</p><p className="truncate text-[9px] text-slate-400">{account?.account_name || "Connected account"}</p></div><button type="button" onClick={onToggle} aria-label="Close platform settings" className="grid h-7 w-7 place-items-center rounded-lg text-sm text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800">×</button></header>
      <div className="space-y-3">{sections.map(({ title, Icon, fields: sectionFields }) => <section key={title} className="border-t border-slate-100 pt-2.5 first:border-0 first:pt-0 dark:border-slate-800"><h4 className="mb-1.5 flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400"><Icon size={12} className="text-indigo-500" />{title}</h4><div className="space-y-1.5">{sectionFields}</div></section>)}</div>
    </div>, document.body)}
  </>;
}

export default function ComposerChannelEditor({
  accounts = [], mode, setMode, caption, setCaption, captionsByAccount,
  setCaptionsByAccount, useUniversalCaptionByAccount = {}, setUseUniversalCaptionByAccount, channelFiles, setChannelFiles, channelMediaUrlsByAccount = {}, setChannelMediaUrlsByAccount, useSharedMediaByAccount, setUseSharedMediaByAccount,
  sharedMediaCount = 0, previewId, setPreviewId, children, onOpenAssistant, onEditMedia, channelWarnings = [],
  formatsByAccount = {}, formatOverridesByAccount = {}, setAccountFormat, platformSettingsByAccount = {}, setPlatformSetting, onChannelFilesAdded,
}) {
  const [activeAccountId, setActiveAccountId] = useState(accounts.find((account) => account?.id)?.id || "");
  const [expandedAccount, setExpandedAccount] = useState(null);
  const [emojiAccount, setEmojiAccount] = useState(null);
  const [recentEmojis, setRecentEmojis] = useState([]);
  const [settingsAccount, setSettingsAccount] = useState(null);
  const [draggingAccount, setDraggingAccount] = useState(null);
  const emojiButtonRefs = useRef({});
  const safeAccounts = Array.isArray(accounts) ? accounts.filter((account) => account && typeof account === "object") : [];
  const safeCaption = typeof caption === "string" ? caption : "";
  const safeCaptionsByAccount = captionsByAccount && typeof captionsByAccount === "object" && !Array.isArray(captionsByAccount) ? captionsByAccount : {};
  const safeUniversalCaptionChoices = useUniversalCaptionByAccount && typeof useUniversalCaptionByAccount === "object" && !Array.isArray(useUniversalCaptionByAccount) ? useUniversalCaptionByAccount : {};
  const safeChannelFiles = channelFiles && typeof channelFiles === "object" && !Array.isArray(channelFiles) ? channelFiles : {};
  const safeSharedMediaChoices = useSharedMediaByAccount && typeof useSharedMediaByAccount === "object" && !Array.isArray(useSharedMediaByAccount) ? useSharedMediaByAccount : {};
  const safeWarnings = Array.isArray(channelWarnings) ? channelWarnings.filter((item) => item && item.account && typeof item.message === "string") : [];
  useEffect(() => {
    if (!safeAccounts.some((account) => account.id === activeAccountId)) {
      const nextId = safeAccounts[0]?.id || "";
      setActiveAccountId(nextId);
      if (nextId) setPreviewId?.(nextId);
    }
  }, [safeAccounts, activeAccountId, setPreviewId]);
  const chooseAccount = (accountId) => {
    setActiveAccountId(accountId);
    setPreviewId?.(accountId);
  };
  const writeAccountCaption = (accountId, nextValue) => {
    setUseUniversalCaptionByAccount?.((current) => ({ ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}), [accountId]: false }));
    setCaptionsByAccount?.((current) => ({ ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}), [accountId]: nextValue }));
  };
  const addChannelFiles = (account, fileList) => {
    const incoming = Array.from(fileList || []).filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
    const existing = Array.isArray(safeChannelFiles[account.id]) ? safeChannelFiles[account.id] : [];
    const existingUrls = Array.isArray(channelMediaUrlsByAccount?.[account.id]) ? channelMediaUrlsByAccount[account.id] : [];
    const accepted = incoming.slice(0, Math.max(0, 10 - existing.length - existingUrls.length));
    if (!accepted.length) return;

    setChannelFiles((current) => {
      const currentFiles = Array.isArray(current?.[account.id]) ? current[account.id] : [];
      return {
        ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}),
        [account.id]: [...currentFiles, ...accepted].slice(0, 10),
      };
    });
    onChannelFilesAdded?.(account, accepted);
  };
  return <section>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="sc-h2">Write your caption</h3><p className="section-hint mt-0.5">Start with a strong hook. Keep it unmistakably you.</p></div><div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="group" aria-label="Caption mode"><button type="button" onClick={() => setMode("universal")} aria-pressed={mode === "universal"} className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition ${mode === "universal" ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500"}`}>Universal</button><button type="button" onClick={() => setMode("custom")} aria-pressed={mode === "custom"} className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition ${mode === "custom" ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500"}`}>Customize per channel</button></div></div>
    {mode === "custom" && safeAccounts.length > 0 && <nav aria-label="Choose account to edit" className="mb-4 flex max-w-full gap-2 overflow-x-auto overflow-y-hidden py-1">
      {safeAccounts.map((account) => {
        const channel = CHANNEL_UI[account.platform] || { label: account.platform || "Channel" };
        const active = account.id === activeAccountId;
        return <button key={account.id} type="button" onClick={() => chooseAccount(account.id)} aria-pressed={active} className={`inline-flex min-w-0 shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${active ? "border-indigo-300 bg-indigo-50 text-indigo-800 shadow-sm ring-2 ring-indigo-500/10 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300"}`}>
          <AccountAvatar account={account} ChannelBrandImage={LocalChannelBrandImage} size={28} badgeScale={0.48} />
          <span className="min-w-0"><span className="block text-[10px] font-extrabold">{channel.label}</span><span className="block max-w-32 truncate text-[9px] opacity-70">{account.account_name || account.platform_account_id || "Connected account"}</span></span>
        </button>;
      })}
    </nav>}
    {mode === "universal" ? <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] font-semibold text-slate-500">One caption and shared media will be used for every selected account.</span><span className="text-[10px] font-bold text-slate-400">{safeCaption.length.toLocaleString()} characters</span></div>
      {children}
      {safeWarnings.length > 0 && <div role="status" aria-live="polite" className="rounded-xl border border-amber-200 bg-amber-50/90 p-3 text-[10px] leading-4 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
        <p className="mb-1 font-extrabold">Review channel requirements</p>
        <p>{safeWarnings.every(({ message }) => message === "Add a caption for this channel.") ? "Captions are required for all selected channels." : "Some selected channels need attention. Review their caption, media, or format requirements."}</p>
      </div>}
    </div> : <div className="space-y-3">{safeAccounts.filter((item) => item.id === activeAccountId).map((account) => {
      const platformId = typeof account.platform === "string" ? account.platform : "";
      const channel = CHANNEL_UI[platformId] || { label: platformId || "Social channel", brand: "#6366f1", mark: "•" };
      const inheritsUniversalCaption = safeUniversalCaptionChoices[account.id] !== false;
      const customValue = typeof safeCaptionsByAccount[account.id] === "string" ? safeCaptionsByAccount[account.id] : safeCaption;
      const value = inheritsUniversalCaption ? safeCaption : customValue;
      const accountFiles = Array.isArray(safeChannelFiles[account.id]) ? safeChannelFiles[account.id].filter(Boolean) : [];
      const savedChannelMedia = Array.isArray(channelMediaUrlsByAccount?.[account.id]) ? channelMediaUrlsByAccount[account.id] : [];
      const channelMediaCount = accountFiles.length + savedChannelMedia.length;
      const inheritsSharedMedia = safeSharedMediaChoices[account.id] !== false;
      const messages = safeWarnings.filter((warning) => warning.account.id === account.id).map((warning) => warning.message);
      return <article key={account.id} className="rounded-2xl border border-slate-200 bg-white p-3 transition dark:border-slate-800 dark:bg-slate-950/30 sm:p-4">
        <header className="mb-3 flex flex-wrap items-center gap-2.5"><AccountAvatar account={account} ChannelBrandImage={LocalChannelBrandImage} size={32} badgeScale={0.48} /><div className="min-w-0 flex-1"><p className="text-xs font-extrabold">{channel.label}</p><p className="truncate text-[10px] text-slate-500">{account.account_name || account.platform_account_id || "Connected account"}</p></div><span className="text-[10px] font-semibold text-slate-400">{value.length.toLocaleString()}</span><ChannelFormatSelector account={account} format={formatsByAccount[account.id] || "Post"} automatic={!formatOverridesByAccount[account.id]} onSelect={(nextFormat) => setAccountFormat?.(account.id, nextFormat)} /></header>
        <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/50">
          <div><p className="text-[10px] font-semibold text-slate-700 dark:text-slate-200">Use universal caption</p><p className="mt-0.5 text-[9px] text-slate-400">{inheritsUniversalCaption ? "This account follows your shared caption." : "Write a unique caption for this account."}</p></div>
          <label className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center" title="Use universal caption">
            <input type="checkbox" role="switch" checked={inheritsUniversalCaption} aria-label={`Use universal caption for ${channel.label}`} onChange={(event) => {
              const checked = event.target.checked;
              if (checked || typeof safeCaptionsByAccount[account.id] !== "string") {
                setCaptionsByAccount?.((current) => ({ ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}), [account.id]: safeCaption }));
              }
              setUseUniversalCaptionByAccount?.((current) => ({ ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}), [account.id]: checked }));
            }} className="peer sr-only" />
            <span aria-hidden="true" className="absolute inset-0 rounded-full bg-slate-300 transition-colors duration-200 peer-checked:bg-gradient-to-r peer-checked:from-indigo-600 peer-checked:to-purple-600 peer-focus-visible:ring-4 peer-focus-visible:ring-indigo-500/20 dark:bg-slate-600" />
            <span aria-hidden="true" className="pointer-events-none absolute left-1 h-3 w-3 rounded-full bg-white shadow-md ring-1 ring-black/5 transition-transform duration-200 peer-checked:translate-x-4" />
          </label>
        </div>
        <textarea rows={expandedAccount === account.id ? 9 : 4} value={value} onFocus={() => setPreviewId?.(account.id)} onChange={(event) => writeAccountCaption(account.id, event.target.value)} placeholder={`Write a caption for ${channel.label}…`} aria-label={`${channel.label} caption for ${account.account_name || "connected account"}`} className="w-full resize-y rounded-t-xl border border-slate-200 bg-white px-3 py-2.5 text-xs leading-5 outline-none transition focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" />
        <div className="flex flex-wrap items-center gap-1 border-x border-b border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
          <button type="button" title="Expand caption editor" aria-label="Expand caption editor" onClick={() => setExpandedAccount((current) => current === account.id ? null : account.id)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-indigo-600 dark:hover:bg-slate-800">{expandedAccount === account.id ? <Shrink size={14} /> : <Expand size={14} />}</button>
          <button ref={(element) => { emojiButtonRefs.current[account.id] = element; }} type="button" title="Insert emoji" aria-label="Insert emoji" aria-expanded={emojiAccount === account.id} onClick={() => setEmojiAccount((current) => current === account.id ? null : account.id)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-indigo-600 dark:hover:bg-slate-800"><Smile size={14} /></button>
          <button type="button" title="Add hashtag" aria-label="Add hashtag" onClick={() => writeAccountCaption(account.id, `${value}${value && !value.endsWith(" ") ? " " : ""}#SocialCastly`)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-indigo-600 dark:hover:bg-slate-800"><Hash size={14} /></button>
          <button type="button" title="Insert link" aria-label="Insert link" onClick={() => writeAccountCaption(account.id, `${value}${value && !value.endsWith(" ") ? " " : ""}https://`)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-indigo-600 dark:hover:bg-slate-800"><Link2 size={14} /></button>
          <button type="button" title="Open writing assistant" aria-label="Open writing assistant" onClick={() => onOpenAssistant?.(account.id)} className="rounded-lg p-1.5 text-indigo-600 hover:bg-white dark:text-indigo-300 dark:hover:bg-slate-800"><Sparkles size={14} /></button>
          <PlatformSettingsPopover account={account} settings={platformSettingsByAccount[account.id]} onChange={setPlatformSetting} open={settingsAccount === account.id} onToggle={() => setSettingsAccount((current) => current === account.id ? null : account.id)} />
          <span className="ml-auto text-[10px] font-semibold text-slate-400">{value.length.toLocaleString()} chars · {value.trim() ? value.trim().split(/\s+/).length : 0} words</span>
        </div>
        <EmojiPicker
          open={emojiAccount === account.id}
          anchorRef={{ current: emojiButtonRefs.current[account.id] }}
          recent={recentEmojis}
          onClose={() => setEmojiAccount(null)}
          onSelect={(emoji) => {
            writeAccountCaption(account.id, `${value}${value && !value.endsWith(" ") ? " " : ""}${emoji}`);
            setRecentEmojis((current) => [emoji, ...current.filter((item) => item !== emoji)].slice(0, 8));
          }}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/50">
          <label className="inline-flex cursor-pointer select-none items-center gap-2.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
            <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
              <input
                type="checkbox"
                checked={inheritsSharedMedia}
                aria-label={`Use shared media for ${channel.label}`}
                onChange={(event) => setUseSharedMediaByAccount?.((current) => ({ ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}), [account.id]: event.target.checked }))}
                className="peer sr-only"
              />
              <span aria-hidden="true" className="absolute inset-0 rounded-full bg-slate-300 transition-colors duration-200 peer-checked:bg-gradient-to-r peer-checked:from-indigo-600 peer-checked:to-purple-600 peer-focus-visible:ring-4 peer-focus-visible:ring-indigo-500/20 dark:bg-slate-600" />
              <span aria-hidden="true" className="pointer-events-none absolute left-1 h-3 w-3 rounded-full bg-white shadow-md ring-1 ring-black/5 transition-transform duration-200 peer-checked:translate-x-4" />
            </span>
            <span>Use shared media</span>
          </label>
          <span className="text-[9px] text-slate-400">{inheritsSharedMedia ? `${sharedMediaCount} shared item${sharedMediaCount === 1 ? "" : "s"} included` : "Only channel media"}</span>
        </div>
        <div
          onDragEnter={(event) => {
            if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
            event.preventDefault();
            setDraggingAccount(account.id);
          }}
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDraggingAccount(account.id);
          }}
          onDragLeave={(event) => {
            if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
            event.preventDefault();
            if (!event.currentTarget.contains(event.relatedTarget)) setDraggingAccount(null);
          }}
          onDrop={(event) => {
            if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
            event.preventDefault();
            event.stopPropagation();
            setDraggingAccount(null);
            addChannelFiles(account, event.dataTransfer.files);
          }}
          className={`mt-2 rounded-xl border border-dashed p-2 transition-colors ${draggingAccount === account.id ? "border-indigo-500 bg-indigo-50/80 ring-4 ring-indigo-500/10 dark:bg-indigo-950/40" : "border-slate-200/80 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30"}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-[10px] font-bold text-slate-600 shadow-sm transition hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <span>Add channel media</span>
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={(event) => {
                  addChannelFiles(account, event.target.files);
                  event.target.value = "";
                }}
                className="sr-only"
              />
            </label>
          <span className="text-[10px] text-slate-400">
              {channelMediaCount
                ? `${channelMediaCount} / 10 · ${inheritsSharedMedia ? "added to shared media" : "custom only"}`
                : inheritsSharedMedia ? "Drop files here or browse" : "Drop files here or browse"}
            </span>
          </div>
          {savedChannelMedia.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {savedChannelMedia.map((url, index) => (
                <div key={`${url}-${index}`} className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                  <img src={url} alt="Saved channel media" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    title="Remove saved media"
                    aria-label="Remove saved channel media"
                    onClick={() => setChannelMediaUrlsByAccount?.((current) => ({
                      ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}),
                      [account.id]: (Array.isArray(current?.[account.id]) ? current[account.id] : []).filter((_, itemIndex) => itemIndex !== index),
                    }))}
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-slate-950/75 text-white shadow transition hover:bg-rose-600"
                  >
                    <X size={12} />
                  </button>
                  <span className="absolute bottom-1 left-1 rounded bg-indigo-600/90 px-1 py-0.5 text-[8px] font-bold text-white">SAVED</span>
                </div>
              ))}
            </div>
          )}
          {accountFiles.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {accountFiles.map((file, index) => (
                <ChannelFileThumb
                  key={`${file.name || "media"}-${file.lastModified || 0}-${index}`}
                  file={file}
                  onEdit={() => onEditMedia?.(file)}
                  onRemove={() => setChannelFiles((current) => ({
                    ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}),
                    [account.id]: (Array.isArray(current?.[account.id]) ? current[account.id] : []).filter((_, fileIndex) => fileIndex !== index),
                  }))}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", String(index));
                    event.dataTransfer.setData("application/x-socialstudio-account", String(account.id));
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (event.dataTransfer.getData("application/x-socialstudio-account") !== String(account.id)) return;
                    const from = Number(event.dataTransfer.getData("text/plain"));
                    if (!Number.isInteger(from) || from === index) return;
                    setChannelFiles((current) => {
                      const next = [...(Array.isArray(current?.[account.id]) ? current[account.id] : [])];
                      const [moved] = next.splice(from, 1);
                      next.splice(index, 0, moved);
                      return { ...(current && typeof current === "object" ? current : {}), [account.id]: next };
                    });
                  }}
                />
              ))}
              <button
                type="button"
                onClick={() => setChannelFiles((current) => ({
                  ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}),
                  [account.id]: [],
                }))}
                className="col-span-3 text-left text-[9px] font-bold text-indigo-600 sm:col-span-4"
              >
                Clear channel media
              </button>
            </div>
          )}
        </div>
        <ChannelWarningNotice messages={messages} />
      </article>;
    })}{!safeAccounts.length && <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-slate-700">Select connected channels above to customize each version.</p>}</div>}
  </section>;
}
