import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChannelTile } from "./sc/ui.jsx";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import PublishSection, { toLocalInputValue } from "./PublishSection.jsx";
import LivePreview from "./LivePreview.jsx";
import BioLinkDashboard from "./BioLinkDashboard.jsx";
import ComposerChannelEditor from "./ComposerChannelEditor.jsx";
import EmojiPicker from "./EmojiPicker.jsx";
import RenderErrorBoundary from "./RenderErrorBoundary.jsx";
import ManageAccounts, { AccountAvatar, DestinationPicker } from "./ManageAccounts.jsx";
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, AtSign, BarChart3, Bookmark, CalendarDays, Expand,
  Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, Code2, Timer, FileText, Film, Flame,
  Globe2, Hash, Heart, Home, ImagePlus, Instagram, Linkedin, Link2, ListTodo, LoaderCircle, MessageCircle,
  MessagesSquare, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Send, Share2, GripVertical, Pencil,
  Settings2, Shrink, Smile, Sparkles, Sun, Target, ThumbsUp, Upload, Users, Video, WandSparkles, X as XIcon, Youtube,
} from "lucide-react";
import facebookPng from "./assets/logos/facebook.svg";
import instagramPng from "./assets/logos/instagram.svg";
import linkedinPng from "./assets/logos/linkedin.svg";
import pinterestPng from "./assets/logos/pinterest.svg";
import tiktokPng from "./assets/logos/tiktok.svg";
import xPng from "./assets/logos/x.svg";
import youtubePng from "./assets/logos/youtube.svg";
import threadsPng from "./assets/logos/threads.svg";
import lockupLight from "./assets/brand/socialcastly-lockup-light.png";
import lockupDark from "./assets/brand/socialcastly-lockup-dark.png";
import "./theme/tokens.css";
import "./styles.css";
import "./theme/design-scoped.css";
import "./sc/sc-shell.css";
import brandMark from "./assets/brand/socialcastly-mark-256.png";
import { Dashboard as ScDashboard, Analytics as ScAnalytics, Settings as ScSettings, Team as ScTeam, MediaLibrary as ScMedia, Onboarding as ScOnboarding, States as ScStates } from "./sc/Pages.jsx";
import { Avatar as ScAvatar, Ch as ScCh } from "./sc/ui.jsx";

const API_BASE = (import.meta.env.VITE_API_BASE || `${window.location.origin}/api/v1`).replace(/\/$/, "");
const API_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, "");
const TOKEN_KEY = "social_studio_access_token";
const REFRESH_KEY = "social_studio_refresh_token";
const OAUTH_RETURN_TAB_KEY = "social_studio_oauth_return_tab";
const OAUTH_PLATFORMS = new Set(["x", "linkedin", "instagram", "facebook", "youtube", "tiktok", "pinterest", "threads"]);
const PUBLISHABLE_PLATFORMS = new Set(["x", "linkedin", "instagram", "facebook", "youtube", "tiktok", "pinterest", "threads"]);
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
  { id: "threads", label: "Threads", icon: "@", brand: "#111827", limit: 500 },
];
const SUPPORTED_FORMATS = {
  x: ["Post", "Reel / Video"], facebook: ["Post", "Reel / Video", "Story"],
  instagram: ["Post", "Reel / Video", "Story"], youtube: ["Post", "Reel / Video", "Short"],
  tiktok: ["Post", "Reel / Video", "Story"], linkedin: ["Post", "Reel / Video"],
  pinterest: ["Post", "Reel / Video"],
  threads: ["Post"],
};
const DEFAULT_POST_SETTINGS = {
  tiktok: { audience: "Public", allow_comments: true, allow_duet: true, allow_stitch: true },
  youtube: { privacy_status: "Public", made_for_kids: false, category: "People & Blogs" },
  facebook: { audience: "Public", location: "", first_comment: "", media_layout: "Grid" },
  instagram: { hide_counts: false, disable_comments: false, alt_text: "", location: "", media_layout: "Carousel / Swipe" },
  linkedin: { visibility: "Anyone", commenting: "Anyone", media_layout: "Grid" },
  x: { reply_permission: "Everyone", media_layout: "Grid" },
  pinterest: { board: "Brand inspiration", destination_url: "", alt_text: "" },
  threads: { reply_control: "Everyone" },
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
      storage.removeItem(OAUTH_RETURN_TAB_KEY);
    });
  } catch {
    // In-memory auth state is cleared even when browser storage is unavailable.
  }
}

