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
import {
  type EnvLike,
  GitLabClient,
  type GitLabConfig,
  loadEnvFile,
  resolveGitLabConfig,
} from '@simplysf/simply-gitlab-core';

export interface ServerOptions {
  /**
   * Register the tools that change data. Off by default, so a server launched without thinking
   * about it can only read. Even when on, a write is still refused when the environment carries
   * `GITLAB_READ_ONLY`, exactly as the CLI refuses it.
   */
  readonly allowWrites?: boolean;
  /**
   * A `.env` file holding connection settings the host did not set. Loaded once, at startup,
   * with the CLI's precedence: a variable already in the environment wins over the file.
   */
  readonly envFile?: string;
  /** The environment to read settings from. Defaults to this process's; tests pass their own. */
  readonly env?: EnvLike;
}

/**
 * What every tool handler gets: the environment its settings come from, and a client built from
 * it on demand. The client is built per call rather than at startup so a missing or wrong setting
 * is reported by the tool that needed it — the same moment the CLI would report it — rather than
 * killing a server the host has already launched.
 */
export interface ToolContext {
  readonly env: EnvLike;
  readonly allowWrites: boolean;
  config(): GitLabConfig;
  gitlab(): GitLabClient;
}

/** Builds the context, loading the env file first so every later lookup sees it. */
export function createContext(options: ServerOptions = {}): ToolContext {
  const env = options.env ?? process.env;
  if (options.envFile !== undefined) loadEnvFile(options.envFile, env);

  return {
    env,
    allowWrites: options.allowWrites ?? false,
    config: () => resolveGitLabConfig({}, env),
    gitlab: () => new GitLabClient(resolveGitLabConfig({}, env)),
  };
}
