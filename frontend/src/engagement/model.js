/** Plain rules for the post drawer and inbox. No React, no network, no made-up numbers. */

export const INSIGHTS_WAIT_MS = 3 * 60 * 60 * 1000;
export const REFRESH_MIN_MS = 15 * 60 * 1000;
export const NETWORK_MEMORY_KEY = "socialcastly_comment_network";

export const INSIGHT_METRICS = [
  ["likes", "Likes"],
  ["views", "Views"],
  ["reach", "Reach"],
  ["shares", "Shares"],
  ["saves", "Saves"],
];

/** ✓ in the spec table. A false cell is "Not available for this network", never 0. */
const METRIC_AVAILABLE = {
  instagram: { likes: true, views: true, reach: true, shares: true, saves: true },
  facebook: { likes: true, views: true, reach: true, shares: true, saves: false },
  threads: { likes: true, views: true, reach: false, shares: true, saves: false },
  youtube: { likes: true, views: true, reach: false, shares: true, saves: false },
  tiktok: { likes: true, views: true, reach: false, shares: true, saves: false },
  pinterest: { likes: true, views: true, reach: false, shares: false, saves: true },
};

const NAMES = {
  instagram: "Instagram",
  facebook: "Facebook Page",
  threads: "Threads",
  youtube: "YouTube",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  x: "X",
  linkedin: "LinkedIn",
};

const RULES = {
  instagram: { reply: true, hide: true, delete: true },
  facebook: { reply: true, hide: true, delete: true },
  threads: { reply: true, hide: true, deleteOwn: true },
  youtube: { reply: true, remove: true },
  x: { reply: true, hide: true, deleteOwn: true },
};

const CAPABILITY_NOTES = {
  instagram: "On Instagram you can reply to, hide and delete comments.",
  facebook: "On Facebook Pages you can reply to, hide and delete comments.",
  threads: "On Threads you can reply to and hide replies.",
  youtube: "On YouTube you can reply to and remove comments.",
  x: "On X you can reply to, hide and delete comments.",
};

export const INBOX_NETWORKS = ["instagram", "facebook", "threads", "youtube"];
export const INBOX_LATER = ["x", "linkedin", "tiktok", "pinterest"];

export const COPY = {
  metricUnavailable: "Not available for this network",
  insightsEmptyTitle: "No insights yet, check back in a few hours",
  insightsNotOut: "Insights appear after this post goes out.",
  insightsErrorTitle: "We couldn't load insights right now",
  insightsErrorBody: "This is not your fault. Please try again later.",
  insightsFooter: "Each network counts these numbers in its own way, so they aren't added together.",
  commentsX: "Comments from X aren't available in SocialCastly yet.",
  insightsX: "Insights from X aren't available in SocialCastly yet.",
  linkedIn: "Comments and insights from LinkedIn aren't available yet.",
  tiktokTotalsTitle: "This post on TikTok",
  tiktokTotalsBody: "TikTok only shares totals, not the comments themselves.",
  tiktokLink: "Open in TikTok to read and reply",
  pinterestTitle: "Pinterest doesn't share comments with other apps",
  pinterestLink: "Open in Pinterest",
  repliesUnsupported: "Replies aren't supported for this network.",
  hiddenBody: "Hidden from everyone except you and the commenter.",
  actionFailed: "We couldn't send your reply. This is not your fault, please try again later.",
  deleteTitle: "Delete this comment?",
  deleteButton: "Delete comment",
  removeTitle: "Remove this comment?",
  removeBody: "It will be hidden from your video for good, along with its replies. This can't be undone.",
  removeButton: "Remove comment",
  inboxTitle: "Inbox",
  inboxSub: "Comments from all your channels in one place.",
  inboxSubMobile: "Comments from all your channels.",
  inboxEmptyTitle: "You're all caught up",
  inboxEmptyAll: "New comments from your channels will show up here.",
  inboxEmptyFilter:
    "No unread comments right now. New comments from your channels will show up here.",
  inboxErrorTitle: "We couldn't load your comments",
  inboxErrorBody: "This is not your fault. Please try again later.",
  inboxLater: "Comments not available yet",
  showAll: "Show all comments",
  tryAgain: "Try again",
  you: "You",
  hidden: "Hidden",
  replied: "Replied",
};

const BANNED =
  /\b(credits?|apis?|permissions?|scopes?|tokens?|webhooks?|rate limits?|app review)\b/i;

export function containsBannedWord(text) {
  return BANNED.test(String(text || ""));
}

export function canonicalNetwork(network) {
  const key = String(network || "")
    .trim()
    .toLowerCase();
  return key === "twitter" ? "x" : key;
}

