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

import { Flags } from '@oclif/core';
import { GitLabCommand, projectFlag } from '../../../shared/base-command.js';

interface DiffEntry {
  readonly old_path?: string;
  readonly new_path?: string;
  readonly new_file?: boolean;
  readonly renamed_file?: boolean;
  readonly deleted_file?: boolean;
  readonly diff?: string;
}

/** GitLab omits a path on the side of the change that does not have one. */
const UNNAMED = '(unknown)';

/** How a changed file is introduced above its hunk, so a rename or delete is not read as an edit. */
function heading(entry: DiffEntry): string {
  const from = entry.old_path ?? UNNAMED;
  const to = entry.new_path ?? UNNAMED;
  if (entry.deleted_file === true) return `deleted ${from}`;
  if (entry.new_file === true) return `added ${to}`;
  if (entry.renamed_file === true) return `renamed ${from} -> ${to}`;
  return `modified ${to}`;
}

export default class GitlabCommitDiff extends GitLabCommand<typeof GitlabCommitDiff> {
  public static override readonly summary = 'Show the changes a commit made.';
  public static override readonly description =
    'Prints the unified diff for each file the commit touched. GitLab truncates very large diffs ' +
    'server-side and says so in the payload, so --stat is worth reaching for first on a big commit: ' +
    'it lists the files without any hunks.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --sha 9a1b2c3',
    '<%= config.bin %> <%= command.id %> --project group/project --sha 9a1b2c3 --stat',
  ];

  public static override readonly flags = {
    ...projectFlag,
    sha: Flags.string({ summary: 'Commit SHA, or the name of a branch or tag.', required: true }),
    stat: Flags.boolean({ summary: 'List the changed files without printing the hunks.', default: false }),
  };

  public async run(): Promise<unknown> {
    const entries = (await this.gitlab().getCommitDiff(this.flags.project, this.flags.sha)) as DiffEntry[];

    if (!Array.isArray(entries) || entries.length === 0) {
      this.log('This commit changed no files.');
      return entries;
    }

    for (const entry of entries) {
      this.logSafe(heading(entry));
      if (!this.flags.stat && typeof entry.diff === 'string') this.logSafe(entry.diff.trimEnd());
    }

    this.log(`\n${entries.length} file(s) changed.`);
    return entries;
  }
}
