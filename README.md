# Simply GitLab

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Simply GitLab is a command-line interface built by [SimplySF](https://github.com/SimplySF) for working
with GitLab, and an MCP server that gives an AI agent the same capabilities.

It covers projects, repository files (read, create, update), branches, tags, releases, commits
(history, diffs, and multi-file commits), merge requests (list, view, open, update), CI/CD jobs and
their logs, CI variables, deployment environments, and search across the instance, a group, or one
project. Output is human-readable by default and raw JSON with `--json`, every write takes
`--dry-run`, and lists say plainly when a limit cut them short.

This repo is a Lerna/pnpm monorepo, following the same conventions as SimplySF's
[`simply-atlassian`](https://github.com/SimplySF/simply-atlassian),
[`simply-node`](https://github.com/SimplySF/simply-node), and
[`simply-plugins`](https://github.com/SimplySF/simply-plugins) repos.

## Packages

| Package                                                       | Description                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`@simplysf/simply-gitlab`](packages/simply-gitlab)           | The `simply gitlab` CLI                                                                    |
| [`@simplysf/simply-gitlab-core`](packages/simply-gitlab-core) | Configuration, auth, the HTTP client, and shared logic the CLI and MCP server are built on |
| [`@simplysf/simply-gitlab-mcp`](packages/simply-gitlab-mcp)   | MCP server exposing GitLab to AI agents, one tool per CLI command                          |

## Installation

All three packages need Node.js 22 or later.

**The CLI**, for a person at a terminal or a script:

```sh
npm install -g @simplysf/simply-gitlab
simply gitlab --help
```

**The MCP server**, for an AI agent in Claude Desktop, Claude Code, Cursor, VS Code, or any other
MCP client. Install it globally, or let the client fetch it on demand with
`npx -y @simplysf/simply-gitlab-mcp`:

```sh
npm install -g @simplysf/simply-gitlab-mcp
simply-gitlab-mcp --help
```

## Connecting

Two settings, as environment variables or flags:

| Setting      | Variable       | Flag             | Default              |
| ------------ | -------------- | ---------------- | -------------------- |
| Instance URL | `GITLAB_URL`   | `--gitlab-url`   | `https://gitlab.com` |
| Access token | `GITLAB_TOKEN` | `--gitlab-token` | required             |

The token is a personal, project, or group access token, created under **Preferences › Access
tokens**. `read_api` is enough for every read command; `api` is needed to write. A `.env` file works
too, with `--env-file`; the real environment always wins over the file, and only GitLab connection
variables are read from it.

```sh
export GITLAB_URL=https://gitlab.example.com   # omit for gitlab.com
export GITLAB_TOKEN=glpat-…

simply gitlab project list --membership
simply gitlab mr list --project group/project --state opened
simply gitlab ci job list --project group/project --scope failed
simply gitlab ci job log --project group/project --job 12345
simply gitlab search --scope blobs --query UMCN_Account --project group/project
```

A project is named by its numeric id or its full path (`group/subgroup/project`) — you do not need to
URL-encode it.

## Safety

- **Writes are off by default on the MCP server.** Start it with `--allow-writes` to register the
  six tools that change data.
- **`GITLAB_READ_ONLY=1` refuses every write**, on both surfaces, before any request is made. It is a
  guardrail against running against the wrong project, not a security boundary — the boundary that
  binds is a `read_api`-scoped token.
- **Every write command takes `--dry-run`**, which prints the exact request body and sends nothing.
- **CI variable values are hidden by default.** `GET /projects/:id/variables` returns every value in
  clear text, including the ones GitLab calls "masked". `simply gitlab ci variable list --reveal`
  prints them; the MCP tool has no equivalent, deliberately.
- **Your token never reaches the output.** It is redacted from every error message and response body
  on both surfaces.
- **Text the instance chose is stripped of control characters** before it is printed. Merge request
  titles, commit messages, file contents, and job traces are all written by whoever can push, and an
  escape sequence in one of them could otherwise make the terminal show something other than what
  the API returned.

## Documentation

- [Command reference](packages/simply-gitlab/README.md) — every command, flag, and example
- [MCP server](packages/simply-gitlab-mcp/README.md) — the tool catalogue and client setup
- [Design documents](docs/design/README.md) — why things are the way they are
- [Contributing](CONTRIBUTING.md) — setup, checks, and the pull-request checklist

## License

Apache-2.0. See [LICENSE.txt](LICENSE.txt).
