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

import {
  type Entry,
  entryKey,
  entryLabel,
  type GroupDesired,
  type ListSection,
  normalizeSection,
  type ProjectDesired,
} from './baseline-config.js';
import { AuthError, HttpError } from './errors.js';
import type { GitLabClient, ProjectRef } from './gitlab-client.js';

/**
 * What a run would do, computed before anything is sent.
 *
 * A plan carries two views of the same decision: `changes`, which is what a person reads, and
 * `actions`, which is what `apply` executes. They are produced together, by one pass, so apply can
 * only ever do what plan showed — the alternative, re-deriving the work at apply time, is how a
 * preview stops being a guarantee.
 */
export interface BaselinePlan {
  readonly targets: readonly TargetPlan[];
}

export interface TargetPlan {
  readonly kind: 'project' | 'group';
  readonly path: string;
  readonly id: number;
  readonly sections: readonly SectionPlan[];
  /** Set when the whole target could not be planned; its sections are then empty. */
  readonly error?: string;
}

export interface SectionPlan {
  readonly section: string;
  /** False when the instance does not offer this section — a Premium feature on a Free plan. */
  readonly supported: boolean;
  /** Why it is unsupported, for the plan output. */
  readonly unsupportedReason?: string;
  readonly changes: readonly Change[];
  readonly actions: readonly Action[];
}

export type ChangeOp = 'create' | 'update' | 'delete' | 'recreate' | 'report';

export interface Change {
  readonly op: ChangeOp;
  /** What changed: an attribute name for `update`, an entry's identity otherwise. */
  readonly key: string;
  readonly from?: unknown;
  readonly to?: unknown;
  /** Extra context a reader needs — why a recreate, or why a delete is not being executed. */
  readonly detail?: string;
}

/** One request `apply` will make. Opaque to the renderer; executed by `baseline-apply.ts`. */
export type Action =
  | { readonly kind: 'updateProject'; readonly body: Record<string, unknown> }
  | { readonly kind: 'updateGroup'; readonly body: Record<string, unknown> }
  | { readonly kind: 'protectBranch'; readonly body: Record<string, unknown> }
  | { readonly kind: 'patchProtectedBranch'; readonly name: string; readonly body: Record<string, unknown> }
  | { readonly kind: 'unprotectBranch'; readonly name: string }
  | { readonly kind: 'protectTag'; readonly body: Record<string, unknown> }
  | { readonly kind: 'unprotectTag'; readonly name: string }
  | { readonly kind: 'updateApprovalSettings'; readonly body: Record<string, unknown> }
  | {
      readonly kind: 'createApprovalRule';
      readonly body: Record<string, unknown>;
      readonly branches?: readonly string[];
    }
  | {
      readonly kind: 'updateApprovalRule';
      readonly ruleId: number;
      readonly body: Record<string, unknown>;
      readonly branches?: readonly string[];
    }
  | { readonly kind: 'deleteApprovalRule'; readonly ruleId: number }
  | { readonly kind: 'setPushRules'; readonly body: Record<string, unknown>; readonly exists: boolean };

/** Whether a plan would change anything if applied. */
export function hasChanges(plan: BaselinePlan): boolean {
  return plan.targets.some((target) => target.error !== undefined || target.sections.some((s) => s.actions.length > 0));
}

/** Every drift a plan found, including the parts it would not correct. */
export function hasDrift(plan: BaselinePlan): boolean {
  return plan.targets.some((target) => target.error !== undefined || target.sections.some((s) => s.changes.length > 0));
}

/**
 * `PATCH` on a protected branch cannot change fields the config does not resend, and neither the
 * approval-rule nor the branch APIs echo their inputs in the same shape they accept them. So
 * comparison is by JSON value on the fields the config declares, and nothing else is looked at.
 */
function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

