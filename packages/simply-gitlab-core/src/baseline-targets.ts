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

import type { BaselineConfig } from './baseline-config.js';
import { ConfigError } from './errors.js';
import type { GitLabClient } from './gitlab-client.js';

/** One thing a run will act on. */
export interface ResolvedTarget {
  readonly kind: 'project' | 'group';
  /** Full path, as GitLab reports it — what overrides are keyed by, and what output names. */
  readonly path: string;
  readonly id: number;
}

export interface ResolvedTargets {
  readonly groups: readonly ResolvedTarget[];
  readonly projects: readonly ResolvedTarget[];
  /** Paths removed by an `exclude` pattern, so a run can say what it left out. */
  readonly excluded: readonly string[];
}

interface ProjectRow {
  readonly id?: unknown;
  readonly path_with_namespace?: unknown;
}

interface GroupRow {
  readonly id?: unknown;
  readonly full_path?: unknown;
}

/**
 * Matches an exclude pattern against a path. Only a trailing `*` is supported: it drops a subtree,
 * which is the case that comes up. A full glob language here would be a second thing to learn for
 * a file whose whole point is being obvious.
 */
export function matchesExclude(path: string, pattern: string): boolean {
  const lowered = path.toLowerCase();
  const wanted = pattern.trim().toLowerCase();
  if (wanted.endsWith('*')) return lowered.startsWith(wanted.slice(0, -1));
  return lowered === wanted;
}

function readProject(row: unknown): ProjectRow {
  return typeof row === 'object' && row !== null ? row : {};
}

/**
 * Turns the `targets` block into the concrete list a run will act on.
 *
 * A target the token cannot see is a hard error rather than a silent omission: a baseline that
 * quietly skipped six of fifty projects would be worse than one that refused to start, because the
 * six would stay wrong and nobody would know to look.
 */
export async function resolveTargets(
  client: GitLabClient,
  config: BaselineConfig,
  options: { readonly only?: readonly string[] } = {},
): Promise<ResolvedTargets> {
  const targets = config.targets;
  if (targets === undefined) {
    throw new ConfigError('The config declares no targets. Add a "targets" block naming groups or projects.');
  }

  const groups: ResolvedTarget[] = [];
  const byPath = new Map<string, ResolvedTarget>();
  const excluded = new Set<string>();
  const exclude = targets.exclude ?? [];

  const admit = (path: string, id: number): void => {
    if (exclude.some((pattern) => matchesExclude(path, pattern))) {
      excluded.add(path);
      return;
    }
    if (!byPath.has(path)) byPath.set(path, { kind: 'project', path, id });
  };

  /* Each group is a separate paged read; awaiting in sequence keeps the request rate predictable
     against an instance that is also serving everyone else. */
  /* eslint-disable no-await-in-loop */
  for (const reference of targets.groups ?? []) {
    const group = (await client.getGroup(reference).catch((error: unknown) => {
      throw new ConfigError(
        `Target group "${reference}" could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    })) as GroupRow;

    const path = typeof group.full_path === 'string' ? group.full_path : reference;
    const id = typeof group.id === 'number' ? group.id : 0;
    groups.push({ kind: 'group', path, id });

    const listed = await client.listGroupProjects(reference);
    for (const row of listed.items) {
      const project = readProject(row);
      if (typeof project.path_with_namespace === 'string' && typeof project.id === 'number') {
        admit(project.path_with_namespace, project.id);
      }
    }
    if (!listed.complete) {
      throw new ConfigError(
        `Group "${path}" has more projects than one run reads. Narrow it with subgroups or list the projects explicitly.`,
      );
    }
  }

  for (const reference of targets.projects ?? []) {
    const project = (await client.getProject(reference).catch((error: unknown) => {
      throw new ConfigError(
        `Target project "${reference}" could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    })) as ProjectRow;
    const path = typeof project.path_with_namespace === 'string' ? project.path_with_namespace : reference;
    const id = typeof project.id === 'number' ? project.id : 0;
    admit(path, id);
  }
  /* eslint-enable no-await-in-loop */

  let projects = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));

  // `--target` narrows a run without editing the file, for the loop of fixing one project and
  // re-checking it. Naming something the config does not target is a mistake worth reporting.
  if (options.only !== undefined && options.only.length > 0) {
    const wanted = new Set(options.only.map((path) => path.toLowerCase()));
    const matched = projects.filter((target) => wanted.has(target.path.toLowerCase()));
    const missing = [...wanted].filter((path) => !projects.some((target) => target.path.toLowerCase() === path));
    if (missing.length > 0) {
      throw new ConfigError(`--target named ${missing.join(', ')}, which this config does not target.`);
    }
    projects = matched;
  }

  return { groups, projects, excluded: [...excluded].sort() };
}
