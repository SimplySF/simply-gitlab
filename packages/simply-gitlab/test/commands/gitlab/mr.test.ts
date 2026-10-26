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
import { respondJson, startTestServer, type TestServer } from '@simplysf/simply-gitlab-core/testing';
import GitlabMrCreate from '../../../src/commands/gitlab/mr/create.js';
import GitlabMrList from '../../../src/commands/gitlab/mr/list.js';
import GitlabMrMerge from '../../../src/commands/gitlab/mr/merge.js';
import GitlabMrUpdate from '../../../src/commands/gitlab/mr/update.js';

let server: TestServer;

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  await server.close();
});

function argv(...extra: string[]): string[] {
  return ['--gitlab-url', server.baseUrl, '--gitlab-token', 'glpat-testing', '--project', 'group/project', ...extra];
}

interface ListOutcome {
  items: unknown[];
  total?: number;
  pages: number;
  complete: boolean;
}

describe('gitlab mr list', () => {
  it('follows pages until the instance reports no next page', async () => {
    server.route('/api/v4/projects/group%2Fproject/merge_requests', (req, res) => {
      const page = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('page');
      const headers: Record<string, string> = { 'content-type': 'application/json', 'x-total': '2' };
      if (page === '1') headers['x-next-page'] = '2';
      res.writeHead(200, headers);
      res.end(JSON.stringify([{ iid: page === '1' ? 1 : 2, title: 'a', state: 'opened' }]));
    });

    const result = (await GitlabMrList.run(argv('--limit', '10'))) as ListOutcome;

    expect(result.items).toHaveLength(2);
    expect(result.pages).toBe(2);
    expect(result.complete).toBe(true);
  });

  it('stops at --limit and reports the results as incomplete', async () => {
    server.route('/api/v4/projects/group%2Fproject/merge_requests', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-next-page': '2', 'x-total': '500' });
      res.end(JSON.stringify([{ iid: 1 }, { iid: 2 }]));
    });

    const result = (await GitlabMrList.run(argv('--limit', '2'))) as ListOutcome;

    expect(result.items).toHaveLength(2);
    expect(result.complete).toBe(false);
    expect(result.total).toBe(500);
  });

  it('defaults to open merge requests', async () => {
    let state: string | null = null;
    server.route('/api/v4/projects/group%2Fproject/merge_requests', (req, res) => {
      state = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('state');
      respondJson(res, 200, []);
    });

    await GitlabMrList.run(argv());
    expect(state).toBe('opened');
  });
});

describe('gitlab mr create', () => {
  it('sends nothing under --dry-run and returns the request instead', async () => {
    const request = (await GitlabMrCreate.run(
      argv('--source-branch', 'feature', '--target-branch', 'main', '--title', 'feat: thing', '--dry-run'),
    )) as Record<string, unknown>;

    expect(request).toMatchObject({ source_branch: 'feature', target_branch: 'main', title: 'feat: thing' });
    expect(server.requests).toHaveLength(0);
  });

  it('marks a draft by prefixing the title, which is how GitLab does it', async () => {
    const request = (await GitlabMrCreate.run(
      argv('--source-branch', 'f', '--target-branch', 'main', '--title', 'wip', '--draft', '--dry-run'),
    )) as Record<string, unknown>;

    expect(request.title).toBe('Draft: wip');
  });

  it('refuses a missing branch before making a request', async () => {
    await expect(GitlabMrCreate.run(argv('--target-branch', 'main', '--title', 't'))).rejects.toThrow(
      /--source-branch/,
    );
    expect(server.requests).toHaveLength(0);
  });
});

describe('gitlab mr update', () => {
  it('sends only the attributes that were named', async () => {
    const request = (await GitlabMrUpdate.run(argv('--mr', '42', '--title', 'renamed', '--dry-run'))) as Record<
      string,
      unknown
    >;

    expect(request).toStrictEqual({ title: 'renamed' });
  });

  it('refuses an update that names nothing to change', async () => {
    // GitLab would answer 200 with an unchanged merge request, which reads as success.
    await expect(GitlabMrUpdate.run(argv('--mr', '42'))).rejects.toThrow(/Nothing to change/);
    expect(server.requests).toHaveLength(0);
  });

  it('addresses the merge request by its iid', async () => {
    server.route('/api/v4/projects/group%2Fproject/merge_requests/42', (_req, res) => {
      respondJson(res, 200, { iid: 42, title: 'renamed', state: 'opened' });
    });

    await GitlabMrUpdate.run(argv('--mr', '42', '--title', 'renamed'));

    expect(server.requests[0]?.method).toBe('PUT');
    expect(server.requests[0]?.url).toBe('/api/v4/projects/group%2Fproject/merge_requests/42');
  });
});

