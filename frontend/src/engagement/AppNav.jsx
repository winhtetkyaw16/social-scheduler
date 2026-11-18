// Desktop sidebar, desktop top bar, and the phone/tablet menu drawer.
import React from "react";
import {
  BarChart3,
  Bell,
  CalendarDays,
  CheckCircle,
  FileText,
  Home,
  Image as ImageIcon,
  Inbox,
  Link2,
  List,
  Menu,
  MessageSquare,
  Moon,
  Plus,
  Settings2,
  Share2,
  SlidersHorizontal,
  Sun,
  Users,
  X,
} from "lucide-react";
import { Avatar } from "../sc/ui.jsx";
import { NAV_GROUPS, menuUnreadDot, navBadge } from "../navModel.js";

const ICONS = {
  home: Home,
  plus: Plus,
  calendar: CalendarDays,
  list: List,
  "file-text": FileText,
  "check-circle": CheckCircle,
  inbox: Inbox,
  "bar-chart": BarChart3,
  "share-2": Share2,
  image: ImageIcon,
  users: Users,
  "sliders-horizontal": SlidersHorizontal,
  link: Link2,
  "message-square": MessageSquare,
};

export function BrandLockup({ size = "xl" }) {
  return (
    <div className={`snav-logo${size === "base" ? " is-base" : ""}`}>
      <span className="snav-mark" aria-hidden="true">
        <span className="snav-mark-ring" />
      </span>
      <span className="snav-word">
        <span className="snav-social">social</span>castly
      </span>
    </div>
  );
}

function NavList({ counts, activeId, isActive, mobile, onNavigate }) {
  return (
    <div className="snav-nav">
      {NAV_GROUPS.map((group) => (
        <div className="snav-group" key={group.label}>
          <div className="snav-label">{group.label}</div>
          <div className="snav-list">
            {group.items.map((item) => {
              const Icon = ICONS[item.icon] || Home;
              const on = isActive(item.id) || activeId === item.id;
              const badge = navBadge(item.id, counts);
              return (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={`snav-item${on ? " is-on" : ""}${mobile ? " is-m" : ""}`}
                  aria-current={on ? "page" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate(item.id);
                  }}
                >
                  <Icon size={16} strokeWidth={2} />
                  <span className="snav-label-text">{item.label}</span>
                  {badge ? (
                    <span className={`snav-badge${badge.strong ? " is-strong" : ""}`}>{badge.text}</span>
                  ) : null}
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkspaceCard({ workspace, channels, scheduled, dark, onToggleTheme, onSignOut }) {
  const channelLabel = `${channels} channel${channels === 1 ? "" : "s"}`;
  return (
    <div className="snav-card">
      <b>{workspace || "My Workspace"}</b>
      <p>
        {channelLabel} · {scheduled} scheduled
      </p>
      <div className="snav-card-row">
        <button type="button" className="snav-mini" onClick={onToggleTheme} aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>
          {dark ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
          {dark ? "Light" : "Dark"}
        </button>
        <button type="button" className="snav-mini is-ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

export function AppSidebar(props) {
  return (
    <aside className="sidebar sc-sidebar snav-side">
      <BrandLockup />
      <nav aria-label="Main navigation">
        <NavList {...props} mobile={false} />
      </nav>
      <WorkspaceCard {...props} />
    </aside>
  );
}

export function AppTopbar({
  dark,
  onToggleTheme,
  onNotifications,
  onNewPost,
  onAccount,
  user,
  inboxUnread,
  onOpenMenu,
}) {
  return (
    <header className="topbar snav-top">
      <button type="button" className="snav-icon snav-burger" aria-label="Open menu" onClick={onOpenMenu}>
        <Menu size={20} strokeWidth={2} />
        {menuUnreadDot(inboxUnread) ? <span className="snav-dot" /> : null}
      </button>
      <span className="snav-mlogo">
        <BrandLockup size="base" />
      </span>
      <div className="snav-desk">
        <button
          type="button"
          className="snav-icon"
          aria-label={`Switch to ${dark ? "light" : "dark"} theme`}
          onClick={onToggleTheme}
        >
          {dark ? <Sun size={18} strokeWidth={2} /> : <Moon size={18} strokeWidth={2} />}
        </button>
        <button type="button" className="snav-icon" aria-label="Notifications" onClick={onNotifications}>
          <Bell size={18} strokeWidth={2} />
        </button>
        <button type="button" className="btn btn-primary" onClick={onNewPost}>
          <Plus size={16} strokeWidth={2} />
          New post
        </button>
        <a
          href="#settings"
          className="snav-account"
          onClick={(event) => {
            event.preventDefault();
            onAccount();
          }}
        >
          <Avatar name={user?.full_name || "W"} size={32} />
          <div>
            <b>{user?.full_name || "Workspace member"}</b>
            <span>{user?.workspace_name || "Workspace"}</span>
          </div>
        </a>
      </div>
      <div className="snav-mob">
        <button type="button" className="snav-icon" aria-label="Notifications" onClick={onNotifications}>
          <Bell size={20} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="snav-icon"
          aria-label="Account"
          onClick={onAccount}
        >
          <Avatar name={user?.full_name || "W"} size={28} />
        </button>
      </div>
    </header>
  );
}

export function AppMenu({ open, onClose, ...props }) {
  if (!open) return null;
  return (
    <>
      <button type="button" className="snav-scrim" aria-label="Close menu" onClick={() => onClose(false)} />
      <aside className="snav-drawer" aria-label="Menu">
        <div className="snav-drawer-head">
          <BrandLockup size="base" />
          <button type="button" className="snav-icon" aria-label="Close menu" onClick={() => onClose(false)}>
            <X size={20} strokeWidth={2} />
          </button>
        </div>
        <NavList {...props} mobile />
        <WorkspaceCard {...props} />
      </aside>
    </>
  );
}
