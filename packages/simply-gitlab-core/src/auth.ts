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

import type { GitLabConfig } from './config.js';

/**
 * GitLab accepts the same token as `PRIVATE-TOKEN` or as an OAuth bearer, and the two are not
 * interchangeable: a personal, project, or group access token authenticates only through
 * `PRIVATE-TOKEN`, while `Authorization: Bearer` is reserved for OAuth 2 tokens. This CLI issues
 * neither OAuth flow, so it sends the header that works for every token a user can create by
 * hand. Returns just the header so callers can merge it into a request.
 */
export function buildAuthHeaders(config: GitLabConfig): Record<string, string> {
  return { 'PRIVATE-TOKEN': config.token };
}
