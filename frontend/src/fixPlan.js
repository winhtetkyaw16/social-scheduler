// Pure "Fix for me" sheet logic: per-account choices (Photos | Video toggle, item picker, X "Choose which 4"),
// row text, counts and the "No changes needed" group. No React/DOM, tested with node --test (fixPlan.test.mjs).
// Spec: design/screens/media-rules-spec.html (States) and composer-fix-for-me*.html.
import { LIMITS, NETWORK, autoSplit, checkMedia, cropIndices, mediaInfo } from "./mediaRules.js";

const net = (platform) => (platform === "twitter" ? "x" : String(platform || "").toLowerCase());
const idx = (infos, pred) => infos.map((m, i) => (pred(m) ? i : -1)).filter((i) => i >= 0);
const photos = (infos) => idx(infos, (m) => m.kind === "photo");
const videos = (infos) => idx(infos, (m) => m.kind === "video");
const gifs = (infos) => idx(infos, (m) => m.kind === "gif");
const stills = (infos) => idx(infos, (m) => m.kind !== "video");
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Networks that can't mix photos and a video get a segmented toggle; mixed-friendly ones get an item picker. */
export const TOGGLE_NETWORKS = ["facebook", "linkedin", "x", "tiktok"];
export const PICK_NETWORKS = ["instagram", "threads"];

/** Photos-side indices for a can't-mix network (TikTok/X take real photos; FB/LI also accept GIFs as images). */
function photoSide(platform, infos) {
  if (platform === "x") return photos(infos).slice(0, LIMITS.x.photos);
  if (platform === "tiktok") return photos(infos).slice(0, LIMITS.tiktok.photos);
  if (platform === "linkedin") return stills(infos).slice(0, LIMITS.linkedin.photos);
  return stills(infos);
}

/** Segmented options, only when there's a real choice: ["Photos","Video"] (+ "GIF" on X when one is uploaded). */
export function choiceOptions(platform, infos) {
  const platformKey = net(platform);
  if (!TOGGLE_NETWORKS.includes(platformKey)) return [];
  const opts = [];
  if (photoSide(platformKey, infos).length && (platformKey !== "x" || photos(infos).length))
    opts.push("Photos");
  if (videos(infos).length) opts.push("Video");
  if (platformKey === "x" && gifs(infos).length) opts.push("GIF");
  return opts.length > 1 ? opts : [];
}

/** Indices a choice sends. X Photos uses `xPhotos` (from "Choose which 4") when given. */
export function indicesForChoice(platform, infos, choice, { xPhotos = null, video = null } = {}) {
  const platformKey = net(platform);
  if (choice === "Video") return videoChoice(infos, video);
  if (choice === "GIF") return gifs(infos).slice(0, 1);
  if (platformKey === "x" && Array.isArray(xPhotos) && xPhotos.length)
    return xPhotos.filter((i) => infos[i]?.kind === "photo").slice(0, LIMITS.x.photos);
  return photoSide(platformKey, infos);
}

/** Networks that post only one video per post (Fix for me shows a "which video" picker when 2+ exist). */
export const SINGLE_VIDEO_NETWORKS = ["facebook", "linkedin", "tiktok", "x", "youtube"];

/** The one video a single-video network sends: the user's pick when it is a video, else the first. */
export function videoChoice(infos, video = null) {
  const videoIndices = videos(infos);
  return Number.isInteger(video) && videoIndices.includes(video)
    ? [video]
    : videoIndices.slice(0, 1);
}

/** Shared media URLs one account publishes, in order (what the publish payload sends). */
export function urlsForSelection(sharedUrls, indices) {
  return (Array.isArray(indices) ? indices : []).map((i) => sharedUrls[i]).filter(Boolean);
}

const joinNames = (names) =>
  names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * Specific blocking media errors for the composer, grouped by message across accounts (shown under the
 * "Media needs a few changes" panel with the account avatars). rows: mediaReport rows ({ account, infos, check }).
 * Returns [{ key, accounts, message }].
 */
export function blockingGroups(rows = []) {
  const groups = new Map();
  const add = (key, account, text) => {
    if (!groups.has(key)) groups.set(key, { key, accounts: [], text });
    const group = groups.get(key);
    if (!group.accounts.some((existing) => existing.id === account.id))
      group.accounts.push(account);
  };
  for (const row of rows) {
    const platformKey = net(row.account?.platform);
    const infos = row.infos || [];
    const many = videos(infos).length > 1 && SINGLE_VIDEO_NETWORKS.includes(platformKey);
    if (many) add("one_video", row.account, null);
    for (const pr of row.check?.problems || []) {
      if (many && pr.code === "too_many") continue; // said once, as "allow only 1 video per post"
      add(`${pr.code}:${pr.title}`, row.account, pr.title + (pr.detail ? ` — ${pr.detail}` : ""));
    }
  }
  return [...groups.values()].map((group) => {
    const names = [
      ...new Set(
        group.accounts.map((account) => NETWORK[net(account.platform)] || account.platform),
      ),
    ];
    const message =
      group.key === "one_video"
        ? `${joinNames(names)} allow${names.length === 1 ? "s" : ""} only 1 video per post`
        : `${joinNames(names)}: ${group.text}`;
    return { key: group.key, accounts: group.accounts, message };
  });
}

