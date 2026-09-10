# Contributing to @simplysf/simply-gitlab

The `simply gitlab` command-line interface. This package is part of the [`simply-gitlab`](https://github.com/SimplySF/simply-gitlab) monorepo.

**Start with the [root CONTRIBUTING.md](https://github.com/SimplySF/simply-gitlab/blob/main/CONTRIBUTING.md).** It covers repository structure, environment setup, commit conventions, versioning, CI, git hooks, and the pull request process — all of which apply here. This file covers only what is specific to this package.

## Working on this package

Run from this directory to target just this package:

```sh
pnpm run build       # command-snapshot + compile + lint
pnpm test            # the full gate CI runs
pnpm run test:only   # just the unit tests, skipping lint
pnpm run readme      # regenerate the command reference in README.md
./bin/dev.js gitlab mr list --project group/project   # run without compiling
```

`bin/dev.js` runs the TypeScript directly through ts-node; `bin/run.js` runs the compiled `lib/`.

## Where the logic goes

Not here. A command parses flags, calls into `@simplysf/simply-gitlab-core`, renders the result, and
returns the value oclif prints under `--json`. Anything between input and request — validating an
iid, building a request body, deciding what a partial result means — belongs in core, because the MCP
server needs the same rule and a second implementation of it will drift.

The rule to check a new command against: could the MCP tool for this command call the same functions?
If not, something that should be in core is in the command.

## Adding a command

1. Write the design document first — see [docs/design/README.md](../../docs/design/README.md).
2. Put the behavior in `@simplysf/simply-gitlab-core`, with its tests.
3. Add the command under `src/commands/gitlab/`, extending `GitLabCommand`. Set
   `public static override isWrite = true` if it changes data; the read-only guard is enforced
   centrally in `init()`, so nothing else is needed for it.
4. Add the matching tool to `packages/simply-gitlab-mcp/src/tools.ts`, with its `command` naming this
   one. `test/tools.test.ts` over there cross-checks both directions against
   `command-snapshot.json`, so skipping this fails CI.
5. Run `pnpm run build` and commit the regenerated `command-snapshot.json`.
6. Run `pnpm run readme` and commit the regenerated `README.md`. Nothing enforces this — CI catches a
   stale snapshot, but not a stale README.

## Command copy

Summaries, descriptions, and examples live inline as static class properties. There is no
`messages/*.md` convention here.

Write the description for someone who does not already know the GitLab API. The details worth
spending a line on are the ones where GitLab does something surprising: that branches come back
alphabetically rather than by recency, that a draft merge request is marked by a title prefix, that
an empty update returns 200 and changes nothing. A description that restates the summary is worse
than none, because it costs a reader time to find that out.

## Printing

Use `this.logSafe()`, not `this.log()`, for anything the instance produced. Merge request titles,
commit messages, file contents, and job traces are written by whoever can push to a project, and
`logSafe` strips the control characters that would otherwise let one of them overwrite what the
terminal already showed.

`this.log()` is fine for text this CLI wrote itself — headings, counts, the dry-run banner.

## Output shape

Return the value you want under `--json` from `run()`; oclif prints it verbatim. Human-readable
output goes through `formatTable` or `formatKeyValue` from core.

A list command that was cut short by `--limit` must say so — `reportList()` does this — so a partial
answer is never mistaken for the whole one.
