/** Sync posts and reload local state even when the provider confirms deletion (HTTP 410). */
export async function syncPostsAndRefresh(syncPost, postIds, refresh) {
  const results = await Promise.allSettled(postIds.map((postId) => syncPost(postId)));
  const deleted = results.some(
    (result) => result.status === "rejected" && result.reason?.status === 410,
  );
  const failure = results.find(
    (result) => result.status === "rejected" && result.reason?.status !== 410,
  );

  const messages = [...new Set(results.flatMap((result) =>
    result.status === "fulfilled" && result.value?.status_message ? [result.value.status_message] : [],
  ))];
  const state = messages.length ? { deleted, message: messages.join(" ") } : { deleted };
  if (deleted || !failure) await refresh(state);
  if (failure) throw failure.reason;
  return state;
}
