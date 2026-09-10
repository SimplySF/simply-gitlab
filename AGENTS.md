# AGENTS.md

## Documentation map

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and the pull-request checklist.
Read [docs/design/README.md](docs/design/README.md) before changing a user-visible command,
shared module, authentication, or API behavior; it defines when a design document is required and
indexes the topic records.

Use the smallest relevant topic document rather than loading the whole directory:

- [GitLab client core](docs/design/0001-gitlab-client-core.md): configuration, authentication,
  HTTP behavior, pagination conventions, and how a project reference is encoded.
- [Migration from `gitlab-mcp`](docs/design/0002-migration-from-gitlab-mcp.md): what this repo was
  before, what was ported, what was deliberately dropped, and every behavior that changed.
- [Repository content](docs/design/0003-repository-content.md): projects, branches, tags, releases,
  files, and commits — including binary-file handling and commit-action validation.
- [Merge requests](docs/design/0004-merge-requests.md): the `iid` versus `id` trap, draft titles,
  and why an empty update is refused.
- [CI/CD](docs/design/0005-cicd-and-variable-values.md): job traces, environments, and the CI
  variable value policy — the one place the CLI and the MCP server deliberately differ.
- [Search](docs/design/0006-search.md): why `--project` selects an endpoint rather than a filter,
  and the Advanced Search caveat.
- [Configuration baselines](docs/design/0007-configuration-baselines.md) (Draft): the planned
  `gitlab config export/plan/apply` surface for holding many projects to one JSON baseline —
  the config shape, merge semantics, opt-in pruning, and why `apply` gets no MCP tool.

The package [README](packages/simply-gitlab/README.md) is the generated user-facing command
reference. Update command metadata first, then regenerate it as described in `CONTRIBUTING.md`.

The [docs site](site) in `site/` publishes that same reference plus four hand-written guides. Its
`reference/` pages are generated from the package README and are gitignored — never hand-edit them.
A guide that no longer matches `--help` is worse than no guide, so when you change credentials,
write safety, the `--json`/exit-code contract, or the MCP server, update the matching page under
`site/src/content/docs/guides/`. See "Documentation Site" in `CONTRIBUTING.md`.

## Working conventions

- **Implement functionality in `@simplysf/simply-gitlab-core` first, then expose it through both
  `simply-gitlab` (the CLI) and `simply-gitlab-mcp`.** The core package holds the behavior; the
  other two are thin surfaces over it. Putting logic in a command means the MCP server cannot reach
  it without a second implementation, and two implementations of the same rule drift.

  Both surfaces are closed allowlists, so exposing is a real step rather than something that happens
  for free: a CLI command declares its `flags`, and an MCP tool declares its `inputSchema`. A
  capability that lives in core and reaches only one of them is the failure worth checking for.
  There is exactly one deliberate exception, `--reveal` on `gitlab ci variable list`, and
  [0005](docs/design/0005-cicd-and-variable-values.md) explains why; a test pins it, so a second
  exception cannot appear by accident.

  Anything touching a terminal, a process, `process.argv`, stdout or stderr stays out of core.

- **GitLab's API is snake_case, and request and response objects are written the way the wire writes
  them.** The `camelcase` lint rule is configured with `properties: 'never'` for this. Our own
  identifiers and every function parameter stay camelCase; only object properties that mirror a
  GitLab field are exempt. Renaming its fields on the way in and back out again would mean two
  spellings for every attribute and a translation layer to keep in step.

- **A project is addressed by id or full path, and the path must be URL-encoded.** Use the client's
  methods rather than building a path by hand; `segment()` is what makes `group/project` reach the
  right route instead of a 404 with no explanation.

- **Anything the instance chose is untrusted text.** Merge request titles, commit messages, file
  contents, and job traces are all controlled by whoever can push or open a merge request. Print them
  through `logSafe`, never `this.log`. Error messages that interpolate a response body use
  `stripControlOneLine`, so a newline in a body cannot forge an extra stderr line.

- A new command, user-visible flag/output/error change, or new shared module needs a design document
  in `docs/design/` **before** implementation, following the process in
  [docs/design/README.md](docs/design/README.md). After landing, correct the doc to match what
  shipped and update its `Status` line and index row.

- Before calling a command or flag change finished, work through the "Pull Requests" checklist in
  `CONTRIBUTING.md`. Nothing local enforces two of its steps, so they are the ones most often
  skipped: run `pnpm run readme` in `packages/simply-gitlab` and commit the regenerated README, and
  run `pnpm run build` so `command-snapshot.json` regenerates and commit it. CI catches a stale
  snapshot but not a stale README.

- Every CLI command needs a matching MCP tool whose `command` names it.
  `packages/simply-gitlab-mcp/test/tools.test.ts` cross-checks the catalogue against
  `command-snapshot.json` in both directions, so adding a command without a tool fails CI.

- Command copy (summaries, descriptions, examples) lives inline as static class properties on the
  command classes. There is no `messages/*.md` convention here; SimplySF's Salesforce CLI repos use
  one via `@salesforce/core`, which does not apply to this project.
