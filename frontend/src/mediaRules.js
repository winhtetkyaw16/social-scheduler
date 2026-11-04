import { igChipLabel, igFrameRatio, igNeedsCrop } from "./igFrame.js";
// Pure media rules engine + auto-split for the composer ("Media needs a few changes" panel, Fix for me).
// Sources: design/screens/media-rules-spec.html and research/api-media-rules.md (official API docs).
// No React, no DOM: safe to unit test with `node --test frontend/src/mediaRules.test.mjs`.

export const NETWORK = { x: "X", twitter: "X", facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", pinterest: "Pinterest", threads: "Threads" };
const MB = 1024 * 1024;
export const LIMITS = {
  instagram: { carousel: 20, minRatio: 0.8, maxRatio: 1.91, reelMin: 3, reelMax: 900, storyMax: 60 },
  threads: { carousel: 20 },
  linkedin: { photos: 20 },
  x: { photos: 4, minVideoRatio: 1 / 3, maxVideoRatio: 3 },
  tiktok: { photos: 35 },
  facebook: { photoBytes: 4 * MB },
};
const VIDEO_EXT = ["mp4", "mov", "webm", "m4v", "ogv", "avi", "mkv"];

function nameOf(item) {
  if (typeof item === "string") { try { return decodeURIComponent(item.split(/[?#]/)[0].split("/").pop() || ""); } catch { return item.split(/[?#]/)[0].split("/").pop() || ""; } }
  return item?.name || "";
}

/** Normalise a File / URL (+ optional measured dims) into {kind, ext, size, width, height, duration}. */
export function mediaInfo(item, dims = null) {
  const name = nameOf(item);
  let ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  const type = typeof item === "string" ? "" : String(item?.type || "").toLowerCase();
  if (!ext && type) ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" })[type] || "";
  if (ext === "jpeg") ext = "jpg";
  const kind = type.startsWith("video/") || VIDEO_EXT.includes(ext) ? "video" : (ext === "gif" || type === "image/gif") ? "gif" : "photo";
  return { kind, ext, size: typeof item === "string" ? 0 : Number(item?.size || 0), width: dims?.width || 0, height: dims?.height || 0, duration: Number.isFinite(dims?.duration) ? dims.duration : null };
}

const net = (p) => (p === "twitter" ? "x" : String(p || "").toLowerCase());
const idx = (infos, pred) => infos.map((m, i) => (pred(m) ? i : -1)).filter((i) => i >= 0);
const photosOf = (infos) => idx(infos, (m) => m.kind === "photo");
const videosOf = (infos) => idx(infos, (m) => m.kind === "video");
const gifsOf = (infos) => idx(infos, (m) => m.kind === "gif");
const stills = (infos) => idx(infos, (m) => m.kind !== "video"); // photos + GIFs (still accepted as images on FB/LI/IG)
const ratio = (m) => (m.width && m.height ? m.width / m.height : null);

/** Which indices of the shared media this network should use by default ("Fix for me"). Keeps the user's order. */
export function autoSplit(platform, infos, { format = "Post" } = {}) {
  const p = net(platform);
  const all = infos.map((_, i) => i);
  const vids = videosOf(infos), pics = photosOf(infos), gifs = gifsOf(infos), still = stills(infos);
  if (p === "instagram") {
    if (format === "Story") {
      const okVid = vids.find((i) => infos[i].duration == null || infos[i].duration <= LIMITS.instagram.storyMax);
      if (okVid != null) return [okVid];
      return still.length ? [still[0]] : vids.slice(0, 1);
    }
    if (format === "Reel / Video") return vids.length ? vids.slice(0, 1) : all.slice(0, LIMITS.instagram.carousel);
    return all.slice(0, LIMITS.instagram.carousel);
  }
  if (p === "threads") return all.slice(0, LIMITS.threads.carousel);
  if (p === "youtube") return vids.slice(0, 1);
  if (p === "tiktok") return vids.length ? vids.slice(0, 1) : pics.slice(0, LIMITS.tiktok.photos);
  if (p === "facebook") return still.length ? still : vids.slice(0, 1);
  if (p === "linkedin") return still.length ? still.slice(0, LIMITS.linkedin.photos) : vids.slice(0, 1);
  if (p === "x") {
    if (pics.length) return pics.slice(0, LIMITS.x.photos);
    if (vids.length) return vids.slice(0, 1);
    return gifs.slice(0, 1);
  }
  return all;
}

/** Media the account publishes when the user hasn't picked per-channel media. YouTube quietly takes just the video. */
export function defaultIndices(platform, infos, opts) {
  return net(platform) === "youtube" ? autoSplit(platform, infos, opts) : infos.map((_, i) => i);
}

/** Selection lookup: account -> network default -> null (use the post default). Values are lists of media keys. */
export function selectionFor(account, { byAccount = {}, byNetwork = {} } = {}) {
  const a = byAccount?.[account?.id];
  if (Array.isArray(a)) return a;
  const n = byNetwork?.[net(account?.platform)];
  return Array.isArray(n) ? n : null;
}

const P = (code, title, detail, action, extra = {}) => ({ code, title, detail, action, ...extra });

/**
 * Check one channel's media. Returns
 *  problems: things the user (or Fix for me) must change, each with one action {id,label}
 *  notes:    automatic conversions, shown muted (never a problem)
 *  hints:    soft tips (YouTube shape), never a block
 * `igRatio` is the Instagram frame the user picked (4:5 / 1:1 / 1.91:1); otherwise the first photo decides.
 */
export function checkMedia(platform, infos, { format = "Post", igRatio = null } = {}) {
  const p = net(platform);
  const problems = [], notes = [], hints = [];
  const n = infos.length;
  const vids = videosOf(infos), pics = photosOf(infos), gifs = gifsOf(infos), still = stills(infos);
  const mixed = vids.length > 0 && still.length > 0;
  const num = (i) => i + 1; // "Photo 3" counts the item's place in the post

  if (p === "instagram") {
    if (format === "Story") {
      if (!n) problems.push(P("no_media", "Add a photo or video", "A Story needs one photo or one video.", { id: "add_media", label: "Add media" }));
      else if (n > 1) problems.push(P("too_many", "Too many items", "A Story takes one photo or one video.", vids.length ? { id: "use_video", label: "Use the video" } : { id: "use_photo", label: "Use a photo" }));
      const v = n === 1 && vids.length ? infos[vids[0]] : null;
      if (v && v.duration != null && v.duration > LIMITS.instagram.storyMax) problems.push(P("story_long", "This video is too long for a Story", "Story videos can be up to 60 seconds.", still.length ? { id: "use_photo", label: "Use a photo" } : { id: "shorten", label: "Shorten video" }));
    } else {
      if (!n) problems.push(P("no_media", "Add a photo or video", "Instagram posts need at least one photo or video.", { id: "add_media", label: "Add media" }));
      if (n > LIMITS.instagram.carousel) problems.push(P("too_many", "Too many items", "Carousels take up to 20 photos and videos.", { id: "keep_first", label: "Keep first 20" }));
      if (format === "Reel / Video" && n && !vids.length) problems.push(P("no_video", "Add a video", "A Reel needs a video.", { id: "add_video", label: "Add a video" }));
      if (n === 1 && vids.length) {
        const d = infos[vids[0]].duration;
        if (d != null && d < LIMITS.instagram.reelMin) problems.push(P("video_short", "This video is too short", "Reels need at least 3 seconds.", { id: "replace", label: "Pick another" }));
        if (d != null && d > LIMITS.instagram.reelMax) problems.push(P("video_long", "This video is too long", "Reels can be up to 15 minutes.", { id: "shorten", label: "Shorten video" }));
      }
    }
    // Feed posts share ONE frame (first photo decides, like Instagram's Create post) and we crop every photo to it
    // automatically at publish, for the Instagram version only. Never a problem, just a calm note.
    if (format !== "Story") {
      const frame = igFrameRatio(infos.map((m) => ({ video: m?.kind === "video", ratio: ratio(m) || 0 })), igRatio);
      if (pics.some((i) => igNeedsCrop(ratio(infos[i]) || 0, frame))) notes.push(`Photos auto-fitted to ${igChipLabel(frame)} for Instagram`);
    }
    if (still.some((i) => infos[i].ext && infos[i].ext !== "jpg")) notes.push("We'll save photos as JPG for Instagram.");
  } else if (p === "facebook") {
    if (mixed) problems.push(P("mixed", "Use photos or the video, not both", "Facebook can't mix photos and a video in one post.", { id: "pick_photos", label: "Pick photos" }));
    else if (vids.length > 1) problems.push(P("too_many", "Too many videos", "Facebook posts take one video.", { id: "use_video", label: "Use the first video" }));
    if (still.some((i) => infos[i].ext === "webp")) notes.push("We'll convert this photo so it works here.");
    if (still.some((i) => infos[i].size > LIMITS.facebook.photoBytes)) notes.push("We'll make this photo smaller for Facebook.");
  } else if (p === "linkedin") {
    if (mixed) problems.push(P("mixed", "Use photos or the video, not both", "One video, or up to 20 photos.", { id: "pick_photos", label: "Pick photos" }));
    else if (vids.length > 1) problems.push(P("too_many", "Too many videos", "One video, or up to 20 photos.", { id: "use_video", label: "Use the first video" }));
    else if (still.length > LIMITS.linkedin.photos) problems.push(P("too_many", "Too many items", "LinkedIn takes up to 20 photos.", { id: "keep_first", label: "Keep first 20" }));
    if (vids.some((i) => infos[i].ext && infos[i].ext !== "mp4")) notes.push("We'll convert the video for LinkedIn.");
    if (still.some((i) => infos[i].ext === "webp")) notes.push("We'll convert this photo so it works here.");
  } else if (p === "x") {
    const tooMany = (vids.length && still.length) || vids.length > 1 || gifs.length > 1 || (gifs.length && pics.length) || pics.length > LIMITS.x.photos;
    if (tooMany) problems.push(P("too_many", "Too many items", "Up to 4 photos, 1 video, or 1 GIF.", pics.length ? { id: "keep_photos", label: `Keep ${Math.min(4, pics.length)} photo${Math.min(4, pics.length) === 1 ? "" : "s"}` } : vids.length ? { id: "use_video", label: "Use the video" } : { id: "use_gif", label: "Use the GIF" }));
    vids.forEach((i) => {
      const r = ratio(infos[i]);
      if (r != null && (r < LIMITS.x.minVideoRatio || r > LIMITS.x.maxVideoRatio)) problems.push(P("x_ratio", "This video's shape doesn't fit X", "X takes videos from tall 1:3 to wide 3:1.", pics.length ? { id: "keep_photos", label: "Use photos" } : { id: "replace", label: "Pick another" }));
    });
  } else if (p === "tiktok") {
    if (!n) problems.push(P("no_media", "Add a video or photos", "TikTok posts one video, or up to 35 photos.", { id: "add_video", label: "Add a video" }));
    else if (mixed || gifs.length) problems.push(P("mixed", "Use photos or the video, not both", "TikTok posts one video, or up to 35 photos.", vids.length ? { id: "use_video", label: "Use the video" } : { id: "use_photos", label: "Use photos" }));
    else if (vids.length > 1) problems.push(P("too_many", "Too many videos", "TikTok posts one video, or up to 35 photos.", { id: "use_video", label: "Use the video" }));
    else if (pics.length > LIMITS.tiktok.photos) problems.push(P("too_many", "Too many items", "TikTok takes up to 35 photos.", { id: "keep_first", label: "Keep first 35" }));
    if (pics.some((i) => infos[i].ext && !["jpg", "webp"].includes(infos[i].ext))) notes.push("We'll convert photos for TikTok.");
  } else if (p === "youtube") {
    if (!vids.length) problems.push(P("no_video", "Add a video", "YouTube posts need a video.", { id: "add_video", label: "Add a video" }));
    const v = vids.length ? infos[vids[0]] : null;
    const r = v ? ratio(v) : null;
    if (r != null && Math.abs(r - 16 / 9) > 0.05 && Math.abs(r - 9 / 16) > 0.05) hints.push("16:9 or 9:16 looks best on YouTube.");
  } else if (p === "threads") {
    if (n > LIMITS.threads.carousel) problems.push(P("too_many", "Too many items", "Threads carousels take up to 20 items.", { id: "keep_first", label: "Keep first 20" }));
  }
  return { problems, notes, hints };
}

/** Indices an inline "Review" action keeps (null = the action isn't a media pick). */
export function actionIndices(actionId, platform, infos, opts = {}) {
  const vids = videosOf(infos), pics = photosOf(infos), gifs = gifsOf(infos), still = stills(infos);
  const p = net(platform);
  switch (actionId) {
    case "pick_photos": return still.slice(0, p === "linkedin" ? LIMITS.linkedin.photos : still.length);
    case "keep_photos": return pics.slice(0, LIMITS.x.photos);
    case "use_photos": return pics.slice(0, LIMITS.tiktok.photos);
    case "use_photo": return still.slice(0, 1);
    case "use_video": return vids.slice(0, 1);
    case "use_gif": return gifs.slice(0, 1);
    case "keep_first": return infos.map((_, i) => i).slice(0, ({ tiktok: 35 })[p] || 20);
    default: return null;
  }
}

/** Short description of what a channel will get, for the confirm sheet. */
export function splitLabel(platform, infos, indices, { format = "Post", cropped = [] } = {}) {
  const p = net(platform);
  const picked = indices.map((i) => infos[i]).filter(Boolean);
  const v = picked.filter((m) => m.kind === "video").length;
  const s = picked.length - v;
  const crop = cropped.length ? ` · ${cropped.map((i) => `Photo ${i + 1}`).join(", ")} auto-fitted` : "";
  if (!picked.length) return p === "youtube" || p === "tiktok" ? "Needs a video" : "Text only";
  if ((p === "instagram" && format !== "Story") || p === "threads") {
    if (picked.length === 1) return (v ? "The video" : "1 photo") + crop;
    return `Carousel · ${picked.length === infos.length ? `all ${picked.length}` : `${picked.length} items`}${crop}`;
  }
  if (v && !s) return "The video";
  if (p === "x" && s && infos.filter((m) => m.kind === "photo").length > s) return `First ${s} photo${s === 1 ? "" : "s"}`;
  if (picked.length === 1 && picked[0].kind === "gif") return "The GIF";
  return `${s} photo${s === 1 ? "" : "s"}`;
}

/** Indices of Instagram feed photos that will be cropped to the post's shared frame. */
export function cropIndices(platform, infos, indices, { format = "Post", igRatio = null } = {}) {
  if (net(platform) !== "instagram" || format === "Story") return [];
  const frame = igFrameRatio(indices.map((i) => ({ video: infos[i]?.kind === "video", ratio: ratio(infos[i]) || 0 })), igRatio);
  return indices.filter((i) => { const m = infos[i]; const r = m && m.kind === "photo" ? ratio(m) : null; return r != null && igNeedsCrop(r, frame); });
}

/** Center-crop box {x,y,width,height} that brings a photo into Instagram's 4:5 .. 1.91:1 range. */
export function instagramCropBox(width, height) {
  const r = width / height;
  if (r > LIMITS.instagram.maxRatio) { const w = Math.round(height * LIMITS.instagram.maxRatio); return { x: Math.floor((width - w) / 2), y: 0, width: w, height }; }
  if (r < LIMITS.instagram.minRatio) { const h = Math.round(width / LIMITS.instagram.minRatio); return { x: 0, y: Math.floor((height - h) / 2), width, height: h }; }
  return { x: 0, y: 0, width, height };
}

/**
 * Whole-post summary for the panel.
 * rows: [{ account, platform, infos(all shared), indices(effective), check }]
 * Returns { needs: rows with problems, fine: muted "Already fine" phrases, count }.
 */
export function summarize(rows) {
  const needs = rows.filter((r) => r.check.problems.length);
  const fine = rows.filter((r) => !r.check.problems.length && r.infos.length).map((r) => {
    const name = NETWORK[net(r.platform)] || r.platform;
    if (r.indices.length === r.infos.length) return `${name} takes all ${r.infos.length} item${r.infos.length === 1 ? "" : "s"}`;
    return `${name} will use just ${splitLabel(r.platform, r.infos, r.indices).toLowerCase().replace(/^the /, "the ")}`;
  });
  return { needs, fine: [...new Set(fine)], count: needs.length };
}

/** Stable key for a composer media item: the URL for saved media, name:size:lastModified for a new File. */
export function mediaKeyOf(item) {
  return typeof item === "string" ? item : item ? `${item.name}:${item.size}:${item.lastModified}` : "";
}
