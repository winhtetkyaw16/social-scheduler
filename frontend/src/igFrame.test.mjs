import test from "node:test";
import assert from "node:assert/strict";
import { igClamp, igNearest, igFrameRatio, igChipLabel, igNeedsCrop, igCropRect, igObjectPosition, igDragOffset, igCropPayload } from "./igFrame.js";

test("clamp and nearest standard frame", () => {
  assert.equal(igClamp(0.4), 0.8);
  assert.equal(igClamp(3), 1.91);
  assert.equal(igClamp(1.2), 1.2);
  assert.equal(igNearest(0.46), 0.8);   // tall phone screenshot -> 4:5
  assert.equal(igNearest(1.05), 1);
  assert.equal(igNearest(16 / 9), 1.91);
  assert.equal(igNearest(1.4), 1);      // closer to 1 than to 1.91
});

test("carousel frame comes from the first PHOTO (video first is skipped)", () => {
  const items = [{ video: true, ratio: 16 / 9 }, { video: false, ratio: 0.46 }, { video: false, ratio: 1.6 }];
  assert.equal(igFrameRatio(items), 0.8);
  assert.equal(igFrameRatio([{ video: false, ratio: 1.3 }]), 1.3);       // single photo: clamp only
  assert.equal(igFrameRatio([{ video: false, ratio: 0.3 }]), 0.8);
  assert.equal(igFrameRatio(items, 1.91), 1.91);                           // chip wins
  assert.equal(igFrameRatio([{ video: true, ratio: 9 / 16 }]), 0.8);
  assert.equal(igFrameRatio([]), 1);
  assert.equal(igChipLabel(0.8), "4:5");
  assert.equal(igChipLabel(1.3), "1.30:1");
});

test("crop rect uses offsets on the free axis", () => {
  assert.deepEqual(igCropRect(1000, 2000, 0.8), { sx: 0, sy: 375, sw: 1000, sh: 1250 });
  assert.deepEqual(igCropRect(1000, 2000, 0.8, 0.5, 0), { sx: 0, sy: 0, sw: 1000, sh: 1250 });
  assert.deepEqual(igCropRect(3000, 1000, 1, 1, 0.5), { sx: 2000, sy: 0, sw: 1000, sh: 1000 });
  assert.deepEqual(igCropRect(1080, 1350, 0.8), { sx: 0, sy: 0, sw: 1080, sh: 1350 });
  assert.equal(igNeedsCrop(0.46, 0.8), true);
  assert.equal(igNeedsCrop(0.8, 0.8), false);
  assert.equal(igObjectPosition([0, 1]), "0% 100%");
  assert.equal(igObjectPosition(null), "50% 50%");
});

test("dragging moves the photo inside the frame, clamped", () => {
  // tall photo (0.5) in a 400x500 frame: rendered 400x800, 300px free vertically
  assert.deepEqual(igDragOffset([0.5, 0.5], 0, -150, 400, 500, 0.5), [0.5, 1]);
  assert.deepEqual(igDragOffset([0.5, 0.5], 0, 600, 400, 500, 0.5), [0.5, 0]);
  // wide photo in a square frame: horizontal axis
  const [ox] = igDragOffset([0.5, 0.5], 100, 0, 400, 400, 2);
  assert.equal(ox, 0.25);
});

test("ig_crop payload is IG-only data: ratio when chosen + offsets by index", () => {
  assert.deepEqual(igCropPayload(null, ["a", "b"]), {});
  assert.deepEqual(igCropPayload({ ratio: 1, offsets: { b: [0.2, 0.9] } }, ["a", "b"]), { ratio: 1, offsets: [[0.5, 0.5], [0.2, 0.9]] });
  assert.deepEqual(igCropPayload({ offsets: { a: [2, -1] } }, ["a"]), { offsets: [[1, 0]] });
});
