import { useEffect, useRef, useState } from "react";
import {
  Bookmark, CheckCircle2, ChevronLeft, ChevronRight, Heart, Link2, MessageCircle,
  MoreHorizontal, Play, Send, Share2, ThumbsUp,
} from "lucide-react";
import { AccountAvatar } from "./ManageAccounts.jsx";
import InstagramGridPlanner from "./InstagramGridPlanner.jsx";
import facebookPng from "./assets/facebook.png";
import instagramPng from "./assets/instagram.png";
import linkedinPng from "./assets/linkedin.png";
import pinterestPng from "./assets/pinterest.png";
import tiktokPng from "./assets/tiktok.png";
import xPng from "./assets/x.png";
import youtubePng from "./assets/youtube.png";

const platformStyles = {
  facebook: { label: "Facebook", color: "#1877F2", logo: facebookPng },
  instagram: { label: "Instagram", color: "#D94687", logo: instagramPng },
  youtube: { label: "YouTube", color: "#FF0033", logo: youtubePng },
  x: { label: "X", color: "#111827", logo: xPng },
  linkedin: { label: "LinkedIn", color: "#0A66C2", logo: linkedinPng },
  tiktok: { label: "TikTok", color: "#111827", logo: tiktokPng },
  pinterest: { label: "Pinterest", color: "#BD081C", logo: pinterestPng },
};
const PLATFORM_MEDIA_LAYOUTS = {
  facebook: ["Grid", "Carousel / Swipe", "Stacked"],
  instagram: ["Carousel / Swipe", "Grid"],
  linkedin: ["Grid", "Side-by-side"],
  x: ["Grid", "Side-by-side"],
};

function useMediaUrls(files) {
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    const next = files.map((file) => file ? URL.createObjectURL(file) : "");
    setUrls(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);
  return urls;
}

function PreviewChannelBrandImage({ channelId, size = 24 }) {
  const logo = platformStyles[channelId]?.logo || facebookPng;
  const pad = size <= 16 ? 1 : size <= 20 ? 1.5 : 3;
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full aspect-square bg-white"
      style={{ width: size, height: size, padding: pad, backgroundColor: "#fff" }}
    >
      <img src={logo} alt="" aria-hidden="true" className="block h-full w-full object-contain" />
    </div>
  );
}

function Avatar({ account, name, size = "h-10 w-10" }) {
  const resolved =
    account && typeof account === "object"
      ? account
      : { account_name: name || "S", platform: "" };
  const sizeParts = String(size || "").split(/\s+/).filter(Boolean);
  const heightToken = sizeParts.find((part) => /^h-\d+$/.test(part));
  const px = heightToken ? Number(heightToken.slice(2)) * 4 : 40;
  const extraClass = sizeParts.filter((part) => !/^h-\d+$/.test(part) && !/^w-\d+$/.test(part)).join(" ");
  return (
    <span className={`inline-flex shrink-0 ${extraClass}`.trim()}>
      <AccountAvatar
        account={resolved}
        ChannelBrandImage={PreviewChannelBrandImage}
        size={px}
        badgeScale={0.45}
        showBadge
      />
    </span>
  );
}

function Media({ url, isVideo, className = "", playOverlay = false }) {
  if (!url) return <div className={`grid place-items-center bg-gradient-to-br from-indigo-50 via-purple-50 to-blue-50 text-indigo-400 dark:from-indigo-950/50 dark:via-purple-950/40 dark:to-blue-950/50 ${className}`}><span className="text-xs font-semibold">Media preview</span></div>;
  return <div className={`relative overflow-hidden bg-black ${className}`}>
    {isVideo ? <video src={url} controls muted playsInline className="h-full w-full object-cover" /> : <img src={url} alt="Post attachment preview" className="h-full w-full object-cover" />}
    {!isVideo && playOverlay && <span className="absolute inset-0 grid place-items-center bg-black/10"><span className="grid h-14 w-14 place-items-center rounded-full bg-black/60 text-white backdrop-blur"><Play size={23} fill="currentColor" /></span></span>}
  </div>;
}

