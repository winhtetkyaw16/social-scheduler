import test from "node:test";
import assert from "node:assert/strict";
import {
  COPY,
  commentedLine,
  commentCountLabel,
  emptyInboxCopy,
  emptyPostsCopy,
  inboxBanners,
  inboxPane,
  viewportTier,
  visibleFeed,
  buildInsightView,
  buildTargets,
  capabilityNote,
  chipCount,
  commentActions,
  commentsMode,
  commentsPresentation,
  commentsTabEnabled,
  compactAge,
  composerHint,
  containsBannedWord,
  countBadge,
  deleteConfirmCopy,
  displayMetric,
  insightsEmptyBody,
  longAge,
  mapComment,
  metricsFromSnapshot,
  mutedCommentCopy,
  mutedInsightCopy,
  networkName,
  noCommentsCopy,
  normalizeThread,
  pickCommentTarget,
  pinCommentsCopy,
  presentThread,
  publishedLabel,
  shortDay,
  readXEnabled,
  reconnectBanner,
  refreshAllowed,
  replyHint,
  replyPostedToast,
  showComposer,
  sortRoots,
  staticCopyList,
  tabCommentCount,
  turnOnBanner,
  unreadCount,
  viewOnName,
  accountAccess,
  inboxNetworkOptions,
  inboxViewChoice,
  normalizeInboxPost,
  postCaption,
  readInboxView,
  writeInboxView,
  INBOX_VIEW_KEY,
} from "./engagement/model.js";
import { createEngagementClient } from "./api/engagement.js";

const NOW = new Date("2026-11-10T11:00:00Z");

test("network names and the X flag default off", () => {
  assert.equal(networkName("facebook"), "Facebook Page");
  assert.equal(networkName("twitter"), "X");
  assert.equal(viewOnName("facebook"), "Facebook");
  assert.equal(readXEnabled({}), false);
  assert.equal(readXEnabled({ ENGAGEMENT_X_ENABLED: "false" }), false);
  assert.equal(readXEnabled({ VITE_ENGAGEMENT_X_ENABLED: "true" }), true);
  assert.equal(commentsMode("x"), "muted");
  assert.equal(commentsMode("x", true), "list");
  assert.equal(mutedCommentCopy("x"), COPY.commentsX);
  assert.equal(mutedInsightCopy("x"), COPY.insightsX);
  assert.equal(mutedCommentCopy("linkedin"), COPY.linkedIn);
  assert.equal(mutedInsightCopy("linkedin"), COPY.linkedIn);
});

test("user-facing copy never mentions credits, APIs, permissions, or scopes", () => {
  for (const line of staticCopyList()) assert.equal(containsBannedWord(line), false, line);
  for (const network of ["instagram", "facebook", "threads", "youtube", "x", "linkedin", "tiktok"]) {
    assert.equal(containsBannedWord(mutedCommentCopy(network)), false);
    assert.equal(containsBannedWord(mutedInsightCopy(network)), false);
    assert.equal(containsBannedWord(reconnectBanner(network, "@northwind.sample").body), false);
    assert.equal(containsBannedWord(turnOnBanner(network).body), false);
    assert.equal(containsBannedWord(capabilityNote(network, true)), false);
  }
  assert.equal(containsBannedWord("needs API credits and the scope"), true);
});

test("insight metrics use the spec table and never invent a zero", () => {
  const ig = metricsFromSnapshot("instagram", {
    impressions: 28410,
    reach: 19880,
    likes: 1204,
    shares: 86,
    saves: 312,
  });
  assert.equal(displayMetric("instagram", "views", ig.views).text, "28,410");
  assert.equal(displayMetric("instagram", "likes", ig.likes).text, "1,204");
  assert.equal(displayMetric("facebook", "saves", null).text, COPY.metricUnavailable);
  assert.equal(displayMetric("facebook", "shares", null).text, "—");
  assert.equal(displayMetric("threads", "reach", null).kind, "unavailable");
  assert.equal(displayMetric("pinterest", "shares", null).kind, "unavailable");
  assert.equal(displayMetric("pinterest", "saves", 126).text, "126");
  const yt = metricsFromSnapshot("youtube", { video_views: 1148, likes: 65, shares: null });
  assert.equal(yt.views, 1148);
  assert.equal(displayMetric("youtube", "shares", yt.shares).text, "—");
  assert.equal(displayMetric("tiktok", "views", 0).text, "0");
});

