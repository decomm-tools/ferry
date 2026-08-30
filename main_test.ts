import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { parseArgs } from "./args.ts";
import { run } from "./main.ts";

Deno.test("parseArgs out ./dir", () => {
  const args = parseArgs(["out", "./dir"]);
  assertEquals(args.command, "out");
  assertEquals(args.dir, "./dir");
  assertEquals(args.force, false);
  assertEquals(args.all, false);
});

Deno.test("parseArgs in ./dir", () => {
  const args = parseArgs(["in", "./dir"]);
  assertEquals(args.command, "in");
  assertEquals(args.dir, "./dir");
});

Deno.test("parseArgs --help and -h", () => {
  assertEquals(parseArgs(["--help"]).help, true);
  assertEquals(parseArgs(["-h"]).help, true);
});

Deno.test("parseArgs --force and --all", () => {
  const args = parseArgs(["out", "--force", "--all", "./dir"]);
  assertEquals(args.command, "out");
  assertEquals(args.dir, "./dir");
  assertEquals(args.force, true);
  assertEquals(args.all, true);
});

Deno.test("parseArgs unknown flag throws", () => {
  assertThrows(() => parseArgs(["--bogus"]), Error, "Unknown argument");
});

Deno.test("run --help is decomm ferry", async () => {
  const text = await run(["--help"]);
  assertStringIncludes(text, "decomm ferry");
  assertStringIncludes(text, "ferry.jsonl");
  assertStringIncludes(text, "./ferry.sh out ./dir");
  assertStringIncludes(text, "--force");
  assertStringIncludes(text, "--all");
  assertEquals(text.includes("decomm pack"), false);
  assertEquals(text.includes("pack <"), false);
});

Deno.test("run empty argv is help", async () => {
  const text = await run([]);
  assertStringIncludes(text, "decomm ferry");
});

Deno.test("run unknown command throws", async () => {
  await assertRejects(() => run(["nope"]), Error, "Unknown command");
});

Deno.test("run out without dir throws", async () => {
  await assertRejects(() => run(["out"]), Error, "out needs a directory");
});

Deno.test("run in without dir throws", async () => {
  await assertRejects(() => run(["in"]), Error, "in needs a directory");
});

const ferrySh = async (args: string[]): Promise<string> => {
  const proc = new Deno.Command("sh", {
    args: [`${Deno.cwd()}/ferry.sh`, ...args],
    cwd: Deno.cwd(),
    stdout: "piped",
    stderr: "piped",
  });
  const out = await proc.output();
  const stdout = new TextDecoder().decode(out.stdout);
  const stderr = new TextDecoder().decode(out.stderr);
  if (!out.success) throw new Error(stderr || stdout);
  return stdout;
};

Deno.test("ferry.sh out, copy, in is the carry-in example", async () => {
  const kit = await Deno.makeTempDir({ prefix: "decomm-ferry-kit-" });
  const far = await Deno.makeTempDir({ prefix: "decomm-ferry-far-" });
  try {
    await Deno.writeTextFile(`${kit}/readme.txt`, "sandbox notes\n");
    const hashed = await ferrySh(["out", kit]);
    assertStringIncludes(hashed, "1 file");
    assertStringIncludes(hashed, `${kit}/ferry.jsonl`);
    await Deno.copyFile(`${kit}/readme.txt`, `${far}/readme.txt`);
    await Deno.copyFile(`${kit}/ferry.jsonl`, `${far}/ferry.jsonl`);
    assertEquals((await ferrySh(["in", far])).trim(), "ok (1)");
  } finally {
    await Deno.remove(kit, { recursive: true });
    await Deno.remove(far, { recursive: true });
  }
});
