import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import PublishSection, { toLocalInputValue } from "./PublishSection.jsx";
import LivePreview from "./LivePreview.jsx";
import BioLinkDashboard from "./BioLinkDashboard.jsx";
import ComposerChannelEditor from "./ComposerChannelEditor.jsx";
import EmojiPicker from "./EmojiPicker.jsx";
import RenderErrorBoundary from "./RenderErrorBoundary.jsx";
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, AtSign, BarChart3, Bookmark, CalendarDays, Expand,
  Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, Code2, FileText, Film, Flame,
  Globe2, Hash, Heart, Home, ImagePlus, Instagram, Linkedin, Link2, ListTodo, LoaderCircle, MessageCircle,
  MessagesSquare, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Send, Share2, GripVertical, Pencil,
  Settings2, Shrink, Smile, Sparkles, Sun, Target, ThumbsUp, Upload, Video, WandSparkles, X as XIcon, Youtube,
} from "lucide-react";
import facebookPng from "./assets/facebook.png";
import instagramPng from "./assets/instagram.png";
import linkedinPng from "./assets/linkedin.png";
import pinterestPng from "./assets/pinterest.png";
import tiktokPng from "./assets/tiktok.png";
import xPng from "./assets/x.png";
import youtubePng from "./assets/youtube.png";
import "./styles.css";

const API_BASE = (import.meta.env.VITE_API_BASE || `${window.location.origin}/api/v1`).replace(/\/$/, "");
const API_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, "");
const TOKEN_KEY = "social_studio_access_token";
const REFRESH_KEY = "social_studio_refresh_token";
const OAUTH_PLATFORMS = new Set(["x", "linkedin", "instagram"]);
let sessionAccessToken = "";
let sessionRefreshHandler = null;
let refreshInFlight = null;
const THEME_KEY = "social_studio_theme";
const MAX_CHARS = 10000;

const CHANNELS = [
  { id: "x", label: "X", icon: "𝕏", brand: "#111827", limit: 280 },
  { id: "facebook", label: "Facebook", icon: "f", brand: "#1877F2", limit: 63206 },
  { id: "instagram", label: "Instagram", icon: "◎", brand: "#D94687", limit: 2200 },
  { id: "youtube", label: "YouTube", icon: "▶", brand: "#FF0033", limit: 5000 },
  { id: "tiktok", label: "TikTok", icon: "♪", brand: "#111827", limit: 2200 },
  { id: "linkedin", label: "LinkedIn", icon: "in", brand: "#0A66C2", limit: 3000 },
  { id: "pinterest", label: "Pinterest", icon: "p", brand: "#BD081C", limit: 500 },
];
const SUPPORTED_FORMATS = {
  x: ["Post", "Reel / Video"], facebook: ["Post", "Reel / Video", "Story"],
  instagram: ["Post", "Reel / Video", "Story"], youtube: ["Post", "Reel / Video", "Short"],
  tiktok: ["Post", "Reel / Video", "Story"], linkedin: ["Post", "Reel / Video"],
  pinterest: ["Post", "Reel / Video"],
};
const DEFAULT_POST_SETTINGS = {
  tiktok: { audience: "Public", allow_comments: true, allow_duet: true, allow_stitch: true },
  youtube: { privacy_status: "Public", made_for_kids: false, category: "People & Blogs" },
  facebook: { audience: "Public", location: "", first_comment: "", media_layout: "Grid" },
  instagram: { hide_counts: false, disable_comments: false, alt_text: "", location: "", media_layout: "Carousel / Swipe" },
  linkedin: { visibility: "Anyone", commenting: "Anyone", media_layout: "Grid" },
  x: { reply_permission: "Everyone", media_layout: "Grid" },
  pinterest: { board: "Brand inspiration", destination_url: "", alt_text: "" },
};
const VARIABLES = ["{{brand_name}}", "{{call_to_action}}", "{{website_url}}"];
const COMPOSER_TEMPLATES = [
  { name: "Product launch", text: "Meet {{brand_name}}.\n\nWe made this for people who want more from every post.\n\nReady to take a look? {{call_to_action}}" },
  { name: "Quick tip", text: "Quick tip: {{topic}}\n\nHere’s one small change you can try today: {{tip}}\n\nSave this for later and tell us what you think." },
  { name: "Behind the scenes", text: "A little behind the scenes at {{brand_name}} ✨\n\nHere’s what we’ve been working on—and why it matters to you.\n\nMore here: {{website_url}}" },
];
const TIMEZONES = (() => {
  try { return Intl.supportedValuesOf("timeZone"); } catch { return ["UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Bangkok", "Asia/Tokyo"]; }
})();
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function readStoredValue(key) {
  try { return localStorage.getItem(key) || sessionStorage.getItem(key) || ""; }
  catch { return ""; }
}

function persistSession(token, refreshToken, user, remember) {
  sessionAccessToken = token || "";
  try {
    const destination = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    destination.setItem(TOKEN_KEY, token);
    if (refreshToken) destination.setItem(REFRESH_KEY, refreshToken);
    destination.setItem("social_studio_full_name", user.full_name || "");
    destination.setItem("social_studio_workspace_name", user.workspace_name || "");
    [TOKEN_KEY, REFRESH_KEY, "social_studio_full_name", "social_studio_workspace_name"].forEach((key) => other.removeItem(key));
  } catch {
    // Authentication should still transition if browser storage is disabled.
  }
}

function clearStoredSession() {
  sessionAccessToken = "";
  try {
    [localStorage, sessionStorage].forEach((storage) => {
      storage.removeItem(TOKEN_KEY);
      storage.removeItem(REFRESH_KEY);
      storage.removeItem("social_studio_full_name");
      storage.removeItem("social_studio_workspace_name");
    });
  } catch {
    // In-memory auth state is cleared even when browser storage is unavailable.
  }
}

function getErrorMessage(body, fallback) {
  if (typeof body?.detail === "string") return body.detail;
  if (Array.isArray(body?.detail)) return body.detail.map((item) => item.msg || "Invalid input").join(" · ");
  return fallback;
}

function isVideoMedia(item) {
  if (typeof item === "string") return /\.(mp4|mov|webm|m4v|ogv)(\?|$)/i.test(item);
  return Boolean(item?.type?.startsWith("video/"));
}

async function getMediaDimensions(file) {
  if (!file) return null;
  if (file.type?.startsWith("image/") && typeof createImageBitmap === "function") {
    try { const bitmap = await createImageBitmap(file); const result = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return result; } catch { return null; }
  }
  if (!file.type?.startsWith("video/")) return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (value) => { URL.revokeObjectURL(url); video.removeAttribute("src"); resolve(value); };
    video.preload = "metadata";
    video.onloadedmetadata = () => done({ width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => done(null);
    video.src = url;
  });
}

async function suggestFormatForMedia(files, platform) {
  const supported = SUPPORTED_FORMATS[platform] || ["Post"];
  const media = Array.from(files || []).filter((file) => file?.type?.startsWith("image/") || file?.type?.startsWith("video/"));
  if (!media.length) return "";
  const videos = media.filter((file) => file.type.startsWith("video/"));
  if (!videos.length) return supported.includes("Post") ? "Post" : supported[0];
  const dimensions = await getMediaDimensions(videos[0]);
  const vertical = dimensions?.height > dimensions?.width * 1.15;
  const candidate = vertical && platform === "youtube" ? "Short"
    : !vertical && (platform === "instagram" || platform === "facebook") ? "Post"
      : "Reel / Video";
  return supported.includes(candidate) ? candidate : supported.includes("Post") ? "Post" : supported[0];
}

function sessionRemembered() {
  try { return Boolean(localStorage.getItem(REFRESH_KEY) || localStorage.getItem(TOKEN_KEY)); }
  catch { return true; }
}

async function refreshAccessToken() {
  const refreshToken = readStoredValue(REFRESH_KEY);
  if (!refreshToken) return "";
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      let response;
      try {
        response = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
      } catch {
        return "";
      }
      if (!response.ok) return "";
      const body = await response.json().catch(() => null);
      if (!body?.access_token) return "";
      const user = {
        full_name: body.full_name || readStoredValue("social_studio_full_name"),
        workspace_name: body.workspace_name || readStoredValue("social_studio_workspace_name"),
      };
      persistSession(body.access_token, body.refresh_token || refreshToken, user, sessionRemembered());
      sessionRefreshHandler?.(body.access_token);
      return body.access_token;
    })().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function api(path, { token, _retried = false, ...options } = {}) {
  const bearer = token || sessionAccessToken;
  const headers = new Headers(options.headers || {});
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let response;
  try { response = await fetch(`${API_BASE}${path}`, { ...options, headers }); }
  catch { throw new Error("Could not reach SocialStudio. Check that the API is running and try again."); }
  if (response.status === 401 && !_retried && !["/auth/refresh", "/auth/login", "/auth/token"].includes(path)) {
    const next = await refreshAccessToken();
    if (next) return api(path, { ...options, token: next, _retried: true });
  }
  if (response.status === 204) return null;
  const text = await response.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = { detail: text }; } }
  if (!response.ok) throw Object.assign(new Error(getErrorMessage(body, `Request failed (${response.status})`)), { status: response.status });
  return body;
}

sessionAccessToken = readStoredValue(TOKEN_KEY);

function dateInZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function zonedDateTimeToISO(dateValue, timeValue, timeZone) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return "";
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(+values.year, +values.month - 1, +values.day, +values.hour, +values.minute);
    const adjustment = desired - represented;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(candidate).toISOString();
}

