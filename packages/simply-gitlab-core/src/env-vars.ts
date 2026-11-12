/*
 * Copyright (c) 2026, SimplySF.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { EnvLike } from './config.js';

/**
 * Every environment variable this project reads, mapped to the unprefixed name it replaced.
 *
 * The `SIMPLY_` prefix exists because the unprefixed names are shared with other GitLab tooling
 * (`GITLAB_TOKEN` and `GITLAB_URL` are what glab, CI scripts, and most GitLab MCP servers read), so
 * a shell configured for one tool silently configured this one too. See
 * docs/design/0012-simply-env-prefix.md.
 *
 * The legacy names still work while the prefixed name is unset, and every use of one is reported
 * by {@link deprecatedEnvWarning}. They will be removed in a future major release.
 *
 * `SIMPLY_GITLAB_PROJECT` is read only by the CLI's `--project` flag, not by this package; it is
 * listed so the rename and its warning live in one place.
 */
export const LEGACY_ENV = {
  SIMPLY_GITLAB_URL: 'GITLAB_URL',
  SIMPLY_GITLAB_TOKEN: 'GITLAB_TOKEN',
  SIMPLY_GITLAB_SSL_VERIFY: 'GITLAB_SSL_VERIFY',
  SIMPLY_GITLAB_READ_ONLY: 'GITLAB_READ_ONLY',
  SIMPLY_GITLAB_PROJECT: 'GITLAB_PROJECT',
} as const;

/** A current, `SIMPLY_`-prefixed variable name. */
export type EnvName = keyof typeof LEGACY_ENV;

/** The names a consumer without a `--project` flag, such as the MCP server, actually reads. */
export const CONNECTION_ENV: readonly EnvName[] = [
  'SIMPLY_GITLAB_URL',
  'SIMPLY_GITLAB_TOKEN',
  'SIMPLY_GITLAB_SSL_VERIFY',
  'SIMPLY_GITLAB_READ_ONLY',
];

const ALL_ENV = Object.keys(LEGACY_ENV) as EnvName[];

function present(value: string | undefined): value is string {
  // An empty export carries no value, matching how `loadEnvFile` treats one.
  return value !== undefined && value !== '';
}

/**
 * Reads a setting: the prefixed name when it has a value, otherwise the deprecated unprefixed one.
 * The prefixed name always wins, so a legacy variable left behind for another tool cannot override
 * a setting made for this one.
 */
export function envValue(env: EnvLike, name: EnvName): string | undefined {
  const current = env[name];
  if (present(current)) return current;
  const legacy = env[LEGACY_ENV[name]];
  return present(legacy) ? legacy : current;
}

/**
 * The deprecated names this environment is actually relying on, among `names`: set, with the
 * prefixed name unset. A legacy name shadowed by its prefixed one is not reported — it is most
 * likely there for another tool, and this project already ignores it.
 */
export function deprecatedEnvInUse(
  env: EnvLike,
  names: readonly EnvName[] = ALL_ENV,
): Array<{ readonly legacy: string; readonly current: EnvName }> {
  return names
    .filter((current) => !present(env[current]) && present(env[LEGACY_ENV[current]]))
    .map((current) => ({ legacy: LEGACY_ENV[current], current }));
}

/**
 * One line naming each deprecated variable in use and its replacement, or `undefined` when there
 * are none. Returned rather than written, so each surface reports it on its own diagnostic channel.
 */
export function deprecatedEnvWarning(env: EnvLike, names: readonly EnvName[] = ALL_ENV): string | undefined {
  const inUse = deprecatedEnvInUse(env, names);
  if (inUse.length === 0) return undefined;
  const renames = inUse.map(({ legacy, current }) => `${legacy} → ${current}`).join(', ');
  return (
    `Deprecated environment variable${inUse.length === 1 ? '' : 's'} in use: ${renames}. ` +
    'Rename to the SIMPLY_ prefix; the unprefixed names will stop working in a future major release.'
  );
}
