import test from "node:test";
import assert from "node:assert/strict";
import { clampIndex, stepIndex, arrowsFor, keyDir, nearestIndex } from "./carouselNav.js";

test("clampIndex", () => {
  assert.equal(clampIndex(-3, 4), 0); assert.equal(clampIndex(9, 4), 3); assert.equal(clampIndex(2, 4), 2);
  assert.equal(clampIndex(5, 0), 0); assert.equal(clampIndex(NaN, 3), 0);
});
test("stepIndex moves one item without wrapping", () => {
  assert.equal(stepIndex(0, 3, 1), 1); assert.equal(stepIndex(2, 3, 1), 2);
  assert.equal(stepIndex(0, 3, -1), 0); assert.equal(stepIndex(2, 3, -1), 1); assert.equal(stepIndex(1, 3, 0), 1);
});
test("arrowsFor hides at start and end", () => {
  assert.deepEqual(arrowsFor(0, 3), { prev: false, next: true });
  assert.deepEqual(arrowsFor(1, 3), { prev: true, next: true });
  assert.deepEqual(arrowsFor(2, 3), { prev: true, next: false });
  assert.deepEqual(arrowsFor(0, 1), { prev: false, next: false });
});
test("keyDir", () => {
  assert.equal(keyDir("ArrowLeft"), -1); assert.equal(keyDir("ArrowRight"), 1); assert.equal(keyDir("Enter"), 0);
});
test("nearestIndex follows scroll position", () => {
  const lefts = [0, 186, 372, 558];
  assert.equal(nearestIndex(0, lefts, 600), 0); assert.equal(nearestIndex(200, lefts, 600), 1);
  assert.equal(nearestIndex(380, lefts, 600), 2); assert.equal(nearestIndex(599, lefts, 600), 3);
  assert.equal(nearestIndex(10, [], 0), 0);
});