function makeIdempotencyKey() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  const success = toast.kind === "success";
  return <div role="status" className={`fixed bottom-5 right-5 z-[100] flex max-w-sm items-start gap-3 rounded-2xl border p-4 shadow-2xl animate-fade-up ${success ? "border-emerald-200 bg-white text-slate-900" : "border-rose-200 bg-white text-slate-900"}`}>
    {success ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" /> : <CircleHelp className="mt-0.5 h-5 w-5 text-rose-500" />}
    <div className="min-w-0 flex-1"><p className="text-sm font-bold">{toast.title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{toast.message}</p></div>
    <button onClick={onClose} aria-label="Dismiss notification" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><XIcon size={15} /></button>
  </div>;
}

function AuthScreen({ onAuthenticated, dark, toggleTheme, remember, setRemember }) {
  const [mode, setMode] = useState("login");
  const [fields, setFields] = useState({ full_name: "", workspace_name: "", email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (event) => setFields((previous) => ({ ...previous, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      if (mode === "signup") {
        await api("/auth/signup", { method: "POST", body: JSON.stringify(fields) });
      }
      const result = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: fields.email, password: fields.password }) });
      onAuthenticated(result, fields);
    } catch (cause) { setError(cause.message || "Unable to sign in. Please try again."); }
    finally { setBusy(false); }
  }
  const shell = dark ? "bg-[#0b1020] text-slate-100" : "bg-[#f6f7fb] text-slate-900";
  return <main className={`min-h-screen ${shell} grid lg:grid-cols-[minmax(0,1.02fr)_minmax(480px,.98fr)]`}>
    <section className="auth-hero relative hidden overflow-hidden px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
      <div className="relative z-10 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/10"><Sparkles size={19} /></div><span className="font-display text-lg font-extrabold tracking-tight">social<span className="text-indigo-300">studio</span></span></div>
      <div className="relative z-10 max-w-xl"><span className="rounded-full border border-indigo-300/20 bg-indigo-300/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.18em] text-indigo-200">Your creative command center</span><h1 className="mt-7 font-display text-5xl font-extrabold leading-[1.08] tracking-[-.055em] xl:text-6xl">Make every post<br /><span className="text-gradient">count.</span></h1><p className="mt-6 max-w-md text-base leading-7 text-slate-300">Create with clarity. Plan with confidence. Bring every channel together in one beautiful workspace.</p>
        <div className="mt-10 space-y-4 text-sm text-slate-200"><div className="flex items-center gap-3"><CheckCircle2 className="text-indigo-300" size={18} />One focused workspace for every channel</div><div className="flex items-center gap-3"><CheckCircle2 className="text-indigo-300" size={18} />A live preview that keeps your content in context</div><div className="flex items-center gap-3"><CheckCircle2 className="text-indigo-300" size={18} />Private, encrypted account credentials</div></div>
      </div>
      <div className="relative z-10 flex items-center gap-2 text-xs text-slate-400"><Globe2 size={14} />Built for teams with a lot to say.</div>
    </section>
    <section className="flex min-h-screen flex-col justify-center px-5 py-8 sm:px-10 lg:px-16 xl:px-24">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-9 flex items-center justify-between lg:justify-end"><div className="flex items-center gap-2 font-display font-extrabold lg:hidden"><Sparkles size={18} className="text-indigo-600" />socialstudio</div><button type="button" onClick={toggleTheme} className="icon-button" aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div>
        <span className="text-[11px] font-extrabold uppercase tracking-[.18em] text-indigo-600">Welcome to SocialStudio</span><h2 className="mt-3 font-display text-3xl font-extrabold tracking-[-.045em]">{mode === "login" ? "Welcome back" : "Create your workspace"}</h2><p className="mt-2 text-sm text-slate-500">{mode === "login" ? "Sign in to pick up where your ideas left off." : "A better rhythm for your social starts here."}</p>
        <div className="mt-7 grid grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"><button onClick={() => { setMode("login"); setError(""); }} className={`rounded-lg py-2.5 text-sm font-bold ${mode === "login" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500"}`}>Sign in</button><button onClick={() => { setMode("signup"); setError(""); }} className={`rounded-lg py-2.5 text-sm font-bold ${mode === "signup" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500"}`}>Create account</button></div>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "signup" && <><Field label="Full name"><input autoComplete="name" required maxLength={160} value={fields.full_name} onChange={set("full_name")} placeholder="Alex Morgan" /></Field><Field label="Workspace name"><input autoComplete="organization" required maxLength={160} value={fields.workspace_name} onChange={set("workspace_name")} placeholder="My Agency Workspace" /></Field></>}
          <Field label="Email address"><div className="field-icon"><AtSign size={16} /><input type="email" autoComplete="email" required value={fields.email} onChange={set("email")} placeholder="you@company.com" /></div></Field>
          <Field label="Password"><div className="password-field"><input type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 10 : 1} maxLength={128} value={fields.password} onChange={set("password")} placeholder={mode === "signup" ? "At least 10 characters" : "Your password"} /><button type="button" onClick={() => setShowPassword((v) => !v)}>{showPassword ? "Hide" : "Show"}</button></div></Field>
          {mode === "signup" && <label className="flex items-start gap-2.5 text-xs leading-5 text-slate-500"><input required type="checkbox" className="mt-1 accent-indigo-600" /><span>I agree to the <a href="#terms" className="font-semibold text-indigo-600">Terms of Service</a> and <a href="#privacy" className="font-semibold text-indigo-600">Privacy Policy</a>.</span></label>}
          {mode === "login" && <div className="flex items-center justify-between text-xs"><label className="flex items-center gap-2 text-slate-500"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="accent-indigo-600" />Remember me</label><button type="button" className="font-semibold text-indigo-600" onClick={() => setError("Password recovery is not configured yet. Contact your workspace administrator.")}>Forgot password?</button></div>}
          {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs leading-5 text-rose-700">{error}</div>}
          <button disabled={busy} className="primary-button flex w-full items-center justify-center gap-2 !py-3.5">{busy ? <LoaderCircle size={17} className="animate-spin" /> : null}{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}<ArrowRight size={16} /></button>
          {mode === "signup" && <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-500 dark:bg-slate-800"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />Passwords are protected and your workspace is private.</div>}
        </form>
      </div>
    </section>
  </main>;
}

function Field({ label, children }) { return <label className="block space-y-1.5"><span className="text-xs font-bold text-slate-700 dark:text-slate-200">{label}</span>{children}</label>; }

function useObjectUrl(file) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) { setUrl(""); return undefined; }
    const nextUrl = URL.createObjectURL(file); setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  return url;
}

function MediaThumb({ file, onRemove, onEdit, onDragStart, onDragOver, onDrop }) {
  const url = useObjectUrl(file);
  return <div className="media-thumb group" draggable onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} title="Drag to reorder">
    <div className="h-full w-full overflow-hidden rounded-xl">{file.type.startsWith("video/") ? <video src={url} className="h-full w-full object-cover" muted /> : <img src={url} alt={file.name} className="h-full w-full object-cover" />}</div>
    <span className="absolute left-1 top-1 grid h-6 w-6 cursor-grab place-items-center rounded-full bg-slate-950/70 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100"><GripVertical size={13} /></span>
    <button type="button" title={`Edit ${file.name}`} aria-label={`Edit ${file.name}`} onClick={onEdit} className="absolute right-8 top-1 grid h-6 w-6 place-items-center rounded-full bg-indigo-600 text-white opacity-100 shadow transition hover:bg-indigo-500 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"><Pencil size={11} /></button>
    <button type="button" title={`Remove ${file.name}`} aria-label={`Remove ${file.name}`} onClick={onRemove} className="media-remove"><XIcon size={12} /></button><span className="media-name">{file.name}</span>
  </div>;
}

function ChannelIcon({ channel, size = 17 }) {
  const icon = { instagram: <Instagram size={size} />, linkedin: <Linkedin size={size} />, youtube: <Youtube size={size} /> }[channel.id];
  return icon || <span className="inline-grid min-w-[17px] place-items-center font-extrabold leading-none" style={{ fontSize: channel.id === "x" ? size : size - 2 }}>{channel.icon}</span>;
}

const CHANNEL_BRAND_PNGS = { facebook: facebookPng, instagram: instagramPng, linkedin: linkedinPng, pinterest: pinterestPng, tiktok: tiktokPng, x: xPng, youtube: youtubePng };
function ChannelBrandImage({ channelId }) {
  const channel = CHANNELS.find((item) => item.id === channelId);
  const source = CHANNEL_BRAND_PNGS[channelId] || facebookPng;

  return (
    <div
      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full aspect-square bg-white p-1 shadow-sm ring-1 ring-slate-200/80"
      style={{ backgroundColor: "#fff" }}
    >
      <img
        src={source}
        alt=""
        aria-hidden="true"
        title={channel?.label || "Social channel"}
        className="block h-full w-full transform-none object-contain"
      />
    </div>
  );
}

function accountPickerName(account) {
  return String(account.display_name || account.account_name || "").trim() || "Connected account";
}