/** Sorts object keys so two equivalent objects compare equal regardless of key order. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normalize(v)]),
    );
  }
  return value;
}

/**
 * Diffs the attributes a config declares against what the instance reports, ignoring everything
 * else. This is the whole reason a baseline is safe to run against projects that already exist:
 * the blast radius is the set of keys someone wrote down.
 */
function diffAttributes(
  desired: Readonly<Record<string, unknown>>,
  actual: Readonly<Record<string, unknown>>,
): { readonly changes: Change[]; readonly body: Record<string, unknown> } {
  const changes: Change[] = [];
  const body: Record<string, unknown> = {};
  for (const [key, want] of Object.entries(desired)) {
    const have = actual[key];
    if (!sameValue(want, have)) {
      changes.push({ op: 'update', key, from: have, to: want });
      body[key] = want;
    }
  }
  return { changes, body };
}

function asRecord(value: unknown): Record<string, unknown> {
  return (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
}

function supported(section: string, changes: Change[], actions: Action[]): SectionPlan {
  return { section, supported: true, changes, actions };
}

function unsupported(section: string, reason: string): SectionPlan {
  return { section, supported: false, unsupportedReason: reason, changes: [], actions: [] };
}

/**
 * Runs a read that may not be available on this instance.
 *
 * Approval rules, approval settings, and push rules are Premium/Ultimate. A 403 or 404 there means
 * the section does not exist rather than that the run failed, so the other sections still converge
 * and the plan says which one was skipped and why.
 */
async function readOptional<T>(
  read: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return { ok: false, reason: 'not available to this token, or not on this plan (403)' };
    }
    if (error instanceof HttpError && error.status === 404) {
      return { ok: false, reason: 'not available on this instance (404)' };
    }
    throw error;
  }
}

// --- Section planners ---------------------------------------------------------------------------

async function planSettings(client: GitLabClient, ref: ProjectRef, desired: ProjectDesired): Promise<SectionPlan[]> {
  if (desired.settings === undefined) return [];
  const actual = asRecord(await client.getProject(ref));
  const { changes, body } = diffAttributes(desired.settings, actual);
  return [supported('settings', changes, changes.length === 0 ? [] : [{ kind: 'updateProject', body }])];
}

/**
 * Protected branches, which are the one section where the update mechanism materially changes what
 * a plan means. `PATCH` corrects a protection in place; a rename cannot be patched, so it reads as
 * a delete and a create — and that pair leaves the branch unprotected in between, which the plan
 * labels rather than leaving anyone to discover.
 */
async function planProtectedBranches(
  client: GitLabClient,
  ref: ProjectRef,
  desired: ProjectDesired,
): Promise<SectionPlan[]> {
  const section = normalizeSection(desired.protectedBranches);
  if (section === undefined) return [];

  const actual = (await client.listProtectedBranches(ref)).items.map(asRecord);
  return [
    planKeyedSection('protectedBranches', section, actual, {
      create: (entry) => ({ kind: 'protectBranch', body: { ...entry } }),
      update: (entry, body) => ({ kind: 'patchProtectedBranch', name: String(entry.name), body }),
      remove: (entry) => ({ kind: 'unprotectBranch', name: String(entry.name) }),
    }),
  ];
}

/** Protected tags have no update endpoint, so a change is a delete and a create, and says so. */
async function planProtectedTags(
  client: GitLabClient,
  ref: ProjectRef,
  desired: ProjectDesired,
): Promise<SectionPlan[]> {
  const section = normalizeSection(desired.protectedTags);
  if (section === undefined) return [];

  const actual = (await client.listProtectedTags(ref)).items.map(asRecord);
  return [
    planKeyedSection('protectedTags', section, actual, {
      create: (entry) => ({ kind: 'protectTag', body: { ...entry } }),
      update: (entry) => ({ kind: 'protectTag', body: { ...entry } }),
      remove: (entry) => ({ kind: 'unprotectTag', name: String(entry.name) }),
      recreate: 'protected tags have no update endpoint, so this is a delete and a create',
      beforeUpdate: (entry) => ({ kind: 'unprotectTag', name: String(entry.name) }),
    }),
  ];
}

