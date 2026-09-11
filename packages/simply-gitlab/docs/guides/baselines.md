---
title: Configuration baselines
description: Hold many GitLab projects to one standard - export a baseline from a project you like, see what differs across the rest, and converge them.
---

Fifty projects drift. One was created before you settled on squash merges, someone unprotected
`main` to fix something and never put it back, and two never had an approval rule at all. There is
no answer to "are these the same?" short of opening fifty tabs.

A baseline is a JSON file saying what those projects should have in common, and three commands that
read it:

| Command                       | Writes? | What it does                                         |
| ----------------------------- | ------- | ---------------------------------------------------- |
| `simply gitlab config export` | no      | Emits a config from a project you already like       |
| `simply gitlab config plan`   | no      | Reports, per project, what differs from the baseline |
| `simply gitlab config apply`  | yes     | Converges each project onto the baseline             |

## Start by exporting

Do not write the file by hand. Export the project that already looks right and delete what you do
not care about:

```sh
simply gitlab config export --project group/api > baseline.json
```

The output is deliberately verbose — every supported key, not a curated subset — because deleting a
line is easier than discovering that a key exists. Variables come out as metadata only: keys,
scopes, and flags, never values.

## Point it at the rest

The exported file targets only the project it came from. Widen it on purpose:

```json
{
  "version": 1,
  "targets": {
    "groups": ["platform"],
    "exclude": ["platform/sandbox", "platform/archived-*"]
  },
  "project": {
    "settings": {
      "merge_method": "ff",
      "squash_option": "default_on",
      "only_allow_merge_if_pipeline_succeeds": true
    },
    "protectedBranches": [{ "name": "main", "allow_force_push": false }],
    "approvalRules": [{ "name": "Two maintainers", "approvals_required": 2, "usernames": ["alice", "bob"] }]
  }
}
```

`targets.groups` expands through subgroups. `exclude` takes a trailing `*` to drop a whole subtree.
A project the token cannot see is a hard error, not a silent omission — a baseline that quietly
skipped six of fifty would leave those six wrong with nobody knowing to look.

## Read the plan

```sh
simply gitlab config plan --config ./baseline.json
```

```
Targets: 50 project(s), 1 group(s).

platform/api
  settings
    ~ merge_method  merge → ff
    ~ only_allow_merge_if_pipeline_succeeds  false → true
  protectedBranches
    ~ main.allow_force_push  true → false
    - legacy   (not pruned; set "prune": true on this section to remove it)

platform/worker
  ✓ matches the baseline

50 target(s): 31 match, 19 differ.
```

Three things in that output are worth understanding.

**Only what you declared is compared.** A project with forty settings the config never mentions
shows nothing for them. That is what makes a baseline safe to point at projects that already exist:
the blast radius is the set of keys you wrote down.

**Drift you are not fixing is still shown.** `- legacy` is a protected branch that exists but is not
in the config. By default nothing is deleted, and the line says so. Seeing what you are choosing not
to correct is most of the value of running this across fifty projects.

**A section can come back unsupported.** Approval rules, approval settings, and push rules are
Premium/Ultimate. On an instance without them the section reports that and the rest still converges.

## Apply it

```sh
simply gitlab config apply --config ./baseline.json --dry-run   # prints the plan, sends nothing
simply gitlab config apply --config ./baseline.json
```

Apply executes exactly what the plan showed — the two are computed in one pass, so a preview is a
guarantee rather than an approximation. A second run against a converged project sends no requests
at all.

Sections are applied in a fixed order: settings, protected branches, protected tags, approval
settings, approval rules, push rules. That order exists because an approval rule scoped to `main`
needs `main` protected before it can reference it.

One project failing does not abandon the other forty-nine. There is no transaction across GitLab
endpoints, so a project that fails part-way keeps the sections already applied; the summary says
where it stopped, and `plan` afterwards shows what is left.

## Per-project exceptions

`overrides` is keyed by project path:

```json
"overrides": {
  "platform/legacy-api": {
    "project": {
      "settings": { "merge_method": "merge" },
      "approvalRules": [{ "name": "Two maintainers", "approvals_required": 1 }]
    }
  }
}
```

Lists merge by a natural key — `name` for branches, tags, and rules; `key` plus `environment_scope`
for variables — so an override adjusts one entry rather than restating the array. The rule above
changes one number and inherits the usernames from the baseline.

Set `"$replace": true` on a section to swap the list wholesale instead, for the project that needs
genuinely different rules rather than adjusted ones.

## Turning on pruning

By default the config adds and corrects; it never deletes. When you are ready for a section to be
authoritative, opt in:

```json
"protectedBranches": {
  "prune": true,
  "entries": [{ "name": "main", "allow_force_push": false }]
}
```

Now an undeclared protected branch is removed. Adopt this section by section, after `plan` has shown
you what it would take away — a first run against fifty existing projects with everything pruning
could remove protections that predate the config.

## Checking for drift in CI

```sh
simply gitlab config plan --config ./baseline.json --fail-on-drift
```

Exits `1` when anything differs, so a scheduled job tells you something drifted without anyone
reading the output. `--json` returns the whole plan as structured data if you would rather track it
over time:

```sh
simply gitlab config plan --config ./baseline.json --json | jq '.summary'
```

## CI/CD variables are reported, not written

The config can declare which variables must exist and what flags they carry. `plan` reports the ones
that are missing or wrong; `apply` does not touch them.

That is the API, not caution. Creating a variable requires a value, and so does updating one — even
to change `masked` from false to true. A variable created as `masked_and_hidden` will not return its
value at all. There is no honest way to reconcile secrets from a file that, by design, holds none.

Knowing that six projects are missing `DEPLOY_ENV` is still the question people actually ask; setting
it is a person's job.

## From an agent

The MCP server exposes `gitlab_config_plan` and `gitlab_config_export`, so you can ask an agent
"which of our projects are missing the two-approval rule?" and get an answer.

There is deliberately no tool that applies a baseline. Changing settings across fifty projects is a
deployment, not a tool call, and belongs to a person with the plan in front of them. An agent that
should apply one can run the CLI, where it is a shell command you can see and approve. See the
[MCP server guide](/guides/mcp-server/).