/** Which toggle option a set of indices corresponds to. */
export function choiceOf(infos, indices) {
  const picked = indices.map((i) => infos[i]).filter(Boolean);
  if (picked.length && picked.every((m) => m.kind === "video")) return "Video";
  if (picked.length === 1 && picked[0].kind === "gif") return "GIF";
  return "Photos";
}

/** Item picker for a row: { label, items (pickable indices), limit } or null. */
export function pickerFor(platform, infos, { format = "Post" } = {}) {
  const platformKey = net(platform);
  if (
    platformKey === "instagram" &&
    format !== "Story" &&
    format !== "Reel / Video" &&
    infos.length > 1
  )
    return {
      kind: "items",
      label: "Change",
      items: infos.map((_, i) => i),
      limit: LIMITS.instagram.carousel,
    };
  if (platformKey === "threads" && infos.length > 1)
    return {
      kind: "items",
      label: "Change",
      items: infos.map((_, i) => i),
      limit: LIMITS.threads.carousel,
    };
  if (platformKey === "x" && photos(infos).length > LIMITS.x.photos)
    return { kind: "x4", label: "Choose which 4", items: photos(infos), limit: LIMITS.x.photos };
  return null;
}

/** Single-video networks with 2+ videos sending a video: pick which one (thumbnails with durations, one choice). */
export function videoPicker(platform, infos, indices, skipped = false) {
  const platformKey = net(platform);
  const videoIndices = videos(infos);
  if (skipped || !SINGLE_VIDEO_NETWORKS.includes(platformKey) || videoIndices.length < 2)
    return null;
  const picked = indices.map((i) => infos[i]).filter(Boolean);
  if (!picked.length || !picked.every((m) => m.kind === "video")) return null;
  return {
    kind: "video",
    label: "Choose video",
    items: videoIndices,
    limit: 1,
    chosen: indices.find((i) => videoIndices.includes(i)),
  };
}

/** Tick/untick one item in a picker. Never above the limit, never below 1. Keeps the user's order. */
export function togglePick(selected, index, limit) {
  const has = selected.includes(index);
  if (has) return selected.length > 1 ? selected.filter((i) => i !== index) : selected;
  if (selected.length >= limit) return selected;
  return [...selected, index].sort((a, b) => a - b);
}

export function fmtDuration(sec) {
  if (sec == null || !Number.isFinite(sec)) return "";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Networks that can't post without media. */
export function needsMedia(platform, format = "Post") {
  const platformKey = net(platform);
  return (
    platformKey === "youtube" ||
    platformKey === "tiktok" ||
    platformKey === "instagram" ||
    format === "Reel / Video" ||
    format === "Short"
  );
}

/** Handle only when the API gave one; Facebook Pages read "Facebook Page". */
export function identityLine(account) {
  const platformKey = net(account?.platform);
  const network = NETWORK[platformKey] || account?.platform || "";
  if (platformKey === "facebook")
    return account?.account_type === "group" ? "Facebook Group" : "Facebook Page";
  const meta = account?.extra_metadata || {};
  const raw =
    account?.username ||
    meta.username ||
    meta.screen_name ||
    meta.handle ||
    /\(@([^)]+)\)\s*$/.exec(String(account?.account_name || ""))?.[1] ||
    "";
  const h = String(raw).trim().replace(/^@/, "");
  return h ? `${network} · @${h}` : network;
}