async function planApprovals(client: GitLabClient, ref: ProjectRef, desired: ProjectDesired): Promise<SectionPlan[]> {
  if (desired.approvals === undefined) return [];
  const read = await readOptional(() => client.getApprovalSettings(ref));
  if (!read.ok) return [unsupported('approvals', read.reason)];

  const { changes, body } = diffAttributes(desired.approvals, asRecord(read.value));
  return [supported('approvals', changes, changes.length === 0 ? [] : [{ kind: 'updateApprovalSettings', body }])];
}

/**
 * Approval rules, where the config speaks in names and the API speaks in ids.
 *
 * `usernames` the API takes directly. Group paths and protected-branch names it does not, so those
 * are carried on the action and resolved at apply time — the branch ids in particular cannot be
 * resolved now, because the branch may be created by the section that runs immediately before this
 * one.
 */
async function planApprovalRules(
  client: GitLabClient,
  ref: ProjectRef,
  desired: ProjectDesired,
): Promise<SectionPlan[]> {
  const section = normalizeSection(desired.approvalRules);
  if (section === undefined) return [];

  const read = await readOptional(() => client.listApprovalRules(ref));
  if (!read.ok) return [unsupported('approvalRules', read.reason)];

  const actual = read.value.items.map(asRecord);
  const byName = new Map(actual.map((rule) => [String(rule.name), rule]));
  const changes: Change[] = [];
  const actions: Action[] = [];

  for (const entry of section.entries) {
    const name = String(entry.name);
    const branches = Array.isArray(entry.protectedBranches) ? (entry.protectedBranches as string[]) : undefined;
    const body = ruleBody(entry);
    const existing = byName.get(name);

    if (existing === undefined) {
      changes.push({ op: 'create', key: name, to: summarise(entry) });
      actions.push({ kind: 'createApprovalRule', body, branches });
      continue;
    }

    const attributeChanges = compareRule(entry, existing);
    if (attributeChanges.length > 0) {
      changes.push(...attributeChanges.map((change) => ({ ...change, key: `${name}.${change.key}` })));
      actions.push({ kind: 'updateApprovalRule', ruleId: Number(existing.id), body, branches });
    }
  }

  const declared = new Set(section.entries.map((entry) => String(entry.name)));
  for (const rule of actual) {
    const name = String(rule.name);
    // `any_approver` is GitLab's implicit fallback rule, not something a config declared or should
    // delete; pruning it would remove the project's default approval behaviour.
    if (declared.has(name) || rule.rule_type === 'any_approver') continue;
    changes.push({
      op: 'delete',
      key: name,
      detail: section.prune ? undefined : 'not pruned; set "prune": true on this section to remove it',
    });
    if (section.prune) actions.push({ kind: 'deleteApprovalRule', ruleId: Number(rule.id) });
  }

  return [supported('approvalRules', changes, actions)];
}

/** The rule attributes the API accepts, with the config's name-based references left off. */
function ruleBody(entry: Entry): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'protectedBranches' || key === 'groups') continue;
    body[key] = value;
  }
  return body;
}

