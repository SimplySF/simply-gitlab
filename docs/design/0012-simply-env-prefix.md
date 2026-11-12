# 0012 — Prefixing environment variables with `SIMPLY_`

**Status:** Implemented (PR #52)
**Package:** `simply-gitlab-core`, `simply-gitlab`, `simply-gitlab-mcp`
**Date:** 2026-11-12

## Problem

Every setting this project reads came from an unprefixed environment variable: `GITLAB_URL`,
`GITLAB_TOKEN`, `GITLAB_SSL_VERIFY`, `GITLAB_READ_ONLY`, and `GITLAB_PROJECT`. `GITLAB_TOKEN` and
`GITLAB_URL` in particular are what `glab`, CI scripts, and most GitLab MCP servers read, so a shell
set up for any of them silently configured this CLI too, pointing it at whatever instance and token
that tool used. There was no way to give this CLI its own settings without also changing the other
tool's. The same change was made in simply-atlassian (its design 0023); the two repos read their
settings the same way and should keep doing so.

## Decision

Every variable gets a `SIMPLY_` prefix, matching the `simply` binary and the SimplySF package scope.
The unprefixed names are deprecated, not removed: each still works while its prefixed name is unset,
and using one produces a warning. They are removed in a future major release.

The mapping lives once, in `simply-gitlab-core` (`src/env-vars.ts`, exported as `LEGACY_ENV`), and
every reader goes through `envValue(env, name)`, so the CLI and the MCP server cannot disagree about
which name wins.

## Behavior

| New name                   | Deprecated name     | Read by                    |
| -------------------------- | ------------------- | -------------------------- |
| `SIMPLY_GITLAB_URL`        | `GITLAB_URL`        | core (CLI and MCP)         |
| `SIMPLY_GITLAB_TOKEN`      | `GITLAB_TOKEN`      | core (CLI and MCP)         |
| `SIMPLY_GITLAB_SSL_VERIFY` | `GITLAB_SSL_VERIFY` | core (CLI and MCP)         |
| `SIMPLY_GITLAB_READ_ONLY`  | `GITLAB_READ_ONLY`  | core (CLI and MCP)         |
| `SIMPLY_GITLAB_PROJECT`    | `GITLAB_PROJECT`    | the CLI's `--project` only |

Resolution, per setting:

1. An explicit flag (`--gitlab-url`, `--gitlab-token`, `--project`) wins, as before. The flags now
   bind the prefixed name.
2. Otherwise the prefixed name, when it has a non-empty value.
3. Otherwise the deprecated name.

The prefixed name always wins over its deprecated one, so a `GITLAB_TOKEN` left in place for another
tool cannot override a setting made for this one. This applies to `SIMPLY_GITLAB_READ_ONLY` too: an
explicit `SIMPLY_GITLAB_READ_ONLY=0` beside `GITLAB_READ_ONLY=1` is not read-only, because someone
deliberately set the new name.

**`--project`** is a required flag whose default comes from oclif's `env` binding, and oclif rejects
a missing required flag while parsing, before any fallback of ours could run. So when only
`GITLAB_PROJECT` is set, the CLI hands the parser a copy of the flag definition bound to the
deprecated name instead. The shared definition is never modified, and `process.env` is not
rewritten.

**Errors** name the prefixed variable (`Set SIMPLY_GITLAB_TOKEN or pass --gitlab-token`), since that
is the one to set.

**Warnings.** When a deprecated name is the one actually supplying a value, one line names each
rename: `Deprecated environment variables in use: GITLAB_TOKEN → SIMPLY_GITLAB_TOKEN, …`. Values are
never included. A deprecated name shadowed by its prefixed one is not reported: it is most likely
there for another tool, and nagging about it on every run would punish exactly the person who
migrated.

- The CLI reports it with oclif's `warn` after loading `--env-file` (stderr; silent under `--json`,
  like every other warning).
- The MCP server writes it to stderr once at startup; stdout is the protocol. It reports only the
  connection settings (`CONNECTION_ENV`): it has no `--project`, so `GITLAB_PROJECT` is not its
  concern.
- Core only builds the text (`deprecatedEnvWarning`), keeping its no-terminal rule.

**`--env-file`** accepts both spellings of the four connection settings; `GITLAB_PROJECT` was never
read from a file and still is not, under either name. The rule that the real environment wins now
treats the two names of a setting as one: a file's entry is applied only when the environment sets
the setting under neither name. Checking only the file's own key would let a file's
`SIMPLY_GITLAB_READ_ONLY=0` outrank a real `GITLAB_READ_ONLY=1` — the prefixed name wins on lookup —
and so turn the guard off from a file, which the read-only design rules out.

**Redaction** collects the token under both names, whichever won, so a shadowed legacy token is
still scrubbed from output.

## Public API

`simply-gitlab-core` adds `LEGACY_ENV`, `EnvName`, `CONNECTION_ENV`, `envValue`,
`deprecatedEnvInUse` and `deprecatedEnvWarning`. `URL_ENV`, `TOKEN_ENV` and `READ_ONLY_ENV` now hold
the prefixed names, and `SECRET_ENV` lists both spellings of the token.

## Alternatives considered

- **Hard rename with no fallback.** Breaks every existing shell, `.env` file and MCP client entry on
  upgrade, with a "requires a token" error that does not say why. Rejected for a minor release.
- **Warn whenever a deprecated name is present.** Rejected for the shadowing reason above: the
  collision with other tools is the whole problem, so their variables are expected to stay.
- **Copy `GITLAB_PROJECT` into `process.env.SIMPLY_GITLAB_PROJECT` before parsing.** Simpler, but it
  mutates the process environment for everything after it, and the warning would then have to be
  told the value had been copied. Rebinding the flag keeps both untouched.

## Removal

A later major release deletes the fallback in `envValue`, the deprecated keys from the env-file
allowlist and `SECRET_ENV`, the `--project` rebinding, and the warning. Keeping
`GITLAB_SSL_VERIFY=false` rejection is worth reconsidering then, since that check exists for settings
carried over from other tooling.
