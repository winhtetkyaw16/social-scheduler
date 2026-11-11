/** Paths for comments, the inbox, insights, and network capabilities.

`request` is the studio's authenticatedFetch (or any function with the same shape).
This module does not render UI.
*/

export function postCommentsPath(postId) {
  return `/posts/${encodeURIComponent(postId)}/comments`;
}

export function postInsightsPath(postId) {
  return `/posts/${encodeURIComponent(postId)}/insights`;
}

export function postEngagementSyncPath(postId) {
  return `/posts/${encodeURIComponent(postId)}/engagement/sync`;
}

export function commentReplyPath(commentId) {
  return `/comments/${encodeURIComponent(commentId)}/reply`;
}

export function commentReadPath(commentId) {
  return `/comments/${encodeURIComponent(commentId)}/read`;
}

export function commentHidePath(commentId) {
  return `/comments/${encodeURIComponent(commentId)}/hide`;
}

export const bulkReadPath = "/comments/read";
export const capabilitiesPath = "/engagement/capabilities";

const INBOX_KEYS = ["network", "account_id", "status", "search", "limit", "offset"];

/** Inbox path with only the filters that were set. */
export function inboxPath(filters = {}) {
  const params = new URLSearchParams();
  for (const key of INBOX_KEYS) {
    const value = filters[key];
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `/inbox?${query}` : "/inbox";
}

/** Thin client. `request` sends an authenticated call and returns the JSON body. */
export function createEngagementClient(request) {
  return {
    listComments(postId) {
      return request(postCommentsPath(postId));
    },
    listInbox(filters) {
      return request(inboxPath(filters));
    },
    reply(commentId, text) {
      return request(commentReplyPath(commentId), {
        method: "POST",
        body: JSON.stringify({ text }),
      });
    },
    markRead(commentId) {
      return request(commentReadPath(commentId), { method: "POST" });
    },
    hideReply(commentId, hidden = true) {
      return request(commentHidePath(commentId), {
        method: "POST",
        body: JSON.stringify({ hidden }),
      });
    },
    markReadBulk(body) {
      return request(bulkReadPath, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    insights(postId) {
      return request(postInsightsPath(postId));
    },
    capabilities() {
      return request(capabilitiesPath);
    },
    syncPost(postId) {
      return request(postEngagementSyncPath(postId), { method: "POST" });
    },
  };
}
