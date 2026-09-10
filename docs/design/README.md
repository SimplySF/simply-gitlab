# Design Documents

Every new feature in this repo gets a design document here **before** it gets code. The point isn't
ceremony — it's that a year from now, the "why" behind a command's shape (why this package, why this
flag, what we rejected) is recoverable without archaeology through git history and PR threads.

## Process

1. **Write the design doc first.** Copy the [template](#template) into
   `docs/design/NNNN-short-slug.md`, using the next free four-digit number.
2. **Get agreement on it** — on the doc, not on the diff. Decisions are cheapest to change here.
3. **Implement**, then update the doc if the implementation taught you something the design got
   wrong. A design doc that quietly diverges from the shipped behavior is worse than none.
4. **Set the status line** to `Implemented` (with the PR link) when it lands.

A design doc is not a substitute for user-facing docs. Command summaries, flag descriptions, and
examples still live on the command classes themselves (or in `messages/*.md`, if that convention gets
introduced later) and each package's README — see the root `CONTRIBUTING.md` checklist. The design
doc records the reasoning; the command/README records the behavior.

## When a design doc is required

- Any new command, or a new subtopic.
- Any change to an existing command's flags, output shape, or error behavior that users would
  notice.
- Any new shared module, or a change to how packages depend on each other.
- Introducing a GitLab API client/SDK dependency, or changing how auth is handled.

Not required for: bug fixes that restore documented behavior, dependency bumps, test-only changes,
refactors that keep the public surface identical (though a short doc is welcome for large ones).

## Index

| #    | Title                                                                                      | Status              |
| ---- | ------------------------------------------------------------------------------------------ | ------------------- |
| 0001 | [GitLab client core (config, auth, HTTP, paging)](0001-gitlab-client-core.md)              | Implemented (PR #1) |
| 0002 | [Migrating gitlab-mcp into a CLI, MCP server, and core](0002-migration-from-gitlab-mcp.md) | Implemented (PR #1) |
| 0003 | [Reading and writing repository content](0003-repository-content.md)                       | Implemented (PR #1) |
| 0004 | [Merge requests](0004-merge-requests.md)                                                   | Implemented (PR #1) |
| 0005 | [CI/CD reads, and the CI variable value policy](0005-cicd-and-variable-values.md)          | Implemented (PR #1) |
| 0006 | [Search across three endpoints](0006-search.md)                                            | Implemented (PR #1) |
| 0007 | [Project and group configuration baselines](0007-configuration-baselines.md)               | Draft               |

## Template

```markdown
# NNNN — Title

**Status:** Draft | Planned | Implemented (PR #N) | Superseded by NNNN
**Package:** the `packages/*` this lands in
**Date:** YYYY-MM-DD

## Problem

What the user can't do today, and why that hurts.

## Decision

The one-paragraph answer: what we're building and where it lives.

## Behavior

The user-visible contract — command name, flags, resolution rules, output, errors. Tables beat
prose for lookup rules.

## Alternatives considered

Each option we rejected and the specific reason. This section is the one future readers come back
for.

## Implementation plan

Files added/changed, in the order they'd be written.

## Testing

Unit test coverage, and what each case pins down.

## Open questions

Anything deliberately left undecided, and who decides it.
```
