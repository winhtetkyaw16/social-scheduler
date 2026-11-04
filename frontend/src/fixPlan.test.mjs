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

test("savedPostBlock: same rules as the composer for a saved post; auto-fixed issues don't block", async () => {
  const { savedPostBlock, channelErrors } = await import("./fixPlan.js");
  const fb = { id: "fb", platform: "facebook" }, ig = { id: "ig", platform: "instagram" };
  const post = (format, media, content = "Hi") => ({ content, media_urls: media, post_metadata: { format } });
  const reel = savedPostBlock({ account: fb, post: post("Reel / Video", ["https://c/x.jpg"]), limit: 500 });
  assert.equal(reel.blocked, true); assert.equal(reel.hint, "Fix the errors above to post");
  assert.ok(reel.messages.some((m) => m.includes("include a video")));
  assert.equal(savedPostBlock({ account: fb, post: post("Reel / Video", ["https://c/x.mp4"]), limit: 500 }).blocked, false);
  // Caption is read live from the panel, so fixing it there clears the block.
  assert.equal(savedPostBlock({ account: fb, post: post("Post", ["https://c/x.jpg"]), content: "  ", limit: 500 }).blocked, true);
  assert.equal(savedPostBlock({ account: fb, post: post("Post", ["https://c/x.jpg"]), content: "ok", limit: 500 }).blocked, false);
  // Instagram small/odd photos are upscaled/auto-fit at publish: no block (no dims known for a saved post).
  assert.equal(savedPostBlock({ account: ig, post: post("Post", ["https://c/a.png", "https://c/b.jpg"]), limit: 2200 }).blocked, false);
  // Media problems from checkMedia block too (TikTok can't mix a video and a photo).
  assert.equal(savedPostBlock({ account: { id: "t", platform: "tiktok" }, post: post("Post", ["https://c/v.mp4", "https://c/p.jpg"]), limit: 2200 }).blocked, true);
  // Composer and panel share channelErrors.
  assert.deepEqual(channelErrors({ platform: "threads", format: "Story", text: "x", limit: 500, mediaCount: 1 }), ["Story is not available for threads; choose a supported format."]);
});

// --- 2+ videos on single-video networks (regression: errors vanished, Fix for me knew only one video) ---
const V1 = { kind: "video", duration: 21, name: "a.mp4" };
const V2 = { kind: "video", duration: 65, name: "b.mp4" };
const TWO = [V1, V2, P(1), P(2), P(3)];
const EIGHT = ["facebook", "linkedin", "tiktok", "x", "youtube", "instagram", "threads", "pinterest"];

test("blockingGroups: 2 videos + photos on 8 channels gives the specific grouped 'only 1 video' error, and the hint shows", async () => {
  const { blockingGroups, publishBlock } = await import("./fixPlan.js");
  const rows = EIGHT.map((p, i) => ({ account: acc(i + 1, p), infos: TWO, check: checkMedia(p, TWO, { format: "Post" }) }));
  const groups = blockingGroups(rows);
  const one = groups.find((g) => g.key === "one_video");
  assert.ok(one, "specific error is returned");
  assert.equal(one.message, "Facebook, LinkedIn, TikTok, X and YouTube allow only 1 video per post");
  assert.deepEqual(one.accounts.map((a) => a.platform), ["facebook", "linkedin", "tiktok", "x", "youtube"]);
  assert.ok(!groups.some((g) => /instagram|threads/i.test(g.message) && /1 video/.test(g.message)));
  const block = publishBlock({ mediaReport: rows });
  assert.equal(block.blocked, true);
  assert.equal(block.hint, "Fix the errors above to post");
  assert.deepEqual(blockingGroups([{ account: acc(9, "youtube"), infos: [V1, V2], check: checkMedia("youtube", [V1, V2]) }])[0].message, "YouTube allows only 1 video per post");
});

test("buildFixPlan with 2 videos: single-video networks get a video picker with every video; IG/Threads keep both", () => {
  const rows = ["facebook", "youtube", "instagram", "threads"].map((p, i) => ({ account: acc(i + 1, p), infos: TWO, check: checkMedia(p, TWO, { format: "Post" }) }));
  const plan = buildFixPlan(rows, { 1: { choice: "Video" } });
  const fb = plan.entries.find((e) => e.platform === "facebook");
  const fbv = buildFixPlan(rows, { 1: { indices: [0] } }).entries.find((e) => e.platform === "facebook");
  assert.equal(fbv.picker.kind, "video");
  assert.deepEqual(fbv.picker.items, [0, 1]);
  assert.equal(fbv.picker.chosen, 0);
  assert.match(fbv.line3, /other video won't be posted here/);
  const yt = plan.entries.find((e) => e.platform === "youtube");
  assert.equal(yt.picker.kind, "video");
  assert.match(yt.line3, /The other video won't be posted here/);
  for (const p of ["instagram", "threads"]) {
    const e = plan.entries.find((x) => x.platform === p);
    if (e) assert.ok(e.indices.includes(0) && e.indices.includes(1), `${p} keeps both videos`);
  }
  void fb;
});

test("per-account video choice is honoured and the publish payload sends only that video", async () => {
  const { videoChoice, urlsForSelection } = await import("./fixPlan.js");
  assert.deepEqual(indicesForChoice("facebook", TWO, "Video"), [0]);
  assert.deepEqual(indicesForChoice("facebook", TWO, "Video", { video: 1 }), [1]);
  assert.deepEqual(videoChoice(TWO, 3), [0], "a photo index is not a valid video pick");
  const rows = [{ account: acc(1, "facebook"), infos: TWO, check: checkMedia("facebook", TWO, { format: "Post" }) },
    { account: acc(2, "x"), infos: TWO, check: checkMedia("x", TWO, { format: "Post" }) }];
  const plan = buildFixPlan(rows, { 1: { indices: [1], video: 1 }, 2: { indices: [0], video: 0 } });
  const fb = plan.entries.find((e) => e.account.id === 1);
  assert.deepEqual(fb.indices, [1]);
  assert.equal(fb.picker.chosen, 1);
  const sel = planResult(plan).selections;
  assert.deepEqual(sel[1], [1]); assert.deepEqual(sel[2], [0]);
  const urls = ["/m/a.mp4", "/m/b.mp4", "/m/p1.jpg", "/m/p2.jpg", "/m/p3.jpg"];
  assert.deepEqual(urlsForSelection(urls, sel[1]), ["/m/b.mp4"]);
  assert.deepEqual(urlsForSelection(urls, sel[2]), ["/m/a.mp4"]);
});

test("composer CSS shows the 'Fix the errors' hint on desktop whenever posting is blocked", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("./sc/composer-v2.css", import.meta.url), "utf8");
  // Top-level rule (not indented inside a mobile-only @media block).
  assert.match(css, /^\.scd \.c2 \.c2-pbar\.fix-first \.c2-fixhint\{display:block\}/m);
});

test("media panel spacing: pulled up with even top/bottom gaps (no overlap: stays inside the body's 18px padding)", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("./sc/composer-v2.css", import.meta.url), "utf8");
  const m = css.match(/^\.scd \.c2 \.mp\{margin:(-?\d+)px 16px (\d+)px;/m);
  assert.ok(m);
  const above = 18 + Number(m[1]), below = Number(m[2]);
  assert.ok(above >= 8 && Math.abs(above - below) <= 4, `gap above ${above}px vs below ${below}px`);
});
