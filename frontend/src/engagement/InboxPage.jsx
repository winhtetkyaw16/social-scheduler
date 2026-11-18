// Desktop inbox: comments from Instagram, Facebook Page, Threads, and YouTube.
import React, { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
  Inbox,
  MoreHorizontal,
  RefreshCw,
  CircleDot,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Avatar, ChannelTile } from "../sc/ui.jsx";
import { CommentBlock } from "./PostDetailDrawer.jsx";
import {
  COPY,
  INBOX_FILTERS,
  accountAccess,
  atHandle,
  canonicalNetwork,
  commentedLine,
  commenterMeta,
  compactAge,
  deleteConfirmCopy,
  displayHandle,
  displayName,
  emptyInboxCopy,
  externalUrl,
  findThreadRoot,
  inboxBanners,
  inboxNetworkOptions,
  inboxPane,
  mapComment,
  networkName,
  normalizeThread,
  presentThread,
  replyHint,
  replyPostedToast,
  shortDay,
  sortRoots,
  viewOnName,
  viewportTier,
  visibleFeed,
} from "./model.js";

function Glyph({ network, size = 16 }) {
  return <ChannelTile platform={network} size={size} label={networkName(network)} />;
}

function safeHref(url) {
  return /^https?:\/\//i.test(String(url || "")) ? url : "";
}

export default function InboxPage({
  client,
  accounts = [],
  xEnabled = false,
  onOpenPost,
  onReconnect,
  notify,
  onActivity,
  fixtures = null,
}) {
  const [status, setStatus] = useState("all");
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
  const [replyOpen, setReplyOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [menu, setMenu] = useState("");
  const [pending, setPending] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [tier, setTier] = useState(() =>
    viewportTier(typeof window === "undefined" ? 1440 : window.innerWidth),
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const pane = inboxPane(tier, detailOpen);
  useEffect(() => {
    document.body.classList.toggle("eng-phone-detail", pane === "detail");
    return () => document.body.classList.remove("eng-phone-detail");
  }, [pane]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const onResize = () => setTier(viewportTier(window.innerWidth));
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

  useEffect(() => {
    void loadPage();
    // Reload when the filters change. loadPage closes over the latest ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, network, accountId, query, fixtures, client]);

  const selected = items.find((item) => item.id === selectedId) || null;
  useEffect(() => {
    if (phase !== "ready") return;
    if (selectedId && items.some((item) => item.id === selectedId)) return;
    setSelectedId(items[0]?.id || "");
    setReplyOpen(false);
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
  const accountLabel = displayHandle(account) || atHandle(selected?.accountName) || displayName(account);

  function backToList() {
    setDetailOpen(false);
    setReplyOpen(false);
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
    setReplyOpen(false);
    setDraft("");
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
      onActivity?.();
    } catch {
      tell(COPY.actionFailed);
    } finally {
      setBusy("");
    }
  }

  async function sendReply() {
    const text = draft.trim();
    if (!text || !selected || !client) return;
    setBusy("reply");
    try {
      await client.reply(selected.id, text);
      setDraft("");
      setReplyOpen(false);
      setItems((current) =>
        current.map((row) => (row.id === selected.id ? { ...row, replied: true, read: true } : row)),
      );
      tell(replyPostedToast(selected.network), "success");
      onActivity?.();
      if (selected.postId) {
        const payload = await client.listComments(selected.postId);
        setThread(normalizeThread(payload, selected.network));
      }
    } catch {
      tell(COPY.actionFailed);
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    function onKey(event) {
      const tag = event.target?.tagName;
      if (tag && /input|textarea|select/i.test(tag)) return;
      if (event.key === "j" || event.key === "k") {
        const index = items.findIndex((item) => item.id === selected?.id);
        const next = event.key === "j" ? items[index + 1] : items[index - 1];
        if (next) void openItem(next);
      }
      if (event.key === "r" && selected) setReplyOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function changeHidden(comment, hidden) {
    if (!client) return;
    setThread((current) => mapComment(current, comment.id, (item) => ({ ...item, hidden })));
    try {
      await client.hideReply(comment.id, hidden);
    } catch {
      setThread((current) => mapComment(current, comment.id, (item) => ({ ...item, hidden: !hidden })));
      tell(COPY.actionFailed);
    }
  }

  async function confirmDelete() {
    if (!pending || !client) return;
    setBusy(pending.id);
    try {
      await client.removeComment(pending.id);
      setThread((current) => mapComment(current, pending.id, (item) => ({ ...item, deleted: true })));
      setItems((current) => current.filter((item) => item.id !== pending.id));
      setPending(null);
      onActivity?.();
    } catch {
      tell(COPY.actionFailed);
    } finally {
      setBusy("");
    }
  }

  const countFor = (id) => {
    if (!counts) return null;
    if (id === "all") return counts.all;
    if (id === "unread") return counts.unread;
    if (id === "unreplied") return counts.unreplied;
    return null;
  };

  return (
    <div className="eng-inbox" data-engagement="inbox" data-phase={phase} data-pane={pane}>
      <div className="page-head eng-inbox-head">
        <div>
          <h1>{COPY.inboxTitle}</h1>
          <p>{tier === "desktop" ? COPY.inboxSub : COPY.inboxSubMobile}</p>
        </div>
        <button
          type="button"
          className={`btn btn-secondary${tier === "desktop" ? "" : " btn-sm"}`}
          onClick={() => void markAll()}
          disabled={phase !== "ready" || items.length === 0 || busy === "all"}
        >
          <Check size={tier === "desktop" ? 16 : 14} />
          {tier === "desktop" ? "Mark all as read" : COPY.markAllRead}
        </button>
      </div>

      {phase === "ready" && banners.length ? (
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
        <div className="eng-filters-rest">
          <label className="eng-search">
            <Search size={16} />
            <input
              value={search}
              placeholder="Search comments"
              aria-label="Search comments"
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

      {phase === "error" ? (
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

      {phase === "loading" ? (
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

      {phase === "ready" && items.length === 0 ? (
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

      {phase === "ready" && items.length > 0 ? (
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
                      now={now}
                      replyId={replyOpen ? detailComment.id : ""}
                      drafts={{ [detailComment.id]: draft }}
                      setDrafts={(updater) => {
                        const next = typeof updater === "function" ? updater({ [detailComment.id]: draft }) : updater;
                        setDraft(next[detailComment.id] || "");
                      }}
                      busy={busy === "reply" ? detailComment.id : ""}
                      onAction={(comment, action) => {
                        if (action === "reply") setReplyOpen(true);
                        if (action === "hide") void changeHidden(comment, true);
                        if (action === "unhide") void changeHidden(comment, false);
                        if (action === "delete" || action === "remove") setPending(comment);
                      }}
                      onSend={() => void sendReply()}
                      onCancel={() => setReplyOpen(false)}
                    />
                  </div>
                </div>
                <div className="eng-inbox-tip">Tip: press R to reply, J / K to move between comments.</div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {pending && selected ? (
        <div className="eng-confirm-layer eng-confirm-fixed" role="alertdialog" aria-labelledby="eng-inbox-confirm">
          <div className="eng-confirm">
            <div className="eng-confirm-row">
              <span className="eng-confirm-icon">
                <Trash2 size={20} />
              </span>
              <div>
                <h3 id="eng-inbox-confirm">{deleteConfirmCopy(pending, selected.network).title}</h3>
                <p>{deleteConfirmCopy(pending, selected.network).body}</p>
              </div>
            </div>
            <div className="eng-confirm-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void confirmDelete()}>
                {deleteConfirmCopy(pending, selected.network).confirm}
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
