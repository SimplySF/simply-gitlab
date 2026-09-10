# 0001 — GitLab client core: configuration, authentication, HTTP, and paging

**Status:** Implemented (PR #1)
**Package:** `packages/simply-gitlab-core`
**Date:** 2026-09-09

## Problem

Every command and every tool needs the same four things: where the instance is, how to prove who we
are, how to make a request that survives a flaky network, and how to read a list that is longer than
one page. Written once per command, those four things drift; written once in core, they are proven
once.

## Decision

`resolveGitLabConfig` → `GitLabClient` → `HttpTransport`. Configuration resolves from flags over
environment over `.env` file; the client owns path construction and paging; the transport owns
retries, timeouts, and turning a response into a typed error.

## Behavior

### Configuration

| Setting      | Flag             | Variable       | Default               |
| ------------ | ---------------- | -------------- | --------------------- |
| Instance URL | `--gitlab-url`   | `GITLAB_URL`   | `https://gitlab.com`  |
| Token        | `--gitlab-token` | `GITLAB_TOKEN` | none; a `ConfigError` |

A flag beats the environment, which beats a `--env-file`. The env file applies only
`GITLAB_URL`, `GITLAB_TOKEN`, `GITLAB_SSL_VERIFY`, and `GITLAB_READ_ONLY`; anything else in the
file is ignored, so a file the user did not write cannot set `NODE_TLS_REJECT_UNAUTHORIZED` and
hand the token to whoever answers.

A variable exported as the empty string does not outrank the file. `export GITLAB_TOKEN=` in a
wrapper script would otherwise discard the real token and fail as if nothing were configured.

URL handling has one special case worth stating: a pasted **gitlab.com** URL keeps only its origin,
because `https://gitlab.com/group/project` is a project page, not an instance served under
`/group/project`. Every other host keeps its path, because self-managed instances really are served
from subpaths.

`GITLAB_SSL_VERIFY=false` is a `ConfigError`, not a no-op. Silently ignoring it leaves a user
believing verification is off when it is on. The error names the fix that keeps verification intact:
`NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

### Authentication

`PRIVATE-TOKEN: <token>`, always. GitLab also accepts `Authorization: Bearer`, but only for OAuth 2
tokens — a personal, project, or group access token authenticates through `PRIVATE-TOKEN` alone.
This CLI issues no OAuth flow, so it sends the header that works for every token a user can create
by hand.

### Transport

- 401 and 403 raise `AuthError` immediately, with no retry. A 403 on a call the caller **declared**
  mutating adds a note about token scope and project role. It is gated on that declaration rather
  than on the HTTP verb, because the verb is not a reliable signal — and because an agent reading
  "use a credential with write scope" after an ordinary read failure would escalate its own
  privileges.
- 429 and 5xx retry with exponential backoff, deferring to `Retry-After` capped at 60s so a hostile
  value cannot park the CLI.
- Timeouts, DNS misses, and certificate failures raise `NetworkError` without retrying; a
  certificate failure names the CA bundle fix. Transient socket failures do retry.
- The 30s timeout covers the whole exchange, response body included.
- Any other non-2xx raises `HttpError` carrying the status and body.

Two GitLab-specific additions over the Atlassian transport this is derived from:

**Array query parameters** are appended as `scope[]=failed&scope[]=running`. GitLab reads a repeated
parameter only in that bracketed form; a comma-joined value is taken as one literal scope and
matches nothing, silently.

**A non-JSON mode.** Job traces are plain text, sometimes megabytes of it. `transport.text()` returns
the body verbatim; the failure path is shared, so an error on those endpoints is still an
`HttpError`.

### Paging

`transport.jsonPaged()` returns the body together with GitLab's `X-Next-Page`, `X-Total`,
`X-Total-Pages`, and `X-Per-Page` headers. Every one is optional: keyset-paginated endpoints and
result sets too large for GitLab to count omit them, so a missing header means **unknown**, never
zero.

`GitLabClient.collect()` walks pages until the caller's limit and returns:

```
{ items, total?, pages, complete }
```

`complete: false` means the limit cut the results short and more exist. Returning a short list with
no signal is how a partial answer gets mistaken for the whole one — by a person and by an agent.

The walk stops on any of: no `X-Next-Page`, an empty page, or a cursor that fails to advance. The
last matters because a reverse proxy that strips or pins the header would otherwise loop to the page
cap. A list response that is not a JSON array raises rather than being sliced — a redirect to a
sign-in page answers 200 with HTML, and slicing that produces a confidently empty list.

### Project references

A project is addressed by numeric id or by full path, and the path must arrive URL-encoded:
`group/project` as `group%2Fproject`. An un-encoded slash routes somewhere else entirely and answers
404 with nothing naming the cause, so `segment()` encodes every caller-supplied path component,
including file paths.

Every client method that builds a path this way is `async`, so a bad reference arrives as a
rejection rather than as a synchronous throw out of a `Promise`-returning method.

### Errors

| Class          | Exit code | When                                                             |
| -------------- | --------- | ---------------------------------------------------------------- |
| `ConfigError`  | 2         | Missing, malformed, or self-contradictory input or configuration |
| `AuthError`    | 3         | 401 or 403; carries the status                                   |
| `NetworkError` | 1         | Timeout, DNS miss, refused connection, untrusted certificate     |
| `HttpError`    | 1         | Any other non-2xx; carries the status and body                   |

## Alternatives considered

**Use `@gitbeaker/rest` or another GitLab SDK.** It would cover far more of the API than this does.
It also owns the failure taxonomy, the retry policy, and the paging contract — the three things this
package exists to make explicit — and it would put a large dependency between us and a REST API that
`fetch` already speaks.

**Guess `mutating` from the HTTP verb** instead of making callers declare it. GitLab has POST
endpoints that change nothing (`/markdown`) and GET endpoints that a read-only token is refused. A
wrong guess writes a misleading scope hint into an error, which is worse than no hint.

**Return one page and let callers loop.** That is what the original `gitlab-mcp` did, and every
caller either ignored paging (and quietly answered from page one) or reimplemented the loop.

**Make `complete` a count of remaining items.** GitLab does not always know the total, so the field
would be absent exactly when the answer matters most. A boolean is always answerable.
