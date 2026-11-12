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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContext } from '../src/context.js';

const TOKEN = 'glpat-legacy-token-value';

function stderrDuring(action: () => void): string {
  const written: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk): boolean => {
    written.push(String(chunk));
    return true;
  });
  action();
  vi.restoreAllMocks();
  return written.join('');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deprecated environment variable names', () => {
  it('still configure the server, with one warning on stderr at startup', () => {
    let context: ReturnType<typeof createContext> | undefined;
    const output = stderrDuring(() => {
      context = createContext({ env: { GITLAB_URL: 'https://gitlab.example.com', GITLAB_TOKEN: TOKEN } });
    });

    expect(context?.config()).toStrictEqual({ url: 'https://gitlab.example.com', token: TOKEN });
    expect(output).toBe(
      'Warning: Deprecated environment variables in use: GITLAB_URL → SIMPLY_GITLAB_URL, ' +
        'GITLAB_TOKEN → SIMPLY_GITLAB_TOKEN. Rename to the SIMPLY_ prefix; the unprefixed names will ' +
        'stop working in a future major release.\n',
    );
  });

  it('do not warn about GITLAB_PROJECT, which the server never reads', () => {
    const output = stderrDuring(() => {
      createContext({ env: { SIMPLY_GITLAB_TOKEN: TOKEN, GITLAB_PROJECT: 'group/project' } });
    });

    expect(output).toBe('');
  });

  it('write nothing when only the prefixed names are used', () => {
    const output = stderrDuring(() => {
      createContext({ env: { SIMPLY_GITLAB_TOKEN: TOKEN, GITLAB_TOKEN: 'glpat-for-another-tool' } });
    });

    expect(output).toBe('');
  });
});
