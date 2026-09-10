# 0006 — Search across three endpoints

**Status:** Implemented (PR #1)
**Package:** all three
**Date:** 2026-09-09

## Problem

Searching GitLab looks like one operation and is three, with two failure modes that both look like
"no results".

**It is three endpoints.** `GET /search`, `GET /groups/:id/search`, and `GET /projects/:id/search`.
The original `gitlab-mcp` called the global one and passed `project_id` and `group_id` as query
parameters, coercing them to numbers on the way. The global endpoint has no such parameters, so
every "search within this project" call silently searched the entire instance and returned whatever
matched. That is worse than an error: the results look plausible.

**The scopes are not all available.** `blobs`, `commits`, `wiki_blobs`, `notes`, and
`snippet_titles` need Advanced Search (Elasticsearch) on the instance. Where it is not enabled,
GitLab answers `200` with `[]` — indistinguishable from a genuine miss. `blobs` is the scope people
most want, so this is the common case, not an edge one.

And the scopes each endpoint accepts differ: `projects` and `users` are instance-wide only, while
`notes` is searchable within a project.

## Decision

One command, `gitlab search`, whose `--project` or `--group` **selects the endpoint** rather than
becoming a query parameter. An empty result in an Advanced-Search scope says so.

## Behavior

| Flags                    | Endpoint                          |
| ------------------------ | --------------------------------- |
| neither                  | `GET /api/v4/search`              |
| `--group <id-or-path>`   | `GET /api/v4/groups/:id/search`   |
| `--project <id-or-path>` | `GET /api/v4/projects/:id/search` |

Both at once is a `ConfigError`, not a precedence rule: accepting both and picking a winner makes a
caller's mistake look like a preference.

The scope enum is passed through as given. Which scopes a given endpoint accepts is GitLab's rule
and it varies by version and edition, so its error is more current than any table encoded here.

### The empty-result caveat

When a search in `blobs`, `commits`, `wiki_blobs`, `notes`, or `snippet_titles` returns nothing, the
output adds:

> The blobs scope needs Advanced Search on the instance; without it GitLab returns an empty list
> rather than an error.

Only on an empty result, and only for those scopes — a caveat printed beside actual results is noise,
and one printed for `projects` is wrong. The MCP tool description carries the same warning, because
an agent that reads "no matches" for a blob search will conclude the code does not exist.

### Rendering

Each scope returns a different object — a blob hit has a path and a line number, a user hit has a
username — so `searchColumns(scope)` picks the column set. The scope is known before the request, so
this is a lookup rather than sniffing the returned rows. `--json` returns the payload unchanged.

## Alternatives considered

**Probe the instance for Advanced Search and say definitively.** There is no supported endpoint that
reports it. `GET /application/settings` exposes related fields but needs admin, which almost no token
here has, so the probe would fail more often than it succeeded.

**Restrict the scope enum per endpoint.** The matrix differs across GitLab versions and between CE
and EE. Encoding it means being wrong on some instances in the direction that refuses a search that
would have worked.

**Print the caveat on every Advanced-Search-scope search.** It would ride along with pages of real
results, which is how a caveat gets ignored when it matters.

**Keep the original's single-endpoint shape and just document that narrowing does not work.** The
narrowing is most of why anyone searches from a project directory.
