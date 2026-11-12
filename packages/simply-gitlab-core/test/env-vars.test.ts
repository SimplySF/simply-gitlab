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

import { describe, expect, it } from 'vitest';
import { resolveGitLabConfig } from '../src/config.js';
import { CONNECTION_ENV, deprecatedEnvInUse, deprecatedEnvWarning, envValue, LEGACY_ENV } from '../src/env-vars.js';
import { secretValues } from '../src/redaction.js';
import { isReadOnly } from '../src/write-safety.js';

describe('LEGACY_ENV', () => {
  it('maps every SIMPLY_ name to the same name without the prefix', () => {
    for (const [current, legacy] of Object.entries(LEGACY_ENV)) {
      expect(current).toBe(`SIMPLY_${legacy}`);
    }
  });

  it('leaves only the CLI-only project setting out of CONNECTION_ENV', () => {
    expect(Object.keys(LEGACY_ENV).filter((name) => !CONNECTION_ENV.includes(name as never))).toStrictEqual([
      'SIMPLY_GITLAB_PROJECT',
    ]);
  });
});

describe('envValue', () => {
  it('prefers the prefixed name', () => {
    expect(envValue({ SIMPLY_GITLAB_URL: 'new', GITLAB_URL: 'old' }, 'SIMPLY_GITLAB_URL')).toBe('new');
  });

  it('falls back to the deprecated name when the prefixed one is unset or empty', () => {
    expect(envValue({ GITLAB_URL: 'old' }, 'SIMPLY_GITLAB_URL')).toBe('old');
    expect(envValue({ SIMPLY_GITLAB_URL: '', GITLAB_URL: 'old' }, 'SIMPLY_GITLAB_URL')).toBe('old');
  });

  it('returns what is there when neither name has a value', () => {
    expect(envValue({}, 'SIMPLY_GITLAB_URL')).toBeUndefined();
    expect(envValue({ SIMPLY_GITLAB_URL: '' }, 'SIMPLY_GITLAB_URL')).toBe('');
  });
});

describe('deprecated names still configure every setting', () => {
  it('resolves the connection from unprefixed names', () => {
    expect(
      resolveGitLabConfig({}, { GITLAB_URL: 'https://gitlab.example.com', GITLAB_TOKEN: 'glpat-legacy' }),
    ).toStrictEqual({ url: 'https://gitlab.example.com', token: 'glpat-legacy' });
  });

  it('lets a prefixed name override its deprecated one', () => {
    const config = resolveGitLabConfig({}, { SIMPLY_GITLAB_TOKEN: 'glpat-new', GITLAB_TOKEN: 'glpat-other-tool' });
    expect(config.token).toBe('glpat-new');
  });

  it('honours GITLAB_READ_ONLY and GITLAB_SSL_VERIFY', () => {
    expect(isReadOnly({ GITLAB_READ_ONLY: '1' })).toBe(true);
    expect(isReadOnly({ SIMPLY_GITLAB_READ_ONLY: '0', GITLAB_READ_ONLY: '1' })).toBe(false);
    expect(() => resolveGitLabConfig({}, { SIMPLY_GITLAB_TOKEN: 't', GITLAB_SSL_VERIFY: 'false' })).toThrow(
      /SIMPLY_GITLAB_SSL_VERIFY=false is not supported/,
    );
  });

  it('redacts the token under either name', () => {
    const secrets = secretValues({ GITLAB_TOKEN: 'legacy-token-value', SIMPLY_GITLAB_TOKEN: 'current-token-value' });
    expect([...secrets].sort()).toStrictEqual(['current-token-value', 'legacy-token-value']);
  });
});

describe('deprecation reporting', () => {
  it('reports nothing when only prefixed names are used', () => {
    expect(deprecatedEnvInUse({ SIMPLY_GITLAB_TOKEN: 'x' })).toStrictEqual([]);
    expect(deprecatedEnvWarning({ SIMPLY_GITLAB_TOKEN: 'x' })).toBeUndefined();
  });

  it('reports a deprecated name only when it is the one supplying the value', () => {
    // Shadowed by its prefixed name, GITLAB_TOKEN is likely there for glab or another tool.
    expect(
      deprecatedEnvInUse({ SIMPLY_GITLAB_TOKEN: 'x', GITLAB_TOKEN: 'y', GITLAB_URL: 'z', GITLAB_PROJECT: '' }),
    ).toStrictEqual([{ legacy: 'GITLAB_URL', current: 'SIMPLY_GITLAB_URL' }]);
  });

  it('can be limited to the names a consumer reads', () => {
    expect(deprecatedEnvWarning({ GITLAB_PROJECT: 'a/b' }, CONNECTION_ENV)).toBeUndefined();
    expect(deprecatedEnvWarning({ GITLAB_PROJECT: 'a/b' })).toContain('GITLAB_PROJECT → SIMPLY_GITLAB_PROJECT');
  });

  it('names every rename in one line, without values', () => {
    const warning = deprecatedEnvWarning({ GITLAB_URL: 'https://gitlab.example.com', GITLAB_READ_ONLY: '1' });
    expect(warning).toBe(
      'Deprecated environment variables in use: GITLAB_URL → SIMPLY_GITLAB_URL, ' +
        'GITLAB_READ_ONLY → SIMPLY_GITLAB_READ_ONLY. Rename to the SIMPLY_ prefix; the unprefixed ' +
        'names will stop working in a future major release.',
    );
    expect(warning).not.toContain('gitlab.example.com');
  });

  it('uses the singular for one variable', () => {
    expect(deprecatedEnvWarning({ GITLAB_URL: 'x' })).toMatch(/^Deprecated environment variable in use: /);
  });
});