test("a brand-new post with no numbers uses the empty insights state", () => {
  const targets = [
    { key: "p1", network: "instagram", status: "published", failed: false, name: "Northwind" },
  ];
  const empty = buildInsightView({
    targets,
    snapshotsByPost: {},
    publishedAt: new Date(NOW.getTime() - 20 * 60 * 1000),
    now: NOW,
  });
  assert.equal(empty.kind, "empty");
  assert.equal(empty.title, COPY.insightsEmptyTitle);
  assert.match(empty.body, /20 minutes ago/);
  assert.equal(insightsEmptyBody(new Date(NOW.getTime() - 20 * 60 * 1000), NOW).includes("20 minutes"), true);

  const later = buildInsightView({
    targets,
    snapshotsByPost: {},
    publishedAt: new Date(NOW.getTime() - 5 * 60 * 60 * 1000),
    now: NOW,
  });
  assert.equal(later.kind, "cards");
  assert.equal(later.cards[0].kind, "metrics");

  const scheduled = buildInsightView({
    targets: [{ key: "p1", network: "instagram", status: "scheduled", failed: false }],
    snapshotsByPost: {},
    now: NOW,
  });
  assert.equal(scheduled.kind, "not-out");
  assert.equal(scheduled.message, COPY.insightsNotOut);
  assert.equal(commentsTabEnabled(scheduled && [{ status: "scheduled" }]), false);
  assert.equal(commentsTabEnabled(targets), true);
});

