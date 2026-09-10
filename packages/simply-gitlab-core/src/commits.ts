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

import type { CommitAction } from './gitlab-client.js';
import { ConfigError } from './errors.js';
import { mergeBody } from './json-input.js';

const ACTIONS = new Set(['create', 'delete', 'move', 'update', 'chmod']);

/** What each action needs beyond `file_path`, checked before the request rather than after. */
const REQUIRED: Readonly<Record<string, readonly string[]>> = {
  create: ['content'],
  update: ['content'],
  move: ['previous_path'],
  delete: [],
  chmod: ['execute_filemode'],
};

/**
 * Validates the `actions` array of a commit.
 *
 * GitLab answers a malformed action with a 400 whose body names neither the index nor the file,
 * so a ten-file commit with one bad entry becomes a hunt. Every rule checked here is one GitLab
 * itself enforces — this only moves the report to where the caller can act on it.
 */
export function parseCommitActions(value: unknown): readonly CommitAction[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigError('A commit needs at least one action, as a JSON array under "actions".');
  }

  return value.map((raw, index) => {
    const where = `actions[${index}]`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new ConfigError(`${where} must be a JSON object.`);
    }
    const action = raw as Record<string, unknown>;

    const verb = action.action;
    if (typeof verb !== 'string' || !ACTIONS.has(verb)) {
      throw new ConfigError(`${where}.action must be one of ${[...ACTIONS].join(', ')}.`);
    }
    if (typeof action.file_path !== 'string' || action.file_path === '') {
      throw new ConfigError(`${where}.file_path is required.`);
    }
    for (const key of REQUIRED[verb] ?? []) {
      if (action[key] === undefined) {
        throw new ConfigError(`${where}.${key} is required for the "${verb}" action.`);
      }
    }

    return action as unknown as CommitAction;
  });
}

export interface CommitInput {
  readonly branch?: string;
  readonly message?: string;
  readonly actions?: unknown;
  readonly startBranch?: string;
  readonly startSha?: string;
  readonly authorEmail?: string;
  readonly authorName?: string;
  readonly force?: boolean;
  readonly stats?: boolean;
  readonly body?: Record<string, unknown>;
}

/**
 * Builds the body of a multi-file commit. Typed properties are merged over `body`, so a template
 * file can supply the action list while a flag names the branch.
 */
export function buildCommitBody(input: CommitInput): Record<string, unknown> {
  const merged = mergeBody(input.body, {
    branch: input.branch,
    commit_message: input.message,
    actions: input.actions,
    start_branch: input.startBranch,
    start_sha: input.startSha,
    author_email: input.authorEmail,
    author_name: input.authorName,
    force: input.force,
    stats: input.stats,
  });

  if (typeof merged.branch !== 'string' || merged.branch === '') {
    throw new ConfigError('A branch is required: pass --branch.');
  }
  if (typeof merged.commit_message !== 'string' || merged.commit_message === '') {
    throw new ConfigError('A commit message is required: pass --message.');
  }

  return { ...merged, actions: parseCommitActions(merged.actions) };
}

/**
 * Parses the `--actions` flag.
 *
 * `JSON.parse` on its own raises a SyntaxError carrying a snippet of the input, which for a flag
 * a caller may have built from a file would echo that file's first bytes into the error. Only the
 * position is kept, matching how `parseBodyInput` handles the same risk.
 */
export function parseActionsInput(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch (error) {
    const position =
      error instanceof Error ? /position \d+(?::? line \d+ column \d+)?/.exec(error.message)?.[0] : undefined;
    throw new ConfigError(`--actions is not valid JSON${position === undefined ? '' : ` at ${position}`}.`);
  }
}