/** Short row text: line 2 summary + optional muted line 3 (max 3 lines with the name). */
export function rowText(
  platform,
  infos,
  indices,
  { format = "Post", suggested = [], skipped = false } = {},
) {
  const platformKey = net(platform);
  if (skipped) return { line2: "Skipped", line3: "This account won't get this post." };
  const picked = indices.map((i) => infos[i]).filter(Boolean);
  if (!picked.length) {
    if (needsMedia(platformKey, format))
      return {
        line2: "Nothing to post here",
        line3:
          platformKey === "youtube" || format === "Reel / Video" || format === "Short"
            ? "Add a video, or skip this account."
            : "Add media, or skip this account.",
      };
    return { line2: "Text only", line3: infos.length ? "Media won't be posted here" : "" };
  }
  const v = picked.filter((m) => m.kind === "video");
  const s = picked.length - v.length;
  let line2;
  if ((platformKey === "instagram" && format !== "Story") || platformKey === "threads")
    line2 =
      picked.length > 1
        ? `Carousel · ${plural(picked.length, "item")}`
        : v.length
          ? `Video${fmtDuration(v[0].duration) ? ` · ${fmtDuration(v[0].duration)}` : ""}`
          : "1 photo";
  else if (v.length && !s)
    line2 = `Video${fmtDuration(v[0].duration) ? ` · ${fmtDuration(v[0].duration)}` : ""}`;
  else if (picked.length === 1 && picked[0].kind === "gif") line2 = "The GIF";
  else line2 = plural(s, "photo");

  let line3 = "";
  const cropped = cropIndices(platformKey, infos, indices, { format });
  const left = infos.length - picked.length;
  const choice = choiceOf(infos, indices);
  const changed = !same(indices, suggested);
  const otherVids =
    SINGLE_VIDEO_NETWORKS.includes(platformKey) && choice === "Video"
      ? videos(infos).length - v.length
      : 0;
  const otherV =
    otherVids > 0
      ? `${otherVids === 1 ? "The other video" : `${otherVids} other videos`} won't be posted here`
      : "";
  if (otherV && stills(infos).length)
    line3 = `${otherV}, nor the ${platformKey === "x" ? "photos and GIFs" : "photos"}`;
  else if (otherV) line3 = otherV;
  else if (TOGGLE_NETWORKS.includes(platformKey) && choice === "Video" && stills(infos).length)
    line3 =
      platformKey === "x" ? "Photos and GIFs won't be posted here" : "Photos won't be posted here";
  else if (TOGGLE_NETWORKS.includes(platformKey) && choice === "GIF")
    line3 = "Other items won't be posted here";
  else if (platformKey === "x" && choice === "Photos" && photos(infos).length > LIMITS.x.photos)
    line3 = changed
      ? `${plural(photos(infos).length - s, "photo")} won't be posted here`
      : "X allows up to 4 — we'll use the first 4";
  else if (TOGGLE_NETWORKS.includes(platformKey) && choice === "Photos" && videos(infos).length)
    line3 = `${NETWORK[platformKey]} can't mix photos and a video`;
  else if (platformKey === "youtube" && left > 0) line3 = "Photos won't be posted here";
  else if (left > 0 && changed) line3 = `${plural(left, "item")} won't be posted here`;
  return { line2, line3 };
}

/**
 * Build the sheet/panel plan. One count source for both.
 * rows: [{ account, format, infos (shared media infos), problems (number) }]
 * overrides: { [accountId]: { indices?: number[], xPhotos?: number[], skip?: boolean } }
 */
export function buildFixPlan(rows, overrides = {}) {
  const entries = rows.map((r) => {
    const platformKey = net(r.account?.platform);
    const format = r.format || "Post";
    const ov = overrides[r.account.id] || {};
    const suggested = autoSplit(platformKey, r.infos, { format });
    const indices = Array.isArray(ov.indices) ? ov.indices : suggested;
    const skipped = !!ov.skip;
    const options = choiceOptions(platformKey, r.infos);
    const empty = !skipped && !indices.length && needsMedia(platformKey, format);
    const needsChange =
      (r.problems || 0) > 0 || (!indices.length && needsMedia(platformKey, format));
    return {
      account: r.account,
      platform: platformKey,
      format,
      suggested,
      indices,
      skipped,
      empty,
      needsChange,
      changed: !same(indices, suggested),
      options,
      choice: options.length ? choiceOf(r.infos, indices) : null,
      picker:
        videoPicker(platformKey, r.infos, indices, skipped) ||
        pickerFor(platformKey, r.infos, { format }),
      identity: identityLine(r.account),
      ...rowText(platformKey, r.infos, indices, { format, suggested, skipped }),
    };
  });
  const changing = entries.filter((e) => e.needsChange);
  const unchanged = entries.filter((e) => !e.needsChange);
  return {
    entries,
    changing,
    unchanged,
    counts: {
      changing: changing.length,
      unchanged: unchanged.length,
      total: entries.filter((e) => !e.skipped).length,
    },
  };
}

/** What Apply hands the composer: per-account indices and the skipped account ids. */
export function planResult(plan) {
  const selections = {};
  plan.entries.forEach((e) => {
    if (!e.skipped) selections[e.account.id] = e.indices;
  });
  return {
    selections,
    skip: plan.entries.filter((e) => e.skipped).map((e) => e.account.id),
    count: plan.counts.total,
  };
}

/**
 * Posting is blocked while any blocking error remains: a channel error (format, caption, limits, unreadable file)
 * or a media problem "Fix for me" would change. Auto-fixed things (IG upscale/auto-fit, conversions) and warnings
 * never reach these lists, so they never block. Save draft is always allowed.
 */
