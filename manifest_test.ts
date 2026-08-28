import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { run } from "./main.ts";

const write = async (dir: string, name: string, text: string) => {
  const parts = name.split("/");
  if (parts.length > 1) {
    await Deno.mkdir(`${dir}/${parts.slice(0, -1).join("/")}`, { recursive: true });
  }
  await Deno.writeTextFile(`${dir}/${name}`, text);
};

Deno.test("out then in roundtrip", async () => {
  const dir = await Deno.makeTempDir({ prefix: "decomm-ferry-rt-" });
  try {
    await write(dir, "a.txt", "alpha\n");
    await write(dir, "nested/b.txt", "beta\n");
    await write(dir, ".hidden", "dot\n");
    const out = await run(["out", dir]);
    assertStringIncludes(out, "3 files");
    assertStringIncludes(out, `${dir}/ferry.jsonl`);
    const text = await Deno.readTextFile(`${dir}/ferry.jsonl`);
    assertEquals(text.endsWith("\n"), true);
    const lines = text.trimEnd().split("\n");
    assertEquals(lines.length, 3);
    const parsed = lines.map((line) => JSON.parse(line));
    assertEquals(parsed.map((row) => row.path), [".hidden", "a.txt", "nested/b.txt"]);
    for (const row of parsed) {
      assertEquals(Object.keys(row), ["path", "sha256"]);
      assertEquals(typeof row.sha256, "string");
      assertEquals(row.sha256.length, 64);
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
    await run(["out", dir]);
    const text = await Deno.readTextFile(`${dir}/ferry.jsonl`);
    const paths = text.trimEnd().split("\n").map((line) => JSON.parse(line).path);
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
    const text = await Deno.readTextFile(`${dir}/ferry.jsonl`);
    const paths = text.trimEnd().split("\n").map((line) => JSON.parse(line).path);
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
