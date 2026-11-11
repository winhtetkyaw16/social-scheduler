import { test } from "node:test";
import assert from "node:assert/strict";
import { bulkSummary, evergreenStatus, intervalOptions } from "./queueExtras.js";

const now = new Date("2026-11-11T00:00:00Z");

test("evergreenStatus explains what happens next", () => {
  assert.equal(evergreenStatus(null), "");
  assert.match(
    evergreenStatus({ enabled: true, reshare_scheduled_at: "2026-11-12T02:00:00Z" }, now),
    /^Re-share scheduled for /,
  );
  assert.match(
    evergreenStatus({ enabled: false, last_published_at: "2026-10-01T00:00:00Z" }, now),
    /^Last posted /,
  );
  assert.match(
    evergreenStatus(
      {
        enabled: true,
        last_published_at: "2026-11-01T00:00:00Z",
        next_eligible_at: "2026-12-01T00:00:00Z",
      },
      now,
    ),
    /can re-share after /,
  );
  assert.match(
    evergreenStatus(
      {
        enabled: true,
        last_published_at: "2026-09-01T00:00:00Z",
        next_eligible_at: "2026-10-01T00:00:00Z",
      },
      now,
    ),
    /goes into the next empty slot$/,
  );
});

test("intervalOptions keeps a custom saved value", () => {
  assert.deepEqual(intervalOptions(30), [7, 14, 30, 60, 90]);
  assert.deepEqual(intervalOptions(45), [7, 14, 30, 45, 60, 90]);
});

test("bulkSummary: errors mean nothing was scheduled", () => {
  const s = bulkSummary({ errors: [{ row: 3, message: "Row 3: bad" }], dry_run: false });
  assert.equal(s.tone, "error");
  assert.equal(s.title, "Nothing was scheduled");
  assert.match(s.text, /Row numbers match your spreadsheet/);
  assert.equal(bulkSummary(null), null);
});

test("bulkSummary: preview and done", () => {
  assert.equal(
    bulkSummary({ errors: [], dry_run: true, valid_rows: 1 }).title,
    "1 post ready to schedule",
  );
  assert.equal(bulkSummary({ errors: [], dry_run: false, created: 4 }).title, "4 posts scheduled");
});
