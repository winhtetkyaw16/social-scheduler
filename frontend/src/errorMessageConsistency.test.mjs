import assert from "node:assert/strict";
import test from "node:test";
import { commentActionError } from "./engagement/model.js";
import { syncPostsAndRefresh } from "./engagement/syncRefresh.js";
import { failedBannerText, friendlyError } from "./publishErrors.js";
import { publishNotice } from "./publishNotice.js";
import { channelConnectionError, readSessionRefresh, requestError } from "./requestErrors.js";

test("sign-in failures and channel connection failures offer the right recovery", () => {
  const signIn = requestError(401, { detail: "Invalid credentials, please try again" });
  assert.equal(signIn.message, "Check your email and password and try again.");
  assert.match(channelConnectionError("OAuth failed with invalid_scope"), /Try connecting again later/);

  const message = "Choose the same TikTok account you are reconnecting.";
  assert.equal(channelConnectionError(message), message);
});

test("rate-limit advice survives session refresh, Inbox actions and publishing submission errors", async () => {
  const headers = new Headers({ "Retry-After": "120" });
  const error = requestError(429, { detail: "HTTP 429: API rate limit exceeded" }, headers);
  assert.match(error.message, /Try again in 2 minutes/);
  assert.equal(commentActionError(error), error.message);
  await assert.rejects(readSessionRefresh(new Response(null, { status: 429, headers })), {
    status: 429,
    message: error.message,
  });
  const notice = publishNotice("schedule", [], [], [{
    account: { account_name: "Studio" },
    message: error.message,
    status: error.status,
  }]);
  assert.equal(notice.kind, "error");
  assert.equal(notice.message, `Couldn't submit to Studio. ${error.message}`);
});

test("Inbox filters diagnostics while keeping actionable comment and refresh messages", async () => {
  const diagnostic = "Authorization: Bearer example-credential";
  assert.match(commentActionError({ status: 502, detail: diagnostic }), /refresh the post before trying again/i);
  assert.match(commentActionError({ status: 429, detail: "HTTP 429" }), /wait a little and try again/i);

  const lastKnown = "Published (last known status).";
  const refreshes = [];
  const state = await syncPostsAndRefresh(
    async (id) => ({ status_message: id === "limited" ? "API permission r_member_social" : lastKnown }),
    ["first", "limited", "second"],
    async (update) => refreshes.push(update),
  );
  assert.deepEqual(state, { deleted: false, message: lastKnown });
  assert.deepEqual(refreshes, [state]);
});

test("failed-post details, row and toast share the same recovery and hide provider diagnostics", () => {
  const account = { platform: "instagram" };
  const post = {
    status: "failed",
    friendly_error: {
      category: "connection_expired",
      network: "Instagram",
      banner: "Reconnect Instagram to keep publishing.",
      what_happened: "The connection expired.",
      what_to_do: "Reconnect Instagram in Accounts.",
      platform_reason: "Authorization: Bearer example-credential",
      actions: [
        { id: "reconnect", label: "Reconnect Instagram" },
        { id: "edit", label: "Fix API permissions" },
      ],
    },
  };
  const failure = friendlyError(post, account);
  assert.equal(failedBannerText(post, account), post.friendly_error.banner);
  assert.equal(failure.platform_reason, null);
  assert.deepEqual(failure.actions, [{ id: "reconnect", label: "Reconnect Instagram" }]);
  const notice = publishNotice("now", [post], [failure], []);
  assert.equal(notice.message, "1 failed. Reconnect Instagram to keep publishing. Reconnect Instagram in Accounts.");
});

test("older failed posts still get a fix, reconnect or wait message when provider copy is unusable", () => {
  const cases = [
    ["format_invalid", "Unsupported content. Add a video to this post.", "content_needs_edit", /Edit post/],
    ["connection_expired", "Invalid OAuth refresh token.", "connection_expired", /Reconnect your YouTube account/],
    ["provider_http_error", "Provider returned HTTP 429: API rate limit exceeded.", "rate_limited", /Wait a little/],
  ];
  for (const [code, message, category, recovery] of cases) {
    const post = {
      status: "failed",
      last_error_code: code,
      last_error_message: message,
      friendly_error: { banner: "Provider API error. Check scopes in the developer console." },
    };
    const failure = friendlyError(post, { platform: "youtube" });
    assert.equal(failure.category, category);
    assert.match(failure.what_to_do, recovery);
    assert.doesNotMatch([failure.banner, failure.what_happened, failure.what_to_do].join(" "), /\b(?:api|scopes?|oauth|tokens?|http 429)\b/i);
  }
});
