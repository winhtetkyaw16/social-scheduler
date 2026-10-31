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
const Md = memo(function Md({ url, video, ratio, radius, overlay, children }) {
  return <div className="md" style={{ aspectRatio: ratio, borderRadius: radius }}>
    {url ? (video ? <video src={url} muted playsInline preload="metadata" /> : <img className="real" src={url} alt="" />) : <img className="ph" src={brandMark} alt="" width={56} height={56} />}
    {video && url && !overlay && <span className="play"><Play size={18} fill="currentColor" /></span>}
    {children}
  </div>;
});
function clip(text, n) { const t = text || ""; return t.length > n ? [t.slice(0, n).replace(/\s+\S*$/, ""), true] : [t, false]; }
const handle = (a) => accountHandle(a);
const name = (a) => accountDisplayName(a);
const Txt = ({ text }) => <>{String(text || "").split(/(https?:\/\/\S+|#[\p{L}\p{N}_]+)/u).map((p, i) => /^(https?:\/\/|#)/.test(p) ? <span key={i} className="lk">{p}</span> : p)}</>;

export default function PostPreview({ account, caption, media = [], title = "", format = "Post", settings = {} }) {
  const urls = useUrls(media);
  const first = urls[0] || ""; const vid = media[0] ? isVideo(media[0]) : false;
  const p = account?.platform;
  const empty = !caption?.trim();
  const cap = empty ? "Your caption will appear here." : caption;
  const capCls = empty ? "tx ph-t" : "tx";
  const vertical = ["Short", "Reel / Video", "Story"].includes(format);

  if (p === "facebook") { const [t, more] = clip(cap, 125); return <div className="pp2">
    <div className="h"><Av account={account} /><div className="grow"><b>{name(account)}</b><div className="sub">Just now · <Globe size={11} /></div></div><MoreHorizontal size={18} /></div>
    <div className={capCls}><Txt text={t} />{more && <>… <span className="mo">See more</span></>}</div>
    {(first || vertical) && <Md url={first} video={vid} ratio={vertical ? "9/16" : "4/5"} />}
    <div className="ac fb"><span><ThumbsUp size={17} />Like</span><span><MessageCircle size={17} />Comment</span><span><Forward size={17} />Share</span></div></div>; }

  if (p === "instagram") { const [t, more] = clip(cap, 125); return <div className="pp2">
    <div className="h"><Av account={account} size={32} /><b className="grow">{String(name(account)).toLowerCase().replace(/\s+/g, ".")}</b><MoreHorizontal size={18} /></div>
    <Md url={first} video={vid} ratio={vertical ? "9/16" : "4/5"} radius={0} />
    <div className="ac ig"><Heart size={22} /><MessageCircle size={22} /><Send size={22} /><span className="grow" /><Bookmark size={22} /></div>
    <div className={capCls}><b>{String(name(account)).toLowerCase().replace(/\s+/g, ".")}</b> <Txt text={t} />{more && <span className="mo">… more</span>}<div className="sub" style={{ marginTop: 4 }}>Just now</div></div></div>; }

  if (p === "x" || p === "twitter") return <div className="pp2"><div className="h" style={{ alignItems: "flex-start" }}><Av account={account} />
    <div className="grow" style={{ minWidth: 0 }}><div><b>{name(account)}</b> <span className="sub">{handle(account)} · now</span></div>
      <div className={capCls} style={{ padding: "2px 0 0", whiteSpace: "pre-wrap" }}><Txt text={cap} /></div>
      {first && <div style={{ marginTop: 10 }}><Md url={first} video={vid} ratio="16/9" radius={16} /></div>}
      <div className="ac x"><span><MessageCircle size={16} />0</span><span><Repeat2 size={16} />0</span><span><Heart size={16} />0</span><span><ChartNoAxesColumn size={16} />0</span><span className="grow" /><Bookmark size={16} /><Share size={16} /></div>
    </div></div></div>;

  if (p === "linkedin") { const [t, more] = clip(cap, 210); return <div className="pp2">
    <div className="h"><Av account={account} size={44} /><div className="grow"><b>{name(account)}</b><div className="sub">Now · <Globe size={11} /></div></div><MoreHorizontal size={18} /></div>
    <div className={capCls} style={{ whiteSpace: "pre-wrap" }}><Txt text={t} />{more && <span className="mo">…more</span>}</div>
    {first && <Md url={first} video={vid} ratio="1.91/1" radius={0} />}
    <div className="ac li"><span><ThumbsUp size={17} />Like</span><span><MessageSquare size={17} />Comment</span><span><Repeat size={17} />Repost</span><span><Send size={17} />Send</span></div></div>; }

  if (p === "tiktok") { const [t, more] = clip(cap, 80); return <div className="pp2 vert"><Md url={first} video={vid} ratio="9/16" radius={0} overlay>
    <div className="rail"><Av account={account} size={34} /><span><Heart size={26} fill="currentColor" />0</span><span><MessageCircle size={26} fill="currentColor" />0</span><span><Bookmark size={24} fill="currentColor" />0</span><span><Forward size={26} fill="currentColor" />0</span></div>
    <div className="ov"><b>{handle(account)}</b><div><Txt text={t} />{more && <span style={{ opacity: .75 }}>… more</span>}</div></div></Md></div>; }

  if (p === "youtube") { const long = !vertical && format !== "Short"; const ttl = title || cap.split("\n")[0]; return <div className="pp2">
    {!long ? <Md url={first} video={vid} ratio="9/16" radius={0} overlay>
      <div className="rail"><span><ThumbsUp size={24} fill="currentColor" />Like</span><span><ThumbsDown size={24} fill="currentColor" />Dislike</span><span><MessageSquare size={24} fill="currentColor" />0</span><span><Forward size={24} fill="currentColor" />Share</span><span><Repeat size={22} />Remix</span></div>
      <div className="ov"><div className="row" style={{ gap: 6, marginBottom: 4 }}><Av account={account} size={24} /><b>{handle(account)}</b><span className="yt-sub">Subscribe</span></div><div>{clip(ttl, 60)[0]}</div></div></Md>
    : <div style={{ padding: 12 }}><Md url={first} video={vid} ratio="16/9" radius={12} />
      <div className="row" style={{ gap: 10, alignItems: "flex-start", marginTop: 10 }}><Av account={account} size={36} /><div className="grow"><b className="yt-t">{ttl}</b><div className="sub">{name(account)} · 0 views · Just now</div></div><MoreHorizontal size={16} /></div>
      <div className="ytp"><span><ThumbsUp size={15} />0<i /><ThumbsDown size={15} /></span><span><Forward size={15} />Share</span><span><ListPlus size={15} />Save</span></div></div>}
  </div>; }

  if (p === "pinterest") { const ttl = settings.title || title || cap.split("\n")[0]; return <div className="pp2" style={{ padding: 8 }}>
    <Md url={first} video={vid} ratio="2/3" radius={16}><span className="pin-save">Save</span></Md>
    <div style={{ padding: "8px 4px 4px" }}><b className="yt-t">{clip(ttl, 100)[0]}</b><div className="row" style={{ gap: 6, marginTop: 6 }}><Av account={account} size={22} /><span className="sub grow">{name(account)}</span><Heart size={15} /><Share size={15} /><MoreHorizontal size={15} /></div></div></div>; }

  if (p === "threads") { const [t, more] = clip(cap, 500); return <div className="pp2"><div className="h" style={{ alignItems: "flex-start" }}><Av account={account} size={36} />
    <div className="grow" style={{ minWidth: 0 }}><div><b>{String(name(account)).toLowerCase().replace(/\s+/g, ".")}</b> <span className="sub">now</span></div>
      <div className={capCls} style={{ padding: "2px 0 0", whiteSpace: "pre-wrap" }}><Txt text={t} />{more && "…"}</div>
      {first && <div style={{ marginTop: 10, maxWidth: 260 }}><Md url={first} video={vid} ratio="4/5" radius={10} /></div>}
      <div className="ac th"><Heart size={18} /><MessageCircle size={18} /><Repeat size={18} /><Send size={18} /></div></div></div></div>; }

  return <div className="pp2"><div className="h"><Av account={account} /><b>{name(account)}</b></div><div className={capCls}><Txt text={cap} /></div>{first && <Md url={first} video={vid} ratio="4/5" />}</div>;
}
