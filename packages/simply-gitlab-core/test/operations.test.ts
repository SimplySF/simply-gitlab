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
import { describe, expect, it } from 'vitest';
import { HIDDEN, maskVariables, tailLog } from '../src/cicd.js';
import { buildCommitBody, parseActionsInput, parseCommitActions } from '../src/commits.js';
import { ConfigError } from '../src/errors.js';
import { assertNotEmpty, mergeBody } from '../src/json-input.js';
import { assertIid, buildMergeRequestCreateBody, buildMergeRequestUpdateBody } from '../src/merge-requests.js';
import { decodeFileContent } from '../src/repository-files.js';
import { needsAdvancedSearch, searchColumns } from '../src/search.js';

describe('assertIid', () => {
  it('accepts a positive integer, and a numeric string', () => {
    expect(assertIid(42)).toBe(42);
    expect(assertIid('42')).toBe(42);
  });

  it.each([0, -1, 1.5, 'abc', undefined, null])('refuses %p, naming iid rather than id', (value) => {
    expect(() => assertIid(value)).toThrow(ConfigError);
    expect(() => assertIid(value)).toThrow(/iid/);
  });
});

describe('buildMergeRequestCreateBody', () => {
  it('maps typed input onto GitLab attribute names', () => {
    expect(
      buildMergeRequestCreateBody({
        sourceBranch: 'feature',
        targetBranch: 'main',
        title: 'feat: thing',
        labels: ['a', 'b'],
        squash: true,
      }),
    ).toStrictEqual({
      source_branch: 'feature',
      target_branch: 'main',
      title: 'feat: thing',
      labels: 'a,b',
      squash: true,
    });
  });

  it('marks a draft the only way GitLab does: by prefixing the title', () => {
    expect(buildMergeRequestCreateBody({ sourceBranch: 'f', targetBranch: 'm', title: 'x', draft: true }).title).toBe(
      'Draft: x',
    );
  });

  it('does not prefix a title that already says Draft', () => {
    expect(
      buildMergeRequestCreateBody({ sourceBranch: 'f', targetBranch: 'm', title: 'Draft: x', draft: true }).title,
    ).toBe('Draft: x');
  });

  it('merges typed input over a raw body', () => {
    const body = buildMergeRequestCreateBody({
      sourceBranch: 'f',
      targetBranch: 'm',
      title: 'flag wins',
      body: { title: 'template loses', approvals_before_merge: 2 },
    });
    expect(body.title).toBe('flag wins');
    expect(body.approvals_before_merge).toBe(2);
  });

  it.each([
    [{ targetBranch: 'm', title: 't' }, /--source-branch/],
    [{ sourceBranch: 'f', title: 't' }, /--target-branch/],
    [{ sourceBranch: 'f', targetBranch: 'm' }, /--title/],
  ])('refuses %p by naming the missing flag', (input, expected) => {
    expect(() => buildMergeRequestCreateBody(input)).toThrow(expected);
  });
});

describe('buildMergeRequestUpdateBody', () => {
  it('sends only what was named', () => {
    expect(buildMergeRequestUpdateBody({ title: 'new' })).toStrictEqual({ title: 'new' });
  });

  it('refuses an empty update, which GitLab would answer 200 and no change', () => {
    expect(() => buildMergeRequestUpdateBody({})).toThrow(/Nothing to change/);
  });
});

describe('parseCommitActions', () => {
  it('accepts a well-formed action list', () => {
    expect(parseCommitActions([{ action: 'create', file_path: 'a.txt', content: 'x' }])).toHaveLength(1);
  });

  it('refuses an empty list', () => {
    expect(() => parseCommitActions([])).toThrow(/at least one action/);
  });

  it.each([
    [[{ action: 'nope', file_path: 'a' }], /actions\[0\]\.action/],
    [[{ action: 'create' }], /actions\[0\]\.file_path/],
    [[{ action: 'create', file_path: 'a' }], /actions\[0\]\.content/],
    [[{ action: 'move', file_path: 'a' }], /actions\[0\]\.previous_path/],
    [[{ action: 'chmod', file_path: 'a' }], /actions\[0\]\.execute_filemode/],
  ])('names the offending index and field for %p', (actions, expected) => {
    // GitLab's own 400 names neither, which turns a ten-file commit into a hunt.
    expect(() => parseCommitActions(actions)).toThrow(expected);
  });
});

