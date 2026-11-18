/** Sidebar order and badge rules from the nav spec. No React. */

export const NAV_GROUPS = [
  {
    label: "Workspace",
    items: [
      { id: "home", label: "Dashboard", icon: "home" },
      { id: "studio", label: "Create post", icon: "plus" },
      { id: "calendar", label: "Calendar", icon: "calendar" },
      { id: "queue", label: "Queue", icon: "list" },
      { id: "drafts", label: "Drafts", icon: "file-text" },
      { id: "approvals", label: "Approvals", icon: "check-circle" },
      { id: "inbox", label: "Inbox", icon: "inbox" },
    ],
  },
  { label: "Insights", items: [{ id: "analytics", label: "Analytics", icon: "bar-chart" }] },
  {
    label: "Manage",
    items: [
      { id: "accounts", label: "Channels", icon: "share-2" },
      { id: "media", label: "Media library", icon: "image" },
      { id: "team", label: "Team", icon: "users" },
      { id: "settings", label: "Settings", icon: "sliders-horizontal" },
    ],
  },
  {
    label: "More",
    items: [
      { id: "biolink", label: "Bio Link", icon: "link" },
      { id: "community", label: "Community", icon: "message-square" },
    ],
  },
];

export function navBadge(id, counts = {}) {
  const n = Number(counts[id]) || 0;
  if (n <= 0) return null;
  return { text: n > 99 ? "99+" : String(n), strong: id === "inbox" };
}

/** The phone menu dot is only present while Inbox still has unread comments. */
export function menuUnreadDot(unread) {
  return Math.max(0, Number(unread) || 0) > 0;
}

/** Mark all read clears the sidebar badge and the menu dot immediately. */
export function unreadAfterMarkAllRead() {
  return 0;
}

/** Desktop items are 36px. The phone and tablet drawer uses 40px. */
export function navItemHeight(tier) {
  return tier === "desktop" ? 36 : 40;
}
