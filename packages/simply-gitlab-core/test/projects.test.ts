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
import { ConfigError } from '../src/errors.js';
import { GitLabClient } from '../src/gitlab-client.js';
import { buildProjectCreateBody, prepareProjectCreate, resolveNamespaceId } from '../src/projects.js';
import { respondJson, startTestServer, type TestServer } from '../src/testing.js';

describe('buildProjectCreateBody', () => {
  it('maps typed input onto GitLab attribute names', () => {
    expect(
      buildProjectCreateBody({
        name: 'New Service',
        path: 'new-service',
        namespaceId: 12,
        description: 'd',
        visibility: 'internal',
        defaultBranch: 'main',
        initializeWithReadme: true,
        topics: ['a', 'b'],
      }),
    ).toStrictEqual({
      name: 'New Service',
      path: 'new-service',
      namespace_id: 12,
      description: 'd',
      visibility: 'internal',
      default_branch: 'main',
      initialize_with_readme: true,
      topics: ['a', 'b'],
    });
  });

  it('sends a plain template as a built-in one, without use_custom_template', () => {
    expect(buildProjectCreateBody({ name: 'x', template: 'express' })).toStrictEqual({
      name: 'x',
      template_name: 'express',
    });
  });

  it('marks each of the three custom routes with use_custom_template', () => {
    expect(buildProjectCreateBody({ name: 'x', template: 'skeleton', customTemplate: true })).toStrictEqual({
      name: 'x',
      template_name: 'skeleton',
      use_custom_template: true,
    });
    expect(buildProjectCreateBody({ name: 'x', template: 'skeleton', templateGroupId: 55 })).toStrictEqual({
      name: 'x',
      template_name: 'skeleton',
      use_custom_template: true,
      group_with_project_templates_id: 55,
    });
    expect(buildProjectCreateBody({ name: 'x', templateProjectId: 99 })).toStrictEqual({
      name: 'x',
      use_custom_template: true,
      template_project_id: 99,
    });
  });

  it('accepts a path alone, since GitLab derives the name from it', () => {
    expect(buildProjectCreateBody({ path: 'new-service' })).toStrictEqual({ path: 'new-service' });
  });

  it('merges typed input over a raw body', () => {
    const body = buildProjectCreateBody({
      name: 'flag wins',
      body: { name: 'template loses', lfs_enabled: false },
    });
    expect(body.name).toBe('flag wins');
    expect(body.lfs_enabled).toBe(false);
  });

  it('lets a raw body supply the name', () => {
    expect(buildProjectCreateBody({ body: { name: 'from-body' } })).toStrictEqual({ name: 'from-body' });
  });

  it('refuses a project with neither a name nor a path, naming both flags', () => {
    expect(() => buildProjectCreateBody({ template: 'express' })).toThrow(ConfigError);
    expect(() => buildProjectCreateBody({ name: '' })).toThrow(/--name or --path/);
  });

  it('refuses a template together with a template project', () => {
    expect(() => buildProjectCreateBody({ name: 'x', template: 'a', templateProjectId: 1 })).toThrow(
      /--template or --template-project, not both/,
    );
  });

  it('refuses a template group or custom flag without a template to apply it to', () => {
    expect(() => buildProjectCreateBody({ name: 'x', templateGroupId: 1 })).toThrow(
      /--template-group needs --template/,
    );
    expect(() => buildProjectCreateBody({ name: 'x', customTemplate: true })).toThrow(
      /--custom-template needs --template/,
    );
  });
});

describe('prepareProjectCreate', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  function client(): GitLabClient {
    return new GitLabClient({ url: server.baseUrl, token: 'glpat-0123456789abcdef' });
  }

  it('uses numeric ids as they are, without a request', async () => {
    const body = await prepareProjectCreate(client(), {
      name: 'x',
      namespace: '12',
      template: 'skeleton',
      templateGroup: 55,
    });

    expect(body).toStrictEqual({
      name: 'x',
      namespace_id: 12,
      template_name: 'skeleton',
      use_custom_template: true,
      group_with_project_templates_id: 55,
    });
    expect(server.requests).toHaveLength(0);
  });

  it('resolves a namespace, a group, and a project path through their own endpoints', async () => {
    server.route('/api/v4/namespaces/platform%2Fapps', (_req, res) => {
      respondJson(res, 200, { id: 12, kind: 'group', full_path: 'platform/apps' });
    });
    server.route('/api/v4/projects/platform%2Ftemplates%2Fskeleton', (_req, res) => {
      respondJson(res, 200, { id: 99 });
    });

    const body = await prepareProjectCreate(client(), {
      name: 'x',
      namespace: 'platform/apps',
      templateProject: 'platform/templates/skeleton',
    });

    expect(body).toStrictEqual({ name: 'x', namespace_id: 12, use_custom_template: true, template_project_id: 99 });
    expect(server.requests.map((request) => request.method)).toStrictEqual(['GET', 'GET']);
  });

  it('resolves a template group path', async () => {
    server.route('/api/v4/groups/platform%2Ftemplates', (_req, res) => {
      respondJson(res, 200, { id: 55 });
    });

    const body = await prepareProjectCreate(client(), {
      name: 'x',
      template: 'skeleton',
      templateGroup: 'platform/templates',
    });

    expect(body.group_with_project_templates_id).toBe(55);
    expect(body.use_custom_template).toBe(true);
  });

  it('refuses a bad flag combination before looking anything up', async () => {
    await expect(prepareProjectCreate(client(), { name: 'x', templateGroup: 'platform/templates' })).rejects.toThrow(
      /--template-group needs --template/,
    );
    expect(server.requests).toHaveLength(0);
  });

  it('refuses an answer that carries no numeric id rather than sending a string', async () => {
    server.route('/api/v4/namespaces/odd', (_req, res) => {
      respondJson(res, 200, { full_path: 'odd' });
    });

    await expect(resolveNamespaceId(client(), 'odd')).rejects.toThrow(ConfigError);
  });
});
