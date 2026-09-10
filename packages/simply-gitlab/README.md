# @simplysf/simply-gitlab

[![NPM](https://img.shields.io/npm/v/@simplysf/simply-gitlab?label=@simplysf/simply-gitlab)](https://npmjs.com/@simplysf/simply-gitlab) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://raw.githubusercontent.com/SimplySF/simply-gitlab/main/LICENSE.txt)

Command-line interface for working with GitLab, built by [SimplySF](https://github.com/SimplySF).

Covers projects, repository files, branches, tags, releases, commits and diffs, merge requests,
CI/CD jobs and their logs, CI variables, deployment environments, and search. Output is
human-readable by default and raw JSON with `--json`, and every command that changes data takes
`--dry-run`, so it is usable both at a terminal and by a script or agent. See
[Commands](#commands) below for the full reference.

The same capabilities are available to AI agents through
[`@simplysf/simply-gitlab-mcp`](https://github.com/SimplySF/simply-gitlab/tree/main/packages/simply-gitlab-mcp).

## Documentation

Guides and the full command reference: **https://simplysf.github.io/simply-cli/gitlab/**

The guides also ship inside this package, under [`docs/`](docs).

## Install

`@simplysf/simply-gitlab` is a plugin of the `simply` CLI, not a command of its own. Install the host; this
plugin installs itself the first time you run one of its commands.

```sh
npm install -g @simplysf/simply-cli

simply gitlab --help
```

To install it ahead of time — in CI, a container image, or offline:

```sh
simply plugins install @simplysf/simply-gitlab
```

> **Upgrading from a standalone install?** This package used to own the `simply` command itself,
> which meant it could not be installed alongside SimplySF's other CLIs. It is now a plugin.
> Run `npm uninstall -g @simplysf/simply-gitlab` and install `@simplysf/simply-cli` instead.
> **Your commands do not change** — `simply gitlab …` is exactly what it was.

## Issues

Please report any issues at https://github.com/SimplySF/simply-gitlab/issues

## Contributing

This package is part of the [`@simplysf/simply-gitlab`](https://github.com/SimplySF/simply-gitlab) monorepo. See the repo's [CONTRIBUTING.md](https://github.com/SimplySF/simply-gitlab/blob/main/CONTRIBUTING.md) for the repo structure, how to set up and build the project, our commit conventions, and how to submit a pull request. Please also read our [Code of Conduct](https://github.com/SimplySF/simply-gitlab/blob/main/CODE_OF_CONDUCT.md).

## Credentials

Connection settings come from environment variables, from flags, or from a `.env` file named with
`-e/--env-file`. Only GitLab connection variables are read from that file; anything else in it is
ignored.

```
GITLAB_URL=https://gitlab.example.com   # omit for gitlab.com
GITLAB_TOKEN=glpat-...
```

The token is a personal, project, or group access token, created under **Preferences › Access
tokens**. `read_api` is enough for every read command; `api` is needed to write.

Explicit flags beat the environment, which beats the file's contents. Certificate verification is
always on: for an instance behind an internal or agency CA, trust that CA with
`NODE_EXTRA_CA_CERTS=/path/to/ca.pem` rather than disabling verification —
`GITLAB_SSL_VERIFY=false` is refused with an error rather than ignored.

`GITLAB_PROJECT` sets the default for `-p/--project`, so a shell in one repository's context need
not repeat it.

## Naming a project

Every project-scoped command takes `-p/--project`, which accepts either the numeric id or the full
path:

```bash
simply gitlab mr list --project 1234
simply gitlab mr list --project group/subgroup/project
```

The path is URL-encoded for you. Do not encode it yourself.

Merge requests are addressed by their project-scoped **iid** — the number in the web URL — not by the
instance-wide `id` that also appears in the API payload. Both are bare integers, and passing the
wrong one does not fail: it addresses a different merge request in a different project.

## Write safety

Six commands change data: `branch create`, `file create`, `file update`, `commit create`,
`mr create`, and `mr update`. Nothing here deletes anything.

**`--dry-run`** is on every one of them. It prints the exact request body that would be sent and
sends nothing, which is the cheapest way to check a command before running it for real.

**`GITLAB_READ_ONLY=1`** refuses every write before any request is made. It is a guardrail against
running against the wrong project or with the wrong credentials, not a security boundary — anyone
who can set the variable can unset it.

**A `read_api`-scoped token** is the boundary that actually binds, because GitLab enforces it
server-side. Use one whenever you only mean to read.

There is deliberately no `--confirm` flag. Every write here creates something or edits a merge
request, and both are recoverable; requiring a confirmation for those would train you to pass it
always, at which point it protects nothing while still implying that it does. The first command that
deletes something is the one that brings the flag back.

## Reading untrusted text

Merge request titles and descriptions, commit messages, repository file contents, and CI job traces
are all written by whoever can push to a project or open a merge request. Control characters are
stripped from them before anything is printed, so an escape sequence cannot make your terminal show
something other than what the API returned. Your token is redacted from every error message and
response body.

## Exit codes

| Code | Meaning                      |
| ---- | ---------------------------- |
| 0    | Success                      |
| 1    | Request or network failure   |
| 2    | Configuration or usage error |
| 3    | Authentication or permission |

Under `--json`, a failure writes a single JSON object to **stderr** — `{"error":{name, message,
exitCode, status?, body?}}` — and nothing to stdout. Exit codes are identical with and without
`--json`.

<!-- commands -->

- [`simply gitlab branch create`](#simply-gitlab-branch-create)
- [`simply gitlab branch list`](#simply-gitlab-branch-list)
- [`simply gitlab ci environment list`](#simply-gitlab-ci-environment-list)
- [`simply gitlab ci job list`](#simply-gitlab-ci-job-list)
- [`simply gitlab ci job log`](#simply-gitlab-ci-job-log)
- [`simply gitlab ci variable list`](#simply-gitlab-ci-variable-list)
- [`simply gitlab commit create`](#simply-gitlab-commit-create)
- [`simply gitlab commit diff`](#simply-gitlab-commit-diff)
- [`simply gitlab commit list`](#simply-gitlab-commit-list)
- [`simply gitlab commit view`](#simply-gitlab-commit-view)
- [`simply gitlab config apply`](#simply-gitlab-config-apply)
- [`simply gitlab config export`](#simply-gitlab-config-export)
- [`simply gitlab config plan`](#simply-gitlab-config-plan)
- [`simply gitlab file create`](#simply-gitlab-file-create)
- [`simply gitlab file update`](#simply-gitlab-file-update)
- [`simply gitlab file view`](#simply-gitlab-file-view)
- [`simply gitlab mr create`](#simply-gitlab-mr-create)
- [`simply gitlab mr list`](#simply-gitlab-mr-list)
- [`simply gitlab mr update`](#simply-gitlab-mr-update)
- [`simply gitlab mr view`](#simply-gitlab-mr-view)
- [`simply gitlab project list`](#simply-gitlab-project-list)
- [`simply gitlab project view`](#simply-gitlab-project-view)
- [`simply gitlab release list`](#simply-gitlab-release-list)
- [`simply gitlab search`](#simply-gitlab-search)
- [`simply gitlab tag list`](#simply-gitlab-tag-list)

## `simply gitlab branch create`

Create a branch.

```
USAGE
  $ simply gitlab branch create -p <value> --branch <value> --ref <value> [--json] [-e <value>] [--gitlab-url <value>]
    [--gitlab-token <value>] [--dry-run]

FLAGS
  -p, --project=<value>  (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.
      --branch=<value>   (required) Name of the new branch.
      --dry-run          Print the request that would be sent and exit without sending it.
      --ref=<value>      (required) Branch, tag, or commit SHA to branch from.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Create a branch.

  Points a new branch at an existing branch, tag, or commit SHA. GitLab refuses a name that already exists rather than
  moving it, so this can never rewrite a branch someone else is using.

EXAMPLES
  $ simply gitlab branch create --project group/project --branch feature/thing --ref main

  $ simply gitlab branch create --project group/project --branch hotfix --ref v1.2.0

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/branch/create.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/branch/create.js)_

## `simply gitlab branch list`

List repository branches.

```
USAGE
  $ simply gitlab branch list -p <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>] [--limit
    <value>] [--search <value>]

FLAGS
  -p, --project=<value>  (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.
      --limit=<value>    [default: 20] Maximum number of branches to return across all pages.
      --search=<value>   Return only branches whose name contains this term.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List repository branches.

  Branches come back in GitLab order, which is alphabetical rather than by recency, so on a busy repository --search is
  usually what you want. The MERGED column reflects whether the branch is merged into the default branch, not into
  whatever you are working on.

EXAMPLES
  $ simply gitlab branch list --project group/project

  $ simply gitlab branch list --project group/project --search release --limit 50

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/branch/list.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/branch/list.js)_

## `simply gitlab ci environment list`

List a project deployment environments.

```
USAGE
  $ simply gitlab ci environment list -p <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>] [--limit
    <value>] [--name <value>] [--search <value>] [--state available|stopped]

FLAGS
  -p, --project=<value>  (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.
      --limit=<value>    [default: 20] Maximum number of environments to return across all pages.
      --name=<value>     Return the environment with exactly this name.
      --search=<value>   Return environments whose name contains this term.
      --state=<option>   Environment state.
                         <options: available|stopped>

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List a project deployment environments.

  Environments are what CI deploys to and what review apps create. Both available and stopped ones are listed; --state
  narrows to one. Use --json for the last deployment on each, which is the field worth having when you are answering
  "what is running where".

EXAMPLES
  $ simply gitlab ci environment list --project group/project

  $ simply gitlab ci environment list --project group/project --state available --search prod

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/ci/environment/list.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/ci/environment/list.js)_

## `simply gitlab ci job list`

List CI jobs for a project.

```
USAGE
  $ simply gitlab ci job list -p <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>] [--limit
    <value>] [--scope created|pending|running|failed|success|canceled|skipped|waiting_for_resource|manual...]

FLAGS
  -p, --project=<value>    (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.
      --limit=<value>      [default: 20] Maximum number of jobs to return across all pages.
      --scope=<option>...  Job states to include. Repeatable.
                           <options:
                           created|pending|running|failed|success|canceled|skipped|waiting_for_resource|manual>

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List CI jobs for a project.

  Jobs across every pipeline, newest first. --scope is repeatable and the scopes are ORed, so --scope failed --scope
  running is "either". The ID column is what ci job log takes.

EXAMPLES
  $ simply gitlab ci job list --project group/project --scope failed --limit 10

  $ simply gitlab ci job list --project group/project --scope running --scope pending

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/ci/job/list.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/ci/job/list.js)_

## `simply gitlab ci job log`

Print a job log.

```
USAGE
  $ simply gitlab ci job log -p <value> --job <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token
    <value>] [--tail <value>]

FLAGS
  -p, --project=<value>  (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.
      --job=<value>      (required) Job id, as listed by ci job list.
      --tail=<value>     [default: 200] Print only the last N lines. 0 prints the whole trace.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Print a job log.

  A job trace regularly runs to tens of megabytes, and what matters about a failed job is at the end, so only the last
  200 lines are printed. --tail changes that number and --tail 0 prints the whole thing.

  The trace is written by whatever the job ran, which means it is arbitrary text from an untrusted source. Control
  characters are stripped before it is printed, so the coloured output a runner emits arrives here plain.

EXAMPLES
  $ simply gitlab ci job log --project group/project --job 12345

  $ simply gitlab ci job log --project group/project --job 12345 --tail 0

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/ci/job/log.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/ci/job/log.js)_

## `simply gitlab ci variable list`

List a project CI/CD variables.

```
USAGE
  $ simply gitlab ci variable list -p <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>] [--limit
    <value>] [--reveal]

FLAGS
  -p, --project=<value>  (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.
      --limit=<value>    [default: 50] Maximum number of variables to return across all pages.
      --reveal           Print the variable values in clear text.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List a project CI/CD variables.

  Variable values are hidden by default, including under --json. GitLab returns every value in clear text on this
  endpoint — the "masked" attribute only hides a value in job logs, not from the API — and those values are deploy keys
  and production credentials.

  Pass --reveal to print them. Doing so puts live secrets on stdout, into your shell history if you redirect it, and
  into the context of anything reading this output, so it is a deliberate step rather than the default.

EXAMPLES
  $ simply gitlab ci variable list --project group/project

  $ simply gitlab ci variable list --project group/project --reveal

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.

  --reveal  Print the variable values in clear text.

    Off by default. Every value on this endpoint is a live secret, so revealing them is worth a moment of thought about
    where this output is going.
```

_See code: [lib/commands/gitlab/ci/variable/list.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/ci/variable/list.js)_

## `simply gitlab commit create`

Commit several file changes at once.

```
USAGE
  $ simply gitlab commit create -p <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>]
    [--dry-run] [--branch <value>] [--message <value>] [--actions <value>] [--start-branch <value>] [--start-sha
    <value>] [--author-email <value>] [--author-name <value>] [--force] [--body <value> | --body-file <value>]

FLAGS
  -p, --project=<value>       (required) [env: GITLAB_PROJECT] Project id, or its full path such as
                              group/subgroup/project.
      --actions=<value>       JSON array of file actions.
      --author-email=<value>  Commit author email.
      --author-name=<value>   Commit author name.
      --body=<value>          Raw JSON request body.
      --body-file=<value>     Path to a file holding the raw JSON request body.
      --branch=<value>        Branch to commit to.
      --dry-run               Print the request that would be sent and exit without sending it.
      --force                 Overwrite the branch with the new commit.
      --message=<value>       Commit message.
      --start-branch=<value>  Branch to create --branch from, if it does not exist.
      --start-sha=<value>     Commit SHA to start the new commit from.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Commit several file changes at once.

  Sends one commit containing a batch of actions — create, update, delete, move, chmod — which is how GitLab writes more
  than one file atomically. The actions are JSON, supplied with --actions or inside a --body-file, because there is no
  readable flag form for a list of file operations.

  Each action is an object with an "action" and a "file_path"; create and update also need "content", move needs
  "previous_path", and chmod needs "execute_filemode". Those rules are checked before anything is sent, so a bad entry
  names its own index.

  Use --dry-run to see exactly what would be sent.

EXAMPLES
  $ simply gitlab commit create --project group/project --branch main --message "chore: tidy" --actions '[{"action":"delete","file_path":"old.txt"}]'

  $ simply gitlab commit create --project group/project --branch main --message "feat: batch" --body-file ./commit.json --dry-run

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/commit/create.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/commit/create.js)_

## `simply gitlab commit diff`

Show the changes a commit made.

```
USAGE
  $ simply gitlab commit diff -p <value> --sha <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token
    <value>] [--stat]

FLAGS
  -p, --project=<value>  (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.
      --sha=<value>      (required) Commit SHA, or the name of a branch or tag.
      --stat             List the changed files without printing the hunks.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Show the changes a commit made.

  Prints the unified diff for each file the commit touched. GitLab truncates very large diffs server-side and says so in
  the payload, so --stat is worth reaching for first on a big commit: it lists the files without any hunks.

EXAMPLES
  $ simply gitlab commit diff --project group/project --sha 9a1b2c3

  $ simply gitlab commit diff --project group/project --sha 9a1b2c3 --stat

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/commit/diff.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/commit/diff.js)_

## `simply gitlab commit list`

List repository commits.

```
USAGE
  $ simply gitlab commit list -p <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>] [--limit
    <value>] [--ref <value>] [--path <value>] [--since <value>] [--until <value>] [--author <value>] [--stats]

FLAGS
  -p, --project=<value>  (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.
      --author=<value>   Only commits by this author name or email.
      --limit=<value>    [default: 20] Maximum number of commits to return across all pages.
      --path=<value>     Only commits that touched this file or directory.
      --ref=<value>      Branch, tag, or SHA to list from. Defaults to the default branch.
      --since=<value>    Only commits on or after this ISO 8601 timestamp.
      --stats            Include per-commit line counts in the JSON payload.
      --until=<value>    Only commits on or before this ISO 8601 timestamp.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List repository commits.

  Walks the history of a ref, newest first. --path narrows to commits that touched one file or directory, which is the
  fastest way to answer "when did this change and who changed it".

  --since and --until take ISO 8601 timestamps (2026-01-31T00:00:00Z); a bare date works too.

EXAMPLES
  $ simply gitlab commit list --project group/project --ref main --limit 10

  $ simply gitlab commit list --project group/project --path src/index.ts

  $ simply gitlab commit list --project group/project --since 2026-01-01 --until 2026-02-01

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/commit/list.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/commit/list.js)_

## `simply gitlab commit view`

Show one commit.

```
USAGE
  $ simply gitlab commit view -p <value> --sha <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token
    <value>]

FLAGS
  -p, --project=<value>  (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.
      --sha=<value>      (required) Commit SHA, or the name of a branch or tag.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Show one commit.

  Accepts a full or short SHA, or the name of a branch or tag — in which case the commit at its tip is shown, so the
  answer changes as the branch moves. Use commit diff for the changes themselves.

EXAMPLES
  $ simply gitlab commit view --project group/project --sha 9a1b2c3

  $ simply gitlab commit view --project group/project --sha main --json

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/commit/view.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/commit/view.js)_

## `simply gitlab config apply`

Bring projects onto a baseline config.

```
USAGE
  $ simply gitlab config apply -c <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>] [--target
    <value>...] [--concurrency <value>] [--fail-fast] [--dry-run]

FLAGS
  -c, --config=<value>       (required) Path to the baseline configuration file.
      --concurrency=<value>  [default: 4] How many targets to work on at once.
      --dry-run              Print the request that would be sent and exit without sending it.
      --fail-fast            Stop at the first target that fails instead of continuing.
      --target=<value>...    Limit the run to this project path. Repeatable.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Bring projects onto a baseline config.

  Computes the same plan as config plan, then executes it. Only what the plan showed is sent, so a preview is a
  guarantee rather than an approximation, and a second run against a converged project sends no requests at all.

  Sections are applied in a fixed order — settings, protected branches, protected tags, approval settings, approval
  rules, push rules — because an approval rule scoped to a branch needs that branch protected before it can reference
  it.

  By default the config only adds and corrects what it declares. A section that sets "prune": true also deletes entries
  the config does not mention.

  One target failing does not abandon the rest; the summary says which ones failed and where they stopped. There is no
  transaction across GitLab endpoints, so a target that failed part-way keeps the sections already applied — run config
  plan afterwards to see what is left.

EXAMPLES
  $ simply gitlab config apply --config ./baseline.json --dry-run

  $ simply gitlab config apply --config ./baseline.json

  $ simply gitlab config apply --config ./baseline.json --target group/project

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.

  --concurrency=<value>  How many targets to work on at once.

    Small by default. The client already retries a rate-limited request with a capped Retry-After, so raising this
    trades a shared instance responsiveness for very little wall-clock time.

  --target=<value>...  Limit the run to this project path. Repeatable.

    Narrows a run without editing the config, for the loop of fixing one project and checking it again. Naming a project
    the config does not target is an error rather than a silent no-op.
```

_See code: [lib/commands/gitlab/config/apply.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/config/apply.js)_

## `simply gitlab config export`

Write a baseline config describing an existing project.

```
USAGE
  $ simply gitlab config export -p <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>]
    [--section settings|protectedBranches|protectedTags|approvals|approvalRules|pushRules|variables...]

FLAGS
  -p, --project=<value>      (required) [env: GITLAB_PROJECT] Project id, or its full path such as
                             group/subgroup/project.
      --section=<option>...  Comma-separated sections to export. Defaults to all of them.
                             <options:
                             settings|protectedBranches|protectedTags|approvals|approvalRules|pushRules|variables>

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Write a baseline config describing an existing project.

  Reads one project and prints a configuration file that describes it, ready to be edited and pointed at the rest of
  your projects. Writing a baseline by hand against forty attributes is miserable and the first draft is wrong;
  exporting the project that already looks right and deleting what you do not care about is the way to start.

  The output is deliberately verbose — every supported key, not a curated subset — because deleting a line is easier
  than discovering that a key exists. Variables are exported as metadata only: keys, scopes, and flags, never values.

  The exported targets name only the project it came from. Widen that on purpose rather than inheriting a blast radius
  from an export.

EXAMPLES
  $ simply gitlab config export --project group/project > baseline.json

  $ simply gitlab config export --project group/project --section settings,protectedBranches

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/config/export.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/config/export.js)_

## `simply gitlab config plan`

Report how projects differ from a baseline config.

```
USAGE
  $ simply gitlab config plan -c <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>] [--target
    <value>...] [--concurrency <value>] [--fail-fast] [--fail-on-drift]

FLAGS
  -c, --config=<value>       (required) Path to the baseline configuration file.
      --concurrency=<value>  [default: 4] How many targets to work on at once.
      --fail-fast            Stop at the first target that fails instead of continuing.
      --fail-on-drift        Exit 1 when any target differs from the baseline.
      --target=<value>...    Limit the run to this project path. Repeatable.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Report how projects differ from a baseline config.

  Reads the baseline, expands its targets, and prints what differs on each one. Nothing is sent that changes anything,
  so this is safe to run against every project you have.

  Only the attributes the config declares are compared. A project with forty settings the config never mentions shows
  nothing for them — that is what makes a baseline safe to point at projects that already exist.

  Entries that exist on the instance but are not in the config are shown as removals, marked as not pruned unless that
  section opts into pruning. Seeing what you are choosing not to fix is most of the value of running this across fifty
  projects.

  Use --fail-on-drift in a scheduled job: it exits 1 when anything differs, so CI can tell you that something drifted
  without anyone having to read the output.

EXAMPLES
  $ simply gitlab config plan --config ./baseline.json

  $ simply gitlab config plan --config ./baseline.json --target group/project

  $ simply gitlab config plan --config ./baseline.json --fail-on-drift

  $ simply gitlab config plan --config ./baseline.json --json | jq .summary

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.

  --concurrency=<value>  How many targets to work on at once.

    Small by default. The client already retries a rate-limited request with a capped Retry-After, so raising this
    trades a shared instance responsiveness for very little wall-clock time.

  --target=<value>...  Limit the run to this project path. Repeatable.

    Narrows a run without editing the config, for the loop of fixing one project and checking it again. Naming a project
    the config does not target is an error rather than a silent no-op.
```

_See code: [lib/commands/gitlab/config/plan.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/config/plan.js)_

## `simply gitlab file create`

Create a file in a repository.

```
USAGE
  $ simply gitlab file create -p <value> --path <value> --branch <value> --message <value> [--json] [-e <value>]
    [--gitlab-url <value>] [--gitlab-token <value>] [--dry-run] [--content <value> | --content-file <value>]
    [--start-branch <value>] [--author-email <value>] [--author-name <value>]

FLAGS
  -p, --project=<value>       (required) [env: GITLAB_PROJECT] Project id, or its full path such as
                              group/subgroup/project.
      --author-email=<value>  Commit author email.
      --author-name=<value>   Commit author name.
      --branch=<value>        (required) Branch to commit to.
      --content=<value>       File contents.
      --content-file=<value>  Path to a local file holding the contents.
      --dry-run               Print the request that would be sent and exit without sending it.
      --message=<value>       (required) Commit message.
      --path=<value>          (required) Path the file will have in the repository.
      --start-branch=<value>  Branch to create --branch from, if it does not exist.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Create a file in a repository.

  Commits one new file to a branch. GitLab refuses the request if the file already exists — use file update for that —
  and refuses it if the branch is protected and the token lacks the role to push to it. Use --dry-run to see exactly
  what would be sent.

EXAMPLES
  $ simply gitlab file create --project group/project --path docs/new.md --branch main --content-file ./new.md --message "docs: add page"

  $ simply gitlab file create --project group/project --path src/config.json --branch feature --content-file ./config.json --message "feat: add config" --dry-run

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/file/create.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/file/create.js)_

## `simply gitlab file update`

Replace a file in a repository.

```
USAGE
  $ simply gitlab file update -p <value> --path <value> --branch <value> --message <value> [--json] [-e <value>]
    [--gitlab-url <value>] [--gitlab-token <value>] [--dry-run] [--content <value> | --content-file <value>]
    [--start-branch <value>] [--last-commit-id <value>] [--author-email <value>] [--author-name <value>]

FLAGS
  -p, --project=<value>         (required) [env: GITLAB_PROJECT] Project id, or its full path such as
                                group/subgroup/project.
      --author-email=<value>    Commit author email.
      --author-name=<value>     Commit author name.
      --branch=<value>          (required) Branch to commit to.
      --content=<value>         New file contents.
      --content-file=<value>    Path to a local file holding the new contents.
      --dry-run                 Print the request that would be sent and exit without sending it.
      --last-commit-id=<value>  Reject the write if the file changed since this commit.
      --message=<value>         (required) Commit message.
      --path=<value>            (required) Path to the file within the repository.
      --start-branch=<value>    Branch to create --branch from, if it does not exist.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Replace a file in a repository.

  Commits new contents over an existing file. The whole file is replaced; there is no partial edit. Pass
  --last-commit-id with the value file view reported to have GitLab reject the write if someone else changed the file
  meanwhile, instead of silently overwriting them.

EXAMPLES
  $ simply gitlab file update --project group/project --path README.md --branch main --content-file ./README.md --message "docs: refresh readme"

  $ simply gitlab file update --project group/project --path README.md --branch main --content-file ./README.md --message "docs: refresh" --last-commit-id 9a1b2c3

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/file/update.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/file/update.js)_

## `simply gitlab file view`

Print a file from a repository.

```
USAGE
  $ simply gitlab file view -p <value> --path <value> --ref <value> [--json] [-e <value>] [--gitlab-url <value>]
    [--gitlab-token <value>] [--raw]

FLAGS
  -p, --project=<value>  (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.
      --path=<value>     (required) Path to the file within the repository.
      --raw              Print only the file contents, with no metadata header.
      --ref=<value>      (required) Branch, tag, or commit SHA to read from.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Print a file from a repository.

  Reads one file at a ref and writes its decoded contents to stdout, under a short metadata header. Use --raw for the
  contents alone, or --json for the API payload, whose "content" is base64 exactly as GitLab sends it.

  A binary file is not printed: its bytes would emit escape sequences to a terminal and noise to whatever reads this
  stream. The metadata still is, so you can see what was found.

EXAMPLES
  $ simply gitlab file view --project group/project --path src/index.ts --ref main

  $ simply gitlab file view --project group/project --path README.md --ref v1.2.0 --raw

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/file/view.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/file/view.js)_

## `simply gitlab mr create`

Open a merge request.

```
USAGE
  $ simply gitlab mr create -p <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>]
    [--dry-run] [--source-branch <value>] [--target-branch <value>] [--title <value>] [--description <value>] [--draft]
    [--squash] [--remove-source-branch] [--assignee-id <value>...] [--reviewer-id <value>...] [--labels <value>]
    [--milestone-id <value>] [--body <value> | --body-file <value>]

FLAGS
  -p, --project=<value>         (required) [env: GITLAB_PROJECT] Project id, or its full path such as
                                group/subgroup/project.
      --assignee-id=<value>...  User id to assign. Repeatable.
      --body=<value>            Raw JSON request body.
      --body-file=<value>       Path to a file holding the raw JSON request body.
      --description=<value>     Merge request description, as Markdown.
      --draft                   Open it as a draft.
      --dry-run                 Print the request that would be sent and exit without sending it.
      --labels=<value>          Comma-separated labels to apply.
      --milestone-id=<value>    Milestone id to attach.
      --remove-source-branch    Delete the source branch on merge.
      --reviewer-id=<value>...  User id to request review from. Repeatable.
      --source-branch=<value>   Branch holding the changes.
      --squash                  Squash the commits when it merges.
      --target-branch=<value>   Branch the changes are proposed for.
      --title=<value>           Merge request title.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Open a merge request.

  Both branches must already exist on the project. --draft prefixes the title with "Draft: ", which is how GitLab itself
  marks a draft; there is no separate field for it.

  Assignees and reviewers are numeric user ids, not usernames — GitLab accepts only ids here. --body or --body-file
  supplies raw JSON for anything the flags do not cover, such as approval rules. Use --dry-run to see exactly what would
  be sent.

EXAMPLES
  $ simply gitlab mr create --project group/project --source-branch feature --target-branch main --title "feat: the thing"

  $ simply gitlab mr create --project group/project --source-branch feature --target-branch main --title wip --draft --squash

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/mr/create.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/mr/create.js)_

## `simply gitlab mr list`

List merge requests for a project.

```
USAGE
  $ simply gitlab mr list -p <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>] [--limit
    <value>] [--state opened|closed|locked|merged|all] [--source-branch <value>] [--target-branch <value>]
    [--author-username <value>] [--reviewer-username <value>] [--labels <value>] [--search <value>]

FLAGS
  -p, --project=<value>            (required) [env: GITLAB_PROJECT] Project id, or its full path such as
                                   group/subgroup/project.
      --author-username=<value>    Only merge requests opened by this username.
      --labels=<value>             Comma-separated labels every result must carry.
      --limit=<value>              [default: 20] Maximum number of merge requests to return across all pages.
      --reviewer-username=<value>  Only merge requests this username is reviewing.
      --search=<value>             Match against the title and description.
      --source-branch=<value>      Only merge requests from this source branch.
      --state=<option>             [default: opened] Merge request state to return.
                                   <options: opened|closed|locked|merged|all>
      --target-branch=<value>      Only merge requests into this target branch.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List merge requests for a project.

  Defaults to open merge requests, which is what a list is nearly always for; pass --state all to include closed and
  merged ones. The IID column is the number to pass to the other mr commands — it is per-project, and is not the "id"
  field in the JSON payload.

EXAMPLES
  $ simply gitlab mr list --project group/project

  $ simply gitlab mr list --project group/project --state merged --target-branch main --limit 10

  $ simply gitlab mr list --project group/project --author-username someone --json

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/mr/list.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/mr/list.js)_

## `simply gitlab mr update`

Change an existing merge request.

```
USAGE
  $ simply gitlab mr update -p <value> --mr <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token
    <value>] [--dry-run] [--title <value>] [--description <value>] [--target-branch <value>] [--state close|reopen]
    [--squash] [--remove-source-branch] [--assignee-id <value>...] [--reviewer-id <value>...] [--labels <value>]
    [--milestone-id <value>] [--body <value> | --body-file <value>]

FLAGS
  -p, --project=<value>            (required) [env: GITLAB_PROJECT] Project id, or its full path such as
                                   group/subgroup/project.
      --assignee-id=<value>...     User id to assign, replacing the set. Repeatable.
      --body=<value>               Raw JSON request body.
      --body-file=<value>          Path to a file holding the raw JSON request body.
      --description=<value>        New description, as Markdown.
      --dry-run                    Print the request that would be sent and exit without sending it.
      --labels=<value>             Comma-separated labels, replacing the existing set.
      --milestone-id=<value>       Milestone id to attach.
      --mr=<value>                 (required) Merge request iid.
      --[no-]remove-source-branch  Delete the source branch on merge.
      --reviewer-id=<value>...     User id to review, replacing the set. Repeatable.
      --[no-]squash                Squash the commits when it merges.
      --state=<option>             Close or reopen the merge request.
                                   <options: close|reopen>
      --target-branch=<value>      New target branch.
      --title=<value>              New title.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Change an existing merge request.

  Only the attributes you name are changed, with one exception worth knowing: --labels replaces the whole label set
  rather than adding to it.

  Naming nothing to change is refused rather than sent, because GitLab answers an empty update with a cheerful 200 and
  an unchanged merge request. --state close and --state reopen do what the buttons of those names do; neither merges
  anything.

EXAMPLES
  $ simply gitlab mr update --project group/project --mr 42 --title "feat: renamed"

  $ simply gitlab mr update --project group/project --mr 42 --state close

  $ simply gitlab mr update --project group/project --mr 42 --labels backend,urgent --dry-run

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/mr/update.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/mr/update.js)_

## `simply gitlab mr view`

Show one merge request.

```
USAGE
  $ simply gitlab mr view -p <value> --mr <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token
    <value>]

FLAGS
  -p, --project=<value>  (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.
      --mr=<value>       (required) Merge request iid.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Show one merge request.

  Takes the project-scoped iid — the number in the merge request URL — not the instance-wide id. Use --json for the full
  payload, which carries the pipeline status, approvals, and diff refs the summary below leaves out.

EXAMPLES
  $ simply gitlab mr view --project group/project --mr 42

  $ simply gitlab mr view --project group/project --mr 42 --json

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/mr/view.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/mr/view.js)_

## `simply gitlab project list`

List projects you can see.

```
USAGE
  $ simply gitlab project list [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>] [--limit <value>]
    [--search <value>] [--membership] [--owned] [--simple]

FLAGS
  --limit=<value>   [default: 20] Maximum number of projects to return across all pages.
  --membership      Only projects you are a member of.
  --owned           Only projects you own.
  --search=<value>  Match against the project name and path.
  --simple          Return only the core fields, for a much smaller payload.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List projects you can see.

  Without --search this lists every project the token can reach, newest activity first, which on a large instance is not
  a useful answer — narrow it with --search or --membership. Use --simple for a much smaller payload when you only need
  ids and paths.

EXAMPLES
  $ simply gitlab project list --membership

  $ simply gitlab project list --search platform --limit 10

  $ simply gitlab project list --search platform --simple --json

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/project/list.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/project/list.js)_

## `simply gitlab project view`

Show one project.

```
USAGE
  $ simply gitlab project view -p <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>]

FLAGS
  -p, --project=<value>  (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Show one project.

  Accepts either the numeric id or the full path. Use --json for the complete, unmodified API payload, which carries far
  more than the summary below — permissions, statistics, and every feature toggle on the project.

EXAMPLES
  $ simply gitlab project view --project group/project

  $ simply gitlab project view --project 1234 --json

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/project/view.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/project/view.js)_

## `simply gitlab release list`

List releases for a project.

```
USAGE
  $ simply gitlab release list -p <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>] [--limit
    <value>]

FLAGS
  -p, --project=<value>  (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.
      --limit=<value>    [default: 20] Maximum number of releases to return across all pages.

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List releases for a project.

  Releases are tags with notes and assets attached, so a project can have many tags and no releases at all. Use --json
  for the release notes, asset links, and the commit each release points at.

EXAMPLES
  $ simply gitlab release list --project group/project

  $ simply gitlab release list --project group/project --limit 5 --json

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/release/list.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/release/list.js)_

## `simply gitlab search`

Search GitLab.

```
USAGE
  $ simply gitlab search --scope
    projects|issues|merge_requests|milestones|wiki_blobs|commits|blobs|notes|users|snippet_titles --query <value>
    [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>] [--limit <value>] [--project <value> | --group
    <value>]

FLAGS
  --group=<value>    Search within this group id or path.
  --limit=<value>    [default: 20] Maximum number of results to return across all pages.
  --project=<value>  Search within this project id or path.
  --query=<value>    (required) The search term.
  --scope=<option>   (required) What to search.
                     <options:
                     projects|issues|merge_requests|milestones|wiki_blobs|commits|blobs|notes|users|snippet_titles>

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Search GitLab.

  Searches the whole instance by default, or one project with --project, or one group with --group. These are three
  different GitLab endpoints, and they do not accept the same scopes: projects and users are instance-wide only, while a
  project search can look at notes.

  The blobs, commits, wiki_blobs, notes, and snippet_titles scopes need Advanced Search (Elasticsearch) enabled on the
  instance. Where it is not, GitLab answers with an empty list and a 200 rather than an error, so an empty result for
  one of those scopes is reported here as possibly meaning "not enabled" rather than "no matches".

EXAMPLES
  $ simply gitlab search --scope projects --query platform

  $ simply gitlab search --scope blobs --query UMCN_Account --project group/project

  $ simply gitlab search --scope merge_requests --query "flaky test" --group my-group --json

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/search.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/search.js)_

## `simply gitlab tag list`

List repository tags.

```
USAGE
  $ simply gitlab tag list -p <value> [--json] [-e <value>] [--gitlab-url <value>] [--gitlab-token <value>] [--limit
    <value>] [--search <value>] [--order-by name|updated|version] [--sort asc|desc]

FLAGS
  -p, --project=<value>    (required) [env: GITLAB_PROJECT] Project id, or its full path such as group/subgroup/project.
      --limit=<value>      [default: 20] Maximum number of tags to return across all pages.
      --order-by=<option>  Field to sort by.
                           <options: name|updated|version>
      --search=<value>     Return only tags whose name contains this term.
      --sort=<option>      Sort direction.
                           <options: asc|desc>

CONNECTION FLAGS
  -e, --env-file=<value>      Path to a .env file holding connection settings.
      --gitlab-token=<value>  [env: GITLAB_TOKEN] Personal, project, or group access token.
      --gitlab-url=<value>    [env: GITLAB_URL] Base URL of the GitLab instance. Defaults to https://gitlab.com.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List repository tags.

  Tags come back newest first by the commit date they point at. That is the commit date, not the tag creation date, so a
  tag cut today on an old commit sorts by the old commit — use --order-by name if you need a deterministic order
  instead.

EXAMPLES
  $ simply gitlab tag list --project group/project

  $ simply gitlab tag list --project group/project --search v1. --limit 50

FLAG DESCRIPTIONS
  -e, --env-file=<value>  Path to a .env file holding connection settings.

    Loaded before anything else. Variables already present in the environment win, so the file never overrides an
    explicit export, and only GitLab connection variables are read from it. A path that cannot be read is an error.
```

_See code: [lib/commands/gitlab/tag/list.js](https://github.com/SimplySF/simply-gitlab/blob/@simplysf/simply-gitlab@0.2.0/packages/simply-gitlab/lib/commands/gitlab/tag/list.js)_
<!-- commandsstop -->

## License

Apache-2.0.