/** Compares only what the config declared, translating its name-based fields onto the payload. */
function compareRule(entry: Entry, actual: Record<string, unknown>): Change[] {
  const changes: Change[] = [];
  for (const [key, want] of Object.entries(entry)) {
    if (key === 'name') continue;
    if (key === 'usernames') {
      const have = (Array.isArray(actual.eligible_approvers) ? actual.eligible_approvers : [])
        .map((user) => asRecord(user).username)
        .filter((username): username is string => typeof username === 'string');
      if (!sameValue([...(want as string[])].sort(), [...have].sort())) {
        changes.push({ op: 'update', key, from: have, to: want });
      }
      continue;
    }
    if (key === 'groups') {
      const have = (Array.isArray(actual.groups) ? actual.groups : [])
        .map((group) => asRecord(group).full_path)
        .filter((path): path is string => typeof path === 'string');
      if (!sameValue([...(want as string[])].sort(), [...have].sort())) {
        changes.push({ op: 'update', key, from: have, to: want });
      }
      continue;
    }
    if (key === 'protectedBranches') {
      const have = (Array.isArray(actual.protected_branches) ? actual.protected_branches : [])
        .map((branch) => asRecord(branch).name)
        .filter((name): name is string => typeof name === 'string');
      if (!sameValue([...(want as string[])].sort(), [...have].sort())) {
        changes.push({ op: 'update', key, from: have, to: want });
      }
      continue;
    }
    if (!sameValue(want, actual[key])) changes.push({ op: 'update', key, from: actual[key], to: want });
  }
  return changes;
}

async function planPushRules(client: GitLabClient, ref: ProjectRef, desired: ProjectDesired): Promise<SectionPlan[]> {
  if (desired.pushRules === undefined) return [];
  const read = await readOptional(() => client.getPushRules(ref));
  if (!read.ok) return [unsupported('pushRules', read.reason)];

  // A project with no push rules answers 200 with null rather than 404.
  const existing = read.value !== null && read.value !== undefined;
  const { changes, body } = diffAttributes(desired.pushRules, asRecord(read.value));
  return [
    supported('pushRules', changes, changes.length === 0 ? [] : [{ kind: 'setPushRules', body, exists: existing }]),
  ];
}

/**
 * Variables are reported, never written.
 *
 * Both POST and PUT require a `value`, and a `masked_and_hidden` variable's value is not even
 * readable, so there is no honest way to reconcile them from a config that by design holds no
 * values. Naming which projects are missing a key is still the question people actually ask.
 */
async function planVariables(client: GitLabClient, ref: ProjectRef, desired: ProjectDesired): Promise<SectionPlan[]> {
  const section = normalizeSection(desired.variables);
  if (section === undefined) return [];

  const read = await readOptional(() => client.listVariables(ref, 200));
  if (!read.ok) return [unsupported('variables', read.reason)];

  const actual = read.value.items.map(asRecord);
  const byKey = new Map(actual.map((variable) => [entryKey('variables', variable), variable]));
  const changes: Change[] = [];

  for (const entry of section.entries) {
    const existing = byKey.get(entryKey('variables', entry));
    const label = entryLabel('variables', entry);
    if (existing === undefined) {
      changes.push({ op: 'report', key: label, detail: 'missing; create it with a value by hand' });
      continue;
    }
    for (const [attribute, want] of Object.entries(entry)) {
      if (attribute === 'key' || attribute === 'environment_scope') continue;
      if (!sameValue(want, existing[attribute])) {
        changes.push({
          op: 'report',
          key: `${label}.${attribute}`,
          from: existing[attribute],
          to: want,
          detail: 'cannot be corrected without resending the value',
        });
      }
    }
  }

  // Deliberately no `actions`: this section never writes, whatever `prune` says.
  return [supported('variables', changes, [])];
}

/** A short description of an entry, for a create line in the plan. */
function summarise(entry: Entry): string {
  return Object.entries(entry)
    .filter(([key]) => key !== 'name')
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join(', ');
}

interface KeyedHandlers {
  readonly create: (entry: Entry) => Action;
  readonly update: (entry: Entry, body: Record<string, unknown>) => Action;
  readonly remove: (entry: Entry) => Action;
  /** Present when a change is really a delete and a create, which the plan then explains. */
  readonly recreate?: string;
  readonly beforeUpdate?: (entry: Entry) => Action;
}

