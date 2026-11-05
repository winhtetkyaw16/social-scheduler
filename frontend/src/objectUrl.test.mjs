import test from "node:test";
import assert from "node:assert/strict";
import { acquireObjectUrl, releaseObjectUrl } from "./objectUrl.js";

test("shared File gets one URL; revoke only after last release + tick", async () => {
  const file = new Blob(["x"], { type: "video/mp4" });
  // Give File-like identity fields the hook uses elsewhere
  Object.assign(file, { name: "a.mp4", lastModified: 1 });
  const a = acquireObjectUrl(file);
  const b = acquireObjectUrl(file);
  assert.equal(a, b);
  assert.match(a, /^blob:/);
  releaseObjectUrl(file);
  // Still referenced — must not be revoked yet (browser would ERR_FILE_NOT_FOUND).
  assert.equal(acquireObjectUrl(file), a);
  releaseObjectUrl(file); // back to 1
  releaseObjectUrl(file); // to 0 → deferred revoke
  await new Promise((r) => setTimeout(r, 20));
  // New acquire after full release must mint a fresh URL
  const c = acquireObjectUrl(file);
  assert.match(c, /^blob:/);
  assert.notEqual(c, a);
  releaseObjectUrl(file);
});

test("string URLs pass through and never revoke", () => {
  assert.equal(acquireObjectUrl("https://x/a.jpg"), "https://x/a.jpg");
  releaseObjectUrl("https://x/a.jpg");
});