export function publishBlock({ channelWarnings = [], mediaReport = [] } = {}) {
  const ids = new Set();
  for (const w of channelWarnings) ids.add(w.account?.id);
  for (const r of mediaReport) if (r.check?.problems?.length) ids.add(r.account?.id);
  return {
    blocked: ids.size > 0,
    accounts: ids.size,
    hint: ids.size ? "Fix the errors above to post" : "",
  };
}

/** Formats each network can publish (composer picker + blocking check).
 * YouTube has no Community post (no Data API create). TikTok has no Story (not in the Content Posting API). */
export const SUPPORTED_FORMATS = {
  x: ["Post", "Reel / Video"],
  facebook: ["Post", "Reel / Video", "Story"],
  instagram: ["Post", "Reel / Video", "Story"],
  youtube: ["Reel / Video", "Short"],
  tiktok: ["Post", "Reel / Video"],
  linkedin: ["Post", "Reel / Video"],
  pinterest: ["Post", "Reel / Video"],
  threads: ["Post"],
};

// One wording for the "video format without a video" error, shared with app/services/post_formats.py
// so the composer, the API and the worker all say the same, actionable thing.
export function videoFormatMessage(format) {
  return format === "Short"
    ? "Please include a video for this Short — tick a video for this account, or remove YouTube Shorts from the post."
    : "Please include a video for this video post — tick a video for this account, or switch the post type to Post.";
}

// Format the composer picks by itself from the media an account currently uses. Never picks Story.
export function autoFormat(platform, infos = []) {
  const supported = SUPPORTED_FORMATS[platform] || ["Post"];
  const fallback = supported.includes("Post") ? "Post" : supported[0];
  const videos = (infos || []).filter((i) => i?.kind === "video");
  if (!videos.length) return fallback;
  const v = videos[0];
  const vertical = v.height > v.width * 1.15;
  const candidate =
    vertical && platform === "youtube"
      ? "Short"
      : !vertical && (platform === "instagram" || platform === "facebook")
        ? "Post"
        : "Reel / Video";
  return supported.includes(candidate) ? candidate : fallback;
}

// The user's explicit choice wins. Otherwise the format is derived from the media ticked for that account.
export function effectiveFormat({ platform, stored, overridden, infos = [] }) {
  if (overridden && typeof stored === "string" && stored) return stored;
  return autoFormat(platform, infos);
}

/** Blocking channel errors that don't depend on files (format, caption, video needed). Shared by the composer and the post panel. */
export function channelErrors({
  platform,
  label,
  format = "Post",
  text = "",
  limit = Infinity,
  hasVideo = false,
  mediaCount = 0,
}) {
  const out = [];
  const chosen = typeof format === "string" ? format.trim() : "";
  if (!chosen) out.push("Choose a format before publishing. This post has no saved format.");
  else if (!(SUPPORTED_FORMATS[platform] || ["Post"]).includes(chosen))
    out.push(`${chosen} is not available for ${label || platform}; choose a supported format.`);
  if (!String(text).trim()) out.push("Add a caption for this channel.");
  if (String(text).length > limit)
    out.push(`Caption is over this channel’s ${limit.toLocaleString()} character limit.`);
  if ((chosen === "Short" || chosen === "Reel / Video") && !hasVideo)
    out.push(videoFormatMessage(chosen));
  if (chosen === "Story" && !mediaCount) out.push("Add a photo or video to create this Story.");
  return out;
}

/**
 * Blocking errors for an already-saved post (post detail panel), using the same rules as the composer:
 * channelErrors + checkMedia problems, combined by publishBlock. Auto-fixed issues and warnings never block.
 */
export function savedPostBlock({ account, post, content, limit }) {
  const md =
    post?.post_metadata && typeof post.post_metadata === "object" ? post.post_metadata : {};
  const format = typeof md.format === "string" ? md.format.trim() : "";
  const platform = net(account?.platform || "");
  const urls = (Array.isArray(post?.media_urls) ? post.media_urls : []).map(String);
  const infos = urls.map((u) => mediaInfo(u));
  const text = typeof content === "string" ? content : String(post?.content || "");
  const errs = channelErrors({
    platform,
    format,
    text,
    limit,
    hasVideo: infos.some((m) => m.kind === "video"),
    mediaCount: infos.length,
  });
  const acc = account || { id: post?.connected_account_id, platform };
  const check = checkMedia(platform, infos, { format });
  const result = publishBlock({
    channelWarnings: errs.map((message) => ({ account: acc, message })),
    mediaReport: [{ account: acc, check }],
  });
  return {
    ...result,
    messages: [
      ...errs,
      ...check.problems.map((p) => (typeof p === "string" ? p : p?.title || "")),
    ].filter(Boolean),
  };
}
