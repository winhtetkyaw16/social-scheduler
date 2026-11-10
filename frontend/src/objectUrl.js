// Shared object-URL cache. Each File gets one blob: URL; thumbs, FixSheet and the live
// preview all share it. Revoke only when the last consumer releases, and only after the
// next paint so a still-mounted <img>/<video> never loads a revoked URL
// (ERR_FILE_NOT_FOUND).
import { useEffect, useState } from "react";

const cache = new Map(); // File -> { url, refs }

export function acquireObjectUrl(file) {
  if (!file) return "";
  if (typeof file === "string") return file;
  let entry = cache.get(file);
  if (!entry) {
    entry = { url: URL.createObjectURL(file), refs: 0 };
    cache.set(file, entry);
  }
  entry.refs += 1;
  return entry.url;
}

export function releaseObjectUrl(file) {
  if (!file || typeof file === "string") return;
  const entry = cache.get(file);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  cache.delete(file);
  const url = entry.url;
  // After React commits the next src (or unmounts), drop the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Hook: stable blob URL for a File (or pass-through for a string URL). */
export function useObjectUrl(file) {
  const [url, setUrl] = useState(() => (typeof file === "string" ? file : ""));
  useEffect(() => {
    if (!file) {
      setUrl("");
      return undefined;
    }
    if (typeof file === "string") {
      setUrl(file);
      return undefined;
    }
    const next = acquireObjectUrl(file);
    setUrl(next);
    return () => releaseObjectUrl(file);
  }, [file]);
  return url;
}

/** Many files → many URLs, keyed by File identity (array identity does not matter). */
export function useObjectUrls(files) {
  const list = Array.isArray(files) ? files : [];
  const [urls, setUrls] = useState(() => list.map((f) => (typeof f === "string" ? f : "")));
  // Stable signature of the File/string identities currently in the list.
  const sig = list
    .map((f) =>
      typeof f === "string" ? `s:${f}` : f ? `f:${f.name}:${f.size}:${f.lastModified}` : "",
    )
    .join("|");
  useEffect(() => {
    const acquired = [];
    const next = list.map((f) => {
      if (!f) return "";
      if (typeof f === "string") return f;
      acquired.push(f);
      return acquireObjectUrl(f);
    });
    setUrls(next);
    return () => {
      acquired.forEach(releaseObjectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity via sig
  }, [sig]);
  return urls;
}
