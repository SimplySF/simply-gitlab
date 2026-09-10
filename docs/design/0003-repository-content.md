# 0003 — Reading and writing repository content

**Status:** Implemented (PR #1)
**Package:** all three
**Date:** 2026-09-09

## Problem

Projects, branches, tags, releases, files, and commits are the read surface people actually want
from a GitLab CLI, plus three writes: create a branch, write a file, and commit a batch of file
changes. Each has a detail that a straight port of the original tools would have got wrong.

## Decision

Ten commands: `project list/view`, `branch list/create`, `tag list`, `release list`,
`file view/create/update`, `commit list/view/diff/create`. Each has a matching MCP tool.

## Behavior

### Reads

`project list` without `--search` lists everything the token can reach, which on a large instance is
not a useful answer; both the description and the tool description say so and name the flag.
`--simple` exists because the full project payload is large and most callers want ids and paths.

`branch list` says plainly that GitLab orders branches alphabetically rather than by recency, and
that `merged` means "into the default branch" — not into whatever the caller is working on.

`tag list` says that the default order is by the date of the commit each tag points at, not the
tagging date, so a tag cut today on an old commit sorts old.

`commit list --path` narrows to commits touching one file or directory, which is the fastest way to
answer when something changed and who changed it.

`commit view --sha` accepts a branch or tag name as well as a SHA, in which case the answer is the
commit at its tip and therefore changes as the branch moves. Said out loud, because a caller who
scripts `--sha main` and compares results over time needs to know.

`commit diff` prints a heading per file that distinguishes added, deleted, renamed, and modified —
`renamed old -> new` rather than a bare path, which would read as an edit. `--stat` lists the files
without the hunks, which is what to reach for first on a large commit.

### `file view`

`GET /repository/files/:path` answers a JSON envelope whose `content` is base64. The command decodes
it and prints it under a short metadata header; `--raw` prints the contents alone; `--json` returns
GitLab's payload unchanged, base64 and all.

Two details:

**The encoding is honoured, not assumed.** Some self-managed versions answer `encoding: "text"`.
Decoding plain text as base64 yields silent garbage, which is precisely the failure a user cannot
diagnose from the output.

**Binary content is not printed.** A NUL byte is the tell. The bytes of a PNG written to a terminal
emit escape sequences, and written into an agent's context they are noise that can carry an
instruction. The metadata still prints, so the caller can see what was found. The MCP tool reports
`printable: false` and omits the text.

File contents go through `logSafe` for the same reason job traces do: anyone who can push controls
them.

### `file create` / `file update`

`--content` or `--content-file`, never both. Branch and message are required by GitLab and checked
here, so the refusal names the flag rather than arriving as a 400 whose body says `branch is
missing`.

`file update` takes `--last-commit-id`, which `file view` reports. Passing it makes GitLab reject the
write if someone else changed the file meanwhile, instead of silently overwriting them. The command
says the whole file is replaced and there is no partial edit; the tool description adds "so read it
first", because that is the mistake an agent makes.

### `commit create`

A batch of actions in one atomic commit. The action list is JSON — `--actions` or inside a
`--body-file` — because there is no readable flag form for a list of file operations.

Every action is validated before anything is sent: the verb must be one GitLab knows, `file_path` is
required, and `create`/`update` need `content`, `move` needs `previous_path`, `chmod` needs
`execute_filemode`. All of these are rules GitLab enforces too; the difference is that its 400 names
neither the index nor the field, which turns a ten-file commit into a hunt. Ours says
`actions[3].content is required for the "create" action.`

`--actions` is parsed through a helper that keeps only the position from a JSON parse failure, never
the parser's snippet — a caller can build that string from any file, and the snippet would echo its
first bytes.

### Writes generally

Each takes `--dry-run`, which prints the exact request body and sends nothing. None takes
`--confirm`: nothing here deletes anything, and a confirmation on a recoverable action trains a
caller to pass it always, at which point it protects nothing while implying that it does. The first
delete command brings the flag back.

## Alternatives considered

**Print binary files anyway and let the terminal deal with it.** It is the caller's terminal, but it
is also an agent's context, and neither benefits.

**Base64-decode inside the client rather than in an operation.** The MCP tool wants the envelope
_and_ the text; the CLI wants the text and a header. Keeping the client's return shape identical to
GitLab's payload lets both compose what they need, and keeps `--json` honest about being the API's
answer.

**Give `commit create` a repeatable `--action` flag** parsed from `key=value` pairs. File content
containing `=` or a newline makes that ambiguous immediately, and the JSON form is what the API
takes anyway.

**Validate actions loosely and let GitLab decide.** GitLab does decide — this only moves the report
to somewhere the caller can act on it. Every rule checked here is one GitLab enforces.
