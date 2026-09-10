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
import { commitColumns, formatTable, type Row } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, limitFlag, projectFlag } from '../../../shared/base-command.js';

const DEFAULT_LIMIT = 20;

export default class GitlabCommitList extends GitLabCommand<typeof GitlabCommitList> {
  public static override readonly summary = 'List repository commits.';
  public static override readonly description =
    'Walks the history of a ref, newest first. --path narrows to commits that touched one file ' +
    'or directory, which is the fastest way to answer "when did this change and who changed it".\n\n' +
    '--since and --until take ISO 8601 timestamps (2026-01-31T00:00:00Z); a bare date works too.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --ref main --limit 10',
    '<%= config.bin %> <%= command.id %> --project group/project --path src/index.ts',
    '<%= config.bin %> <%= command.id %> --project group/project --since 2026-01-01 --until 2026-02-01',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...limitFlag(DEFAULT_LIMIT, 'commits'),
    ref: Flags.string({ summary: 'Branch, tag, or SHA to list from. Defaults to the default branch.' }),
    path: Flags.string({ summary: 'Only commits that touched this file or directory.' }),
    since: Flags.string({ summary: 'Only commits on or after this ISO 8601 timestamp.' }),
    until: Flags.string({ summary: 'Only commits on or before this ISO 8601 timestamp.' }),
    author: Flags.string({ summary: 'Only commits by this author name or email.' }),
    stats: Flags.boolean({ summary: 'Include per-commit line counts in the JSON payload.', default: false }),
  };

  public async run(): Promise<unknown> {
    const result = await this.gitlab().listCommits(
      this.flags.project,
      {
        ref: this.flags.ref,
        path: this.flags.path,
        since: this.flags.since,
        until: this.flags.until,
        author: this.flags.author,
        withStats: this.flags.stats || undefined,
      },
      this.flags.limit,
    );

    if (result.items.length === 0) {
      this.log('No commits matched.');
      return result;
    }

    this.logSafe(formatTable(result.items as Row[], commitColumns));
    this.reportList(result.items.length, result.total, result.complete, this.flags.limit, 'commit(s)');
    return result;
  }
}
