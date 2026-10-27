import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { EMOJI_CATEGORIES, EMOJI_SEARCH_ALIASES } from "./emojiData.js";

const pickerWidth = 336;

export default function EmojiPicker({ open, anchorRef, recent = [], onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(EMOJI_CATEGORIES[0].id);
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false });
  const pickerRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const placePicker = () => {
      const anchor = anchorRef?.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(pickerWidth, window.innerWidth - 24);
      const height = pickerRef.current?.offsetHeight || 380;
      const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
      const below = rect.bottom + 8;
      const top = below + height <= window.innerHeight - 12
        ? below
        : Math.max(12, rect.top - height - 8);
      setPosition({ top, left, ready: true });
    };
    placePicker();
    window.addEventListener("resize", placePicker);
    window.addEventListener("scroll", placePicker, true);
    return () => {
      window.removeEventListener("resize", placePicker);
      window.removeEventListener("scroll", placePicker, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (pickerRef.current?.contains(event.target) || anchorRef?.current?.contains(event.target)) return;
      onClose?.();
    };
    const onKeyDown = (event) => { if (event.key === "Escape") onClose?.(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, anchorRef, onClose]);

  const activeCategory = EMOJI_CATEGORIES.find((item) => item.id === category) || EMOJI_CATEGORIES[0];
  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const source = normalizedQuery
      ? EMOJI_CATEGORIES.flatMap((item) => item.emojis.trim().split(/\s+/))
      : activeCategory.emojis.trim().split(/\s+/);
    const unique = [...new Set(source)];
    if (!normalizedQuery) return unique;
    return unique.filter((emoji) => `${EMOJI_SEARCH_ALIASES[emoji] || ""} ${emoji}`.toLowerCase().includes(normalizedQuery));
  }, [activeCategory, query]);

  if (!open || typeof document === "undefined") return null;
  const choose = (emoji) => { onSelect?.(emoji); onClose?.(); setQuery(""); };

  return createPortal(
    <section
      ref={pickerRef}
      role="dialog"
      aria-label="Emoji picker"
      className="fixed z-[120] flex max-h-[min(420px,calc(100dvh-24px))] w-[min(336px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/95 p-3 text-slate-800 shadow-[0_22px_65px_rgba(15,23,42,.22)] backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100"
      style={{ top: position.top, left: position.left, visibility: position.ready ? "visible" : "hidden" }}
    >
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 dark:border-slate-700 dark:bg-slate-950/70">
        <Search size={15} className="shrink-0 text-slate-400" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search emoji"
          aria-label="Search emoji"
          className="h-10 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
        />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="rounded-full p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={13} /></button>}
      </div>

      {!query && <nav aria-label="Emoji categories" className="mt-2 flex gap-1 overflow-x-auto border-b border-slate-100 pb-2 dark:border-slate-800">
        {EMOJI_CATEGORIES.map((item) => <button
          key={item.id}
          type="button"
          title={item.label}
          aria-label={item.label}
          aria-pressed={category === item.id}
          onClick={() => setCategory(item.id)}
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-lg transition ${category === item.id ? "bg-indigo-50 ring-1 ring-indigo-200 dark:bg-indigo-950/60 dark:ring-indigo-800" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
        >{item.icon}</button>)}
      </nav>}

      {!query && recent.length > 0 && <div className="mt-2 border-b border-slate-100 pb-2 dark:border-slate-800"><p className="mb-1 px-1 text-[9px] font-extrabold uppercase tracking-wider text-slate-400">Recently used</p><div className="grid grid-cols-8 gap-0.5">{recent.slice(0, 8).map((emoji) => <EmojiButton key={`recent-${emoji}`} emoji={emoji} onClick={choose} />)}</div></div>}

      <div className="mb-1 mt-2 flex items-center justify-between px-1"><h3 className="text-[10px] font-extrabold text-slate-600 dark:text-slate-300">{query ? "Search results" : activeCategory.label}</h3><span className="text-[9px] text-slate-400">{results.length}</span></div>
      <div className="min-h-0 max-h-56 flex-1 overflow-y-auto overscroll-contain pr-0.5">
        {results.length ? <div className="grid grid-cols-8 gap-0.5">{results.map((emoji) => <EmojiButton key={emoji} emoji={emoji} onClick={choose} />)}</div> : <p className="py-8 text-center text-xs text-slate-400">No emoji found. Try another search.</p>}
      </div>
    </section>,
    document.body,
  );
}

function EmojiButton({ emoji, onClick }) {
  const title = EMOJI_SEARCH_ALIASES[emoji];
  return <button type="button" onClick={() => onClick(emoji)} aria-label={title || emoji} title={title || emoji} className="grid h-9 w-full place-items-center rounded-lg text-[22px] leading-none transition hover:scale-110 hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:hover:bg-slate-800 dark:focus:bg-slate-800">{emoji}</button>;
}
