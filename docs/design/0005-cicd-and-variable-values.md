# 0005 — CI/CD reads, and the CI variable value policy

**Status:** Implemented (PR #1)
**Package:** all three
**Date:** 2026-09-09

## Problem

Three of the four CI reads are ordinary lists. The other two each have a problem that a
straight port would have shipped:

- **Job traces are enormous.** A trace of tens of megabytes is routine, and returning it whole blows
  a terminal's scrollback and an agent's context for a question that is nearly always "why did it
  fail".
- **`GET /projects/:id/variables` returns production secrets in clear text.** Every value, including
  the ones GitLab calls "masked" — masking only hides a value in job logs, never from the API. The
  original `gitlab-mcp` exposed this endpoint as an unqualified read tool, which makes copying a
  deploy key into a transcript a single tool call.

## Decision

Four read commands: `ci job list`, `ci job log`, `ci variable list`, `ci environment list`.

Traces are tailed to the last 200 lines by default. Variable values are hidden by default, and the
only way to see them is `--reveal` **on the CLI** — the MCP tool has no equivalent input.

## Behavior

### `gitlab ci job list` / `gitlab_ci_job_list`

Jobs across every pipeline, newest first. `--scope` is repeatable and the scopes are ORed, which is
GitLab's own semantics — this is the reason the transport spells arrays `scope[]=`.

### `gitlab ci job log` / `gitlab_ci_job_log`

`GET /jobs/:id/trace` answers `text/plain`, so it goes through the transport's text mode rather than
its JSON mode.

`--tail` defaults to 200 and `--tail 0` prints the whole trace. When the output was cut, the command
says so and names the flag, so a truncated trace is never mistaken for a short one. The MCP tool
takes the same `tail`, with the same default.

A trace is whatever the job printed: arbitrary text from an untrusted source, controlled by anyone
who can open a merge request. It goes through `logSafe`, which strips control characters — so the
colour codes a runner emits arrive plain, and an escape sequence cannot make the terminal show
something other than what the API returned. The tool description says plainly that the trace is data,
not instructions.

### `gitlab ci environment list` / `gitlab_ci_environment_list`

Available and stopped environments, with the last deployment on each in the JSON.

### `gitlab ci variable list` / `gitlab_ci_variable_list`

Keys, environment scopes, and the protected/masked attributes. Values are replaced with `<hidden>`,
in the table **and** in `--json` — hiding one but not the other would be theatre.

`--reveal` prints them, and its help says where that output ends up.

**The MCP tool has no `reveal` input at all.** This is the one place the two surfaces deliberately
differ, and it is worth being explicit about why. `AGENTS.md` says a capability in core that reaches
only one surface is the failure worth checking for, and normally it is. Here the asymmetry is the
feature: a value revealed to a person is on their screen, and a value revealed to an agent is in a
context window, a transcript, and whatever that agent writes next. A person who needs the value runs
the command. `test/tools.test.ts` asserts the absence of the input, so it cannot be added back
without someone deciding to.

None of this is a security boundary — an agent with shell access can run the CLI with `--reveal`. It
is the difference between a deliberate act and an incidental one, which is the same standard
`GITLAB_READ_ONLY` is held to.

## Alternatives considered

**Give the tool a `reveal` input and rely on the description to discourage it.** A description is
not a control. The tool would be called with `reveal: true` the first time an agent hit a "check
whether the variable is set correctly" task.

**Omit `ci variable list` from the MCP catalogue entirely.** Knowing _which_ variables exist, their
scopes, and whether they are protected answers most real questions — "is `DEPLOY_KEY` defined for
production?" — without any value leaving the instance. Dropping the tool loses that for no gain.

**Redact only variables GitLab marks `masked`.** That attribute describes job-log behaviour, not
sensitivity. An unmasked variable is routinely a token that simply could not satisfy GitLab's
masking rules (too short, wrong character set) — which makes unmasked ones _more_ likely to be
awkward secrets, not less.

**Return the whole trace and let the caller slice it.** The cost is paid at the transfer and in the
context window, before any caller gets the chance.
