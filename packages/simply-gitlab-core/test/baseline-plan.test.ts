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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPlan, applyTarget } from '../src/baseline-apply.js';
import type { ProjectDesired } from '../src/baseline-config.js';
import { hasChanges, hasDrift, planProject, type TargetPlan } from '../src/baseline-plan.js';
import { GitLabClient } from '../src/gitlab-client.js';
import { respondJson, startTestServer, type TestServer } from '../src/testing.js';

let server: TestServer;

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  await server.close();
});

function client(): GitLabClient {
  return new GitLabClient({ url: server.baseUrl, token: 'glpat-testing' });
}

const PROJECT = 'group%2Fproject';
const target = { path: 'group/project', id: 7 };

/** Registers the reads a full plan performs, so a test only overrides the ones it cares about. */
function stubReads(
  overrides: {
    project?: Record<string, unknown>;
    branches?: unknown[];
    tags?: unknown[];
    approvals?: Record<string, unknown>;
    rules?: unknown[];
    pushRules?: unknown;
    variables?: unknown[];
  } = {},
): void {
  server.route(`/api/v4/projects/${PROJECT}`, (_req, res) => {
    respondJson(res, 200, overrides.project ?? {});
  });
  server.route(`/api/v4/projects/${PROJECT}/protected_branches`, (_req, res) => {
    respondJson(res, 200, overrides.branches ?? []);
  });
  server.route(`/api/v4/projects/${PROJECT}/protected_tags`, (_req, res) => {
    respondJson(res, 200, overrides.tags ?? []);
  });
  server.route(`/api/v4/projects/${PROJECT}/approvals`, (_req, res) => {
    respondJson(res, 200, overrides.approvals ?? {});
  });
  server.route(`/api/v4/projects/${PROJECT}/approval_rules`, (_req, res) => {
    respondJson(res, 200, overrides.rules ?? []);
  });
  server.route(`/api/v4/projects/${PROJECT}/push_rule`, (_req, res) => {
    respondJson(res, 200, overrides.pushRules ?? null);
  });
  server.route(`/api/v4/projects/${PROJECT}/variables`, (_req, res) => {
    respondJson(res, 200, overrides.variables ?? []);
  });
}

function section(plan: TargetPlan, name: string) {
  return plan.sections.find((entry) => entry.section === name);
}

describe('planProject: settings', () => {
  it('reports only the attributes the config declares', async () => {
    // The blast radius is the set of keys someone wrote down; everything else is invisible.
    stubReads({ project: { merge_method: 'merge', build_timeout: 3600, description: 'untouched' } });
    const desired: ProjectDesired = { settings: { merge_method: 'ff' } };

    const plan = await planProject(client(), target, desired);
    const settings = section(plan, 'settings');

    expect(settings?.changes).toStrictEqual([{ op: 'update', key: 'merge_method', from: 'merge', to: 'ff' }]);
    expect(settings?.actions).toStrictEqual([{ kind: 'updateProject', body: { merge_method: 'ff' } }]);
  });

  it('plans nothing when the project already matches', async () => {
    stubReads({ project: { merge_method: 'ff' } });
    const plan = await planProject(client(), target, { settings: { merge_method: 'ff' } });

    expect(section(plan, 'settings')?.changes).toStrictEqual([]);
    expect(hasChanges({ targets: [plan] })).toBe(false);
  });

  it('compares objects regardless of key order', async () => {
    stubReads({ project: { squash: { b: 2, a: 1 } } });
    const plan = await planProject(client(), target, { settings: { squash: { a: 1, b: 2 } } });
    expect(section(plan, 'settings')?.changes).toStrictEqual([]);
  });
});

