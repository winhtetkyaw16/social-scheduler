import test from "node:test";
import assert from "node:assert/strict";
import { connectIntroCopy, introCopyIsPlain } from "./connectIntro.js";

test("Facebook connect matches the spec", () => {
  const copy = connectIntroCopy("facebook");
  assert.equal(copy.title, "Connect Facebook");
  assert.equal(copy.subtitle, "You'll sign in with Facebook, then pick which Pages to post to.");
  assert.deepEqual(copy.bullets, [
    "Personal profiles can't be used for posting.",
    "You can add or remove Pages later.",
  ]);
  assert.equal(copy.note, "");
  assert.equal(copy.continueLabel, "Continue with Facebook");
  assert.ok(introCopyIsPlain(copy));
});

test("Facebook reconnect changes the title, subtitle and adds the stay-connected note", () => {
  const copy = connectIntroCopy("facebook", { reconnect: true });
  assert.equal(copy.title, "Reconnect Facebook");
  assert.equal(copy.subtitle, "Sign in again with Facebook to refresh this connection.");
  assert.deepEqual(copy.bullets, [
    "Personal profiles can't be used for posting.",
    "You can add or remove Pages later.",
  ]);
  assert.equal(copy.note, "Your existing Pages stay connected.");
  assert.equal(copy.continueLabel, "Continue with Facebook");
  assert.ok(introCopyIsPlain(copy));
});

test("other networks follow Connect/Reconnect {Network} and Continue with {Network}", () => {
  assert.equal(connectIntroCopy("instagram").title, "Connect Instagram");
  assert.equal(connectIntroCopy("linkedin", { reconnect: true }).title, "Reconnect LinkedIn");
  assert.equal(connectIntroCopy("x").continueLabel, "Continue with X");
  assert.equal(connectIntroCopy("youtube").title, "Connect YouTube");
  assert.match(connectIntroCopy("youtube").subtitle, /Google/);
  assert.ok(connectIntroCopy("pinterest").subtitle.toLowerCase().includes("board"));
});

test("at most two bullets, and none of the copy uses jargon", () => {
  for (const platform of [
    "facebook",
    "instagram",
    "linkedin",
    "x",
    "youtube",
    "tiktok",
    "pinterest",
    "threads",
  ]) {
    for (const reconnect of [false, true]) {
      const copy = connectIntroCopy(platform, { reconnect });
      assert.ok(copy.bullets.length <= 2, platform);
      assert.ok(introCopyIsPlain(copy), `${platform} reconnect=${reconnect}`);
      assert.equal(Boolean(copy.note), reconnect);
    }
  }
});