export function readXEnabled(env = {}) {
  const raw = env.VITE_ENGAGEMENT_X_ENABLED ?? env.ENGAGEMENT_X_ENABLED ?? "";
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

export function networkName(network) {
  const key = canonicalNetwork(network);
  if (NAMES[key]) return NAMES[key];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "this network";
}

/** "View on Facebook", not "View on Facebook Page". */
export function viewOnName(network) {
  return canonicalNetwork(network) === "facebook" ? "Facebook" : networkName(network);
}

export function formatCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-US").format(value);
}

export function countBadge(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return n > 99 ? "99+" : String(n);
}

export function longAge(date, now = new Date()) {
  const ms = new Date(now).getTime() - new Date(date).getTime();
  if (!Number.isFinite(ms) || ms < 60 * 1000) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

export function compactAge(date, now = new Date()) {
  const ms = new Date(now).getTime() - new Date(date).getTime();
  if (!Number.isFinite(ms) || ms < 60000) return "now";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export function publishedLabel(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `Published ${day} · ${time}`;
}

export function insightsEmptyBody(publishedAt, now = new Date()) {
  return `This post went out ${longAge(publishedAt, now)}. Networks take a little while to share likes, views and reach.`;
}

export function failedInsightCopy(network) {
  return `This post didn't go out on ${networkName(network)}, so there are no insights.`;
}

export function noCommentsCopy(network) {
  return `No comments on ${networkName(network)} yet.`;
}

export function pinCommentsCopy(count) {
  if (typeof count !== "number" || !Number.isFinite(count)) return "";
  const noun = count === 1 ? "comment" : "comments";
  return `This Pin has ${formatCount(count)} ${noun}.`;
}

export function composerHint(network) {
  return `Posts a new comment on ${networkName(network)}.`;
}

export function composerPlaceholder(accountName) {
  return `Write a comment as ${accountName || "your account"}…`;
}

export function replyHint(handle, network) {
  const who = atHandle(handle) || "this comment";
  return `Replying to ${who} on ${networkName(network)}`;
}

export function replyPostedToast(network) {
  return `Reply posted on ${networkName(network)}`;
}

export function capabilityNote(network, xEnabled = false) {
  const key = canonicalNetwork(network);
  if (key === "x" && !xEnabled) return "";
  return CAPABILITY_NOTES[key] || "";
}

export function commentsMode(network, xEnabled = false) {
  const key = canonicalNetwork(network);
  if (key === "x") return xEnabled ? "list" : "muted";
  if (key === "linkedin") return "muted";
  if (key === "tiktok") return "totals";
  if (key === "pinterest") return "pin";
  if (RULES[key]) return "list";
  return "muted";
}

export function insightsMode(network, xEnabled = false) {
  const key = canonicalNetwork(network);
  if (key === "x") return xEnabled ? "metrics" : "muted";
  if (key === "linkedin") return "muted";
  if (METRIC_AVAILABLE[key]) return "metrics";
  return "muted";
}

export function mutedCommentCopy(network) {
  const key = canonicalNetwork(network);
  if (key === "linkedin") return COPY.linkedIn;
  if (key === "x") return COPY.commentsX;
  return `Comments from ${networkName(key)} aren't available in SocialCastly yet.`;
}

export function mutedInsightCopy(network) {
  const key = canonicalNetwork(network);
  if (key === "linkedin") return COPY.linkedIn;
  if (key === "x") return COPY.insightsX;
  return `Insights from ${networkName(key)} aren't available in SocialCastly yet.`;
}

export function showComposer(network, xEnabled = false) {
  if (commentsMode(network, xEnabled) !== "list") return false;
  return !!RULES[canonicalNetwork(network)]?.reply;
}

export function showRepliesUnsupported(network, xEnabled = false) {
  return commentsMode(network, xEnabled) === "list" && !showComposer(network, xEnabled);
}

export function commentActions(network, comment, xEnabled = false) {
  if (!comment || comment.deleted) return [];
  if (commentsMode(network, xEnabled) !== "list") return [];
  const rule = RULES[canonicalNetwork(network)];
  if (!rule) return [];
  const own = !!comment.own;
  if (comment.hidden) {
    const acts = [];
    if (rule.hide) acts.push("unhide");
    if (rule.delete || (rule.deleteOwn && own)) acts.push("delete");
    else if (rule.remove) acts.push("remove");
    return acts;
  }
  if (own) {
    if (rule.delete || rule.deleteOwn) return ["delete"];
    if (rule.remove) return ["remove"];
    return [];
  }
  const acts = [];
  if (rule.reply) acts.push("reply");
  if (rule.hide) acts.push("hide");
  if (rule.delete) acts.push("delete");
  if (rule.remove) acts.push("remove");
  return acts;
}

export function deleteConfirmCopy(comment, network) {
  if (canonicalNetwork(network) === "youtube") {
    return {
      title: COPY.removeTitle,
      body: COPY.removeBody,
      confirm: COPY.removeButton,
      tone: "remove",
    };
  }
  const quote = String(comment?.text || "").trim();
  return {
    title: COPY.deleteTitle,
    body: `"${quote}" will be removed from ${networkName(network)} for everyone. This can't be undone.`,
    confirm: COPY.deleteButton,
    tone: "delete",
  };
}

export function atHandle(value) {
  const raw = String(value || "")
    .replace(/^@/, "")
    .trim();
  return raw ? `@${raw}` : "";
}

export function displayName(account) {
  if (!account) return "";
  const raw = String(account.display_name || account.account_name || "").trim();
  return raw.replace(/\s*\(@[^)]*\)\s*$/, "").trim();
}

export function displayHandle(account) {
  if (!account) return "";
  const meta = account.extra_metadata || {};
  const explicit = account.username || meta.username || meta.screen_name || meta.handle || "";
  const fromName = /\(@([^)]+)\)\s*$/.exec(String(account.account_name || ""));
  return atHandle(explicit || fromName?.[1] || "");
}