describe('planProject: protected branches', () => {
  it('creates a branch protection that does not exist', async () => {
    stubReads({ branches: [] });
    const plan = await planProject(client(), target, {
      protectedBranches: [{ name: 'main', allow_force_push: false }],
    });

    expect(section(plan, 'protectedBranches')?.changes[0]).toMatchObject({ op: 'create', key: 'main' });
    expect(section(plan, 'protectedBranches')?.actions[0]).toMatchObject({ kind: 'protectBranch' });
  });

  it('patches one in place rather than deleting and recreating it', async () => {
    // The alternative leaves main unprotected in between, which is the whole reason PATCH matters.
    stubReads({ branches: [{ id: 1, name: 'main', allow_force_push: true }] });
    const plan = await planProject(client(), target, {
      protectedBranches: [{ name: 'main', allow_force_push: false }],
    });

    expect(section(plan, 'protectedBranches')?.actions).toStrictEqual([
      { kind: 'patchProtectedBranch', name: 'main', body: { allow_force_push: false } },
    ]);
  });

  it('reports an undeclared protection as drift but does not remove it by default', async () => {
    stubReads({ branches: [{ id: 1, name: 'legacy' }] });
    const plan = await planProject(client(), target, { protectedBranches: [] });
    const branches = section(plan, 'protectedBranches');

    expect(branches?.changes[0]).toMatchObject({ op: 'delete', key: 'legacy' });
    expect(branches?.changes[0]?.detail).toMatch(/not pruned/);
    expect(branches?.actions).toStrictEqual([]);
    // Visible as drift, deliberately not corrected.
    expect(hasDrift({ targets: [plan] })).toBe(true);
    expect(hasChanges({ targets: [plan] })).toBe(false);
  });

  it('removes it when the section opts into pruning', async () => {
    stubReads({ branches: [{ id: 1, name: 'legacy' }] });
    const plan = await planProject(client(), target, {
      protectedBranches: { prune: true, entries: [] },
    });

    expect(section(plan, 'protectedBranches')?.actions).toStrictEqual([{ kind: 'unprotectBranch', name: 'legacy' }]);
  });
});

describe('planProject: protected tags', () => {
  it('explains that a change is a delete and a create', async () => {
    stubReads({ tags: [{ name: 'v*', create_access_level: 30 }] });
    const plan = await planProject(client(), target, { protectedTags: [{ name: 'v*', create_access_level: 40 }] });
    const tags = section(plan, 'protectedTags');

    expect(tags?.changes[0]?.detail).toMatch(/no update endpoint/);
    expect(tags?.actions.map((action) => action.kind)).toStrictEqual(['unprotectTag', 'protectTag']);
  });
});

describe('planProject: approval rules', () => {
  it('compares usernames against the eligible approvers GitLab reports', async () => {
    stubReads({
      rules: [
        {
          id: 5,
          name: 'Two maintainers',
          approvals_required: 2,
          eligible_approvers: [{ username: 'bob' }, { username: 'alice' }],
        },
      ],
    });

    const plan = await planProject(client(), target, {
      approvalRules: [{ name: 'Two maintainers', approvals_required: 2, usernames: ['alice', 'bob'] }],
    });

    expect(section(plan, 'approvalRules')?.changes).toStrictEqual([]);
  });

  it('carries branch names on the action rather than resolving ids at plan time', async () => {
    // The branch may be created by the section that runs immediately before the rules.
    stubReads({ rules: [] });
    const plan = await planProject(client(), target, {
      approvalRules: [{ name: 'Main', approvals_required: 1, protectedBranches: ['main'] }],
    });

    const action = section(plan, 'approvalRules')?.actions[0];
    expect(action).toMatchObject({ kind: 'createApprovalRule', branches: ['main'] });
    expect((action as { body: Record<string, unknown> }).body.protectedBranches).toBeUndefined();
  });

  it('never prunes the implicit any_approver rule', async () => {
    // Deleting it would remove the project's default approval behaviour.
    stubReads({ rules: [{ id: 1, name: 'All Members', rule_type: 'any_approver' }] });
    const plan = await planProject(client(), target, { approvalRules: { prune: true, entries: [] } });

    expect(section(plan, 'approvalRules')?.actions).toStrictEqual([]);
  });

  it('marks the section unsupported when the instance refuses it', async () => {
    stubReads();
    server.route(`/api/v4/projects/${PROJECT}/approval_rules`, (_req, res) => {
      respondJson(res, 403, { message: '403 Forbidden' });
    });

    const plan = await planProject(client(), target, { approvalRules: [{ name: 'x', approvals_required: 1 }] });
    const rules = section(plan, 'approvalRules');

    expect(rules?.supported).toBe(false);
    expect(rules?.unsupportedReason).toMatch(/not on this plan/);
    // The rest of the target still planned.
    expect(plan.error).toBeUndefined();
  });
});

describe('planProject: push rules', () => {
  it('creates the rule set when the project has none', async () => {
    stubReads({ pushRules: null });
    const plan = await planProject(client(), target, { pushRules: { prevent_secrets: true } });

    expect(section(plan, 'pushRules')?.actions).toStrictEqual([
      { kind: 'setPushRules', body: { prevent_secrets: true }, exists: false },
    ]);
  });

  it('edits it when one already exists', async () => {
    stubReads({ pushRules: { id: 1, prevent_secrets: false } });
    const plan = await planProject(client(), target, { pushRules: { prevent_secrets: true } });

    expect(section(plan, 'pushRules')?.actions[0]).toMatchObject({ exists: true });
  });
});

