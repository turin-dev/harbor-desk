import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildContainerCreateInput,
  type ContainerFormState,
} from "./container-create-input.js";

function baseForm(
  overrides: Partial<ContainerFormState> = {},
): ContainerFormState {
  return {
    image: "nginx:1.27",
    name: "",
    command: "",
    portRows: [],
    envRows: [],
    labelRows: [],
    restartPolicy: "",
    ...overrides,
  };
}

test("buildContainerCreateInput trims the image and omits empty optionals", () => {
  const result = buildContainerCreateInput(
    baseForm({ image: "  nginx:1.27  " }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.input, { image: "nginx:1.27" });
});

test("buildContainerCreateInput requires an image reference", () => {
  const result = buildContainerCreateInput(baseForm({ image: "   " }));
  assert.deepEqual(result, {
    ok: false,
    error: "An image reference is required.",
  });
});

test("buildContainerCreateInput validates container port ranges", () => {
  const zero = buildContainerCreateInput(
    baseForm({
      portRows: [{ containerPort: "0", hostPort: "", protocol: "tcp" }],
    }),
  );
  assert.deepEqual(zero, {
    ok: false,
    error: "Container ports must be integers from 1 to 65535.",
  });
  const high = buildContainerCreateInput(
    baseForm({
      portRows: [{ containerPort: "65536", hostPort: "", protocol: "tcp" }],
    }),
  );
  assert.equal(high.ok, false);
});

test("buildContainerCreateInput validates host port ranges", () => {
  const result = buildContainerCreateInput(
    baseForm({
      portRows: [{ containerPort: "80", hostPort: "70000", protocol: "tcp" }],
    }),
  );
  assert.deepEqual(result, {
    ok: false,
    error: "Host ports must be integers from 1 to 65535.",
  });
});

test("buildContainerCreateInput rejects duplicate port mappings", () => {
  const result = buildContainerCreateInput(
    baseForm({
      portRows: [
        { containerPort: "80", hostPort: "8080", protocol: "tcp" },
        { containerPort: "80", hostPort: "8081", protocol: "tcp" },
      ],
    }),
  );
  assert.deepEqual(result, {
    ok: false,
    error: "Container port 80/tcp is mapped more than once.",
  });
});

test("buildContainerCreateInput skips blank port rows and builds mappings", () => {
  const result = buildContainerCreateInput(
    baseForm({
      portRows: [
        { containerPort: "", hostPort: "9999", protocol: "tcp" },
        { containerPort: "443", hostPort: "", protocol: "tcp" },
      ],
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.input.ports, [
    { containerPort: 443, protocol: "tcp" },
  ]);
});

test("buildContainerCreateInput filters and validates environment rows", () => {
  const invalid = buildContainerCreateInput(
    baseForm({ envRows: [{ name: "9BAD", value: "x" }] }),
  );
  assert.deepEqual(invalid, {
    ok: false,
    error: "Environment name 9BAD is not a valid variable name.",
  });
  const ok = buildContainerCreateInput(
    baseForm({
      envRows: [
        { name: "", value: "ignored" },
        { name: " A_B ", value: "1" },
      ],
    }),
  );
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.deepEqual(ok.input.env, [{ name: "A_B", value: "1" }]);
});

test("buildContainerCreateInput keeps labels and restart policy", () => {
  const result = buildContainerCreateInput(
    baseForm({
      name: " web ",
      command: " serve ",
      labelRows: [
        { key: "", value: "x" },
        { key: " team ", value: "core" },
      ],
      restartPolicy: "unless-stopped",
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.input, {
    image: "nginx:1.27",
    name: "web",
    command: "serve",
    restartPolicy: "unless-stopped",
    labels: { team: "core" },
  });
});
