import { Image, Play } from "lucide-react";

function GridTile({ src, caption, video, current = false, index = 0 }) {
  return <div className={`group relative aspect-square overflow-hidden ${current ? "ring-2 ring-inset ring-indigo-500" : ""}`}>
    {src ? <img src={src} alt={current ? "Current post preview" : `Published Instagram post ${index + 1}`} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" /> : <div className={`grid h-full w-full place-items-center bg-gradient-to-br ${current ? "from-indigo-100 via-purple-100 to-blue-100 text-indigo-500 dark:from-indigo-950 dark:via-purple-950 dark:to-blue-950" : "from-slate-100 to-slate-200 text-slate-400 dark:from-slate-800 dark:to-slate-900"}`}>{video ? <Play size={20} /> : <Image size={20} />}</div>}
    {video && <span className="absolute right-1.5 top-1.5 rounded bg-black/60 p-1 text-white"><Play size={11} fill="currentColor" /></span>}
    {current && <span className="absolute left-1.5 top-1.5 rounded-md bg-indigo-600 px-1.5 py-1 text-[8px] font-extrabold uppercase tracking-wide text-white shadow">Your post</span>}
    <div className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-5 text-[9px] leading-3 text-white opacity-0 transition group-hover:opacity-100">{caption || (current ? "Current draft" : "Published post")}</div>
  </div>;
}

export default function InstagramGridPlanner({ account, posts = [], currentMediaUrl = "", caption = "", isVideo = false }) {
  const safePosts = Array.isArray(posts) ? posts.filter((post) => post && typeof post === "object") : [];
  const previousPosts = safePosts
    .filter((post) => post.connected_account_id === account?.id && post.status === "published" && post.provider_post_id)
    .sort((a, b) => new Date(b.published_at || b.scheduled_at || b.created_at) - new Date(a.published_at || a.scheduled_at || a.created_at))
    .slice(0, 8);
  const tiles = [{ id: "current", current: true, src: currentMediaUrl, caption, video: isVideo }, ...previousPosts.map((post, index) => ({
    id: post.id,
    published: true,
    src: post.media_urls?.[0] || "",
    caption: typeof post.content === "string" ? post.content : "",
    video: /\.(mp4|mov|webm|m4v|ogv)(\?|$)/i.test(post.media_urls?.[0] || ""),
    index,
  }))];
  while (tiles.length < 9) tiles.push({ id: `empty-${tiles.length}` });

  return <section className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white">
    <header className="flex items-center gap-3 border-b border-slate-100 p-4 dark:border-slate-800"><span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 text-sm font-extrabold text-white">{(account?.account_name || "S").slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold">{account?.account_name || "Instagram profile"}</p><p className="text-[10px] text-slate-500">Profile grid preview · newest post first</p></div><span className="rounded-full bg-indigo-50 px-2 py-1 text-[9px] font-bold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200">3 × 3</span></header>
    <div className="grid grid-cols-3 gap-0.5 bg-white dark:bg-slate-900">{tiles.slice(0, 9).map((tile) => tile.current || tile.published ? <GridTile key={tile.id} {...tile} /> : <div key={tile.id} className="aspect-square bg-slate-100 dark:bg-slate-900" />)}</div>
    <p className="px-4 py-3 text-[10px] leading-4 text-slate-500 dark:text-slate-400">The current post appears in the first tile. Published posts from this Instagram account fill the remaining spaces.</p>
  </section>;
}
