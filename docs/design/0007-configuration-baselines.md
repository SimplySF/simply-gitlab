# 0007 — Project and group configuration baselines

**Status:** Implemented (PR #4)
**Package:** all three
**Date:** 2026-09-10

## Problem

Someone maintaining 50 GitLab projects has no way to state what those projects should have in common
and then make it so. Every setting that matters — the merge method, whether a pipeline must pass
before merge, which branches are protected and by whom, how many approvals a merge request needs,
the build timeout — is per-project, reachable only through that project's settings page or a
one-off API call.

The result is drift that nobody sees. A project created last year has `merge_method: merge` while
everything else squashes. Someone unprotected `main` to fix something and never put it back. Two of
the fifty never had an approval rule at all. There is no answer to "are these the same?" short of
opening fifty tabs, and no way to fix what you find short of fifty more.

The commands this CLI already has make each of those checks possible one project at a time. That is
the wrong unit of work for the problem.

## Decision

A JSON file states the desired baseline. Three commands read it:

| Command                       | Kind  | What it does                                                 |
| ----------------------------- | ----- | ------------------------------------------------------------ |
| `simply gitlab config export` | read  | Emits a config file from a project or group you already like |
| `simply gitlab config plan`   | read  | Reports, per target, what differs from the baseline          |
| `simply gitlab config apply`  | write | Converges each target onto the baseline                      |

The config is a **baseline, not a full description**. It declares a subset of settings; everything
it does not mention is left exactly as it is. That is what makes it usable against fifty live
projects on day one: the blast radius is the set of keys you wrote down.

The engine — parsing, merging, diffing, and converging — lives in
`@simplysf/simply-gitlab-core`. The CLI exposes all three commands. The MCP server exposes `plan`
and `export` and **not** `apply`, for the reason in [The MCP surface](#the-mcp-surface).

## Behavior

### The configuration file

```json
{
  "$schema": "https://simplysf.github.io/simply-gitlab/schema/baseline-v1.json",
  "version": 1,

  "targets": {
    "groups": ["platform", "platform/services"],
    "projects": ["tools/one-off"],
    "exclude": ["platform/sandbox", "platform/archived-*"]
  },

  "group": {
    "settings": {
      "default_branch_protection_defaults": { "allowed_to_push": [{ "access_level": 40 }] },
      "prevent_forking_outside_group": true
    }
  },

  "project": {
    "settings": {
      "merge_method": "ff",
      "squash_option": "default_on",
      "only_allow_merge_if_pipeline_succeeds": true,
      "only_allow_merge_if_all_discussions_are_resolved": true,
      "remove_source_branch_after_merge": true,
      "ci_config_path": ".gitlab/ci.yml",
      "build_timeout": 3600,
      "keep_latest_artifact": true
    },
    "protectedBranches": [
      {
        "name": "main",
        "allowed_to_push": [{ "access_level": 0 }],
        "allowed_to_merge": [{ "access_level": 30 }],
        "allow_force_push": false,
        "code_owner_approval_required": true
      },
      { "name": "release/*", "allowed_to_push": [{ "access_level": 40 }], "allow_force_push": false }
    ],
    "protectedTags": [{ "name": "v*", "create_access_level": 40 }],
    "approvals": {
      "reset_approvals_on_push": true,
      "disable_overriding_approvers_per_merge_request": true,
      "merge_requests_author_approval": false
    },
    "approvalRules": [
      {
        "name": "Two maintainers",
        "approvals_required": 2,
        "usernames": ["alice", "bob"],
        "groups": ["platform/maintainers"],
        "protectedBranches": ["main"]
      }
    ],
    "pushRules": { "prevent_secrets": true, "reject_unsigned_commits": false },
    "variables": [{ "key": "DEPLOY_ENV", "environment_scope": "production", "protected": true, "masked": true }]
  },

  "overrides": {
    "platform/legacy-api": {
      "project": {
        "settings": { "merge_method": "merge" },
        "approvalRules": [{ "name": "Two maintainers", "approvals_required": 1 }]
      }
    }
  }
}
```

Field names inside each section are GitLab's own, unchanged. Renaming them would mean maintaining a
translation table against an API that adds fields between releases, and would make GitLab's own
documentation stop applying to this file. The exceptions are the three places the config accepts a
human-readable reference where the API demands a numeric id — `approvalRules[].groups`,
`approvalRules[].protectedBranches`, and target paths — which is the whole point of a portable
baseline and is covered in [Reference resolution](#reference-resolution).

Plain JSON, no comments. A published JSON Schema gives an editor completion, validation, and hover
documentation, which is what comments would otherwise be for.

### Targeting

`targets.groups` expands to every project in the group **and its subgroups**. `targets.projects`
adds individual projects by path or id. `targets.exclude` removes from the union, and accepts a
trailing `*` glob so a whole subtree can be dropped.

Expansion happens at plan time and the resolved list is printed, because "which fifty projects is
this about to touch" is the first question anyone should ask and the last one they should have to
guess at. A target the token cannot see is a hard error, not a silent omission — a baseline that
quietly skipped six projects would be worse than one that failed.

`--target <path>` on any of the three commands narrows a run to one project without editing the
file, for the loop of fixing one project and re-checking it.

### Merge semantics

Effective config for a project is `project` deep-merged with `overrides[<path>].project`.

Objects merge key by key. Arrays merge **by natural key**, so an override can adjust one entry
without restating the rest:

| Section             | Key                         |
| ------------------- | --------------------------- |
| `protectedBranches` | `name`                      |
| `protectedTags`     | `name`                      |
| `approvalRules`     | `name`                      |
| `variables`         | `key` + `environment_scope` |

An override entry whose key matches merges into the baseline entry; one that does not is appended.
`"$replace": true` on an array section replaces it wholesale instead, for the project that genuinely
needs different rules rather than adjusted ones.

Restating a whole array to change one number is how these files rot: the fifty-first project gets a
copy-paste that misses the change everyone else got. Keyed merge is the reason overrides stay two
lines long.

### What each section reconciles

| Section             | Endpoint                                           | Update mechanism                       |
| ------------------- | -------------------------------------------------- | -------------------------------------- |
| `settings`          | `PUT /projects/:id`                                | Partial — only sent attributes change  |
| `protectedBranches` | `POST` / `PATCH` / `DELETE .../protected_branches` | `PATCH` in place; `POST` when absent   |
| `protectedTags`     | `POST` / `DELETE .../protected_tags`               | No update: delete and recreate         |
| `approvals`         | `POST /projects/:id/approvals`                     | Partial                                |
| `approvalRules`     | `POST` / `PUT` / `DELETE .../approval_rules`       | `PUT` by rule id                       |
| `pushRules`         | `POST` / `PUT /projects/:id/push_rule`             | `PUT` when one exists, `POST` when not |
| `variables`         | read only — see below                              | —                                      |

Two of those deserve their own note.

**Protected branches support `PATCH`**, which matters more than it sounds. Without it the only way
to change protection would be `DELETE` then `POST`, leaving a window in which `main` is unprotected
and anyone can force-push to it. `PATCH` covers `allow_force_push`, `allowed_to_push`,
`allowed_to_merge`, `allowed_to_unprotect`, and `code_owner_approval_required` — everything the
config declares except the name. Renaming is therefore not an update; it is a delete and a create,
and `plan` labels it as such so nobody discovers the window by accident.

**Protected tags have no update endpoint.** A change to a tag protection is a delete followed by a
create, which `plan` shows as two operations rather than one, for the same reason.

**`PUT /projects/:id` is a partial update** — attributes not sent are unchanged. GitLab's
documentation does not say so outright, so this is pinned by a test against a recorded response
rather than taken on trust. If it were ever a full replace, this whole design would be unsafe, so it
is worth a test that fails loudly.

### Reference resolution

Three things in the config are written the way a person thinks about them and have to become ids
before they reach the API:

- **Target paths** → project ids. Resolved once, at expansion.
- **`approvalRules[].groups`** (group paths) → `group_ids`. The approval-rule API accepts
  `usernames` directly, so users need no resolution; groups have no equivalent.
- **`approvalRules[].protectedBranches`** (branch names) → `protected_branch_ids`.

The last one creates an ordering dependency inside a single project: a rule scoped to `main` cannot
be created until `main` is protected and its protection has an id. So sections are reconciled in a
fixed order — settings, protected branches, protected tags, approval settings, approval rules, push
rules — and the protected-branch ids are read back after that section runs rather than assumed.

An unresolvable reference is a plan-time failure for that target, reported with the path or name
that could not be found. It is not deferred to apply, because the point of `plan` is to be told
before anything happens.

### `plan`

Reads the desired state and the actual state and prints the difference. Never writes.

```sh
simply gitlab config plan --config ./baseline.json
```

```
platform/api
  settings
    ~ only_allow_merge_if_pipeline_succeeds   false → true
    ~ squash_option                           default_off → default_on
  protectedBranches
    + main                                    push: no one, merge: developer, code owner approval
    ~ release/*  allow_force_push             true → false
  approvalRules
    ~ Two maintainers  approvals_required     1 → 2

platform/worker
  ✓ matches the baseline

platform/legacy-api
  ! approvalRules                             unsupported on this instance (403)

50 projects: 31 match, 18 differ, 1 partially unsupported.
```

Only declared keys are compared. A project with forty settings the config never mentions shows
nothing for them.

`--fail-on-drift` exits `1` when anything differs, which is the form a scheduled CI job wants.
`--json` returns the whole plan as a structured document — targets, sections, and per-key
`{ from, to }` — so drift can be tracked over time rather than eyeballed.

### `apply`

Runs the same plan, then executes it.

```sh
simply gitlab config apply --config ./baseline.json
```

`--dry-run` prints the plan and sends nothing, identical to `plan`, because every write command in
this CLI takes `--dry-run` and one that quietly did not would be the exception that gets someone.

Apply is idempotent by construction: it sends only what the diff found, so a second run against a
converged project sends no requests at all.

**Pruning is opt-in and per section.** By default the config adds and corrects what it declares and
ignores everything else, so the first run against fifty live projects cannot remove a protection
nobody meant to lose. `"prune": true` on a section makes the config authoritative for that section,
and undeclared entries are deleted:

```json
"protectedBranches": { "prune": true, "entries": [ ... ] }
```

That is a second shape for a section that would otherwise be a bare array, and the schema accepts
both. `plan` shows prospective deletions as `- name` whether or not pruning is on — with pruning
off they are labelled `(not pruned)`, so the drift is visible even when it will not be corrected.
Seeing what you are not fixing is most of the value of running this against fifty projects.

### `export`

Reads a project or group and emits a config file describing it.

```sh
simply gitlab config export --project platform/api > baseline.json
```

Writing a baseline by hand against forty settings is miserable and the first draft would be wrong.
Exporting the project that already looks right and deleting what you do not care about is the way
anyone will actually start.

`--section settings,protectedBranches` narrows the output. Variables are exported as metadata only,
never values. The output is deliberately verbose — every supported key, not a curated subset —
because deleting a line is easier than discovering a key exists.

### Execution across many targets

Fifty projects is enough that the shape of the run matters.

- **Bounded concurrency**, default 4, `--concurrency` to change it. The transport already retries
  429 with a capped `Retry-After`, so the failure mode of setting this too high is slowness rather
  than errors — but a shared instance has other users.
- **Continue on failure.** One project failing does not abandon the other 49. `--fail-fast` stops at
  the first failure for the case where a systematic problem means the rest are pointless.
- **A summary at the end**, and a non-zero exit if anything failed. Exit `1` for any target failure,
  `2` for a config or usage error, as everywhere else in this CLI.
- **Per-target isolation.** A failure part-way through a project leaves the earlier sections applied.
  There is no transaction across GitLab endpoints and pretending otherwise would be a lie; `plan`
  after a partial failure shows exactly what is left.

### Tier and capability handling

`approvalRules`, `approvals`, `pushRules`, and per-user/group protected-branch access are
Premium/Ultimate. A `403` or `404` reading one of those is reported as `unsupported on this
instance` for that section and does not fail the target — the other sections still converge.

The projects this is being built for are Premium, so this is robustness rather than a headline
feature. It costs one branch in the reader and means a Free instance added later degrades instead of
erroring.

### CI/CD variables are report-only

`plan` reports variables the config declares that do not exist, and existing ones whose
`protected`, `masked`, `variable_type`, or `environment_scope` differs. `apply` does not touch them.

The reason is in the API, not in caution. `POST` requires a `value`, so a missing variable cannot be
created without inventing a secret — and creating a credential with an empty string is worse than
leaving it absent, because a job would then run with it. `PUT` also requires a `value`, so even
correcting `masked: false → true` on an existing variable means resending the secret. Reading it
back first is possible for an ordinary variable and **impossible** for one created with
`masked_and_hidden`, whose value `GET` does not return.

So there is no honest way to reconcile variables from a config that, by design, contains no values.
Reporting the drift is genuinely useful — "these six projects are missing `DEPLOY_ENV`" is the
question people ask — and fixing it is a person's job. Correcting flags in place, by reading a value
into memory and writing it straight back without ever printing it, is a coherent follow-up, but it
puts a live secret through this process for the first time and deserves its own decision rather than
riding along in this one.

Variables with the same key in different environment scopes are addressed with the API's `filter`
parameter, which is why `environment_scope` is part of their merge key.

### The MCP surface

Two read tools, `gitlab_config_plan` and `gitlab_config_export`. **No apply tool.**

Plan and export are exactly what an agent is good at here: "which of our projects are missing the
two-approval rule?" is a question worth asking an agent, and the answer is a read.

Apply is one call that changes settings across fifty projects. That is not a tool; it is a
deployment. The person running it should have the plan output in front of them, which is precisely
what the CLI gives them and what a tool call does not. This is the same judgement as `--reveal` in
[0005](0005-cicd-and-variable-values.md), and it gets the same treatment: `test/tools.test.ts`
asserts that no tool's `command` is `['gitlab', 'config', 'apply']`, so the absence is pinned rather
than merely intended.

An agent that should apply a baseline can run the CLI, where it is a shell command a person can see
and approve, rather than a tool call inside a loop.

## Alternatives considered

**Use Terraform's GitLab provider.** It does this, properly, with real state. It is also a second
tool, a state file to store and lock, and a language to learn, for a team whose actual question is
"are these fifty projects the same?". It is the right answer for a team already running Terraform,
and this design should not pretend to beat it — the doc should say so. What this offers instead is
no state file, no provider version to pin, and the same binary and credentials as the rest of this
CLI. The absence of state is a real trade: without it, "delete what I previously created" is
unanswerable, which is exactly why pruning has to be declared in the config rather than inferred.

**Store desired state and reconcile against it.** A state file would make pruning automatic and
renames tractable. It would also make this tool own a file that must not be lost, and turn a
read-only `plan` into something that can be wrong because the state is stale. GitLab is the state;
reading it every time is slower and always true.

**YAML instead of JSON.** Comments alone would nearly justify it. The request was JSON, a schema
gives editors the affordances comments would have provided, and JSON means no new dependency. Worth
revisiting if the file grows past what people will tolerate un-commented.

**One `sync` command instead of `plan`/`apply`.** Fewer commands, but it conflates "tell me" with
"do it", and the whole safety argument here rests on those being separate acts. `--dry-run` on a
single `apply` would technically cover it; two named commands make the read-only one the obvious
first thing to run.

**Rename GitLab's fields to something friendlier.** `only_allow_merge_if_pipeline_succeeds` is a
mouthful. Renaming it means a mapping table to maintain against an API that adds attributes between
releases, and it means GitLab's own documentation no longer describes this file. Verbose and
accurate beats tidy and divergent.

**Make the config fully authoritative.** The strongest drift guarantee, and the right end state for
a team that has adopted this. It is the wrong default for the first run against fifty projects that
already exist, where it would delete protections that predate the config. Per-section `prune` lets a
team get there deliberately, section by section, once `plan` has shown them what it would remove.

**Manage variable values through the config.** Rejected on the API facts above, and it would put
production credentials in a file that ends up in a repo — against the position
[0005](0005-cicd-and-variable-values.md) already takes.

## Implementation plan

Phased so each lands with tests and is useful on its own.

**Phase 1 — read the world.** Client methods and types for every endpoint in the table above, plus
group project expansion. `test/gitlab-client.test.ts` grows a case per endpoint against the local
test server. Nothing user-visible yet.

**Phase 2 — the config.** `baseline-config.ts` in core: parse, validate against the schema, resolve
targets, and merge baseline with overrides. Pure functions over plain data, so the merge semantics
above are unit-testable without a server. Publish the JSON Schema to the docs site.

**Phase 3 — `export`.** The first user-visible command, and the cheapest: read one project, emit
config. It proves the reader and the shape of the file before anything can write.

**Phase 4 — `plan`.** `baseline-plan.ts`: per-section diff producing a structured plan document, and
a renderer for it. `--json`, `--fail-on-drift`, target expansion, concurrency, and the
capability/unsupported path. This is the half of the feature that carries most of the value, and it
cannot break anything.

**Phase 5 — `apply`.** `baseline-apply.ts`: execute a plan, in the fixed section order, with
`--dry-run`, per-section `prune`, continue-on-failure, and the summary. `isWrite = true`, so the
existing `GITLAB_READ_ONLY` guard covers it with no new code.

**Phase 6 — MCP.** `gitlab_config_plan` and `gitlab_config_export`, plus the test asserting `apply`
has no tool.

**Phase 7 — docs.** A `site/src/content/docs/guides/baselines.md` guide — writing a first config by
exporting, reading a plan, adopting pruning — and a `GROUPS` entry so
`simply gitlab config *` gets a reference page.

## Open questions

- **Group-level variables and approval rules.** The `group` section covers group settings in v1.
  Group-level variables have the same value problem as project ones; group approval rules are marked
  experimental in GitLab's own documentation. Both are deferred until the project surface is proven.
- **Renames.** Changing a protected branch's `name` in the config reads as "delete one, create
  another", which for `main` is a genuine unprotect window. `plan` labels it; whether `apply` should
  refuse it without an explicit flag is worth deciding before Phase 5.
- **How many projects is too many.** Fifty is fine. Five hundred means the plan output stops being
  readable and the run stops being interactive. A `--summary-only` mode and a resumable run may
  become necessary; neither is needed yet, and designing for them now would be guessing.
