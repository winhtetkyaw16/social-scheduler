/** Decode JWT `exp` (ms since epoch) without verifying the signature. */
export function accessTokenExpiresAtMs(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return 0;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = JSON.parse(json)?.exp;
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** True when the access token is missing, undecodable, or within `skewMs` of expiry. */
export function accessTokenNeedsRefresh(token, skewMs = 60_000, now = Date.now()) {
  if (!token) return true;
  const exp = accessTokenExpiresAtMs(token);
  if (!exp) return true;
  return exp - now <= skewMs;
}
