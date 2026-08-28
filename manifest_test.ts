import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { crypto } from "@std/crypto";
import { run } from "./main.ts";
import { MANIFEST_NAME, sha256File } from "./manifest.ts";

const write = async (dir: string, name: string, text: string) => {
  const parts = name.split("/");
  if (parts.length > 1) {
    await Deno.mkdir(`${dir}/${parts.slice(0, -1).join("/")}`, { recursive: true });
  }
  await Deno.writeTextFile(`${dir}/${name}`, text);
};

const hex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

const receipt = async (dir: string) => {
  const text = await Deno.readTextFile(`${dir}/${MANIFEST_NAME}`);
  if (text === "") return [];
  return text.trimEnd().split("\n").map((line) => JSON.parse(line));
};

Deno.test("sha256File streams a small file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-stream-" });
  try {
    const path = `${dir}/small.txt`;
    const bytes = new TextEncoder().encode("alpha\n");
    await Deno.writeFile(path, bytes);
    const streamed = await sha256File(path);
    const expected = hex(await crypto.subtle.digest("SHA-256", bytes));
    assertEquals(streamed, expected);
    assertEquals(streamed.length, 64);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("out then in roundtrip", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-rt-" });
  try {
    await write(dir, "a.txt", "alpha\n");
    await write(dir, "nested/b.txt", "beta\n");
    await write(dir, ".hidden", "dot\n");
    const out = await run(["out", dir]);
    assertStringIncludes(out, "3 files");
    assertStringIncludes(out, "15 B");
    assertStringIncludes(out, `${dir}/ferry.jsonl`);
    const text = await Deno.readTextFile(`${dir}/ferry.jsonl`);
    assertEquals(text.endsWith("\n"), true);
    const lines = text.trimEnd().split("\n");
    assertEquals(lines.length, 3);
    const parsed = lines.map((line) => JSON.parse(line));
    assertEquals(parsed.map((row) => row.path), [".hidden", "a.txt", "nested/b.txt"]);
    const sizes = { ".hidden": 4, "a.txt": 6, "nested/b.txt": 5 };
    for (const row of parsed) {
      assertEquals(typeof row.path, "string");
      assertEquals(typeof row.sha256, "string");
      assertEquals(row.sha256.length, 64);
      assertEquals(typeof row.size, "number");
      assertEquals(row.size, sizes[row.path as keyof typeof sizes]);
    }
    assertEquals(await run(["in", dir]), "ok (3)\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("in fails on missing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-miss-" });
  try {
    await write(dir, "keep.txt", "keep\n");
    await write(dir, "gone.txt", "gone\n");
    await run(["out", dir]);
    await Deno.remove(`${dir}/gone.txt`);
    const err = await assertRejects(() => run(["in", dir]), Error, "missing");
    assertStringIncludes(err.message, "gone.txt");
    assertEquals(err.message.split("\n")[0], "1 missing");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("in fails on extra", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-extra-" });
  try {
    await write(dir, "keep.txt", "keep\n");
    await run(["out", dir]);
    await write(dir, "stowaway.txt", "nope\n");
    const err = await assertRejects(() => run(["in", dir]), Error, "extra");
    assertStringIncludes(err.message, "stowaway.txt");
    assertEquals(err.message.split("\n")[0], "1 extra");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("in fails on changed", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-chg-" });
  try {
    await write(dir, "readme.md", "one\n");
    await run(["out", dir]);
    await write(dir, "readme.md", "two\n");
    const err = await assertRejects(() => run(["in", dir]), Error, "changed");
    assertStringIncludes(err.message, "readme.md");
    assertEquals(err.message.split("\n")[0], "1 changed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("in summary counts changed missing extra", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-sum-" });
  try {
    await write(dir, "a.txt", "a\n");
    await write(dir, "b.txt", "b\n");
    await write(dir, "c.txt", "c\n");
    await run(["out", dir]);
    await write(dir, "a.txt", "changed\n");
    await Deno.remove(`${dir}/b.txt`);
    await write(dir, "extra.txt", "e\n");
    const err = await assertRejects(() => run(["in", dir]), Error);
    assertEquals(err.message.split("\n")[0], "1 changed, 1 missing, 1 extra");
    assertStringIncludes(err.message, "changed: a.txt");
    assertStringIncludes(err.message, "missing: b.txt");
    assertStringIncludes(err.message, "extra: extra.txt");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("out skips .git trees and ferry.jsonl", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-git-" });
  try {
    await write(dir, "keep.txt", "keep\n");
    await Deno.mkdir(`${dir}/.git/objects`, { recursive: true });
    await Deno.writeTextFile(`${dir}/.git/objects/ab`, "blob\n");
    await Deno.writeTextFile(`${dir}/ferry.jsonl`, "stale\n");
    await run(["out", "--force", dir]);
    const paths = (await receipt(dir)).map((row) => row.path);
    assertEquals(paths, ["keep.txt"]);
    assertEquals(await run(["in", dir]), "ok (1)\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("out does not follow symlinks", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-link-" });
  try {
    await write(dir, "real.txt", "real\n");
    await Deno.symlink(`${dir}/real.txt`, `${dir}/link.txt`);
    await run(["out", dir]);
    const paths = (await receipt(dir)).map((row) => row.path);
    assertEquals(paths, ["real.txt"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("out of an empty dir then in is ok (0)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-empty-" });
  try {
    const out = await run(["out", dir]);
    assertStringIncludes(out, "0 files");
    assertEquals(await Deno.readTextFile(`${dir}/ferry.jsonl`), "");
    assertEquals(await run(["in", dir]), "ok (0)\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("out refuses existing ferry.jsonl without --force", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-clobber-" });
  try {
    await write(dir, "a.txt", "a\n");
    await run(["out", dir]);
    const err = await assertRejects(() => run(["out", dir]), Error, "--force");
    assertStringIncludes(err.message, "ferry.jsonl already exists");
    assertStringIncludes(err.message, "in to verify");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("out --force overwrites existing ferry.jsonl", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-force-" });
  try {
    await write(dir, "a.txt", "a\n");
    await run(["out", dir]);
    await write(dir, "b.txt", "b\n");
    await run(["out", "--force", dir]);
    const paths = (await receipt(dir)).map((row) => row.path);
    assertEquals(paths, ["a.txt", "b.txt"]);
    assertEquals(await run(["in", dir]), "ok (2)\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("unreadable file fails the walk", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-unreadable-" });
  const secret = `${dir}/secret.txt`;
  try {
    await write(dir, "ok.txt", "ok\n");
    await write(dir, "secret.txt", "nope\n");
    await Deno.chmod(secret, 0o000);
    const err = await assertRejects(() => run(["out", dir]), Error, "unreadable");
    assertStringIncludes(err.message, "secret.txt");
  } finally {
    try {
      await Deno.chmod(secret, 0o644);
    } catch {
      // ignore
    }
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("unreadable directory fails the walk", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-lockdir-" });
  const locked = `${dir}/locked`;
  try {
    await Deno.mkdir(locked);
    await write(dir, "locked/x.txt", "x\n");
    await Deno.chmod(locked, 0o000);
    const err = await assertRejects(() => run(["out", dir]), Error, "unreadable");
    assertStringIncludes(err.message, "locked");
  } finally {
    try {
      await Deno.chmod(locked, 0o755);
    } catch {
      // ignore
    }
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test(".DS_Store and Thumbs.db skipped unless --all", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-noise-" });
  try {
    await write(dir, "keep.txt", "keep\n");
    await write(dir, ".DS_Store", "mac\n");
    await write(dir, "nested/Thumbs.db", "win\n");
    await run(["out", dir]);
    assertEquals((await receipt(dir)).map((row) => row.path), ["keep.txt"]);
    await run(["out", "--force", "--all", dir]);
    assertEquals((await receipt(dir)).map((row) => row.path), [
      ".DS_Store",
      "keep.txt",
      "nested/Thumbs.db",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("node_modules is hashed", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-nm-" });
  try {
    await write(dir, "node_modules/pkg/index.js", "module.exports = 1\n");
    await write(dir, "keep.txt", "keep\n");
    await run(["out", dir]);
    const paths = (await receipt(dir)).map((row) => row.path);
    assertEquals(paths, ["keep.txt", "node_modules/pkg/index.js"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("mtime change does not fail in if hash and size match", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-mtime-" });
  try {
    await write(dir, "a.txt", "hello\n");
    await run(["out", dir]);
    const past = new Date(Date.now() - 86_400_000);
    await Deno.utime(`${dir}/a.txt`, past, past);
    assertEquals(await run(["in", dir]), "ok (1)\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("size mismatch is changed", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-size-" });
  try {
    await write(dir, "a.txt", "hello\n");
    await run(["out", dir]);
    const rows = await receipt(dir);
    rows[0].size = rows[0].size + 1;
    await Deno.writeTextFile(`${dir}/ferry.jsonl`, JSON.stringify(rows[0]) + "\n");
    const err = await assertRejects(() => run(["in", dir]), Error, "changed");
    assertStringIncludes(err.message, "a.txt");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
