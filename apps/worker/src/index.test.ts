import test from "node:test";
import assert from "node:assert/strict";

import { parseRedisUrl } from "./index.js";

test("parseRedisUrl reads host, port, password, and database", () => {
  const parsed = parseRedisUrl("rediss://usr:p%40ss@10.0.0.5:7000/3");
  assert.deepEqual(parsed, {
    host: "10.0.0.5",
    port: 7000,
    password: "p@ss",
    db: 3,
  });
  assert.equal(parseRedisUrl("redis://127.0.0.1").port, 6379);
  assert.equal(parseRedisUrl("redis://127.0.0.1").password, undefined);
  assert.equal(parseRedisUrl("redis://127.0.0.1").db, undefined);
  assert.equal(parseRedisUrl("redis://127.0.0.1:6381").port, 6381);
  assert.equal(parseRedisUrl("redis://127.0.0.1/2").db, 2);
  assert.throws(() => parseRedisUrl("not a redis url"));
});
