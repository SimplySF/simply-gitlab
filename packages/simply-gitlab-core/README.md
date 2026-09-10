# @simplysf/simply-gitlab-core

Configuration, authentication, the HTTP client, and the shared logic that
[`@simplysf/simply-gitlab`](../simply-gitlab) (the CLI) and
[`@simplysf/simply-gitlab-mcp`](../simply-gitlab-mcp) (the MCP server) are both built on.

Everything a command does between parsing its input and rendering its result lives here, so the CLI
and the MCP server cannot disagree about what a rule means. Nothing in this package touches a
terminal or a process: no oclif, no child processes, no `process.argv`, nothing written to stdout or
stderr. `process.env` is read only through an injectable `env` parameter.

You want this package directly if you are building something else against GitLab in TypeScript. If
you want a CLI or an MCP server, install one of those instead.

```sh
npm install @simplysf/simply-gitlab-core
```

## Usage

```ts
import { GitLabClient, resolveGitLabConfig } from '@simplysf/simply-gitlab-core';

// Reads GITLAB_URL (default https://gitlab.com) and GITLAB_TOKEN, and throws a ConfigError
// naming what is missing.
const client = new GitLabClient(resolveGitLabConfig());

// A project is named by numeric id or by full path; the path is encoded for you.
const project = await client.getProject('group/subgroup/project');

// Lists follow pages up to your limit and tell you whether they got everything.
const { items, total, complete } = await client.listMergeRequests('group/project', { state: 'opened' }, 50);
if (!complete) console.warn(`showing ${items.length} of ${total ?? 'many'}`);
```

## What is in here

**Configuration and auth** — `resolveGitLabConfig`, `buildAuthHeaders`, `loadEnvFile`.

**Transport** — `HttpTransport`, with retries on 429 and 5xx, a capped `Retry-After`, a 30s deadline
covering the response body, GitLab's bracketed array query parameters, a non-JSON mode for job
traces, and its offset-pagination headers.

**The client** — `GitLabClient`, which owns project-path encoding and page walking, and returns
`{ items, total?, pages, complete }` from every list.

**Errors** — `ConfigError` (exit 2), `AuthError` (3), `NetworkError` (1), `HttpError` (1), all
extending `CliError`.

**Safety** — `assertWritesAllowed`/`isReadOnly` for `GITLAB_READ_ONLY`; `redactSecrets` and
`sanitiseDeep` to keep a token out of any message or response body; `stripControl` and
`stripControlOneLine` for text the instance chose.

**Operations** — `assertIid`, `buildMergeRequestCreateBody`, `buildMergeRequestUpdateBody`,
`buildCommitBody`, `parseCommitActions`, `buildFileWrite`, `decodeFileContent`, `maskVariables`,
`tailLog`, `searchColumns`.

**Rendering** — `formatTable`, `formatKeyValue`, and the column sets each list command uses.

**Testing** — `@simplysf/simply-gitlab-core/testing` exports `startTestServer` and `respondJson`, a
tiny local HTTP server that records every request. Both other packages test against it.

## Stability

Every export from `src/index.ts` is semver-covered: adding one is a minor or patch change, removing
or renaming one is breaking. `test/index.test.ts` pins the list, so a removal fails a test rather
than shipping quietly in a patch.

## Documentation

- [GitLab client core design](../../docs/design/0001-gitlab-client-core.md)
- [Contributing](./CONTRIBUTING.md)

## License

Apache-2.0.