function MediaGallery({ items = [], className = "", singleClassName = "", rounded = "", layout = "Grid" }) {
  const safeItems = Array.isArray(items) ? items.filter((item) => item && typeof item.url === "string" && item.url) : [];
  if (!safeItems.length) return <Media url="" className={singleClassName || className} />;
  if (safeItems.length === 1) return <Media url={safeItems[0].url} isVideo={safeItems[0].isVideo} className={`${singleClassName || className} ${rounded}`} />;
  const mediaTile = (item, index, extraClass = "") => <div key={item.key || `${item.url}-${index}`} className={`relative min-h-0 min-w-0 overflow-hidden bg-slate-100 ${extraClass}`}>
    <Media url={item.url} isVideo={item.isVideo} className="h-full min-h-0 w-full" />
    {index === 3 && safeItems.length > 4 && <span className="absolute inset-0 grid place-items-center bg-black/45 text-lg font-extrabold text-white">+{safeItems.length - 4}</span>}
  </div>;
  if (layout === "Carousel / Swipe") return <PhotoCarousel items={safeItems} className={`${className} ${rounded}`} />;
  if (layout === "Side-by-side") return <div className={`flex ${className} ${rounded} overflow-x-auto overscroll-x-contain bg-slate-100`} aria-label={`${safeItems.length} attached media items side by side`}>
    {safeItems.map((item, index) => mediaTile(item, index, "h-full w-1/2 min-w-1/2 border-r border-white/80 last:border-0"))}
  </div>;
  if (layout === "Stacked") {
    return <div className={`grid grid-cols-1 gap-0.5 overflow-hidden bg-slate-100 ${className} ${rounded}`} style={{ gridTemplateRows: `repeat(${safeItems.length}, minmax(0, 1fr))` }} aria-label={`${safeItems.length} attached media items stacked`}>
      {safeItems.map((item, index) => mediaTile(item, index))}
    </div>;
  }
  const gridRows = safeItems.length === 2 ? "grid-rows-1" : "grid-rows-2";
  return <div className={`grid ${gridRows} max-h-[440px] min-h-0 grid-cols-2 gap-0.5 overflow-hidden bg-slate-100 ${className} ${rounded}`} aria-label={`${safeItems.length} attached media items in a grid`}>
    {safeItems.slice(0, 4).map((item, index) => mediaTile(item, index, safeItems.length === 3 && index === 0 ? "row-span-2" : ""))}
  </div>;
}

function PhotoCarousel({ items = [], className = "", dotsClassName = "bottom-3", controlPlacement = "sides" }) {
  const photos = Array.isArray(items) ? items.filter((item) => item && typeof item.url === "string" && item.url) : [];
  const [index, setIndex] = useState(0);
  const touchStartX = useRef(null);
  useEffect(() => setIndex((current) => Math.min(current, Math.max(photos.length - 1, 0))), [photos.length]);
  const move = (delta) => setIndex((current) => (current + delta + photos.length) % photos.length);
  if (!photos.length) return <div className={`grid place-items-center bg-gradient-to-br from-indigo-100 via-purple-100 to-slate-200 text-xs font-semibold text-indigo-700 dark:from-indigo-950 dark:via-purple-950 dark:to-slate-900 dark:text-indigo-200 ${className}`}>Add photos to preview this post</div>;
  const active = photos[index];
  return <div className={`relative touch-pan-y overflow-hidden bg-slate-950 ${className}`} onTouchStart={(event) => { touchStartX.current = event.touches?.[0]?.clientX ?? null; }} onTouchEnd={(event) => { const endX = event.changedTouches?.[0]?.clientX; if (touchStartX.current != null && typeof endX === "number" && Math.abs(endX - touchStartX.current) > 36) move(endX < touchStartX.current ? 1 : -1); touchStartX.current = null; }} aria-label={`Photo ${index + 1} of ${photos.length}`}>
    {active.isVideo ? <video key={active.key || active.url} src={active.url} muted playsInline controls className="h-full w-full object-cover" /> : <img key={active.key || active.url} src={active.url} alt={`Post media ${index + 1}`} draggable="false" className="h-full w-full select-none object-cover" />}
    {photos.length > 1 && <><button type="button" onClick={() => move(-1)} aria-label="Previous photo" className="absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/40 text-white shadow-sm backdrop-blur-sm transition hover:bg-black/65 focus:outline-none focus:ring-2 focus:ring-white/70"><ChevronLeft size={16} /></button><button type="button" onClick={() => move(1)} aria-label="Next photo" className={`absolute ${controlPlacement === "tiktok" ? "right-12" : "right-2"} top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/40 text-white shadow-sm backdrop-blur-sm transition hover:bg-black/65 focus:outline-none focus:ring-2 focus:ring-white/70`}><ChevronRight size={16} /></button><div className={`absolute inset-x-0 flex items-center justify-center gap-1.5 ${dotsClassName}`} aria-label="Photo pagination">{photos.map((photo, photoIndex) => <button key={photo.key || photo.url} type="button" aria-label={`Show photo ${photoIndex + 1}`} aria-current={photoIndex === index ? "true" : undefined} onClick={() => setIndex(photoIndex)} className={`h-1.5 rounded-full shadow transition-all ${photoIndex === index ? "w-3 bg-white" : "w-1.5 bg-white/60"}`} />)}</div></>}
  </div>;
}

