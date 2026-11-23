export function remotePostStatusLabel(post) {
  return post?.remote_status === "deleted" ? "Deleted on network" : null;
}

export function statusMatchesFilter(post, filter) {
  if (!filter || filter === "all") return true;
  if (filter === "remote_deleted") return post?.remote_status === "deleted";
  if (filter === "scheduled") return ["scheduled", "queued", "publishing"].includes(post?.status);
  if (filter === "published") return post?.status === "published" && post?.remote_status !== "deleted";
  return post?.status === filter;
}

export function filterPublishPosts(
  posts,
  accounts,
  { status = "all", platform = "all", accountId = "all" } = {},
) {
  const accountMap = new Map(
    (Array.isArray(accounts) ? accounts : []).map((account) => [account.id, account]),
  );
  return (Array.isArray(posts) ? posts : []).filter((post) => {
    if (!post || post.status === "archived") return false;
    if (!statusMatchesFilter(post, status)) return false;
    if (accountId !== "all" && String(post.connected_account_id) !== String(accountId))
      return false;
    if (platform !== "all") {
      const account = accountMap.get(post.connected_account_id);
      if (!account || account.platform !== platform) return false;
    }
    return true;
  });
}
