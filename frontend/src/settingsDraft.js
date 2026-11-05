// Draft / commit / discard for the per-network "Platform settings" popover.
// Edits live in a local draft until Save; Cancel, the X button, Escape and clicking outside discard it.

export function openDraft(saved = {}, defaults = {}) {
  return { ...defaults, ...(saved && typeof saved === "object" ? saved : {}) };
}

export function updateDraft(draft, key, value) {
  return { ...draft, [key]: value };
}

// Keys whose draft value differs from what is effectively saved (saved value, else default).
export function draftChanges(saved = {}, draft = {}, defaults = {}) {
  const base = openDraft(saved, defaults);
  return Object.keys(draft).filter((key) => draft[key] !== base[key]).map((key) => [key, draft[key]]);
}

export function isDraftDirty(saved, draft, defaults) {
  return draftChanges(saved, draft, defaults).length > 0;
}

// Apply a draft through the existing per-key setter; returns the number of keys written.
export function commitDraft(accountId, saved, draft, defaults, setSetting) {
  const changes = draftChanges(saved, draft, defaults);
  changes.forEach(([key, value]) => setSetting?.(accountId, key, value));
  return changes.length;
}

// Fields the composer used to show that no publishing API can apply. Kept here so the popover
// and its note stay in sync (see the PR's audit table).
export const UNSUPPORTED_FIELDS = {
  facebook: ["Privacy (Page posts are always public)", "Location tag (needs a Facebook place ID)"],
  instagram: ["Hide like and view counts", "Location tag (needs an Instagram location ID)"],
  linkedin: ["Who can comment"],
};
