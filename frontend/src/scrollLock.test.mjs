import test from "node:test";
import assert from "node:assert/strict";
import { createScrollLock } from "./scrollLock.js";

const fakeEnv = () => {
  const calls = [];
  const body = { style: { overflow: "", position: "", top: "", left: "", right: "", width: "", paddingRight: "", touchAction: "" } };
  const html = { style: { overflow: "" }, clientWidth: 985 };
  const win = { scrollY: 420, scrollX: 0, innerWidth: 1000, getComputedStyle: () => ({ paddingRight: "0px" }), scrollTo: (x, y) => calls.push([x, y]) };
  return { doc: { body, documentElement: html }, win, calls };
};

test("locks on first, unlocks only after last nested release, restores scroll", () => {
  const e = fakeEnv();
  const l = createScrollLock(() => e);
  l.lock();
  assert.equal(e.doc.body.style.position, "fixed");
  assert.equal(e.doc.body.style.top, "-420px");
  assert.equal(e.doc.body.style.paddingRight, "15px");
  assert.equal(e.doc.documentElement.style.overflow, "hidden");
  e.win.scrollY = 0; // fixed body reports 0
  l.lock();
  assert.equal(l.count(), 2);
  l.unlock();
  assert.equal(e.doc.body.style.position, "fixed");
  assert.equal(e.calls.length, 0);
  l.unlock();
  assert.equal(l.count(), 0);
  assert.equal(e.doc.body.style.position, "");
  assert.equal(e.doc.body.style.paddingRight, "");
  assert.equal(e.doc.documentElement.style.overflow, "");
  assert.deepEqual(e.calls, [[0, 420]]);
});

test("extra unlock is a no-op and no padding without scrollbar", () => {
  const e = fakeEnv();
  e.doc.documentElement.clientWidth = 1000;
  const l = createScrollLock(() => e);
  l.unlock();
  assert.equal(l.count(), 0);
  l.lock();
  assert.equal(e.doc.body.style.paddingRight, "");
  l.unlock();
  assert.equal(e.doc.body.style.overflow, "");
});
