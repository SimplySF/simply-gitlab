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
import { ConfigError } from './errors.js';

export interface GitLabConfig {
  /** Instance origin, with any trailing path preserved for instances served under a subpath. */
  readonly url: string;
  /** Personal, project, or group access token, sent as `PRIVATE-TOKEN`. */
  readonly token: string;
}

/** Per-invocation overrides, sourced from global flags. Anything set here beats the environment. */
export interface ConfigOverrides {
  readonly url?: string;
  readonly token?: string;
}

export type EnvLike = Record<string, string | undefined>;

export const URL_ENV = 'GITLAB_URL';
export const TOKEN_ENV = 'GITLAB_TOKEN';
const SSL_VERIFY_ENV = 'GITLAB_SSL_VERIFY';

/**
 * Where an unconfigured `GITLAB_URL` points. GitLab is one product with one API, and the great
 * majority of tokens are gitlab.com tokens, so requiring the URL would be ceremony for the common
 * case. A self-managed instance sets the variable.
 */
export const DEFAULT_URL = 'https://gitlab.com';

const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);
const CA_BUNDLE_HINT = 'NODE_EXTRA_CA_CERTS=/path/to/ca.pem';

/**
 * Parses the configured base URL. Unlike Atlassian's two deployments, every GitLab instance
 * speaks the same `/api/v4` surface, so the only normalization needed is trimming a trailing
 * slash — and keeping any subpath, because self-managed instances are routinely served from one
 * (`https://example.com/gitlab`).
 */
function normalizeUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ConfigError(
      `GitLab URL is not a valid URL: ${rawUrl}. Set ${URL_ENV} to something like https://gitlab.example.com.`,
    );
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ConfigError(`GitLab URL must use http or https, got ${parsed.protocol} (${URL_ENV}).`);
  }

  // A pasted project URL — https://gitlab.com/group/project — would otherwise be treated as an
  // instance served under /group/project, and every request would 404 with nothing pointing at
  // the cause. gitlab.com has no subpath, so the path is noise there by construction.
  if (parsed.hostname.toLowerCase() === 'gitlab.com') return parsed.origin;

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * Certificate verification is not negotiable, so a `GITLAB_SSL_VERIFY=false` carried over from
 * other GitLab tooling fails loudly rather than being silently ignored — the alternative is a
 * user believing verification is off when it is on, or vice versa. The fix keeps verification
 * intact.
 */
function rejectSslOptOut(env: EnvLike): void {
  const raw = env[SSL_VERIFY_ENV];
  if (raw !== undefined && FALSE_VALUES.has(raw.trim().toLowerCase())) {
    throw new ConfigError(
      `${SSL_VERIFY_ENV}=${raw} is not supported: this CLI always verifies TLS certificates. ` +
        `If your GitLab instance is behind an internal or agency CA, trust that CA instead with ${CA_BUNDLE_HINT}.`,
    );
  }
}

export function resolveGitLabConfig(overrides: ConfigOverrides = {}, env: EnvLike = process.env): GitLabConfig {
  rejectSslOptOut(env);

  const rawUrl = (overrides.url ?? env[URL_ENV])?.trim();
  const token = (overrides.token ?? env[TOKEN_ENV])?.trim();

  if (!token) {
    throw new ConfigError(
      `GitLab authentication requires a token. Set ${TOKEN_ENV} or pass --gitlab-token. ` +
        'Create one under Preferences > Access tokens with the api scope (read_api is enough for read-only use).',
    );
  }

  return { url: normalizeUrl(rawUrl === undefined || rawUrl === '' ? DEFAULT_URL : rawUrl), token };
}
