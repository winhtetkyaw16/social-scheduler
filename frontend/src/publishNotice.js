import { readableDetail } from "./requestErrors.js";

export function publishNotice(mode, posts, failures, rejected) {
  const parts = [];
  const published = posts.filter((post) => post.status === "published").length;
  const stopped = posts.filter((post) => ["cancelled", "archived"].includes(post.status)).length;
  const pending = posts.length - published - failures.length - stopped;
  if (published) parts.push(`${published} published.`);
  if (pending) parts.push(`${pending} ${mode === "schedule" ? "scheduled" : "queued"}.`);
  if (stopped) parts.push(`${stopped} cancelled or archived.`);
  if (failures.length) {
    parts.push(`${failures.length} failed.`);
    const first = failures[0];
    if (first?.banner) parts.push(first.banner);
    parts.push(first?.what_to_do || "Open the failed post in Publish for details.");
  }
  if (rejected.length) {
    const declined = rejected.filter(({ status }) => status >= 400 && status < 500 && status !== 408);
    const unconfirmed = rejected.filter((result) => !declined.includes(result));
    for (const group of [declined, unconfirmed]) {
      if (!group.length) continue;
      const { account, message } = group[0];
      const label = account.account_name || account.platform;
      const others = group.length > 1 ? ` and ${group.length - 1} more` : "";
      parts.push(group === declined ? `Couldn't submit to ${label}${others}.` : `Submission unconfirmed for ${label}${others}.`);
      const detail = readableDetail(message);
      if (detail) parts.push(detail);
    }
    if (unconfirmed.length) parts.push("Check Publish before submitting again.");
  }
  if (rejected.length || failures.length || stopped) {
    return {
      title: published || pending ? "Some posts need attention" : "Post needs attention",
      message: parts.join(" "),
      kind: "error",
    };
  }
  const title = mode === "queue" ? "Added to queue" : mode === "schedule" ? "Post scheduled" : pending ? "Publishing in progress" : "Published";
  return { title, message: parts.join(" "), kind: "success" };
}