function promoteSessionForOAuth(returnTab = "accounts") {
  // OAuth leaves this origin; keep access+refresh in localStorage so a full-page
  // return (or sessionStorage-only "remember me" off) cannot drop the user on login.
  const access = readStoredValue(TOKEN_KEY);
  const refresh = readStoredValue(REFRESH_KEY);
  const fullName = readStoredValue("social_studio_full_name");
  const workspace = readStoredValue("social_studio_workspace_name");
  if (!access) return;
  try {
    localStorage.setItem(TOKEN_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
    localStorage.setItem("social_studio_full_name", fullName || "");
    localStorage.setItem("social_studio_workspace_name", workspace || "");
    [TOKEN_KEY, REFRESH_KEY, "social_studio_full_name", "social_studio_workspace_name"].forEach((key) => {
      sessionStorage.removeItem(key);
    });
    localStorage.setItem(OAUTH_RETURN_TAB_KEY, returnTab);
  } catch {
    // Best effort; in-memory token still used for the connect API call itself.
  }
  sessionAccessToken = access;
}

function oauthReturnTabFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") || params.get("connect_error") || params.get("oauth_pick")) {
      return localStorage.getItem(OAUTH_RETURN_TAB_KEY) || "accounts";
    }
  } catch {
    // Fall through to home when storage is unavailable.
  }
  return "home";
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
  catch { throw new Error("Could not reach SocialCastly. Check that the API is running and try again."); }
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
  const switchMode = (next) => { setMode(next); setError(""); };
  return <div className={`scd sc-auth-root ${dark ? "dark" : ""}`}><main className="auth">
    <section className="art">
      <img src={lockupDark} style={{ height: 36, alignSelf: "flex-start" }} alt="SocialCastly" />
      <div><h1 style={{ fontSize: 40, lineHeight: 1.1, maxWidth: 440 }}>Your whole social calendar, in one calm place.</h1><p style={{ opacity: .92, marginTop: 14, maxWidth: 420, fontSize: 16 }}>Write once, tailor per channel, and publish on time — every time.</p>
        <div className="card" style={{ marginTop: 36, maxWidth: 440, color: "var(--text)", overflow: "hidden" }} aria-hidden="true"><div className="post"><div className="time">11:30<span>AM</span></div><span className="with-ch"><span className="avatar" style={{ background: "#4F46E5", width: 36, height: 36 }}>SC</span><span className="ch ch-linkedin sm">in</span></span><div className="body"><div className="row" style={{ gap: 8, marginBottom: 4 }}><b className="sm">Your brand</b><span className="badge b-primary">Scheduled</span></div><div className="txt">Plan the week in one place, preview every channel, and let SocialCastly publish on time.</div></div></div></div>
      </div>
      <p style={{ opacity: .9 }} className="sm">Built for teams with a lot to say.</p>
      <img src={brandMark} style={{ position: "absolute", right: -140, bottom: -140, width: 520, opacity: .14, filter: "brightness(0) invert(1)" }} alt="" />
    </section>
    <section className="form">
      <div style={{ width: "100%", maxWidth: 400 }} className="col">
        <div className="row between"><span className="sc-auth-mobile-logo"><img className="logo-light" src={lockupLight} alt="SocialCastly" style={{ height: 28 }} /><img className="logo-dark" src={lockupDark} alt="SocialCastly" style={{ height: 28 }} /></span><span className="grow" /><button type="button" onClick={toggleTheme} className="btn btn-ghost btn-icon" aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div>
        <h1>{mode === "login" ? "Welcome back" : "Create your workspace"}</h1><p className="muted" style={{ marginTop: -6 }}>{mode === "login" ? "Sign in to your SocialCastly workspace." : "A better rhythm for your social starts here."}</p>
        <form onSubmit={submit} className="col" style={{ marginTop: 12 }}>
          {mode === "signup" && <><div className="field"><label className="label" htmlFor="auth-name">Full name</label><input id="auth-name" className="input" autoComplete="name" required maxLength={160} value={fields.full_name} onChange={set("full_name")} placeholder="Alex Morgan" /></div><div className="field"><label className="label" htmlFor="auth-ws">Workspace name</label><input id="auth-ws" className="input" autoComplete="organization" required maxLength={160} value={fields.workspace_name} onChange={set("workspace_name")} placeholder="My Agency Workspace" /></div></>}
          <div className="field"><label className="label" htmlFor="auth-email">Email</label><input id="auth-email" className="input" type="email" autoComplete="email" required value={fields.email} onChange={set("email")} placeholder="you@company.com" /></div>
          <div className="field"><div className="row between"><label className="label" htmlFor="auth-pw">Password</label>{mode === "login" ? <a role="button" className="xs" style={{ color: "var(--primary)", fontWeight: 600, cursor: "pointer" }} onClick={() => setError("Password recovery is not configured yet. Contact your workspace administrator.")}>Forgot password?</a> : null}</div><div className="row" style={{ position: "relative" }}><input id="auth-pw" className="input grow" type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 10 : 1} maxLength={128} value={fields.password} onChange={set("password")} placeholder={mode === "signup" ? "At least 10 characters" : "Your password"} /><button type="button" className="btn btn-sm btn-ghost" style={{ position: "absolute", right: 4 }} onClick={() => setShowPassword((v) => !v)}>{showPassword ? "Hide" : "Show"}</button></div></div>
          {mode === "login" ? <label className="row sm" style={{ cursor: "pointer" }}><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} hidden /><span className={`check ${remember ? "on" : ""}`} />Keep me signed in</label> : <label className="row sm" style={{ alignItems: "flex-start" }}><input required type="checkbox" style={{ marginTop: 3, accentColor: "var(--primary)" }} /><span>I agree to the <a href="#terms" style={{ color: "var(--primary)", fontWeight: 600 }}>Terms of Service</a> and <a href="#privacy" style={{ color: "var(--primary)", fontWeight: 600 }}>Privacy Policy</a>.</span></label>}
          {error && <div role="alert" className="alert error sm">{error}</div>}
          <button disabled={busy} className="btn btn-primary btn-lg">{busy ? <LoaderCircle size={17} className="animate-spin" /> : null}{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
          <p className="sm muted" style={{ textAlign: "center" }}>{mode === "login" ? <>New to SocialCastly? <a role="button" style={{ color: "var(--primary)", fontWeight: 600, cursor: "pointer" }} onClick={() => switchMode("signup")}>Create an account</a></> : <>Already have an account? <a role="button" style={{ color: "var(--primary)", fontWeight: 600, cursor: "pointer" }} onClick={() => switchMode("login")}>Sign in</a></>}</p>
        </form>
      </div>
    </section>
  </main></div>;
}

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

const CHANNEL_BRAND_PNGS = { facebook: facebookPng, instagram: instagramPng, linkedin: linkedinPng, pinterest: pinterestPng, tiktok: tiktokPng, x: xPng, youtube: youtubePng, threads: threadsPng };
function ChannelBrandImage({ channelId, size = 24 }) {
  return <ChannelTile platform={channelId} size={size} />;
}

