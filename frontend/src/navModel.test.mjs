import test from "node:test";
import assert from "node:assert/strict";
import { NAV_GROUPS, menuUnreadDot, navBadge, navItemHeight, unreadAfterMarkAllRead } from "./navModel.js";

test("nav groups, order, and icons match the spec", () => {
  assert.deepEqual(
    NAV_GROUPS.map((group) => group.label),
    ["Workspace", "Insights", "Manage", "More"],
  );
  assert.deepEqual(
    NAV_GROUPS[0].items.map((item) => item.label),
    ["Dashboard", "Create post", "Calendar", "Queue", "Drafts", "Approvals", "Inbox"],
  );
  assert.equal(NAV_GROUPS[0].items.find((item) => item.label === "Inbox").icon, "inbox");
  assert.deepEqual(
    NAV_GROUPS[2].items.map((item) => item.label),
    ["Channels", "Media library", "Team", "Settings"],
  );
  assert.deepEqual(
    NAV_GROUPS[3].items.map((item) => [item.label, item.icon]),
    [
      ["Bio Link", "link"],
      ["Community", "message-square"],
    ],
  );
  const ids = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("badges hide at zero, inbox is the strong text-colour badge, and 99+ caps", () => {
  assert.equal(navBadge("queue", { queue: 0 }), null);
  assert.equal(navBadge("inbox", { inbox: 0 }), null);
  assert.deepEqual(navBadge("drafts", { drafts: 3 }), { text: "3", strong: false });
  assert.deepEqual(navBadge("inbox", { inbox: 12 }), { text: "12", strong: true });
  assert.deepEqual(navBadge("inbox", { inbox: 120 }), { text: "99+", strong: true });
  assert.equal(navItemHeight("desktop"), 36);
  assert.equal(navItemHeight("phone"), 40);
  assert.equal(navItemHeight("tablet"), 40);
});

test("inbox badge and the menu dot clear at zero and right after mark all read", () => {
  assert.equal(navBadge("inbox", { inbox: 4 }).text, "4");
  assert.equal(menuUnreadDot(4), true);
  const cleared = unreadAfterMarkAllRead();
  assert.equal(cleared, 0);
  assert.equal(navBadge("inbox", { inbox: cleared }), null);
  assert.equal(menuUnreadDot(cleared), false);
  assert.equal(navBadge("inbox", { inbox: 0 }), null);
  assert.equal(menuUnreadDot(0), false);
  assert.equal(menuUnreadDot(null), false);
});