test("X and LinkedIn insight rows sit after networks that have data", () => {
  const targets = [
    { key: "x", network: "x", status: "published", failed: false },
    { key: "ig", network: "instagram", status: "published", failed: false },
    { key: "li", network: "linkedin", status: "published", failed: false },
  ];
  const view = buildInsightView({
    targets,
    snapshotsByPost: { ig: { likes: 4, impressions: 10, captured_at: "2026-11-10T09:00:00Z" } },
    publishedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    now: NOW,
  });
  assert.deepEqual(
    view.cards.map((card) => card.target.network),
    ["instagram", "x", "linkedin"],
  );
  assert.equal(view.cards[1].message, COPY.insightsX);
  assert.equal(view.cards[2].message, COPY.linkedIn);
  const failed = buildInsightView({
    targets: [{ key: "x", network: "x", status: "failed", failed: true }],
    snapshotsByPost: {},
    publishedAt: NOW,
    now: NOW,
  });
  assert.equal(failed.cards[0].kind, "failed");
  assert.match(failed.cards[0].message, /didn't go out on X/);
});

test("refresh waits 15 minutes and ages are compact on comments", () => {
  assert.equal(refreshAllowed(null, NOW.getTime()), true);
  assert.equal(refreshAllowed(new Date(NOW.getTime() - 2 * 60 * 1000), NOW.getTime()), false);
  assert.equal(refreshAllowed(new Date(NOW.getTime() - 2 * 60 * 60 * 1000), NOW.getTime()), true);
  assert.equal(longAge(new Date(NOW.getTime() - 2 * 60 * 60 * 1000), NOW), "2 hours ago");
  assert.equal(compactAge(new Date(NOW.getTime() - 3 * 60 * 60 * 1000), NOW), "3h");
  assert.equal(compactAge(new Date(NOW.getTime() - 26 * 60 * 60 * 1000), NOW), "1d");
  assert.match(publishedLabel("2026-11-10T09:00:00Z"), /^Published /);
});

test("comment actions follow the network and there is no Like button", () => {
  const other = { own: false, hidden: false, deleted: false, text: "Hi" };
  const own = { ...other, own: true };
  const hidden = { ...other, hidden: true, text: "spam" };
  assert.deepEqual(commentActions("instagram", other), ["reply", "hide", "delete"]);
  assert.deepEqual(commentActions("instagram", own), ["delete"]);
  assert.deepEqual(commentActions("instagram", hidden), ["unhide", "delete"]);
  assert.deepEqual(commentActions("facebook", other), ["reply", "hide", "delete"]);
  assert.deepEqual(commentActions("threads", other), ["reply", "hide"]);
  assert.deepEqual(commentActions("threads", own), ["delete"]);
  assert.deepEqual(commentActions("youtube", other), ["reply", "remove"]);
  assert.deepEqual(commentActions("youtube", own), ["remove"]);
  assert.deepEqual(commentActions("tiktok", other), []);
  assert.deepEqual(commentActions("pinterest", other), []);
  assert.deepEqual(commentActions("x", other), []);
  assert.deepEqual(commentActions("x", other, true), ["reply", "hide"]);
  assert.deepEqual(commentActions("linkedin", other), []);
  for (const network of ["instagram", "facebook", "threads", "youtube", "x"]) {
    assert.equal(commentActions(network, other, true).includes("like"), false);
  }
  assert.equal(showComposer("instagram"), true);
  assert.equal(showComposer("tiktok"), false);
  assert.equal(showComposer("x"), false);
  assert.equal(showComposer("youtube"), true);
  assert.equal(capabilityNote("facebook"), "On Facebook Pages you can reply to, hide and delete comments.");
  assert.equal(noCommentsCopy("instagram"), "No comments on Instagram yet.");
  assert.equal(pinCommentsCopy(2), "This Pin has 2 comments.");
  assert.equal(pinCommentsCopy(null), "");
  assert.equal(composerHint("instagram"), "Posts a new comment on Instagram.");
  assert.equal(replyHint("dan.sample", "instagram"), "Replying to @dan.sample on Instagram");
  assert.equal(replyPostedToast("instagram"), "Reply posted on Instagram");
});

test("each network's comments tab uses the spec copy and hides the list when it must", () => {
  const x = commentsPresentation({ network: "x" });
  assert.equal(x.kind, "muted");
  assert.equal(x.message, "Comments from X aren't available in SocialCastly yet.");
  assert.equal(x.link, "Open on X");
  assert.equal(x.composer, false);
  const xOn = commentsPresentation({ network: "x", xEnabled: true, access: "ok" });
  assert.equal(xOn.kind, "list");
  const linkedin = commentsPresentation({ network: "linkedin" });
  assert.equal(linkedin.message, "Comments and insights from LinkedIn aren't available yet.");
  assert.equal(linkedin.link, "Open on LinkedIn");
  const tiktok = commentsPresentation({ network: "tiktok" });
  assert.equal(tiktok.kind, "totals");
  assert.equal(tiktok.title, "This post on TikTok");
  assert.equal(tiktok.body, "TikTok only shares totals, not the comments themselves.");
  assert.equal(tiktok.link, "Open in TikTok to read and reply");
  assert.equal(tiktok.composer, false);
  const pin = commentsPresentation({ network: "pinterest", metrics: { comments: 2 } });
  assert.equal(pin.kind, "pin");
  assert.equal(pin.title, "Pinterest doesn't share comments with other apps");
  assert.equal(pin.body, "This Pin has 2 comments.");
  assert.equal(pin.link, "Open in Pinterest");
  const threads = commentsPresentation({ network: "threads", access: "comments_not_enabled" });
  assert.equal(threads.banner.title, "Turn on comments for Threads");
  assert.equal(threads.banner.button, "Reconnect Threads");
  assert.match(threads.banner.body, /comments weren't turned on/);
  assert.equal(threads.composer, false);
  const ig = commentsPresentation({ network: "instagram", access: "needs_reconnect" });
  assert.equal(ig.banner.title, "Reconnect Instagram to see comments");
  assert.equal(ig.banner.button, "Reconnect");
  const open = commentsPresentation({ network: "instagram" });
  assert.equal(open.kind, "list");
  assert.equal(open.composer, true);
  assert.equal(open.empty, "No comments on Instagram yet.");
  assert.equal(open.banner, null);
  for (const state of [x, linkedin, tiktok, pin, threads, ig, open]) {
    for (const value of Object.values(state)) {
      if (typeof value === "string") assert.equal(containsBannedWord(value), false, value);
      if (value && typeof value === "object") {
        for (const nested of Object.values(value)) {
          if (typeof nested === "string") assert.equal(containsBannedWord(nested), false, nested);
        }
      }
    }
  }
});

test("delete confirm quotes the comment and YouTube Remove is its own dialog", () => {
  const comment = { text: "Get 10k followers fast, DM me" };
  const removed = deleteConfirmCopy(comment, "instagram");
  assert.equal(removed.title, "Delete this comment?");
  assert.match(removed.body, /Get 10k followers fast, DM me/);
  assert.match(removed.body, /removed from Instagram/);
  assert.equal(removed.confirm, "Delete comment");
  const youtube = deleteConfirmCopy(comment, "youtube");
  assert.equal(youtube.title, COPY.removeTitle);
  assert.equal(youtube.body, COPY.removeBody);
  assert.equal(youtube.confirm, COPY.removeButton);
  assert.equal(containsBannedWord(youtube.body), false);
});

test("replies flatten to one level and the busiest unread network is the default", () => {
  const thread = normalizeThread({
    comments: [
      {
        id: "a",
        text: "Root",
        author_handle: "maya",
        is_read: false,
        replies: [
          {
            id: "b",
            text: "Child",
            author_handle: "cafe",
            is_own: true,
            is_read: true,
            replies: [{ id: "c", text: "Deep", author_handle: "maya", is_read: false }],
          },
        ],
      },
    ],
  });
  const shown = presentThread(thread);
  assert.equal(shown[0].replies.length, 2);
  assert.equal(shown[0].replies[0].replyingTo, "");
  assert.equal(shown[0].replies[1].replyingTo, "@cafe");
  assert.equal(unreadCount(thread), 2);
  const sorted = sortRoots(
    [
      { id: "old", text: "Old", createdAt: "2026-11-10T08:00:00Z", replies: [] },
      { id: "new", text: "New", createdAt: "2026-11-10T10:00:00Z", replies: [] },
    ],
    "newest",
  );
  assert.equal(sorted[0].id, "new");
  const targets = [
    { key: "ig", network: "instagram" },
    { key: "fb", network: "facebook" },
    { key: "x", network: "x" },
  ];
  const threads = {
    ig: [{ id: "1", read: true, own: false, deleted: false, replies: [] }],
    fb: [
      { id: "2", read: false, own: false, deleted: false, replies: [] },
      { id: "3", read: false, own: false, deleted: false, replies: [] },
    ],
  };
  assert.equal(pickCommentTarget(targets, threads, ""), "fb");
  assert.equal(pickCommentTarget(targets, threads, "ig"), "ig");
  assert.equal(chipCount(targets[2], threads, {}, false), null);
  assert.equal(tabCommentCount(targets, threads, {}, false), 3);
  const hidden = mapComment(thread, "a", (item) => ({ ...item, hidden: true }));
  assert.equal(hidden[0].hidden, true);
});

test("targets group sibling posts and reconnect copy names the network", () => {
  const post = {
    id: "1",
    content: "Hello",
    scheduled_at: "2026-11-10T09:00:00Z",
    media_urls: ["a"],
    connected_account_id: "acc-ig",
    status: "published",
  };
  const other = {
    ...post,
    id: "2",
    connected_account_id: "acc-fb",
  };
  const accounts = [
    { id: "acc-ig", platform: "instagram", account_name: "Northwind Café (@northwind.sample)" },
    { id: "acc-fb", platform: "facebook", account_name: "Northwind Café", needs_reconnect: true },
  ];
  const targets = buildTargets(post, [post, other], accounts);
  assert.deepEqual(
    targets.map((target) => target.network),
    ["instagram", "facebook"],
  );
  const ordered = buildTargets(
    { id: "x1", content: "Hi", scheduled_at: "2026-11-10T09:00:00Z", media_urls: [], connected_account_id: "x", status: "published" },
    [
      { id: "x1", content: "Hi", scheduled_at: "2026-11-10T09:00:00Z", media_urls: [], connected_account_id: "x", status: "published" },
      { id: "ig1", content: "Hi", scheduled_at: "2026-11-10T09:00:00Z", media_urls: [], connected_account_id: "ig", status: "published" },
      { id: "li1", content: "Hi", scheduled_at: "2026-11-10T09:00:00Z", media_urls: [], connected_account_id: "li", status: "published" },
      { id: "tt1", content: "Hi", scheduled_at: "2026-11-10T09:00:00Z", media_urls: [], connected_account_id: "tt", status: "published" },
    ],
    [
      { id: "x", platform: "x", account_name: "X" },
      { id: "ig", platform: "instagram", account_name: "IG" },
      { id: "li", platform: "linkedin", account_name: "LI" },
      { id: "tt", platform: "tiktok", account_name: "TT" },
    ],
  );
  assert.deepEqual(
    ordered.map((target) => target.network),
    ["instagram", "tiktok", "x", "linkedin"],
  );
  assert.equal(targets[0].name, "Northwind Café");
  assert.equal(targets[0].handle, "@northwind.sample");
  assert.equal(accountAccess(accounts[1], null), "needs_reconnect");
  assert.equal(
    accountAccess({ is_active: true }, { supports_comments_read: true, can_read_comments: false, reconnect_for_permissions: true }),
    "comments_not_enabled",
  );
  const banner = reconnectBanner("instagram", "@northwind.sample");
  assert.equal(banner.title, "Reconnect Instagram to see comments");
  assert.match(banner.body, /@northwind.sample/);
  assert.equal(turnOnBanner("threads").title, "Turn on comments for Threads");
  assert.equal(countBadge(0), "");
  assert.equal(countBadge(12), "12");
  assert.equal(countBadge(120), "99+");
  assert.deepEqual(inboxNetworkOptions(["instagram", "x", "tiktok", "linkedin"]), {
    available: ["instagram"],
    later: ["tiktok", "x", "linkedin"],
  });
});

test("375 and 390 are a phone inbox list until a comment is opened", () => {
  assert.equal(viewportTier(375), "phone");
  assert.equal(viewportTier(390), "phone");
  assert.equal(viewportTier(767), "phone");
  assert.equal(viewportTier(768), "tablet");
  assert.equal(viewportTier(1023), "tablet");
  assert.equal(viewportTier(1024), "desktop");
  assert.equal(viewportTier(1440), "desktop");
  assert.equal(inboxPane("phone", false), "list");
  assert.equal(inboxPane("phone", true), "detail");
  assert.equal(inboxPane("tablet", false), "list");
  assert.equal(inboxPane("tablet", true), "detail");
  assert.equal(inboxPane("desktop", true), "both");
});

test("the inbox feed keeps a kind and only shows comments", () => {
  const rows = visibleFeed([
    { id: "1", text: "Hi", network: "instagram", kind: "comment", is_read: false },
    { id: "2", text: "Mention", network: "instagram", kind: "mention" },
    { id: "3", text: "DM", network: "instagram", kind: "dm" },
    { id: "4", text: "Default", network: "threads" },
    { id: "5", text: "Yes, iced", network: "instagram", is_own: true, kind: "comment" },
  ]);
  assert.deepEqual(rows.map((row) => row.kind), ["comment", "comment"]);
  assert.equal(rows.some((row) => row.own), false);
  assert.equal(rows[0].text, "Hi");
  assert.equal(emptyInboxCopy("all").body, COPY.inboxEmptyAll);
  assert.equal(emptyInboxCopy("unread").body, COPY.inboxEmptyFilter);
  assert.equal(emptyInboxCopy("unread").action, "Show all comments");
  assert.equal(emptyInboxCopy("all", "latte").title, "No comments match your search");
  assert.equal(emptyInboxCopy("unread", "latte").action, "Clear search");
  assert.equal(emptyInboxCopy("all", "  ").title, COPY.inboxEmptyTitle);
  const line = commentedLine(
    { createdAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000), network: "instagram" },
    "@northwind.sample",
    NOW,
  );
  assert.equal(line, "Commented 3h ago on Instagram · @northwind.sample");
  assert.equal(shortDay("2026-11-10T09:00:00Z"), "Tue, Nov 10");
  assert.equal(shortDay(null), "");
  assert.equal(shortDay(undefined), "");
  assert.equal(shortDay(""), "");
  assert.equal(shortDay(0), "");
  assert.equal(shortDay(new Date(0)), "");
  assert.equal(publishedLabel(null), "");
  assert.equal(publishedLabel(0), "");
  const banners = inboxBanners([
    {
      account_id: "a",
      network: "instagram",
      needs_reconnect: true,
      account_name: "Northwind (@northwind.sample)",
      supports_comments_read: true,
    },
    {
      account_id: "b",
      network: "threads",
      reconnect_for_permissions: true,
      supports_comments_read: true,
      can_read_comments: false,
      account_name: "Northwind",
    },
    { account_id: "c", network: "tiktok", needs_reconnect: true },
  ]);
  assert.equal(banners.length, 2);
  assert.equal(banners[0].title, "Reconnect Instagram to see comments");
  assert.match(banners[0].body, /@northwind.sample/);
  assert.equal(banners[1].title, "Turn on comments for Threads");
  assert.equal(banners.some((banner) => banner.network === "tiktok"), false);
});

test("inbox posts view prefers a saved choice, otherwise unread comments", () => {
  assert.equal(inboxViewChoice({ stored: "", unread: 3 }), "comments");
  assert.equal(inboxViewChoice({ stored: "", unread: 0 }), "posts");
  assert.equal(inboxViewChoice({ stored: "posts", unread: 4 }), "posts");
  assert.equal(inboxViewChoice({ stored: "comments", unread: 0 }), "comments");
  assert.equal(inboxViewChoice({ stored: "nope", unread: 0 }), "posts");
  const storage = {
    value: "",
    getItem(key) {
      assert.equal(key, INBOX_VIEW_KEY);
      return this.value;
    },
    setItem(key, value) {
      assert.equal(key, INBOX_VIEW_KEY);
      this.value = value;
    },
  };
  assert.equal(readInboxView(storage), "");
  writeInboxView(storage, "posts");
  assert.equal(readInboxView(storage), "posts");
  writeInboxView(storage, "later");
  assert.equal(readInboxView(storage), "posts");
  assert.equal(readInboxView(null), "");
});

test("a published post row shows counts, a snippet, and hides a missing date", () => {
  const row = normalizeInboxPost({
    id: "p1",
    social_account_id: "acc",
    network: "Instagram",
    account_name: "Northwind Café",
    content: "  Morning pour  ",
    media_urls: ["https://cdn.example/latte.jpg"],
    published_at: "2026-11-16T02:15:00Z",
    comment_count: 3,
    unread_count: 2,
  });
  assert.equal(row.network, "instagram");
  assert.equal(row.accountName, "Northwind Café");
  assert.equal(postCaption(row.caption), "Morning pour");
  assert.equal(row.thumb, "https://cdn.example/latte.jpg");
  assert.equal(commentCountLabel(row.commentCount), "3 comments");
  assert.equal(commentCountLabel(1), "1 comment");
  assert.equal(commentCountLabel(0), COPY.noCommentsYet);
  assert.equal(shortDay(row.publishedAt), "Mon, Nov 16");
  const quiet = normalizeInboxPost({
    id: "p2",
    network: "facebook",
    content: "   ",
    published_at: null,
    comment_count: 0,
    unread_count: 0,
  });
  assert.equal(postCaption(quiet.caption), COPY.untitledPost);
  assert.equal(quiet.thumb, "");
  assert.equal(shortDay(quiet.publishedAt), "");
  assert.equal(shortDay(normalizeInboxPost({ published_at: 0 }).publishedAt), "");
  assert.equal(shortDay(normalizeInboxPost({ published_at: "1970-01-01T00:00:00Z" }).publishedAt), "");
  const empty = emptyPostsCopy("");
  assert.equal(empty.title, COPY.inboxPostsEmptyTitle);
  assert.equal(empty.action, COPY.createPost);
  assert.equal(empty.create, true);
  const searched = emptyPostsCopy("latte");
  assert.equal(searched.title, COPY.inboxPostsSearchTitle);
  assert.equal(searched.clearSearch, true);
  for (const line of [empty.title, empty.body, searched.title, searched.body, COPY.inboxPostsSub, COPY.noCommentsYet]) {
    assert.equal(containsBannedWord(line), false, line);
  }
});

test("engagement client can post a comment and remove one", async () => {
  const calls = [];
  const client = createEngagementClient(async (path, options = {}) => {
    calls.push({ path, options });
    return { ok: true };
  });
  await client.createComment("post 1", "Hello", "instagram");
  await client.removeComment("comment 1");
  await client.markUnread("comment 1");
  assert.equal(calls[0].path, "/posts/post%201/comments");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.body, JSON.stringify({ text: "Hello", network: "instagram" }));
  assert.equal(calls[1].path, "/comments/comment%201");
  assert.equal(calls[1].options.method, "DELETE");
  assert.equal(calls[2].path, "/comments/comment%201/unread");
  assert.equal(calls[2].options.method, "POST");
});
