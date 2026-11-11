// Run with: node --test frontend/src/upNext.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { sortUpNext, upNextDateLabel, upNextDateParts, upNextTime } from "./upNext.js";

const at = (m, day, h, min = 0, y = 2026) => new Date(y, m, day, h, min, 0).toISOString();

test("sorts newest first by scheduled time", () => {
  const posts = [
    { id: "a", scheduled_at: at(9, 30, 9) },
    { id: "b", scheduled_at: at(10, 4, 19) },
    { id: "c", scheduled_at: at(10, 2, 8) },
  ];
  assert.deepEqual(
    sortUpNext(posts).map((p) => p.id),
    ["b", "c", "a"],
  );
});

test("mixed statuses are not split; old failed posts sink by time", () => {
  const posts = [
    { id: "oldFail", status: "failed", scheduled_at: at(9, 30, 10) },
    { id: "sched", status: "scheduled", scheduled_at: at(10, 5, 9) },
    { id: "newFail", status: "failed", scheduled_at: at(10, 6, 9) },
    { id: "queued", status: "queued", scheduled_at: at(10, 4, 9) },
  ];
  assert.deepEqual(
    sortUpNext(posts).map((p) => p.id),
    ["newFail", "sched", "queued", "oldFail"],
  );
});

test("falls back to published_at then created_at; missing times go last", () => {
  const posts = [
    { id: "none" },
    { id: "pub", published_at: at(10, 3, 9) },
    { id: "created", created_at: at(10, 1, 9) },
    { id: "bad", scheduled_at: "not a date" },
    { id: "sched", scheduled_at: at(10, 2, 9) },
  ];
  assert.equal(upNextTime(posts[1]), posts[1].published_at);
  assert.deepEqual(
    sortUpNext(posts).map((p) => p.id),
    ["pub", "sched", "created", "none", "bad"],
  );
  assert.deepEqual(sortUpNext(null), []);
});

test("does not mutate input", () => {
  const posts = [
    { id: "a", scheduled_at: at(10, 1, 1) },
    { id: "b", scheduled_at: at(10, 2, 1) },
  ];
  sortUpNext(posts);
  assert.deepEqual(
    posts.map((p) => p.id),
    ["a", "b"],
  );
});

test("date label format with middle dot, year only when not current", () => {
  const now = new Date(2026, 10, 4, 12);
  assert.equal(upNextDateLabel(at(10, 4, 19, 46), now), "Nov 4 \u00b7 7:46 PM");
  assert.equal(upNextDateLabel(at(9, 30, 0, 5), now), "Oct 30 \u00b7 12:05 AM");
  assert.equal(upNextDateLabel(at(11, 31, 12, 0, 2025), now), "Dec 31, 2025 \u00b7 12:00 PM");
  assert.ok(upNextDateLabel(at(10, 4, 9), now).includes("\u00b7"));
  assert.equal(upNextDateLabel(null, now), "No time set");
});

test("date parts split date (top line) and time (bottom line)", () => {
  const now = new Date(2026, 10, 4, 12);
  assert.deepEqual(upNextDateParts(at(10, 4, 9, 27), now), { date: "Nov 4", time: "9:27 AM" });
  assert.deepEqual(upNextDateParts(at(11, 31, 23, 59, 2025), now), {
    date: "Dec 31, 2025",
    time: "11:59 PM",
  });
  assert.deepEqual(upNextDateParts(undefined, now), { date: "No time set", time: "" });
});

test("selectUpNext mixes upcoming and recent failed posts, earliest first", async () => {
  const { selectUpNext } = await import("./upNext.js");
  const now = new Date(2026, 10, 11, 12, 0);
  const posts = [
    { id: "old-fail", status: "failed", scheduled_at: at(9, 20, 9) },
    { id: "recent-fail", status: "failed", scheduled_at: at(10, 10, 16) },
    { id: "later", status: "scheduled", scheduled_at: at(10, 12, 9) },
    { id: "soon", status: "queued", scheduled_at: at(10, 11, 18) },
    { id: "published", status: "published", scheduled_at: at(10, 11, 8) },
    { id: "draft", status: "draft", scheduled_at: null },
    { id: "yesterday", status: "scheduled", scheduled_at: at(10, 10, 8) },
  ];
  assert.deepEqual(
    selectUpNext(posts, now).map((p) => p.id),
    ["recent-fail", "soon", "later"],
  );
});

test("selectUpNext keeps failures from crowding out upcoming posts", async () => {
  const { selectUpNext } = await import("./upNext.js");
  const now = new Date(2026, 10, 11, 12, 0);
  const posts = [
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `fail-${i}`,
      status: "failed",
      scheduled_at: at(10, 10, i + 1),
    })),
    { id: "next", status: "scheduled", scheduled_at: at(10, 11, 15) },
  ];
  const ids = selectUpNext(posts, now).map((p) => p.id);
  assert.equal(ids.length, 3);
  assert.equal(ids.filter((id) => id.startsWith("fail")).length, 2);
  assert.equal(ids[ids.length - 1], "next");
});

test("selectUpNext shows only failures when nothing is upcoming", async () => {
  const { selectUpNext } = await import("./upNext.js");
  const now = new Date(2026, 10, 11, 12, 0);
  const posts = Array.from({ length: 8 }, (_, i) => ({
    id: `fail-${i}`,
    status: "failed",
    scheduled_at: at(10, 10, i + 1),
  }));
  assert.equal(selectUpNext(posts, now).length, 6);
});
