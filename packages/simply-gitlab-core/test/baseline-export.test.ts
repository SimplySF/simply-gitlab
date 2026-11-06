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
import { exportProject } from '../src/baseline-export.js';
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

function stubProject(project: Record<string, unknown>): void {
  server.route('/api/v4/projects/group%2Fproject', (_req, res) => {
    respondJson(res, 200, project);
  });
}

const FEATURE_ACCESS_LEVELS = {
  analytics_access_level: 'private',
  builds_access_level: 'private',
  environments_access_level: 'enabled',
  feature_flags_access_level: 'private',
  infrastructure_access_level: 'disabled',
  issues_access_level: 'enabled',
  merge_requests_access_level: 'enabled',
  model_experiments_access_level: 'enabled',
  model_registry_access_level: 'private',
  monitor_access_level: 'disabled',
  package_registry_access_level: 'public',
  pages_access_level: 'public',
  releases_access_level: 'enabled',
  repository_access_level: 'enabled',
  requirements_access_level: 'private',
  security_and_compliance_access_level: 'private',
  snippets_access_level: 'disabled',
  wiki_access_level: 'private',
};

describe('exportProject: settings', () => {
  it('exports the project feature access levels', async () => {
    stubProject(FEATURE_ACCESS_LEVELS);

    const desired = await exportProject(client(), 'group/project', { sections: ['settings'] });

    expect(desired.settings).toStrictEqual(FEATURE_ACCESS_LEVELS);
  });

  it('leaves out an access level the instance does not report', async () => {
    stubProject({ snippets_access_level: 'enabled', requirements_access_level: null });

    const desired = await exportProject(client(), 'group/project', { sections: ['settings'] });

    expect(desired.settings).toStrictEqual({ snippets_access_level: 'enabled' });
  });

  it('does not export the boolean a feature access level replaces', async () => {
    stubProject({
      issues_enabled: true,
      packages_enabled: true,
      requirements_enabled: true,
      snippets_enabled: true,
      wiki_enabled: true,
      snippets_access_level: 'enabled',
    });

    const desired = await exportProject(client(), 'group/project', { sections: ['settings'] });

    expect(desired.settings).toStrictEqual({ snippets_access_level: 'enabled' });
  });
});