describe('buildCommitBody', () => {
  it('requires a branch and a message, naming the flag', () => {
    expect(() => buildCommitBody({ message: 'm', actions: [] })).toThrow(/--branch/);
    expect(() => buildCommitBody({ branch: 'b', actions: [] })).toThrow(/--message/);
  });

  it('validates the actions it was given', () => {
    expect(() => buildCommitBody({ branch: 'b', message: 'm', actions: 'not an array' })).toThrow(
      /at least one action/,
    );
  });
});

describe('parseActionsInput', () => {
  it('reports a position but never the content of what failed to parse', () => {
    let message = '';
    try {
      parseActionsInput('{"token": "glpat-secret-value-here"');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/not valid JSON/);
    expect(message).not.toContain('glpat-secret-value-here');
  });
});

describe('decodeFileContent', () => {
  it('decodes base64 content', () => {
    const content = Buffer.from('hello\n', 'utf8').toString('base64');
    expect(decodeFileContent({ encoding: 'base64', content })).toMatchObject({ text: 'hello\n', printable: true });
  });

  it('honours an encoding of "text" instead of assuming base64', () => {
    // Decoding plain text as base64 yields silent garbage the user cannot diagnose.
    expect(decodeFileContent({ encoding: 'text', content: 'hello' }).text).toBe('hello');
  });

  it('marks binary content unprintable', () => {
    const content = Buffer.from([0x89, 0x50, 0x00, 0x0d]).toString('base64');
    expect(decodeFileContent({ encoding: 'base64', content }).printable).toBe(false);
  });

  it('refuses a payload with no content', () => {
    expect(() => decodeFileContent({})).toThrow(ConfigError);
  });
});

describe('maskVariables', () => {
  it('replaces every value, including on a variable GitLab calls masked', () => {
    // "masked" only hides a value in job logs; the API returns it in clear text regardless.
    expect(maskVariables([{ key: 'DEPLOY_KEY', value: 'secret', masked: true }])).toStrictEqual([
      { key: 'DEPLOY_KEY', value: HIDDEN, masked: true },
    ]);
  });

  it('leaves an entry with no value alone', () => {
    expect(maskVariables([{ key: 'K' }])).toStrictEqual([{ key: 'K' }]);
  });
});

describe('tailLog', () => {
  it('keeps the last N lines and says it truncated', () => {
    expect(tailLog('a\nb\nc\nd', 2)).toStrictEqual({ text: 'c\nd', truncated: true });
  });

  it('returns the whole log when it fits, or when the limit is zero', () => {
    expect(tailLog('a\nb', 5)).toStrictEqual({ text: 'a\nb', truncated: false });
    expect(tailLog('a\nb', 0)).toStrictEqual({ text: 'a\nb', truncated: false });
  });
});

describe('mergeBody and assertNotEmpty', () => {
  it('drops unset typed values so they never overwrite the body', () => {
    expect(mergeBody({ title: 'kept' }, { title: undefined, squash: true })).toStrictEqual({
      title: 'kept',
      squash: true,
    });
  });

  it('refuses an empty result', () => {
    expect(() => assertNotEmpty({}, 'merge request')).toThrow(/Nothing to change/);
  });
});

describe('search scopes', () => {
  it('knows which scopes need Advanced Search', () => {
    expect(needsAdvancedSearch('blobs')).toBe(true);
    expect(needsAdvancedSearch('projects')).toBe(false);
  });

  it('renders a different column set per scope', () => {
    expect(searchColumns('users').map((column) => column.header)).toContain('USERNAME');
    expect(searchColumns('blobs').map((column) => column.header)).toContain('PATH');
  });
});
