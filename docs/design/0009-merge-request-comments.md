# 0009 — Merge request comments

**Status:** Draft
**Package:** all three
**Date:** 2026-10-13

## Problem

[0004](0004-merge-requests.md) covers a merge request's own fields: its title, description, labels,
and state. It does not cover the conversation underneath it. Someone working on a merge request
from the terminal cannot answer a question, leave a status note, or fix a typo in a comment they
left. An agent driving the MCP server has it worse. It can open a merge request and push to it, but
it cannot say anything on it.

GitLab calls these _notes_. The REST API for them is small, but it has three traps that a direct
port would ship:

1. **A comment can run commands.** GitLab reads a line starting with `/` as a
   [quick action](https://docs.gitlab.com/ee/user/project/quick_actions.html), runs it, and removes
   it from the posted text. `/merge`, `/close`, `/approve`, `/assign_reviewer`, `/label` and dozens
   of others all work through `POST .../notes`. That endpoint even takes a
   `merge_request_diff_head_sha` parameter, which exists for `/merge`. 0004 deliberately ships no
   merge command, but a comment endpoint that passes text through unchanged is a merge command with
   extra steps. It is also the most likely place for that text to come from something nobody
   checked: an agent quoting a review, or a template file.
2. **A retried create can post the comment twice.** The transport retries 5xx responses and
   transient socket failures on every call, POST included ([0001](0001-gitlab-client-core.md)).
   The existing creates mostly protect themselves: a second `mr create` for the same branches gets
   a 409, and a second `branch create` is told the branch exists. A note has no natural key. If a
   proxy returns 502 after GitLab has already saved the comment, the retry posts a second copy, and
   everyone subscribed gets notified twice.
3. **Most of a merge request's notes are not comments.** "added 3 commits", "approved this merge
   request", and "changed the description" are all notes with `system: true`, and they share the
   comments' endpoint and pagination. A list of 20 notes on a busy merge request can easily hold
   zero things a person wrote.

## Decision

Add a new subtopic, `gitlab mr comment`, with three commands (`list`, `create`, and `update`) and
the matching MCP tools `gitlab_mr_comment_list/create/update`. The behavior lives in a new core
module, `merge-request-comments.ts`, and in two shared changes that this doc introduces:

- **`assertNoQuickActions`** refuses comment text that GitLab would run as a quick action. It is
  applied on create and update, on both surfaces, and cannot be overridden.
- **A `replayable: false` call option** on the transport limits a POST to retries that are known
  not to have reached GitLab. Comment create uses it.

**Deleting a comment is out of scope.** It would be the first command in the CLI that destroys data
with no way back, and the repo has already said what that command brings with it. The `writeFlags`
comment in `base-command.ts`, the `ToolKind` comment in the MCP `tools.ts`, and the write-safety
guide each say that the first irreversible command brings `--confirm` and a `destructive` tool kind
with it. That is a bigger decision than comments, and it deserves its own design rather than
arriving as part of this one. Those three statements stay true after this doc ships. See
[Open questions](#open-questions).

The scope is top-level comments, plus editing any comment by id. Thread replies, resolving threads,
comments on diff lines, and draft review comments are also out of scope; see
[Alternatives considered](#alternatives-considered) and [Open questions](#open-questions).

## Behavior

### Naming

The subtopic is `comment`, not `note`. "Comment" is the word the GitLab UI uses, and the word a
caller will reach for. "Note" is GitLab's internal term, and it also covers system notes, which
these commands never create. Payloads still use GitLab's field names (`id`, `body`, `system`),
because API objects are written the way the wire writes them.

`update` rather than `edit`, to match `mr update` and `file update`.

### Addressing a comment

| Flag / input            | Meaning                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `--project`             | As everywhere: an id, or a full path, which the client URL-encodes                          |
| `--mr`                  | The merge request's **iid**, checked by `assertIid` exactly as in 0004                      |
| `--comment` (`comment`) | The note's `id`: the number after `#note_` in the comment's link, and `id` in `list --json` |

A note `id` is unique across the whole instance, not per project. GitLab still requires the merge
request in the route (`/projects/:id/merge_requests/:iid/notes/:note_id`) and looks the note up
among that merge request's notes. So a note id from a different merge request should return 404
rather than edit someone else's comment. That is the opposite of the `iid`/`id` trap, and it is why
`--mr` stays required even though the note id alone is unique. _(Confirm against an instance during
implementation, and record what was observed here. If GitLab turns out to resolve the note
globally, `update` must GET the note first and compare `noteable_iid`.)_

`assertCommentId` accepts a positive whole number or a numeric string. Its error names where the
number appears:

> A comment is addressed by its id: a positive whole number, got "note_123". It is the number after
> "#note_" in the comment's link, and the "id" field of `gitlab mr comment list --json`.

### Comment text

`create` and `update` take the text from `--message` or `--message-file`, which are mutually
exclusive. The MCP tools take a `message` string. The name follows `glab mr note --message`. It
cannot be `--body`, because across this CLI `--body` already means a raw JSON request body, and
reusing the name for something else is a trap of its own.

The text is checked before any request is made, in this order:

1. **Not empty.** Text that is empty or only whitespace is refused, and the refusal names the flag.
   GitLab's own answer is `{"message":{"note":["can't be blank"]}}`, which names the field as
   `note` even though the parameter is called `body`.
2. **No quick actions.** A line counts as a quick action if, after any leading spaces or tabs, it
   starts with `/`, then a word made of lowercase letters and underscores, then whitespace or the
   end of the line (`/^[ \t]*\/[a-z_]+(?=\s|$)/m`). The refusal names the first such line and
   explains why:

   > Line 3 starts with "/merge", which GitLab would run as a quick action instead of posting it
   > as text. This command does not send quick actions. To post the text itself, wrap it in
   > backticks (`` `/merge` ``).

   The pattern is deliberately looser than GitLab's. It does not try to keep GitLab's list of
   quick-action names, because that list grows with every release and differs by tier. It also
   does not skip fenced code blocks or block quotes, even though GitLab probably does. A false
   positive costs the caller one clear error, while a false negative can merge or close someone's
   work. Paths do not match, because `/usr/bin` continues with `/` rather than whitespace. A line
   such as `/etc is full` does match, and that is the price of the rule.

The same check runs on `update`. Whether GitLab runs quick actions when a note is edited is
undocumented _(confirm)_. Applying the check either way costs nothing and saves anyone from having
to find out.

### `mr comment list`

`GET /projects/:id/merge_requests/:iid/notes`, read-only.

| Flag               | Default | Meaning                                                                                      |
| ------------------ | ------- | -------------------------------------------------------------------------------------------- |
| `--limit`          | 20      | Comments to return across all pages                                                          |
| `--sort`           | `desc`  | `asc` or `desc` by creation time. GitLab's default, so a limit returns the _latest_ comments |
| `--include-system` | off     | Also return system notes ("added 3 commits", "approved")                                     |

System notes are filtered out on our side _(confirm that the REST notes endpoint still has no
server-side filter)_. For the filter to work, `collect` gains an optional `keep` predicate:

- The limit counts **kept** items, so `--limit 20` means 20 comments, not 20 notes of which three
  were comments.
- While a predicate is set, `per_page` is always 100, because the ratio of kept to fetched notes is
  unknown.
- `total` is reported as `undefined`, because GitLab's `X-Total` counts system notes and "Showing 5
  of 112" would be wrong. `complete` keeps its meaning, and `MAX_PAGES` still applies.

The table has five columns: **ID** (what `update` takes), **AUTHOR**, **CREATED**, **TYPE**, and
**BODY**.

- **TYPE** is `comment` for a plain note, `thread` for a `DiscussionNote`, `diff` for a `DiffNote`,
  and `system` for a note with `system: true`.
- **BODY** is the first line of the comment, cut at 80 characters with an ellipsis. It is printed
  through `logSafe` as the last column.

`--json` returns the raw `ListResult`.

The tool description and the command description both say that comment text is **untrusted**. It
reaches further than any other text this CLI reads: on a public project, any signed-in GitLab user
can comment, not only people who can push. The `mr_view` tool already warns that an MR title and
description are data, not instructions. The comment tools carry the same warning, more strongly.

### `mr comment create`

`POST /projects/:id/merge_requests/:iid/notes` with `{ "body": <message> }`. This is a write
(`isWrite = true`), so `GITLAB_READ_ONLY` refuses it.

- `--dry-run` prints the request body and sends nothing, as every write command does.
- On success it prints `Created: comment <id> on !<iid>`, the author, and the time. `--json`
  returns the note payload.
- No URL is printed, because the notes payload does not include one _(confirm)_. Building
  `<mr web_url>#note_<id>` would cost an extra GET per create. See
  [Open questions](#open-questions).
- The call is sent with `replayable: false` (see [Retries](#retries)).

There is no raw `--body`/`--body-file`. The endpoint has almost nothing a caller could add:
`created_at` is admin-only, and `merge_request_diff_head_sha` exists only for `/merge`, which is
refused anyway. Having one less flag is better than having one that does nothing useful.

### `mr comment update`

`PUT /projects/:id/merge_requests/:iid/notes/:note_id` with `{ "body": <message> }`. The new text
**replaces** the comment's whole body; nothing is appended. The description says so.

- A message is required, so an empty update cannot be sent. 0004's rule that "an update naming
  nothing is refused" holds without needing a separate check.
- GitLab lets only a comment's author edit it _(confirm whether an admin can edit someone else's
  comment)_. The 403 the transport raises already says "your role on the project may not permit
  this", which is close enough that this doc adds no special case.
- There is no optimistic-concurrency guard, because the endpoint has no equivalent of
  `--last-commit-id`. The last writer wins, and the description says that too.
- Replacing a comment's text is not a way to take it back. GitLab keeps no edit history visible
  through this API, but notification emails for the original have already gone out. The description
  does not suggest `update` as a substitute for deleting.
- PUT with the same body is idempotent, so `update` keeps normal retries.

### Retries

`JsonCall` gains `replayable?: boolean`, which defaults to `true` so every existing call keeps its
current behavior. A call with `replayable: false` is retried only when the request provably never
reached GitLab:

| Outcome                                   | `replayable` (today) | `replayable: false`                                      |
| ----------------------------------------- | -------------------- | -------------------------------------------------------- |
| 429                                       | retry                | retry: GitLab rejected the request without processing it |
| `ECONNREFUSED`                            | retry                | retry: the request was never sent                        |
| 5xx, `ECONNRESET`, other transient errors | retry                | **raise**, with a hint (below)                           |

The hint is added to the existing error message, and the command fills in the noun:

> The comment may have been posted anyway. Run `gitlab mr comment list` before trying again.

Whether the other non-idempotent writes (`mr create`, `commit create`, `project create`) should also
switch to `replayable: false` is left open. This doc adds the option and uses it only for comment
create.

### MCP surface

| Tool                       | Kind    | Inputs                                            |
| -------------------------- | ------- | ------------------------------------------------- |
| `gitlab_mr_comment_list`   | `read`  | `project`, `mr`, `limit`, `sort`, `includeSystem` |
| `gitlab_mr_comment_create` | `write` | `project`, `mr`, `message`, `dryRun`              |
| `gitlab_mr_comment_update` | `write` | `project`, `mr`, `comment`, `message`, `dryRun`   |

The CLI's `--message-file` has no MCP equivalent, just as `--content-file` has none for `file
create`. Reading local files is a convenience of the CLI, not a capability the MCP server lacks, so
this does not count as a second parity exception alongside `--reveal`.

No new tool kind is needed. Both write tools get the existing `write` annotations and are registered
only under `--allow-writes`.

## Alternatives considered

**Include `mr comment delete` now.** The first draft of this doc did, with `--confirm`, a
`destructive` MCP tool kind, and a GET before the delete so the deleted text was printed. It was
dropped from this doc. The commitments it carries (the first `--confirm`, the first destructive
tool, and whether destructive tools need their own server gate) apply to every future delete, not
just comments, so they should be decided once, in their own design. Create and update are useful
without delete, and nothing in this doc makes delete harder to add later.

**Pass quick actions through, documented.** This is what GitLab's UI does, and what `glab` does.
Here it would make 0004's decision not to ship a merge command meaningless: one `mr comment create
--message "/merge"` would bypass it. The text a comment command posts is also usually written by
someone else, such as a quoted review or a template, or produced by an agent from what it read.

**Refuse quick actions by default, with `--allow-quick-actions` to opt in.** This was considered
seriously. The CLI flag is reasonable for a person. The MCP version, an `allowQuickActions` input,
would let any agent with `--allow-writes` merge, approve, or reassign through a comment, so the
input would have to be left off the MCP side. That would be a second deliberate parity exception
next to `--reveal`, and it would need a test pinning it. Leaving the flag off both surfaces costs
less. Each quick action worth having should get a typed flag (`mr update --labels` already covers
`/label`) or its own design, as merging has. This is listed under [Open questions](#open-questions)
in case a real need appears.

**Escape quick actions instead of refusing them**, for example by prefixing the line with a
zero-width character or a backslash. This changes what the caller wrote without telling them, and
whether GitLab's Markdown renders the escape invisibly differs between versions. A refusal tells
the caller what is happening; a silent rewrite does not.

**Use the discussions API for everything.** `POST .../discussions` creates a thread that can be
replied to and resolved. It would make replies and resolving natural, and it is the only way to
comment on a diff line. The cost is a second id (the 40-character `discussion_id`) alongside the
note id. `list` would also have to page by discussion rather than by note, so `--limit` would count
threads. The notes API addresses every note, including replies and diff comments, by one integer,
which is enough for create and update. Threads should get their own design, which can build on this
one.

**Call it `gitlab mr note`.** That matches the API, but it fits less well with a subtopic that never
creates system notes, and it is not the word anyone uses in the UI.

**Accept the comment's full URL or `note_123` for `--comment`.** It is friendlier to paste, but it
gives one flag several input formats, and a URL brings in a project and an iid that could disagree
with `--project` and `--mr`. The error message tells the caller where to find the number instead.

**Make every POST non-replayable now.** This is probably right eventually, but it changes the
behavior of seven shipped commands as a side effect of a comments feature. It belongs in its own
change, with its own testing of what each endpoint does on a duplicate.

## Implementation plan

1. **Core: transport.** Add `replayable?: boolean` to `JsonCall` in `http.ts`. Change `send`/`triage`
   so that a non-replayable call retries only 429 and `ECONNREFUSED`, and otherwise raises with an
   `ambiguous` marker that callers can turn into a hint. Leave `GitLabClient.request` and its
   callers unchanged.
2. **Core: paging.** Add an optional `keep` predicate to `collect` in `gitlab-client.ts`, with the
   limit, `per_page`, and `total` rules described above.
3. **Core: client methods.** In `gitlab-client.ts`, under "Merge requests", add
   `listMergeRequestNotes(project, iid, { sort, includeSystem }, limit)`,
   `createMergeRequestNote(project, iid, body)` (with `replayable: false`), and
   `updateMergeRequestNote(project, iid, noteId, body)`. Every route goes through
   `segment(project)`.
4. **Core: `merge-request-comments.ts`.** Add `assertCommentId`, `assertNoQuickActions`, and
   `buildCommentBody(message)` (empty check, then quick-action check, returning `{ body }`). Export
   them from `index.ts`.
5. **Core: `tables.ts`.** Add `commentColumns`, with the TYPE mapping and the BODY first-line
   truncation.
6. **CLI.** Add the commands under `src/commands/gitlab/mr/comment/`: `list.ts`, `create.ts`, and
   `update.ts`. All untrusted text goes through `logSafe`. `writeFlags` and its doc comment in
   `base-command.ts` are unchanged.
7. **MCP.** In `tools.ts`, add a shared `comment` schema block (worded like `mr`) and a `message`
   block, then add the three tools after `gitlab_mr_update`. `ToolKind`, `ANNOTATIONS`, and
   `selectTools` are unchanged.
8. **Docs.** Run `pnpm run build` (regenerates `command-snapshot.json`) and `pnpm run readme` in
   `packages/simply-gitlab`, and commit both. Update `packages/simply-gitlab/docs/guides/write-safety.md`:
   change the count from seven commands that change data to nine, and add a section on quick
   actions. Update the count of write tools ("the seven") and the tool list in
   `packages/simply-gitlab-mcp/docs/guides/mcp-server.md`. Add this doc's row to the index in
   `docs/design/README.md` and an entry in `AGENTS.md`. Add a one-line forward reference from
   0004's "no merge command" paragraph to the quick-action rule here.

## Testing

**Core (`packages/simply-gitlab-core/test/`, alongside the existing merge-request cases in
`operations.test.ts` and `safety.test.ts`)**

- `assertNoQuickActions`:
  - Refuses `/merge`, `  /close`, `/label ~bug`, and a quick action on line 3 of 5, naming the line
    number and the command.
  - Refuses one inside a fenced code block. This is pinned deliberately, so that skipping fences
    later is a visible decision.
  - Allows `/usr/bin/env`, `see /merge`, `` `/merge` ``, `https://x/merge`, and `/Merge` (GitLab's
    names are lowercase).
- `buildCommentBody`: refuses empty and whitespace-only text, naming the flag. Runs the empty check
  before the quick-action check. Returns exactly `{ body }`.
- `assertCommentId`: accepts `123` and `"123"`. Rejects `0`, `-1`, `1.5`, and `"note_123"`, with
  the `#note_` wording.
- Client routes: each method hits the encoded path (`group%2Fproject`) with the right method.
  Create sets `replayable: false`, and update does not.
- `collect` with `keep`:
  - The limit counts kept items across pages.
  - `total` is undefined while filtering.
  - `complete: false` when the limit is reached mid-page.
  - `per_page` is 100.
- Transport, with `replayable: false`:
  - A 502 is raised after one attempt with the ambiguous marker.
  - A 429 is retried, honoring `Retry-After`.
  - `ECONNREFUSED` is retried.
  - `ECONNRESET` is raised.
  - With the default, a 502 is still retried, so nothing about existing calls changed.

**CLI (`packages/simply-gitlab/test/commands/gitlab/mr.test.ts`, or a new `mr-comment.test.ts`)**

- `create --dry-run` prints `{ "body": ... }` and sends nothing. `--message` together with
  `--message-file` is a usage error.
- `update` without a message is a usage error. With one, it sends a PUT to the note's route.
- `list` hides system notes by default and shows them with `--include-system`. A body containing an
  escape sequence is printed stripped.
- `GITLAB_READ_ONLY=1` refuses `create` and `update`, and allows `list`. This extends the existing
  case in `safety.test.ts`.

**MCP (`packages/simply-gitlab-mcp/test/`)**

- `tools.test.ts`: extend "marks exactly the commands that change data as writes" with
  `gitlab_mr_comment_create` and `gitlab_mr_comment_update`. The existing `dryRun` assertion and the
  catalogue/snapshot cross-check cover the new tools automatically.
- `server.test.ts`: without `--allow-writes`, only `gitlab_mr_comment_list` of the three is
  registered.

## Open questions

- **Deleting comments.** This is deferred to a design of its own, which should settle what every
  future delete needs:
  - the shape of `--confirm`
  - a `destructive` MCP tool kind and its annotations
  - whether destructive tools get their own server flag (`--allow-deletes`) or come in under
    `--allow-writes`. The case for a separate flag is prompt injection: a comment that says "delete
    the review comments above", read by an agent holding a Maintainer token, could erase a review
    record.

  The first draft of this doc proposed fetching the note before deleting it, so the deleted text is
  printed and `--dry-run` has something to show. That idea should carry over.

- **An override for quick actions.** None is proposed (see Alternatives). Revisit only for a
  specific quick action that someone needs and that has no typed equivalent.
- **Thread replies, resolving threads, and diff-line comments.** These are deferred to a follow-up
  design on the discussions API. Replies are the most likely to be needed soon, because answering a
  review comment in its thread is the common case. The follow-up should decide whether `list` grows
  a threaded view or a new `mr discussion list` appears.
- **Internal (confidential) comments.** Recent GitLab versions accept `internal: true` on some note
  endpoints _(confirm whether that includes merge request notes, and from which version)_. If it
  does, `--internal` is a one-line addition, but it needs a sentence on what happens on an instance
  too old to know the parameter.
- **A link to the created comment.** Printing `<mr web_url>#note_<id>` costs one GET per create.
  Building the link from the configured URL and `--project` only works when the project was given as
  a path. Leaving it out is the default.
- **Mentions.** `@all` and `@here` in a comment notify everyone on the project. They are not refused
  here, because a mention is visible in the text the caller wrote, unlike a quick action, which runs
  silently. Revisit if agent use shows that it matters.
- **`replayable: false` for the other creates.** See Alternatives. This should be its own change.