describe('gitlab mr merge', () => {
  const SHA = 'a'.repeat(40);
  const MERGE_PATH = '/api/v4/projects/group%2Fproject/merge_requests/42/merge';

  afterEach(() => {
    delete process.env.GITLAB_READ_ONLY;
  });

  it('sends nothing without --confirm, and says how to send it', async () => {
    await expect(GitlabMrMerge.run(argv('--mr', '42', '--sha', SHA))).rejects.toThrow(/Pass --confirm/);
    expect(server.requests).toHaveLength(0);
  });

  it('returns the request under --dry-run without sending it', async () => {
    const request = await GitlabMrMerge.run(argv('--mr', '42', '--squash', '--remove-source-branch', '--dry-run'));

    expect(request).toStrictEqual({ squash: true, should_remove_source_branch: true });
    expect(server.requests).toHaveLength(0);
  });

  it('merges with --confirm, pinned to the reviewed head', async () => {
    server.route(MERGE_PATH, (_req, res) => {
      respondJson(res, 200, { iid: 42, state: 'merged', target_branch: 'main' });
    });

    const merged = await GitlabMrMerge.run(argv('--mr', '42', '--sha', SHA, '--confirm'));

    expect(merged).toMatchObject({ state: 'merged' });
    expect(server.requests[0]).toMatchObject({ method: 'PUT', url: MERGE_PATH });
    expect(JSON.parse(server.requests[0]?.body ?? '{}')).toStrictEqual({ sha: SHA });
  });

  it('refuses --auto-merge with --skip-merge-train', async () => {
    await expect(
      GitlabMrMerge.run(argv('--mr', '42', '--auto-merge', '--skip-merge-train', '--sha', SHA, '--confirm')),
    ).rejects.toThrow(/cannot also be provided|--auto-merge/);
    expect(server.requests).toHaveLength(0);
  });

  it('refuses --skip-merge-train without --sha before any request', async () => {
    await expect(GitlabMrMerge.run(argv('--mr', '42', '--skip-merge-train', '--confirm'))).rejects.toThrow(
      /needs --sha/,
    );
    expect(server.requests).toHaveLength(0);
  });

  it('checks the project allows skipping the train, even on a dry run', async () => {
    server.route('/api/v4/projects/group%2Fproject', (_req, res) => {
      respondJson(res, 200, { merge_trains_enabled: true, merge_trains_skip_train_allowed: false });
    });

    await expect(
      GitlabMrMerge.run(argv('--mr', '42', '--skip-merge-train', '--sha', SHA, '--dry-run')),
    ).rejects.toThrow(/does not allow skipping the merge train/);
    expect(server.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('skips the train when the project allows it', async () => {
    server.route('/api/v4/projects/group%2Fproject', (_req, res) => {
      respondJson(res, 200, {
        merge_trains_enabled: true,
        merge_trains_skip_train_allowed: true,
        merge_method: 'merge',
      });
    });
    server.route(MERGE_PATH, (_req, res) => {
      respondJson(res, 200, { iid: 42, state: 'merged', target_branch: 'main' });
    });

    await GitlabMrMerge.run(argv('--mr', '42', '--skip-merge-train', '--sha', SHA, '--confirm'));

    const put = server.requests.find((request) => request.method === 'PUT');
    expect(JSON.parse(put?.body ?? '{}')).toStrictEqual({ sha: SHA, skip_merge_train: true });
  });

  it('is refused under GITLAB_READ_ONLY like every write', async () => {
    process.env.GITLAB_READ_ONLY = '1';

    await expect(GitlabMrMerge.run(argv('--mr', '42', '--confirm'))).rejects.toThrow(/GITLAB_READ_ONLY/);
    expect(server.requests).toHaveLength(0);
  });
});