function ScheduleControls({ mode, setMode, date, setDate, time, setTime, timeZone, setTimeZone, selectedAccounts = [] }) {
  const minDate = dateInZone(new Date(), timeZone);
  const queueHint = selectedAccounts.length
    ? `Places each selected account into its next free weekly slot (${selectedAccounts.length} channel${selectedAccounts.length === 1 ? "" : "s"}).`
    : "Places each selected account into its next free weekly slot.";
  return <section className="space-y-3"><div className="flex items-center justify-between"><div><h3 className="sc-h2">When should it go live?</h3><p className="section-hint">Choose a time that works for your audience.</p></div><Clock3 size={17} className="text-indigo-500" /></div>
    <div className="grid grid-cols-3 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"><button type="button" onClick={() => setMode("now")} className={`sc-pill ${mode === "now" ? "sc-pill-on" : ""}`}><Send size={13} />Post now</button><button type="button" onClick={() => setMode("schedule")} className={`sc-pill ${mode === "schedule" ? "sc-pill-on" : ""}`}><CalendarDays size={13} />Schedule</button><button type="button" onClick={() => setMode("queue")} className={`sc-pill ${mode === "queue" ? "sc-pill-on" : ""}`}><Timer size={13} />Next queue</button></div>
    {mode === "schedule" && <div className="grid grid-cols-2 gap-2"><label className="label">Date<input required type="date" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} /></label><label className="label">Time<input required type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label><label className="label col-span-2">Timezone<select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>{!TIMEZONES.includes(timeZone) && <option value={timeZone}>{timeZone}</option>}{TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz.replaceAll("_", " ")}</option>)}</select></label><div className="col-span-2 flex flex-wrap gap-1.5">{[["Tomorrow 9:00 AM", 1, "09:00"], ["In 3 hours", 0, ""]].map(([label, day, clock]) => <button type="button" key={label} onClick={() => { const next = new Date(Date.now() + (label === "In 3 hours" ? 3 * 60 * 60 * 1000 : 0)); if (label !== "In 3 hours") next.setDate(next.getDate() + Number(day)); setDate(dateInZone(next, timeZone)); setTime(clock || new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(next)); }} className="sc-pill">{label}</button>)}</div></div>}
    {mode === "queue" && <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-3.5 py-3 text-xs leading-5 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100"><p className="font-bold">Add to next queue slot</p><p className="mt-1 opacity-90">{queueHint} Edit weekly times under Publish → Queue.</p></div>}
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
      className={`dropzone ${dragging ? "sc-drop-on" : ""}`}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
      }}
    >
      <span className="sc-drop-ico"><Upload size={18} /></span><span className="text-sm font-bold">{uploadBusy ? "Uploading your media…" : "Drop photos or videos here"}</span><span className="text-[11px] text-slate-500">or <span className="font-bold text-indigo-600">browse files</span> · up to 10 files</span>
    </div>
    {files.length > 0 && <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">{files.map((file, index) => <MediaThumb key={`${file.name}-${file.lastModified}-${index}`} file={file} onEdit={() => onEditFile(file)} onRemove={(e) => { e.stopPropagation(); setFiles((current) => current.filter((_, i) => i !== index)); }} onDragStart={(event) => { event.dataTransfer.setData("text/plain", String(index)); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const from = Number(event.dataTransfer.getData("text/plain")); const to = index; if (!Number.isInteger(from) || from === to) return; setFiles((current) => { const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next; }); }} />)}</div>}
    <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => openTool("image")} className="btn btn-secondary btn-sm"><WandSparkles size={13} />Mini Canva / Image Editor</button><button type="button" onClick={() => openTool("video")} className="btn btn-secondary btn-sm"><Film size={13} />Video Studio</button></div>
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
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 dark:border-slate-800"><div className="flex flex-wrap gap-1.5"><button type="button" onClick={() => polish("viral")} className="sc-pill"><Sparkles size={12} />Make it viral</button><button type="button" onClick={() => polish("grammar")} className="sc-pill">✓ Fix grammar</button><button type="button" onClick={() => polish("hashtags")} className={`sc-pill ${hashtagsOpen ? "sc-pill-on" : ""}`}><Hash size={12} />Generate hashtags</button><button type="button" onClick={() => insert("https://")} className="sc-pill" title="Insert a link"><Link2 size={12} />Link</button></div><div className="flex items-center gap-1"><button type="button" onClick={() => setExpanded((value) => !value)} className="btn btn-ghost btn-sm" aria-label={expanded ? "Collapse caption editor" : "Expand caption editor"} title={expanded ? "Collapse editor" : "Expand editor"}>{expanded ? <Shrink size={15} /> : <Expand size={15} />}</button><button ref={emojiButton} type="button" className="btn btn-ghost btn-sm" aria-label="Open emoji picker" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((old) => !old)}><Smile size={17} /></button></div></div>
    {hashtagsOpen && <div className="border-t border-slate-100 px-3 py-2 dark:border-slate-800"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Suggested hashtags · select to insert</p><div className="flex flex-wrap gap-1.5">{(suggestions.length ? suggestions : ["#socialmedia", "#contentcreator", "#yourbrand"]).map((tag) => <button key={tag} onClick={() => insert(`${caption.endsWith(" ") || !caption ? "" : " "}${tag}`)} className="sc-pill !text-indigo-600">{tag}</button>)}</div></div>}
    <EmojiPicker open={emojiOpen} anchorRef={emojiButton} recent={recentEmojis} onClose={() => setEmojiOpen(false)} onSelect={(emoji) => { insert(emoji); setRecentEmojis((current) => [emoji, ...current.filter((item) => item !== emoji)].slice(0, 8)); }} />
    <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-3 py-2 dark:border-slate-800"><span className="mr-1 text-[9px] font-extrabold tracking-[.15em] text-slate-400">INSERT</span>{VARIABLES.map((variable) => <button key={variable} type="button" onClick={() => insert(variable)} className="sc-pill">{variable}</button>)}<span className={`ml-auto text-[10px] font-semibold ${caption.length > MAX_CHARS - 200 ? "text-amber-600" : "text-slate-400"}`}>{caption.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}</span></div>
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
  return <div className="modal-wrap sc-modal-wrap" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="quick-studio-title" className="modal sc-modal max-w-lg">
    <div className="flex items-start justify-between"><div><span className="xs muted sc-eyebrow">QUICK CREATIVE TOOLS</span><h2 id="quick-studio-title" className="mt-1  text-xl font-extrabold">{tool === "image" ? "Mini Canva / Image Editor" : "Video Studio"}</h2></div><button onClick={onClose} className="btn btn-ghost btn-icon" aria-label="Close"><XIcon size={17} /></button></div>
    {!file ? <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-7 text-center dark:border-slate-700 dark:bg-slate-800"><ImagePlus size={24} className="mx-auto text-indigo-500" /><p className="mt-2 text-sm font-bold">Add {tool === "video" ? "a video" : "an image"} to get started</p><p className="mt-1 text-xs text-slate-500">Your media will appear here as soon as you upload it in the composer.</p></div> : tool === "image" ? <div className="mt-4 space-y-4"><div className="overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-800"><img src={fileUrl} alt="Image editing preview" className="max-h-72 w-full object-contain" style={{ filter: `brightness(${brightness}%) contrast(${contrast}%)`, objectFit: fit }} /></div><label className="label">Brightness · {brightness}%<input type="range" min="50" max="150" value={brightness} onChange={(e) => setBrightness(+e.target.value)} /></label><label className="label">Contrast · {contrast}%<input type="range" min="50" max="150" value={contrast} onChange={(e) => setContrast(+e.target.value)} /></label><label className="label">Image crop<select value={fit} onChange={(e) => setFit(e.target.value)}><option value="cover">Fill frame</option><option value="contain">Fit entire image</option></select></label><p className="text-[10px] leading-4 text-slate-500">Adjustments are a live preview. The original uploaded image remains unchanged.</p></div> : <div className="mt-4 space-y-3"><video controls playsInline src={fileUrl} className="max-h-72 w-full rounded-2xl bg-black" /><p className="text-xs leading-5 text-slate-500">Review your video here before scheduling. Trim and export tools depend on a media editing service, which is not part of this API.</p></div>}
    <div className="mt-5 flex justify-end"><button onClick={() => { onToast({ title: "Preview ready", message: "Your media preview is up to date." }); onClose(); }} className="btn btn-primary !px-5 !py-2.5">Done</button></div>
  </section></div>;
}

function ConnectDialog({ channel, onClose, onConnect, busy, error }) {
  if (!channel) return null;
  const supported = OAUTH_PLATFORMS.has(channel.id);
  const canPublish = PUBLISHABLE_PLATFORMS.has(channel.id);
  const typeHints = {
    facebook: "Facebook Pages are the publishable destinations. Personal profiles are not postable via the Pages API. Groups appear only when Meta returns them. Linked Instagram Business accounts appear in the same picker when Meta returns them.",
    instagram: "Instagram Business/Creator accounts via Instagram Login (not personal profiles).",
    x: "Your X user account.",
    linkedin: "Personal profile and Company/Organization Pages after authorization.",
    youtube: "YouTube channels available to the Google account (pick Channel / Brand channel).",
    tiktok: "TikTok Creator/Business account for the Content Posting API.",
    pinterest: "Pinterest boards you can pin to (user login is kept as parent).",
    threads: "Your Threads profile via the Meta Threads API.",
  };
  return <div className="modal-wrap sc-modal-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}><div className="modal sc-modal max-w-md" role="dialog" aria-modal="true" aria-labelledby="connect-title"><div className="flex items-start justify-between"><div><span className="xs muted sc-eyebrow">CONNECT SOCIAL ACCOUNT</span><h2 id="connect-title" className="mt-1  text-xl font-extrabold">Connect {channel.label}</h2></div><button type="button" onClick={onClose} className="btn btn-ghost btn-icon"><XIcon size={17} /></button></div>{supported ? <><p className="mt-2 text-xs leading-5 text-slate-500">You'll continue to {channel.label} to authorize SocialCastly. Tokens are encrypted on the server and never returned to the browser.</p><p className="mt-2 text-xs leading-5 text-slate-500">{typeHints[channel.id] || ""}</p><p className="mt-2 text-[11px] font-semibold text-slate-500">{canPublish ? "Scheduling/publishing is available for this network." : "Connect works; publishing needs a publish-ready destination (e.g. Facebook Page) and valid tokens."}</p></> : <p className="mt-2 text-xs leading-5 text-slate-500">{channel.label} is not a connectable network in SocialCastly yet.</p>}{error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>{supported && <button type="button" disabled={busy} onClick={() => onConnect(channel.id)} className="btn btn-primary !px-5 !py-2.5">{busy ? "Redirecting…" : `Continue with ${channel.label}`}</button>}</div></div></div>;
}