function FacebookPreview({ account, caption, mediaItems, mediaLayout }) {
  const name = account?.account_name || "Your Page";
  return <article className="w-full max-w-[320px] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-lg">
    <header className="flex items-center gap-3 p-4"><Avatar account={account} name={name} size="h-10 w-10" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{name}</p><p className="text-xs text-slate-500">Just now · <span aria-label="Public">🌐</span></p></div><MoreHorizontal size={20} className="text-slate-500" /></header>
    {caption && <p className="whitespace-pre-wrap px-4 pb-3 text-sm leading-6">{caption}</p>}
    <MediaGallery items={mediaItems} layout={mediaLayout} className="aspect-[4/3] w-full" singleClassName="aspect-[4/3] w-full" />
    <div className="flex items-center gap-6 border-t border-slate-100 px-4 py-3 text-xs font-semibold text-slate-500"><span className="flex items-center gap-2"><ThumbsUp size={16} />Like</span><span className="flex items-center gap-2"><MessageCircle size={16} />Comment</span><span className="flex items-center gap-2"><Share2 size={16} />Share</span></div>
  </article>;
}

function YouTubePreview({ account, caption, title, mediaItems, format }) {
  const name = account?.account_name || "Your channel";
  const videoItem = mediaItems.find((item) => item.isVideo) || mediaItems[0];
  return <article className="w-full max-w-[320px] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-lg">
    <Media url={videoItem?.url || ""} isVideo={videoItem?.isVideo} playOverlay className="aspect-video w-full" />
    <div className="p-4"><h3 className="line-clamp-2 text-base font-extrabold">{title || (format === "Short" ? "Your Short title" : "Your video title")}</h3><p className="mt-1 text-xs text-slate-500">1.2K views · Just now</p>
      <div className="mt-4 flex items-center gap-3"><Avatar account={account} name={name} size="h-10 w-10" /><div className="min-w-0 flex-1"><p className="flex items-center gap-1 text-xs font-bold">{name}<CheckCircle2 size={13} className="text-slate-500" /></p><p className="text-[10px] text-slate-500">12.4K subscribers</p></div><button type="button" className="rounded-full bg-slate-950 px-4 py-2 text-[10px] font-extrabold text-white">Subscribe</button></div>
      <p className="mt-4 line-clamp-3 whitespace-pre-wrap rounded-xl bg-slate-100 p-3 text-xs leading-5 text-slate-700">{caption || "Your description will appear here."}</p>
    </div>
  </article>;
}

