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

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnvFile, parseEnvFile } from '../src/env-file.js';
import { ConfigError } from '../src/errors.js';
import { assertWritesAllowed, isReadOnly } from '../src/write-safety.js';

function envFile(contents: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'simply-gitlab-')), '.env');
  writeFileSync(path, contents, 'utf8');
  return path;
}

describe('parseEnvFile', () => {
  it('reads assignments, tolerating export, quotes, and comments', () => {
    expect(
      parseEnvFile(
        ['# a comment', 'export SIMPLY_GITLAB_URL=https://example.com', 'SIMPLY_GITLAB_TOKEN="tok en" # note'].join(
          '\n',
        ),
      ),
    ).toStrictEqual({ SIMPLY_GITLAB_URL: 'https://example.com', SIMPLY_GITLAB_TOKEN: 'tok en' });
  });
});

describe('loadEnvFile', () => {
  it('applies only the GitLab connection variables', () => {
    // Without the allowlist, a file could set NODE_TLS_REJECT_UNAUTHORIZED and hand over the token.
    const env: NodeJS.ProcessEnv = {};
    loadEnvFile(envFile('SIMPLY_GITLAB_TOKEN=abc\nNODE_TLS_REJECT_UNAUTHORIZED=0\nUNRELATED=1\n'), env);
    expect(env).toStrictEqual({ SIMPLY_GITLAB_TOKEN: 'abc' });
  });

  it('lets the real environment win, but not an empty export', () => {
    const env: NodeJS.ProcessEnv = { SIMPLY_GITLAB_URL: 'https://real.example.com', SIMPLY_GITLAB_TOKEN: '' };
    loadEnvFile(envFile('SIMPLY_GITLAB_URL=https://file.example.com\nSIMPLY_GITLAB_TOKEN=from-file\n'), env);
    expect(env.SIMPLY_GITLAB_URL).toBe('https://real.example.com');
    expect(env.SIMPLY_GITLAB_TOKEN).toBe('from-file');
  });

  it('still applies a deprecated unprefixed name', () => {
    const env: NodeJS.ProcessEnv = {};
    loadEnvFile(envFile('GITLAB_TOKEN=from-file\n'), env);
    expect(env).toStrictEqual({ GITLAB_TOKEN: 'from-file' });
  });

  it('treats both names of a setting as one when the environment already sets it', () => {
    // The prefixed name wins on lookup, so without this a file's SIMPLY_GITLAB_READ_ONLY=0 would
    // outrank a real GITLAB_READ_ONLY=1 and turn the guard off from a file.
    const env: NodeJS.ProcessEnv = { GITLAB_READ_ONLY: '1', SIMPLY_GITLAB_URL: 'https://real.example.com' };
    loadEnvFile(envFile('SIMPLY_GITLAB_READ_ONLY=0\nGITLAB_URL=https://file.example.com\n'), env);
    expect(env.SIMPLY_GITLAB_READ_ONLY).toBeUndefined();
    expect(env.GITLAB_URL).toBeUndefined();
  });

  it('does not accept GITLAB_PROJECT, under either name', () => {
    const env: NodeJS.ProcessEnv = {};
    loadEnvFile(envFile('SIMPLY_GITLAB_PROJECT=a/b\nGITLAB_PROJECT=a/b\n'), env);
    expect(env).toStrictEqual({});
  });

  it('refuses a path the caller named but that cannot be read', () => {
    expect(() => loadEnvFile(join(tmpdir(), 'definitely-not-here.env'), {})).toThrow(ConfigError);
  });
});

describe('the read-only guard', () => {
  it.each(['1', 'true', 'YES', ' on '])('treats %p as read-only', (value) => {
    expect(isReadOnly({ SIMPLY_GITLAB_READ_ONLY: value })).toBe(true);
    expect(() => assertWritesAllowed({ SIMPLY_GITLAB_READ_ONLY: value })).toThrow(/SIMPLY_GITLAB_READ_ONLY/);
  });

  it.each([undefined, '', 'false', 'nope'])('treats %p as not read-only', (value) => {
    expect(isReadOnly({ SIMPLY_GITLAB_READ_ONLY: value })).toBe(false);
    expect(() => assertWritesAllowed({ SIMPLY_GITLAB_READ_ONLY: value })).not.toThrow();
  });
});
