export const MANIFEST_NAME = "ferry.jsonl";

export type ManifestEntry = {
  path: string;
  sha256: string;
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

export const sha256File = async (path: string): Promise<string> => {
  const bytes = await Deno.readFile(path);
  return hex(await crypto.subtle.digest("SHA-256", bytes));
};

/** Relative posix paths, files only, no symlink follow, skip .git/ trees and ferry.jsonl. */
export const walkFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];

  const walk = async (abs: string, rel: string): Promise<void> => {
    for await (const entry of Deno.readDir(abs)) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = `${abs}/${entry.name}`;
      let st: Deno.FileInfo;
      try {
        st = await Deno.lstat(childAbs);
      } catch {
        continue;
      }
      if (st.isSymlink) continue;
      if (st.isDirectory) {
        if (entry.name === ".git") continue;
        await walk(childAbs, childRel);
        continue;
      }
      if (!st.isFile) continue;
      if (childRel === MANIFEST_NAME) continue;
      files.push(childRel);
    }
  };

  await walk(root, "");
  files.sort();
  return files;
};

export const writeManifest = async (dir: string, entries: ManifestEntry[]): Promise<string> => {
  const path = `${dir}/${MANIFEST_NAME}`;
  const lines = entries.map((entry) => JSON.stringify({ path: entry.path, sha256: entry.sha256 }));
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
    entries.push({ path: rec.path, sha256: rec.sha256 });
  }
  return entries;
};

export const ferryOut = async (directory: string): Promise<string> => {
  const dir = await ensureDir(directory);
  const paths = await walkFiles(dir);
  const entries: ManifestEntry[] = [];
  for (const rel of paths) {
    entries.push({ path: rel, sha256: await sha256File(`${dir}/${rel}`) });
  }
  const manifestPath = await writeManifest(dir, entries);
  return `${entries.length} files\n${manifestPath}\n`;
};

export const ferryIn = async (directory: string): Promise<string> => {
  const dir = await ensureDir(directory);
  const expected = await readManifest(dir);
  const expectedMap = new Map<string, string>();
  for (const entry of expected) expectedMap.set(entry.path, entry.sha256);

  const actualMap = new Map<string, string>();
  for (const rel of await walkFiles(dir)) {
    actualMap.set(rel, await sha256File(`${dir}/${rel}`));
  }

  const missing: string[] = [];
  const extra: string[] = [];
  const changed: string[] = [];

  for (const [path, sha] of expectedMap) {
    if (!actualMap.has(path)) missing.push(path);
    else if (actualMap.get(path) !== sha) changed.push(path);
  }
  for (const path of actualMap.keys()) {
    if (!expectedMap.has(path)) extra.push(path);
  }

  missing.sort();
  extra.sort();
  changed.sort();

  if (missing.length > 0 || extra.length > 0 || changed.length > 0) {
    const lines: string[] = [];
    for (const path of missing) lines.push(`missing: ${path}`);
    for (const path of extra) lines.push(`extra: ${path}`);
    for (const path of changed) lines.push(`changed: ${path}`);
    throw new Error(lines.join("\n"));
  }

  return `ok (${expected.length})\n`;
};
