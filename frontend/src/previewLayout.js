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
