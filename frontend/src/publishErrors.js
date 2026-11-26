import { networkName } from "./publishedDelete.js";
import { readableDetail } from "./requestErrors.js";

/**
 * Plain-language failure copy. Prefers the server's `friendly_error`; the local
 * mirror below is only a fallback for older API responses. Only the generic
 * fallback quotes the (sanitized) platform message.
 */
export function friendlyError(post, account) {
  if (!post) return null;
  const fe = post.friendly_error;
  if (fe?.banner && [fe.banner, fe.what_happened, fe.what_to_do].every((text) => !text || readableDetail(text))) {
    return {
      ...fe,
      network: readableDetail(fe.network) || networkName(post, account),
      platform_reason: readableDetail(fe.platform_reason) || null,
      actions: Array.isArray(fe.actions) ? fe.actions.filter((action) => readableDetail(action?.label)) : [],
    };
  }
  if (post.status !== "failed") return null;
  const net =
    networkName(post, account) === "the network" ? "this network" : networkName(post, account);
  const p = String(account?.platform || post.preview_platform || "").toLowerCase();
  const raw = `${post.last_error_code || ""} ${post.last_error_message || ""}`.toLowerCase();
  const http = Number((raw.match(/http\s+(\d{3})/) || [])[1] || 0);
  const mk = (category, banner, what_happened, what_to_do, actions) => ({
    category,
    network: net,
    banner,
    what_happened,
    what_to_do,
    actions,
  });
  const media = Array.isArray(post.media_urls) ? post.media_urls : null;
  const has = (...n) => n.some((x) => raw.includes(x));
  const EDIT = [{ id: "edit", label: "Edit post" }];
  if (["media_invalid", "format_invalid"].includes(post.last_error_code)) {
    return mk(
      "content_needs_edit",
      `Edit this post before publishing to ${net}.`,
      readableDetail(post.last_error_message) || `The selected format or media doesn't work for ${net}.`,
      "Open Edit post, update the content, and save your changes before publishing again.",
      EDIT,
    );
  }
  const RETRY = [
    { id: "retry", label: "Retry now" },
    { id: "reschedule", label: "Save & reschedule" },
  ];
  const credits = http === 402 ||
    has("credits depleted", "credits-depleted", "creditsdepleted", "payment required");
  const isX = p === "x" || p === "twitter";
  if (http === 429 || (!credits && has("too many requests", "rate limit", "rate_limit")) || (credits && !isX))
    return mk(
      "rate_limited",
      `${net} asked us to wait before posting again.`,
      `${net} temporarily paused publishing for this account.`,
      "Wait a little before trying again, or reschedule the post for later.",
      RETRY,
    );
  const RECON = [
    { id: "reconnect", label: `Reconnect ${net}`, target: "accounts" },
    { id: "retry", label: "Retry now" },
  ];
  if ((post.last_error_code || "").toLowerCase() === "connection_expired") {
    const said = readableDetail(post.last_error_message);
    const safe =
      said && !/invalid_grant|error code|oauth|http\s+\d/i.test(said) && said.length < 180;
    return mk(
      "connection_expired",
      safe
        ? said.endsWith(".")
          ? said
          : `${said}.`
        : `Your ${net} connection has expired or was revoked.`,
      `${net} no longer accepts SocialCastly's sign-in for this account.`,
      `Reconnect your ${net} account in Accounts, then retry the post.`,
      RECON,
    );
  }
  if (
    p === "youtube" &&
    has(
      "requires a video",
      "not an image",
      "no video",
      "exactly one video",
      "text-only posts are not supported",
    )
  )
    return mk(
      "youtube_video_required",
      "YouTube needs a video — this post has no video.",
      "YouTube only publishes videos. Text-only and photo posts can't be uploaded.",
      "Add one video file to this post, or remove YouTube from it.",
      EDIT,
    );
  if (
    p === "tiktok" &&
    has(
      "exactly one video",
      "no video",
      "video file is empty",
      "photo posting",
      "text-only posts are not supported",
    )
  )
    return mk(
      "tiktok_one_video",
      "TikTok needs exactly one video.",
      "TikTok posts from SocialCastly must contain one video. Text-only, photo, or multi-video posts aren't accepted.",
      "Keep exactly one video in this post (remove other files), then try again.",
      EDIT,
    );
  if (p === "instagram" && /aspect.ratio/.test(raw))
    return mk(
      "instagram_aspect_ratio",
      "Instagram rejected this photo's shape (aspect ratio).",
      "Instagram only accepts photos between portrait 4:5 and landscape 1.91:1. This image is taller or wider than that.",
      "Crop the photo to square (1:1), portrait (4:5) or landscape (1.91:1), then try again.",
      [{ id: "crop", label: "Crop" }, ...EDIT],
    );
  if (p === "instagram" && has("exactly one public image", "exactly one image"))
    return media && media.length === 0
      ? mk(
          "instagram_no_media",
          "Instagram needs at least one image or video; caption-only posts aren't allowed.",
          "This post only had a caption. Instagram doesn't publish text-only posts.",
          "Add one photo to the post (or remove Instagram), then try again.",
          EDIT,
        )
      : mk(
          "instagram_one_image",
          "Instagram needs exactly one image for this post.",
          "This post had more than one media file or a file type SocialCastly can't send to Instagram yet.",
          "Keep a single photo (JPG or PNG) and remove the rest, then try again.",
          EDIT,
        );
  if (has("publicly fetchable", "public_base_url", "not publicly reachable"))
    return mk(
      "media_not_public",
      `${net} couldn't reach your image — its link isn't public.`,
      `${net} downloads the image from a web link, but this file is only stored privately, so ${net} can't open it.`,
      "Use an image from the Media library on the live site (or any public image link), then try again.",
      EDIT,
    );
  if (has("could not download", "could not pull", "media container failed", "could not fetch"))
    return mk(
      "media_fetch_failed",
      `${net} couldn't download your media file.`,
      `${net} tried to fetch the image or video from its link and the download failed.`,
      "Check the file still opens, re-upload it, then try again.",
      [...EDIT, RETRY[0]],
    );
  if (post.last_error_code === "provider_request_error" && has(
    "could not connect to", "could not reach", "request timed out", "could not upload the video",
    "upload failed: could not send", "upload timed out", "upload session timed out",
  ))
    return mk(
      "network_unreachable",
      `SocialCastly couldn't get a response from ${net}.`,
      `We couldn't confirm whether your post appeared on ${net}.`,
      `Check your ${net} profile. If the post is missing, try again in a few minutes.`,
      RETRY,
    );
  if (has("timeout", "timed out", "still processing"))
    return mk(
      "timeout",
      `${net} took too long to fetch your media and gave up.`,
      `${net} timed out while downloading or processing the attached file.`,
      "Try again. If it keeps failing, use a smaller file (or a photo instead of a video) and make sure the link is public.",
      RETRY,
    );
  if (credits && isX)
    return mk(
          "x_credits_depleted",
          "X isn't accepting posts right now. This isn't your fault — please try again later.",
          "X turned this post away because SocialCastly's posting allowance on X has run out for now. Your post itself is fine and nothing was published.",
          "Try again later, or reschedule the post for another time.",
          RETRY,
        );
  if (has("cannot call api for app", "app has been deleted", "app removed"))
    return mk(
      "app_not_authorized",
      `${net} blocked SocialCastly for this account.`,
      `${net} says SocialCastly isn't authorized for this Page/account.`,
      `Reconnect ${net} and grant SocialCastly access to this Page/account, then retry.`,
      RECON,
    );
  if (
    http === 401 ||
    has(
      "account_inactive",
      "token",
      "unauthorized",
      "session has expired",
      "revoked",
      "inactive",
      "invalid_grant",
    )
  )
    return mk(
      "connection_expired",
      `Your ${net} connection has expired or was revoked.`,
      `${net} no longer accepts SocialCastly's sign-in for this account.`,
      `Reconnect your ${net} account in Accounts, then retry the post.`,
      RECON,
    );
  if (http === 403 || has("permission", "(#200)", "(#10)", "not authorized", "scope", "forbidden"))
    return mk(
      "permission_missing",
      `SocialCastly can't publish to this ${net} account.`,
      `${net} did not allow this account to publish here.`,
      `Reconnect ${net}, choose where to publish, and allow SocialCastly to post there.`,
      RECON,
    );
  if (has("duplicate") || (http === 422 && p === "linkedin"))
    return mk(
      "duplicate_content",
      `${net} rejected this as a duplicate post.`,
      `${net} blocks posting the same text twice in a row from one account.`,
      "Change the caption a little (or wait before reposting), then try again.",
      EDIT,
    );
  if (has("limited to", "too long", "character limit"))
    return mk(
      "text_too_long",
      `The caption is too long for ${net}.`,
      `${net} limits how many characters a post can have, and this caption is over it.`,
      "Shorten the caption, then try again.",
      EDIT,
    );
  if (
    (http >= 500 && http < 600) ||
    has("service unavailable", "could not connect", "did not return", "without returning")
  )
    return mk(
      "platform_unavailable",
      `${net} had a problem on its side and didn't publish the post.`,
      `${net} returned a server error or didn't confirm the post. This isn't something you did.`,
      "Retry in a few minutes. Check your profile first so you don't post twice.",
      RETRY,
    );
  const said = readableDetail(sanitizeRaw(post.last_error_message));
  return mk(
    "unknown",
    said && said.length < 110
      ? `${net} rejected this post: ${said}`
      : said
        ? `${net} rejected this post. See details for the reason.`
        : `We couldn't post this to ${net}.`,
    said ? `The platform said: "${said}"` : `${net} didn't give a reason.`,
    "Fix what the message mentions and retry. If it doesn't make sense, contact us and include this message.",
    [
      { id: "retry", label: "Retry now" },
      { id: "contact", label: "Contact us" },
    ],
  );
}

/** Strip tokens/URLs and internal prefixes from a provider message; max ~200 chars. */
export function sanitizeRaw(message) {
  let t = String(message || "")
    .trim()
    .replace(/^provider returned http \d{3}:?\s*/i, "");
  t = t
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[hidden]")
    .replace(
      /\b(access_token|refresh_token|client_secret|token|code|key|signature|sig)=[^&\s"']+/gi,
      "[hidden]",
    )
    .replace(/https?:\/\/\S+/gi, "[hidden]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[hidden]");
  t = t.replace(/\s+/g, " ").replace(/^[\s|]+|[\s|]+$/g, "");
  return t.length > 200 ? `${t.slice(0, 199).trimEnd()}…` : t;
}

/** One-line failure text for rows, calendar cells and popovers. */
export function failedBannerText(post, account) {
  return friendlyError(post, account)?.banner || "We couldn't post this right now.";
}
