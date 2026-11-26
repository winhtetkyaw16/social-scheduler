import test from "node:test";
import assert from "node:assert/strict";
import { readableDetail, readSessionRefresh, rejectedWorkspaceSession, requestError } from "./requestErrors.js";

test("only workspace authentication failures expire the sign-in", () => {
  const response = new Response(null, { status: 401 });
  assert.equal(rejectedWorkspaceSession(response, "Invalid authentication credentials"), true);
  assert.equal(rejectedWorkspaceSession(response, "Reconnect Instagram"), false);
  assert.equal(rejectedWorkspaceSession(new Response(null, { status: 409 }), "Reconnect Instagram"), false);
});

test("an interrupted session refresh is distinct from a rejected sign-in", async () => {
  assert.equal(await readSessionRefresh(new Response(null, { status: 401 })), null);
  await assert.rejects(readSessionRefresh(new Response(null, { status: 503 })), { status: 503 });
  await assert.rejects(readSessionRefresh(new Response('{"access_token":')), /check your connection/i);
  assert.deepEqual(await readSessionRefresh(Response.json({ access_token: "test" })), { access_token: "test" });
});

test("saved and redirected errors cannot display developer instructions", () => {
  for (const text of ["Check API credits", "CreditsDepleted", "Allow video.list", "Missing pages_manage_posts", "Check the redirect URI", "Enable permissions in the developer console"]) {
    assert.equal(readableDetail(text), "");
  }
  assert.equal(readableDetail("Choose the same TikTok account you are reconnecting."), "Choose the same TikTok account you are reconnecting.");
});

test("request failures keep the status and expose the same guidance to inbox and toast callers", () => {
  const detail = "Media files must be 500 MB or smaller.";
  const error = requestError(413, { detail });
  assert.equal(error.status, 413);
  assert.equal(error.message, detail);
  assert.equal(error.detail, detail);
  for (const detail of ["<html>Bad gateway</html>", "Provider returned HTTP 502", "TypeError: invalid argument", null]) {
    assert.match(requestError(502, { detail }).message, /try again later/i);
  }
  assert.match(requestError(401, { detail: "Invalid refresh token" }).message, /Sign in again/);
  assert.match(requestError(401, { detail: "Invalid credentials, please try again" }).message, /email and password/);
});

test("rate-limit responses show the retry window without exposing provider details", async () => {
  const headers = new Headers({ "Retry-After": "120" });
  const error = requestError(429, { detail: "Provider returned HTTP 429" }, headers);
  assert.equal(error.status, 429);
  assert.equal(error.detail, error.message);
  assert.match(error.message, /Try again in 2 minutes/);
  await assert.rejects(readSessionRefresh(new Response(null, { status: 429, headers })), /Try again in 2 minutes/);

  const soon = new Date(Date.now() + 20_000).toUTCString();
  assert.match(requestError(429, null, new Headers({ "Retry-After": soon })).message, /Try again in \d+ seconds/);
  for (const retryAfter of ["invalid", "0", new Date(0).toUTCString()]) {
    const headers = new Headers({ "Retry-After": retryAfter });
    assert.match(requestError(429, null, headers).message, /wait a little and try again/);
  }
});

test("validation failures retain actionable limits without echoing the input", () => {
  const detail = [{ type: "string_too_short", loc: ["body", "password"], input: "secret", ctx: { min_length: 10 } }];
  assert.equal(requestError(422, { detail }).message, "Use a password with at least 10 characters.");
  assert.match(requestError(422, { detail: [null] }).message, /Check the details/);
});
