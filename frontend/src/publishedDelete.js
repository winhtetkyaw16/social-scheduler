/** Pure helpers for published-post delete UI (composer format wiring is untouched). */

export const NETWORK_NAMES = {
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  twitter: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  threads: "Threads",
  bluesky: "Bluesky",
};

export function platformOf(post, account) {
  return String(account?.platform || post?.preview_platform || "").toLowerCase();
}

export function networkName(post, account) {
  const p = platformOf(post, account);
  return NETWORK_NAMES[p] || account?.platform || "the network";
}

/** True when DELETE /posts/:id will also delete the post on the provider (published with a real provider id). */
export function willRemoteDelete(post) {
  return Boolean(post?.provider_post_id) && !String(post.provider_post_id).startsWith("inbox:");
}

export function canDeletePost(post) {
  return post?.status !== "publishing";
}

export function canShowPublishedDelete(post, account) {
  return (
    post?.status === "published" && platformOf(post, account) !== "tiktok" && canDeletePost(post)
  );
}

/** What the row menu should offer. Published: Delete only (never Edit); TikTok published: neither. */
export function rowMenuActions(post, account) {
  if (!post) return { edit: false, delete: false };
  if (post.status === "published") {
    return { edit: false, delete: canShowPublishedDelete(post, account) };
  }
  return { edit: true, delete: Boolean(canDeletePost(post)) };
}

export function deleteCopy(post, network) {
  return willRemoteDelete(post)
    ? `It will be removed from ${network} too. This can't be undone.`
    : `It's removed from SocialCastly only. Nothing was published, so nothing changes on ${network}.`;
}

/** Body copy for the shared delete modal. Local/unpublished wording stays the pre-existing queue sentence. */
export function deleteModalBody(post, network) {
  return willRemoteDelete(post)
    ? `It will be removed from ${network} too. This can't be undone.`
    : "This will remove the post from your queue. This can't be undone.";
}

export function remoteDeleteFailedMessage(network) {
  return `Couldn't delete from ${network}. It's not your fault \u2014 please try again later.`;
}

export const TIKTOK_NO_DELETE_NOTE =
  "TikTok doesn't allow deleting from SocialCastly. You can delete it in the TikTok app.";

/**
 * Shared in-flight lock so confirm + toast "Try again" cannot fire two DELETEs for the same post,
 * and a failure never looks like success (no optimistic remove).
 */
export function createDeleteController() {
  const inflight = new Set();
  return {
    isBusy(id) {
      return inflight.has(id);
    },
    async run(request, post) {
      const id = post?.id;
      if (!id) return { status: "error", post, error: new Error("Missing post") };
      if (inflight.has(id)) return { status: "busy", post };
      inflight.add(id);
      try {
        await request(`/posts/${id}`, { method: "DELETE" });
        return { status: "ok", post };
      } catch (error) {
        return { status: "error", post, error };
      } finally {
        inflight.delete(id);
      }
    },
  };
}

export const publishedDeleteController = createDeleteController();
