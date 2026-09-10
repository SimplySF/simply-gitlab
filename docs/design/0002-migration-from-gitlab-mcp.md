# 0002 — Migrating `gitlab-mcp` into a CLI, an MCP server, and a core library

**Status:** Implemented (PR #1)
**Package:** all three
**Date:** 2026-09-09

## Problem

The starting point was `@scope/gitlab-mcp`: a single package of plain `.mjs` files that registered
24 MCP tools against the GitLab REST API. Every tool was a thin `z.object(...)` schema wrapped
around one `gitlabApiRequest(method, path, options)` call, and that function was the whole
transport, the whole error handling, and the whole result formatting.

Three problems with it, in the order they bite:

1. **There is no way to use it from a terminal.** The only entry point is an MCP server on stdio.
   A person debugging a failed pipeline has to ask an agent to ask GitLab, which is a slow way to
   run `curl`.
2. **Failure is indistinguishable from success.** `gitlabApiRequest` returns a `CallToolResult` for
   every outcome, including transport failures, and the error text is a string that begins
   `GitLab API Error (Status 404)`. Nothing is typed, nothing carries an exit code, and nothing can
   be caught — a caller distinguishes an error from a result by reading English prose.
3. **Nothing is checked before the request.** A merge request iid, a commit action list, a project
   path — all go to GitLab as given, and GitLab's own errors name neither the field nor the index
   that was wrong.

Behind all three: the module reads `process.env.GITLAB_PERSONAL_ACCESS_TOKEN` and calls
`process.exit(1)` at import time, so the code cannot be loaded by anything that is not that server.

## Decision

Split it the way `simply-atlassian` is split, and for the same reason: one library package holding
the behaviour, and two thin surfaces over it.

| Package                        | What it is                                                             |
| ------------------------------ | ---------------------------------------------------------------------- |
| `@simplysf/simply-gitlab-core` | Config, auth, transport, the `GitLabClient`, operations, and rendering |
| `@simplysf/simply-gitlab`      | The `simply gitlab …` oclif CLI                                        |
| `@simplysf/simply-gitlab-mcp`  | The stdio MCP server, one tool per CLI command                         |

Both surfaces are closed allowlists — a CLI command declares its `flags`, an MCP tool declares its
`inputSchema` — so exposing a capability is a deliberate step in each. What they must not do is
implement anything: a rule that lives in a command cannot be reached by the server without a second
copy, and two copies of a rule drift.

Core never touches a terminal or a process. `process.env` is read only through an injectable `env`
parameter. The lint config enforces the import half of that (no oclif, no `child_process`).

## Behavior

### What was ported

22 of the original 24 tools, each becoming one core operation, one CLI command, and one MCP tool.

| Original tool                                                      | Command                                                             | Tool                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------- |
| `list_projects`, `get_project`                                     | `gitlab project list/view`                                          | `gitlab_project_list/view`       |
| `get_file`, `create_file`, `update_file`                           | `gitlab file view/create/update`                                    | `gitlab_file_view/create/update` |
| `list_branches`, `create_branch`                                   | `gitlab branch list/create`                                         | `gitlab_branch_list/create`      |
| `list_commits`, `get_commit`, `get_commit_diff`, `create_commit`   | `gitlab commit list/view/diff/create`                               | `gitlab_commit_*`                |
| `list_merge_requests`, `get_merge_request`, `create_*`, `update_*` | `gitlab mr list/view/create/update`                                 | `gitlab_mr_*`                    |
| `list_tags`                                                        | `gitlab tag list`                                                   | `gitlab_tag_list`                |
| `list_jobs`, `get_job_log`, `list_variables`, `list_environments`  | `gitlab ci job list/log`, `ci variable list`, `ci environment list` | `gitlab_ci_*`                    |
| `list_releases`                                                    | `gitlab release list`                                               | `gitlab_release_list`            |
| `search`                                                           | `gitlab search`                                                     | `gitlab_search`                  |

### What was not ported, and why

**`download_job_artifacts`.** The endpoint answers with a ZIP archive. The original tool passed
those bytes through `response.text()` and returned them as a `text` content block, which produces
mojibake in a terminal and megabytes of noise in an agent's context — it never worked. Doing it
properly means a `--output <path>` flag and a streamed write, which is a different shape from every
other command here and belongs in its own design.

**`render_markdown`.** `POST /markdown` renders GitLab-flavoured Markdown to HTML. It is not about
any project, it does not read or change anything, and neither a terminal nor an agent has a use for
the HTML. It was in the original because the OpenAPI generator emitted it.

### What changed in porting

These are behaviour differences from the original, each deliberate.

| Area               | Original                                                 | Now                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Search scoping     | `GET /search?project_id=…`                               | `GET /projects/:id/search`. GitLab's global endpoint has no `project_id` parameter, so the original's project and group narrowing silently did nothing — see [0006](0006-search.md). |
| Errors             | A string beginning `GitLab API Error (Status …)`         | Typed `ConfigError`/`AuthError`/`HttpError`/`NetworkError` with exit codes 2/3/1/1, mapped to a stable `code` on the MCP side                                                        |
| Retries            | None                                                     | 429 and 5xx retry with backoff, honouring a capped `Retry-After`; DNS and certificate failures do not retry                                                                          |
| Paging             | The caller passed `page` and `per_page` and got one page | Every list follows pages to a `--limit` and reports `complete: false` when the limit cut it short                                                                                    |
| Credentials        | Missing token called `process.exit(1)` at import         | A `ConfigError` from the operation that needed it, naming the variable and the flag                                                                                                  |
| Token in output    | Not considered                                           | Redacted from every message and response body, on both surfaces                                                                                                                      |
| Writes             | Always available                                         | Off by default on the MCP server; `GITLAB_READ_ONLY` refuses them on both                                                                                                            |
| Job traces         | Returned whole                                           | Last 200 lines by default, `--tail 0` for all of it                                                                                                                                  |
| CI variable values | Returned in clear text                                   | Hidden by default; `--reveal` on the CLI only — see [0005](0005-cicd-and-variable-values.md)                                                                                         |

### Configuration

`GITLAB_URL` (default `https://gitlab.com`) and `GITLAB_TOKEN`, or `--gitlab-url` and
`--gitlab-token`. This is a clean break from the original's `GITLAB_API_URL` and
`GITLAB_PERSONAL_ACCESS_TOKEN`: an existing MCP client configuration has to be updated, and gets a
`ConfigError` naming the new variable rather than a silent fall back to gitlab.com with no token.

## Alternatives considered

**Keep it as one MCP package and just add a CLI to it.** The CLI and the server want different
things from the same code — one wants a table and an exit code, the other wants raw JSON and a tool
result — and both would have ended up in the same file. It also leaves core's no-terminal rule
unenforceable, because there would be no package boundary to enforce it at.

**Port it as-is and improve it later.** The original returns `{content: [...], isError: true}` from
the one function that makes every request. Threading typed errors through afterwards means changing
every call site anyway, so there is no saving — only a released version whose contract we would then
break.

**Generate the client from GitLab's OpenAPI spec**, as the original was. The spec is enormous, its
generated names are not the names anyone uses (`ApiV4ProjectsIdMergeRequestsMergeRequestIidGet`), and
the value in this package is the part a generator cannot produce: which errors are worth explaining,
which values must never be printed, and when a partial answer must say so.

**Keep `GITLAB_PERSONAL_ACCESS_TOKEN`.** It is what the original used and what GitLab's own docs
show. It also does not match `*_URL`/`*_TOKEN`, the shape every other SimplySF CLI uses, and the
migration is one line in a config file.

## Implementation plan

1. `simply-gitlab-core`: errors, text, config, auth, http, env-file, redaction, write-safety.
2. `simply-gitlab-core`: `GitLabClient`, then the operations and the table column sets.
3. `simply-gitlab`: `GitLabCommand`, then the 22 commands.
4. `simply-gitlab-mcp`: context, server, and the 22-tool catalogue.
5. Tests at each layer; the tool catalogue is cross-checked against the CLI's `command-snapshot.json`
   so a command with no tool fails CI.
