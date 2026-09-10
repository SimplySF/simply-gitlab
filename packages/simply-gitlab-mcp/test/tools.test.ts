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
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../src/tools.js';

/**
 * The CLI's generated command list. Cross-checking against it is the point of this file: a
 * command added to the CLI without a tool here would otherwise ship unexposed to agents, and a
 * tool naming a command that no longer exists would document something that cannot be run.
 */
const snapshot = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../simply-gitlab/command-snapshot.json', import.meta.url)), 'utf8'),
) as Array<{ command: string }>;

const cliCommands = new Set(snapshot.map((entry) => entry.command));

describe('the tool catalogue', () => {
  it('gives every tool a unique name', () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('names every tool gitlab_<noun>_<verb> in snake case', () => {
    for (const tool of TOOLS) expect(tool.name).toMatch(/^gitlab(_[a-z]+)+$/);
  });

  it('covers every CLI command', () => {
    const covered = new Set(TOOLS.map((tool) => tool.command.join(':')));
    expect([...cliCommands].filter((command) => !covered.has(command))).toStrictEqual([]);
  });

  it('names only commands the CLI actually has', () => {
    const missing = TOOLS.map((tool) => tool.command.join(':')).filter((command) => !cliCommands.has(command));
    expect(missing).toStrictEqual([]);
  });

  it('gives every write tool a dryRun input, so a change can always be previewed', () => {
    for (const tool of TOOLS.filter((entry) => entry.kind === 'write')) {
      expect(Object.keys(tool.inputSchema)).toContain('dryRun');
    }
  });

  it('marks exactly the commands that change data as writes', () => {
    const writes = TOOLS.filter((tool) => tool.kind === 'write')
      .map((tool) => tool.name)
      .sort();
    expect(writes).toStrictEqual([
      'gitlab_branch_create',
      'gitlab_commit_create',
      'gitlab_file_create',
      'gitlab_file_update',
      'gitlab_mr_create',
      'gitlab_mr_update',
    ]);
  });

  it('never offers a way to reveal a CI variable value', () => {
    // Deliberately asymmetric with the CLI's --reveal: a value revealed to an agent is a value
    // copied into a context window and whatever it writes next.
    const variables = TOOLS.find((tool) => tool.name === 'gitlab_ci_variable_list');
    expect(Object.keys(variables?.inputSchema ?? {})).not.toContain('reveal');
  });

  it('gives every tool a title and a description worth reading', () => {
    for (const tool of TOOLS) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });
});
