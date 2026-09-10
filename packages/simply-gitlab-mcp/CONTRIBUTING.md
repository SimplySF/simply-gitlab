# Contributing to @simplysf/simply-gitlab-mcp

The Model Context Protocol server exposing GitLab to AI agents. This package is part of the [`simply-gitlab`](https://github.com/SimplySF/simply-gitlab) monorepo.

**Start with the [root CONTRIBUTING.md](https://github.com/SimplySF/simply-gitlab/blob/main/CONTRIBUTING.md).** It covers repository structure, environment setup, commit conventions, versioning, CI, git hooks, and the pull request process — all of which apply here. This file covers only what is specific to this package.

## Working on this package

Run from this directory to target just this package:

```sh
pnpm run build       # compile + lint
pnpm test            # the full gate CI runs
pnpm run test:only   # just the unit tests, skipping lint
node ./bin/run.js --help          # list the tools this server would register
node ./bin/run.js --allow-writes  # run it on stdio, if you have a client to attach
```

## stdout belongs to the protocol

A stdio MCP server uses stdout as the transport. Nothing in `bin/run.js` or anywhere under `src/`
may write to it except the transport itself — a stray `console.log` corrupts the protocol stream and
the client's failure will not point at it. Diagnostics go to stderr.

## Adding a tool

Every tool corresponds to exactly one CLI command, and `test/tools.test.ts` cross-checks the
catalogue against `packages/simply-gitlab/command-snapshot.json` in both directions. Adding a command
without a tool fails CI; so does a tool naming a command that does not exist.

A new tool needs:

- A `name` of the form `gitlab_<noun>_<verb>`, snake case. It is stable across releases: renaming one
  breaks every agent that learned it.
- A `command` naming the CLI command it mirrors.
- A `kind`: `read` or `write`. Write tools are registered only with `--allow-writes` and go through
  `assertWritesAllowed` before running.
- An `inputSchema`. Write tools include `dryRun`; a test asserts it.
- A `run` that calls into `@simplysf/simply-gitlab-core` — the same functions the command calls — and
  returns what the command returns under `--json`.

## Writing a description

The description is the whole interface. An agent chooses this tool over another one by reading it,
and gets the inputs right or wrong by reading it, so it is worth more care than the code beside it.

Say what the tool returns, not just what it does. Name the trap if there is one: that a merge request
is addressed by `iid` and not `id`, that a file update replaces the whole file, that an empty result
in an Advanced-Search scope may mean the feature is not enabled. Where the tool returns text someone
else wrote — a file, a job trace, a merge request description — say that it is data rather than
instructions.

## Errors are results

`invokeTool` never throws for an operational failure. A failure becomes an `isError` result whose
text is the JSON object `mapError` builds, with a stable `code` an agent can branch on. Only a
genuine bug should propagate.

The message and any response body are redacted of credentials and stripped of control characters
first, using core's `redactSecrets`, `sanitiseDeep`, and `stripControl`. Anything added to that
object needs the same treatment.

## Design documents

The catalogue, the read-only default, and the error mapping are covered by
[0002](../../docs/design/0002-migration-from-gitlab-mcp.md). The one place this server deliberately
offers less than the CLI — CI variable values — is
[0005](../../docs/design/0005-cicd-and-variable-values.md). Read that before adding a `reveal` input
of any kind.
