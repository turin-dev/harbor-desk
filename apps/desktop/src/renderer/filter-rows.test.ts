import assert from "node:assert/strict";
import { test } from "node:test";
import { filterRowsByQuery } from "./filter-rows.js";

interface Row {
  name: string;
  tag?: string;
  scope?: string;
}

const rows: Row[] = [
  { name: "nginx", tag: "1.27" },
  { name: "redis", tag: "7.2" },
  { name: "harbor-core", scope: "global" },
];

const fields = (row: Row) => [row.name, row.tag ?? "", row.scope ?? ""];

test("filterRowsByQuery returns all rows for blank queries", () => {
  assert.deepEqual(filterRowsByQuery(rows, fields, ""), rows);
  assert.deepEqual(filterRowsByQuery(rows, fields, "   "), rows);
});

test("filterRowsByQuery matches fields case-insensitively", () => {
  const result = filterRowsByQuery(rows, fields, "NGINX");
  assert.deepEqual(result, [{ name: "nginx", tag: "1.27" }]);
  const byTag = filterRowsByQuery(rows, fields, "7.2");
  assert.deepEqual(byTag, [{ name: "redis", tag: "7.2" }]);
  const byScope = filterRowsByQuery(rows, fields, "GLOBAL");
  assert.deepEqual(byScope, [{ name: "harbor-core", scope: "global" }]);
});

test("filterRowsByQuery trims the query and supports partial matches", () => {
  const result = filterRowsByQuery(rows, fields, "  redis ");
  assert.deepEqual(result, [{ name: "redis", tag: "7.2" }]);
  const partial = filterRowsByQuery(rows, fields, "core");
  assert.deepEqual(partial, [{ name: "harbor-core", scope: "global" }]);
});

test("filterRowsByQuery returns an empty list when nothing matches", () => {
  assert.deepEqual(filterRowsByQuery(rows, fields, "zzz"), []);
  const many = filterRowsByQuery(rows, fields, "r");
  assert.equal(many.length, 2);
});
