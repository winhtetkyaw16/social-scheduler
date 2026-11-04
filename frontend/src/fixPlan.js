// Pure "Fix for me" sheet logic: per-account choices (Photos | Video toggle, item picker, X "Choose which 4"),
// row text, counts and the "No changes needed" group. No React/DOM, tested with node --test (fixPlan.test.mjs).
// Spec: design/screens/media-rules-spec.html (States) and composer-fix-for-me*.html.
import { LIMITS, NETWORK, autoSplit, cropIndices } from "./mediaRules.js";

const net = (p) => (p === "twitter" ? "x" : String(p || "").toLowerCase());
const idx = (infos, pred) => infos.map((m, i) => (pred(m) ? i : -1)).filter((i) => i >= 0);
const photos = (infos) => idx(infos, (m) => m.kind === "photo");
const videos = (infos) => idx(infos, (m) => m.kind === "video");
const gifs = (infos) => idx(infos, (m) => m.kind === "gif");
const stills = (infos) => idx(infos, (m) => m.kind !== "video");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Networks that can't mix photos and a video get a segmented toggle; mixed-friendly ones get an item picker. */
export const TOGGLE_NETWORKS = ["facebook", "linkedin", "x", "tiktok"];
export const PICK_NETWORKS = ["instagram", "threads"];

/** Photos-side indices for a can't-mix network (TikTok/X take real photos; FB/LI also accept GIFs as images). */
function photoSide(p, infos) {
  if (p === "x") return photos(infos).slice(0, LIMITS.x.photos);
  if (p === "tiktok") return photos(infos).slice(0, LIMITS.tiktok.photos);
  if (p === "linkedin") return stills(infos).slice(0, LIMITS.linkedin.photos);
  return stills(infos);
}

/** Segmented options, only when there's a real choice: ["Photos","Video"] (+ "GIF" on X when one is uploaded). */
export function choiceOptions(platform, infos) {
  const p = net(platform);
  if (!TOGGLE_NETWORKS.includes(p)) return [];
  const opts = [];
  if (photoSide(p, infos).length && (p !== "x" || photos(infos).length)) opts.push("Photos");
  if (videos(infos).length) opts.push("Video");
  if (p === "x" && gifs(infos).length) opts.push("GIF");
  return opts.length > 1 ? opts : [];
}

/** Indices a choice sends. X Photos uses `xPhotos` (from "Choose which 4") when given. */
export function indicesForChoice(platform, infos, choice, { xPhotos = null } = {}) {
  const p = net(platform);
  if (choice === "Video") return videos(infos).slice(0, 1);
  if (choice === "GIF") return gifs(infos).slice(0, 1);
  if (p === "x" && Array.isArray(xPhotos) && xPhotos.length) return xPhotos.filter((i) => infos[i]?.kind === "photo").slice(0, LIMITS.x.photos);
  return photoSide(p, infos);
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
  const p = net(platform);
  if (p === "instagram" && format !== "Story" && format !== "Reel / Video" && infos.length > 1) return { kind: "items", label: "Change", items: infos.map((_, i) => i), limit: LIMITS.instagram.carousel };
  if (p === "threads" && infos.length > 1) return { kind: "items", label: "Change", items: infos.map((_, i) => i), limit: LIMITS.threads.carousel };
  if (p === "x" && photos(infos).length > LIMITS.x.photos) return { kind: "x4", label: "Choose which 4", items: photos(infos), limit: LIMITS.x.photos };
  return null;
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
  const p = net(platform);
  return p === "youtube" || p === "tiktok" || p === "instagram" || format === "Reel / Video" || format === "Short";
}

/** Handle only when the API gave one; Facebook Pages read "Facebook Page". */
export function identityLine(account) {
  const p = net(account?.platform);
  const network = NETWORK[p] || account?.platform || "";
  if (p === "facebook") return account?.account_type === "group" ? "Facebook Group" : "Facebook Page";
  const meta = account?.extra_metadata || {};
  const raw = account?.username || meta.username || meta.screen_name || meta.handle || /\(@([^)]+)\)\s*$/.exec(String(account?.account_name || ""))?.[1] || "";
  const h = String(raw).trim().replace(/^@/, "");
  return h ? `${network} · @${h}` : network;
}

