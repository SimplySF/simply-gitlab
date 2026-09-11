---
title: MCP server
description: Give an AI agent in Claude Desktop, Claude Code, Cursor, Gemini CLI, or VS Code the same GitLab capabilities as the CLI, as Model Context Protocol tools, read-only by default.
---

`@simplysf/simply-gitlab-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io/)
server with one tool per CLI command. It calls the same library the CLI is built on, in-process, so
the agent gets the same credential handling, `dryRun` previews, read-only guard, and error messages
described elsewhere in these guides, and the same raw JSON the CLI prints with `--json`.

Using it takes four steps: install the server, tell your MCP client how to launch it, check the
connection, then ask the agent for what you want in plain language. This page walks through each,
then covers letting the agent write, the full tool list, results and errors, and what to check when
something does not work.

## Install

The server needs Node.js 22 or later.

```sh
npm install -g @simplysf/simply-gitlab-mcp
simply-gitlab-mcp --help
```

`--help` prints the options and every tool the server can register, so it doubles as a check that
the install worked. It prints to stderr, because stdout is reserved for the protocol stream.

You can skip the global install and have the client fetch the package on demand with
`npx -y @simplysf/simply-gitlab-mcp` as the command; the client configurations below show both
forms.

## Connection settings

The server reads the same variables as the CLI, described in [Credentials](/guides/credentials/):

```
GITLAB_TOKEN=glpat-...
GITLAB_URL=https://gitlab.example.com   # omit entirely for gitlab.com
```

There are only two, and `GITLAB_URL` defaults to `https://gitlab.com` — a gitlab.com user needs the
token and nothing else.

Put them in a `.env` file and pass it with `--env-file`, or set them in the `env` block of the
client's server entry. A variable already in the environment wins over the file, as it does for the
CLI. Settings are resolved when a tool is called rather than at startup, so a missing token is
reported by the tool that needed it instead of killing a server the client has already launched.

Give the token `read_api` scope unless you intend to enable writes. That is the only layer that
actually binds — see [Write safety](/guides/write-safety/).

Use an absolute path for the env file. MCP clients launch the server from a working directory of
their own, so `~` and relative paths may not resolve. On Windows, write the path with forward
slashes or doubled backslashes inside JSON: `"C:/Users/me/gitlab.env"`.

## Configure a client

### Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`; Windows:
`%APPDATA%\Claude\`) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "simply-gitlab": {
      "command": "simply",
      "args": ["gitlab", "mcp", "--env-file", "/home/me/gitlab.env"]
    }
  }
}
```

The same entry with the settings inline and no global install:

```json
{
  "mcpServers": {
    "simply-gitlab": {
      "command": "npx",
      "args": ["gitlab", "mcp"],
      "env": {
        "GITLAB_URL": "https://gitlab.example.com",
        "GITLAB_TOKEN": "glpat-..."
      }
    }
  }
}
```

### Claude Code

```sh
claude mcp add simply-gitlab -- simply-gitlab-mcp --env-file ~/gitlab.env
```

Add `--scope project` to write the entry to a `.mcp.json` at the repository root instead, which can
be committed so a team shares the server definition. Keep tokens out of a committed file by
pointing at an env file each person holds locally. Inside a session, `/mcp` lists the configured
servers and whether each one connected.

### Cursor

Cursor reads `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for every project, with the
same `mcpServers` shape as Claude Desktop.

### Gemini CLI

Gemini CLI reads `~/.gemini/settings.json` for every project, or `.gemini/settings.json` inside a
project, with the same `mcpServers` shape as Claude Desktop:

```json
{
  "mcpServers": {
    "simply-gitlab": {
      "command": "simply",
      "args": ["gitlab", "mcp", "--env-file", "/home/me/gitlab.env"]
    }
  }
}
```

`gemini mcp add` writes the same entry. `--scope user` puts it in the global file; the default
`project` scope writes `.gemini/settings.json`, and `-e` sets one variable on the entry:

```sh
gemini mcp add --scope user \
  -e GITLAB_URL=https://gitlab.example.com \
  -e GITLAB_TOKEN=glpat-... \
  simply-gitlab simply-gitlab-mcp
