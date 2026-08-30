import test from "node:test";
import assert from "node:assert/strict";
import {
  formatHubMetric,
  hubReference,
  normalizeHubQuery,
  sortHubResults,
} from "./hub-format.js";
import type { HubSearchResult } from "@harbor/contracts";

function row(overrides: Partial<HubSearchResult> = {}): HubSearchResult {
  return {
    repository: "nginx",
    starCount: 1,
    pullCount: 1,
    isOfficial: false,
    ...overrides,
  };
}

test("normalizeHubQuery trims and collapses whitespace", () => {
  assert.equal(normalizeHubQuery("   "), "");
  assert.equal(normalizeHubQuery("  nginx   alpine  "), "nginx alpine");
});

test("sortHubResults orders by stars then pulls without mutating", () => {
  const rows = [
    row({ repository: "a", starCount: 1, pullCount: 5 }),
    row({ repository: "b", starCount: 9, pullCount: 2 }),
    row({ repository: "c", starCount: 1, pullCount: 9 }),
  ];
  const sorted = sortHubResults(rows);
  assert.deepEqual(
    sorted.map((item) => item.repository),
    ["b", "c", "a"],
  );
  assert.deepEqual(
    rows.map((item) => item.repository),
    ["a", "b", "c"],
  );
});

test("formatHubMetric renders compact counts", () => {
  assert.equal(formatHubMetric(undefined), "—");
  assert.equal(formatHubMetric(0), "—");
  assert.equal(formatHubMetric(-3), "—");
  assert.equal(formatHubMetric(950), "950");
  assert.equal(formatHubMetric(3100), "3.1 K");
  assert.equal(formatHubMetric(9000000000), "9.0 B");
});

test("hubReference returns the pullable repository name", () => {
  assert.equal(
    hubReference(row({ repository: "library/nginx" })),
    "library/nginx",
  );
});
