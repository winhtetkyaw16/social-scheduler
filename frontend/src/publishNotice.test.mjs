import assert from "node:assert/strict";
import test from "node:test";
import { publishNotice } from "./publishNotice.js";

test("mixed results keep confirmed posts, pending posts and failed submissions distinct", () => {
  const notice = publishNotice("now", [{ status: "published" }, { status: "queued" }, { status: "failed" }],
    [{ banner: "YouTube needs a video.", what_to_do: "Add a video." }],
    [{ account: { account_name: "Studio" }, message: "Couldn't reach SocialCastly." }]);
  assert.equal(notice.kind, "error");
  for (const text of ["1 published.", "1 queued.", "1 failed.", "Add a video.", "Studio", "Check Publish"]) {
    assert.ok(notice.message.includes(text));
  }
});

test("a queued receipt is not evidence of publication and a rejected request is not proof of failure", () => {
  assert.equal(publishNotice("now", [{ status: "queued" }], [], []).title, "Publishing in progress");
  const rejected = [{ account: { platform: "YouTube" }, message: "HTTP 502" }];
  const notice = publishNotice("schedule", [], [], rejected);
  assert.match(notice.message, /Submission unconfirmed/);
  assert.doesNotMatch(notice.message, /HTTP|published|scheduled/i);
  assert.equal(publishNotice("now", [{ status: "published" }], [], rejected).kind, "error");
});

test("a validation rejection keeps the account and corrective action", () => {
  const notice = publishNotice("queue", [], [], [
    { account: { account_name: "Studio" }, status: 422, message: "Add a video." },
  ]);
  assert.equal(notice.message, "Couldn't submit to Studio. Add a video.");
});
