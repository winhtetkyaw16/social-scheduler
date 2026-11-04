// Display-only layout helpers for the Threads and Facebook previews.
// They never touch the uploaded files; published media stays the original.
export const clampRatio = (r, lo, hi) => Math.min(hi, Math.max(lo, r > 0 && Number.isFinite(r) ? r : 1));
export const TH_SINGLE = [4 / 5, 1.91];
export const TH_TILE = [3 / 4, 4 / 3];

// ratios: natural w/h per item (0 = not loaded yet -> treated as 1:1).
export function threadsLayout(ratios) {
  const list = ratios || [];
  if (list.length <= 1) return { kind: list.length ? "single" : "none", ratio: clampRatio(list[0], ...TH_SINGLE), tiles: [] };
  return { kind: "row", ratio: null, tiles: list.map((r) => ({ w: clampRatio(r, ...TH_TILE), cropped: r > 0 && (r < TH_TILE[0] || r > TH_TILE[1]) })) };
}

// Facebook Classic auto-grid. Cells carry CSS grid placement (gridArea "row / col / rowEnd / colEnd").
export const fbPortrait = (r) => r > 0 && r < 1;
export function fbGridLayout(ratios) {
  const n = (ratios || []).length;
  if (!n) return { kind: "none", cells: [], more: 0 };
  if (n === 1) return { kind: "single", ratio: clampRatio(ratios[0], 4 / 5, 1.91), cells: [{ i: 0, area: "1 / 1 / 2 / 2" }], cols: "1fr", rows: "1fr", more: 0 };
  if (n === 2) return { kind: "pair", cells: [{ i: 0, area: "1 / 1 / 2 / 2" }, { i: 1, area: "1 / 2 / 2 / 3" }], cols: "1fr 1fr", rows: "1fr", ratio: 1, more: 0 };
  if (n <= 4) {
    const k = n - 1; const v = fbPortrait(ratios[0]);
    const cells = [{ i: 0, area: v ? `1 / 1 / ${k + 1} / 2` : `1 / 1 / 2 / ${k + 1}` }];
    for (let j = 1; j <= k; j++) cells.push({ i: j, area: v ? `${j} / 2 / ${j + 1} / 3` : `2 / ${j} / 3 / ${j + 1}` });
    return v ? { kind: "hero", dir: "vertical", cells, cols: "2fr 1fr", rows: `repeat(${k}, 1fr)`, ratio: 1, more: 0 }
      : { kind: "hero", dir: "horizontal", cells, cols: `repeat(${k}, 1fr)`, rows: "2fr 1fr", ratio: 1, more: 0 };
  }
  const cells = [0, 1].map((i) => ({ i, area: `1 / ${i * 3 + 1} / 2 / ${i * 3 + 4}` }))
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
  if (list.length === 1 || single) return { kind: "single", ratio: clampRatio(list[0], ...X_RANGE), tiles: [] };
  return { kind: "row", ratio: null, tiles: list.map((r) => ({ w: clampRatio(r, ...X_RANGE), cropped: r > 0 && (r < X_RANGE[0] || r > X_RANGE[1]) })) };
}

// LinkedIn feed. ratio = natural w/h of the grid; frame = shown box (capped at 4:5 tall, bottom cropped).
export const LINKEDIN_MAX_VISIBLE = 4;
export const LI_SINGLE = [4 / 5, 3];
export const LI_CAP = 4 / 5;
export function liLayout(ratios, { video = false, max = LINKEDIN_MAX_VISIBLE } = {}) {
  const all = ratios || []; const n = all.length;
  if (!n) return { kind: "none", cells: [], more: 0 };
  const r = all.map((x) => clampRatio(x, ...LI_SINGLE));
  if (n === 1) {
    const own = video ? clampRatio(all[0], 1 / 2.4, 2.4) : r[0];
    return { kind: "single", ratio: own, frame: own, cropped: false, cols: "1fr", rows: "1fr", cells: [{ i: 0, area: "1 / 1 / 2 / 2" }], more: 0 };
  }
  const cap = (nat) => ({ ratio: nat, frame: Math.max(nat, LI_CAP), cropped: nat < LI_CAP - 1e-9 });
  if (n === 2) return { kind: "pair", ...cap(r[0] + r[1]), cols: `${r[0]}fr ${r[1]}fr`, rows: "1fr",
    cells: [{ i: 0, area: "1 / 1 / 2 / 2" }, { i: 1, area: "1 / 2 / 2 / 3" }], more: 0 };
  const shown = Math.min(n, Math.max(2, max)); const k = shown - 1; const more = n - shown;
  const rest = r.slice(1, shown);
  if (r[0] > 4 / 3) {
    const heroH = 1 / r[0]; const rowH = (1 / k) / Math.max(...rest);
    const cells = [{ i: 0, area: `1 / 1 / 2 / ${k + 1}` }];
    for (let j = 1; j <= k; j++) cells.push({ i: j, area: `2 / ${j} / 3 / ${j + 1}` });
    return { kind: "top", ...cap(1 / (heroH + rowH)), cols: `repeat(${k}, 1fr)`, rows: `${heroH}fr ${rowH}fr`, cells, more };
  }
  const hero = Math.min(1, r[0]);
  const cells = [{ i: 0, area: `1 / 1 / ${k + 1} / 2` }];
  for (let j = 1; j <= k; j++) cells.push({ i: j, area: `${j} / 2 / ${j + 1} / 3` });
  return { kind: "left", ...cap(hero * 1.5), cols: "2fr 1fr", rows: `repeat(${k}, 1fr)`, cells, more };
}
