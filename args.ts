export type FerryArgs = {
  command: string;
  dir: string;
  help: boolean;
};

export const parseArgs = (argv: string[]): FerryArgs => {
  const parsed: FerryArgs = {
    command: "",
    dir: "",
    help: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--") continue;
    else if (!arg.startsWith("-")) rest.push(arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  parsed.command = rest[0] ?? "";
  parsed.dir = rest[1] ?? "";
  return parsed;
};