function accountPickerHandle(account) {
  const handle = String(account.platform_account_id || "").trim();
  const name = accountPickerName(account);
  if (!handle || handle === name) return "";
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function ChannelAccountPicker({ channel, accounts, selectedIds, toggleAccount, onConnect, anchorRef, onClose }) {
  const pickerRef = useRef(null);
  const [layout, setLayout] = useState(() => ({
    top: 0,
    left: 0,
    ready: false,
    sheet: typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches,
  }));
  const selectedCount = accounts.filter((account) => selectedIds.includes(account.id)).length;

  useLayoutEffect(() => {
    const place = () => {
      const sheet = window.matchMedia("(max-width: 639px)").matches;
      if (sheet) {
        setLayout((current) => (current.ready && current.sheet ? current : { top: 0, left: 0, ready: true, sheet: true }));
        return;
      }
      const anchor = anchorRef?.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24);
      const height = pickerRef.current?.offsetHeight || 280;
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const below = rect.bottom + 8;
      const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - height - 8);
      setLayout((current) => (
        current.ready && !current.sheet && current.top === top && current.left === left
          ? current
          : { top, left, ready: true, sheet: false }
      ));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, accounts.length, selectedCount]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const close = () => onCloseRef.current?.();
    const onPointerDown = (event) => {
      if (pickerRef.current?.contains(event.target) || anchorRef?.current?.contains(event.target)) return;
      close();
    };
    const onKeyDown = (event) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef]);

  useEffect(() => {
    if (!layout.sheet) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [layout.sheet]);

  useEffect(() => {
    pickerRef.current?.focus();
  }, []);

  function selectAll() {
    accounts.forEach((account) => {
      if (!selectedIds.includes(account.id)) toggleAccount(account.id);
    });
  }

  function clearSelected() {
    accounts.forEach((account) => {
      if (selectedIds.includes(account.id)) toggleAccount(account.id);
    });
  }

  const body = (
    <>
      {layout.sheet && <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true" />}
      <div className="flex items-start justify-between gap-3 px-3 pb-1 pt-3">
        <div className="min-w-0">
          <p className="text-xs font-extrabold text-slate-900 dark:text-slate-100">{channel.label} accounts</p>
          <p className="mt-0.5 text-[10px] text-slate-500">{selectedCount} of {accounts.length} selected for this post</p>
        </div>
        <button type="button" onClick={onClose} className="icon-button !h-7 !w-7 shrink-0" aria-label={`Close ${channel.label} accounts`}><XIcon size={14} /></button>
      </div>
      <div className="flex items-center gap-3 px-3 pb-1">
        <button type="button" onClick={selectAll} disabled={selectedCount === accounts.length} className="text-[10px] font-bold text-indigo-600 disabled:cursor-not-allowed disabled:text-slate-300 dark:text-indigo-300 dark:disabled:text-slate-600">Select all</button>
        <button type="button" onClick={clearSelected} disabled={selectedCount === 0} className="text-[10px] font-bold text-slate-500 disabled:cursor-not-allowed disabled:text-slate-300 dark:text-slate-400 dark:disabled:text-slate-600">Clear</button>
      </div>
      <ul className="max-h-64 space-y-0.5 overflow-y-auto px-2 py-1" aria-label={`${channel.label} accounts`}>
        {accounts.map((account) => {
          const checked = selectedIds.includes(account.id);
          const name = accountPickerName(account);
          const handle = accountPickerHandle(account);
          return (
            <li key={account.id}>
              <label className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/80 ${checked ? "bg-indigo-50/80 dark:bg-indigo-950/40" : ""}`}>
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-indigo-600" checked={checked} onChange={() => toggleAccount(account.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-slate-800 dark:text-slate-100">{name}</span>
                  {handle && <span className="block truncate text-[10px] text-slate-400">{handle}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className={`border-t border-slate-100 p-2 dark:border-slate-800 ${layout.sheet ? "pb-[max(12px,env(safe-area-inset-bottom))]" : ""}`}>
        <button type="button" onClick={() => { onClose?.(); onConnect(channel); }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left text-xs font-bold text-indigo-600 transition hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40">
          <Plus size={14} /> Connect another {channel.label} account
        </button>
      </div>
    </>
  );

  if (typeof document === "undefined") return null;

  if (layout.sheet) {
    return createPortal(
      <div className="modal-backdrop !items-end !justify-center !p-0" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
        <section ref={pickerRef} id="channel-account-picker" role="dialog" aria-modal="true" aria-label={`${channel.label} accounts`} tabIndex={-1} className="modal-card w-full max-w-lg !rounded-b-none !rounded-t-[20px] !p-0 outline-none">
          {body}
        </section>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <section
      ref={pickerRef}
      id="channel-account-picker"
      role="dialog"
      aria-label={`${channel.label} accounts`}
      tabIndex={-1}
      className="fixed z-[120] w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-[0_22px_65px_rgba(15,23,42,.18)] outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      style={{ top: layout.top, left: layout.left, visibility: layout.ready ? "visible" : "hidden" }}
    >
      {body}
    </section>,
    document.body,
  );
}

function ChannelBar({ accounts, selectedIds, toggleAccount, openConnect }) {
  const [openChannelId, setOpenChannelId] = useState("");
  const anchors = useRef({});
  const activeByPlatform = useMemo(() => {
    const map = new Map();
    accounts.filter((account) => account.is_active).forEach((account) => {
      const group = map.get(account.platform) || []; group.push(account); map.set(account.platform, group);
    });
    return map;
  }, [accounts]);
  const openChannel = CHANNELS.find((channel) => channel.id === openChannelId) || null;
  const openAccounts = openChannel ? activeByPlatform.get(openChannel.id) || [] : [];

  function anchorFor(channelId) {
    if (!anchors.current[channelId]) anchors.current[channelId] = { current: null };
    return anchors.current[channelId];
  }

  return <section className="surface-card px-4 py-4 sm:px-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-extrabold">Choose your channels</h2><p className="mt-0.5 text-[11px] text-slate-500">Open a channel and choose which accounts should receive this post.</p></div><span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{accounts.filter((a) => a.is_active).length} connected</span></div>
    <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Select social channels">{CHANNELS.map((channel) => {
      const connected = activeByPlatform.get(channel.id) || [];
      const selectedCount = connected.filter((account) => selectedIds.includes(account.id)).length;
      const selected = selectedCount > 0;
      const open = openChannelId === channel.id;
      const label = selectedCount > 0 ? `${channel.label} · ${selectedCount}` : channel.label;
      return <button key={channel.id} ref={(node) => { anchorFor(channel.id).current = node; }} type="button" aria-pressed={selected} aria-expanded={connected.length ? open : undefined} aria-haspopup={connected.length ? "dialog" : undefined} aria-controls={open ? "channel-account-picker" : undefined} onClick={() => { if (!connected.length) { openConnect(channel); return; } setOpenChannelId((current) => current === channel.id ? "" : channel.id); }} className={`channel-pill ${selected ? "channel-pill-active" : ""} ${connected.length ? "" : "channel-pill-offline"}`} style={selected ? { "--channel-color": channel.brand } : {}} title={connected.length ? (selectedCount ? `${selectedCount} of ${connected.length} ${channel.label} ${connected.length === 1 ? "account" : "accounts"} selected` : `${connected.length} ${channel.label} ${connected.length === 1 ? "account" : "accounts"} connected — click to choose`) : `${channel.label} is not connected — click to add an account`}>
        <ChannelBrandImage channelId={channel.id} /><span className="whitespace-nowrap">{label}</span>{connected.length ? <ChevronDown size={12} className={`shrink-0 opacity-70 transition-transform ${open ? "rotate-180" : ""}`} /> : <Plus size={12} className="text-slate-400" />}</button>;
    })}</div>
    {selectedIds.length > 0 && <p className="mt-2 text-[10px] text-slate-500">{selectedIds.length} account{selectedIds.length === 1 ? "" : "s"} selected · Open a channel to change which accounts receive this post</p>}
    {openChannel && openAccounts.length > 0 && <ChannelAccountPicker channel={openChannel} accounts={openAccounts} selectedIds={selectedIds} toggleAccount={toggleAccount} onConnect={openConnect} anchorRef={anchorFor(openChannel.id)} onClose={() => setOpenChannelId("")} />}
  </section>;
}

function ScheduleControls({ mode, setMode, date, setDate, time, setTime, timeZone, setTimeZone }) {
  const minDate = dateInZone(new Date(), timeZone);
  return <section className="space-y-3"><div className="flex items-center justify-between"><div><h3 className="section-title">When should it go live?</h3><p className="section-hint">Choose a time that works for your audience.</p></div><Clock3 size={17} className="text-indigo-500" /></div>
    <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"><button type="button" onClick={() => setMode("now")} className={`mode-pill ${mode === "now" ? "mode-pill-active" : ""}`}><Send size={13} />Post now</button><button type="button" onClick={() => setMode("schedule")} className={`mode-pill ${mode === "schedule" ? "mode-pill-active" : ""}`}><CalendarDays size={13} />Schedule later</button></div>
    {mode === "schedule" && <div className="grid grid-cols-2 gap-2"><label className="control-label">Date<input required type="date" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} /></label><label className="control-label">Time<input required type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label><label className="control-label col-span-2">Timezone<select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>{!TIMEZONES.includes(timeZone) && <option value={timeZone}>{timeZone}</option>}{TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz.replaceAll("_", " ")}</option>)}</select></label><div className="col-span-2 flex flex-wrap gap-1.5">{[["Tomorrow · 9:00 AM", 1, "09:00"], ["In 3 hours", 0, ""]].map(([label, day, clock]) => <button type="button" key={label} onClick={() => { const next = new Date(Date.now() + (label === "In 3 hours" ? 3 * 60 * 60 * 1000 : 0)); if (label !== "In 3 hours") next.setDate(next.getDate() + Number(day)); setDate(dateInZone(next, timeZone)); setTime(clock || new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(next)); }} className="quick-time">{label}</button>)}</div></div>}
  </section>;
}

function MediaDropzone({ files, setFiles, uploadBusy, setToast, openTool, onEditFile, onFilesAdded }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const hasFilePayload = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
  const addFiles = (list) => {
    const incoming = Array.from(list || []).filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
    if (incoming.length !== (list?.length ?? 0)) setToast({ title: "Unsupported file", message: "Choose an image or video file." });
    setFiles((old) => [...old, ...incoming].slice(0, 10));
    if (incoming.length) onFilesAdded?.(incoming);
  };
  return <div>
    <input ref={inputRef} className="sr-only" type="file" accept="image/*,video/*" multiple onChange={(e) => { addFiles(e.target.files || []); e.target.value = ""; }} />
    <div
      onDragEnter={(event) => {
        if (!hasFilePayload(event)) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!hasFilePayload(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!hasFilePayload(event)) return;
        event.preventDefault();
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        if (!hasFilePayload(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`dropzone ${dragging ? "dropzone-active" : ""}`}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
      }}
    >
      <span className="dropzone-icon"><Upload size={18} /></span><span className="text-sm font-bold">{uploadBusy ? "Uploading your media…" : "Drop photos or videos here"}</span><span className="text-[11px] text-slate-500">or <span className="font-bold text-indigo-600">browse files</span> · up to 10 files</span>
    </div>
    {files.length > 0 && <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">{files.map((file, index) => <MediaThumb key={`${file.name}-${file.lastModified}-${index}`} file={file} onEdit={() => onEditFile(file)} onRemove={(e) => { e.stopPropagation(); setFiles((current) => current.filter((_, i) => i !== index)); }} onDragStart={(event) => { event.dataTransfer.setData("text/plain", String(index)); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const from = Number(event.dataTransfer.getData("text/plain")); const to = index; if (!Number.isInteger(from) || from === to) return; setFiles((current) => { const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next; }); }} />)}</div>}
    <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => openTool("image")} className="tool-launch"><WandSparkles size={13} />Mini Canva / Image Editor</button><button type="button" onClick={() => openTool("video")} className="tool-launch"><Film size={13} />Video Studio</button></div>
  </div>;
}

function WritingTools({ caption, setCaption }) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState([]);
  const [hashtagsOpen, setHashtagsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const textarea = useRef(null);
  const emojiButton = useRef(null);
  function insert(value) {
    const input = textarea.current; if (!input) { setCaption((old) => `${old}${old ? " " : ""}${value}`); return; }
    const start = input.selectionStart ?? caption.length; const end = input.selectionEnd ?? start;
    const next = `${caption.slice(0, start)}${value}${caption.slice(end)}`; setCaption(next);
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + value.length, start + value.length); });
  }
  const suggestions = [...new Set((caption.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).filter((word) => !["that", "with", "your", "this", "from", "have", "just", "what"].includes(word)))].slice(0, 5).map((word) => `#${word}`);
  function polish(action) {
    const words = caption.trim();
    if (action === "hashtags") { setHashtagsOpen((old) => !old); return; }
    if (action === "grammar") { setCaption(caption.replace(/\s+/g, " ").replace(/\bi\b/g, "I").replace(/(^|[.!?]\s+)([a-z])/g, (_, start, char) => start + char.toUpperCase())); return; }
    if (words) setCaption(`${words.replace(/[.!?\s]+$/, "")}\n\nWhat do you think? 👇`);
  }
  return <div className="rounded-2xl border border-slate-200 bg-white transition focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-900">
    <textarea ref={textarea} value={caption} maxLength={MAX_CHARS} onChange={(e) => setCaption(e.target.value)} rows={expanded ? 12 : 7} placeholder="What would you like to share? Write a first line that makes people stop scrolling…" className={`${expanded ? "min-h-[280px]" : "min-h-[170px]"} w-full resize-y rounded-2xl border-0 bg-transparent px-4 py-3.5 text-sm leading-6 outline-none placeholder:text-slate-400 focus:ring-0 transition-[min-height]`} />
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 dark:border-slate-800"><div className="flex flex-wrap gap-1.5"><button type="button" onClick={() => polish("viral")} className="writing-action"><Sparkles size={12} />Make it viral</button><button type="button" onClick={() => polish("grammar")} className="writing-action">✓ Fix grammar</button><button type="button" onClick={() => polish("hashtags")} className={`writing-action ${hashtagsOpen ? "writing-action-selected" : ""}`}><Hash size={12} />Generate hashtags</button><button type="button" onClick={() => insert("https://")} className="writing-action" title="Insert a link"><Link2 size={12} />Link</button></div><div className="flex items-center gap-1"><button type="button" onClick={() => setExpanded((value) => !value)} className="emoji-button" aria-label={expanded ? "Collapse caption editor" : "Expand caption editor"} title={expanded ? "Collapse editor" : "Expand editor"}>{expanded ? <Shrink size={15} /> : <Expand size={15} />}</button><button ref={emojiButton} type="button" className="emoji-button" aria-label="Open emoji picker" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((old) => !old)}><Smile size={17} /></button></div></div>
    {hashtagsOpen && <div className="border-t border-slate-100 px-3 py-2 dark:border-slate-800"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Suggested hashtags · select to insert</p><div className="flex flex-wrap gap-1.5">{(suggestions.length ? suggestions : ["#socialmedia", "#contentcreator", "#yourbrand"]).map((tag) => <button key={tag} onClick={() => insert(`${caption.endsWith(" ") || !caption ? "" : " "}${tag}`)} className="variable-pill !text-indigo-600">{tag}</button>)}</div></div>}
    <EmojiPicker open={emojiOpen} anchorRef={emojiButton} recent={recentEmojis} onClose={() => setEmojiOpen(false)} onSelect={(emoji) => { insert(emoji); setRecentEmojis((current) => [emoji, ...current.filter((item) => item !== emoji)].slice(0, 8)); }} />
    <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-3 py-2 dark:border-slate-800"><span className="mr-1 text-[9px] font-extrabold tracking-[.15em] text-slate-400">INSERT</span>{VARIABLES.map((variable) => <button key={variable} type="button" onClick={() => insert(variable)} className="variable-pill">{variable}</button>)}<span className={`ml-auto text-[10px] font-semibold ${caption.length > MAX_CHARS - 200 ? "text-amber-600" : "text-slate-400"}`}>{caption.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}</span></div>
  </div>;
}

function QuickStudioDialog({ tool, files, selectedFile, onClose, onToast }) {
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [fit, setFit] = useState("cover");
  if (!tool) return null;
  const file = selectedFile || files.find((item) => item.type.startsWith(tool === "video" ? "video/" : "image/"));
  return <QuickStudioDialogContent tool={tool} file={file} brightness={brightness} setBrightness={setBrightness} contrast={contrast} setContrast={setContrast} fit={fit} setFit={setFit} onClose={onClose} onToast={onToast} />;
}

function QuickStudioDialogContent({ tool, file, brightness, setBrightness, contrast, setContrast, fit, setFit, onClose, onToast }) {
  const fileUrl = useObjectUrl(file);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="quick-studio-title" className="modal-card max-w-lg">
    <div className="flex items-start justify-between"><div><span className="eyebrow">QUICK CREATIVE TOOLS</span><h2 id="quick-studio-title" className="mt-1 font-display text-xl font-extrabold">{tool === "image" ? "Mini Canva / Image Editor" : "Video Studio"}</h2></div><button onClick={onClose} className="icon-button" aria-label="Close"><XIcon size={17} /></button></div>
    {!file ? <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-7 text-center dark:border-slate-700 dark:bg-slate-800"><ImagePlus size={24} className="mx-auto text-indigo-500" /><p className="mt-2 text-sm font-bold">Add {tool === "video" ? "a video" : "an image"} to get started</p><p className="mt-1 text-xs text-slate-500">Your media will appear here as soon as you upload it in the composer.</p></div> : tool === "image" ? <div className="mt-4 space-y-4"><div className="overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-800"><img src={fileUrl} alt="Image editing preview" className="max-h-72 w-full object-contain" style={{ filter: `brightness(${brightness}%) contrast(${contrast}%)`, objectFit: fit }} /></div><label className="control-label">Brightness · {brightness}%<input type="range" min="50" max="150" value={brightness} onChange={(e) => setBrightness(+e.target.value)} /></label><label className="control-label">Contrast · {contrast}%<input type="range" min="50" max="150" value={contrast} onChange={(e) => setContrast(+e.target.value)} /></label><label className="control-label">Image crop<select value={fit} onChange={(e) => setFit(e.target.value)}><option value="cover">Fill frame</option><option value="contain">Fit entire image</option></select></label><p className="text-[10px] leading-4 text-slate-500">Adjustments are a live preview. The original uploaded image remains unchanged.</p></div> : <div className="mt-4 space-y-3"><video controls playsInline src={fileUrl} className="max-h-72 w-full rounded-2xl bg-black" /><p className="text-xs leading-5 text-slate-500">Review your video here before scheduling. Trim and export tools depend on a media editing service, which is not part of this API.</p></div>}
    <div className="mt-5 flex justify-end"><button onClick={() => { onToast({ title: "Preview ready", message: "Your media preview is up to date." }); onClose(); }} className="primary-button !px-5 !py-2.5">Done</button></div>
  </section></div>;
}

function ConnectDialog({ channel, onClose, onConnect, busy, error }) {
  if (!channel) return null;
  const supported = OAUTH_PLATFORMS.has(channel.id);
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}><div className="modal-card max-w-md" role="dialog" aria-modal="true" aria-labelledby="connect-title"><div className="flex items-start justify-between"><div><span className="eyebrow">CONNECT SOCIAL ACCOUNT</span><h2 id="connect-title" className="mt-1 font-display text-xl font-extrabold">Connect {channel.label}</h2></div><button type="button" onClick={onClose} className="icon-button"><XIcon size={17} /></button></div>{supported ? <p className="mt-2 text-xs leading-5 text-slate-500">You’ll continue to {channel.label} to authorize SocialStudio. The access token is encrypted before it is stored and is never sent back to the browser.</p> : <p className="mt-2 text-xs leading-5 text-slate-500">Publishing is available for X, LinkedIn, and Instagram. {channel.label} can’t be connected, because posts to it would fail.</p>}{error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button>{supported && <button type="button" disabled={busy} onClick={() => onConnect(channel.id)} className="primary-button !px-5 !py-2.5">{busy ? "Redirecting…" : `Continue with ${channel.label}`}</button>}</div></div></div>;
}

function MetricCard({ icon: Icon, label, value, detail, accent, progress, footnote }) {
  return <article className="dashboard-metric group relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white/75 p-5 shadow-[0_12px_36px_rgba(21,32,66,.045)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_48px_rgba(62,53,160,.10)] dark:border-slate-800 dark:bg-slate-900/75 sm:p-6">
    <div className={`metric-orb ${accent}`} />
    <div className="relative flex items-start justify-between"><div><p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</p><p className="mt-3 font-display text-3xl font-extrabold tracking-[-.06em] text-slate-900 dark:text-white">{value}</p><p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{detail}</p></div><span className={`metric-icon ${accent}`}><Icon size={18} /></span></div>
    {progress !== undefined && <div className="relative mt-5"><div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 transition-all" style={{ width: `${Math.min(progress, 100)}%` }} /></div><p className="mt-2 text-[10px] font-semibold text-slate-400">{footnote}</p></div>}
    {progress === undefined && <p className="relative mt-5 text-[10px] font-semibold text-slate-400">{footnote}</p>}
  </article>;
}

function HomeDashboard({ user, accounts, posts, openStudio, openConnect, openPlaceholder, openApiDocs }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(timer); }, []);
  const firstName = user.full_name?.trim().split(/\s+/)[0] || "there";
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const weekStart = new Date(now); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const confirmedPosts = posts.filter((post) => post.status === "published" && post.provider_post_id);
  const weekPosts = confirmedPosts.filter((post) => { const date = new Date(post.published_at || post.scheduled_at); return date >= weekStart && date <= now; }).length;
  const weeklyGoal = 5;
  const analyticsPosts = confirmedPosts.flatMap((post) => {
    const analytics = post.post_metadata?.analytics;
    if (!analytics || analytics.source === "simulated") return [];
    const engagements = Number(analytics.engagements ?? analytics.engagement_count);
    const commentCount = Number(analytics.comments ?? analytics.comment_count);
    return [{ engagements: Number.isFinite(engagements) ? engagements : 0, comments: Number.isFinite(commentCount) ? commentCount : 0 }];
  });
  const engagement = analyticsPosts.reduce((sum, item) => sum + item.engagements, 0);
  const comments = analyticsPosts.reduce((sum, item) => sum + item.comments, 0);
  const failedPosts = posts.filter((post) => post.status === "failed");
  const activeChannels = accounts.filter((account) => account.is_active);
  const upcoming = posts.filter((post) => ["scheduled", "queued", "publishing"].includes(post.status) && new Date(post.scheduled_at) > now).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)).slice(0, 4);
  const stepsDone = [activeChannels.length > 0, posts.length > 0, false].filter(Boolean).length;
  const postedDayKeys = new Set(confirmedPosts.map((post) => new Date(post.published_at || post.created_at).toDateString()));
  let streak = 0;
  const streakCursor = new Date(now); streakCursor.setHours(0, 0, 0, 0);
  if (!postedDayKeys.has(streakCursor.toDateString())) streakCursor.setDate(streakCursor.getDate() - 1);
  while (postedDayKeys.has(streakCursor.toDateString()) && streak < 365) { streak += 1; streakCursor.setDate(streakCursor.getDate() - 1); }
  return <div className="animate-fade-up space-y-6 pb-12">
    <section className="dashboard-hero relative overflow-hidden rounded-[30px] border border-white/70 px-6 py-7 shadow-[0_22px_70px_rgba(41,39,112,.12)] backdrop-blur-xl dark:border-slate-700/70 sm:px-8 sm:py-9">
      <div className="hero-grid" /><div className="relative z-10 flex flex-wrap items-end justify-between gap-5"><div className="max-w-2xl"><span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.16em] text-indigo-100 backdrop-blur-md"><Sparkles size={13} />Your creative command center</span><h1 className="mt-5 font-display text-3xl font-extrabold leading-tight tracking-[-.055em] text-white sm:text-[40px]">{greeting}, {firstName}<span className="text-indigo-300">.</span></h1><p className="mt-2 max-w-lg text-sm leading-6 text-slate-300">Your ideas are ready to meet the world. Here’s what’s happening in your workspace.</p><div className="mt-5 flex flex-wrap gap-2"><button onClick={openStudio} className="primary-button inline-flex items-center gap-2 !border-white/20 !bg-gradient-to-r !from-indigo-500 !via-purple-500 !to-blue-500 !px-4 !py-2.5 !shadow-[0_8px_28px_rgba(99,102,241,.35)]"><Plus size={15} />Create a post</button><button onClick={() => openPlaceholder("Calendar")} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-[11px] font-bold text-white backdrop-blur-md transition hover:bg-white/15"><CalendarDays size={14} />View calendar</button></div></div><div className="date-badge"><CalendarDays size={15} /><span>{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(now)}</span></div></div>
      <div className="hero-glow hero-glow-one" /><div className="hero-glow hero-glow-two" />
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <MetricCard icon={Flame} label="Publishing streak" value={`${streak} day${streak === 1 ? "" : "s"}`} detail={streak ? "You’re building a steady rhythm" : "Your next confirmed post starts the streak"} accent="metric-violet" footnote={streak ? "Consecutive days with a provider-confirmed post." : "Only posts with a provider post id count."} />
      <MetricCard icon={Target} label="Weekly posting goal" value={`${Math.min(weekPosts, weeklyGoal)} / ${weeklyGoal}`} detail="confirmed posts this week" accent="metric-blue" progress={(weekPosts / weeklyGoal) * 100} footnote={`${Math.max(weeklyGoal - weekPosts, 0)} more confirmed posts to reach this week’s goal${failedPosts.length ? ` · ${failedPosts.length} failed` : ""}`} />
      <MetricCard icon={Heart} label="Engagement & comments" value={analyticsPosts.length ? engagement.toLocaleString() : "—"} detail={analyticsPosts.length ? `${comments.toLocaleString()} comments on posts with provider analytics` : "No provider analytics yet"} accent="metric-pink" footnote={analyticsPosts.length ? `Based on ${analyticsPosts.length} confirmed post${analyticsPosts.length === 1 ? "" : "s"}` : confirmedPosts.length ? `${confirmedPosts.length} confirmed publish${confirmedPosts.length === 1 ? "" : "es"} and no provider metrics` : "Metrics appear only after a provider confirms the post"} />
    </section>
    {failedPosts.length > 0 && <section className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100"><b>{failedPosts.length} post{failedPosts.length === 1 ? "" : "s"} failed after a provider attempt.</b><ul className="mt-2 space-y-1">{failedPosts.slice(0, 3).map((post) => <li key={post.id}>{post.last_error_message || post.last_error_code || "The provider did not accept this post."}{post.latest_execution_outcome ? ` · log ${post.latest_execution_outcome}` : ""}</li>)}</ul></section>}

    <section><div className="mb-3 flex items-end justify-between gap-3"><div><span className="eyebrow">A GREAT PLACE TO START</span><h2 className="mt-1 font-display text-lg font-extrabold tracking-tight">First steps</h2></div><span className="text-[10px] font-semibold text-slate-400">{stepsDone} of 3 complete</span></div><div className="grid gap-3 md:grid-cols-3">
      <button onClick={() => openConnect(activeChannels.length ? CHANNELS.find((channel) => !activeChannels.some((account) => account.platform === channel.id)) || CHANNELS[0] : CHANNELS[0])} className="first-step-card text-left"><span className="first-step-icon bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300"><Globe2 size={18} /></span><span className="first-step-body"><b>{activeChannels.length ? "Connect another channel" : "Connect a channel"}</b><small>{activeChannels.length ? `${activeChannels.length} active · Add another account` : "Bring your socials into one workspace"}</small></span><span className="step-state"><span className={activeChannels.length ? "step-complete" : "step-number"}>{activeChannels.length ? <Check size={13} /> : "01"}</span><ChevronRight size={15} /></span></button>
      <button onClick={openStudio} className="first-step-card text-left"><span className="first-step-icon bg-purple-50 text-purple-600 dark:bg-purple-950/50 dark:text-purple-300"><Sparkles size={18} /></span><span className="first-step-body"><b>Create your first post</b><small>Draft once, preview across channels</small></span><span className="step-state"><span className="step-number">02</span><ChevronRight size={15} /></span></button>
      <button onClick={openApiDocs} className="first-step-card text-left"><span className="first-step-icon bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300"><Code2 size={18} /></span><span className="first-step-body"><b>Explore API & automations</b><small>Open the API docs and integration endpoints</small></span><span className="step-state"><span className="step-number">03</span><ChevronRight size={15} /></span></button>
    </div></section>

    <section className="grid items-start gap-4 xl:grid-cols-[1.08fr_.92fr]">
      <article className="dashboard-panel"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800"><div><span className="eyebrow">YOUR PUBLISHING PLAN</span><h2 className="mt-1 font-display text-base font-extrabold">Up next</h2></div><button onClick={() => openPlaceholder("Publish calendar")} className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-700">View calendar<ArrowRight size={13} /></button></div>
        {upcoming.length ? <div className="divide-y divide-slate-100 dark:divide-slate-800">{upcoming.map((post) => { const account = accounts.find((item) => item.id === post.connected_account_id); const platform = CHANNELS.find((item) => item.id === account?.platform); return <div key={post.id} className="flex items-center gap-3 px-5 py-3.5"><span className="up-next-icon" style={{ color: platform?.brand || "#6366f1" }}>{platform ? <ChannelBrandImage channelId={platform.id} /> : <CalendarDays size={15} />}</span><div className="min-w-0 flex-1"><p className="line-clamp-1 text-xs font-semibold">{post.content}</p><p className="mt-1 text-[10px] text-slate-400">{account?.account_name || account?.platform || "Connected account"} · {new Date(post.scheduled_at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p></div><span className="status-chip">{post.status}</span></div>; })}</div> : <div className="empty-dashboard-state"><span className="empty-dashboard-icon"><ListTodo size={19} /></span><b>Nothing on the schedule yet</b><p>Your upcoming posts will show up here.</p><button onClick={openStudio} className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600">Create a post<ArrowRight size={12} /></button></div>}
      </article>
      <article className="dashboard-panel"><div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800"><span className="eyebrow">THE CONVERSATION</span><h2 className="mt-1 font-display text-base font-extrabold">Recent comments</h2></div><div className="empty-dashboard-state min-h-[222px]"><span className="empty-dashboard-icon"><MessagesSquare size={19} /></span><b>Your community, all in one place</b><p>Recent comments will appear here when community inbox integrations are available.</p><button onClick={() => openPlaceholder("Community")} className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600">Explore community<ArrowRight size={12} /></button></div></article>
    </section>
  </div>;
}

function App() {
  const [token, setToken] = useState(() => readStoredValue(TOKEN_KEY));
  const [isLoggedIn, setIsLoggedIn] = useState(() => Boolean(readStoredValue(TOKEN_KEY)));
  const [user, setUser] = useState(() => ({ full_name: readStoredValue("social_studio_full_name"), workspace_name: readStoredValue("social_studio_workspace_name") }));
  const [dark, setDark] = useState(() => readStoredValue(THEME_KEY) === "dark");
  const [accounts, setAccounts] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [formatsByAccount, setFormatsByAccount] = useState({});
  const [formatOverridesByAccount, setFormatOverridesByAccount] = useState({});
  const [platformSettingsByAccount, setPlatformSettingsByAccount] = useState({});
  const [caption, setCaption] = useState("");
  const [captionMode, setCaptionMode] = useState("universal");
  const [captionsByAccount, setCaptionsByAccount] = useState({});
  const [useUniversalCaptionByAccount, setUseUniversalCaptionByAccount] = useState({});
  const [channelFiles, setChannelFiles] = useState({});
  const [channelMediaUrlsByAccount, setChannelMediaUrlsByAccount] = useState({});
  const [useSharedMediaByAccount, setUseSharedMediaByAccount] = useState({});
  const [writingTool, setWritingTool] = useState(null);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState([]);
  const [libraryMediaUrls, setLibraryMediaUrls] = useState([]);
  const [scheduleMode, setScheduleMode] = useState("schedule");
  const [date, setDate] = useState(() => dateInZone(new Date(Date.now() + 60 * 60 * 1000), localZone));
  const [time, setTime] = useState(() => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Date.now() + 60 * 60 * 1000)));
  const [timeZone, setTimeZone] = useState(localZone);
  const [device, setDevice] = useState("mobile");
  const [previewId, setPreviewId] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [editingDraftId, setEditingDraftId] = useState("");
  const [quickTool, setQuickTool] = useState(null);
  const [quickFile, setQuickFile] = useState(null);
  const [connectChannel, setConnectChannel] = useState(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [posts, setPosts] = useState([]);
  const [localDrafts, setLocalDrafts] = useState([]);
  const [showQueue, setShowQueue] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [remember, setRemember] = useState(true);
  const toastTimer = useRef(null);
  const mediaUrls = useRef(new Map());
  const formatOverridesRef = useRef({});

  const notify = useCallback((next) => { setToast(next); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 5500); }, []);
  const authenticatedFetch = useCallback((path, options = {}) => api(path, { ...options, token }), [token]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch { /* Theme still works for this session. */ }
  }, [dark]);

  useEffect(() => () => { window.clearTimeout(toastTimer.current); mediaUrls.current.forEach((url) => URL.revokeObjectURL(url)); }, []);

  const loadWorkspace = useCallback(async (activeToken = token) => {
    if (!activeToken) return;
    setLoadingAccounts(true); setLoadError("");
    try {
      const [accountData, postData] = await Promise.all([
        api("/accounts", { token: activeToken }), api("/posts", { token: activeToken }),
      ]);
      const list = Array.isArray(accountData) ? accountData : [];
      setAccounts(list); setPosts(Array.isArray(postData) ? postData : []);
      const active = list.filter((item) => item.is_active);
      setPlatformSettingsByAccount((current) => active.reduce((next, account) => {
        if (!next[account.id]) next[account.id] = { ...(DEFAULT_POST_SETTINGS[account.platform] || {}) };
        return next;
      }, { ...current }));
      setSelectedIds((previous) => previous.filter((id) => active.some((item) => item.id === id)));
    } catch (error) {
      if (error.status === 401) { clearStoredSession(); setToken(""); setIsLoggedIn(false); }
      else setLoadError(error.message);
    } finally { setLoadingAccounts(false); }
  }, [token]);

  useEffect(() => { if (token) void loadWorkspace(token); }, [token, loadWorkspace]);

  const selectedAccounts = useMemo(() => accounts.filter((account) => selectedIds.includes(account.id) && account.is_active), [accounts, selectedIds]);
  const previewAccount = selectedAccounts.find((item) => item.id === previewId) || selectedAccounts[0] || null;
  const previewChannel = CHANNELS.find((item) => item.id === previewAccount?.platform) || null;
  const formatForAccount = (account) => formatsByAccount[account?.id] || "Post";
  const setAccountFormat = (accountId, nextFormat) => {
    setPreviewId(accountId);
    setFormatsByAccount((current) => ({ ...current, [accountId]: nextFormat }));
    formatOverridesRef.current = { ...formatOverridesRef.current, [accountId]: true };
    setFormatOverridesByAccount((current) => ({ ...current, [accountId]: true }));
  };
  const setPlatformSetting = (accountId, key, value) => {
    setPlatformSettingsByAccount((current) => ({
      ...current, [accountId]: { ...(current[accountId] || {}), [key]: value },
    }));
  };
  const postLimit = Math.min(previewChannel?.limit || MAX_CHARS, MAX_CHARS);
  const captionForAccount = (account) => captionMode === "custom" && useUniversalCaptionByAccount[account?.id] === false ? (captionsByAccount[account?.id] ?? caption) : caption;
  const mediaForAccount = (account) => {
    const shared = [...files, ...libraryMediaUrls];
    if (captionMode === "universal") return shared;
    const custom = Array.isArray(channelFiles[account?.id]) ? channelFiles[account.id] : [];
    const savedCustom = Array.isArray(channelMediaUrlsByAccount[account?.id]) ? channelMediaUrlsByAccount[account.id] : [];
    return useSharedMediaByAccount[account?.id] !== false ? [...shared, ...savedCustom, ...custom] : [...savedCustom, ...custom];
  };
  const previewCaption = captionForAccount(previewAccount);
  const previewMediaItems = useMemo(() => mediaForAccount(previewAccount), [captionMode, channelFiles, channelMediaUrlsByAccount, useSharedMediaByAccount, files, libraryMediaUrls, previewAccount?.id]);
  const previewFiles = useMemo(() => previewMediaItems.filter((item) => typeof item !== "string"), [previewMediaItems]);
  const previewMediaUrls = useMemo(() => previewMediaItems.filter((item) => typeof item === "string"), [previewMediaItems]);
  const channelWarnings = useMemo(() => selectedAccounts.flatMap((account) => {
    const media = mediaForAccount(account);
    const hasVideo = media.some(isVideoMedia);
    const format = formatForAccount(account);
    const text = captionForAccount(account);
    const channel = CHANNELS.find((item) => item.id === account.platform);
    const limit = Math.min(channel?.limit || MAX_CHARS, MAX_CHARS);
    const warnings = [];
    if (!(SUPPORTED_FORMATS[account.platform] || ["Post"]).includes(format)) warnings.push(`${format} is not available for ${channel?.label || account.platform}; choose a supported format.`);
    if (!text.trim()) warnings.push("Add a caption for this channel.");
    if (text.length > limit) warnings.push(`Caption is over this channel’s ${limit.toLocaleString()} character limit.`);
    if ((format === "Short" || format === "Reel / Video") && !hasVideo) warnings.push(`Please include a video for this ${format === "Short" ? "Short" : "video post"}.`);
    if (format === "Story" && !media.length) warnings.push("Add a photo or video to create this Story.");
    return warnings.map((message) => ({ account, message }));
  }), [selectedAccounts, captionMode, captionsByAccount, useUniversalCaptionByAccount, caption, channelFiles, channelMediaUrlsByAccount, useSharedMediaByAccount, files, libraryMediaUrls, formatsByAccount]);

  async function suggestFormatsForAccounts(newFiles, targetAccounts = selectedAccounts) {
    const safeTargets = Array.isArray(targetAccounts) ? targetAccounts : [];
    const suggestions = await Promise.all(safeTargets.map(async (account) => [account.id, await suggestFormatForMedia(newFiles, account.platform)]));
    const detected = Object.fromEntries(suggestions.filter(([, value]) => value));
    setFormatsByAccount((current) => Object.entries(detected).reduce((next, [accountId, value]) => {
      if (!formatOverridesRef.current[accountId]) next[accountId] = value;
      return next;
    }, { ...current }));
  }

  function updateTargetCaption(transform) {
    if (captionMode === "custom") {
      const target = selectedAccounts.find((account) => account.id === previewId) || selectedAccounts[0];
      if (!target) { setCaption((current) => transform(current)); return; }
      setUseUniversalCaptionByAccount((current) => ({ ...current, [target.id]: false }));
      setCaptionsByAccount((current) => ({ ...current, [target.id]: transform(useUniversalCaptionByAccount[target.id] === false ? (current[target.id] ?? caption) : caption) }));
      return;
    }
    setCaption((current) => transform(current));
  }

  function applyWritingHelper(kind) {
    updateTargetCaption((value) => {
      const text = value.trim();
      if (kind === "grammar") return text ? text.charAt(0).toUpperCase() + text.slice(1).replace(/\s+([,.!?])/g, "$1") : text;
      if (kind === "hashtags") return `${text}${text ? "\n\n" : ""}#SocialMedia #ContentCreation #Marketing`;
      return text && !/^(stop scrolling|here's the idea|here’s the idea)/i.test(text) ? `Here’s the idea: ${text}` : text;
    });
    setWritingTool(null);
  }

  function openPlaceholder(name) { notify({ title: `${name} is coming soon`, message: "This workspace view will be available as the product grows." }); }
  function goToTab(tab) { if (["home", "studio", "publish", "biolink"].includes(tab)) { setActiveTab(tab); window.scrollTo({ top: 0, behavior: "smooth" }); } else openPlaceholder(tab); }
  function openApiDocs() { window.open(`${API_ORIGIN}/docs`, "_blank", "noopener,noreferrer"); }

  function handleAuthenticated(result, submitted) {
    const accessToken = result?.access_token;
    if (!accessToken) throw new Error("The sign-in response did not include an access token.");
    const nextUser = { full_name: result.full_name || submitted.full_name, workspace_name: result.workspace_name || submitted.workspace_name };
    // Update React first so a storage restriction cannot prevent the dashboard from mounting.
    setUser(nextUser);
    setToken(accessToken);
    setIsLoggedIn(true);
    setActiveTab("home");
    setLoadError("");
    persistSession(accessToken, result.refresh_token, nextUser, remember);
    notify({ title: "You’re signed in", message: "Your workspace is ready when you are.", kind: "success" });
  }

  function logout() {
    clearStoredSession();
    setIsLoggedIn(false); setToken(""); setAccounts([]); setSelectedIds([]); setPosts([]); setActiveTab("home");
    setCaption(""); setCaptionsByAccount({}); setUseUniversalCaptionByAccount({}); setCaptionMode("universal"); setTitle(""); setFiles([]); setLibraryMediaUrls([]); setLocalDrafts([]);
    setChannelFiles({}); setChannelMediaUrlsByAccount({}); setUseSharedMediaByAccount({}); setFormatsByAccount({}); setFormatOverridesByAccount({});
    formatOverridesRef.current = {}; setPlatformSettingsByAccount({}); setEditingDraftId("");
  }

  function toggleAccount(id) { setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); setPreviewId(""); }

  function changeCaptionMode(nextMode) {
    if (nextMode === "custom") {
      setCaptionsByAccount((current) => {
        const existing = current && typeof current === "object" && !Array.isArray(current) ? current : {};
        return selectedAccounts.reduce((next, account) => {
          next[account.id] = typeof existing[account.id] === "string" ? existing[account.id] : caption;
          return next;
        }, { ...existing });
      });
      setUseUniversalCaptionByAccount((current) => ({ ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}) }));
    }
    setCaptionMode(nextMode === "custom" ? "custom" : "universal");
  }

  async function uploadFiles(fileList) {
    if (!fileList?.length) return [];
    return Promise.all(fileList.map(async (file) => {
        const body = new FormData(); body.append("file", file);
        const result = await authenticatedFetch("/upload", { method: "POST", body });
        return new URL(result.url, `${API_ORIGIN}/`).href;
      }));
  }

  async function saveAsDraft() {
    if (!caption.trim() && !Object.values(captionsByAccount).some((value) => String(value || "").trim()) && !files.length && !libraryMediaUrls.length && !Object.values(channelFiles).some((items) => items?.length) && !Object.values(channelMediaUrlsByAccount).some((items) => items?.length)) {
      notify({ title: "Nothing to save yet", message: "Add a caption or media before saving this draft." });
      return;
    }
    setSaving(true);
    setUploadBusy(true);
    try {
      const sharedUrls = [...await uploadFiles(files), ...libraryMediaUrls];
      const savedChannelUrls = captionMode === "custom" ? { ...channelMediaUrlsByAccount } : {};
      if (captionMode === "custom") {
        for (const [accountId, accountFiles] of Object.entries(channelFiles)) {
          const uploaded = await uploadFiles(accountFiles);
          savedChannelUrls[accountId] = [...(savedChannelUrls[accountId] || []), ...uploaded];
        }
      }
      const primaryAccount = selectedAccounts[0] || accounts.find((account) => account.is_active);
      let scheduledAt = null;
      if (scheduleMode === "schedule" && date && time) {
        try { scheduledAt = zonedDateTimeToISO(date, time, timeZone); } catch { scheduledAt = null; }
      }
      const metadata = {
        caption, title, captionMode, captionsByAccount, useUniversalCaptionByAccount, selectedIds,
        formatsByAccount, formatOverridesByAccount, platformSettingsByAccount,
        useSharedMediaByAccount, scheduleMode, date, time, timeZone,
        sharedMediaUrls: sharedUrls, channelMediaUrlsByAccount: savedChannelUrls,
      };
      const payload = {
        content: captionMode === "custom" && primaryAccount ? (captionsByAccount[primaryAccount.id] ?? caption) : caption,
        media_urls: [...sharedUrls, ...Object.values(savedChannelUrls).flat()].slice(0, 10),
        post_format: primaryAccount ? formatForAccount(primaryAccount) : "Post",
        scheduled_at: scheduledAt,
        metadata,
      };
      const draftKey = String(editingDraftId || "");
      if (draftKey.startsWith("local-")) removeLocalDraft(draftKey);
      if (draftKey && !draftKey.startsWith("local-")) {
        await authenticatedFetch(`/publish/drafts/${draftKey}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await authenticatedFetch("/publish/drafts", { method: "POST", body: JSON.stringify(payload) });
      }
      setEditingDraftId("");
      setFiles([]);
      setChannelFiles({});
      setChannelMediaUrlsByAccount({}); setLibraryMediaUrls([]); setUseSharedMediaByAccount({});
      setCaption(""); setCaptionsByAccount({}); setCaptionMode("universal"); setTitle("");
      setFormatsByAccount({}); formatOverridesRef.current = {}; setFormatOverridesByAccount({}); setPlatformSettingsByAccount({});
      setSelectedIds([]); setPreviewId(""); setScheduleMode("schedule");
      setDate(dateInZone(new Date(Date.now() + 60 * 60 * 1000), localZone));
      setTime(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Date.now() + 60 * 60 * 1000)));
      setTimeZone(localZone);
      notify({ title: "Draft saved", message: "It’s stored in your workspace under Publish → Drafts.", kind: "success" });
    } catch (error) {
      notify({ title: "Couldn’t save draft", message: error.message || "Please try again." });
    } finally {
      setUploadBusy(false);
      setSaving(false);
    }
  }

  function openSavedDraft(draft) {
    const metadata = draft?.metadata_json && typeof draft.metadata_json === "object" && !Array.isArray(draft.metadata_json)
      ? draft.metadata_json
      : (draft?.metadata && typeof draft.metadata === "object" && !Array.isArray(draft.metadata) ? draft.metadata : {});
    const activeAccountIds = new Set(accounts.filter((account) => account.is_active).map((account) => account.id));
    const nextSelectedIds = Array.isArray(metadata.selectedIds) ? metadata.selectedIds.filter((id) => activeAccountIds.has(id)) : [];
    const nextSharedUrls = Array.isArray(metadata.sharedMediaUrls) ? metadata.sharedMediaUrls : (draft.media_urls || []);
    const nextChannelMedia = metadata.channelMediaUrlsByAccount && typeof metadata.channelMediaUrlsByAccount === "object" ? metadata.channelMediaUrlsByAccount : {};
    setCaption(typeof metadata.caption === "string" ? metadata.caption : (draft.content || ""));
    setTitle(typeof metadata.title === "string" ? metadata.title : "");
    setCaptionMode(metadata.captionMode === "custom" ? "custom" : "universal");
    setCaptionsByAccount(metadata.captionsByAccount && typeof metadata.captionsByAccount === "object" ? metadata.captionsByAccount : {});
    setUseUniversalCaptionByAccount(metadata.useUniversalCaptionByAccount && typeof metadata.useUniversalCaptionByAccount === "object" ? metadata.useUniversalCaptionByAccount : {});
    setSelectedIds(nextSelectedIds);
    setPreviewId(nextSelectedIds[0] || "");
    setFormatsByAccount(metadata.formatsByAccount && typeof metadata.formatsByAccount === "object" ? metadata.formatsByAccount : {});
    const nextOverrides = metadata.formatOverridesByAccount && typeof metadata.formatOverridesByAccount === "object" ? metadata.formatOverridesByAccount : {};
    formatOverridesRef.current = nextOverrides;
    setFormatOverridesByAccount(nextOverrides);
    setPlatformSettingsByAccount(metadata.platformSettingsByAccount && typeof metadata.platformSettingsByAccount === "object" ? metadata.platformSettingsByAccount : {});
    setUseSharedMediaByAccount(metadata.useSharedMediaByAccount && typeof metadata.useSharedMediaByAccount === "object" ? metadata.useSharedMediaByAccount : {});
    setScheduleMode(metadata.scheduleMode === "now" ? "now" : "schedule");
    const localSchedule = draft.scheduled_at ? toLocalInputValue(draft.scheduled_at) : "";
    setDate(typeof metadata.date === "string" ? metadata.date : localSchedule.slice(0, 10) || dateInZone(new Date(Date.now() + 60 * 60 * 1000), localZone));
    setTime(typeof metadata.time === "string" ? metadata.time : localSchedule.slice(11, 16) || "12:00");
    setTimeZone(typeof metadata.timeZone === "string" ? metadata.timeZone : localZone);
    setLibraryMediaUrls(nextSharedUrls);
    setChannelMediaUrlsByAccount(nextChannelMedia);
    setFiles([]);
    setChannelFiles({});
    setEditingDraftId(draft.id);
    setActiveTab("studio");
    window.scrollTo({ top: 0, behavior: "smooth" });
    notify({ title: "Draft opened", message: "Your saved post is ready to edit.", kind: "success" });
  }

  function updateLocalDraft(draftId, updates) {
    setLocalDrafts((current) => current.map((draft) => draft.id === draftId ? { ...draft, ...updates, updated_at: new Date().toISOString() } : draft));
  }

  function removeLocalDraft(draftId) {
    setLocalDrafts((current) => current.filter((draft) => draft.id !== draftId));
  }

  async function createPost(event) {
    event.preventDefault();
    if (!selectedAccounts.length) { notify({ title: "Choose a channel", message: "Select at least one connected social account before publishing." }); return; }
    if (channelWarnings.length) { notify({ title: "Review channel requirements", message: channelWarnings[0].message }); return; }
    const emptyCaptionAccount = selectedAccounts.find((account) => !captionForAccount(account).trim());
    if (emptyCaptionAccount) { notify({ title: "Add a caption", message: `Write a caption for ${CHANNELS.find((channel) => channel.id === emptyCaptionAccount.platform)?.label || "each selected channel"}.` }); return; }
    const overLimitAccount = selectedAccounts.find((account) => captionForAccount(account).length > Math.min(CHANNELS.find((channel) => channel.id === account.platform)?.limit || MAX_CHARS, MAX_CHARS));
    if (overLimitAccount) { const overLimitChannel = CHANNELS.find((channel) => channel.id === overLimitAccount.platform); const limit = Math.min(overLimitChannel?.limit || MAX_CHARS, MAX_CHARS); notify({ title: "Caption is too long", message: `${overLimitChannel?.label || "A selected channel"} allows up to ${limit.toLocaleString()} characters.` }); return; }
    let scheduledAt;
    try { scheduledAt = scheduleMode === "now" ? new Date(Date.now() + 5000).toISOString() : zonedDateTimeToISO(date, time, timeZone); }
    catch { notify({ title: "Check the schedule", message: "The selected date, time, or timezone is not valid." }); return; }
    if (!scheduledAt || (scheduleMode === "schedule" && new Date(scheduledAt) <= new Date())) { notify({ title: "Choose a future time", message: "Scheduled publishing needs a time later than now." }); return; }
    setSaving(true);
    setUploadBusy(true);
    try {
      const anyAccountInheritsShared = captionMode === "universal" || selectedAccounts.some((account) => useSharedMediaByAccount[account.id] !== false);
      const sharedUrls = anyAccountInheritsShared ? [...await uploadFiles(files), ...libraryMediaUrls] : [];
      const results = await Promise.allSettled(selectedAccounts.map(async (account) => {
        const accountFiles = Array.isArray(channelFiles[account.id]) ? channelFiles[account.id] : [];
        const inheritShared = useSharedMediaByAccount[account.id] !== false;
        const customUrls = captionMode === "custom" ? [...(channelMediaUrlsByAccount[account.id] || []), ...(accountFiles.length ? await uploadFiles(accountFiles) : [])] : [];
        const mediaUrls = inheritShared ? [...sharedUrls, ...customUrls] : customUrls;
        return authenticatedFetch("/posts", {
          method: "POST",
          body: JSON.stringify({ connected_account_id: account.id, content: captionForAccount(account).trim(), media_urls: mediaUrls, scheduled_at: scheduledAt, idempotency_key: makeIdempotencyKey(), post_metadata: { format: formatForAccount(account), settings: platformSettingsByAccount[account.id] || {}, ...(account.platform === "pinterest" && platformSettingsByAccount[account.id]?.destination_url ? { destination_url: platformSettingsByAccount[account.id].destination_url } : {}) } }),
        });
      }));
      const successCount = results.filter((result) => result.status === "fulfilled").length;
      const failureMessages = results.filter((result) => result.status === "rejected").map((result) => result.reason?.message);
      if (successCount) {
        const [accountData, postData] = await Promise.all([authenticatedFetch("/accounts"), authenticatedFetch("/posts")]);
        setAccounts(Array.isArray(accountData) ? accountData : []); setPosts(Array.isArray(postData) ? postData : []);
        if (editingDraftId) {
          try { await authenticatedFetch(`/publish/drafts/${editingDraftId}`, { method: "DELETE" }); } catch { /* The published post remains successful if draft cleanup fails. */ }
        }
        setEditingDraftId(""); setFiles([]); setChannelFiles({}); setChannelMediaUrlsByAccount({}); setUseSharedMediaByAccount({}); setLibraryMediaUrls([]); setCaption(""); setCaptionsByAccount({}); setUseUniversalCaptionByAccount({}); setCaptionMode("universal"); setTitle(""); setFormatsByAccount({}); formatOverridesRef.current = {}; setFormatOverridesByAccount({}); setPlatformSettingsByAccount({});
        notify({ title: scheduleMode === "now" ? "Your post is on its way" : "Post scheduled", message: `${successCount} account${successCount === 1 ? "" : "s"} ${scheduleMode === "now" ? "queued for publishing" : "added to your publishing queue"}.${failureMessages.length ? ` ${failureMessages.length} account${failureMessages.length === 1 ? "" : "s"} could not be scheduled.` : ""}`, kind: failureMessages.length ? "error" : "success" });
      }
      if (!successCount) notify({ title: "Couldn’t create your post", message: failureMessages[0] || "Please try again." });
    } catch (error) { notify({ title: "Couldn’t create your post", message: error.message || "Please try again." }); }
    finally { setUploadBusy(false); setSaving(false); }
  }

  async function connectAccount(platform) {
    if (!OAUTH_PLATFORMS.has(platform)) {
      setConnectError("Publishing is available for X, LinkedIn, and Instagram.");
      return;
    }
    setConnectBusy(true); setConnectError("");
    try {
      const result = await authenticatedFetch(`/accounts/${platform}/connect`);
      if (!result?.authorization_url) throw new Error("The server did not return an authorization URL.");
      window.location.assign(result.authorization_url);
    } catch (error) { setConnectError(error.message); setConnectBusy(false); }
  }

  async function retryQueuedPost(postId) {
    try {
      await authenticatedFetch(`/posts/${postId}/retry`, { method: "POST" });
      await loadWorkspace(token);
      notify({ title: "Retry queued", message: "The post will publish again after the provider accepts it.", kind: "success" });
    } catch (error) { notify({ title: "Couldn’t retry", message: error.message }); }
  }

  async function archiveQueuedPost(postId) {
    try {
      await authenticatedFetch(`/posts/${postId}/archive`, { method: "POST" });
      await loadWorkspace(token);
      notify({ title: "Post archived", message: "Its history is kept with status archived.", kind: "success" });
    } catch (error) { notify({ title: "Couldn’t archive", message: error.message }); }
  }

  function useLibraryAsset(asset) {
    const absoluteUrl = new URL(asset.public_url, API_ORIGIN).href;
    setLibraryMediaUrls((current) => current.includes(absoluteUrl) ? current : [...current, absoluteUrl]);
    goToTab("studio");
    notify({ title: "Added to composer", message: `${asset.filename} is ready to attach to your post.`, kind: "success" });
  }

  useEffect(() => { sessionRefreshHandler = (next) => setToken(next); return () => { if (sessionRefreshHandler) sessionRefreshHandler = null; }; }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const connectError = params.get("connect_error");
    if (!connected && !connectError) return;
    if (connected) notify({ title: "Channel connected", message: `${connected} is ready to schedule. The token stays encrypted on the server.`, kind: "success" });
    if (connectError) notify({ title: "Couldn’t connect the channel", message: connectError });
    const url = new URL(window.location.href);
    url.searchParams.delete("connected");
    url.searchParams.delete("connect_error");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    if (token) void loadWorkspace(token);
  }, [token, loadWorkspace, notify]);

  if (!isLoggedIn || !token) return <><AuthScreen onAuthenticated={handleAuthenticated} dark={dark} toggleTheme={() => setDark((value) => !value)} remember={remember} setRemember={setRemember} /><Toast toast={toast} onClose={() => setToast(null)} /></>;

  const navigation = [
    { id: "home", label: "Home", icon: Home },
    { id: "studio", label: "Create Post", icon: Plus },
    { id: "publish", label: "Publish", icon: CalendarDays },
    { id: "biolink", label: "Bio Link", icon: Link2 },
    { id: "community", label: "Community", icon: MessagesSquare },
    { id: "insights", label: "Insights", icon: BarChart3 },
  ];
  const queuedPosts = posts.filter((post) => ["scheduled", "queued", "publishing", "failed"].includes(post.status));
  const connect = (channel) => {
    if (!channel) return;
    if (!OAUTH_PLATFORMS.has(channel.id)) {
      notify({ title: `${channel.label} isn’t available`, message: "Connect X, LinkedIn, or Instagram. Other networks can’t be scheduled because publishing would fail." });
      return;
    }
    setConnectError("");
    setConnectChannel(channel);
  };
  const openStudio = () => goToTab("studio");

  return <div className="app-shell min-h-screen transition-colors duration-300">
    <div className="flex min-h-screen">
      <aside className={`sidebar ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <div className="sidebar-brand"><span className="brand-mark"><Sparkles size={17} /></span>{!sidebarCollapsed && <span className="font-display text-[15px] font-extrabold tracking-tight">social<span className="text-indigo-600">studio</span></span>}<button className="sidebar-collapse ml-auto" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>{sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
        <div className="sidebar-workspace"><span className="workspace-avatar">{(user.workspace_name || user.full_name || "S").slice(0, 1).toUpperCase()}</span>{!sidebarCollapsed && <span className="min-w-0 flex-1"><b>{user.workspace_name || "My Workspace"}</b><small>Workspace</small></span>}<ChevronDown size={13} className="text-slate-400" /></div>
        <nav className="sidebar-nav" aria-label="Main navigation">{navigation.map(({ id, label, icon: Icon }) => { const active = activeTab === id; return <button key={id} onClick={() => goToTab(id)} title={sidebarCollapsed ? label : undefined} aria-current={active ? "page" : undefined} className={`sidebar-nav-item ${active ? "sidebar-nav-active" : ""}`}><Icon size={17} /><span>{!sidebarCollapsed && label}</span>{id === "studio" && !sidebarCollapsed && <span className="nav-plus"><Plus size={12} /></span>}</button>; })}</nav>
        {!sidebarCollapsed && <div className="sidebar-section-label">CONNECTED CHANNELS</div>}
        <div className={`sidebar-channels ${sidebarCollapsed ? "sidebar-channels-collapsed" : ""}`}>{CHANNELS.map((channel) => { const count = accounts.filter((account) => account.platform === channel.id && account.is_active).length; return <button key={channel.id} title={`${channel.label}${count ? ` · ${count} connected` : " · not connected"}`} onClick={() => count ? goToTab("studio") : connect(channel)} className="sidebar-channel"><span className="sidebar-channel-symbol" style={{ color: count ? channel.brand : undefined }}><ChannelBrandImage channelId={channel.id} /></span>{!sidebarCollapsed && <><span>{channel.label}</span><span className={`sidebar-channel-status ${count ? "is-connected" : ""}`} /></>}</button>; })}</div>
        <div className="sidebar-spacer" />
        <button onClick={() => openPlaceholder("Workspace settings")} className={`sidebar-settings ${sidebarCollapsed ? "justify-center" : ""}`}><span className="workspace-avatar workspace-avatar-small">{(user.full_name || "S").slice(0, 1).toUpperCase()}</span>{!sidebarCollapsed && <span className="min-w-0 flex-1 text-left"><b>{user.full_name || "Workspace member"}</b><small>Workspace profile</small></span>}<Settings2 size={15} className="text-slate-400" /></button>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="topbar"><div className="topbar-inner"><div className="flex min-w-0 items-center gap-3">{activeTab === "studio" ? <button onClick={() => goToTab("home")} className="back-dashboard"><ArrowLeft size={15} /><span>Back to Dashboard</span></button> : <><span className="topbar-mobile-brand"><span className="brand-mark"><Sparkles size={15} /></span>social<span className="text-indigo-600">studio</span></span><span className="hidden text-xs text-slate-400 lg:block">/</span><span className="hidden text-xs font-bold text-slate-600 dark:text-slate-300 lg:block">{activeTab === "publish" ? "Publish workspace" : activeTab === "home" ? "Home dashboard" : activeTab === "biolink" ? "Bio Link" : activeTab}</span></>}</div><div className="ml-auto flex items-center gap-2"><span className="hidden text-[11px] text-slate-400 sm:inline">{user.full_name || "Workspace member"}</span><button className="icon-button" onClick={() => setDark((value) => !value)} aria-label={`Switch to ${dark ? "light" : "dark"} theme`} title="Switch theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</button><button onClick={logout} className="secondary-button !px-3 !py-2 text-[11px]">Sign out</button></div></div>
          <nav className="mobile-nav" aria-label="Mobile navigation">{navigation.slice(0, 3).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => goToTab(id)} className={activeTab === id ? "mobile-nav-active" : ""}><Icon size={15} />{label}</button>)}</nav>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 pb-14 pt-6 sm:px-6 lg:px-8 lg:pt-8">
          {loadError && <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"><span>{loadError}</span><button onClick={() => void loadWorkspace()} className="font-bold underline">Retry</button></div>}
          {activeTab === "home" ? <HomeDashboard user={user} accounts={accounts} posts={posts} openStudio={openStudio} openConnect={connect} openPlaceholder={(name) => name.toLowerCase().includes("calendar") ? goToTab("publish") : openPlaceholder(name)} openApiDocs={openApiDocs} /> : activeTab === "biolink" ? <RenderErrorBoundary scope="Bio Link dashboard"><BioLinkDashboard user={user} accounts={accounts} posts={posts} /></RenderErrorBoundary> : activeTab === "publish" ? <RenderErrorBoundary scope="Publish workspace"><PublishSection request={authenticatedFetch} posts={posts} accounts={accounts} authorName={user.full_name} localDrafts={localDrafts} onUpdateLocalDraft={updateLocalDraft} onRemoveLocalDraft={removeLocalDraft} onCreatePost={openStudio} onOpenDraft={openSavedDraft} onUseAsset={useLibraryAsset} onRefresh={() => loadWorkspace(token)} /></RenderErrorBoundary> : <section className="animate-fade-up space-y-4">
            <div><div className="eyebrow">YOUR CREATIVE WORKSPACE</div><h1 className="mt-2 font-display text-[27px] font-extrabold leading-tight tracking-[-.05em] sm:text-3xl">Make your next post <span className="text-gradient">matter.</span></h1><p className="mt-1.5 text-xs text-slate-500 sm:text-sm">One idea, every channel. Create it once and see how it looks everywhere.</p></div>
            <ChannelBar accounts={accounts} selectedIds={selectedIds} toggleAccount={toggleAccount} openConnect={connect} />
            <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
              <form onSubmit={createPost} className="surface-card studio-scroll-panel relative z-10 min-w-0 space-y-5 p-4 sm:p-5 lg:col-span-12 xl:col-span-7 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:overscroll-auto">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="eyebrow">THE COMPOSER</span><h2 className="mt-1 font-display text-lg font-extrabold tracking-tight">Create something great</h2></div><div className="flex items-center gap-2"><button type="button" onClick={() => setWritingTool(writingTool === "templates" ? null : "templates")} aria-expanded={writingTool === "templates"} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-bold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"><FileText size={13} />Templates</button><button type="button" onClick={() => setWritingTool(writingTool === "assistant" ? null : "assistant")} aria-expanded={writingTool === "assistant"} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-blue-600 px-3 py-2 text-[10px] font-bold text-white shadow-md shadow-indigo-500/15"><WandSparkles size={13} />AI Assistant</button></div></div>
                {writingTool && <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-purple-50/70 p-3 dark:border-indigo-900/60 dark:from-indigo-950/30 dark:to-purple-950/20"><div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700 dark:text-indigo-200">{writingTool === "templates" ? "Start with a template" : "Writing assistant"}</p><button type="button" onClick={() => setWritingTool(null)} className="text-[10px] font-bold text-slate-400">Close</button></div>{writingTool === "templates" ? <div className="grid gap-2 sm:grid-cols-3">{COMPOSER_TEMPLATES.map((template) => <button type="button" key={template.name} onClick={() => { updateTargetCaption(() => template.text); setWritingTool(null); }} className="rounded-xl border border-white bg-white/80 p-2.5 text-left text-[10px] font-bold text-slate-700 transition hover:border-indigo-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">{template.name}<span className="mt-1 block line-clamp-2 text-[9px] font-normal leading-4 text-slate-500">{template.text.split("\n")[0]}</span></button>)}</div> : <><p className="mb-2 text-[10px] text-slate-500">Quick local writing helpers for {captionMode === "custom" ? (previewAccount?.account_name || "the selected preview account") : "your universal caption"}. Connect a text-generation service to enable generated copy.</p><div className="flex flex-wrap gap-2"><button type="button" onClick={() => applyWritingHelper("hook")} className="rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5 text-[10px] font-bold text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-200">Make it engaging</button><button type="button" onClick={() => applyWritingHelper("grammar")} className="rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5 text-[10px] font-bold text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-200">Fix grammar</button><button type="button" onClick={() => applyWritingHelper("hashtags")} className="rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5 text-[10px] font-bold text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-200">Add hashtag ideas</button></div></>}</div>}
                {previewAccount && (formatForAccount(previewAccount) === "Short" || formatForAccount(previewAccount) === "Reel / Video" || previewAccount.platform === "youtube") && <label className="block"><span className="section-title">Video title <span className="font-normal text-slate-400">· optional</span></span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="Add a title for your video" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none transition focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" /></label>}
                <RenderErrorBoundary scope="Channel caption editor" compact><ComposerChannelEditor accounts={selectedAccounts} mode={captionMode} setMode={changeCaptionMode} caption={caption} setCaption={setCaption} captionsByAccount={captionsByAccount} setCaptionsByAccount={setCaptionsByAccount} useUniversalCaptionByAccount={useUniversalCaptionByAccount} setUseUniversalCaptionByAccount={setUseUniversalCaptionByAccount} channelFiles={channelFiles} setChannelFiles={setChannelFiles} channelMediaUrlsByAccount={channelMediaUrlsByAccount} setChannelMediaUrlsByAccount={setChannelMediaUrlsByAccount} useSharedMediaByAccount={useSharedMediaByAccount} setUseSharedMediaByAccount={setUseSharedMediaByAccount} sharedMediaCount={files.length + libraryMediaUrls.length} channelWarnings={channelWarnings} previewId={previewAccount?.id} setPreviewId={setPreviewId} formatsByAccount={formatsByAccount} formatOverridesByAccount={formatOverridesByAccount} setAccountFormat={setAccountFormat} platformSettingsByAccount={platformSettingsByAccount} setPlatformSetting={setPlatformSetting} onChannelFilesAdded={(account, incoming) => { void suggestFormatsForAccounts(incoming, [account]); }} onOpenAssistant={(accountId) => { if (accountId) setPreviewId(accountId); setWritingTool("assistant"); }} onEditMedia={(file) => { setQuickFile(file); setQuickTool(file.type.startsWith("video/") ? "video" : "image"); }}>
                  <div className="mb-2 flex justify-end"><span className={`text-[10px] font-bold ${caption.length > postLimit ? "text-rose-500" : "text-slate-400"}`}>{caption.length.toLocaleString()} / {postLimit.toLocaleString()}</span></div><WritingTools caption={caption} setCaption={setCaption} />
                </ComposerChannelEditor></RenderErrorBoundary>
                <section><div className="mb-2.5 flex items-center justify-between"><div><h3 className="section-title">Add your media</h3><p className="section-hint mt-0.5">Photos and video make a post feel real.</p></div><span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Optional</span></div><MediaDropzone files={files} setFiles={setFiles} uploadBusy={uploadBusy} setToast={notify} openTool={setQuickTool} onFilesAdded={(incoming) => { void suggestFormatsForAccounts(incoming); }} onEditFile={(file) => { setQuickFile(file); setQuickTool(file.type.startsWith("video/") ? "video" : "image"); }} />{libraryMediaUrls.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{libraryMediaUrls.map((url) => <span key={url} className="inline-flex max-w-full items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[10px] font-semibold text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200"><ImagePlus size={12} /><span className="max-w-48 truncate">{decodeURIComponent(url.split("/").pop().split("?")[0])}</span><button type="button" onClick={() => setLibraryMediaUrls((current) => current.filter((item) => item !== url))} aria-label="Remove selected library media" className="font-bold">×</button></span>)}</div>}</section>
                <ScheduleControls mode={scheduleMode} setMode={setScheduleMode} date={date} setDate={setDate} time={time} setTime={setTime} timeZone={timeZone} setTimeZone={setTimeZone} />
                <div className="border-t border-slate-100 pt-4 dark:border-slate-800"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void saveAsDraft()} disabled={saving || uploadBusy || loadingAccounts} className="secondary-button flex flex-1 items-center justify-center gap-2 !py-3.5">{saving && !uploadBusy ? <LoaderCircle size={16} className="animate-spin" /> : <FileText size={15} />}Save as draft</button><button type="submit" disabled={saving || uploadBusy || loadingAccounts} className="primary-button flex flex-[1.4] items-center justify-center gap-2.5 !py-3.5">{saving || uploadBusy ? <LoaderCircle size={17} className="animate-spin" /> : scheduleMode === "now" ? <Send size={16} /> : <CalendarDays size={16} />}{saving || uploadBusy ? "Preparing your post…" : scheduleMode === "now" ? "Post now" : "Schedule post"}<ArrowRight size={16} className="ml-1" /></button></div><p className="mt-2 text-center text-[9px] text-slate-400">Posts are created separately for each selected account.</p></div>
              </form>
              <aside className="studio-scroll-panel relative z-0 min-w-0 space-y-4 self-start lg:col-span-12 xl:sticky xl:top-20 xl:col-span-5 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:overscroll-auto"><RenderErrorBoundary scope="Live preview" compact><LivePreview channelInfo={{ account: previewAccount, platform: previewChannel }} accounts={selectedAccounts} previewId={previewId} setPreviewId={setPreviewId} caption={previewCaption} uploadedMedia={previewFiles} mediaUrls={previewMediaUrls} posts={posts} title={title} format={formatForAccount(previewAccount)} formatsByAccount={formatsByAccount} platformSettingsByAccount={platformSettingsByAccount} destinationUrl={platformSettingsByAccount[previewAccount?.id]?.destination_url || ""} destinationBoard={platformSettingsByAccount[previewAccount?.id]?.board || "Brand inspiration"} device={device} setDevice={setDevice} /></RenderErrorBoundary>
                <section className="surface-card"><button type="button" onClick={() => setShowQueue((value) => !value)} className="flex w-full items-center justify-between p-4 text-left sm:px-5"><span><span className="eyebrow">YOUR CONTENT</span><span className="mt-1 flex items-center gap-2 font-display text-base font-extrabold">Publishing queue <span className="queue-count">{queuedPosts.length}</span></span></span><ChevronDown size={17} className={`text-slate-400 transition-transform ${showQueue ? "rotate-180" : ""}`} /></button>{showQueue && <div className="max-h-72 space-y-2 overflow-y-auto border-t border-slate-100 p-3 dark:border-slate-800">{queuedPosts.length ? queuedPosts.map((post) => { const account = accounts.find((item) => item.id === post.connected_account_id); return <article key={post.id} className="queue-item"><div className="min-w-0 flex-1"><p className="line-clamp-2 text-xs font-semibold">{post.content}</p><p className="mt-1 text-[10px] text-slate-400">{account?.account_name || account?.platform || "Account"} · {new Date(post.scheduled_at).toLocaleString()}{post.provider_post_id ? " · provider confirmed" : ""}{post.last_error_message ? ` · ${post.last_error_message}` : ""}</p></div><span className="status-chip" title={post.latest_execution_outcome ? `Last log: ${post.latest_execution_outcome}` : post.status}>{post.status === "published" && post.provider_post_id ? "published" : post.status === "published" ? "unconfirmed" : post.status}</span>{post.status === "failed" && <button type="button" className="text-[10px] font-bold text-indigo-600" onClick={() => void retryQueuedPost(post.id)}>Retry</button>}{["failed", "cancelled"].includes(post.status) && <button type="button" className="text-[10px] font-bold text-slate-500" onClick={() => void archiveQueuedPost(post.id)}>Archive</button>}</article>; }) : <p className="py-5 text-center text-xs text-slate-400">Your queue is clear. Time for a new idea.</p>}</div>}</section>
                <div className="security-note"><span className="security-lock">⌑</span><span>Workspace is private and secure <span className="mx-1">·</span> Your credentials stay encrypted</span></div>
              </aside>
            </div>
          </section>}
        </main>
      </div>
    </div>
    <QuickStudioDialog tool={quickTool} files={files} selectedFile={quickFile} onClose={() => { setQuickTool(null); setQuickFile(null); }} onToast={notify} />
    <ConnectDialog channel={connectChannel} onClose={() => setConnectChannel(null)} onConnect={connectAccount} busy={connectBusy} error={connectError} />
    <Toast toast={toast} onClose={() => setToast(null)} />
  </div>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><RenderErrorBoundary scope="SocialStudio workspace"><App /></RenderErrorBoundary></React.StrictMode>);
