import test from "node:test";
import assert from "node:assert/strict";
import { choiceOptions, indicesForChoice, choiceOf, pickerFor, togglePick, rowText, buildFixPlan, planResult, identityLine, fmtDuration } from "./fixPlan.js";
import { checkMedia } from "./mediaRules.js";

const P = (n) => ({ kind: "photo", width: 1080, height: 1080, name: `p${n}.jpg` });
const V = { kind: "video", duration: 42, name: "clip.mp4" };
const G = { kind: "gif", name: "a.gif" };
const MIX = [P(1), P(2), P(3), P(4), P(5), P(6), V];
const acc = (id, platform, extra = {}) => ({ id, platform, account_name: `Acct ${id}`, ...extra });

test("toggle shows only when both photos and video exist; X adds GIF", () => {
  assert.deepEqual(choiceOptions("facebook", MIX), ["Photos", "Video"]);
  assert.deepEqual(choiceOptions("linkedin", MIX), ["Photos", "Video"]);
  assert.deepEqual(choiceOptions("tiktok", MIX), ["Photos", "Video"]);
  assert.deepEqual(choiceOptions("x", [...MIX, G]), ["Photos", "Video", "GIF"]);
  assert.deepEqual(choiceOptions("facebook", [P(1), P(2)]), []);
  assert.deepEqual(choiceOptions("instagram", MIX), []);
});

