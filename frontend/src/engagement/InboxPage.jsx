// Desktop inbox: comments from Instagram, Facebook Page, Threads, and YouTube.
import React, { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
  Inbox,
  MoreHorizontal,
  Plus,
  RefreshCw,
  CircleDot,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { unreadAfterMarkAllRead } from "../navModel.js";
import { Avatar, ChannelTile } from "../sc/ui.jsx";
import { CommentBlock } from "./PostDetailDrawer.jsx";
import { syncPostsAndRefresh } from "./syncRefresh.js";
import {
  COPY,
  commentActionError,
  INBOX_FILTERS,
  accountAccess,
  audienceCommentCount,
  atHandle,
  canonicalNetwork,
  commentCountLabel,
  commentIdsByRead,
  commentedLine,
  commenterMeta,
  compactAge,
  countBadge,
  visibleDeleteConfirmation,
  displayHandle,
  displayName,
  emptyInboxCopy,
  emptyPostsCopy,
  externalUrl,
  findThreadRoot,
  inboxBanners,
  inboxNetworkOptions,
  inboxPane,
  inboxViewChoice,
  postsPane,
  mapComment,
  networkName,
  normalizeInboxPost,
  normalizeThread,
  postCaption,
  presentThread,
  readInboxView,
  replyHint,
  replyPostedToast,
  shortDay,
  commentActions,
  sortRoots,
  unreadCount,
  viewOnName,
  viewportTier,
  visibleFeed,
  writeInboxView,
} from "./model.js";

function Glyph({ network, size = 16 }) {
  return <ChannelTile platform={network} size={size} label={networkName(network)} />;
}

function safeHref(url) {
  return /^https?:\/\//i.test(String(url || "")) ? url : "";
}

function writePostUrl(id, { push = false, open = false } = {}) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("post", String(id));
  else url.searchParams.delete("post");
  const next = url.pathname + url.search + url.hash;
  const state = { inboxPost: id || "", inboxPostOpen: !!open };
  if (push) window.history.pushState(state, "", next);
  else window.history.replaceState(state, "", next);
}

