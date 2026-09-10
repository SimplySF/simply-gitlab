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

import { readFileSync } from 'node:fs';
import { ConfigError } from './errors.js';

/**
 * Reads a raw JSON request body from a flag or a file. GitLab's merge-request and commit
 * endpoints accept far more attributes than it is worth giving a flag each — squash options,
 * approval rules, milestone ids — and the set grows without our involvement, so an escape hatch
 * means an unusual attribute never blocks anyone, while the typed flags keep the common case
 * simple.
 *
 * Exactly one source is allowed. Accepting both and picking a winner would make a caller's
 * mistake look like a preference.
 */
export function parseBodyInput(
  body: string | undefined,
  bodyFile: string | undefined,
): Record<string, unknown> | undefined {
  if (body !== undefined && bodyFile !== undefined) {
    throw new ConfigError('Pass --body or --body-file, not both.');
  }

  const source = body ?? (bodyFile === undefined ? undefined : readTextFile(bodyFile, 'Body file'));
  if (source === undefined) return undefined;

  const label = bodyFile ?? '--body';
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    // Only the position, never the parser's snippet of the content: a caller can name any path,
    // and the snippet would echo the first bytes of whatever file that was.
    const position =
      error instanceof Error ? /position \d+(?::? line \d+ column \d+)?/.exec(error.message)?.[0] : undefined;
    throw new ConfigError(`${label} is not valid JSON${position === undefined ? '' : ` at ${position}`}.`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

/** Reads a file a caller named explicitly, reporting the path rather than a raw errno. */
export function readTextFile(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not found' : 'could not be read';
    throw new ConfigError(`${label} ${path} ${reason}.`);
  }
}

/**
 * Merges typed flags over a raw body, dropping the flags the caller left unset.
 *
 * A template file can supply the shape while a flag overrides a single value, which is the way
 * both are actually used together. GitLab request bodies are flat — unlike Jira's, there is no
 * nested `fields` object — so a shallow merge is the whole rule.
 */
export function mergeBody(
  body: Record<string, unknown> | undefined,
  typed: Record<string, unknown>,
): Record<string, unknown> {
  const provided = Object.fromEntries(Object.entries(typed).filter(([, value]) => value !== undefined));
  return { ...(body ?? {}), ...provided };
}

/**
 * Requires at least one attribute to change.
 *
 * GitLab answers an empty `PUT` with 200 and an unchanged object, so without this a caller who
 * misspelled a flag would be told the update succeeded and see nothing different.
 */
export function assertNotEmpty(body: Record<string, unknown>, what: string): Record<string, unknown> {
  if (Object.keys(body).length === 0) {
    throw new ConfigError(`Nothing to change: name at least one attribute to update on this ${what}.`);
  }
  return body;
}
