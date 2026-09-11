# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.5.0](https://github.com/SimplySF/simply-gitlab/compare/%40simplysf%2Fsimply-gitlab%400.4.0...%40simplysf%2Fsimply-gitlab%400.5.0) (2026-09-10)

### Features

- **docs:** ship the guides in the packages, redirect the site ([#7](https://github.com/SimplySF/simply-gitlab/issues/7)) ([3968f7f](https://github.com/SimplySF/simply-gitlab/commit/3968f7f1e15ca04e3eddfb7cdfb5ea7609bc2d9a))

# [0.4.0](https://github.com/SimplySF/simply-gitlab/compare/%40simplysf%2Fsimply-gitlab%400.3.0...%40simplysf%2Fsimply-gitlab%400.4.0) (2026-09-10)

- feat!: become a plugin of the simply CLI (#5) ([7c40567](https://github.com/SimplySF/simply-gitlab/commit/7c40567ad94a1a4179c6684c99fb6661af1ab2a6)), closes [#5](https://github.com/SimplySF/simply-gitlab/issues/5)

### BREAKING CHANGES

- this package no longer provides the `simply` command. Install
  @simplysf/simply-cli instead; this plugin installs itself the first time one of
  its commands runs, or ahead of time with `simply plugins install
@simplysf/simply-gitlab`. Command names are unchanged — `simply gitlab ...` is
  exactly what it was.

  This package and @simplysf/simply-atlassian both declared bin: { simply }, so
  npm could only ever link one of them and the two could not be installed
  together. A single host now owns the name and both are plugins.

  Two changes make that work:

  - `bin` is removed, so nothing competes for the name.
  - `prepack` generates oclif.manifest.json, which is what the host reads out of
    this package's tarball to build its just-in-time manifest. Without it the host
    cannot discover these commands and the JIT install never fires. It also lets
    the CLI start without scanning every command file, which it never did before —
    the file was listed in `files` but nothing generated it.

  prepack compiles first. `oclif manifest` reads lib/commands, so a stale lib
  would otherwise ship a quietly incomplete manifest rather than failing.

# [0.3.0](https://github.com/SimplySF/simply-gitlab/compare/%40simplysf%2Fsimply-gitlab%400.2.0...%40simplysf%2Fsimply-gitlab%400.3.0) (2026-09-10)

### Features

- configuration baselines across many projects ([#4](https://github.com/SimplySF/simply-gitlab/issues/4)) ([316bb38](https://github.com/SimplySF/simply-gitlab/commit/316bb38bd7f6264831570ade0b15acddd108f004))

# 0.2.0 (2026-09-10)

### Features

- migrate gitlab-mcp into a CLI, MCP server, and core library ([b41495c](https://github.com/SimplySF/simply-gitlab/commit/b41495c4e595ffbeddf3f90864deab2949e948f1))
