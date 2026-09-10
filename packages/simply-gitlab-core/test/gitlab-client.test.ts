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
import { GitLabClient } from '../src/gitlab-client.js';
import { ConfigError } from '../src/errors.js';
import { respondJson, startTestServer, type TestServer } from '../src/testing.js';

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

/** Answers one page of `count` items, advertising `next` as the following page. */
function page(count: number, next: number | undefined, total: number) {
  return (_req: unknown, res: Parameters<Parameters<TestServer['route']>[1]>[1]): void => {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-total': String(total) };
    if (next !== undefined) headers['x-next-page'] = String(next);
    res.writeHead(200, headers);
    res.end(JSON.stringify(Array.from({ length: count }, (_, index) => ({ id: index }))));
  };
}

describe('GitLabClient addressing', () => {
  it('URL-encodes a project path so a slash does not become a route', async () => {
    server.route('/api/v4/projects/group%2Fsub%2Fproject', (_req, res) => {
      respondJson(res, 200, { id: 7 });
    });

    await expect(client().getProject('group/sub/project')).resolves.toEqual({ id: 7 });
  });

  it('sends the token as PRIVATE-TOKEN', async () => {
    let seen: string | undefined;
    server.route('/api/v4/projects/1', (req, res) => {
      seen = req.headers['private-token'] as string;
      respondJson(res, 200, {});
    });

    await client().getProject(1);
    expect(seen).toBe('glpat-0123456789abcdef');
  });

  it('refuses an empty project reference rather than requesting /projects/', async () => {
    await expect(client().getProject('  ')).rejects.toBeInstanceOf(ConfigError);
  });

  it('encodes a file path, including its slashes', async () => {
    server.route('/api/v4/projects/1/repository/files/src%2Findex.ts', (req, res) => {
      respondJson(res, 200, { url: req.url });
    });

    await expect(client().getFile(1, 'src/index.ts', { ref: 'main' })).resolves.toEqual({
      url: '/api/v4/projects/1/repository/files/src%2Findex.ts?ref=main',
    });
  });
});

describe('GitLabClient pagination', () => {
  it('follows pages until the limit and reports being cut short', async () => {
    let call = 0;
    server.route('/api/v4/projects', (req, res) => {
      call += 1;
      // Always another page, so the only thing that can stop the walk is the caller's limit.
      page(2, call + 1, 99)(req, res);
    });

    const result = await client().listProjects({}, 5);

    expect(result.items).toHaveLength(5);
    expect(result.total).toBe(99);
    expect(result.complete).toBe(false);
  });

  it('stops and reports complete when the instance says there is no next page', async () => {
    server.route('/api/v4/projects', page(2, undefined, 2));

    const result = await client().listProjects({}, 50);

    expect(result.items).toHaveLength(2);
    expect(result.pages).toBe(1);
    expect(result.complete).toBe(true);
  });

  it('stops rather than looping when a proxy pins the next-page header', async () => {
    // x-next-page that never advances would otherwise spin until the page cap.
    server.route('/api/v4/projects', page(2, 1, 100));

    const result = await client().listProjects({}, 50);

    expect(result.pages).toBe(1);
    expect(result.complete).toBe(true);
  });

  it('never asks for more than GitLab will give in one page', async () => {
    server.route('/api/v4/projects', (req, res) => {
      respondJson(res, 200, [{ url: req.url }]);
    });

    const result = await client().listProjects({}, 5000);
    expect(JSON.stringify(result.items)).toContain('per_page=100');
  });

  it('refuses a limit that is not a positive whole number', async () => {
    await expect(client().listProjects({}, 0)).rejects.toBeInstanceOf(ConfigError);
  });

  it('refuses a list response that is not a list', async () => {
    // A sign-in page redirect answers 200 with HTML; slicing it would yield a confident empty list.
    server.route('/api/v4/projects', (_req, res) => {
      respondJson(res, 200, { message: 'not a list' });
    });

    await expect(client().listProjects({}, 5)).rejects.toThrow(/did not return a list/);
  });
});

describe('GitLabClient.search', () => {
  it('uses the global endpoint when neither project nor group is named', async () => {
    server.route('/api/v4/search', (_req, res) => {
      respondJson(res, 200, [{ id: 1 }]);
    });

    await expect(client().search({ scope: 'projects', search: 'x' }, 5)).resolves.toMatchObject({ pages: 1 });
  });

  it('uses the project endpoint when a project is named', async () => {
    server.route('/api/v4/projects/group%2Fproject/search', (_req, res) => {
      respondJson(res, 200, [{ id: 1 }]);
    });

    await expect(client().search({ scope: 'blobs', search: 'x', project: 'group/project' }, 5)).resolves.toMatchObject({
      pages: 1,
    });
  });

  it('uses the group endpoint when a group is named', async () => {
    server.route('/api/v4/groups/my-group/search', (_req, res) => {
      respondJson(res, 200, []);
    });

    await expect(client().search({ scope: 'issues', search: 'x', group: 'my-group' }, 5)).resolves.toMatchObject({
      pages: 1,
    });
  });

  it('refuses both at once rather than silently preferring one', async () => {
    await expect(client().search({ scope: 'issues', search: 'x', project: 'a', group: 'b' }, 5)).rejects.toThrow(
      /not both/,
    );
  });
});

describe('GitLabClient configuration endpoints', () => {
  it('sends only the attributes given to updateProject', async () => {
    // The design rests on PUT /projects/:id being a partial update. GitLab does not document that
    // outright, so it is pinned here: if it were ever a full replace, every apply would be
    // destructive and this test is what would say so.
    let received: unknown;
    server.route('/api/v4/projects/1', (req, res, body) => {
      received = body === '' ? undefined : (JSON.parse(body) as unknown);
      respondJson(res, 200, { id: 1 });
    });

    await client().updateProject(1, { merge_method: 'ff' });

    expect(received).toStrictEqual({ merge_method: 'ff' });
    expect(server.requests[0]?.method).toBe('PUT');
  });

  it('patches a protected branch in place, encoding the branch name', async () => {
    server.route('/api/v4/projects/1/protected_branches/release%2Fnext', (req, res) => {
      respondJson(res, 200, { method: req.method });
    });

    await expect(client().patchProtectedBranch(1, 'release/next', { allow_force_push: false })).resolves.toEqual({
      method: 'PATCH',
    });
  });

  it('updates approval settings with POST, which is the shape GitLab takes', async () => {
    server.route('/api/v4/projects/1/approvals', (req, res) => {
      respondJson(res, 200, { method: req.method });
    });

    await expect(client().updateApprovalSettings(1, { reset_approvals_on_push: true })).resolves.toEqual({
      method: 'POST',
    });
  });

  it('lists a group including its subgroups', async () => {
    server.route('/api/v4/groups/platform/projects', (req, res) => {
      respondJson(res, 200, [{ id: 1, path_with_namespace: 'platform/api', url: req.url }]);
    });

    const result = await client().listGroupProjects('platform');

    expect(result.items).toHaveLength(1);
    expect(server.requests[0]?.url).toContain('include_subgroups=true');
  });
});
