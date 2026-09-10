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
import { DEFAULT_URL, resolveGitLabConfig, type EnvLike } from '../src/config.js';
import { ConfigError } from '../src/errors.js';

const token = 'glpat-0123456789abcdef';

function env(overrides: EnvLike = {}): EnvLike {
  return { GITLAB_TOKEN: token, ...overrides };
}

describe('resolveGitLabConfig', () => {
  it('defaults to gitlab.com when no URL is configured', () => {
    expect(resolveGitLabConfig({}, env())).toStrictEqual({ url: DEFAULT_URL, token });
  });

  it('treats an empty GITLAB_URL as unset rather than as a URL', () => {
    expect(resolveGitLabConfig({}, env({ GITLAB_URL: '   ' })).url).toBe(DEFAULT_URL);
  });

  it('keeps the subpath a self-managed instance is served under', () => {
    expect(resolveGitLabConfig({}, env({ GITLAB_URL: 'https://example.com/gitlab/' })).url).toBe(
      'https://example.com/gitlab',
    );
  });

  it('drops the path of a pasted gitlab.com project URL', () => {
    // Otherwise every request goes to /group/project/api/v4/... and 404s with nothing naming the cause.
    expect(resolveGitLabConfig({}, env({ GITLAB_URL: 'https://gitlab.com/group/project' })).url).toBe(
      'https://gitlab.com',
    );
  });

  it('prefers an explicit override over the environment', () => {
    const config = resolveGitLabConfig({ url: 'https://flag.example.com', token: 'flag-token-value' }, env());
    expect(config).toStrictEqual({ url: 'https://flag.example.com', token: 'flag-token-value' });
  });

  it('refuses a missing token, naming both the variable and the flag', () => {
    expect(() => resolveGitLabConfig({}, {})).toThrow(ConfigError);
    expect(() => resolveGitLabConfig({}, {})).toThrow(/GITLAB_TOKEN or pass --gitlab-token/);
  });

  it('refuses a URL that is not one', () => {
    expect(() => resolveGitLabConfig({}, env({ GITLAB_URL: 'gitlab.example.com' }))).toThrow(/not a valid URL/);
  });

  it('refuses a non-HTTP scheme', () => {
    expect(() => resolveGitLabConfig({}, env({ GITLAB_URL: 'ssh://git@example.com' }))).toThrow(/http or https/);
  });

  it('refuses a certificate-verification opt-out instead of ignoring it', () => {
    // Silently ignoring it would leave a user believing verification is off when it is on.
    expect(() => resolveGitLabConfig({}, env({ GITLAB_SSL_VERIFY: 'false' }))).toThrow(/NODE_EXTRA_CA_CERTS/);
  });

  it('leaves a truthy GITLAB_SSL_VERIFY alone', () => {
    expect(() => resolveGitLabConfig({}, env({ GITLAB_SSL_VERIFY: 'true' }))).not.toThrow();
  });
});
