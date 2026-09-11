---
title: Write safety
description: The layers between a Simply GitLab command and a change to your repository, which of them is a real boundary, and why CI variable values are hidden by default.
---

Six commands change data — `branch create`, `file create`, `file update`, `commit create`,
`mr create`, and `mr update`. Nothing in this CLI deletes anything. Those six sit behind several
layers, and only the last is a real boundary.

## No `--confirm`, deliberately

Every write here either creates something or edits a merge request, and both are recoverable: a
branch can be deleted, a file can be committed over, a closed merge request can be reopened.
Requiring a confirmation for actions like those would train you to pass it always, at which point
it protects nothing while still implying that it does.

So there is no `--confirm` flag anywhere in this CLI. The first command that irreversibly destroys
something is the one that brings it back.

## `--dry-run`

Accepted by all six. It prints the exact request body that would be sent and sends nothing, which
is the cheapest way to see what is about to happen:

```sh
simply gitlab mr create --project group/project \
  --source-branch feature/thing --target-branch main --title "feat: the thing" --dry-run
```

```
Dry run — not sent. Request body:
{
  "source_branch": "feature/thing",
  "target_branch": "main",
  "title": "feat: the thing"
}
```

## `--last-commit-id` on a file update

`file update` replaces the whole file; there is no partial edit. That makes a lost-update race real
whenever two people or two runs touch the same file. `file view` reports the file's last commit,
and passing it back makes GitLab reject the write if anything changed meanwhile:

```sh
simply gitlab file view --project group/project --path README.md --ref main
# Last commit: 9a1b2c3

simply gitlab file update --project group/project --path README.md --branch main \
  --content-file ./README.md --message "docs: refresh" --last-commit-id 9a1b2c3
```

Without it, the last writer silently wins.

## `GITLAB_READ_ONLY`

Set it to `1`, `true`, `yes`, or `on` and every write command refuses before making any request.
Reads are unaffected. This guards against misconfiguration: the wrong credential file, the wrong
project, the wrong context. It is not a security boundary, because anything that can run commands
can also unset an environment variable.

## A `read_api` token

This is the only layer that actually binds. A `read_api`-scoped token cannot create, edit, or push
anything — GitLab refuses server-side, regardless of what this CLI sends or what any caller is
persuaded to attempt.

That matters most when an AI agent drives the CLI, because merge request descriptions, commit
messages, and file contents are written by anyone who can push, and an agent reading that text
cannot reliably tell instructions from content. The arrangement worth adopting is two credential
files:

```
~/gitlab.env        # read_api token — what the agent uses by default
~/gitlab-write.env  # api token — passed explicitly, by a person
```

```sh
simply gitlab mr list -e ~/gitlab.env --project group/project
simply gitlab mr update -e ~/gitlab-write.env --project group/project --mr 42 --state close
```

The agent's normal loop is then structurally incapable of changing anything, and a write becomes a
deliberate act.

## CI variable values are hidden

`simply gitlab ci variable list` replaces every value with `<hidden>`, in the table and under
`--json` alike:

```sh
simply gitlab ci variable list --project group/project
```

```
KEY         SCOPE  TYPE     PROTECTED  MASKED  VALUE
──────────  ─────  ───────  ─────────  ──────  ────────
DEPLOY_KEY  *      env_var  yes        yes     <hidden>

Showing 1 of 1 variable(s).
Values are hidden. Pass --reveal to print them.
```

This is worth explaining, because GitLab's own API does not do this. `GET /projects/:id/variables`
returns **every** value in clear text — including the ones marked "masked", since masking only
hides a value in job logs, not from the API. Those values are deploy keys, signing certificates,
and production credentials, and the usual reason to list them is to see _which_ exist, not to read
them.

`--reveal` prints them. It exists on the CLI and has no equivalent in the
[MCP server](/guides/mcp-server/), deliberately: a value revealed to a person is on their screen,
and a value revealed to an agent is in a context window, a transcript, and whatever that agent
writes next.

## Untrusted text is stripped

Merge request titles and descriptions, commit messages, repository file contents, and CI job traces
are all written by whoever can push to a project or open a merge request. Every one of them is
stripped of control characters before it is printed, so an escape sequence cannot make your
terminal show something other than what the API returned — and your token is redacted from every
error message and response body.
