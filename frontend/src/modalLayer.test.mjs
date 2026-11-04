import test from "node:test";
import assert from "node:assert/strict";
import { hasDarkRoot, modalLayerClass, trapsFixed } from "./modalLayer.js";

const doc = (dark, htmlDark = false) => ({ documentElement: { classList: { contains: (c) => htmlDark && c === "dark" } }, querySelector: () => (dark ? {} : null) });

test("portal layer keeps the .scd scope and dark theme", () => {
  assert.equal(modalLayerClass(doc(false)), "scd sc-modal-layer");
  assert.equal(modalLayerClass(doc(true)), "scd sc-modal-layer dark");
  assert.equal(hasDarkRoot(doc(false, true)), true);
  assert.equal(hasDarkRoot(null), false);
});

test("detects ancestors that would trap position:fixed", () => {
  assert.equal(trapsFixed({ transform: "matrix(1, 0, 0, 1, 0, 0)" }), true); // fade-up fill-mode both
  assert.equal(trapsFixed({ filter: "blur(2px)" }), true);
  assert.equal(trapsFixed({ contain: "paint" }), true);
  assert.equal(trapsFixed({ willChange: "transform" }), true);
  assert.equal(trapsFixed({ transform: "none", filter: "none", contain: "none", willChange: "auto" }), false);
});
