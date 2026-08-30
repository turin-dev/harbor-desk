import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContextTar } from "../src/main/build-context.js";

function ustarEntryName(tar: Buffer, block: number): string {
  const raw = tar.subarray(block * 512, block * 512 + 100);
  const end = raw.indexOf(0);
  return (end >= 0 ? raw.subarray(0, end) : raw).toString("utf8");
}

function ustarEntrySize(tar: Buffer, block: number): number {
  const octal = tar
    .subarray(block * 512 + 124, block * 512 + 135)
    .toString("ascii")
    .replace(/\0.*$/, "");
  return parseInt(octal, 8);
}

test("builds a deterministic USTAR archive from a folder tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "harbor-build-ctx-"));
  await mkdir(join(root, "sub"), { recursive: true });
  await mkdir(join(root, "empty"), { recursive: true });
  await writeFile(join(root, "Dockerfile"), "FROM scratch\n");
  await writeFile(join(root, "sub", "app.txt"), "hello");
  const payload = await buildContextTar(root);
  const tar = Buffer.from(payload.base64Tar, "base64");
  // Two zero-block trailer.
  assert.ok(tar.length % 512 === 0, "archive must be 512-byte aligned");
  assert.deepEqual(
    tar.subarray(tar.length - 1024).toString("utf8"),
    "\u0000".repeat(1024),
    "archive must end with a 1024-byte zero trailer",
  );
  const names: string[] = [];
  for (let offset = 0; offset + 512 <= tar.length - 1024; offset += 512) {
    const name = ustarEntryName(tar, offset / 512);
    if (!name) break;
    names.push(name);
    const size = ustarEntrySize(tar, offset / 512);
    if (size > 0) offset += Math.ceil(size / 512) * 512;
  }
  assert.deepEqual(names, ["Dockerfile", "empty/", "sub/", "sub/app.txt"]);
  assert.equal(payload.entries.length, 4);
  assert.equal(payload.totalBytes, "FROM scratch\n".length + "hello".length);
  // Rebuilding the same tree yields the same archive.
  const again = await buildContextTar(root);
  assert.equal(again.base64Tar, payload.base64Tar);
});

test("rejects folders without files", async () => {
  const root = await mkdtemp(join(tmpdir(), "harbor-build-ctx-empty-"));
  await mkdir(join(root, "nothing"), { recursive: true });
  await assert.rejects(buildContextTar(root), /does not contain any files/);
});
