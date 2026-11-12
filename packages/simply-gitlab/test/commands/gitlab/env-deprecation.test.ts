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
import { stripVTControlCharacters } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { respondJson, startTestServer, type TestServer } from '@simplysf/simply-gitlab-core/testing';
import GitlabCiVariableList from '../../../src/commands/gitlab/ci/variable/list.js';

const NAMES = [
  'GITLAB_URL',
  'GITLAB_TOKEN',
  'GITLAB_PROJECT',
  'SIMPLY_GITLAB_URL',
  'SIMPLY_GITLAB_TOKEN',
  'SIMPLY_GITLAB_PROJECT',
];

let server: TestServer;
let written: string[];

beforeEach(async () => {
  server = await startTestServer();
  server.route('/api/v4/projects/group%2Fproject/variables', (_req, res) => {
    respondJson(res, 200, []);
  });
  // oclif writes warnings to stderr through console.error, which the test runner intercepts.
  written = [];
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    written.push(parts.map(String).join(' '));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
  for (const name of NAMES) delete process.env[name];
});

/**
 * What was warned, as one line. oclif wraps a warning to the terminal width, may colour it, and
 * marks each line with a platform-specific arrow: `›` on Linux and macOS, `»` on Windows.
 */
function warnings(): string {
  return stripVTControlCharacters(written.join(' ')).replaceAll(/[›»]/g, ' ').replaceAll(/\s+/g, ' ');
}

describe('deprecated environment variable names', () => {
  it('still configure the connection and --project, with one warning naming each', async () => {
    process.env.GITLAB_URL = server.baseUrl;
    process.env.GITLAB_TOKEN = 'glpat-legacy-token';
    process.env.GITLAB_PROJECT = 'group/project';

    await expect(GitlabCiVariableList.run([])).resolves.toBeDefined();

    expect(server.requests).toHaveLength(1);
    expect(warnings()).toContain('GITLAB_URL → SIMPLY_GITLAB_URL');
    expect(warnings()).toContain('GITLAB_TOKEN → SIMPLY_GITLAB_TOKEN');
    expect(warnings()).toContain('GITLAB_PROJECT → SIMPLY_GITLAB_PROJECT');
    expect(warnings()).not.toContain('glpat-legacy-token');
  });

  it('are ignored, without a warning, when the prefixed names are set', async () => {
    // Left behind for glab or another tool: this CLI ignores them, so it has nothing to report.
    process.env.GITLAB_URL = 'https://other-tool.example.com';
    process.env.GITLAB_TOKEN = 'glpat-other-tool';
    process.env.GITLAB_PROJECT = 'other/project';
    process.env.SIMPLY_GITLAB_URL = server.baseUrl;
    process.env.SIMPLY_GITLAB_TOKEN = 'glpat-current';
    process.env.SIMPLY_GITLAB_PROJECT = 'group/project';

    await expect(GitlabCiVariableList.run([])).resolves.toBeDefined();

    expect(server.requests).toHaveLength(1);
    expect(warnings()).not.toContain('Deprecated');
  });

  it('do not outrank an explicit --project flag', async () => {
    process.env.SIMPLY_GITLAB_URL = server.baseUrl;
    process.env.SIMPLY_GITLAB_TOKEN = 'glpat-current';
    process.env.GITLAB_PROJECT = 'other/project';

    await expect(GitlabCiVariableList.run(['--project', 'group/project'])).resolves.toBeDefined();

    expect(server.requests).toHaveLength(1);
  });
});
