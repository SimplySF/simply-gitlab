---
title: Get Started
description: Requirements, installation, and a first command for the Simply GitLab CLI.
---

## Requirements

- Node.js 22 or later
- A GitLab account on gitlab.com or a self-managed instance, and an access token

## Install

```sh
npm install -g @simplysf/simply-cli
```

## Verify it worked

```sh
simply gitlab --help
```

## Get a token

Create a personal access token under **Preferences › Access tokens** in GitLab, or a project or
group access token from that project's or group's settings. Two scopes matter:

| Scope      | What it allows                                           |
| ---------- | -------------------------------------------------------- |
| `read_api` | Everything on this site that reads. Nothing that writes. |
| `api`      | Reads and writes.                                        |

Start with `read_api`. It is not just a smaller permission — it is the only thing that makes a
write structurally impossible, which matters as soon as a script or an agent is running these
commands. See [Write safety](/guides/write-safety/).

## Connect to your instance

Every command reads its connection settings from environment variables, from flags, or from a
`.env` file passed with `-e/--env-file`:

```
GITLAB_TOKEN=glpat-...
GITLAB_URL=https://gitlab.example.com   # omit entirely for gitlab.com
```

`GITLAB_URL` defaults to `https://gitlab.com`, so a gitlab.com user needs only the token. See
[Credentials](/guides/credentials/) for precedence between flags, environment, and file, and for
trusting an internal certificate authority.

## First commands

Find a project you can reach, then look at its open merge requests:

```sh
simply gitlab project list --membership
simply gitlab mr list --project group/project
```

Add `--json` to either to get the raw API payload instead of the formatted table.

## Naming a project

Every project-scoped command takes `-p/--project`, which accepts a numeric id or the full path.
Both of these are the same project:

```sh
simply gitlab mr list --project 1234
simply gitlab mr list --project group/subgroup/project
```

The path is URL-encoded for you — do not encode it yourself. If you work in one project most of
the time, set `GITLAB_PROJECT` and drop the flag.

## Where to go next

- The [Command Reference](/reference/) lists every command by topic, with its flags and examples.
- [Credentials](/guides/credentials/) covers tokens, precedence, and certificates.
- [Write safety](/guides/write-safety/) explains `--dry-run`, `GITLAB_READ_ONLY`, and why a
  `read_api` token is the only one of those that actually binds.
- [Scripts and agents](/guides/scripting/) covers the `--json` contract and exit codes.
- [MCP server](/guides/mcp-server/) gives an AI agent the same capabilities as tools, read-only by
  default.
- Want to contribute? See
  [CONTRIBUTING.md](https://github.com/SimplySF/simply-gitlab/blob/main/CONTRIBUTING.md) in the
  repo.
