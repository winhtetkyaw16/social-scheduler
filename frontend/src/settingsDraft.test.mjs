import test from "node:test";
import assert from "node:assert/strict";
import {
  openDraft,
  updateDraft,
  draftChanges,
  isDraftDirty,
  commitDraft,
  UNSUPPORTED_FIELDS,
} from "./settingsDraft.js";

const defaults = { first_comment: "", media_layout: "Grid" };

test("openDraft starts from saved values over defaults and copies them", () => {
  const saved = { first_comment: "hi" };
  const draft = openDraft(saved, defaults);
  assert.deepEqual(draft, { first_comment: "hi", media_layout: "Grid" });
  draft.first_comment = "changed";
  assert.equal(saved.first_comment, "hi");
  assert.deepEqual(openDraft(undefined, defaults), defaults);
});

test("updateDraft is immutable", () => {
  const a = openDraft({}, defaults);
  const b = updateDraft(a, "media_layout", "Stacked");
  assert.equal(a.media_layout, "Grid");
  assert.equal(b.media_layout, "Stacked");
});

test("draftChanges and isDraftDirty only report real edits", () => {
  const saved = { first_comment: "hi" };
  let draft = openDraft(saved, defaults);
  assert.equal(isDraftDirty(saved, draft, defaults), false);
  draft = updateDraft(draft, "first_comment", "hello");
  draft = updateDraft(draft, "media_layout", "Grid");
  assert.deepEqual(draftChanges(saved, draft, defaults), [["first_comment", "hello"]]);
  draft = updateDraft(draft, "first_comment", "hi");
  assert.equal(isDraftDirty(saved, draft, defaults), false);
});

test("commitDraft writes only changed keys through the setter (Save)", () => {
  const calls = [];
  const saved = { first_comment: "hi" };
  const draft = updateDraft(
    updateDraft(openDraft(saved, defaults), "first_comment", "new"),
    "media_layout",
    "Stacked",
  );
  const n = commitDraft("acc1", saved, draft, defaults, (...args) => calls.push(args));
  assert.equal(n, 2);
  assert.deepEqual(calls, [
    ["acc1", "first_comment", "new"],
    ["acc1", "media_layout", "Stacked"],
  ]);
});

test("discard (Cancel / X / outside) leaves saved values untouched and a reopen restores them", () => {
  const saved = { first_comment: "hi" };
  let draft = updateDraft(openDraft(saved, defaults), "first_comment", "unsaved");
  draft = null; // discarded: nothing committed
  assert.deepEqual(saved, { first_comment: "hi" });
  assert.equal(openDraft(saved, defaults).first_comment, "hi");
});

test("unsupported field notes exist for the networks with hidden fields", () => {
  for (const platform of ["facebook", "instagram", "linkedin"])
    assert.ok(UNSUPPORTED_FIELDS[platform].length > 0);
  assert.equal(UNSUPPORTED_FIELDS.x, undefined);
});
