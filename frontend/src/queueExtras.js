// Plain-language copy for the Evergreen and Bulk upload cards in Queue settings.

export const EVERGREEN_INTERVALS = [7, 14, 30, 60, 90];

const fmtDate = (value) =>
  new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtDateTime = (value) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** One muted line under an evergreen post: what happens next. */
export function evergreenStatus(row, now = new Date()) {
  if (!row) return "";
  if (row.reshare_scheduled_at)
    return `Re-share scheduled for ${fmtDateTime(row.reshare_scheduled_at)}`;
  const last = row.last_published_at
    ? `Last posted ${fmtDate(row.last_published_at)}`
    : "Not posted yet";
  if (!row.enabled) return last;
  if (!row.last_published_at) return "Can be re-shared after it's posted";
  if (row.next_eligible_at && new Date(row.next_eligible_at) > now)
    return `${last} · can re-share after ${fmtDate(row.next_eligible_at)}`;
  return `${last} · goes into the next empty slot`;
}

/** Interval choices, always including the post's current value. */
export function intervalOptions(current) {
  const values = new Set(EVERGREEN_INTERVALS);
  if (Number.isFinite(current) && current > 0) values.add(current);
  return [...values].sort((a, b) => a - b);
}

/** Banner for a bulk upload result: { tone: "error" | "ready" | "done", title, text }. */
export function bulkSummary(result) {
  if (!result) return null;
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const plural = (n) => `${n} post${n === 1 ? "" : "s"}`;
  if (errors.length)
    return {
      tone: "error",
      title: "Nothing was scheduled",
      text:
        errors.length === 1
          ? "Fix the problem below and upload the file again. Row numbers match your spreadsheet."
          : `Fix the ${errors.length} problems below and upload the file again. Row numbers match your spreadsheet.`,
    };
  if (result.dry_run)
    return {
      tone: "ready",
      title: `${plural(result.valid_rows)} ready to schedule`,
      text: "Every row looks good. Nothing is scheduled until you confirm.",
    };
  return {
    tone: "done",
    title: `${plural(result.created)} scheduled`,
    text: "You'll find them in the queue and on the calendar.",
  };
}
