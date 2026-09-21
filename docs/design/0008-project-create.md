# 0008 — Creating a project, from a template or blank

**Status:** Implemented
**Package:** all three
**Date:** 2026-09-21

## Problem

Every command in this CLI assumes the project already exists. Someone who wants a new repository —
most often one stamped out from a template so it starts with the right CI configuration, README,
and directory layout — has to leave the terminal for the web UI, click through the "Create from
template" flow, and come back. An agent driving the MCP server cannot do that at all.

GitLab's `POST /projects` covers this in one call, but the template half of it is spread across
four attributes with non-obvious rules:

| Attribute                         | Meaning                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `template_name`                   | A built-in template's name — or, with `use_custom_template`, a custom one    |
| `use_custom_template`             | Look the name up among custom templates rather than built-in ones            |
| `group_with_project_templates_id` | Which group's custom templates; empty means the instance-level group         |
| `template_project_id`             | A custom template by project id, which GitLab prefers over an ambiguous name |

`namespace_id` and both `*_id` attributes are integers, while everything else in this CLI addresses
a project or group by path. A caller who has `platform/templates` in front of them should not have
to look up its number first.

## Decision

One command, `gitlab project create`, with the matching MCP tool `gitlab_project_create`. The
template is optional: the same command creates a blank project, because forcing a second command for
that would mean two flag sets that drift. The body is built in core by `buildProjectCreateBody`, and
`prepareProjectCreate` resolves any path the caller gave for the namespace, template project, or
template group to its id before building — so both surfaces accept paths everywhere.

## Behavior

### Flags

| Flag                       | Sends                                                          | Notes                                                                                |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `--name`                   | `name`                                                         | One of `--name` or `--path` is required                                              |
| `--path`                   | `path`                                                         | GitLab derives one from the other when only one is given                             |
| `--namespace`              | `namespace_id`                                                 | Group or user namespace, by id or full path. Defaults to the token owner's namespace |
| `--description`            | `description`                                                  |                                                                                      |
| `--visibility`             | `visibility`                                                   | `private`, `internal`, or `public`                                                   |
| `--default-branch`         | `default_branch`                                               |                                                                                      |
| `--initialize-with-readme` | `initialize_with_readme`                                       | Gives a blank project a first commit                                                 |
| `--topics`                 | `topics`                                                       | Comma-separated                                                                      |
| `--template`               | `template_name`                                                | Built-in by default                                                                  |
| `--custom-template`        | `use_custom_template: true`                                    | Needs `--template`; looks it up among the instance's custom templates                |
| `--template-group`         | `use_custom_template: true`, `group_with_project_templates_id` | Needs `--template`; by id or full path                                               |
| `--template-project`       | `use_custom_template: true`, `template_project_id`             | By id or full path. Exclusive with `--template`                                      |
| `--body` / `--body-file`   | merged under the typed flags                                   | The same escape hatch `mr create` has                                                |
| `--dry-run`                | nothing                                                        | Prints the request body and sends nothing                                            |

### Rules checked before anything is sent

Each of these is a rule GitLab enforces too; checking them here means the refusal names the flag
rather than arriving as a 400 whose body says `name is missing`.

| Condition                                    | Error                                                      |
| -------------------------------------------- | ---------------------------------------------------------- |
| Neither `name` nor `path` in the merged body | `A project needs a name or a path: pass --name or --path.` |
| `--template` with `--template-project`       | `Pass --template or --template-project, not both.`         |
| `--template-group` without `--template`      | `--template-group needs --template: …`                     |
| `--custom-template` without `--template`     | `--custom-template needs --template: …`                    |

### Resolving paths to ids

`prepareProjectCreate` turns a `--namespace`, `--template-group`, or `--template-project` value into
the integer GitLab needs. A value that is already all digits is used as is. Anything else is looked
up — `GET /namespaces/:path`, `GET /groups/:path`, `GET /projects/:path` respectively — and the
`id` field of the answer is taken. A path that does not resolve surfaces as GitLab's own 404, which
names the path.

**`--dry-run` still performs those lookups.** They are reads, and the alternative — printing
`"namespace_id": "platform/apps"` — would show a body that could never be sent. A dry run with
only numeric ids issues no request at all, which is what the tests pin.

### Output

