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

import type { Action, BaselinePlan, TargetPlan } from './baseline-plan.js';
import { mapPool, type RunOptions, DEFAULT_CONCURRENCY } from './baseline-run.js';
import { ConfigError } from './errors.js';
import type { GitLabClient, ProjectRef } from './gitlab-client.js';

/** What executing one target's plan amounted to. */
export interface TargetResult {
  readonly path: string;
  readonly kind: 'project' | 'group';
  readonly applied: number;
  /** Set when execution stopped part-way; the actions before it are already applied. */
  readonly error?: string;
  /** The section that failed, so a partial application can be described precisely. */
  readonly failedSection?: string;
}

export interface ApplyResult {
  readonly targets: readonly TargetResult[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
}

/**
 * Resolves the name-based references an approval rule carries into the ids the API demands.
 *
 * This has to happen here rather than at plan time. A rule scoped to `main` needs that branch's
 * protection id, and the protected-branches section that creates it runs moments earlier in this
 * same apply — so at plan time the id does not exist yet.
 */
async function resolveRuleReferences(
  client: GitLabClient,
  ref: ProjectRef,
  body: Record<string, unknown>,
  branches: readonly string[] | undefined,
  groups: readonly string[] | undefined,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = { ...body };

  if (branches !== undefined && branches.length > 0) {
    const protectedBranches = (await client.listProtectedBranches(ref)).items.map(asRecord);
    const byName = new Map(protectedBranches.map((branch) => [String(branch.name), branch.id]));
    const ids: number[] = [];
    for (const name of branches) {
      const id = byName.get(name);
      if (typeof id !== 'number') {
        throw new ConfigError(
          `Approval rule references protected branch "${name}", which is not protected on this project. ` +
            'Declare it under protectedBranches so it exists before the rule is written.',
        );
      }
      ids.push(id);
    }
    resolved.protected_branch_ids = ids;
  }

  if (groups !== undefined && groups.length > 0) {
    const ids: number[] = [];
    /* Each group is one lookup; there are rarely more than a couple on a rule. */
    /* eslint-disable no-await-in-loop */
    for (const path of groups) {
      const group = asRecord(await client.getGroup(path));
      if (typeof group.id !== 'number') {
        throw new ConfigError(`Approval rule references group "${path}", which could not be resolved to an id.`);
      }
      ids.push(group.id);
    }
    /* eslint-enable no-await-in-loop */
    resolved.group_ids = ids;
  }

  return resolved;
}

/** Executes one action. Split out so the switch stays exhaustive as actions are added. */
async function execute(client: GitLabClient, target: TargetPlan, action: Action): Promise<void> {
  const ref = target.path;
  switch (action.kind) {
    case 'updateProject':
      await client.updateProject(ref, action.body);
      return;
    case 'updateGroup':
      await client.updateGroup(ref, action.body);
      return;
    case 'protectBranch':
      await client.protectBranch(ref, action.body);
      return;
    case 'patchProtectedBranch':
      await client.patchProtectedBranch(ref, action.name, action.body);
      return;
    case 'unprotectBranch':
      await client.unprotectBranch(ref, action.name);
      return;
    case 'protectTag':
      await client.protectTag(ref, action.body);
      return;
    case 'unprotectTag':
      await client.unprotectTag(ref, action.name);
      return;
    case 'updateApprovalSettings':
      await client.updateApprovalSettings(ref, action.body);
      return;
    case 'createApprovalRule': {
      const groups = Array.isArray(action.body.groups) ? (action.body.groups as string[]) : undefined;
      const body = await resolveRuleReferences(client, ref, action.body, action.branches, groups);
      await client.createApprovalRule(ref, body);
      return;
    }
    case 'updateApprovalRule': {
      const groups = Array.isArray(action.body.groups) ? (action.body.groups as string[]) : undefined;
      const body = await resolveRuleReferences(client, ref, action.body, action.branches, groups);
      await client.updateApprovalRule(ref, action.ruleId, body);
      return;
    }
    case 'deleteApprovalRule':
      await client.deleteApprovalRule(ref, action.ruleId);
      return;
    case 'setPushRules':
      // POST creates the rule set, PUT edits it. Which one applies was decided at plan time from
      // whether the project already had push rules.
      if (action.exists) await client.updatePushRules(ref, action.body);
      else await client.createPushRules(ref, action.body);
      return;
    default: {
      const exhaustive: never = action;
      throw new ConfigError(`Unknown action ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Executes one target's plan, in the order the sections were planned.
 *
 * There is no transaction across GitLab endpoints and this does not pretend otherwise: a failure
 * part-way leaves the earlier sections applied, and the result says which section stopped it so a
 * following `plan` can be read against that.
 */
export async function applyTarget(client: GitLabClient, target: TargetPlan): Promise<TargetResult> {
  let applied = 0;

  for (const section of target.sections) {
    for (const action of section.actions) {
      try {
        // eslint-disable-next-line no-await-in-loop -- order across sections is the contract
        await execute(client, target, action);
        applied += 1;
      } catch (error) {
        return {
          path: target.path,
          kind: target.kind,
          applied,
          failedSection: section.section,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  return { path: target.path, kind: target.kind, applied };
}

/**
 * Executes a whole plan.
 *
 * One target failing does not abandon the other forty-nine — that is the default, because a run
 * that stopped at the twelfth project would leave the operator worse off than one that reported
 * twelve successes and one failure. `--fail-fast` is there for the systematic problem where the
 * rest are pointless.
 */
export async function applyPlan(
  client: GitLabClient,
  plan: BaselinePlan,
  options: RunOptions = {},
): Promise<ApplyResult> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  // A target that failed to plan is not applied: acting on a half-read project is how a baseline
  // makes things worse than it found them.
  const runnable = plan.targets.filter((target) => target.error === undefined);
  const unplanned: TargetResult[] = plan.targets
    .filter((target) => target.error !== undefined)
    .map((target) => ({ path: target.path, kind: target.kind, applied: 0, error: target.error }));

  const groups = runnable.filter((target) => target.kind === 'group');
  const projects = runnable.filter((target) => target.kind === 'project');
  const stopAfter =
    options.failFast === true ? (result: TargetResult): boolean => result.error !== undefined : undefined;

  // Groups first: a group setting that projects inherit should be in place before the projects are
  // reconciled against it.
  const groupResults = await mapPool(groups, concurrency, (target) => applyTarget(client, target), stopAfter);

  const projectResults =
    options.failFast === true && groupResults.some((result) => result.error !== undefined)
      ? []
      : await mapPool(projects, concurrency, (target) => applyTarget(client, target), stopAfter);

  return { targets: [...unplanned, ...groupResults, ...projectResults] };
}

/** How many targets an apply failed on, for the exit code. */
export function applyFailures(result: ApplyResult): readonly TargetResult[] {
  return result.targets.filter((target) => target.error !== undefined);
}
