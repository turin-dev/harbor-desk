import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * Minimal USTAR (POSIX) tar writer for Docker build contexts.
 * Files are added with a stable 0644 mode and a fixed mtime of 0 so the
 * resulting archive is deterministic for a given directory tree. Symlinks,
 * device files, and hardlink metadata are intentionally not represented:
 * the Docker Engine build context only needs regular files with their
 * relative POSIX paths. Directories are emitted as their own entries so
 * empty folders survive the transfer. The root-level .git directory is
 * skipped because it is never part of a useful build context.
 */

export interface BuildContextEntry {
  /** Context-relative POSIX path (directories end with a slash). */
  path: string;
  sizeBytes: number;
  mode: "file" | "directory";
}

export interface BuildContextPayload {
  base64Tar: string;
  entries: BuildContextEntry[];
  totalBytes: number;
}

const MAX_NAME_BYTES = 100;
const MAX_CONTEXT_BYTES = 256 * 1024 * 1024;

function fixedSizeField(value: string, size: number): Buffer {
  const out = Buffer.alloc(size);
  Buffer.from(value, "utf8").copy(out, 0);
  return out;
}

function octalField(value: number, size: number): Buffer {
  const text = (value >>> 0).toString(8).padStart(size - 1, "0") + "\0";
  return Buffer.from(text, "ascii");
}

function encodeHeader(entry: {
  path: string;
  sizeBytes: number;
  mode: "file" | "directory";
  mtime: number;
}): Buffer {
  const header = Buffer.alloc(512);
  fixedSizeField(entry.path, 100).copy(header, 0);
  octalField(entry.mode === "file" ? 0o644 : 0o755, 8).copy(header, 100);
  octalField(0, 8).copy(header, 108); // uid
  octalField(0, 8).copy(header, 116); // gid
  octalField(entry.sizeBytes, 12).copy(header, 124);
  octalField(entry.mtime, 12).copy(header, 136);
  let checksum = 0;
  for (let i = 0; i < 512; i += 1) checksum += header[i] ?? 0;
  octalField(checksum, 7).copy(header, 148);
  header[155] = 0x00;
  header[156] = 0x00; // typeflag: regular file (directories are zero-length)
  Buffer.from("ustar\0", "ascii").copy(header, 257);
  Buffer.from("00", "ascii").copy(header, 263);
  return header;
}

function assertNameFits(path: string): void {
  if (Buffer.byteLength(path, "utf8") > MAX_NAME_BYTES) {
    throw new Error(
      `Build context path is too long for USTAR (max ${MAX_NAME_BYTES} bytes): ${path}`,
    );
  }
}

async function collectEntries(
  root: string,
  current: string,
  out: BuildContextEntry[],
): Promise<void> {
  const files = await readdir(current, { withFileTypes: true });
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
    if (file.name === ".git" && current === root) continue;
    const absolute = join(current, file.name);
    const rel = relative(root, absolute).split(sep).join("/");
    if (file.isDirectory()) {
      out.push({ path: rel + "/", sizeBytes: 0, mode: "directory" });
      await collectEntries(root, absolute, out);
    } else if (file.isFile()) {
      const info = await stat(absolute);
      out.push({ path: rel, sizeBytes: info.size, mode: "file" });
    }
  }
}

export async function buildContextTar(
  folder: string,
): Promise<BuildContextPayload> {
  const entries: BuildContextEntry[] = [];
  await collectEntries(folder, folder, entries);
  if (!entries.some((entry) => entry.mode === "file")) {
    throw new Error("The selected folder does not contain any files.");
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    assertNameFits(entry.path);
    chunks.push(
      encodeHeader({
        path: entry.path,
        sizeBytes: entry.sizeBytes,
        mode: entry.mode,
        mtime: 0,
      }),
    );
    if (entry.mode === "file") {
      const data = await readFile(join(folder, ...entry.path.split("/")));
      totalBytes += data.length;
      chunks.push(data);
      const remainder = data.length % 512;
      if (remainder !== 0) chunks.push(Buffer.alloc(512 - remainder));
    }
  }
  if (totalBytes > MAX_CONTEXT_BYTES) {
    throw new Error(
      "The build context is larger than 256 MiB; remove files and retry.",
    );
  }
  chunks.push(Buffer.alloc(1024));
  return {
    base64Tar: Buffer.concat(chunks).toString("base64"),
    entries,
    totalBytes,
  };
}
