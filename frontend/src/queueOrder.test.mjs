// Run with: node --test frontend/src/queueOrder.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupQueuePosts } from "./queueOrder.js";

const at = (day, h) => new Date(2026, 10, day, h, 0, 0).toISOString();
const posts = [
  { id: "n1a", scheduled_at: at(1, 9), published_at: at(1, 9) },
  { id: "n4a", scheduled_at: at(4, 8), published_at: at(4, 8) },
  { id: "n2a", scheduled_at: at(2, 10), published_at: at(2, 10) },
  { id: "n4b", scheduled_at: at(4, 15), published_at: at(4, 15) },
  { id: "n1b", scheduled_at: at(1, 18), published_at: at(1, 18) },
];
const order = (tab) => groupQueuePosts(posts, tab).map(([, g]) => g.items.map((p) => p.id));

for (const tab of ["published", "failed"]) {
  test(`${tab}: newest day first, newest post first within day`, () => {
    assert.deepEqual(order(tab), [["n4b", "n4a"], ["n2a"], ["n1b", "n1a"]]);
  });
}
for (const tab of ["scheduled", "queued"]) {
  test(`${tab}: soonest first`, () => {
    assert.deepEqual(order(tab), [["n1a", "n1b"], ["n2a"], ["n4a", "n4b"]]);
  });
}
test("published uses published_at for grouping", () => {
  const g = groupQueuePosts(
    [{ id: "x", scheduled_at: at(1, 9), published_at: at(3, 9) }],
    "published",
  );
  assert.equal(g[0][1].d.getDate(), 3);
});