test("toggle results per network", () => {
  assert.deepEqual(indicesForChoice("facebook", MIX, "Video"), [6]);
  assert.deepEqual(indicesForChoice("facebook", MIX, "Photos"), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(indicesForChoice("x", MIX, "Photos"), [0, 1, 2, 3]);
  assert.deepEqual(indicesForChoice("x", [...MIX, G], "GIF"), [7]);
  assert.deepEqual(indicesForChoice("x", MIX, "Photos", { xPhotos: [5, 4, 2, 1] }), [5, 4, 2, 1]);
  assert.equal(choiceOf(MIX, [6]), "Video");
  assert.equal(choiceOf(MIX, [0, 1]), "Photos");
});

test("picker limits and X choose 4", () => {
  assert.equal(pickerFor("instagram", MIX).limit, 20);
  assert.equal(pickerFor("threads", MIX).limit, 20);
  const x = pickerFor("x", MIX);
  assert.equal(x.kind, "x4"); assert.equal(x.limit, 4); assert.deepEqual(x.items, [0, 1, 2, 3, 4, 5]);
  assert.equal(pickerFor("x", [P(1), P(2)]), null);
  assert.deepEqual(togglePick([0, 1, 2, 3], 4, 4), [0, 1, 2, 3]);
  assert.deepEqual(togglePick([0, 1, 2], 5, 4), [0, 1, 2, 5]);
  assert.deepEqual(togglePick([2], 2, 4), [2]);
  assert.deepEqual(togglePick([1, 2], 1, 4), [2]);
});

test("row text: summaries and notes, no sizes or formats", () => {
  assert.deepEqual(rowText("facebook", MIX, [6], { suggested: [0, 1, 2, 3, 4, 5] }), { line2: "Video · 0:42", line3: "Photos won't be posted here" });
  assert.deepEqual(rowText("facebook", MIX, [0, 1, 2, 3, 4, 5], { suggested: [0, 1, 2, 3, 4, 5] }), { line2: "6 photos", line3: "Facebook can't mix photos and a video" });
  assert.deepEqual(rowText("x", MIX, [0, 1, 2, 3], { suggested: [0, 1, 2, 3] }), { line2: "4 photos", line3: "X allows up to 4 — we'll use the first 4" });
  assert.equal(rowText("instagram", MIX, [0, 1, 2, 3, 4, 5, 6]).line2, "Carousel · 7 items");
  const crop = [{ kind: "photo", width: 1000, height: 3000 }, P(2)];
  assert.equal(rowText("instagram", crop, [0, 1]).line3, ""); // auto-fit is silent
  assert.equal(fmtDuration(42), "0:42"); assert.equal(fmtDuration(125), "2:05");
});

test("nothing-postable states", () => {
  const plan = buildFixPlan([{ account: acc(1, "youtube"), infos: [P(1)], problems: 1 }]);
  assert.equal(plan.entries[0].empty, true);
  assert.equal(plan.entries[0].line2, "Nothing to post here");
  const skipped = buildFixPlan([{ account: acc(1, "youtube"), infos: [P(1)], problems: 1 }, { account: acc(2, "facebook"), infos: [P(1)], problems: 0 }], { 1: { skip: true } });
  assert.equal(skipped.entries[0].line3, "This account won't get this post.");
  assert.equal(skipped.counts.total, 1);
  assert.deepEqual(planResult(skipped), { selections: { 2: [0] }, skip: [1], count: 1 });
});

test("counts match between panel and sheet; no-changes group", () => {
  const rows = [
    { account: acc(1, "facebook"), infos: MIX, problems: 1 },
    { account: acc(2, "x"), infos: MIX, problems: 1 },
    { account: acc(3, "instagram"), infos: MIX, problems: 0 },
    { account: acc(4, "threads"), infos: MIX, problems: 0 },
  ];
  const panel = buildFixPlan(rows);
  const sheet = buildFixPlan(rows, { 1: { indices: [6] } });
  assert.equal(panel.counts.changing, 2); assert.equal(sheet.counts.changing, 2);
  assert.equal(sheet.counts.unchanged, 2); assert.equal(sheet.counts.total, 4);
  assert.equal(sheet.entries[0].changed, true); assert.equal(sheet.entries[0].choice, "Video");
  assert.equal(panel.entries[0].changed, false);
});

test("identity: handle only from API, FB pages say Facebook Page", () => {
  assert.equal(identityLine(acc(1, "facebook")), "Facebook Page");
  assert.equal(identityLine(acc(2, "x", { username: "winhk" })), "X · @winhk");
  assert.equal(identityLine(acc(3, "linkedin")), "LinkedIn");
});

test("Fix for me count ignores what the app fixes on its own (small, odd-shaped, PNG Instagram photos)", () => {
  const ig = { id: "ig1", platform: "instagram" }, tt = { id: "tt1", platform: "tiktok" };
  const infos = [{ kind: "photo", width: 95, height: 400, ext: "png" }, { kind: "photo", width: 3000, height: 800, ext: "webp" }];
  const rows = [ig, tt].map((account) => ({ account, format: "Post", infos, problems: checkMedia(account.platform, infos).problems.length }));
  assert.equal(buildFixPlan(rows).counts.changing, 0);
});

test("publishBlock: errors block posting, auto-fixed issues and warnings don't, and it re-enables once cleared", async () => {
  const { publishBlock } = await import("./fixPlan.js");
  const ig = { id: "ig", platform: "instagram" }, yt = { id: "yt", platform: "youtube" };
  assert.deepEqual(publishBlock({}), { blocked: false, accounts: 0, hint: "" });
  // Auto-fixed (IG upscale / auto-fit) leave no problems; warnings live in channelNotices, not here.
  assert.equal(publishBlock({ mediaReport: [{ account: ig, check: { problems: [], notes: ["auto"], hints: [] } }] }).blocked, false);
  const err = publishBlock({ channelWarnings: [{ account: yt, message: "Please include a video for this Short" }] });
  assert.equal(err.blocked, true); assert.equal(err.hint, "Fix the errors above to post");
  const media = publishBlock({ mediaReport: [{ account: ig, check: { problems: ["too many"] } }, { account: yt, check: { problems: [] } }] });
  assert.equal(media.blocked, true); assert.equal(media.accounts, 1);
  // After Fix for me / removing media / deselecting the channel the lists are empty again.
  assert.equal(publishBlock({ channelWarnings: [], mediaReport: [{ account: ig, check: { problems: [] } }] }).blocked, false);
});
