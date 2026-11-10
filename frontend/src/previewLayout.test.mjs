import test from "node:test";
import assert from "node:assert/strict";
import { clampRatio, threadsLayout, fbGridLayout } from "./previewLayout.js";

const P = 0.5,
  L = 2;
test("clampRatio clamps and defaults unknown to 1", () => {
  assert.equal(clampRatio(0, 0.8, 1.91), 1);
  assert.equal(clampRatio(NaN, 0.8, 1.91), 1);
  assert.equal(clampRatio(0.5, 0.8, 1.91), 0.8);
  assert.equal(clampRatio(3, 0.8, 1.91), 1.91);
  assert.equal(clampRatio(1.2, 0.8, 1.91), 1.2);
});
test("threads single clamps to 4:5..1.91:1", () => {
  assert.equal(threadsLayout([9 / 16]).ratio, 4 / 5);
  assert.equal(threadsLayout([3]).ratio, 1.91);
  assert.equal(threadsLayout([1.5]).kind, "single");
  assert.equal(threadsLayout([]).kind, "none");
});
test("threads carousel tiles clamp each width to 3:4..4:3", () => {
  const l = threadsLayout([9 / 16, 1, 16 / 9, 0]);
  assert.equal(l.kind, "row");
  assert.deepEqual(
    l.tiles.map((t) => t.w),
    [3 / 4, 1, 4 / 3, 1],
  );
  assert.deepEqual(
    l.tiles.map((t) => t.cropped),
    [true, false, true, false],
  );
});
test("fb 1 and 2 items", () => {
  assert.equal(fbGridLayout([P]).kind, "single");
  assert.equal(fbGridLayout([P]).ratio, 0.8);
  const two = fbGridLayout([L, P]);
  assert.equal(two.kind, "pair");
  assert.equal(two.cols, "1fr 1fr");
  assert.equal(two.cells.length, 2);
});
test("fb 3 and 4 items follow first item orientation", () => {
  for (const n of [3, 4]) {
    const v = fbGridLayout([P, ...Array(n - 1).fill(L)]);
    assert.equal(v.dir, "vertical");
    assert.equal(v.cols, "2fr 1fr");
    assert.equal(v.cells[0].area, `1 / 1 / ${n} / 2`);
    assert.equal(v.cells.length, n);
    assert.equal(v.more, 0);
    const h = fbGridLayout([L, ...Array(n - 1).fill(P)]);
    assert.equal(h.dir, "horizontal");
    assert.equal(h.rows, "2fr 1fr");
    assert.equal(h.cells[0].area, `1 / 1 / 2 / ${n}`);
    assert.equal(fbGridLayout([1, P, P]).dir, "horizontal"); // square counts as landscape
  }
});
test("fb 5 and 6+ items: 2 on top, 3 below, +N", () => {
  for (const first of [P, L]) {
    const five = fbGridLayout([first, L, L, L, L]);
    assert.equal(five.kind, "2+3");
    assert.equal(five.cells.length, 5);
    assert.equal(five.more, 0);
    const nine = fbGridLayout([first, ...Array(8).fill(P)]);
    assert.equal(nine.cells.length, 5);
    assert.equal(nine.more, 4);
    assert.deepEqual(
      nine.cells.map((c) => c.area.split(" / ")[0]),
      ["1", "1", "2", "2", "2"],
    );
  }
  assert.equal(fbGridLayout([L, L, L, L, L, L]).more, 1);
});

import { xLayout, liLayout, LINKEDIN_MAX_VISIBLE } from "./previewLayout.js";
test("x single clamps to 3:4..2:1; gif/video forces single", () => {
  assert.equal(xLayout([9 / 16]).ratio, 3 / 4);
  assert.equal(xLayout([3]).ratio, 2);
  assert.equal(xLayout([16 / 9]).ratio, 16 / 9);
  assert.equal(xLayout([1, 2], { single: true }).kind, "single");
  assert.equal(xLayout([]).kind, "none");
});
test("x 2-4 images form a row with clamped widths, max 4", () => {
  const l = xLayout([0.5, 1, 3, 1.5, 1]);
  assert.equal(l.kind, "row");
  assert.equal(l.tiles.length, 4);
  assert.deepEqual(
    l.tiles.map((t) => t.w),
    [3 / 4, 1, 2, 1.5],
  );
  assert.deepEqual(
    l.tiles.map((t) => t.cropped),
    [true, false, true, false],
  );
});
const PL = 0.8,
  LS = 16 / 9;
