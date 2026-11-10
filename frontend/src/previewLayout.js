// Display-only layout helpers for the Threads and Facebook previews.
// They never touch the uploaded files; published media stays the original.
export const clampRatio = (r, lo, hi) =>
  Math.min(hi, Math.max(lo, r > 0 && Number.isFinite(r) ? r : 1));
export const TH_SINGLE = [4 / 5, 1.91];
export const TH_TILE = [3 / 4, 4 / 3];

// ratios: natural w/h per item (0 = not loaded yet -> treated as 1:1).
export function threadsLayout(ratios) {
  const list = ratios || [];
  if (list.length <= 1)
    return {
      kind: list.length ? "single" : "none",
      ratio: clampRatio(list[0], ...TH_SINGLE),
      tiles: [],
    };
  return {
    kind: "row",
    ratio: null,
    tiles: list.map((r) => ({
      w: clampRatio(r, ...TH_TILE),
      cropped: r > 0 && (r < TH_TILE[0] || r > TH_TILE[1]),
    })),
  };
}

// Facebook Classic auto-grid. Cells carry CSS grid placement (gridArea "row / col / rowEnd / colEnd").
export const fbPortrait = (r) => r > 0 && r < 1;
export function fbGridLayout(ratios) {
  const n = (ratios || []).length;
  if (!n) return { kind: "none", cells: [], more: 0 };
  if (n === 1)
    return {
      kind: "single",
      ratio: clampRatio(ratios[0], 4 / 5, 1.91),
      cells: [{ i: 0, area: "1 / 1 / 2 / 2" }],
      cols: "1fr",
      rows: "1fr",
      more: 0,
    };
  if (n === 2)
    return {
      kind: "pair",
      cells: [
        { i: 0, area: "1 / 1 / 2 / 2" },
        { i: 1, area: "1 / 2 / 2 / 3" },
      ],
      cols: "1fr 1fr",
      rows: "1fr",
      ratio: 1,
      more: 0,
    };
  if (n <= 4) {
    const k = n - 1;
    const v = fbPortrait(ratios[0]);
    const cells = [{ i: 0, area: v ? `1 / 1 / ${k + 1} / 2` : `1 / 1 / 2 / ${k + 1}` }];
    for (let j = 1; j <= k; j++)
      cells.push({ i: j, area: v ? `${j} / 2 / ${j + 1} / 3` : `2 / ${j} / 3 / ${j + 1}` });
    return v
      ? {
          kind: "hero",
          dir: "vertical",
          cells,
          cols: "2fr 1fr",
          rows: `repeat(${k}, 1fr)`,
          ratio: 1,
          more: 0,
        }
      : {
          kind: "hero",
          dir: "horizontal",
          cells,
          cols: `repeat(${k}, 1fr)`,
          rows: "2fr 1fr",
          ratio: 1,
          more: 0,
        };
  }
  const cells = [0, 1]
    .map((i) => ({ i, area: `1 / ${i * 3 + 1} / 2 / ${i * 3 + 4}` }))
    .concat([2, 3, 4].map((i, j) => ({ i, area: `2 / ${j * 2 + 1} / 3 / ${j * 2 + 3}` })));
  return { kind: "2+3", cells, cols: "repeat(6, 1fr)", rows: "1fr 1fr", ratio: 1, more: n - 5 };
}

// X (Twitter) timeline: a single image (or any GIF / video post) is shown uncropped inside 3:4..2:1;
// 2-4 images form a swipe row with a shared height and per-image widths in the same range.
export const X_RANGE = [3 / 4, 2];
export const X_MAX = 4;
export function xLayout(ratios, { single = false } = {}) {
  const list = (ratios || []).slice(0, X_MAX);
  if (!list.length) return { kind: "none", ratio: null, tiles: [] };
  if (list.length === 1 || single)
    return { kind: "single", ratio: clampRatio(list[0], ...X_RANGE), tiles: [] };
  return {
    kind: "row",
    ratio: null,
    tiles: list.map((r) => ({
      w: clampRatio(r, ...X_RANGE),
      cropped: r > 0 && (r < X_RANGE[0] || r > X_RANGE[1]),
    })),
  };
}

