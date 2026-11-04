// Modals are portalled to <body> so position:fixed is relative to the viewport. A transformed/filtered/contained
// ancestor (e.g. the composer's `animate-fade-up`, animation fill-mode "both" keeps a transform) or the body
// scroll lock (body position:fixed; top:-scrollY) would otherwise shift or clip them. Pure so node --test can check it.
export function hasDarkRoot(doc) {
  if (!doc) return false;
  if (doc.documentElement?.classList?.contains("dark")) return true;
  return !!doc.querySelector?.(".sc-app-root.dark, .scd.dark");
}
/** Class list for the portal wrapper: keeps the `.scd` (and `.dark`) scope the modal CSS is written against. */
export function modalLayerClass(doc, extra = "") {
  return ["scd", "sc-modal-layer", hasDarkRoot(doc) ? "dark" : "", extra].filter(Boolean).join(" ");
}
/** True when an element's computed style would make it the containing block for position:fixed descendants. */
export function trapsFixed(style) {
  if (!style) return false;
  const v = (k) => String(style[k] ?? "").trim();
  if (v("transform") && v("transform") !== "none") return true;
  if (v("filter") && v("filter") !== "none") return true;
  if (v("backdropFilter") && v("backdropFilter") !== "none") return true;
  if (v("perspective") && v("perspective") !== "none") return true;
  if (/(paint|layout|strict|content)/.test(v("contain"))) return true;
  return /(transform|filter|perspective)/.test(v("willChange"));
}
