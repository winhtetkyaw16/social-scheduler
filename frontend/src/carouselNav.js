// Pure index logic shared by every preview carousel (no wrap-around, matching the real feeds).
export const clampIndex = (i, n) => (n > 0 ? Math.min(n - 1, Math.max(0, Math.round(Number(i) || 0))) : 0);
export const stepIndex = (i, n, dir) => clampIndex(clampIndex(i, n) + (dir < 0 ? -1 : dir > 0 ? 1 : 0), n);
export const arrowsFor = (i, n) => ({ prev: n > 1 && clampIndex(i, n) > 0, next: n > 1 && clampIndex(i, n) < n - 1 });
export const keyDir = (key) => (key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0);
// Scroll row: the current item is the tile whose left edge is nearest the scroll position;
// at the far end (can't scroll further) the last item counts as current.
export function nearestIndex(scrollLeft, lefts, maxScroll) {
  if (!lefts || !lefts.length) return 0;
  if (maxScroll > 0 && scrollLeft >= maxScroll - 2) return lefts.length - 1;
  let best = 0;
  lefts.forEach((x, i) => { if (Math.abs(x - scrollLeft) < Math.abs(lefts[best] - scrollLeft)) best = i; });
  return best;
}