// LinkedIn feed. ratio = w/h of the whole block; tiles always fill it (no empty area).
// 3+ items: block is between 4:5 and 1:1; rowFracs/colFracs are the shares of the block (sum to 1).
export const LINKEDIN_MAX_VISIBLE = 4;
export const LI_SINGLE = [4 / 5, 3];
export const LI_CAP = 4 / 5;
export const LI_HERO = [0.6, 0.66];
const fr = (xs) => xs.map((x) => `${x}fr`).join(" ");
export function liLayout(ratios, { video = false, max = LINKEDIN_MAX_VISIBLE } = {}) {
  const all = ratios || [];
  const itemCount = all.length;
  if (!itemCount) return { kind: "none", cells: [], more: 0 };
  const r = all.map((x) => clampRatio(x || 1, ...LI_SINGLE));
  if (itemCount === 1) {
    const own = video ? clampRatio(all[0] || 16 / 9, 1 / 2.4, 2.4) : r[0];
    return {
      kind: "single",
      ratio: own,
      frame: own,
      cropped: false,
      cols: "1fr",
      rows: "1fr",
      rowFracs: [1],
      colFracs: [1],
      cells: [{ i: 0, area: "1 / 1 / 2 / 2" }],
      more: 0,
    };
  }
  if (itemCount === 2) {
    const nat = r[0] + r[1];
    const ratio = clampRatio(nat, LI_CAP, 2);
    return {
      kind: "pair",
      ratio,
      frame: ratio,
      cropped: false,
      cols: fr([r[0] / nat, r[1] / nat]),
      rows: "1fr",
      rowFracs: [1],
      colFracs: [r[0] / nat, r[1] / nat],
      cells: [
        { i: 0, area: "1 / 1 / 2 / 2" },
        { i: 1, area: "1 / 2 / 2 / 3" },
      ],
      more: 0,
    };
  }
  const shown = Math.min(itemCount, Math.max(2, max));
  const k = shown - 1;
  const more = itemCount - shown;
  const rest = r.slice(1, shown);
  if (r[0] > 4 / 3) {
    const heroH = 1 / r[0];
    const rowH = 1 / k / Math.max(...rest);
    const ratio = clampRatio(1 / (heroH + rowH), LI_CAP, 1);
    const top = clampRatio(heroH / (heroH + rowH), ...LI_HERO);
    const rowFracs = [top, 1 - top];
    const colFracs = Array(k).fill(1 / k);
    const cells = [{ i: 0, area: `1 / 1 / 2 / ${k + 1}` }];
    for (let j = 1; j <= k; j++) cells.push({ i: j, area: `2 / ${j} / 3 / ${j + 1}` });
    return {
      kind: "top",
      ratio,
      frame: ratio,
      cropped: false,
      cols: fr(colFracs),
      rows: fr(rowFracs),
      rowFracs,
      colFracs,
      cells,
      more,
    };
  }
  const ratio = clampRatio(Math.min(1, r[0]) * 1.5, LI_CAP, 1);
  const rowFracs = Array(k).fill(1 / k);
  const colFracs = [2 / 3, 1 / 3];
  const cells = [{ i: 0, area: `1 / 1 / ${k + 1} / 2` }];
  for (let j = 1; j <= k; j++) cells.push({ i: j, area: `${j} / 2 / ${j + 1} / 3` });
  return {
    kind: "left",
    ratio,
    frame: ratio,
    cropped: false,
    cols: "2fr 1fr",
    rows: fr(rowFracs),
    rowFracs,
    colFracs,
    cells,
    more,
  };
}

/** Facebook Page post preview: a Page post carries one video, never a video next to other media.
 *  kinds: "video" | "image" | "gif" per item. Returns "blocked" until the media is cut down to one video. */
export function fbPostState(kinds = []) {
  const v = kinds.filter((k) => k === "video").length;
  if (v > 1) return "choose_video";
  if (v === 1 && kinds.length > 1) return "mixed";
  return "ok";
}

/** Networks whose preview carries one video per post (Instagram/Threads carousels are not gated). */
export const ONE_VIDEO_PREVIEW = {
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  x: "X",
  twitter: "X",
  youtube: "YouTube",
};

/** Shared gate for every single-video network preview: until one video is picked (2+ videos in the
 *  account's media), show "Choose which video goes to <Network>". Facebook Page posts also gate video+photos.
 *  Returns { state: "ok" | "choose_video" | "mixed", net, title, line }. */
export function oneVideoGate(platform, kinds = []) {
  const key = String(platform || "").toLowerCase();
  const net = ONE_VIDEO_PREVIEW[key];
  if (!net) return { state: "ok", net: null };
  let state = fbPostState(kinds);
  if (state === "mixed" && key !== "facebook") state = "ok";
  if (state === "ok") return { state, net };
  return {
    state,
    net,
    title:
      state === "choose_video"
        ? `Choose which video goes to ${net}`
        : `${net} posts a video on its own`,
    line: `${key === "facebook" ? "A Page post" : `${net}`} carries one video${key === "facebook" ? "" : " per post"}. Use Fix for me to pick it.`,
  };
}
