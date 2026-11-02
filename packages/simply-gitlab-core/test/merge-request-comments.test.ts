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
import { commentLocation, commentType, keepComment } from '../src/merge-request-comments.js';
import { formatTable } from '../src/output.js';
import { commentColumns } from '../src/tables.js';
import { respondJson, startTestServer, type TestServer } from '../src/testing.js';

const plain = { id: 1, type: null, system: false, body: 'Looks good' };
const thread = { id: 2, type: 'DiscussionNote', system: false, body: 'Why?' };
const code = {
  id: 3,
  type: 'DiffNote',
  system: false,
  body: 'Off by one here',
  resolvable: true,
  resolved: false,
  position: { position_type: 'text', new_path: 'src/a.ts', old_path: 'src/a.ts', new_line: 12, old_line: null },
};
const system = { id: 4, type: null, system: true, body: 'added 3 commits' };

describe('commentType', () => {
  it('names each kind of note, and lets system win over type', () => {
    expect([plain, thread, code, system].map(commentType)).toStrictEqual(['comment', 'thread', 'code', 'system']);
    expect(commentType({ type: 'DiffNote', system: true })).toBe('system');
  });
});

describe('commentLocation', () => {
  it('gives the new path and line for an added or unchanged line', () => {
    expect(commentLocation(code)).toBe('src/a.ts:12');
  });

  it('gives the old path and line for a removed line, the only place it exists', () => {
    expect(commentLocation({ position: { new_path: 'b.ts', old_path: 'a.ts', new_line: null, old_line: 7 } })).toBe(
      'a.ts:7',
    );
  });

  it('gives just the path for a comment on a whole file', () => {
    expect(commentLocation({ position: { position_type: 'file', new_path: 'a.ts', old_path: 'a.ts' } })).toBe('a.ts');
  });

  it('is undefined for a note that is not on the diff', () => {
    expect(commentLocation(plain)).toBeUndefined();
  });
});

describe('keepComment', () => {
  const all = [plain, thread, code, system];
  const ids = (options: Parameters<typeof keepComment>[1]): unknown[] =>
    all.filter((note) => keepComment(note, options)).map((note) => note.id);

  it('drops system notes by default', () => {
    expect(ids({})).toStrictEqual([1, 2, 3]);
  });

  it('keeps them when asked', () => {
    expect(ids({ includeSystem: true })).toStrictEqual([1, 2, 3, 4]);
  });

  it('keeps only code comments with codeOnly', () => {
    expect(ids({ codeOnly: true })).toStrictEqual([3]);
  });
});

describe('commentColumns', () => {
  it('shows the location and resolution of a code comment, and only the first line of a body', () => {
    const long = { ...plain, id: 9, body: `${'x'.repeat(100)}\nsecond line` };
    const table = formatTable([code, long], commentColumns);

    expect(table.split('\n')[0]).toMatch(/^ID\s+AUTHOR\s+CREATED\s+TYPE\s+LOCATION\s+RESOLVED\s+BODY$/);
    expect(table).toContain('src/a.ts:12');
    expect(table).toMatch(/code\s+src\/a\.ts:12\s+no\s+Off by one here/);
    expect(table).toContain(`${'x'.repeat(79)}…`);
    expect(table).not.toContain('second line');
  });
});

describe('GitLabClient.listMergeRequestNotes', () => {
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

  const route = '/api/v4/projects/group%2Fproject/merge_requests/42/notes';

  it('reads the encoded notes route, newest first by creation time', async () => {
    server.route(route, (_req, res) => respondJson(res, 200, [plain]));

    await client().listMergeRequestNotes('group/project', 42, { sort: 'desc' });

    const url = new URL(server.requests[0]?.url ?? '/', 'http://127.0.0.1');
    expect(url.pathname).toBe(route);
    expect(url.searchParams.get('sort')).toBe('desc');
    expect(url.searchParams.get('order_by')).toBe('created_at');
  });

  it('counts the limit in kept comments across pages, at full page size, with no total', async () => {
    server.route(route, (req, res) => {
      const page = Number(new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('page'));
      // Each page holds two system notes and one comment; X-Total counts all of them.
      res.writeHead(200, { 'content-type': 'application/json', 'x-total': '300', 'x-next-page': String(page + 1) });
      res.end(JSON.stringify([system, { ...plain, id: page }, system]));
    });

    const result = await client().listMergeRequestNotes('group/project', 42, {}, 3);

    expect(result.items.map((note) => (note as { id: number }).id)).toStrictEqual([1, 2, 3]);
    expect(result.total).toBeUndefined();
    expect(result.complete).toBe(false);
    expect(server.requests.every((request) => request.url?.includes('per_page=100'))).toBe(true);
  });

  it('reports a filtered last page that overflows the limit as cut short', async () => {
    server.route(route, (_req, res) => respondJson(res, 200, [plain, thread, code]));

    const result = await client().listMergeRequestNotes('group/project', 42, {}, 2);

    expect(result.items).toHaveLength(2);
    expect(result.complete).toBe(false);
  });

  it('returns only code comments with codeOnly', async () => {
    server.route(route, (_req, res) => respondJson(res, 200, [plain, thread, code, system]));

    const result = await client().listMergeRequestNotes('group/project', 42, { codeOnly: true });

    expect(result.items).toStrictEqual([code]);
    expect(result.complete).toBe(true);
  });

  it('keeps GitLab total when every note is wanted', async () => {
    server.route(route, (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-total': '4' });
      res.end(JSON.stringify([plain, thread, code, system]));
    });

    const result = await client().listMergeRequestNotes('group/project', 42, { includeSystem: true });

    expect(result.items).toHaveLength(4);
    expect(result.total).toBe(4);
  });
});
