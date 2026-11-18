// Screenshot harness only. Sample rows live here, never in the app or a served path.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import InboxPage from "../../../frontend/src/engagement/InboxPage.jsx";
import PostDetailDrawer from "../../../frontend/src/engagement/PostDetailDrawer.jsx";
import "../../../frontend/src/theme/tokens.css";
import "../../../frontend/src/theme/design-scoped.css";
import "../../../frontend/src/sc/sc-shell.css";
import "../../../frontend/src/engagement/engagement.css";

const theme = new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.setAttribute("data-theme", theme);

function swatch(background, accent) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" fill="${background}"/><circle cx="80" cy="68" r="28" fill="${accent}"/><rect y="118" width="160" height="42" fill="#111827" opacity="0.15"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const IG_THUMB = swatch("#F4D7C5", "#8B5E3C");
const THREADS_THUMB = swatch("#E0E7FF", "#4F46E5");
const YOUTUBE_THUMB = swatch("#FEE2E2", "#DC2626");

const ACCOUNTS = [
  { id: "acc-ig", platform: "instagram", account_name: "Northwind Café", display_name: "Northwind Café", username: "northwind.cafe" },
  { id: "acc-fb", platform: "facebook", account_name: "Northwind Café", display_name: "Northwind Café" },
  { id: "acc-th", platform: "threads", account_name: "Northwind", display_name: "Northwind", username: "northwind" },
  { id: "acc-yt", platform: "youtube", account_name: "Northwind Studio", display_name: "Northwind Studio" },
];

const FEED = [
  {
    id: "post-ig",
    social_account_id: "acc-ig",
    network: "instagram",
    account_name: "Northwind Café",
    content: "Monday pour at the window seat. Oat milk, extra hot, and the last almond croissant.",
    media_thumb: IG_THUMB,
    published_at: "2026-11-16T02:15:00Z",
    comment_count: 3,
    unread_count: 2,
  },
  {
    id: "post-fb",
    social_account_id: "acc-fb",
    network: "facebook",
    account_name: "Northwind Café",
    content: "We're open early tomorrow for the neighborhood market. Come by before the good pastries go.",
    media_thumb: "",
    published_at: null,
    comment_count: 0,
    unread_count: 0,
  },
  {
    id: "post-th",
    social_account_id: "acc-th",
    network: "threads",
    account_name: "Northwind",
    content: "A quiet note from the counter: the winter blend is back.",
    media_thumb: THREADS_THUMB,
    published_at: "2026-11-14T15:40:00Z",
    comment_count: 1,
    unread_count: 0,
  },
  {
    id: "post-yt",
    social_account_id: "acc-yt",
    network: "youtube",
    account_name: "Northwind Studio",
    content: "How we pull a slow espresso shot, from the grind to the crema.",
    media_thumb: YOUTUBE_THUMB,
    published_at: "2026-11-12T18:05:00Z",
    comment_count: 12,
    unread_count: 1,
  },
];

const POSTS = FEED.map((row) => ({
  id: row.id,
  content: row.content,
  media_urls: row.media_thumb ? [row.media_thumb] : [],
  published_at: row.published_at,
  scheduled_at: row.published_at || "2026-11-10T09:00:00Z",
  status: "published",
  connected_account_id: row.social_account_id,
  provider_post_id: `${row.network}-sample`,
}));

const THREADS = {
  "post-ig": [
    {
      id: "c1",
      authorName: "Ada Lovelace",
      handle: "@ada",
      text: "The pour looks perfect. Saving this for Saturday.",
      createdAt: "2026-11-17T08:12:00Z",
      likes: 4,
      replies: [],
    },
    {
      id: "c2",
      authorName: "Grace Hopper",
      handle: "@grace",
      text: "Extra hot is the only way. See you at the market.",
      createdAt: "2026-11-17T09:40:00Z",
      likes: 1,
      replies: [],
    },
  ],
};

function Harness() {
  const [openId, setOpenId] = useState("");
  const post = POSTS.find((item) => item.id === openId) || null;
  return (
    <div className={`scd sc-app-root${theme === "dark" ? " dark" : ""}`}>
      <div className="content">
        <InboxPage
          accounts={ACCOUNTS}
          xEnabled={false}
          fixtures={{ view: "posts", phase: "ready", posts: FEED, counts: { all: 0, unread: 0, unreplied: 0, replied: 0 } }}
          onOpenPost={(id) => {
            const url = new URL(window.location.href);
            url.searchParams.set("post", id);
            window.history.pushState({ engagementPost: id }, "", url.pathname + url.search);
            setOpenId(id);
          }}
          onCreatePost={() => {}}
        />
      </div>
      {post ? (
        <PostDetailDrawer
          post={post}
          posts={POSTS}
          accounts={ACCOUNTS}
          xEnabled={false}
          initialTab="comments"
          fixtures={{ phase: "ready", threads: THREADS }}
          onClose={() => setOpenId("")}
        />
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Harness />);
