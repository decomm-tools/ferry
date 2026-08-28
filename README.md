# decomm ferry

Hash a folder on the way out. Check missing, extra, or changed on the way in.

You copied a folder onto a stick and walked it over. Did every byte survive? Did anything extra
hitch a ride? `out` writes a SHA-256 and size for every file into `ferry.jsonl` inside that folder.
Carry the folder. `in` rehashes and fails if a path is missing, extra, or changed.

## Commands

| Command     | What                                                        |
| ----------- | ----------------------------------------------------------- |
| `out <dir>` | Walk files, SHA-256 each, write `ferry.jsonl` in the folder |
| `in <dir>`  | Rehash. Fail on missing, extra, or changed                  |

Flags: `--force` overwrites `ferry.jsonl` if it already exists. `--all` includes `.DS_Store` and
`Thumbs.db`.

`ferry.jsonl` travels inside the folder. Each line is `{ path, sha256, size }` (bytes; optional
`mtime` for display only). Paths are relative, posix `/`, sorted when written. Files only. Symlinks
are not followed. `.git/` trees are skipped so a checkout does not hash the repo db. `.DS_Store` and
`Thumbs.db` are skipped unless `--all`. Dotfiles and `node_modules` are included. The manifest file
itself is not hashed. Hashes stream from disk so a big dump does not have to fit in RAM. Unreadable
files fail the walk instead of vanishing from the receipt.

`in` prints `ok (N)` or a summary like `3 changed, 1 missing, 1 extra` then the path list, and exits
nonzero on any mismatch. Size or hash mismatch is changed. `mtime` is ignored on the way in (FAT/USB
rewrite).

## Carry-in

```sh
deno run -A jsr:@decomm/ferry/init ./ferry
cd ferry
deno task compile
./ferry.sh out ./dir
./ferry.sh in ./dir
```

Or from this repo, on a connected machine:

```sh
deno task compile
./ferry.sh out ./dir
./ferry.sh in ./dir
```

Copy the **folder you hashed**, including `ferry.jsonl`, onto the isolated box. Then `in`.

`ferry.sh` runs the compiled ferry CLI if it exists, otherwise
`deno run --allow-read --allow-write`. The isolated box does not need Deno if you compiled first.