/** The shared shape of every keyed list section: create what is missing, correct what differs. */
function planKeyedSection(
  section: ListSection,
  desired: { readonly prune: boolean; readonly entries: readonly Entry[] },
  actual: ReadonlyArray<Record<string, unknown>>,
  handlers: KeyedHandlers,
): SectionPlan {
  const byKey = new Map(actual.map((item) => [entryKey(section, item), item]));
  const changes: Change[] = [];
  const actions: Action[] = [];

  for (const entry of desired.entries) {
    const key = entryKey(section, entry);
    const label = entryLabel(section, entry);
    const existing = byKey.get(key);

    if (existing === undefined) {
      changes.push({ op: 'create', key: label, to: summarise(entry) });
      actions.push(handlers.create(entry));
      continue;
    }

    const declared = Object.fromEntries(Object.entries(entry).filter(([field]) => field !== 'name'));
    const { changes: attributeChanges, body } = diffAttributes(declared, existing);
    if (attributeChanges.length === 0) continue;

    if (handlers.recreate !== undefined) {
      changes.push(
        ...attributeChanges.map((change) => ({ ...change, key: `${label}.${change.key}`, detail: handlers.recreate })),
      );
      if (handlers.beforeUpdate) actions.push(handlers.beforeUpdate(entry));
      actions.push(handlers.update(entry, body));
    } else {
      changes.push(...attributeChanges.map((change) => ({ ...change, key: `${label}.${change.key}` })));
      actions.push(handlers.update(entry, body));
    }
  }

  const declaredKeys = new Set(desired.entries.map((entry) => entryKey(section, entry)));
  for (const item of actual) {
    const key = entryKey(section, item);
    if (declaredKeys.has(key)) continue;
    changes.push({
      op: 'delete',
      key: entryLabel(section, item),
      detail: desired.prune ? undefined : 'not pruned; set "prune": true on this section to remove it',
    });
    if (desired.prune) actions.push(handlers.remove(item));
  }

  return supported(section, changes, actions);
}

// --- Target planners ----------------------------------------------------------------------------

/**
 * The order sections are planned and applied in. Settings first because some of them gate what the
 * later ones can set; approval rules after protected branches because a rule scoped to a branch
 * needs that branch to exist before it can reference it.
 */
const PROJECT_PLANNERS = [
  planSettings,
  planProtectedBranches,
  planProtectedTags,
  planApprovals,
  planApprovalRules,
  planPushRules,
  planVariables,
] as const;

/** Plans one project. Never throws for an instance failure; the target carries the error instead. */
export async function planProject(
  client: GitLabClient,
  target: { readonly path: string; readonly id: number },
  desired: ProjectDesired,
): Promise<TargetPlan> {
  const sections: SectionPlan[] = [];
  try {
    /* Sections are read in a fixed order rather than concurrently: the order is part of the
       contract, and a project's own reads are not the bottleneck across fifty of them. */
    /* eslint-disable no-await-in-loop */
    for (const planner of PROJECT_PLANNERS) {
      sections.push(...(await planner(client, target.path, desired)));
    }
    /* eslint-enable no-await-in-loop */
  } catch (error) {
    return {
      kind: 'project',
      path: target.path,
      id: target.id,
      sections,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { kind: 'project', path: target.path, id: target.id, sections };
}

export async function planGroup(
  client: GitLabClient,
  target: { readonly path: string; readonly id: number },
  desired: GroupDesired,
): Promise<TargetPlan> {
  if (desired.settings === undefined) {
    return { kind: 'group', path: target.path, id: target.id, sections: [] };
  }
  try {
    const actual = asRecord(await client.getGroup(target.path));
    const { changes, body } = diffAttributes(desired.settings, actual);
    return {
      kind: 'group',
      path: target.path,
      id: target.id,
      sections: [supported('settings', changes, changes.length === 0 ? [] : [{ kind: 'updateGroup', body }])],
    };
  } catch (error) {
    return {
      kind: 'group',
      path: target.path,
      id: target.id,
      sections: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