export function reconnectBanner(network, handle) {
  const name = networkName(network);
  const who = atHandle(handle) || "this account";
  return {
    title: `Reconnect ${name} to see comments`,
    body: `${name} disconnected from SocialCastly, so new comments from ${who} aren't coming in.`,
    button: "Reconnect",
  };
}

export function turnOnBanner(network) {
  const name = networkName(network);
  return {
    title: `Turn on comments for ${name}`,
    body: `${name} is connected for posting, but comments weren't turned on. Reconnect ${name} and allow comments.`,
    button: `Reconnect ${name}`,
  };
}

export function accountAccess(account, capability) {
  if (account?.needs_reconnect || capability?.needs_reconnect) return "needs_reconnect";
  if (capability?.reconnect_for_permissions) return "comments_not_enabled";
  if (
    capability &&
    capability.supports_comments_read &&
    capability.can_read_comments === false &&
    capability.is_active !== false
  ) {
    return "comments_not_enabled";
  }
  return "ok";
}

export function samePostGroup(a, b) {
  if (!a || !b) return false;
  if (a.id && a.id === b.id) return true;
  const aTime = new Date(a.scheduled_at || a.published_at || 0).getTime();
  const bTime = new Date(b.scheduled_at || b.published_at || 0).getTime();
  if (!aTime || !bTime || aTime !== bTime) return false;
  if ((a.content || "") !== (b.content || "")) return false;
  return JSON.stringify(a.media_urls || []) === JSON.stringify(b.media_urls || []);
}

export function buildTargets(post, posts, accounts) {
  if (!post) return [];
  const pool = Array.isArray(posts) && posts.length ? posts : [post];
  const group = pool.filter((item) => samePostGroup(post, item));
  const rows = group.length ? group : [post];
  return rows
    .map((item) => {
      const account = (accounts || []).find((entry) => entry.id === item.connected_account_id) || null;
      const network = canonicalNetwork(account?.platform || item.platform || item.preview_platform);
      if (!network) return null;
      return {
        key: String(item.id),
        post: item,
        account,
        network,
        status: item.status || "",
        failed: item.status === "failed",
        name: displayName(account) || networkName(network),
        handle: displayHandle(account),
      };
    })
    .filter(Boolean);
}

export function externalUrl(network, providerPostId) {
  const id = String(providerPostId || "").trim();
  const enc = encodeURIComponent(id);
  switch (canonicalNetwork(network)) {
    case "instagram":
      return id ? `https://www.instagram.com/p/${enc}/` : "https://www.instagram.com/";
    case "facebook":
      return id ? `https://www.facebook.com/${enc}` : "https://www.facebook.com/";
    case "threads":
      return id ? `https://www.threads.net/post/${enc}` : "https://www.threads.net/";
    case "tiktok":
      return "https://www.tiktok.com/";
    case "pinterest":
      return id ? `https://www.pinterest.com/pin/${enc}/` : "https://www.pinterest.com/";
    case "youtube":
      return id ? `https://www.youtube.com/watch?v=${enc}` : "https://www.youtube.com/";
    case "x":
      return id ? `https://x.com/i/web/status/${enc}` : "https://x.com/";
    case "linkedin":
      return "https://www.linkedin.com/";
    default:
      return "";
  }
}

