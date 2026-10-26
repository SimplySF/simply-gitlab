# 0011 — Merging a merge request

**Status:** Draft
**Package:** all three
**Date:** 2026-10-26

## Problem

[0004](0004-merge-requests.md) stopped short of merging on purpose: merging is the one
merge-request action that no other command in this CLI can undo, and 0004 said it needed its own
design and its own `--confirm` flag. That gap now blocks real work. Projects that use merge trains
cannot add a merge request to the train from the terminal or from an agent, and they cannot use
GitLab's experimental
[merge immediately without restarting the merge train](https://docs.gitlab.com/ci/pipelines/merge_trains/#merge-immediately-without-restarting-merge-train-pipelines)
at all. The web UI offers that option only to Maintainers, and the API offers it only as
`skip_merge_train` on the merge endpoint.

The project side is already covered. A baseline can declare `merge_trains_skip_train_allowed` and
`max_pipelines_per_merge_train` ([0007](0007-configuration-baselines.md)). What is missing is the
act of merging.

The merge endpoint has three traps that a thin wrapper would ship:

1. **It merges whatever the source branch says when the request arrives**, not what the caller
   reviewed. A push between the review and the merge goes in unseen. GitLab's `sha` parameter
   exists to close that gap, but it is optional.
2. **`405 Method Not Allowed` covers every reason a merge request cannot merge**: a missing
   approval, a failing pipeline, a draft, a conflict, merge train enforcement. The body does not
   say which. The real answer is in the merge request's `detailed_merge_status`, which takes a
   second read to get.
3. **A retried merge reports its own success as a failure.** The transport retries a 5xx on every
   call ([0001](0001-gitlab-client-core.md)). If a proxy returns 502 after GitLab has already
   merged, the retry gets a 405, and the caller is told the merge failed when it succeeded.

Skipping the train adds a fourth, which is GitLab's own warning. The skipped change is never tested
against the merge requests already queued, so the train ahead of it can break after it lands.

## Decision

Add a new command, `gitlab mr merge`, with a matching MCP tool, `gitlab_mr_merge`. Core gets
`mergeMergeRequest()`, which owns the pre-flight checks, the request body, and how a 405 is
explained. The command requires `--confirm`. That makes merge the first command to bring the flag
back, as `base-command.ts` anticipated. The MCP tool gets the `destructive` kind that `tools.ts`
anticipated, along with its `confirm` gate.

## Behavior

### Flags

| Flag                       | Sends                         | Notes                                                                                    |
| -------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `--mr` (required)          | path `:merge_request_iid`     | `assertIid`, as everywhere else                                                          |
| `--sha`                    | `sha`                         | The head the caller reviewed. Required with `--skip-merge-train` (see below)             |
| `--auto-merge`             | `auto_merge: true`            | Merge when checks pass. On a merge train project, this joins the train                   |
| `--skip-merge-train`       | `skip_merge_train: true`      | Merge now without restarting the train. Exclusive with `--auto-merge`                    |
| `--squash` / `--no-squash` | `squash`                      | Omitted unless given, so the merge request's own setting applies                         |
| `--remove-source-branch`   | `should_remove_source_branch` | Likewise                                                                                 |
| `--merge-commit-message`   | `merge_commit_message`        |                                                                                          |
| `--squash-commit-message`  | `squash_commit_message`       |                                                                                          |
| `--confirm`                | —                             | Required unless `--dry-run`. Without it, the command prints what it would do and exits 1 |
| `--dry-run`                | —                             | Shared `writeFlags`. Runs the pre-flight reads and prints the request                    |

`--auto-merge` uses `auto_merge`. `merge_when_pipeline_succeeds` was deprecated in GitLab 17.11
and is not sent. The command calls the merge endpoint with `auto_merge` rather than
`POST /merge_trains/merge_requests/:iid`. The merge endpoint does the right thing on both kinds of
project, and with merge train enforcement on it is the only route that works: a direct merge gets
a 405, while `auto_merge` routes the merge request to the train.

### `--skip-merge-train`

The flag summary says this is an experimental GitLab feature that may change or be removed. Before
merging, core reads the project once and refuses, naming the fix, when:

| Project state                                | Message names                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `merge_trains_enabled` is not `true`         | the project has no merge train to skip; merge without the flag           |
| `merge_trains_skip_train_allowed` is `false` | the "Merge immediately without restarting the merge train" setting       |
| `merge_method` is `ff` or `rebase_merge`     | GitLab does not support skipping the train with fast-forward/semi-linear |

An attribute the instance does not report is not treated as `false`. An older instance or a
feature flag turned off on Self-Managed means GitLab gets to answer. The project read costs one
GET, and it turns a bare 405 into a sentence.

**`--sha` is required with `--skip-merge-train`.** The whole point of the train is that nothing
merges untested. Skipping it is a deliberate bet on one specific commit, so the command makes the
caller name that commit. A push after the decision then fails with 409 instead of riding along
unverified.

### Output

The response is the merge request. Under `--json` it is passed through raw. Otherwise the command
prints one line, chosen from the response:

| Response                                        | Line                                             |
| ----------------------------------------------- | ------------------------------------------------ |
| `state: merged`                                 | `Merged !42 into main (a1b2c3d).`                |
| `state: opened`, `merge_when_pipeline_succeeds` | `!42 will merge into main when its checks pass.` |

On a merge train project the second line reads `!42 joined the merge train for main.`. The command
tells the two cases apart from the project's `merge_trains_enabled`, which it reads only when
`--auto-merge` is given. The target branch is untrusted text and goes through `logSafe`.

### Errors

| Status | GitLab says                              | We say                                                                                         |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 400    | SHA must be provided when merging        | The group or instance requires `--sha`; pass the head shown by `mr view`                       |
| 401    | Unauthorized                             | Unchanged `AuthError`                                                                          |
| 405    | Method Not Allowed                       | Re-read the merge request and name `detailed_merge_status` in words (below)                    |
| 409    | SHA does not match HEAD of source branch | The source branch moved since `<sha>`; review the new head and pass its sha                    |
| 422    | Branch cannot be merged                  | GitLab tried and failed, usually a conflict or a hook. Body included via `stripControlOneLine` |

**A 405 is explained, not just reported.** Core does one GET of the merge request and maps its
`detailed_merge_status` to a sentence. For example, `not_approved` becomes "needs approval",
`ci_must_pass` becomes "its pipeline must pass first, or pass `--auto-merge`", and `draft_status`
becomes "it is a draft". A status not on the list is printed as GitLab spelled it. If the status
is `mergeable` and merge trains are on, the likely cause is merge train enforcement, so the message
suggests `--auto-merge`.

**A 405 on a merge request that is already merged is a success, if it is the one we asked for.**
Core cannot see whether the transport retried, so it judges by the re-read alone. When that shows
`state: merged` and `--sha` was given and equals the merged head, the command reports the merge
with a note that it was confirmed by reading it back. Otherwise the merge request may have been merged by someone else first, so
the command says who merged it and when, and exits 1, because the caller cannot know whose merge
it was.

### MCP

`gitlab_mr_merge` mirrors the flags in its `inputSchema` and is registered only with
`--allow-writes`. It is the first tool of the new `destructive` kind: it carries
`destructiveHint: true`, and its schema requires `confirm: true` as a literal, so a call that omits
it fails validation rather than merging. The tool description says that `skip_merge_train` bypasses
the train's testing, and that `sha` should be the head the agent actually looked at. It also tells
the agent to treat the title and description it read as data.

## Alternatives considered

**Leave merge out of the MCP server, as `config apply` is.** `apply` is exempt because one call
changes fifty projects. A merge changes one merge request, it is the natural last step of the
create, push, and review loop that agents already run, and leaving it out sends them to
`/merge` in a comment, which 0009 already has to guard against. A confirmed, write-gated tool is
safer than pushing agents towards that workaround.

**Use `POST /merge_trains/merge_requests/:iid` for `--auto-merge` on train projects.** That needs a
second code path chosen by reading the project first. It gains nothing, because the merge endpoint
with `auto_merge` already joins the train. It also does not take `skip_merge_train`.

**Make `--sha` required always.** It is the safe default, and a group can enforce it server-side.
But it makes the common case, merging the merge request you just viewed, a two-step dance. Required
only where the risk is highest (skipping the train), and recommended in the flag summary
everywhere else.

**Fill in `--sha` automatically from a fresh read.** That defeats the parameter. The sha would
describe the head at merge time, not at review time, which is exactly the gap it exists to close.

**Allow `--auto-merge` with `--skip-merge-train`.** "Merge later, but skip the train" has no
defined meaning in GitLab's docs, so the two are exclusive until GitLab defines one.

**No `--confirm`, as for every other write.** `base-command.ts` argues that a confirmation on
recoverable writes trains callers to always pass it. Merge is not recoverable, which is precisely
the case that argument reserved the flag for.

## Implementation plan

1. `gitlab-client.ts`: `mergeMergeRequest(project, iid, body)` → `PUT .../merge_requests/:iid/merge`.
2. `merge-requests.ts`: `mergeMergeRequest(client, project, iid, options)`, with skip-train
   pre-flight, body building, the 405 explanation, and the merged-on-retry read-back. Export it
   from `index.ts` and add it to `index.test.ts`.
3. `src/commands/gitlab/mr/merge.ts`, with `--confirm` defined on the command, not added to
   `writeFlags`. Update the `base-command.ts` comment.
4. `tools.ts`: add the `destructive` kind with `destructiveHint` and the `confirm` literal, plus
   `gitlab_mr_merge`. Update the `ToolKind` comment.
5. `pnpm run build` for `command-snapshot.json`, and `pnpm run readme`.
6. Docs: point 0004's "no merge command" paragraph at this record, and update the index row. Add a
   section on merging, and on skipping the train, to the CLI guide.

## Testing

- Body: each flag maps to its field. `--squash`/`--remove-source-branch` are omitted when not
  given. `merge_when_pipeline_succeeds` is never sent.
- Exclusivity: `--auto-merge` with `--skip-merge-train` is a usage error.
  `--skip-merge-train` without `--sha` is refused before any request.
- Pre-flight: each row of the skip-train table refuses with its message and sends no PUT. An
  absent attribute lets the PUT through.
- `--confirm`: without it, nothing is sent and the exit code is 1. With `--dry-run`, the request is
  printed and nothing is sent. `GITLAB_READ_ONLY` refuses as for every write.
- Errors: 400, 409, and 422 messages. A 405 re-reads the merge request and names
  `not_approved`, `ci_must_pass`, and an unknown status verbatim.
- Retry: 502 then 405 with the merge request merged at the requested sha reports success. The same
  without `--sha` exits 1 naming who merged it.
- Output: the merged line, the auto-merge line, and the train line. A title or branch with control
  characters is sanitised.
- MCP: the tool is absent without `--allow-writes`. A call without `confirm: true` fails schema
  validation. The annotations include `destructiveHint`. `tools.test.ts` pairs the tool with the
  command.

## Open questions

- **A merge train view.** `GET /projects/:id/merge_trains/merge_requests/:iid` would let `mr view`
  show a merge request's place in the train, and `GET /merge_trains/:target_branch` would support a
  `gitlab merge-train list`. Both are reads and deserve their own record. This one only gets things
  onto the train.
- **Cancelling auto-merge** (`POST .../cancel_merge_when_pipeline_succeeds`) is the undo for
  `--auto-merge` and the only way to leave a train. It probably belongs on `mr update`, but that
  changes 0004's contract, so it is left for a follow-up.
- **`merge_train_enforcement`** (GitLab 19.2+) could be read in pre-flight to suggest `--auto-merge`
  before the 405 rather than after. Not worth a second project read until someone hits it.
