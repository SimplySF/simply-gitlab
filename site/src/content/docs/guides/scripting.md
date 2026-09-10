---
title: Scripts and agents
description: The output contract that makes the Simply GitLab CLI safe to drive from a shell script or an AI agent - raw JSON, stable exit codes, honest truncation, no prompts.
---

The CLI is designed for two callers at once: a person at a terminal, and a script or AI agent
running it as shell commands. The defaults serve the person; a small, stable contract serves the
script.

## `--json` returns the raw API payload

Every command accepts `--json`, without exception. The output is the unmodified response from the
GitLab API — the full object, not the curated subset the table shows — so anything the API exposes
is reachable with `jq`, and the payload shape is GitLab's contract rather than this CLI's.

```sh
simply gitlab mr view --project group/project --mr 42 --json | jq -r '.detailed_merge_status'
```

## Lists tell you when they were cut short

Every list command follows pages up to `--limit`, so there is no single response to hand back.
They return an envelope instead:

```json
{ "items": [...], "total": 500, "pages": 3, "complete": false }
```

The elements inside `items` are still raw API objects. **`complete: false` means `--limit` cut the
results short** and more exist, so a caller can detect truncation without counting rows. `total` is
present only when GitLab reports one — keyset-paginated endpoints and very large result sets omit
it, so treat a missing `total` as unknown rather than zero.

```sh
out=$(simply gitlab mr list --project group/project --state all --limit 100 --json)
if [ "$(jq -r .complete <<<"$out")" = "false" ]; then
  echo "more than 100 merge requests; raise --limit" >&2
fi
```

## Exit codes and errors

Errors carry no stack trace and map to stable exit codes:

| Exit code | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| `0`       | Success                                                    |
| `2`       | Configuration or usage problem, e.g. a missing token       |
| `3`       | Authentication or authorization failure                    |
| `1`       | Anything else, including an API error or a network failure |

Under `--json`, a failure is written as one JSON object on **stderr** and stdout stays empty, so a
caller that captures stdout never has to disambiguate an error from a payload. The object nests
under an `error` key:

```json
{ "error": { "name": "HttpError", "message": "...", "exitCode": 1, "status": 404, "body": {} } }
```

`body` carries the API's own response when there was one. Every string in the object — the message
and everything inside `body` — is scrubbed of any known credential value and of characters that
could rewrite the terminal or hide text, so a response that quotes your token back at you does not
put it on the stream.

```sh
if ! out=$(simply gitlab mr view --project group/project --mr 999 --json 2>err.json); then
  case $? in
    3) echo "credentials rejected";;
    *) jq -r .error.message err.json;;
  esac
fi
```

## Address merge requests by `iid`

A merge request has both an `id` and an `iid`. Both are bare integers, both appear in every
payload, and the endpoints take the **`iid`** — the number in the web URL. Passing the wrong one
does not fail: it addresses a different merge request in a different project that happens to share
the number.

The CLI validates the shape and refuses anything that is not a positive whole number, but it cannot
catch a valid-looking wrong number. When scripting, read `iid` from the list output, never `id`:

```sh
simply gitlab mr list --project group/project --json | jq -r '.items[].iid'
```

## Keep payloads small

`--simple` on `project list` returns a much smaller object. `--stat` on `commit diff` lists the
changed files without the hunks. `--tail` on `ci job log` defaults to the last 200 lines, because a
trace is regularly tens of megabytes and an agent pays for every token it reads:

```sh
simply gitlab ci job list --project group/project --scope failed --limit 5 --json \
  | jq -r '.items[0].id' \
  | xargs -I{} simply gitlab ci job log --project group/project --job {} --tail 50
```

## Retries are handled for you

429 and 5xx responses retry with exponential backoff, honouring a capped `Retry-After`. DNS
failures and certificate problems do not retry, because another attempt cannot fix them. A script
does not need its own retry loop around these commands.

## Never interactive

No command prompts or blocks on stdin, and there is no `--confirm` flag to hang on. Every write
takes `--dry-run` instead. See [Write safety](/guides/write-safety/) for the full set of layers and
the two-credential-file arrangement that keeps an agent's normal loop read-only.

## Help is discovery

`--help` output is generated from the command classes and written to be self-sufficient, so an
agent can discover flags and examples the same way a person does:

```sh
simply gitlab mr --help
simply gitlab mr create --help
```

The same text, for every command, is on the [Command Reference](/reference/) pages.