function PostThreadPane({
  post,
  accountName,
  capability,
  client,
  fixtures,
  xEnabled,
  now,
  showBack,
  onBack,
  onOpenDetails,
  onCounts,
  onActivity,
  onRemotePostDeleted,
  notify,
}) {
  const [thread, setThread] = useState([]);
  const [statusNotice, setStatusNotice] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [replyId, setReplyId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState("");
  const [pending, setPending] = useState(null);

  function tell(title, kind) {
    notify?.({ title, message: "", kind });
  }

  async function loadThread() {
    if (fixtures) {
      const rows = fixtures.threads?.[post.id] || [];
      setThread(normalizeThread(rows, post.network));
      setPhase("ready");
      return;
    }
    if (!client) {
      setThread([]);
      setPhase("error");
      return;
    }
    setPhase("loading");
    try {
      const payload = await client.listComments(post.id);
      const next = normalizeThread(payload, post.network);
      setThread(next);
      setPhase("ready");
      onCounts?.(post.id, {
        commentCount: audienceCommentCount(next),
        unreadCount: unreadCount(next),
      });
    } catch {
      setThread([]);
      setPhase("error");
    }
  }

  useEffect(() => {
    void loadThread();
    // Reload when this post changes. loadThread closes over the latest client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id, client, fixtures]);

  const roots = sortRoots(thread, "newest");
  const unreadIds = commentIdsByRead(thread, true);
  const readIds = commentIdsByRead(thread, false);
  const when = shortDay(post.publishedAt);

  async function refresh() {
    setBusy("refresh");
    setStatusNotice(null);
    try {
      let deleted = false;
      let commentsSkipped = false;
      if (client && !fixtures) {
        const result = await syncPostsAndRefresh(
          async (postId) => {
            const result = await client.syncPost(postId);
            commentsSkipped = result?.skipped?.includes("comments_read");
            return result;
          },
          [post.id],
          async ({ deleted: wasDeleted }) => {
            deleted = wasDeleted;
            await loadThread();
            if (wasDeleted) {
              await onRemotePostDeleted?.();
              await onActivity?.();
            }
          },
        );
        deleted = result.deleted;
        if (result.message) {
          setStatusNotice({ id: post.id, text: result.message });
          return;
        }
      } else {
        await loadThread();
      }
      if (deleted) tell("Post status updated", "success");
      else if (commentsSkipped) tell("Post checked. Comments are unavailable.");
      else if (!fixtures) tell(COPY.commentsUpdated, "success");
    } catch (error) {
      tell(error?.message || COPY.postsErrorTitle);
    } finally {
      setBusy("");
    }
  }

  async function markThread(read) {
    const ids = read ? unreadIds : readIds;
    if (!ids.length) return;
    setBusy(read ? "read" : "unread");
    const previous = thread;
    let next = thread;
    for (const id of ids) {
      next = mapComment(next, id, (item) => ({ ...item, read }));
    }
    setThread(next);
    onCounts?.(post.id, {
      commentCount: audienceCommentCount(next),
      unreadCount: unreadCount(next),
    });
    if (!client || fixtures) {
      setBusy("");
      return;
    }
    try {
      await Promise.all(ids.map((id) => (read ? client.markRead(id) : client.markUnread(id))));
      onActivity?.();
      onCounts?.(post.id, {
        commentCount: audienceCommentCount(next),
        unreadCount: unreadCount(next),
      });
    } catch {
      setThread(previous);
      onCounts?.(post.id, {
        commentCount: audienceCommentCount(previous),
        unreadCount: unreadCount(previous),
      });
      tell(COPY.actionFailed);
    } finally {
      setBusy("");
    }
  }

  async function sendReply(comment) {
    const text = String(drafts[comment.id] || "").trim();
    if (!text || !client) return;
    setBusy(comment.id);
    try {
      await client.reply(comment.id, text);
      setDrafts((current) => ({ ...current, [comment.id]: "" }));
      setReplyId(null);
      tell(replyPostedToast(post.network), "success");
      await loadThread();
    } catch (error) {
      tell(commentActionError(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function changeHidden(comment, hidden) {
    if (!client) return;
    setBusy(comment.id);
    try {
      const updated = await client.hideReply(comment.id, hidden);
      setThread((current) => mapComment(current, updated.id, (item) => ({ ...item, hidden: updated.is_hidden })));
    } catch (error) {
      tell(commentActionError(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function confirmDelete() {
    if (!pending || !client) return;
    setBusy(pending.id);
    try {
      await client.removeComment(pending.id);
      setThread((current) => mapComment(current, pending.id, (item) => ({ ...item, deleted: true })));
      setPending(null);
      await loadThread();
      onActivity?.();
    } catch (error) {
      tell(commentActionError(error), "error");
    } finally {
      setBusy("");
    }
  }

  const confirm = visibleDeleteConfirmation(roots, pending, post.network, xEnabled, capability);

  return (
    <section className="eng-post-detail card" data-engagement="post-comments" data-post-id={post.id}>
      {showBack ? (
        <header className="eng-sheet-head">
          <button type="button" className="eng-back eng-back-auto" onClick={onBack}>
            <ChevronLeft size={20} />
            Inbox
          </button>
          <button
            type="button"
            className="eng-iconbtn"
            aria-label={COPY.refreshComments}
            onClick={() => void refresh()}
            disabled={busy === "refresh"}
          >
            <RefreshCw size={18} />
          </button>
        </header>
      ) : null}
      <div className="eng-post-head">
        {post.thumb ? <img className="eng-postrow-thumb" src={post.thumb} alt="" /> : null}
        <div className="eng-post-head-copy">
          <div className="eng-postrow-top">
            <Glyph network={post.network} size={16} />
            <b>{accountName}</b>
          </div>
          <p>{postCaption(post.caption)}</p>
          {statusNotice?.id === post.id && <p role="status">{statusNotice.text}</p>}
          {when ? <div className="eng-postrow-date eng-post-head-date">{when}</div> : null}
          <button type="button" className="eng-link" onClick={onOpenDetails}>
            {COPY.postDetails}
          </button>
        </div>
        {showBack ? null : (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => void refresh()}
            disabled={busy === "refresh"}
          >
            <RefreshCw size={14} />
            {COPY.refreshComments}
          </button>
        )}
      </div>
      {phase === "ready" && roots.length > 0 ? (
        <div className="eng-post-threadbar">
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => void markThread(unreadIds.length > 0)}
            disabled={busy === "read" || busy === "unread" || (unreadIds.length === 0 && readIds.length === 0)}
          >
            <CircleDot size={14} />
            {unreadIds.length > 0 ? COPY.markRead : COPY.markUnread}
          </button>
        </div>
      ) : null}
      <div className="eng-scroll">
        {phase === "loading" ? (
          <div className="eng-body" aria-busy="true">
            <div className="eng-skel eng-skel-line" style={{ width: "40%" }} />
            <div className="eng-skel" style={{ height: 72 }} />
            <div className="eng-skel eng-skel-line" />
          </div>
        ) : null}
        {phase === "error" ? (
          <div className="eng-state">
            <span className="eng-state-icon red">
              <TriangleAlert size={24} />
            </span>
            <h3>{COPY.postsErrorTitle}</h3>
            <p>{COPY.postsErrorBody}</p>
            <button type="button" className="btn btn-secondary" onClick={() => void loadThread()}>
              <RefreshCw size={16} />
              {COPY.tryAgain}
            </button>
          </div>
        ) : null}
        {phase === "ready" && roots.length === 0 ? (
          <div className="eng-state">
            <span className="eng-state-icon">
              <Inbox size={24} />
            </span>
            <h3>{COPY.noCommentsYet}</h3>
            <p>{COPY.postsThreadEmptyBody}</p>
            <button type="button" className="btn btn-secondary" onClick={() => void refresh()} disabled={busy === "refresh"}>
              <RefreshCw size={16} />
              {COPY.refreshComments}
            </button>
          </div>
        ) : null}
        {phase === "ready" && roots.length > 0 ? (
          <div className="eng-body">
            {roots.map((comment) => (
              <CommentBlock
                key={comment.id}
                comment={comment}
                network={post.network}
                xEnabled={xEnabled}
                capability={capability}
                now={now}
                replyId={replyId}
                drafts={drafts}
                setDrafts={setDrafts}
                busy={busy}
                onAction={(comment, action) => {
                  if (action === "reply") setReplyId(comment.id);
                  if (action === "hide") void changeHidden(comment, true);
                  if (action === "unhide") void changeHidden(comment, false);
                  if (action === "delete" || action === "remove") setPending(comment);
                }}
                onSend={sendReply}
                onCancel={() => setReplyId(null)}
              />
            ))}
          </div>
        ) : null}
      </div>
      {confirm ? (
        <div className="eng-confirm-layer" role="alertdialog" aria-labelledby="eng-post-confirm">
          <div className="eng-confirm">
            <div className="eng-confirm-row">
              <span className="eng-confirm-icon">
                <Trash2 size={20} />
              </span>
              <div>
                <h3 id="eng-post-confirm">{confirm.title}</h3>
                <p>{confirm.body}</p>
              </div>
            </div>
            <div className="eng-confirm-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" disabled={Boolean(busy)} onClick={() => void confirmDelete()}>
                {confirm.confirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function storedInboxView() {
  try {
    return readInboxView(window.localStorage);
  } catch {
    return "";
  }
}

export default function InboxPage({
  client,
  accounts = [],
  xEnabled = false,
  onOpenPost,
  onCreatePost,
  onReconnect,
  notify,
  onActivity,
  onRemotePostDeleted,
  fixtures = null,
}) {
  const [status, setStatus] = useState("all");
  const [view, setView] = useState(() => {
    if (fixtures?.view === "comments" || fixtures?.view === "posts") return fixtures.view;
    return storedInboxView();
  });
  const explicitView = React.useRef(
    Boolean(
      fixtures?.view === "comments" ||
        fixtures?.view === "posts" ||
        storedInboxView(),
    ),
  );
  const [network, setNetwork] = useState("");
  const [accountId, setAccountId] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState(null);
  const [total, setTotal] = useState(0);
  const [phase, setPhase] = useState(fixtures?.phase || "loading");
  const [matrix, setMatrix] = useState(fixtures?.matrix || null);
  const [selectedId, setSelectedId] = useState("");
  const [thread, setThread] = useState([]);
  const [replyId, setReplyId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState("");
  const [menu, setMenu] = useState("");
  const [pending, setPending] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [tier, setTier] = useState(() =>
    viewportTier(typeof window === "undefined" ? 1440 : window.innerWidth),
  );
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState(() => {
    if (fixtures?.view !== "posts") return "";
    const rows = (fixtures.posts || []).map(normalizeInboxPost);
    const fromUrl = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("post") || "";
    return rows.find((item) => item.id === fromUrl)?.id || rows[0]?.id || "";
  });
  const [postDetailOpen, setPostDetailOpen] = useState(false);
  const [postItems, setPostItems] = useState(() =>
    fixtures?.view === "posts" ? (fixtures.posts || []).map(normalizeInboxPost) : [],
  );
  const [postTotal, setPostTotal] = useState(() =>
    fixtures?.view === "posts" ? (fixtures.posts || []).length : 0,
  );
  const [postPhase, setPostPhase] = useState(() =>
    fixtures?.view === "posts" ? fixtures.phase || "ready" : "loading",
  );
  const postPane = postsPane(width, postDetailOpen);
  const pane = view === "posts" ? postPane : inboxPane(tier, detailOpen);
  useEffect(() => {
    document.body.classList.toggle("eng-phone-detail", pane === "detail");
    return () => document.body.classList.remove("eng-phone-detail");
  }, [pane]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const onResize = () => {
      setTier(viewportTier(window.innerWidth));
      setWidth(window.innerWidth);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const sync = () => {
      const id = new URLSearchParams(window.location.search).get("comment");
      if (!id) {
        setDetailOpen(false);
        return;
      }
      setSelectedId(id);
      setDetailOpen(true);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const platforms = accounts.map((account) => account.platform);
  const networkOptions = inboxNetworkOptions(platforms, xEnabled);
  const accountOptions = accounts.filter((account) => {
    const key = canonicalNetwork(account.platform);
    if (network && key !== network) return false;
    return networkOptions.available.includes(key);
  });

  async function loadPage({ offset = 0, append = false } = {}) {
    if (fixtures) {
      setItems(visibleFeed(fixtures.items || []));
      setCounts(fixtures.counts || null);
      setTotal((fixtures.items || []).length);
      setMatrix(fixtures.matrix || null);
      setPhase(fixtures.phase || "ready");
      setNow(new Date());
      return;
    }
    if (!client) {
      setPhase("error");
      return;
    }
    if (!append) setPhase("loading");
    try {
      const [page, caps] = await Promise.all([
        client.listInbox({
          status,
          network: network || undefined,
          account_id: accountId || undefined,
          search: query || undefined,
          limit: 30,
          offset,
        }),
        offset === 0 ? client.capabilities().catch(() => null) : Promise.resolve(matrix),
      ]);
      const next = visibleFeed(page?.items || []);
      setItems((current) => (append ? [...current, ...next] : next));
      setTotal(Number(page?.total) || 0);
      setCounts(page?.counts || null);
      if (offset === 0) setMatrix(caps);
      if (offset === 0 && !network && !accountId && !query) {
        onActivity?.(Math.max(0, Number(page?.unread_count) || 0));
      }
      setPhase("ready");
      setNow(new Date());
    } catch {
      if (!append) {
        setItems([]);
        setPhase("error");
      } else {
        notify?.({ title: COPY.inboxErrorTitle, message: COPY.inboxErrorBody });
      }
    }
  }

  async function loadPosts({ offset = 0, append = false } = {}) {
    if (fixtures) {
      const rows = (fixtures.posts || []).map(normalizeInboxPost);
      setPostItems(append ? (current) => [...current, ...rows] : rows);
      setPostTotal(rows.length);
      setPostPhase(fixtures.phase || "ready");
      if (fixtures.matrix) setMatrix(fixtures.matrix);
      setNow(new Date());
      return;
    }
    if (!client) {
      setPostPhase("error");
      return;
    }
    if (!append) setPostPhase("loading");
    try {
      const [page, caps] = await Promise.all([
        client.listInboxPosts({
          network: network || undefined,
          account_id: accountId || undefined,
          search: query || undefined,
          limit: 30,
          offset,
        }),
        offset === 0 ? client.capabilities().catch(() => null) : Promise.resolve(matrix),
      ]);
      const next = (page?.items || []).map(normalizeInboxPost);
      setPostItems((current) => (append ? [...current, ...next] : next));
      setPostTotal(Number(page?.total) || 0);
      if (offset === 0 && caps) setMatrix(caps);
      setPostPhase("ready");
      setNow(new Date());
    } catch {
      if (!append) {
        setPostItems([]);
        setPostPhase("error");
      } else {
        notify?.({ title: COPY.postsErrorTitle, message: COPY.postsErrorBody });
      }
    }
  }

  const listKind = view === "posts" ? "posts" : "comments";
  useEffect(() => {
    if (listKind === "posts") void loadPosts();
    else void loadPage();
    // Reload when the filters or the view change. The loaders close over the latest ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKind, status, network, accountId, query, fixtures, client]);

  useEffect(() => {
    if (view || explicitView.current) return;
    if (phase === "error") {
      setView("comments");
      return;
    }
    if (phase !== "ready") return;
    setView(inboxViewChoice({ stored: "", unread: counts?.unread }));
  }, [view, phase, counts]);

  useEffect(() => {
    if (view !== "posts" || postPhase !== "ready" || postPane !== "both") return;
    const fromUrl = new URLSearchParams(window.location.search).get("post") || "";
    const fromUrlPost = postItems.find((item) => item.id === fromUrl);
    const current = postItems.find((item) => item.id === selectedPostId);
    const next = fromUrlPost || current || postItems[0] || null;
    if (!next) return;
    if (next.id !== selectedPostId) setSelectedPostId(next.id);
    if (fromUrl !== next.id) writePostUrl(next.id);
  }, [view, postPhase, postPane, postItems, selectedPostId]);

  useEffect(() => {
    const sync = () => {
      const state = window.history.state || {};
      if (!state.inboxPostOpen) setPostDetailOpen(false);
      const id = new URLSearchParams(window.location.search).get("post") || "";
      if (id) setSelectedPostId(id);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  function openPostRow(item) {
    setSelectedPostId(item.id);
    if (postPane === "both") {
      writePostUrl(item.id);
      return;
    }
    setPostDetailOpen(true);
    writePostUrl(item.id, { push: true, open: true });
  }

  function backFromPost() {
    setPostDetailOpen(false);
    if (window.history.state?.inboxPostOpen) {
      window.history.back();
      return;
    }
    writePostUrl(selectedPostId);
  }

  function chooseView(next) {
    explicitView.current = true;
    setView(next);
    setMenu("");
    if (next === "posts") {
      setDetailOpen(false);
      setReplyId(null);
    } else if (window.history.state?.inboxPost) {
      writePostUrl("");
      setPostDetailOpen(false);
    }
    try {
      writeInboxView(window.localStorage, next);
    } catch {
      /* The choice still applies for this visit. */
    }
  }

  const selected = items.find((item) => item.id === selectedId) || null;
  useEffect(() => {
    if (phase !== "ready") return;
    if (selectedId && items.some((item) => item.id === selectedId)) return;
    setSelectedId(items[0]?.id || "");
    setReplyId(null);
  }, [items, phase, selectedId]);

  useEffect(() => {
    if (!selected || !client || fixtures) {
      setThread([]);
      return undefined;
    }
    let cancelled = false;
    client
      .listComments(selected.postId)
      .then((payload) => {
        if (!cancelled) setThread(normalizeThread(payload, selected.network));
      })
      .catch(() => {
        if (!cancelled) setThread([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.postId, client, fixtures]);

  const banners = inboxBanners(matrix?.accounts);
  const empty = emptyInboxCopy(status, query);
  const shown = presentThread(thread);
  const root = findThreadRoot(shown.length ? thread : [], selected?.id);
  const detailComment = root
    ? sortRoots([root], "newest")[0]
    : selected
      ? { ...selected, replies: [] }
      : null;
  const account = accounts.find((item) => item.id === selected?.accountId);
  const capability = matrix?.accounts?.find((row) => row.account_id === selected?.accountId) ?? null;
  const shortcutComment = detailComment?.id === selected?.id
    ? detailComment
    : detailComment?.replies?.find((reply) => reply.id === selected?.id);
  const canReplyToSelected = commentActions(selected?.network, shortcutComment, xEnabled, capability).includes("reply");
  const confirm = visibleDeleteConfirmation(detailComment ? [detailComment] : [], pending, selected?.network, xEnabled, capability);
  const accountLabel = displayHandle(account) || atHandle(selected?.accountName) || displayName(account);

  function backToList() {
    setDetailOpen(false);
    setReplyId(null);
    if (window.history.state?.inboxComment) {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("comment");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  function tell(title, kind) {
    notify?.({ title, message: "", kind });
  }

  async function openItem(item) {
    setSelectedId(item.id);
    setReplyId(null);
    setDrafts({});
    if (viewportTier(window.innerWidth) === "phone") {
      setDetailOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.set("comment", item.id);
      window.history.pushState({ inboxComment: item.id }, "", url.pathname + url.search + url.hash);
    }
    if (item.read || !client || fixtures) return;
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, read: true } : row)));
    setCounts((current) =>
      current ? { ...current, unread: Math.max(0, current.unread - 1) } : current,
    );
    try {
      await client.markRead(item.id);
      onActivity?.();
    } catch {
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, read: false } : row)));
      tell(COPY.actionFailed);
    }
  }

  async function markUnread() {
    if (!selected || !client) return;
    setItems((current) => current.map((row) => (row.id === selected.id ? { ...row, read: false } : row)));
    try {
      await client.markUnread(selected.id);
      onActivity?.();
    } catch {
      setItems((current) => current.map((row) => (row.id === selected.id ? { ...row, read: true } : row)));
      tell(COPY.actionFailed);
    }
  }

  async function markAll() {
    if (!client) return;
    setBusy("all");
    try {
      await client.markReadBulk({
        all_matching: true,
        status: status === "all" ? "unread" : status,
        network: network || undefined,
        account_id: accountId || undefined,
        search: query || undefined,
      });
      setItems((current) => current.map((row) => ({ ...row, read: true })));
      setCounts((current) => (current ? { ...current, unread: 0 } : current));
      const clearsEveryUnread = !network && !accountId && !query && (status === "all" || status === "unread");
      onActivity?.(clearsEveryUnread ? unreadAfterMarkAllRead() : undefined);
    } catch {
      tell(COPY.actionFailed);
    } finally {
      setBusy("");
    }
  }

  async function sendReply(comment) {
    const text = (drafts[comment.id] || "").trim();
    if (!text || !selected || !client) return;
    setBusy("reply");
    try {
      await client.reply(comment.id, text);
      setDrafts({});
      setReplyId(null);
      setItems((current) =>
        current.map((row) => (row.id === comment.id ? { ...row, replied: true, read: true } : row)),
      );
      tell(replyPostedToast(selected.network), "success");
      onActivity?.();
      if (selected.postId) {
        try {
          const payload = await client.listComments(selected.postId);
          setThread(normalizeThread(payload, selected.network));
        } catch {
          tell("Reply posted. Refresh the post to see it.");
        }
      }
    } catch (error) {
      tell(commentActionError(error), "error");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    function onKey(event) {
      const tag = event.target?.tagName;
      if (tag && /input|textarea|select/i.test(tag)) return;
      if (view !== "comments") return;
      if (event.key === "j" || event.key === "k") {
        const index = items.findIndex((item) => item.id === selected?.id);
        const next = event.key === "j" ? items[index + 1] : items[index - 1];
        if (next) void openItem(next);
      }
      if (event.key === "r" && canReplyToSelected) {
        setReplyId(selected.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function changeHidden(comment, hidden) {
    if (!client) return;
    setBusy(comment.id);
    try {
      const updated = await client.hideReply(comment.id, hidden);
      setThread((current) => mapComment(current, updated.id, (item) => ({ ...item, hidden: updated.is_hidden })));
      setItems((current) => current.map((item) => item.id === updated.id ? { ...item, hidden: updated.is_hidden } : item));
    } catch (error) {
      tell(commentActionError(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function confirmDelete() {
    if (!pending || !client) return;
    setBusy(pending.id);
    try {
      await client.removeComment(pending.id);
      setThread((current) => mapComment(current, pending.id, (item) => ({ ...item, deleted: true })));
      await loadPage();
      setPending(null);
      onActivity?.();
    } catch (error) {
      tell(commentActionError(error), "error");
    } finally {
      setBusy("");
    }
  }

  const selectedPost = postItems.find((item) => item.id === selectedPostId) || null;
  const selectedPostAccount = accounts.find((item) => item.id === selectedPost?.accountId);
  const selectedPostName =
    displayName(selectedPostAccount) || selectedPost?.accountName || networkName(selectedPost?.network);

  const countFor = (id) => {
    if (!counts) return null;
    if (id === "all") return counts.all;
    if (id === "unread") return counts.unread;
    if (id === "unreplied") return counts.unreplied;
    return null;
  };

  return (
    <div className="eng-inbox" data-engagement="inbox" data-view={view || "pending"} data-phase={view === "posts" ? postPhase : phase} data-pane={pane}>
      <div className="page-head eng-inbox-head">
        <div>
          <h1>{COPY.inboxTitle}</h1>
          <p>
            {view === "posts"
              ? COPY.inboxPostsSub
              : tier === "desktop"
                ? COPY.inboxSub
                : COPY.inboxSubMobile}
          </p>
        </div>
        {view === "posts" ? null : (
          <button
            type="button"
            className={`btn btn-secondary${tier === "desktop" ? "" : " btn-sm"}`}
            onClick={() => void markAll()}
            disabled={phase !== "ready" || items.length === 0 || busy === "all"}
          >
            <Check size={tier === "desktop" ? 16 : 14} />
            {tier === "desktop" ? "Mark all as read" : COPY.markAllRead}
          </button>
        )}
      </div>

      <div className="eng-seg eng-view-switch" role="tablist" aria-label="Inbox view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "comments"}
          className={view === "comments" ? "is-on" : ""}
          onClick={() => chooseView("comments")}
        >
          Comments
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "posts"}
          className={view === "posts" ? "is-on" : ""}
          onClick={() => chooseView("posts")}
        >
          Posts
        </button>
      </div>

      {(view === "posts" ? postPhase : phase) === "ready" && banners.length ? (
        <div className="eng-banner-stack">
          {banners.map((banner) => (
            <div className="eng-banner" key={banner.id}>
              <span className="eng-banner-icon">
                <TriangleAlert size={20} />
              </span>
              <div style={{ flex: 1 }}>
                <h3>
                  <Glyph network={banner.network} size={16} />
                  {banner.title}
                </h3>
                <p>{banner.body}</p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onReconnect?.(banner.network)}
              >
                {banner.button}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="eng-filters">
        {view === "posts" ? null : (
          <div className="eng-seg" role="tablist" aria-label="Comment status">
            {INBOX_FILTERS.map((filter) => {
              const count = phase === "loading" ? null : countFor(filter.id);
              const on = status === filter.status;
              return (
                <button
                  key={filter.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={on ? "is-on" : ""}
                  onClick={() => setStatus(filter.status)}
                >
                  {filter.label}
                  {count == null ? null : <span>{count}</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className={`eng-filters-rest${view === "posts" ? " is-start" : ""}`}>
          <label className="eng-search">
            <Search size={16} />
            <input
              value={search}
              placeholder={view === "posts" ? "Search posts" : "Search comments"}
              aria-label={view === "posts" ? "Search posts" : "Search comments"}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="eng-select">
            <button
              type="button"
              className="input eng-select-btn"
              aria-expanded={menu === "network"}
              onClick={() => setMenu((current) => (current === "network" ? "" : "network"))}
            >
              {network ? networkName(network) : "All networks"}
              <ChevronDown size={16} />
            </button>
            {menu === "network" ? (
              <div className="eng-pop" role="listbox">
                <button
                  type="button"
                  className={!network ? "is-on" : ""}
                  onClick={() => {
                    setNetwork("");
                    setAccountId("");
                    setMenu("");
                  }}
                >
                  All networks
                  {!network ? <Check size={16} /> : null}
                </button>
                {networkOptions.available.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={network === key ? "is-on" : ""}
                    onClick={() => {
                      setNetwork(key);
                      setAccountId("");
                      setMenu("");
                    }}
                  >
                    <Glyph network={key} size={16} />
                    {networkName(key)}
                    {network === key ? <Check size={16} /> : null}
                  </button>
                ))}
                {networkOptions.later.length ? (
                  <>
                    <div className="eng-pop-label">{COPY.inboxLater}</div>
                    {networkOptions.later.map((key) => (
                      <div key={key} className="eng-pop-muted">
                        <Glyph network={key} size={16} />
                        {networkName(key)}
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="eng-select">
            <button
              type="button"
              className="input eng-select-btn"
              aria-expanded={menu === "account"}
              aria-label="All accounts"
              onClick={() => setMenu((current) => (current === "account" ? "" : "account"))}
            >
              {accountOptions.find((item) => item.id === accountId)
                ? displayName(accountOptions.find((item) => item.id === accountId)) || "Account"
                : "All accounts"}
              <ChevronDown size={16} />
            </button>
            {menu === "account" ? (
              <div className="eng-pop" role="listbox">
                <button
                  type="button"
                  className={!accountId ? "is-on" : ""}
                  onClick={() => {
                    setAccountId("");
                    setMenu("");
                  }}
                >
                  All accounts
                  {!accountId ? <Check size={16} /> : null}
                </button>
                {accountOptions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={accountId === item.id ? "is-on" : ""}
                    onClick={() => {
                      setAccountId(item.id);
                      setMenu("");
                    }}
                  >
                    <Glyph network={item.platform} size={16} />
                    {displayName(item) || item.account_name || networkName(item.platform)}
                    {accountId === item.id ? <Check size={16} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {view === "comments" && phase === "error" ? (
        <div className="card eng-state eng-state-card">
          <span className="eng-state-icon red">
            <TriangleAlert size={24} />
          </span>
          <h3>{COPY.inboxErrorTitle}</h3>
          <p>{COPY.inboxErrorBody}</p>
          <button type="button" className="btn btn-secondary" onClick={() => void loadPage()}>
            <RefreshCw size={16} />
            {COPY.tryAgain}
          </button>
        </div>
      ) : null}

      {view !== "posts" && (view === "" || phase === "loading") ? (
        <div className="eng-inbox-panes" aria-busy="true">
          <div className={`eng-inbox-list${tier === "desktop" ? " card" : " is-plain"}`}>
            {Array.from({ length: 7 }, (_, index) => (
              <div className="eng-feed eng-feed-skel" key={index}>
                <div className="eng-skel eng-skel-avatar" />
                <div style={{ flex: 1 }}>
                  <div className="eng-skel eng-skel-line" style={{ width: "40%" }} />
                  <div className="eng-skel eng-skel-line" />
                  <div className="eng-skel eng-skel-line" style={{ width: "66%" }} />
                </div>
              </div>
            ))}
          </div>
          <div className="card eng-inbox-detail">
            <div className="eng-body">
              <div className="eng-skel eng-skel-line" style={{ width: "30%" }} />
              <div className="eng-skel" style={{ height: 80 }} />
              <div className="eng-skel eng-skel-line" />
            </div>
          </div>
        </div>
      ) : null}

      {view === "comments" && phase === "ready" && items.length === 0 ? (
        <div className="card eng-state eng-state-card">
          <span className="eng-state-icon">
            <Inbox size={24} />
          </span>
          <h3>{empty.title}</h3>
          <p>{empty.body}</p>
          {empty.action ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (empty.clearSearch) {
                  setSearch("");
                  setQuery("");
                  return;
                }
                setStatus("all");
              }}
            >
              {empty.action}
            </button>
          ) : null}
        </div>
      ) : null}

      {view === "comments" && phase === "ready" && items.length > 0 ? (
        <div className="eng-inbox-panes">
          <div className={`eng-inbox-list${tier === "desktop" ? " card" : " is-plain"}`}>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`eng-feed${tier === "desktop" && item.id === selected?.id ? " is-on" : ""}`}
                onClick={() => void openItem(item)}
              >
                <span className="eng-feed-avatar">
                  <Avatar name={item.authorName} size={36} src={item.avatarUrl} />
                  <Glyph network={item.network} size={16} />
                </span>
                <span className="eng-feed-main">
                  <span className="eng-feed-top">
                    <b className={item.read ? "" : "is-unread"}>{item.authorName}</b>
                    <span className="eng-handle">{compactAge(item.createdAt, now)}</span>
                    {item.read ? null : <span className="eng-unread-dot" aria-label="Unread" />}
                  </span>
                  <span className={`eng-feed-text${item.read ? " is-read" : ""}`}>{item.text}</span>
                  <span className="eng-feed-foot">
                    <span>On: {item.postExcerpt || "your post"}</span>
                    {item.replied ? <span className="eng-badge">{COPY.replied}</span> : null}
                  </span>
                </span>
              </button>
            ))}
            {items.length < total ? (
              <button type="button" className="btn btn-ghost" onClick={() => void loadPage({ offset: items.length, append: true })}>
                Load more
              </button>
            ) : null}
          </div>
          <div className="card eng-inbox-detail">
            {selected && detailComment ? (
              <>
                <header className="eng-sheet-head">
                  <button type="button" className="eng-back eng-back-auto" onClick={backToList}>
                    <ChevronLeft size={20} />
                    Inbox
                  </button>
                  <div className="eng-sheet-tools">
                    <a
                      className="eng-iconbtn"
                      href={safeHref(externalUrl(selected.network, selected.providerPostId))}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open on ${viewOnName(selected.network)}`}
                    >
                      <ExternalLink size={18} />
                    </a>
                    <button
                      type="button"
                      className="eng-iconbtn"
                      aria-label="More comment actions"
                      onClick={() => setMenu((current) => (current === "detail" ? "" : "detail"))}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                  {menu === "detail" ? (
                    <div className="eng-menu eng-menu-mobile" role="menu">
                      <button type="button" role="menuitem" onClick={() => void markUnread()}>
                        Mark as unread
                      </button>
                    </div>
                  ) : null}
                </header>
                <div className="eng-commenter">
                  <span className="eng-feed-avatar eng-feed-avatar-lg">
                    <Avatar name={selected.authorName} size={40} src={selected.avatarUrl} />
                    <Glyph network={selected.network} size={16} />
                  </span>
                  <div>
                    <div className="eng-commenter-name">{selected.authorName}</div>
                    <div className="eng-commenter-meta">{commenterMeta(selected, accountLabel, now)}</div>
                  </div>
                </div>
                <div className="eng-detail-head">
                  <div className="eng-who">
                    <span className="eng-feed-avatar">
                      <Avatar name={selected.authorName} size={36} src={selected.avatarUrl} />
                      <Glyph network={selected.network} size={16} />
                    </span>
                    <div>
                      <b>
                        {selected.authorName}{" "}
                        {selected.handle ? <span className="eng-handle-muted">{selected.handle}</span> : null}
                      </b>
                      <div className="eng-detail-meta">{commentedLine(selected, accountLabel, now)}</div>
                    </div>
                  </div>
                  <div className="eng-detail-actions">
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => void markUnread()}>
                      <CircleDot size={14} />
                      Mark as unread
                    </button>
                    <a
                      className="btn btn-sm btn-secondary"
                      href={safeHref(externalUrl(selected.network, selected.providerPostId))}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} />
                      Open on {viewOnName(selected.network)}
                    </a>
                  </div>
                </div>
                <div className="eng-scroll">
                  <div className="eng-context-wrap">
                    <div className="eng-context">
                      {selected.postThumb ? (
                        <img className="eng-context-thumb" src={selected.postThumb} alt="" />
                      ) : null}
                      <div className="eng-context-copy">
                        <div className="eng-handle eng-context-kicker">
                          <Glyph network={selected.network} size={12} />
                          Your post
                          {shortDay(selected.postPublishedAt) ? ` · ${shortDay(selected.postPublishedAt)}` : ""}
                        </div>
                        <p>{selected.postExcerpt || "Your post"}</p>
                        <button type="button" className="eng-link" onClick={() => onOpenPost?.(selected.postId)}>
                          View post details
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="eng-body">
                    <CommentBlock
                      comment={{ ...detailComment, open: false }}
                      network={selected.network}
                      xEnabled={xEnabled}
                      capability={capability}
                      now={now}
                      replyId={replyId}
                      drafts={drafts}
                      setDrafts={setDrafts}
                      busy={busy}
                      onAction={(comment, action) => {
                        if (action === "reply") setReplyId(comment.id);
                        if (action === "hide") void changeHidden(comment, true);
                        if (action === "unhide") void changeHidden(comment, false);
                        if (action === "delete" || action === "remove") setPending(comment);
                      }}
                      onSend={sendReply}
                      onCancel={() => setReplyId(null)}
                    />
                  </div>
                </div>
                <div className="eng-inbox-tip">{canReplyToSelected ? "Press R to reply. " : ""}Press J / K to move between comments.</div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {view === "posts" && postPhase === "error" ? (
        <div className="card eng-state eng-state-card">
          <span className="eng-state-icon red">
            <TriangleAlert size={24} />
          </span>
          <h3>{COPY.postsErrorTitle}</h3>
          <p>{COPY.postsErrorBody}</p>
          <button type="button" className="btn btn-secondary" onClick={() => void loadPosts()}>
            <RefreshCw size={16} />
            {COPY.tryAgain}
          </button>
        </div>
      ) : null}

      {view === "posts" && postPhase === "loading" ? (
        <div className={`eng-post-list${tier === "desktop" ? " card" : " is-plain"}`} aria-busy="true">
          {Array.from({ length: 5 }, (_, index) => (
            <div className="eng-postrow" key={index}>
              <div className="eng-skel eng-postrow-thumb" />
              <div style={{ flex: 1 }}>
                <div className="eng-skel eng-skel-line" style={{ width: "36%" }} />
                <div className="eng-skel eng-skel-line" />
                <div className="eng-skel eng-skel-line" style={{ width: "28%" }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {view === "posts" && postPhase === "ready" && postItems.length === 0 ? (
        <div className="card eng-state eng-state-card">
          <span className="eng-state-icon">
            <Inbox size={24} />
          </span>
          <h3>{emptyPostsCopy(query).title}</h3>
          <p>{emptyPostsCopy(query).body}</p>
          {emptyPostsCopy(query).action ? (
            <button
              type="button"
              className={emptyPostsCopy(query).create ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => {
                const emptyPosts = emptyPostsCopy(query);
                if (emptyPosts.clearSearch) {
                  setSearch("");
                  setQuery("");
                  return;
                }
                onCreatePost?.();
              }}
            >
              {emptyPostsCopy(query).create ? <Plus size={16} /> : null}
              {emptyPostsCopy(query).action}
            </button>
          ) : null}
        </div>
      ) : null}

      {view === "posts" && postPhase === "ready" && postItems.length > 0 ? (
        <div className={`eng-posts-wrap${pane === "both" ? " is-split" : ""}`}>
          <div className={`eng-post-list${pane === "both" ? " card" : " is-plain"}`} data-engagement="inbox-posts">
            {postItems.map((item) => {
              const account = accounts.find((entry) => entry.id === item.accountId);
              const name = displayName(account) || item.accountName || networkName(item.network);
              const when = shortDay(item.publishedAt);
              const unread = countBadge(item.unreadCount);
              const on = pane === "both" && item.id === selectedPostId;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`eng-postrow${on ? " is-on" : ""}`}
                  data-post-id={item.id}
                  aria-current={on ? "true" : undefined}
                  onClick={() => openPostRow(item)}
                >
                  {item.thumb ? <img className="eng-postrow-thumb" src={item.thumb} alt="" /> : null}
                  <span className="eng-postrow-main">
                    <span className="eng-postrow-top">
                      <Glyph network={item.network} size={16} />
                      <b>{name}</b>
                      {when ? <span className="eng-postrow-date">{when}</span> : null}
                    </span>
                    <span className="eng-postrow-caption">{postCaption(item.caption)}</span>
                    <span className="eng-postrow-foot">
                      <span className={item.commentCount > 0 ? "" : "is-quiet"}>{commentCountLabel(item.commentCount)}</span>
                      {unread ? (
                        <span className="eng-unread-badge" aria-label={`${item.unreadCount} unread`}>
                          {unread}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              );
            })}
            {postItems.length < postTotal ? (
              <button
                type="button"
                className="btn btn-ghost eng-post-more"
                onClick={() => void loadPosts({ offset: postItems.length, append: true })}
              >
                Load more
              </button>
            ) : null}
          </div>
          {selectedPost && pane !== "list" ? (
            <PostThreadPane
              key={selectedPost.id}
              post={selectedPost}
              accountName={selectedPostName}
              capability={matrix?.accounts?.find((row) => row.account_id === selectedPost.accountId) ?? null}
              client={client}
              fixtures={fixtures}
              xEnabled={xEnabled}
              now={now}
              showBack={pane === "detail"}
              onBack={backFromPost}
              onOpenDetails={() => onOpenPost?.(selectedPost.id, { tab: "comments", fromInboxPosts: true })}
              onCounts={(id, counts) => {
                setPostItems((current) =>
                  current.map((row) => (row.id === id ? { ...row, ...counts } : row)),
                );
              }}
              onActivity={onActivity}
              onRemotePostDeleted={async () => {
                await loadPosts();
                await onRemotePostDeleted?.();
              }}
              notify={notify}
            />
          ) : null}
        </div>
      ) : null}
      {confirm ? (
        <div className="eng-confirm-layer eng-confirm-fixed" role="alertdialog" aria-labelledby="eng-inbox-confirm">
          <div className="eng-confirm">
            <div className="eng-confirm-row">
              <span className="eng-confirm-icon">
                <Trash2 size={20} />
              </span>
              <div>
                <h3 id="eng-inbox-confirm">{confirm.title}</h3>
                <p>{confirm.body}</p>
              </div>
            </div>
            <div className="eng-confirm-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" disabled={Boolean(busy)} onClick={() => void confirmDelete()}>
                {confirm.confirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function inboxAccess(account, capability) {
  return accountAccess(account, capability);
}