describe('planProject: variables', () => {
  it('reports a missing key and never plans an action for it', async () => {
    stubReads({ variables: [] });
    const plan = await planProject(client(), target, { variables: [{ key: 'DEPLOY_ENV', masked: true }] });
    const variables = section(plan, 'variables');

    expect(variables?.changes[0]).toMatchObject({ op: 'report', key: 'DEPLOY_ENV @ *' });
    expect(variables?.actions).toStrictEqual([]);
  });

  it('reports a wrong flag but still writes nothing, even with prune on', async () => {
    // Both POST and PUT require a value, and a hidden variable's value cannot even be read.
    stubReads({ variables: [{ key: 'DEPLOY_ENV', environment_scope: '*', masked: false }] });
    const plan = await planProject(client(), target, {
      variables: { prune: true, entries: [{ key: 'DEPLOY_ENV', masked: true }] },
    });
    const variables = section(plan, 'variables');

    expect(variables?.changes[0]?.detail).toMatch(/without resending the value/);
    expect(variables?.actions).toStrictEqual([]);
  });
});

describe('applyTarget', () => {
  it('sends exactly the actions the plan carried, in section order', async () => {
    stubReads({ project: { merge_method: 'merge' }, branches: [] });
    server.route(`/api/v4/projects/${PROJECT}/protected_branches`, (req, res) => {
      if (req.method === 'POST') respondJson(res, 201, { id: 9, name: 'main' });
      else respondJson(res, 200, []);
    });

    const plan = await planProject(client(), target, {
      settings: { merge_method: 'ff' },
      protectedBranches: [{ name: 'main' }],
    });
    const result = await applyTarget(client(), plan);

    expect(result.applied).toBe(2);
    expect(result.error).toBeUndefined();
    const writes = server.requests.filter((request) => request.method !== 'GET');
    expect(writes.map((request) => `${request.method} ${request.url}`)).toStrictEqual([
      `PUT /api/v4/projects/${PROJECT}`,
      `POST /api/v4/projects/${PROJECT}/protected_branches`,
    ]);
  });

  it('stops at the failing section and says how far it got', async () => {
    stubReads({ project: { merge_method: 'merge' } });
    server.route(`/api/v4/projects/${PROJECT}`, (req, res) => {
      if (req.method === 'PUT') respondJson(res, 400, { message: 'nope' });
      else respondJson(res, 200, { merge_method: 'merge' });
    });

    const plan = await planProject(client(), target, { settings: { merge_method: 'ff' } });
    const result = await applyTarget(client(), plan);

    expect(result.applied).toBe(0);
    expect(result.failedSection).toBe('settings');
    expect(result.error).toMatch(/400/);
  });

  it('resolves a branch name to its protection id at apply time', async () => {
    let ruleBody: unknown;
    stubReads({ rules: [] });
    server.route(`/api/v4/projects/${PROJECT}/protected_branches`, (_req, res) => {
      respondJson(res, 200, [{ id: 42, name: 'main' }]);
    });
    server.route(`/api/v4/projects/${PROJECT}/approval_rules`, (req, res, body) => {
      if (req.method === 'POST') {
        ruleBody = JSON.parse(body);
        respondJson(res, 201, {});
      } else respondJson(res, 200, []);
    });

    const plan = await planProject(client(), target, {
      approvalRules: [{ name: 'Main', approvals_required: 1, protectedBranches: ['main'] }],
    });
    await applyTarget(client(), plan);

    expect(ruleBody).toMatchObject({ protected_branch_ids: [42] });
  });

  it('refuses a rule whose branch is not protected, naming the fix', async () => {
    stubReads({ rules: [], branches: [] });
    const plan = await planProject(client(), target, {
      approvalRules: [{ name: 'Main', approvals_required: 1, protectedBranches: ['missing'] }],
    });
    const result = await applyTarget(client(), plan);

    expect(result.error).toMatch(/Declare it under protectedBranches/);
  });
});

describe('applyPlan', () => {
  it('never applies a target that failed to plan', async () => {
    // Acting on a half-read project is how a baseline makes things worse than it found them.
    const broken: TargetPlan = { kind: 'project', path: 'group/broken', id: 1, sections: [], error: 'unreadable' };
    const result = await applyPlan(client(), { targets: [broken] });

    expect(result.targets[0]).toMatchObject({ path: 'group/broken', applied: 0, error: 'unreadable' });
    expect(server.requests).toHaveLength(0);
  });
});
