import test from "node:test";
import assert from "node:assert/strict";
import { createScrollLock, focusNoScroll, cleanFbHash } from "./scrollLock.js";

const fakeEnv = () => {
  const calls = [];
  const body = { style: { overflow: "", position: "", top: "", paddingRight: "" } };
  const html = { style: { overflow: "", scrollBehavior: "smooth" }, clientWidth: 985 };
  const win = {
    scrollY: 420,
    scrollX: 0,
    innerWidth: 1000,
    getComputedStyle: () => ({ paddingRight: "0px" }),
    scrollTo: (x, y) => {
      calls.push([x, y]);
      win.scrollY = y;
    },
  };
  return { doc: { body, documentElement: html }, win, calls };
};

test("locks with overflow hidden only: never position:fixed, never moves the page", () => {
  const e = fakeEnv();
  const l = createScrollLock(() => e);
  l.lock();
  assert.equal(l.savedY(), 420);
  assert.equal(e.doc.body.style.position, "");
  assert.equal(e.doc.body.style.top, "");
  assert.equal(e.doc.body.style.overflow, "hidden");
  assert.equal(e.doc.documentElement.style.overflow, "hidden");
  assert.equal(e.doc.documentElement.style.scrollBehavior, "auto");
  assert.equal(e.doc.body.style.paddingRight, "15px");
  assert.equal(e.win.scrollY, 420);
  assert.equal(e.calls.length, 0);
});

test("nested locks release on last; no scrollTo when page stayed put; smooth restored", () => {
  const e = fakeEnv();
  const l = createScrollLock(() => e);
  l.lock();
  l.lock();
  assert.equal(l.count(), 2);
  l.unlock();
  assert.equal(e.doc.body.style.overflow, "hidden");
  l.unlock();
  assert.equal(l.count(), 0);
  assert.equal(e.doc.body.style.overflow, "");
  assert.equal(e.doc.body.style.paddingRight, "");
  assert.equal(e.doc.documentElement.style.overflow, "");
  assert.equal(e.doc.documentElement.style.scrollBehavior, "smooth");
  assert.equal(e.calls.length, 0);
  assert.equal(e.win.scrollY, 420);
});

test("if something moved the page while open, unlock restores the saved position", () => {
  const e = fakeEnv();
  const l = createScrollLock(() => e);
  l.lock();
  e.win.scrollY = 0;
  let behaviorAtRestore = null;
  e.win.scrollTo = (x, y) => {
    behaviorAtRestore = e.doc.documentElement.style.scrollBehavior;
    e.calls.push([x, y]);
    e.win.scrollY = y;
  };
  l.unlock();
  assert.deepEqual(e.calls, [[0, 420]]);
  assert.equal(behaviorAtRestore, "auto");
  assert.equal(e.win.scrollY, 420);
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

test("focusNoScroll passes preventScroll", () => {
  const seen = [];
  focusNoScroll({ focus: (o) => seen.push(o) });
  focusNoScroll(null);
  assert.deepEqual(seen, [{ preventScroll: true }]);
});

test("cleanFbHash removes only #_=_", () => {
  const calls = [];
  const hist = { state: null, replaceState: (...a) => calls.push(a) };
  assert.equal(cleanFbHash({ hash: "#_=_", pathname: "/", search: "?a=1" }, hist), true);
  assert.deepEqual(calls, [[null, "", "/?a=1"]]);
  assert.equal(cleanFbHash({ hash: "#top", pathname: "/", search: "" }, hist), false);
  assert.equal(calls.length, 1);
});
