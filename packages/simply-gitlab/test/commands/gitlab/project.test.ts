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

import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { respondJson, startTestServer, type TestServer } from '@simplysf/simply-gitlab-core/testing';
import GitlabProjectCreate from '../../../src/commands/gitlab/project/create.js';

let server: TestServer;

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  await server.close();
  delete process.env.GITLAB_READ_ONLY;
});

function argv(...extra: string[]): string[] {
  return ['--gitlab-url', server.baseUrl, '--gitlab-token', 'glpat-testing', ...extra];
}

describe('gitlab project create', () => {
  it('sends nothing under --dry-run when every id is numeric, and returns the request', async () => {
    const request = (await GitlabProjectCreate.run(
      argv(
        '--name',
        'new-service',
        '--namespace',
        '12',
        '--template',
        'express',
        '--visibility',
        'internal',
        '--dry-run',
      ),
    )) as Record<string, unknown>;

    expect(request).toStrictEqual({
      name: 'new-service',
      namespace_id: 12,
      visibility: 'internal',
      template_name: 'express',
    });
    expect(server.requests).toHaveLength(0);
  });

  it('resolves a template group path to its id, even under --dry-run', async () => {
    server.route('/api/v4/groups/platform%2Ftemplates', (_req, res) => {
      respondJson(res, 200, { id: 55, full_path: 'platform/templates' });
    });

    const request = (await GitlabProjectCreate.run(
      argv('--name', 'x', '--template', 'skeleton', '--template-group', 'platform/templates', '--dry-run'),
    )) as Record<string, unknown>;

    expect(request).toMatchObject({ use_custom_template: true, group_with_project_templates_id: 55 });
    expect(server.requests.map((sent) => sent.method)).toStrictEqual(['GET']);
  });

  it('sends a template group alongside a template project', async () => {
    const request = (await GitlabProjectCreate.run(
      argv('--name', 'x', '--template-project', '99', '--template-group', '55', '--dry-run'),
    )) as Record<string, unknown>;

    expect(request).toStrictEqual({
      name: 'x',
      use_custom_template: true,
      template_project_id: 99,
      group_with_project_templates_id: 55,
    });
    expect(server.requests).toHaveLength(0);
  });

  it('creates the project with a POST and returns the payload', async () => {
    server.route('/api/v4/namespaces/platform%2Fapps', (_req, res) => {
      respondJson(res, 200, { id: 12 });
    });
    server.route('/api/v4/projects/platform%2Ftemplates%2Fskeleton', (_req, res) => {
      respondJson(res, 200, { id: 99 });
    });
    let received: unknown;
    server.route('/api/v4/projects', (_req, res, body) => {
      received = JSON.parse(body) as unknown;
      respondJson(res, 201, {
        id: 4711,
        path_with_namespace: 'platform/apps/new-service',
        import_status: 'scheduled',
        web_url: 'https://gitlab.example.com/platform/apps/new-service',
      });
    });

    const created = (await GitlabProjectCreate.run(
      argv(
        '--name',
        'new-service',
        '--namespace',
        'platform/apps',
        '--template-project',
        'platform/templates/skeleton',
        '--topics',
        'node, service,',
      ),
    )) as { id: number };

    expect(created.id).toBe(4711);
    expect(received).toStrictEqual({
      name: 'new-service',
      namespace_id: 12,
      topics: ['node', 'service'],
      use_custom_template: true,
      template_project_id: 99,
    });
    expect(server.requests.at(-1)?.method).toBe('POST');
    expect(server.requests.at(-1)?.url).toBe('/api/v4/projects');
  });

  it('refuses a project with neither a name nor a path before making a request', async () => {
    await expect(GitlabProjectCreate.run(argv('--template', 'express'))).rejects.toThrow(/--name or --path/);
    expect(server.requests).toHaveLength(0);
  });

  it('refuses --template together with --template-project, before looking anything up', async () => {
    await expect(
      GitlabProjectCreate.run(argv('--name', 'x', '--template', 'a', '--template-project', 'platform/templates/a')),
    ).rejects.toThrow(/not both/);
    expect(server.requests).toHaveLength(0);
  });

  it('is a write, so the read-only guard refuses it before any request', async () => {
    process.env.GITLAB_READ_ONLY = '1';

    await expect(GitlabProjectCreate.run(argv('--name', 'x', '--dry-run'))).rejects.toThrow(/GITLAB_READ_ONLY/);
    expect(server.requests).toHaveLength(0);
  });
});