function YouTubeCommunityPreview({ account, caption, mediaItems }) {
  const name = account?.account_name || "Your channel";
  const photos = mediaItems.filter((item) => !item.isVideo);
  return <article className="w-full max-w-[320px] rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-lg">
    <header className="flex items-start gap-3"><Avatar account={account} name={name} size="h-10 w-10" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold">{name}</p><p className="text-[10px] text-slate-500">@{name.toLowerCase().replace(/[^a-z0-9]+/g, "")} · Just now</p></div><MoreHorizontal size={18} className="text-slate-500" /></header>
    <p className="my-3 whitespace-pre-wrap text-sm leading-6">{caption || "Your community post will appear here."}</p>
    {photos.length > 1 ? <MediaGallery items={photos} layout="Grid" className="aspect-square w-full rounded-xl" singleClassName="aspect-square w-full rounded-xl" /> : photos.length === 1 ? <img src={photos[0].url} alt="Community post attachment" className="aspect-square w-full rounded-xl object-cover" /> : <MediaGallery items={[]} className="aspect-square w-full rounded-xl" singleClassName="aspect-square w-full rounded-xl" />}
    <div className="mt-3 flex items-center gap-5 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500"><span className="inline-flex items-center gap-1.5"><ThumbsUp size={15} />Like</span><span className="inline-flex items-center gap-1.5"><MessageCircle size={15} />Comment</span><span className="inline-flex items-center gap-1.5"><Share2 size={15} />Share</span></div>
  </article>;
}

function XPreview({ account, caption, mediaItems, mediaLayout }) {
  const name = account?.account_name || "Your brand";
  const handle = `@${name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 15) || "yourbrand"}`;
  return <article className="w-full max-w-[320px] rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-lg">
    <div className="flex gap-3"><Avatar account={account} name={name} size="h-11 w-11" /><div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-sm"><span className="truncate font-extrabold">{name}</span><CheckCircle2 size={13} className="shrink-0 text-sky-500" /><span className="truncate text-slate-500">{handle} · 1m</span><MoreHorizontal size={17} className="ml-auto shrink-0 text-slate-500" /></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{caption || "Your post text will appear here."}</p>
      {mediaItems.length > 0 && <MediaGallery items={mediaItems} layout={mediaLayout} className="mt-3 aspect-[16/10] w-full" singleClassName="mt-3 aspect-[16/10] w-full" rounded="rounded-2xl" />}
      <div className="mt-4 flex max-w-sm items-center justify-between text-slate-500"><MessageCircle size={16} /><span className="text-[10px]">24</span><Share2 size={16} /><span className="text-[10px]">18</span><Heart size={16} /><span className="text-[10px]">186</span><Bookmark size={16} /></div>
    </div></div>
  </article>;
}

function InstagramPreview({ account, caption, mediaItems, mediaLayout }) {
  const name = account?.account_name || "yourbrand";
  return <article className="w-full max-w-[320px] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-lg">
    <header className="flex items-center gap-3 p-3"><Avatar account={account} name={name} size="h-9 w-9" /><span className="min-w-0 flex-1 truncate text-xs font-extrabold">{name.toLowerCase().replaceAll(" ", ".")}</span><MoreHorizontal size={18} /></header>
    <MediaGallery items={mediaItems} layout={mediaLayout} className="aspect-square w-full" singleClassName="aspect-square w-full" />
    <div className="p-3"><div className="flex items-center gap-4"><Heart size={22} /><MessageCircle size={22} /><Send size={21} /><Bookmark size={21} className="ml-auto" /></div><p className="mt-3 text-xs font-extrabold">1,284 likes</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5"><b>{name.toLowerCase().replaceAll(" ", ".")}</b>{" "}{caption || "Your caption will appear here."}</p><p className="mt-2 text-[10px] uppercase text-slate-400">View all 28 comments</p></div>
  </article>;
}

function LinkedInPreview({ account, caption, mediaItems, mediaLayout }) {
  const name = account?.account_name || "Your company";
  return <article className="w-full max-w-[320px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-lg">
    <header className="flex items-start gap-3"><Avatar account={account} name={name} size="h-12 w-12 rounded-lg" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{name}</p><p className="text-[11px] text-slate-500">Company page · 1m · 🌐</p><p className="text-[10px] text-slate-500">12,450 followers</p></div><MoreHorizontal size={18} /></header>
    <p className="my-3 whitespace-pre-wrap text-sm leading-6">{caption || "Your professional update will appear here."}</p>
    {mediaItems.length > 0 && <MediaGallery items={mediaItems} layout={mediaLayout} className="aspect-video w-full" singleClassName="aspect-video w-full" rounded="rounded-lg" />}
    <div className="mt-3 flex items-center justify-around border-t border-slate-200 pt-3 text-xs font-semibold text-slate-600"><span className="flex items-center gap-2"><ThumbsUp size={17} />Like</span><span className="flex items-center gap-2"><MessageCircle size={17} />Comment</span><span className="flex items-center gap-2"><Share2 size={17} />Repost</span><span className="flex items-center gap-2"><Send size={17} />Send</span></div>
  </article>;
}