export function externalHref(target) {
  const post = target?.post || {};
  const meta = post.post_metadata || post.metadata || {};
  const explicit = meta.permalink || meta.url || post.permalink || "";
  if (explicit) return String(explicit);
  return externalUrl(target?.network, post.provider_post_id);
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function metricsFromSnapshot(network, snapshot) {
  const empty = { likes: null, views: null, reach: null, shares: null, saves: null, comments: null };
  if (!snapshot) return empty;
  const key = canonicalNetwork(network);
  const views =
    key === "youtube" || key === "tiktok"
      ? numberOrNull(snapshot.video_views ?? snapshot.impressions)
      : numberOrNull(snapshot.impressions ?? snapshot.video_views);
  return {
    likes: numberOrNull(snapshot.likes),
    views,
    reach: numberOrNull(snapshot.reach),
    shares: numberOrNull(snapshot.shares),
    saves: numberOrNull(snapshot.saves),
    comments: numberOrNull(snapshot.comments),
  };
}

export function displayMetric(network, key, value) {
  const available = METRIC_AVAILABLE[canonicalNetwork(network)]?.[key];
  if (!available) return { kind: "unavailable", text: COPY.metricUnavailable };
  if (typeof value !== "number") return { kind: "empty", text: "—" };
  return { kind: "value", text: formatCount(value) };
}

function hasReportedMetrics(network, metrics) {
  const table = METRIC_AVAILABLE[canonicalNetwork(network)];
  if (!table || !metrics) return false;
  return Object.keys(table).some((key) => table[key] && typeof metrics[key] === "number");
}

export function latestSnapshot(payload) {
  if (!payload || typeof payload !== "object") return null;
  return payload.latest || (Array.isArray(payload.history) ? payload.history[0] : null) || null;
}

export function commentsTabEnabled(targets) {
  return (targets || []).some((target) => target.status === "published");
}

export function buildInsightView({
  targets,
  snapshotsByPost,
  publishedAt,
  now = new Date(),
  xEnabled = false,
  error = false,
}) {
  if (error) {
    return { kind: "error", title: COPY.insightsErrorTitle, body: COPY.insightsErrorBody };
  }
  const list = targets || [];
  const notOut = list.length > 0 && list.every((target) => !["published", "failed"].includes(target.status));
  if (notOut) return { kind: "not-out", message: COPY.insightsNotOut };

  const cards = list.map((target) => {
    if (target.failed || target.status === "failed") {
      return { kind: "failed", target, message: failedInsightCopy(target.network) };
    }
    if (insightsMode(target.network, xEnabled) === "muted") {
      return { kind: "muted", target, message: mutedInsightCopy(target.network) };
    }
    const snap = snapshotsByPost?.[target.key] || null;
    return {
      kind: "metrics",
      target,
      metrics: metricsFromSnapshot(target.network, snap),
      capturedAt: snap?.captured_at || snap?.capturedAt || null,
    };
  });
  const published = list.filter((target) => target.status === "published");
  const waiting =
    published.length > 0 &&
    published.every((target) => {
      const card = cards.find((item) => item.target.key === target.key);
      return card?.kind === "metrics" && !hasReportedMetrics(target.network, card.metrics);
    });
  const young =
    publishedAt && new Date(now).getTime() - new Date(publishedAt).getTime() < INSIGHTS_WAIT_MS;
  const anyFailed = list.some((target) => target.status === "failed");
  if (waiting && young && !anyFailed) {
    return {
      kind: "empty",
      title: COPY.insightsEmptyTitle,
      body: insightsEmptyBody(publishedAt, now),
    };
  }
  const ordered = [
    ...cards.filter((card) => card.kind !== "muted"),
    ...cards.filter((card) => card.kind === "muted"),
  ];
  const times = ordered.map((card) => card.capturedAt).filter(Boolean);
  const capturedAt = times.sort((a, b) => new Date(a) - new Date(b)).at(-1) || null;
  return { kind: "cards", cards: ordered, capturedAt, footer: COPY.insightsFooter };
}

export function refreshAllowed(capturedAt, now = Date.now()) {
  if (!capturedAt) return true;
  const then = new Date(capturedAt).getTime();
  if (!Number.isFinite(then)) return true;
  return now - then >= REFRESH_MIN_MS;
}

export function normalizeComment(row, network) {
  if (!row || typeof row !== "object") return null;
  const handle = atHandle(row.author_handle || row.handle || "");
  const replies = Array.isArray(row.replies)
    ? row.replies.map((item) => normalizeComment(item, row.network || network)).filter(Boolean)
    : [];
  return {
    id: String(row.id),
    postId: String(row.post_id || row.postId || ""),
    network: canonicalNetwork(row.network || network),
    authorName: row.author_name || row.authorName || "Someone",
    handle,
    avatarUrl: row.author_avatar_url || row.avatarUrl || "",
    text: row.text || "",
    createdAt: row.created_at_provider || row.createdAt || row.fetched_at || null,
    likes: numberOrNull(row.like_count ?? row.likes),
    hidden: !!(row.is_hidden ?? row.hidden),
    own: !!(row.is_own ?? row.own),
    deleted: !!(row.is_deleted ?? row.deleted),
    read: !!(row.is_read ?? row.read),
    replied: !!row.replied,
    replies,
  };
}

export function normalizeThread(payload, network) {
  const rows = Array.isArray(payload) ? payload : payload?.comments || [];
  return rows.map((row) => normalizeComment(row, network)).filter(Boolean);
}

function handleOf(node) {
  if (!node) return "";
  return node.handle || node.authorName || "";
}

/** One reply level. Deeper replies are flattened, with "Replying to @x" when needed. */
export function presentThread(comments) {
  return (comments || [])
    .filter((comment) => !comment.deleted)
    .map((root) => ({ ...root, replies: flattenReplies(root) }));
}

function flattenReplies(root) {
  const out = [];
  function walk(node, depth) {
    for (const child of node.replies || []) {
      if (!child.deleted) {
        out.push({
          ...child,
          replies: [],
          replyingTo: depth >= 1 ? handleOf(node) : "",
        });
      }
      walk(child, depth + 1);
    }
  }
  walk(root, 0);
  return out;
}

export function commentCount(list) {
  let n = 0;
  function walk(items) {
    for (const item of items || []) {
      if (item.deleted) continue;
      n += 1;
      walk(item.replies);
    }
  }
  walk(list);
  return n;
}

export function unreadCount(list) {
  let n = 0;
  function walk(items) {
    for (const item of items || []) {
      if (item.deleted) continue;
      if (!item.read && !item.own) n += 1;
      walk(item.replies);
    }
  }
  walk(list);
  return n;
}

export function sortRoots(comments, order = "newest") {
  const rows = presentThread(comments);
  rows.sort((a, b) => {
    const left = new Date(a.createdAt).getTime() || 0;
    const right = new Date(b.createdAt).getTime() || 0;
    return order === "oldest" ? left - right : right - left;
  });
  return rows;
}

export function pickCommentTarget(targets, threadsByPost, remembered) {
  const list = targets || [];
  if (remembered && list.some((target) => target.key === remembered)) return remembered;
  let best = list[0]?.key || "";
  let bestCount = -1;
  for (const target of list) {
    if (commentsMode(target.network) !== "list") continue;
    const count = unreadCount(threadsByPost?.[target.key]);
    if (count > bestCount) {
      bestCount = count;
      best = target.key;
    }
  }
  return best;
}

export function chipCount(target, threadsByPost, snapshotsByPost, xEnabled = false) {
  const mode = commentsMode(target.network, xEnabled);
  if (mode === "muted") return null;
  if (mode === "list") return commentCount(threadsByPost?.[target.key]);
  const snap = snapshotsByPost?.[target.key];
  const metrics = metricsFromSnapshot(target.network, snap);
  return metrics.comments;
}

export function tabCommentCount(targets, threadsByPost, snapshotsByPost, xEnabled = false) {
  return (targets || []).reduce((sum, target) => {
    const count = chipCount(target, threadsByPost, snapshotsByPost, xEnabled);
    return sum + (typeof count === "number" ? count : 0);
  }, 0);
}

export function mapComment(list, id, fn) {
  return (list || []).map((item) => {
    const next = item.id === id ? fn(item) : item;
    if (next.replies?.length) return { ...next, replies: mapComment(next.replies, id, fn) };
    return next;
  });
}

export function staticCopyList() {
  return Object.values(COPY);
}

export function inboxNetworkOptions(connectedPlatforms, xEnabled = false) {
  const have = new Set((connectedPlatforms || []).map(canonicalNetwork));
  const available = INBOX_NETWORKS.filter((network) => have.has(network));
  if (xEnabled && have.has("x") && !available.includes("x")) available.push("x");
  const later = INBOX_LATER.filter((network) => have.has(network) && !(network === "x" && xEnabled));
  return { available, later };
}
