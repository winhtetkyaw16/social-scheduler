import test from "node:test";
import assert from "node:assert/strict";
import {
  bulkReadPath,
  capabilitiesPath,
  createEngagementClient,
  inboxPath,
  postCommentsPath,
} from "./api/engagement.js";

test("inbox path keeps only set filters", () => {
  assert.equal(inboxPath(), "/inbox");
  assert.equal(inboxPath({ status: "unread", search: "" }), "/inbox?status=unread");
  const path = inboxPath({
    network: "instagram",
    account_id: "acc-1",
    status: "unreplied",
    search: "hello world",
    limit: 20,
    offset: 40,
  });
  assert.match(path, /^\/inbox\?/);
  assert.match(path, /network=instagram/);
  assert.match(path, /account_id=acc-1/);
  assert.match(path, /status=unreplied/);
  assert.match(path, /search=hello\+world/);
  assert.match(path, /limit=20/);
  assert.match(path, /offset=40/);
});

test("engagement client calls the authenticated request helper", async () => {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    return { ok: true, path };
  };
  const client = createEngagementClient(request);
  await client.listComments("post/1");
  await client.listInbox({ status: "replied" });
  await client.reply("comment 1", "Thanks");
  await client.markRead("comment 1");
  await client.markReadBulk({ all_matching: true, status: "unread" });
  await client.insights("post/1");
  await client.capabilities();
  await client.syncPost("post/1");

  assert.equal(calls[0].path, postCommentsPath("post/1"));
  assert.equal(calls[1].path, "/inbox?status=replied");
  assert.equal(calls[2].path, "/comments/comment%201/reply");
  assert.equal(calls[2].options.method, "POST");
  assert.equal(calls[2].options.body, JSON.stringify({ text: "Thanks" }));
  assert.equal(calls[3].options.method, "POST");
  assert.equal(calls[4].path, bulkReadPath);
  assert.equal(calls[5].path, "/posts/post%2F1/insights");
  assert.equal(calls[6].path, capabilitiesPath);
  assert.equal(calls[7].path, "/posts/post%2F1/engagement/sync");
  assert.equal(calls[7].options.method, "POST");
});
