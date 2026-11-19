// Pure logic for the post-OAuth destination picker ("Choose Facebook Pages") and the
// "Facebook Page instead of a made-up @handle" rule. No React here so node --test can check it.

export const FACEBOOK_CREATE_PAGE_URL = "https://www.facebook.com/pages/create";

const sentence = (text) => {
  const s = String(text || "")
    .trim()
    .replace(/_/g, " ");
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

/** A handle only when the API gave one (username / screen_name / handle, or a trailing "(@x)" in the name). */
export function realHandle(account) {
  const meta =
    (account && typeof account.extra_metadata === "object" && account.extra_metadata) || {};
  const raw =
    account?.username ||
    meta.username ||
    meta.screen_name ||
    meta.handle ||
    /\(@([^)]+)\)\s*$/.exec(String(account?.account_name || account?.name || ""))?.[1] ||
    "";
  const h = String(raw).trim().replace(/^@/, "");
  return h ? `@${h}` : "";
}

export const isFacebook = (item) => String(item?.platform || "").toLowerCase() === "facebook";

/** Muted kind line for a Facebook account: "Facebook Page" / "Facebook Group". */
export function facebookKind(item) {
  return String(item?.account_type || "").toLowerCase() === "group"
    ? "Facebook Group"
    : "Facebook Page";
}

/** Strip a trailing "(@handle)" the API adds to some names. */
export function cleanName(name) {
  return (
    String(name || "")
      .replace(/\s*\(@[^)]*\)\s*$/, "")
      .trim() || String(name || "").trim()
  );
}

/** Row subtitle in the picker. Facebook: "Facebook Page[ · Category]". Others: network kind [· @handle if real]. */
export function destinationSubtitle(item, sessionPlatform = "facebook") {
  const platform = String(item?.platform || sessionPlatform || "").toLowerCase();
  if (platform === "facebook") {
    const cat = sentence(item?.category);
    return cat ? `${facebookKind(item)} \u00b7 ${cat}` : facebookKind(item);
  }
  const kinds = {
    instagram: "Instagram account",
    linkedin: String(item?.account_type) === "organization" ? "Company page" : "LinkedIn profile",
    youtube: "YouTube channel",
    pinterest: String(item?.account_type) === "board" ? "Pinterest board" : "Pinterest account",
  };
  const kind = kinds[platform] || sentence(item?.account_type) || sentence(platform);
  const h = realHandle(item);
  return h ? `${kind} \u00b7 ${h}` : kind;
}

export const isSelectable = (item) => !item?.already_connected;

/** Pages that can still be chosen (already-added ones are excluded from counts and Select all). */
export function selectableIds(destinations = []) {
  return destinations.filter(isSelectable).map((item) => String(item.id));
}

export function initialSelection(destinations = []) {
  return selectableIds(destinations);
}

export function toggleSelection(selected = [], id, destinations = []) {
  const key = String(id);
  if (!selectableIds(destinations).includes(key)) return selected;
  return selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key];
}

export function showSelectAll(destinations = []) {
  return selectableIds(destinations).length >= 2;
}

export function allSelected(selected = [], destinations = []) {
  const ids = selectableIds(destinations);
  return ids.length > 0 && ids.every((id) => selected.includes(id));
}

/** Select all, or clear when everything selectable is already selected. */
export function toggleAll(selected = [], destinations = []) {
  return allSelected(selected, destinations) ? [] : selectableIds(destinations);
}

/** Noun for counts: "Page(s)" when every selectable row is a Facebook Page, else "destination(s)". */
export function pickerNoun(destinations = [], count = 2) {
  const rows = destinations.filter(isSelectable);
  const pages =
    rows.length > 0 &&
    rows.every((item) => isFacebook(item) && facebookKind(item) === "Facebook Page");
  const word = pages || rows.length === 0 ? "Page" : "destination";
  return count === 1 ? word : `${word}s`;
}

export function selectionSummary(selected = [], destinations = []) {
  const ids = selectableIds(destinations);
  const n = selected.filter((id) => ids.includes(id)).length;
  const m = ids.length;
  return {
    n,
    m,
    status: `${n} of ${m} ${pickerNoun(destinations, m)} selected`,
    addLabel:
      n > 0 ? `Add ${n} ${pickerNoun(destinations, n)}` : `Add ${pickerNoun(destinations, 2)}`,
    canAdd: n > 0,
  };
}

export function pickerTitle(platform, label) {
  return String(platform) === "facebook"
    ? "Choose Facebook Pages"
    : `Choose ${label || platform} destinations`;
}

export function pickerSubtitle(platform) {
  return String(platform) === "facebook"
    ? "Pick the Pages you want to post to. You can change this later."
    : "Pick where you want to post. You can change this later.";
}

/**
 * Picker mode:
 *  - "reconnect": opened from Re-auth (reauthId set). Existing Pages show "Connected" (checked, disabled) and the
 *    primary action refreshes their tokens; newly ticked Pages are added too.
 *  - "all-added": normal Connect where every returned destination is already connected -> note + "Done".
 *  - "connect": normal Connect with something new to add.
 */
export function pickerMode({ reauthId = "", destinations = [] } = {}) {
  if (reauthId) return "reconnect";
  if (destinations.length > 0 && selectableIds(destinations).length === 0) return "all-added";
  return "connect";
}

/** Primary button state and the save request for the current mode. */
export function primaryAction(mode, selected = [], destinations = []) {
  const ids = selectableIds(destinations);
  const picked = selected.filter((id) => ids.includes(id));
  const n = picked.length;
  if (mode === "reconnect") {
    return {
      label: n > 0 ? `Save ${n} ${pickerNoun(destinations, n)}` : "Reconnect",
      enabled: true,
      ids: picked,
      refreshExisting: true,
    };
  }
  if (mode === "all-added") return { label: "Done", enabled: true, ids: [], refreshExisting: true };
  const summary = selectionSummary(selected, destinations);
  return { label: summary.addLabel, enabled: summary.canAdd, ids: picked, refreshExisting: false };
}

/** Footer status text, or "" when there is nothing selectable (M = 0). */
export function footerStatus(selected = [], destinations = []) {
  const summary = selectionSummary(selected, destinations);
  return summary.m > 0 ? summary.status : "";
}

/** Right-hand label for an already-connected row. */
export function connectedLabel(mode) {
  return mode === "reconnect" ? "Connected" : "Already added";
}

export function isReauthRow(item, reauthId) {
  return Boolean(reauthId) && String(item?.id) === String(reauthId);
}
