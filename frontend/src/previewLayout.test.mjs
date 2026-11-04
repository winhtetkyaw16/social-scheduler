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
