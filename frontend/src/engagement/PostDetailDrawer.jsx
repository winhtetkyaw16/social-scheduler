// Post detail drawer: Insights and Comments for one published group of posts.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  MoreHorizontal,
  RefreshCw,
  Reply,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Avatar, ChannelTile } from "../sc/ui.jsx";
import useBodyScrollLock from "../useBodyScrollLock.js";
import { syncPostsAndRefresh } from "./syncRefresh.js";
import { remotePostStatusLabel } from "../postStatus.js";
import {
  COPY,
  commentActionError,
  INSIGHT_METRICS,
  NETWORK_MEMORY_KEY,
  accountAccess,
  buildInsightView,
  buildTargets,
  chipCount,
  commentActions,
  commentsPresentation,
  commentsTabEnabled,
  compactAge,
  visibleDeleteConfirmation,
  displayMetric,
  externalHref,
  formatCount,
  latestSnapshot,
  longAge,
  mapComment,
  metricsFromSnapshot,
  networkName,
  normalizeThread,
  pickCommentTarget,
  publishedLabel,
  refreshAllowed,
  replyHint,
  replyPostedToast,
  showRepliesUnsupported,
  sortRoots,
  tabCommentCount,
  reconnectBanner,
  turnOnBanner,
  viewOnName,
  viewportTier,
} from "./model.js";
import "./engagement.css";

function Glyph({ network, size = 16 }) {
  return <ChannelTile platform={network} size={size} label={networkName(network)} />;
}

function safeHref(url) {
  return /^https?:\/\//i.test(String(url || "")) ? url : "";
}

function likesLabel(count) {
  return `${formatCount(count)} ${count === 1 ? "like" : "likes"}`;
}

function MediaBlock({ urls, compact }) {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return null;
  if (compact) {
    return (
      <div className="eng-thumb">
        <img src={list[0]} alt="" />
        <span>{`1/${list.length}`}</span>
      </div>
    );
  }
  const extra = Math.max(0, list.length - 3);
  return (
    <div className="eng-media">
      <div className="eng-media-main">{list[0] ? <img src={list[0]} alt="" /> : null}</div>
      <div className="eng-media-side">
        <div>{list[1] ? <img src={list[1]} alt="" /> : null}</div>
        <div className="eng-media-more">
          {list[2] ? <img src={list[2]} alt="" /> : null}
          {extra > 0 ? <span>{`+${extra}`}</span> : null}
        </div>
      </div>
    </div>
  );
}

function StateBlock({ icon: Icon, title, body, tone, action, onAction }) {
  return (
    <div className="eng-state">
      {Icon ? (
        <span className={`eng-state-icon${tone === "red" ? " red" : ""}`}>
          <Icon size={24} />
        </span>
      ) : null}
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action ? (
        <button type="button" className="btn btn-secondary" onClick={onAction}>
          <RefreshCw size={16} />
          {action}
        </button>
      ) : null}
    </div>
  );
}

function AccessBanner({ access, network, handle, onReconnect }) {
  if (access !== "needs_reconnect" && access !== "comments_not_enabled") return null;
  const copy = access === "needs_reconnect" ? reconnectBanner(network, handle) : turnOnBanner(network);
  return (
    <div className="eng-banner">
      <span className="eng-banner-icon">
        <TriangleAlert size={20} />
      </span>
      <div style={{ flex: 1 }}>
        <h3>
          <Glyph network={network} size={16} />
          {copy.title}
        </h3>
        <p>{copy.body}</p>
      </div>
      <button type="button" className="btn btn-primary" onClick={onReconnect}>
        {copy.button}
      </button>
    </div>
  );
}