```

Flags meant for the server itself, `--env-file` and `--allow-writes`, are easier to add by editing
`settings.json`, because `gemini mcp add` reads a leading-dash argument as one of its own options.

Values in `env` expand `$NAME` from the environment Gemini started in, which keeps the token out of
the settings file without an env file:

```json
{
  "mcpServers": {
    "simply-gitlab": {
      "command": "npx",
      "args": ["gitlab", "mcp"],
      "env": {
        "GITLAB_URL": "https://gitlab.example.com",
        "GITLAB_TOKEN": "$GITLAB_TOKEN"
      }
    }
  }
}
```

Two other fields on an entry matter here. `trust: true` bypasses the per-call confirmation for every
tool on that server, so leave it off on any entry started with `--allow-writes` and let a person
approve each write. `includeTools` and `excludeTools` narrow what the model is shown, which is a
second way to express the split in [Let the agent write](#let-the-agent-write): a write entry can
register the merge-request tools while holding back the ones that push commits.

```json
{
  "mcpServers": {
    "simply-gitlab-write": {
      "command": "simply",
      "args": ["gitlab", "mcp", "--allow-writes", "--env-file", "/home/me/gitlab-write.env"],
      "excludeTools": ["gitlab_commit_create", "gitlab_file_create", "gitlab_file_update"],
      "trust": false
    }
  }
}
```

Inside a session, `/mcp` lists the configured servers, whether each connected, and the tools it
registered.

### Gemini Code Assist

Agent mode in the VS Code extension reads that same `~/.gemini/settings.json`, so an entry added for
Gemini CLI is already in place. In IntelliJ the file is `mcp.json` in the IDE's configuration
directory, holding the same `mcpServers` object.

### VS Code

VS Code reads `.vscode/mcp.json`, with a `servers` key and an explicit transport type:

```json
{
  "servers": {
    "simply-gitlab": {
      "type": "stdio",
      "command": "simply",
      "args": ["gitlab", "mcp", "--env-file", "/home/me/gitlab.env"]
    }
  }
}
```

### Any other client

The server speaks MCP over stdio, so any client that can launch a local command works: give it the
command, its arguments, and optionally an environment, as above. It announces itself as
`simply-gitlab` with the package version during the handshake and supplies instructions that
summarise the tool conventions for the host's model.

## Check the connection

Ask the agent to list the projects you are a member of. It should call `gitlab_project_list` with
`membership: true` and come back with paths and ids. If it does, the server is running and the
token works; the [troubleshooting](#troubleshooting) table covers the cases where it does not.

There is no `whoami` tool, because GitLab has no cheap identity endpoint worth a tool of its own —
a project listing answers the same question and gives the agent the paths it needs next.

## Ask for what you want

You do not call tools yourself. Describe the outcome, and the agent chooses the tools and fills in
their inputs from the descriptions the server publishes. Some examples of what a request turns
into:

| You ask                                         | The agent calls                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| "Why did CI fail on group/project?"             | `gitlab_ci_job_list` with `scope: ["failed"]`, then `gitlab_ci_job_log` on the first |
| "What merge requests am I reviewing?"           | `gitlab_mr_list` with `reviewerUsername`                                             |
| "Summarise MR 42 and what changed in it."       | `gitlab_mr_view`, then `gitlab_commit_list` on the source branch                     |
| "Where is `UMCN_Account` defined?"              | `gitlab_search` with `scope: "blobs"` and a `project`                                |
| "When did `src/index.ts` last change, and who?" | `gitlab_commit_list` with `path: "src/index.ts"`                                     |
| "Show me the README on the `release` branch."   | `gitlab_file_view` with `ref: "release"`                                             |
| "What's deployed to production?"                | `gitlab_ci_environment_list`                                                         |
| "Which CI variables are set for production?"    | `gitlab_ci_variable_list` — keys and scopes only, never values                       |

Each tool's inputs are the matching command's flags in camel case, with arrays where the CLI takes
a repeatable or comma-separated flag; see the [Command Reference](/reference/) for what each does.
The second request above, for instance, becomes a call like:

```json
{ "project": "group/project", "state": "opened", "reviewerUsername": "me", "limit": 20 }
```

and returns the same envelope the CLI prints under `--json`:

```json
{ "items": [...], "total": 3, "pages": 1, "complete": true }
```

A few things make the agent's job easier:

- **Name the project by path.** `group/subgroup/project` works everywhere a numeric id does, and
  the agent does not have to look the id up first. It is not URL-encoded by the caller.
- **Merge requests go by `iid`.** That is the number in the web URL, and it is what the tools take
  — not the `id` that also appears in the payload. "MR 42" is unambiguous; the tools validate the
  shape and refuse anything that is not a positive whole number.
- **`complete: false` means there is more.** Every list returns `{ items, total?, pages, complete }`,
  and a `false` there means the limit cut the results short. Ask for a higher `limit` rather than
  assuming the list is the whole answer.
- **Job logs come back tailed.** `gitlab_ci_job_log` returns the last 200 lines by default, because
  a trace is regularly tens of megabytes. `tail: 0` returns all of it, which is rarely what you
  want in a context window.
- **Blob search needs Advanced Search.** The `blobs`, `commits`, `wiki_blobs`, `notes`, and
  `snippet_titles` scopes need Elasticsearch enabled on the instance. Where it is not, GitLab
  answers with an empty list and a `200` rather than an error — so an empty blob search may mean
  "not enabled" rather than "no matches". The tool description says so, so the agent can tell you
  that instead of concluding the code does not exist.

## Let the agent write

Started without options, the server registers only the 16 read tools. Start it with
`--allow-writes` to also register the six that create a branch, write a file, push a commit, or
open and update a merge request. Even then, `GITLAB_READ_ONLY` in the environment refuses every
write, exactly as it does for the CLI.

That mirrors the two-credential-file arrangement in [Write safety](/guides/write-safety/): give the
agent's everyday server a `read_api` token, and configure a second server entry with
`--allow-writes` and an `api` token that is enabled only when a person means to let the agent
write. In an `mcpServers` configuration the pair looks like this:

```json
{
  "mcpServers": {
    "simply-gitlab": {
      "command": "simply",
      "args": ["gitlab", "mcp", "--env-file", "/home/me/gitlab.env"]
    },
    "simply-gitlab-write": {
      "command": "simply",
      "args": ["gitlab", "mcp", "--allow-writes", "--env-file", "/home/me/gitlab-write.env"]
    }
  }
}
```

A `read_api` token is still the only layer that binds; the server-side default just keeps write
tools out of the agent's normal loop entirely. Most clients also ask you to approve each tool call,
and the tools carry MCP annotations (`readOnlyHint`, `destructiveHint`) so a host can tell a read
from a write when it asks.

With writes allowed:

- **Ask for a preview first.** All six write tools accept `dryRun: true`, which returns the request
  that would be sent without sending it. "Show me what you'd send to open a merge request from
  `feature/thing` into `main`, then do it" produces a call like the one below, which you can check
  before the agent repeats it without `dryRun`.

  ```json
  {
    "project": "group/project",
    "sourceBranch": "feature/thing",
    "targetBranch": "main",
    "title": "feat: the thing",
    "dryRun": true
  }
  ```

- **Nothing here deletes.** There is no delete tool in the catalogue, and so no `confirm` gate: every
  write either creates something or edits a merge request, and both are recoverable. That is why
  `dryRun` carries the weight it does.
- **A file update replaces the whole file.** There is no partial edit, so an agent must read the
  file before writing it. Passing `lastCommitId` from `gitlab_file_view` makes GitLab reject the
  write if anything changed meanwhile, instead of silently overwriting someone.
- **A batch commit is atomic.** `gitlab_commit_create` takes an array of actions — create, update,
  delete, move, chmod — and writes them as one commit. Each action is validated before anything is
  sent, so a malformed entry comes back naming its own index rather than as an opaque `400`.

## Tools

| Read tools (always)          | Write tools (`--allow-writes`) |
| ---------------------------- | ------------------------------ |
| `gitlab_project_list`        | `gitlab_file_create`           |
| `gitlab_project_view`        | `gitlab_file_update`           |
| `gitlab_file_view`           | `gitlab_branch_create`         |
| `gitlab_branch_list`         | `gitlab_commit_create`         |
| `gitlab_commit_list`         | `gitlab_mr_create`             |
| `gitlab_commit_view`         | `gitlab_mr_update`             |
| `gitlab_commit_diff`         |                                |
| `gitlab_mr_list`             |                                |
| `gitlab_mr_view`             |                                |
| `gitlab_tag_list`            |                                |
| `gitlab_release_list`        |                                |
| `gitlab_ci_job_list`         |                                |
| `gitlab_ci_job_log`          |                                |
| `gitlab_ci_variable_list`    |                                |
| `gitlab_ci_environment_list` |                                |
| `gitlab_search`              |                                |

### CI variable values are never returned

`gitlab_ci_variable_list` reports each variable's key, environment scope, and whether it is
protected or masked. Every **value** comes back as `<hidden>`, and there is no input to reveal them.

GitLab's own API does not work this way: `GET /projects/:id/variables` returns every value in clear
text, including the ones marked "masked", because masking only hides a value in job logs. Those
values are deploy keys and production credentials, and a value revealed to an agent lands in a
context window, a transcript, and whatever that agent writes next.

This is the one place the MCP server deliberately offers less than the CLI. A person who needs a
value runs `simply gitlab ci variable list --reveal`.

## Results and errors

A successful call returns what the CLI prints with `--json`, verbatim. A failure returns an error
result whose text is a JSON object with a stable `code`:

| `code`   | Meaning                                                                              |
| -------- | ------------------------------------------------------------------------------------ |
| `config` | Missing or contradictory settings, a refused write, bad input.                       |
| `auth`   | The instance rejected the credentials; carries the HTTP `status`.                    |
| `error`  | Any other failure, including an API error with its HTTP `status` and sanitised body. |

These map one-to-one onto the CLI's exit codes 2, 3, and 1, described in
[Scripts and agents](/guides/scripting/), and carry the same `name` and `message`, scrubbed of
credentials and control characters the same way. The agent sees these errors and can act on them,
so a missing token or a wrong project path usually ends in the agent telling you what went wrong
rather than in silence.

Text the instance produced — merge request descriptions, commit messages, file contents, job traces
— is written by anyone who can push or open a merge request. Control characters are stripped before
it reaches the agent, and the tool descriptions say plainly that the content is data rather than
instructions.

## Troubleshooting

Run `simply-gitlab-mcp --help` at a terminal first. If it prints the tool list, the package is
installed and working, and the problem is in how the client launches it or what it passes.

| Symptom                                                        | Cause and fix                                                                                                                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The client reports the server failed to start                  | Desktop apps do not load your shell profile, so the command may not be on their `PATH`. Use the full path to the executable (it lives in the directory `npm prefix -g` reports, under `bin/` on macOS and Linux), or the `npx` form above. |
| The client's log says `Env file ... not found.`                | The only startup failure. The path is wrong or relative; make it absolute. The server exits with code 2.                                                                                                                                   |
| Every tool returns `code: "config"` naming `GITLAB_TOKEN`      | The settings are not reaching the server: the env file is not being read, or the variable was set in a shell the client did not inherit. Pass `--env-file` or an `env` block explicitly.                                                   |
| `code: "auth"` with status `401`                               | The token is wrong, expired, or revoked. Create a new one under **Preferences › Access tokens**.                                                                                                                                           |
| `code: "auth"` with status `403` on a write                    | The token is `read_api`-scoped, or your role on the project does not permit the change. The first is the intended outcome for the everyday server; use the write-capable entry for this change.                                            |
| `code: "error"` with status `404` on a project you can see     | The project reference is wrong. Use the numeric id, or the full path including every parent group — and do not URL-encode it yourself.                                                                                                     |
| A merge request tool acts on the wrong merge request           | An `id` was passed where an `iid` belongs. The `iid` is the number in the web URL; both are integers, so nothing rejects the wrong one.                                                                                                    |
| The agent says it has no tool to create or update anything     | The server was started without `--allow-writes`. That is the default; see [Let the agent write](#let-the-agent-write).                                                                                                                     |
| A write returns `code: "config"` mentioning `GITLAB_READ_ONLY` | The variable is set in the environment or the env file. Unset it, or point the write server at a credential file meant for writing.                                                                                                        |
| A blob search returns nothing for code you know exists         | Advanced Search is probably not enabled on the instance; GitLab answers those scopes with an empty list and a `200`. Try `scope: "merge_requests"` or the project's file tree instead.                                                     |

## Embed in your own process

The stdio binary is the usual way to run the server, but the package also exports what it is built
from, so a host process can serve the same tools over a transport of its choosing:

```js
import { createServer, startServer } from '@simplysf/simply-gitlab-mcp';

// Serve over stdio, exactly as the binary does.
await startServer({ allowWrites: false, envFile: '/home/me/gitlab.env' });

// Or build the server and attach a transport yourself.
const server = createServer({ allowWrites: true, env: process.env });
await server.connect(transport);
```

`createServer` returns the MCP SDK's `McpServer` with the tools registered and nothing connected.
`TOOLS` is the full catalogue, `selectTools(allowWrites)` is the subset a given configuration
registers, and `invokeTool` and `mapError` run one tool and map a failure onto the error object
above, for tests and hosts that need to drive the server without a transport.

## Options

```
simply-gitlab-mcp [--allow-writes] [--env-file <path>]
```

`--help` prints the options and the full tool list. Because stdout is the protocol stream, it prints
to stderr.