```
Created:        platform/apps/new-service
ID:             4711
Visibility:     private
Default branch: main
Import status:  scheduled
URL:            https://gitlab.example.com/platform/apps/new-service
```

`Import status` appears only when GitLab reports one. That is the detail worth knowing about
templates: **the template is applied asynchronously.** `POST /projects` answers as soon as the
project record exists, with `import_status: "scheduled"`, and the files arrive a few seconds later.
A caller that creates a project and immediately writes a file to it will race the import. The
command description says so and points at `project view`, whose payload carries `import_status`
until it reads `finished` or `failed`.

`--json` returns the API payload unchanged.

### The MCP tool

`gitlab_project_create` is a `write` tool, registered only with `--allow-writes`, with `dryRun` like
every other write. Its inputs mirror the flags in camelCase (`namespace`, `templateProject`,
`templateGroup`, `customTemplate`), and its description carries the asynchronous-import caveat, since
an agent that chains "create, then commit" is exactly the caller who hits it.

## Alternatives considered

**A separate `project create-from-template` command.** Two commands would share nine flags and
differ in three. Users would learn one and wonder why the other refuses `--template`. One command
with an optional template is the shape GitLab's own API has.

**Take only numeric ids for `--namespace` and friends.** Simpler to implement and no extra request,
but every other command here takes a path, and the CLI's own `project list` and `project view` print
paths first. Making a caller find a number for one flag out of the whole surface is the kind of
inconsistency that costs a lookup every time.

**Skip the lookups under `--dry-run`.** Keeps the "sends nothing" promise literal, but prints a
request that is not the one that would be sent. The point of a dry run is that the body is exact.

**Resolve paths in the client, inside `createProject`.** Would hide a GET inside a method named for
a POST, and the MCP tool would then have no way to preview the resolved body. Keeping resolution in
an operation lets both surfaces show the exact request.

**Infer `use_custom_template` from `--template` alone.** GitLab cannot tell a built-in name from a
custom one either — that is why the boolean exists. Guessing would make `--template rails` mean
different things on different instances.

**`--wait` to poll until the import finishes.** Genuinely useful for agents, and the reason
`import_status` is printed. Left out of the first version so the command lands without a polling
loop and a timeout policy; see Open questions.

## Implementation plan

1. `packages/simply-gitlab-core/src/gitlab-client.ts`: `createProject(body)` and `getNamespace(ref)`.
2. `packages/simply-gitlab-core/src/projects.ts`: `ProjectCreateInput`, `buildProjectCreateBody`,
   `resolveNamespaceId`/`resolveGroupId`/`resolveProjectId`, and `prepareProjectCreate`.
3. `packages/simply-gitlab-core/src/index.ts` and `README.md`: export and mention them.
4. `packages/simply-gitlab/src/commands/gitlab/project/create.ts`.
5. `packages/simply-gitlab-mcp/src/tools.ts`: `gitlab_project_create`.
6. Guides: `write-safety.md` and `mcp-server.md` count seven writes, not six.
7. Regenerate the CLI README and `command-snapshot.json`.

## Testing

- `buildProjectCreateBody`: maps typed input onto GitLab attribute names; sets `use_custom_template`
  for each of the three custom routes and never for a built-in template; merges typed input over a
  raw body; refuses a missing name and path, a template with a template project, and a group or
  custom flag without a template — each naming the flag.
- `prepareProjectCreate`: uses a numeric id as is without a request; resolves a namespace, group,
  and project path through the right endpoint; refuses an answer without an `id`.
- `GitLabClient`: `createProject` POSTs to `/projects` with the body as given; `getNamespace`
  URL-encodes a path.
- CLI: `--dry-run` with numeric ids sends nothing and returns the body; a template group path is
  resolved even under `--dry-run`; the real call POSTs and prints the summary; `GITLAB_READ_ONLY`
  refuses it (the shared guard, covered by the existing safety test on `isWrite`).
- MCP: `gitlab_project_create` is in the pinned write list; the catalogue cross-check passes.

## Open questions

- **`--wait`.** Poll `GET /projects/:id` until `import_status` leaves `scheduled`/`started`, with a
  ceiling. Worth adding once someone hits the race in practice; the output already exposes what
  they would need to poll on.
- **Listing templates.** `GET /templates/…` and `GET /groups/:id/projects?…` could back a
  `project template list`, so a caller can discover names before creating. Not needed to create.
