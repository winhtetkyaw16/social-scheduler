import test from "node:test";
import assert from "node:assert/strict";
import { accessTokenExpiresAtMs, accessTokenNeedsRefresh } from "./accessToken.js";

function jwt(expSec) {
  const payload = Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url");
  return `hdr.${payload}.sig`;
}

test("fresh token does not need refresh", () => {
  const t = jwt(Math.floor(Date.now() / 1000) + 600);
  assert.equal(accessTokenNeedsRefresh(t), false);
});

test("expired or near-expiry token needs refresh", () => {
  assert.equal(accessTokenNeedsRefresh(jwt(Math.floor(Date.now() / 1000) - 10)), true);
  assert.equal(accessTokenNeedsRefresh(jwt(Math.floor(Date.now() / 1000) + 30)), true);
  assert.equal(accessTokenNeedsRefresh(""), true);
  assert.equal(accessTokenNeedsRefresh("not-a-jwt"), true);
});

test("exp decode", () => {
  const exp = Math.floor(Date.now() / 1000) + 100;
  assert.equal(accessTokenExpiresAtMs(jwt(exp)), exp * 1000);
});
