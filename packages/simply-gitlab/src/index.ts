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

// This package is a CLI first (see bin/run.js). The library surface lives in
// `@simplysf/simply-gitlab-core`; these re-exports exist so a consumer that installed the CLI can
// reach the client without a second dependency, and so the two packages cannot drift on the names
// they use for the same thing. New code should import the core package directly, which is where
// anything added from here on will appear.
export {
  AuthError,
  CliError,
  ConfigError,
  GitLabClient,
  HttpError,
  NetworkError,
  resolveGitLabConfig,
  type ConfigOverrides,
  type EnvLike,
  type GitLabConfig,
  type ListResult,
  type ProjectRef,
} from '@simplysf/simply-gitlab-core';
