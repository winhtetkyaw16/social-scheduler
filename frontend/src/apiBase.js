/** API base for the studio. Relative by default so the page and FastAPI share an origin. */

function trimSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

/**
 * Resolve the base used in fetch(`${API_BASE}/auth/login`).
 * VITE_API_BASE_URL wins, then the legacy VITE_API_BASE.
 * Unset means same-origin `/api/v1`. An origin with no path, or a value that
 * ends in `/api`, is normalized onto `/api/v1`.
 */
export function resolveApiBase(env = {}) {
  const configured = env.VITE_API_BASE_URL || env.VITE_API_BASE || "";
  let raw = trimSlash(configured) || "/api/v1";
  if (/^https?:\/\/[^/]+$/i.test(raw)) raw = `${raw}/api/v1`;
  else if (raw === "/api" || /\/api$/i.test(raw)) raw = `${raw}/v1`;
  return raw || "/api/v1";
}

/** Origin used to open /docs and to resolve relative media URLs. */
export function resolveApiOrigin(apiBase, pageOrigin = "") {
  const base = String(apiBase || "");
  if (/^https?:\/\//i.test(base)) return base.replace(/\/api\/v1\/?$/i, "").replace(/\/$/, "");
  return trimSlash(pageOrigin);
}
