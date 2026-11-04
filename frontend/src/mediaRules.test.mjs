// Run with: node --test frontend/src/mediaRules.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { igPhotoWarnings, mediaInfo, autoSplit, checkMedia, actionIndices, splitLabel, summarize, selectionFor, defaultIndices, instagramCropBox, cropIndices } from "./mediaRules.js";

const vid = (d = 42, w = 1080, h = 1920, ext = "mp4") => ({ kind: "video", ext, size: 0, width: w, height: h, duration: d });
const pic = (w = 1080, h = 1080, ext = "jpg", size = 0) => ({ kind: "photo", ext, size, width: w, height: h, duration: null });
const gif = () => ({ kind: "gif", ext: "gif", size: 0, width: 400, height: 300, duration: null });
// The design's example: 1 video + 5 photos, photo 3 (index 3) too wide for Instagram.
const MIX = [vid(), pic(), pic(), pic(3000, 1000), pic(), pic()];
const codes = (r) => r.problems.map((p) => p.code);

test("mediaInfo classifies files and urls", () => {
  assert.equal(mediaInfo("https://x/a/clip.MOV").kind, "video");
  assert.equal(mediaInfo("https://x/a/clip.MOV").ext, "mov");
  assert.equal(mediaInfo("/static/uploads/a.gif").kind, "gif");
  assert.equal(mediaInfo({ name: "p.jpeg", type: "image/jpeg", size: 5 }).ext, "jpg");
  assert.equal(mediaInfo({ name: "blob", type: "video/mp4", size: 5 }, { width: 1, height: 2, duration: 3 }).duration, 3);
});

