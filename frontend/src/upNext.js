// Helpers for the Dashboard "Up next" card.
// All posts are sorted simply newest first by their own time; no status split.

export function upNextTime(post) {
  return post?.scheduled_at || post?.published_at || post?.created_at || null;
}

function ms(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

// Newest first; posts with no usable time go to the bottom (stable order).
export function sortUpNext(posts) {
  return (Array.isArray(posts) ? posts : [])
    .map((p, i) => ({ p, i, t: ms(upNextTime(p)) }))
    .sort((a, b) => {
      if (a.t === null && b.t === null) return a.i - b.i;
      if (a.t === null) return 1;
      if (b.t === null) return -1;
      return b.t - a.t || a.i - b.i;
    })
    .map((x) => x.p);
}

// Separate local date and time parts, e.g. { date: "Nov 4", time: "7:46 PM" }.
// Year added to the date when not the current year. Missing time -> { date: "No time set", time: "" }.
export function upNextDateParts(value, now = new Date()) {
  const t = ms(value);
  if (t === null) return { date: "No time set", time: "" };
  const d = new Date(t);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const h = d.getHours();
  const time = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  const year = d.getFullYear() !== now.getFullYear() ? `, ${d.getFullYear()}` : "";
  return { date: `${months[d.getMonth()]} ${d.getDate()}${year}`, time };
}

// "Nov 4 \u00b7 7:46 PM" single-line label (local time).
export function upNextDateLabel(value, now = new Date()) {
  const { date, time } = upNextDateParts(value, now);
  return time ? `${date} \u00b7 ${time}` : date;
}
