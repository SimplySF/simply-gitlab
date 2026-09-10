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
import { AuthError, ConfigError, HIDDEN, HttpError } from '@simplysf/simply-gitlab-core';
import { respondJson, startTestServer, type TestServer } from '@simplysf/simply-gitlab-core/testing';
import { createContext } from '../src/context.js';
import { invokeTool, mapError, selectTools } from '../src/server.js';
import { TOOLS, type ToolSpec } from '../src/tools.js';

let server: TestServer;

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  await server.close();
});

function context(overrides: Record<string, string> = {}) {
  return createContext({
    allowWrites: true,
    env: { GITLAB_URL: server.baseUrl, GITLAB_TOKEN: 'glpat-testing', ...overrides },
  });
}

function spec(name: string): ToolSpec {
  const found = TOOLS.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no such tool: ${name}`);
  return found;
}

/** The JSON an isError result carries, or the payload a successful one does. */
function payload(result: { content: Array<{ type: string; text?: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? 'null');
}

describe('selectTools', () => {
  it('registers only read tools by default', () => {
    expect(selectTools(false).every((tool) => tool.kind === 'read')).toBe(true);
  });

  it('registers everything with --allow-writes', () => {
    expect(selectTools(true)).toHaveLength(TOOLS.length);
    expect(selectTools(false).length).toBeLessThan(TOOLS.length);
  });
});

describe('invokeTool', () => {
  it('returns the raw GitLab payload as JSON text', async () => {
    server.route('/api/v4/projects/group%2Fproject', (_req, res) => {
      respondJson(res, 200, { id: 7, path_with_namespace: 'group/project' });
    });

    const result = await invokeTool(spec('gitlab_project_view'), context(), { project: 'group/project' });

    expect(result.isError).toBeUndefined();
    expect(payload(result)).toEqual({ id: 7, path_with_namespace: 'group/project' });
  });

  it('applies the read-only guard before the request, exactly as the CLI does', async () => {
    const result = await invokeTool(spec('gitlab_branch_create'), context({ GITLAB_READ_ONLY: '1' }), {
      project: 'group/project',
      branch: 'x',
      ref: 'main',
    });

    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({ code: 'config' });
    expect(server.requests).toHaveLength(0);
  });

  it('sends nothing for a dry run', async () => {
    const result = await invokeTool(spec('gitlab_mr_create'), context(), {
      project: 'group/project',
      sourceBranch: 'feature',
      targetBranch: 'main',
      title: 'feat: thing',
      dryRun: true,
    });

    expect(payload(result)).toMatchObject({ source_branch: 'feature', title: 'feat: thing' });
    expect(server.requests).toHaveLength(0);
  });

  it('hides CI variable values with no way to ask for them', async () => {
    server.route('/api/v4/projects/group%2Fproject/variables', (_req, res) => {
      respondJson(res, 200, [{ key: 'DEPLOY_KEY', value: 'a-real-secret', masked: true }]);
    });

    const result = await invokeTool(spec('gitlab_ci_variable_list'), context(), { project: 'group/project' });

    expect(JSON.stringify(payload(result))).not.toContain('a-real-secret');
    expect(payload(result)).toMatchObject({ items: [{ key: 'DEPLOY_KEY', value: HIDDEN }] });
  });

  it('reports a failure as an isError result rather than throwing', async () => {
    server.route('/api/v4/projects/group%2Fproject', (_req, res) => {
      respondJson(res, 404, { message: '404 Project Not Found' });
    });

    const result = await invokeTool(spec('gitlab_project_view'), context(), { project: 'group/project' });

    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({ code: 'error', status: 404 });
  });
});

describe('mapError', () => {
  const env = { GITLAB_TOKEN: 'glpat-0123456789' };

  it('maps each error class onto a stable code and exit code', () => {
    expect(mapError(new ConfigError('bad'), { env })).toMatchObject({ code: 'config', exitCode: 2 });
    expect(mapError(new AuthError('denied', 401), { env })).toMatchObject({ code: 'auth', exitCode: 3, status: 401 });
    expect(mapError(new HttpError('boom', 500), { env })).toMatchObject({ code: 'error', exitCode: 1, status: 500 });
    expect(mapError(new TypeError('bug'), { env })).toMatchObject({ code: 'error', name: 'Error', exitCode: 1 });
  });

  it('redacts the token out of the message and the body alike', () => {
    // A message that was redacted while the body beside it went out clean is still a disclosure.
    const error = new HttpError('rejected glpat-0123456789', 400, { message: 'glpat-0123456789 is invalid' });
    const mapped = mapError(error, { env });

    expect(mapped.message).not.toContain('glpat-0123456789');
    expect(JSON.stringify(mapped.body)).not.toContain('glpat-0123456789');
  });
});
