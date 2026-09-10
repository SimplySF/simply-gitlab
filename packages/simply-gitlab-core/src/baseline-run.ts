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

import { type BaselineConfig, effectiveGroup, effectiveProject } from './baseline-config.js';
import { type BaselinePlan, planGroup, planProject, type TargetPlan } from './baseline-plan.js';
import { resolveTargets, type ResolvedTargets } from './baseline-targets.js';
import { ConfigError } from './errors.js';
import type { GitLabClient } from './gitlab-client.js';

/** How a run is paced and how it reacts to a target failing. */
export interface RunOptions {
  /**
   * How many targets are in flight at once. Small on purpose: the transport already retries 429
   * with a capped Retry-After, so setting this high trades a shared instance's responsiveness for
   * very little wall-clock.
   */
  readonly concurrency?: number;
  /** Stop at the first target that fails, for when a systematic problem makes the rest pointless. */
  readonly failFast?: boolean;
  /** Narrow the run to these project paths without editing the config. */
  readonly only?: readonly string[];
}

export const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;

export interface PlannedRun {
  readonly targets: ResolvedTargets;
  readonly plan: BaselinePlan;
}

/**
 * Runs `worker` over `items` with at most `limit` in flight, preserving input order in the result.
 *
 * A pool rather than `Promise.all` in chunks: with fifty targets of uneven size, chunking waits for
 * the slowest project in each batch before starting the next, which is most of the run.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  /** Return true to stop scheduling further items. Those already in flight still finish. */
  stopAfter?: (result: R) => boolean,
): Promise<R[]> {
  const results: Array<{ index: number; value: R }> = [];
  let next = 0;
  let stopped = false;

  const run = async (): Promise<void> => {
    for (;;) {
      if (stopped) return;
      const index = next++;
      if (index >= items.length) return;
      // eslint-disable-next-line no-await-in-loop -- one worker handles its items in sequence
      const value = await worker(items[index], index);
      results.push({ index, value });
      if (stopAfter?.(value) === true) stopped = true;
    }
  };

  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, () => run()));

  // Input order, not completion order: a plan that listed fifty projects in a different order on
  // every run would be unreadable as a diff between runs.
  return results.sort((a, b) => a.index - b.index).map(({ value }) => value);
}

function resolveConcurrency(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CONCURRENCY;
  if (!Number.isInteger(value) || value < 1 || value > MAX_CONCURRENCY) {
    throw new ConfigError(`--concurrency must be a whole number between 1 and ${MAX_CONCURRENCY}, got ${value}.`);
  }
  return value;
}

/**
 * Resolves the targets and plans every one of them.
 *
 * Groups are planned before projects, matching the order `apply` writes them in: a group setting
 * that projects inherit should be in place before the projects are looked at.
 */
export async function planRun(
  client: GitLabClient,
  config: BaselineConfig,
  options: RunOptions = {},
): Promise<PlannedRun> {
  const concurrency = resolveConcurrency(options.concurrency);
  const targets = await resolveTargets(client, config, { only: options.only });

  const stopAfter = options.failFast === true ? (result: TargetPlan): boolean => result.error !== undefined : undefined;

  const groupPlans = await mapPool(
    targets.groups,
    concurrency,
    (target) => planGroup(client, target, effectiveGroup(config, target.path)),
    stopAfter,
  );

  // A group that could not be planned under --fail-fast stops the run before any project is read.
  const projectPlans =
    options.failFast === true && groupPlans.some((group) => group.error !== undefined)
      ? []
      : await mapPool(
          targets.projects,
          concurrency,
          (target) => planProject(client, target, effectiveProject(config, target.path)),
          stopAfter,
        );

  return { targets, plan: { targets: [...groupPlans, ...projectPlans] } };
}

/** What a plan or an apply amounted to, for the closing summary and the exit code. */
export interface RunSummary {
  readonly targets: number;
  readonly matching: number;
  readonly differing: number;
  readonly failed: number;
  readonly unsupported: number;
}

export function summarise(plan: BaselinePlan): RunSummary {
  let matching = 0;
  let differing = 0;
  let failed = 0;
  let unsupported = 0;

  for (const target of plan.targets) {
    if (target.error !== undefined) {
      failed += 1;
      continue;
    }
    if (target.sections.some((section) => !section.supported)) unsupported += 1;
    if (target.sections.some((section) => section.changes.length > 0)) differing += 1;
    else matching += 1;
  }

  return { targets: plan.targets.length, matching, differing, failed, unsupported };
}

/** Targets that could not be planned or applied, for reporting before the exit code. */
export function failures(plan: BaselinePlan): readonly TargetPlan[] {
  return plan.targets.filter((target) => target.error !== undefined);
}