function ConnectChannelPicker({ open, onClose, onPick, onRequestChannel }) {
  if (!open) return null;
  const hints = {
    x: "Profile",
    facebook: "Page",
    instagram: "Business or Creator",
    youtube: "Channel",
    tiktok: "Business or Personal",
    linkedin: "Profile or Page",
    pinterest: "Business or Profile",
    threads: "Profile",
  };
  return (
    <div className="modal-wrap sc-modal-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal sc-modal max-w-2xl p-5 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="connect-picker-title">
        <div className="flex items-start justify-between gap-3">
          <h2 id="connect-picker-title" className=" text-xl font-extrabold tracking-tight">Connect a channel</h2>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-icon" aria-label="Close"><XIcon size={17} /></button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CHANNELS.map((channel) => (
            <button
              type="button"
              key={channel.id}
              onClick={() => onPick(channel)}
              className="card card-pad"
            >
              <ChannelBrandImage channelId={channel.id} size={36} />
              <span className="mt-3 block text-sm font-bold text-slate-900 dark:text-slate-100">{channel.label}</span>
              <span className="mt-0.5 block text-[11px] text-slate-500">{hints[channel.id] || "Profile"}</span>
            </button>
          ))}
          <button type="button" onClick={onRequestChannel} className="card card-pad">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <Plus size={18} />
            </span>
            <span className="mt-3 block text-sm font-bold text-slate-900 dark:text-slate-100">Can&apos;t find it?</span>
            <span className="mt-0.5 block text-[11px] text-slate-500">Request a channel</span>
          </button>
        </div>
      </div>
    </div>
  );
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
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [pickSession, setPickSession] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [posts, setPosts] = useState([]);
  const [localDrafts, setLocalDrafts] = useState([]);
  const [showQueue, setShowQueue] = useState(false);
  const [activeTab, setActiveTab] = useState(() => {
    const tab = oauthReturnTabFromUrl();
    return tab === "publish" ? "calendar" : ["home", "studio", "accounts", "calendar", "week", "posts", "queue", "drafts", "approvals", "library", "analytics", "media", "team", "settings", "onboarding", "states", "biolink"].includes(tab) ? tab : "home";
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsTab, setSettingsTab] = useState("profile");
  const [navOpts, setNavOpts] = useState(null);
  const [approvalItems, setApprovalItems] = useState([]);
  const [draftCount, setDraftCount] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [remember, setRemember] = useState(true);
  const toastTimer = useRef(null);
  const mediaUrls = useRef(new Map());
  const formatOverridesRef = useRef({});

  const notify = useCallback((next) => { setToast(next); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 5500); }, []);
  const authenticatedFetch = useCallback((path, options = {}) => api(path, { ...options, token }), [token]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
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

  const refreshNavCounts = useCallback(async () => {
    if (!token) return;
    const [approvalData, draftData] = await Promise.all([
      api("/publish/approvals", { token }).catch(() => null), api("/publish/drafts", { token }).catch(() => null),
    ]);
    if (Array.isArray(approvalData)) setApprovalItems(approvalData);
    if (Array.isArray(draftData)) setDraftCount(draftData.length);
  }, [token]);
  useEffect(() => { void refreshNavCounts(); }, [refreshNavCounts, activeTab]);

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
  function goToTab(rawTab, opts) {
    let tab = rawTab === "publish" ? "calendar" : rawTab === "insights" ? "analytics" : rawTab;
    if (tab === "billing" || tab === "notifications" || tab === "profile") { setSettingsTab(tab); tab = "settings"; }
    if (opts?.tab) setNavOpts(opts); else setNavOpts(null);
    if (["home", "studio", "accounts", "calendar", "week", "posts", "queue", "drafts", "approvals", "library", "analytics", "media", "team", "settings", "onboarding", "states", "biolink"].includes(tab)) {
      if (["calendar", "week", "posts", "queue", "drafts", "approvals"].includes(tab)) {
        try { localStorage.setItem("social_studio_opened_publish", "1"); } catch { /* Session flag still works. */ }
      }
      setActiveTab(tab);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else openPlaceholder(tab);
  }
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
    setScheduleMode(metadata.scheduleMode === "now" ? "now" : metadata.scheduleMode === "queue" ? "queue" : "schedule");
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
    let scheduledAt = null;
    let queueByAccount = {};
    if (scheduleMode !== "queue") {
      try { scheduledAt = scheduleMode === "now" ? new Date().toISOString() : zonedDateTimeToISO(date, time, timeZone); }
      catch { notify({ title: "Check the schedule", message: "The selected date, time, or timezone is not valid." }); return; }
      if (!scheduledAt || (scheduleMode === "schedule" && new Date(scheduledAt) <= new Date())) { notify({ title: "Choose a future time", message: "Scheduled publishing needs a time later than now." }); return; }
    }
    setSaving(true);
    setUploadBusy(true);
    try {
      if (scheduleMode === "queue") {
        const allocated = await authenticatedFetch(`/publish/queue/allocate?timezone=${encodeURIComponent(timeZone || "UTC")}`, {
          method: "POST",
          body: JSON.stringify({ connected_account_ids: selectedAccounts.map((account) => account.id) }),
        });
        for (const item of allocated?.allocations || []) {
          queueByAccount[item.connected_account_id] = item.scheduled_at;
        }
        const missing = selectedAccounts.filter((account) => !queueByAccount[account.id]);
        if (missing.length) {
          throw new Error("Could not find a free queue slot for every selected account. Add times under Publish → Queue.");
        }
      }
      const anyAccountInheritsShared = captionMode === "universal" || selectedAccounts.some((account) => useSharedMediaByAccount[account.id] !== false);
      const sharedUrls = anyAccountInheritsShared ? [...await uploadFiles(files), ...libraryMediaUrls] : [];
      const results = await Promise.allSettled(selectedAccounts.map(async (account) => {
        const accountFiles = Array.isArray(channelFiles[account.id]) ? channelFiles[account.id] : [];
        const inheritShared = useSharedMediaByAccount[account.id] !== false;
        const customUrls = captionMode === "custom" ? [...(channelMediaUrlsByAccount[account.id] || []), ...(accountFiles.length ? await uploadFiles(accountFiles) : [])] : [];
        const mediaUrls = inheritShared ? [...sharedUrls, ...customUrls] : customUrls;
        const when = scheduleMode === "queue" ? queueByAccount[account.id] : scheduledAt;
        return authenticatedFetch("/posts", {
          method: "POST",
          body: JSON.stringify({ connected_account_id: account.id, content: captionForAccount(account).trim(), media_urls: mediaUrls, scheduled_at: when, idempotency_key: makeIdempotencyKey(), post_metadata: { format: formatForAccount(account), settings: platformSettingsByAccount[account.id] || {}, scheduleMode, ...(account.platform === "pinterest" && platformSettingsByAccount[account.id]?.destination_url ? { destination_url: platformSettingsByAccount[account.id].destination_url } : {}) } }),
        });
      }));
      const successCount = results.filter((result) => result.status === "fulfilled").length;
      const failureMessages = results.filter((result) => result.status === "rejected").map((result) => result.reason?.message);
      if (successCount) {
        const createdIds = results.filter((result) => result.status === "fulfilled").map((result) => result.value?.id).filter(Boolean);
        let [accountData, postData] = await Promise.all([authenticatedFetch("/accounts"), authenticatedFetch("/posts")]);
        // Post now finishes in a background worker; poll briefly so the calendar flips to published.
        if (scheduleMode === "now" && createdIds.length) {
          const terminal = new Set(["published", "failed", "cancelled", "archived"]);
          for (let attempt = 0; attempt < 8; attempt += 1) {
            const pending = (Array.isArray(postData) ? postData : []).filter((post) => createdIds.includes(post.id) && !terminal.has(post.status));
            if (!pending.length) break;
            await new Promise((resolve) => setTimeout(resolve, 1000));
            try { postData = await authenticatedFetch("/posts"); } catch { break; }
          }
        }
        setAccounts(Array.isArray(accountData) ? accountData : []); setPosts(Array.isArray(postData) ? postData : []);
        if (editingDraftId) {
          try { await authenticatedFetch(`/publish/drafts/${editingDraftId}`, { method: "DELETE" }); } catch { /* The published post remains successful if draft cleanup fails. */ }
        }
        setEditingDraftId(""); setFiles([]); setChannelFiles({}); setChannelMediaUrlsByAccount({}); setUseSharedMediaByAccount({}); setLibraryMediaUrls([]); setCaption(""); setCaptionsByAccount({}); setUseUniversalCaptionByAccount({}); setCaptionMode("universal"); setTitle(""); setFormatsByAccount({}); formatOverridesRef.current = {}; setFormatOverridesByAccount({}); setPlatformSettingsByAccount({});
        const refreshedCreated = (Array.isArray(postData) ? postData : []).filter((post) => createdIds.includes(post.id));
        const publishedCount = refreshedCreated.filter((post) => post.status === "published").length;
        const failedCount = refreshedCreated.filter((post) => post.status === "failed").length;
        const nowTitle = publishedCount === createdIds.length ? "Published" : failedCount ? "Publish finished with errors" : "Your post is on its way";
        const nowMessage = publishedCount === createdIds.length
          ? `${publishedCount} account${publishedCount === 1 ? "" : "s"} published successfully.`
          : failedCount
            ? `${publishedCount} published, ${failedCount} failed.${failureMessages.length ? ` ${failureMessages[0]}` : ""}`
            : `${successCount} account${successCount === 1 ? "" : "s"} queued for publishing. Refresh if the status is still updating.`;
        notify({ title: scheduleMode === "now" ? nowTitle : scheduleMode === "queue" ? "Added to queue" : "Post scheduled", message: scheduleMode === "now" ? nowMessage : `${successCount} account${successCount === 1 ? "" : "s"} ${scheduleMode === "queue" ? "placed in the next free queue slot" : "scheduled for a specific time"}.${failureMessages.length ? ` ${failureMessages.length} account${failureMessages.length === 1 ? "" : "s"} could not be scheduled.` : ""}`, kind: (failureMessages.length || failedCount) ? "error" : "success" });
      }
      if (!successCount) notify({ title: "Couldn’t create your post", message: failureMessages[0] || "Please try again." });
    } catch (error) { notify({ title: "Couldn’t create your post", message: error.message || "Please try again." }); }
    finally { setUploadBusy(false); setSaving(false); }
  }

  async function connectAccount(platform) {
    if (!OAUTH_PLATFORMS.has(platform)) {
      setConnectError("This network is not connectable in SocialCastly.");
      return;
    }
    setConnectBusy(true); setConnectError("");
    try {
      promoteSessionForOAuth("accounts");
      const returnTo = encodeURIComponent(window.location.origin);
      const result = await authenticatedFetch(`/accounts/${platform}/connect?return_to=${returnTo}`);
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
  useEffect(() => { const onPageShow = (event) => { if (event.persisted) { setConnectBusy(false); setConnectError(""); } }; const onPopState = () => { setConnectBusy(false); setConnectError(""); }; window.addEventListener("pageshow", onPageShow); window.addEventListener("popstate", onPopState); return () => { window.removeEventListener("pageshow", onPageShow); window.removeEventListener("popstate", onPopState); }; }, []);
    useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const connectError = params.get("connect_error");
    const oauthPick = params.get("oauth_pick");
    const pickSessionId = params.get("pick_session");
    if (!connected && !connectError && !oauthPick) return;
    let returnTab = "accounts";
    try {
      returnTab = localStorage.getItem(OAUTH_RETURN_TAB_KEY) || "accounts";
      localStorage.removeItem(OAUTH_RETURN_TAB_KEY);
    } catch {
      returnTab = "accounts";
    }
    if (returnTab === "publish") returnTab = "calendar";
    if (!["home", "studio", "accounts", "calendar", "week", "posts", "queue", "drafts", "approvals", "library", "analytics", "media", "team", "settings", "onboarding", "states", "biolink"].includes(returnTab)) returnTab = "accounts";
    goToTab(returnTab);
    if (oauthPick && pickSessionId) {
      setPickSession({ platform: oauthPick, sessionId: pickSessionId });
      notify({ title: `Choose ${oauthPick} destinations`, message: "Select which Pages, channels, or boards to save. Tokens stay encrypted on the server.", kind: "success" });
    }
    if (connected) notify({ title: "Channel connected", message: `${connected} is ready. The token stays encrypted on the server.`, kind: "success" });
    if (connectError) notify({ title: "Couldn't connect the channel", message: connectError });
    const url = new URL(window.location.href);
    url.searchParams.delete("connected");
    url.searchParams.delete("connect_error");
    url.searchParams.delete("oauth_pick");
    url.searchParams.delete("pick_session");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    if (token) void loadWorkspace(token);
  }, [token, loadWorkspace, notify]);

  if (!isLoggedIn || !token) return <><AuthScreen onAuthenticated={handleAuthenticated} dark={dark} toggleTheme={() => setDark((value) => !value)} remember={remember} setRemember={setRemember} /><Toast toast={toast} onClose={() => setToast(null)} /></>;

  const navigation = [
    { id: "home", label: "Dashboard", icon: Home },
    { id: "studio", label: "Create Post", icon: Plus },
    { id: "accounts", label: "Channels", icon: Users },
    { id: "publish", label: "Publish", icon: CalendarDays },
    { id: "biolink", label: "Bio Link", icon: Link2 },
    { id: "community", label: "Community", icon: MessagesSquare },
    { id: "insights", label: "Insights", icon: BarChart3 },
  ];
  const queuedPosts = posts.filter((post) => ["scheduled", "queued", "publishing", "failed"].includes(post.status));
  const connect = (channel) => {
    if (!channel) {
      setShowChannelPicker(true);
      return;
    }
    if (!OAUTH_PLATFORMS.has(channel.id)) {
      notify({ title: `${channel.label} isn’t available`, message: "This network is not connectable yet." });
      return;
    }
    setConnectError(""); setConnectBusy(false);
    setConnectChannel(channel);
  };
  const openStudio = (scheduleSeed) => {
    if (scheduleSeed instanceof Date && !Number.isNaN(scheduleSeed.getTime())) {
      const yyyy = scheduleSeed.getFullYear();
      const mm = String(scheduleSeed.getMonth() + 1).padStart(2, "0");
      const dd = String(scheduleSeed.getDate()).padStart(2, "0");
      setScheduleMode("schedule");
      setDate(`${yyyy}-${mm}-${dd}`);
      const hh = String(scheduleSeed.getHours()).padStart(2, "0");
      const mi = String(scheduleSeed.getMinutes()).padStart(2, "0");
      const seedClock = `${hh}:${mi}`;
      const now = new Date();
      const sameDay = yyyy === now.getFullYear() && scheduleSeed.getMonth() === now.getMonth() && scheduleSeed.getDate() === now.getDate();
      if (sameDay && scheduleSeed.getTime() <= now.getTime()) {
        const later = new Date(now.getTime() + 60 * 60 * 1000);
        setTime(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(later));
      } else {
        setTime(seedClock);
      }
      setTimeZone(localZone);
    }
    goToTab("studio");
  };

  const navCounts = { queue: posts.filter((post) => ["scheduled", "queued", "publishing"].includes(post.status)).length, drafts: draftCount, approvals: approvalItems.length };
  const navGroups = [
    ["Workspace", [["home", "Dashboard", Home], ["studio", "Create post", Plus], ["calendar", "Calendar", CalendarDays], ["queue", "Queue", ListTodo], ["drafts", "Drafts", FileText], ["approvals", "Approvals", CheckCircle2]]],
    ["Insights", [["analytics", "Analytics", BarChart3]]],
    ["Manage", [["accounts", "Channels", Share2], ["media", "Media library", ImagePlus], ["team", "Team", Users], ["settings", "Settings", Settings2]]],
    ["More", [["onboarding", "Get started", Sparkles], ["biolink", "Bio Link", Link2], ["community", "Community", MessagesSquare], ["states", "UI states", Target]]],
  ];
  const navActive = (id) => activeTab === id || (id === "calendar" && ["week", "posts"].includes(activeTab));
  const navLink = ([id, label, Icon]) => <a key={id} href={`#${id}`} onClick={(event) => { event.preventDefault(); setMoreOpen(false); goToTab(id); }} className={navActive(id) ? "active" : ""} aria-current={navActive(id) ? "page" : undefined}><Icon size={18} className="ico" />{label}{navCounts[id] ? <span className="count">{navCounts[id]}</span> : null}</a>;
  const publishViews = ["calendar", "week", "posts", "queue", "drafts", "approvals", "library"];
  const activeChannels = accounts.filter((account) => account.is_active !== false);

  return <div className={`scd sc-app-root ${dark ? "dark" : ""}`}>
    <div className="app">
      <aside className="sidebar sc-sidebar">
        <div className="brand"><img className="logo-light" src={lockupLight} alt="SocialCastly" style={{ height: 30 }} /><img className="logo-dark" src={lockupDark} alt="SocialCastly" style={{ height: 30 }} /></div>
        <nav className="nav" aria-label="Main navigation">{navGroups.map(([group, items]) => <React.Fragment key={group}><div className="nav-label">{group}</div>{items.map(navLink)}</React.Fragment>)}</nav>
        <div className="nav-label">Channels</div>
        <div className="col" style={{ gap: 8, padding: "0 10px" }}>{activeChannels.length ? activeChannels.slice(0, 6).map((account) => <a key={account.id} href="#accounts" onClick={(event) => { event.preventDefault(); goToTab("accounts"); }} className="row" style={{ gap: 10 }}><span className="with-ch"><ScAvatar name={account.account_name || account.platform} size={26} src={account.avatar_url || undefined} /><ScCh platform={account.platform} /></span><span className="sm muted grow" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{account.account_name || account.platform}</span></a>) : <button type="button" className="btn btn-sm btn-secondary" onClick={() => connect()}><Plus size={14} />Connect a channel</button>}</div>
        <div className="foot"><div className="card" style={{ padding: 12, background: "var(--surface-2)", boxShadow: "none" }}><div className="row between"><b className="sm" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.workspace_name || "My Workspace"}</b><span className="badge b-primary nodot">Self-hosted</span></div><div className="xs muted" style={{ marginTop: 4 }}>{activeChannels.length} channel{activeChannels.length === 1 ? "" : "s"} · {navCounts.queue} scheduled</div><div className="row" style={{ marginTop: 10, gap: 6 }}><button type="button" className="btn btn-sm btn-secondary grow" onClick={() => setDark((value) => !value)} aria-label={`Switch to ${dark ? "light" : "dark"} theme`}>{dark ? <Sun size={14} /> : <Moon size={14} />}{dark ? "Light" : "Dark"}</button><button type="button" className="btn btn-sm btn-ghost" onClick={logout}>Sign out</button></div></div></div>
      </aside>

      <div className="main">
        <header className="topbar">
          <span className="sc-m-brand"><img className="logo-light" src={lockupLight} alt="SocialCastly" style={{ height: 26 }} /><img className="logo-dark" src={lockupDark} alt="SocialCastly" style={{ height: 26 }} /></span>
          <div className="search sc-search"><svg className="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><span className="grow">Search posts, channels, media…</span><span className="kbd">⌘K</span></div>
          <div className="grow" />
          <button type="button" className="btn btn-ghost btn-icon sc-hide-m" aria-label={`Switch to ${dark ? "light" : "dark"} theme`} title="Switch theme" onClick={() => setDark((value) => !value)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Notifications" title="Notification settings" onClick={() => goToTab("notifications")}><svg className="ico" viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></svg></button>
          {activeTab !== "studio" && <button type="button" className="btn btn-primary sc-hide-m" onClick={() => openStudio()}><Plus size={16} />New post</button>}
          <a href="#settings" onClick={(event) => { event.preventDefault(); goToTab("settings"); }} className="row sc-hide-m" style={{ borderLeft: "1px solid var(--border)", paddingLeft: 16 }}><ScAvatar name={user.full_name || "W"} size={32} /><div><div className="sm" style={{ fontWeight: 600 }}>{user.full_name || "Workspace member"}</div><div className="xs subtle">{user.workspace_name || "Workspace"}</div></div></a>
        </header>

        <div className="content">
          {loadError && <div role="alert" className="alert error sm"><span className="grow">{loadError}</span><button type="button" onClick={() => void loadWorkspace()} className="btn btn-sm btn-secondary">Retry</button></div>}
          {activeTab === "home" ? <RenderErrorBoundary scope="Dashboard"><ScDashboard user={user} accounts={accounts} posts={posts} approvals={approvalItems} goToTab={goToTab} openStudio={openStudio} onRetryPost={retryQueuedPost} /></RenderErrorBoundary>
          : publishViews.includes(activeTab) ? <RenderErrorBoundary scope="Publish workspace"><PublishSection key={activeTab === "week" || activeTab === "calendar" ? "cal" : activeTab} view={activeTab} initialQueueTab={navOpts?.tab} onNavigate={goToTab} request={authenticatedFetch} posts={posts} accounts={accounts} authorName={user.full_name} localDrafts={localDrafts} onUpdateLocalDraft={updateLocalDraft} onRemoveLocalDraft={removeLocalDraft} onCreatePost={openStudio} onOpenDraft={openSavedDraft} onUseAsset={useLibraryAsset} onRefresh={() => { void loadWorkspace(token); void refreshNavCounts(); }} /></RenderErrorBoundary>
          : activeTab === "analytics" ? <RenderErrorBoundary scope="Analytics"><ScAnalytics posts={posts} accounts={accounts} /></RenderErrorBoundary>
          : activeTab === "media" ? <RenderErrorBoundary scope="Media library"><ScMedia request={authenticatedFetch} onUseAsset={useLibraryAsset} /></RenderErrorBoundary>
          : activeTab === "team" ? <ScTeam user={user} accounts={accounts} />
          : activeTab === "settings" ? <ScSettings tab={settingsTab} setTab={setSettingsTab} user={user} dark={dark} setDark={setDark} accounts={accounts} posts={posts} onLogout={logout} />
          : activeTab === "onboarding" ? <ScOnboarding accounts={accounts} connect={(id) => connect(CHANNELS.find((channel) => channel.id === id))} connectable={[...OAUTH_PLATFORMS]} goToTab={goToTab} dark={dark} />
          : activeTab === "states" ? <ScStates goToTab={goToTab} />
          : activeTab === "biolink" ? <RenderErrorBoundary scope="Bio Link dashboard"><BioLinkDashboard user={user} accounts={accounts} posts={posts} /></RenderErrorBoundary> : activeTab === "accounts" ? <><ManageAccounts posts={posts} ownerName={user.full_name} accounts={accounts} channels={CHANNELS} request={authenticatedFetch} onConnect={connect} onChanged={() => loadWorkspace(token)} ChannelBrandImage={ChannelBrandImage} publishablePlatforms={PUBLISHABLE_PLATFORMS} /></> : <section className="animate-fade-up space-y-4">
            <div className="page-head"><div><h1>Create post</h1><p className="muted">Write once, tailor for each channel, and preview before it goes out.</p></div><div className="row"><button type="button" className="btn btn-ghost" onClick={() => setWritingTool(writingTool === "templates" ? null : "templates")} aria-expanded={writingTool === "templates"}><FileText size={15} />Templates</button><button type="button" className="btn btn-ghost" onClick={() => setWritingTool(writingTool === "assistant" ? null : "assistant")} aria-expanded={writingTool === "assistant"}><WandSparkles size={15} />Assistant</button><button type="button" className="btn btn-secondary" onClick={() => void saveAsDraft()} disabled={saving || uploadBusy || loadingAccounts}>Save draft</button></div></div>
            <div className="grid sc-composer" style={{ gridTemplateColumns: "minmax(0,1.45fr) minmax(0,1fr)", alignItems: "start" }}>
              <form onSubmit={createPost} className="card col sc-composer-form" style={{ padding: 20, gap: 20, minWidth: 0 }}>
                <div className="row wrap sc-publish-to" style={{ gap: 8, padding: "14px 20px", borderBottom: "1px solid var(--border)", margin: "-20px -20px 0" }}><span className="sm muted">Publish to</span>{accounts.filter((account) => account.is_active).map((account) => { const on = selectedIds.includes(account.id); return <button type="button" key={account.id} onClick={() => toggleAccount(account.id)} aria-pressed={on} className="row sc-acct-pill" style={{ gap: 6, padding: "3px 10px 3px 3px", borderRadius: 999, border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`, background: on ? "var(--primary-soft)" : "var(--surface)", opacity: on ? 1 : .7 }}><span className="with-ch"><ScAvatar name={account.account_name || account.platform} size={24} src={account.avatar_url || undefined} /><ScCh platform={account.platform} /></span><span className="sm" style={{ fontWeight: 600 }}>{account.account_name || account.platform}</span></button>; })}<button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Connect a channel" onClick={() => connect()}><Plus size={16} /></button></div>
                {writingTool && <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-purple-50/70 p-3 dark:border-indigo-900/60 dark:from-indigo-950/30 dark:to-purple-950/20"><div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700 dark:text-indigo-200">{writingTool === "templates" ? "Start with a template" : "Writing assistant"}</p><button type="button" onClick={() => setWritingTool(null)} className="text-[10px] font-bold text-slate-400">Close</button></div>{writingTool === "templates" ? <div className="grid gap-2 sm:grid-cols-3">{COMPOSER_TEMPLATES.map((template) => <button type="button" key={template.name} onClick={() => { updateTargetCaption(() => template.text); setWritingTool(null); }} className="rounded-xl border border-white bg-white/80 p-2.5 text-left text-[10px] font-bold text-slate-700 transition hover:border-indigo-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">{template.name}<span className="mt-1 block line-clamp-2 text-[9px] font-normal leading-4 text-slate-500">{template.text.split("\n")[0]}</span></button>)}</div> : <><p className="mb-2 text-[10px] text-slate-500">Quick local writing helpers for {captionMode === "custom" ? (previewAccount?.account_name || "the selected preview account") : "your universal caption"}. Connect a text-generation service to enable generated copy.</p><div className="flex flex-wrap gap-2"><button type="button" onClick={() => applyWritingHelper("hook")} className="rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5 text-[10px] font-bold text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-200">Make it engaging</button><button type="button" onClick={() => applyWritingHelper("grammar")} className="rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5 text-[10px] font-bold text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-200">Fix grammar</button><button type="button" onClick={() => applyWritingHelper("hashtags")} className="rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5 text-[10px] font-bold text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-200">Add hashtag ideas</button></div></>}</div>}
                {previewAccount && (formatForAccount(previewAccount) === "Short" || formatForAccount(previewAccount) === "Reel / Video" || previewAccount.platform === "youtube") && <label className="block"><span className="sc-h2">Video title <span className="font-normal text-slate-400">· optional</span></span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="Add a title for your video" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs outline-none transition focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950" /></label>}
                <RenderErrorBoundary scope="Channel caption editor" compact><ComposerChannelEditor accounts={selectedAccounts} mode={captionMode} setMode={changeCaptionMode} caption={caption} setCaption={setCaption} captionsByAccount={captionsByAccount} setCaptionsByAccount={setCaptionsByAccount} useUniversalCaptionByAccount={useUniversalCaptionByAccount} setUseUniversalCaptionByAccount={setUseUniversalCaptionByAccount} channelFiles={channelFiles} setChannelFiles={setChannelFiles} channelMediaUrlsByAccount={channelMediaUrlsByAccount} setChannelMediaUrlsByAccount={setChannelMediaUrlsByAccount} useSharedMediaByAccount={useSharedMediaByAccount} setUseSharedMediaByAccount={setUseSharedMediaByAccount} sharedMediaCount={files.length + libraryMediaUrls.length} channelWarnings={channelWarnings} previewId={previewAccount?.id} setPreviewId={setPreviewId} formatsByAccount={formatsByAccount} formatOverridesByAccount={formatOverridesByAccount} setAccountFormat={setAccountFormat} platformSettingsByAccount={platformSettingsByAccount} setPlatformSetting={setPlatformSetting} onChannelFilesAdded={(account, incoming) => { void suggestFormatsForAccounts(incoming, [account]); }} onOpenAssistant={(accountId) => { if (accountId) setPreviewId(accountId); setWritingTool("assistant"); }} onEditMedia={(file) => { setQuickFile(file); setQuickTool(file.type.startsWith("video/") ? "video" : "image"); }}>
                  <div className="mb-2 flex justify-end"><span className={`text-[10px] font-bold ${caption.length > postLimit ? "text-rose-500" : "text-slate-400"}`}>{caption.length.toLocaleString()} / {postLimit.toLocaleString()}</span></div><WritingTools caption={caption} setCaption={setCaption} />
                </ComposerChannelEditor></RenderErrorBoundary>
                <section><div className="mb-2.5 flex items-center justify-between"><div><h3 className="sc-h2">Add your media</h3><p className="section-hint mt-0.5">Photos and video make a post feel real.</p></div><span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Optional</span></div><MediaDropzone files={files} setFiles={setFiles} uploadBusy={uploadBusy} setToast={notify} openTool={setQuickTool} onFilesAdded={(incoming) => { void suggestFormatsForAccounts(incoming); }} onEditFile={(file) => { setQuickFile(file); setQuickTool(file.type.startsWith("video/") ? "video" : "image"); }} />{libraryMediaUrls.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{libraryMediaUrls.map((url) => <span key={url} className="inline-flex max-w-full items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[10px] font-semibold text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200"><ImagePlus size={12} /><span className="max-w-48 truncate">{decodeURIComponent(url.split("/").pop().split("?")[0])}</span><button type="button" onClick={() => setLibraryMediaUrls((current) => current.filter((item) => item !== url))} aria-label="Remove selected library media" className="font-bold">×</button></span>)}</div>}</section>
                <ScheduleControls mode={scheduleMode} setMode={setScheduleMode} date={date} setDate={setDate} time={time} setTime={setTime} timeZone={timeZone} setTimeZone={setTimeZone} selectedAccounts={selectedAccounts} />
                <div className="row between wrap" style={{ borderTop: "1px solid var(--border)", margin: "0 -20px -20px", padding: "14px 20px", gap: 10 }}><span className="xs subtle">Posts are created separately for each selected account.</span><div className="row"><button type="button" onClick={() => void saveAsDraft()} disabled={saving || uploadBusy || loadingAccounts} className="btn btn-secondary">{saving && !uploadBusy ? <LoaderCircle size={15} className="animate-spin" /> : null}Save as draft</button><button type="submit" disabled={saving || uploadBusy || loadingAccounts} className="btn btn-primary">{saving || uploadBusy ? <LoaderCircle size={15} className="animate-spin" /> : null}{saving || uploadBusy ? "Preparing…" : scheduleMode === "now" ? `Post now${selectedAccounts.length > 1 ? ` (${selectedAccounts.length})` : ""}` : scheduleMode === "queue" ? "Add to queue" : `Schedule ${selectedAccounts.length || ""} post${selectedAccounts.length === 1 ? "" : "s"}`.replace("  ", " ")}</button></div></div>
              </form>
              <aside className="col sc-composer-preview" style={{ gap: 12, position: "sticky", top: 88, minWidth: 0 }}><h2>Preview</h2><RenderErrorBoundary scope="Live preview" compact><LivePreview channelInfo={{ account: previewAccount, platform: previewChannel }} accounts={selectedAccounts} previewId={previewId} setPreviewId={setPreviewId} caption={previewCaption} uploadedMedia={previewFiles} mediaUrls={previewMediaUrls} posts={posts} title={title} format={formatForAccount(previewAccount)} formatsByAccount={formatsByAccount} platformSettingsByAccount={platformSettingsByAccount} destinationUrl={platformSettingsByAccount[previewAccount?.id]?.destination_url || ""} destinationBoard={platformSettingsByAccount[previewAccount?.id]?.board || "Brand inspiration"} device={device} setDevice={setDevice} /></RenderErrorBoundary>
              </aside>
            </div>
          </section>}
        </div>
      </div>
    </div>
    <nav className="m-tab sc-mtab" aria-label="Mobile navigation">
      {[["home", "Home", Home], ["calendar", "Calendar", CalendarDays]].map(([id, label, Icon]) => <a key={id} href={`#${id}`} className={navActive(id) ? "active" : ""} onClick={(event) => { event.preventDefault(); setMoreOpen(false); goToTab(id); }}><Icon size={20} className="ico" />{label}</a>)}
      <a href="#studio" aria-label="New post" onClick={(event) => { event.preventDefault(); setMoreOpen(false); openStudio(); }}><span className="fab"><Plus size={22} /></span></a>
      <a href="#queue" className={activeTab === "queue" ? "active" : ""} onClick={(event) => { event.preventDefault(); setMoreOpen(false); goToTab("queue"); }}><ListTodo size={20} className="ico" />Queue</a>
      <a href="#more" className={moreOpen ? "active" : ""} onClick={(event) => { event.preventDefault(); setMoreOpen((value) => !value); }}><MoreHorizontal size={20} className="ico" />More</a>
    </nav>
    {moreOpen && <div className="sc-more card" role="menu"><nav className="nav">{navGroups.flatMap(([, items]) => items).filter(([id]) => !["home", "calendar", "queue", "studio"].includes(id)).map(navLink)}<a href="#signout" onClick={(event) => { event.preventDefault(); logout(); }}><XIcon size={18} className="ico" />Sign out</a></nav></div>}
    <QuickStudioDialog tool={quickTool} files={files} selectedFile={quickFile} onClose={() => { setQuickTool(null); setQuickFile(null); }} onToast={notify} />
    {pickSession && <DestinationPicker platform={pickSession.platform} sessionId={pickSession.sessionId} request={authenticatedFetch} channelMeta={CHANNELS.find((item) => item.id === pickSession.platform)} ChannelBrandImage={ChannelBrandImage} onClose={() => setPickSession(null)} onSaved={async (platform) => { setPickSession(null); await loadWorkspace(token); notify({ title: "Destinations saved", message: `${platform} destinations are connected.`, kind: "success" }); }} />}
    <ConnectChannelPicker
      open={showChannelPicker}
      onClose={() => setShowChannelPicker(false)}
      onPick={(channel) => { setShowChannelPicker(false); connect(channel); }}
      onRequestChannel={() => { setShowChannelPicker(false); notify({ title: "Thanks", message: "Channel requests help us prioritize what to add next.", kind: "success" }); }}
    />
    <ConnectDialog channel={connectChannel} onClose={() => setConnectChannel(null)} onConnect={connectAccount} busy={connectBusy} error={connectError} />
    <Toast toast={toast} onClose={() => setToast(null)} />
  </div>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><RenderErrorBoundary scope="SocialCastly workspace"><App /></RenderErrorBoundary></React.StrictMode>);
