// Ordering helpers for the Queue view tabs.
// Published and Failed are history: newest day first, newest post first inside each day.
// Scheduled and Queued are upcoming: soonest first.

export const NEWEST_FIRST_TABS = new Set(["published", "failed"]);

export function queueDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function queueTimeFor(post, tab) {
  if (tab === "published")
    return post?.published_at || post?.scheduled_at || post?.created_at || null;
  return post?.scheduled_at || post?.published_at || post?.created_at || null;
}

function ms(value) {
  const t = new Date(value || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Returns [[dayKey, { d, items }], ...] in display order for the given tab.
export function groupQueuePosts(posts, tab) {
  const dir = NEWEST_FIRST_TABS.has(tab) ? -1 : 1;
  const sorted = (Array.isArray(posts) ? posts : [])
    .slice()
    .sort((x, y) => dir * (ms(queueTimeFor(x, tab)) - ms(queueTimeFor(y, tab))));
  const groups = new Map();
  for (const p of sorted) {
    const d = new Date(queueTimeFor(p, tab) || 0);
    const k = queueDateKey(d);
    if (!groups.has(k)) groups.set(k, { d, items: [] });
    groups.get(k).items.push(p);
  }
  return [...groups.entries()].sort((a, b) => dir * a[0].localeCompare(b[0]));
}
