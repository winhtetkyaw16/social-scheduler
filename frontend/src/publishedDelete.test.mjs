import test from "node:test";
import assert from "node:assert/strict";
import {
  willRemoteDelete,
  deleteCopy,
  deleteModalBody,
  remoteDeleteFailedMessage,
  rowMenuActions,
  canShowPublishedDelete,
  TIKTOK_NO_DELETE_NOTE,
  createDeleteController,
} from "./publishedDelete.js";

const fb = { id: "a1", platform: "facebook", account_name: "Banner K" };
const tt = { id: "a2", platform: "tiktok", account_name: "Acme Studio" };
const publishedRemote = {
  id: "p1",
  status: "published",
  provider_post_id: "123",
  content: "hello",
};
const publishedNoId = { id: "p2", status: "published", provider_post_id: "", content: "hello" };
const publishedInbox = {
  id: "p3",
  status: "published",
  provider_post_id: "inbox:abc",
  content: "hello",
};
const scheduled = { id: "p4", status: "scheduled", content: "later" };

test("willRemoteDelete requires a real provider id (not inbox:)", () => {
  assert.equal(willRemoteDelete(publishedRemote), true);
  assert.equal(willRemoteDelete(publishedNoId), false);
  assert.equal(willRemoteDelete(publishedInbox), false);
  assert.equal(willRemoteDelete(scheduled), false);
});

test("remote confirm copy names the network; unpublished copy does not claim remote removal", () => {
  assert.equal(
    deleteCopy(publishedRemote, "Facebook"),
    "It will be removed from Facebook too. This can't be undone.",
  );
  assert.equal(
    deleteModalBody(publishedRemote, "Facebook"),
    "It will be removed from Facebook too. This can't be undone.",
  );
  assert.equal(
    deleteCopy(scheduled, "Facebook"),
    "It's removed from SocialCastly only. Nothing was published, so nothing changes on Facebook.",
  );
  assert.equal(
    deleteModalBody(scheduled, "Facebook"),
    "This will remove the post from your queue. This can't be undone.",
  );
  assert.equal(
    deleteModalBody(publishedNoId, "Facebook"),
    "This will remove the post from your queue. This can't be undone.",
  );
});

test("failed remote-delete toast copy is exact and includes Try-again wording separately", () => {
  assert.equal(
    remoteDeleteFailedMessage("Facebook"),
    "Couldn't delete from Facebook. It's not your fault \u2014 please try again later.",
  );
  assert.equal(
    remoteDeleteFailedMessage("Threads"),
    "Couldn't delete from Threads. It's not your fault \u2014 please try again later.",
  );
});

test("published row menu is delete-only; TikTok published has no delete or edit", () => {
  assert.deepEqual(rowMenuActions(publishedRemote, fb), { edit: false, delete: true });
  assert.deepEqual(rowMenuActions({ ...publishedRemote, preview_platform: "tiktok" }, tt), {
    edit: false,
    delete: false,
  });
  assert.equal(canShowPublishedDelete(publishedRemote, tt), false);
  assert.deepEqual(rowMenuActions(scheduled, fb), { edit: true, delete: true });
  assert.deepEqual(rowMenuActions({ ...scheduled, status: "publishing" }, fb), {
    edit: true,
    delete: false,
  });
});

test("TikTok empty-state note is exact", () => {
  assert.equal(
    TIKTOK_NO_DELETE_NOTE,
    "TikTok doesn't allow deleting from SocialCastly. You can delete it in the TikTok app.",
  );
});

test("mock HTTP: success calls DELETE once and reports ok (caller may then drop the row)", async () => {
  const calls = [];
  const request = async (url, opts) => {
    calls.push({ url, ...opts });
  };
  const ctl = createDeleteController();
  const result = await ctl.run(request, publishedRemote);
  assert.equal(result.status, "ok");
  assert.equal(result.post.id, "p1");
  assert.deepEqual(calls, [{ url: "/posts/p1", method: "DELETE" }]);
});

test("mock HTTP: failure keeps the same target and never reports ok", async () => {
  const ids = [];
  const request = async (url) => {
    ids.push(url);
    throw Object.assign(new Error("provider 403"), { status: 403 });
  };
  const ctl = createDeleteController();
  const first = await ctl.run(request, publishedRemote);
  const retry = await ctl.run(request, publishedRemote);
  assert.equal(first.status, "error");
  assert.equal(retry.status, "error");
  assert.equal(first.post.id, "p1");
  assert.equal(retry.post.id, "p1");
  assert.deepEqual(ids, ["/posts/p1", "/posts/p1"]);
});

test("mock HTTP: a second concurrent delete of the same post is ignored", async () => {
  let started = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const request = async () => {
    started += 1;
    await gate;
  };
  const ctl = createDeleteController();
  const pending = ctl.run(request, publishedRemote);
  await Promise.resolve();
  const skipped = await ctl.run(request, publishedRemote);
  assert.equal(skipped.status, "busy");
  assert.equal(skipped.post.id, "p1");
  assert.equal(started, 1);
  assert.equal(ctl.isBusy("p1"), true);
  release();
  const done = await pending;
  assert.equal(done.status, "ok");
  assert.equal(started, 1);
  assert.equal(ctl.isBusy("p1"), false);
});