test("auto-split per network (design example)", () => {
  assert.deepEqual(autoSplit("instagram", MIX), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(autoSplit("threads", MIX), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(autoSplit("facebook", MIX), [1, 2, 3, 4, 5]);
  assert.deepEqual(autoSplit("linkedin", MIX), [1, 2, 3, 4, 5]);
  assert.deepEqual(autoSplit("x", MIX), [1, 2, 3, 4]);
  assert.deepEqual(autoSplit("tiktok", MIX), [0]);
  assert.deepEqual(autoSplit("youtube", MIX), [0]);
});

test("auto-split edge cases", () => {
  assert.equal(autoSplit("instagram", Array.from({ length: 25 }, () => pic())).length, 20);
  assert.equal(autoSplit("tiktok", Array.from({ length: 40 }, () => pic())).length, 35);
  assert.deepEqual(autoSplit("x", [gif()]), [0]);
  assert.deepEqual(autoSplit("x", [vid(), gif()]), [0]);
  assert.deepEqual(autoSplit("facebook", [vid(), vid()]), [0]);
  assert.deepEqual(autoSplit("youtube", [pic()]), []);
  assert.deepEqual(autoSplit("instagram", [vid(90), pic()], { format: "Story" }), [1]);
  assert.deepEqual(autoSplit("instagram", [vid(30), pic()], { format: "Story" }), [0]);
});

test("Instagram: mixed carousel of up to 20 is fine, odd-sized photos are auto-fitted (never a problem)", () => {
  const r = checkMedia("instagram", MIX);
  assert.deepEqual(codes(r), []);
  const tall = [{ kind: "photo", width: 1080, height: 2340 }, { kind: "photo", width: 1920, height: 1080 }, { kind: "video", width: 1920, height: 1080, duration: 20 }];
  assert.deepEqual(codes(checkMedia("instagram", tall)), []);
  assert.deepEqual(checkMedia("instagram", tall).notes, []); // auto-fit is silent
  assert.deepEqual(codes(checkMedia("instagram", Array.from({ length: 20 }, () => pic()))), []);
  assert.deepEqual(codes(checkMedia("instagram", Array.from({ length: 21 }, () => pic()))), ["too_many"]);
  assert.deepEqual(checkMedia("instagram", [pic(1080, 1080, "png")]).notes, []); // JPG conversion is silent
});

test("Instagram Story limits are separate from feed limits", () => {
  assert.deepEqual(codes(checkMedia("instagram", [vid(120)])), []); // feed Reel: up to 15 min
  assert.deepEqual(codes(checkMedia("instagram", [vid(120)], { format: "Story" })), ["story_long"]);
  assert.deepEqual(codes(checkMedia("instagram", [vid(50)], { format: "Story" })), []);
  assert.deepEqual(codes(checkMedia("instagram", [vid(50), pic()], { format: "Story" })), ["too_many"]);
  assert.deepEqual(codes(checkMedia("instagram", [vid(1000)])), ["video_long"]);
});

test("TikTok: 1 video or 1-35 photos, not mixed", () => {
  assert.deepEqual(codes(checkMedia("tiktok", [vid()])), []);
  assert.deepEqual(codes(checkMedia("tiktok", [pic()])), []);
  assert.deepEqual(codes(checkMedia("tiktok", Array.from({ length: 35 }, () => pic()))), []);
  assert.deepEqual(codes(checkMedia("tiktok", Array.from({ length: 36 }, () => pic()))), ["too_many"]);
  assert.deepEqual(codes(checkMedia("tiktok", MIX)), ["mixed"]);
  assert.equal(checkMedia("tiktok", MIX).problems[0].action.id, "use_video");
  assert.deepEqual(checkMedia("tiktok", [pic(1, 1, "png")]).notes, []); // photo conversion is silent
});

test("X: 4 photos, 1 video, or 1 GIF", () => {
  assert.deepEqual(codes(checkMedia("x", [gif()])), []);
  assert.deepEqual(codes(checkMedia("x", [pic(), pic(), pic(), pic()])), []);
  assert.deepEqual(codes(checkMedia("x", [vid(10, 1920, 1080)])), []);
  assert.deepEqual(codes(checkMedia("x", MIX)), ["too_many"]);
  assert.equal(checkMedia("x", MIX).problems[0].action.label, "Keep 4 photos");
  assert.deepEqual(codes(checkMedia("x", [gif(), pic()])), ["too_many"]);
  assert.deepEqual(codes(checkMedia("x", [vid(10, 4000, 1000)])), ["x_ratio"]);
});

test("Facebook and LinkedIn: photos or one video; conversions are notes", () => {
  assert.deepEqual(codes(checkMedia("facebook", MIX)), ["mixed"]);
  assert.deepEqual(codes(checkMedia("linkedin", MIX)), ["mixed"]);
  assert.deepEqual(codes(checkMedia("linkedin", Array.from({ length: 21 }, () => pic()))), ["too_many"]);
  const li = checkMedia("linkedin", [vid(10, 1, 1, "mov")]);
  assert.deepEqual(codes(li), []);
  assert.deepEqual(li.notes, []);
  const fb = checkMedia("facebook", [pic(1, 1, "webp", 5 * 1024 * 1024)]);
  assert.deepEqual(codes(fb), []);
  assert.equal(fb.notes.length, 0);
});

test("YouTube: needs a video, shape is only a hint", () => {
  assert.deepEqual(codes(checkMedia("youtube", [pic()])), ["no_video"]);
  const r = checkMedia("youtube", [vid(10, 1000, 1000)]);
  assert.deepEqual(codes(r), []);
  assert.equal(r.hints.length, 1);
  assert.deepEqual(codes(checkMedia("youtube", MIX)), []); // mixed: YouTube just takes the video
  assert.deepEqual(defaultIndices("youtube", MIX), [0]);
  assert.deepEqual(defaultIndices("instagram", MIX), [0, 1, 2, 3, 4, 5]);
});

test("Threads: carousel up to 20", () => {
  assert.deepEqual(codes(checkMedia("threads", MIX)), []);
  assert.deepEqual(codes(checkMedia("threads", Array.from({ length: 21 }, () => pic()))), ["too_many"]);
});

test("auto-split result always passes the rules", () => {
  for (const p of ["instagram", "threads", "facebook", "linkedin", "x", "tiktok", "youtube"]) {
    const picked = autoSplit(p, MIX).map((i) => MIX[i]);
    assert.deepEqual(codes(checkMedia(p, picked, {})), [], p);
  }
});

test("review actions pick media", () => {
  assert.deepEqual(actionIndices("pick_photos", "facebook", MIX), [1, 2, 3, 4, 5]);
  assert.deepEqual(actionIndices("keep_photos", "x", MIX), [1, 2, 3, 4]);
  assert.deepEqual(actionIndices("use_video", "tiktok", MIX), [0]);
  assert.equal(actionIndices("crop", "instagram", MIX), null);
});

test("labels, crops and summary", () => {
  assert.equal(splitLabel("instagram", MIX, [0, 1, 2, 3, 4, 5], { cropped: [3] }), "Carousel · all 6");
  assert.equal(splitLabel("facebook", MIX, [1, 2, 3, 4, 5]), "5 photos");
  assert.equal(splitLabel("x", MIX, [1, 2, 3, 4]), "First 4 photos");
  assert.equal(splitLabel("tiktok", MIX, [0]), "The video");
  assert.deepEqual(cropIndices("instagram", MIX, [0, 1, 2, 3, 4, 5]), [3]);
  assert.deepEqual(instagramCropBox(3000, 1000), { x: 545, y: 0, width: 1910, height: 1000 });
  assert.deepEqual(instagramCropBox(1000, 2000), { x: 0, y: 375, width: 1000, height: 1250 });
  const rows = ["facebook", "youtube", "threads"].map((platform) => ({ platform, infos: MIX, indices: defaultIndices(platform, MIX), check: checkMedia(platform, MIX) }));
  const s = summarize(rows);
  assert.equal(s.count, 1);
  assert.deepEqual(s.fine, ["YouTube will use just the video", "Threads takes all 6 items"]);
});

test("selection lookup: account, then network default", () => {
  const a = { id: "a1", platform: "instagram" };
  assert.equal(selectionFor(a, {}), null);
  assert.deepEqual(selectionFor(a, { byNetwork: { instagram: ["k1"] } }), ["k1"]);
  assert.deepEqual(selectionFor(a, { byAccount: { a1: [] }, byNetwork: { instagram: ["k1"] } }), []);
});

test("auto-conversion info notes are never shown, blocking problems still are", () => {
  const conv = [
    ["instagram", [{ kind: "photo", width: 1080, height: 2340, ext: "png" }, { kind: "photo", width: 1920, height: 1080, ext: "webp" }]],
    ["tiktok", [pic(1080, 1920, "png"), pic(1080, 1920, "heic")]],
    ["facebook", [pic(1, 1, "webp", 9 * 1024 * 1024)]],
    ["linkedin", [vid(10, 1, 1, "mov")]],
  ];
  for (const [net, items] of conv) {
    const r = checkMedia(net, items);
    assert.deepEqual(r.notes, [], net);
    assert.ok(!r.notes.concat(r.hints).some((t) => /auto-fitted|JPG|convert|smaller/i.test(t)), net);
  }
  assert.deepEqual(codes(checkMedia("instagram", Array.from({ length: 21 }, () => pic()))), ["too_many"]);
  assert.deepEqual(codes(checkMedia("tiktok", MIX)), ["mixed"]);
  assert.deepEqual(codes(checkMedia("youtube", [pic()])), ["no_video"]);
});

test("Instagram: small photos are fixed at publish, only unreadable files show an error", () => {
  const tiny = [{ kind: "photo", width: 95, height: 120, ext: "png" }, { kind: "photo", width: 47, height: 300 }];
  assert.deepEqual(checkMedia("instagram", tiny).problems, []);
  assert.deepEqual(igPhotoWarnings({ which: "Photo 4", loaded: true, dims: { width: 95, height: 95 } }), []);
  assert.deepEqual(igPhotoWarnings({ which: "Photo 4", loaded: false }), []); // still measuring
  assert.match(igPhotoWarnings({ which: "Photo 4", loaded: true, dims: null })[0], /Photo 4 can't be opened/);
});