/** Short row text: line 2 summary + optional muted line 3 (max 3 lines with the name). */
export function rowText(platform, infos, indices, { format = "Post", suggested = [], skipped = false } = {}) {
  const p = net(platform);
  if (skipped) return { line2: "Skipped", line3: "This account won't get this post." };
  const picked = indices.map((i) => infos[i]).filter(Boolean);
  if (!picked.length) {
    if (needsMedia(p, format)) return { line2: "Nothing to post here", line3: p === "youtube" || format === "Reel / Video" || format === "Short" ? "Add a video, or skip this account." : "Add media, or skip this account." };
    return { line2: "Text only", line3: infos.length ? "Media won't be posted here" : "" };
  }
  const v = picked.filter((m) => m.kind === "video");
  const s = picked.length - v.length;
  let line2;
  if ((p === "instagram" && format !== "Story") || p === "threads") line2 = picked.length > 1 ? `Carousel · ${plural(picked.length, "item")}` : v.length ? `Video${fmtDuration(v[0].duration) ? ` · ${fmtDuration(v[0].duration)}` : ""}` : "1 photo";
  else if (v.length && !s) line2 = `Video${fmtDuration(v[0].duration) ? ` · ${fmtDuration(v[0].duration)}` : ""}`;
  else if (picked.length === 1 && picked[0].kind === "gif") line2 = "The GIF";
  else line2 = plural(s, "photo");

  let line3 = "";
  const cropped = cropIndices(p, infos, indices, { format });
  const left = infos.length - picked.length;
  const choice = choiceOf(infos, indices);
  const changed = !same(indices, suggested);
  if (TOGGLE_NETWORKS.includes(p) && choice === "Video" && stills(infos).length) line3 = p === "x" ? "Photos and GIFs won't be posted here" : "Photos won't be posted here";
  else if (TOGGLE_NETWORKS.includes(p) && choice === "GIF") line3 = "Other items won't be posted here";
  else if (p === "x" && choice === "Photos" && photos(infos).length > LIMITS.x.photos) line3 = changed ? `${plural(photos(infos).length - s, "photo")} won't be posted here` : "X allows up to 4 — we'll use the first 4";
  else if (TOGGLE_NETWORKS.includes(p) && choice === "Photos" && videos(infos).length) line3 = `${NETWORK[p]} can't mix photos and a video`;
  else if (p === "youtube" && left > 0) line3 = "Photos won't be posted here";
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
    const p = net(r.account?.platform);
    const format = r.format || "Post";
    const ov = overrides[r.account.id] || {};
    const suggested = autoSplit(p, r.infos, { format });
    const indices = Array.isArray(ov.indices) ? ov.indices : suggested;
    const skipped = !!ov.skip;
    const options = choiceOptions(p, r.infos);
    const empty = !skipped && !indices.length && needsMedia(p, format);
    const needsChange = (r.problems || 0) > 0 || (!indices.length && needsMedia(p, format));
    return {
      account: r.account, platform: p, format, suggested, indices, skipped, empty, needsChange,
      changed: !same(indices, suggested), options, choice: options.length ? choiceOf(r.infos, indices) : null,
      picker: pickerFor(p, r.infos, { format }), identity: identityLine(r.account),
      ...rowText(p, r.infos, indices, { format, suggested, skipped }),
    };
  });
  const changing = entries.filter((e) => e.needsChange);
  const unchanged = entries.filter((e) => !e.needsChange);
  return { entries, changing, unchanged, counts: { changing: changing.length, unchanged: unchanged.length, total: entries.filter((e) => !e.skipped).length } };
}

/** What Apply hands the composer: per-account indices and the skipped account ids. */
export function planResult(plan) {
  const selections = {};
  plan.entries.forEach((e) => { if (!e.skipped) selections[e.account.id] = e.indices; });
  return { selections, skip: plan.entries.filter((e) => e.skipped).map((e) => e.account.id), count: plan.counts.total };
}
