import test from "node:test";
import assert from "node:assert/strict";
import {
  realHandle,
  destinationSubtitle,
  selectableIds,
  initialSelection,
  toggleSelection,
  showSelectAll,
  allSelected,
  toggleAll,
  selectionSummary,
  pickerTitle,
  pickerSubtitle,
  cleanName,
  FACEBOOK_CREATE_PAGE_URL,
  pickerMode,
  primaryAction,
  footerStatus,
  connectedLabel,
  isReauthRow,
} from "./pagePicker.js";

const pages = [
  {
    id: "1",
    name: "Banner K",
    platform: "facebook",
    account_type: "page",
    category: "SOCIAL MEDIA AGENCY",
  },
  { id: "2", name: "SocialCastly", platform: "facebook", account_type: "page" },
  {
    id: "3",
    name: "Acme Studio",
    platform: "facebook",
    account_type: "page",
    already_connected: true,
  },
];

test("already-added Pages are excluded from selection, Select all and counts", () => {
  assert.deepEqual(selectableIds(pages), ["1", "2"]);
  assert.deepEqual(initialSelection(pages), ["1", "2"]);
  assert.deepEqual(toggleSelection(["1"], "3", pages), ["1"]);
  assert.deepEqual(selectionSummary(["1", "2", "3"], pages), {
    n: 2,
    m: 2,
    status: "2 of 2 Pages selected",
    addLabel: "Add 2 Pages",
    canAdd: true,
  });
});

test("toggling and counts", () => {
  let sel = toggleSelection(["1", "2"], "2", pages);
  assert.deepEqual(sel, ["1"]);
  assert.equal(selectionSummary(sel, pages).addLabel, "Add 1 Page");
  assert.equal(selectionSummary(sel, pages).status, "1 of 2 Pages selected");
  sel = toggleSelection(sel, 1, pages);
  const empty = selectionSummary(sel, pages);
  assert.equal(empty.canAdd, false);
  assert.equal(empty.addLabel, "Add Pages");
  assert.equal(empty.status, "0 of 2 Pages selected");
});

test("Select all only with 2+ selectable; toggles between all and none", () => {
  assert.equal(showSelectAll(pages), true);
  assert.equal(showSelectAll(pages.slice(1)), false); // 1 selectable + 1 already added
  assert.equal(allSelected(["1", "2"], pages), true);
  assert.deepEqual(toggleAll(["1"], pages), ["1", "2"]);
  assert.deepEqual(toggleAll(["1", "2"], pages), []);
  assert.equal(allSelected([], []), false);
});

test("Facebook subtitle: 'Facebook Page' plus sentence-case category, never a made-up handle", () => {
  assert.equal(destinationSubtitle(pages[0]), "Facebook Page \u00b7 Social media agency");
  assert.equal(destinationSubtitle(pages[1]), "Facebook Page");
  assert.equal(
    destinationSubtitle({ platform: "facebook", account_type: "group", name: "G" }),
    "Facebook Group",
  );
  assert.ok(!destinationSubtitle(pages[1]).includes("@"));
});

test("handles only when the API returned one", () => {
  assert.equal(realHandle({ account_name: "Banner K", platform: "facebook" }), "");
  assert.equal(realHandle({ username: "acme" }), "@acme");
  assert.equal(realHandle({ extra_metadata: { username: "@acme" } }), "@acme");
  assert.equal(realHandle({ account_name: "Acme (@acme.studio)" }), "@acme.studio");
  assert.equal(
    destinationSubtitle({ platform: "instagram", name: "Acme (@acme)" }),
    "Instagram account \u00b7 @acme",
  );
  assert.equal(cleanName("Acme (@acme)"), "Acme");
});

test("mixed destinations use a neutral noun", () => {
  const mixed = [...pages, { id: "9", platform: "instagram", name: "IG" }];
  assert.equal(selectionSummary(["1"], mixed).status, "1 of 3 destinations selected");
});

test("copy and create-Page link", () => {
  assert.equal(pickerTitle("facebook"), "Choose Facebook Pages");
  assert.equal(
    pickerSubtitle("facebook"),
    "Pick the Pages you want to post to. You can change this later.",
  );
  assert.equal(pickerTitle("linkedin", "LinkedIn"), "Choose LinkedIn destinations");
  assert.match(FACEBOOK_CREATE_PAGE_URL, /^https:\/\/www\.facebook\.com\//);
});

const allAdded = pages.map((p) => ({ ...p, already_connected: true }));

test("mode: Re-auth is always reconnect; all-added only in normal Connect", () => {
  assert.equal(pickerMode({ reauthId: "3", destinations: allAdded }), "reconnect");
  assert.equal(pickerMode({ reauthId: "3", destinations: pages }), "reconnect");
  assert.equal(pickerMode({ destinations: allAdded }), "all-added");
  assert.equal(pickerMode({ destinations: pages }), "connect");
  assert.equal(pickerMode({ destinations: [] }), "connect"); // empty state
});

test("reconnect: primary always enabled; 'Reconnect' or 'Save N Pages'; refreshes existing", () => {
  assert.deepEqual(primaryAction("reconnect", [], allAdded), {
    label: "Reconnect",
    enabled: true,
    ids: [],
    refreshExisting: true,
  });
  const withNew = primaryAction("reconnect", ["1"], pages);
  assert.equal(withNew.label, "Save 1 Page");
  assert.deepEqual(withNew.ids, ["1"]);
  assert.equal(withNew.refreshExisting, true);
  assert.equal(primaryAction("reconnect", ["1", "2", "3"], pages).label, "Save 2 Pages");
  assert.equal(primaryAction("reconnect", [], pages).label, "Reconnect");
});

test("all-added Connect shows an enabled Done; normal Connect unchanged", () => {
  assert.deepEqual(primaryAction("all-added", [], allAdded), {
    label: "Done",
    enabled: true,
    ids: [],
    refreshExisting: true,
  });
  assert.deepEqual(primaryAction("connect", [], pages), {
    label: "Add Pages",
    enabled: false,
    ids: [],
    refreshExisting: false,
  });
  assert.equal(primaryAction("connect", ["2"], pages).label, "Add 1 Page");
});

test("footer status hidden when M = 0; connected labels; re-auth row", () => {
  assert.equal(footerStatus([], allAdded), "");
  assert.equal(footerStatus(["1"], pages), "1 of 2 Pages selected");
  assert.equal(connectedLabel("reconnect"), "Connected");
  assert.equal(connectedLabel("connect"), "Already added");
  assert.equal(isReauthRow({ id: 3 }, "3"), true);
  assert.equal(isReauthRow({ id: "3" }, ""), false);
});
