import test from "node:test";
import assert from "node:assert/strict";
import { clampRatio, threadsLayout, fbGridLayout } from "./previewLayout.js";

const P = 0.5, L = 2;
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
  assert.deepEqual(l.tiles.map((t) => t.w), [3 / 4, 1, 4 / 3, 1]);
  assert.deepEqual(l.tiles.map((t) => t.cropped), [true, false, true, false]);
});
test("fb 1 and 2 items", () => {
  assert.equal(fbGridLayout([P]).kind, "single");
  assert.equal(fbGridLayout([P]).ratio, 0.8);
  const two = fbGridLayout([L, P]);
  assert.equal(two.kind, "pair"); assert.equal(two.cols, "1fr 1fr"); assert.equal(two.cells.length, 2);
});
test("fb 3 and 4 items follow first item orientation", () => {
  for (const n of [3, 4]) {
    const v = fbGridLayout([P, ...Array(n - 1).fill(L)]);
    assert.equal(v.dir, "vertical"); assert.equal(v.cols, "2fr 1fr"); assert.equal(v.cells[0].area, `1 / 1 / ${n} / 2`);
    assert.equal(v.cells.length, n); assert.equal(v.more, 0);
    const h = fbGridLayout([L, ...Array(n - 1).fill(P)]);
    assert.equal(h.dir, "horizontal"); assert.equal(h.rows, "2fr 1fr"); assert.equal(h.cells[0].area, `1 / 1 / 2 / ${n}`);
    assert.equal(fbGridLayout([1, P, P]).dir, "horizontal"); // square counts as landscape
  }
});
test("fb 5 and 6+ items: 2 on top, 3 below, +N", () => {
  for (const first of [P, L]) {
    const five = fbGridLayout([first, L, L, L, L]);
    assert.equal(five.kind, "2+3"); assert.equal(five.cells.length, 5); assert.equal(five.more, 0);
    const nine = fbGridLayout([first, ...Array(8).fill(P)]);
    assert.equal(nine.cells.length, 5); assert.equal(nine.more, 4);
    assert.deepEqual(nine.cells.map((c) => c.area.split(" / ")[0]), ["1", "1", "2", "2", "2"]);
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
  assert.equal(l.kind, "row"); assert.equal(l.tiles.length, 4);
  assert.deepEqual(l.tiles.map((t) => t.w), [3 / 4, 1, 2, 1.5]);
  assert.deepEqual(l.tiles.map((t) => t.cropped), [true, false, true, false]);
});
const PL = 0.8, LS = 16 / 9;
test("linkedin single and video", () => {
  assert.equal(liLayout([0.5]).ratio, 4 / 5); assert.equal(liLayout([4]).ratio, 3); assert.equal(liLayout([1.5]).kind, "single");
  assert.equal(liLayout([9 / 16], { video: true }).ratio, 9 / 16);
});
test("linkedin 2 images side by side at own ratios", () => {
  const l = liLayout([PL, LS]);
  assert.equal(l.kind, "pair"); assert.equal(l.cols, `${PL}fr ${LS}fr`); assert.ok(Math.abs(l.ratio - (PL + LS)) < 1e-9);
});
test("linkedin 3/4/6 with landscape first: hero on top, equal row below", () => {
  for (const n of [3, 4, 6]) {
    const l = liLayout([LS, ...Array(n - 1).fill(1)]);
    assert.equal(l.kind, "top");
    const k = Math.min(n, LINKEDIN_MAX_VISIBLE) - 1;
    assert.equal(l.cells.length, k + 1); assert.equal(l.cells[0].area, `1 / 1 / 2 / ${k + 1}`);
    assert.equal(l.more, Math.max(0, n - LINKEDIN_MAX_VISIBLE));
  }
  assert.equal(liLayout([4 / 3, 1, 1]).kind, "left"); // exactly 4:3 is not wider than 4:3
});
test("linkedin 3/4/6 with portrait or square first: hero left, stack right", () => {
  for (const first of [PL, 1]) for (const n of [3, 4, 6]) {
    const l = liLayout([first, ...Array(n - 1).fill(LS)]);
    assert.equal(l.kind, "left"); assert.equal(l.cols, "2fr 1fr");
    assert.equal(l.cells.length, Math.min(n, 4)); assert.equal(l.more, n > 4 ? n - 4 : 0);
    assert.ok(l.frame >= 4 / 5);
  }
});
test("linkedin 4:5 cap crops the bottom and +N follows max", () => {
  const l = liLayout([1.4, 0.8, 0.8]); // tall row under a hero
  assert.ok(l.ratio < 4 / 5); assert.equal(l.frame, 4 / 5); assert.equal(l.cropped, true);
  assert.equal(liLayout([LS, 1, 1, 1, 1, 1], { max: 3 }).more, 3);
  assert.equal(liLayout([LS, 1, 1, 1]).cropped, false);
});
