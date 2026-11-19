import test from "node:test";
import assert from "node:assert/strict";
import {
  groupByNetwork,
  needsHandle,
  resolveCaption,
  captionSource,
  groupWarnings,
  usedForLine,
  networkNoun,
} from "./accountCaptions.js";

const a = { id: "a", platform: "facebook", account_name: "SocialCastly Page" };
const b = { id: "b", platform: "facebook", account_name: "socialcastly page" };
const x = { id: "x", platform: "twitter", account_name: "Brand" };

test("groups accounts by network and maps twitter to x", () => {
  const g = groupByNetwork([a, x, b]);
  assert.deepEqual(
    g.map((n) => [n.platform, n.accounts.length]),
    [
      ["facebook", 2],
      ["x", 1],
    ],
  );
});

test("needsHandle only when names collide", () => {
  assert.equal(needsHandle(a, [a, b, x]), true);
  assert.equal(needsHandle(x, [a, b, x]), false);
});

test("caption fallback: account, then network, then default", () => {
  const st = {
    caption: "Default",
    captionMode: "custom",
    captionsByNetwork: { facebook: "FB" },
    captionsByAccount: { a: "Mine" },
    useUniversalCaptionByAccount: { a: false },
  };
  assert.equal(resolveCaption(st, a), "Mine");
  assert.equal(captionSource(st, a), "account");
  assert.equal(resolveCaption(st, b), "FB");
  assert.equal(captionSource(st, b), "network");
  assert.equal(resolveCaption(st, x), "Default");
  assert.equal(captionSource(st, x), "default");
  assert.equal(resolveCaption({ ...st, captionMode: "universal" }, a), "Default");
});

test("usedForLine and nouns", () => {
  assert.equal(usedForLine("facebook", 2), "Used for both Facebook pages");
  assert.match(networkNoun("youtube", 1), /channel/);
});

test("caption warnings collapse into one group", () => {
  const w = [
    { accountId: "a", account: a, message: "Add a caption" },
    { accountId: "b", account: b, message: "Add a caption" },
  ];
  const g = groupWarnings(w, 2);
  assert.equal(g.length, 1);
  assert.match(g[0].detail, /All 2 accounts need one\./);
});
