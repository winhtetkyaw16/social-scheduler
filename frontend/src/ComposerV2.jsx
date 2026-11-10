import React, { useEffect, useMemo, useRef, useState } from "react";
import { useObjectUrl } from "./objectUrl.js";
import { Check, ChevronDown, Clock3, FileText, Hash, Image as ImageIcon, LayoutGrid, Link2, LoaderCircle, Plus, Scissors, Settings2, Smile, Sparkles, SpellCheck, WandSparkles, X as XIcon, AlertCircle } from "lucide-react";
import { AccountAvatar, ChannelTile, accountDisplayName, resolveAvatarUrl } from "./sc/ui.jsx";
import EmojiPicker from "./EmojiPicker.jsx";
import PublishBar from "./sc/PublishBar.jsx";
import PostPreview from "./PostPreviews.jsx";
import { ChannelFormatSelector, PlatformSettingsPopover } from "./ComposerChannelEditor.jsx";
import { mediaKeyOf, summarize } from "./mediaRules.js";
import useBodyScrollLock from "./useBodyScrollLock.js";
import FixSheet from "./FixSheet.jsx";
import { blockingGroups, buildFixPlan, publishBlock } from "./fixPlan.js";

const LABELS = { x: "X", facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", pinterest: "Pinterest", threads: "Threads" };
const isVideo = (item) => typeof item === "string" ? /\.(mp4|mov|webm|m4v)(\?|$)/i.test(item) : String(item?.type || "").startsWith("video/");

function Thumb({ item, onRemove, onEdit }) {
  const url = useObjectUrl(item);
  const video = isVideo(item);
  return <div className="thumb" onClick={onEdit} role={onEdit ? "button" : undefined} title={onEdit ? "Edit media" : undefined}>
    {url ? (video ? <video src={url} muted preload="metadata" /> : <img src={url} alt="" />) : null}
    {video && <span className="vid">▶ Video</span>}
    <button type="button" className="x" aria-label="Remove media" onClick={(e) => { e.stopPropagation(); onRemove(); }}><XIcon size={11} /></button>
  </div>;
}

/** Per-channel media strip: tap a thumb to include/leave it out of this channel. */
function TickThumb({ item, on, onToggle, n }) {
  const url = useObjectUrl(item);
  const video = isVideo(item);
  return <button type="button" className={`mt ${on ? "" : "off"}`} aria-pressed={on} aria-label={`${on ? "Leave out" : "Include"} ${video ? "video" : "photo"} ${n}`} onClick={onToggle}>
    {url ? (video ? <video src={url} muted preload="metadata" /> : <img src={url} alt="" />) : null}
    {video && <span className="v">▶</span>}<span className="n">{n}</span>
    <span className={`tk ${on ? "on" : ""}`}>{on && <Check size={10} strokeWidth={3.5} />}</span>
  </button>;
}
function MiniStrip({ items, indices }) {
  return <span className="mini">{indices.slice(0, 6).map((i) => <i key={i} className={isVideo(items[i]) ? "vd" : ""} />)}{indices.length > 6 && <em>+{indices.length - 6}</em>}</span>;
}

function zoneLabel(timeZone) {
  try { return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value || timeZone; } catch { return timeZone; }
}

export default function ComposerV2(props) {
  const {
    accounts, selectedIds, toggleAccount, connect, selectedAccounts, channels, maxChars,
    captionMode, changeCaptionMode, caption, setCaption, captionsByAccount, setCaptionsByAccount, useUniversalCaptionByAccount, setUseUniversalCaptionByAccount,
    captionForAccount, mediaForAccount, channelWarnings, channelNotices = [], igCropByAccount = {}, onIgCrop, templates,
    files, setFiles, libraryMediaUrls, setLibraryMediaUrls, onFilesAdded, onEditFile,
    title, setTitle, formatForAccount, formatsByAccount, formatOverridesByAccount, setAccountFormat, platformSettingsByAccount, setPlatformSetting,
    date, setDate, time, setTime, timeZone, setTimeZone, timezones, minDate,
    saving, uploadBusy, loadingAccounts, saveAsDraft, submit, onDiscard, previewId, setPreviewId,
    publishMode = "schedule", setPublishMode = () => {}, request, onSetupQueue,
    mediaReport = [], sharedMedia = [], mediaSelectionByAccount = {}, setAccountMediaKeys = () => {}, applyMediaFix = () => ({ count: 0, undo() {} }), applyMediaAction = () => {},
  } = props;
  const [tab, setTab] = useState("all");
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
  const busy = saving || uploadBusy || loadingAccounts;
  const active = accounts.filter((a) => a.is_active);
  const tabAccount = captionMode === "custom" && tab !== "all" ? selectedAccounts.find((a) => a.id === tab) : null;
  useEffect(() => { if (tab !== "all" && !selectedAccounts.some((a) => a.id === tab)) setTab("all"); }, [selectedAccounts, tab]);
  useEffect(() => { if (captionMode !== "custom") setTab("all"); }, [captionMode]);

  const value = tabAccount ? captionForAccount(tabAccount) : caption;
  const setValue = (next) => {
    if (!tabAccount) { setCaption(typeof next === "function" ? next(caption) : next); return; }
    const resolved = typeof next === "function" ? next(value) : next;
    setUseUniversalCaptionByAccount((c) => ({ ...c, [tabAccount.id]: false }));
    setCaptionsByAccount((c) => ({ ...c, [tabAccount.id]: resolved }));
  };
  const limitOf = (account) => Math.min(channels.find((c) => c.id === account.platform)?.limit || maxChars, maxChars);
  const strictest = useMemo(() => {
    const pool = tabAccount ? [tabAccount] : selectedAccounts;
    return pool.reduce((best, a) => (!best || limitOf(a) < limitOf(best) ? a : best), null);
  }, [tabAccount, selectedAccounts]);
  const limit = strictest ? limitOf(strictest) : maxChars;
  const len = value.length;
  const cntCls = len > limit ? "over" : len >= limit * 0.9 ? "warn" : "";
  const mediaRow = (id) => mediaReport.find((r) => r.account.id === id);
  const warnFor = (id) => channelWarnings.some((w) => w.account.id === id) || !!mediaRow(id)?.check.problems.length;
  const summary = useMemo(() => summarize(mediaReport.map((r) => ({ account: r.account, platform: r.account.platform, infos: r.sharedInfos, indices: r.indices, check: r.check }))), [mediaReport]);
  const mediaNotes = mediaReport.flatMap((r) => [...r.check.notes, ...r.check.hints].map((t) => ({ account: r.account, text: t })));
  const nameOf = (a) => LABELS[a.platform] || a.platform;
  // One count source for the panel and the sheet (accounts, not networks).
  const fixPlan = useMemo(() => buildFixPlan(mediaReport.map((r) => ({ account: r.account, format: r.format, infos: r.sharedInfos, problems: r.check.problems.length }))), [mediaReport]);
  const fixCount = fixPlan.counts.changing;
  const fixTrigger = useRef(null);
  const startToast = () => { window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setMtoast(null), 10000); };
  function applyFix(result) {
    const { count, undo } = applyMediaFix(result);
    setSheetOpen(false); setReviewOpen(false);
    setMtoast({ count, undo });
    startToast();
  }
  // Every publish action is disabled while a blocking error remains (Save draft stays enabled).
  const block = publishBlock({ channelWarnings, mediaReport });
  // Specific media errors, always visible (not only under Review), grouped across accounts.
  const mediaErrors = useMemo(() => blockingGroups(mediaReport), [mediaReport]);
  const guardedSubmit = (m) => { if (block.blocked) return; submit(m); };

  function insert(text) {
    const el = textarea.current; const start = el?.selectionStart ?? value.length; const end = el?.selectionEnd ?? start;
    setValue(`${value.slice(0, start)}${text}${value.slice(end)}`);
    requestAnimationFrame(() => { if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(start + text.length, start + text.length); } });
  }
  function ai(kind) {
    setAiOpen(false); setTplOpen(false);
    setValue((v) => {
      const t = v.trim();
      if (kind === "grammar") return t ? t.replace(/\s+([,.!?])/g, "$1").replace(/[ \t]{2,}/g, " ").replace(/\bi\b/g, "I").replace(/(^|[.!?]\s+)([a-z])/g, (_, s, c) => s + c.toUpperCase()) : t;
      if (kind === "hashtags") { const words = [...new Set((t.toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) || []).filter((w) => !["about", "their", "there", "which", "would", "these"].includes(w)))].slice(0, 3).map((w) => `#${w}`); return `${t}${t ? "\n\n" : ""}${(words.length ? words : ["#socialmedia", "#marketing"]).join(" ")}`; }
      if (kind === "shorten") return t.length <= 280 ? t : `${t.slice(0, 279).replace(/\s+\S*$/, "")}…`;
      return t && !/^here[’']s the idea/i.test(t) ? `Here’s the idea: ${t}` : t;
    });
  }
  function addFiles(list) {
    const incoming = Array.from(list || []).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    setFiles((old) => [...old, ...incoming].slice(0, 35));
    if (incoming.length) onFilesAdded?.(incoming);
  }

  const whenText = (() => { try { const d = new Date(`${date}T${time || "00:00"}`); return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`; } catch { return `${date} ${time}`; } })();
  const needsTitle = selectedAccounts.some((a) => a.platform === "youtube" || ["Short", "Reel / Video"].includes(formatForAccount(a)));
  const previewAccount = selectedAccounts.find((a) => a.id === previewId) || selectedAccounts[0] || null;
  const xAcc = selectedAccounts.find((a) => a.platform === "x");

  return <section className="c2 animate-fade-up">
    <div className="page-head c2-head"><h1>Create post</h1><div className="row" style={{ gap: 8 }}><button type="button" className="btn btn-ghost c2-m-draft" onClick={() => void saveAsDraft()} disabled={busy}>Save draft</button><button type="button" className="btn btn-ghost" onClick={onDiscard}>Discard</button></div></div>
    <div className="c2-grid">
      <form className="card c2-form" onSubmit={(e) => { e.preventDefault(); guardedSubmit(publishMode); }}>
        <div className="c2-body">
          <div className="c2-chips" aria-label="Publish to">
            {active.map((a) => { const on = selectedIds.includes(a.id); return <button type="button" key={a.id} className={`chip2 ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggleAccount(a.id)} title={a.account_name || LABELS[a.platform]}>
              {resolveAvatarUrl(a) ? <AccountAvatar account={a} size={24} /> : <ChannelTile platform={a.platform} size={24} />}<span className="nm">{accountDisplayName(a)}</span>{on && <span className="ck"><Check size={9} strokeWidth={3.5} /></span>}
            </button>; })}
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Connect a channel" onClick={() => connect()}><Plus size={16} /></button>
            {!active.length && <span className="sm muted">Connect a channel to start publishing.</span>}
          </div>
          <div className="seg2" role="group" aria-label="Caption mode">
            <a role="button" tabIndex={0} className={captionMode !== "custom" ? "active" : ""} onClick={() => changeCaptionMode("universal")}><span className="c2-d">Same caption everywhere</span><span className="c2-m">Same caption</span></a>
            <a role="button" tabIndex={0} className={captionMode === "custom" ? "active" : ""} onClick={() => changeCaptionMode("custom")}><span className="c2-d">Customize per channel</span><span className="c2-m">Per channel</span></a>
          </div>
          {needsTitle && <input className="c2-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Video title (YouTube / Shorts / Reels) — optional" />}
          <div className="ed">
            {captionMode === "custom" && selectedAccounts.length > 0 && <div className="ctabs" role="tablist">
              <a role="tab" className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}><LayoutGrid size={15} />All</a>
              {selectedAccounts.map((a) => <a role="tab" key={a.id} className={tab === a.id ? "active" : ""} onClick={() => { setTab(a.id); setPreviewId(a.id); }}><ChannelTile platform={a.platform} size={18} />{LABELS[a.platform] || a.platform}{selectedAccounts.length > 0 && <span className={`dot ${warnFor(a.id) ? "bad" : "ok"}`} title={warnFor(a.id) ? "Needs attention" : "Ready"} />}</a>)}
            </div>}
            <textarea ref={textarea} value={value} onChange={(e) => setValue(e.target.value)} rows={7} placeholder={tabAccount ? `Write a caption for ${LABELS[tabAccount.platform]}…` : "What do you want to share?"} aria-label="Caption" />
            {tabAccount && sharedMedia.length > 0 ? (() => {
              const row = mediaRow(tabAccount.id);
              const on = new Set((row?.indices || []).map((i) => mediaKeyOf(sharedMedia[i])));
              const picked = Array.isArray(mediaSelectionByAccount[tabAccount.id]);
              const toggle = (item) => { const k = mediaKeyOf(item); const next = sharedMedia.map(mediaKeyOf).filter((x) => (x === k ? !on.has(x) : on.has(x))); setAccountMediaKeys(tabAccount.id, next); };
              return <div className="mst">
                <div className="mh"><span className="sm muted">Media for {nameOf(tabAccount)} · tap to include or leave out</span>{picked && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAccountMediaKeys(tabAccount.id, null)}>Reset to default</button>}</div>
                <div className="mts">{sharedMedia.map((item, i) => <TickThumb key={mediaKeyOf(item)} item={item} n={i + 1} on={on.has(mediaKeyOf(item))} onToggle={() => toggle(item)} />)}
                  <button type="button" className="add" aria-label="Add photos or videos" onClick={() => fileInput.current?.click()}>{uploadBusy ? <LoaderCircle size={18} className="animate-spin" /> : <Plus size={18} />}</button></div>
                <input ref={fileInput} className="sr-only" type="file" accept="image/*,video/*" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </div>;
            })() : <>
            <div className="med">
              {files.map((f, i) => <Thumb key={`${f.name}-${f.lastModified}-${i}`} item={f} onEdit={() => onEditFile(f)} onRemove={() => setFiles((c) => c.filter((_, j) => j !== i))} />)}
              {libraryMediaUrls.map((u) => <Thumb key={u} item={u} onRemove={() => setLibraryMediaUrls((c) => c.filter((x) => x !== u))} />)}
              <button type="button" className="add" aria-label="Add photos or videos" onClick={() => fileInput.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>{uploadBusy ? <LoaderCircle size={18} className="animate-spin" /> : <Plus size={18} />}</button>
              <input ref={fileInput} className="sr-only" type="file" accept="image/*,video/*" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </div>
            </>}
            <div className="tb">
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Add image or video" title="Image / video" onClick={() => fileInput.current?.click()}><ImageIcon size={17} /></button>
              <button ref={emojiBtn} type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Emoji" title="Emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((o) => !o)}><Smile size={17} /></button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Insert hashtag" title="Hashtag" onClick={() => insert("#")}><Hash size={17} /></button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Insert link" title="Link" onClick={() => insert("https://")}><Link2 size={17} /></button>
              <span style={{ position: "relative" }}>
                <button type="button" className="btn btn-ghost btn-sm c2-ai" aria-haspopup="menu" aria-expanded={aiOpen} onClick={() => { setAiOpen((o) => !o); setTplOpen(false); }}><Sparkles size={16} /><span className="c2-d">AI</span></button>
                {aiOpen && <div className="menu" role="menu">
                  {!tplOpen ? <>
                    <a role="menuitem" onClick={() => ai("rewrite")}><WandSparkles className="ico" />Rewrite</a>
                    <a role="menuitem" onClick={() => ai("grammar")}><SpellCheck className="ico" />Fix grammar</a>
                    <a role="menuitem" onClick={() => ai("hashtags")}><Hash className="ico" />Suggest hashtags</a>
                    <a role="menuitem" onClick={() => ai("shorten")}><Scissors className="ico" />Shorten for X</a>
                    <hr /><a role="menuitem" onClick={() => setTplOpen(true)}><FileText className="ico" />Insert template…</a>
                  </> : <>{templates.map((t) => <a role="menuitem" key={t.name} onClick={() => { setValue(t.text); setAiOpen(false); setTplOpen(false); }}><FileText className="ico" />{t.name}</a>)}<hr /><a onClick={() => setTplOpen(false)}>← Back</a></>}
                </div>}
              </span>
              <span className="grow" />
              <span className={`cnt ${cntCls}`} title={strictest ? `${LABELS[strictest.platform]} limit (strictest selected)` : "Character count"}>{strictest && <ChannelTile platform={strictest.platform} size={16} />}{len.toLocaleString()} / {limit.toLocaleString()}</span>
            </div>
          </div>
          {strictest && cntCls && !tabAccount && <p className={`c2-hint ${cntCls}`}><AlertCircle size={14} />{len > limit ? `${(len - limit).toLocaleString()} characters over on ${LABELS[strictest.platform]} (strictest limit).` : `${(limit - len).toLocaleString()} characters left on ${LABELS[strictest.platform]} (strictest limit).`}{xAcc && strictest.platform === "x" && <> <a onClick={() => { changeCaptionMode("custom"); setTab(xAcc.id); setPreviewId(xAcc.id); }}>Edit for X</a></>}</p>}
          {selectedAccounts.length > 0 && <div className="c2-opts">
            <button type="button" className="c2-opts-t" aria-expanded={optsOpen} onClick={() => setOptsOpen((o) => !o)}><Settings2 size={14} />Channel options<ChevronDown size={14} style={{ transform: optsOpen ? "rotate(180deg)" : "none" }} /></button>
            {optsOpen && <div className="c2-opts-l">{selectedAccounts.map((a) => <div key={a.id} className="row" style={{ gap: 8 }}><ChannelTile platform={a.platform} size={18} /><span className="sm grow">{a.account_name || LABELS[a.platform]}</span><ChannelFormatSelector account={a} format={formatsByAccount[a.id] || "Post"} automatic={!formatOverridesByAccount[a.id]} onSelect={(f) => setAccountFormat(a.id, f)} /><PlatformSettingsPopover account={a} settings={platformSettingsByAccount[a.id] || {}} onChange={setPlatformSetting} open={settingsOpen === a.id} onToggle={() => setSettingsOpen((c) => c === a.id ? "" : a.id)} /></div>)}</div>}
          </div>}
        </div>
        {fixCount > 0 && <div className="mp" role="region" aria-label="Media check">
          <div className="hd"><span className="mk"><AlertCircle size={16} /></span><div className="grow"><b>Media needs a few changes for {fixCount} account{fixCount === 1 ? "" : "s"}</b>
            <p className="sm muted">Each network accepts media a little differently. We can sort it out for you.</p></div>
            <div className="acts"><button type="button" className="btn btn-grad btn-sm" onClick={(e) => { fixTrigger.current = e.currentTarget; setSheetOpen(true); }}><Sparkles size={14} />Fix for me</button><button type="button" className="btn btn-secondary btn-sm" aria-expanded={reviewOpen} onClick={() => setReviewOpen((o) => !o)}>{reviewOpen ? "Hide" : "Review"}</button></div></div>
          {reviewOpen && summary.needs.map((r) => { const pr = r.check.problems[0]; return <div className="ln" key={r.account.id}>
            <ChannelTile platform={r.account.platform} size={18} /><span className="grow"><b>{nameOf(r.account)}</b> <span className="d">{pr.title}{pr.detail ? ` — ${pr.detail}` : ""}</span></span>
            {pr.action && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (["add_media", "add_video"].includes(pr.action.id)) fileInput.current?.click(); else if (["shorten", "replace"].includes(pr.action.id)) { changeCaptionMode("custom"); setTab(r.account.id); } else applyMediaAction(r.account, pr.action); }}>{pr.action.label}</button>}
          </div>; })}
        </div>}
        {mediaErrors.length > 0 && <div className="c2-blockers c2-merrs" role="alert">{mediaErrors.map((g) => <p key={g.key} className="c2-hint over"><span className="c2-avs" aria-hidden="true">{g.accounts.slice(0, 5).map((a) => <ChannelTile key={a.id} platform={a.platform} size={16} />)}</span><span>{g.message}</span></p>)}</div>}
        {mediaNotes.length > 0 && <div className="c2-notes">{mediaNotes.map((n, i) => <p key={`mn-${n.account.id}-${i}`} className="sm muted">{nameOf(n.account)}: {n.text}</p>)}</div>}
        {sheetOpen && <FixSheet rows={mediaReport} items={sharedMedia} returnFocus={fixTrigger} onCancel={() => setSheetOpen(false)} onApply={applyFix} onAddMedia={() => fileInput.current?.click()} nameOf={(a) => accountDisplayName(a)} renderAvatar={(a) => <AccountAvatar account={a} size={36} />} />}
        {mtoast && <div className="mtoast" role="status" aria-live="polite" onMouseEnter={() => window.clearTimeout(toastTimer.current)} onMouseLeave={startToast} onFocus={() => window.clearTimeout(toastTimer.current)} onBlur={startToast}>Media updated for {mtoast.count} account{mtoast.count === 1 ? "" : "s"}. <button type="button" className="lnk" onClick={() => { window.clearTimeout(toastTimer.current); mtoast.undo(); setMtoast(null); }}>Undo</button></div>}
        {channelWarnings.length > 0 && <div className="c2-blockers" role="alert">{channelWarnings.map((w, i) => <p key={`${w.account.id}-${i}`} className="c2-hint over"><AlertCircle size={14} /><span><b>{LABELS[w.account.platform] || w.account.platform}{w.account.account_name ? ` · ${w.account.account_name}` : ""}:</b> {w.message}</span></p>)}</div>}
        {channelNotices.length > 0 && <div className="c2-blockers">{channelNotices.map((w, i) => <p key={`n-${w.account.id}-${i}`} className="c2-hint warn"><AlertCircle size={14} /><span><b>{LABELS[w.account.platform] || w.account.platform}:</b> {w.message}</span></p>)}</div>}
          <PublishBar blocked={block.blocked} blockHint={block.hint} mode={publishMode} setMode={setPublishMode} busy={busy} submit={guardedSubmit} saveAsDraft={saveAsDraft} whenText={whenText} zoneText={zoneLabel(timeZone)} date={date} setDate={setDate} time={time} setTime={setTime} timeZone={timeZone} setTimeZone={setTimeZone} timezones={timezones} minDate={minDate} request={request} selectedAccounts={selectedAccounts} onSetupQueue={onSetupQueue} />
      </form>
      <aside className="c2-pv">
        {selectedAccounts.length ? <>
          <div className="pvh" role="tablist">{selectedAccounts.map((a) => <a role="tab" key={a.id} className={previewAccount?.id === a.id ? "active" : ""} onClick={() => setPreviewId(a.id)} title={a.account_name}><ChannelTile platform={a.platform} size={18} /><span className={previewAccount?.id === a.id ? "" : "sr-only"}>{LABELS[a.platform]}</span></a>)}</div>
          {previewAccount && <PostPreview account={previewAccount} caption={captionForAccount(previewAccount)} media={mediaForAccount(previewAccount)} title={title} format={formatForAccount(previewAccount)} settings={platformSettingsByAccount[previewAccount.id] || {}} igCrop={igCropByAccount[previewAccount.id] || null} onIgCrop={onIgCrop ? (next) => onIgCrop(previewAccount, next) : undefined} />}
        </> : <div className="card card-pad sm muted">Select a channel to see a preview.</div>}
      </aside>
    </div>
    <EmojiPicker open={emojiOpen} anchorRef={emojiBtn} recent={recentEmojis} onSelect={(em) => { insert(em); setRecentEmojis((r) => [em, ...r.filter((x) => x !== em)].slice(0, 16)); }} onClose={() => setEmojiOpen(false)} />
  </section>;
}
