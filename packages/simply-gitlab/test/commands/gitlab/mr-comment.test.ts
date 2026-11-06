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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { respondJson, startTestServer, type TestServer } from '@simplysf/simply-gitlab-core/testing';
import GitlabMrCommentList from '../../../src/commands/gitlab/mr/comment/list.js';

let server: TestServer;

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  await server.close();
  vi.restoreAllMocks();
});

function argv(...extra: string[]): string[] {
  return ['--gitlab-url', server.baseUrl, '--gitlab-token', 'glpat-testing', '--project', 'group/project', ...extra];
}

const ROUTE = '/api/v4/projects/group%2Fproject/merge_requests/42/notes';

const NOTES = [
  { id: 1, type: null, system: false, body: 'Looks good', author: { username: 'ana' } },
  {
    id: 2,
    type: 'DiffNote',
    system: false,
    body: 'Off by one \u001bhere',
    resolvable: true,
    resolved: true,
    author: { username: 'bo' },
    position: { new_path: 'src/a.ts', old_path: 'src/a.ts', new_line: 12 },
  },
  { id: 3, type: null, system: true, body: 'added 3 commits' },
];

interface ListOutcome {
  items: Array<{ id: number }>;
  complete: boolean;
}

let written: string[] = [];

function output(): string {
  return written.join('');
}

describe('gitlab mr comment list', () => {
  beforeEach(() => {
    server.route(ROUTE, (_req, res) => respondJson(res, 200, NOTES));
    written = [];
    vi.spyOn(GitlabMrCommentList.prototype, 'log').mockImplementation((message?: string) => {
      written.push(message ?? '');
    });
  });

  it('hides system notes by default', async () => {
    const result = (await GitlabMrCommentList.run(argv('--mr', '42'))) as ListOutcome;
    expect(result.items.map((note) => note.id)).toStrictEqual([1, 2]);
  });

  it('shows them with --include-system', async () => {
    const result = (await GitlabMrCommentList.run(argv('--mr', '42', '--include-system'))) as ListOutcome;
    expect(result.items.map((note) => note.id)).toStrictEqual([1, 2, 3]);
  });

  it('returns only code comments with --code-only, and prints where each one is', async () => {
    const result = (await GitlabMrCommentList.run(argv('--mr', '42', '--code-only'))) as ListOutcome;

    expect(result.items.map((note) => note.id)).toStrictEqual([2]);
    expect(output()).toContain('src/a.ts:12');
  });

  it('refuses --code-only with --include-system before making a request', async () => {
    await expect(GitlabMrCommentList.run(argv('--mr', '42', '--code-only', '--include-system'))).rejects.toThrow();
    expect(server.requests).toHaveLength(0);
  });

  it('strips escape sequences out of comment text', async () => {
    await GitlabMrCommentList.run(argv('--mr', '42'));
    expect(output()).toContain('Off by one here');
    expect(output()).not.toContain('\u001b');
  });
});