function TikTokPreview({ account, caption, title, mediaItems }) {
  const name = account?.account_name || "yourbrand";
  const videoItem = mediaItems.find((item) => item.isVideo) || mediaItems[0];
  return <article className="relative aspect-[9/16] w-full max-w-[270px] overflow-hidden rounded-[30px] border-[5px] border-slate-950 bg-slate-950 text-white shadow-xl">
    <Media url={videoItem?.url || ""} isVideo={videoItem?.isVideo} playOverlay className="absolute inset-0 h-full w-full opacity-90" />
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent p-4 pt-20"><p className="text-sm font-extrabold">@{name.toLowerCase().replace(/[^a-z0-9]+/g, "")}</p><p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5">{caption || title || "Your TikTok caption appears here."}</p><p className="mt-2 text-[10px]">♫ Original sound · {name}</p></div>
    <div className="absolute bottom-24 right-3 flex flex-col items-center gap-4"><Avatar account={account} name={name} size="h-10 w-10 border-2 border-white" /><div className="grid justify-items-center gap-1"><Heart size={23} fill="white" /><span className="text-[10px]">8.2K</span></div><div className="grid justify-items-center gap-1"><MessageCircle size={22} /><span className="text-[10px]">184</span></div><Share2 size={22} /></div>
    <span className="absolute left-4 top-4 rounded-full bg-black/35 px-3 py-1 text-[10px] font-bold backdrop-blur">For you</span>
  </article>;
}

function TikTokPhotoPreview({ account, caption, mediaItems }) {
  const name = account?.account_name || "yourbrand";
  const photos = mediaItems.filter((item) => !item.isVideo);
  return <article className="relative aspect-[9/16] w-full max-w-[270px] overflow-hidden rounded-[30px] border-[5px] border-slate-950 bg-slate-950 text-white shadow-xl">
    <PhotoCarousel items={photos} className="absolute inset-0 h-full w-full" dotsClassName="bottom-28" controlPlacement="tiktok" />
    <header className="absolute inset-x-0 top-0 flex items-center justify-center gap-5 bg-gradient-to-b from-black/65 to-transparent pb-8 pt-5 text-[11px] font-bold"><span className="text-white/70">Following</span><span className="border-b-2 border-white pb-1">For You</span></header>
    <div className="absolute bottom-28 right-2.5 flex flex-col items-center gap-3.5"><div className="relative mb-1"><Avatar account={account} name={name} size="h-10 w-10 border-2 border-white" /><span className="absolute -bottom-1 left-1/2 grid h-4 w-4 -translate-x-1/2 place-items-center rounded-full bg-rose-500 text-[11px] font-extrabold">+</span></div><div className="grid justify-items-center gap-0.5"><Heart size={22} fill="white" /><span className="text-[9px]">8.2K</span></div><div className="grid justify-items-center gap-0.5"><MessageCircle size={21} /><span className="text-[9px]">184</span></div><Bookmark size={19} fill="white" /><Share2 size={20} /></div>
    <footer className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-4 pt-14"><span className="inline-flex rounded-full bg-white/20 px-2 py-1 text-[9px] font-extrabold backdrop-blur">▧ Photo</span><p className="mt-2 text-xs font-extrabold">@{name.toLowerCase().replace(/[^a-z0-9]+/g, "")}</p><p className="mt-1 line-clamp-3 whitespace-pre-wrap pr-12 text-[10px] leading-4">{caption || "Your photo post caption appears here."}</p><p className="mt-2 text-[9px]">♫ Original sound · {name}</p></footer>
  </article>;
}

