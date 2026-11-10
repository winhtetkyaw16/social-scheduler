// Errors are derived live from current state: ticks, Fix for me, post type, selected accounts.
import test from "node:test";
import assert from "node:assert/strict";
import {
  autoFormat,
  channelErrors,
  effectiveFormat,
  publishBlock,
  videoFormatMessage,
} from "./fixPlan.js";

const V = { kind: "video", width: 1080, height: 1920 };
const H = { kind: "video", width: 1920, height: 1080 };
const P = { kind: "photo", width: 1080, height: 1080 };
const fb = { id: "fb", platform: "facebook", account_name: "SocialCastly" };
const li = { id: "li", platform: "linkedin", account_name: "Win Htet Kyaw" };

// Mirrors main.jsx: format + warnings + block recomputed from scratch each render.
function render({ accounts, picks, stored = {}, overrides = {} }) {
  const channelWarnings = accounts.flatMap((a) => {
    const infos = picks[a.id] || [];
    const format = effectiveFormat({
      platform: a.platform,
      stored: stored[a.id],
      overridden: !!overrides[a.id],
      infos,
    });
    return channelErrors({
      platform: a.platform,
      label: a.platform,
      format,
      text: "hi",
      limit: 3000,
      hasVideo: infos.some((i) => i.kind === "video"),
      mediaCount: infos.length,
    }).map((message) => ({ account: a, message }));
  });
  const block = publishBlock({ channelWarnings, mediaReport: [] });
  return {
    channelWarnings,
    block,
    buttonDisabled: block.blocked,
    hintShown: block.blocked ? block.hint : null,
  };
}

test("auto format follows current picks", () => {
  assert.equal(autoFormat("linkedin", [V]), "Reel / Video");
  assert.equal(autoFormat("linkedin", [P, P]), "Post");
  assert.equal(autoFormat("facebook", [V]), "Reel / Video");
  assert.equal(autoFormat("facebook", [P]), "Post");
  assert.equal(autoFormat("facebook", [H]), "Post");
});

test("untick the video: stale auto 'video post' disappears (screenshot bug)", () => {
  const stored = { fb: "Reel / Video", li: "Reel / Video" }; // left behind by the upload-time suggestion
  const before = render({ accounts: [fb, li], picks: { fb: [V, P], li: [V] }, stored });
  assert.equal(before.block.blocked, false);
  const after = render({ accounts: [fb, li], picks: { fb: [P, P, P, P, P], li: [P] }, stored });
  assert.deepEqual(after.channelWarnings, []);
  assert.equal(after.block.blocked, false);
  assert.equal(after.buttonDisabled, false);
  assert.equal(after.hintShown, null);
});

test("tick a video back in: still fine, no stale error", () => {
  const r = render({ accounts: [fb], picks: { fb: [V] }, stored: { fb: "Post" } });
  assert.equal(r.block.blocked, false);
});

test("Fix for me swapping picks recomputes errors", () => {
  const overrides = { fb: true };
  const broken = render({
    accounts: [fb],
    picks: { fb: [P] },
    stored: { fb: "Reel / Video" },
    overrides,
  });
  assert.equal(broken.block.blocked, true);
  const fixed = render({
    accounts: [fb],
    picks: { fb: [V] },
    stored: { fb: "Reel / Video" },
    overrides,
  });
  assert.equal(fixed.block.blocked, false);
  assert.equal(fixed.hintShown, null);
});

test("explicit video post type with no video: actionable message; switching to Post clears it", () => {
  const r = render({
    accounts: [fb],
    picks: { fb: [P] },
    stored: { fb: "Reel / Video" },
    overrides: { fb: true },
  });
  assert.equal(r.channelWarnings[0].message, videoFormatMessage("Reel / Video"));
  assert.match(r.channelWarnings[0].message, /tick a video.*switch the post type to Post/);
  assert.equal(r.buttonDisabled, true);
  assert.equal(r.hintShown, r.block.hint);
  const switched = render({
    accounts: [fb],
    picks: { fb: [P] },
    stored: { fb: "Post" },
    overrides: { fb: true },
  });
  assert.equal(switched.block.blocked, false);
});

test("remove the failing account: block clears", () => {
  const args = {
    picks: { fb: [P], li: [P] },
    stored: { li: "Reel / Video" },
    overrides: { li: true },
  };
  const both = render({ accounts: [fb, li], ...args });
  assert.equal(both.block.blocked, true);
  const without = render({ accounts: [fb], ...args });
  assert.equal(without.block.blocked, false);
  assert.equal(without.hintShown, null);
});

test("button disabled iff hint shown", () => {
  for (const picks of [{ fb: [P] }, { fb: [V] }]) {
    const r = render({
      accounts: [fb],
      picks,
      stored: { fb: "Reel / Video" },
      overrides: { fb: true },
    });
    assert.equal(r.buttonDisabled, r.hintShown !== null);
  }
});
