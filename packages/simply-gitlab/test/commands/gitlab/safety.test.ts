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

import { Buffer } from 'node:buffer';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HIDDEN } from '@simplysf/simply-gitlab-core';
import { respondJson, startTestServer, type TestServer } from '@simplysf/simply-gitlab-core/testing';
import GitlabBranchCreate from '../../../src/commands/gitlab/branch/create.js';
import GitlabCiVariableList from '../../../src/commands/gitlab/ci/variable/list.js';
import GitlabFileView from '../../../src/commands/gitlab/file/view.js';

let server: TestServer;

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  await server.close();
  delete process.env.GITLAB_READ_ONLY;
});

function argv(...extra: string[]): string[] {
  return ['--gitlab-url', server.baseUrl, '--gitlab-token', 'glpat-testing', '--project', 'group/project', ...extra];
}

describe('the read-only guard', () => {
  it('refuses a write command before it issues a request', async () => {
    process.env.GITLAB_READ_ONLY = '1';

    await expect(GitlabBranchCreate.run(argv('--branch', 'x', '--ref', 'main'))).rejects.toThrow(/GITLAB_READ_ONLY/);
    expect(server.requests).toHaveLength(0);
  });

  it('leaves read commands alone', async () => {
    process.env.GITLAB_READ_ONLY = '1';
    server.route('/api/v4/projects/group%2Fproject/variables', (_req, res) => {
      respondJson(res, 200, []);
    });

    await expect(GitlabCiVariableList.run(argv())).resolves.toBeDefined();
  });
});

describe('gitlab ci variable list', () => {
  it('hides every value by default, including under --json', async () => {
    // The API returns masked variables in clear text: "masked" only applies to job logs.
    server.route('/api/v4/projects/group%2Fproject/variables', (_req, res) => {
      respondJson(res, 200, [{ key: 'DEPLOY_KEY', value: 'a-real-secret', masked: true }]);
    });

    const result = (await GitlabCiVariableList.run(argv('--json'))) as { items: Array<{ value: string }> };

    expect(result.items[0]?.value).toBe(HIDDEN);
    expect(JSON.stringify(result)).not.toContain('a-real-secret');
  });

  it('prints the values only when explicitly asked', async () => {
    server.route('/api/v4/projects/group%2Fproject/variables', (_req, res) => {
      respondJson(res, 200, [{ key: 'DEPLOY_KEY', value: 'a-real-secret' }]);
    });

    const result = (await GitlabCiVariableList.run(argv('--reveal'))) as { items: Array<{ value: string }> };

    expect(result.items[0]?.value).toBe('a-real-secret');
  });
});

describe('gitlab file view', () => {
  it('decodes the base64 content GitLab returns', async () => {
    server.route('/api/v4/projects/group%2Fproject/repository/files/src%2Findex.ts', (_req, res) => {
      respondJson(res, 200, {
        file_path: 'src/index.ts',
        ref: 'main',
        encoding: 'base64',
        content: Buffer.from('export const x = 1;\n', 'utf8').toString('base64'),
      });
    });

    const payload = (await GitlabFileView.run(argv('--path', 'src/index.ts', '--ref', 'main'))) as {
      file_path: string;
    };

    expect(payload.file_path).toBe('src/index.ts');
    expect(server.requests[0]?.url).toContain('ref=main');
  });
});
