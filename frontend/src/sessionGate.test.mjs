import test from "node:test";
import assert from "node:assert/strict";
import { showsAppShell } from "./sessionGate.js";

test("signed-in pages require a session token", () => {
  assert.equal(showsAppShell(false, ""), false);
  assert.equal(showsAppShell(true, ""), false);
  assert.equal(showsAppShell(false, "token"), false);
  assert.equal(showsAppShell(true, "token"), true);
});
