// Copy for the pre-OAuth Connect / Reconnect intro dialog.
// Plain words only: no tokens, encryption, Meta, "publishable", or API jargon.

export const NETWORK_NAMES = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  twitter: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  threads: "Threads",
};

const COPY = {
  facebook: {
    connectSubtitle: "You'll sign in with Facebook, then pick which Pages to post to.",
    reconnectSubtitle: "Sign in again with Facebook to refresh this connection.",
    bullets: ["Personal profiles can't be used for posting.", "You can add or remove Pages later."],
    stay: "Your existing Pages stay connected.",
  },
  instagram: {
    connectSubtitle: "You'll sign in with Instagram, then pick which accounts to post to.",
    reconnectSubtitle: "Sign in again with Instagram to refresh this connection.",
    bullets: [
      "Personal profiles can't be used for posting.",
      "You can add or remove accounts later.",
    ],
    stay: "Your existing accounts stay connected.",
  },
  linkedin: {
    connectSubtitle: "You'll sign in with LinkedIn, then pick which profiles or pages to post to.",
    reconnectSubtitle: "Sign in again with LinkedIn to refresh this connection.",
    bullets: [
      "You can post from your profile or a company page.",
      "You can add or remove them later.",
    ],
    stay: "Your existing profiles and pages stay connected.",
  },
  youtube: {
    connectSubtitle: "You'll sign in with Google, then pick which YouTube channels to post to.",
    reconnectSubtitle: "Sign in again with Google to refresh this connection.",
    bullets: [
      "You can pick any channel this Google account can manage.",
      "You can add or remove channels later.",
    ],
    stay: "Your existing channels stay connected.",
  },
  pinterest: {
    connectSubtitle: "You'll sign in with Pinterest, then pick which boards to pin to.",
    reconnectSubtitle: "Sign in again with Pinterest to refresh this connection.",
    bullets: ["You'll pick the boards you want to pin to.", "You can add or remove boards later."],
    stay: "Your existing boards stay connected.",
  },
  x: {
    connectSubtitle: "You'll sign in with X to connect your account.",
    reconnectSubtitle: "Sign in again with X to refresh this connection.",
    bullets: ["You'll post as the X account you sign in with."],
    stay: "Your existing account stays connected.",
  },
  tiktok: {
    connectSubtitle: "You'll sign in with TikTok to connect your account.",
    reconnectSubtitle: "Sign in again with TikTok to refresh this connection.",
    bullets: ["You'll post as the TikTok account you sign in with."],
    stay: "Your existing account stays connected.",
  },
  threads: {
    connectSubtitle: "You'll sign in with Threads to connect your profile.",
    reconnectSubtitle: "Sign in again with Threads to refresh this connection.",
    bullets: ["You'll post as the Threads profile you sign in with."],
    stay: "Your existing profile stays connected.",
  },
};

COPY.twitter = COPY.x;

const JARGON = /\b(token|tokens|encrypt(?:ed|ion)?|meta|publishable|api)\b/i;

export function networkName(platform, label) {
  const id = String(platform || "").toLowerCase();
  return label || NETWORK_NAMES[id] || String(label || platform || "this network");
}

export function connectIntroCopy(platform, { reconnect = false, label } = {}) {
  const id = String(platform || "").toLowerCase();
  const name = networkName(id, label);
  const entry = COPY[id] || {
    connectSubtitle: `You'll sign in with ${name} to connect your account.`,
    reconnectSubtitle: `Sign in again with ${name} to refresh this connection.`,
    bullets: [],
    stay: "Your existing connection stays in place.",
  };
  const bullets = (entry.bullets || []).slice(0, 2);
  return {
    title: `${reconnect ? "Reconnect" : "Connect"} ${name}`,
    subtitle: reconnect ? entry.reconnectSubtitle : entry.connectSubtitle,
    bullets,
    note: reconnect ? entry.stay || "" : "",
    continueLabel: `Continue with ${name}`,
  };
}

export function introCopyIsPlain(copy) {
  const text = [copy.title, copy.subtitle, copy.note, ...(copy.bullets || [])].join(" ");
  return !JARGON.test(text);
}
