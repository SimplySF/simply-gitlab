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

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { respondJson, startTestServer, type TestServer } from '@simplysf/simply-gitlab-core/testing';
import GitlabConfigApply from '../../../src/commands/gitlab/config/apply.js';
import GitlabConfigExport from '../../../src/commands/gitlab/config/export.js';
import GitlabConfigPlan from '../../../src/commands/gitlab/config/plan.js';

let server: TestServer;

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  await server.close();
  delete process.env.GITLAB_READ_ONLY;
});

const PROJECT = 'group%2Fproject';

function argv(...extra: string[]): string[] {
  return ['--gitlab-url', server.baseUrl, '--gitlab-token', 'glpat-testing', ...extra];
}

function configFile(config: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), 'simply-gitlab-baseline-')), 'baseline.json');
  writeFileSync(path, JSON.stringify(config), 'utf8');
  return path;
}

/** The reads a plan performs for one project, so a test only stubs what it cares about. */
function stubProject(settings: Record<string, unknown> = {}): void {
  server.route(`/api/v4/projects/${PROJECT}`, (req, res, body) => {
    if (req.method === 'PUT') respondJson(res, 200, { ...settings, ...(JSON.parse(body) as object) });
    else respondJson(res, 200, { id: 7, path_with_namespace: 'group/project', ...settings });
  });
  for (const path of ['protected_branches', 'protected_tags', 'approval_rules', 'variables']) {
    server.route(`/api/v4/projects/${PROJECT}/${path}`, (_req, res) => {
      respondJson(res, 200, []);
    });
  }
  server.route(`/api/v4/projects/${PROJECT}/approvals`, (_req, res) => {
    respondJson(res, 200, {});
  });
  server.route(`/api/v4/projects/${PROJECT}/push_rule`, (_req, res) => {
    respondJson(res, 200, null);
  });
}

const baseline = {
  version: 1,
  targets: { projects: ['group/project'] },
  project: { settings: { merge_method: 'ff' } },
};

interface PlanJson {
  targets: Array<{ path: string; sections: Array<{ section: string; changes: unknown[]; willChange: boolean }> }>;
  summary: { targets: number; matching: number; differing: number };
}

describe('gitlab config plan', () => {
  it('reports drift without sending anything that changes data', async () => {
    stubProject({ merge_method: 'merge' });

    const result = (await GitlabConfigPlan.run(argv('--config', configFile(baseline)))) as PlanJson;

    expect(result.summary).toMatchObject({ targets: 1, differing: 1 });
    expect(result.targets[0]?.sections[0]).toMatchObject({ section: 'settings', willChange: true });
    expect(server.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('reports a converged project as matching', async () => {
    stubProject({ merge_method: 'ff' });

    const result = (await GitlabConfigPlan.run(argv('--config', configFile(baseline)))) as PlanJson;

    expect(result.summary).toMatchObject({ matching: 1, differing: 0 });
  });

  it('exits non-zero under --fail-on-drift, which is what a scheduled job wants', async () => {
    stubProject({ merge_method: 'merge' });

    await expect(GitlabConfigPlan.run(argv('--config', configFile(baseline), '--fail-on-drift'))).rejects.toThrow(
      /does not match/,
    );
  });

  it('does not fail on drift when there is none', async () => {
    stubProject({ merge_method: 'ff' });

    await expect(
      GitlabConfigPlan.run(argv('--config', configFile(baseline), '--fail-on-drift')),
    ).resolves.toBeDefined();
  });

  it('refuses a --target the config does not target', async () => {
    stubProject();

    await expect(
      GitlabConfigPlan.run(argv('--config', configFile(baseline), '--target', 'group/elsewhere')),
    ).rejects.toThrow(/which this config does not target/);
  });

  it('reports every config problem at once, before any request', async () => {
    const path = configFile({ version: 2, targets: { group: 'x' } });

    await expect(GitlabConfigPlan.run(argv('--config', path))).rejects.toThrow(/version: must be 1/);
    expect(server.requests).toHaveLength(0);
  });
});

describe('gitlab config apply', () => {
  it('sends nothing under --dry-run', async () => {
    stubProject({ merge_method: 'merge' });

    await GitlabConfigApply.run(argv('--config', configFile(baseline), '--dry-run'));

    expect(server.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('applies only what the plan showed', async () => {
    stubProject({ merge_method: 'merge' });

    const result = (await GitlabConfigApply.run(argv('--config', configFile(baseline)))) as {
      applied: Array<{ path: string; applied: number }>;
    };

    const writes = server.requests.filter((request) => request.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0].body)).toStrictEqual({ merge_method: 'ff' });
    expect(result.applied[0]).toMatchObject({ path: 'group/project', applied: 1 });
  });

  it('sends nothing when the project already matches', async () => {
    stubProject({ merge_method: 'ff' });

    await GitlabConfigApply.run(argv('--config', configFile(baseline)));

    expect(server.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('is refused by the read-only guard before any request', async () => {
    process.env.GITLAB_READ_ONLY = '1';
    stubProject({ merge_method: 'merge' });

    await expect(GitlabConfigApply.run(argv('--config', configFile(baseline)))).rejects.toThrow(/GITLAB_READ_ONLY/);
    expect(server.requests).toHaveLength(0);
  });
});

describe('gitlab config export', () => {
  it('emits a config that plan accepts, targeting only the project it came from', async () => {
    stubProject({ merge_method: 'ff', build_timeout: 3600 });

    const config = (await GitlabConfigExport.run(argv('--project', 'group/project'))) as {
      version: number;
      targets: { projects: string[] };
      project: { settings: Record<string, unknown> };
    };

    expect(config.version).toBe(1);
    expect(config.targets.projects).toStrictEqual(['group/project']);
    expect(config.project.settings).toMatchObject({ merge_method: 'ff', build_timeout: 3600 });
  });

  it('never copies a variable value into the file', async () => {
    stubProject();
    server.route(`/api/v4/projects/${PROJECT}/variables`, (_req, res) => {
      respondJson(res, 200, [{ key: 'DEPLOY_KEY', value: 'a-real-secret', masked: true, environment_scope: '*' }]);
    });

    const config = await GitlabConfigExport.run(argv('--project', 'group/project'));

    expect(JSON.stringify(config)).not.toContain('a-real-secret');
    expect(JSON.stringify(config)).toContain('DEPLOY_KEY');
  });

  it('drops attributes that cannot be set back', async () => {
    // A config carrying ids and timestamps would look like intent the moment it was in a file.
    stubProject({ merge_method: 'ff' });

    const config = (await GitlabConfigExport.run(argv('--project', 'group/project'))) as {
      project: { settings: Record<string, unknown> };
    };

    expect(config.project.settings.id).toBeUndefined();
    expect(config.project.settings.path_with_namespace).toBeUndefined();
  });
});
