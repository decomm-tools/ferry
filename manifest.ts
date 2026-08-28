import { crypto } from "@std/crypto";

export const MANIFEST_NAME = "ferry.jsonl";

const SKIP_NOISE = new Set([".DS_Store", "Thumbs.db"]);

export type ManifestEntry = {
  path: string;
  sha256: string;
  size?: number;
  mtime?: string;
};

export const resolveDir = (directory: string): string => {
  if (directory.startsWith("/")) return directory;
  return `${Deno.cwd()}/${directory}`;
};

export const ensureDir = async (directory: string): Promise<string> => {
  const abs = resolveDir(directory);
  try {
    const st = await Deno.stat(abs);
    if (!st.isDirectory) throw new Error(`${abs} is not a directory`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw new Error(`No directory at ${abs}`);
    throw error;
  }
  return abs;
};

const hex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

const unreadable = (path: string): Error => new Error(`unreadable: ${path}`);

/** Stream SHA-256 of a file. Does not load the whole file into memory. */
export const sha256File = async (path: string): Promise<string> => {
  const file = await Deno.open(path, { read: true });
  try {
    return hex(await crypto.subtle.digest("SHA-256", file.readable));
  } finally {
    try {
      file.close();
    } catch {
      // Stream consumption may already have closed the handle.
    }
  }
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${text.replace(/\.0$/, "")} ${units[unit]}`;
};

const visitFile = async (
  childAbs: string,
  childRel: string,
  st: Deno.FileInfo,
): Promise<ManifestEntry> => {
  let sha256: string;
  try {
    sha256 = await sha256File(childAbs);
  } catch {
    throw unreadable(childRel);
  }
  const entry: ManifestEntry = { path: childRel, sha256, size: st.size };
  if (st.mtime) entry.mtime = st.mtime.toISOString();
  return entry;
};

/**
 * Walk files and hash in one pass. Relative posix paths, files only, no symlink
 * follow. Skip .git/ trees and ferry.jsonl. Skip .DS_Store and Thumbs.db unless
 * `all`. Sort only when writing jsonl.
 */
export const walkFiles = async (
  root: string,
  options: { all?: boolean } = {},
): Promise<ManifestEntry[]> => {
  const files: ManifestEntry[] = [];

  const walk = async (abs: string, rel: string): Promise<void> => {
    try {
      for await (const entry of Deno.readDir(abs)) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const childAbs = `${abs}/${entry.name}`;
        let st: Deno.FileInfo;
        try {
          st = await Deno.lstat(childAbs);
        } catch {
          throw unreadable(childRel);
        }
        if (st.isSymlink) continue;
        if (!options.all && SKIP_NOISE.has(entry.name)) continue;
        if (st.isDirectory) {
          if (entry.name === ".git") continue;
          await walk(childAbs, childRel);
          continue;
        }
        if (!st.isFile) continue;
        if (childRel === MANIFEST_NAME) continue;
        files.push(await visitFile(childAbs, childRel, st));
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("unreadable:")) throw error;
      throw unreadable(rel || ".");
    }
  };

  await walk(root, "");
  return files;
};

export const writeManifest = async (dir: string, entries: ManifestEntry[]): Promise<string> => {
  const path = `${dir}/${MANIFEST_NAME}`;
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const lines = sorted.map((entry) => {
    const rec: Record<string, unknown> = {
      path: entry.path,
      sha256: entry.sha256,
      size: entry.size,
    };
    if (entry.mtime !== undefined) rec.mtime = entry.mtime;
    return JSON.stringify(rec);
  });
  const text = lines.length === 0 ? "" : lines.join("\n") + "\n";
  await Deno.writeTextFile(path, text);
  return path;
};

export const readManifest = async (dir: string): Promise<ManifestEntry[]> => {
  const path = `${dir}/${MANIFEST_NAME}`;
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw new Error(`No ${MANIFEST_NAME} at ${path}`);
    throw error;
  }
  const entries: ManifestEntry[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`bad ${MANIFEST_NAME} line ${i + 1}`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`bad ${MANIFEST_NAME} line ${i + 1}`);
    }
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.path !== "string" || typeof rec.sha256 !== "string") {
      throw new Error(`bad ${MANIFEST_NAME} line ${i + 1}`);
    }
    const entry: ManifestEntry = { path: rec.path, sha256: rec.sha256 };
    if (rec.size !== undefined) {
      if (typeof rec.size !== "number" || !Number.isFinite(rec.size)) {
        throw new Error(`bad ${MANIFEST_NAME} line ${i + 1}`);
      }
      entry.size = rec.size;
    }
    if (typeof rec.mtime === "string") entry.mtime = rec.mtime;
    entries.push(entry);
  }
  return entries;
};

export type FerryOptions = {
  force?: boolean;
  all?: boolean;
};

export const ferryOut = async (
  directory: string,
  options: FerryOptions = {},
): Promise<string> => {
  const dir = await ensureDir(directory);
  const manifestPath = `${dir}/${MANIFEST_NAME}`;
  if (!options.force) {
    try {
      await Deno.lstat(manifestPath);
      throw new Error(
        `${MANIFEST_NAME} already exists. Pass --force to overwrite, or run in to verify the existing receipt.`,
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  const entries = await walkFiles(dir, { all: options.all });
  await writeManifest(dir, entries);
  const total = entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  const word = entries.length === 1 ? "file" : "files";
  return `${entries.length} ${word}, ${formatBytes(total)}\n${manifestPath}\n`;
};

export const ferryIn = async (
  directory: string,
  options: FerryOptions = {},
): Promise<string> => {
  const dir = await ensureDir(directory);
  const expected = await readManifest(dir);
  const expectedMap = new Map<string, ManifestEntry>();
  for (const entry of expected) expectedMap.set(entry.path, entry);

  const actualMap = new Map<string, ManifestEntry>();
  for (const entry of await walkFiles(dir, { all: options.all })) {
    actualMap.set(entry.path, entry);
  }

  const missing: string[] = [];
  const extra: string[] = [];
  const changed: string[] = [];

  for (const [path, want] of expectedMap) {
    const got = actualMap.get(path);
    if (!got) missing.push(path);
    else if (
      got.sha256 !== want.sha256 ||
      (typeof want.size === "number" && Number.isFinite(want.size) && got.size !== want.size)
    ) changed.push(path);
  }
  for (const path of actualMap.keys()) {
    if (!expectedMap.has(path)) extra.push(path);
  }

  missing.sort();
  extra.sort();
  changed.sort();

  if (missing.length > 0 || extra.length > 0 || changed.length > 0) {
    const parts: string[] = [];
    if (changed.length > 0) parts.push(`${changed.length} changed`);
    if (missing.length > 0) parts.push(`${missing.length} missing`);
    if (extra.length > 0) parts.push(`${extra.length} extra`);
    const lines: string[] = [parts.join(", ")];
    for (const path of changed) lines.push(`changed: ${path}`);
    for (const path of missing) lines.push(`missing: ${path}`);
    for (const path of extra) lines.push(`extra: ${path}`);
    throw new Error(lines.join("\n"));
  }

  return `ok (${expected.length})\n`;
};