export default function PostDetailDrawer({
  post,
  posts = [],
  accounts = [],
  client,
  xEnabled = false,
  onClose,
  onOpenInQueue,
  onReconnect,
  notify,
  initialTab = "insights",
  fixtures = null,
  pendingPost = false,
  onActivity,
  onRemotePostDeleted,
}) {
  useBodyScrollLock(true);
  const targets = useMemo(() => buildTargets(post, posts, accounts), [post, posts, accounts]);
  const targetIds = targets.map((target) => target.key).join(",");
  const [threads, setThreads] = useState({});
  const [snapshots, setSnapshots] = useState({});
  const [errors, setErrors] = useState({});
  const [matrix, setMatrix] = useState(null);
  const [phase, setPhase] = useState(fixtures ? fixtures.phase || "ready" : "loading");
  const [insightError, setInsightError] = useState(!!fixtures?.insightError);
  const [tab, setTab] = useState(initialTab === "comments" ? "comments" : "insights");
  const [selected, setSelected] = useState("");
  const [order, setOrder] = useState("newest");
  const [expanded, setExpanded] = useState(false);
  const [replyId, setReplyId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState("");
  const [statusNotice, setStatusNotice] = useState(null);
  const [pending, setPending] = useState(null);
  const [menu, setMenu] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [tier, setTier] = useState(() =>
    viewportTier(typeof window === "undefined" ? 1440 : window.innerWidth),
  );
  const panelRef = useRef(null);
  const selectedChipRef = useRef(null);
  const phone = tier === "phone";

  useEffect(() => {
    selectedChipRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [selected, tab]);

  useEffect(() => {
    const onResize = () => setTier(viewportTier(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const load = useCallback(async () => {
    if (fixtures) {
      setThreads(fixtures.threads || {});
      setSnapshots(fixtures.snapshots || {});
      setErrors(fixtures.errors || {});
      setMatrix(fixtures.matrix || null);
      setInsightError(!!fixtures.insightError);
      setPhase(fixtures.phase || "ready");
      return;
    }
    if (!post || !client || !targets.length) {
      setPhase("ready");
      return;
    }
    const commentResults = await Promise.all(
      targets.map(async (target) => {
        try {
          const payload = await client.listComments(target.post.id);
          return { key: target.key, comments: normalizeThread(payload, target.network), error: false };
        } catch {
          return { key: target.key, comments: [], error: true };
        }
      }),
    );
    const insightResults = await Promise.all(
      targets.map(async (target) => {
        try {
          const payload = await client.insights(target.post.id);
          return { key: target.key, snapshot: latestSnapshot(payload), error: false };
        } catch {
          return { key: target.key, snapshot: null, error: true };
        }
      }),
    );
    let caps = null;
    try {
      caps = await client.capabilities();
    } catch {
      caps = null;
    }
    const nextThreads = {};
    const nextErrors = {};
    for (const row of commentResults) {
      nextThreads[row.key] = row.comments;
      if (row.error) nextErrors[row.key] = true;
    }
    const nextSnaps = {};
    for (const row of insightResults) nextSnaps[row.key] = row.snapshot;
    setThreads(nextThreads);
    setSnapshots(nextSnaps);
    setErrors(nextErrors);
    setMatrix(caps);
    setInsightError(insightResults.length > 0 && insightResults.every((row) => row.error));
    setPhase("ready");
    setNow(new Date());
  }, [client, fixtures, post, targets]);

  useEffect(() => {
    let cancelled = false;
    setPhase(fixtures ? fixtures.phase || "ready" : "loading");
    void load().then(() => {
      if (cancelled) return undefined;
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, [load, targetIds, fixtures]);

  useEffect(() => {
    if (phase !== "ready") return;
    setSelected((prev) => {
      if (prev && targets.some((target) => target.key === prev)) return prev;
      let remembered = "";
      try {
        remembered = localStorage.getItem(NETWORK_MEMORY_KEY) || "";
      } catch {
        remembered = "";
      }
      return pickCommentTarget(targets, threads, remembered);
    });
  }, [phase, targetIds, targets, threads]);

  const commentsOn = commentsTabEnabled(targets);
  useEffect(() => {
    setTab(initialTab === "comments" ? "comments" : "insights");
  }, [initialTab, post?.id]);
  useEffect(() => {
    if (!post) return;
    if (!commentsOn && tab === "comments") setTab("insights");
  }, [commentsOn, tab, post]);

  useEffect(() => {
    panelRef.current?.focus();
  }, [post?.id]);

  useEffect(() => {
    function onKey(event) {
      if (event.key !== "Escape") return;
      if (pending) {
        setPending(null);
        return;
      }
      if (menu) {
        setMenu(false);
        return;
      }
      onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, onClose, pending]);

  const selectedTarget = targets.find((target) => target.key === selected) || targets[0] || null;
  const publishedAt = post?.published_at || post?.scheduled_at;
  const insight = buildInsightView({
    targets,
    snapshotsByPost: snapshots,
    publishedAt,
    now,
    xEnabled,
    error: insightError,
  });
  const tabCount = tabCommentCount(targets, threads, snapshots, xEnabled);
  const urls = [...new Set((targets.length ? targets : [{ post }]).flatMap((target) => target.post?.media_urls || post?.media_urls || []))];
  const previewTarget = tab === "comments" ? selectedTarget : targets.find((target) => target.key === String(post?.id));
  const who = previewTarget?.name || "Account";
  const when = remotePostStatusLabel(previewTarget?.post || post) || publishedLabel(publishedAt);
  const compact = tab === "comments" && !expanded;

  function choose(key) {
    setSelected(key);
    setReplyId(null);
    try {
      localStorage.setItem(NETWORK_MEMORY_KEY, key);
    } catch {
      /* The choice still applies for this visit. */
    }
  }

  function tell(title, kind) {
    notify?.({ title, message: "", kind });
  }

  async function refresh(force = false) {
    if (!force && !refreshAllowed(insight.capturedAt, Date.now())) {
      tell("Updated a few minutes ago");
      return;
    }
    setBusy("refresh");
    setStatusNotice(null);
    setMenu(false);
    try {
      let deleted = false;
      if (!fixtures && client) {
        const scope = tab === "comments" && selectedTarget ? [selectedTarget] : targets;
        const syncable = scope.filter((target) => target.status === "published" && target.post?.provider_post_id);
        if (!syncable.length) {
          tell("Only published posts with a network ID can be refreshed.");
          return;
        }
        const result = await syncPostsAndRefresh(
          (postId) => client.syncPost(postId),
          syncable.map((target) => target.post.id),
          async ({ deleted: wasDeleted }) => {
            deleted = wasDeleted;
            await load();
            if (wasDeleted) await onRemotePostDeleted?.();
          },
        );
        deleted = result.deleted;
        if (result.message) {
          setStatusNotice({ key: previewTarget?.key, text: result.message });
          return;
        }
      } else {
        await load();
      }
      tell(deleted ? "Post status updated" : "Post refreshed", "success");
    } catch (error) {
      tell(error?.message || COPY.insightsErrorTitle);
    } finally {
      setBusy("");
    }
  }

  async function copyLink() {
    setMenu(false);
    try {
      const url = new URL(window.location.href);
      if (post?.id) url.searchParams.set("post", post.id);
      await navigator.clipboard.writeText(url.toString());
      tell("Link copied", "success");
    } catch {
      tell("Couldn't copy the link");
    }
  }

  async function sendReply(comment) {
    const text = String(drafts[comment.id] || "").trim();
    if (!text || !client) return;
    setBusy(comment.id);
    try {
      await client.reply(comment.id, text);
      tell(replyPostedToast(selectedTarget?.network), "success");
      setDrafts((current) => ({ ...current, [comment.id]: "" }));
      setReplyId(null);
      onActivity?.();
      await load();
    } catch (error) {
      tell(commentActionError(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function toggleHide(comment, hidden) {
    const key = selectedTarget?.key;
    if (!key || !client) return;
    setBusy(comment.id);
    try {
      const updated = await client.hideReply(comment.id, hidden);
      setThreads((current) => ({
        ...current,
        [key]: mapComment(current[key], updated.id, (item) => ({ ...item, hidden: updated.is_hidden })),
      }));
      onActivity?.();
    } catch (error) {
      tell(commentActionError(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function confirmDelete() {
    if (!pending || !selectedTarget) return;
    setBusy(pending.id);
    try {
      await client.removeComment(pending.id);
      await load();
      setPending(null);
      onActivity?.();
    } catch (error) {
      tell(commentActionError(error), "error");
    } finally {
      setBusy("");
    }
  }

  function onAction(comment, action) {
    if (action === "reply") {
      setReplyId(comment.id);
      return;
    }
    if (action === "hide") void toggleHide(comment, true);
    if (action === "unhide") void toggleHide(comment, false);
    if (action === "delete" || action === "remove") setPending(comment);
  }

  const capability = matrix?.accounts?.find((row) => row.account_id === selectedTarget?.post?.connected_account_id);
  const access = accountAccess(selectedTarget?.account, capability);
  const metrics = metricsFromSnapshot(selectedTarget?.network, snapshots[selectedTarget?.key]);
  const presentation = selectedTarget
    ? commentsPresentation({
        network: selectedTarget.network,
        xEnabled,
        metrics,
        access,
      })
    : null;
  const mode = presentation?.kind || "muted";
  const roots = sortRoots(threads[selectedTarget?.key] || [], order);
  const confirm = visibleDeleteConfirmation(roots, pending, selectedTarget?.network, xEnabled, capability);

  return (
    <div className="eng-root">
      <button type="button" className="eng-scrim" aria-label="Close post details" onClick={onClose} />
      <aside
        className="eng-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="eng-drawer-title"
        tabIndex={-1}
        ref={panelRef}
        data-engagement="drawer"
        data-tab={tab}
        data-network={selectedTarget?.network || ""}
      >
        <header className={`eng-head${phone ? " eng-head-phone" : ""}`}>
          {phone ? (
            <button type="button" className="eng-back eng-back-auto" onClick={onClose}>
              <ChevronLeft size={20} />
              Back
            </button>
          ) : null}
          <h2 id="eng-drawer-title">Post details</h2>
          <div className="eng-head-actions">
            {previewTarget?.account?.needs_reconnect && onReconnect ? (
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => onReconnect(previewTarget.account)}>
                Reconnect {viewOnName(previewTarget.network)}
              </button>
            ) : (
              <button type="button" className="eng-iconbtn" title="Refresh post" aria-label="Refresh post"
                disabled={busy === "refresh"} onClick={() => void refresh(true)}>
                <RefreshCw size={18} />
              </button>
            )}
            {phone ? null : (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onOpenInQueue}>
              <ExternalLink size={14} />
              <span className="eng-open-label">Open in Queue</span>
            </button>
            )}
            <button
              type="button"
              className="eng-iconbtn"
              aria-label="More post actions"
              aria-expanded={menu}
              onClick={() => setMenu((open) => !open)}
            >
              <MoreHorizontal size={18} />
            </button>
            {menu ? (
              <div className="eng-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => void refresh(true)}>
                  Refresh
                </button>
                <button type="button" role="menuitem" onClick={() => void copyLink()}>
                  Copy link
                </button>
              </div>
            ) : null}
            {phone ? null : (
              <button
                type="button"
                className="eng-iconbtn"
                aria-label="Close"
                onClick={onClose}
              >
                <X size={18} />
              </button>
            )}
          </div>
        </header>

        <div className="eng-scroll">
          {statusNotice && statusNotice.key === previewTarget?.key && (
            <p className="eng-body" role="status">{statusNotice.text}</p>
          )}
          {!post ? (
            pendingPost ? (
              <div className="eng-body">
                <div className="eng-skel eng-skel-line" style={{ width: "46%" }} />
                <div className="eng-skel" style={{ height: 120 }} />
              </div>
            ) : (
              <StateBlock title="This post isn't available" body="It may have been removed from the workspace." />
            )
          ) : (
            <>
            <div className={`eng-preview${compact ? " is-compact" : ""}`}>
              {compact ? (
                <div className="eng-compact">
                  <div className="eng-compact-main">
                    <div className="eng-who">
                      <Avatar name={who} size={28} src={previewTarget?.account?.avatar_url} />
                      <div>
                        <b>{who}</b>
                        <div>
                          <span>{when}</span>
                        </div>
                      </div>
                    </div>
                    <p className="eng-copy clamp">{post.content || "Untitled post"}</p>
                    <button type="button" className="eng-link" onClick={() => setExpanded(true)}>
                      Show full post
                    </button>
                  </div>
                  <MediaBlock urls={urls} compact />
                </div>
              ) : (
                <>
                  <div className="eng-who">
                    <Avatar name={who} size={40} src={previewTarget?.account?.avatar_url} />
                    <div>
                      <b>{who}</b>
                      <div>
                        <span>{when}</span>
                      </div>
                    </div>
                  </div>
                  <p className="eng-copy">{post.content || "Untitled post"}</p>
                  <MediaBlock urls={urls} />
                  {tab === "comments" && expanded ? (
                    <button type="button" className="eng-link" onClick={() => setExpanded(false)}>
                      Show less
                    </button>
                  ) : null}
                </>
              )}
              <div className="eng-kicker">Posted to</div>
              <div className="eng-chips">
                {targets.map((target) => (
                  <span className="eng-netchip" key={target.key}>
                    <Glyph network={target.network} size={16} />
                    {networkName(target.network)}
                    {target.failed ? <span className="eng-failed">· Failed</span> : null}
                  </span>
                ))}
              </div>
            </div>

          <div className="eng-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "insights"}
              className={tab === "insights" ? "is-on" : ""}
              onClick={() => setTab("insights")}
            >
              Insights
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "comments"}
              className={tab === "comments" ? "is-on" : ""}
              disabled={!commentsOn}
              onClick={() => commentsOn && setTab("comments")}
            >
              Comments
              {commentsOn ? <span className="eng-count">{formatCount(tabCount)}</span> : null}
            </button>
          </div>

          {tab === "insights" ? (
            <div className="eng-body">
              {phase === "loading" ? (
                <div>
                  <div className="eng-skel eng-skel-line" style={{ width: "40%" }} />
                  <div className="eng-skel" style={{ height: 96 }} />
                </div>
              ) : null}
              {phase !== "loading" && insight.kind === "empty" ? (
                <StateBlock icon={BarChart3} title={insight.title} body={insight.body} />
              ) : null}
              {phase !== "loading" && insight.kind === "not-out" ? (
                <StateBlock icon={BarChart3} title={insight.message} />
              ) : null}
              {phase !== "loading" && insight.kind === "error" ? (
                <StateBlock
                  icon={TriangleAlert}
                  tone="red"
                  title={insight.title}
                  body={insight.body}
                  action={COPY.tryAgain}
                  onAction={() => void refresh(true)}
                />
              ) : null}
              {phase !== "loading" && insight.kind === "cards" ? (
                <>
                  <div className="eng-updated">
                    <span>
                      {insight.capturedAt ? (
                        <>
                          <Clock3 size={14} />
                          {`Updated ${longAge(insight.capturedAt, now)}`}
                        </>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => void refresh(true)}
                      disabled={busy === "refresh"}
                    >
                      <RefreshCw size={14} />
                      Refresh
                    </button>
                  </div>
                  {insight.cards.map((card) =>
                    card.kind === "metrics" ? (
                      <article className="eng-card" key={card.target.key}>
                        <div className="eng-card-head">
                          <div>
                            <Glyph network={card.target.network} size={20} />
                            {networkName(card.target.network)}
                          </div>
                          <a className="eng-link" href={safeHref(externalHref(card.target))} target="_blank" rel="noreferrer">
                            View on {viewOnName(card.target.network)}
                            <ExternalLink size={12} />
                          </a>
                        </div>
                        <div className="eng-metrics">
                          {INSIGHT_METRICS.map(([key, label]) => {
                            const cell = displayMetric(card.target.network, key, card.metrics[key]);
                            return (
                              <div key={key}>
                                <div className="eng-metric-label">{label}</div>
                                <div className={cell.kind === "value" ? "eng-metric-value" : "eng-metric-missing"}>
                                  {cell.text}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </article>
                    ) : (
                      <article className="eng-card eng-card-row" key={card.target.key}>
                        <Glyph network={card.target.network} size={20} />
                        <b>{networkName(card.target.network)}</b>
                        <span className="eng-muted">{card.message}</span>
                      </article>
                    ),
                  )}
                  <p className="eng-footer">{insight.footer}</p>
                </>
              ) : null}
            </div>
          ) : (
            <div className="eng-body">
              {selectedTarget ? (
                <>
                  <div className="eng-switch-block">
                  <div className="eng-switch" role="tablist" aria-label="Networks">
                    {targets.map((target) => {
                      const count = chipCount(target, threads, snapshots, xEnabled);
                      const on = target.key === selectedTarget.key;
                      return (
                        <button
                          type="button"
                          key={target.key}
                          role="tab"
                          aria-selected={on}
                          className={on ? "is-on" : ""}
                          ref={on ? selectedChipRef : null}
                          onClick={() => choose(target.key)}
                        >
                          <Glyph network={target.network} size={14} />
                          {networkName(target.network)}
                          {count == null ? null : <span className="eng-chip-count">{formatCount(count)}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {presentation?.banner ? (
                    <AccessBanner
                      access={access}
                      network={selectedTarget.network}
                      handle={selectedTarget.handle}
                      onReconnect={() => onReconnect?.(selectedTarget.account)}
                    />
                  ) : null}
                  {mode === "list" && roots.length > 1 ? (
                    <div className="eng-toolbar">
                      <button
                        type="button"
                        className="eng-sort"
                        onClick={() => setOrder((value) => (value === "newest" ? "oldest" : "newest"))}
                      >
                        {order === "newest" ? "Newest first" : "Oldest first"}
                        <ChevronDown size={14} />
                      </button>
                    </div>
                  ) : null}
                  </div>
                  {phase === "loading" ? <div className="eng-skel" style={{ height: 120 }} /> : null}
                  {phase !== "loading" && errors[selectedTarget.key] ? (
                    <StateBlock
                      icon={TriangleAlert}
                      tone="red"
                      title={COPY.inboxErrorTitle}
                      body={COPY.inboxErrorBody}
                      action={COPY.tryAgain}
                      onAction={() => void load()}
                    />
                  ) : null}
                  {phase !== "loading" && !errors[selectedTarget.key] && mode === "muted" ? (
                    <div className="eng-muted-block">
                      <p>{presentation.message}</p>
                      <a className="eng-link lg" href={safeHref(externalHref(selectedTarget))} target="_blank" rel="noreferrer">
                        Open on {viewOnName(selectedTarget.network)}
                        <ExternalLink size={14} />
                      </a>
                    </div>
                  ) : null}
                  {phase !== "loading" && !errors[selectedTarget.key] && mode === "totals" ? (
                    <article className="eng-card">
                      <h3>{presentation.title}</h3>
                      <div className="eng-metrics eng-metrics-4">
                        {[
                          ["comments", "Comments"],
                          ["likes", "Likes"],
                          ["shares", "Shares"],
                          ["views", "Views"],
                        ].map(([key, label]) => (
                          <div key={key}>
                            <div className="eng-metric-label">{label}</div>
                            <div className={typeof metrics[key] === "number" ? "eng-metric-value" : "eng-metric-missing"}>
                              {typeof metrics[key] === "number" ? formatCount(metrics[key]) : "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p>{presentation.body}</p>
                      <a className="eng-link lg" href={safeHref(externalHref(selectedTarget))} target="_blank" rel="noreferrer">
                        {presentation.link}
                        <ExternalLink size={14} />
                      </a>
                    </article>
                  ) : null}
                  {phase !== "loading" && !errors[selectedTarget.key] && mode === "pin" ? (
                    <div className="eng-info">
                      <h3>{presentation.title}</h3>
                      {presentation.body ? <p>{presentation.body}</p> : null}
                      <a className="eng-link lg" href={safeHref(externalHref(selectedTarget))} target="_blank" rel="noreferrer">
                        {presentation.link}
                        <ExternalLink size={14} />
                      </a>
                    </div>
                  ) : null}
                  {phase !== "loading" && !errors[selectedTarget.key] && mode === "list" && access === "ok" && roots.length === 0 ? (
                    <StateBlock title={presentation.empty} />
                  ) : null}
                  {phase !== "loading" && !errors[selectedTarget.key] && mode === "list" && (access !== "ok" || roots.length > 0)
                    ? roots.map((comment) => (
                        <CommentBlock
                          key={comment.id}
                          comment={comment}
                          network={selectedTarget.network}
                          xEnabled={xEnabled}
                          capability={capability ?? null}
                          now={now}
                          replyId={replyId}
                          drafts={drafts}
                          setDrafts={setDrafts}
                          busy={busy}
                          onAction={onAction}
                          onSend={sendReply}
                          onCancel={() => setReplyId(null)}
                        />
                      ))
                    : null}
                  {showRepliesUnsupported(selectedTarget?.network, xEnabled) ? (
                    <div className="eng-info">
                      <h3>{COPY.repliesUnsupported}</h3>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
            </>
          )}
        </div>


        {confirm ? (
          <div className="eng-confirm-layer" role="alertdialog" aria-labelledby="eng-confirm-title">
            <div className="eng-confirm">
              <div className="eng-confirm-row">
                <span className="eng-confirm-icon">
                  <Trash2 size={20} />
                </span>
                <div>
                  <h3 id="eng-confirm-title">{confirm.title}</h3>
                  <p>{confirm.body}</p>
                </div>
              </div>
              <div className="eng-confirm-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setPending(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy === pending.id}
                  onClick={() => void confirmDelete()}
                >
                  {confirm.confirm}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

export function CommentBlock({
  comment,
  network,
  xEnabled,
  now,
  replyId,
  drafts,
  setDrafts,
  busy,
  onAction,
  onSend,
  onCancel,
  capability,
  depth = 0,
}) {
  const acts = commentActions(network, comment, xEnabled, capability);
  const name = comment.authorName || comment.handle || "";
  const showHandle = !comment.own && comment.handle && comment.handle !== comment.authorName;
  return (
    <div className={depth ? "eng-reply" : "eng-comment"}>
      <Avatar name={name} size={depth ? 28 : 32} src={comment.avatarUrl} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eng-comment-meta">
          <b className={comment.hidden ? "is-muted" : ""}>{name}</b>
          {comment.own ? <span className="eng-badge">{COPY.you}</span> : null}
          {showHandle ? <span className="eng-handle">{comment.handle}</span> : null}
          <span className="eng-handle">· {compactAge(comment.createdAt, now)}</span>
          {comment.hidden ? <span className="eng-badge">{COPY.hidden}</span> : null}
        </div>
        {comment.replyingTo ? <div className="eng-replying">Replying to {comment.replyingTo}</div> : null}
        {comment.hidden ? <p className="eng-text eng-muted">{COPY.hiddenBody}</p> : <p className="eng-text">{comment.text}</p>}
        <div className="eng-actions">
          {typeof comment.likes === "number" ? <span className="eng-likes">{likesLabel(comment.likes)}</span> : null}
          {acts.map((action) => (
            <button
              key={action}
              type="button"
              className={`eng-action${action === "delete" || action === "remove" ? " danger" : ""}`}
              disabled={Boolean(busy)}
              onClick={() => onAction(comment, action)}
            >
              <ActionIcon action={action} />
              {action === "reply"
                ? "Reply"
                : action === "hide"
                  ? "Hide"
                  : action === "unhide"
                    ? "Unhide"
                    : action === "remove"
                      ? "Remove"
                      : "Delete"}
            </button>
          ))}
        </div>
        {replyId === comment.id && acts.includes("reply") ? (
          <div className="eng-replybox">
            <div className="eng-note">{replyHint(comment.handle || comment.authorName, network)}</div>
            <textarea
              value={drafts[comment.id] || ""}
              aria-label={replyHint(comment.handle || comment.authorName, network)}
              onChange={(event) => {
                const el = event.target;
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
                setDrafts((current) => ({ ...current, [comment.id]: event.target.value }));
              }}
            />
            <div className="eng-reply-actions">
              <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!String(drafts[comment.id] || "").trim() || Boolean(busy)}
                onClick={() => void onSend(comment)}
              >
                <Send size={14} />
                Reply
              </button>
            </div>
          </div>
        ) : null}
        {depth === 0 && comment.replies?.length ? (
          <div className="eng-thread">
            {comment.replies.map((reply) => (
              <CommentBlock
                key={reply.id}
                comment={reply}
                network={network}
                xEnabled={xEnabled}
                capability={capability}
                now={now}
                replyId={replyId}
                drafts={drafts}
                setDrafts={setDrafts}
                busy={busy}
                onAction={onAction}
                onSend={onSend}
                onCancel={onCancel}
                depth={1}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActionIcon({ action }) {
  if (action === "reply") return <Reply size={14} />;
  if (action === "hide") return <EyeOff size={14} />;
  if (action === "unhide") return <Eye size={14} />;
  return <Trash2 size={14} />;
}