function VerticalVideoPreview({ account, caption, title, mediaItems, platformId, format, mediaLayout }) {
  const name = account?.account_name || "yourbrand";
  const isInstagram = platformId === "instagram";
  const primary = mediaItems[0];
  return <article className="relative aspect-[9/16] w-full max-w-[270px] overflow-hidden rounded-[32px] border-[5px] border-slate-950 bg-slate-950 text-white shadow-xl ring-1 ring-white/70 dark:border-slate-700 dark:ring-slate-600">
    {mediaLayout ? <MediaGallery items={mediaItems} layout={mediaLayout} className="absolute inset-0 h-full w-full" singleClassName="absolute inset-0 h-full w-full" /> : <Media url={primary?.url || ""} isVideo={primary?.isVideo} playOverlay className="absolute inset-0 h-full w-full" />}
    <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/65 to-transparent px-4 pb-8 pt-4"><span className="text-xs font-extrabold">{format === "Story" ? "Story" : isInstagram ? "Reels" : platformId === "youtube" ? "Shorts" : platformId === "tiktok" ? "For You" : "Video"}</span><MoreHorizontal size={18} /></div>
    {format === "Story" && <div className="absolute inset-x-4 top-10 flex gap-1">{[0, 1, 2].map((item) => <span key={item} className="h-0.5 flex-1 rounded-full bg-white/60" />)}</div>}
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent px-4 pb-5 pt-24"><p className="text-xs font-extrabold">{name}</p><p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5">{caption || title || "Your video caption appears here."}</p><p className="mt-2 text-[10px]">♫ Original audio · {name}</p></div>
    <div className="absolute bottom-24 right-3 flex flex-col items-center gap-4"><Avatar account={account} name={name} size="h-10 w-10 border-2 border-white" /><div className="grid justify-items-center gap-1"><Heart size={22} fill="white" /><span className="text-[9px]">8.2K</span></div><div className="grid justify-items-center gap-1"><MessageCircle size={21} /><span className="text-[9px]">184</span></div><Share2 size={20} /><Bookmark size={19} /></div>
    {mediaItems.length > 1 && <span className="absolute right-3 top-14 rounded-full bg-black/55 px-2 py-1 text-[9px] font-bold">1 / {mediaItems.length}</span>}
  </article>;
}

function PinterestPreview({ account, caption, title, mediaItems, destinationUrl, board = "Brand inspiration" }) {
  const name = account?.account_name || "Your profile";
  const pinMedia = mediaItems.slice(0, 1);
  let destinationLabel = "Add a destination link";
  try { if (destinationUrl) destinationLabel = new URL(destinationUrl).hostname.replace(/^www\./, ""); } catch { destinationLabel = destinationUrl; }
  return <article className="w-full max-w-[300px] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-lg">
    <div className="relative"><MediaGallery items={pinMedia} className="aspect-[4/5] w-full" singleClassName="aspect-[4/5] w-full" /><button type="button" className="absolute right-3 top-3 rounded-full bg-rose-600 px-4 py-2.5 text-xs font-extrabold text-white shadow">Save</button></div>
    <div className="p-4"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate rounded-full border border-slate-200 bg-white px-3 py-2 text-[10px] font-bold">{board}</span><button type="button" className="rounded-full bg-rose-600 px-4 py-2 text-xs font-extrabold text-white">Save</button><MoreHorizontal size={18} /></div><h3 className="mt-3 text-sm font-extrabold">{title || "Your Pin title"}</h3><p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-slate-600">{caption || "Add a description for this Pin."}</p><a href={destinationUrl || undefined} target={destinationUrl ? "_blank" : undefined} rel="noreferrer" className="mt-3 flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 p-2.5 text-[10px] font-semibold text-slate-600"><Link2 size={13} className="shrink-0 text-rose-600" /><span className="truncate">{destinationLabel}</span><span className="ml-auto shrink-0 text-rose-700">Visit</span></a><p className="mt-3 text-[10px] font-bold text-slate-500">Saved by {name}</p></div>
  </article>;
}

