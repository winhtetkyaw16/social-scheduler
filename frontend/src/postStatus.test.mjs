import test from "node:test";
import assert from "node:assert/strict";
import { filterPublishPosts, remotePostStatusLabel } from "./postStatus.js";

test("remote-deleted posts have a visible label and dedicated filter", () => {
  const posts = [
    { id: "live", status: "published", remote_status: "available", connected_account_id: "a" },
    { id: "deleted", status: "published", remote_status: "deleted", connected_account_id: "a" },
  ];
  assert.equal(remotePostStatusLabel(posts[1]), "Deleted on network");
  assert.equal(remotePostStatusLabel(posts[0]), null);
  assert.deepEqual(
    filterPublishPosts(posts, [{ id: "a", platform: "youtube" }], { status: "remote_deleted" }).map((post) => post.id),
    ["deleted"],
  );
  assert.deepEqual(
    filterPublishPosts(posts, [], { status: "published" }).map((post) => post.id),
    ["live"],
  );
});
