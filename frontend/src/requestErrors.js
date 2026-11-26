export const connectionError = "Couldn't reach SocialCastly. Check your connection and try again.";

export function channelConnectionError(detail) {
  return readableDetail(detail) || "Try connecting again later. If this continues, contact support.";
}

export function rejectedWorkspaceSession(response, detail) {
  return response.status === 401 && (
    /^Bearer\b/i.test(response.headers.get("WWW-Authenticate") || "") ||
    detail === "Invalid authentication credentials" || detail === "Not authenticated"
  );
}

// Only a rejected sign-in should send the user back to the login screen.
export async function readSessionRefresh(response) {
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw requestError(response.status, null, response.headers);
  const body = await response.json().catch(() => null);
  if (!body?.access_token) throw new Error(connectionError);
  return body;
}

const fallbackMessages = {
  400: "Check the details you entered and try again.",
  401: "Sign in again to continue.",
  403: "Your account can't make this change.",
  404: "This item is unavailable. Refresh the page to see the latest changes.",
  409: "Refresh the page to see the latest changes before trying again.",
  413: "This file is too large. Choose a smaller file and try again.",
  422: "Check the details you entered and try again.",
};

function rateLimitMessage(retryAfter) {
  const value = retryAfter?.trim() || "";
  const retryAt = value.endsWith(" GMT") ? Date.parse(value) : NaN;
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((retryAt - Date.now()) / 1000);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    return "Too many attempts right now. Please wait a little and try again.";
  }
  const minutes = Math.ceil(seconds / 60);
  const wait = seconds < 60
    ? `${seconds} ${seconds === 1 ? "second" : "seconds"}`
    : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return `Too many attempts right now. Try again in ${wait}.`;
}

// Keep product guidance such as file size limits and retry times. Drop diagnostics.
export function readableDetail(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (text.length > 350 || /[<>\r\n{}]|\b\w+_\w+\b/.test(text)) return "";
  if (/\b(bearer|client secret|econnreset|econnrefused|enotfound|etimedout)\b/i.test(text)) return "";
  if (/\b(apis?|oauth|developer console|redirect uri|app credentials|authorization code|login kit|video\.list|media\.write|tweet\.write|user\.info\.\w+|https?|sql\w*|database|traceback|stack trace|\w*exception|\w+error|tokens?|scopes?|credits?(?:depleted)?|permissions?|internal server error|bad gateway|service unavailable|unprocessable entity|network id)\b/i.test(text)) return "";
  return text;
}

export function requestError(status, body, headers) {
  if (status === 429) {
    const message = rateLimitMessage(headers?.get("Retry-After"));
    return Object.assign(new Error(message), { status, detail: message });
  }
  const detail = body?.detail;
  let message = readableDetail(detail);
  if (Array.isArray(detail)) {
    const hints = detail.map((item) => {
      // Application validators supply guidance as a ValueError. Framework
      // diagnostics can include internal field names, types and input values.
      if (item?.loc?.at(-1) === "password" && item.type === "string_too_short" && Number.isInteger(item.ctx?.min_length)) {
        return `Use a password with at least ${item.ctx.min_length} characters.`;
      }
      if (item?.loc?.at(-1) === "email" && item.type === "value_error") return "Enter a valid email address.";
      if (item?.type !== "value_error" || typeof item.msg !== "string") return "";
      return readableDetail(item.msg.replace(/^Value error, /, ""));
    }).filter(Boolean);
    message = [...new Set(hints)].join(" · ");
  }
  if (detail === "Invalid credentials, please try again") message = "Check your email and password and try again.";
  if (!message) message = fallbackMessages[status] || "SocialCastly couldn't complete this request. Please try again later.";
  return Object.assign(new Error(message), { status, detail: message });
}
