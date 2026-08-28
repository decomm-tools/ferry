import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { parseArgs } from "./args.ts";
import { run } from "./main.ts";

Deno.test("parseArgs out ./dir", () => {
  const args = parseArgs(["out", "./dir"]);
  assertEquals(args.command, "out");
  assertEquals(args.dir, "./dir");
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

Deno.test("parseArgs unknown flag throws", () => {
  assertThrows(() => parseArgs(["--bogus"]), Error, "Unknown argument");
});

Deno.test("run --help is decomm ferry", async () => {
  const text = await run(["--help"]);
  assertStringIncludes(text, "decomm ferry");
  assertStringIncludes(text, "ferry.jsonl");
  assertStringIncludes(text, "./ferry.sh out ./dir");
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