test("linkedin single and video", () => {
  assert.equal(liLayout([0.5]).ratio, 4 / 5);
  assert.equal(liLayout([4]).ratio, 3);
  assert.equal(liLayout([1.5]).kind, "single");
  assert.equal(liLayout([9 / 16], { video: true }).ratio, 9 / 16);
});
test("linkedin 2 images side by side, columns share the block", () => {
  const l = liLayout([PL, LS]);
  assert.equal(l.kind, "pair");
  near(l.colFracs[0] + l.colFracs[1], 1);
  assert.ok(l.ratio >= 4 / 5 && l.ratio <= 2);
});
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const fills = (l) => {
  near(
    l.rowFracs.reduce((a, b) => a + b, 0),
    1,
  );
  near(
    l.colFracs.reduce((a, b) => a + b, 0),
    1,
  );
  assert.ok(l.ratio >= 4 / 5 - 1e-9 && l.ratio <= 1 + 1e-9, `ratio ${l.ratio}`);
  assert.equal(l.frame, l.ratio);
  assert.equal(l.cropped, false);
};
test("linkedin 3/4/6 with wide first: hero on top 60-66%, row fills the rest", () => {
  for (const rest of [1, PL, LS, 0.5])
    for (const n of [3, 4, 6]) {
      const l = liLayout([LS, ...Array(n - 1).fill(rest)]);
      assert.equal(l.kind, "top");
      fills(l);
      assert.ok(l.rowFracs[0] >= 0.6 - 1e-9 && l.rowFracs[0] <= 0.66 + 1e-9);
      const k = Math.min(n, LINKEDIN_MAX_VISIBLE) - 1;
      assert.equal(l.cells.length, k + 1);
      assert.equal(l.cells[0].area, `1 / 1 / 2 / ${k + 1}`);
      assert.equal(l.more, Math.max(0, n - LINKEDIN_MAX_VISIBLE));
    }
  assert.equal(liLayout([4 / 3, 1, 1]).kind, "left"); // exactly 4:3 is not wider than 4:3
});
test("linkedin 3/4/6 with portrait or square first: full-height left column, even stack", () => {
  for (const first of [PL, 1, 0.5])
    for (const n of [3, 4, 6]) {
      const l = liLayout([first, ...Array(n - 1).fill(LS)]);
      assert.equal(l.kind, "left");
      assert.equal(l.cols, "2fr 1fr");
      fills(l);
      const k = Math.min(n, 4) - 1;
      assert.equal(l.cells[0].area, `1 / 1 / ${k + 1} / 2`);
      l.rowFracs.forEach((f) => near(f, 1 / k));
      assert.equal(l.cells.length, Math.min(n, 4));
      assert.equal(l.more, n > 4 ? n - 4 : 0);
    }
});
test("linkedin +N follows max", () => {
  assert.equal(liLayout([LS, 1, 1, 1, 1, 1], { max: 3 }).more, 3);
  fills(liLayout([1.4, 0.8, 0.8]));
});

test("fbPostState: a Facebook Page post never previews two videos", async () => {
  const { fbPostState } = await import("./previewLayout.js");
  assert.equal(fbPostState(["video", "video"]), "choose_video");
  assert.equal(fbPostState(["video", "video", "photo"]), "choose_video");
  assert.equal(fbPostState(["video", "photo"]), "mixed");
  assert.equal(fbPostState(["video"]), "ok");
  assert.equal(fbPostState(["photo", "photo"]), "ok");
});

test("oneVideoGate: every single-video network shows the placeholder until a video is picked, then only that video", async () => {
  const { oneVideoGate } = await import("./previewLayout.js");
  const { indicesForChoice, urlsForSelection } = await import("./fixPlan.js");
  const infos = [
    { kind: "video", name: "a.mp4" },
    { kind: "video", name: "b.mp4" },
    { kind: "photo", name: "p.jpg" },
  ];
  const urls = ["/m/a.mp4", "/m/b.mp4", "/m/p.jpg"];
  const nets = {
    facebook: "Facebook",
    linkedin: "LinkedIn",
    tiktok: "TikTok",
    x: "X",
    youtube: "YouTube",
  };
  for (const [p, net] of Object.entries(nets)) {
    const none = oneVideoGate(p, ["video", "video"]);
    assert.equal(none.state, "choose_video", p);
    assert.equal(none.title, `Choose which video goes to ${net}`);
    assert.match(none.line, /carries one video.*Use Fix for me to pick it\./);
    const picked = indicesForChoice(p, infos, "Video", { video: 1 });
    const sent = urlsForSelection(urls, picked);
    assert.deepEqual(sent, ["/m/b.mp4"], `${p} previews/sends only the chosen video`);
    assert.equal(
      oneVideoGate(
        p,
        picked.map((i) => infos[i].kind),
      ).state,
      "ok",
      `${p} shows the real preview after a pick`,
    );
  }
  assert.equal(
    oneVideoGate("facebook", ["video", "video"]).line,
    "A Page post carries one video. Use Fix for me to pick it.",
  );
  for (const p of ["instagram", "threads"])
    assert.equal(
      oneVideoGate(p, ["video", "video", "photo"]).state,
      "ok",
      `${p} carousel keeps both videos`,
    );
});
