/**
 * Hash a folder on the way out. Check missing, extra, or changed on the way in.
 *
 * `out` walks files, SHA-256s each, and writes `ferry.jsonl` inside the folder.
 * Carry that folder. `in` rehashes and throws if a path is missing, extra, or
 * changed.
 *
 * Use {@linkcode run} from the CLI. Point `out` or `in` at a directory.
 *
 * @example Hash and verify a folder
 * ```ts
 * import { run } from "jsr:@decomm/ferry";
 *
 * await run(["out", "./dir"]);
 * await run(["in", "./dir"]);
 * ```
 *
 * @module jsr:@decomm/ferry
 */

import { parseArgs } from "./args.ts";
import { ferryIn, ferryOut } from "./manifest.ts";

const HELP = `decomm ferry

Hash a folder on the way out. Check missing, extra, or changed on the way in.

ferry.jsonl travels inside the folder. Carry the folder. in fails if a path is
missing, extra, or changed.

Commands:
  out <dir>            Walk files, SHA-256, write ferry.jsonl inside the folder
  in <dir>             Rehash and fail on missing, extra, or changed
  help                 This text

Examples:
  ./ferry.sh out ./dir
  ./ferry.sh in ./dir
  deno task compile
`;

/**
 * Run one CLI command and return the text that would be printed.
 *
 * Commands: `out`, `in`. `out` writes `ferry.jsonl`. `in` fails on missing,
 * extra, or changed files.
 *
 * @param argv Arguments after the binary name.
 * @returns Help text, or a trailing-newline status string for the command.
 *
 * @example
 * ```ts
 * import { run } from "jsr:@decomm/ferry";
 * await run(["out", "./dir"]);
 * ```
 */
export async function run(argv: string[]): Promise<string> {
  const args = parseArgs(argv);
  if (args.help || args.command === "" || args.command === "help") return HELP;

  switch (args.command) {
    case "out": {
      if (!args.dir) throw new Error("out needs a directory");
      return await ferryOut(args.dir);
    }
    case "in": {
      if (!args.dir) throw new Error("in needs a directory");
      return await ferryIn(args.dir);
    }
    default:
      throw new Error(`Unknown command: ${args.command}`);
  }
}

if (import.meta.main) {
  try {
    const out = await run(Deno.args);
    if (out) console.log(out.endsWith("\n") ? out.slice(0, -1) : out);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
