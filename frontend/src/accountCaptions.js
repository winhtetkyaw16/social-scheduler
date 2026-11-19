// Pure helpers for multiple accounts per network (no React, no assets) so node --test can cover them.

export const NETWORK_LABELS = {
  x: "X",
  twitter: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  threads: "Threads",
};
const NOUNS = {
  facebook: ["page", "pages"],
  youtube: ["channel", "channels"],
  pinterest: ["account", "accounts"],
};

export function networkLabel(platform) {
  return NETWORK_LABELS[platform] || platform || "Channel";
}
export function networkNoun(platform, n = 2) {
  const [one, many] = NOUNS[platform] || ["account", "accounts"];
  return n === 1 ? one : many;
}

/** "Used for both Facebook pages" / "Used for all 3 Instagram accounts". */
export function usedForLine(platform, n) {
  const label = networkLabel(platform);
  if (n <= 1) return `Used for your ${label} ${networkNoun(platform, 1)}`;
  if (n === 2) return `Used for both ${label} ${networkNoun(platform, 2)}`;
  return `Used for all ${n} ${label} ${networkNoun(platform, n)}`;
}

/** Group accounts by network, keeping the order each network first appears in. */
export function groupByNetwork(accounts = []) {
  const groups = new Map();
  for (const a of accounts) {
    const key = a?.platform === "twitter" ? "x" : a?.platform;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  return [...groups].map(([platform, list]) => ({ platform, accounts: list }));
}

function rawName(account) {
  const meta = account?.extra_metadata || {};
  const raw = String(
    account?.display_name || account?.account_name || meta.name || meta.page_name || "",
  ).trim();
  return raw.replace(/\s*\(@[^)]*\)\s*$/, "").trim() || meta.username || "Your account";
}
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");

/** True when another account's name is the same or could be confused (same letters ignoring case, spaces, punctuation). */
export function needsHandle(account, all = []) {
  const me = norm(rawName(account));
  return all.some((o) => o && o.id !== account?.id && norm(rawName(o)) === me);
}

/** Caption fallback: account caption -> network caption -> default caption. Works for old posts with no network captions. */
export function resolveCaption(state = {}, account) {
  const {
    captionMode,
    caption = "",
    captionsByNetwork = {},
    captionsByAccount = {},
    useUniversalCaptionByAccount = {},
  } = state;
  if (captionMode !== "custom" || !account) return caption || "";
  if (
    useUniversalCaptionByAccount[account.id] === false &&
    typeof captionsByAccount[account.id] === "string"
  )
    return captionsByAccount[account.id];
  const net = captionsByNetwork[account.platform];
  if (typeof net === "string") return net;
  return caption || "";
}

/** Where an account's caption comes from: "account" | "network" | "default". */
export function captionSource(state = {}, account) {
  const {
    captionMode,
    captionsByNetwork = {},
    captionsByAccount = {},
    useUniversalCaptionByAccount = {},
  } = state;
  if (captionMode !== "custom" || !account) return "default";
  if (
    useUniversalCaptionByAccount[account.id] === false &&
    typeof captionsByAccount[account.id] === "string"
  )
    return "account";
  if (typeof captionsByNetwork[account.platform] === "string") return "network";
  return "default";
}

const CAPTION_MISSING = /add a caption/i;
/**
 * Group identical warnings. Each item: { key, title, detail, accounts }.
 * When every selected account lacks a caption: "Add a caption before scheduling" / "All N accounts need one."
 * Otherwise the title names the account(s): "Reconnect SocialCastly Page (Facebook)".
 */
export function groupWarnings(warnings = [], selectedCount = 0) {
  const label = (a) => `${rawName(a)} (${networkLabel(a?.platform)})`;
  const byMsg = new Map();
  for (const w of warnings) {
    const key = CAPTION_MISSING.test(w.message) ? "__caption" : w.message;
    if (!byMsg.has(key)) byMsg.set(key, { message: w.message, accounts: [] });
    const g = byMsg.get(key);
    if (!g.accounts.some((a) => a.id === w.account?.id)) g.accounts.push(w.account);
  }
  return [...byMsg].map(([key, g]) => {
    const n = g.accounts.length;
    if (key === "__caption") {
      if (n === selectedCount || n === 0)
        return {
          key,
          title: "Add a caption before scheduling",
          detail: n === 1 ? "Your account needs one." : `All ${n} accounts need one.`,
          accounts: g.accounts,
        };
      return {
        key,
        title: `Add a caption for ${g.accounts.map(label).join(", ")}`,
        detail: n === 1 ? "" : `${n} accounts need one.`,
        accounts: g.accounts,
      };
    }
    const msg = String(g.message || "").replace(/\s+$/, "");
    if (/^reconnect\b/i.test(msg))
      return {
        key,
        title: `Reconnect ${g.accounts.map(label).join(", ")}`,
        detail: msg.replace(/^reconnect\b[^.]*\.?\s*/i, ""),
        accounts: g.accounts,
      };
    return { key, title: msg, detail: g.accounts.map(label).join(", "), accounts: g.accounts };
  });
}
