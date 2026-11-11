import test from "node:test";
import assert from "node:assert/strict";
import { resolveApiBase, resolveApiOrigin } from "./apiBase.js";

test("defaults to same-origin relative /api/v1", () => {
  assert.equal(resolveApiBase({}), "/api/v1");
  assert.equal(resolveApiOrigin("/api/v1", "https://socialcastly.com"), "https://socialcastly.com");
});

test("VITE_API_BASE_URL overrides the legacy VITE_API_BASE", () => {
  assert.equal(
    resolveApiBase({
      VITE_API_BASE_URL: "https://api.socialcastly.com/api/v1/",
      VITE_API_BASE: "https://ignored.example/api/v1",
    }),
    "https://api.socialcastly.com/api/v1",
  );
});

test("an origin or /api value is normalized onto /api/v1", () => {
  assert.equal(
    resolveApiBase({ VITE_API_BASE_URL: "https://api.socialcastly.com" }),
    "https://api.socialcastly.com/api/v1",
  );
  assert.equal(resolveApiBase({ VITE_API_BASE_URL: "/api" }), "/api/v1");
  assert.equal(
    resolveApiOrigin("https://api.socialcastly.com/api/v1", "https://socialcastly.com"),
    "https://api.socialcastly.com",
  );
});

test("legacy VITE_API_BASE still works", () => {
  assert.equal(resolveApiBase({ VITE_API_BASE: "http://127.0.0.1:8000/api/v1" }), "http://127.0.0.1:8000/api/v1");
});