export default function LivePreview({ accounts = [], channelInfo, caption, uploadedMedia = [], mediaUrls = [], posts = [], title = "", format, formatsByAccount = {}, platformSettingsByAccount = {}, destinationUrl = "", destinationBoard = "Brand inspiration", previewId, setPreviewId, device, setDevice }) {
  const [previewMode, setPreviewMode] = useState("post");
  const safeAccounts = Array.isArray(accounts) ? accounts.filter((item) => item && typeof item === "object") : [];
  const safeUploadedMedia = Array.isArray(uploadedMedia) ? uploadedMedia : [];
  const safeMediaUrls = Array.isArray(mediaUrls) ? mediaUrls.filter((url) => typeof url === "string") : [];
  const safePosts = Array.isArray(posts) ? posts.filter(Boolean) : [];
  const safeCaption = typeof caption === "string" ? caption : "";
  const safeTitle = typeof title === "string" ? title : "";
  const safeFormat = typeof format === "string" ? format : "Post";
  const account = channelInfo?.account && typeof channelInfo.account === "object" ? channelInfo.account : null;
  const channel = channelInfo?.platform && typeof channelInfo.platform === "object" ? channelInfo.platform : null;
  const objectUrls = useMediaUrls(safeUploadedMedia);
  const mediaItems = [
    ...safeUploadedMedia.map((file, index) => ({ key: `file-${index}-${file?.name || "media"}`, url: objectUrls[index] || "", isVideo: Boolean(file?.type?.startsWith("video/")) })),
    ...safeMediaUrls.map((url, index) => ({ key: `url-${index}-${url}`, url, isVideo: /\.(mp4|mov|webm|m4v|ogv)(\?|$)/i.test(url) })),
  ].filter((item) => item.url);
  const firstMediaUrl = mediaItems[0]?.url || "";
  const firstIsVideo = Boolean(mediaItems[0]?.isVideo);
  const platformId = (typeof channel?.id === "string" && channel.id) || (typeof account?.platform === "string" && account.platform) || "facebook";
  const platform = platformStyles[platformId] || platformStyles.facebook;
  const configuredLayout = platformSettingsByAccount?.[account?.id]?.media_layout;
  const allowedLayouts = PLATFORM_MEDIA_LAYOUTS[platformId] || [];
  const mediaLayout = allowedLayouts.includes(configuredLayout) ? configuredLayout : (allowedLayouts[0] || null);
  const hasVideoMedia = mediaItems.some((item) => item.isVideo);
  const verticalVideoExperience = (platformId === "instagram" && ["Reel / Video", "Story"].includes(safeFormat)) || (platformId === "youtube" && safeFormat === "Short") || (platformId === "tiktok" && (["Reel / Video", "Story"].includes(safeFormat) || hasVideoMedia)) || (platformId === "facebook" && safeFormat === "Story");
  let renderer;
  if (verticalVideoExperience && platformId !== "tiktok") {
    renderer = <VerticalVideoPreview account={account} caption={safeCaption} title={safeTitle} mediaItems={mediaItems} mediaLayout={mediaLayout} platformId={platformId} format={safeFormat} />;
  } else switch (platformId) {
    case "youtube": renderer = hasVideoMedia ? <YouTubePreview account={account} caption={safeCaption} title={safeTitle} mediaItems={mediaItems} format={safeFormat} /> : <YouTubeCommunityPreview account={account} caption={safeCaption} mediaItems={mediaItems} />; break;
    case "x": renderer = <XPreview account={account} caption={safeCaption} mediaItems={mediaItems} mediaLayout={mediaLayout} />; break;
    case "instagram": renderer = <InstagramPreview account={account} caption={safeCaption} mediaItems={mediaItems} mediaLayout={mediaLayout} />; break;
    case "linkedin": renderer = <LinkedInPreview account={account} caption={safeCaption} mediaItems={mediaItems} mediaLayout={mediaLayout} />; break;
    case "tiktok": renderer = hasVideoMedia || verticalVideoExperience ? <TikTokPreview account={account} caption={safeCaption} title={safeTitle} mediaItems={mediaItems} /> : <TikTokPhotoPreview account={account} caption={safeCaption} mediaItems={mediaItems} />; break;
    case "pinterest": renderer = <PinterestPreview account={account} caption={safeCaption} title={safeTitle} mediaItems={mediaItems} destinationUrl={destinationUrl} board={destinationBoard} />; break;
    default: renderer = <FacebookPreview account={account} caption={safeCaption} mediaItems={mediaItems} mediaLayout={mediaLayout} />;
  }
  return <section className="card h-auto min-w-0 p-4 sm:p-5">
    <header className="flex items-start justify-between gap-3"><div><span className="xs muted sc-eyebrow">LIVE PREVIEW</span><h2 className="mt-1  text-lg font-extrabold tracking-tight">See it in the wild</h2></div><div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800"><button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")} className={`sc-seg-btn ${device === "mobile" ? "active" : ""}`} title="Mobile preview">▯</button><button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")} className={`sc-seg-btn ${device === "desktop" ? "active" : ""}`} title="Desktop preview">▱</button></div></header>
    <nav className="seg" aria-label="Preview social accounts">
      {safeAccounts.length ? (
        safeAccounts.map((item) => {
          const data = platformStyles[item.platform];
          if (!data) return null;

          const active = item.id === (account?.id || previewId);
          const itemFormat = formatsByAccount[item.id] || (active ? safeFormat : "Post");
          const formatLabel =
            item.platform === "instagram"
              ? itemFormat === "Reel / Video"
                ? "Reel"
                : itemFormat === "Story"
                  ? "Story"
                  : "Feed"
              : item.platform === "x"
                ? "Post"
                : item.platform === "youtube"
                  ? itemFormat === "Short"
                    ? "Short"
                    : itemFormat === "Reel / Video"
                      ? "Video"
                      : "Community"
                  : item.platform === "tiktok"
                    ? itemFormat === "Reel / Video" || itemFormat === "Short"
                      ? "Video"
                      : itemFormat === "Story"
                        ? "Story"
                        : "Photo"
                    : item.platform === "facebook" && itemFormat === "Story"
                      ? "Story"
                      : item.platform === "pinterest"
                        ? "Pin"
                        : "Post";

          return (
            <button
              type="button"
              key={item.id}
              onClick={() => setPreviewId?.(item.id)}
              aria-selected={active}
              className={`sc-seg-btn ${active ? "active" : ""}`}
            >
              <span className="inline-flex items-center gap-2">
                <AccountAvatar
                  account={item}
                  ChannelBrandImage={PreviewChannelBrandImage}
                  size={28}
                  badgeScale={0.45}
                  showBadge={true}
                />
                <span>{data.label} {formatLabel}</span>
              </span>
            </button>
          );
        })
      ) : (
        <span className="text-xs text-slate-400">Connect a channel to see its preview</span>
      )}
    </nav>
    {platformId === "instagram" && <div className="mb-3 flex items-center justify-between"><span className="text-[10px] font-semibold text-slate-500">Instagram view</span><div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800"><button type="button" onClick={() => setPreviewMode("post")} aria-pressed={previewMode === "post"} className={`rounded-md px-2.5 py-1.5 text-[10px] font-bold ${previewMode === "post" ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500"}`}>Post</button><button type="button" onClick={() => setPreviewMode("grid")} aria-pressed={previewMode === "grid"} className={`rounded-md px-2.5 py-1.5 text-[10px] font-bold ${previewMode === "grid" ? "bg-white text-indigo-700 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500"}`}>Profile grid</button></div></div>}
    <div className={`preview-stage ${device === "desktop" ? "preview-stage-desktop" : ""}`}><div className={`flex w-full justify-center ${device === "mobile" ? "px-1" : "px-2"}`}>{platformId === "instagram" && previewMode === "grid" ? <InstagramGridPlanner account={account} posts={safePosts} currentMediaUrl={firstMediaUrl} caption={safeCaption} isVideo={firstIsVideo} /> : renderer}</div></div>
    <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-400"><span className="h-1.5 w-1.5 animate-soft-pulse rounded-full bg-emerald-500" /><span>{platform.label} preview updates as you create</span><span className="ml-auto font-extrabold tracking-wider">{safeFormat.toUpperCase()}</span></div>
  </section>;
}
