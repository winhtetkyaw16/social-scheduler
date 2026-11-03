import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, ChartNoAxesColumn, Forward, Globe, Heart, ListPlus, MessageCircle, MessageSquare, MoreHorizontal, Repeat, Repeat2, Send, Share, ThumbsDown, ThumbsUp, Play } from "lucide-react";
import { accountDisplayName, accountHandle, resolveAvatarUrl } from "./sc/ui.jsx";
import brandMark from "./assets/brand/socialcastly-mark-256.png";

const isVideo = (item) => typeof item === "string" ? /\.(mp4|mov|webm|m4v)(\?|$)/i.test(item) : String(item?.type || "").startsWith("video/");
// Object URLs are cached per File and only revoked when that File leaves the list
// (or on unmount). Callers pass a fresh array every render (e.g. mediaForAccount),
// so we must not key effects on array identity or the <video> reloads per keystroke.
function useUrls(items) {
  const cache = useRef(new Map());
  const stable = useRef([]);
  const list = items || [];
  if (list.length !== stable.current.length || list.some((it, i) => it !== stable.current[i])) stable.current = list;
  const same = stable.current;
  const urls = useMemo(() => same.map((it) => {
    if (!it) return "";
    if (typeof it === "string") return it;
    let u = cache.current.get(it);
    if (!u) { u = URL.createObjectURL(it); cache.current.set(it, u); }
    return u;
  }), [same]);
  useEffect(() => {
    const live = new Set(same);
    for (const [f, u] of cache.current) if (!live.has(f)) { URL.revokeObjectURL(u); cache.current.delete(f); }
  }, [urls]);
  useEffect(() => () => { for (const u of cache.current.values()) URL.revokeObjectURL(u); cache.current.clear(); }, []);
  return urls;
}
function Av({ account, size = 40 }) {
  const [broken, setBroken] = useState(false);
  const name = accountDisplayName(account);
  const ini = name.replace(/^@/, "").split(/[\s._-]+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const src = resolveAvatarUrl(account);
  useEffect(() => { setBroken(false); }, [src]);
  return src && !broken ? <img className="pv-av" src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ width: size, height: size }} /> : <span className="pv-av" style={{ width: size, height: size, fontSize: size * 0.32 }}>{ini}</span>;
}
// Natural width/height ratio per media URL (URLs are stable via useUrls), so typing never resets it.
const natRatio = new Map();
// fit modes: given natural ratio r (w/h) return the box ratio; media is object-fit: cover inside it.
const FIT = {
  fb: (r) => Math.max(r, 4 / 5),                       // landscape/square native, portrait native down to 4:5
  ig: (r) => Math.min(1.91, Math.max(r, 4 / 5)),       // Instagram feed clamp 1.91:1 .. 4:5
  x: (r) => Math.max(r, 3 / 4),                        // native landscape, portrait capped at 3:4
  li: (r) => Math.max(r, 4 / 5),                       // native landscape, portrait capped at 4:5
};
const PH = { fb: [16 / 9, 1], ig: [1, 1], x: [16 / 9, 16 / 9], li: [16 / 9, 1] }; // [video, image] before load
const Md = memo(function Md({ url, video, ratio, fit, radius, overlay, children }) {
  const [nat, setNat] = useState(() => natRatio.get(url) || 0);
  useEffect(() => { setNat(natRatio.get(url) || 0); }, [url]);
  const got = (w, h) => { if (w > 0 && h > 0) { const r = w / h; natRatio.set(url, r); setNat(r); } };
  const box = fit && FIT[fit] ? (url && nat ? FIT[fit](nat) : (video ? PH[fit][0] : PH[fit][1])) : ratio;
  return <div className="md" style={{ aspectRatio: box, borderRadius: radius }}>
    {url ? (video ? <video src={url} muted playsInline preload="metadata" onLoadedMetadata={fit ? (e) => got(e.currentTarget.videoWidth, e.currentTarget.videoHeight) : undefined} /> : <img className="real" src={url} alt="" onLoad={fit ? (e) => got(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight) : undefined} />) : <img className="ph" src={brandMark} alt="" width={56} height={56} />}
    {video && url && !overlay && <span className="play"><Play size={18} fill="currentColor" /></span>}
    {children}
  </div>;
});
function clip(text, n) { const t = text || ""; return t.length > n ? [t.slice(0, n).replace(/\s+\S*$/, ""), true] : [t, false]; }
const handle = (a) => accountHandle(a);
const name = (a) => accountDisplayName(a);
const Txt = ({ text }) => <>{String(text || "").split(/(https?:\/\/\S+|#[\p{L}\p{N}_]+)/u).map((p, i) => /^(https?:\/\/|#)/.test(p) ? <span key={i} className="lk">{p}</span> : p)}</>;

// ---------- Instagram: real-size preview (feed / reel / story) + crop ----------
const IG_MIN = 4 / 5, IG_MAX = 1.91;
const igClamp = (r) => Math.min(IG_MAX, Math.max(IG_MIN, r));
const igInRange = (r) => r >= 0.795 && r <= 1.915;
function igRatioLabel(r) {
  if (Math.abs(r - 1) < 0.01) return ["1:1", "1080×1080"];
  if (Math.abs(r - IG_MIN) < 0.006) return ["4:5", "1080×1350"];
  if (Math.abs(r - IG_MAX) < 0.01) return ["1.91:1", "1080×566"];
  if (Math.abs(r - 16 / 9) < 0.01) return ["16:9", "1080×608"];
  return [`${r >= 1 ? r.toFixed(2) + ":1" : "1:" + (1 / r).toFixed(2)}`, `1080×${Math.round(1080 / r)}`];
}
const igName = (a) => String(name(a)).toLowerCase().replace(/\s+/g, ".");
function useNatural(url, video) {
  const [nat, setNat] = useState(() => natRatio.get(url) || 0);
  useEffect(() => {
    setNat(natRatio.get(url) || 0);
    if (!url || natRatio.get(url)) return undefined;
    let off = false;
    const done = (w, h) => { if (!off && w > 0 && h > 0) { natRatio.set(url, w / h); setNat(w / h); } };
    if (video) { const v = document.createElement("video"); v.preload = "metadata"; v.muted = true; v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight); v.src = url; }
    else { const im = new Image(); im.onload = () => done(im.naturalWidth, im.naturalHeight); im.src = url; }
    return () => { off = true; };
  }, [url, video]);
  return nat;
}
const IgMedia = ({ url, video, pos = "50% 50%", children }) => <>
  {url ? (video ? <video src={url} muted playsInline preload="metadata" style={{ objectPosition: pos }} /> : <img className="real" src={url} alt="" style={{ objectPosition: pos }} />) : <img className="ph" src={brandMark} alt="" width={56} height={56} />}
  {children}
</>;

async function cropToJpeg(url, nat, target, off, baseName) {
  let src = url;
  if (!/^blob:|^data:/.test(url)) { const res = await fetch(url, { credentials: "include" }); if (!res.ok) throw new Error("fetch"); src = URL.createObjectURL(await res.blob()); }
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
  const W = img.naturalWidth, H = img.naturalHeight;
  let sw = W, sh = H, sx = 0, sy = 0;
  if (nat > target) { sw = Math.round(H * target); sx = Math.round((W - sw) * off); } else { sh = Math.round(W / target); sy = Math.round((H - sh) * off); }
  const scale = Math.min(1, 1440 / sw);
  const c = document.createElement("canvas"); c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  if (src !== url) URL.revokeObjectURL(src);
  const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.92));
  if (!blob) throw new Error("encode");
  const stem = String(baseName || "photo").replace(/\.[^.]+$/, "");
  return new File([blob], `${stem}-instagram.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

function IgCrop({ url, nat, target, item, onReplaceMedia, off, setOff }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const box = useRef(null); const drag = useRef(null);
  const wide = nat > target;
  const winW = wide ? (target / nat) * 100 : 100, winH = wide ? 100 : (nat / target) * 100;
  const left = wide ? (100 - winW) * off : 0, top = wide ? 0 : (100 - winH) * off;
  const label = target === IG_MIN ? "4:5" : "1.91:1";
  const move = (e) => {
    if (!drag.current || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const free = wide ? r.width * (1 - winW / 100) : r.height * (1 - winH / 100);
    const d = wide ? e.clientX - drag.current.x : e.clientY - drag.current.y;
    setOff(Math.min(1, Math.max(0, drag.current.off + (free ? d / free : 0))));
  };
  const apply = async () => {
    setBusy(true); setErr("");
    try { const f = await cropToJpeg(url, nat, target, off, item?.name); onReplaceMedia?.(item, f); setEditing(false); setOff(0.5); }
    catch { setErr("Couldn't crop this photo here. Crop it to " + label + " in a photo editor, then add it again."); }
    finally { setBusy(false); }
  };
  return <div className="igc">
    <div ref={box} className={`igc-v${editing ? " edit" : ""}`} style={{ aspectRatio: nat }}
      onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <img src={url} alt="" />
      <div className="igc-win" style={{ left: `${left}%`, top: `${top}%`, width: `${winW}%`, height: `${winH}%` }}
        onPointerDown={editing ? (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, off }; e.preventDefault(); } : undefined} />
    </div>
    <div className="igc-note">
      <span className="grow">{editing ? `Drag the frame to choose what stays in.` : `This photo will be cropped to ${label} for Instagram. Crop it before posting.`}</span>
      {editing ? <><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setOff(0.5); }} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={apply} disabled={busy || !onReplaceMedia}>{busy ? "Cropping…" : "Apply crop"}</button></>
        : <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Adjust crop</button>}
    </div>
    {err && <p className="igp-err">{err}</p>}
    <p className="igp-cap">Your post will look like this:</p>
  </div>;
}
function fmtDur(s) { if (!Number.isFinite(s)) return ""; const m = Math.floor(s / 60), r = Math.round(s % 60); return `${m}:${String(r).padStart(2, "0")}`; }
function useVideoMeta(url, video) {
  const [d, setD] = useState(null);
  useEffect(() => { setD(null); if (!url || !video) return undefined; let off = false; const v = document.createElement("video"); v.preload = "metadata"; v.muted = true; v.onloadedmetadata = () => { if (!off) setD(v.duration); }; v.src = url; return () => { off = true; }; }, [url, video]);
  return d;
}

function InstagramPreview({ account, caption, capCls, media, format, onReplaceMedia }) {
  const urls = useUrls(media);
  const hasVideo = media.some(isVideo);
  const initial = format === "Story" ? "story" : format === "Reel / Video" && hasVideo ? "reel" : "feed";
  const [view, setView] = useState(initial);
  useEffect(() => { setView(initial); }, [initial]);
  useEffect(() => { if (view === "reel" && !hasVideo) setView("feed"); }, [hasVideo, view]);
  const [idx, setIdx] = useState(0);
  useEffect(() => { if (idx >= urls.length) setIdx(0); }, [urls.length, idx]);
  const cur = urls[idx] || ""; const curItem = media[idx]; const curVid = curItem ? isVideo(curItem) : false;
  const nat = useNatural(cur, curVid);
  const [cropOff, setCropOff] = useState(0.5);
  useEffect(() => { setCropOff(0.5); }, [cur]);
  const vi = media.findIndex(isVideo); const vurl = vi >= 0 ? urls[vi] : "";
  const dur = useVideoMeta(vurl, true);
  const [t, more] = clip(caption, 90);
  const uname = igName(account);
  const box = nat ? igClamp(nat) : 1;
  const needsCrop = view === "feed" && cur && !curVid && nat && !igInRange(nat);
  const [rl] = igRatioLabel(box);
  const label = view === "feed" ? igRatioLabel(box).join(" · ") : "9:16 · 1080×1920";
  const n = urls.length;
  const fm = (k, txt, show = true) => show && <a role="tab" className={view === k ? "on" : ""} onClick={() => setView(k)}>{txt}</a>;
  const stUrl = view === "reel" ? vurl : cur; const stVid = view === "reel" ? true : curVid;
  const vSize = vi >= 0 && typeof media[vi] !== "string" ? media[vi].size : 0;
  const vNote = (() => {
    if (vi < 0 || view === "feed") return "";
    const mb = vSize / 1048576; const parts = [];
    if (view === "reel") { if (dur && dur < 3) parts.push("Reels must be at least 3 seconds."); if (dur && dur > 900) parts.push("Reels can be up to 15 minutes."); if (mb > 300) parts.push("Reels can be up to 300 MB."); }
    if (view === "story") { if (dur && dur < 3) parts.push("Story videos must be at least 3 seconds."); if (dur && dur > 60) parts.push("Story videos can be up to 60 seconds."); if (mb > 100) parts.push("Story videos can be up to 100 MB."); }
    return parts.join(" ");
  })();
  const head = <div className="h"><Av account={account} size={32} /><b className="grow">{uname}</b><MoreHorizontal size={18} /></div>;
  const feedCard = <div className="pp2 igf">
    {head}
    <div className="md" style={{ aspectRatio: box }}>
      <IgMedia url={cur} video={curVid} pos={needsCrop ? (nat > 1 ? `${cropOff * 100}% 50%` : `50% ${cropOff * 100}%`) : "50% 50%"} />
      {curVid && cur && <span className="play"><Play size={18} fill="currentColor" /></span>}
      {cur && <span className="ig-dim">{rl}</span>}
      {n > 1 && <span className="ig-ct">{idx + 1}/{n}</span>}
    </div>
    <div className="ac ig"><Heart size={22} /><MessageCircle size={22} /><Send size={22} />
      {n > 1 && <span className="ig-dots">{urls.map((_, i) => <i key={i} className={i === idx ? "on" : ""} onClick={() => setIdx(i)} />)}</span>}
      <span className="grow" /><Bookmark size={22} /></div>
    <div className="ig-likes">1,284 likes</div>
    <div className={`${capCls} ig-capt`}><b>{uname}</b> <Txt text={t} />{more && <span className="mo">… more</span>}</div>
  </div>;
  return <div className="igp">
    <div className="igp-top"><div className="fsw" role="tablist">{fm("feed", "Feed post")}{fm("reel", "Reel", hasVideo)}{fm("story", "Story")}</div><span className="igp-lbl">{label}</span></div>
    {view === "feed" && <>
      {needsCrop && <IgCrop key={cur} url={cur} nat={nat} target={nat < 1 ? IG_MIN : IG_MAX} item={curItem} onReplaceMedia={onReplaceMedia} off={cropOff} setOff={setCropOff} />}
      {feedCard}
      <p className="igp-cap">Shown at Instagram's real proportions.{hasVideo ? " Reel appears because this post has a video." : ""}</p>
    </>}
    {view === "reel" && <div className="igr-wrap">
      <div className="pp2 igv"><div className="md" style={{ aspectRatio: "9/16" }}><IgMedia url={stUrl} video={stVid} />
        <div className="igv-top">Reels</div>
        <div className="rail"><span><Heart size={24} />1.2K</span><span><MessageCircle size={24} />48</span><span><Send size={22} /></span><span><MoreHorizontal size={20} /></span></div>
        <div className="ov"><div className="row" style={{ gap: 6, marginBottom: 4 }}><Av account={account} size={24} /><b>{uname}</b><span className="igv-follow">Follow</span></div><div>{clip(caption, 60)[0]}{clip(caption, 60)[1] && <span style={{ opacity: .75 }}>… more</span>}</div><div className="igv-audio">♪ Original audio</div></div>
      </div></div>
      <div className="igr-grid"><div className="md" style={{ aspectRatio: "3/4" }}><IgMedia url={stUrl} video={stVid} /><span className="ig-dim">3:4</span></div><p className="igp-cap">Shown as 3:4 in your profile grid</p></div>
    </div>}
    {view === "story" && <>
      <div className="pp2 igv"><div className="md" style={{ aspectRatio: "9/16" }}><IgMedia url={stUrl} video={stVid} />
        <div className="igs-zone top" /><div className="igs-zone bot" />
        <div className="igs-bar"><i /></div>
        <div className="igs-h"><Av account={account} size={28} /><b>{uname}</b><span>Just now</span></div>
      </div></div>
      <p className="igp-cap">Keep text away from edges</p>
    </>}
    {view !== "feed" && vi >= 0 && <p className={`igp-cap${vNote ? " warn" : ""}`}>{vNote || `Video ${fmtDur(dur)}${vSize ? ` · ${(vSize / 1048576).toFixed(1)} MB` : ""} fits Instagram's ${view === "reel" ? "Reel" : "Story"} limits.`}</p>}
  </div>;
}

// ---------- Compact previews for the other networks (same look as the Instagram card) ----------
function sizeLabel(r) {
  const k = [[1, "1:1", "1080×1080"], [4 / 5, "4:5", "1080×1350"], [3 / 4, "3:4", "1080×1440"], [9 / 16, "9:16", "1080×1920"], [16 / 9, "16:9", "1920×1080"], [1.91, "1.91:1", "1200×628"]];
  for (const [v, a, b] of k) if (Math.abs(r - v) < 0.012) return [a, b];
  return r >= 1 ? [`${r.toFixed(2)}:1`, `1920×${Math.round(1920 / r)}`] : [`1:${(1 / r).toFixed(2)}`, `1080×${Math.round(1080 / r)}`];
}
function useCarousel(media) {
  const urls = useUrls(media);
  const [idx, setIdx] = useState(0);
  useEffect(() => { if (idx >= urls.length) setIdx(0); }, [urls.length, idx]);
  const cur = urls[idx] || ""; const item = media[idx]; const vid = item ? isVideo(item) : false;
  const vi = media.findIndex(isVideo);
  return { urls, idx, setIdx, n: urls.length, cur, vid, vurl: vi >= 0 ? urls[vi] : "", hasVideo: vi >= 0 };
}
// Media box at a given ratio with ratio pill, 1/N badge, dots, optional duration badge.
function CMd({ c, ratio, radius, inset, dur, pill = true }) {
  const [rl] = sizeLabel(ratio);
  return <div className={`md${inset ? " cpv-inset" : ""}`} style={{ aspectRatio: ratio, borderRadius: radius }}>
    <IgMedia url={c.cur} video={c.vid} />
    {c.vid && c.cur && <span className="play"><Play size={18} fill="currentColor" /></span>}
    {c.cur && pill && <span className="ig-dim">{rl}</span>}
    {c.n > 1 && <span className="ig-ct">{c.idx + 1}/{c.n}</span>}
    {dur ? <span className="cpv-dur">{fmtDur(dur)}</span> : null}
    {c.n > 1 && <span className="cpv-dots">{c.urls.map((_, i) => <i key={i} className={i === c.idx ? "on" : ""} onClick={() => c.setIdx(i)} />)}</span>}
  </div>;
}
function Cpv({ net, tabs, view, setView, label, foot, children }) {
  return <div className="igp cpv">
    <div className="igp-top">
      {tabs ? <div className="fsw" role="tablist">{tabs.map(([k, txt]) => <a key={k} role="tab" className={view === k ? "on" : ""} onClick={() => setView(k)}>{txt}</a>)}</div> : <b className="cpv-net">{net}</b>}
      <span className="igp-lbl">{label}</span>
    </div>
    {children}
    <p className="igp-cap">{foot || `${net} real proportions`}</p>
  </div>;
}
// 9:16 vertical frame (Reel / Story / Short / TikTok), reusing the Instagram .igv frame styles.
function VFrame({ c, top, rail, ov, story, account, uname }) {
  const url = c.cur || c.vurl; const vid = c.cur ? c.vid : !!c.vurl;
  return <div className="pp2 igv"><div className="md" style={{ aspectRatio: "9/16" }}><IgMedia url={url} video={vid} />
    {story ? <><div className="igs-zone top" /><div className="igs-zone bot" /><div className="igs-bar"><i /></div>
      <div className="igs-h"><Av account={account} size={28} /><b>{uname}</b><span>Just now</span></div></> : <>
      {top && <div className="igv-top">{top}</div>}
      {c.n > 1 && <span className="ig-ct" style={{ top: 44 }}>{c.idx + 1}/{c.n}</span>}
      <div className="rail">{rail}</div>
      <div className="ov">{ov}</div></>}
  </div></div>;
}
const viewFrom = (format, map, dflt) => map[format] || dflt;

function FacebookPreview({ account, caption, capCls, media, format }) {
  const c = useCarousel(media);
  const init = viewFrom(format, { "Reel / Video": "reel", Story: "story" }, "post");
  const [view, setView] = useState(init); useEffect(() => { setView(init); }, [init]);
  const nat = useNatural(c.cur, c.vid);
  const box = nat ? FIT.fb(nat) : (c.vid ? 16 / 9 : 1);
  const [t, more] = clip(caption, 110);
  const label = view === "post" ? (c.cur ? sizeLabel(box).join(" · ") : "Text post") : "9:16 · 1080×1920";
  return <Cpv net="Facebook" tabs={[["post", "Post"], ["reel", "Reel"], ["story", "Story"]]} view={view} setView={setView} label={label}>
    {view === "post" && <div className="pp2">
      <div className="h"><Av account={account} size={32} /><div className="grow"><b>{name(account)}</b><div className="sub">Just now · <Globe size={11} /></div></div><MoreHorizontal size={18} /></div>
      <div className={`${capCls} cpv-capt`}><Txt text={t} />{more && <>… <span className="mo">more</span></>}</div>
      {c.cur && <CMd c={c} ratio={box} radius={0} />}
      <div className="ac fb"><span><ThumbsUp size={15} />Like</span><span><MessageCircle size={15} />Comment</span><span><Forward size={15} />Share</span></div>
    </div>}
    {view === "reel" && <VFrame c={c} top="Reels" rail={<><span><ThumbsUp size={22} />1.2K</span><span><MessageCircle size={22} />48</span><span><Forward size={22} /></span><span><MoreHorizontal size={20} /></span></>}
      ov={<><div className="row" style={{ gap: 6, marginBottom: 4 }}><Av account={account} size={24} /><b>{name(account)}</b><span className="igv-follow">Follow</span></div><div>{clip(caption, 60)[0]}{clip(caption, 60)[1] && <span style={{ opacity: .75 }}>… more</span>}</div></>} />}
    {view === "story" && <VFrame c={c} story account={account} uname={name(account)} />}
  </Cpv>;
}

function LinkedInPreview({ account, caption, capCls, media }) {
  const c = useCarousel(media);
  const nat = useNatural(c.cur, c.vid);
  const box = nat ? FIT.li(nat) : (c.vid ? 16 / 9 : 1);
  const [t, more] = clip(caption, 120);
  return <Cpv net="LinkedIn" label={c.cur ? sizeLabel(box).join(" · ") : "Text post"}>
    <div className="pp2">
      <div className="h"><Av account={account} size={32} /><div className="grow"><b>{name(account)}</b><div className="sub">Now · <Globe size={11} /></div></div><MoreHorizontal size={18} /></div>
      <div className={`${capCls} cpv-capt`}><Txt text={t} />{more && <>… <span className="mo">more</span></>}</div>
      {c.cur && <CMd c={c} ratio={box} radius={0} />}
      <div className="ac li"><span><ThumbsUp size={15} />Like</span><span><MessageSquare size={15} />Comment</span><span><Repeat size={15} />Repost</span><span><Send size={15} />Send</span></div>
    </div>
  </Cpv>;
}

function InsetPreview({ net, account, caption, capCls, media, fit, uname, sub, actions, inset }) {
  const c = useCarousel(media);
  const nat = useNatural(c.cur, c.vid);
  const box = nat ? FIT[fit](nat) : (c.vid ? 16 / 9 : 1);
  const [t, more] = clip(caption, 140);
  return <Cpv net={net} label={c.cur ? sizeLabel(box).join(" · ") : "Text post"}>
    <div className="pp2 cpv-row">
      <Av account={account} size={32} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="cpv-nm"><b>{uname}</b> <span className="sub">{sub}</span><span className="grow" /><MoreHorizontal size={16} /></div>
        <div className={`${capCls} cpv-capt`} style={{ padding: "2px 0 0" }}><Txt text={t} />{more && <>… <span className="mo">more</span></>}</div>
        {c.cur && <div className={`cpv-media ${inset || ""}`}><CMd c={c} ratio={box} radius={12} inset /></div>}
        <div className="ac cpv-ac">{actions}</div>
      </div>
    </div>
  </Cpv>;
}

function TikTokPreview({ account, caption, media }) {
  const c = useCarousel(media);
  const [t, more] = clip(caption, 70);
  return <Cpv net="TikTok" label="9:16 · 1080×1920">
    <VFrame c={c} top={<span className="cpv-tt"><span>Following</span><b>For You</b></span>}
      rail={<><Av account={account} size={30} /><span><Heart size={22} fill="currentColor" />1.2K</span><span><MessageCircle size={22} fill="currentColor" />48</span><span><Bookmark size={20} fill="currentColor" /></span><span><Forward size={22} fill="currentColor" /></span></>}
      ov={<><b>{handle(account)}</b><div><Txt text={t} />{more && <span style={{ opacity: .75 }}>… more</span>}</div><div className="igv-audio">♪ Original sound</div></>} />
  </Cpv>;
}

function YouTubePreview({ account, caption, media, title, format }) {
  const c = useCarousel(media);
  const init = ["Short", "Reel / Video", "Story"].includes(format) ? "shorts" : "video";
  const [view, setView] = useState(init); useEffect(() => { setView(init); }, [init]);
  const dur = useVideoMeta(c.vid ? c.cur : "", c.vid);
  const ttl = title || String(caption || "").split("\n")[0];
  return <Cpv net="YouTube" tabs={[["video", "Video"], ["shorts", "Shorts"]]} view={view} setView={setView} label={view === "video" ? "16:9 · 1920×1080" : "9:16 · 1080×1920"}>
    {view === "video" ? <div className="pp2">
      <CMd c={c} ratio={16 / 9} radius={0} dur={dur} />
      <div className="cpv-row" style={{ padding: 12 }}><Av account={account} size={32} /><div className="grow" style={{ minWidth: 0 }}><b className="yt-t">{clip(ttl, 100)[0]}</b><div className="sub">{name(account)} · 0 views · Just now</div></div><MoreHorizontal size={16} /></div>
    </div> : <VFrame c={c} top="Shorts"
      rail={<><span><ThumbsUp size={22} fill="currentColor" />Like</span><span><ThumbsDown size={22} fill="currentColor" /></span><span><MessageSquare size={22} fill="currentColor" />0</span><span><Forward size={22} fill="currentColor" /></span></>}
      ov={<><div className="row" style={{ gap: 6, marginBottom: 4 }}><Av account={account} size={24} /><b>{handle(account)}</b><span className="yt-sub">Subscribe</span></div><div>{clip(ttl, 60)[0]}</div></>} />}
  </Cpv>;
}

export default function PostPreview(
{ account, caption, media = [], title = "", format = "Post", settings = {}, onReplaceMedia }) {
  const urls = useUrls(media);
  const first = urls[0] || ""; const vid = media[0] ? isVideo(media[0]) : false;
  const p = account?.platform;
  const empty = !caption?.trim();
  const cap = empty ? "Your caption will appear here." : caption;
  const capCls = empty ? "tx ph-t" : "tx";
  const vertical = ["Short", "Reel / Video", "Story"].includes(format);

  if (p === "facebook") return <FacebookPreview account={account} caption={cap} capCls={capCls} media={media} format={format} />;

  if (p === "instagram") return <InstagramPreview account={account} caption={cap} capCls={capCls} media={media} format={format} onReplaceMedia={onReplaceMedia} />;

  if (p === "x" || p === "twitter") return <InsetPreview net="X" account={account} caption={cap} capCls={capCls} media={media} fit="x" uname={name(account)} sub={`${handle(account)} · now`}
    actions={<><span><MessageCircle size={15} />0</span><span><Repeat2 size={15} />0</span><span><Heart size={15} />0</span><span><ChartNoAxesColumn size={15} />0</span></>} />;

  if (p === "linkedin") return <LinkedInPreview account={account} caption={cap} capCls={capCls} media={media} />;

  if (p === "tiktok") return <TikTokPreview account={account} caption={cap} media={media} />;

  if (p === "youtube") return <YouTubePreview account={account} caption={cap} media={media} title={title} format={format} />;

  if (p === "pinterest") { const ttl = settings.title || title || cap.split("\n")[0]; return <div className="pp2" style={{ padding: 8 }}>
    <Md url={first} video={vid} ratio="2/3" radius={16}><span className="pin-save">Save</span></Md>
    <div style={{ padding: "8px 4px 4px" }}><b className="yt-t">{clip(ttl, 100)[0]}</b><div className="row" style={{ gap: 6, marginTop: 6 }}><Av account={account} size={22} /><span className="sub grow">{name(account)}</span><Heart size={15} /><Share size={15} /><MoreHorizontal size={15} /></div></div></div>; }

  if (p === "threads") return <InsetPreview net="Threads" account={account} caption={cap} capCls={capCls} media={media} fit="li" uname={igName(account)} sub="now" inset="th"
    actions={<><Heart size={17} /><MessageCircle size={17} /><Repeat size={17} /><Send size={17} /></>} />;

  return <div className="pp2"><div className="h"><Av account={account} /><b>{name(account)}</b></div><div className={capCls}><Txt text={cap} /></div>{first && <Md url={first} video={vid} ratio="4/5" />}</div>;
}
