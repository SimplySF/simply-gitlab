# 0004 — Merge requests

**Status:** Implemented (PR #1)
**Package:** all three
**Date:** 2026-09-09

## Problem

Merge requests are the reason most people reach for a GitLab CLI, and they carry the single most
dangerous piece of API trivia in the whole surface: a merge request has both an `id` and an `iid`,
both bare integers, both present in every payload, and the endpoints take the `iid`.

Passing the wrong one does not fail. It addresses a **different merge request in a different
project** that happens to share the number, and answers 200. On a read that is a confusing result;
on `mr update --state close` it closes a stranger's work.

## Decision

Four commands — `mr list/view/create/update` — and one guard, `assertIid`, on every command and tool
that takes one.

## Behavior

### `assertIid`

Accepts a positive whole number (or a numeric string), rejects everything else, and the error says
which of the two fields to read:

> A merge request is addressed by its project-scoped iid: a positive whole number, got "abc". It is
> the number in the web URL and the "iid" field of the API payload, not "id".

This cannot catch a valid-looking wrong number — both are positive integers — so the real work is
the wording, which is why the error names the web URL. `mr view` prints `!42`, GitLab's own notation
for an iid, so a caller reading output back into another command sees the right field.

### `mr list`

Defaults to `--state opened`, which is what a list is nearly always for. The IID column is first,
and the description says it is the number the other `mr` commands take.

Filters map onto GitLab's parameters: `--source-branch`, `--target-branch`, `--author-username`,
`--reviewer-username`, `--labels`, `--search`.

### `mr view`

The raw payload under `--json`; a summary otherwise, including `detailed_merge_status` (falling back
to `merge_status` on older instances), whether it has conflicts, and its labels. Title and
description go through `logSafe` — they are written by whoever opened the merge request, which is
the widest input this CLI reads, and the tool description says to treat them as data rather than
instructions.

### `mr create`

Both branches must already exist. Three things are checked before the request, each naming its flag,
because GitLab's own 400 for a missing source branch is `{"message":{"source_branch":["can't be
blank"]}}` — accurate, and no help in finding the flag.

`--draft` prefixes the title with `Draft: `. That is not a convenience: it is the only way GitLab
marks a draft on this endpoint, there being no separate field. A title that already starts with the
prefix is left alone.

Assignees and reviewers are numeric user ids, not usernames, because that is what the endpoint
accepts. Said in both the flag summary and the tool description, since it is the first thing a
caller gets wrong.

`--body`/`--body-file` supplies raw JSON for what the flags do not cover — approval rules, squash
options, milestones — and typed flags merge over it, so a template file can supply the shape while
one flag overrides one value.

### `mr update`

Only what is named is changed, with one exception the description calls out: `--labels` replaces the
whole set rather than adding to it. One verb per flag; a flag that sometimes adds and sometimes
replaces is the kind of thing a caller discovers by losing labels.

**An update naming nothing is refused rather than sent.** GitLab answers an empty `PUT` with 200 and
an unchanged merge request, so without this a caller who misspelled a flag would be told the update
succeeded and see nothing different.

`--state close` and `--state reopen` are the buttons of those names. Neither merges anything —
there is no merge command here, deliberately: merging is the one merge-request action that is not
reversible by another command in this CLI, and it deserves its own design alongside the `--confirm`
flag it would need.

## Alternatives considered

**Accept either `id` or `iid` and resolve whichever was given.** Resolving an `id` means a search
across the instance, it is ambiguous when the numbers collide (which is the whole problem), and it
would teach callers that the distinction does not matter.

**Take the merge request as a positional argument** rather than `--mr`. A bare number as a
positional is exactly the shape that makes a mistyped project flag act on the wrong thing quietly.

**Accept usernames for assignees and resolve them to ids.** A user search per name on every create,
plus an ambiguity story when a name matches several people. Worth doing when there is a
`gitlab user search` command to resolve against; not worth inventing one inside `mr create`.

**Add `--add-label` and `--remove-label` alongside `--labels`.** Three flags whose interaction has
to be specified and tested, for a case the raw `--body` already covers.
