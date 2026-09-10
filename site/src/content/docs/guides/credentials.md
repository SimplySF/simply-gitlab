---
title: Credentials
description: How the Simply GitLab CLI finds its connection settings, which token scope to use, and how flags, environment variables, and an env file take precedence.
---

Connection settings come from environment variables, from flags, or from a `.env` file named with
`-e/--env-file`. Only GitLab connection variables are read from that file; anything else in it is
ignored.

```
GITLAB_TOKEN=glpat-...
GITLAB_URL=https://gitlab.example.com   # omit entirely for gitlab.com
```

There are only two settings, and one of them has a default — `GITLAB_URL` is `https://gitlab.com`
unless you say otherwise. A gitlab.com user needs the token and nothing else.

## Tokens and scopes

The token is a personal access token (**Preferences › Access tokens**), a project access token, or
a group access token. All three work the same way; the CLI sends whichever you give it as GitLab's
`PRIVATE-TOKEN` header.

| Scope      | Covers                                      |
| ---------- | ------------------------------------------- |
| `read_api` | Every read command on this site. No writes. |
| `api`      | Reads and writes.                           |

Prefer `read_api` and reach for `api` only when you mean to change something — see
[Write safety](/guides/write-safety/) for why that distinction carries more weight than it looks
like it should.

OAuth 2 tokens are not supported: GitLab accepts those only as `Authorization: Bearer`, and this
CLI runs no OAuth flow.

## Precedence

Explicit flags beat the environment, which beats the file's contents. That ordering is what makes
the two-file arrangement in [Write safety](/guides/write-safety/) work: a `read_api` file can be
the default, and a write-capable one is named explicitly for the one command that needs it.

```sh
simply gitlab mr list -e ~/gitlab.env --project group/project
simply gitlab mr update -e ~/gitlab-write.env --project group/project --mr 42 --state close
```

A variable exported as an empty string does not outrank the file. `export GITLAB_TOKEN=` in a
wrapper script would otherwise discard the real token and fail as though nothing were configured.

## Naming a project

Not a credential, but it belongs in the same shell profile. `GITLAB_PROJECT` sets the default for
`-p/--project`:

```sh
export GITLAB_PROJECT=group/subgroup/project
simply gitlab mr list
```

A project is named by numeric id or full path, and the path is URL-encoded for you.

## Self-managed instances

Set `GITLAB_URL` to the instance origin. A subpath is kept, because self-managed instances are
routinely served from one:

```
GITLAB_URL=https://example.com/gitlab
```

One thing to watch: pasting a **project** URL from gitlab.com — `https://gitlab.com/group/project`
— sets the instance, not the project. The CLI keeps only the origin in that case, since gitlab.com
has no subpath. On a self-managed host it cannot tell a subpath from a project path, so give it the
instance root and name the project with `--project`.

## Certificate verification

Certificate verification is always on. For an instance behind an internal or agency certificate
authority, trust that CA rather than disabling verification:

```sh
NODE_EXTRA_CA_CERTS=/path/to/ca.pem simply gitlab project list
```

A `GITLAB_SSL_VERIFY=false` carried over from other GitLab tooling is rejected with an error rather
than silently ignored, so nobody ends up believing verification is off when it is on, or the
reverse.

## Checking what you're connected as

There is no `whoami` command. The cheapest check is a list you expect to be non-empty:

```sh
simply gitlab project list --membership --limit 5
```

A wrong or expired token comes back as an authentication error with exit code `3`. A `403` on a
command that changes data says the token may be `read_api`-scoped, or that your role on the project
does not permit the change — so a refused write is distinguishable from a genuine permissions
problem.
