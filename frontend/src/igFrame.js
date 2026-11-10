// Instagram feed frame: like Instagram's own Create post, every item of a feed post shares ONE frame.
// Pure helpers (no DOM) so they can be tested with node --test. The server applies the same rule at publish
// (app/services/media_convert.py: ig_frame_ratio / frame_crop_box), so the preview matches what gets posted.
export const IG_MIN = 0.8;
export const IG_MAX = 1.91;
export const IG_CHIPS = [
  ["4:5", 0.8],
  ["1:1", 1],
  ["1.91:1", 1.91],
];

export const igClamp = (r) => Math.min(IG_MAX, Math.max(IG_MIN, r));
export function igNearest(r) {
  const c = igClamp(r);
  return IG_CHIPS.reduce(
    (best, [, v]) => (Math.abs(v - c) < Math.abs(best - c) ? v : best),
    IG_CHIPS[0][1],
  );
}

/**
 * The frame ratio for an Instagram feed post.
 * items: [{ video:boolean, ratio:number|0 }] in post order; chosen: the user's chip ratio (wins).
 * Carousel -> first photo snapped to 4:5 / 1:1 / 1.91:1; single photo -> clamped into range.
 * No photo (or not measured yet): the first video's ratio snapped, else 1:1.
 */
export function igFrameRatio(items, chosen = null) {
  if (chosen) return igClamp(Number(chosen));
  const list = items || [];
  const photo = list.find((m) => !m.video && m.ratio > 0);
  if (photo) return list.length > 1 ? igNearest(photo.ratio) : igClamp(photo.ratio);
  const vid = list.find((m) => m.video && m.ratio > 0);
  return vid ? igNearest(vid.ratio) : 1;
}

export function igChipLabel(r) {
  const hit = IG_CHIPS.find(([, v]) => Math.abs(v - r) < 0.006);
  if (hit) return hit[0];
  return r >= 1 ? `${r.toFixed(2)}:1` : `1:${(1 / r).toFixed(2)}`;
}

/** True when a photo of `ratio` will be cropped to fit `frame`. */
export const igNeedsCrop = (ratio, frame) => ratio > 0 && Math.abs(ratio - frame) >= 0.005;

const unit = (v) => (Number.isFinite(+v) ? Math.min(1, Math.max(0, +v)) : 0.5);

/** Crop rectangle {sx,sy,sw,sh} of `frame` aspect inside a w x h photo; ox/oy (0..1) choose the position. */
export function igCropRect(w, h, frame, ox = 0.5, oy = 0.5) {
  const r = w / h;
  if (Math.abs(r - frame) < 0.005) return { sx: 0, sy: 0, sw: w, sh: h };
  if (r > frame) {
    const sw = Math.max(1, Math.round(h * frame));
    return { sx: Math.round((w - sw) * unit(ox)), sy: 0, sw, sh: h };
  }
  const sh = Math.max(1, Math.round(w / frame));
  return { sx: 0, sy: Math.round((h - sh) * unit(oy)), sw: w, sh };
}

/** CSS object-position that shows the same crop as igCropRect (with object-fit: cover). */
export const igObjectPosition = (off) =>
  `${unit(off?.[0] ?? 0.5) * 100}% ${unit(off?.[1] ?? 0.5) * 100}%`;

/** Drag by (dx,dy) px inside a frame of fw x fh px showing a photo of `ratio` (cover): new [ox, oy]. */
export function igDragOffset(off, dx, dy, fw, fh, ratio) {
  const frame = fw / fh;
  const [ox, oy] = [unit(off?.[0] ?? 0.5), unit(off?.[1] ?? 0.5)];
  if (ratio > frame) {
    const free = fh * ratio - fw;
    return [free > 0 ? unit(ox - dx / free) : ox, oy];
  }
  const free = fw / ratio - fh;
  return [ox, free > 0 ? unit(oy - dy / free) : oy];
}

/** Payload for post_metadata.ig_crop: shared ratio (only if the user chose one) + offsets by item index. */
export function igCropPayload(crop, keys) {
  const c = crop || {};
  const offs = c.offsets || {};
  const offsets = (keys || []).map((k) =>
    Array.isArray(offs[k]) ? [unit(offs[k][0]), unit(offs[k][1])] : null,
  );
  const out = {};
  if (c.ratio) out.ratio = igClamp(Number(c.ratio));
  if (offsets.some(Boolean)) out.offsets = offsets.map((o) => o || [0.5, 0.5]);
  return out;
}
